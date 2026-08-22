'use client';

// ════════════════════════════════════════════════════════════════════
// ZADACI NA TELEFONU — dovlačenje i upisi (kontrolorov „Zadaci" tab)
//
// Jedna ruta (/api/field/tasks) nosi sve: GET cijelu listu, POST kreira i
// vodi status. Odgovori na upise ne nose podatke — ekran se osvježi ponovnim
// dohvatom, isto kao kod naloga i šihtarice.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { FieldTasksPayload } from './fieldTasks';
import type { Task } from '@/lib/types';

export interface CreateFieldTaskInput {
    title: string;
    priority?: string;
    category?: string;
    dueDate?: string;
    notes?: string;
    assignedWorkerId?: string;
    checklist?: string[];
}

export function useFieldTasks() {
    const [data, setData] = useState<FieldTasksPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await apiGet<FieldTasksPayload>('/api/field/tasks'));
        } catch (e: any) {
            setError(e?.message || 'Učitavanje nije uspjelo.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleTask = useCallback(async (taskId: string, done: boolean) => {
        await apiPost('/api/field/tasks', { taskId, done });
        await load();
    }, [load]);

    const setStatus = useCallback(async (taskId: string, status: Task['Status']) => {
        await apiPost('/api/field/tasks', { taskId, status });
        await load();
    }, [load]);

    const toggleChecklistItem = useCallback(async (taskId: string, checklistItemId: string) => {
        await apiPost('/api/field/tasks', { taskId, checklistItemId });
        await load();
    }, [load]);

    const createTask = useCallback(async (input: CreateFieldTaskInput) => {
        await apiPost('/api/field/tasks', input);
        await load();
    }, [load]);

    return {
        tasks: data?.tasks ?? [],
        workers: data?.workers ?? [],
        today: data?.today ?? '',
        loading,
        error,
        reload: load,
        toggleTask,
        setStatus,
        toggleChecklistItem,
        createTask,
    };
}
