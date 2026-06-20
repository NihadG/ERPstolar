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

        // ═══════════════════════════════════════════════════════════════
        // REACTIVE PATTERN: DELETE-BEFORE-CREATE
        // 
        // ALWAYS delete existing work logs first, then create fresh ones.
        // This handles ALL status transition scenarios:
        //   Prisutan → Teren:  old production logs deleted, montaža logs created
        //   Teren → Prisutan:  old montaža logs deleted, production logs created
        //   Prisutan → Odsutan: all logs deleted
        //   Odsutan → Prisutan: fresh production logs created
        //
        // This is the standard ERP reconciliation pattern — idempotent
        // and always produces correct results regardless of previous state.
        // ═══════════════════════════════════════════════════════════════

        // STEP 1: Find which WOs had logs BEFORE deletion (for recalculation later)
        // Also detect MANUAL bookings (Dnevna knjiga rada) — those are the source of truth
        // and must NOT be overwritten by the auto-split pipeline.
        let hasManualBooking = false;
        try {
            const existingLogsQ = query(
                collection(firestore, 'work_logs'),
                where('Worker_ID', '==', attendance.Worker_ID),
                where('Date', '==', attendance.Date),
                where('Organization_ID', '==', attendance.Organization_ID)
            );
            const existingLogsSnap = await getDocs(existingLogsQ);
            existingLogsSnap.docs.forEach(d => {
                const data = d.data();
                if (data.Booking_Source === 'manual') hasManualBooking = true;
                const woId = data.Work_Order_ID;
                if (woId) affectedWorkOrderIds.add(woId);
            });
        } catch (err) {
            console.warn('Pre-deletion WO lookup failed:', err);
        }

        // GUARD: Ručni booking postoji → on vlada danom. Prisutnost je već spremljena;
        // ne diramo work logove (ni brisanje ni auto-kreiranje).
        if (hasManualBooking) {
            console.log(`[ATTENDANCE] Ručni booking postoji za ${attendance.Worker_Name} na ${attendance.Date} — preskačem auto work logove.`);
            return { success: true, affectedWorkOrders: [], workLogsCreated: 0, workLogsDeleted: 0 };
        }

        // STEP 2: DELETE all existing work logs for this worker+date (clean slate)
        try {
            const cleanupResult = await deleteWorkLogsForWorkerOnDate(
                attendance.Worker_ID,
                attendance.Date,
                attendance.Organization_ID
            );
            workLogsDeleted = cleanupResult.deleted;
            if (workLogsDeleted > 0) {
                console.log(`[ATTENDANCE] Cleaned ${workLogsDeleted} old work logs for ${attendance.Worker_Name} on ${attendance.Date}`);
            }
        } catch (deleteError) {
            console.error('Work log cleanup during attendance change failed:', deleteError);
        }

        // STEP 3: CREATE fresh work logs based on current status
        if (attendance.Status === 'Prisutan' || attendance.Status === 'Teren') {
            const workers = await getWorkers(attendance.Organization_ID);
            const worker = workers.find(w => w.Worker_ID === attendance.Worker_ID);
            const dailyRate = worker?.Daily_Rate || 0;
            const workerName = attendance.Worker_Name || worker?.Name || 'Unknown';

            // CREATE work logs with WO type filter:
            //   Prisutan → ONLY on Proizvodnja orders (factory work)
            //   Teren    → ONLY on Montaža orders (field work)
            const result = await createWorkLogsForAttendance(
                attendance.Worker_ID,
                workerName,
                dailyRate,
                attendance.Date,
                attendance.Organization_ID,
                attendance.Status // Pass status to filter by WO type
            );

            workLogsCreated = result.created;
            result.affectedWorkOrderIds.forEach(id => affectedWorkOrderIds.add(id));

            console.log(`[ATTENDANCE] ${workerName}: ${attendance.Status} on ${attendance.Date}. Created: ${result.created}, Skipped: ${result.skipped}`);
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

// ════════════════════════════════════════════════════════════════════
// DNEVNA KNJIGA RADA (Daily Work Booking)
// Eksplicitno bilježenje radnih dana/dnevnica po proizvodu (Model B+A).
// Izvor istine za trošak rada — piše WorkLog sa Day_Fraction i Booking_Source:'manual'.
// ════════════════════════════════════════════════════════════════════

export interface DailyBookingItemInput {
    workOrderItemId: string;
    dayFraction: number;        // 1 (cijeli) ili 0.5 (pola)
    processName?: string;       // opcioni tag procesa
}
export interface DailyBookingEntryInput {
    workerId: string;
    items: DailyBookingItemInput[];
}

export interface DailyBookingItemView {
    workOrderItemId: string;
    workOrderId: string;
    productName: string;
    projectName: string;
    dayFraction: number;
    processName?: string;
    amount: number;             // KM koje su pale na ovaj proizvod (Daily_Rate zapisa)
}
export interface DailyBookingEntryView {
    workerId: string;
    workerName: string;
    dailyRate: number;
    items: DailyBookingItemView[];
}

/**
 * Helper: dohvati WorkOrderItem-e po ID-jevima (chunked 'in' upiti, max 10 po upitu).
 */
async function fetchWorkOrderItemsByIds(itemIds: string[], organizationId: string): Promise<Map<string, WorkOrderItem>> {
    const map = new Map<string, WorkOrderItem>();
    if (itemIds.length === 0) return map;
    const firestore = getDb();
    for (let i = 0; i < itemIds.length; i += 10) {
        const chunk = itemIds.slice(i, i + 10);
        const q = query(
            collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
            where('ID', 'in', chunk),
            where('Organization_ID', '==', organizationId)
        );
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
            const it = d.data() as WorkOrderItem;
            map.set(it.ID, it);
        });
    }
    return map;
}

/**
 * Spremi dnevnu knjigu rada za dati dan. Booking je IZVOR ISTINE:
 * za svakog radnika u `entries` briše postojeće work logove tog dana i piše nove.
 * Daily_Rate = round(dnevnica × dayFraction).
 */
export async function saveDailyWorkBooking(
    date: string,
    organizationId: string,
    entries: DailyBookingEntryInput[]
): Promise<{ success: boolean; logsCreated: number; affectedWorkOrders: string[]; message: string }> {
    if (!organizationId || !date) {
        return { success: false, logsCreated: 0, affectedWorkOrders: [], message: 'Nedostaju datum ili organizacija' };
    }
    try {
        const workers = await getWorkers(organizationId);
        const affected = new Set<string>();
        let logsCreated = 0;

        // RECALC SAFETY: zabilježi naloge koji su PRIJE imali zapise za ove radnike na ovaj datum,
        // da ih osvježimo čak i ako rad pređe na drugi proizvod/nalog (inače ostane stari trošak).
        try {
            const fs = getDb();
            for (const e of entries) {
                const prevQ = query(
                    collection(fs, 'work_logs'),
                    where('Worker_ID', '==', e.workerId),
                    where('Date', '==', date),
                    where('Organization_ID', '==', organizationId)
                );
                const prevSnap = await getDocs(prevQ);
                prevSnap.docs.forEach(d => { const wo = d.data().Work_Order_ID; if (wo) affected.add(wo); });
            }
        } catch (e) { console.warn('saveDailyWorkBooking pre-affected lookup failed:', e); }

        const bookedItemIds = Array.from(new Set(entries.flatMap(e => e.items.map(i => i.workOrderItemId))));
        let itemMap = await fetchWorkOrderItemsByIds(bookedItemIds, organizationId);
        // Custom (ad-hoc) zadaci koji su POVEZANI s proizvodom → trošak ide na povezani proizvod.
        // Dohvati i povezane iteme da bismo zapis upisali na njih.
        const linkedIds = Array.from(new Set(
            Array.from(itemMap.values())
                .filter(it => it.Item_Type === 'custom' && it.Linked_Item_ID)
                .map(it => it.Linked_Item_ID as string)
        ));
        if (linkedIds.length > 0) {
            const linkedMap = await fetchWorkOrderItemsByIds(linkedIds, organizationId);
            linkedMap.forEach((v, k) => itemMap.set(k, v));
        }

        for (const entry of entries) {
            const worker = workers.find(w => w.Worker_ID === entry.workerId);
            const dailyRate = worker?.Daily_Rate || 0;
            const workerName = worker?.Name || 'Nepoznat';

            // Clean slate: booking u potpunosti preuzima dan ovog radnika
            try {
                await deleteWorkLogsForWorkerOnDate(entry.workerId, date, organizationId);
            } catch (e) {
                console.warn('saveDailyWorkBooking cleanup failed:', e);
            }

            for (const item of entry.items) {
                const booked = itemMap.get(item.workOrderItemId);
                if (!booked) continue;
                const frac = item.dayFraction === 0.5 ? 0.5 : 1;
                const amount = Math.round(dailyRate * frac * 100) / 100;

                // POVEZAN custom zadatak → upiši zapis na povezani proizvod (trošak se dodaje proizvodu),
                // a naziv zadatka ide u Process_Name. Inače piši na sam booked item.
                const linked = (booked.Item_Type === 'custom' && booked.Linked_Item_ID)
                    ? itemMap.get(booked.Linked_Item_ID)
                    : undefined;
                const target = linked || booked;
                const processName = linked
                    ? booked.Product_Name                       // naziv zadatka kao "proces" na proizvodu
                    : item.processName;

                const res = await createWorkLog({
                    Worker_ID: entry.workerId,
                    Worker_Name: workerName,
                    Daily_Rate: amount,
                    Original_Daily_Rate: dailyRate,
                    Day_Fraction: frac,
                    Booking_Source: 'manual',
                    Is_From_Attendance: false,
                    Hours_Worked: frac === 0.5 ? 4 : 8,
                    Work_Order_ID: target.Work_Order_ID,
                    Work_Order_Item_ID: target.ID,
                    Product_ID: target.Product_ID,
                    Process_Name: processName,
                    Date: date,
                }, organizationId);
                if (res.success) {
                    logsCreated++;
                    if (target.Work_Order_ID) affected.add(target.Work_Order_ID);
                }
            }
        }

        const affectedList = Array.from(affected);
        await Promise.all(affectedList.map(id => recalculateWorkOrder(id).catch(err => console.warn('recalc failed', id, err))));

        return { success: true, logsCreated, affectedWorkOrders: affectedList, message: `Spremljeno ${logsCreated} zapisa rada` };
    } catch (error) {
        console.error('saveDailyWorkBooking error:', error);
        return { success: false, logsCreated: 0, affectedWorkOrders: [], message: 'Greška pri spremanju knjige rada' };
    }
}

/**
 * Pročitaj postojeću knjigu rada za dan (grupisano po radniku) — za prikaz/uređivanje.
 */
export async function getDailyWorkBooking(date: string, organizationId: string): Promise<DailyBookingEntryView[]> {
    if (!organizationId || !date) return [];
    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, 'work_logs'),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        );
        const snap = await getDocs(q);
        if (snap.empty) return [];

        const logs = snap.docs.map(d => d.data() as WorkLog);
        const itemMap = await fetchWorkOrderItemsByIds(
            Array.from(new Set(logs.map(l => l.Work_Order_Item_ID).filter(Boolean))),
            organizationId
        );
        const workers = await getWorkers(organizationId);

        const byWorker = new Map<string, DailyBookingEntryView>();
        for (const log of logs) {
            let entry = byWorker.get(log.Worker_ID);
            if (!entry) {
                const w = workers.find(x => x.Worker_ID === log.Worker_ID);
                entry = {
                    workerId: log.Worker_ID,
                    workerName: log.Worker_Name,
                    dailyRate: w?.Daily_Rate ?? log.Original_Daily_Rate ?? 0,
                    items: [],
                };
                byWorker.set(log.Worker_ID, entry);
            }
            const woi = itemMap.get(log.Work_Order_Item_ID);
            entry.items.push({
                workOrderItemId: log.Work_Order_Item_ID,
                workOrderId: log.Work_Order_ID,
                productName: woi?.Product_Name ?? '',
                projectName: woi?.Project_Name ?? '',
                dayFraction: log.Day_Fraction ?? 1,
                processName: log.Process_Name,
                amount: log.Daily_Rate,
            });
        }
        return Array.from(byWorker.values());
    } catch (error) {
        console.error('getDailyWorkBooking error:', error);
        return [];
    }
}

/**
 * Predloži raspodjelu za `date` na osnovu zadnjeg ranijeg dana sa zabilježenim radom,
 * za radnike koji su danas prisutni (Prisutan/Teren). Model A kao prijedlog.
 */
export async function suggestDailyBooking(date: string, organizationId: string): Promise<DailyBookingEntryView[]> {
    if (!organizationId || !date) return [];
    try {
        const firestore = getDb();

        // Ko je danas prisutan?
        const attQ = query(
            collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        );
        const attSnap = await getDocs(attQ);
        const presentWorkerIds = attSnap.docs
            .map(d => d.data() as WorkerAttendance)
            .filter(a => a.Status === 'Prisutan' || a.Status === 'Teren')
            .map(a => a.Worker_ID);
        if (presentWorkerIds.length === 0) return [];

        const workers = await getWorkers(organizationId);
        const suggestions: DailyBookingEntryView[] = [];

        for (const workerId of presentWorkerIds) {
            // Svi logovi radnika, nađi zadnji datum < date
            const logsQ = query(
                collection(firestore, 'work_logs'),
                where('Worker_ID', '==', workerId),
                where('Organization_ID', '==', organizationId)
            );
            const logsSnap = await getDocs(logsQ);
            const priorLogs = logsSnap.docs
                .map(d => d.data() as WorkLog)
                .filter(l => l.Date < date);
            if (priorLogs.length === 0) continue;

            const lastDate = priorLogs.reduce((max, l) => (l.Date > max ? l.Date : max), priorLogs[0].Date);
            const lastDayLogs = priorLogs.filter(l => l.Date === lastDate);
            if (lastDayLogs.length === 0) continue;

            const w = workers.find(x => x.Worker_ID === workerId);
            const dailyRate = w?.Daily_Rate ?? lastDayLogs[0].Original_Daily_Rate ?? 0;
            const itemMap = await fetchWorkOrderItemsByIds(
                Array.from(new Set(lastDayLogs.map(l => l.Work_Order_Item_ID).filter(Boolean))),
                organizationId
            );

            const items: DailyBookingItemView[] = [];
            for (const log of lastDayLogs) {
                const woi = itemMap.get(log.Work_Order_Item_ID);
                // Predloži samo proizvode iz naloga koji NIJE završen/otkazan
                if (!woi) continue;
                const frac = log.Day_Fraction ?? 1;
                items.push({
                    workOrderItemId: log.Work_Order_Item_ID,
                    workOrderId: log.Work_Order_ID,
                    productName: woi.Product_Name ?? '',
                    projectName: woi.Project_Name ?? '',
                    dayFraction: frac,
                    processName: log.Process_Name,
                    amount: Math.round(dailyRate * frac * 100) / 100,
                });
            }
            if (items.length > 0) {
                suggestions.push({ workerId, workerName: w?.Name ?? lastDayLogs[0].Worker_Name, dailyRate, items });
            }
        }
        return suggestions;
    } catch (error) {
        console.error('suggestDailyBooking error:', error);
        return [];
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
    organizationId: string,
    attendanceStatus?: string // 'Prisutan' | 'Teren' — controls which WO types get logs
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

            // FILTER BY WO TYPE based on attendance status:
            //   Prisutan → Only Proizvodnja orders (factory work)
            //   Teren    → Only Montaža orders (field work)
            if (attendanceStatus === 'Teren' && wo.Work_Order_Type !== 'Montaža') continue;
            if (attendanceStatus === 'Prisutan' && wo.Work_Order_Type === 'Montaža') continue;

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
 * 
 * FIX: Previously only checked processes with Status === 'U toku'.
 * This caused workers who finished a process (Završeno) to lose their
 * assignment check, resulting in 0 work logs for subsequent days.
 * Now checks ALL process statuses — if a worker was ever assigned
 * to the item, they get work logs as long as the item itself is active.
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

    // Check Processes - main worker OR helper (ANY status — not just 'U toku')
    // A worker who finished 'Rezanje' is still working on the item if the item itself is active
    if (item.Processes?.some(p =>
        p.Worker_ID === workerId ||
        p.Helpers?.some(h => h.Worker_ID === workerId)
    )) {
        return true;
    }

    // Check SubTasks - main worker OR helper (ANY status)
    if (item.SubTasks?.some(st =>
        st.Worker_ID === workerId ||
        st.Helpers?.some(h => h.Worker_ID === workerId)
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
 * Assign workers to a Work Order Item — WITH REACTIVE RECONCILIATION
 * 
 * When workers change, this function:
 * 1. Diffs old vs new assignments to find added/removed workers
 * 2. Deletes TODAY's work logs for removed workers (on this item only)
 * 3. Re-splits daily rates for ALL affected workers (because split factor changed)
 * 4. Creates work logs for newly added workers (if they have attendance today)
 * 5. Recalculates the work order
 * 
 * CRITICAL: The item status is NEVER changed by this function.
 * Workers can be changed while the order is "U toku" without stopping it.
 */
export async function assignWorkersToItem(
    workOrderId: string,
    itemId: string,
    workers: { Worker_ID: string; Worker_Name: string; Daily_Rate: number }[],
    organizationId?: string
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) {
            throw new Error('Item ne postoji');
        }

        const itemData = itemSnap.data() as WorkOrderItem;
        const orgId = organizationId || (itemData as any).Organization_ID || '';
        const oldWorkers = itemData.Assigned_Workers || [];

        // Write new workers FIRST (so recalculation uses the latest data)
        await updateDoc(itemRef, {
            Assigned_Workers: workers
        });

        // Compute diff: who was removed, who was added
        const oldWorkerIds = new Set(oldWorkers.map(w => w.Worker_ID));
        const newWorkerIds = new Set(workers.map(w => w.Worker_ID));

        const removedWorkerIds = Array.from(oldWorkerIds).filter(id => !newWorkerIds.has(id));
        const addedWorkerIds = Array.from(newWorkerIds).filter(id => !oldWorkerIds.has(id));

        // REACTIVE: Reconcile work logs when workers change
        if (orgId && (removedWorkerIds.length > 0 || addedWorkerIds.length > 0)) {
            await reconcileWorkLogsAfterWorkerChange(
                workOrderId,
                itemId,
                removedWorkerIds,
                addedWorkerIds,
                [...Array.from(newWorkerIds)],
                orgId
            );
        }

        // Recalculate Work Order aggregates (profit, labor cost, etc.)
        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error assigning workers:', error);
        throw error;
    }
}

/**
 * REACTIVE RECONCILIATION: Clean up and regenerate work logs when worker assignments change.
 * 
 * This ensures that:
 * - Removed workers' TODAY work logs for this item are deleted
 * - All workers' daily rate splits are recalculated for today
 * - Newly added workers get work logs created if they have attendance today
 * 
 * IMPORTANT: Historical work logs (past days) are NEVER touched.
 * If Worker A worked Mon-Tue and was removed on Wed, Mon/Tue logs remain.
 */
async function reconcileWorkLogsAfterWorkerChange(
    workOrderId: string,
    itemId: string,
    removedWorkerIds: string[],
    addedWorkerIds: string[],
    allNewWorkerIds: string[],
    organizationId: string
): Promise<void> {
    const firestore = getDb();
    const today = formatLocalDateISO();

    console.log(`[WORKER RECONCILIATION] WO:${workOrderId} Item:${itemId} removed:${removedWorkerIds.length} added:${addedWorkerIds.length}`);

    // 1. DELETE today's work logs for REMOVED workers (on this item ONLY)
    for (const workerId of removedWorkerIds) {
        await deleteWorkLogsForWorkerOnItem(workerId, itemId, today, organizationId);
    }

    // 2. RE-SPLIT daily rates for ALL affected workers
    // When assignment count changes, the split factor changes for all workers.
    // Must recalculate for: removed workers (they may still be on other items)
    // and remaining + new workers (their split count changed)
    const allAffectedWorkerIds = Array.from(new Set([...removedWorkerIds, ...allNewWorkerIds]));
    for (const workerId of allAffectedWorkerIds) {
        await resplitWorkerDailyRate(workerId, today, organizationId);
    }

    // 3. CREATE work logs for ADDED workers (if they have attendance today)
    for (const workerId of addedWorkerIds) {
        try {
            // Check if worker has attendance today
            const attendanceQ = query(
                collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
                where('Worker_ID', '==', workerId),
                where('Date', '==', today),
                where('Organization_ID', '==', organizationId)
            );
            const attendanceSnap = await getDocs(attendanceQ);
            if (!attendanceSnap.empty) {
                const att = attendanceSnap.docs[0].data();
                const attStatus = att.Status;
                // Only create if they're a working status
                if (attStatus === 'Prisutan' || attStatus === 'Teren') {
                    const allWorkers = await getWorkers(organizationId);
                    const worker = allWorkers.find(w => w.Worker_ID === workerId);
                    if (worker) {
                        await createWorkLogsForAttendance(
                            workerId,
                            worker.Name || att.Worker_Name || 'Unknown',
                            worker.Daily_Rate || 0,
                            today,
                            organizationId,
                            attStatus
                        );
                    }
                }
            }
        } catch (err) {
            console.warn(`Work log creation for added worker ${workerId} failed (non-critical):`, err);
        }
    }
}

/**
 * Delete work logs for a specific worker on a specific item on a specific date.
 * More targeted than deleteWorkLogsForWorkerOnDate — doesn't affect other items.
 */
async function deleteWorkLogsForWorkerOnItem(
    workerId: string,
    workOrderItemId: string,
    date: string,
    organizationId: string
): Promise<{ deleted: number }> {
    try {
        const firestore = getDb();
        const q = query(
            collection(firestore, 'work_logs'),
            where('Worker_ID', '==', workerId),
            where('Work_Order_Item_ID', '==', workOrderItemId),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) return { deleted: 0 };

        const batch = writeBatch(firestore);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();

        console.log(`[WORKER RECONCILIATION] Deleted ${snapshot.size} work logs for worker ${workerId} on item ${workOrderItemId} on ${date}`);
        return { deleted: snapshot.size };
    } catch (error) {
        console.error('deleteWorkLogsForWorkerOnItem error:', error);
        return { deleted: 0 };
    }
}

/**
 * Re-split a worker's daily rate across ALL their active item assignments.
 * 
 * When a worker is added to or removed from an item, the split factor changes for ALL of their items.
 * E.g., if Worker A (80 KM/day) was on 2 items (40 KM each) and gets added to a 3rd,
 * ALL 3 items now get 80/3 = 26.67 KM.
 * 
 * This function:
 * 1. Counts how many active items the worker is assigned to
 * 2. Gets the worker's full Daily_Rate from the workers collection
 * 3. Updates ALL work logs for this worker+date with the correct split
 */
export async function resplitWorkerDailyRate(
    workerId: string,
    date: string,
    organizationId: string
): Promise<void> {
    try {
        const firestore = getDb();

        // Get worker's full daily rate
        const allWorkers = await getWorkers(organizationId);
        const worker = allWorkers.find(w => w.Worker_ID === workerId);
        if (!worker || !worker.Daily_Rate) return;

        const fullRate = worker.Daily_Rate;

        // Find ALL work logs for this worker on this date
        const logsQuery = query(
            collection(firestore, 'work_logs'),
            where('Worker_ID', '==', workerId),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        );
        const logsSnap = await getDocs(logsQuery);

        if (logsSnap.empty) return;

        // Count total active assignments (= number of work logs for this date)
        const totalAssignments = logsSnap.size;
        const splitRate = Math.round((fullRate / totalAssignments) * 100) / 100;

        // Update each log with new split rate
        const batch = writeBatch(firestore);
        logsSnap.docs.forEach(logDoc => {
            batch.update(logDoc.ref, {
                Daily_Rate: splitRate,
                Original_Daily_Rate: fullRate,
                Split_Factor: totalAssignments
            });
        });
        await batch.commit();

        console.log(`[RATE RESPLIT] Worker ${workerId} on ${date}: ${fullRate} KM ÷ ${totalAssignments} items = ${splitRate} KM each`);
    } catch (error) {
        console.error('resplitWorkerDailyRate error:', error);
    }
}

/**
 * Start a Work Order Item
 * PRESERVES existing Started_At — only sets it on first activation
 * Accepts optional customDate for retroactive start setting
 */
export async function startWorkOrderItem(
    workOrderId: string,
    itemId: string,
    options?: { customDate?: string }
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);
        const existingStartedAt = itemSnap.exists() ? itemSnap.data()?.Started_At : undefined;

        // Use customDate if provided, otherwise preserve existing or use now
        const startDate = options?.customDate
            ? new Date(options.customDate).toISOString()
            : (existingStartedAt || new Date().toISOString());

        await updateDoc(itemRef, {
            Status: 'U toku',
            Started_At: startDate
        });

        await recalculateWorkOrder(workOrderId);

        // Propagiraj status projekta (proizvod u pokrenutom nalogu → projekat "U proizvodnji")
        const itemData = itemSnap.data();
        if (itemData?.Project_ID) {
            try { await syncProjectStatus(itemData.Project_ID, itemData.Organization_ID); }
            catch (e) { console.warn('startWorkOrderItem: syncProjectStatus failed:', e); }
        }
    } catch (error) {
        console.error('Error starting item:', error);
        throw error;
    }
}

/**
 * Complete a Work Order Item and calculate actual labor cost
 * Accepts optional customDate for retroactive completion
 */
export async function completeWorkOrderItem(
    workOrderId: string,
    itemId: string,
    options?: { customDate?: string }
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

        const completionDate = options?.customDate
            ? new Date(options.customDate).toISOString()
            : new Date().toISOString();

        await updateDoc(itemRef, {
            Status: 'Završeno',
            Completed_At: completionDate,
            Actual_Labor_Cost: actualLaborCost,
            Labor_Cost_Frozen: true
        });

        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error completing item:', error);
        throw error;
    }
}

/**
 * Proportionally split labor costs across WO items when same worker works
 * on multiple products on the same day.
 *
 * For each (Worker_ID, Date) combination that appears in work logs of
 * multiple items, split the Original_Daily_Rate proportionally by material cost.
 *
 * Example: Worker (100 KM/day) works on Product A (material: 1900 KM) and
 * Product B (material: 300 KM) on the same day:
 *   A gets: 100 × 1900/(1900+300) = 86 KM
 *   B gets: 100 ×  300/(1900+300) = 14 KM
 */
async function recalculateWOLaborSplit(
    workOrderId: string,
    organizationId: string
): Promise<void> {
    const firestore = getDb();

    // 1. Get ALL work logs for this WO
    const logsQuery = query(
        collection(firestore, 'work_logs'),
        where('Work_Order_ID', '==', workOrderId),
        where('Organization_ID', '==', organizationId)
    );
    const logsSnap = await getDocs(logsQuery);
    if (logsSnap.empty) return;

    // 2. Get all WO items to find material costs
    const itemsQuery = query(
        collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
        where('Work_Order_ID', '==', workOrderId)
    );
    const itemsSnap = await getDocs(itemsQuery);
    const itemMaterialCosts = new Map<string, number>(); // itemID -> materialCost
    itemsSnap.docs.forEach(d => {
        const data = d.data();
        itemMaterialCosts.set(data.ID, data.Material_Cost || data.Product_Value || 1);
    });

    // 3. Group logs by (Worker_ID, Date) → list of { docRef, itemId, originalRate }
    type LogInfo = { ref: any; itemId: string; originalRate: number; docId: string };
    const workerDateMap = new Map<string, LogInfo[]>();

    logsSnap.docs.forEach(d => {
        const data = d.data();
        const key = `${data.Worker_ID}__${data.Date}`;
        const entry: LogInfo = {
            ref: d.ref,
            itemId: data.Work_Order_Item_ID,
            originalRate: data.Original_Daily_Rate || data.Daily_Rate || 0,
            docId: d.id,
        };
        const existing = workerDateMap.get(key) || [];
        existing.push(entry);
        workerDateMap.set(key, existing);
    });

    // 4. For each worker-date group, check if logs span multiple items
    const CHUNK_SIZE = 450;
    const updates: Array<{ ref: any; newRate: number }> = [];

    for (const entry of Array.from(workerDateMap.entries())) {
        const logs = entry[1];
        // Get unique item IDs for this worker-date
        const uniqueItemIds = Array.from(new Set(logs.map((l: LogInfo) => l.itemId)));

        if (uniqueItemIds.length <= 1) {
            // Only one item — ensure full rate (no split needed)
            for (const log of logs) {
                if (Math.round(log.originalRate) !== Math.round(log.originalRate)) continue; // skip if fine
                updates.push({ ref: log.ref, newRate: Math.round(log.originalRate) });
            }
            continue;
        }

        // Multiple items — split proportionally by material cost
        const totalMaterial = uniqueItemIds.reduce(
            (sum, id) => sum + (itemMaterialCosts.get(id) || 1), 0
        );

        for (const log of logs) {
            const itemMaterial = itemMaterialCosts.get(log.itemId) || 1;
            const ratio = itemMaterial / totalMaterial;
            const splitRate = Math.round(log.originalRate * ratio);
            updates.push({ ref: log.ref, newRate: splitRate });
        }
    }

    // 5. Batch update all adjusted rates
    if (updates.length > 0) {
        for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
            const chunk = updates.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            chunk.forEach(u => batch.update(u.ref, { Daily_Rate: u.newRate }));
            await batch.commit();
        }
        console.log(`[recalculateWOLaborSplit] WO ${workOrderId}: ${updates.length} logs adjusted across ${itemMaterialCosts.size} items`);
    }
}

/**
 * Override work logs for a specific work order item.
 * Replaces ALL existing work logs for the item with manually-edited entries.
 * Used when the user edits the timeline to correct profit calculations.
 *
 * Pipeline:
 * 1. Delete all existing work logs for this item
 * 2. Write new work logs from manual entries
 * 3. Recalculate work order (labor cost + profit)
 */
export async function overrideWorkLogs(
    workOrderId: string,
    itemId: string,
    entries: Array<{
        Worker_ID: string;
        Worker_Name: string;
        Date: string;
        Daily_Rate: number;
        Process_Name?: string;
    }>,
    organizationId: string,
    productId?: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();

        // Resolve Product_ID from the work order item if not provided
        let resolvedProductId = productId || '';
        if (!resolvedProductId) {
            try {
                const itemDoc = await getDoc(doc(firestore, COLLECTIONS.WORK_ORDER_ITEMS, itemId));
                if (itemDoc.exists()) {
                    resolvedProductId = itemDoc.data().Product_ID || '';
                }
            } catch { /* continue without it */ }
        }

        // 1. Delete all existing work logs for this item
        //    FIELD: Work_Order_Item_ID — matches how createWorkLog stores them
        const existingQuery = query(
            collection(firestore, 'work_logs'),
            where('Work_Order_ID', '==', workOrderId),
            where('Work_Order_Item_ID', '==', itemId),
            where('Organization_ID', '==', organizationId)
        );
        const existingSnap = await getDocs(existingQuery);

        // Delete in batches
        const CHUNK_SIZE = 450;
        const docsToDelete = existingSnap.docs;
        for (let i = 0; i < docsToDelete.length; i += CHUNK_SIZE) {
            const chunk = docsToDelete.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            chunk.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }

        // 2. Write new work logs with ALL required fields
        //    Must match the schema used by createWorkLog / calculateActualLaborCost
        const newLogs = entries.map(entry => ({
            Work_Log_ID: generateUUID(),
            Organization_ID: organizationId,
            Work_Order_ID: workOrderId,
            Work_Order_Item_ID: itemId,          // ← correct field name
            Product_ID: resolvedProductId,        // ← required for timeline display
            Worker_ID: entry.Worker_ID,
            Worker_Name: entry.Worker_Name,
            Date: entry.Date,
            Daily_Rate: entry.Daily_Rate,
            Original_Daily_Rate: entry.Daily_Rate,
            Split_Factor: 1,
            Hours_Worked: 8,                      // ← required field
            Process_Name: entry.Process_Name || '',
            Is_From_Attendance: false,            // ← manual override, not from attendance
            Source: 'manual_override' as const,
            Created_At: new Date().toISOString(),
        }));

        for (let i = 0; i < newLogs.length; i += CHUNK_SIZE) {
            const chunk = newLogs.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            chunk.forEach(log => {
                const ref = doc(collection(firestore, 'work_logs'));
                batch.set(ref, log);
            });
            await batch.commit();
        }

        // 3. Mark item as having manual labor cost override
        //    Query by ID field since Firestore doc ID may differ from item.ID
        try {
            const totalLaborCost = entries.reduce((sum, e) => sum + e.Daily_Rate, 0);
            const itemQuery = query(
                collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                where('ID', '==', itemId)
            );
            const itemSnap = await getDocs(itemQuery);
            if (!itemSnap.empty) {
                const itemRef = itemSnap.docs[0].ref;
                await updateDoc(itemRef, {
                    Labor_Cost_Frozen: true,
                    Actual_Labor_Cost: totalLaborCost,
                    Labor_Cost_Updated_At: new Date().toISOString(),
                    Labor_Cost_Source: 'manual_override',
                });
            } else {
                console.warn(`[overrideWorkLogs] Item ${itemId} not found in collection — skipping metadata update`);
            }
        } catch (itemErr) {
            console.warn(`[overrideWorkLogs] Failed to update item ${itemId}:`, itemErr);
        }

        // 4. Proportionally split labor costs across sibling items
        await recalculateWOLaborSplit(workOrderId, organizationId);

        // 5. Recalculate work order totals
        await recalculateWorkOrder(workOrderId);

        console.log(`[overrideWorkLogs] WO ${workOrderId} item ${itemId}: ${docsToDelete.length} deleted, ${newLogs.length} created`);
        return { success: true, message: `${newLogs.length} zapisa ažurirano` };
    } catch (error) {
        console.error('overrideWorkLogs error:', error);
        return { success: false, message: 'Greška pri ažuriranju work logova' };
    }
}

/**
 * Retroactively adjust work order dates (Started_At, Completed_At).
 * Used when the user was away and needs to correct WO timeline.
 *
 * Cascade pipeline:
 * 1. Update WO-level dates in Firestore
 * 2. Update item-level dates proportionally
 * 3. Recalculate work order (labor cost, profit, status)
 * 4. Sync product/project statuses
 */
export async function adjustWorkOrderDates(
    workOrderId: string,
    updates: { Started_At?: string; Completed_At?: string },
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const firestore = getDb();

        // 1. Find the WO document
        const woQuery = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const woSnap = await getDocs(woQuery);
        if (woSnap.empty) {
            return { success: false, message: 'Work order not found' };
        }

        const woDoc = woSnap.docs[0];
        const woData = woDoc.data();

        // 2. Build WO-level update payload
        const woUpdate: Record<string, any> = {};
        if (updates.Started_At) {
            woUpdate.Started_At = new Date(updates.Started_At).toISOString();
        }
        if (updates.Completed_At) {
            woUpdate.Completed_At = new Date(updates.Completed_At).toISOString();
        }

        if (Object.keys(woUpdate).length > 0) {
            await updateDoc(woDoc.ref, woUpdate);
        }

        // 3. Update item-level dates
        //    - If Started_At changed: update items that don't have their own Started_At,
        //      or items whose Started_At matches the old WO start (inherited)
        //    - If Completed_At changed: update items whose Completed_At matches old WO end
        const itemsQuery = query(
            collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnap = await getDocs(itemsQuery);

        for (const itemDoc of itemsSnap.docs) {
            const item = itemDoc.data();
            const itemUpdate: Record<string, any> = {};

            // Sync Started_At: update if item has no start or inherited WO start
            if (updates.Started_At) {
                const oldWoStart = woData.Started_At;
                if (!item.Started_At || item.Started_At === oldWoStart) {
                    itemUpdate.Started_At = new Date(updates.Started_At).toISOString();
                }
            }

            // Sync Completed_At: update if item inherited WO completion
            if (updates.Completed_At && item.Status === 'Završeno') {
                const oldWoEnd = woData.Completed_At;
                if (item.Completed_At === oldWoEnd) {
                    itemUpdate.Completed_At = new Date(updates.Completed_At).toISOString();
                }
            }

            if (Object.keys(itemUpdate).length > 0) {
                await updateDoc(itemDoc.ref, itemUpdate);
            }
        }

        // 4. Full cascade recalculation (profit, labor cost, status sync)
        await recalculateWorkOrder(workOrderId);

        console.log(`[adjustWorkOrderDates] WO ${workOrderId} dates adjusted:`, updates);
        return { success: true, message: 'Datumi ažurirani' };
    } catch (error) {
        console.error('adjustWorkOrderDates error:', error);
        return { success: false, message: 'Greška pri ažuriranju datuma' };
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

            // FIX #1: Apply Profit_Overrides — user can override selling price per item
            // This ensures recalculateWorkOrder matches the profit modal badge
            const overrides = (item as any).Profit_Overrides;
            if (overrides?.Selling_Price != null && overrides.Selling_Price > 0) {
                itemValue = overrides.Selling_Price;
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

            // Include Transport and Services in profit calculation
            // FIX #1: Apply Profit_Overrides for Transport_Share if present
            const itemTransport = overrides?.Transport_Share != null ? overrides.Transport_Share : (item.Transport_Share || 0);
            transportCost += itemTransport;
            servicesCost += item.Services_Total || 0;

            plannedLaborCost += item.Planned_Labor_Cost || 0;

            // Calculate labor cost from work logs
            // FIX #5: If labor cost was manually overridden (manual_override source),
            // preserve the user's value — don't overwrite with auto-calculated cost.
            // Auto-attendance logs still recalculate normally.
            let freshItemLaborCost: number;
            const isManualOverride = (item as any).Labor_Cost_Source === 'manual_override';
            if (isManualOverride && (item.Actual_Labor_Cost || 0) > 0) {
                // Manual override: use the stored value (set by overrideWorkLogs)
                // Still recalculate from work_logs to stay in sync with manual entries
                freshItemLaborCost = await calculateActualLaborCost(item, workOrder.Organization_ID);
                // If work_logs exist, use them; otherwise fall back to stored value
                if (freshItemLaborCost === 0) {
                    freshItemLaborCost = item.Actual_Labor_Cost || 0;
                }
            } else {
                freshItemLaborCost = await calculateActualLaborCost(item, workOrder.Organization_ID);
            }
            actualLaborCost += freshItemLaborCost;

            // SYNC: Update item-level Material_Cost and Actual_Labor_Cost for consistency
            try {
                const itemRef = doc(firestore, COLLECTIONS.WORK_ORDER_ITEMS, item.ID);
                const updatePayload: Record<string, any> = {
                    Material_Cost: itemMaterialCost,
                    Actual_Labor_Cost: freshItemLaborCost
                };
                if ((item as any).Labor_Cost_Frozen === true) {
                    updatePayload.Labor_Cost_Updated_At = new Date().toISOString();
                }
                await updateDoc(itemRef, updatePayload);
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

        // NOTE: Profit calculation REMOVED — now handled by manual daily_profit_entries
        // Cost fields are still aggregated here for reference.

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
            // GAP-4 FIX: Pass organizationId for proper multi-tenancy isolation
            await syncProjectStatus(projectId, workOrder.Organization_ID);
        }
    } catch (error) {
        console.error('Error recalculating work order:', error);
        throw error;
    }
}

/**
 * Recalculate work orders for an organization.
 * Used after bulk attendance updates to avoid per-worker recalculation overhead.
 * 
 * GAP-2 FIX: Now also recalculates recently completed WOs (last 30 days)
 * so that retroactive attendance changes propagate to finished work orders.
 * 
 * @param includeCompleted - If true, also recalculates recently completed WOs
 */
export async function recalculateAllActiveWorkOrders(
    organizationId: string,
    options?: { includeCompleted?: boolean }
): Promise<void> {
    try {
        const firestore = getDb();

        // Always recalculate active WOs
        const activeWoQuery = query(
            collection(firestore, COLLECTIONS.WORK_ORDERS),
            where('Status', '==', 'U toku'),
            where('Organization_ID', '==', organizationId)
        );
        const activeSnap = await getDocs(activeWoQuery);

        let totalRecalculated = 0;

        for (const woDoc of activeSnap.docs) {
            const woId = woDoc.data().Work_Order_ID;
            try {
                await recalculateWorkOrder(woId);
                totalRecalculated++;
            } catch (err) {
                console.warn(`Failed to recalculate active WO ${woId}:`, err);
            }
        }

        // GAP-2 FIX: Also recalculate recently completed WOs when called from attendance context
        if (options?.includeCompleted) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const cutoffISO = thirtyDaysAgo.toISOString();

            const completedWoQuery = query(
                collection(firestore, COLLECTIONS.WORK_ORDERS),
                where('Status', '==', 'Završeno'),
                where('Organization_ID', '==', organizationId)
            );
            const completedSnap = await getDocs(completedWoQuery);

            for (const woDoc of completedSnap.docs) {
                const woData = woDoc.data();
                // Only recalculate if completed within the last 30 days
                if (woData.Completed_At && woData.Completed_At >= cutoffISO) {
                    try {
                        await recalculateWorkOrder(woData.Work_Order_ID);
                        totalRecalculated++;
                    } catch (err) {
                        console.warn(`Failed to recalculate completed WO ${woData.Work_Order_ID}:`, err);
                    }
                }
            }
        }

        console.log(`Batch recalculation: ${totalRecalculated} work orders recalculated (includeCompleted: ${!!options?.includeCompleted})`);
    } catch (error) {
        console.error('Error in batch recalculation:', error);
    }
}

/**
 * Sync product statuses in projects based on work order item statuses
 */
async function syncProductStatuses(items: any[]): Promise<void> {
    // BUG-3 FIX: Dynamic status hierarchy — supports custom production steps
    // Known lifecycle statuses in order. Custom processes get rank based on position
    // between 'Materijali spremni' and 'Spremno' (i.e., they are production steps).
    const KNOWN_STATUS_HIERARCHY = [
        'Na čekanju', 'Materijali naručeni', 'Materijali spremni',
        'Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje', 'Spremno',
        'Transport', 'Montaža', 'Čišćenje', 'Primopredaja', 'Instalirano'
    ];

    // BUG-3: Helper to get rank — unknown processes (custom steps) get a rank
    // between 'Materijali spremni' (2) and 'Spremno' (7), defaulting to 5
    // so they're treated as active production statuses
    function getStatusRank(status: string): number {
        const idx = KNOWN_STATUS_HIERARCHY.indexOf(status);
        if (idx >= 0) return idx;
        // Unknown/custom process → treat as mid-production (rank 5)
        return 5;
    }

    // BUG-8 FIX: Expanded map — last completed process → final product status
    const FINAL_STATUS_MAP: Record<string, string> = {
        'Sklapanje': 'Spremno',
        'Primopredaja': 'Instalirano',
        'Čišćenje': 'Instalirano',
        'Montaža': 'Instalirano',
    };

    try {
        const firestore = getDb();

        // Group items by project
        const projectUpdates = new Map<string, Map<string, { status: string; itemStatus: string }>>();

        for (const item of items) {
            if (!item.Project_ID || !item.Product_ID) continue;

            if (!projectUpdates.has(item.Project_ID)) {
                projectUpdates.set(item.Project_ID, new Map());
            }

            // Determine product status based on work order item processes
            let productStatus = 'Na čekanju';
            if (item.Status === 'Završeno') {
                const lastProcess = item.Processes?.[item.Processes.length - 1];
                const lastProcessName = lastProcess?.Process_Name || '';
                productStatus = FINAL_STATUS_MAP[lastProcessName] || 'Spremno';
            } else if (item.Status === 'U toku') {
                const activeProcess = item.Processes?.find((p: any) => p.Status === 'U toku');
                if (activeProcess) {
                    productStatus = activeProcess.Process_Name;
                } else {
                    const lastCompleted = [...(item.Processes || [])].reverse().find((p: any) => p.Status === 'Završeno');
                    productStatus = lastCompleted?.Process_Name || 'Sklapanje';
                }
            }

            // BUG-5 FIX: Store item status to allow regression when WO item moves backward
            projectUpdates.get(item.Project_ID)!.set(item.Product_ID, {
                status: productStatus,
                itemStatus: item.Status || 'Na čekanju'
            });
        }

        // Update products in separate 'products' collection
        const entries = Array.from(projectUpdates.entries());
        for (const [projectId, productStatuses] of entries) {
            const productsQuery = query(
                collection(firestore, 'products'),
                where('Project_ID', '==', projectId)
            );
            const productsSnap = await getDocs(productsQuery);
            if (productsSnap.empty) continue;

            for (const productDoc of productsSnap.docs) {
                const productData = productDoc.data();
                const update = productStatuses.get(productData.Product_ID);
                if (!update) continue;

                const currentRank = getStatusRank(productData.Status || '');
                const newRank = getStatusRank(update.status);

                // BUG-5 FIX: Allow regression in two cases:
                //   1. WO item is 'Na čekanju' (reset/reopened) → always sync
                //   2. WO item is 'U toku' but product is at a higher stage → regress to current step
                // Still prevent progression noise (only advance when new rank > current)
                const shouldUpdate = newRank > currentRank
                    || (update.itemStatus === 'Na čekanju' && update.status !== productData.Status)
                    || (update.itemStatus === 'U toku' && newRank < currentRank && currentRank < getStatusRank('Spremno'));

                if (shouldUpdate) {
                    await updateDoc(productDoc.ref, { Status: update.status });
                }
            }
        }
    } catch (error) {
        console.error('Error syncing product statuses:', error);
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

        // Skip only cancelled projects — projekti bez ponude (Nacrt/Ponuđeno) i dalje
        // moraju moći preći u "U proizvodnji" kad im se proizvod nađe u pokrenutom nalogu.
        if (project.Status === 'Otkazano') {
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
            // BUG-2 FIX: Filter by Organization_ID to prevent cross-tenant data leak
            const montazaConstraints = [
                where('Work_Order_Type', '==', 'Montaža'),
                where('Status', 'in', ['Na čekanju', 'U toku']),
            ];
            if (organizationId) {
                montazaConstraints.push(where('Organization_ID', '==', organizationId));
            }
            const montazaWoQuery = query(
                collection(firestore, COLLECTIONS.WORK_ORDERS),
                ...montazaConstraints
            );
            const montazaSnap = await getDocs(montazaWoQuery);
            for (const mDoc of montazaSnap.docs) {
                const mData = mDoc.data();
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

        // Jak signal: ima li projekat proizvod u POKRENUTOM nalogu ('U toku')?
        // Tada je projekat "U proizvodnji" bez obzira na ponudu i mikro-status proizvoda.
        let hasActiveWorkOrder = false;
        try {
            const activeWoConstraints = [where('Status', '==', 'U toku')] as any[];
            if (organizationId) activeWoConstraints.push(where('Organization_ID', '==', organizationId));
            const activeWoSnap = await getDocs(query(collection(firestore, COLLECTIONS.WORK_ORDERS), ...activeWoConstraints));
            for (const woDoc of activeWoSnap.docs) {
                const woData = woDoc.data();
                const itemsSnap = await getDocs(query(
                    collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                    where('Work_Order_ID', '==', woData.Work_Order_ID),
                    where('Project_ID', '==', projectId)
                ));
                if (!itemsSnap.empty) { hasActiveWorkOrder = true; break; }
            }
        } catch (err) {
            console.warn('syncProjectStatus: Error checking active WOs:', err);
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

        // BUG-1 FIX: Any product actively in production or montaža?
        // Added parentheses to fix operator precedence (|| binds after &&)
        const anyInProduction = products.some(p => {
            const status = p.Status || '';
            return (!waitingStatuses.includes(status)
                && status !== 'Spremno'
                && status !== 'Instalirano')
                || montazaActiveStatuses.includes(status);
        });

        const inProduction = anyInProduction || hasActiveWorkOrder;
        const preProduction = ['Nacrt', 'Ponuđeno', 'Odobreno'];
        let newStatus = project.Status;

        if (allComplete && !hasActiveWorkOrder && (project.Status === 'U proizvodnji' || project.Status === 'Odobreno')) {
            newStatus = 'Završeno';
        } else if (inProduction && preProduction.includes(project.Status)) {
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
 * Used for drag-and-drop stage changes AND worker assignment changes
 * 
 * REACTIVE: Detects worker changes in Processes and triggers work log reconciliation
 */
export async function updateAllItemProcesses(
    workOrderId: string,
    itemId: string,
    newProcesses: ItemProcessStatus[]
): Promise<void> {
    try {
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);

        // Read old processes to detect worker changes
        const oldProcesses: ItemProcessStatus[] = itemSnap.exists() ? (itemSnap.data().Processes || []) : [];
        const orgId = itemSnap.exists() ? (itemSnap.data() as any).Organization_ID || '' : '';

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

        // REACTIVE: Detect worker changes and reconcile work logs
        if (orgId) {
            const oldWorkerIds = extractWorkerIdsFromProcesses(oldProcesses);
            const newWorkerIds = extractWorkerIdsFromProcesses(sanitizedProcesses);

            const removedWorkerIds = Array.from(oldWorkerIds).filter(id => !newWorkerIds.has(id));
            const addedWorkerIds = Array.from(newWorkerIds).filter(id => !oldWorkerIds.has(id));

            if (removedWorkerIds.length > 0 || addedWorkerIds.length > 0) {
                await reconcileWorkLogsAfterWorkerChange(
                    workOrderId,
                    itemId,
                    removedWorkerIds,
                    addedWorkerIds,
                    Array.from(newWorkerIds),
                    orgId
                );
            }
        }

        // Recalculate item and work order status
        await recalculateItemStatus(workOrderId, itemId, sanitizedProcesses);
        await recalculateWorkOrder(workOrderId);
    } catch (error) {
        console.error('Error updating all item processes:', error);
        throw error;
    }
}

/**
 * Extract all worker IDs from a Processes array (main workers + helpers)
 */
function extractWorkerIdsFromProcesses(processes: ItemProcessStatus[]): Set<string> {
    const ids = new Set<string>();
    for (const proc of processes) {
        if (proc.Worker_ID) ids.add(proc.Worker_ID);
        if (proc.Helpers && Array.isArray(proc.Helpers)) {
            for (const h of proc.Helpers) {
                if (h.Worker_ID) ids.add(h.Worker_ID);
            }
        }
    }
    return ids;
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
