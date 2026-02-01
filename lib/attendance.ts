import { db } from './firebase';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    query,
    where,
    writeBatch,
} from 'firebase/firestore';
import { generateUUID, createWorkLog, workLogExists, getWorkers } from './database';
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
        const attendanceData = {
            ...attendance,
            Attendance_ID: attendance.Attendance_ID || generateUUID(),
            Created_Date: attendance.Created_Date || new Date().toISOString(),
            Modified_Date: new Date().toISOString(),
        };

        // Remove undefined fields to prevent Firestore errors
        Object.keys(attendanceData).forEach(key =>
            (attendanceData as any)[key] === undefined && delete (attendanceData as any)[key]
        );

        const attendanceRef = doc(firestore, COLLECTIONS.WORKER_ATTENDANCE, attendanceData.Attendance_ID);
        await updateDoc(attendanceRef, attendanceData as any).catch(async () => {
            await addDoc(collection(firestore, COLLECTIONS.WORKER_ATTENDANCE), attendanceData);
        });

        return attendanceData.Attendance_ID;
    } catch (error) {
        console.error('Error saving worker attendance:', error);
        throw error;
    }
}

/**
 * Mark worker attendance - simplified version
 * (Returns empty affectedWorkOrders for backward compatibility)
 */
export async function markAttendanceAndRecalculate(
    attendance: Partial<WorkerAttendance>
): Promise<{ success: boolean; affectedWorkOrders: string[] }> {
    try {
        await saveWorkerAttendance(attendance);
        return { success: true, affectedWorkOrders: [] };
    } catch (error) {
        console.error('Error marking attendance:', error);
        throw error;
    }
}

/**
 * Create WorkLog entries for a worker's attendance
 * Finds all active work order items where the worker is assigned and creates work logs
 * 
 * @param workerId - Worker ID
 * @param workerName - Worker name
 * @param dailyRate - Worker's daily rate
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
): Promise<{ created: number; skipped: number }> {
    if (!organizationId) {
        console.error('createWorkLogsForAttendance: organizationId is required');
        return { created: 0, skipped: 0 };
    }
    try {
        const firestore = getDb();
        let created = 0;
        let skipped = 0;

        // Find all active work orders (status = 'U toku') for this organization
        const woQuery = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Status', '==', 'U toku'),
            where('Organization_ID', '==', organizationId)
        );
        const woSnapshot = await getDocs(woQuery);

        if (woSnapshot.empty) {
            console.log('No active work orders found');
            return { created: 0, skipped: 0 };
        }

        const workOrderIds = woSnapshot.docs.map(d => d.data().Work_Order_ID);

        // For each active work order, find items where this worker is assigned
        for (const workOrderId of workOrderIds) {
            const itemsQuery = query(
                collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                where('Work_Order_ID', '==', workOrderId),
                where('Status', 'in', ['U toku', 'Na čekanju']),
                where('Organization_ID', '==', organizationId)
            );
            const itemsSnapshot = await getDocs(itemsQuery);

            for (const itemDoc of itemsSnapshot.docs) {
                const item = itemDoc.data() as WorkOrderItem;

                // Check if worker is assigned to this item
                const isAssigned = isWorkerAssignedToItem(item, workerId);

                if (!isAssigned) continue;

                // Check if work log already exists for this worker/item/date
                const exists = await workLogExists(workerId, item.ID, date);
                if (exists) {
                    skipped++;
                    continue;
                }

                // Create work log with process name if available
                const processName = getActiveProcessForWorker(item, workerId);

                const result = await createWorkLog({
                    Worker_ID: workerId,
                    Worker_Name: workerName,
                    Daily_Rate: dailyRate,
                    Work_Order_ID: workOrderId,
                    Work_Order_Item_ID: item.ID,
                    Product_ID: item.Product_ID,
                    Process_Name: processName,  // Now includes the active process
                    Is_From_Attendance: true,
                    Date: date,
                }, organizationId);

                if (result.success) {
                    created++;
                }
            }
        }

        console.log(`WorkLogs: Created ${created}, Skipped ${skipped} for worker ${workerName} on ${date}`);
        return { created, skipped };
    } catch (error) {
        console.error('createWorkLogsForAttendance error:', error);
        return { created: 0, skipped: 0 };
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

    // Check SubTasks
    if (item.SubTasks?.some(st => st.Worker_ID === workerId && st.Status === 'U toku')) {
        return true;
    }

    return false;
}

/**
 * Toggle pause state for a work order item
 * Paused items don't accrue daily rates (dnevnice) but maintain their status
 */
export async function toggleItemPause(
    workOrderId: string,
    itemId: string,
    isPaused: boolean
): Promise<{ success: boolean; message: string }> {
    try {
        const itemRef = await getItemRef(itemId);
        await updateDoc(itemRef, { Is_Paused: isPaused });
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

export async function getWorkerAttendance(workerId: string, date: string): Promise<WorkerAttendance | null> {
    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            where('Worker_ID', '==', workerId),
            where('Date', '==', date)
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

export async function autoPopulateWeekends(workers: Worker[], year: number, month: number): Promise<void> {
    try {
        const firestore = getDb();
        const daysInMonth = new Date(year, month, 0).getDate();
        const batch = writeBatch(firestore);

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month - 1, day);
            const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday

            if (dayOfWeek === 0 || dayOfWeek === 6) {
                // It's a weekend!
                const dateStr = formatLocalDateISO(date);

                for (const worker of workers) {
                    // Check if attendance already exists
                    const existing = await getWorkerAttendance(worker.Worker_ID, dateStr);
                    if (!existing) {
                        const attendanceRef = doc(collection(firestore, COLLECTIONS.WORKER_ATTENDANCE));
                        batch.set(attendanceRef, {
                            Attendance_ID: generateUUID(),
                            Worker_ID: worker.Worker_ID,
                            Worker_Name: worker.Name,
                            Date: dateStr,
                            Status: 'Vikend',
                            Created_Date: new Date().toISOString(),
                        });
                    }
                }
            }
        }

        await batch.commit();
    } catch (error) {
        console.error('Error auto-populating weekends:', error);
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

        // Calculate actual labor cost
        const actualLaborCost = await calculateActualLaborCost(item);

        await updateDoc(itemRef, {
            Status: 'Završeno',
            Completed_At: new Date().toISOString(),
            Actual_Labor_Cost: actualLaborCost
        });

        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error completing item:', error);
        throw error;
    }
}

/**
 * Calculate actual labor cost based on worker attendance
 * OPTIMIZED: Batch-fetches attendance records instead of individual calls per day/worker
 */
export async function calculateActualLaborCost(item: any): Promise<number> {
    try {
        if (!item.Started_At || !item.Completed_At) return 0;

        // Collect all unique worker IDs from Processes (main workers + helpers)
        const workerIds = new Set<string>();

        if (item.Processes && item.Processes.length > 0) {
            for (const process of item.Processes) {
                if (process.Worker_ID) {
                    workerIds.add(process.Worker_ID);
                }
                if (process.Helpers && process.Helpers.length > 0) {
                    for (const helper of process.Helpers) {
                        if (helper.Worker_ID) {
                            workerIds.add(helper.Worker_ID);
                        }
                    }
                }
            }
        }

        // Fallback to legacy Assigned_Workers if no Processes
        if (workerIds.size === 0 && item.Assigned_Workers && item.Assigned_Workers.length > 0) {
            for (const worker of item.Assigned_Workers) {
                if (worker.Worker_ID) {
                    workerIds.add(worker.Worker_ID);
                }
            }
        }

        if (workerIds.size === 0) return 0;

        const firestore = getDb();

        // Fetch worker daily rates from workers collection
        const workersSnap = await getDocs(collection(firestore, 'workers'));
        const workersMap = new Map<string, number>();
        workersSnap.forEach(doc => {
            const data = doc.data();
            if (data.Worker_ID) {
                workersMap.set(data.Worker_ID, data.Daily_Rate || 0);
            }
        });

        const startDateStr = item.Started_At.split('T')[0]; // YYYY-MM-DD
        const endDateStr = item.Completed_At.split('T')[0]; // YYYY-MM-DD

        // OPTIMIZATION: Batch-fetch ALL attendance records for the date range
        // Instead of N workers × M days = N×M queries, we do just 1 query
        const attendanceQuery = query(
            collection(firestore, 'worker_attendance'),
            where('Date', '>=', startDateStr),
            where('Date', '<=', endDateStr)
        );
        const attendanceSnap = await getDocs(attendanceQuery);

        // Build a map of worker+date -> status for O(1) lookup
        const attendanceMap = new Map<string, string>();
        attendanceSnap.forEach(doc => {
            const data = doc.data();
            if (data.Worker_ID && data.Date && data.Status) {
                const key = `${data.Worker_ID}_${data.Date}`;
                attendanceMap.set(key, data.Status);
            }
        });

        let totalCost = 0;
        const startDate = new Date(item.Started_At);
        const endDate = new Date(item.Completed_At);
        const currentDate = new Date(startDate);

        // Iterate through each day
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD

            // Check attendance for each worker using the pre-fetched map
            for (const workerId of Array.from(workerIds)) {
                const key = `${workerId}_${dateStr}`;
                const status = attendanceMap.get(key);

                // Count only if worker was Present or Field (Prisutan ili Teren)
                if (status === 'Prisutan' || status === 'Teren') {
                    const dailyRate = workersMap.get(workerId) || 0;
                    totalCost += dailyRate;
                }
            }

            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return totalCost;
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

        // Aggregate values from items
        let totalValue = 0;
        let materialCost = 0;
        let plannedLaborCost = 0;
        let actualLaborCost = 0;

        let earliestStart: Date | undefined;
        let latestCompletion: Date | undefined;

        workOrder.items.forEach((item: any) => {
            totalValue += item.Product_Value || 0;
            materialCost += item.Material_Cost || 0;
            plannedLaborCost += item.Planned_Labor_Cost || 0;
            actualLaborCost += item.Actual_Labor_Cost || 0;

            if (item.Started_At) {
                const start = new Date(item.Started_At);
                if (!earliestStart || start < earliestStart) earliestStart = start;
            }

            if (item.Completed_At) {
                const comp = new Date(item.Completed_At);
                if (!latestCompletion || comp > latestCompletion) latestCompletion = comp;
            }
        });

        // SAFETY CHECK: If calculated total is 0 but existing WO has value, preserve it (Legacy Data Protection)
        if (totalValue === 0 && (workOrder.Total_Value || 0) > 0) {
            totalValue = workOrder.Total_Value || 0;
        }

        const profit = totalValue - materialCost - actualLaborCost;
        const profitMargin = totalValue > 0 ? (profit / totalValue) * 100 : 0;
        const laborCostVariance = plannedLaborCost - actualLaborCost;

        // Determine overall status
        let status: 'Na čekanju' | 'U toku' | 'Završeno' = 'Na čekanju';
        const allCompleted = workOrder.items.every((i: any) => i.Status === 'Završeno');
        const anyInProgress = workOrder.items.some((i: any) => i.Status === 'U toku');

        if (allCompleted) status = 'Završeno';
        else if (anyInProgress) status = 'U toku';

        await updateDoc(doc(firestore, COLLECTIONS.WORK_ORDERS, workOrderId), {
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
 * Sync product statuses in projects based on work order item statuses
 */
async function syncProductStatuses(items: any[]): Promise<void> {
    console.log('=== syncProductStatuses START ===');
    console.log('Items received:', items.length);

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

            // Determine product status based on work order item status
            // NOTE: Mapping WO item status to PRODUCT_STATUSES:
            // - 'Na čekanju' (WO) → 'Na čekanju' (Product) - Waiting in production queue
            // - 'U toku' (WO) → Keep current process status or 'Sklapanje' - Active production
            // - 'Završeno' (WO) → 'Spremno' (Product) - Production complete, ready for install
            let productStatus = 'Na čekanju';
            if (item.Status === 'Završeno') {
                productStatus = 'Spremno';
            } else if (item.Status === 'U toku') {
                // Try to get current process from item, fallback to 'Sklapanje'
                const activeProcess = item.Processes?.find((p: any) => p.Status === 'U toku');
                productStatus = activeProcess?.Process_Name || 'Sklapanje';
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

            // Update each product document individually
            let updatedCount = 0;
            for (const productDoc of productsSnap.docs) {
                const productData = productDoc.data();
                const newStatus = productStatuses.get(productData.Product_ID);

                if (newStatus && productData.Status !== newStatus) {
                    console.log(`    -> Updating product "${productData.Name || productData.Product_ID}": "${productData.Status}" => "${newStatus}"`);
                    await updateDoc(productDoc.ref, { Status: newStatus });
                    updatedCount++;
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
 * - 'U proizvodnji' if any product is in active production
 * - 'Završeno' if ALL products are Spremno or Instalirano
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

        // Check product statuses
        const completedStatuses = ['Spremno', 'Instalirano'];
        const waitingStatuses = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'];

        const allComplete = products.every(p => completedStatuses.includes(p.Status || ''));
        const anyInProduction = products.some(p =>
            !waitingStatuses.includes(p.Status || '') && !completedStatuses.includes(p.Status || '')
        );

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
    const woRef = doc(firestore, COLLECTIONS.WORK_ORDERS, workOrderId);
    const woSnap = await getDoc(woRef);

    if (!woSnap.exists()) return null;

    const data = woSnap.data();
    // Use the stored Work_Order_ID if available, otherwise fallback to doc ID (for backward compatibility)
    const storedWorkOrderId = data.Work_Order_ID || woSnap.id;

    // IMPORTANT: Keep doc ID as the main identifier for updates, but link items via stored ID
    const workOrder = { ...data, Work_Order_ID: woSnap.id } as WorkOrder;

    // Get items from root collection using the Stored Work Order ID (linking key)
    const itemsQuery = query(
        collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
        where('Work_Order_ID', '==', storedWorkOrderId)
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
            // Merge all sub-tasks into one
            const totalQuantity = updatedSubTasks.reduce((sum, st) => sum + st.Quantity, 0);
            finalSubTasks = [{
                SubTask_ID: `st-merged-${Date.now()}`,
                Quantity: totalQuantity,
                Current_Process: updatedSubTasks[0].Current_Process,
                Status: updatedSubTasks[0].Status,
                Started_At: updatedSubTasks.find(st => st.Started_At)?.Started_At
            }];
            console.log('Auto-merged sub-tasks into one:', totalQuantity);
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
