/**
 * workOrderService.ts — Work Order lifecycle, scheduling, and process management
 * 
 * Extracted from database.ts (functions: getWorkOrders, getWorkOrder, createWorkOrder,
 * startWorkOrder, updateWorkOrderStatus, updateWorkOrderItemStatus, completeWorkOrderItem,
 * deleteWorkOrder, updateWorkOrder, updateDueDate, assignWorkerToItem,
 * scheduleWorkOrder, rescheduleWorkOrder, unscheduleWorkOrder, getScheduledWorkOrders,
 * checkWorkerConflicts, autoCreateOrdersForWorkOrder)
 */

import { COLLECTIONS } from '../shared/collections';
import {
    queryByOrg,
    findByIdAndOrg,
    findRef,
    updateDocByRef,
    getDb,
    query,
    collection,
    where,
    getDocs,
    writeBatch,
} from '../shared/firestoreClient';
import { assembleWorkOrders } from '../shared/dataAssembler';
import { eventBus } from '../eventBus';
import { planWorkOrderRenumber, type RenumberAssignment, type RenumberInput } from '../../workOrderNumber';
import { firstBookingDate } from '../../workOrderTasks';
import type { WorkOrder, WorkOrderItem, WorkLog } from '../../types';

// ============================================
// READ
// ============================================

export async function getWorkOrders(organizationId: string): Promise<WorkOrder[]> {
    if (!organizationId) return [];

    const db = getDb();
    const orgFilter = where('Organization_ID', '==', organizationId);

    const [woSnap, woiSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.WORK_ORDERS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.WORK_ORDER_ITEMS), orgFilter)),
    ]);

    const workOrders = woSnap.docs.map(d => ({ ...d.data() } as WorkOrder));
    const workOrderItems = woiSnap.docs.map(d => ({ ...d.data() } as WorkOrderItem));

    assembleWorkOrders(workOrders, workOrderItems);

    return workOrders;
}

export async function getWorkOrder(workOrderId: string, organizationId: string): Promise<WorkOrder | null> {
    const { getWorkOrder: _get } = await import('../../database');
    return _get(workOrderId, organizationId);
}

// ════════════════════════════════════════════════════════════════════
// MIGRACIJA BROJEVA (jednokratno) — stari RN-20260713-075307-241 → 2026-07/R1
//
// Namjerno DVA koraka (plan → primjena): korisnik prvo vidi tačan spisak
// „staro → novo", pa tek onda potvrdi. Broj naloga je ono što ljudi
// izgovaraju i traže, pa se ne mijenja bez pogleda.
//
// Broj naloga je SAMO PRIKAZ — sve veze u bazi (stavke, dnevnice, narudžbe,
// snapshoti) drže Work_Order_ID, koji se ovdje ne dira. Zato prenumeracija
// ne može „raskinuti" ništa; jedino stare ODŠTAMPANE naloge više ne poklapa.
// ════════════════════════════════════════════════════════════════════

/** Spisak izmjena koje bi prenumeracija napravila. Ništa se ne piše. */
export async function planWorkOrderRenumbering(organizationId: string): Promise<RenumberAssignment[]> {
    if (!organizationId) return [];

    const db = getDb();
    const orgFilter = where('Organization_ID', '==', organizationId);
    const [woSnap, logSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.WORK_ORDERS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.WORK_LOGS), orgFilter)),
    ]);

    // Prvo knjiženje po nalogu — kad je radnik STVARNO stao na taj posao.
    const logsByOrder = new Map<string, WorkLog[]>();
    logSnap.docs.forEach(d => {
        const log = d.data() as WorkLog;
        if (!log.Work_Order_ID) return;
        const list = logsByOrder.get(log.Work_Order_ID);
        if (list) list.push(log);
        else logsByOrder.set(log.Work_Order_ID, [log]);
    });

    const input: RenumberInput[] = woSnap.docs.map(d => {
        const wo = d.data() as WorkOrder;
        return {
            Work_Order_ID: wo.Work_Order_ID,
            Work_Order_Number: wo.Work_Order_Number,
            Work_Order_Type: wo.Work_Order_Type,
            Created_Date: wo.Created_Date,
            Started_At: wo.Started_At,
            First_Booking_Date: firstBookingDate(logsByOrder.get(wo.Work_Order_ID) || []),
        };
    });

    return planWorkOrderRenumber(input);
}

/** Upiši plan (samo polje Work_Order_Number). */
export async function applyWorkOrderRenumbering(
    assignments: RenumberAssignment[],
    organizationId: string
): Promise<{ success: boolean; updatedCount: number; message: string }> {
    if (!organizationId) return { success: false, updatedCount: 0, message: 'Organization ID is required' };
    if (assignments.length === 0) return { success: true, updatedCount: 0, message: 'Svi nalozi već imaju uredan broj' };

    try {
        const db = getDb();
        const byId = new Map(assignments.map(a => [a.Work_Order_ID, a.to]));

        const snap = await getDocs(query(
            collection(db, COLLECTIONS.WORK_ORDERS),
            where('Organization_ID', '==', organizationId)
        ));

        let updatedCount = 0;
        const targets = snap.docs.filter(d => byId.has((d.data() as WorkOrder).Work_Order_ID));

        const batchSize = 400;   // Firestore batch limit je 500
        for (let i = 0; i < targets.length; i += batchSize) {
            const batch = writeBatch(db);
            for (const d of targets.slice(i, i + batchSize)) {
                batch.update(d.ref, { Work_Order_Number: byId.get((d.data() as WorkOrder).Work_Order_ID) });
                updatedCount++;
            }
            await batch.commit();
        }

        return { success: true, updatedCount, message: `${updatedCount} naloga prenumerisano` };
    } catch (error) {
        console.error('applyWorkOrderRenumbering error:', error);
        return { success: false, updatedCount: 0, message: 'Greška pri prenumeraciji naloga' };
    }
}

// ============================================
// CREATE
// ============================================

export async function createWorkOrder(
    data: any,
    organizationId: string
): Promise<{ success: boolean; data?: { Work_Order_ID: string; Work_Order_Number: string }; message: string }> {
    const { createWorkOrder: _create } = await import('../../database');
    const result = await _create(data, organizationId);

    if (result.success && result.data) {
        eventBus.emit('workOrder:created', { workOrderId: result.data.Work_Order_ID, organizationId });
    }

    return result;
}

// ============================================
// UPDATE
// ============================================

export async function updateWorkOrder(
    workOrderId: string,
    updates: Partial<WorkOrder>,
    organizationId: string
): Promise<{ success: boolean; message: string; data?: WorkOrder }> {
    const { updateWorkOrder: _update } = await import('../../database');
    return _update(workOrderId, updates, organizationId);
}

export async function updateWorkOrderStatus(
    workOrderId: string,
    status: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { updateWorkOrderStatus: _update } = await import('../../database');
    return _update(workOrderId, status, organizationId);
}

export async function updateWorkOrderItemStatus(
    itemId: string,
    status: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { updateWorkOrderItemStatus: _update } = await import('../../database');
    const result = await _update(itemId, status, organizationId);

    if (result.success) {
        eventBus.emit('workOrder:itemUpdated', { workOrderId: '', itemId, organizationId });
    }

    return result;
}

export async function assignWorkerToItem(
    itemId: string,
    workerId: string,
    workerName: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { assignWorkerToItem: _assign } = await import('../../database');
    return _assign(itemId, workerId, workerName, organizationId);
}



// ============================================
// LIFECYCLE
// ============================================

export async function startWorkOrder(
    workOrderId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { startWorkOrder: _start } = await import('../../database');
    const result = await _start(workOrderId, organizationId);

    if (result.success) {
        eventBus.emit('workOrder:started', { workOrderId, organizationId });
    }

    return result;
}



export async function deleteWorkOrder(
    workOrderId: string,
    organizationId: string,
    productAction: 'completed' | 'waiting' = 'waiting'
): Promise<{ success: boolean; message: string }> {
    const { deleteWorkOrder: _delete } = await import('../../database');
    return _delete(workOrderId, organizationId, productAction);
}

// ============================================
// SCHEDULING / PLANNER
// ============================================

export async function scheduleWorkOrder(
    workOrderId: string,
    plannedStartDate: string,
    plannedEndDate: string,
    organizationId: string,
    colorCode?: string
): Promise<{ success: boolean; message: string }> {
    const { scheduleWorkOrder: _schedule } = await import('../../database');
    return _schedule(workOrderId, plannedStartDate, plannedEndDate, organizationId, colorCode);
}

export async function rescheduleWorkOrder(
    workOrderId: string,
    newStartDate: string,
    newEndDate: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { rescheduleWorkOrder: _reschedule } = await import('../../database');
    return _reschedule(workOrderId, newStartDate, newEndDate, organizationId);
}

export async function unscheduleWorkOrder(
    workOrderId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { unscheduleWorkOrder: _unschedule } = await import('../../database');
    return _unschedule(workOrderId, organizationId);
}

export async function getScheduledWorkOrders(
    organizationId: string,
    dateRange?: { start: string; end: string }
): Promise<WorkOrder[]> {
    const { getScheduledWorkOrders: _get } = await import('../../database');
    return _get(organizationId, dateRange);
}

export async function updateDueDate(
    workOrderId: string,
    newDueDate: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { updateDueDate: _update } = await import('../../database');
    return _update(workOrderId, newDueDate, organizationId);
}

export async function updatePlannedStartDate(
    workOrderId: string,
    newStartDate: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { updatePlannedStartDate: _update } = await import('../../database');
    return _update(workOrderId, newStartDate, organizationId);
}

// ============================================
// CONFLICT DETECTION
// ============================================

export async function checkWorkerConflicts(
    workerIds: string[],
    startDate: string,
    endDate: string,
    excludeWorkOrderId: string | null,
    organizationId: string
): Promise<{ hasConflicts: boolean; conflicts: any[] }> {
    const { checkWorkerConflicts: _check } = await import('../../database');
    return _check(workerIds, startDate, endDate, excludeWorkOrderId, organizationId);
}

// ============================================
// AUTO-ORDER FROM WORK ORDER
// ============================================

export async function autoCreateOrdersForWorkOrder(
    workOrderId: string,
    plannedStartDate: string,
    organizationId: string
): Promise<{ ordersCreated: number; orderNumbers: string[] }> {
    const { autoCreateOrdersForWorkOrder: _auto } = await import('../../database');
    return _auto(workOrderId, plannedStartDate, organizationId);
}

// ============================================
// WORK LOGS (delegated — will move to laborCostService)
// ============================================

export async function getWorkLogs(organizationId: string): Promise<any[]> {
    const { getWorkLogs: _get } = await import('../../database');
    return _get(organizationId);
}

export async function getWorkLogsForItem(workOrderItemId: string, organizationId: string): Promise<any[]> {
    const { getWorkLogsForItem: _get } = await import('../../database');
    return _get(workOrderItemId, organizationId);
}

export async function getWorkLogsForWorkOrder(workOrderId: string, organizationId: string): Promise<any[]> {
    const { getWorkLogsForWorkOrder: _get } = await import('../../database');
    return _get(workOrderId, organizationId);
}

export async function createWorkLog(data: any, organizationId: string): Promise<{ success: boolean; data?: any; message: string }> {
    const { createWorkLog: _create } = await import('../../database');
    return _create(data, organizationId);
}
