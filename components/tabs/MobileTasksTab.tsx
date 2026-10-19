'use client';

// ════════════════════════════════════════════════════════════════════
// ZADACI (telefon) — veza mobilnog prikaza sa servisima
//
// Prikaz je u mobile/MobileTasksView (isti jezik kao ostali mobilni
// ekrani). Ovdje su samo upisi: status i kontrolna lista se mijenjaju
// optimistično (kvačica reaguje odmah), pa se tiho usklade s bazom.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task, TaskProfile, Project, Worker, Material, WorkOrder, Order } from '@/lib/types';
import { saveTask, deleteTask, updateTaskStatus, toggleTaskChecklistItem } from '@/lib/services';
import { useData } from '@/context/DataContext';
import MobileTasksView from './mobile/MobileTasksView';

interface MobileTasksTabProps {
    tasks: Task[];
    projects: Project[];
    workers: Worker[];
    materials: Material[];
    workOrders?: WorkOrder[];
    orders?: Order[];
    taskProfiles?: TaskProfile[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    projectFilter?: string | null;
    onClearFilter?: () => void;
}

export default function MobileTasksTab({
    tasks, projects, workers, materials, workOrders = [], orders = [], taskProfiles = [],
    onRefresh, showToast, projectFilter, onClearFilter,
}: MobileTasksTabProps) {
    const { organizationId } = useData();

    const [localTasks, setLocalTasks] = useState<Task[]>(tasks);
    useEffect(() => { setLocalTasks(tasks); }, [tasks]);
    const localRef = useRef(localTasks);
    localRef.current = localTasks;

    const patchLocal = (taskId: string, fn: (t: Task) => Task) =>
        setLocalTasks(prev => prev.map(t => (t.Task_ID === taskId ? fn(t) : t)));

    const onSave = useCallback(async (data: Partial<Task>) => {
        const result = await saveTask(data, organizationId!);
        showToast(result.message, result.success ? 'success' : 'error');
        if (result.success) onRefresh('tasks');
        return result.success;
    }, [organizationId, showToast, onRefresh]);

    const onDelete = useCallback(async (taskId: string) => {
        const before = localRef.current;
        setLocalTasks(prev => prev.filter(t => t.Task_ID !== taskId));
        const result = await deleteTask(taskId, organizationId!);
        showToast(result.message, result.success ? 'success' : 'error');
        if (result.success) onRefresh('tasks');
        else setLocalTasks(before);
    }, [organizationId, showToast, onRefresh]);

    const onStatus = useCallback(async (taskId: string, status: Task['Status']) => {
        const before = localRef.current;
        patchLocal(taskId, t => ({ ...t, Status: status }));
        const result = await updateTaskStatus(taskId, status, organizationId!);
        if (result.success) onRefresh('tasks');
        else { setLocalTasks(before); showToast(result.message, 'error'); }
    }, [organizationId, showToast, onRefresh]);

    const onToggleChecklist = useCallback(async (taskId: string, itemId: string) => {
        const before = localRef.current;
        patchLocal(taskId, t => ({
            ...t,
            Checklist: (t.Checklist || []).map(c => (c.id === itemId ? { ...c, completed: !c.completed } : c)),
        }));
        const result = await toggleTaskChecklistItem(taskId, itemId, organizationId!);
        if (result.success) onRefresh('tasks');
        else { setLocalTasks(before); showToast(result.message, 'error'); }
    }, [organizationId, showToast, onRefresh]);

    return (
        <MobileTasksView
            tasks={localTasks}
            projects={projects}
            workers={workers}
            materials={materials}
            workOrders={workOrders}
            orders={orders}
            taskProfiles={taskProfiles}
            projectFilter={projectFilter}
            onClearFilter={onClearFilter}
            onSave={onSave}
            onDelete={onDelete}
            onStatus={onStatus}
            onToggleChecklist={onToggleChecklist}
        />
    );
}
