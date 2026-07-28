'use client';

// ════════════════════════════════════════════════════════════════════
// NALOZI NA TELEFONU — dovlačenje i upisi
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { FieldOrderDetail, FieldOrderRow } from './fieldOrders';

export interface ProcessTarget { itemId: string; procName: string }

export type ProcessAction = 'complete' | 'start' | 'defer' | 'reset';

export function useFieldOrders() {
    const [orders, setOrders] = useState<FieldOrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiGet<{ today: string; orders: FieldOrderRow[] }>('/api/field/work-orders');
            setOrders(res.orders);
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return { orders, loading, error, reload: load };
}

export function useFieldOrderDetail(orderId: string | null) {
    const [detail, setDetail] = useState<FieldOrderDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!orderId) { setDetail(null); return; }
        setLoading(true);
        setError(null);
        try {
            setDetail(await apiGet<FieldOrderDetail>(`/api/field/work-orders/${orderId}`));
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    useEffect(() => { load(); }, [load]);

    /** Čekiranje procesa. Odgovor ne nosi podatke — ekran se osvježi ponovnim dohvatom. */
    const updateProcess = useCallback(async (
        action: ProcessAction,
        targets: ProcessTarget[],
        extra?: { date?: string; workerIds?: string[]; notes?: string }
    ) => {
        if (!orderId) return;
        await apiPost(`/api/field/work-orders/${orderId}/process`, { action, targets, ...extra });
        await load();
    }, [orderId, load]);

    const completeProduct = useCallback(async (itemId: string, date: string) => {
        if (!orderId) return;
        await apiPost(`/api/field/work-orders/${orderId}/item`, { itemId, date });
        await load();
    }, [orderId, load]);

    const reopenProduct = useCallback(async (itemId: string) => {
        if (!orderId) return;
        await apiPost(`/api/field/work-orders/${orderId}/item`, { itemId, action: 'reopen' });
        await load();
    }, [orderId, load]);

    const toggleTask = useCallback(async (taskId: string, done: boolean) => {
        await apiPost('/api/field/tasks', { taskId, done });
        await load();
    }, [load]);

    const addTask = useCallback(async (input: {
        title: string; priority?: string; productId?: string; assignedWorkerId?: string;
    }) => {
        if (!orderId) return;
        await apiPost('/api/field/tasks', { ...input, workOrderId: orderId });
        await load();
    }, [orderId, load]);

    return {
        detail, loading, error, reload: load,
        updateProcess, completeProduct, reopenProduct, toggleTask, addTask,
    };
}
