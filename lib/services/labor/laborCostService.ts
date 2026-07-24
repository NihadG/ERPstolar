/**
 * laborCostService.ts — Attendance, Work Logs, and Labor Cost Pipeline
 * 
 * Facade over attendance.ts functions, providing a clean service interface
 * for the attendance → work log → labor cost → recalculation pipeline.
 */

import { eventBus } from '../eventBus';
import type { WorkerAttendance } from '../../types';

// ============================================
// ATTENDANCE
// ============================================

export async function markAttendanceAndRecalculate(
    attendance: Partial<WorkerAttendance>,
    options?: { skipRecalculation?: boolean; skipAutoBook?: boolean; deleteManualOnAbsence?: boolean }
): Promise<{ success: boolean; affectedWorkOrders: string[]; workLogsCreated: number; workLogsDeleted: number; manualKept: number }> {
    const { markAttendanceAndRecalculate: _mark } = await import('../../attendance');
    const result = await _mark(attendance, options);

    if (result.success && attendance.Worker_ID && attendance.Date) {
        eventBus.emit('attendance:marked', {
            workerId: attendance.Worker_ID,
            date: attendance.Date,
            status: attendance.Status || '',
            organizationId: attendance.Organization_ID || '',
        });
    }

    return result;
}

export async function saveWorkerAttendance(
    attendance: Partial<WorkerAttendance>
): Promise<string> {
    const { saveWorkerAttendance: _save } = await import('../../attendance');
    return _save(attendance);
}

export async function getWorkerAttendance(
    workerId: string,
    date: string,
    organizationId?: string
): Promise<WorkerAttendance | null> {
    const { getWorkerAttendance: _get } = await import('../../attendance');
    return _get(workerId, date, organizationId);
}

export async function getWorkerAttendanceByMonth(
    workerId: string,
    year: string,
    month: string
): Promise<WorkerAttendance[]> {
    const { getWorkerAttendanceByMonth: _get } = await import('../../attendance');
    return _get(workerId, year, month);
}

export async function getAllAttendanceByMonth(
    year: string,
    month: string,
    organizationId?: string
): Promise<WorkerAttendance[]> {
    const { getAllAttendanceByMonth: _get } = await import('../../attendance');
    return _get(year, month, organizationId);
}

export async function autoPopulateWeekends(
    workers: any[],
    year: number,
    month: number,
    organizationId?: string
): Promise<void> {
    const { autoPopulateWeekends: _auto } = await import('../../attendance');
    return _auto(workers, year, month, organizationId);
}

// ============================================
// WORK LOG CREATION
// ============================================

export async function createWorkLogsForAttendance(
    workerId: string,
    workerName: string,
    dailyRate: number,
    date: string,
    organizationId: string,
    attendanceStatus?: string
): Promise<{ created: number; skipped: number; affectedWorkOrderIds: string[] }> {
    const { createWorkLogsForAttendance: _create } = await import('../../attendance');
    return _create(workerId, workerName, dailyRate, date, organizationId, attendanceStatus);
}

/**
 * Aditivno proknjiži dnevnicu radnika na EKSPLICITNE ciljne stavke (potvrđeni unos iz šihtarice).
 * Idempotentno; kanonska podjela + recalc rade interno. Vidi attendance.bookWorkerDayItems.
 */
export async function bookWorkerDayItems(
    workerId: string,
    workerName: string,
    date: string,
    organizationId: string,
    targets: BookTarget[],
    presence?: number
): Promise<{ created: number; affectedWorkOrderIds: string[] }> {
    const { bookWorkerDayItems: _book } = await import('../../attendance');
    const result = await _book(workerId, workerName, date, organizationId, targets, presence);
    if (result.created > 0) {
        eventBus.emit('attendance:marked', { workerId, date, status: 'Prisutan', organizationId });
    }
    return result;
}

export async function backfillWorkLogsFromAttendance(
    organizationId: string,
    dateFrom: string,
    dateTo: string
): Promise<{ totalCreated: number; totalSkipped: number; processedDays: number }> {
    const mod = await import('../../attendance');
    return mod.backfillWorkLogsFromAttendance(organizationId, dateFrom, dateTo);
}

// ============================================
// DNEVNA KNJIGA RADA (Daily Work Booking)
// ============================================

import type {
    DailyBookingEntryInput,
    DailyBookingEntryView,
    WorkOrderDayEntryInput,
    BookTarget,
} from '../../attendance';
export type {
    DailyBookingItemInput,
    DailyBookingEntryInput,
    DailyBookingItemView,
    DailyBookingEntryView,
    WorkOrderDayEntryInput,
    BookTarget,
} from '../../attendance';

export async function saveDailyWorkBooking(
    date: string,
    organizationId: string,
    entries: DailyBookingEntryInput[]
): Promise<{ success: boolean; logsCreated: number; affectedWorkOrders: string[]; message: string }> {
    const { saveDailyWorkBooking: _save } = await import('../../attendance');
    const result = await _save(date, organizationId, entries);
    if (result.success) {
        eventBus.emit('workOrder:recalculated', { workOrderId: '', organizationId });
    }
    return result;
}

export async function saveWorkOrderDayBooking(
    workOrderId: string,
    date: string,
    organizationId: string,
    entries: WorkOrderDayEntryInput[]
): Promise<{ success: boolean; logsCreated: number; affectedWorkOrders: string[]; message: string }> {
    const { saveWorkOrderDayBooking: _save } = await import('../../attendance');
    const result = await _save(workOrderId, date, organizationId, entries);
    if (result.success) {
        result.affectedWorkOrders.forEach(id => eventBus.emit('workOrder:recalculated', { workOrderId: id, organizationId }));
    }
    return result;
}

export async function getDailyWorkBooking(
    date: string,
    organizationId: string
): Promise<DailyBookingEntryView[]> {
    const { getDailyWorkBooking: _get } = await import('../../attendance');
    return _get(date, organizationId);
}

export async function getBookedWorkerDaysByMonth(
    year: string | number,
    month: string | number,
    organizationId: string
): Promise<string[]> {
    const { getBookedWorkerDaysByMonth: _get } = await import('../../attendance');
    return _get(year, month, organizationId);
}

export async function getWorkLogsForMonth(
    year: string | number,
    month: string | number,
    organizationId: string
): Promise<{ Worker_ID: string; Worker_Name?: string; Date: string; Daily_Rate?: number; Day_Fraction?: number }[]> {
    const { getWorkLogsForMonth: _get } = await import('../../attendance');
    return _get(year, month, organizationId);
}

export async function suggestDailyBooking(
    date: string,
    organizationId: string
): Promise<DailyBookingEntryView[]> {
    const { suggestDailyBooking: _suggest } = await import('../../attendance');
    return _suggest(date, organizationId);
}

export async function bulkBookWorkOrderLabor(
    workOrderId: string,
    workerIds: string[],
    itemIds: string[],
    dateFrom: string,
    dateTo: string,
    skipWeekends: boolean,
    organizationId: string
): Promise<{ success: boolean; logsCreated: number; message: string }> {
    const { bulkBookWorkOrderLabor: _bulk } = await import('../../attendance');
    const result = await _bulk(workOrderId, workerIds, itemIds, dateFrom, dateTo, skipWeekends, organizationId);
    if (result.success) eventBus.emit('workOrder:recalculated', { workOrderId, organizationId });
    return result;
}

/** JEDNOKRATNA MIGRACIJA: uskladi sve postojeće dnevnice s kanonskim (ravnomjernim) modelom. */
export async function recalcAllWorkLogSplits(
    organizationId: string
): Promise<{ success: boolean; pairs: number; logs: number; workOrders: number; message: string }> {
    const { recalcAllWorkLogSplits: _fn } = await import('../../attendance');
    const result = await _fn(organizationId);
    if (result.success) eventBus.emit('workOrder:recalculated', { workOrderId: '', organizationId });
    return result;
}

// ============================================
// RECALCULATION
// ============================================

export async function recalculateWorkOrder(
    workOrderId: string,
    options?: { skipSnapshot?: boolean; skipStatusSync?: boolean; skipMaterialRefresh?: boolean; forceMaterialBasisRefresh?: boolean }
): Promise<void> {
    const { recalculateWorkOrder: _recalc } = await import('../../attendance');
    await _recalc(workOrderId, options);

    eventBus.emit('workOrder:recalculated', { workOrderId, organizationId: '' });
}

export async function recalculateAllActiveWorkOrders(
    organizationId: string,
    options?: { includeCompleted?: boolean }
): Promise<void> {
    const { recalculateAllActiveWorkOrders: _recalcAll } = await import('../../attendance');
    await _recalcAll(organizationId, options);
}

// ============================================
// SYNC PIPELINE
// ============================================

export async function syncProjectStatus(
    projectId: string,
    organizationId?: string
): Promise<void> {
    const { syncProjectStatus: _sync } = await import('../../attendance');
    return _sync(projectId, organizationId);
}

export async function syncAllProjectData(organizationId: string): Promise<{
    workLogsCreated: number;
    workOrdersRecalculated: number;
}> {
    const { syncAllProjectData: _sync } = await import('../../attendance');
    return _sync(organizationId);
}

export async function runStartupSync(organizationId: string): Promise<{
    scheduled: number;
    recalculated: number;
    projectsSynced: number;
}> {
    const { runStartupSync: _run } = await import('../../attendance');
    return _run(organizationId);
}

// ============================================
// MISSING ATTENDANCE DETECTION
// ============================================

export async function checkMissingAttendanceForActiveOrders(
    organizationId: string,
    date?: string
): Promise<any> {
    const { checkMissingAttendanceForActiveOrders: _check } = await import('../../attendance');
    return _check(organizationId, date);
}

export async function checkMissingAttendanceHistory(
    workOrderId: string,
    organizationId: string
): Promise<any> {
    const { checkMissingAttendanceHistory: _check } = await import('../../attendance');
    return _check(workOrderId, organizationId);
}

// ============================================
// PROCESS MANAGEMENT
// ============================================

export async function assignWorkersToItem(
    workOrderId: string,
    itemId: string,
    workers: any[],
    organizationId?: string
): Promise<void> {
    const { assignWorkersToItem: _assign } = await import('../../attendance');
    return _assign(workOrderId, itemId, workers, organizationId);
}

export async function toggleItemPause(
    workOrderId: string,
    itemId: string,
    isPaused: boolean
): Promise<{ success: boolean; message: string }> {
    const { toggleItemPause: _toggle } = await import('../../attendance');
    return _toggle(workOrderId, itemId, isPaused);
}

// ============================================
// LABOR COST CALCULATIONS
// ============================================

export async function calculateActualLaborCost(
    item: any,
    organizationId?: string
): Promise<number> {
    const { calculateActualLaborCost: _calc } = await import('../../attendance');
    return _calc(item, organizationId);
}

export async function calculateSubTaskLaborCost(
    subTask: any,
    itemQuantity: number,
    organizationId: string,
    parentItemId?: string
): Promise<{ laborCost: number; workingDays: number }> {
    const { calculateSubTaskLaborCost: _calc } = await import('../../attendance');
    return _calc(subTask, itemQuantity, organizationId, parentItemId);
}

export async function adjustWorkOrderDates(
    workOrderId: string,
    updates: { Started_At?: string; Completed_At?: string },
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { adjustWorkOrderDates: _fn } = await import('../../attendance');
    return _fn(workOrderId, updates, organizationId);
}

// ============================================
// REMAINING ATTENDANCE FUNCTIONS
// ============================================

export async function updateItemProcess(
    workOrderId: string,
    itemId: string,
    processName: string,
    updates: any
): Promise<void> {
    const { updateItemProcess: _fn } = await import('../../attendance');
    return _fn(workOrderId, itemId, processName, updates);
}

export async function addProcessToOrderItem(
    workOrderId: string,
    itemId: string,
    processName: string,
    organizationId: string,
    opts?: { stageIndex?: number }
): Promise<{ success: boolean; message: string }> {
    const { addProcessToOrderItem: _fn } = await import('../../attendance');
    return _fn(workOrderId, itemId, processName, organizationId, opts);
}

export async function createSubTasks(
    workOrderId: string,
    itemId: string,
    subTasks: any[]
): Promise<void> {
    const { createSubTasks: _fn } = await import('../../attendance');
    return _fn(workOrderId, itemId, subTasks);
}

export async function updateSubTask(
    workOrderId: string,
    itemId: string,
    subTaskId: string,
    updates: any
): Promise<void> {
    const { updateSubTask: _fn } = await import('../../attendance');
    return _fn(workOrderId, itemId, subTaskId, updates);
}

export async function moveSubTask(
    workOrderId: string,
    itemId: string,
    subTaskId: string,
    targetProcess: string
): Promise<void> {
    const { moveSubTask: _fn } = await import('../../attendance');
    return _fn(workOrderId, itemId, subTaskId, targetProcess);
}

export async function canWorkerStartProcess(
    workerId: string
): Promise<{ allowed: boolean; reason?: string; status?: string }> {
    const { canWorkerStartProcess: _fn } = await import('../../attendance');
    return _fn(workerId);
}

export async function triggerWorkLogReconciliation(
    workerId: string,
    organizationId: string
): Promise<{ created: number; message: string }> {
    const { triggerWorkLogReconciliation: _fn } = await import('../../attendance');
    return _fn(workerId, organizationId);
}

export async function getWorkerMonthlyAttendance(
    workerId: string,
    year: number,
    month: number
): Promise<any[]> {
    const { getWorkerMonthlyAttendance: _fn } = await import('../../attendance');
    return _fn(workerId, year, month);
}

export async function overrideWorkLogs(
    workOrderId: string,
    itemId: string,
    entries: Array<{
        Worker_ID: string;
        Worker_Name: string;
        Date: string;
        Daily_Rate: number;
        Original_Daily_Rate?: number;
        Presence?: number;
        Process_Name?: string;
    }>,
    organizationId: string,
    productId?: string
): Promise<{ success: boolean; message: string }> {
    const { overrideWorkLogs: _fn } = await import('../../attendance');
    return _fn(workOrderId, itemId, entries, organizationId, productId);
}

export async function repairAllProductStatuses(): Promise<{ success: boolean; message: string; count: number }> {
    const { repairAllProductStatuses: _fn } = await import('../../attendance');
    return _fn();
}

export async function startWorkOrderItem(
    workOrderId: string,
    itemId: string,
    options?: { customDate?: string }
): Promise<void> {
    const { startWorkOrderItem: _fn } = await import('../../attendance');
    return _fn(workOrderId, itemId, options);
}

export async function completeWorkOrderItem(
    workOrderId: string,
    itemId: string,
    options?: { customDate?: string }
): Promise<void> {
    const { completeWorkOrderItem: _fn } = await import('../../attendance');
    return _fn(workOrderId, itemId, options);
}

export function formatLocalDateISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
