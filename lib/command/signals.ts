// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — PULS I LEĆA
//
// Šest brojki na vrhu strane nisu ukras: svaka je i FILTER. Klik na
// "Kasni" ne skače nikuda — cijela strana (proizvodi, nalozi, zadaci,
// napomene, kalendar) se suzi na to jedno pitanje. Zato se pripadnost
// računa JEDNOM ovdje, kao skupovi ID-eva, pa je svi kontejneri samo
// provjeravaju. Bez toga bi svaki panel imao vlastitu definiciju toga
// šta znači "kasni" i brojke se ne bi slagale s onim što se vidi.
// ════════════════════════════════════════════════════════════════════

import type { Order, Project, Task, WorkOrder } from '../types';
import { isOrderPaused } from '../utils';
import { noteStatus } from '../productNotes';
import type { CommandMaterialRow } from './materialOrder';
import { isTaskOpen, isWorkOrderOpen, taskProject, type BoardScope } from './scope';

export type LensId = 'late' | 'blocked' | 'toOrder' | 'running' | 'tasks' | 'awaiting';

export const LENS_IDS: LensId[] = ['late', 'blocked', 'toOrder', 'running', 'tasks', 'awaiting'];

export interface LensSelection {
    projectIds: Set<string>;
    productIds: Set<string>;
    workOrderIds: Set<string>;
    orderIds: Set<string>;
    taskIds: Set<string>;
    /** Ključ je `${productId}:${noteId}` — id napomene je jedinstven samo unutar proizvoda. */
    noteKeys: Set<string>;
    materialIds: Set<string>;
}

export interface Signal {
    id: LensId;
    label: string;
    hint: string;
    count: number;
    tone: 'alert' | 'warn' | 'info';
}

export interface SignalReport {
    signals: Signal[];
    selection: Record<LensId, LensSelection>;
}

export function noteKey(productId: string, noteId: string): string {
    return `${productId}:${noteId}`;
}

function emptySelection(): LensSelection {
    return {
        projectIds: new Set(), productIds: new Set(), workOrderIds: new Set(),
        orderIds: new Set(), taskIds: new Set(), noteKeys: new Set(), materialIds: new Set(),
    };
}

const before = (date: string | undefined, today: string) => !!date && date.slice(0, 10) < today;

export function isWorkOrderLate(wo: WorkOrder, today: string): boolean {
    return isWorkOrderOpen(wo) && before(wo.Due_Date, today);
}

export function isPurchaseLate(order: Order, today: string): boolean {
    return order.Status !== 'Primljeno' && before(order.Expected_Delivery, today);
}

export function isTaskLate(task: Task, today: string): boolean {
    return isTaskOpen(task) && before(task.Due_Date, today);
}

/**
 * Stanje ključnog materijala. Razlika između „naručeno" i „nije ni naručeno"
 * je ono što odlučuje da li nešto treba VIKATI: materijal na putu se čeka,
 * materijal koji niko nije naručio je propust.
 *
 * `ok` obuhvata i sve što nije ključno — takav materijal ne zaustavlja rad
 * (isto pravilo kao provjera pokretanja naloga u lib/workOrderStart).
 */
export type EssentialState = 'ok' | 'incoming' | 'missing';

export function essentialState(material: { Is_Essential?: boolean; Status?: string }): EssentialState {
    if (!material.Is_Essential) return 'ok';
    if (material.Status === 'Primljeno' || material.Status === 'Na stanju') return 'ok';
    return material.Status === 'Naručeno' ? 'incoming' : 'missing';
}

/** Ključni materijal koji nije spreman — šira definicija, kao pri pokretanju naloga. */
export function blocksWork(material: { Is_Essential?: boolean; Status?: string }): boolean {
    return essentialState(material) !== 'ok';
}

export function buildSignals(scope: BoardScope, materials: CommandMaterialRow[], today: string): SignalReport {
    const selection: Record<LensId, LensSelection> = {
        late: emptySelection(), blocked: emptySelection(), toOrder: emptySelection(),
        running: emptySelection(), tasks: emptySelection(), awaiting: emptySelection(),
    };

    const addWorkOrder = (lens: LensId, wo: WorkOrder) => {
        selection[lens].workOrderIds.add(wo.Work_Order_ID);
        for (const projectId of scope.workOrderProjects.get(wo.Work_Order_ID) || []) selection[lens].projectIds.add(projectId);
        for (const item of wo.items || []) if (item.Product_ID) selection[lens].productIds.add(item.Product_ID);
    };
    const addMaterial = (lens: LensId, row: CommandMaterialRow) => {
        selection[lens].materialIds.add(row.ID);
        selection[lens].productIds.add(row.productId);
        selection[lens].projectIds.add(row.projectId);
    };
    const addTask = (lens: LensId, task: Task) => {
        selection[lens].taskIds.add(task.Task_ID);
        const projectId = taskProject(task, scope);
        if (projectId) selection[lens].projectIds.add(projectId);
    };

    // ── Kasni ────────────────────────────────────────────────────────
    let lateCount = 0;
    for (const wo of scope.workOrders) if (isWorkOrderLate(wo, today)) { addWorkOrder('late', wo); lateCount++; }
    for (const task of scope.tasks) if (isTaskLate(task, today)) { addTask('late', task); lateCount++; }
    for (const order of scope.orders) {
        if (!isPurchaseLate(order, today)) continue;
        selection.late.orderIds.add(order.Order_ID);
        for (const item of order.items || []) {
            if (item.Project_ID && scope.projectIds.has(item.Project_ID)) selection.late.projectIds.add(item.Project_ID);
            if (item.Product_ID) selection.late.productIds.add(item.Product_ID);
        }
        lateCount++;
    }

    // ── Blokirano materijalom / Za naručiti ──────────────────────────
    // „Blokirano" znači da materijal koči STVARNI rad: proizvod je već u
    // otvorenom nalogu, a ključni materijal nije spreman. Proizvod koji još
    // nije ni raspoređen nije blokiran — on je samo „za naručiti", i to je
    // zaseban signal. Bez te razlike bi na početku posla sve bilo crveno.
    const inActiveOrder = new Set<string>();
    for (const wo of scope.workOrders) {
        if (!isWorkOrderOpen(wo)) continue;
        for (const item of wo.items || []) if (item.Product_ID) inActiveOrder.add(item.Product_ID);
    }
    const blockedProducts = new Set<string>();
    for (const row of materials) {
        if (essentialState(row) === 'missing' && inActiveOrder.has(row.productId)) {
            addMaterial('blocked', row);
            blockedProducts.add(row.productId);
        }
        if (row.orderable) addMaterial('toOrder', row);
    }

    // ── U toku ───────────────────────────────────────────────────────
    let runningCount = 0;
    for (const wo of scope.workOrders) {
        if (wo.Status === 'U toku' && !isOrderPaused(wo)) { addWorkOrder('running', wo); runningCount++; }
    }

    // ── Otvoreni zadaci ──────────────────────────────────────────────
    let openTasks = 0;
    for (const task of scope.tasks) {
        if (!isTaskOpen(task)) continue;
        addTask('tasks', task);
        openTasks++;
    }

    // ── Čeka odgovor ─────────────────────────────────────────────────
    let awaiting = 0;
    for (const project of scope.projects) {
        for (const product of project.products || []) {
            for (const note of product.Questions || []) {
                if (noteStatus(note) !== 'open') continue;
                selection.awaiting.noteKeys.add(noteKey(product.Product_ID, note.id));
                selection.awaiting.productIds.add(product.Product_ID);
                selection.awaiting.projectIds.add(project.Project_ID);
                awaiting++;
            }
        }
    }

    const signals: Signal[] = [
        { id: 'late', label: 'Kasni', hint: 'Nalozi, zadaci i isporuke s prošlim rokom', count: lateCount, tone: 'alert' },
        { id: 'blocked', label: 'Blokirano materijalom', hint: 'Nalog stoji jer ključni materijal nije naručen', count: blockedProducts.size, tone: 'alert' },
        { id: 'toOrder', label: 'Za naručiti', hint: 'Materijali koje treba naručiti', count: selection.toOrder.materialIds.size, tone: 'warn' },
        { id: 'running', label: 'U toku', hint: 'Nalozi koji trenutno rade', count: runningCount, tone: 'info' },
        { id: 'tasks', label: 'Otvoreni zadaci', hint: 'Zadaci koji nisu završeni', count: openTasks, tone: 'info' },
        { id: 'awaiting', label: 'Čeka odgovor', hint: 'Pitanja bez odgovora', count: awaiting, tone: 'warn' },
    ];

    return { signals, selection };
}

// ── Provjere koje kontejneri koriste ────────────────────────────────
// `sel === null` znači "bez leće" i uvijek propušta — tako paneli nemaju
// grananje, nego samo pozovu funkciju.

export const lensAllowsProject = (sel: LensSelection | null, id: string) => !sel || sel.projectIds.has(id);
export const lensAllowsProduct = (sel: LensSelection | null, id: string) => !sel || sel.productIds.has(id);
export const lensAllowsWorkOrder = (sel: LensSelection | null, id: string) => !sel || sel.workOrderIds.has(id);
export const lensAllowsTask = (sel: LensSelection | null, id: string) => !sel || sel.taskIds.has(id);
export const lensAllowsNote = (sel: LensSelection | null, productId: string, noteId: string) =>
    !sel || sel.noteKeys.has(noteKey(productId, noteId));
export const lensAllowsMaterial = (sel: LensSelection | null, id: string) => !sel || sel.materialIds.has(id);

/** Projekti koji uopšte imaju šta pokazati pod trenutnom lećom. */
export function visibleProjects(projects: Project[], sel: LensSelection | null): Project[] {
    if (!sel) return projects;
    return projects.filter(p => sel.projectIds.has(p.Project_ID));
}
