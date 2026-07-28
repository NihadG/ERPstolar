// ════════════════════════════════════════════════════════════════════
// ADMIN ČITANJA ZA POGONSKE RUTE
//
// Jedno mjesto za sve što /api/field/* dovlači iz Firestorea. Postoji da se
// isti upiti ne pišu po rutama i da se ograničenja Firestorea (`in` prima 30
// vrijednosti) rješavaju jednom.
//
// NIŠTA ODAVDE NE IDE PRAVO KLIJENTU. Ovo su sirovi dokumenti s iznosima;
// prolaze kroz projekciju u lib/field/* koja gradi payload nabrajanjem polja.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import type {
    ProcessGraph, Task, WorkerAttendance, WorkLog, WorkOrder, WorkOrderItem, Worker,
} from '@/lib/types';

/** Firestore `in` prima najviše 30 vrijednosti po upitu. */
const IN_CHUNK = 30;

function chunk<T>(arr: T[], size = IN_CHUNK): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ─── Radnici ──────────────────────────────────────────────────────────

export async function getWorkers(orgId: string): Promise<Worker[]> {
    const snap = await adminDb().collection('workers').where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => d.data() as Worker);
}

/** Radnici koje šihtarica prikazuje — bez arhiviranih (soft-delete). */
export async function getActiveWorkers(orgId: string): Promise<Worker[]> {
    const all = await getWorkers(orgId);
    return all
        .filter(w => w.Status !== 'Obrisan')
        .sort((a, b) => (a.Name || '').localeCompare(b.Name || '', 'bs'));
}

// ─── Nalozi i stavke ──────────────────────────────────────────────────

/** Nalozi koji mogu primiti rad. Zatvoreni i otkazani se ne knjiže. */
export async function getOpenWorkOrders(orgId: string): Promise<WorkOrder[]> {
    const snap = await adminDb().collection('work_orders')
        .where('Organization_ID', '==', orgId)
        .where('Status', 'in', ['U toku', 'Na čekanju'])
        .get();
    return snap.docs.map(d => d.data() as WorkOrder);
}

/**
 * Nalozi relevantni za knjiženje na dati dan.
 *
 * Uz otvorene uzima i ZAVRŠENE — radnik može biti prisutan na dan kad je nalog
 * zatvoren, i taj rad mora imati gdje da se knjiži (isto pravilo koje nosi
 * `isOrderActiveOn` u lib/autoBook.ts).
 */
export async function getBookableWorkOrders(orgId: string): Promise<WorkOrder[]> {
    const snap = await adminDb().collection('work_orders')
        .where('Organization_ID', '==', orgId)
        .where('Status', 'in', ['U toku', 'Na čekanju', 'Završeno'])
        .get();
    return snap.docs.map(d => d.data() as WorkOrder);
}

export async function getWorkOrderById(orgId: string, workOrderId: string): Promise<WorkOrder | null> {
    const snap = await adminDb().collection('work_orders')
        .where('Organization_ID', '==', orgId)
        .where('Work_Order_ID', '==', workOrderId)
        .limit(1)
        .get();
    return snap.empty ? null : (snap.docs[0].data() as WorkOrder);
}

/** Referenca na dokument naloga — treba za upise (doc id ≠ Work_Order_ID). */
export async function getWorkOrderRef(orgId: string, workOrderId: string) {
    const snap = await adminDb().collection('work_orders')
        .where('Organization_ID', '==', orgId)
        .where('Work_Order_ID', '==', workOrderId)
        .limit(1)
        .get();
    return snap.empty ? null : snap.docs[0].ref;
}

export async function getItemsForWorkOrders(orgId: string, workOrderIds: string[]): Promise<WorkOrderItem[]> {
    const ids = workOrderIds.filter(Boolean);
    if (ids.length === 0) return [];

    const out: WorkOrderItem[] = [];
    for (const part of chunk(ids)) {
        const snap = await adminDb().collection('work_order_items')
            .where('Organization_ID', '==', orgId)
            .where('Work_Order_ID', 'in', part)
            .get();
        snap.docs.forEach(d => out.push(d.data() as WorkOrderItem));
    }
    return out;
}

/** Zakači stavke na naloge (mutira ulazne objekte — oni su ionako lokalne kopije). */
export function attachItems(orders: WorkOrder[], items: WorkOrderItem[]): WorkOrder[] {
    const byOrder = new Map<string, WorkOrderItem[]>();
    for (const item of items) {
        const list = byOrder.get(item.Work_Order_ID) || [];
        list.push(item);
        byOrder.set(item.Work_Order_ID, list);
    }
    for (const wo of orders) wo.items = byOrder.get(wo.Work_Order_ID) || [];
    return orders;
}

/** Nalozi s već zakačenim stavkama — ono što `buildBookingProposal` traži. */
export async function getWorkOrdersWithItems(orgId: string, orders: WorkOrder[]): Promise<WorkOrder[]> {
    const items = await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID));
    return attachItems(orders, items);
}

export async function getItemsByIds(orgId: string, itemIds: string[]): Promise<WorkOrderItem[]> {
    const ids = itemIds.filter(Boolean);
    if (ids.length === 0) return [];

    const out: WorkOrderItem[] = [];
    for (const part of chunk(ids, 10)) {   // `ID` upiti su uži — držimo se 10 kao klijent
        const snap = await adminDb().collection('work_order_items')
            .where('Organization_ID', '==', orgId)
            .where('ID', 'in', part)
            .get();
        snap.docs.forEach(d => out.push(d.data() as WorkOrderItem));
    }
    return out;
}

/** Stavke naloga s referencama — jedan upit, za batch izmjene. */
export async function getItemDocsForWorkOrder(orgId: string, workOrderId: string) {
    const snap = await adminDb().collection('work_order_items')
        .where('Organization_ID', '==', orgId)
        .where('Work_Order_ID', '==', workOrderId)
        .get();
    return snap.docs.map(d => ({ ref: d.ref, data: d.data() as WorkOrderItem }));
}

/** Grafovi procesa po nalogu. Graf živi na dokumentu naloga — nema zasebnog čitanja. */
export async function getProcessGraphs(orgId: string, workOrderIds: string[]): Promise<Map<string, ProcessGraph | undefined>> {
    const out = new Map<string, ProcessGraph | undefined>();
    const ids = Array.from(new Set(workOrderIds.filter(Boolean)));
    if (ids.length === 0) return out;

    for (const part of chunk(ids)) {
        const snap = await adminDb().collection('work_orders')
            .where('Organization_ID', '==', orgId)
            .where('Work_Order_ID', 'in', part)
            .get();
        snap.docs.forEach(d => {
            const wo = d.data() as WorkOrder;
            out.set(wo.Work_Order_ID, processGraphOf(wo));
        });
    }
    return out;
}

export async function getItemRef(orgId: string, itemId: string) {
    const snap = await adminDb().collection('work_order_items')
        .where('Organization_ID', '==', orgId)
        .where('ID', '==', itemId)
        .limit(1)
        .get();
    return snap.empty ? null : snap.docs[0].ref;
}

/** Graf procesa živi NA dokumentu naloga — nema zasebnog čitanja. */
export function processGraphOf(wo: WorkOrder | null | undefined): ProcessGraph | undefined {
    const g = wo?.Process_Graph;
    return g && Array.isArray(g.nodes) ? g : undefined;
}

// ─── Prisustvo ────────────────────────────────────────────────────────

export async function getAttendanceInRange(orgId: string, from: string, to: string): Promise<WorkerAttendance[]> {
    const snap = await adminDb().collection('worker_attendance')
        .where('Organization_ID', '==', orgId)
        .where('Date', '>=', from)
        .where('Date', '<=', to)
        .get();
    return snap.docs.map(d => d.data() as WorkerAttendance);
}

export async function getAttendanceForDate(orgId: string, date: string): Promise<WorkerAttendance[]> {
    const snap = await adminDb().collection('worker_attendance')
        .where('Organization_ID', '==', orgId)
        .where('Date', '==', date)
        .get();
    return snap.docs.map(d => d.data() as WorkerAttendance);
}

// ─── Dnevnice ─────────────────────────────────────────────────────────

export async function getWorkLogsInRange(orgId: string, from: string, to: string): Promise<WorkLog[]> {
    const snap = await adminDb().collection('work_logs')
        .where('Organization_ID', '==', orgId)
        .where('Date', '>=', from)
        .where('Date', '<=', to)
        .get();
    return snap.docs.map(d => d.data() as WorkLog);
}

export async function getWorkLogsForWorkerDate(orgId: string, workerId: string, date: string): Promise<WorkLog[]> {
    const snap = await adminDb().collection('work_logs')
        .where('Organization_ID', '==', orgId)
        .where('Worker_ID', '==', workerId)
        .where('Date', '==', date)
        .get();
    return snap.docs.map(d => d.data() as WorkLog);
}

/** Zapisi jednog radnika za dan, s referencama — renormalizacija ih prepisuje. */
export async function getWorkLogRefsForWorkerDate(orgId: string, workerId: string, date: string) {
    const snap = await adminDb().collection('work_logs')
        .where('Organization_ID', '==', orgId)
        .where('Worker_ID', '==', workerId)
        .where('Date', '==', date)
        .get();
    return snap.docs.map(d => ({ ref: d.ref, data: d.data() as WorkLog }));
}

export async function getWorkLogsForWorkOrder(orgId: string, workOrderId: string): Promise<WorkLog[]> {
    const snap = await adminDb().collection('work_logs')
        .where('Organization_ID', '==', orgId)
        .where('Work_Order_ID', '==', workOrderId)
        .get();
    return snap.docs.map(d => d.data() as WorkLog);
}

// ─── Zadaci ───────────────────────────────────────────────────────────

export async function getTasksForWorker(orgId: string, workerId: string): Promise<Task[]> {
    const snap = await adminDb().collection('tasks')
        .where('Organization_ID', '==', orgId)
        .where('Assigned_Worker_ID', '==', workerId)
        .get();
    return snap.docs.map(d => d.data() as Task);
}
