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
import { attachItems, getActiveWorkers, getAllTasks, getBookableWorkOrders, getItemsForWorkOrders } from '@/lib/server/fieldRepo';
import { buildVoiceContext } from '@/lib/voice/context';
import { contextNames, projectLabel, type VoiceProjectRef } from '@/lib/voice/extract';
import { listMemory } from './store';
import type { MemoryItem, ProcessCatalogItem, Project, Supplier, Task, WorkOrder } from '@/lib/types';

const MAX_PROJECTS = 80;
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

/** Radni nalog za dnevni upis rada: model bira oznaku (R3 = nalog, R3b = proizvod), ERP provjerava. */
export interface WorkOrderRef {
    id: string;
    name: string;
    type: string;
    projectName: string;
    finished: boolean;
    items: { alias: string; id: string; name: string }[];
    /** Proizvoda ima više nego što je navedeno (iznad MAX_ITEMS_PER_ORDER). */
    moreItems: number;
}

export interface AssistantContext {
    workers: Aliased<{ id: string; name: string }>[];
    projects: Aliased<VoiceProjectRef>[];
    suppliers: string[];
    memory: Aliased<MemoryItem>[];
    tasks: Aliased<Task>[];
    /** Otvoreni i nedavno završeni nalozi s proizvodima (R#, R#a…). */
    workOrders: Aliased<WorkOrderRef>[];
    /** Katalog procesa (kanonski redoslijed) — model bira naziv odavde. */
    processes: string[];
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

export async function loadContext(orgId: string, uid: string, now: Date = new Date()): Promise<AssistantContext> {
    const [projects, workers, suppliers, memory, tasks, orders, processes] = await Promise.all([
        loadProjects(orgId),
        getActiveWorkers(orgId),
        loadSuppliers(orgId),
        listMemory(orgId, uid),
        getAllTasks(orgId),
        loadWorkOrders(orgId, now),
        loadProcessCatalog(orgId),
    ]);

    const voice = buildVoiceContext(relevantProjects(projects, now), workers);
    const projectName = new Map(projects.map(p => [p.Project_ID, p.Name || p.Client_Name || '']));

    return {
        workers: (voice.workers || []).map((w, i) => ({ alias: `W${i + 1}`, value: w })),
        projects: (voice.projects || []).slice(0, MAX_PROJECTS).map((p, i) => ({ alias: `P${i + 1}`, value: p })),
        suppliers,
        memory: memory.slice(-MAX_MEMORY).map((m, i) => ({ alias: `M${i + 1}`, value: m })),
        tasks: relevantTasks(tasks, uid, now).map((t, i) => ({ alias: `T${i + 1}`, value: t })),
        workOrders: workOrderRefs(orders, id => projectName.get(id) || ''),
        processes,
        names: contextNames({ ...voice, suppliers }),
    };
}

// ─── Nalozi za dnevni upis rada ───────────────────────────────────────

const MAX_ORDERS = 60;
const MAX_ITEMS_PER_ORDER = 26;          // a…z
const FINISHED_ORDER_DAYS = 14;          // završen nalog još prima zaostali rad (kao šihtarica)

async function loadWorkOrders(orgId: string, now: Date): Promise<WorkOrder[]> {
    const cutoff = new Date(now.getTime() - FINISHED_ORDER_DAYS * DAY_MS).toISOString();
    const orders = (await getBookableWorkOrders(orgId))
        .filter(o => o.Status !== 'Završeno' || String(o.Completed_At || '') >= cutoff);
    return attachItems(orders, await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID)));
}

async function loadProcessCatalog(orgId: string): Promise<string[]> {
    const snap = await adminDb().collection('process_catalog').where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => d.data() as ProcessCatalogItem)
        .sort((a, b) => (a.Order || 0) - (b.Order || 0) || a.Name.localeCompare(b.Name, 'bs'))
        .map(c => c.Name);
}

/**
 * Oznake naloga: otvoreni prvo, pa nedavno završeni; unutar grupe po broju
 * naloga — deterministički, da stabilni dio prompta ostane isti (keš).
 */
export function workOrderRefs(orders: WorkOrder[], projectNameOf: (id: string) => string): Aliased<WorkOrderRef>[] {
    return orders
        .slice()
        .sort((a, b) => Number(a.Status === 'Završeno') - Number(b.Status === 'Završeno')
            || String(a.Work_Order_Number || '').localeCompare(String(b.Work_Order_Number || ''), 'bs', { numeric: true })
            || a.Work_Order_ID.localeCompare(b.Work_Order_ID))
        .slice(0, MAX_ORDERS)
        .map((o, i) => {
            const alias = `R${i + 1}`;
            const items = (o.items || []).slice().sort((a, b) => (a.Product_Name || '').localeCompare(b.Product_Name || '', 'bs') || a.ID.localeCompare(b.ID));
            const projectId = items.find(it => it.Project_ID)?.Project_ID;
            return {
                alias,
                value: {
                    id: o.Work_Order_ID,
                    name: o.Name || o.Work_Order_Number || 'Nalog',
                    type: o.Work_Order_Type || '',
                    projectName: projectId ? projectNameOf(projectId) : '',
                    finished: o.Status === 'Završeno',
                    items: items.slice(0, MAX_ITEMS_PER_ORDER).map((it, j) => ({ alias: `${alias}${String.fromCharCode(97 + j)}`, id: it.ID, name: it.Product_Name || '' })),
                    moreItems: Math.max(0, items.length - MAX_ITEMS_PER_ORDER),
                },
            };
        });
}

/** „R3" → cijeli nalog; „R3b" → jedan proizvod. null = nepostojeća oznaka. */
export function resolveWorkRef(list: Aliased<WorkOrderRef>[], ref: unknown): { order: WorkOrderRef; itemIds: string[] } | null {
    if (typeof ref !== 'string') return null;
    const m = ref.trim().match(/^(R\d+)([a-z])?$/i);
    if (!m) return null;
    const order = resolveAlias(list, m[1]);
    if (!order) return null;
    if (!m[2]) return { order, itemIds: order.items.map(i => i.id) };
    const item = order.items.find(i => i.alias.toLowerCase() === `${m[1]}${m[2]}`.toLowerCase());
    return item ? { order, itemIds: [item.id] } : null;
}

export function resolveAlias<T>(list: Aliased<T>[], alias: unknown): T | null {
    if (typeof alias !== 'string') return null;
    const a = alias.trim().toUpperCase();
    return list.find(x => x.alias === a)?.value ?? null;
}

export { projectLabel };
