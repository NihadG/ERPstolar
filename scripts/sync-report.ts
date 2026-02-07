/**
 * sync-report.ts - ERP Sync Report Generator
 * 
 * Generira HTML izvještaj o konzistentnosti podataka.
 * 
 * Execute with: npx ts-node --skip-project scripts/sync-report.ts
 * Output: scripts/sync-report.html
 */

import { initializeApp } from 'firebase/app';
import {
    getFirestore,
    collection,
    getDocs,
    query,
    where,
    orderBy
} from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

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
// TYPES
// ============================================

interface WorkOrder {
    Work_Order_ID: string;
    Work_Order_Number: string;
    Status: string;
    Created_Date: string;
}

interface WorkOrderItem {
    ID: string;
    Work_Order_ID: string;
    Product_Name: string;
    Quantity: number;
    Status: string;
    Started_At?: string;
    Completed_At?: string;
    Actual_Labor_Cost?: number;
    Product_Value?: number;
    Material_Cost?: number;
    SubTasks?: any[];
    Processes?: any[];
}

interface WorkLog {
    Work_Order_Item_ID: string;
    Daily_Rate: number;
    Date: string;
    Worker_Name: string;
}

interface SyncIssue {
    workOrderNumber: string;
    itemName: string;
    issueType: string;
    expected: string;
    actual: string;
    severity: 'low' | 'medium' | 'high';
}

// ============================================
// DATA LOADING
// ============================================

async function loadData() {
    console.log('📂 Učitavanje podataka...');

    const workOrdersSnap = await getDocs(collection(db, 'work_orders'));
    const workOrders: WorkOrder[] = [];
    workOrdersSnap.forEach(doc => workOrders.push(doc.data() as WorkOrder));

    const itemsSnap = await getDocs(collection(db, 'work_order_items'));
    const items: WorkOrderItem[] = [];
    itemsSnap.forEach(doc => items.push(doc.data() as WorkOrderItem));

    const logsSnap = await getDocs(collection(db, 'work_logs'));
    const logs: WorkLog[] = [];
    logsSnap.forEach(doc => logs.push(doc.data() as WorkLog));

    console.log(`  Work Orders: ${workOrders.length}`);
    console.log(`  Items: ${items.length}`);
    console.log(`  Work Logs: ${logs.length}`);

    return { workOrders, items, logs };
}

// ============================================
// SYNC CHECKS
// ============================================

function checkSync(
    workOrders: WorkOrder[],
    items: WorkOrderItem[],
    logs: WorkLog[]
): SyncIssue[] {
    const issues: SyncIssue[] = [];

    // Group items by work order
    const itemsByWO = new Map<string, WorkOrderItem[]>();
    for (const item of items) {
        const existing = itemsByWO.get(item.Work_Order_ID) || [];
        existing.push(item);
        itemsByWO.set(item.Work_Order_ID, existing);
    }

    // Group logs by item
    const logsByItem = new Map<string, WorkLog[]>();
    for (const log of logs) {
        const existing = logsByItem.get(log.Work_Order_Item_ID) || [];
        existing.push(log);
        logsByItem.set(log.Work_Order_Item_ID, existing);
    }

    // Find work order number by ID
    const woNumberMap = new Map<string, string>();
    for (const wo of workOrders) {
        woNumberMap.set(wo.Work_Order_ID, wo.Work_Order_Number);
    }

    // Check each item
    for (const item of items) {
        const woNumber = woNumberMap.get(item.Work_Order_ID) || 'Unknown';
        const itemLogs = logsByItem.get(item.ID) || [];

        // Check 1: Labor cost sync
        if (item.Actual_Labor_Cost !== undefined && item.Actual_Labor_Cost > 0) {
            const logSum = itemLogs.reduce((sum, l) => sum + (l.Daily_Rate || 0), 0);
            const diff = Math.abs(item.Actual_Labor_Cost - logSum);

            if (diff > 0.01) {
                issues.push({
                    workOrderNumber: woNumber,
                    itemName: item.Product_Name,
                    issueType: 'Labor Cost Mismatch',
                    expected: `${item.Actual_Labor_Cost.toFixed(2)} KM (item)`,
                    actual: `${logSum.toFixed(2)} KM (work_logs)`,
                    severity: diff > 100 ? 'high' : diff > 10 ? 'medium' : 'low'
                });
            }
        }

        // Check 2: Started but no work logs
        if (item.Started_At && itemLogs.length === 0 && item.Status !== 'Na čekanju') {
            issues.push({
                workOrderNumber: woNumber,
                itemName: item.Product_Name,
                issueType: 'Missing Work Logs',
                expected: 'Work logs za started item',
                actual: '0 work logs',
                severity: 'medium'
            });
        }

        // Check 3: SubTask cost distribution
        if (item.SubTasks && item.SubTasks.length > 0) {
            const subTaskSum = item.SubTasks.reduce((sum: number, st: any) =>
                sum + (st.Actual_Labor_Cost || 0), 0);
            const itemCost = item.Actual_Labor_Cost || 0;

            if (Math.abs(itemCost - subTaskSum) > 0.01 && itemCost > 0) {
                issues.push({
                    workOrderNumber: woNumber,
                    itemName: item.Product_Name,
                    issueType: 'SubTask Cost Mismatch',
                    expected: `${itemCost.toFixed(2)} KM (item total)`,
                    actual: `${subTaskSum.toFixed(2)} KM (subtask sum)`,
                    severity: 'medium'
                });
            }
        }

        // Check 4: Completed but no labor cost
        if (item.Status === 'Završeno' && (!item.Actual_Labor_Cost || item.Actual_Labor_Cost === 0)) {
            // Only flag if there are assigned workers in Processes
            if (item.Processes && item.Processes.some((p: any) => p.Worker_ID)) {
                issues.push({
                    workOrderNumber: woNumber,
                    itemName: item.Product_Name,
                    issueType: 'Missing Labor Cost',
                    expected: 'Labor cost > 0 za finished item',
                    actual: '0 KM',
                    severity: 'low'
                });
            }
        }
    }

    return issues;
}

// ============================================
// HTML GENERATION
// ============================================

function generateHTML(
    workOrders: WorkOrder[],
    items: WorkOrderItem[],
    issues: SyncIssue[]
): string {
    const now = new Date().toLocaleString('hr-HR');

    const issueRows = issues.map(issue => {
        const severityColor = {
            low: '#fef3c7',
            medium: '#fed7aa',
            high: '#fecaca'
        }[issue.severity];

        return `
        <tr style="background-color: ${severityColor}">
            <td>${issue.workOrderNumber}</td>
            <td>${issue.itemName}</td>
            <td>${issue.issueType}</td>
            <td>${issue.expected}</td>
            <td>${issue.actual}</td>
            <td>${issue.severity.toUpperCase()}</td>
        </tr>`;
    }).join('');

    // Summary by work order
    const woSummary = workOrders.map(wo => {
        const woItems = items.filter(i => i.Work_Order_ID === wo.Work_Order_ID);
        const woIssues = issues.filter(i => i.workOrderNumber === wo.Work_Order_Number);
        const statusClass = woIssues.length === 0 ? 'status-ok' : 'status-warning';

        return `
        <tr class="${statusClass}">
            <td>${wo.Work_Order_Number}</td>
            <td>${wo.Status}</td>
            <td>${woItems.length}</td>
            <td>${woIssues.length}</td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="hr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ERP Sync Report - ${now}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            background: #f5f5f5;
            color: #333;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { 
            color: #1a1a1a;
            margin-bottom: 8px;
        }
        .subtitle { color: #666; margin-bottom: 24px; }
        .card {
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 20px;
            margin-bottom: 20px;
        }
        .card h2 {
            font-size: 18px;
            margin-bottom: 16px;
            color: #333;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 10px 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        th {
            background: #f8f8f8;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            color: #666;
        }
        .status-ok { background: #d1fae5; }
        .status-warning { background: #fef3c7; }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        .summary-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .summary-card .value {
            font-size: 32px;
            font-weight: 700;
            color: #333;
        }
        .summary-card .label {
            font-size: 14px;
            color: #666;
            margin-top: 4px;
        }
        .summary-card.success { border-left: 4px solid #10b981; }
        .summary-card.warning { border-left: 4px solid #f59e0b; }
        .summary-card.error { border-left: 4px solid #ef4444; }
        .no-issues {
            text-align: center;
            padding: 40px;
            color: #10b981;
        }
        .no-issues svg {
            width: 48px;
            height: 48px;
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 ERP Sync Report</h1>
        <p class="subtitle">Generisano: ${now}</p>
        
        <div class="summary-grid">
            <div class="summary-card ${issues.length === 0 ? 'success' : 'warning'}">
                <div class="value">${workOrders.length}</div>
                <div class="label">Radnih Naloga</div>
            </div>
            <div class="summary-card">
                <div class="value">${items.length}</div>
                <div class="label">Stavki</div>
            </div>
            <div class="summary-card ${issues.length === 0 ? 'success' : 'error'}">
                <div class="value">${issues.length}</div>
                <div class="label">Pronađenih Problema</div>
            </div>
            <div class="summary-card ${issues.filter(i => i.severity === 'high').length === 0 ? 'success' : 'error'}">
                <div class="value">${issues.filter(i => i.severity === 'high').length}</div>
                <div class="label">Kritičnih</div>
            </div>
        </div>
        
        <div class="card">
            <h2>📋 Pregled Radnih Naloga</h2>
            <table>
                <thead>
                    <tr>
                        <th>Broj Naloga</th>
                        <th>Status</th>
                        <th>Stavki</th>
                        <th>Problema</th>
                    </tr>
                </thead>
                <tbody>
                    ${woSummary}
                </tbody>
            </table>
        </div>
        
        ${issues.length > 0 ? `
        <div class="card">
            <h2>⚠️ Pronađeni Problemi</h2>
            <table>
                <thead>
                    <tr>
                        <th>Nalog</th>
                        <th>Stavka</th>
                        <th>Tip Problema</th>
                        <th>Očekivano</th>
                        <th>Stvarno</th>
                        <th>Ozbiljnost</th>
                    </tr>
                </thead>
                <tbody>
                    ${issueRows}
                </tbody>
            </table>
        </div>
        ` : `
        <div class="card">
            <div class="no-issues">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <h3>Sve je u redu!</h3>
                <p>Nisu pronađeni problemi sinhronizacije.</p>
            </div>
        </div>
        `}
    </div>
</body>
</html>`;
}

// ============================================
// MAIN
// ============================================

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('   ERP SYNC REPORT GENERATOR');
    console.log('═══════════════════════════════════════════\n');

    try {
        const { workOrders, items, logs } = await loadData();

        console.log('\n🔍 Provjeravam sinhronizaciju...');
        const issues = checkSync(workOrders, items, logs);

        console.log(`  Pronađeno problema: ${issues.length}`);
        if (issues.length > 0) {
            console.log(`    - High: ${issues.filter(i => i.severity === 'high').length}`);
            console.log(`    - Medium: ${issues.filter(i => i.severity === 'medium').length}`);
            console.log(`    - Low: ${issues.filter(i => i.severity === 'low').length}`);
        }

        console.log('\n📝 Generišem HTML izvještaj...');
        const html = generateHTML(workOrders, items, issues);

        const outputPath = path.join(__dirname, 'sync-report.html');
        fs.writeFileSync(outputPath, html);

        console.log(`\n✅ Izvještaj sačuvan: ${outputPath}`);
        console.log('\nOtvorite u browseru za pregled.');

    } catch (error) {
        console.error('Greška:', error);
    }

    process.exit(0);
}

main();
