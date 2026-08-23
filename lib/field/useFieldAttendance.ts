'use client';

// ════════════════════════════════════════════════════════════════════
// ŠIHTARICA NA TELEFONU — dovlačenje i upisi
//
// Učitava se PO SEDMICI, ne po mjesecu. Ekran je dan-prvi i pokazuje najviše
// sedam dana odjednom, pa mjesečni dohvat znači ~4× više podataka nego što se
// ikad prikaže — što se na pogonskoj mreži osjeti.
//
// Sedmice se kešuju, pa listanje naprijed-nazad ne ide ponovo na mrežu.
// Nakon upisa keš te sedmice se odbacuje (ne cijeli), jer je to jedino što se
// promijenilo.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { FieldAttendancePayload } from './fieldAttendance';
import type { ProposalRow } from '@/lib/attendanceBooking';

export const isoOf = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Ponedjeljak sedmice u kojoj je dati dan. */
export function mondayOf(d: Date): Date {
    const out = new Date(d);
    out.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    out.setHours(0, 0, 0, 0);
    return out;
}

export function weekRange(anchor: Date): { from: string; to: string } {
    const monday = mondayOf(anchor);
    // Dohvati i prethodnu nedjelju. „Kao jučer" treba jučerašnji status, a
    // ponedjeljkom jučer (nedjelja) padne izvan sedmice — bez ovog dugme nestane
    // baš na dan kad je najkorisnije. Jedan dan više je zanemariv na mreži.
    const from = new Date(monday);
    from.setDate(monday.getDate() - 1);
    const to = new Date(monday);
    to.setDate(monday.getDate() + 6);
    return { from: isoOf(from), to: isoOf(to) };
}

/** Payload sa upisanim/izmijenjenim statusom za (radnik, dan) — ostalo netaknuto. */
function withEntry(
    p: FieldAttendancePayload, workerId: string, date: string, status: string, notes = ''
): FieldAttendancePayload {
    const rest = p.entries.filter(e => !(e.workerId === workerId && e.date === date));
    return { ...p, entries: [...rest, { workerId, date, status, notes }] };
}

export interface BookingDecision {
    workerId: string;
    workerName: string;
    orderIds: string[];
    presence: 0.5 | 1;
}

export interface BookResult {
    booked: number;
    failedWorkers: string[];
    startWarnings: string[];
    message: string;
}

export function useFieldAttendance(anchorDate: Date) {
    const { from, to } = useMemo(() => weekRange(anchorDate), [anchorDate]);

    const cache = useRef<Map<string, FieldAttendancePayload>>(new Map());
    const [data, setData] = useState<FieldAttendancePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // `silent` = tihi reconcile poslije optimističnog upisa: osvježi podatke u
    // pozadini bez spinnera i bez brisanja greške, da ekran ne treperi.
    const load = useCallback(async (force = false, silent = false) => {
        const key = `${from}_${to}`;
        if (!force && cache.current.has(key)) {
            setData(cache.current.get(key)!);
            setLoading(false);
            return;
        }
        if (!silent) { setLoading(true); setError(null); }
        try {
            const payload = await apiGet<FieldAttendancePayload>(
                `/api/field/attendance?from=${from}&to=${to}`
            );
            cache.current.set(key, payload);
            setData(payload);
        } catch (e: any) {
            if (!silent) setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [from, to]);

    /** Odmah primijeni izmjenu na tekuću sedmicu (i u keš) — ćelija reaguje na dodir. */
    const applyOptimistic = useCallback((update: (p: FieldAttendancePayload) => FieldAttendancePayload) => {
        setData(prev => {
            if (!prev) return prev;
            const next = update(prev);
            cache.current.set(`${from}_${to}`, next);
            return next;
        });
    }, [from, to]);

    useEffect(() => { load(); }, [load]);

    /** Odbaci keš sedmice kojoj datum pripada — sljedeći dolazak je svjež. */
    const invalidate = useCallback((date: string) => {
        const r = weekRange(new Date(date + 'T12:00:00'));
        cache.current.delete(`${r.from}_${r.to}`);
    }, []);

    /**
     * Označi prisustvo. Vraća prijedlog naloga kad je radnik prisutan/na terenu —
     * isti tok kao desktop, gdje se dodjela otvara odmah po označavanju.
     */
    const setStatus = useCallback(async (
        workerId: string, date: string, status: string, notes?: string
    ): Promise<ProposalRow[]> => {
        applyOptimistic(p => withEntry(p, workerId, date, status, notes));
        try {
            const res = await apiPost<{ ok: boolean; proposal: ProposalRow[] | null }>(
                '/api/field/attendance', { workerId, date, status, notes }
            );
            return res.proposal || [];
        } finally {
            // Reconcile ide i kad upis padne. Zahtjev može pasti POSLIJE upisa
            // prisustva (npr. brisanje auto-dnevnica kod odsustva), pa optimistični
            // presjek treba potvrditi svježim. Ide u POZADINI (silent) — ne blokira
            // dodir i ne vraća spinner; ćelija je već prebačena.
            invalidate(date);
            void load(true, true);
        }
    }, [applyOptimistic, invalidate, load]);

    /**
     * Grupni upis statusa za više radnika istog dana. POST-ovi idu paralelno
     * (radnici su nezavisni), pa se keš odbaci i sedmica dohvati JEDNOM — za
     * razliku od petlje `setStatus`, koja bi reloadala mrežu za svakog radnika.
     * Dnevnice se ne knjiže ovdje; to ostaje na traci „bez dnevnice → Proknjiži".
     */
    const setManyStatuses = useCallback(async (
        date: string, entries: { workerId: string; status: string; notes?: string }[]
    ): Promise<void> => {
        if (entries.length === 0) return;
        applyOptimistic(p => entries.reduce(
            (acc, e) => withEntry(acc, e.workerId, date, e.status, e.notes), p));
        try {
            // `allSettled`, ne `all`: pad jednog radnika ne smije sakriti ostale
            // koji JESU snimljeni. Prijavi se koliko ih je palo, a ekran pokaže
            // stvarno stanje iz svježeg dohvata ispod.
            const results = await Promise.allSettled(entries.map(e =>
                apiPost('/api/field/attendance', { workerId: e.workerId, date, status: e.status, notes: e.notes })
            ));
            const failed = results.filter(r => r.status === 'rejected').length;
            if (failed > 0) {
                throw new Error(failed === entries.length
                    ? 'Snimanje nije uspjelo.'
                    : `Snimljeno ${entries.length - failed} od ${entries.length} — ostalo pokušaj ponovo.`);
            }
        } finally {
            invalidate(date);
            void load(true, true);
        }
    }, [applyOptimistic, invalidate, load]);

    /** Prijedlog za više radnika — „Svi prisutni" i traka „bez dnevnice". */
    const proposalFor = useCallback(async (date: string, workerIds?: string[]): Promise<ProposalRow[]> => {
        const res = await apiPost<{ proposal: ProposalRow[] }>(
            '/api/field/attendance/proposal', { date, workerIds }
        );
        return res.proposal || [];
    }, []);

    const book = useCallback(async (date: string, decisions: BookingDecision[]): Promise<BookResult> => {
        const res = await apiPost<BookResult>('/api/field/attendance/book', { date, decisions });
        invalidate(date);
        await load(true);
        return res;
    }, [invalidate, load]);

    return { data, loading, error, reload: () => load(true), setStatus, setManyStatuses, proposalFor, book };
}
