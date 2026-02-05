/**
 * ERP App Diagnostic Script
 * Run this in the browser console to check for data inconsistencies
 * 
 * Usage: 
 * 1. Open the app in Chrome/Firefox
 * 2. Open Developer Tools (F12)
 * 3. Go to Console tab
 * 4. Paste this entire script and press Enter
 */

(async function runDiagnostics() {
    console.log('=== ERP APP DIAGNOSTICS ===\n');

    // Try to access appState from React component state
    // This requires React DevTools or accessing internal state
    let appState = null;

    // Method 1: Check if exposed globally (add window.appState = appState in page.tsx for debugging)
    if (window.appState) {
        appState = window.appState;
        console.log('✓ Found appState via window.appState');
    }

    if (!appState) {
        console.error('❌ Could not access appState.');
        console.log('TIP: Add "window.appState = appState" in page.tsx useEffect to expose it.');
        console.log('Or use React DevTools to inspect the component state.');
        return;
    }

    const issues = [];

    // ============================================
    // CHECK 1: Product Status Mismatches
    // ============================================
    console.log('📋 Check 1: Product Status Sync...');

    const VALID_PRODUCT_STATUSES = [
        'Na čekanju', 'Materijali naručeni', 'Materijali spremni',
        'Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje',
        'Spremno', 'Instalirano'
    ];
    const LEGACY_STATUSES = ['Čeka proizvodnju', 'U proizvodnji', 'Završeno'];

    (appState.projects || []).forEach(function (project) {
        (project.products || []).forEach(function (product) {
            if (LEGACY_STATUSES.includes(product.Status)) {
                issues.push({
                    category: 'Product Status',
                    severity: 'MEDIUM',
                    description: 'Product "' + product.Name + '" has legacy status "' + product.Status + '"',
                    data: { projectId: project.Project_ID, productId: product.Product_ID }
                });
            } else if (!VALID_PRODUCT_STATUSES.includes(product.Status)) {
                issues.push({
                    category: 'Product Status',
                    severity: 'LOW',
                    description: 'Product "' + product.Name + '" has unknown status "' + product.Status + '"',
                    data: { projectId: project.Project_ID, productId: product.Product_ID }
                });
            }
        });
    });

    // ============================================
    // CHECK 2: Work Order Item vs Product Status Mismatch
    // ============================================
    console.log('📋 Check 2: Work Order ↔ Product Status Consistency...');

    (appState.workOrders || []).forEach(function (wo) {
        (wo.items || []).forEach(function (item) {
            var project = (appState.projects || []).find(function (p) { return p.Project_ID === item.Project_ID; });
            var product = project ? (project.products || []).find(function (p) { return p.Product_ID === item.Product_ID; }) : null;

            if (product) {
                if (item.Status === 'Završeno' && ['Spremno', 'Instalirano'].indexOf(product.Status) === -1) {
                    issues.push({
                        category: 'Sync Mismatch',
                        severity: 'HIGH',
                        description: 'WO Item "' + item.Product_Name + '" is Završeno but Product status is "' + product.Status + '"',
                        data: { workOrderId: wo.Work_Order_ID, productStatus: product.Status, itemStatus: item.Status }
                    });
                }

                if (item.Status === 'U toku' && ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'].indexOf(product.Status) !== -1) {
                    issues.push({
                        category: 'Sync Mismatch',
                        severity: 'MEDIUM',
                        description: 'WO Item "' + item.Product_Name + '" is U toku but Product status is still "' + product.Status + '"',
                        data: { workOrderId: wo.Work_Order_ID }
                    });
                }
            }
        });
    });

    // ============================================
    // CHECK 3: Profit Calculation Integrity
    // ============================================
    console.log('📋 Check 3: Profit Calculation...');

    (appState.workOrders || []).forEach(function (wo) {
        if (wo.Status === 'Završeno') {
            var calculatedTotalValue = (wo.items || []).reduce(function (sum, i) { return sum + (i.Product_Value || 0); }, 0);
            var calculatedMaterialCost = (wo.items || []).reduce(function (sum, i) { return sum + (i.Material_Cost || 0); }, 0);
            var calculatedLaborCost = (wo.items || []).reduce(function (sum, i) { return sum + (i.Actual_Labor_Cost || 0); }, 0);
            var calculatedProfit = calculatedTotalValue - calculatedMaterialCost - calculatedLaborCost;

            if (wo.Profit !== undefined && Math.abs(wo.Profit - calculatedProfit) > 1) {
                issues.push({
                    category: 'Calculation',
                    severity: 'HIGH',
                    description: 'WO ' + wo.Work_Order_Number + ' profit mismatch: stored=' + (wo.Profit || 0).toFixed(2) + ', calculated=' + calculatedProfit.toFixed(2),
                    data: { workOrderId: wo.Work_Order_ID, stored: wo.Profit, calculated: calculatedProfit }
                });
            }

            if (!wo.Total_Value || wo.Total_Value === 0) {
                issues.push({
                    category: 'Missing Data',
                    severity: 'MEDIUM',
                    description: 'WO ' + wo.Work_Order_Number + ' has no Total_Value',
                    data: { workOrderId: wo.Work_Order_ID }
                });
            }
        }
    });

    // ============================================
    // CHECK 4: Work Order Item Missing Dates
    // ============================================
    console.log('📋 Check 4: Missing Dates on Completed Items...');

    (appState.workOrders || []).forEach(function (wo) {
        (wo.items || []).forEach(function (item) {
            if (item.Status === 'Završeno') {
                if (!item.Started_At) {
                    issues.push({
                        category: 'Missing Data',
                        severity: 'MEDIUM',
                        description: 'WO Item "' + item.Product_Name + '" is Završeno but has no Started_At',
                        data: { workOrderId: wo.Work_Order_ID, itemId: item.ID }
                    });
                }
                if (!item.Completed_At) {
                    issues.push({
                        category: 'Missing Data',
                        severity: 'MEDIUM',
                        description: 'WO Item "' + item.Product_Name + '" is Završeno but has no Completed_At',
                        data: { workOrderId: wo.Work_Order_ID, itemId: item.ID }
                    });
                }
            }
        });
    });

    // ============================================
    // SUMMARY
    // ============================================
    console.log('\n=== DIAGNOSTIC RESULTS ===\n');

    var highIssues = issues.filter(function (i) { return i.severity === 'HIGH'; });
    var mediumIssues = issues.filter(function (i) { return i.severity === 'MEDIUM'; });
    var lowIssues = issues.filter(function (i) { return i.severity === 'LOW'; });

    console.log('🔴 HIGH Severity: ' + highIssues.length);
    console.log('🟡 MEDIUM Severity: ' + mediumIssues.length);
    console.log('🟢 LOW Severity: ' + lowIssues.length);
    console.log('📊 TOTAL Issues: ' + issues.length);

    if (issues.length > 0) {
        console.log('\n--- ISSUES BY CATEGORY ---');
        var categories = [];
        issues.forEach(function (i) {
            if (categories.indexOf(i.category) === -1) categories.push(i.category);
        });
        categories.forEach(function (cat) {
            var catIssues = issues.filter(function (i) { return i.category === cat; });
            console.log('\n' + cat + ': ' + catIssues.length + ' issue(s)');
            catIssues.slice(0, 5).forEach(function (issue) {
                console.log('  [' + issue.severity + '] ' + issue.description);
            });
            if (catIssues.length > 5) {
                console.log('  ... and ' + (catIssues.length - 5) + ' more');
            }
        });

        console.log('\n--- RECOMMENDED ACTIONS ---');
        if (highIssues.length > 0) {
            console.log('1. Run repairAllProductStatuses() to fix sync issues');
        }
        if (mediumIssues.some(function (i) { return i.category === 'Missing Data'; })) {
            console.log('2. Review Work Orders with missing dates and update them manually');
        }
    } else {
        console.log('\n✅ No issues found! Your data integrity looks good.');
    }

    window.__ERP_DIAGNOSTIC_RESULTS = issues;
    console.log('\nFull results stored in window.__ERP_DIAGNOSTIC_RESULTS');
    console.table(issues);

})();
