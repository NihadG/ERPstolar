// ════════════════════════════════════════════════════════════════════
// KONTEKST ASISTENTA — šta model vidi pri svakoj poruci.
//
// Bez vektorske baze: podaci jednog vlasnika su mali, pa u prompt ide ono
// što je otvoreno i blizu (bilježnica + bliski zadaci) uz imena radnika i
// aktivnih projekata. Sve ostalo model nađe alatom search_memory.
//
// Svaki token se plaća pri svakom pozivu, zato su liste namjerno skraćene:
// zatvoreni stari projekti i zadaci daleko u budućnosti ne ulaze u prompt.
//
// Model dobija kratke oznake (W1, P3, M7, T2) umjesto dugih ID-jeva: manje
// tokena i nema izmišljenih ID-jeva — oznaka koje nema u mapi se odbija.
// Redoslijed je deterministički (isti ulaz → isti tekst), da keš prompta radi.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from '@/lib/server/firebaseAdmin';
import { getActiveWorkers, getAllTasks, getOpenWorkOrders } from '@/lib/server/fieldRepo';
import { buildVoiceContext } from '@/lib/voice/context';
import { contextNames, projectLabel, type VoiceProjectRef } from '@/lib/voice/extract';
import { listMemory } from './store';
import { activeVocab, type VocabEntry } from './vocab';
import { listVocab } from './vocabStore';
import type { MemoryItem, Project, Supplier, Task, WorkOrder } from '@/lib/types';

const MAX_PROJECTS = 80;
const MAX_ORDERS = 100;
const MAX_TASKS = 60;
const MAX_MEMORY = 150;
/** Zatvoren projekat ostaje u listi još ovoliko dana (reklamacije, završne montaže). */
const CLOSED_PROJECT_DAYS = 90;
/** Zadaci s rokom/podsjetnikom u ovom rasponu oko danas ulaze u prompt. */
const TASK_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const CLOSED = /zavr|otkaz|arhiv|cancel|complete|closed/i;

export interface Aliased<T> {
    alias: string;
    value: T;
}

export interface AssistantContext {
    workers: Aliased<{ id: string; name: string }>[];
    projects: Aliased<VoiceProjectRef>[];
    /** Otvoreni radni nalozi — R# su isti iz poruke u poruku, pa „sve osim vrata" radi i kao odgovor. */
    orders?: Aliased<{ id: string; name: string }>[];
    /** Naučene riječi koje sada važe (projekat/nalog aktivan, lokacija nije istekla). */
    vocab?: VocabEntry[];
    suppliers: string[];
    memory: Aliased<MemoryItem>[];
    tasks: Aliased<Task>[];
    /** Imena za prompt transkripcije glasovne poruke. */
    names: string[];
}

const OPEN_TASK = new Set<Task['Status']>(['pending', 'in_progress']);

function taskSortKey(t: Task): string {
    return (t.Reminder_At || t.Due_Date || '9999') + t.Created_Date + t.Task_ID;
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
    return snap.docs.map(d => (d.data() as Supplier).Name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'bs'));
}

/** Aktivni projekti + nedavno zatvoreni; stari zatvoreni ne troše tokene. */
export function relevantProjects(projects: Project[], now: Date): Project[] {
    const cutoff = new Date(now.getTime() - CLOSED_PROJECT_DAYS * DAY_MS).toISOString();
    return projects.filter(p => !CLOSED.test(p.Status || '') || String(p.Created_Date || '') >= cutoff);
}

/**
 * Otvoreni zadaci koji su „blizu": rok ili podsjetnik u ±30 dana, bez datuma
 * a skorašnji, ili ih je korisnik sam napravio preko asistenta.
 */
export function relevantTasks(tasks: Task[], uid: string, now: Date): Task[] {
    const from = new Date(now.getTime() - TASK_WINDOW_DAYS * DAY_MS).toISOString();
    const to = new Date(now.getTime() + TASK_WINDOW_DAYS * DAY_MS).toISOString();
    const near = (iso?: string) => !!iso && iso.slice(0, 10) >= from.slice(0, 10) && iso.slice(0, 10) <= to.slice(0, 10);
    return tasks
        .filter(t => OPEN_TASK.has(t.Status))
        .filter(t => t.Created_By_UID === uid
            || near(t.Reminder_At) || near(t.Due_Date)
            || (!t.Reminder_At && !t.Due_Date && String(t.Created_Date || '') >= from))
        .sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)))
        .slice(0, MAX_TASKS);
}

/** Otvoreni nalozi po nazivu (deterministički, keš prompta) → R1, R2… */
export function orderRefs(orders: WorkOrder[]): Aliased<{ id: string; name: string }>[] {
    return orders
        .map(o => ({ id: o.Work_Order_ID, name: o.Name || o.Work_Order_Number || 'Nalog' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'bs') || a.id.localeCompare(b.id))
        .slice(0, MAX_ORDERS)
        .map((value, i) => ({ alias: `R${i + 1}`, value }));
}

export async function loadContext(orgId: string, uid: string, now: Date = new Date()): Promise<AssistantContext> {
    const [projects, workers, suppliers, memory, tasks, orders, vocab] = await Promise.all([
        loadProjects(orgId),
        getActiveWorkers(orgId),
        loadSuppliers(orgId),
        listMemory(orgId, uid),
        getAllTasks(orgId),
        getOpenWorkOrders(orgId),
        listVocab(orgId).catch(() => [] as VocabEntry[]),
    ]);

    const voice = buildVoiceContext(relevantProjects(projects, now), workers);

    return {
        workers: (voice.workers || []).map((w, i) => ({ alias: `W${i + 1}`, value: w })),
        projects: (voice.projects || []).slice(0, MAX_PROJECTS).map((p, i) => ({ alias: `P${i + 1}`, value: p })),
        orders: orderRefs(orders),
        vocab: activeVocab(vocab, {
            projectIds: new Set((voice.projects || []).map(p => p.id)),
            orderIds: new Set(orders.map(o => o.Work_Order_ID)),
        }, now.toISOString()),
        suppliers,
        memory: memory.slice(-MAX_MEMORY).map((m, i) => ({ alias: `M${i + 1}`, value: m })),
        tasks: relevantTasks(tasks, uid, now).map((t, i) => ({ alias: `T${i + 1}`, value: t })),
        names: contextNames({ ...voice, suppliers }),
    };
}

export function resolveAlias<T>(list: Aliased<T>[], alias: unknown): T | null {
    if (typeof alias !== 'string') return null;
    const a = alias.trim().toUpperCase();
    return list.find(x => x.alias === a)?.value ?? null;
}

export { projectLabel };
