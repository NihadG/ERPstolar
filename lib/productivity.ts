/**
 * productivity.ts - Productivity and Profitability Calculations
 * 
 * Funkcije za izračun produktivnosti radnika i profitabilnosti proizvoda.
 */

import { db } from './firebase';
import {
    collection,
    query,
    where,
    getDocs,
} from 'firebase/firestore';
import type {
    WorkerProductivity,
    ProductProfitability,
    WorkLog,
    WorkOrderItem,
    WorkerAttendance,
} from './types';

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
        // Get all work logs for this worker in the period
        const workLogsQuery = query(
            collection(db, 'work_logs'),
            where('Worker_ID', '==', workerId),
            where('Organization_ID', '==', organizationId)
        );
        const workLogsSnapshot = await getDocs(workLogsQuery);
        const allWorkLogs = workLogsSnapshot.docs.map(doc => doc.data() as WorkLog);

        // Filter by date range
        const workLogs = allWorkLogs.filter(log =>
            log.Date >= dateFrom && log.Date <= dateTo
        );

        // Get attendance records
        const attendanceQuery = query(
            collection(db, 'worker_attendance'),
            where('Worker_ID', '==', workerId),
            where('Organization_ID', '==', organizationId)
        );
        const attendanceSnapshot = await getDocs(attendanceQuery);
        const allAttendance = attendanceSnapshot.docs.map(doc => doc.data() as WorkerAttendance);

        // Filter by date range
        const attendance = allAttendance.filter(att =>
            att.Date >= dateFrom && att.Date <= dateTo
        );

        // Calculate Days_Present (Prisutan + Teren)
        const daysPresent = attendance.filter(att =>
            att.Status === 'Prisutan' || att.Status === 'Teren'
        ).length;

        // Calculate working days in period (excluding weekends)
        const workingDaysInPeriod = countWorkingDays(dateFrom, dateTo);

        // Days worked (from work logs - unique dates)
        const uniqueDates = new Set(workLogs.map(log => log.Date));
        const daysWorked = uniqueDates.size;

        // Total earnings
        const totalEarnings = workLogs.reduce((sum, log) => sum + (log.Daily_Rate || 0), 0);

        // Average daily rate
        const avgDailyRate = daysWorked > 0 ? totalEarnings / daysWorked : 0;

        // Products worked on (unique Product_IDs)
        const uniqueProducts = new Set(workLogs.map(log => log.Product_ID));
        const productsWorkedOn = uniqueProducts.size;

        // Average days per product
        const avgDaysPerProduct = productsWorkedOn > 0 ? daysWorked / productsWorkedOn : 0;

        // Get worker name from first log
        const workerName = workLogs[0]?.Worker_Name || 'Unknown';

        // Get product values for products worked on
        let valueGenerated = 0;
        if (uniqueProducts.size > 0) {
            // Get work order items to find product values
            const itemsQuery = query(
                collection(db, 'work_order_items'),
                where('Organization_ID', '==', organizationId)
            );
            const itemsSnapshot = await getDocs(itemsQuery);
            const items = itemsSnapshot.docs.map(doc => doc.data() as WorkOrderItem);

            // Sum product values for products this worker worked on
            const workerProductIds = Array.from(uniqueProducts);
            items.forEach(item => {
                if (workerProductIds.includes(item.Product_ID)) {
                    valueGenerated += item.Product_Value || 0;
                }
            });
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
// PRODUCT PROFITABILITY
// ============================================

/**
 * Calculate profitability for a specific work order item
 * Includes: all costs, profit, margin, workers who worked on it
 */
export async function calculateProductProfitability(
    workOrderItemId: string,
    organizationId: string
): Promise<ProductProfitability | null> {
    if (!organizationId) return null;

    try {
        // Get the work order item
        const itemQuery = query(
            collection(db, 'work_order_items'),
            where('ID', '==', workOrderItemId),
            where('Organization_ID', '==', organizationId)
        );
        const itemSnapshot = await getDocs(itemQuery);

        if (itemSnapshot.empty) return null;

        const item = itemSnapshot.docs[0].data() as WorkOrderItem;

        // Get work logs for this item
        const logsQuery = query(
            collection(db, 'work_logs'),
            where('Work_Order_Item_ID', '==', workOrderItemId),
            where('Organization_ID', '==', organizationId)
        );
        const logsSnapshot = await getDocs(logsQuery);
        const workLogs = logsSnapshot.docs.map(doc => doc.data() as WorkLog);

        // Calculate worker breakdown
        const workerMap = new Map<string, { Name: string; Days: number; Cost: number }>();

        for (const log of workLogs) {
            const existing = workerMap.get(log.Worker_ID);
            if (existing) {
                existing.Days += 1;
                existing.Cost += log.Daily_Rate || 0;
            } else {
                workerMap.set(log.Worker_ID, {
                    Name: log.Worker_Name,
                    Days: 1,
                    Cost: log.Daily_Rate || 0,
                });
            }
        }

        const workers = Array.from(workerMap.entries()).map(([workerId, data]) => ({
            Worker_ID: workerId,
            Name: data.Name,
            Days: data.Days,
            Cost: data.Cost,
        }));

        // Get values from item
        const sellingPrice = item.Product_Value || 0;
        const quantity = item.Quantity || 1;
        const materialCost = item.Material_Cost || 0;
        const transportShare = item.Transport_Share || 0;
        const servicesTotal = item.Services_Total || 0;
        const plannedLaborCost = item.Planned_Labor_Cost || 0;
        const actualLaborCost = workLogs.reduce((sum, log) => sum + (log.Daily_Rate || 0), 0);

        // Calculate variance
        const laborVariance = plannedLaborCost - actualLaborCost;
        const laborVariancePercent = plannedLaborCost > 0
            ? (laborVariance / plannedLaborCost) * 100
            : 0;

        // Calculate profits
        const grossProfit = sellingPrice - materialCost - transportShare - servicesTotal;
        const netProfit = grossProfit - actualLaborCost;
        const profitMargin = sellingPrice > 0 ? (netProfit / sellingPrice) * 100 : 0;

        // Calculate duration
        let durationDays: number | undefined;
        if (item.Started_At && item.Completed_At) {
            const start = new Date(item.Started_At);
            const end = new Date(item.Completed_At);
            durationDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        }

        return {
            Product_ID: item.Product_ID,
            Product_Name: item.Product_Name || 'Unknown',
            Work_Order_Item_ID: workOrderItemId,
            Selling_Price: sellingPrice,
            Quantity: quantity,
            Material_Cost: materialCost,
            Transport_Share: transportShare,
            Services_Total: servicesTotal,
            Planned_Labor_Cost: plannedLaborCost,
            Actual_Labor_Cost: actualLaborCost,
            Labor_Variance: laborVariance,
            Labor_Variance_Percent: Math.round(laborVariancePercent * 10) / 10,
            Gross_Profit: grossProfit,
            Net_Profit: netProfit,
            Profit_Margin: Math.round(profitMargin * 10) / 10,
            Workers: workers,
            Started_At: item.Started_At,
            Completed_At: item.Completed_At,
            Duration_Days: durationDays,
        };
    } catch (error) {
        console.error('calculateProductProfitability error:', error);
        return null;
    }
}

// ============================================
// WORK ORDER PROFITABILITY
// ============================================

/**
 * Calculate profitability for an entire work order
 * Aggregates all items
 */
export async function calculateWorkOrderProfitability(
    workOrderId: string,
    organizationId: string
): Promise<{
    totalValue: number;
    materialCost: number;
    transportCost: number;
    servicesCost: number;
    plannedLaborCost: number;
    actualLaborCost: number;
    laborVariance: number;
    laborVariancePercent: number;
    grossProfit: number;
    netProfit: number;
    profitMargin: number;
    items: ProductProfitability[];
} | null> {
    if (!organizationId) return null;

    try {
        // Get all work order items
        const itemsQuery = query(
            collection(db, 'work_order_items'),
            where('Work_Order_ID', '==', workOrderId),
            where('Organization_ID', '==', organizationId)
        );
        const itemsSnapshot = await getDocs(itemsQuery);
        const items = itemsSnapshot.docs.map(doc => doc.data() as WorkOrderItem);

        if (items.length === 0) return null;

        // Calculate profitability for each item
        const itemProfitabilities: ProductProfitability[] = [];
        for (const item of items) {
            const profitability = await calculateProductProfitability(item.ID, organizationId);
            if (profitability) {
                itemProfitabilities.push(profitability);
            }
        }

        // Aggregate values
        const totalValue = itemProfitabilities.reduce((sum, p) => sum + p.Selling_Price, 0);
        const materialCost = itemProfitabilities.reduce((sum, p) => sum + p.Material_Cost, 0);
        const transportCost = itemProfitabilities.reduce((sum, p) => sum + p.Transport_Share, 0);
        const servicesCost = itemProfitabilities.reduce((sum, p) => sum + p.Services_Total, 0);
        const plannedLaborCost = itemProfitabilities.reduce((sum, p) => sum + p.Planned_Labor_Cost, 0);
        const actualLaborCost = itemProfitabilities.reduce((sum, p) => sum + p.Actual_Labor_Cost, 0);

        const laborVariance = plannedLaborCost - actualLaborCost;
        const laborVariancePercent = plannedLaborCost > 0
            ? (laborVariance / plannedLaborCost) * 100
            : 0;

        const grossProfit = totalValue - materialCost - transportCost - servicesCost;
        const netProfit = grossProfit - actualLaborCost;
        const profitMargin = totalValue > 0 ? (netProfit / totalValue) * 100 : 0;

        return {
            totalValue,
            materialCost,
            transportCost,
            servicesCost,
            plannedLaborCost,
            actualLaborCost,
            laborVariance,
            laborVariancePercent: Math.round(laborVariancePercent * 10) / 10,
            grossProfit,
            netProfit,
            profitMargin: Math.round(profitMargin * 10) / 10,
            items: itemProfitabilities,
        };
    } catch (error) {
        console.error('calculateWorkOrderProfitability error:', error);
        return null;
    }
}

// ============================================
// WORKER EARNINGS SUMMARY
// ============================================

/**
 * Get earnings summary for all workers in a period
 * For dashboard widget
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
        // Get all work logs in the period
        const logsQuery = query(
            collection(db, 'work_logs'),
            where('Organization_ID', '==', organizationId)
        );
        const logsSnapshot = await getDocs(logsQuery);
        const allLogs = logsSnapshot.docs.map(doc => doc.data() as WorkLog);

        // Filter by date range
        const logs = allLogs.filter(log =>
            log.Date >= dateFrom && log.Date <= dateTo
        );

        // Group by worker
        const workerMap = new Map<string, { Name: string; Days: number; TotalRate: number }>();

        for (const log of logs) {
            const existing = workerMap.get(log.Worker_ID);
            if (existing) {
                existing.Days += 1;
                existing.TotalRate += log.Daily_Rate || 0;
            } else {
                workerMap.set(log.Worker_ID, {
                    Name: log.Worker_Name,
                    Days: 1,
                    TotalRate: log.Daily_Rate || 0,
                });
            }
        }

        const workers = Array.from(workerMap.entries())
            .map(([workerId, data]) => ({
                Worker_ID: workerId,
                Worker_Name: data.Name,
                Days: data.Days,
                Avg_Daily_Rate: data.Days > 0 ? Math.round((data.TotalRate / data.Days) * 100) / 100 : 0,
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

/**
 * Count working days (Monday-Friday) between two dates
 */
function countWorkingDays(dateFrom: string, dateTo: string): number {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    let count = 0;

    const current = new Date(start);
    while (current <= end) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
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
