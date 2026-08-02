'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIKOVI EKRANI — dovlačenje
//
// Isti obrazac kao useFieldOrders: jedan zahtjev po ekranu, bez DataContexta.
// Svaki hook nosi `previewUid` da „Pogledaj kao" radi na svim tabovima, ne
// samo na početnoj.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/apiClient';
import type { FieldOrderRow, FieldOrderDetail } from './fieldOrders';
import type { FieldProjectDetail } from './fieldProjects';
import type { WorkerCalendarMonth } from './fieldCalendar';
import type { WorkerEfficiency } from './fieldWorker';
import type { NoteRow } from './fieldNotes';

function withPreview(path: string, previewUid?: string | null): string {
    if (!previewUid) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}preview=${encodeURIComponent(previewUid)}`;
}

interface WorkPayload {
    today: string;
    orders: FieldOrderRow[];
    projects: FieldProjectDetail[];
}

export function useWorkerWork(previewUid?: string | null) {
    const [data, setData] = useState<WorkPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await apiGet<WorkPayload>(withPreview('/api/field/worker/work', previewUid)));
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, [previewUid]);

    useEffect(() => { load(); }, [load]);

    return {
        orders: data?.orders || [],
        projects: data?.projects || [],
        today: data?.today || '',
        loading,
        error,
        reload: load,
    };
}

export function useWorkerOrderDetail(orderId: string | null, previewUid?: string | null) {
    const [detail, setDetail] = useState<FieldOrderDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!orderId) { setDetail(null); return; }
        setLoading(true);
        setError(null);
        try {
            setDetail(await apiGet<FieldOrderDetail>(withPreview(`/api/field/worker/orders/${orderId}`, previewUid)));
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, [orderId, previewUid]);

    useEffect(() => { load(); }, [load]);

    return { detail, loading, error, reload: load };
}

export function useWorkerCalendar(month: string, previewUid?: string | null) {
    const [calendar, setCalendar] = useState<WorkerCalendarMonth | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setCalendar(await apiGet<WorkerCalendarMonth>(withPreview(`/api/field/worker/calendar?month=${month}`, previewUid)));
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, [month, previewUid]);

    useEffect(() => { load(); }, [load]);

    return { calendar, loading, error, reload: load };
}

export function useWorkerNotes(previewUid?: string | null) {
    const [notes, setNotes] = useState<NoteRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiGet<{ notes: NoteRow[] }>(withPreview('/api/field/worker/notes', previewUid));
            setNotes(res.notes);
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, [previewUid]);

    useEffect(() => { load(); }, [load]);

    return { notes, setNotes, loading, error, reload: load };
}

export interface CreateNoteInput {
    title: string;
    workOrderId: string;
    productId?: string;
    priority?: string;
}

/**
 * Direktne radnje nad napomenama (kreiranje/čekiranje/brisanje) — BEZ odobrenja,
 * jer napomena je običan zadatak. Server šalje notifikaciju poslodavcu na
 * kreiranje. Pisanje ne nosi `preview` — u pregledu je sve ionako ugašeno.
 */
export function useWorkerNoteActions() {
    const [busy, setBusy] = useState(false);

    const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
        setBusy(true);
        try { return await fn(); }
        finally { setBusy(false); }
    }, []);

    const createNote = useCallback((input: CreateNoteInput) =>
        run(() => apiPost<{ taskId: string }>('/api/field/worker/notes', input)), [run]);

    const toggleNote = useCallback((taskId: string, done: boolean) =>
        run(() => apiPatch('/api/field/worker/notes', { taskId, done })), [run]);

    const toggleChecklistItem = useCallback((taskId: string, checklistItemId: string, done: boolean) =>
        run(() => apiPatch('/api/field/worker/notes', { taskId, checklistItemId, done })), [run]);

    const deleteNote = useCallback((taskId: string) =>
        run(() => apiDelete(`/api/field/worker/notes?taskId=${encodeURIComponent(taskId)}`)), [run]);

    return { createNote, toggleNote, toggleChecklistItem, deleteNote, busy };
}

export function useWorkerMe(previewUid?: string | null) {
    const [efficiency, setEfficiency] = useState<WorkerEfficiency | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setEfficiency(await apiGet<WorkerEfficiency>(withPreview('/api/field/worker/me', previewUid)));
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, [previewUid]);

    useEffect(() => { load(); }, [load]);

    return { efficiency, loading, error, reload: load };
}
