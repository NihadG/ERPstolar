'use client';

// ════════════════════════════════════════════════════════════════════
// ŠIHTARICA — kontrolorov ekran
//
// DAN-PRVI, ne mjesec-prvi. Desktop mreža radnik×dan na telefonu ne radi:
// 15 radnika × 31 dan je 465 ćelija od kojih se vidi šaka. Kontrolor ionako
// uvijek radi jedan dan — današnji.
//
// Tok je isti kao desktop: označi prisustvo → otvori se dodjela naloga →
// potvrdi. Razlika je samo u tome što su ovdje mete velike i što se sve
// dogodi u dva dodira.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ListChecks, ReceiptText, Users, Wallet } from 'lucide-react';
import type { ProposalRow } from '@/lib/attendanceBooking';
import { bookedKey, unbookedPresentWorkers } from '@/lib/field/fieldAttendance';
import { isoOf, mondayOf, useFieldAttendance } from '@/lib/field/useFieldAttendance';
import { MLarge, MSearch, MEmpty, MButton, MAvatar } from '@/components/tabs/mobile/MobileUI';
import { haptic } from '@/components/tabs/mobile/useSwipe';
import StatusSheet from './StatusSheet';
import BookingScreen from './BookingScreen';
import BulkAttendanceScreen from './BulkAttendanceScreen';

const DOW = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];

const TONE: Record<string, string> = {
    'Prisutan': 'green', 'Teren': 'blue', 'Odsutan': 'gray',
    'Bolovanje': 'orange', 'Odmor': 'orange', 'Vikend': 'gray', 'Praznik': 'purple',
};

// Poredak liste za izabrani dan prati kontrolorovu pažnju: prvo ko je tu, pa
// teren, pa odsustva po težini, a ostala i neoznačeni na dnu. Neoznačeni idu
// najniže (rang 5) — na početku dana su svi tu, pa kako se označavaju, prisutni
// se dižu na vrh, a „još za uraditi" ostaje skupljeno pri dnu.
const STATUS_RANK: Record<string, number> = {
    'Prisutan': 0, 'Teren': 1, 'Bolovanje': 2, 'Odmor': 3,
    'Odsutan': 4, 'Vikend': 4, 'Praznik': 4,
};
const rankOf = (status?: string): number => (status == null ? 5 : STATUS_RANK[status] ?? 4);

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

const longDate = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' });

interface Props {
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    readOnly?: boolean;
    /**
     * Obračun dnevnica. Postoji samo za vlasnika (isti ekran na telefonu):
     * kontrolor raspoređuje ljude i ne vidi iznose, pa kod njega ovo izostaje
     * i dugme se ne crta.
     */
    onOpenPayroll?: () => void;
}

export default function AttendanceScreen({ showToast, readOnly, onOpenPayroll }: Props) {
    const [anchor, setAnchor] = useState(() => new Date());
    const [selected, setSelected] = useState(() => isoOf(new Date()));
    const [search, setSearch] = useState('');
    const [sheetWorker, setSheetWorker] = useState<{ id: string; name: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [booking, setBooking] = useState<{ rows: ProposalRow[]; date: string } | null>(null);
    const [bulkOpen, setBulkOpen] = useState(false);

    const { data, loading, error, reload, setStatus, setManyStatuses, proposalFor, book } = useFieldAttendance(anchor);

    const today = isoOf(new Date());

    // ── Izvedeno ─────────────────────────────────────────────────────
    const statusByWorker = useMemo(() => {
        const map = new Map<string, { status: string; notes: string }>();
        for (const e of data?.entries || []) {
            if (e.date === selected) map.set(e.workerId, { status: e.status, notes: e.notes });
        }
        return map;
    }, [data, selected]);

    const yesterdayByWorker = useMemo(() => {
        const prev = new Date(selected + 'T12:00:00');
        prev.setDate(prev.getDate() - 1);
        const prevISO = isoOf(prev);
        const map = new Map<string, string>();
        for (const e of data?.entries || []) {
            if (e.date === prevISO) map.set(e.workerId, e.status);
        }
        return map;
    }, [data, selected]);

    const booked = useMemo(() => new Set(data?.bookedKeys || []), [data]);

    const unbooked = useMemo(
        () => (data ? unbookedPresentWorkers(data, selected) : []),
        [data, selected]
    );

    const weekDays = useMemo(() => {
        const start = mondayOf(new Date(selected + 'T12:00:00'));
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            return isoOf(d);
        });
    }, [selected]);

    /** Dan ima nešto neproknjiženo → tačka na pilulu sedmice. */
    const weekWarn = useMemo(() => {
        const out = new Set<string>();
        for (const e of data?.entries || []) {
            if ((e.status === 'Prisutan' || e.status === 'Teren') && !booked.has(bookedKey(e.workerId, e.date))) {
                out.add(e.date);
            }
        }
        return out;
    }, [data, booked]);

    const workers = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = (data?.workers || []).filter(w => !q || w.name.toLowerCase().includes(q));
        // Sortiraj po statusu IZABRANOG dana; unutar iste grupe ostaje abecedno
        // (projekcija radnike već slaže po imenu).
        return list.slice().sort((a, b) => {
            const ra = rankOf(statusByWorker.get(a.workerId)?.status);
            const rb = rankOf(statusByWorker.get(b.workerId)?.status);
            return ra - rb || a.name.localeCompare(b.name, 'bs');
        });
    }, [data, search, statusByWorker]);

    const markedCount = useMemo(
        () => (data?.workers || []).filter(w => statusByWorker.has(w.workerId)).length,
        [data, statusByWorker]
    );

    // ── Radnje ───────────────────────────────────────────────────────
    const goDay = useCallback((delta: number) => {
        const d = new Date(selected + 'T12:00:00');
        d.setDate(d.getDate() + delta);
        const iso = isoOf(d);
        setSelected(iso);
        // Prelazak u drugu sedmicu pomjera i dohvat.
        if (isoOf(mondayOf(d)) !== isoOf(mondayOf(new Date(selected + 'T12:00:00')))) setAnchor(d);
        haptic(5);
    }, [selected]);

    const pickDay = useCallback((iso: string) => {
        setSelected(iso);
        haptic(5);
    }, []);

    const handlePick = useCallback(async (status: string, notes?: string) => {
        if (!sheetWorker) return;
        setBusy(true);
        try {
            const proposal = await setStatus(sheetWorker.id, selected, status, notes);
            setSheetWorker(null);
            // Isto kao desktop: prisustvo označeno → odmah se otvara dodjela naloga.
            if (proposal.length > 0) setBooking({ rows: proposal, date: selected });
            else showToast('Prisustvo sačuvano', 'success');
        } catch (e: any) {
            showToast(e?.message || 'Snimanje nije uspjelo', 'error');
        } finally {
            setBusy(false);
        }
    }, [sheetWorker, selected, setStatus, showToast]);

    const openBookingFor = useCallback(async (workerIds?: string[]) => {
        setBusy(true);
        try {
            const rows = await proposalFor(selected, workerIds);
            if (rows.length === 0) {
                showToast('Nema naloga za knjiženje', 'info');
                return;
            }
            setBooking({ rows, date: selected });
        } catch (e: any) {
            showToast(e?.message || 'Učitavanje nije uspjelo', 'error');
        } finally {
            setBusy(false);
        }
    }, [selected, proposalFor, showToast]);

    const markAllPresent = useCallback(async () => {
        const missing = (data?.workers || []).filter(w => !statusByWorker.has(w.workerId));
        if (missing.length === 0) {
            showToast('Svi su već označeni', 'info');
            return;
        }
        setBusy(true);
        try {
            // Grupni upis, ne petlja `setStatus`. Petlja je za svakog radnika
            // radila POST + puni dohvat sedmice (17 radnika = 34 kruga na
            // pogonskoj mreži), a prvi pad bi je prekinuo na pola — ostatak
            // ekipe ostane neoznačen, a poruka kaže samo „snimanje nije uspjelo".
            // Dnevnice se ne knjiže ovdje; to radi korak ispod.
            await setManyStatuses(selected, missing.map(w => ({ workerId: w.workerId, status: 'Prisutan' })));
            showToast(`Označeno ${missing.length} radnika`, 'success');
            await openBookingFor(missing.map(w => w.workerId));
        } catch (e: any) {
            showToast(e?.message || 'Snimanje nije uspjelo', 'error');
        } finally {
            setBusy(false);
        }
    }, [data, statusByWorker, selected, setManyStatuses, showToast, openBookingFor]);

    // Zatečeni status po radniku (bez napomene) — polazna tačka grupnog nacrta.
    const currentStatusMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const [id, v] of statusByWorker) map.set(id, v.status);
        return map;
    }, [statusByWorker]);

    const saveBulk = useCallback(async (entries: { workerId: string; status: string }[]) => {
        try {
            await setManyStatuses(selected, entries);
            showToast(`Sačuvano za ${entries.length} radnika`, 'success');
        } catch (e: any) {
            showToast(e?.message || 'Snimanje nije uspjelo', 'error');
            throw e;   // ekran ostaje otvoren za ponovni pokušaj
        }
    }, [selected, setManyStatuses, showToast]);

    // ── Prikaz ───────────────────────────────────────────────────────
    if (booking) {
        return (
            <BookingScreen
                rows={booking.rows}
                date={booking.date}
                showToast={showToast}
                onClose={() => setBooking(null)}
                onConfirm={async decisions => {
                    const res = await book(booking.date, decisions);
                    setBooking(null);
                    showToast(res.message, res.failedWorkers.length > 0 ? 'error' : 'success');
                    res.startWarnings.forEach(w => showToast(w, 'error'));
                }}
            />
        );
    }

    if (bulkOpen && data) {
        return (
            <BulkAttendanceScreen
                date={selected}
                workers={data.workers}
                current={currentStatusMap}
                yesterday={yesterdayByWorker}
                onClose={() => setBulkOpen(false)}
                onSave={saveBulk}
            />
        );
    }

    return (
        <>
            <MLarge title="Šihtarica">
                {longDate(selected)}
                {data && <span className="mui-dim">· {markedCount}/{data.workers.length} označeno</span>}
            </MLarge>

            {/* Dan i sedmica */}
            <div className="fat-daynav">
                <button type="button" className="fat-navbtn" onClick={() => goDay(-1)} aria-label="Prethodni dan">
                    <ChevronLeft size={22} />
                </button>
                <div className="fat-week">
                    {weekDays.map((iso, i) => {
                        const isSel = iso === selected;
                        const isToday = iso === today;
                        return (
                            <button
                                key={iso}
                                type="button"
                                className={`fat-pill${isSel ? ' on' : ''}${isToday ? ' today' : ''}`}
                                onClick={() => pickDay(iso)}
                            >
                                <span className="fat-pill-dow">{DOW[i]}</span>
                                <span className="fat-pill-num">{Number(iso.slice(8, 10))}</span>
                                {weekWarn.has(iso) && <span className="fat-pill-dot" />}
                            </button>
                        );
                    })}
                </div>
                <button type="button" className="fat-navbtn" onClick={() => goDay(1)} aria-label="Sljedeći dan">
                    <ChevronRight size={22} />
                </button>
            </div>

            {selected !== today && (
                <button type="button" className="fat-today" onClick={() => { setSelected(today); setAnchor(new Date()); }}>
                    <CalendarDays size={15} /> Nazad na danas
                </button>
            )}

            {/* Neproknjiženi — najvažnija radnja dana */}
            {!readOnly && unbooked.length > 0 && (
                <button
                    type="button"
                    className="fat-unbooked"
                    disabled={busy}
                    onClick={() => openBookingFor(unbooked.map(u => u.workerId))}
                >
                    <ReceiptText size={19} />
                    <span>
                        <b>{unbooked.length}</b> {unbooked.length === 1 ? 'radnik' : 'radnika'} bez dnevnice
                    </span>
                    <span className="fat-unbooked-cta">Proknjiži</span>
                </button>
            )}

            {!readOnly && (
                <div className="fat-bulkrow">
                    <button type="button" className="fat-bulk" disabled={busy} onClick={markAllPresent}>
                        <Users size={18} /> Svi prisutni
                    </button>
                    <button type="button" className="fat-bulk" disabled={busy || !data} onClick={() => setBulkOpen(true)}>
                        <ListChecks size={18} /> Grupno
                    </button>
                    {onOpenPayroll && (
                        <button type="button" className="fat-bulk" onClick={onOpenPayroll}>
                            <Wallet size={18} /> Obračun
                        </button>
                    )}
                </div>
            )}

            <div className="fat-search">
                <MSearch value={search} onChange={setSearch} placeholder="Traži radnika…" />
            </div>

            {loading && !data && <div className="fat-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Podaci nisu učitani" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={reload}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {data && workers.length === 0 && !error && (
                <MEmpty
                    title={search ? 'Nema rezultata' : 'Nema radnika'}
                    sub={search ? 'Promijeni pretragu.' : 'Radnici se dodaju u aplikaciji.'}
                />
            )}

            <div className="fat-list">
                {workers.map(w => {
                    const entry = statusByWorker.get(w.workerId);
                    const tone = entry ? (TONE[entry.status] || 'gray') : 'none';
                    const isUnbooked = !!entry
                        && (entry.status === 'Prisutan' || entry.status === 'Teren')
                        && !booked.has(bookedKey(w.workerId, selected));

                    return (
                        <button
                            key={w.workerId}
                            type="button"
                            className={`fat-card ${tone}`}
                            disabled={readOnly || busy}
                            onClick={() => setSheetWorker({ id: w.workerId, name: w.name })}
                        >
                            <MAvatar tone={entry ? (tone as any) : 'gray'}>{initials(w.name)}</MAvatar>
                            <span className="fat-card-main">
                                <span className="fat-card-name">{w.name}</span>
                                <span className="fat-card-role">{w.role || w.workerType}</span>
                            </span>
                            <span className="fat-card-right">
                                {isUnbooked && <span className="fat-dot" title="Nema dnevnicu" />}
                                <span className={`fat-status ${tone}`}>
                                    {entry ? entry.status : 'Označi'}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>

            <StatusSheet
                open={!!sheetWorker}
                workerName={sheetWorker?.name || ''}
                dateLabel={longDate(selected)}
                current={sheetWorker ? statusByWorker.get(sheetWorker.id)?.status : undefined}
                yesterday={sheetWorker ? yesterdayByWorker.get(sheetWorker.id) : undefined}
                busy={busy}
                onClose={() => setSheetWorker(null)}
                onPick={handlePick}
            />
        </>
    );
}
