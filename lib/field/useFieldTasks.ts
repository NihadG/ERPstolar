'use client';

// ════════════════════════════════════════════════════════════════════
// ZADACI NA TELEFONU — dovlačenje i upisi (kontrolorov „Zadaci" tab)
//
// Jedna ruta (/api/field/tasks) nosi sve: GET cijelu listu, POST kreira i
// vodi status. Upisi su OPTIMISTIČNI (v. useFieldResource): kvačica, status i
// checklist se prebace odmah, a server se uskladi u pozadini. Pad upisa vrati
// zadatak na staro i javi grešku.
// ════════════════════════════════════════════════════════════════════

import { useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/apiClient';
import { useFieldResource } from './useFieldResource';
import type { FieldTaskRow, FieldTasksPayload } from './fieldTasks';
import type { Task, TaskCategory, TaskPriority } from '@/lib/types';

export interface CreateFieldTaskInput {
    title: string;
    priority?: string;
    category?: string;
    dueDate?: string;
    notes?: string;
    assignedWorkerId?: string;
    checklist?: string[];
}

/** Otvoren = na čekanju ili u toku (isto kao isTaskOpen na serveru). */
const isOpenStatus = (s: Task['Status']) => s === 'pending' || s === 'in_progress';

/** Zamijeni jedan red u payloadu novom verzijom (ostalo netaknuto). */
function replaceTask(p: FieldTasksPayload, taskId: string, fn: (t: FieldTaskRow) => FieldTaskRow): FieldTasksPayload {
    return { ...p, tasks: p.tasks.map(t => (t.taskId === taskId ? fn(t) : t)) };
}

export function useFieldTasks() {
    const { data, loading, error, reload, mutate } = useFieldResource<FieldTasksPayload>(
        () => apiGet<FieldTasksPayload>('/api/field/tasks'),
        [],
    );

    const toggleTask = useCallback(async (taskId: string, done: boolean) => {
        await mutate(
            p => replaceTask(p, taskId, t => {
                const status: Task['Status'] = done ? 'completed' : 'pending';
                return { ...t, status, open: isOpenStatus(status), overdue: isOpenStatus(status) && t.overdue };
            }),
            () => apiPost('/api/field/tasks', { taskId, done }),
        );
    }, [mutate]);

    const setStatus = useCallback(async (taskId: string, status: Task['Status']) => {
        await mutate(
            p => replaceTask(p, taskId, t => ({
                ...t, status, open: isOpenStatus(status), overdue: isOpenStatus(status) && t.overdue,
            })),
            () => apiPost('/api/field/tasks', { taskId, status }),
        );
    }, [mutate]);

    const toggleChecklistItem = useCallback(async (taskId: string, checklistItemId: string) => {
        await mutate(
            p => replaceTask(p, taskId, t => {
                const checklist = t.checklist.map(c =>
                    c.id === checklistItemId ? { ...c, completed: !c.completed } : c);
                return { ...t, checklist, checklistDone: checklist.filter(c => c.completed).length };
            }),
            () => apiPost('/api/field/tasks', { taskId, checklistItemId }),
        );
    }, [mutate]);

    const createTask = useCallback(async (input: CreateFieldTaskInput) => {
        // Privremeni red se pojavi odmah; tihi reload ga zamijeni pravim (server dodjeljuje ID i veze).
        const tempId = `temp-${Date.now()}`;
        const workerName = input.assignedWorkerId
            ? (data?.workers.find(w => w.workerId === input.assignedWorkerId)?.name ?? null)
            : null;
        const optimistic: FieldTaskRow = {
            taskId: tempId,
            title: input.title,
            description: '',
            notes: input.notes || '',
            status: 'pending',
            priority: (input.priority as TaskPriority) || 'medium',
            category: (input.category as TaskCategory) || 'general',
            dueDate: input.dueDate || null,
            createdDate: new Date().toISOString(),
            overdue: false,
            open: true,
            assignedWorkerName: workerName,
            checklist: (input.checklist || []).map((text, i) => ({ id: `${tempId}-${i}`, text, completed: false })),
            checklistDone: 0,
            checklistTotal: (input.checklist || []).length,
            links: [],
        };
        await mutate(
            p => ({ ...p, tasks: [optimistic, ...p.tasks] }),
            () => apiPost('/api/field/tasks', input),
        );
    }, [mutate, data]);

    return {
        tasks: data?.tasks ?? [],
        workers: data?.workers ?? [],
        today: data?.today ?? '',
        loading,
        error,
        reload,
        toggleTask,
        setStatus,
        toggleChecklistItem,
        createTask,
    };
}
