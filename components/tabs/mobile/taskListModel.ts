// ════════════════════════════════════════════════════════════════════
// ZADACI (telefon) — čista logika liste: filteri, rokovi, sortiranje, grupe
//
// Odvojeno od prikaza da bi se moglo testirati bez Reacta i da preview ruta
// i pravi tab računaju ISTO.
// ════════════════════════════════════════════════════════════════════

import type { Project, Task, TaskPriority } from '@/lib/types';
import { TASK_PRIORITY_LABELS } from '@/lib/types';

export type TaskFilter = 'open' | 'late' | 'in_progress' | 'done' | 'all';
export type TaskGroupBy = 'due' | 'priority' | 'worker' | 'project' | 'none';

export const TASK_FILTERS: { id: TaskFilter; label: string }[] = [
    { id: 'open', label: 'Otvoreni' },
    { id: 'late', label: 'Kasne' },
    { id: 'in_progress', label: 'U toku' },
    { id: 'done', label: 'Završeni' },
    { id: 'all', label: 'Svi' },
];

export const TASK_GROUPINGS: { id: TaskGroupBy; label: string }[] = [
    { id: 'due', label: 'Po roku' },
    { id: 'priority', label: 'Po hitnosti' },
    { id: 'worker', label: 'Po radniku' },
    { id: 'project', label: 'Po projektu' },
    { id: 'none', label: 'Bez grupisanja' },
];

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const isOpen = (t: Task) => t.Status === 'pending' || t.Status === 'in_progress';

/** Lokalni današnji datum kao YYYY-MM-DD (rok zadatka je datum bez vremena). */
export function localISO(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Broj dana do roka (negativno = kasni); null kad rok nije postavljen. */
export function daysToDue(t: Task, today: string): number | null {
    if (!t.Due_Date) return null;
    const due = new Date(t.Due_Date.split('T')[0] + 'T00:00:00');
    const base = new Date(today + 'T00:00:00');
    if (isNaN(due.getTime())) return null;
    return Math.round((due.getTime() - base.getTime()) / 86400000);
}

export const isLate = (t: Task, today: string) => {
    const d = daysToDue(t, today);
    return isOpen(t) && d !== null && d < 0;
};

/** Kratki natpis roka za karticu: „kasni 2 d", „danas", „sutra", „pet 24.10.". */
export function dueLabel(t: Task, today: string): { text: string; tone: '' | 'soon' | 'late' } | null {
    const d = daysToDue(t, today);
    if (d === null) return null;
    const open = isOpen(t);
    if (open && d < 0) return { text: `kasni ${-d} ${-d === 1 ? 'dan' : 'dana'}`, tone: 'late' };
    if (d === 0) return { text: 'danas', tone: open ? 'soon' : '' };
    if (d === 1) return { text: 'sutra', tone: open ? 'soon' : '' };
    const date = new Date(t.Due_Date!.split('T')[0] + 'T00:00:00');
    const dm = `${date.getDate()}.${date.getMonth() + 1}.`;
    if (d > 1 && d < 7) {
        const wd = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'][date.getDay()];
        return { text: `${wd} ${dm}`, tone: '' };
    }
    return { text: dm, tone: '' };
}

export function matchesFilter(t: Task, f: TaskFilter, today: string): boolean {
    switch (f) {
        case 'open': return isOpen(t);
        case 'late': return isLate(t, today);
        case 'in_progress': return t.Status === 'in_progress';
        case 'done': return t.Status === 'completed' || t.Status === 'cancelled';
        default: return true;
    }
}

export function countFilters(tasks: Task[], today: string): Record<TaskFilter, number> {
    const c: Record<TaskFilter, number> = { open: 0, late: 0, in_progress: 0, done: 0, all: tasks.length };
    for (const t of tasks) {
        for (const f of ['open', 'late', 'in_progress', 'done'] as const) if (matchesFilter(t, f, today)) c[f]++;
    }
    return c;
}

/** Otvoreni prije završenih; zatim kasni → rok (bez roka na kraju) → hitnost. */
export function sortTasks(tasks: Task[], today: string): Task[] {
    return [...tasks].sort((a, b) => {
        const oa = isOpen(a) ? 0 : 1, ob = isOpen(b) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        const da = daysToDue(a, today), db = daysToDue(b, today);
        if (da !== db) {
            if (da === null) return 1;
            if (db === null) return -1;
            return da - db;
        }
        return PRIORITY_RANK[a.Priority] - PRIORITY_RANK[b.Priority];
    });
}

/** ID projekta za zadatak: direktna veza na projekat, ili preko proizvoda. */
export function taskProjectId(t: Task, projects: Project[]): string | null {
    const direct = t.Links?.find(l => l.Entity_Type === 'project');
    if (direct) return direct.Entity_ID;
    for (const l of t.Links || []) {
        if (l.Entity_Type !== 'product') continue;
        const p = projects.find(pr => (pr.products || []).some(x => x.Product_ID === l.Entity_ID));
        if (p) return p.Project_ID;
    }
    return null;
}

export function searchTasks(tasks: Task[], q: string): Task[] {
    const s = q.trim().toLowerCase();
    if (!s) return tasks;
    return tasks.filter(t =>
        t.Title?.toLowerCase().includes(s)
        || t.Description?.toLowerCase().includes(s)
        || t.Assigned_Worker_Name?.toLowerCase().includes(s)
        || (t.Links || []).some(l => l.Entity_Name?.toLowerCase().includes(s)));
}

export interface TaskGroup { key: string; label: string; tone?: 'late'; items: Task[] }

export function groupTasks(tasks: Task[], by: TaskGroupBy, today: string, projects: Project[] = []): TaskGroup[] {
    if (by === 'none') return [{ key: 'all', label: '', items: tasks }];

    const buckets = new Map<string, TaskGroup>();
    const push = (key: string, label: string, t: Task, tone?: 'late') => {
        let g = buckets.get(key);
        if (!g) { g = { key, label, tone, items: [] }; buckets.set(key, g); }
        g.items.push(t);
    };

    for (const t of tasks) {
        if (!isOpen(t)) { push('~done', 'Završeno', t); continue; }
        if (by === 'due') {
            const d = daysToDue(t, today);
            if (d === null) push('4', 'Bez roka', t);
            else if (d < 0) push('0', 'Kasni', t, 'late');
            else if (d === 0) push('1', 'Danas', t);
            else if (d < 7) push('2', 'Ove sedmice', t);
            else push('3', 'Kasnije', t);
        } else if (by === 'priority') {
            push(String(PRIORITY_RANK[t.Priority]), TASK_PRIORITY_LABELS[t.Priority] + ' prioritet', t);
        } else if (by === 'worker') {
            const n = t.Assigned_Worker_Name?.trim();
            push(n ? `a:${n}` : 'z', n || 'Nedodijeljeno', t);
        } else {
            const pid = taskProjectId(t, projects);
            const p = pid ? projects.find(x => x.Project_ID === pid) : null;
            const name = p?.Name || p?.Client_Name || t.Links?.find(l => l.Entity_Type === 'project')?.Entity_Name;
            push(name ? `a:${name}` : 'z', name || 'Bez projekta', t);
        }
    }
    // Završeno uvijek na dnu (localeCompare bi interpunkciju u ključu stavio naprijed).
    return [...buckets.values()].sort((a, b) =>
        (a.key === '~done' ? 1 : 0) - (b.key === '~done' ? 1 : 0) || a.key.localeCompare(b.key, 'bs'));
}
