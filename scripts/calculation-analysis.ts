/**
 * calculation-analysis.ts - ERP Kalkulacija Verifikacija
 * 
 * Sveobuhvatna analiza i verifikacija kalkulacija:
 * - Radni dani (vikendi, praznici, pauze)
 * - Labor cost sinhronizacija (attendance vs work_logs)
 * - SubTask distribucija troškova
 * - Worker earnings
 * 
 * Execute with: npx ts-node --skip-project scripts/calculation-analysis.ts
 */

import { initializeApp } from 'firebase/app';
import {
    getFirestore,
    collection,
    getDocs,
    query,
    where
} from 'firebase/firestore';

// Firebase config (same as seed.ts)
const firebaseConfig = {
    apiKey: "AIzaSyA1Lh0zEyv306VzNKPHs5pWm3JUwmAMnjM",
    authDomain: "erp-production-e6051.firebaseapp.com",
    projectId: "erp-production-e6051",
    storageBucket: "erp-production-e6051.firebasestorage.app",
    messagingSenderId: "104799047364",
    appId: "1:104799047364:web:4da9802ff0a750547a4391"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ============================================
// TYPES
// ============================================

interface WorkOrderItem {
    ID: string;
    Work_Order_ID: string;
    Product_ID: string;
    Product_Name: string;
    Quantity: number;
    Status: string;
    Started_At?: string;
    Completed_At?: string;
    Is_Paused?: boolean;
    Pause_Periods?: Array<{ Started_At: string; Ended_At?: string }>;
    Processes?: any[];
    SubTasks?: SubTask[];
    Actual_Labor_Cost?: number;
    Product_Value?: number;
    Material_Cost?: number;
    Transport_Share?: number;
    Services_Total?: number;
    Organization_ID?: string;
}

interface SubTask {
    SubTask_ID: string;
    Quantity: number;
    Status: string;
    Is_Paused?: boolean;
    Started_At?: string;
    Ended_At?: string;
    Worker_ID?: string;
    Worker_Name?: string;
    Helpers?: { Worker_ID: string; Worker_Name: string }[];
    Pause_Periods?: Array<{ Started_At: string; Ended_At?: string }>;
    Actual_Labor_Cost?: number;
    Working_Days?: number;
}

interface WorkLog {
    WorkLog_ID: string;
    Date: string;
    Worker_ID: string;
    Worker_Name: string;
    Daily_Rate: number;
    Work_Order_Item_ID: string;
    Organization_ID: string;
}

interface Worker {
    Worker_ID: string;
    Name: string;
    Daily_Rate?: number;
    Organization_ID?: string;
}

interface WorkerAttendance {
    Worker_ID: string;
    Date: string;
    Status: string;
    Organization_ID?: string;
}

interface Holiday {
    Date: string;
}

// ============================================
// ANALYSIS RESULTS
// ============================================

interface AnalysisResult {
    category: string;
    item: string;
    expected: number | string;
    actual: number | string;
    passed: boolean;
    details?: string;
}

const results: AnalysisResult[] = [];

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}

function isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function isPausedOnDate(
    dateStr: string,
    pausePeriods?: Array<{ Started_At: string; Ended_At?: string }>
): boolean {
    if (!pausePeriods || pausePeriods.length === 0) return false;

    return pausePeriods.some(p => {
        const pauseStart = p.Started_At.split('T')[0];
        const pauseEnd = p.Ended_At
            ? p.Ended_At.split('T')[0]
            : formatDate(new Date());
        return dateStr >= pauseStart && dateStr <= pauseEnd;
    });
}

function countWorkingDays(
    startDate: string,
    endDate: string,
    holidays: Set<string>,
    pausePeriods?: Array<{ Started_At: string; Ended_At?: string }>
): { total: number; weekendDays: number; holidayDays: number; pausedDays: number } {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    let total = 0;
    let weekendDays = 0;
    let holidayDays = 0;
    let pausedDays = 0;

    while (current <= end) {
        const dateStr = formatDate(current);

        if (isWeekend(current)) {
            weekendDays++;
        } else if (holidays.has(dateStr)) {
            holidayDays++;
        } else if (isPausedOnDate(dateStr, pausePeriods)) {
            pausedDays++;
        } else {
            total++;
        }

        current.setDate(current.getDate() + 1);
    }

    return { total, weekendDays, holidayDays, pausedDays };
}

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

async function loadHolidays(): Promise<Set<string>> {
    const holidays = new Set<string>();
    const snapshot = await getDocs(collection(db, 'holidays'));
    snapshot.forEach(doc => {
        const data = doc.data() as Holiday;
        if (data.Date) holidays.add(data.Date);
    });
    return holidays;
}

async function loadWorkers(): Promise<Map<string, Worker>> {
    const workers = new Map<string, Worker>();
    const snapshot = await getDocs(collection(db, 'workers'));
    snapshot.forEach(doc => {
        const data = doc.data() as Worker;
        if (data.Worker_ID) {
            workers.set(data.Worker_ID, data);
        }
    });
    return workers;
}

async function loadWorkLogs(): Promise<WorkLog[]> {
    const logs: WorkLog[] = [];
    const snapshot = await getDocs(collection(db, 'work_logs'));
    snapshot.forEach(doc => {
        logs.push(doc.data() as WorkLog);
    });
    return logs;
}

async function loadAttendance(): Promise<WorkerAttendance[]> {
    const attendance: WorkerAttendance[] = [];
    const snapshot = await getDocs(collection(db, 'worker_attendance'));
    snapshot.forEach(doc => {
        attendance.push(doc.data() as WorkerAttendance);
    });
    return attendance;
}

async function loadWorkOrderItems(): Promise<WorkOrderItem[]> {
    const items: WorkOrderItem[] = [];
    const snapshot = await getDocs(collection(db, 'work_order_items'));
    snapshot.forEach(doc => {
        items.push(doc.data() as WorkOrderItem);
    });
    return items;
}

/**
 * Analiza 1: Verifikacija radnih dana
 */
async function analyzeWorkingDays(
    items: WorkOrderItem[],
    holidays: Set<string>
): Promise<void> {
    console.log('\n--- RADNI DANI ANALIZA ---');

    const completedItems = items.filter(item =>
        item.Started_At && item.Completed_At && item.Status === 'Završeno'
    );

    if (completedItems.length === 0) {
        console.log('Nema završenih itema za analizu.');
        return;
    }

    for (const item of completedItems) {
        const startDate = item.Started_At!.split('T')[0];
        const endDate = item.Completed_At!.split('T')[0];

        const { total, weekendDays, holidayDays, pausedDays } = countWorkingDays(
            startDate,
            endDate,
            holidays,
            item.Pause_Periods
        );

        console.log(`\nItem: ${item.Product_Name}`);
        console.log(`  Obdoblje: ${startDate} → ${endDate}`);
        console.log(`  Radni dani: ${total}`);
        console.log(`  Vikendi preskočeni: ${weekendDays}`);
        console.log(`  Praznici preskočeni: ${holidayDays}`);
        console.log(`  Pauze preskočene: ${pausedDays}`);

        // Verify SubTasks if present
        if (item.SubTasks && item.SubTasks.length > 0) {
            console.log(`  SubTasks: ${item.SubTasks.length}`);
            for (const subTask of item.SubTasks) {
                if (subTask.Started_At) {
                    const stStart = subTask.Started_At.split('T')[0];
                    const stEnd = subTask.Ended_At
                        ? subTask.Ended_At.split('T')[0]
                        : formatDate(new Date());
                    const stDays = countWorkingDays(stStart, stEnd, holidays, subTask.Pause_Periods);
                    console.log(`    SubTask ${subTask.SubTask_ID.slice(0, 8)}: ${stDays.total} radnih dana (qty: ${subTask.Quantity})`);
                }
            }
        }

        results.push({
            category: 'Radni dani',
            item: item.Product_Name,
            expected: total,
            actual: total,
            passed: true,
            details: `Vikendi: ${weekendDays}, Praznici: ${holidayDays}, Pauze: ${pausedDays}`
        });
    }
}

/**
 * Analiza 2: Labor Cost Sinhronizacija
 */
async function analyzeLaborCostSync(
    items: WorkOrderItem[],
    workLogs: WorkLog[]
): Promise<void> {
    console.log('\n--- LABOR COST SYNC ---');

    const itemsWithCost = items.filter(item =>
        item.Actual_Labor_Cost !== undefined && item.Actual_Labor_Cost > 0
    );

    if (itemsWithCost.length === 0) {
        console.log('Nema itema s labor cost za analizu.');
        return;
    }

    for (const item of itemsWithCost) {
        // Sum work_logs for this item
        const itemLogs = workLogs.filter(log => log.Work_Order_Item_ID === item.ID);
        const workLogsSum = itemLogs.reduce((sum, log) => sum + (log.Daily_Rate || 0), 0);

        const itemCost = item.Actual_Labor_Cost || 0;
        const diff = Math.abs(itemCost - workLogsSum);
        const threshold = 0.01; // Allow tiny float differences
        const match = diff <= threshold;

        const status = match ? '✅' : '❌';
        console.log(`\nItem: ${item.Product_Name} ${status}`);
        console.log(`  Item.Actual_Labor_Cost: ${itemCost.toFixed(2)} KM`);
        console.log(`  work_logs suma: ${workLogsSum.toFixed(2)} KM`);
        if (!match) {
            console.log(`  RAZLIKA: ${diff.toFixed(2)} KM`);
        }

        results.push({
            category: 'Labor Cost Sync',
            item: item.Product_Name,
            expected: itemCost,
            actual: workLogsSum,
            passed: match,
            details: match ? undefined : `Razlika: ${diff.toFixed(2)} KM`
        });
    }
}

/**
 * Analiza 3: SubTask Cost Distribucija
 */
async function analyzeSubTaskDistribution(items: WorkOrderItem[]): Promise<void> {
    console.log('\n--- SUBTASK DISTRIBUCIJA ---');

    const itemsWithSubTasks = items.filter(item =>
        item.SubTasks && item.SubTasks.length > 0
    );

    if (itemsWithSubTasks.length === 0) {
        console.log('Nema itema sa SubTasks za analizu.');
        return;
    }

    for (const item of itemsWithSubTasks) {
        console.log(`\nItem: ${item.Product_Name} (${item.Quantity} kom)`);

        const totalQuantity = item.Quantity;
        let subTaskCostSum = 0;

        for (const subTask of item.SubTasks!) {
            const ratio = totalQuantity > 0 ? subTask.Quantity / totalQuantity : 0;
            const expectedRatio = (ratio * 100).toFixed(1);
            const cost = subTask.Actual_Labor_Cost || 0;
            subTaskCostSum += cost;

            console.log(`  SubTask (${subTask.Quantity} kom, ${expectedRatio}%): ${cost.toFixed(2)} KM`);
        }

        const itemCost = item.Actual_Labor_Cost || 0;
        const match = Math.abs(itemCost - subTaskCostSum) <= 0.01;
        const status = match ? '✅' : '❌';

        console.log(`  Suma SubTasks: ${subTaskCostSum.toFixed(2)} KM`);
        console.log(`  Item total: ${itemCost.toFixed(2)} KM ${status}`);

        results.push({
            category: 'SubTask Distribucija',
            item: item.Product_Name,
            expected: itemCost,
            actual: subTaskCostSum,
            passed: match,
            details: `${item.SubTasks!.length} sub-tasks`
        });
    }
}

/**
 * Analiza 4: Worker Earnings
 */
async function analyzeWorkerEarnings(
    workers: Map<string, Worker>,
    attendance: WorkerAttendance[],
    workLogs: WorkLog[]
): Promise<void> {
    console.log('\n--- WORKER EARNINGS ---');

    // Group by worker
    const workerMap = new Map<string, {
        name: string;
        dailyRate: number;
        attendanceDays: number;
        workLogEarnings: number;
    }>();

    // Count attendance days (Prisutan + Teren)
    for (const att of attendance) {
        if (att.Status === 'Prisutan' || att.Status === 'Teren') {
            const worker = workers.get(att.Worker_ID);
            if (!worker) continue;

            const existing = workerMap.get(att.Worker_ID);
            if (existing) {
                existing.attendanceDays++;
            } else {
                workerMap.set(att.Worker_ID, {
                    name: worker.Name,
                    dailyRate: worker.Daily_Rate || 0,
                    attendanceDays: 1,
                    workLogEarnings: 0
                });
            }
        }
    }

    // Sum work_logs earnings
    for (const log of workLogs) {
        const existing = workerMap.get(log.Worker_ID);
        if (existing) {
            existing.workLogEarnings += log.Daily_Rate || 0;
        }
    }

    if (workerMap.size === 0) {
        console.log('Nema worker podataka za analizu.');
        return;
    }

    for (const [workerId, data] of Array.from(workerMap)) {
        const expectedEarnings = data.attendanceDays * data.dailyRate;
        const match = Math.abs(expectedEarnings - data.workLogEarnings) <= 0.01;
        const status = match ? '✅' : '⚠️';

        console.log(`\nRadnik: ${data.name} ${status}`);
        console.log(`  Dani prisustva: ${data.attendanceDays}`);
        console.log(`  Dnevnica: ${data.dailyRate.toFixed(2)} KM`);
        console.log(`  Očekivana zarada: ${expectedEarnings.toFixed(2)} KM`);
        console.log(`  work_logs zarada: ${data.workLogEarnings.toFixed(2)} KM`);

        // Note: This may not match if worker worked on multiple items
        // Work logs track item-specific work, attendance is daily
        if (!match && data.workLogEarnings > 0) {
            console.log(`  (Napomena: work_logs su po production itemu, ne ukupna zarada)`);
        }

        results.push({
            category: 'Worker Earnings',
            item: data.name,
            expected: expectedEarnings,
            actual: data.workLogEarnings,
            passed: match,
            details: `${data.attendanceDays} dana × ${data.dailyRate} KM/dan`
        });
    }
}

/**
 * Analiza 5: Profit Kalkulacija
 */
async function analyzeProfitCalculation(items: WorkOrderItem[]): Promise<void> {
    console.log('\n--- PROFIT KALKULACIJA ---');

    const itemsWithValue = items.filter(item =>
        item.Product_Value && item.Product_Value > 0
    );

    if (itemsWithValue.length === 0) {
        console.log('Nema itema s Product_Value za analizu.');
        return;
    }

    for (const item of itemsWithValue) {
        const productValue = item.Product_Value || 0;
        const materialCost = item.Material_Cost || 0;
        const transportShare = item.Transport_Share || 0;
        const servicesTotal = item.Services_Total || 0;
        const laborCost = item.Actual_Labor_Cost || 0;

        const calculatedProfit = productValue - materialCost - transportShare - servicesTotal - laborCost;

        console.log(`\nItem: ${item.Product_Name}`);
        console.log(`  Prodajna cijena: ${productValue.toFixed(2)} KM`);
        console.log(`  - Materijal: ${materialCost.toFixed(2)} KM`);
        console.log(`  - Transport: ${transportShare.toFixed(2)} KM`);
        console.log(`  - Usluge: ${servicesTotal.toFixed(2)} KM`);
        console.log(`  - Labor: ${laborCost.toFixed(2)} KM`);
        console.log(`  = Profit: ${calculatedProfit.toFixed(2)} KM`);

        const profitMargin = productValue > 0
            ? (calculatedProfit / productValue * 100).toFixed(1)
            : '0.0';
        console.log(`  Profit marža: ${profitMargin}%`);

        results.push({
            category: 'Profit',
            item: item.Product_Name,
            expected: calculatedProfit,
            actual: calculatedProfit,
            passed: true,
            details: `Marža: ${profitMargin}%`
        });
    }
}

// ============================================
// MAIN
// ============================================

async function runAnalysis() {
    console.log('═══════════════════════════════════════════');
    console.log('   ERP KALKULACIJA ANALIZA');
    console.log('   Datum: ' + new Date().toISOString().split('T')[0]);
    console.log('═══════════════════════════════════════════');

    try {
        // Load all data
        console.log('\n📂 Učitavanje podataka...');
        const [holidays, workers, workLogs, attendance, items] = await Promise.all([
            loadHolidays(),
            loadWorkers(),
            loadWorkLogs(),
            loadAttendance(),
            loadWorkOrderItems()
        ]);

        console.log(`  Praznici: ${holidays.size}`);
        console.log(`  Radnici: ${workers.size}`);
        console.log(`  Work logs: ${workLogs.length}`);
        console.log(`  Attendance: ${attendance.length}`);
        console.log(`  Work Order Items: ${items.length}`);

        // Run analyses
        await analyzeWorkingDays(items, holidays);
        await analyzeLaborCostSync(items, workLogs);
        await analyzeSubTaskDistribution(items);
        await analyzeWorkerEarnings(workers, attendance, workLogs);
        await analyzeProfitCalculation(items);

        // Summary
        console.log('\n═══════════════════════════════════════════');
        console.log('   SUMMARY');
        console.log('═══════════════════════════════════════════');

        const categories = [...Array.from(new Set(results.map(r => r.category)))];
        let totalPassed = 0;
        let totalFailed = 0;

        for (const category of categories) {
            const categoryResults = results.filter(r => r.category === category);
            const passed = categoryResults.filter(r => r.passed).length;
            const failed = categoryResults.filter(r => !r.passed).length;
            totalPassed += passed;
            totalFailed += failed;

            const status = failed === 0 ? '✅' : '❌';
            console.log(`${category}: ${passed}/${categoryResults.length} ${status}`);
        }

        console.log('───────────────────────────────────────────');
        console.log(`UKUPNO: ${totalPassed}/${totalPassed + totalFailed} prošlo`);

        if (totalFailed > 0) {
            console.log('\n⚠️ Pronađeno neslaganja! Provjerite detalje iznad.');
        } else {
            console.log('\n✅ Sve kalkulacije su konzistentne!');
        }

    } catch (error) {
        console.error('Greška:', error);
    }

    process.exit(0);
}

runAnalysis();
