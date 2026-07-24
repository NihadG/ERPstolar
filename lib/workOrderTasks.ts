// ════════════════════════════════════════════════════════════════════
// ZADACI NA NALOGU — veza Task ⇄ WorkOrder ⇄ Product
//
// JEDAN IZVOR ISTINE: Task.Links. Zadatak pripada nalogu kad ima link
// { Entity_Type: 'work_order', Entity_ID: Work_Order_ID }; „tiče se"
// proizvoda kad ima link { Entity_Type: 'product', Entity_ID: … }.
//
// Zato je sinhronizacija besplatna i u OBA smjera: i tab Zadaci i kartica
// naloga čitaju/pišu ISTI Task dokument — nema kopije statusa na nalogu
// koja bi mogla odlutati. Čekiranje u nalogu = čekiranje u Zadacima.
//
// Entity_Name u linku je DENORMALIZOVAN (snimljen naziv u trenutku
// vezivanja) — za prikaz uvijek ide live pretraga po Entity_ID, a
// Entity_Name je samo fallback kad entitet više ne postoji.
// ════════════════════════════════════════════════════════════════════

import type { Task, TaskLink, TaskPriority, TaskCategory, WorkOrder, WorkOrderItem, WorkLog } from './types';

/**
 * Zadatak koji korisnik upiše PRIJE nego nalog postoji (wizard) — još nije
 * Task u bazi. Nastaje tek s nalogom, pa odmah dobije vezu na njega.
 */
export interface TaskDraft {
    /** Lokalni ključ za React liste — nije Task_ID (zadatak još ne postoji). */
    id: string;
    Title: string;
    Priority: TaskPriority;
    Category: TaskCategory;
    Due_Date?: string;
    Description?: string;
    Assigned_Worker_ID?: string;
    /** Product_ID iz naloga na koji se zadatak odnosi. */
    productId?: string;
    /** Koraci checkliste — samo tekstovi; ID/completed dobijaju pri upisu. */
    checklist?: string[];
}

/** Šta se vezuje na nalog: postojeći zadaci + novi (nacrti). */
export interface TaskAttachSelection {
    existingTaskIds: string[];
    newTasks: TaskDraft[];
}

export const emptyTaskSelection = (): TaskAttachSelection => ({ existingTaskIds: [], newTasks: [] });

export const taskSelectionCount = (sel: TaskAttachSelection): number =>
    sel.existingTaskIds.length + sel.newTasks.filter(t => t.Title.trim()).length;

/**
 * Task.Links je u tipu obavezan, ali stariji dokumenti u bazi ga nemaju —
 * čitači ovdje moraju podnijeti i zadatak bez linkova.
 */
type LinkedTask = { Links?: TaskLink[] };

// ── Čitanje veza ────────────────────────────────────────────────────

export function isTaskLinkedToWorkOrder(task: LinkedTask, workOrderId: string): boolean {
    return (task.Links || []).some(l => l.Entity_Type === 'work_order' && l.Entity_ID === workOrderId);
}

/** Product_ID-evi na koje zadatak pokazuje (obično 0 ili 1). */
export function taskProductIds(task: LinkedTask): string[] {
    return (task.Links || []).filter(l => l.Entity_Type === 'product').map(l => l.Entity_ID);
}

/** Prvi proizvod zadatka koji pripada OVOM nalogu (za grupisanje/prikaz). */
export function taskProductInOrder(
    task: LinkedTask,
    items: Pick<WorkOrderItem, 'Product_ID'>[]
): string | undefined {
    const inOrder = new Set(items.map(i => i.Product_ID));
    return taskProductIds(task).find(id => inOrder.has(id));
}

// ── Pisanje veza (čiste funkcije nad Links nizom) ───────────────────

/** Dodaj vezu na nalog (idempotentno — dupli klik ne pravi duplikat). */
export function withWorkOrderLink(
    links: TaskLink[] | undefined,
    workOrder: Pick<WorkOrder, 'Work_Order_ID'> & { displayName: string }
): TaskLink[] {
    const rest = (links || []).filter(
        l => !(l.Entity_Type === 'work_order' && l.Entity_ID === workOrder.Work_Order_ID)
    );
    return [...rest, {
        Entity_Type: 'work_order',
        Entity_ID: workOrder.Work_Order_ID,
        Entity_Name: workOrder.displayName,
    }];
}

export function withoutWorkOrderLink(links: TaskLink[] | undefined, workOrderId: string): TaskLink[] {
    return (links || []).filter(l => !(l.Entity_Type === 'work_order' && l.Entity_ID === workOrderId));
}

/**
 * Postavi/skini proizvod zadatka U KONTEKSTU jednog naloga.
 *
 * Dira SAMO product-linkove koji pokazuju na proizvode IZ TOG naloga —
 * veza na proizvod nekog drugog naloga se čuva (zadatak smije biti vezan
 * na više proizvoda; padajući izbornik ovdje bira samo „koji od ovih").
 */
export function withProductLinkInOrder(
    links: TaskLink[] | undefined,
    orderItems: Pick<WorkOrderItem, 'Product_ID' | 'Product_Name'>[],
    productId: string | null
): TaskLink[] {
    const inOrder = new Set(orderItems.map(i => i.Product_ID));
    const rest = (links || []).filter(l => !(l.Entity_Type === 'product' && inOrder.has(l.Entity_ID)));
    if (!productId) return rest;
    const item = orderItems.find(i => i.Product_ID === productId);
    if (!item) return rest;
    return [...rest, {
        Entity_Type: 'product',
        Entity_ID: productId,
        Entity_Name: item.Product_Name,
    }];
}

// ── Izbor i sortiranje ──────────────────────────────────────────────

const OPEN_STATUSES: Task['Status'][] = ['pending', 'in_progress'];
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function isTaskOpen(task: Pick<Task, 'Status'>): boolean {
    return OPEN_STATUSES.includes(task.Status);
}

export function isTaskOverdue(task: Pick<Task, 'Status' | 'Due_Date'>, todayISO: string): boolean {
    if (!task.Due_Date || !isTaskOpen(task)) return false;
    return task.Due_Date.split('T')[0] < todayISO;
}

/**
 * Zadaci naloga, poredani onako kako se i rade: otvoreni prije završenih,
 * pa hitniji, pa raniji rok (bez roka na kraj), pa naslov.
 */
export function tasksForWorkOrder(tasks: Task[], workOrderId: string): Task[] {
    return tasks
        .filter(t => isTaskLinkedToWorkOrder(t, workOrderId))
        .sort((a, b) => {
            const openA = isTaskOpen(a) ? 0 : 1;
            const openB = isTaskOpen(b) ? 0 : 1;
            if (openA !== openB) return openA - openB;
            const pa = PRIORITY_RANK[a.Priority] ?? 9;
            const pb = PRIORITY_RANK[b.Priority] ?? 9;
            if (pa !== pb) return pa - pb;
            const da = a.Due_Date || '9999-12-31';
            const db = b.Due_Date || '9999-12-31';
            if (da !== db) return da < db ? -1 : 1;
            return (a.Title || '').localeCompare(b.Title || '', 'bs');
        });
}

/**
 * Zadaci koji se tiču proizvoda IZ ovog naloga, ali sam nalog nije vezan —
 * ponuda „ovo vjerovatno spada ovdje" umjesto ručnog traženja po tabu Zadaci.
 * Završeni se ne nude (nema šta da se prati).
 */
export function suggestedTasksForWorkOrder(
    tasks: Task[],
    workOrderId: string,
    items: Pick<WorkOrderItem, 'Product_ID'>[]
): Task[] {
    const inOrder = new Set(items.map(i => i.Product_ID));
    if (inOrder.size === 0) return [];
    return tasks.filter(t =>
        isTaskOpen(t) &&
        !isTaskLinkedToWorkOrder(t, workOrderId) &&
        taskProductIds(t).some(id => inOrder.has(id))
    );
}

export interface TaskProgress {
    total: number;
    done: number;
    open: number;
    overdue: number;
    pct: number;
}

export function taskProgress(tasks: Task[], todayISO: string): TaskProgress {
    let done = 0, overdue = 0;
    for (const t of tasks) {
        if (t.Status === 'completed') done++;
        if (isTaskOverdue(t, todayISO)) overdue++;
    }
    // Otkazani zadaci nisu ni „urađeni" ni „za uraditi" — ostaju u total-u
    // (vide se na listi), ali ne dižu postotak.
    const open = tasks.filter(isTaskOpen).length;
    return {
        total: tasks.length,
        done,
        open,
        overdue,
        pct: tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0,
    };
}

// ── Prvo knjiženje ──────────────────────────────────────────────────

/**
 * Datum kad je RADNIK prvi put knjižen na nalog (YYYY-MM-DD) — stvarni
 * početak rada, za razliku od Started_At koji je samo pritisnuto dugme.
 * Bez knjiženja → undefined (nalog još niko nije dotakao).
 */
export function firstBookingDate(workLogs: Pick<WorkLog, 'Date'>[]): string | undefined {
    let min: string | undefined;
    for (const log of workLogs) {
        const d = log.Date?.split('T')[0];
        if (!d) continue;
        if (!min || d < min) min = d;
    }
    return min;
}

/**
 * Datum ZADNJEG knjiženja radnika na nalog (YYYY-MM-DD) — stvarni posljednji
 * dan rada. Koristi se kod završetka naloga kao prijedlog „dana zadnjeg rada"
 * (kad se nalog završava naknadno, a ne na dan zadnjeg rada).
 * Bez knjiženja → undefined.
 */
export function lastBookingDate(workLogs: Pick<WorkLog, 'Date'>[]): string | undefined {
    let max: string | undefined;
    for (const log of workLogs) {
        const d = log.Date?.split('T')[0];
        if (!d) continue;
        if (!max || d > max) max = d;
    }
    return max;
}

/**
 * Prvo knjiženje po SVIM nalozima odjednom (Work_Order_ID → YYYY-MM-DD) —
 * za liste, gdje bi upit po nalogu značio N upita.
 *
 * Broji i PREUSMJEREN rad: kad je „razni posao" vezan za proizvod, log se piše
 * na nalog tog proizvoda (Work_Order_ID), a izvorni zadaci-nalog ostaje u
 * Source_Work_Order_ID. Oba naloga su tog dana stvarno radila, pa se log računa
 * za oba — isti obuhvat kao getWorkLogsForWorkOrder.
 */
export function firstBookingByOrder(
    workLogs: Pick<WorkLog, 'Date' | 'Work_Order_ID' | 'Source_Work_Order_ID'>[]
): Map<string, string> {
    const out = new Map<string, string>();
    const put = (orderId: string | undefined, date: string) => {
        if (!orderId) return;
        const cur = out.get(orderId);
        if (!cur || date < cur) out.set(orderId, date);
    };
    for (const log of workLogs) {
        const d = log.Date?.split('T')[0];
        if (!d) continue;
        put(log.Work_Order_ID, d);
        put(log.Source_Work_Order_ID, d);
    }
    return out;
}
