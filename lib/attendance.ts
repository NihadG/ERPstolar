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
import { itemMaterialTotal } from './materialCost';
import { computeMissingAttendanceDays } from './attendanceHistory';

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
        const startISO = formatLocalDateISO(startDate);
        const endISO = formatLocalDateISO(endDate);
        const inRange = (dateStr?: string) => !!dateStr && dateStr >= startISO && dateStr <= endISO;

        // 3. Šihtarica (worker_attendance) + SVE dnevnice (bilo koji nalog) za dodijeljene radnike.
        //    Chunked 'in' upit po Worker_ID (Firestore limit 30); raspon datuma filtriramo klijentski.
        const presentByWorkerDate = new Set<string>();   // radnik bio Prisutan/Teren u šihtarici
        const bookedByWorkerDate = new Set<string>();     // radnik ima dnevnicu na BILO kojem nalogu
        const CHUNK = 30;
        for (let i = 0; i < workerIds.length; i += CHUNK) {
            const chunk = workerIds.slice(i, i + CHUNK);
            const [attSnap, logSnap] = await Promise.all([
                getDocs(query(
                    collection(firestore, COLLECTIONS.WORKER_ATTENDANCE),
                    where('Worker_ID', 'in', chunk),
                    where('Organization_ID', '==', organizationId),
                )),
                getDocs(query(
                    collection(firestore, 'work_logs'),
                    where('Worker_ID', 'in', chunk),
                    where('Organization_ID', '==', organizationId),
                )),
            ]);
            attSnap.docs.forEach(d => {
                const a = d.data() as WorkerAttendance;
                if (inRange(a.Date) && (a.Status === 'Prisutan' || a.Status === 'Teren')) {
                    presentByWorkerDate.add(`${a.Worker_ID}_${a.Date}`);
                }
            });
            logSnap.docs.forEach(d => {
                const l = d.data() as WorkLog;
                if (inRange(l.Date)) bookedByWorkerDate.add(`${l.Worker_ID}_${l.Date}`);
            });
        }

        // 4. Prijavi SAMO dane gdje je radnik bio prisutan (šihtarica) a nema dnevnicu nigdje —
        //    (čista, testirana logika; ne prijavljuje rad na drugom nalogu ni odsustva).
        const missingDetails = computeMissingAttendanceDays({
            startISO, endISO,
            workers: workerIds.map(id => ({ id, name: assignedWorkers.get(id) || 'Unknown' })),
            presentByWorkerDate,
            bookedByWorkerDate,
        });

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

        // Active item with no labor booked yet → profit still incomplete (NIJE nužno greška prisustva:
        // rad se možda knjiži na drugi nalog, ili proizvod tek počinje). Poruka opisuje šta zaista znači.
        if (item.Status === 'U toku' && (!item.Actual_Labor_Cost || item.Actual_Labor_Cost <= 0)) {
            warnings.push({
                type: 'warning',
                icon: 'person_off',
                message: `Proizvod je u toku, a još nema knjiženog rada`,
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
    options?: { skipRecalculation?: boolean; skipAutoBook?: boolean; deleteManualOnAbsence?: boolean }
): Promise<{ success: boolean; affectedWorkOrders: string[]; workLogsCreated: number; workLogsDeleted: number; manualKept: number }> {
    try {
        // 1. Save the attendance record
        await saveWorkerAttendance(attendance);

        let workLogsCreated = 0;
        let workLogsDeleted = 0;
        let manualKept = 0;
        const affectedWorkOrderIds = new Set<string>();

        if (!attendance.Worker_ID || !attendance.Date || !attendance.Organization_ID) {
            return { success: true, affectedWorkOrders: [], workLogsCreated: 0, workLogsDeleted: 0, manualKept: 0 };
        }

        const firestore = getDb();

        // ═══════════════════════════════════════════════════════════════
        // MODEL (od 2026-06-27): Šihtarica AUTO-KNJIŽI dnevnicu prisutnih.
        //   - Prisutan / Teren  → auto-knjiži na AKTIVNE NEPAUZIRANE dodijeljene naloge
        //     (idempotentno; manualni unos ima prednost). Vidi autoBookPresentWorker / lib/autoBook.ts.
        //   - Odsutan/Bolovanje/Odmor/Vikend/Praznik → dnevnice tog dana se NE računaju
        //     → brišemo work logove tog radnika za taj dan.
        // ═══════════════════════════════════════════════════════════════
        const PRESENT_STATUSES = ['Prisutan', 'Teren'];
        const isAbsent = attendance.Status != null && !PRESENT_STATUSES.includes(attendance.Status);
        const isPresent = attendance.Status != null && PRESENT_STATUSES.includes(attendance.Status);

        // Pronađi naloge koji imaju dnevnice za ovog radnika/datum (za recalc)
        try {
            const existingLogsQ = query(
                collection(firestore, 'work_logs'),
                where('Worker_ID', '==', attendance.Worker_ID),
                where('Date', '==', attendance.Date),
                where('Organization_ID', '==', attendance.Organization_ID)
            );
            const existingLogsSnap = await getDocs(existingLogsQ);
            existingLogsSnap.docs.forEach(d => {
                const woId = d.data().Work_Order_ID;
                if (woId) affectedWorkOrderIds.add(woId);
            });
        } catch (err) {
            console.warn('Attendance WO lookup failed:', err);
        }

        // PRISUTAN/TEREN → auto-knjiži na aktivne nepauzirane dodijeljene naloge (idempotentno).
        // Kad UI vodi knjiženje kroz upit potvrde (šihtarica), prosljeđuje skipAutoBook:true —
        // tada se prisustvo samo snima, a dnevnice se knjiže nakon korisnikove potvrde.
        if (isPresent && !options?.skipAutoBook) {
            try {
                const auto = await autoBookPresentWorker(
                    attendance.Worker_ID, attendance.Worker_Name || '', attendance.Date, attendance.Organization_ID, attendance.Status!
                );
                workLogsCreated += auto.created;
                auto.affectedWorkOrderIds.forEach(id => affectedWorkOrderIds.add(id));
            } catch (autoErr) {
                console.warn('[ATTENDANCE] auto-book failed:', autoErr);
            }
        }

        // ODSUTAN → obriši dnevnice tog dana (ne računaju se).
        if (isAbsent) {
            try {
                // Po defaultu briši SAMO auto-knjižene; ručne (manual) zadrži osim ako pozivalac
                // eksplicitno traži brisanje (deleteManualOnAbsence — odluka korisnika kroz upit). Rizik #5.
                const cleanupResult = await deleteWorkLogsForWorkerOnDate(
                    attendance.Worker_ID,
                    attendance.Date,
                    attendance.Organization_ID,
                    options?.deleteManualOnAbsence ? undefined : { onlySource: 'attendance' }
                );
                workLogsDeleted = cleanupResult.deleted;
                manualKept = cleanupResult.manualKept;
                if (workLogsDeleted > 0 || manualKept > 0) {
                    console.log(`[ATTENDANCE] ${attendance.Worker_Name} ${attendance.Status} na ${attendance.Date} — obrisano ${workLogsDeleted} auto-dnevnica, zadržano ${manualKept} ručnih.`);
                }
            } catch (deleteError) {
                console.error('Work log cleanup on absence failed:', deleteError);
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

                // Čisto knjiženje rada ne mijenja materijal ni status proizvoda/projekta.
                await Promise.all(finalAffectedList.map(woId =>
                    recalculateWorkOrder(woId, { skipMaterialRefresh: true, skipStatusSync: true })
                ));
                console.log(`Recalculated ${finalAffectedList.length} work orders affected by attendance change.`);
            } catch (recalcError) {
                console.error('Failed to recalculate work orders after attendance change:', recalcError);
            }
        }

        return { success: true, affectedWorkOrders: finalAffectedList, workLogsCreated, workLogsDeleted, manualKept };
    } catch (error) {
        console.error('Error marking attendance:', error);
        throw error;
    }
}

/**
 * AUTO-KNJIŽENJE IZ ŠIHTARICE: kad je radnik PRISUTAN/TEREN, automatski proknjiži dnevnicu na
 * AKTIVNE NEPAUZIRANE naloge na kojima je DODIJELJEN (odluka: lib/autoBook.ts → selectAutoBookItemIds).
 * Idempotentno — preskače proizvode koji već imaju zapis tog dana (manualni unos ima prednost).
 * Bazni log (presence 1); konačnu DVONIVOVSKU podjelu radi renormalizeWorkerDay (po nalogu pa proizvodu).
 * Ne dira druge radnike. Odsutan/pauziran/nedodijeljen → ništa (osim ručno).
 */
export async function autoBookPresentWorker(
    workerId: string,
    workerName: string,
    date: string,
    organizationId: string,
    status: string
): Promise<{ created: number; affectedWorkOrderIds: string[] }> {
    if (!workerId || !date || !organizationId) return { created: 0, affectedWorkOrderIds: [] };
    if (status !== 'Prisutan' && status !== 'Teren') return { created: 0, affectedWorkOrderIds: [] };
    try {
        const fs = getDb();

        // Aktivni nalozi (U toku + nedavno Završeni) + njihove stavke
        const woSnap = await getDocs(query(
            collection(fs, COLLECTIONS.WORK_ORDERS),
            where('Organization_ID', '==', organizationId),
            where('Status', 'in', ['U toku', 'Završeno'])
        ));
        if (woSnap.empty) return { created: 0, affectedWorkOrderIds: [] };

        const orderMap = new Map<string, AutoBookOrder>();
        woSnap.docs.forEach(d => {
            const w = d.data();
            orderMap.set(w.Work_Order_ID, {
                Work_Order_ID: w.Work_Order_ID, Status: w.Status, Work_Order_Type: w.Work_Order_Type,
                Started_At: w.Started_At, Completed_At: w.Completed_At, items: [],
            });
        });

        const itemsSnap = await getDocs(query(
            collection(fs, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Organization_ID', '==', organizationId)
        ));
        const itemDataById = new Map<string, Record<string, unknown>>();
        itemsSnap.docs.forEach(d => {
            const it = d.data();
            const ord = orderMap.get(it.Work_Order_ID);
            if (!ord) return;
            ord.items.push({
                ID: it.ID, Status: it.Status, Is_Paused: it.Is_Paused, Completed_At: it.Completed_At,
                Assigned_Workers: it.Assigned_Workers, Processes: it.Processes, SubTasks: it.SubTasks,
            });
            itemDataById.set(it.ID, it);
        });

        // Postojeći logovi radnika za taj dan (idempotentnost)
        const logSnap = await getDocs(query(
            collection(fs, 'work_logs'),
            where('Worker_ID', '==', workerId),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        ));
        const loggedItemIds = new Set<string>();
        logSnap.docs.forEach(d => { const id = d.data().Work_Order_Item_ID; if (id) loggedItemIds.add(id); });

        const targetItemIds = selectAutoBookItemIds({
            workerId, date, status,
            orders: Array.from(orderMap.values()),
            hasExistingLog: (id) => loggedItemIds.has(id),
        });
        if (targetItemIds.length === 0) return { created: 0, affectedWorkOrderIds: [] };

        // Aditivno knjiženje + kanonska podjela delegira se zajedničkom pisaču.
        const targets: BookTarget[] = targetItemIds.map(itemId => {
            const it = itemDataById.get(itemId)!;
            return {
                workOrderId: it.Work_Order_ID as string,
                itemId: it.ID as string,
                productId: it.Product_ID as string | undefined,
            };
        });
        return await bookWorkerDayItems(workerId, workerName, date, organizationId, targets, 1);
    } catch (error) {
        console.error('autoBookPresentWorker error:', error);
        return { created: 0, affectedWorkOrderIds: [] };
    }
}

export interface BookTarget {
    workOrderId: string;
    itemId: string;
    productId?: string;
}

/**
 * ADITIVNI, IDEMPOTENTNI pisač dnevnice iz šihtarice: za (radnik, dan) proknjiži dnevnicu na
 * EKSPLICITNE ciljne stavke (targets). Preskače parove (radnik, stavka) koji već imaju zapis
 * tog dana (manualni/postojeći unos ima prednost — bez dupliranja). Bazni log (presence);
 * konačnu DVONIVOVSKU podjelu (po nalogu pa proizvodu) radi renormalizeWorkerDay. Ne dira
 * druge radnike. Koriste ga: šihtarica-upit (potvrđeni Prisutan/Teren ciljevi) i autoBookPresentWorker.
 */
export async function bookWorkerDayItems(
    workerId: string,
    workerName: string,
    date: string,
    organizationId: string,
    targets: BookTarget[],
    presence: number = 1
): Promise<{ created: number; affectedWorkOrderIds: string[] }> {
    if (!workerId || !date || !organizationId || !targets || targets.length === 0) {
        return { created: 0, affectedWorkOrderIds: [] };
    }
    try {
        const fs = getDb();

        // Postojeći logovi radnika za taj dan → idempotentnost (preskači već knjižene stavke).
        const logSnap = await getDocs(query(
            collection(fs, 'work_logs'),
            where('Worker_ID', '==', workerId),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        ));
        const loggedItemIds = new Set<string>();
        logSnap.docs.forEach(d => { const id = d.data().Work_Order_Item_ID; if (id) loggedItemIds.add(id); });

        // Stavke ciljeva (Product_ID fallback + item.Processes za auto-pripis tekućeg procesa).
        const itemMap = await fetchWorkOrderItemsByIds(targets.map(t => t.itemId).filter(Boolean), organizationId);

        // AUTO-PRIPIS PROCESA: graf naloga (jedan read po distinct nalogu) + tekući proces stavke
        // (prvi nezavršen u checklisti) → Process_Node_ID/Process_Name na logu. Ručni unos u Knjizi
        // rada i dalje ima prednost (ovaj put piše samo NOVE logove; postojeći se preskaču).
        const graphByWO = new Map<string, import('./types').ProcessGraph>();
        try {
            const { getProcessGraph } = await import('./database');
            const distinctWOs = Array.from(new Set(targets.map(t => t.workOrderId).filter(Boolean)));
            await Promise.all(distinctWOs.map(async woId => {
                graphByWO.set(woId, await getProcessGraph(woId, organizationId));
            }));
        } catch (e) { console.warn('process graph load for auto-pripis failed (non-critical):', e); }
        const { resolveAutoProcessNode } = await import('./productProcesses');

        const workers = await getWorkers(organizationId);
        // Cijena VAŽEĆA na datum knjiženja (efektivno-datirana istorija) — ne trenutna (rizik #2).
        const dailyRate = effectiveDailyRate(workers.find(w => w.Worker_ID === workerId), date);
        const norm = presence === 0.5 ? 0.5 : 1;

        const batch = writeBatch(fs);
        const affected = new Set<string>();
        const seen = new Set<string>();
        let created = 0;
        for (const t of targets) {
            if (!t.itemId || !t.workOrderId) continue;
            if (seen.has(t.itemId)) continue;              // dedupe unutar poziva
            seen.add(t.itemId);
            if (loggedItemIds.has(t.itemId)) continue;     // već ima zapis → preskoči (manualni ima prednost)
            const item = itemMap.get(t.itemId);
            const productId = t.productId || item?.Product_ID;
            const autoNode = resolveAutoProcessNode(graphByWO.get(t.workOrderId), t.itemId, item?.Processes);
            const log: Record<string, unknown> = {
                WorkLog_ID: generateUUID(), Organization_ID: organizationId, Date: date,
                Worker_ID: workerId, Worker_Name: workerName, Daily_Rate: dailyRate, Original_Daily_Rate: dailyRate,
                Day_Fraction: norm, Presence: norm, Split_Factor: 1, Hours_Worked: 8 * norm,
                Booking_Source: 'attendance', Is_From_Attendance: true,
                Work_Order_ID: t.workOrderId, Work_Order_Item_ID: t.itemId, Product_ID: productId,
                ...(autoNode && { Process_Node_ID: autoNode.id, Process_Name: autoNode.name }),
                Created_At: new Date().toISOString(),
            };
            Object.keys(log).forEach(k => log[k] === undefined && delete log[k]);
            batch.set(doc(collection(fs, 'work_logs')), log);
            affected.add(t.workOrderId);
            created++;
        }
        if (created === 0) return { created: 0, affectedWorkOrderIds: [] };
        await batch.commit();

        // Kanonska dvonivovska podjela preko cijelog radnikovog dana (uklj. druge naloge/manualno).
        const wos = await renormalizeWorkerDay(workerId, date, organizationId, norm);
        wos.forEach(id => affected.add(id));
        return { created, affectedWorkOrderIds: Array.from(affected) };
    } catch (error) {
        // NE gutati grešku tiho: ranije se ovdje vraćalo {created:0} bez obzira na uzrok, pa je
        // korisnik vidio zbunjujuću poruku "Dnevnice nisu knjižene" (kao da nema šta da se
        // knjiži) čak i kad je stvarni uzrok bio pravi izuzetak (npr. Firestore greška).
        // Sad se greška baca dalje — pozivaoci (commitDecisions i sl.) je hvataju i prikazuju
        // pravu poruku "Greška pri knjiženju dnevnica", a stvarni uzrok ostaje u konzoli.
        console.error('bookWorkerDayItems error:', error);
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
    dayFraction?: number;       // DEPRECATED — podjela se sada računa ravnomjerno (presence / N). Ignoriše se.
    processes?: string[];       // opcioni procesi koje je radnik radio (ne utiče na trošak)
    processNodeId?: string;     // izabrani čvor grafa procesa (za auto-datum/status u grafu)
}
export interface DailyBookingEntryInput {
    workerId: string;
    presence?: number;          // Prisutnost radnika za taj dan: 1 (cijeli) ili 0.5 (pola). Default 1.
    items: DailyBookingItemInput[];
}

export interface DailyBookingItemView {
    workOrderItemId: string;
    workOrderId: string;
    productName: string;
    projectName: string;
    dayFraction: number;        // = Day_Fraction zapisa (presence / N) — za informaciju
    processes?: string[];
    processNodeId?: string;     // izabrani čvor grafa procesa
    amount: number;             // KM koje su pale na ovaj proizvod (Daily_Rate zapisa)
}
export interface DailyBookingEntryView {
    workerId: string;
    workerName: string;
    dailyRate: number;
    presence: number;           // Prisutnost radnika za taj dan (1 ili 0.5), rekonstruisana iz zapisa
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

// ════════════════════════════════════════════════════════════════════
// KANONSKA PODJELA DNEVNICE — jedini izvor istine za iznos po proizvodu.
// Čista logika je u lib/laborSplit.ts (bez Firebase, pokrivena testovima).
// ════════════════════════════════════════════════════════════════════
export { splitDnevnica, splitDnevnicaExact, splitDnevnicaByOrder, normalizePresence } from './laborSplit';
import { splitDnevnicaExact, splitDnevnicaByOrder, effectiveDailyRate } from './laborSplit';
import { selectAutoBookItemIds, type AutoBookOrder } from './autoBook';

/**
 * Ravnomjerno raspodijeli dnevnicu radnika preko SVIH njegovih logova na dati datum
 * (cijela organizacija, kroz sve naloge). IDEMPOTENTNO. Garantuje invarijantu:
 *   Σ Daily_Rate (svi proizvodi radnika tog dana) = Original_Daily_Rate × Presence.
 * Vraća skup pogođenih Work_Order_ID (za naknadni recalculateWorkOrder).
 */
export async function renormalizeWorkerDay(
    workerId: string,
    date: string,
    organizationId: string,
    presenceHint?: number
): Promise<Set<string>> {
    const affected = new Set<string>();
    if (!workerId || !date || !organizationId) return affected;
    const firestore = getDb();
    const snap = await getDocs(query(
        collection(firestore, 'work_logs'),
        where('Worker_ID', '==', workerId),
        where('Date', '==', date),
        where('Organization_ID', '==', organizationId)
    ));
    if (snap.empty) return affected;

    // Rizik #8: isključi logove OBRISANIH naloga iz podjele (ne smiju naduvati preostale naloge).
    const docs = snap.docs.filter(d => d.data().Work_Order_Deleted !== true);
    if (docs.length === 0) return affected;

    // presence je per-(radnik, dan): hint (zadnja korisnička namjera) ima prednost,
    // inače eksplicitni Presence sa zapisa, inače 1.
    let presence = 1;
    if (presenceHint === 0.5 || presenceHint === 1) {
        presence = presenceHint;
    } else {
        for (const d of docs) {
            const p = d.data().Presence;
            if (p === 0.5 || p === 1) { presence = p; break; }
        }
    }
    // GARDA (#9): upozori (ne nadjačavaj tiho) ako dan već ima drugačiju prisutnost
    // (npr. ručno pola dana + auto cijeli) — pomaže da se uoči konflikt više izvora/uređaja.
    const distinctPresence = new Set<number>(
        docs.map(d => d.data().Presence).filter((p: unknown): p is number => p === 0.5 || p === 1)
    );
    if (distinctPresence.size > 1 || (distinctPresence.size === 1 && !distinctPresence.has(presence))) {
        console.warn(`[renormalizeWorkerDay] konflikt prisutnosti ${workerId} @ ${date}: postoji ${Array.from(distinctPresence).join('/')}, primjenjujem ${presence}.`);
    }
    // dnevnica = Original_Daily_Rate; fallback na trenutnu dnevnicu radnika ako nedostaje
    let dnevnica = 0;
    for (const d of docs) {
        const o = d.data().Original_Daily_Rate;
        if (typeof o === 'number' && o > 0) { dnevnica = o; break; }
    }
    if (dnevnica <= 0) {
        const workers = await getWorkers(organizationId);
        dnevnica = effectiveDailyRate(workers.find(w => w.Worker_ID === workerId), date);
    }
    // GARDA (#1): ako i dalje nemamo dnevnicu (radnik obrisan / bez cijene) — NE upisuj nule;
    // ostavi postojeće logove netaknute da se istorijski trošak ne izgubi.
    if (dnevnica <= 0) {
        console.warn(`[renormalizeWorkerDay] preskočeno: nepoznata dnevnica za ${workerId} @ ${date} — ne nuliram ${docs.length} log(ova).`);
        return affected;
    }

    // DVONIVOVSKA PODJELA: grupiši logove po NALOGU → udio po nalogu, pa po proizvodu.
    // (jedan nalog → identično ravnomjernoj podjeli; više naloga → svaki nalog dobije jednak udio)
    const orderIds: string[] = [];
    const byOrder = new Map<string, typeof docs>();
    docs.forEach(d => {
        const woId = (d.data().Work_Order_ID as string) || '__none__';
        if (!byOrder.has(woId)) { byOrder.set(woId, [] as unknown as typeof docs); orderIds.push(woId); }
        (byOrder.get(woId) as typeof docs).push(d);
    });
    const { amounts, dayFractions } = splitDnevnicaByOrder(dnevnica, presence, orderIds.map(id => byOrder.get(id)!.length));

    const batch = writeBatch(firestore);
    let changed = 0;
    orderIds.forEach((woId, oi) => {
        const group = byOrder.get(woId)!;
        const splitFactor = orderIds.length * group.length;  // efektivni djelitelj za proizvod
        group.forEach((d, j) => {
            const data = d.data();
            if (data.Work_Order_ID) affected.add(data.Work_Order_ID);
            const amount = amounts[oi][j];
            const dayFraction = dayFractions[oi][j];
            const needsUpdate =
                Math.abs((data.Daily_Rate || 0) - amount) > 0.001 ||
                Math.abs((data.Day_Fraction ?? 1) - dayFraction) > 0.0001 ||
                (data.Split_Factor || 0) !== splitFactor ||
                (data.Original_Daily_Rate || 0) !== dnevnica ||
                (data.Presence ?? 1) !== presence;
            if (needsUpdate) {
                batch.update(d.ref, {
                    Daily_Rate: amount,
                    Day_Fraction: dayFraction,
                    Split_Factor: splitFactor,
                    Original_Daily_Rate: dnevnica,
                    Presence: presence,
                });
                changed++;
            }
        });
    });
    if (changed > 0) await batch.commit();
    return affected;
}

/**
 * JEDNOKRATNA MIGRACIJA — uskladi SVE postojeće work logove s kanonskim modelom.
 * Grupiše po (radnik, datum), ravnomjerno raspoređuje dnevnicu (presence iz zapisa ili 1),
 * čisti zastarjele Labor_Cost_Frozen/Labor_Cost_Source oznake i preračuna sve pogođene naloge.
 */
export async function recalcAllWorkLogSplits(
    organizationId: string
): Promise<{ success: boolean; pairs: number; logs: number; workOrders: number; message: string }> {
    if (!organizationId) return { success: false, pairs: 0, logs: 0, workOrders: 0, message: 'Organization ID je obavezan' };
    try {
        const firestore = getDb();
        const workers = await getWorkers(organizationId);
        const rateOf = new Map(workers.map(w => [w.Worker_ID, w.Daily_Rate || 0]));

        const snap = await getDocs(query(
            collection(firestore, 'work_logs'),
            where('Organization_ID', '==', organizationId)
        ));
        if (snap.empty) return { success: true, pairs: 0, logs: 0, workOrders: 0, message: 'Nema zapisa rada za preračun' };

        // Grupiši po (radnik, datum)
        type LogDoc = (typeof snap.docs)[number];
        const groups = new Map<string, LogDoc[]>();
        snap.docs.forEach(d => {
            const x = d.data();
            const key = `${x.Worker_ID}__${x.Date}`;
            const arr = groups.get(key) || [];
            arr.push(d);
            groups.set(key, arr);
        });

        const affectedWO = new Set<string>();
        const itemLabor = new Map<string, number>();   // itemId -> Σ Daily_Rate (novi raspoređeni iznosi)
        let logsUpdated = 0;
        let batch = writeBatch(firestore);
        let ops = 0;
        const flush = async () => { if (ops > 0) { await batch.commit(); batch = writeBatch(firestore); ops = 0; } };

        for (const docs of Array.from(groups.values())) {
            let presence = 1;
            for (const d of docs) { const p = d.data().Presence; if (p === 0.5 || p === 1) { presence = p; break; } }
            let dnevnica = 0;
            for (const d of docs) { const o = d.data().Original_Daily_Rate; if (typeof o === 'number' && o > 0) { dnevnica = o; break; } }
            if (dnevnica <= 0) dnevnica = rateOf.get(docs[0].data().Worker_ID) || 0;

            // DVONIVOVSKA PODJELA: grupiši (radnik,dan) logove po NALOGU → udio po nalogu, pa po proizvodu.
            const orderIds: string[] = [];
            const byOrder = new Map<string, LogDoc[]>();
            docs.forEach(d => {
                const woId = (d.data().Work_Order_ID as string) || '__none__';
                if (!byOrder.has(woId)) { byOrder.set(woId, []); orderIds.push(woId); }
                byOrder.get(woId)!.push(d);
            });
            const { amounts, dayFractions } = splitDnevnicaByOrder(dnevnica, presence, orderIds.map(id => byOrder.get(id)!.length));

            orderIds.forEach((woId, oi) => {
                const group = byOrder.get(woId)!;
                const splitFactor = orderIds.length * group.length;
                group.forEach((d, j) => {
                    const data = d.data();
                    if (data.Work_Order_ID) affectedWO.add(data.Work_Order_ID);
                    const itemId = data.Work_Order_Item_ID;
                    const amount = amounts[oi][j];
                    if (itemId) itemLabor.set(itemId, Math.round(((itemLabor.get(itemId) || 0) + amount) * 100) / 100);
                    batch.update(d.ref, {
                        Daily_Rate: amount,
                        Day_Fraction: dayFractions[oi][j],
                        Split_Factor: splitFactor,
                        Original_Daily_Rate: dnevnica,
                        Presence: presence,
                    });
                    logsUpdated++; ops++;
                });
            });
            if (ops >= 400) await flush();
        }
        await flush();

        // BRZI UPIS TROŠKA: direktno upiši Actual_Labor_Cost na stavke + naloge (Σ Daily_Rate),
        // očisti zastarjele override oznake. BEZ teškog recalc-a (bez materijala/backfilla/snapshot/sync)
        // i paralelno u grupama → migracija je brza čak i za mnogo naloga.
        const woIds = Array.from(affectedWO);
        const CHUNK = 5;
        for (let i = 0; i < woIds.length; i += CHUNK) {
            const chunk = woIds.slice(i, i + CHUNK);
            await Promise.all(chunk.map(async (woId) => {
                try {
                    const [itemsSnap, woSnap] = await Promise.all([
                        getDocs(query(collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS), where('Work_Order_ID', '==', woId))),
                        getDocs(query(collection(firestore, COLLECTIONS.WORK_ORDERS), where('Work_Order_ID', '==', woId))),
                    ]);
                    const ib = writeBatch(firestore);
                    let woLabor = 0;
                    itemsSnap.docs.forEach(d => {
                        const x = d.data();
                        const labor = Math.round((itemLabor.get(x.ID) || 0) * 100) / 100;
                        woLabor += labor;
                        const payload: Record<string, any> = { Actual_Labor_Cost: labor };
                        if (x.Labor_Cost_Frozen || x.Labor_Cost_Source) { payload.Labor_Cost_Frozen = false; payload.Labor_Cost_Source = 'work_logs'; }
                        ib.update(d.ref, payload);
                    });
                    woLabor = Math.round(woLabor * 100) / 100;
                    woSnap.docs.forEach(d => ib.update(d.ref, { Actual_Labor_Cost: woLabor, Labor_Cost: woLabor }));
                    await ib.commit();
                } catch (e) { console.warn('[recalcAll] WO labor update failed for', woId, e); }
            }));
        }

        return {
            success: true,
            pairs: groups.size,
            logs: logsUpdated,
            workOrders: affectedWO.size,
            message: `Preračunato ${logsUpdated} zapisa · ${groups.size} radnik-dan · ${affectedWO.size} naloga`,
        };
    } catch (error) {
        console.error('recalcAllWorkLogSplits error:', error);
        return { success: false, pairs: 0, logs: 0, workOrders: 0, message: 'Greška pri preračunu dnevnica' };
    }
}

/**
 * Spremi dnevnu knjigu rada za dati dan. Booking je IZVOR ISTINE:
 * za svakog radnika u `entries` briše postojeće work logove tog dana i piše nove.
 * Dnevnica radnika (× presence) se RAVNOMJERNO dijeli na N proizvoda (splitDnevnicaExact).
 *
 * @deprecated Bez UI pozivaoca od uklanjanja DailyWorkBookingBoard-a (jul 2026).
 * Živi put je `saveWorkOrderDayBooking` (per-nalog, iz WorkOrderWorkLog). Ne koristiti za novi kod.
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
        let skippedAbsent = 0;

        // POTVRDA IZ ŠIHTARICE: radnik označen odsutnim (ne Prisutan/Teren) tog dana → dnevnica se NE računa
        const absentWorkerIds = new Set<string>();
        try {
            const fs = getDb();
            const attSnap = await getDocs(query(
                collection(fs, COLLECTIONS.WORKER_ATTENDANCE),
                where('Date', '==', date),
                where('Organization_ID', '==', organizationId)
            ));
            attSnap.docs.forEach(d => {
                const a = d.data() as WorkerAttendance;
                if (a.Status && a.Status !== 'Prisutan' && a.Status !== 'Teren') absentWorkerIds.add(a.Worker_ID);
            });
        } catch (e) { console.warn('saveDailyWorkBooking attendance lookup failed:', e); }

        // JEDAN upit za sve logove tog dana (mala lista) → pre-affected nalozi + ref-ovi za brisanje
        // postojećih logova radnika iz unosa (clean slate). Briše se + kreira u BATCH-u (ne po stavci).
        const fs = getDb();
        const entryWorkerIds = new Set(entries.map(e => e.workerId));
        const toDelete: any[] = [];
        try {
            const dayLogsSnap = await getDocs(query(
                collection(fs, 'work_logs'),
                where('Date', '==', date),
                where('Organization_ID', '==', organizationId)
            ));
            dayLogsSnap.docs.forEach(d => {
                const x = d.data();
                if (!entryWorkerIds.has(x.Worker_ID)) return;
                if (x.Work_Order_ID) affected.add(x.Work_Order_ID);  // osvježi i naloge gdje je rad ranije bio
                toDelete.push(d.ref);
            });
        } catch (e) { console.warn('saveDailyWorkBooking day-logs lookup failed:', e); }

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

        // Sastavi SVE nove logove (clean-slate brisanja su već skupljena u `toDelete`).
        const newLogs: Record<string, any>[] = [];
        for (const entry of entries) {
            const worker = workers.find(w => w.Worker_ID === entry.workerId);
            const dailyRate = worker?.Daily_Rate || 0;
            const workerName = worker?.Name || 'Nepoznat';

            // POTVRDA: radnik označen odsutnim tog dana → dnevnica se ne računa
            if (absentWorkerIds.has(entry.workerId) && entry.items.length > 0) { skippedAbsent++; continue; }

            // DVONIVOVSKA PODJELA: dnevnica × presence → RAVNOMJERNO po NALOGU, pa po proizvodu unutar naloga.
            // (npr. nalog A s 12 proizvoda + nalog B s 1 proizvodom, cijeli dan → 65 KM na A i 65 KM na B,
            //  a NE 130/13 na sve. Jedan nalog → identično ravnomjernoj podjeli.)
            const validItems = entry.items.filter(it => itemMap.get(it.workOrderItemId));
            const presence = entry.presence === 0.5 ? 0.5 : 1;
            if (validItems.length === 0) continue;

            // Svaku stavku mapiraj na CILJNI (troškovni) proizvod/nalog: povezani custom zadatak → povezani proizvod.
            const mapped = validItems.map(item => {
                const booked = itemMap.get(item.workOrderItemId)!;
                const linked = (booked.Item_Type === 'custom' && booked.Linked_Item_ID)
                    ? itemMap.get(booked.Linked_Item_ID)
                    : undefined;
                return { item, booked, linked, target: linked || booked };
            });
            // Grupiši po CILJNOM nalogu (stabilan redoslijed unosa)
            const orderIds: string[] = [];
            const byOrder = new Map<string, typeof mapped>();
            for (const m of mapped) {
                const woId = (m.target.Work_Order_ID as string) || '__none__';
                if (!byOrder.has(woId)) { byOrder.set(woId, []); orderIds.push(woId); }
                byOrder.get(woId)!.push(m);
            }
            const { amounts, dayFractions } = splitDnevnicaByOrder(dailyRate, presence, orderIds.map(id => byOrder.get(id)!.length));

            orderIds.forEach((woId, oi) => {
                const group = byOrder.get(woId)!;
                const splitFactor = orderIds.length * group.length;             // efektivni djelitelj za proizvod
                const hoursPerItem = Math.round((8 * presence / splitFactor) * 10) / 10;
                group.forEach((m, j) => {
                    const { item, booked, linked, target } = m;
                    const amount = amounts[oi][j] ?? 0;
                    const processName = linked ? booked.Product_Name : undefined;
                    const processTags = Array.from(new Set((item.processes || []).map(p => p.trim()).filter(Boolean)));

                    const log: Record<string, any> = {
                        WorkLog_ID: generateUUID(),
                        Organization_ID: organizationId,
                        Date: date,
                        Worker_ID: entry.workerId,
                        Worker_Name: workerName,
                        Daily_Rate: amount,
                        Original_Daily_Rate: dailyRate,
                        Day_Fraction: dayFractions[oi][j],
                        Presence: presence,
                        Split_Factor: splitFactor,
                        Hours_Worked: hoursPerItem,
                        Booking_Source: 'manual',
                        Is_From_Attendance: false,
                        Work_Order_ID: target.Work_Order_ID,
                        Work_Order_Item_ID: target.ID,
                        Product_ID: target.Product_ID,
                        Process_Name: processName,
                        Process_Tags: processTags.length > 0 ? processTags : undefined,
                        Process_Node_ID: item.processNodeId,
                        Created_At: new Date().toISOString(),
                    };
                    Object.keys(log).forEach(k => log[k] === undefined && delete log[k]);
                    newLogs.push(log);
                    logsCreated++;
                    if (target.Work_Order_ID) affected.add(target.Work_Order_ID);
                });
            });
        }

        // BATCH: brisanja starih + upis novih (max 450 ops po batchu) → minimalan broj round-tripova.
        const ops: Array<{ del?: any; set?: Record<string, any> }> = [
            ...toDelete.map(ref => ({ del: ref })),
            ...newLogs.map(l => ({ set: l })),
        ];
        for (let i = 0; i < ops.length; i += 450) {
            const b = writeBatch(fs);
            for (const op of ops.slice(i, i + 450)) {
                if (op.del) b.delete(op.del);
                else if (op.set) b.set(doc(collection(fs, 'work_logs')), op.set);
            }
            await b.commit();
        }

        const affectedList = Array.from(affected);
        // Labor-only preračun: bez snapshota, bez status-sync i bez ponovnog dohvata materijala
        // (unos dnevnice ne mijenja status ni materijal) → bitno brže spremanje.
        await Promise.all(affectedList.map(id =>
            recalculateWorkOrder(id, { skipSnapshot: true, skipStatusSync: true, skipMaterialRefresh: true })
                .catch(err => console.warn('recalc failed', id, err))
        ));

        const msg = skippedAbsent > 0
            ? `Spremljeno ${logsCreated} zapisa rada · ${skippedAbsent} radnik(a) preskočen(o) (označen odsutan u šihtarici)`
            : `Spremljeno ${logsCreated} zapisa rada`;
        return { success: true, logsCreated, affectedWorkOrders: affectedList, message: msg };
    } catch (error) {
        console.error('saveDailyWorkBooking error:', error);
        return { success: false, logsCreated: 0, affectedWorkOrders: [], message: 'Greška pri spremanju knjige rada' };
    }
}

export interface WorkOrderDayEntryInput {
    workerId: string;
    presence: number;        // 1 = cijeli dan, 0.5 = pola dana
    itemIds: string[];       // proizvodi OVOG naloga na kojima je radnik radio taj dan
}

/**
 * Spremi knjigu rada za JEDAN nalog i JEDAN dan ("Knjiga rada naloga").
 * `entries` je KOMPLETNO stanje tog naloga za taj dan (izvor istine).
 *
 * Razlika od `saveDailyWorkBooking` (koji briše CIJELI radnikov dan kroz sve naloge):
 * ovdje je clean-slate SCOPED na (nalog × dan) — logovi istog radnika na DRUGIM nalozima
 * tog dana ostaju netaknuti. Konačna (dvonivovska) podjela dnevnice se određuje u
 * `renormalizeWorkerDay` preko SVIH radnikovih logova tog dana (uklj. druge naloge).
 *
 * Knjiženje je dozvoljeno i za pauzirane/završene dane — trošak je nezavisan od statusa
 * (dan s logom je radni dan). Status proizvoda se NE mijenja.
 */
export async function saveWorkOrderDayBooking(
    workOrderId: string,
    date: string,
    organizationId: string,
    entries: WorkOrderDayEntryInput[]
): Promise<{ success: boolean; logsCreated: number; affectedWorkOrders: string[]; message: string }> {
    if (!organizationId || !date || !workOrderId) {
        return { success: false, logsCreated: 0, affectedWorkOrders: [], message: 'Nedostaju nalog, datum ili organizacija' };
    }
    try {
        const fs = getDb();
        const workers = await getWorkers(organizationId);
        const affected = new Set<string>([workOrderId]);
        const affectedWorkers = new Set<string>();
        let logsCreated = 0;
        let skippedAbsent = 0;

        // POTVRDA IZ ŠIHTARICE: radnik označen odsutnim tog dana → dnevnica se NE računa
        const absentWorkerIds = new Set<string>();
        try {
            const attSnap = await getDocs(query(
                collection(fs, COLLECTIONS.WORKER_ATTENDANCE),
                where('Date', '==', date),
                where('Organization_ID', '==', organizationId)
            ));
            attSnap.docs.forEach(d => {
                const a = d.data() as WorkerAttendance;
                if (a.Status && a.Status !== 'Prisutan' && a.Status !== 'Teren') absentWorkerIds.add(a.Worker_ID);
            });
        } catch (e) { console.warn('saveWorkOrderDayBooking attendance lookup failed:', e); }

        // CLEAN-SLATE SCOPED: obriši SVE logove OVOG naloga za taj dan (kompletno stanje dolazi iz `entries`).
        // Logovi drugih naloga (isti radnik, isti dan) se NE diraju.
        const toDelete: import('firebase/firestore').DocumentReference[] = [];
        // ISTORIJA ATRIBUCIJE: sačuvaj proces sa STARIH logova (workerId|itemId → node/name) —
        // retroaktivna izmjena prošlog dana NE smije pre-atribuirati rad na DANAŠNJI tekući proces.
        const oldAttr = new Map<string, { nodeId?: string; name?: string }>();
        try {
            const daySnap = await getDocs(query(
                collection(fs, 'work_logs'),
                where('Work_Order_ID', '==', workOrderId),
                where('Date', '==', date),
                where('Organization_ID', '==', organizationId)
            ));
            daySnap.docs.forEach(d => {
                toDelete.push(d.ref);
                const x = d.data();
                if (x.Worker_ID) affectedWorkers.add(x.Worker_ID);     // i uklonjeni radnici se renormalizuju
                const attrKey = `${x.Worker_ID}|${x.Work_Order_Item_ID}`;
                if (!oldAttr.has(attrKey) && (x.Process_Node_ID || x.Process_Name)) {
                    oldAttr.set(attrKey, { nodeId: x.Process_Node_ID, name: x.Process_Name });
                }
            });
        } catch (e) { console.warn('saveWorkOrderDayBooking day-logs lookup failed:', e); }

        // Proizvodi ovog naloga (validacija + Product_ID po stavci)
        const itemIds = Array.from(new Set(entries.flatMap(e => e.itemIds)));
        const itemMap = await fetchWorkOrderItemsByIds(itemIds, organizationId);

        // AUTO-PRIPIS PROCESA: graf naloga + tekući proces stavke (prvi nezavršen u checklisti)
        // → Process_Node_ID/Process_Name na logu (odgovor na "koji proces, koji dan, koji radnik").
        let orderGraph: import('./types').ProcessGraph | undefined;
        try {
            const { getProcessGraph } = await import('./database');
            orderGraph = await getProcessGraph(workOrderId, organizationId);
        } catch (e) { console.warn('process graph load for auto-pripis failed (non-critical):', e); }
        const { resolveAutoProcessNode } = await import('./productProcesses');

        // Bazni logovi (puna dnevnica + presence; TAČAN iznos postavlja renormalizeWorkerDay)
        const newLogs: Record<string, unknown>[] = [];
        for (const entry of entries) {
            const worker = workers.find(w => w.Worker_ID === entry.workerId);
            const dailyRate = worker?.Daily_Rate || 0;
            const workerName = worker?.Name || 'Nepoznat';
            affectedWorkers.add(entry.workerId);

            if (absentWorkerIds.has(entry.workerId) && entry.itemIds.length > 0) { skippedAbsent++; continue; }

            const presence = entry.presence === 0.5 ? 0.5 : 1;
            const validItemIds = entry.itemIds.filter(id => itemMap.get(id));
            if (validItemIds.length === 0) continue;

            for (const itemId of validItemIds) {
                const booked = itemMap.get(itemId)!;
                // PROŠLI dan + postojeći (radnik,stavka) par → zadrži ISTORIJSKU atribuciju procesa;
                // auto-pripis (tekući proces) važi za danas i za nove parove.
                const carried = date < formatLocalDateISO(new Date()) ? oldAttr.get(`${entry.workerId}|${itemId}`) : undefined;
                const autoNode = carried ? null : resolveAutoProcessNode(orderGraph, itemId, booked.Processes);
                const attr = carried
                    ? { ...(carried.nodeId && { Process_Node_ID: carried.nodeId }), ...(carried.name && { Process_Name: carried.name }) }
                    : (autoNode ? { Process_Node_ID: autoNode.id, Process_Name: autoNode.name } : {});
                const log: Record<string, unknown> = {
                    WorkLog_ID: generateUUID(),
                    Organization_ID: organizationId,
                    Date: date,
                    Worker_ID: entry.workerId,
                    Worker_Name: workerName,
                    Daily_Rate: dailyRate,            // placeholder — renormalizeWorkerDay postavlja tačno
                    Original_Daily_Rate: dailyRate,
                    Day_Fraction: presence,
                    Presence: presence,
                    Split_Factor: 1,
                    Hours_Worked: 8 * presence,
                    Booking_Source: 'manual',
                    Is_From_Attendance: false,
                    Work_Order_ID: booked.Work_Order_ID || workOrderId,
                    Work_Order_Item_ID: booked.ID,
                    Product_ID: booked.Product_ID,
                    ...attr,
                    Created_At: new Date().toISOString(),
                };
                Object.keys(log).forEach(k => log[k] === undefined && delete log[k]);
                newLogs.push(log);
                logsCreated++;
                if (booked.Work_Order_ID) affected.add(booked.Work_Order_ID);
            }
        }

        // BATCH: brisanja + upis (max 450 ops/batch)
        const ops: Array<{ del?: import('firebase/firestore').DocumentReference; set?: Record<string, unknown> }> = [
            ...toDelete.map(ref => ({ del: ref })),
            ...newLogs.map(l => ({ set: l })),
        ];
        for (let i = 0; i < ops.length; i += 450) {
            const b = writeBatch(fs);
            for (const op of ops.slice(i, i + 450)) {
                if (op.del) b.delete(op.del);
                else if (op.set) b.set(doc(collection(fs, 'work_logs')), op.set);
            }
            await b.commit();
        }

        // KANONSKA dvonivovska podjela: za svaki pogođeni (radnik, dan) preraspodijeli preko SVIH
        // radnikovih logova tog dana (po nalogu pa po proizvodu). presence iz entries pobjeđuje.
        const presenceByWorker = new Map<string, number>();
        entries.forEach(e => presenceByWorker.set(e.workerId, e.presence === 0.5 ? 0.5 : 1));
        for (const wid of Array.from(affectedWorkers)) {
            try {
                const wos = await renormalizeWorkerDay(wid, date, organizationId, presenceByWorker.get(wid));
                wos.forEach(id => affected.add(id));
            } catch (e) { console.warn('[saveWorkOrderDayBooking] renormalize failed', wid, e); }
        }

        // Preračun pogođenih naloga (labor-only → brzo)
        await Promise.all(Array.from(affected).map(id =>
            recalculateWorkOrder(id, { skipSnapshot: true, skipStatusSync: true, skipMaterialRefresh: true })
                .catch(err => console.warn('[saveWorkOrderDayBooking] recalc failed', id, err))
        ));

        const msg = skippedAbsent > 0
            ? `Spremljeno ${logsCreated} zapisa · ${skippedAbsent} radnik(a) preskočen(o) (odsutan u šihtarici)`
            : `Spremljeno ${logsCreated} zapisa rada`;
        return { success: true, logsCreated, affectedWorkOrders: Array.from(affected), message: msg };
    } catch (error) {
        console.error('saveWorkOrderDayBooking error:', error);
        return { success: false, logsCreated: 0, affectedWorkOrders: [], message: 'Greška pri spremanju knjige rada naloga' };
    }
}

/**
 * BRZI RETROSPEKTIVNI UNOS — za zaboravljene naloge.
 * Za svaki radni dan u rasponu, dnevnica svakog radnika se RAVNOMJERNO podijeli na izabrane proizvode
 * (Day_Fraction = 1/N). Total rada = radnici × dani × dnevnica. Preskače dane gdje već postoji zapis
 * (workLogExists) → bezbjedno za ponovni unos. Pojedinačno se kasnije fino podešava u timeline-u proizvoda.
 */
export async function bulkBookWorkOrderLabor(
    workOrderId: string,
    workerIds: string[],
    itemIds: string[],
    dateFrom: string,
    dateTo: string,
    skipWeekends: boolean,
    organizationId: string
): Promise<{ success: boolean; logsCreated: number; message: string }> {
    if (!organizationId || !workOrderId || workerIds.length === 0 || itemIds.length === 0 || !dateFrom || !dateTo) {
        return { success: false, logsCreated: 0, message: 'Nedostaju parametri (radnici, proizvodi, raspon)' };
    }
    try {
        const workers = await getWorkers(organizationId);
        const itemMap = await fetchWorkOrderItemsByIds(itemIds, organizationId);
        const split = itemIds.length;
        let logsCreated = 0;

        const start = new Date(dateFrom + 'T00:00:00');
        const end = new Date(dateTo + 'T00:00:00');
        if (start > end) return { success: false, logsCreated: 0, message: 'Datum "od" je poslije "do"' };

        const fs = getDb();
        let skippedAbsent = 0;
        const touchedPairs = new Map<string, { workerId: string; date: string }>();

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (skipWeekends && (dow === 0 || dow === 6)) continue;
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

            // ŠIHTARICA: radnik označen odsutnim tog dana (ne Prisutan/Teren) → bez dnevnice
            const absentThatDay = new Set<string>();
            try {
                const attSnap = await getDocs(query(
                    collection(fs, COLLECTIONS.WORKER_ATTENDANCE),
                    where('Date', '==', dateStr),
                    where('Organization_ID', '==', organizationId)
                ));
                attSnap.docs.forEach(doc => {
                    const a = doc.data() as WorkerAttendance;
                    if (a.Status && a.Status !== 'Prisutan' && a.Status !== 'Teren') absentThatDay.add(a.Worker_ID);
                });
            } catch (e) { console.warn('bulk attendance lookup failed for', dateStr, e); }

            for (const wid of workerIds) {
                if (absentThatDay.has(wid)) { skippedAbsent++; continue; }  // odsutan u šihtarici
                const w = workers.find(x => x.Worker_ID === wid);
                const rate = w?.Daily_Rate || 0;
                const perItemRate = Math.round((rate / split) * 100) / 100;
                for (const itemId of itemIds) {
                    const woi = itemMap.get(itemId);
                    if (!woi) continue;
                    const exists = await workLogExists(wid, itemId, dateStr, organizationId);
                    if (exists) continue;  // već ima zapis za taj dan/proizvod/radnika — preskoči
                    const res = await createWorkLog({
                        Worker_ID: wid,
                        Worker_Name: w?.Name || 'Nepoznat',
                        Daily_Rate: perItemRate,
                        Original_Daily_Rate: rate,
                        Day_Fraction: Math.round((1 / split) * 100) / 100,
                        Presence: 1,
                        Split_Factor: split,
                        Booking_Source: 'manual',
                        Is_From_Attendance: false,
                        Hours_Worked: 8,
                        Work_Order_ID: woi.Work_Order_ID,
                        Work_Order_Item_ID: woi.ID,
                        Product_ID: woi.Product_ID,
                        Date: dateStr,
                        // NAMJERNO bez Process_Name/Node_ID: retro raspon nepoznate istorije —
                        // auto-pripis DANAŠNJEG tekućeg procesa bi lažno atribuirao prošle dane.
                    }, organizationId);
                    if (res.success) { logsCreated++; touchedPairs.set(`${wid}__${dateStr}`, { workerId: wid, date: dateStr }); }
                }
            }
        }

        // KANONSKA podjela: uskladi svaki pogođeni (radnik, datum) — ravnomjerno preko SVIH proizvoda
        // tog radnika tog dana (uključujući postojeće logove iz drugih naloga).
        const affectedWO = new Set<string>([workOrderId]);
        for (const p of Array.from(touchedPairs.values())) {
            try {
                // bez hint-a: zadrži postojeću prisutnost dana ako je radnik već imao zapis (npr. ručni ½)
                const wos = await renormalizeWorkerDay(p.workerId, p.date, organizationId);
                wos.forEach(id => affectedWO.add(id));
            } catch (e) { console.warn('[bulkBook] renormalize failed', p, e); }
        }
        await Promise.all(Array.from(affectedWO).map(id =>
            recalculateWorkOrder(id, { skipSnapshot: true }).catch(err => console.warn('[bulkBook] recalc failed', id, err))
        ));
        const msg = skippedAbsent > 0
            ? `Dodano ${logsCreated} zapisa rada · ${skippedAbsent} dan(a) preskočeno (radnik odsutan u šihtarici)`
            : `Dodano ${logsCreated} zapisa rada`;
        return { success: true, logsCreated, message: msg };
    } catch (error) {
        console.error('bulkBookWorkOrderLabor error:', error);
        return { success: false, logsCreated: 0, message: 'Greška pri brzom unosu rada' };
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
        const explicitPresence = new Map<string, number>();
        for (const log of logs) {
            let entry = byWorker.get(log.Worker_ID);
            if (!entry) {
                const w = workers.find(x => x.Worker_ID === log.Worker_ID);
                entry = {
                    workerId: log.Worker_ID,
                    workerName: log.Worker_Name,
                    dailyRate: w?.Daily_Rate ?? log.Original_Daily_Rate ?? 0,
                    presence: 1,
                    items: [],
                };
                byWorker.set(log.Worker_ID, entry);
            }
            if (log.Presence === 0.5 || log.Presence === 1) explicitPresence.set(log.Worker_ID, log.Presence);
            const woi = itemMap.get(log.Work_Order_Item_ID);
            entry.items.push({
                workOrderItemId: log.Work_Order_Item_ID,
                workOrderId: log.Work_Order_ID,
                productName: woi?.Product_Name ?? '',
                projectName: woi?.Project_Name ?? '',
                dayFraction: log.Day_Fraction ?? 1,
                processes: log.Process_Tags ?? [],
                processNodeId: log.Process_Node_ID,
                amount: log.Daily_Rate,
            });
        }
        // presence po radniku: eksplicitni Presence ako postoji, inače rekonstrukcija iz Σ Day_Fraction
        for (const entry of Array.from(byWorker.values())) {
            const exp = explicitPresence.get(entry.workerId);
            if (exp != null) { entry.presence = exp; continue; }
            const sumFrac = entry.items.reduce((s, it) => s + (it.dayFraction || 0), 0);
            entry.presence = sumFrac > 0 && sumFrac <= 0.6 ? 0.5 : 1;
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

            // presence sa zadnjeg dana (eksplicitni Presence ili rekonstrukcija iz Σ Day_Fraction)
            const sumFracPrev = lastDayLogs.reduce((s, l) => s + (l.Day_Fraction ?? 1), 0);
            const presence = (lastDayLogs[0].Presence === 0.5 || lastDayLogs[0].Presence === 1)
                ? lastDayLogs[0].Presence
                : (sumFracPrev > 0 && sumFracPrev <= 0.6 ? 0.5 : 1);

            // Predloži samo proizvode čiji nalog/stavka još postoji; dnevnica ravnomjerno podijeljena.
            const validLogs = lastDayLogs.filter(l => itemMap.get(l.Work_Order_Item_ID));
            const { amounts, dayFraction } = splitDnevnicaExact(dailyRate, presence, validLogs.length || 1);

            const items: DailyBookingItemView[] = [];
            validLogs.forEach((log, i) => {
                const woi = itemMap.get(log.Work_Order_Item_ID)!;
                items.push({
                    workOrderItemId: log.Work_Order_Item_ID,
                    workOrderId: log.Work_Order_ID,
                    productName: woi.Product_Name ?? '',
                    projectName: woi.Project_Name ?? '',
                    dayFraction,
                    processes: log.Process_Tags ?? [],
                    amount: amounts[i] ?? 0,
                });
            });
            if (items.length > 0) {
                suggestions.push({ workerId, workerName: w?.Name ?? lastDayLogs[0].Worker_Name, dailyRate, presence, items });
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
                Day_Fraction: totalAssignments > 0 ? Math.round((1 / totalAssignments) * 1e6) / 1e6 : 1,
                Presence: 1,
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

/**
 * Distinct (radnik, dan) parovi koji imaju BAR JEDAN work log u mjesecu.
 * Za šihtaricu: indikator "prisutan bez knjiženja" (poredi se s worker_attendance).
 * Vraća ključeve oblika `${Worker_ID}|${Date}`.
 */
export async function getBookedWorkerDaysByMonth(
    year: string | number,
    month: string | number,
    organizationId: string
): Promise<string[]> {
    if (!organizationId) return [];
    try {
        const firestore = getDb();
        const m = String(month).padStart(2, '0');
        const q = query(
            collection(firestore, 'work_logs'),
            where('Organization_ID', '==', organizationId),
            where('Date', '>=', `${year}-${m}-01`),
            where('Date', '<=', `${year}-${m}-31`)
        );
        const snapshot = await getDocs(q);
        const keys = new Set<string>();
        snapshot.docs.forEach(d => {
            const x = d.data();
            if (x.Worker_ID && x.Date) keys.add(`${x.Worker_ID}|${x.Date}`);
        });
        return Array.from(keys);
    } catch (error) {
        console.error('getBookedWorkerDaysByMonth error:', error);
        return [];
    }
}

/**
 * Svi work logovi organizacije u mjesecu (lite polja za obračun plata).
 */
export async function getWorkLogsForMonth(
    year: string | number,
    month: string | number,
    organizationId: string
): Promise<{ Worker_ID: string; Worker_Name?: string; Date: string; Daily_Rate?: number; Day_Fraction?: number }[]> {
    if (!organizationId) return [];
    try {
        const firestore = getDb();
        const m = String(month).padStart(2, '0');
        const q = query(
            collection(firestore, 'work_logs'),
            where('Organization_ID', '==', organizationId),
            where('Date', '>=', `${year}-${m}-01`),
            where('Date', '<=', `${year}-${m}-31`)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => {
            const x = d.data();
            return {
                Worker_ID: x.Worker_ID,
                Worker_Name: x.Worker_Name,
                Date: x.Date,
                Daily_Rate: x.Daily_Rate,
                Day_Fraction: x.Day_Fraction,
            };
        });
    } catch (error) {
        console.error('getWorkLogsForMonth error:', error);
        return [];
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

        // Get worker's full daily rate VAŽEĆU na datum (efektivno-datirano; rizik #2)
        const allWorkers = await getWorkers(organizationId);
        const worker = allWorkers.find(w => w.Worker_ID === workerId);
        const fullRate = effectiveDailyRate(worker, date);
        // GARDA (#1): nepoznata cijena (obrisan radnik) → ne diraj logove (ne nuliraj).
        if (!worker || fullRate <= 0) return;

        // Find ALL work logs for this worker on this date
        const logsQuery = query(
            collection(firestore, 'work_logs'),
            where('Worker_ID', '==', workerId),
            where('Date', '==', date),
            where('Organization_ID', '==', organizationId)
        );
        const logsSnap = await getDocs(logsQuery);

        if (logsSnap.empty) return;

        // Rizik #8: ne računaj logove obrisanih naloga u podjelu.
        const liveLogs = logsSnap.docs.filter(d => d.data().Work_Order_Deleted !== true);
        if (liveLogs.length === 0) return;

        // Count total active assignments (= number of live work logs for this date)
        const totalAssignments = liveLogs.length;
        const splitRate = Math.round((fullRate / totalAssignments) * 100) / 100;

        // Update each log with new split rate
        const batch = writeBatch(firestore);
        liveLogs.forEach(logDoc => {
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

// [UKLONJENO] recalculateWOLaborSplit — dijelila je dnevnicu po trošku materijala, što je
// pravilo nespojivo s ostalim putevima unosa i glavni uzrok nekonzistentnih iznosa u timeline-u.
// Zamijenjeno kanonskom RAVNOMJERNOM podjelom kroz renormalizeWorkerDay().

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
        Daily_Rate: number;            // (informativno) — konačni iznos određuje renormalizeWorkerDay
        Original_Daily_Rate?: number;  // puna dnevnica radnika (za ravnomjernu podjelu)
        Presence?: number;             // 1 ili 0.5 (cijeli/pola dana)
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

        // ISTORIJA ATRIBUCIJE: sačuvaj proces sa starih logova (workerId|date → node/name) —
        // timeline override ne smije BLANKATI atribuciju (graf „Radnici·dani" gubi zapise).
        const oldAttr = new Map<string, { nodeId?: string; name?: string }>();
        existingSnap.docs.forEach(d => {
            const x = d.data();
            const k = `${x.Worker_ID}|${x.Date}`;
            if (!oldAttr.has(k) && (x.Process_Node_ID || x.Process_Name)) {
                oldAttr.set(k, { nodeId: x.Process_Node_ID, name: x.Process_Name });
            }
        });

        // Delete in batches
        const CHUNK_SIZE = 450;
        const docsToDelete = existingSnap.docs;
        for (let i = 0; i < docsToDelete.length; i += CHUNK_SIZE) {
            const chunk = docsToDelete.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            chunk.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }

        // 2. Write new work logs. Daily_Rate/Day_Fraction/Split_Factor će biti TAČNO postavljeni
        //    naknadno (renormalizeWorkerDay) — ovdje upisujemo punu dnevnicu + presence kao osnovu.
        const newLogs = entries.map(entry => {
            const original = entry.Original_Daily_Rate ?? entry.Daily_Rate;
            const presence = entry.Presence === 0.5 ? 0.5 : 1;
            // Atribucija: ručno unesen naziv ima prednost (node se prenosi ako se naziv poklapa);
            // bez unosa → prenesi staru atribuciju; polja se IZOSTAVLJAJU umjesto blankanja ''.
            const old = oldAttr.get(`${entry.Worker_ID}|${entry.Date}`);
            const manualName = (entry.Process_Name || '').trim();
            const attr: Record<string, string> = {};
            if (manualName) {
                attr.Process_Name = manualName;
                if (old?.nodeId && (old.name || '').trim().toLowerCase() === manualName.toLowerCase()) {
                    attr.Process_Node_ID = old.nodeId;
                }
            } else if (old) {
                if (old.name) attr.Process_Name = old.name;
                if (old.nodeId) attr.Process_Node_ID = old.nodeId;
            }
            return {
                WorkLog_ID: generateUUID(),
                Organization_ID: organizationId,
                Work_Order_ID: workOrderId,
                Work_Order_Item_ID: itemId,
                Product_ID: resolvedProductId,        // ← required for timeline display
                Worker_ID: entry.Worker_ID,
                Worker_Name: entry.Worker_Name,
                Date: entry.Date,
                Daily_Rate: entry.Daily_Rate,
                Original_Daily_Rate: original,
                Presence: presence,
                Split_Factor: 1,
                Day_Fraction: presence,
                Hours_Worked: 8,
                ...attr,
                Is_From_Attendance: false,
                Booking_Source: 'manual' as const,
                Created_At: new Date().toISOString(),
            };
        });

        for (let i = 0; i < newLogs.length; i += CHUNK_SIZE) {
            const chunk = newLogs.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(firestore);
            chunk.forEach(log => {
                const ref = doc(collection(firestore, 'work_logs'));
                batch.set(ref, log);
            });
            await batch.commit();
        }

        // 3. KANONSKA podjela: za svaki pogođeni (radnik, datum) ravnomjerno preraspodijeli dnevnicu
        //    preko SVIH proizvoda tog radnika tog dana (uklj. uklonjene → siblinzi dobiju veći udio).
        //    Bez "Labor_Cost_Frozen"/override — Actual_Labor_Cost je uvijek Σ work logova.
        const pairs = new Map<string, { workerId: string; date: string; presence?: number }>();
        existingSnap.docs.forEach(d => {
            const x = d.data();
            if (x.Worker_ID && x.Date) pairs.set(`${x.Worker_ID}__${x.Date}`, { workerId: x.Worker_ID, date: x.Date });
        });
        // entries (upravo uređeni proizvod) nose najsvježiju namjeru presence → ona pobjeđuje za cijeli dan
        entries.forEach(e => pairs.set(`${e.Worker_ID}__${e.Date}`, {
            workerId: e.Worker_ID, date: e.Date, presence: e.Presence === 0.5 ? 0.5 : 1,
        }));

        const affectedWO = new Set<string>([workOrderId]);
        for (const p of Array.from(pairs.values())) {
            try {
                const wos = await renormalizeWorkerDay(p.workerId, p.date, organizationId, p.presence);
                wos.forEach(id => affectedWO.add(id));
            } catch (e) { console.warn('[overrideWorkLogs] renormalize failed', p, e); }
        }

        // 4. Preračunaj sve pogođene naloge (radnik je mogao raditi na proizvodima drugih naloga isti dan)
        //    skipSnapshot: izmjena timeline-a ne treba AI snapshot; paralelno za brzinu.
        await Promise.all(Array.from(affectedWO).map(id =>
            recalculateWorkOrder(id, { skipSnapshot: true }).catch(err => console.warn('[overrideWorkLogs] recalc failed', id, err))
        ));

        console.log(`[overrideWorkLogs] WO ${workOrderId} item ${itemId}: ${docsToDelete.length} deleted, ${newLogs.length} created, ${affectedWO.size} WO recalc`);
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
 * Recalculate Work Order aggregates from items.
 * options (za labor-only puteve, da bude brzo):
 *   skipSnapshot       — ne pravi AI production snapshot (samo na završetku naloga treba)
 *   skipStatusSync     — ne dira statuse proizvoda/projekata (labor ne mijenja status)
 *   skipMaterialRefresh— ne dohvaća svjež materijal po stavci (koristi spremljeni Material_Cost)
 */
export async function recalculateWorkOrder(
    workOrderId: string,
    options?: { skipSnapshot?: boolean; skipStatusSync?: boolean; skipMaterialRefresh?: boolean }
): Promise<void> {
    const skipSnapshot = options?.skipSnapshot ?? false;
    const skipStatusSync = options?.skipStatusSync ?? false;
    const skipMaterialRefresh = options?.skipMaterialRefresh ?? false;
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

        // EFIKASNOST: JEDAN upit svih logova naloga → trošak rada po stavci iz memorije
        // (umjesto calculateActualLaborCost = 1 upit po stavci). Σ Daily_Rate po
        // Work_Order_Item_ID je identičan staroj per-item logici (vidi calculateActualLaborCost).
        const laborByItem = new Map<string, number>();
        // Radnik-dani po stavci (Σ Day_Fraction) — hrani Actual_Labor_Days za "planirano vs potrošeno" na kartici
        const daysByItem = new Map<string, number>();
        {
            const logConstraints: any[] = [where('Work_Order_ID', '==', workOrderId)];
            if (workOrder.Organization_ID) logConstraints.push(where('Organization_ID', '==', workOrder.Organization_ID));
            const woLogsSnap = await getDocs(query(collection(firestore, 'work_logs'), ...logConstraints));
            woLogsSnap.docs.forEach(d => {
                const x = d.data();
                laborByItem.set(x.Work_Order_Item_ID, (laborByItem.get(x.Work_Order_Item_ID) || 0) + (x.Daily_Rate || 0));
                daysByItem.set(x.Work_Order_Item_ID, (daysByItem.get(x.Work_Order_Item_ID) || 0) + (x.Day_Fraction ?? 1));
            });
        }
        // EFIKASNOST: sve per-item sync izmjene idu u jedan writeBatch (umjesto N updateDoc-a).
        const itemUpdates: { ref: any; payload: Record<string, any> }[] = [];

        // EFIKASNOST: items se obrađuju PARALELNO (Promise.all) — svaki item radi najviše 2-3
        // nezavisna Firestore čitanja (offer backfill, services backfill, materijali), pa je
        // sekvencijalni for-of preko N stavki bio glavni uzrok sporog preračuna (N × round-trip).
        // Agregacija u zajedničke akumulatore (totalValue itd.) ostaje SINHRONA nakon Promise.all.
        const itemResults = await Promise.all(workOrder.items.map(async (item) => {
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

            // BACKFILL: Services_Total (usluge = trošak) iz ponude ako nije postavljeno — one-time self-healing
            if ((item as any).Services_Total === undefined && item.Product_ID && item.Project_ID && workOrder.Organization_ID) {
                try {
                    const offSnap = await getDocs(query(
                        collection(firestore, COLLECTIONS.OFFERS),
                        where('Project_ID', '==', item.Project_ID),
                        where('Status', '==', 'Prihvaćeno'),
                        where('Organization_ID', '==', workOrder.Organization_ID)
                    ));
                    if (!offSnap.empty) {
                        const offerId = offSnap.docs[0].data().Offer_ID;
                        const opSnap = await getDocs(query(
                            collection(firestore, COLLECTIONS.OFFER_PRODUCTS),
                            where('Offer_ID', '==', offerId),
                            where('Product_ID', '==', item.Product_ID),
                            where('Organization_ID', '==', workOrder.Organization_ID)
                        ));
                        if (!opSnap.empty) {
                            const opId = opSnap.docs[0].data().ID;
                            let services = 0;
                            if (opId) {
                                const exSnap = await getDocs(query(
                                    collection(firestore, 'offer_extras'),
                                    where('Offer_Product_ID', '==', opId)
                                ));
                                services = exSnap.docs.reduce((s, d) => s + (d.data().Total || 0), 0);
                            }
                            const itemRef = doc(firestore, COLLECTIONS.WORK_ORDER_ITEMS, item.ID);
                            await updateDoc(itemRef, { Services_Total: services });
                            (item as any).Services_Total = services;  // za tekuću agregaciju
                            console.log(`Backfilled Services_Total=${services} for item ${item.Product_Name}`);
                        }
                    }
                } catch (svcErr) {
                    console.warn('Services_Total backfill failed (non-critical):', svcErr);
                }
            }

            // FIX #1: Apply Profit_Overrides — user can override selling price per item
            // This ensures recalculateWorkOrder matches the profit modal badge
            const overrides = (item as any).Profit_Overrides;
            if (overrides?.Selling_Price != null && overrides.Selling_Price > 0) {
                itemValue = overrides.Selling_Price;
            }

            // PROFIT-09 FIX: For completed items, use FROZEN material cost (don't re-fetch)
            // This prevents retroactive profit changes when material prices change after completion.
            // Active items still get fresh prices so profit is accurate during production.
            // PRICE-MODAL FIX: If Material_Cost was manually set (Material_Cost_Source === 'manual'),
            // preserve the stored value — user explicitly entered this price.
            let itemMaterialCost = 0;
            // Rizik #3: materijal je ZAMRZNUT za stavku koja je ikad završena (ima Completed_At) —
            // ostaje zamrznut i ako se status privremeno vrati na 'U toku' (naknadno knjiženje).
            const matFrozen = item.Status === 'Završeno' || !!item.Completed_At;
            if (matFrozen && (item.Material_Cost || 0) > 0) {
                // Završeno/zamrznuto: koristi pohranjeni trošak
                itemMaterialCost = item.Material_Cost || 0;
            } else if ((item as any).Material_Cost_Source === 'manual' && (item.Material_Cost || 0) > 0) {
                // Manually set via PriceEditModal: preserve user's value
                itemMaterialCost = item.Material_Cost || 0;
            } else if (!skipMaterialRefresh && item.Product_ID && workOrder.Organization_ID) {
                // Active: fetch fresh material costs
                const materials = await getProductMaterials(item.Product_ID, workOrder.Organization_ID);
                itemMaterialCost = materials.reduce((sum, m) => sum + (m.Total_Price || 0), 0);
            } else {
                // Fallback to stored value if no Product_ID
                itemMaterialCost = item.Material_Cost || 0;
            }

            // Include Transport and Services in profit calculation
            // FIX #1: Apply Profit_Overrides for Transport_Share if present
            const itemTransport = overrides?.Transport_Share != null ? overrides.Transport_Share : (item.Transport_Share || 0);

            // INVARIJANTA: trošak rada proizvoda = Σ Daily_Rate iz work logova (jedini izvor istine).
            // Nema "manual_override" izuzetka — sve izmjene (knjiga rada, timeline) idu kroz work logove.
            const freshItemLaborCost = Math.round((laborByItem.get(item.ID) || 0) * 100) / 100;
            const freshItemLaborDays = Math.round((daysByItem.get(item.ID) || 0) * 100) / 100;

            return {
                item, itemValue, itemMaterialCost, itemTransport,
                itemServices: item.Services_Total || 0,
                itemPlannedLabor: item.Planned_Labor_Cost || 0,
                freshItemLaborCost, freshItemLaborDays,
            };
        }));

        // Agregacija (sinhrono, u redoslijedu stavki) + priprema batch izmjena.
        for (const r of itemResults) {
            const { item } = r;
            totalValue += r.itemValue;
            // MATERIJAL × KOLIČINA: itemMaterialCost je PO KOMADU (Σ product_materials za 1 komad),
            // a prihod (itemValue) je UKUPAN → agregat naloga mora množiti količinom (bug iz PDF-a).
            materialCost += itemMaterialTotal(r.itemMaterialCost, item.Quantity);
            transportCost += r.itemTransport;
            servicesCost += r.itemServices;
            plannedLaborCost += r.itemPlannedLabor;
            actualLaborCost += r.freshItemLaborCost;

            // SYNC: Update item-level Material_Cost, Actual_Labor_Cost i Actual_Labor_Days for consistency
            // (skupljamo izmjene → jedan batch commit poslije petlje)
            // NB: Material_Cost se ČUVA PO KOMADU (invarijanta) — množenje količinom radi SAMO agregat gore.
            itemUpdates.push({
                ref: doc(firestore, COLLECTIONS.WORK_ORDER_ITEMS, item.ID),
                payload: { Material_Cost: r.itemMaterialCost, Actual_Labor_Cost: r.freshItemLaborCost, Actual_Labor_Days: r.freshItemLaborDays },
            });

            if (item.Started_At) {
                const start = new Date(item.Started_At);
                if (!earliestStart || start < earliestStart) earliestStart = start;
            }

            if (item.Completed_At) {
                const comp = new Date(item.Completed_At);
                if (!latestCompletion || comp > latestCompletion) latestCompletion = comp;
            }
        }

        // EFIKASNOST: commit svih per-item sync izmjena u batch-evima (max 450 op/batch).
        try {
            for (let i = 0; i < itemUpdates.length; i += 450) {
                const b = writeBatch(firestore);
                for (const u of itemUpdates.slice(i, i + 450)) b.update(u.ref, u.payload);
                await b.commit();
            }
        } catch (syncErr) {
            console.warn(`Failed to batch-sync item costs on WO ${workOrderId}:`, syncErr);
        }

        // SAFETY CHECK: If calculated total is 0 but existing WO has value, preserve it (Legacy Data Protection)
        // Skip for Montaža WOs which intentionally carry 0 Total_Value
        if (totalValue === 0 && (workOrder.Total_Value || 0) > 0 && workOrder.Work_Order_Type !== 'Montaža') {
            totalValue = workOrder.Total_Value || 0;
        }

        // NOTE: Profit calculation REMOVED — now handled by manual daily_profit_entries
        // Cost fields are still aggregated here for reference.

        // Determine overall status
        // FLOOR 'U toku': pokrenut nalog (bar jedna stavka sa Started_At) nikad ne regresira na
        // 'Na čekanju' — šihtarica (selectAutoBookItemIds) auto-knjiži dnevnice SAMO na aktivne
        // naloge, pa bi regresija tiho ugasila knjiženje.
        let status: 'Na čekanju' | 'U toku' | 'Završeno' = 'Na čekanju';
        const allCompleted = workOrder.items.every((i: any) => i.Status === 'Završeno');
        const anyInProgress = workOrder.items.some((i: any) => i.Status === 'U toku');

        if (allCompleted) status = 'Završeno';
        else if (anyInProgress || earliestStart) status = 'U toku';

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
        // (preskoči za labor-only preračune — snapshot nije potreban kod izmjene dnevnice)
        if (!skipSnapshot && status === 'Završeno' && workOrder.Organization_ID) {
            try {
                await createProductionSnapshot(workOrderId, workOrder.Organization_ID);
                console.log(`[AI Training] Production snapshot created for WorkOrder ${workOrderId}`);
            } catch (snapshotError) {
                console.error('[AI Training] Failed to create production snapshot:', snapshotError);
                // Don't throw - snapshot failure shouldn't block work order completion
            }
        }

        if (!skipStatusSync) {
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
        const CHUNK = 5;  // paralelno u grupama (brže, ali bez preopterećenja Firestore-a)

        // skipSnapshot: batch preračun ne treba AI snapshot (snapshot se pravi kod stvarnog završetka naloga)
        const activeIds = activeSnap.docs.map(d => d.data().Work_Order_ID).filter(Boolean);
        for (let i = 0; i < activeIds.length; i += CHUNK) {
            await Promise.all(activeIds.slice(i, i + CHUNK).map(async (woId) => {
                try { await recalculateWorkOrder(woId, { skipSnapshot: true }); totalRecalculated++; }
                catch (err) { console.warn(`Failed to recalculate active WO ${woId}:`, err); }
            }));
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

            // Only recalculate WOs completed within the last 30 days (retroaktivne izmjene), bez snapshot-a, paralelno
            const completedIds = completedSnap.docs
                .map(d => d.data())
                .filter(w => w.Completed_At && w.Completed_At >= cutoffISO)
                .map(w => w.Work_Order_ID).filter(Boolean);
            for (let i = 0; i < completedIds.length; i += CHUNK) {
                await Promise.all(completedIds.slice(i, i + CHUNK).map(async (woId) => {
                    try { await recalculateWorkOrder(woId, { skipSnapshot: true }); totalRecalculated++; }
                    catch (err) { console.warn(`Failed to recalculate completed WO ${woId}:`, err); }
                }));
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

        // EFIKASNOST: jedan zajednički upit svih work_order_items OVOG projekta (dijeli se između
        // oba narednih provjera), umjesto da se za SVAKI aktivni/montaža nalog u CIJELOJ organizaciji
        // pojedinačno pita "dira li ovaj projekat" (bio je N+1, sekvencijalno — glavni uzrok sporog
        // preračuna naloga kako raste broj aktivnih naloga u organizaciji).
        let projectItemsSnap: any = null;
        try {
            const itemsConstraints: any[] = [where('Project_ID', '==', projectId)];
            if (organizationId) itemsConstraints.push(where('Organization_ID', '==', organizationId));
            projectItemsSnap = await getDocs(query(collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS), ...itemsConstraints));
        } catch (err) {
            console.warn('syncProjectStatus: Error fetching project work order items:', err);
        }

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
            const montazaWoIds = new Set(montazaSnap.docs.map(d => d.data().Work_Order_ID));
            projectItemsSnap?.docs.forEach((d: any) => {
                const itemData = d.data();
                if (montazaWoIds.has(itemData.Work_Order_ID) && itemData.Product_ID) {
                    montazaProductIds.add(itemData.Product_ID);
                }
            });
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
            const activeWoIds = new Set(activeWoSnap.docs.map(d => d.data().Work_Order_ID));
            hasActiveWorkOrder = !!projectItemsSnap?.docs.some((d: any) => activeWoIds.has(d.data().Work_Order_ID));
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

        // ODSPOJENO OD STATUSA: procesi su ČIST NAPREDAK — pojedinačno pokretanje/završavanje
        // procesa NE pomiče status stavke ni naloga. Rad/profit dolaze isključivo iz WorkLog-a
        // (šihtarica + Knjiga rada), pa ovdje nema kaskade (recalculateItemStatus/recalculateWorkOrder).
        // Status naloga vode samo eksplicitne akcije u kartici (Pokreni/Završi nalog).
    } catch (error) {
        console.error('Error updating item process:', error);
        throw error;
    }
}

/**
 * DODAJ PROCES U NALOG (samo taj nalog — plan proizvoda se NE dira):
 *  1) upsert u item.Processes (updateItemProcess)
 *  2) dopuni item.Process_Stages (u zadatu fazu = paralelno, ili nova faza na kraj)
 *  3) re-sintetiši WorkOrder.Process_Graph iz svih stavki, čuvajući pozicije istoimenih čvorova
 */
export async function addProcessToOrderItem(
    workOrderId: string,
    itemId: string,
    processName: string,
    organizationId: string,
    opts?: { stageIndex?: number }
): Promise<{ success: boolean; message: string }> {
    const name = (processName || '').trim();
    if (!workOrderId || !itemId || !name || !organizationId) {
        return { success: false, message: 'Nedostaju podaci za dodavanje procesa' };
    }
    try {
        const firestore = getDb();
        const { planToStages, synthesizeOrderGraph, nodeMatchesProcess } = await import('./productProcesses');
        const { layoutColumns } = await import('./processLayout');
        const { getProcessGraph, saveProcessGraph } = await import('./database');

        // 1) upsert u item.Processes (+ recalc statusa/naloga interno)
        await updateItemProcess(workOrderId, itemId, name, { Status: 'Na čekanju' });

        // 2) dopuni Process_Stages ciljne stavke
        const itemRef = await getItemRef(itemId);
        const itemSnap = await getDoc(itemRef);
        const itemData = itemSnap.data() as WorkOrderItem;
        const curStages = planToStages(
            (itemData as any).Process_Stages,
            (itemData.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[]
        );
        // ako je već negdje (npr. upsert ga stavio u Processes pa fallback izveo fazu) — ne dupliraj
        const already = curStages.some(st => st.some(pn => pn.trim().toLowerCase() === name.toLowerCase()));
        if (!already) {
            if (opts?.stageIndex !== undefined && opts.stageIndex >= 0 && opts.stageIndex < curStages.length) {
                curStages[opts.stageIndex].push(name);
            } else {
                curStages.push([name]); // nova faza na kraj
            }
        }
        await updateDoc(itemRef, { Process_Stages: curStages.map(s => ({ processes: s })) });

        // 3) Ažuriraj graf naloga BEZ diranja RUČNIH veza / konsolidacije (aliasa):
        //    - postojeći čvor već predstavlja ovaj proces (po nazivu/aliasu) → samo proširi pokrivenost
        //    - inače dodaj NOVI čvor bez veza (korisnik ga poveže); fazni raspored
        //    - grafa još nema → edgeless sinteza iz svih stavki
        const prev = await getProcessGraph(workOrderId, organizationId);
        if (prev.nodes && prev.nodes.length > 0) {
            const existing = prev.nodes.find(n => nodeMatchesProcess(n, name));
            if (existing) {
                if ((existing.itemIds || []).length > 0 && !existing.itemIds.includes(itemId)) existing.itemIds.push(itemId);
            } else {
                const maxX = Math.max(0, ...prev.nodes.map(n => n.position?.x || 0));
                prev.nodes.push({ id: `n-${generateUUID()}`, name, itemIds: [itemId], aliases: [name], position: { x: maxX + 260, y: 24 } });
            }
            await saveProcessGraph(workOrderId, prev, organizationId);
        } else {
            const allItemsSnap = await getDocs(query(
                collection(firestore, COLLECTIONS.WORK_ORDER_ITEMS),
                where('Work_Order_ID', '==', workOrderId),
                where('Organization_ID', '==', organizationId)
            ));
            const planItems = allItemsSnap.docs.map(d => {
                const it = d.data() as WorkOrderItem;
                const stages = it.ID === itemId
                    ? curStages
                    : planToStages((it as any).Process_Stages, (it.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[]);
                return { itemId: it.ID, stages };
            }).filter(pi => pi.stages.length > 0);
            const { graph, columns } = synthesizeOrderGraph(planItems, undefined, { includeEdges: false });
            if (graph.nodes.length > 0) {
                const pos = layoutColumns(columns);
                graph.nodes.forEach(n => { n.position = pos[n.id] || { x: 24, y: 24 }; });
                await saveProcessGraph(workOrderId, graph, organizationId);
            }
        }

        return { success: true, message: `Proces „${name}" dodan u nalog` };
    } catch (error) {
        console.error('addProcessToOrderItem error:', error);
        return { success: false, message: 'Greška pri dodavanju procesa' };
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
        const itemSnap = await getDoc(itemRef);
        const itemStartedAt: string | undefined = itemSnap.exists() ? (itemSnap.data() as any).Started_At : undefined;

        // FLOOR 'U toku': pokrenuta stavka (Started_At iz starta naloga ili prvog procesa) NIKAD ne
        // regresira na 'Na čekanju' kad se proces vrati — regresija bi kaskadno oborila status naloga,
        // a šihtarica (selectAutoBookItemIds) auto-knjiži samo na aktivne naloge. Vidi deriveItemStatus.
        const { deriveItemStatus } = await import('./productProcesses');
        const firstStarted = processes.find(p => p.Started_At);
        const status = deriveItemStatus(processes, itemStartedAt || firstStarted?.Started_At);
        const allCompleted = status === 'Završeno';

        const updates: any = { Status: status };

        // Set Started_At if first process started
        if (firstStarted && !itemStartedAt) {
            updates.Started_At = firstStarted.Started_At;
        }

        // Set Completed_At if all completed
        // (pri regresiji se Completed_At NE čisti — zamrznut materijal je namjeran, Rizik #3 guard)
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

        // NAPOMENA: Dnevnice se VIŠE ne kreiraju iz šihtarice (Radna knjiga je jedini izvor).
        // "Sync" sada samo osvježava (auto-Started_At iznad + preračun ispod).

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

        // EFIKASNOST: nalozi su nezavisni dokumenti → paralelno (bilo je sekvencijalno po nalogu,
        // usporavalo pokretanje aplikacije kad ima puno aktivnih naloga).
        await Promise.all(woSnap.docs.map(async (woDoc) => {
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
        }));

        // Step 3: Sync project statuses — paralelno.
        await Promise.all(Array.from(projectIds).map(async (projectId) => {
            try {
                await syncProjectStatus(projectId, organizationId);
                projectsSynced++;
            } catch (e) {
                console.warn(`[STARTUP-SYNC] Project sync failed for ${projectId}:`, e);
            }
        }));

        console.log(`[STARTUP-SYNC] Done: ${scheduled} scheduled, ${recalculated} recalculated, ${projectsSynced} projects synced`);
    } catch (error) {
        console.error('[STARTUP-SYNC] Error:', error);
    }

    return { scheduled, recalculated, projectsSynced };
}
