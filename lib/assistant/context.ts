// ════════════════════════════════════════════════════════════════════
// KONTEKST ASISTENTA — šta model vidi pri svakoj poruci.
//
// Bez vektorske baze: podaci jednog vlasnika su mali, pa u prompt ide SVE
// otvoreno (bilježnica + zadaci) uz imena radnika/projekata. Model tako
// odgovara iz trenutnog STANJA, a ne iz isječaka starih poruka.
//
// Model dobija kratke oznake (W1, P3, M7, T2) umjesto dugih ID-jeva: manje
// tokena i nema izmišljenih ID-jeva — oznaka koje nema u mapi se odbija.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from '@/lib/server/firebaseAdmin';
import { getActiveWorkers, getAllTasks } from '@/lib/server/fieldRepo';
import { buildVoiceContext } from '@/lib/voice/context';
import { contextNames, projectLabel, type VoiceProjectRef } from '@/lib/voice/extract';
import { listMemory } from './store';
import type { MemoryItem, Project, Supplier, Task } from '@/lib/types';

const MAX_PROJECTS = 150;
const MAX_TASKS = 200;

export interface Aliased<T> {
    alias: string;
    value: T;
}

export interface AssistantContext {
    workers: Aliased<{ id: string; name: string }>[];
    projects: Aliased<VoiceProjectRef>[];
    suppliers: string[];
    memory: Aliased<MemoryItem>[];
    tasks: Aliased<Task>[];
    /** Imena za prompt transkripcije glasovne poruke. */
    names: string[];
}

const OPEN_TASK = new Set<Task['Status']>(['pending', 'in_progress']);

function taskSortKey(t: Task): string {
    return (t.Reminder_At || t.Due_Date || '9999') + t.Created_Date;
}

/** Imena za transkripciju — lakše od punog konteksta (bez bilježnice i zadataka). */
export async function loadNames(orgId: string): Promise<string[]> {
    const [projects, workers, suppliers] = await Promise.all([
        loadProjects(orgId), getActiveWorkers(orgId), loadSuppliers(orgId),
    ]);
    const voice = buildVoiceContext(projects, workers);
    return contextNames({ ...voice, suppliers });
}

async function loadProjects(orgId: string): Promise<Project[]> {
    const snap = await adminDb().collection('projects').where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => d.data() as Project).filter(p => !p.Hidden);
}

async function loadSuppliers(orgId: string): Promise<string[]> {
    const snap = await adminDb().collection('suppliers').where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => (d.data() as Supplier).Name).filter(Boolean);
}

export async function loadContext(orgId: string, uid: string): Promise<AssistantContext> {
    const [projects, workers, suppliers, memory, tasks] = await Promise.all([
        loadProjects(orgId),
        getActiveWorkers(orgId),
        loadSuppliers(orgId),
        listMemory(orgId, uid),
        getAllTasks(orgId),
    ]);

    const voice = buildVoiceContext(projects, workers);
    const openTasks = tasks
        .filter(t => OPEN_TASK.has(t.Status))
        .sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)))
        .slice(0, MAX_TASKS);

    return {
        workers: (voice.workers || []).map((w, i) => ({ alias: `W${i + 1}`, value: w })),
        projects: (voice.projects || []).slice(0, MAX_PROJECTS).map((p, i) => ({ alias: `P${i + 1}`, value: p })),
        suppliers,
        memory: memory.map((m, i) => ({ alias: `M${i + 1}`, value: m })),
        tasks: openTasks.map((t, i) => ({ alias: `T${i + 1}`, value: t })),
        names: contextNames({ ...voice, suppliers }),
    };
}

export function resolveAlias<T>(list: Aliased<T>[], alias: unknown): T | null {
    if (typeof alias !== 'string') return null;
    const a = alias.trim().toUpperCase();
    return list.find(x => x.alias === a)?.value ?? null;
}

export { projectLabel };
