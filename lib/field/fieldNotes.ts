// ════════════════════════════════════════════════════════════════════
// RADNIKOVE NAPOMENE — zadaci koji se tiču radnika ili njegovih proizvoda
//
// „Napomena" je Task; radnik ih zove napomenama. Tab pokazuje one koje su:
//   • dodijeljene radniku (Assigned_Worker_ID), ILI
//   • vezane (Task.Links) za nalog/proizvod na kojem radnik ima stavku.
// Oboje — radnik vidi i lične i one uz posao. Veza je JEDAN izvor istine
// (Task.Links), isti koji čita desktop tab Zadaci i kartica naloga.
//
// NEMA NOVCA: Task nema novčano polje, a projekcija ionako nabraja polja
// (nikad spread), pa se nijedan iznos ne može provući.
// ════════════════════════════════════════════════════════════════════

import { isTaskLinkedToWorkOrder, isTaskOpen, taskProductIds } from '@/lib/workOrderTasks';
import type { Task } from '@/lib/types';

export interface NoteChecklistItem {
    id: string;
    text: string;
    completed: boolean;
}

export interface NoteRow {
    taskId: string;
    title: string;
    status: string;
    priority: string;
    /** Vezani nalog (ako je među radnikovim) — za pločicu i autorizaciju izmjene. */
    orderId: string | null;
    orderName: string | null;
    /** Vezani proizvod (ako je među radnikovim). */
    productId: string | null;
    productName: string | null;
    /** Kako se napomena tiče radnika — za grupisanje/prikaz. */
    source: 'assigned' | 'order' | 'product';
    /** Puni sadržaj za expandable prikaz (opis, rok, checklista). */
    description: string;
    notes: string;
    dueDate: string | null;
    checklist: NoteChecklistItem[];
}

export interface WorkerNotesInput {
    tasks: Task[];
    workerId: string;
    /** Nalozi na kojima radnik ima stavku. */
    myOrderIds: Set<string>;
    /** Proizvodi na kojima radnik ima stavku. */
    myProductIds: Set<string>;
    /** Work_Order_ID → prikazni naziv (naziv naloga link ne nosi pouzdano). */
    orderNameById: Map<string, string>;
    /** Product_ID → naziv. */
    productNameById: Map<string, string>;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * Napomene radnika, poredane kao što se i rade: otvorene prije završenih,
 * pa hitnije, pa naslov. Otkazane se ne prikazuju.
 */
export function buildWorkerNotes(input: WorkerNotesInput): NoteRow[] {
    const { tasks, workerId, myOrderIds, myProductIds, orderNameById, productNameById } = input;

    const rows: NoteRow[] = [];
    for (const t of tasks) {
        if (t.Status === 'cancelled') continue;

        const links = t.Links || [];
        const myOrderLink = links.find(l => l.Entity_Type === 'work_order' && myOrderIds.has(l.Entity_ID));
        const myProductId = taskProductIds(t).find(id => myProductIds.has(id));
        const assignedToMe = t.Assigned_Worker_ID === workerId;

        // Uključi napomenu samo ako se stvarno tiče radnika.
        if (!assignedToMe && !myOrderLink && !myProductId) continue;

        // Nalog: prvi radnikov work_order link (fallback bilo koji work_order link).
        const orderLink = myOrderLink || links.find(l => l.Entity_Type === 'work_order');
        const orderId = orderLink?.Entity_ID || null;
        const orderName = orderId
            ? (orderNameById.get(orderId) || orderLink?.Entity_Name || null)
            : null;

        // Proizvod: prvi radnikov product link (fallback bilo koji product link).
        const productId = myProductId || taskProductIds(t)[0] || null;
        const productName = productId
            ? (productNameById.get(productId) || links.find(l => l.Entity_Type === 'product' && l.Entity_ID === productId)?.Entity_Name || null)
            : null;

        const source: NoteRow['source'] = myProductId ? 'product' : myOrderLink ? 'order' : 'assigned';

        rows.push({
            taskId: t.Task_ID,
            title: t.Title,
            status: t.Status,
            priority: t.Priority,
            orderId,
            orderName,
            productId,
            productName,
            source,
            description: t.Description || '',
            notes: t.Notes || '',
            dueDate: t.Due_Date || null,
            checklist: (t.Checklist || []).map(c => ({ id: c.id, text: c.text, completed: !!c.completed })),
        });
    }

    return rows.sort((a, b) => {
        const openA = isTaskOpen({ Status: a.status as Task['Status'] }) ? 0 : 1;
        const openB = isTaskOpen({ Status: b.status as Task['Status'] }) ? 0 : 1;
        if (openA !== openB) return openA - openB;
        const pa = PRIORITY_RANK[a.priority] ?? 9;
        const pb = PRIORITY_RANK[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        return a.title.localeCompare(b.title, 'bs');
    });
}

/** Da li radnik smije mijenjati napomenu (toggle/brisanje) — ista relacija kao vidljivost. */
export function canWorkerTouchTask(
    task: Pick<Task, 'Assigned_Worker_ID' | 'Links'>,
    workerId: string,
    myOrderIds: Set<string>,
    myProductIds: Set<string>,
): boolean {
    if (task.Assigned_Worker_ID === workerId) return true;
    if ([...myOrderIds].some(id => isTaskLinkedToWorkOrder(task, id))) return true;
    return taskProductIds(task).some(id => myProductIds.has(id));
}
