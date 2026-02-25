import { db } from './firebase';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    setDoc,
    query,
    where,
    writeBatch,
} from 'firebase/firestore';
import { generateUUID, createWorkLog, workLogExists, getWorkers, createProductionSnapshot, getProductMaterials, deleteWorkLogsForWorkerOnDate } from './database';
import type { Worker, WorkerAttendance, WorkOrder, WorkOrderItem, WorkLog } from './types';

// Helper: Get Firestore with null check
function getDb() {
    if (!db) {
        throw new Error('Firebase is not initialized. This can only be called in the browser.');
    }
    return db;
}

// Collection names
// Collection names
const COLLECTIONS = {
    WORKER_ATTENDANCE: 'worker_attendance',
    WORK_ORDERS: 'work_orders',
    WORK_ORDER_ITEMS: 'work_order_items',
    PROJECTS: 'projects',
    PRODUCTS: 'products',
    OFFERS: 'offers',
    OFFER_PRODUCTS: 'offer_products',
};

// Start Helper: Get Work Order Item Reference by ID query
async function getItemRef(itemId: string) {
    const firestore = getDb();
    const q = query(
        collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
        where('ID', '==', itemId)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        throw new Error(`Item ${itemId} ne postoji`);
    }

    return snapshot.docs[0].ref;
}
// End Helper

// ============================================
// WORKER ATTENDANCE FUNCTIONS
// ============================================

export async function saveWorkerAttendance(attendance: Partial<WorkerAttendance>): Promise<string> {
    try {
        const firestore = getDb();

        // DUPLICATE GUARD: Check if record already exists for this Worker+Date
        // If so, update existing instead of creating a new one
        let existingId = attendance.Attendance_ID;
        if (!existingId && attendance.Worker_ID && attendance.Date) {
            const existingQuery = query(
                collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
                where('Worker_ID', '==', attendance.Worker_ID),
                where('Date', '==', attendance.Date)
            );
            const existingSnap = await getDocs(existingQuery);
            if (!existingSnap.empty) {
                existingId = existingSnap.docs[0].data().Attendance_ID || existingSnap.docs[0].id;
            }
        }

        const attendanceData = {
            ...attendance,
            Attendance_ID: existingId || generateUUID(),
            Created_Date: attendance.Created_Date || new Date().toISOString(),
            Modified_Date: new Date().toISOString(),
        };

        // Remove undefined fields to prevent Firestore errors
        Object.keys(attendanceData).forEach(key =>
            (attendanceData as any)[key] === undefined && delete (attendanceData as any)[key]
        );

        const attendanceRef = doc(firestore, COLLECTIONS.WORKER_ATTENDANCE, attendanceData.Attendance_ID);
        // Use setDoc with merge to create or update consistently using Attendance_ID as doc ID
        await setDoc(attendanceRef, attendanceData as any, { merge: true });

        return attendanceData.Attendance_ID;
    } catch (error) {
        console.error('Error saving worker attendance:', error);
        throw error;
    }
}

/**
 * PROFIT-02: Check for missing attendance records on active work orders
 * 
 * Returns a list of workers who are assigned to active work order items
 * but don't have attendance records for the given date.
 * This allows the UI to show daily notifications:
 * "⚠️ Amer nema uneseno prisustvo za danas — trošak rada može biti netačan"
 * 
 * @param organizationId - Organization ID
 * @param date - Date to check (YYYY-MM-DD), defaults to today
 * @returns Array of missing attendance warnings
 */
export async function checkMissingAttendanceForActiveOrders(
    organizationId: string,
    date?: string
): Promise<{
    warnings: {
        Worker_ID: string;
        Worker_Name: string;
        Work_Order_ID: string;
        Work_Order_Name: string;
        Item_Name: string;
        Date: string;
    }[];
    missingCount: number;
    totalAssigned: number;
}> {
    if (!organizationId) return { warnings: [], missingCount: 0, totalAssigned: 0 };

    try {
        const firestore = getDb();
        const checkDate = date || new Date().toISOString().split('T')[0];

        // PROFIT-10 FIX: Use date string for day-of-week check to avoid timezone issues
        // Parse as local noon to avoid midnight timezone shifts
        const dateForDayCheck = new Date(checkDate + 'T12:00:00');
        const dayOfWeek = dateForDayCheck.getDay();

        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return { warnings: [], missingCount: 0, totalAssigned: 0 };
        }

        // Get all active work orders
        const woQuery = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Status', '==', 'U toku'),
            where('Organization_ID', '==', organizationId)
        );
        const woSnap = await getDocs(woQuery);

        if (woSnap.empty) return { warnings: [], missingCount: 0, totalAssigned: 0 };

        // Get all attendance records for this date
        const attendanceQuery = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            where('Date', '==', checkDate),
            where('Organization_ID', '==', organizationId)
        );
        const attendanceSnap = await getDocs(attendanceQuery);

        // Build set of workers who have attendance
        const workersWithAttendance = new Set<string>();
        attendanceSnap.forEach(d => {
            const data = d.data();
            if (data.Worker_ID && (data.Status === 'Prisutan' || data.Status === 'Teren' || data.Status === 'Odsutan' || data.Status === 'Bolovanje' || data.Status === 'Odmor')) {
                workersWithAttendance.add(data.Worker_ID);
            }
        });

        // Check each active work order's items for assigned workers without attendance
        const warnings: {
            Worker_ID: string;
            Worker_Name: string;
            Work_Order_ID: string;
            Work_Order_Name: string;
            Item_Name: string;
            Date: string;
        }[] = [];
        const checkedWorkers = new Set<string>();
        let totalAssigned = 0;

        for (const woDoc of woSnap.docs) {
            const wo = woDoc.data();
            const itemsQuery = query(
                collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                where('Work_Order_ID', '==', wo.Work_Order_ID),
                where('Status', '==', 'U toku'),
                where('Organization_ID', '==', organizationId)
            );
            const itemsSnap = await getDocs(itemsQuery);

            for (const itemDoc of itemsSnap.docs) {
                const item = itemDoc.data() as WorkOrderItem;

                // Collect workers from Processes
                const itemWorkers: { id: string; name: string }[] = [];
                if (item.Processes && item.Processes.length > 0) {
                    for (const process of item.Processes) {
                        if (process.Worker_ID) {
                            itemWorkers.push({ id: process.Worker_ID, name: (process as any).Worker_Name || 'Nepoznat' });
                        }
                        if ((process as any).Helpers?.length > 0) {
                            for (const h of (process as any).Helpers) {
                                if (h.Worker_ID) {
                                    itemWorkers.push({ id: h.Worker_ID, name: h.Worker_Name || 'Nepoznat' });
                                }
                            }
                        }
                    }
                }
                // Fallback to Assigned_Workers
                if (itemWorkers.length === 0 && item.Assigned_Workers?.length) {
                    for (const w of item.Assigned_Workers) {
                        if (w.Worker_ID) {
                            itemWorkers.push({ id: w.Worker_ID, name: w.Worker_Name || 'Nepoznat' });
                        }
                    }
                }

                totalAssigned += itemWorkers.length;

                for (const worker of itemWorkers) {
                    if (checkedWorkers.has(worker.id)) continue;
                    if (!workersWithAttendance.has(worker.id)) {
                        warnings.push({
                            Worker_ID: worker.id,
                            Worker_Name: worker.name,
                            Work_Order_ID: wo.Work_Order_ID,
                            Work_Order_Name: wo.Name || `RN-${wo.Work_Order_ID?.slice(-4)}`,
                            Item_Name: item.Product_Name || 'Nepoznat proizvod',
                            Date: checkDate,
                        });
                        checkedWorkers.add(worker.id);
                    }
                }
            }
        }

        return {
            warnings,
            missingCount: warnings.length,
            totalAssigned: new Set(Array.from(checkedWorkers).concat(Array.from(workersWithAttendance))).size,
        };
    } catch (error) {
        console.error('Error checking missing attendance:', error);
        return { warnings: [], missingCount: 0, totalAssigned: 0 };
    }
}

/**
 * Check for missing attendance history for a specific work order.
 * Scans from Started_At to Completed_At (or Today) and checks if assigned workers
 * have valid work logs for those dates.
 * 
 * Used for:
 * 1. Warnings on finished work orders (Profit might be inaccurate)
 * 2. Pre-completion checks
 */
export async function checkMissingAttendanceHistory(
    workOrderId: string,
    organizationId: string
): Promise<{
    missingDays: number;
    details: { date: string; workerName: string }[]
}> {
    if (!workOrderId || !organizationId) return { missingDays: 0, details: [] };

    try {
        const firestore = getDb();

        // 1. Get Work Order
        const woRef = doc(firestore, COLLECTIONS.WORK_ORDERS, workOrderId);
        const woSnap = await getDoc(woRef);
        if (!woSnap.exists()) return { missingDays: 0, details: [] };

        const wo = woSnap.data() as WorkOrder;
        if (!wo.Started_At) return { missingDays: 0, details: [] };
        if (wo.Status !== 'Završeno' && wo.Status !== 'U toku') return { missingDays: 0, details: [] };

        const startDate = new Date(wo.Started_At);
        const endDate = wo.Completed_At ? new Date(wo.Completed_At) : new Date();

        // Normalize dates
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        // 2. Get assigned workers for this WO (from items)
        const itemsQuery = query(
            collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnap = await getDocs(itemsQuery);
        const assignedWorkers = new Map<string, string>(); // ID -> Name

        itemsSnap.docs.forEach(d => {
            const item = d.data() as WorkOrderItem;
            item.Assigned_Workers?.forEach(w => {
                assignedWorkers.set(w.Worker_ID, w.Worker_Name);
            });
            // Also include workers active on processes
            item.Processes?.forEach(p => {
                if (p.Worker_ID) assignedWorkers.set(p.Worker_ID, (p as any).Worker_Name || 'Unknown');
                p.Helpers?.forEach(h => assignedWorkers.set(h.Worker_ID, h.Worker_Name || 'Unknown'));
            });
        });

        if (assignedWorkers.size === 0) return { missingDays: 0, details: [] };
        const workerIds = Array.from(assignedWorkers.keys());

        // 3. Fetch logs for this WO within the timeframe
        // This confirms ACTUAL work done
        const logsQuery = query(
            collection(firestore, 'work_logs'),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const logsSnap = await getDocs(logsQuery);

        const workerLogDates = new Set<string>(); // "WorkerID_Date"
        logsSnap.docs.forEach(d => {
            const data = d.data();
            workerLogDates.add(`${data.Worker_ID}_${data.Date}`);
        });

        // 4. Scan dates and check for missing logs
        // IMPORTANT: We also need to check if the worker was even present (Attendance).
        // If they were absent (Sick/Vacation), it's NOT a missing log.
        // Fetch attendance for these workers in valid range (batch query by month is hard here, so we do simpler check)
        // Optimization: Fetch all attendance for these workers in range? 
        // Or assume business days = working days?

        // To be accurate, we'll fetch attendance for the relevant period.
        // Since period could be long, let's limit to check "Was there attendance but NO log?" or "Was there NO attendance?"
        // Usually, if no attendance record exists, we assume they were absent or forgot to check in.
        // If they checked in (Prisutan) but have NO log for this active WO, that's a gap.

        // Let's implement simpler logic for MVP: Business days check.
        // Ideally we should cross-reference attendance status, but that requires many reads.
        // We'll proceed with Business Days approach and rely on user to know if they were sick.

        const missingDetails: { date: string; workerName: string }[] = [];
        const loopDate = new Date(startDate);

        while (loopDate <= endDate) {
            const day = loopDate.getDay();
            if (day !== 0 && day !== 6) { // Mon-Fri
                const dateStr = formatLocalDateISO(new Date(loopDate));

                for (const workerId of workerIds) {
                    // Check if log exists for this specific WO
                    if (!workerLogDates.has(`${workerId}_${dateStr}`)) {
                        // Log is missing.
                        // Ideally we check if they were present on that day at all.
                        // But for now, flagging it is safer — user can ignore if they know worker was sick.
                        missingDetails.push({
                            date: dateStr,
                            workerName: assignedWorkers.get(workerId) || 'Unknown'
                        });
                    }
                }
            }
            loopDate.setDate(loopDate.getDate() + 1);
        }

        return {
            missingDays: missingDetails.length,
            details: missingDetails
        };

    } catch (error) {
        console.error('Error checking missing attendance history:', error);
        return { missingDays: 0, details: [] };
    }
}

/**
 * PROFIT VALIDATION — GAP-2/5
 * Validates a work order's profit data and returns warnings for the UI.
 * This is called when expanding a work order card to show real-time data quality indicators.
 */
export interface ProfitWarning {
    type: 'error' | 'warning' | 'info';
    icon: string;
    message: string;
    itemName?: string;
}

export function validateWorkOrderProfitData(workOrder: any): ProfitWarning[] {
    const warnings: ProfitWarning[] = [];
    const items = workOrder?.items || [];

    if (items.length === 0) return warnings;

    // Check each item
    for (const item of items) {
        // Product_Value = 0 → No offer pricing
        if (!item.Product_Value || item.Product_Value <= 0) {
            warnings.push({
                type: 'error',
                icon: 'money_off',
                message: `Cijena nije postavljena (nema ponude?)`,
                itemName: item.Product_Name,
            });
        }

        // Material_Cost = 0 → No materials assigned
        if (!item.Material_Cost || item.Material_Cost <= 0) {
            warnings.push({
                type: 'warning',
                icon: 'inventory_2',
                message: `Materijali nisu dodati ili nemaju cijenu`,
                itemName: item.Product_Name,
            });
        }

        // Active item with no labor cost → Missing attendance
        if (item.Status === 'U toku' && (!item.Actual_Labor_Cost || item.Actual_Labor_Cost <= 0)) {
            warnings.push({
                type: 'warning',
                icon: 'person_off',
                message: `Nema evidentiranog prisustva (trošak rada = 0)`,
                itemName: item.Product_Name,
            });
        }

        // Labor budget overrun (>20%)
        if (item.Planned_Labor_Cost && item.Planned_Labor_Cost > 0 && item.Actual_Labor_Cost) {
            if (item.Actual_Labor_Cost > item.Planned_Labor_Cost * 1.2) {
                const overrun = Math.round(((item.Actual_Labor_Cost - item.Planned_Labor_Cost) / item.Planned_Labor_Cost) * 100);
                warnings.push({
                    type: 'error',
                    icon: 'trending_up',
                    message: `Prekoračen budžet rada za ${overrun}%`,
                    itemName: item.Product_Name,
                });
            }
        }
    }

    // Aggregate checks
    const totalValue = items.reduce((s: number, i: any) => s + (i.Product_Value || 0), 0);
    const totalMaterial = items.reduce((s: number, i: any) => s + (i.Material_Cost || 0), 0);
    const totalLabor = items.reduce((s: number, i: any) => s + (i.Actual_Labor_Cost || 0), 0);
    const totalTransport = items.reduce((s: number, i: any) => s + (i.Transport_Share || 0), 0);
    const totalServices = items.reduce((s: number, i: any) => s + (i.Services_Total || 0), 0);

    if (totalValue > 0) {
        const netProfit = totalValue - totalMaterial - totalLabor - totalTransport - totalServices;
        const margin = (netProfit / totalValue) * 100;

        if (margin < -20) {
            warnings.push({
                type: 'error',
                icon: 'warning',
                message: `Negativna marža (${Math.round(margin)}%) — provjerite cijene i troškove`,
            });
        } else if (margin < 0) {
            warnings.push({
                type: 'warning',
                icon: 'trending_down',
                message: `Profit u minusu (${Math.round(margin)}%)`,
            });
        }
    }

    // Transport/Services = 0 but offer probably had them
    if (totalValue > 0 && totalTransport === 0 && totalServices === 0) {
        warnings.push({
            type: 'info',
            icon: 'local_shipping',
            message: 'Transport i usluge = 0 KM (nalog kreiran bez podataka iz ponude?)',
        });
    }

    return warnings;
}

/**
 * Mark worker attendance and automatically create/cleanup work logs
 * ENHANCED: 
 *   - Creates work_logs when status is 'Prisutan' or 'Teren'
 *   - DELETES work_logs when status changes to non-working (Odsutan, Bolovanje, Odmor, Vikend)
 * This ensures proper synchronization between attendance and productivity tracking
 */
export async function markAttendanceAndRecalculate(
    attendance: Partial<WorkerAttendance>,
    options?: { skipRecalculation?: boolean }
): Promise<{ success: boolean; affectedWorkOrders: string[]; workLogsCreated: number; workLogsDeleted: number }> {
    try {
        // 1. Save the attendance record
        await saveWorkerAttendance(attendance);

        let workLogsCreated = 0;
        let workLogsDeleted = 0;
        const affectedWorkOrderIds = new Set<string>();

        if (!attendance.Worker_ID || !attendance.Date || !attendance.Organization_ID) {
            return { success: true, affectedWorkOrders: [], workLogsCreated: 0, workLogsDeleted: 0 };
        }

        const firestore = getDb();

        // 2. If worker is present (Prisutan or Teren), create work logs for all active items
        if (attendance.Status === 'Prisutan' || attendance.Status === 'Teren') {
            // Get worker's daily rate
            const workers = await getWorkers(attendance.Organization_ID);
            const worker = workers.find(w => w.Worker_ID === attendance.Worker_ID);
            const dailyRate = worker?.Daily_Rate || 0;
            const workerName = attendance.Worker_Name || worker?.Name || 'Unknown';

            // Create work logs for all active work order items where worker is assigned
            // NOW HANDLES BACKDATED ATTENDANCE (Checks Start/End dates instead of just Status)
            const result = await createWorkLogsForAttendance(
                attendance.Worker_ID,
                workerName,
                dailyRate,
                attendance.Date,
                attendance.Organization_ID
            );

            workLogsCreated = result.created;
            result.affectedWorkOrderIds.forEach(id => affectedWorkOrderIds.add(id));

            console.log(`Attendance marked: ${workerName} - ${attendance.Status} on ${attendance.Date}. Work logs created: ${result.created}, skipped: ${result.skipped}`);
        } else {
            // 3. NON-WORKING STATUS: Delete any existing work logs for this worker/date
            // This handles retroactive corrections (e.g., changing Prisutan → Odsutan)
            try {
                // BEFORE deleting, find which WOs might be affected so we can recalculate them
                // We need to find WOs active on this date where this worker IS assigned
                // Same logic as createWorkLogsForAttendance
                if (!options?.skipRecalculation) {
                    const targetDate = new Date(attendance.Date);
                    targetDate.setHours(0, 0, 0, 0);

                    // Find WOs active on this date
                    const woQuery = query(
                        collection(firestore, COLLECTIONS.WORK_ORDERS),
                        where('Organization_ID', '==', attendance.Organization_ID),
                        where('Status', 'in', ['U toku', 'Završeno'])
                    );
                    const woSnap = await getDocs(woQuery);

                    for (const doc of woSnap.docs) {
                        const wo = doc.data() as WorkOrder;
                        // Date check
                        if (!wo.Started_At) continue;
                        const start = new Date(wo.Started_At); start.setHours(0, 0, 0, 0);
                        if (start > targetDate) continue;
                        if (wo.Status === 'Završeno' && wo.Completed_At) {
                            const end = new Date(wo.Completed_At); end.setHours(23, 59, 59, 999);
                            if (end < targetDate) continue;
                        }

                        // Check items for assignment
                        const itemsQuery = query(
                            collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                            where('Work_Order_ID', '==', wo.Work_Order_ID),
                            where('Organization_ID', '==', attendance.Organization_ID)
                        );
                        const itemsSnap = await getDocs(itemsQuery);
                        const isAssigned = itemsSnap.docs.some(d => isWorkerAssignedToItem(d.data() as WorkOrderItem, attendance.Worker_ID!));

                        if (isAssigned) {
                            affectedWorkOrderIds.add(wo.Work_Order_ID);
                        }
                    }
                }

                const cleanupResult = await deleteWorkLogsForWorkerOnDate(
                    attendance.Worker_ID,
                    attendance.Date,
                    attendance.Organization_ID
                );
                workLogsDeleted = cleanupResult.deleted;
                if (workLogsDeleted > 0) {
                    console.log(`Attendance cleanup: Deleted ${workLogsDeleted} stale work logs for worker ${attendance.Worker_ID} on ${attendance.Date} (status: ${attendance.Status})`);
                }
            } catch (deleteError) {
                console.error('Failed to delete work logs during attendance cleanup:', deleteError);
                // Continue — attendance was already saved, best effort cleanup
            }
        }

        // 4. RECALCULATE affected work orders so profit/labor cost stays fresh
        //    (skipped when called in bulk — caller handles batch recalc)
        const finalAffectedList = Array.from(affectedWorkOrderIds);

        if (!options?.skipRecalculation && finalAffectedList.length > 0) {
            try {
                // Determine if we need to update snapshots for finished orders
                // recalculateWorkOrder handles the logic, but if a WO is finished, 
                // we might need to recreate the snapshot? 
                // Currently recalculateWorkOrder updates the WO document. 
                // If the app relies on snapshots for finished orders, strictly speaking we should update them.
                // But for now, ensuring the WO document has correct Actual_Labor_Cost is the priority (S16).

                await Promise.all(finalAffectedList.map(woId => recalculateWorkOrder(woId)));
                console.log(`Recalculated ${finalAffectedList.length} work orders affected by attendance change.`);
            } catch (recalcError) {
                console.error('Failed to recalculate work orders after attendance change:', recalcError);
            }
        }

        return { success: true, affectedWorkOrders: finalAffectedList, workLogsCreated, workLogsDeleted };
    } catch (error) {
        console.error('Error marking attendance:', error);
        throw error;
    }
}



/**
 * Create WorkLog entries for a worker's attendance
 * Finds all active work order items where the worker is assigned and creates work logs
 * 
 * CRITICAL FIX (S2.6): Daily rate is now SPLIT across all active assignments.
 * A worker assigned to 3 items gets dailyRate/3 per item, NOT dailyRate × 3.
 * 
 * @param workerId - Worker ID
 * @param workerName - Worker name
 * @param dailyRate - Worker's daily rate (total, will be split)
 * @param date - Attendance date (YYYY-MM-DD)
 * @param organizationId - Organization ID for multi-tenancy
 * @returns Number of work logs created
 */
/**
 * Create WorkLog entries for a worker's attendance
 * Finds all active work order items where the worker is assigned and creates work logs
 * 
 * CRITICAL FIX (S16): Now handles BACKDATED attendance correctly.
 * Instead of checking current status, checks if the work order was active ON THE DATE provided.
 * Logic: (Started_At <= Date) AND (Completed_At >= Date OR Completed_At IS NULL)
 * 
 * @param workerId - Worker ID
 * @param workerName - Worker name
 * @param dailyRate - Worker's daily rate (total, will be split)
 * @param date - Attendance date (YYYY-MM-DD)
 * @param organizationId - Organization ID for multi-tenancy
 * @returns Number of work logs created
 */
export async function createWorkLogsForAttendance(
    workerId: string,
    workerName: string,
    dailyRate: number,
    date: string,
    organizationId: string
): Promise<{ created: number; skipped: number; affectedWorkOrderIds: string[] }> {
    if (!organizationId) {
        console.error('createWorkLogsForAttendance: organizationId is required');
        return { created: 0, skipped: 0, affectedWorkOrderIds: [] };
    }
    try {
        const firestore = getDb();
        let created = 0;
        let skipped = 0;
        const affectedWorkOrderIds: string[] = [];

        // Find work orders that were active ON THIS DATE
        // We can't query this easily in Firestore due to composite index limitations on inequalities
        // So we fetch all U toku, Na čekanju, AND Završeno (if recently finished)
        // Optimization: Fetch 'U toku' AND 'Završeno' where Completed_At >= Date

        const activeWoQuery = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Organization_ID', '==', organizationId),
            where('Status', 'in', ['U toku', 'Završeno']) // Check finished ones too!
        );

        const woSnapshot = await getDocs(activeWoQuery);

        if (woSnapshot.empty) {
            console.log('No work orders found for attendance processing');
            return { created: 0, skipped: 0, affectedWorkOrderIds: [] };
        }

        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0); // Normalize to midnight

        const validWorkOrderIds: string[] = [];

        for (const doc of woSnapshot.docs) {
            const wo = doc.data() as WorkOrder;

            // Check start date
            if (!wo.Started_At) continue;
            const startDate = new Date(wo.Started_At);
            startDate.setHours(0, 0, 0, 0);

            if (startDate > targetDate) continue; // Started after this attendance date

            // Check end date (if finished)
            if (wo.Status === 'Završeno' && wo.Completed_At) {
                const endDate = new Date(wo.Completed_At);
                endDate.setHours(23, 59, 59, 999); // End of that day

                if (endDate < targetDate) continue; // Finished before this attendance date
            }

            validWorkOrderIds.push(wo.Work_Order_ID);
        }

        // ═══════════════════════════════════════════════════════════════
        // PASS 1: Count total active assignments to determine rate split
        // ═══════════════════════════════════════════════════════════════
        interface PendingWorkLog {
            workOrderId: string;
            item: WorkOrderItem;
            processName: string | undefined;
        }
        const pendingLogs: PendingWorkLog[] = [];

        for (const workOrderId of validWorkOrderIds) {
            const itemsQuery = query(
                collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                where('Work_Order_ID', '==', workOrderId),
                where('Organization_ID', '==', organizationId)
                // Don't filter by Item Status here, as item might be finished now but was active then
            );
            const itemsSnapshot = await getDocs(itemsQuery);

            for (const itemDoc of itemsSnapshot.docs) {
                const item = itemDoc.data() as WorkOrderItem;

                // Check if item was active on date
                // Similar logic to WO check
                if (item.Started_At) {
                    const itemStart = new Date(item.Started_At);
                    itemStart.setHours(0, 0, 0, 0);
                    if (itemStart > targetDate) continue;
                }
                if (item.Status === 'Završeno' && item.Completed_At) {
                    const itemEnd = new Date(item.Completed_At);
                    itemEnd.setHours(23, 59, 59, 999);
                    if (itemEnd < targetDate) continue;
                }

                // Check if worker is assigned to this item
                const isAssigned = isWorkerAssignedToItem(item, workerId);
                if (!isAssigned) continue;

                // Check if work log already exists for this worker/item/date
                const exists = await workLogExists(workerId, item.ID, date, organizationId);
                if (exists) {
                    skipped++;
                    continue;
                }

                const processName = getActiveProcessForWorker(item, workerId);
                pendingLogs.push({ workOrderId, item, processName });
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // PASS 2: Create work logs with SPLIT daily rate
        // Worker's daily rate is divided equally across all assignments
        // e.g., 80 KM / 3 assignments = 26.67 KM per item
        // ═══════════════════════════════════════════════════════════════
        const totalAssignments = pendingLogs.length + skipped; // Total = new + existing
        const splitRate = totalAssignments > 0 ? dailyRate / totalAssignments : dailyRate;

        for (const pending of pendingLogs) {
            const result = await createWorkLog({
                Worker_ID: workerId,
                Worker_Name: workerName,
                Daily_Rate: splitRate,
                Original_Daily_Rate: dailyRate,
                Split_Factor: totalAssignments,
                Work_Order_ID: pending.workOrderId,
                Work_Order_Item_ID: pending.item.ID,
                Product_ID: pending.item.Product_ID,
                Process_Name: pending.processName,
                Is_From_Attendance: true,
                Date: date,
            }, organizationId);

            if (result.success) {
                created++;
                if (!affectedWorkOrderIds.includes(pending.workOrderId)) {
                    affectedWorkOrderIds.push(pending.workOrderId);
                }
            }
        }

        console.log(`WorkLogs: Created ${created}, Skipped ${skipped} for worker ${workerName} on ${date} (split: ${splitRate.toFixed(2)} KM across ${totalAssignments} items)`);

        // ═══════════════════════════════════════════════════════════════
        // PASS 3: Reconcile ALL work logs for this worker/date
        // ALWAYS run (not just when skipped > 0) to catch:
        //   - Stale split rates from previous runs
        //   - Orphan logs from items the worker was removed from
        // ═══════════════════════════════════════════════════════════════
        try {
            const reconcileFirestore = getDb();
            const existingLogsQuery = query(
                collection(reconcileFirestore, 'work_logs'),
                where('Worker_ID', '==', workerId),
                where('Date', '==', date),
                where('Organization_ID', '==', organizationId)
            );
            const existingSnap = await getDocs(existingLogsQuery);
            const totalLogs = existingSnap.size;

            if (totalLogs > 0) {
                const correctSplitRate = dailyRate / totalLogs;
                const batch = writeBatch(reconcileFirestore);
                let updated = 0;

                existingSnap.docs.forEach(docSnap => {
                    const data = docSnap.data();
                    // Update if split rate has changed
                    if (Math.abs((data.Daily_Rate || 0) - correctSplitRate) > 0.01) {
                        batch.update(docSnap.ref, {
                            Daily_Rate: Math.round(correctSplitRate * 100) / 100,
                            Original_Daily_Rate: dailyRate,
                            Split_Factor: totalLogs
                        });
                        updated++;
                    }
                });

                if (updated > 0) {
                    await batch.commit();
                    console.log(`WorkLogs: Reconciled ${updated} existing logs for ${workerName} on ${date} (new split: ${correctSplitRate.toFixed(2)} KM across ${totalLogs} items)`);
                }
            }
        } catch (reconcileErr) {
            console.warn('WorkLogs reconcile error (non-critical):', reconcileErr);
        }

        return { created, skipped, affectedWorkOrderIds };
    } catch (error) {
        console.error('createWorkLogsForAttendance error:', error);
        return { created: 0, skipped: 0, affectedWorkOrderIds: [] };
    }
}

/**
 * Helper: Check if a worker is assigned to a work order item
 * Checks Assigned_Workers array, Processes, and SubTasks
 * NOTE: Returns false if the item is paused (Is_Paused = true)
 */
function isWorkerAssignedToItem(item: WorkOrderItem, workerId: string): boolean {
    // Skip paused items - they don't accrue daily rates
    if (item.Is_Paused) {
        return false;
    }

    // Check Assigned_Workers
    if (item.Assigned_Workers?.some(w => w.Worker_ID === workerId)) {
        return true;
    }

    // Check Processes - main worker OR helper
    if (item.Processes?.some(p =>
        p.Status === 'U toku' && (
            p.Worker_ID === workerId ||
            p.Helpers?.some(h => h.Worker_ID === workerId)
        )
    )) {
        return true;
    }

    // Check SubTasks - main worker OR helper
    if (item.SubTasks?.some(st =>
        st.Status === 'U toku' && (
            st.Worker_ID === workerId ||
            st.Helpers?.some(h => h.Worker_ID === workerId)
        )
    )) {
        return true;
    }

    return false;
}

/**
 * Toggle pause state for a work order item
 * Paused items don't accrue daily rates (dnevnice) but maintain their status
 * Also tracks Pause_Periods for accurate labor cost calculation
 */
export async function toggleItemPause(
    workOrderId: string,
    itemId: string,
    isPaused: boolean
): Promise<{ success: boolean; message: string }> {
    try {
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) {
            return { success: false, message: 'Stavka nije pronađena' };
        }

        const itemData = itemSnap.data();
        const now = new Date().toISOString();

        // Track pause periods for accurate labor cost calculation
        let pausePeriods: Array<{ Started_At: string; Ended_At?: string }> = itemData.Pause_Periods || [];

        if (isPaused) {
            // Starting a new pause period
            pausePeriods.push({ Started_At: now });
        } else {
            // Ending the most recent pause period
            if (pausePeriods.length > 0) {
                const lastPause = pausePeriods[pausePeriods.length - 1];
                if (!lastPause.Ended_At) {
                    lastPause.Ended_At = now;
                }
            }
        }

        await updateDoc(itemRef, {
            Is_Paused: isPaused,
            Pause_Periods: pausePeriods
        });

        return {
            success: true,
            message: isPaused ? 'Proizvod pauziran - dnevnice neće biti zaračunate' : 'Proizvod nastavljen'
        };
    } catch (error) {
        console.error('toggleItemPause error:', error);
        return { success: false, message: 'Greška pri ažuriranju pauze' };
    }
}

/**
 * Helper: Get the active process name for a worker on a work order item
 * Returns the process the worker is currently working on, or undefined if not found
 */
function getActiveProcessForWorker(item: WorkOrderItem, workerId: string): string | undefined {
    // First check Processes - find the one where worker is assigned as main worker and status is 'U toku'
    const activeProcess = item.Processes?.find(p => p.Worker_ID === workerId && p.Status === 'U toku');
    if (activeProcess) {
        return activeProcess.Process_Name;
    }

    // Check if worker is a helper on any active process
    const helperProcess = item.Processes?.find(p =>
        p.Status === 'U toku' && p.Helpers?.some(h => h.Worker_ID === workerId)
    );
    if (helperProcess) {
        return helperProcess.Process_Name;
    }

    // Check SubTasks - if worker is assigned to a subtask, get its current process
    const activeSubTask = item.SubTasks?.find(st => st.Worker_ID === workerId && st.Status === 'U toku');
    if (activeSubTask) {
        return activeSubTask.Current_Process;
    }

    // If worker is in Assigned_Workers but no active process, check for any 'U toku' process
    if (item.Assigned_Workers?.some(w => w.Worker_ID === workerId)) {
        const anyActiveProcess = item.Processes?.find(p => p.Status === 'U toku');
        if (anyActiveProcess) {
            return anyActiveProcess.Process_Name;
        }
    }

    return undefined;
}

// Helper: Get local date string YYYY-MM-DD
export function formatLocalDateISO(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * FIX-1: Trigger WorkLog creation/reconciliation when a worker is assigned via Kanban.
 * This ensures labor costs are captured immediately, without waiting for sihtarica.
 * 
 * Idempotent — workLogExists() prevents duplicate logs.
 * If the worker already has logs for today, this will reconcile split rates.
 * 
 * @param workerId - Worker being assigned
 * @param organizationId - Organization ID for multi-tenancy
 * @returns Object with created count and informational message
 */
export async function triggerWorkLogReconciliation(
    workerId: string,
    organizationId: string
): Promise<{ created: number; message: string }> {
    try {
        if (!workerId || !organizationId) {
            return { created: 0, message: 'Missing workerId or organizationId' };
        }

        // 1. Get worker details (name + daily rate)
        const allWorkers = await getWorkers(organizationId);
        const worker = allWorkers.find(w => w.Worker_ID === workerId);
        if (!worker) {
            return { created: 0, message: 'Worker not found' };
        }

        if (!worker.Daily_Rate || worker.Daily_Rate <= 0) {
            return { created: 0, message: `${worker.Name} ima dnevnicu 0 KM — WorkLog nije kreiran.` };
        }

        const today = formatLocalDateISO(new Date());

        // 2. Create/reconcile work logs for today
        const result = await createWorkLogsForAttendance(
            worker.Worker_ID,
            worker.Name,
            worker.Daily_Rate,
            today,
            organizationId
        );

        // 3. Recalculate affected work orders
        if (result.affectedWorkOrderIds.length > 0) {
            await Promise.all(
                result.affectedWorkOrderIds.map(woId => recalculateWorkOrder(woId))
            );
        }

        if (result.created > 0) {
            return {
                created: result.created,
                message: `WorkLog kreiran za ${worker.Name} (${worker.Daily_Rate} KM ÷ ${result.created + result.skipped} stavki)`
            };
        } else {
            return {
                created: 0,
                message: `WorkLog za ${worker.Name} već postoji za danas.`
            };
        }
    } catch (error) {
        console.error('triggerWorkLogReconciliation error:', error);
        return { created: 0, message: 'Greška pri kreiranju WorkLog-a' };
    }
}

/**
 * Check if a worker can start a process today
 * NOTE: Always returns allowed=true now. Attendance status is for work log creation,
 * not for blocking work order operations. Users can adjust work orders anytime.
 */
export async function canWorkerStartProcess(
    workerId: string
): Promise<{ allowed: boolean; reason?: string; status?: string }> {
    try {
        const today = formatLocalDateISO(new Date());
        const attendance = await getWorkerAttendance(workerId, today);

        // Always allow work order operations - attendance is informational only
        // Work logs will be created based on actual attendance when recorded
        if (!attendance) {
            return { allowed: true, status: 'Nije evidentiran' };
        }

        return { allowed: true, status: attendance.Status };
    } catch (error) {
        console.error('Error checking worker availability:', error);
        // Still allow on error - don't block operations
        return { allowed: true, reason: 'Provjera prisustva nije uspjela' };
    }
}

export async function getWorkerAttendance(workerId: string, date: string, organizationId?: string): Promise<WorkerAttendance | null> {
    try {
        const firestore = getDb();
        const constraints = [
            where('Worker_ID', '==', workerId),
            where('Date', '==', date)
        ];
        if (organizationId) {
            constraints.push(where('Organization_ID', '==', organizationId));
        }
        const q = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            ...constraints
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) return null;
        return snapshot.docs[0].data() as WorkerAttendance;
    } catch (error) {
        console.error('Error getting worker attendance:', error);
        throw error;
    }
}

export async function getWorkerAttendanceByMonth(workerId: string, year: string, month: string): Promise<WorkerAttendance[]> {
    try {
        const firestore = getDb();
        const startDate = `${year}-${month.padStart(2, '0')}-01`;
        const endDate = `${year}-${month.padStart(2, '0')}-31`;

        const q = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            where('Worker_ID', '==', workerId),
            where('Date', '>=', startDate),
            where('Date', '<=', endDate)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data() as WorkerAttendance);
    } catch (error) {
        console.error('Error getting monthly attendance:', error);
        throw error;
    }
}

export async function getAllAttendanceByMonth(year: string, month: string, organizationId?: string): Promise<WorkerAttendance[]> {
    try {
        const firestore = getDb();
        const startDate = `${year}-${month.padStart(2, '0')}-01`;
        const endDate = `${year}-${month.padStart(2, '0')}-31`;

        // If organizationId provided, filter by it
        if (organizationId) {
            const q = query(
                collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
                where('Organization_ID', '==', organizationId),
                where('Date', '>=', startDate),
                where('Date', '<=', endDate)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => doc.data() as WorkerAttendance);
        }

        // Fallback for backward compatibility (no org filter)
        const q = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            where('Date', '>=', startDate),
            where('Date', '<=', endDate)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data() as WorkerAttendance);
    } catch (error) {
        console.error('Error getting all attendance:', error);
        throw error;
    }
}

export async function getWorkerMonthlyAttendance(
    workerId: string,
    year: number,
    month: number
): Promise<WorkerAttendance[]> {
    try {
        const firestore = getDb();
        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endDate = `${year}-${month.toString().padStart(2, '0')}-31`;

        const q = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            where('Worker_ID', '==', workerId),
            where('Date', '>=', startDate),
            where('Date', '<=', endDate)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data() as WorkerAttendance);
    } catch (error) {
        console.error('Error getting worker monthly attendance:', error);
        throw error;
    }
}

export async function autoPopulateWeekends(workers: Worker[], year: number, month: number, organizationId?: string): Promise<void> {
    try {
        const firestore = getDb();
        const daysInMonth = new Date(year, month, 0).getDate();

        // Collect all weekend date strings
        const weekendDates: string[] = [];
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month - 1, day);
            if (date.getDay() === 0 || date.getDay() === 6) {
                weekendDates.push(formatLocalDateISO(date));
            }
        }

        if (weekendDates.length === 0 || workers.length === 0) return;

        // BATCH-FETCH all existing attendance for this month to avoid N async reads
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
        const constraints = [
            where('Date', '>=', startDate),
            where('Date', '<=', endDate)
        ];
        if (organizationId) {
            constraints.push(where('Organization_ID', '==', organizationId));
        }
        const existingQuery = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            ...constraints
        );
        const existingSnap = await getDocs(existingQuery);
        const existingKeys = new Set<string>();
        existingSnap.forEach(d => {
            const data = d.data();
            existingKeys.add(`${data.Worker_ID}_${data.Date}`);
        });

        // Build all operations, then commit in 500-op chunks
        const operations: Array<{ ref: any; data: any }> = [];
        for (const dateStr of weekendDates) {
            for (const worker of workers) {
                const key = `${worker.Worker_ID}_${dateStr}`;
                if (!existingKeys.has(key)) {
                    const ref = doc(collection(firestore, COLLECTIONS.WORKER_ATTENDANCE));
                    operations.push({
                        ref,
                        data: {
                            Attendance_ID: generateUUID(),
                            Organization_ID: organizationId || '',
                            Worker_ID: worker.Worker_ID,
                            Worker_Name: worker.Name,
                            Date: dateStr,
                            Status: 'Vikend',
                            Created_Date: new Date().toISOString(),
                        }
                    });
                }
            }
        }

        // Commit in chunks of 450 (well under Firestore's 500 limit)
        const CHUNK_SIZE = 450;
        for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
            const chunk = operations.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            chunk.forEach(op => batch.set(op.ref, op.data));
            await batch.commit();
        }

        console.log(`autoPopulateWeekends: Created ${operations.length} records for ${workers.length} workers`);
    } catch (error) {
        console.error('Error auto-populating weekends:', error);
        throw error;
    }
}

/**
 * BACKFILL UTILITY: Create work_logs for all existing attendance records
 * Use this once to fix historical data after enabling automatic work_log creation
 * 
 * @param organizationId - Organization ID
 * @param dateFrom - Start date (YYYY-MM-DD)
 * @param dateTo - End date (YYYY-MM-DD)
 * @returns Summary of created and skipped work logs
 */
export async function backfillWorkLogsFromAttendance(
    organizationId: string,
    dateFrom: string,
    dateTo: string
): Promise<{ totalCreated: number; totalSkipped: number; processedDays: number }> {
    if (!organizationId) {
        throw new Error('organizationId is required');
    }

    console.log(`Starting backfill for organization ${organizationId} from ${dateFrom} to ${dateTo}`);

    const firestore = getDb();
    let totalCreated = 0;
    let totalSkipped = 0;
    let processedDays = 0;

    try {
        // Get all attendance records in the date range
        const attendanceQuery = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            where('Organization_ID', '==', organizationId),
            where('Date', '>=', dateFrom),
            where('Date', '<=', dateTo)
        );
        const attendanceSnap = await getDocs(attendanceQuery);

        // Filter for Prisutan and Teren only
        const validRecords = attendanceSnap.docs
            .map(d => d.data() as WorkerAttendance)
            .filter(a => a.Status === 'Prisutan' || a.Status === 'Teren');

        console.log(`Found ${validRecords.length} attendance records to process`);

        // Get all workers for daily rates
        const workers = await getWorkers(organizationId);
        const workerMap = new Map(workers.map(w => [w.Worker_ID, w]));

        // Group by worker+date for batch processing
        for (const attendance of validRecords) {
            const worker = workerMap.get(attendance.Worker_ID);
            const dailyRate = worker?.Daily_Rate || 0;
            const workerName = attendance.Worker_Name || worker?.Name || 'Unknown';

            const result = await createWorkLogsForAttendance(
                attendance.Worker_ID,
                workerName,
                dailyRate,
                attendance.Date,
                organizationId
            );

            totalCreated += result.created;
            totalSkipped += result.skipped;
            processedDays++;
        }

        console.log(`Backfill complete: ${totalCreated} created, ${totalSkipped} skipped, ${processedDays} days processed`);
        return { totalCreated, totalSkipped, processedDays };
    } catch (error) {
        console.error('Error in backfillWorkLogsFromAttendance:', error);
        throw error;
    }
}

// ============================================
// SIMPLIFIED WORK ORDER MANAGEMENT
// ============================================


/**
 * Assign workers to a Work Order Item
 */
export async function assignWorkersToItem(
    workOrderId: string,
    itemId: string,
    workers: { Worker_ID: string; Worker_Name: string; Daily_Rate: number }[]
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);

        await updateDoc(itemRef, {
            Assigned_Workers: workers
        });

        // Recalculate Work Order aggregates
        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error assigning workers:', error);
        throw error;
    }
}

/**
 * Start a Work Order Item
 */
export async function startWorkOrderItem(
    workOrderId: string,
    itemId: string
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);

        await updateDoc(itemRef, {
            Status: 'U toku',
            Started_At: new Date().toISOString()
        });

        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error starting item:', error);
        throw error;
    }
}

/**
 * Complete a Work Order Item and calculate actual labor cost
 * FIX-3: Also freezes labor cost so backdated attendance won't retroactively change profit
 */
export async function completeWorkOrderItem(
    workOrderId: string,
    itemId: string
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) {
            throw new Error('Item ne postoji');
        }

        const item = itemSnap.data();

        // Calculate actual labor cost — pass Organization_ID for tenant isolation
        const actualLaborCost = await calculateActualLaborCost(item, item.Organization_ID);

        await updateDoc(itemRef, {
            Status: 'Završeno',
            Completed_At: new Date().toISOString(),
            Actual_Labor_Cost: actualLaborCost,
            Labor_Cost_Frozen: true  // FIX-3: Freeze labor cost on completion
        });

        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error completing item:', error);
        throw error;
    }
}

/**
 * Calculate labor cost for a specific sub-task (split group)
 * Considers individual pause periods, worker assignments, and quantity ratio
 * 
 * @param subTask - The sub-task to calculate cost for
 * @param itemQuantity - Total quantity of parent item (for ratio calculation)
 * @param organizationId - Organization ID for filtering
 * @returns Object with laborCost and workingDays
 */
export async function calculateSubTaskLaborCost(
    subTask: any,
    itemQuantity: number,
    organizationId: string,
    parentItemId?: string
): Promise<{ laborCost: number; workingDays: number }> {
    try {
        // If not started, no cost
        if (!subTask.Started_At) {
            return { laborCost: 0, workingDays: 0 };
        }

        // If paused, return existing stored values
        if (subTask.Is_Paused) {
            return {
                laborCost: subTask.Actual_Labor_Cost || 0,
                workingDays: subTask.Working_Days || 0
            };
        }

        const firestore = getDb();

        // Collect worker IDs (main + helpers)
        const workerIds = new Set<string>();
        if (subTask.Worker_ID) {
            workerIds.add(subTask.Worker_ID);
        }
        if (subTask.Helpers && subTask.Helpers.length > 0) {
            subTask.Helpers.forEach((h: { Worker_ID: string }) => {
                if (h.Worker_ID) workerIds.add(h.Worker_ID);
            });
        }

        if (workerIds.size === 0) {
            return { laborCost: 0, workingDays: 0 };
        }

        // Date range
        const startDateStr = subTask.Started_At.split('T')[0];
        const endDateStr = subTask.Completed_At
            ? subTask.Completed_At.split('T')[0]
            : new Date().toISOString().split('T')[0];

        // ═══════════════════════════════════════════════════════════════
        // FIX A1: Use WorkLogs as source of truth (already split rates)
        // Instead of fetching full Daily_Rate from workers collection,
        // we query work_logs which contain the correctly SPLIT rate.
        // This is consistent with calculateActualLaborCost.
        // ═══════════════════════════════════════════════════════════════
        const itemIdForQuery = parentItemId || subTask.Work_Order_Item_ID;

        if (itemIdForQuery) {
            // PRIMARY: Query work_logs for this item + workers + date range
            const logsQuery = query(
                collection(firestore, 'work_logs'),
                where('Work_Order_Item_ID', '==', itemIdForQuery),
                where('Date', '>=', startDateStr),
                where('Date', '<=', endDateStr),
                where('Organization_ID', '==', organizationId)
            );
            const logsSnap = await getDocs(logsQuery);

            if (!logsSnap.empty) {
                let totalCost = 0;
                const uniqueDates = new Set<string>();

                logsSnap.docs.forEach(d => {
                    const data = d.data();
                    // Only count logs for workers assigned to THIS sub-task
                    if (workerIds.has(data.Worker_ID)) {
                        totalCost += (data.Daily_Rate || 0);
                        uniqueDates.add(data.Date);
                    }
                });

                return {
                    laborCost: Math.round(totalCost * 100) / 100,
                    workingDays: uniqueDates.size
                };
            }
        }

        // FALLBACK: No work logs yet — return 0 (consistent with calculateActualLaborCost)
        return { laborCost: 0, workingDays: 0 };
    } catch (error) {
        console.error('Error calculating sub-task labor cost:', error);
        return { laborCost: 0, workingDays: 0 };
    }
}

/**
 * Calculate actual labor cost based on WORK LOGS (single source of truth)
 * 
 * PROFIT-01 FIX: Previously used attendance + full Daily_Rate from workers collection,
 * which caused 2-3x overcount when workers worked on multiple items simultaneously.
 * Now uses work_logs which store the correctly SPLIT daily rate.
 * 
 * This ensures recalculateWorkOrder() and calculateProductProfitability() produce
 * identical results.
 */
export async function calculateActualLaborCost(item: any, organizationId?: string): Promise<number> {
    try {
        const orgId = organizationId || item.Organization_ID || '';
        const firestore = getDb();

        // PRIMARY METHOD: Sum Daily_Rate from work_logs for this item
        // Work logs already contain the correctly split rate (e.g., 80 KM / 3 items = 26.67 per item)
        const logsQueryConstraints = [
            where('Work_Order_Item_ID', '==', item.ID),
        ];
        if (orgId) {
            logsQueryConstraints.push(where('Organization_ID', '==', orgId));
        }
        const logsQuery = query(
            collection(firestore, 'work_logs'),
            ...logsQueryConstraints
        );
        const logsSnap = await getDocs(logsQuery);

        if (!logsSnap.empty) {
            // Work logs exist — use them as the definitive source
            const totalCost = logsSnap.docs.reduce((sum, d) => {
                const data = d.data();
                return sum + (data.Daily_Rate || 0);
            }, 0);
            return Math.round(totalCost * 100) / 100;
        }

        // FALLBACK: No work logs yet (item just started, or attendance not entered)
        // Return 0 — the missing attendance notification (PROFIT-02) will warn the user
        // This is more honest than estimating incorrectly
        return 0;
    } catch (error) {
        console.error('Error calculating actual labor cost:', error);
        return 0;
    }
}

/**
 * Recalculate Work Order aggregates from items
 */
export async function recalculateWorkOrder(workOrderId: string): Promise<void> {
    try {
        const firestore = getDb();
        const workOrder = await getWorkOrderWithItems(workOrderId);

        if (!workOrder || !workOrder.items) return;

        // Aggregate values from items - FETCH FRESH COSTS (material + labor)
        let totalValue = 0;
        let materialCost = 0;
        let transportCost = 0;
        let servicesCost = 0;
        let plannedLaborCost = 0;
        let actualLaborCost = 0;

        let earliestStart: Date | undefined;
        let latestCompletion: Date | undefined;

        // Use for...of to support async material + labor cost fetching
        for (const item of workOrder.items) {
            // BACKFILL: If Product_Value is 0, recover from accepted offer (one-time self-healing)
            let itemValue = item.Product_Value || 0;
            if (itemValue <= 0 && item.Product_ID && item.Project_ID && workOrder.Organization_ID) {
                try {
                    // Find accepted offer for this project
                    const offerQuery = query(
                        collection(firestore, COLLECTIONS.OFFERS),
                        where('Project_ID', '==', item.Project_ID),
                        where('Status', '==', 'Prihvaćeno'),
                        where('Organization_ID', '==', workOrder.Organization_ID)
                    );
                    const offerSnap = await getDocs(offerQuery);
                    if (!offerSnap.empty) {
                        const offerId = offerSnap.docs[0].data().Offer_ID;
                        // Find the offer product matching this item
                        const opQuery = query(
                            collection(firestore, COLLECTIONS.OFFER_PRODUCTS),
                            where('Offer_ID', '==', offerId),
                            where('Product_ID', '==', item.Product_ID),
                            where('Organization_ID', '==', workOrder.Organization_ID)
                        );
                        const opSnap = await getDocs(opQuery);
                        if (!opSnap.empty) {
                            const sellingPrice = opSnap.docs[0].data().Selling_Price || 0;
                            if (sellingPrice > 0) {
                                itemValue = sellingPrice * (item.Quantity || 1);
                                // Write back to WO item so this only runs once
                                try {
                                    const itemRef = doc(firestore, COLLECTIONS.WORK_ORDER_ITEMS, item.ID);
                                    await updateDoc(itemRef, { Product_Value: itemValue });
                                    console.log(`Backfilled Product_Value=${itemValue} for item ${item.Product_Name} from offer`);
                                } catch (writeErr) {
                                    console.warn('Failed to persist backfilled Product_Value:', writeErr);
                                }
                            }
                        }
                    }
                } catch (backfillErr) {
                    console.warn('Product_Value backfill failed (non-critical):', backfillErr);
                }
            }
            totalValue += itemValue;

            // PROFIT-09 FIX: For completed items, use FROZEN material cost (don't re-fetch)
            // This prevents retroactive profit changes when material prices change after completion.
            // Active items still get fresh prices so profit is accurate during production.
            // PRICE-MODAL FIX: If Material_Cost was manually set (Material_Cost_Source === 'manual'),
            // preserve the stored value — user explicitly entered this price.
            let itemMaterialCost = 0;
            if (item.Status === 'Završeno' && (item.Material_Cost || 0) > 0) {
                // Completed: use stored/frozen cost
                itemMaterialCost = item.Material_Cost || 0;
            } else if ((item as any).Material_Cost_Source === 'manual' && (item.Material_Cost || 0) > 0) {
                // Manually set via PriceEditModal: preserve user's value
                itemMaterialCost = item.Material_Cost || 0;
            } else if (item.Product_ID && workOrder.Organization_ID) {
                // Active: fetch fresh material costs
                const materials = await getProductMaterials(item.Product_ID, workOrder.Organization_ID);
                itemMaterialCost = materials.reduce((sum, m) => sum + (m.Total_Price || 0), 0);
            } else {
                // Fallback to stored value if no Product_ID
                itemMaterialCost = item.Material_Cost || 0;
            }
            materialCost += itemMaterialCost;

            // Include Transport and Services in profit calculation (best practice)
            transportCost += item.Transport_Share || 0;
            servicesCost += item.Services_Total || 0;

            plannedLaborCost += item.Planned_Labor_Cost || 0;

            // CRITICAL FIX: Calculate FRESH labor cost instead of using stale stored value
            // FIX-3: For COMPLETED items with frozen labor, use stored value (consistent with material freeze)
            let freshItemLaborCost: number;
            if (item.Status === 'Završeno' && (item as any).Labor_Cost_Frozen === true && (item.Actual_Labor_Cost || 0) > 0) {
                freshItemLaborCost = item.Actual_Labor_Cost || 0;
            } else {
                freshItemLaborCost = await calculateActualLaborCost(item, workOrder.Organization_ID);
            }
            actualLaborCost += freshItemLaborCost;

            // SYNC: Update item-level Material_Cost and Actual_Labor_Cost for consistency
            try {
                const itemRef = doc(firestore, COLLECTIONS.WORK_ORDER_ITEMS, item.ID);
                await updateDoc(itemRef, {
                    Material_Cost: itemMaterialCost,
                    Actual_Labor_Cost: freshItemLaborCost
                });
            } catch (syncErr) {
                console.warn(`Failed to sync costs on item ${item.ID}:`, syncErr);
            }


            if (item.Started_At) {
                const start = new Date(item.Started_At);
                if (!earliestStart || start < earliestStart) earliestStart = start;
            }

            if (item.Completed_At) {
                const comp = new Date(item.Completed_At);
                if (!latestCompletion || comp > latestCompletion) latestCompletion = comp;
            }
        }

        // SAFETY CHECK: If calculated total is 0 but existing WO has value, preserve it (Legacy Data Protection)
        // Skip for Montaža WOs which intentionally carry 0 Total_Value
        if (totalValue === 0 && (workOrder.Total_Value || 0) > 0 && workOrder.Work_Order_Type !== 'Montaža') {
            totalValue = workOrder.Total_Value || 0;
        }

        // STANDARDIZED PROFIT FORMULA (consistent with calculateProductProfitability)
        // Gross Profit = Selling - Material - Transport - Services
        // Net Profit = Gross - Labor
        const grossProfit = totalValue - materialCost - transportCost - servicesCost;
        const profit = grossProfit - actualLaborCost; // This is Net Profit
        const profitMargin = totalValue > 0 ? (profit / totalValue) * 100 : 0;
        const laborCostVariance = plannedLaborCost - actualLaborCost;

        // Determine overall status
        let status: 'Na čekanju' | 'U toku' | 'Završeno' = 'Na čekanju';
        const allCompleted = workOrder.items.every((i: any) => i.Status === 'Završeno');
        const anyInProgress = workOrder.items.some((i: any) => i.Status === 'U toku');

        if (allCompleted) status = 'Završeno';
        else if (anyInProgress) status = 'U toku';

        // Use _docId from queryied work order (not the Work_Order_ID field)
        const docId = (workOrder as any)._docId;
        if (!docId) {
            console.error('recalculateWorkOrder: No _docId found on work order');
            return;
        }

        await updateDoc(doc(firestore, COLLECTIONS.WORK_ORDERS, docId), {
            Status: status,
            Started_At: earliestStart?.toISOString() || null,
            Completed_At: latestCompletion?.toISOString() || null,
            Total_Value: totalValue,
            Material_Cost: materialCost,
            Planned_Labor_Cost: plannedLaborCost,
            Actual_Labor_Cost: actualLaborCost,
            Labor_Cost: actualLaborCost, // Legacy field
            Profit: profit,
            Profit_Margin: profitMargin,
            Labor_Cost_Variance: laborCostVariance
        });

        // AI TRAINING: Create production snapshot when work order is completed
        if (status === 'Završeno' && workOrder.Organization_ID) {
            try {
                await createProductionSnapshot(workOrderId, workOrder.Organization_ID);
                console.log(`[AI Training] Production snapshot created for WorkOrder ${workOrderId}`);
            } catch (snapshotError) {
                console.error('[AI Training] Failed to create production snapshot:', snapshotError);
                // Don't throw - snapshot failure shouldn't block work order completion
            }
        }

        // SYNC: Update product statuses in projects
        await syncProductStatuses(workOrder.items);

        // SYNC: Update project status based on product statuses
        // Collect unique project IDs from work order items
        const projectIds = new Set<string>();
        for (const item of workOrder.items) {
            if (item.Project_ID) projectIds.add(item.Project_ID);
        }
        for (const projectId of Array.from(projectIds)) {
            await syncProjectStatus(projectId);
        }
    } catch (error) {
        console.error('Error recalculating work order:', error);
        throw error;
    }
}

/**
 * Recalculate ALL active work orders for an organization.
 * Used after bulk attendance updates to avoid per-worker recalculation overhead.
 */
export async function recalculateAllActiveWorkOrders(organizationId: string): Promise<void> {
    try {
        const firestore = getDb();
        const woQuery = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Status', '==', 'U toku'),
            where('Organization_ID', '==', organizationId)
        );
        const woSnap = await getDocs(woQuery);

        // Recalculate each active WO (sequential to avoid Firestore contention)
        for (const woDoc of woSnap.docs) {
            const woId = woDoc.data().Work_Order_ID;
            try {
                await recalculateWorkOrder(woId);
            } catch (err) {
                console.warn(`Failed to recalculate WO ${woId}:`, err);
            }
        }
        console.log(`Batch recalculation: ${woSnap.size} active work orders recalculated`);
    } catch (error) {
        console.error('Error in batch recalculation:', error);
    }
}

/**
 * Sync product statuses in projects based on work order item statuses
 */
async function syncProductStatuses(items: any[]): Promise<void> {
    console.log('=== syncProductStatuses START ===');
    console.log('Items received:', items.length);

    // Status hierarchy — higher index = more advanced in lifecycle
    // CRITICAL: syncProductStatuses must NEVER regress a product to a lower status
    const STATUS_HIERARCHY = [
        'Na čekanju', 'Materijali naručeni', 'Materijali spremni',
        'Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje', 'Spremno',
        'Transport', 'Montaža', 'Čišćenje', 'Primopredaja', 'Instalirano'
    ];

    // Map: last completed process → final product status
    const FINAL_STATUS_MAP: Record<string, string> = {
        'Sklapanje': 'Spremno',
        'Primopredaja': 'Instalirano',
    };

    try {
        const firestore = getDb();

        // Group items by project
        const projectUpdates = new Map<string, Map<string, string>>();

        for (const item of items) {
            console.log(`Item: ${item.Product_Name || 'unknown'}, Project_ID: ${item.Project_ID}, Product_ID: ${item.Product_ID}, Status: ${item.Status}`);

            if (!item.Project_ID || !item.Product_ID) {
                console.warn('  -> SKIPPED: Missing Project_ID or Product_ID');
                continue;
            }

            if (!projectUpdates.has(item.Project_ID)) {
                projectUpdates.set(item.Project_ID, new Map());
            }

            // Determine product status based on work order item processes
            let productStatus = 'Na čekanju';
            if (item.Status === 'Završeno') {
                // Check the LAST process name to determine final product status
                const lastProcess = item.Processes?.[item.Processes.length - 1];
                const lastProcessName = lastProcess?.Process_Name || '';
                productStatus = FINAL_STATUS_MAP[lastProcessName] || 'Spremno';
            } else if (item.Status === 'U toku') {
                // Find the active (U toku) process for intermediate status
                const activeProcess = item.Processes?.find((p: any) => p.Status === 'U toku');
                if (activeProcess) {
                    productStatus = activeProcess.Process_Name;
                } else {
                    // All prior completed, find first waiting process
                    const nextWaiting = item.Processes?.find((p: any) => p.Status === 'Na čekanju');
                    if (nextWaiting) {
                        // Product is at the last completed process stage
                        const lastCompleted = [...(item.Processes || [])].reverse().find((p: any) => p.Status === 'Završeno');
                        productStatus = lastCompleted?.Process_Name || 'Sklapanje';
                    } else {
                        productStatus = 'Sklapanje';
                    }
                }
            }

            console.log(`  -> Mapped status: "${item.Status}" => "${productStatus}"`);
            projectUpdates.get(item.Project_ID)!.set(item.Product_ID, productStatus);
        }

        console.log('Projects to update:', projectUpdates.size);

        // Update products in separate 'products' collection (NOT embedded in project)
        const entries = Array.from(projectUpdates.entries());
        for (const [projectId, productStatuses] of entries) {
            console.log(`\nProcessing Project: ${projectId}`);

            // Products are in a SEPARATE collection - query them directly!
            const productsQuery = query(
                collection(firestore, 'products'),
                where('Project_ID', '==', projectId)
            );
            const productsSnap = await getDocs(productsQuery);

            console.log(`  -> Products in 'products' collection for this project: ${productsSnap.docs.length}`);

            if (productsSnap.empty) {
                console.warn(`  -> No products found in products collection for project ${projectId}`);
                continue;
            }

            // Update each product document — NEVER REGRESS status
            let updatedCount = 0;
            for (const productDoc of productsSnap.docs) {
                const productData = productDoc.data();
                const newStatus = productStatuses.get(productData.Product_ID);

                if (!newStatus) continue;

                const currentRank = STATUS_HIERARCHY.indexOf(productData.Status || '');
                const newRank = STATUS_HIERARCHY.indexOf(newStatus);

                // Only update if new status is HIGHER in hierarchy (never regress)
                if (newRank > currentRank) {
                    console.log(`    -> Updating product "${productData.Name || productData.Product_ID}": "${productData.Status}" => "${newStatus}"`);
                    await updateDoc(productDoc.ref, { Status: newStatus });
                    updatedCount++;
                } else if (newStatus !== productData.Status) {
                    console.log(`    -> SKIPPED regression for "${productData.Name || productData.Product_ID}": "${productData.Status}" => "${newStatus}" (would be regression)`);
                }
            }

            console.log(`  -> Products updated: ${updatedCount}`);
        }

        console.log('=== syncProductStatuses END ===');
    } catch (error) {
        console.error('Error syncing product statuses:', error);
        // Don't throw - this is a secondary operation
    }
}

/**
 * Sync project status based on products and work orders
 * - 'U proizvodnji' if any product is in active production or montaža
 * - 'Završeno' if ALL products are truly complete (Instalirano, or Spremno with no pending montaža)
 */
export async function syncProjectStatus(projectId: string, organizationId?: string): Promise<void> {
    try {
        const firestore = getDb();

        // Get project - optionally filter by organizationId if provided
        const projectQuery = organizationId
            ? query(
                collection(firestore, 'projects'),
                where('Project_ID', '==', projectId),
                where('Organization_ID', '==', organizationId)
            )
            : query(
                collection(firestore, 'projects'),
                where('Project_ID', '==', projectId)
            );
        const projectSnap = await getDocs(projectQuery);

        if (projectSnap.empty) return;

        const projectDoc = projectSnap.docs[0];
        const project = projectDoc.data();

        // Skip if project is in early stages or cancelled
        if (['Nacrt', 'Ponuđeno', 'Otkazano'].includes(project.Status)) {
            return;
        }

        // Get all products for this project
        const productsQuery = organizationId
            ? query(
                collection(firestore, 'products'),
                where('Project_ID', '==', projectId),
                where('Organization_ID', '==', organizationId)
            )
            : query(
                collection(firestore, 'products'),
                where('Project_ID', '==', projectId)
            );
        const productsSnap = await getDocs(productsQuery);

        if (productsSnap.empty) return;

        const products = productsSnap.docs.map(d => d.data());

        // Check for active montaža WOs that reference products in this project
        // This prevents premature "Završeno" when products are Spremno but montaža is pending
        let montazaProductIds = new Set<string>();
        try {
            const montazaWoQuery = query(
                collection(firestore, COLLECTIONS.WORK_ORDERS),
                where('Work_Order_Type', '==', 'Montaža'),
                where('Status', 'in', ['Na čekanju', 'U toku'])
            );
            const montazaSnap = await getDocs(montazaWoQuery);
            for (const mDoc of montazaSnap.docs) {
                const mData = mDoc.data();
                // Query work order items for this montaža WO
                const itemsQuery = query(
                    collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                    where('Work_Order_ID', '==', mData.Work_Order_ID),
                    where('Project_ID', '==', projectId)
                );
                const itemsSnap = await getDocs(itemsQuery);
                itemsSnap.docs.forEach(d => {
                    const itemData = d.data();
                    if (itemData.Product_ID) montazaProductIds.add(itemData.Product_ID);
                });
            }
        } catch (err) {
            console.warn('syncProjectStatus: Error checking montaža WOs:', err);
        }

        // Statuses
        const waitingStatuses = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'];
        const montazaActiveStatuses = ['Transport', 'Montaža', 'Čišćenje', 'Primopredaja'];

        // Per-product completion check
        const allComplete = products.every(p => {
            const status = p.Status || '';
            // Products in active montaža WOs: only 'Instalirano' is truly complete
            if (montazaProductIds.has(p.Product_ID || '')) {
                return status === 'Instalirano';
            }
            // Products NOT in montaža: Spremno or Instalirano is complete
            return status === 'Spremno' || status === 'Instalirano';
        });

        // Any product actively in production or montaža?
        const anyInProduction = products.some(p => {
            const status = p.Status || '';
            return !waitingStatuses.includes(status)
                && status !== 'Spremno'
                && status !== 'Instalirano'
                || montazaActiveStatuses.includes(status);
        });

        let newStatus = project.Status;

        if (allComplete && project.Status !== 'Završeno') {
            newStatus = 'Završeno';
        } else if (anyInProduction && project.Status === 'Odobreno') {
            newStatus = 'U proizvodnji';
        }

        if (newStatus !== project.Status) {
            console.log(`syncProjectStatus: ${projectId} "${project.Status}" => "${newStatus}"`);
            await updateDoc(projectDoc.ref, { Status: newStatus });
        }
    } catch (error) {
        console.error('Error syncing project status:', error);
    }
}

/**
 * One-time repair function to sync ALL product statuses from work orders to projects.
 * Use this to fix historical data that was never properly synced.
 */
export async function repairAllProductStatuses(): Promise<{ success: boolean; message: string; count: number }> {
    try {
        const firestore = getDb();

        // Get all work orders
        const woSnap = await getDocs(collection(firestore, COLLECTIONS.WORK_ORDERS));

        let repairedCount = 0;
        let fixedItemsCount = 0;

        for (const woDoc of woSnap.docs) {
            const workOrderId = woDoc.id;
            const workOrder = await getWorkOrderWithItems(workOrderId);

            if (workOrder && workOrder.items && workOrder.items.length > 0) {
                // DEEP REPAIR: Check if any item status/dates are inconsistent with its processes

                for (const item of workOrder.items) {
                    const updates: any = {};
                    let needsUpdate = false;

                    // Check legacy processes structure
                    if (item.Processes && Array.isArray(item.Processes) && item.Processes.length > 0) {
                        const allCompleted = item.Processes.every((p: any) => p.Status === 'Završeno');

                        // 1. Fix Status
                        if (allCompleted && item.Status !== 'Završeno') {
                            updates.Status = 'Završeno';
                            needsUpdate = true;
                        }

                        // 2. Fix Started_At if missing
                        if (!item.Started_At) {
                            const firstStarted = item.Processes
                                .filter((p: any) => p.Started_At)
                                .sort((a: any, b: any) => new Date(a.Started_At).getTime() - new Date(b.Started_At).getTime())[0];
                            if (firstStarted) {
                                updates.Started_At = firstStarted.Started_At;
                                needsUpdate = true;
                            }
                        }

                        // 3. Fix Completed_At
                        if (allCompleted && !item.Completed_At) {
                            const lastCompleted = item.Processes
                                .filter((p: any) => p.Completed_At)
                                .sort((a: any, b: any) => new Date(b.Completed_At).getTime() - new Date(a.Completed_At).getTime())[0];

                            updates.Completed_At = lastCompleted ? lastCompleted.Completed_At : new Date().toISOString();
                            needsUpdate = true;
                        } else if ((updates.Status === 'Završeno' || item.Status === 'Završeno') && !item.Completed_At) {
                            updates.Completed_At = new Date().toISOString();
                            needsUpdate = true;
                        }

                        // Apply updates if needed
                        if (needsUpdate) {
                            try {
                                const itemRef = doc(firestore, COLLECTIONS.WORK_ORDER_ITEMS, item.ID);
                                await updateDoc(itemRef, updates);

                                // Update local object
                                Object.assign(item, updates);
                                fixedItemsCount++;
                            } catch (e) {
                                console.error(`Failed to fix item ${item.ID}`, e);
                            }
                        }
                    }
                }

                // Sync product statuses for this work order
                await syncProductStatuses(workOrder.items);

                // CRITICAL: Recalculate Work Order to update main Status and Dates based on fixed items
                await recalculateWorkOrder(workOrderId);

                repairedCount += workOrder.items.length;
            }
        }

        return {
            success: true,
            message: `Sinkronizirano ${repairedCount} proizvoda (popravljeno ${fixedItemsCount} stavki)`,
            count: repairedCount
        };
    } catch (error) {
        console.error('Error repairing product statuses:', error);
        return {
            success: false,
            message: 'Greška pri sinkronizaciji statusa',
            count: 0
        };
    }
}

/**
 * Get Work Order with all its items (helper function)
 */
async function getWorkOrderWithItems(workOrderId: string): Promise<WorkOrder | null> {
    const firestore = getDb();

    // Query by Work_Order_ID field (not doc ID) for consistency
    const woQuery = query(
        collection(firestore, COLLECTIONS.WORK_ORDERS),
        where('Work_Order_ID', '==', workOrderId)
    );
    const woSnap = await getDocs(woQuery);

    if (woSnap.empty) return null;

    const woDoc = woSnap.docs[0];
    const data = woDoc.data();

    // IMPORTANT: Keep doc ID as the main identifier for updates
    const workOrder = { ...data, _docId: woDoc.id } as WorkOrder & { _docId: string };

    // Get items from root collection using the Work_Order_ID
    const itemsQuery = query(
        collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
        where('Work_Order_ID', '==', workOrderId)
    );
    const itemsSnap = await getDocs(itemsQuery);

    workOrder.items = itemsSnap.docs.map(doc => ({
        ...doc.data(),
        ID: doc.id
    })) as any[];

    return workOrder;
}

// ============================================
// PROCESS MANAGEMENT FUNCTIONS
// ============================================

import type { ItemProcessStatus } from './types';

/**
 * Update ALL processes for a work order item in a single write (FAST)
 * Used for drag-and-drop stage changes
 */
export async function updateAllItemProcesses(
    workOrderId: string,
    itemId: string,
    newProcesses: ItemProcessStatus[]
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);

        // Sanitize all processes - remove undefined fields
        const sanitizedProcesses = newProcesses.map(p => {
            const sanitized = { ...p };
            Object.keys(sanitized).forEach(key =>
                (sanitized as any)[key] === undefined && delete (sanitized as any)[key]
            );
            return sanitized;
        });

        // Single write for all processes
        await updateDoc(itemRef, { Processes: sanitizedProcesses });

        // Recalculate item and work order status
        await recalculateItemStatus(workOrderId, itemId, sanitizedProcesses);
        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error updating all item processes:', error);
        throw error;
    }
}

/**
 * Update a single process for a work order item
 */
export async function updateItemProcess(
    workOrderId: string,
    itemId: string,
    processName: string,
    updates: Partial<ItemProcessStatus>
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) {
            throw new Error('Item ne postoji');
        }

        const item = itemSnap.data();
        const processes: ItemProcessStatus[] = item.Processes || [];

        // Find and update the process
        const processIndex = processes.findIndex(p => p.Process_Name === processName);
        if (processIndex >= 0) {
            const updatedProcess = { ...processes[processIndex], ...updates };
            // Remove undefined fields to prevent Firestore errors
            Object.keys(updatedProcess).forEach(key =>
                (updatedProcess as any)[key] === undefined && delete (updatedProcess as any)[key]
            );
            processes[processIndex] = updatedProcess;
        } else {
            // Add new process if it doesn't exist
            const newProcess = {
                Process_Name: processName,
                Status: 'Na čekanju',
                ...updates
            } as ItemProcessStatus;

            // Remove undefined fields
            Object.keys(newProcess).forEach(key =>
                (newProcess as any)[key] === undefined && delete (newProcess as any)[key]
            );

            processes.push(newProcess);
        }

        // Calculate duration if completing
        if (updates.Status === 'Završeno' && processes[processIndex]?.Started_At) {
            const start = new Date(processes[processIndex].Started_At!).getTime();
            const end = updates.Completed_At ? new Date(updates.Completed_At).getTime() : Date.now();
            processes[processIndex].Duration_Minutes = Math.round((end - start) / 60000);
        }

        await updateDoc(itemRef, { Processes: processes });

        // Recalculate item status based on process statuses
        await recalculateItemStatus(workOrderId, itemId, processes);
        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error updating item process:', error);
        throw error;
    }
}

/**
 * Bulk update processes for multiple items
 */
export async function bulkUpdateProcesses(
    workOrderId: string,
    itemIds: string[],
    processName: string | 'all',
    updates: Partial<ItemProcessStatus>
): Promise<void> {
    try {
        const firestore = getDb();
        const batch = writeBatch(firestore);

        for (const itemId of itemIds) {
            let itemRef;
            try {
                itemRef = await getItemRef(itemId);
            } catch (e) {
                // Item not found, skip
                continue;
            }

            const itemSnap = await getDoc(itemRef);
            if (!itemSnap.exists()) continue;

            const item = itemSnap.data();
            const processes: ItemProcessStatus[] = item.Processes || [];

            if (processName === 'all') {
                // Update all processes
                processes.forEach((p, idx) => {
                    processes[idx] = { ...p, ...updates };
                    if (updates.Status === 'U toku' && !p.Started_At) {
                        processes[idx].Started_At = new Date().toISOString();
                    }
                    if (updates.Status === 'Završeno' && !p.Completed_At) {
                        processes[idx].Completed_At = new Date().toISOString();
                    }
                });
            } else {
                // Update specific process
                const processIndex = processes.findIndex(p => p.Process_Name === processName);
                if (processIndex >= 0) {
                    processes[processIndex] = { ...processes[processIndex], ...updates };
                    if (updates.Status === 'U toku' && !processes[processIndex].Started_At) {
                        processes[processIndex].Started_At = new Date().toISOString();
                    }
                    if (updates.Status === 'Završeno' && !processes[processIndex].Completed_At) {
                        processes[processIndex].Completed_At = new Date().toISOString();
                    }
                }
            }

            batch.update(itemRef, { Processes: processes });
        }

        await batch.commit();
        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error bulk updating processes:', error);
        throw error;
    }
}

/**
 * Add a new process to specified items
 */
export async function addProcessToItems(
    workOrderId: string,
    itemIds: string[],
    processName: string
): Promise<void> {
    try {
        const firestore = getDb();
        const batch = writeBatch(firestore);

        for (const itemId of itemIds) {
            let itemRef;
            try {
                itemRef = await getItemRef(itemId);
            } catch (e) {
                continue;
            }

            const itemSnap = await getDoc(itemRef);

            if (!itemSnap.exists()) continue;

            const item = itemSnap.data();
            const processes: ItemProcessStatus[] = item.Processes || [];

            // Check if process already exists
            if (!processes.some(p => p.Process_Name === processName)) {
                processes.push({
                    Process_Name: processName,
                    Status: 'Na čekanju'
                });
                batch.update(itemRef, { Processes: processes });
            }
        }

        await batch.commit();
    } catch (error) {
        console.error('Error adding process to items:', error);
        throw error;
    }
}

/**
 * Initialize processes for an item based on work order's Production_Steps
 */
export async function initializeItemProcesses(
    workOrderId: string,
    itemId: string,
    productionSteps: string[]
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);

        const processes: ItemProcessStatus[] = productionSteps.map(step => ({
            Process_Name: step,
            Status: 'Na čekanju'
        }));

        await updateDoc(itemRef, { Processes: processes });
    } catch (error) {
        console.error('Error initializing item processes:', error);
        throw error;
    }
}

/**
 * Recalculate item status based on its processes
 */
async function recalculateItemStatus(
    workOrderId: string,
    itemId: string,
    processes: ItemProcessStatus[]
): Promise<void> {
    try {
        // Note: workOrderId is kept for compatibility but not strictly needed for finding item by ID
        const itemRef = await getItemRef(itemId);

        const allCompleted = processes.every(p => p.Status === 'Završeno');
        const anyInProgress = processes.some(p => p.Status === 'U toku');

        let status: 'Na čekanju' | 'U toku' | 'Završeno' = 'Na čekanju';
        if (allCompleted) status = 'Završeno';
        else if (anyInProgress) status = 'U toku';

        const updates: any = { Status: status };

        // Set Started_At if first process started
        const firstStarted = processes.find(p => p.Started_At);
        if (firstStarted && !updates.Started_At) {
            updates.Started_At = firstStarted.Started_At;
        }

        // Set Completed_At if all completed
        if (allCompleted) {
            const lastCompleted = processes
                .filter(p => p.Completed_At)
                .sort((a, b) => new Date(b.Completed_At!).getTime() - new Date(a.Completed_At!).getTime())[0];
            if (lastCompleted) {
                updates.Completed_At = lastCompleted.Completed_At;
            }
        }

        await updateDoc(itemRef, updates);
    } catch (error) {
        console.error('Error recalculating item status:', error);
        throw error;
    }
}

// ============================================
// SUB-TASK MANAGEMENT FUNCTIONS
// ============================================

import type { SubTask } from './types';

/**
 * Create sub-tasks for an item (split functionality)
 * This replaces the item's Processes with SubTasks
 */
export async function createSubTasks(
    workOrderId: string,
    itemId: string,
    subTasks: SubTask[]
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);

        // Clear legacy Processes and set SubTasks
        const sanitizedSubTasks = JSON.parse(JSON.stringify(subTasks));
        await updateDoc(itemRef, {
            SubTasks: sanitizedSubTasks,
            // Keep Processes for reference but mark as migrated
        });

        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error creating sub-tasks:', error);
        throw error;
    }
}

/**
 * Update a single sub-task
 */
export async function updateSubTask(
    workOrderId: string,
    itemId: string,
    subTaskId: string,
    updates: Partial<SubTask>
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) throw new Error('Item not found');

        const data = itemSnap.data();
        const subTasks = (data.SubTasks || []) as SubTask[];

        const updatedSubTasks = subTasks.map(st =>
            st.SubTask_ID === subTaskId ? { ...st, ...updates } : st
        );

        // If status changed to 'U toku', set Started_At
        const updatedSubTask = updatedSubTasks.find(st => st.SubTask_ID === subTaskId);
        if (updatedSubTask && updates.Status === 'U toku' && !updatedSubTask.Started_At) {
            updatedSubTask.Started_At = new Date().toISOString();
        }
        // If status changed to 'Završeno', set Completed_At
        if (updatedSubTask && updates.Status === 'Završeno' && !updatedSubTask.Completed_At) {
            updatedSubTask.Completed_At = new Date().toISOString();
        }

        const sanitizedSubTasks = JSON.parse(JSON.stringify(updatedSubTasks));
        await updateDoc(itemRef, { SubTasks: sanitizedSubTasks });

        // Recalculate item status based on sub-tasks
        await recalculateItemStatusFromSubTasks(workOrderId, itemId, updatedSubTasks);
        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error updating sub-task:', error);
        throw error;
    }
}

/**
 * Move a sub-task to a different process stage
 */
export async function moveSubTask(
    workOrderId: string,
    itemId: string,
    subTaskId: string,
    targetProcess: string
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) throw new Error('Item not found');

        const data = itemSnap.data();
        const subTasks = (data.SubTasks || []) as SubTask[];

        const updatedSubTasks = subTasks.map(st => {
            if (st.SubTask_ID !== subTaskId) return st;

            const isCompleted = targetProcess === 'ZAVRŠENO';

            const updatedSubTask: SubTask = {
                ...st,
                Current_Process: isCompleted ? st.Current_Process : targetProcess,
                Status: isCompleted ? 'Završeno' as const : 'U toku' as const,
                Started_At: st.Started_At || new Date().toISOString()
            };

            if (isCompleted) {
                updatedSubTask.Completed_At = new Date().toISOString();
            } else {
                // If moving back from completion, remove Completed_At
                delete updatedSubTask.Completed_At;
            }

            return updatedSubTask;
        });

        // Auto-merge: If all sub-tasks are now on the same process, merge them
        const allOnSameProcess = updatedSubTasks.length > 1 &&
            updatedSubTasks.every(st => st.Current_Process === updatedSubTasks[0].Current_Process && st.Status !== 'Završeno');

        let finalSubTasks = updatedSubTasks;
        if (allOnSameProcess) {
            // Merge all sub-tasks into one — PRESERVE worker data (Fix A2)
            const totalQuantity = updatedSubTasks.reduce((sum, st) => sum + st.Quantity, 0);
            const sourceWithWorker = updatedSubTasks.find(st => st.Worker_ID);
            const sourceWithHelpers = updatedSubTasks.find(st => st.Helpers?.length);
            const allPausePeriods = updatedSubTasks.flatMap(st => st.Pause_Periods || []);

            finalSubTasks = [{
                SubTask_ID: `st-merged-${Date.now()}`,
                Quantity: totalQuantity,
                Current_Process: updatedSubTasks[0].Current_Process,
                Status: updatedSubTasks[0].Status,
                Started_At: updatedSubTasks.find(st => st.Started_At)?.Started_At,
                Worker_ID: sourceWithWorker?.Worker_ID,
                Worker_Name: sourceWithWorker?.Worker_Name,
                Helpers: sourceWithHelpers?.Helpers || [],
                ...(allPausePeriods.length > 0 ? { Pause_Periods: allPausePeriods } : {}),
            }];
            console.log('Auto-merged sub-tasks into one:', totalQuantity, 'worker:', sourceWithWorker?.Worker_Name || 'none');
        }

        const sanitizedSubTasks = JSON.parse(JSON.stringify(finalSubTasks));
        await updateDoc(itemRef, { SubTasks: sanitizedSubTasks });

        await recalculateItemStatusFromSubTasks(workOrderId, itemId, finalSubTasks);
        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error moving sub-task:', error);
        throw error;
    }
}

/**
 * Recalculate item status based on its sub-tasks
 */
async function recalculateItemStatusFromSubTasks(
    workOrderId: string,
    itemId: string,
    subTasks: SubTask[]
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);

        const allCompleted = subTasks.every(st => st.Status === 'Završeno');
        const anyInProgress = subTasks.some(st => st.Status === 'U toku');

        let status: 'Na čekanju' | 'U toku' | 'Završeno' = 'Na čekanju';
        if (allCompleted) status = 'Završeno';
        else if (anyInProgress) status = 'U toku';

        const updates: any = { Status: status };

        // Set timestamps
        const firstStarted = subTasks.find(st => st.Started_At);
        if (firstStarted) {
            updates.Started_At = firstStarted.Started_At;
        }

        if (allCompleted) {
            const lastCompleted = subTasks
                .filter(st => st.Completed_At)
                .sort((a, b) => new Date(b.Completed_At!).getTime() - new Date(a.Completed_At!).getTime())[0];
            if (lastCompleted) {
                updates.Completed_At = lastCompleted.Completed_At;
            }
        }

        await updateDoc(itemRef, updates);
    } catch (error) {
        console.error('Error recalculating item status from sub-tasks:', error);
        throw error;
    }
}

/**
 * Comprehensive data sync — backfills missing work logs from attendance history
 * and recalculates all active work orders. Call this after code fixes or data corrections.
 */
export async function syncAllProjectData(
    organizationId: string,
    onProgress?: (msg: string) => void
): Promise<{ workLogsCreated: number; workOrdersRecalculated: number }> {
    if (!organizationId) throw new Error('Organization ID required');
    const log = (msg: string) => { console.log(`[SYNC] ${msg}`); onProgress?.(msg); };

    let workLogsCreated = 0;
    let workOrdersRecalculated = 0;

    // Step 1: Get all active/completed work orders with their items
    log('Učitavanje radnih naloga...');
    const woSnap = await getDocs(query(
        collection(db, COLLECTIONS.WORK_ORDERS),
        where('Organization_ID', '==', organizationId),
        where('Status', 'in', ['U toku', 'Završeno'])
    ));
    const woItemsSnap = await getDocs(query(
        collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
        where('Organization_ID', '==', organizationId)
    ));
    const allItems = woItemsSnap.docs.map(d => d.data() as WorkOrderItem);

    const workOrders = woSnap.docs.map(d => {
        const wo = d.data() as WorkOrder;
        wo.items = allItems.filter(i => i.Work_Order_ID === wo.Work_Order_ID);
        return wo;
    });

    if (workOrders.length === 0) {
        log('Nema aktivnih naloga');
        return { workLogsCreated: 0, workOrdersRecalculated: 0 };
    }

    // Step 2: Get ALL attendance records for the org
    log('Učitavanje evidencije prisustva...');
    const attSnap = await getDocs(query(
        collection(db, COLLECTIONS.WORKER_ATTENDANCE),
        where('Organization_ID', '==', organizationId),
        where('Status', 'in', ['Prisutan', 'Teren'])
    ));

    // Build attendance map: date -> worker[]
    const attendanceByDate = new Map<string, Array<{ Worker_ID: string; Worker_Name: string }>>();
    attSnap.docs.forEach(d => {
        const att = d.data();
        const date = att.Date;
        if (!attendanceByDate.has(date)) attendanceByDate.set(date, []);
        attendanceByDate.get(date)!.push({
            Worker_ID: att.Worker_ID,
            Worker_Name: att.Worker_Name || att.Worker_ID
        });
    });

    // Step 3: Get workers for daily rates
    log('Učitavanje radnika...');
    const workers = await getWorkers(organizationId);
    const workerMap = new Map(workers.map(w => [w.Worker_ID, w]));

    // Step 4: For each active WO, backfill missing work logs for present workers
    // KEY FIX: If workers are NOT specifically assigned to items, distribute ALL present
    // workers across ALL active items in the WO (matching real-world usage)
    log(`Sinkronizacija ${workOrders.length} naloga...`);
    for (const wo of workOrders) {
        const woStartDate = wo.Started_At
            ? new Date(wo.Started_At).toISOString().split('T')[0]
            : wo.Created_Date
                ? new Date(wo.Created_Date).toISOString().split('T')[0]
                : null;
        if (!woStartDate) continue;

        // AUTO-FIX: If WO is active but has no Started_At, set it from Created_Date
        if (!wo.Started_At && wo.Created_Date) {
            try {
                const firestore = getDb();
                const woQuery = query(
                    collection(firestore, 'work_orders'),
                    where('Work_Order_ID', '==', wo.Work_Order_ID),
                    where('Organization_ID', '==', organizationId)
                );
                const woSnap = await getDocs(woQuery);
                if (!woSnap.empty) {
                    await updateDoc(woSnap.docs[0].ref, { Started_At: wo.Created_Date });
                    log(`Auto-set Started_At=${wo.Created_Date} on WO ${wo.Work_Order_Number}`);
                }
            } catch (e) {
                console.warn('Failed to auto-set Started_At:', e);
            }
        }

        // Get active items (not paused)
        const activeItems = (wo.items || []).filter(item => !item.Is_Paused);
        if (activeItems.length === 0) continue;

        // Check if ANY item in this WO has explicit worker assignments
        const hasAnyAssignment = activeItems.some(it =>
            ((it.Assigned_Workers || []).length > 0) ||
            ((it.Processes || []).some((p: any) => p.Worker_ID))
        );

        // Check each date with attendance
        for (const [date, presentWorkers] of Array.from(attendanceByDate.entries())) {
            if (date < woStartDate) continue;

            for (const attWorker of presentWorkers) {
                for (const item of activeItems) {
                    const itemStartDate = item.Started_At
                        ? new Date(item.Started_At).toISOString().split('T')[0]
                        : woStartDate;
                    if (date < itemStartDate) continue;
                    if (item.Status === 'Završeno' && item.Completed_At && date > item.Completed_At.split('T')[0]) continue;

                    // If there are explicit assignments, only assigned workers get logs
                    if (hasAnyAssignment) {
                        const isAssigned =
                            (item.Assigned_Workers || []).some((w: any) => w.Worker_ID === attWorker.Worker_ID) ||
                            (item.Processes || []).some((p: any) =>
                                p.Worker_ID === attWorker.Worker_ID ||
                                (p.Helpers || []).some((h: any) => h.Worker_ID === attWorker.Worker_ID)
                            );
                        if (!isAssigned) continue;
                    }
                    // If NO assignments at all, ALL present workers get logs for ALL items

                    // Check if work log already exists
                    const exists = await workLogExists(attWorker.Worker_ID, item.ID, date, organizationId);
                    if (exists) continue;

                    // Count total active items for daily rate splitting
                    const worker = workerMap.get(attWorker.Worker_ID);
                    const dailyRate = worker?.Daily_Rate || 0;
                    const splitRate = activeItems.length > 0 ? dailyRate / activeItems.length : dailyRate;

                    await createWorkLog({
                        Worker_ID: attWorker.Worker_ID,
                        Worker_Name: attWorker.Worker_Name,
                        Work_Order_ID: wo.Work_Order_ID,
                        Work_Order_Item_ID: item.ID,
                        Product_ID: item.Product_ID || '',
                        Date: date,
                        Daily_Rate: splitRate,
                        Hours_Worked: 8,
                        Process_Name: '',
                        Is_From_Attendance: true,
                    }, organizationId);
                    workLogsCreated++;
                }
            }
        }

        // Recalculate this work order
        try {
            await recalculateWorkOrder(wo.Work_Order_ID);
            workOrdersRecalculated++;
        } catch (e) {
            console.warn(`Recalculate WO ${wo.Work_Order_Number} failed:`, e);
        }
    }

    log(`Završeno: ${workLogsCreated} work logova kreirano, ${workOrdersRecalculated} naloga preračunato`);
    return { workLogsCreated, workOrdersRecalculated };
}

/**
 * Lightweight startup sync — runs silently on every app open.
 * 1. Auto-schedules active WOs missing from Planer
 * 2. Recalculates all active WO profits/costs
 * 3. Syncs project statuses from WO data
 */
export async function runStartupSync(organizationId: string): Promise<{
    scheduled: number;
    recalculated: number;
    projectsSynced: number;
}> {
    if (!organizationId) return { scheduled: 0, recalculated: 0, projectsSynced: 0 };

    const firestore = getDb();
    let scheduled = 0;
    let recalculated = 0;
    let projectsSynced = 0;

    try {
        // Step 1: Get all active work orders
        const woSnap = await getDocs(query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Organization_ID', '==', organizationId),
            where('Status', 'in', ['U toku', 'Na čekanju'])
        ));

        const projectIds = new Set<string>();
        const now = new Date();

        for (const woDoc of woSnap.docs) {
            const wo = woDoc.data();

            // Step 1a: Auto-schedule active WOs not in Planer
            if (wo.Status === 'U toku' && !wo.Is_Scheduled) {
                await updateDoc(woDoc.ref, {
                    Is_Scheduled: true,
                    Planned_Start_Date: wo.Started_At
                        ? new Date(wo.Started_At).toISOString().split('T')[0]
                        : now.toISOString().split('T')[0],
                    Planned_End_Date: wo.Due_Date || new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0],
                    Scheduled_At: now.toISOString(),
                });
                scheduled++;
                console.log(`[STARTUP-SYNC] Auto-scheduled WO ${wo.Work_Order_Number}`);
            }

            // Step 1b: Auto-set Started_At if WO is active but missing it
            if (wo.Status === 'U toku' && !wo.Started_At && wo.Created_Date) {
                await updateDoc(woDoc.ref, { Started_At: wo.Created_Date });
                console.log(`[STARTUP-SYNC] Auto-set Started_At on WO ${wo.Work_Order_Number}`);
            }

            // Step 2: Recalculate active WO profits
            if (wo.Status === 'U toku') {
                try {
                    await recalculateWorkOrder(wo.Work_Order_ID);
                    recalculated++;
                } catch (e) {
                    console.warn(`[STARTUP-SYNC] Recalculate failed for ${wo.Work_Order_Number}:`, e);
                }
            }

            // Collect project IDs for step 3
            const itemsSnap = await getDocs(query(
                collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                where('Work_Order_ID', '==', wo.Work_Order_ID),
                where('Organization_ID', '==', organizationId)
            ));
            itemsSnap.docs.forEach(d => {
                const pid = d.data().Project_ID;
                if (pid) projectIds.add(pid);
            });
        }

        // Step 3: Sync project statuses
        for (const projectId of Array.from(projectIds)) {
            try {
                await syncProjectStatus(projectId, organizationId);
                projectsSynced++;
            } catch (e) {
                console.warn(`[STARTUP-SYNC] Project sync failed for ${projectId}:`, e);
            }
        }

        console.log(`[STARTUP-SYNC] Done: ${scheduled} scheduled, ${recalculated} recalculated, ${projectsSynced} projects synced`);
    } catch (error) {
        console.error('[STARTUP-SYNC] Error:', error);
    }

    return { scheduled, recalculated, projectsSynced };
}
