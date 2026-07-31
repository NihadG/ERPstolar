'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIKOVI EKRANI — dovlačenje
//
// Isti obrazac kao useFieldOrders: jedan zahtjev po ekranu, bez DataContexta.
// Svaki hook nosi `previewUid` da „Pogledaj kao" radi na svim tabovima, ne
// samo na početnoj.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/apiClient';
import type { FieldOrderRow, FieldOrderDetail } from './fieldOrders';
import type { FieldProjectDetail } from './fieldProjects';
import type { WorkerCalendarMonth } from './fieldCalendar';
import type { WorkerEfficiency } from './fieldWorker';

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
