/**
 * productivity.ts - Worker Productivity Calculations
 * 
 * Funkcije za izračun produktivnosti i zarade radnika.
 * Profit proizvoda i projekta se računa isključivo u lib/projectFinance.ts.
 */

import { db } from './firebase';
import {
    collection,
    query,
    where,
    getDocs,
    type QueryConstraint,
} from 'firebase/firestore';
import type {
    WorkerProductivity,
    WorkLog,
    WorkOrderItem,
    WorkerAttendance,
} from './types';
import { liveLogs } from './projectFinance';

// ============================================
// QUERY HELPERS
// ============================================

/**
 * Upit s Date-range filterom NA SERVERU (composite indexi u firestore.indexes.json).
 * Ako index još nije deploy-an (failed-precondition), tiho pada na širi upit +
 * in-memory filter — staro ponašanje, samo sporije. Bez rušenja UI-ja.
 */
async function getDocsInDateRange<T extends { Date: string }>(
    collectionName: string,
    baseConstraints: QueryConstraint[],
    dateFrom: string,
    dateTo: string
): Promise<T[]> {
    try {
        const snap = await getDocs(query(
            collection(db, collectionName),
            ...baseConstraints,
            where('Date', '>=', dateFrom),
            where('Date', '<=', dateTo)
        ));
        return snap.docs.map(d => d.data() as T);
    } catch (err) {
        console.warn(`${collectionName}: date-range upit pao (nedostaje index?), fallback na in-memory filter`, err);
        const snap = await getDocs(query(collection(db, collectionName), ...baseConstraints));
        return snap.docs
            .map(d => d.data() as T)
            .filter(x => x.Date >= dateFrom && x.Date <= dateTo);
    }
}

// ============================================
// WORKER PRODUCTIVITY
// ============================================

/**
 * Calculate worker productivity for a given period
 * Includes: days worked, earnings, products worked on, value generated
 */
export async function calculateWorkerProductivity(
    workerId: string,
    dateFrom: string,
    dateTo: string,
    organizationId: string
): Promise<WorkerProductivity> {
    if (!organizationId) {
        return getEmptyWorkerProductivity(workerId);
    }

    try {
        // Dnevnice i šihtarica radnika u periodu — Date-range na serveru (paralelno),
        // umjesto povlačenja kompletne istorije radnika pa filtriranja u memoriji.
        const [allWorkLogs, attendance] = await Promise.all([
            getDocsInDateRange<WorkLog>('work_logs',
                [where('Worker_ID', '==', workerId), where('Organization_ID', '==', organizationId)],
                dateFrom, dateTo),
            getDocsInDateRange<WorkerAttendance>('worker_attendance',
                [where('Worker_ID', '==', workerId), where('Organization_ID', '==', organizationId)],
                dateFrom, dateTo),
        ]);

        // Dnevnice obrisanih naloga su nulirane — ne ulaze u zaradu (isto kao obračun plata).
        const workLogs = liveLogs(allWorkLogs);

        // Calculate Days_Present (Prisutan + Teren)
        const presentAttendance = attendance.filter(att =>
            att.Status === 'Prisutan' || att.Status === 'Teren'
        );
        const daysPresent = presentAttendance.length;

        // Radni dani perioda: pon–pet (bez praznika) + SUBOTE na kojima je radnik po
        // šihtarici stvarno radio (subotnja rotacija ne smije kažnjavati Attendance_Rate).
        const saturdaysWorked = new Set(
            presentAttendance
                .filter(att => new Date(att.Date + 'T12:00:00').getDay() === 6)
                .map(att => att.Date)
        );
        const workingDaysInPeriod = await countWorkingDays(dateFrom, dateTo, saturdaysWorked);

        // Days worked (from work logs - unique dates)
        const uniqueDates = new Set(workLogs.map(log => log.Date));
        const daysWorked = uniqueDates.size;

        // Total earnings
        const totalEarnings = workLogs.reduce((sum, log) => sum + (log.Daily_Rate || 0), 0);

        // Prosječna dnevnica = zarada / radnik-dani (Σ Day_Fraction) — isto kao Analitika.
        // (Ranije / broj datuma: pola dana ili dio dana na drugom nalogu je „kvario" prosjek.)
        const bookedDays = workLogs.reduce((sum, log) => sum + (log.Day_Fraction ?? 1), 0);
        const avgDailyRate = bookedDays > 0 ? totalEarnings / bookedDays : 0;

        // Products worked on (unique Product_IDs)
        const uniqueProducts = new Set(workLogs.map(log => log.Product_ID));
        const productsWorkedOn = uniqueProducts.size;

        // Average days per product
        const avgDaysPerProduct = productsWorkedOn > 0 ? daysWorked / productsWorkedOn : 0;

        // Get worker name from first log
        const workerName = workLogs[0]?.Worker_Name || 'Unknown';

        // Vrijednost koju je radnik "generisao" = Product_Value × NJEGOV UDIO radnik-dana
        // na stavci (Σ Day_Fraction radnika / Actual_Labor_Days stavke). Ranije je svaki
        // radnik koji je dotakao proizvod dobijao PUNU vrijednost → duplo brojanje kroz tim.
        let valueGenerated = 0;
        const workerFractionByItem = new Map<string, number>();
        workLogs.forEach(log => {
            if (!log.Work_Order_Item_ID) return;
            workerFractionByItem.set(
                log.Work_Order_Item_ID,
                (workerFractionByItem.get(log.Work_Order_Item_ID) || 0) + (log.Day_Fraction ?? 1)
            );
        });
        if (workerFractionByItem.size > 0) {
            // Samo stavke koje je radnik dirao, 'in' chunkovima po 10 (paralelno) —
            // umjesto skena SVIH stavki organizacije.
            const itemIds = Array.from(workerFractionByItem.keys());
            const chunks: string[][] = [];
            for (let i = 0; i < itemIds.length; i += 10) chunks.push(itemIds.slice(i, i + 10));
            const snaps = await Promise.all(chunks.map(chunk =>
                getDocs(query(collection(db, 'work_order_items'), where('ID', 'in', chunk), where('Organization_ID', '==', organizationId)))
            ));
            const items = snaps.flatMap(s => s.docs.map(d => d.data() as WorkOrderItem));

            items.forEach(item => {
                const workerFraction = workerFractionByItem.get(item.ID);
                if (!workerFraction) return;
                // Actual_Labor_Days sync-uje recalculateWorkOrder (Σ Day_Fraction SVIH radnika);
                // bez njega (legacy stavka) pripiši punu vrijednost — bolje precijeniti nego 0.
                const totalDays = item.Actual_Labor_Days || 0;
                const share = totalDays > 0 ? Math.min(1, workerFraction / totalDays) : 1;
                valueGenerated += (item.Product_Value || 0) * share;
            });
            valueGenerated = Math.round(valueGenerated * 100) / 100;
        }

        const valuePerDay = daysWorked > 0 ? valueGenerated / daysWorked : 0;
        const attendanceRate = workingDaysInPeriod > 0
            ? (daysPresent / workingDaysInPeriod) * 100
            : 0;

        return {
            Worker_ID: workerId,
            Worker_Name: workerName,
            Days_Worked: daysWorked,
            Days_Present: daysPresent,
            Attendance_Rate: Math.round(attendanceRate * 10) / 10,
            Total_Earnings: totalEarnings,
            Avg_Daily_Rate: Math.round(avgDailyRate * 100) / 100,
            Products_Worked_On: productsWorkedOn,
            Avg_Days_Per_Product: Math.round(avgDaysPerProduct * 10) / 10,
            Value_Generated: valueGenerated,
            Value_Per_Day: Math.round(valuePerDay * 100) / 100,
        };
    } catch (error) {
        console.error('calculateWorkerProductivity error:', error);
        return getEmptyWorkerProductivity(workerId);
    }
}

function getEmptyWorkerProductivity(workerId: string): WorkerProductivity {
    return {
        Worker_ID: workerId,
        Worker_Name: 'Unknown',
        Days_Worked: 0,
        Days_Present: 0,
        Attendance_Rate: 0,
        Total_Earnings: 0,
        Avg_Daily_Rate: 0,
        Products_Worked_On: 0,
        Avg_Days_Per_Product: 0,
        Value_Generated: 0,
        Value_Per_Day: 0,
    };
}

// ============================================
// WORKER EARNINGS SUMMARY
// ============================================

/**
 * Get earnings summary for all workers in a period
 * For dashboard widget
 * 
 * PROFIT-07 FIX: Uses unique dates for day counting instead of counting each
 * work log as 1 day. A worker with 3 items creates 3 logs per day, but that's
 * still 1 working day.
 */
export async function getWorkerEarningsSummary(
    dateFrom: string,
    dateTo: string,
    organizationId: string
): Promise<{
    workers: {
        Worker_ID: string;
        Worker_Name: string;
        Days: number;
        Avg_Daily_Rate: number;
        Total_Earnings: number;
    }[];
    totalDays: number;
    totalEarnings: number;
}> {
    if (!organizationId) {
        return { workers: [], totalDays: 0, totalEarnings: 0 };
    }

    try {
        // Dnevnice org-a u periodu — Date-range na serveru (index Organization_ID+Date postoji)
        const logs = await getDocsInDateRange<WorkLog>('work_logs',
            [where('Organization_ID', '==', organizationId)],
            dateFrom, dateTo);

        // Group by worker — track unique dates for accurate day counting
        const workerMap = new Map<string, { Name: string; UniqueDates: Set<string>; TotalRate: number }>();

        for (const log of logs) {
            const existing = workerMap.get(log.Worker_ID);
            if (existing) {
                existing.UniqueDates.add(log.Date);
                existing.TotalRate += log.Daily_Rate || 0;
            } else {
                workerMap.set(log.Worker_ID, {
                    Name: log.Worker_Name,
                    UniqueDates: new Set([log.Date]),
                    TotalRate: log.Daily_Rate || 0,
                });
            }
        }

        const workers = Array.from(workerMap.entries())
            .map(([workerId, data]) => ({
                Worker_ID: workerId,
                Worker_Name: data.Name,
                Days: data.UniqueDates.size,
                Avg_Daily_Rate: data.UniqueDates.size > 0 ? Math.round((data.TotalRate / data.UniqueDates.size) * 100) / 100 : 0,
                Total_Earnings: data.TotalRate,
            }))
            .sort((a, b) => b.Total_Earnings - a.Total_Earnings);

        const totalDays = workers.reduce((sum, w) => sum + w.Days, 0);
        const totalEarnings = workers.reduce((sum, w) => sum + w.Total_Earnings, 0);

        return { workers, totalDays, totalEarnings };
    } catch (error) {
        console.error('getWorkerEarningsSummary error:', error);
        return { workers: [], totalDays: 0, totalEarnings: 0 };
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/** Lokalni YYYY-MM-DD (bez UTC pomaka — toISOString bi oko ponoći promašio dan). */
function toLocalISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Radni dani perioda: pon–pet bez praznika (kolekcija 'holidays'), PLUS subote iz
 * `saturdaysWorked` — subota je radni dan SAMO kad je radnik po šihtarici taj dan
 * stvarno radio (pravilo radionice; ista logika kao subotnja rotacija u lib/planning.ts).
 */
async function countWorkingDays(dateFrom: string, dateTo: string, saturdaysWorked: Set<string>): Promise<number> {
    // PROFIT-10 FIX: Parse as noon to avoid timezone midnight edge cases
    const start = new Date(dateFrom + 'T12:00:00');
    const end = new Date(dateTo + 'T12:00:00');

    // Fetch holidays for the date range
    let holidayDates = new Set<string>();
    try {
        const holidayQuery = query(
            collection(db, 'holidays'),
            where('Date', '>=', dateFrom),
            where('Date', '<=', dateTo)
        );
        const holidaySnap = await getDocs(holidayQuery);
        holidaySnap.forEach(doc => holidayDates.add(doc.data().Date));
    } catch {
        // If holidays collection doesn't exist or query fails, continue without
    }

    let count = 0;
    const current = new Date(start);
    while (current <= end) {
        const dayOfWeek = current.getDay();
        const dateStr = toLocalISO(current);
        if (dayOfWeek === 6) {
            // Subota: broji se samo ako je stvarno odrađena (šihtarica) — praznik nebitan, rad je rad.
            if (saturdaysWorked.has(dateStr)) count++;
        } else if (dayOfWeek !== 0 && !holidayDates.has(dateStr)) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }

    return count;
}


/**
 * Get current month's date range
 */
export function getCurrentMonthRange(): { dateFrom: string; dateTo: string } {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    return {
        dateFrom: firstDay.toISOString().split('T')[0],
        dateTo: lastDay.toISOString().split('T')[0],
    };
}

/**
 * Get date range for last N days
 */
export function getLastNDaysRange(n: number): { dateFrom: string; dateTo: string } {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - n);

    return {
        dateFrom: start.toISOString().split('T')[0],
        dateTo: end.toISOString().split('T')[0],
    };
}
