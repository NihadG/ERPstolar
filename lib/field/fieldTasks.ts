// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA ZADATAKA — kontrolorov „Zadaci" tab
//
// Kontrolor vidi CIJELU listu zadataka organizacije, ali samo ono što mu
// treba za rad: šta, ko, dokad, koliko je urađeno i na šta se veže. Nikakav
// novac ne postoji na zadatku, pa ovdje nema šta da se odbaci — projekcija
// ipak ide nabrajanjem polja (isti obrazac kao ostale /lib/field/*), da se
// dokument iz baze nikad ne prospe klijentu u cijelosti.
// ════════════════════════════════════════════════════════════════════

import type { Task, TaskCategory, TaskLink, TaskPriority } from '@/lib/types';
import { isTaskOpen, isTaskOverdue } from '@/lib/workOrderTasks';

export interface FieldTaskLink {
    type: TaskLink['Entity_Type'];
    name: string;
}

export interface FieldChecklistItem {
    id: string;
    text: string;
    completed: boolean;
}

export interface FieldTaskRow {
    taskId: string;
    title: string;
    description: string;
    notes: string;
    status: Task['Status'];
    priority: TaskPriority;
    category: TaskCategory;
    dueDate: string | null;      // YYYY-MM-DD
    createdDate: string;
    overdue: boolean;
    open: boolean;
    assignedWorkerName: string | null;
    checklist: FieldChecklistItem[];
    checklistDone: number;
    checklistTotal: number;
    links: FieldTaskLink[];
}

export interface FieldTasksPayload {
    today: string;
    tasks: FieldTaskRow[];
    /** Za dodjelu i filter po radniku u tabu. */
    workers: { workerId: string; name: string }[];
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const dOnly = (iso?: string | null): string => (iso ? iso.split('T')[0] : '');

function projectTask(t: Task, today: string): FieldTaskRow {
    const checklist: FieldChecklistItem[] = (t.Checklist || []).map(c => ({
        id: c.id,
        text: c.text,
        completed: !!c.completed,
    }));

    const links: FieldTaskLink[] = (t.Links || []).map(l => ({
        type: l.Entity_Type,
        name: l.Entity_Name,
    }));

    return {
        taskId: t.Task_ID,
        title: t.Title || '',
        description: t.Description || '',
        notes: t.Notes || '',
        status: t.Status,
        priority: t.Priority,
        category: t.Category,
        dueDate: t.Due_Date ? dOnly(t.Due_Date) : null,
        createdDate: t.Created_Date || '',
        overdue: isTaskOverdue(t, today),
        open: isTaskOpen(t),
        assignedWorkerName: t.Assigned_Worker_Name || null,
        checklist,
        checklistDone: checklist.filter(c => c.completed).length,
        checklistTotal: checklist.length,
        links,
    };
}

/**
 * Podrazumijevani poredak — isti kao svuda: otvoreni prije završenih, prekoračeni
 * na vrh, pa hitniji, pa raniji rok (bez roka na kraj), pa naslov. Tab može
 * pregrupisati, ali lista je smislena i bez ijednog dodira.
 */
export function sortFieldTasks(rows: FieldTaskRow[]): FieldTaskRow[] {
    return rows.slice().sort((a, b) => {
        if (a.open !== b.open) return a.open ? -1 : 1;
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        const pa = PRIORITY_RANK[a.priority] ?? 9;
        const pb = PRIORITY_RANK[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        const da = a.dueDate || '9999-12-31';
        const db = b.dueDate || '9999-12-31';
        if (da !== db) return da < db ? -1 : 1;
        return a.title.localeCompare(b.title, 'bs');
    });
}

export function buildFieldTasks(
    tasks: Task[],
    workers: { Worker_ID: string; Name: string }[],
    today: string
): FieldTasksPayload {
    return {
        today,
        tasks: sortFieldTasks(tasks.map(t => projectTask(t, today))),
        workers: workers.map(w => ({ workerId: w.Worker_ID, name: w.Name || '' })),
    };
}
