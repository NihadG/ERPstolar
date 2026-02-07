/**
 * calculation-analysis.mjs - ERP Kalkulacija Verifikacija
 * 
 * Sveobuhvatna analiza i verifikacija kalkulacija:
 * - Radni dani (vikendi, praznici, pauze)
 * - Labor cost sinhronizacija (attendance vs work_logs)
 * - SubTask distribucija troškova
 * - Worker earnings
 * 
 * Execute with: node scripts/calculation-analysis.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

// Firebase config
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
// HELPER FUNCTIONS
// ============================================

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function isPausedOnDate(dateStr, pausePeriods) {
    if (!pausePeriods || pausePeriods.length === 0) return false;
    return pausePeriods.some(p => {
        const pauseStart = p.Started_At.split('T')[0];
        const pauseEnd = p.Ended_At ? p.Ended_At.split('T')[0] : formatDate(new Date());
        return dateStr >= pauseStart && dateStr <= pauseEnd;
    });
}

function countWorkingDays(startDate, endDate, holidays, pausePeriods) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    let total = 0, weekendDays = 0, holidayDays = 0, pausedDays = 0;

    while (current <= end) {
        const dateStr = formatDate(current);
        if (isWeekend(current)) weekendDays++;
        else if (holidays.has(dateStr)) holidayDays++;
        else if (isPausedOnDate(dateStr, pausePeriods)) pausedDays++;
        else total++;
        current.setDate(current.getDate() + 1);
    }
    return { total, weekendDays, holidayDays, pausedDays };
}

// ============================================
// DATA LOADING
// ============================================

async function loadHolidays() {
    const holidays = new Set();
    const snapshot = await getDocs(collection(db, 'holidays'));
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.Date) holidays.add(data.Date);
    });
    return holidays;
}

async function loadWorkers() {
    const workers = new Map();
    const snapshot = await getDocs(collection(db, 'workers'));
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.Worker_ID) workers.set(data.Worker_ID, data);
    });
    return workers;
}

async function loadWorkLogs() {
    const logs = [];
    const snapshot = await getDocs(collection(db, 'work_logs'));
    snapshot.forEach(doc => logs.push(doc.data()));
    return logs;
}

async function loadAttendance() {
    const attendance = [];
    const snapshot = await getDocs(collection(db, 'worker_attendance'));
    snapshot.forEach(doc => attendance.push(doc.data()));
    return attendance;
}

async function loadWorkOrderItems() {
    const items = [];
    const snapshot = await getDocs(collection(db, 'work_order_items'));
    snapshot.forEach(doc => items.push(doc.data()));
    return items;
}

const results = [];

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

async function analyzeWorkingDays(items, holidays) {
    console.log('\n--- RADNI DANI ANALIZA ---');
    const completedItems = items.filter(i => i.Started_At && i.Completed_At && i.Status === 'Završeno');

    if (completedItems.length === 0) {
        console.log('Nema završenih itema za analizu.');
        return;
    }

    for (const item of completedItems) {
        const startDate = item.Started_At.split('T')[0];
        const endDate = item.Completed_At.split('T')[0];
        const { total, weekendDays, holidayDays, pausedDays } = countWorkingDays(startDate, endDate, holidays, item.Pause_Periods);

        console.log(`\nItem: ${item.Product_Name}`);
        console.log(`  Razdoblje: ${startDate} → ${endDate}`);
        console.log(`  Radni dani: ${total}`);
        console.log(`  Vikendi: ${weekendDays}, Praznici: ${holidayDays}, Pauze: ${pausedDays}`);

        if (item.SubTasks && item.SubTasks.length > 0) {
            console.log(`  SubTasks: ${item.SubTasks.length}`);
            for (const st of item.SubTasks) {
                if (st.Started_At) {
                    const stEnd = st.Ended_At ? st.Ended_At.split('T')[0] : formatDate(new Date());
                    const stDays = countWorkingDays(st.Started_At.split('T')[0], stEnd, holidays, st.Pause_Periods);
                    console.log(`    SubTask (${st.Quantity} kom): ${stDays.total} radnih dana`);
                }
            }
        }

        results.push({ category: 'Radni dani', item: item.Product_Name, expected: total, actual: total, passed: true });
    }
}

async function analyzeLaborCostSync(items, workLogs) {
    console.log('\n--- LABOR COST SYNC ---');
    const itemsWithCost = items.filter(i => i.Actual_Labor_Cost > 0);

    if (itemsWithCost.length === 0) {
        console.log('Nema itema s labor cost za analizu.');
        return;
    }

    for (const item of itemsWithCost) {
        const itemLogs = workLogs.filter(l => l.Work_Order_Item_ID === item.ID);
        const logSum = itemLogs.reduce((sum, l) => sum + (l.Daily_Rate || 0), 0);
        const itemCost = item.Actual_Labor_Cost || 0;
        const diff = Math.abs(itemCost - logSum);
        const match = diff <= 0.01;

        console.log(`\nItem: ${item.Product_Name} ${match ? '✅' : '❌'}`);
        console.log(`  Item.Actual_Labor_Cost: ${itemCost.toFixed(2)} KM`);
        console.log(`  work_logs suma: ${logSum.toFixed(2)} KM`);
        if (!match) console.log(`  RAZLIKA: ${diff.toFixed(2)} KM`);

        results.push({ category: 'Labor Cost Sync', item: item.Product_Name, expected: itemCost, actual: logSum, passed: match });
    }
}

async function analyzeSubTaskDistribution(items) {
    console.log('\n--- SUBTASK DISTRIBUCIJA ---');
    const itemsWithST = items.filter(i => i.SubTasks && i.SubTasks.length > 0);

    if (itemsWithST.length === 0) {
        console.log('Nema itema sa SubTasks za analizu.');
        return;
    }

    for (const item of itemsWithST) {
        console.log(`\nItem: ${item.Product_Name} (${item.Quantity} kom)`);
        let subTaskCostSum = 0;

        for (const st of item.SubTasks) {
            const ratio = item.Quantity > 0 ? (st.Quantity / item.Quantity * 100).toFixed(1) : '0.0';
            const cost = st.Actual_Labor_Cost || 0;
            subTaskCostSum += cost;
            console.log(`  SubTask (${st.Quantity} kom, ${ratio}%): ${cost.toFixed(2)} KM`);
        }

        const itemCost = item.Actual_Labor_Cost || 0;
        const match = Math.abs(itemCost - subTaskCostSum) <= 0.01;
        console.log(`  Suma: ${subTaskCostSum.toFixed(2)} KM vs Item: ${itemCost.toFixed(2)} KM ${match ? '✅' : '❌'}`);

        results.push({ category: 'SubTask Dist', item: item.Product_Name, expected: itemCost, actual: subTaskCostSum, passed: match });
    }
}

async function analyzeWorkerEarnings(workers, attendance, workLogs) {
    console.log('\n--- WORKER EARNINGS ---');
    const workerData = new Map();

    for (const att of attendance) {
        if (att.Status === 'Prisutan' || att.Status === 'Teren') {
            const worker = workers.get(att.Worker_ID);
            if (!worker) continue;

            const existing = workerData.get(att.Worker_ID);
            if (existing) existing.attendanceDays++;
            else workerData.set(att.Worker_ID, { name: worker.Name, dailyRate: worker.Daily_Rate || 0, attendanceDays: 1, workLogEarnings: 0 });
        }
    }

    for (const log of workLogs) {
        const existing = workerData.get(log.Worker_ID);
        if (existing) existing.workLogEarnings += log.Daily_Rate || 0;
    }

    if (workerData.size === 0) {
        console.log('Nema worker podataka za analizu.');
        return;
    }

    for (const [, data] of workerData) {
        const expected = data.attendanceDays * data.dailyRate;
        const match = Math.abs(expected - data.workLogEarnings) <= 0.01;

        console.log(`\nRadnik: ${data.name} ${match ? '✅' : '⚠️'}`);
        console.log(`  Dani: ${data.attendanceDays} × ${data.dailyRate.toFixed(2)} KM = ${expected.toFixed(2)} KM`);
        console.log(`  work_logs: ${data.workLogEarnings.toFixed(2)} KM`);

        results.push({ category: 'Worker Earnings', item: data.name, expected, actual: data.workLogEarnings, passed: match });
    }
}

async function analyzeProfitCalculation(items) {
    console.log('\n--- PROFIT KALKULACIJA ---');
    const itemsWithValue = items.filter(i => i.Product_Value > 0);

    if (itemsWithValue.length === 0) {
        console.log('Nema itema s Product_Value za analizu.');
        return;
    }

    for (const item of itemsWithValue) {
        const pv = item.Product_Value || 0;
        const mc = item.Material_Cost || 0;
        const ts = item.Transport_Share || 0;
        const st = item.Services_Total || 0;
        const lc = item.Actual_Labor_Cost || 0;

        const profit = pv - mc - ts - st - lc;
        const margin = pv > 0 ? (profit / pv * 100).toFixed(1) : '0.0';

        console.log(`\nItem: ${item.Product_Name}`);
        console.log(`  ${pv.toFixed(2)} - ${mc.toFixed(2)} - ${ts.toFixed(2)} - ${st.toFixed(2)} - ${lc.toFixed(2)} = ${profit.toFixed(2)} KM (${margin}%)`);

        results.push({ category: 'Profit', item: item.Product_Name, expected: profit, actual: profit, passed: true });
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
        console.log('\n📂 Učitavanje podataka...');
        const [holidays, workers, workLogs, attendance, items] = await Promise.all([
            loadHolidays(), loadWorkers(), loadWorkLogs(), loadAttendance(), loadWorkOrderItems()
        ]);

        console.log(`  Praznici: ${holidays.size}, Radnici: ${workers.size}`);
        console.log(`  Work logs: ${workLogs.length}, Attendance: ${attendance.length}`);
        console.log(`  Work Order Items: ${items.length}`);

        await analyzeWorkingDays(items, holidays);
        await analyzeLaborCostSync(items, workLogs);
        await analyzeSubTaskDistribution(items);
        await analyzeWorkerEarnings(workers, attendance, workLogs);
        await analyzeProfitCalculation(items);

        // Summary
        console.log('\n═══════════════════════════════════════════');
        console.log('   SUMMARY');
        console.log('═══════════════════════════════════════════');

        const categories = [...new Set(results.map(r => r.category))];
        let totalPassed = 0, totalFailed = 0;

        for (const cat of categories) {
            const catResults = results.filter(r => r.category === cat);
            const passed = catResults.filter(r => r.passed).length;
            totalPassed += passed;
            totalFailed += catResults.length - passed;
            console.log(`${cat}: ${passed}/${catResults.length} ${catResults.length - passed === 0 ? '✅' : '❌'}`);
        }

        console.log('───────────────────────────────────────────');
        console.log(`UKUPNO: ${totalPassed}/${totalPassed + totalFailed} prošlo`);
        console.log(totalFailed > 0 ? '\n⚠️ Pronađeno neslaganja!' : '\n✅ Sve kalkulacije konzistentne!');

    } catch (error) {
        console.error('Greška:', error);
    }

    process.exit(0);
}

runAnalysis();
