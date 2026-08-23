'use client';

// ════════════════════════════════════════════════════════════════════
// NALOZI NA TELEFONU — dovlačenje i upisi
//
// Lista se samo dohvaća. Detalj ima upise, i oni su OPTIMISTIČNI
// (v. useFieldResource): čekiranje procesa, zatvaranje/vraćanje proizvoda,
// zadaci — sve se prebaci na ekranu odmah, a server se uskladi u pozadini.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/apiClient';
import { useFieldResource } from './useFieldResource';
import type { FieldOrderDetail, FieldOrderRow, FieldOrderTask } from './fieldOrders';
import type { ProcPerItem, ProcRow } from '@/lib/orderProcessRows';

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

// ─── Detalj ───────────────────────────────────────────────────────────

const STATUS_BY_ACTION: Record<ProcessAction, ProcPerItem['status']> = {
    complete: 'Završeno', start: 'U toku', defer: 'Odloženo', reset: 'Na čekanju',
};

/** Novo stanje reda toka nakon što se dio njegovih stavki prebaci na `status`. */
function applyProcess(row: ProcRow, hit: (p: ProcPerItem) => boolean, status: ProcPerItem['status'], workerName?: string): ProcRow {
    const perItem = row.perItem.map(p => (hit(p)
        ? { ...p, status, ...(status === 'Završeno' && workerName ? { workerName } : {}) }
        : p));
    const done = perItem.filter(p => p.status === 'Završeno').length;
    // Puno stanje (gating) prepravi tihi reload; ovdje samo da kvačica i brojač reaguju.
    const state: ProcRow['state'] = done === row.total && row.total > 0
        ? 'done'
        : (row.state === 'done' ? 'active' : row.state);
    return { ...row, perItem, done, state };
}

export function useFieldOrderDetail(orderId: string | null) {
    const { data: detail, loading, error, reload, mutate } = useFieldResource<FieldOrderDetail>(
        orderId ? () => apiGet<FieldOrderDetail>(`/api/field/work-orders/${orderId}`) : null,
        [orderId],
    );

    const updateProcess = useCallback(async (
        action: ProcessAction,
        targets: ProcessTarget[],
        extra?: { date?: string; workerIds?: string[]; notes?: string }
    ) => {
        if (!orderId) return;
        const status = STATUS_BY_ACTION[action];
        const wanted = new Set(targets.map(t => `${t.itemId}|${t.procName}`));
        const workerName = extra?.workerIds?.[0]
            ? detail?.crew.find(c => c.workerId === extra.workerIds![0])?.name
            : undefined;
        await mutate(
            d => ({
                ...d,
                flow: d.flow.map(row => applyProcess(
                    row, p => wanted.has(`${p.itemId}|${p.procName}`), status, workerName,
                )),
            }),
            () => apiPost(`/api/field/work-orders/${orderId}/process`, { action, targets, ...extra }),
        );
    }, [orderId, mutate, detail]);

    const completeProduct = useCallback(async (itemId: string, date: string) => {
        if (!orderId) return;
        await mutate(
            d => ({
                ...d,
                items: d.items.map(it => it.itemId === itemId
                    ? { ...it, status: 'Završeno', progressPct: 100, canComplete: false, isPaused: false }
                    : it),
            }),
            () => apiPost(`/api/field/work-orders/${orderId}/item`, { itemId, date }),
        );
    }, [orderId, mutate]);

    const reopenProduct = useCallback(async (itemId: string) => {
        if (!orderId) return;
        await mutate(
            d => ({
                ...d,
                items: d.items.map(it => it.itemId === itemId
                    ? { ...it, status: 'U toku', canComplete: false }
                    : it),
            }),
            () => apiPost(`/api/field/work-orders/${orderId}/item`, { itemId, action: 'reopen' }),
        );
    }, [orderId, mutate]);

    const toggleTask = useCallback(async (taskId: string, done: boolean) => {
        await mutate(
            d => ({
                ...d,
                tasks: d.tasks.map(t => t.taskId === taskId
                    ? { ...t, status: done ? 'completed' : 'pending' }
                    : t),
            }),
            () => apiPost('/api/field/tasks', { taskId, done }),
        );
    }, [mutate]);

    const addTask = useCallback(async (input: {
        title: string; priority?: string; productId?: string; assignedWorkerId?: string;
    }) => {
        if (!orderId) return;
        const tempId = `temp-${Date.now()}`;
        const optimistic: FieldOrderTask = {
            taskId: tempId,
            title: input.title,
            status: 'pending',
            priority: input.priority || 'medium',
            dueDate: null,
            assignedWorkerName: input.assignedWorkerId
                ? (detail?.crew.find(c => c.workerId === input.assignedWorkerId)?.name ?? null)
                : null,
            checklistDone: 0,
            checklistTotal: 0,
        };
        await mutate(
            d => ({ ...d, tasks: [optimistic, ...d.tasks] }),
            () => apiPost('/api/field/tasks', { ...input, workOrderId: orderId }),
        );
    }, [orderId, mutate, detail]);

    return {
        detail, loading, error, reload,
        updateProcess, completeProduct, reopenProduct, toggleTask, addTask,
    };
}
