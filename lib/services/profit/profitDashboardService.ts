/**
 * profitDashboardService.ts — Aggregated profit dashboard data
 * 
 * Provides a single-call API to get all active products' profitability,
 * with worker breakdown for the Profit Dashboard modal.
 */

import { COLLECTIONS } from '../shared/collections';
import {
    queryByOrg,
} from '../shared/firestoreClient';
import type { WorkOrderItem, WorkLog, WorkOrder } from '../../types';

// ============================================
// TYPES
// ============================================

export interface DashboardWorker {
    workerId: string;
    name: string;
    baseDailyRate: number;   // Worker's full daily rate
    splitDailyRate: number;  // Rate allocated to this product
    days: number;            // Unique days worked
    totalCost: number;       // Sum of Daily_Rate from work logs
}

export interface DailyEntry {
    date: string;
    workers: { workerId: string; name: string; rate: number }[];
}

export interface DashboardProduct {
    workOrderItemId: string;
    productId: string;
    productName: string;
    projectName: string;
    workOrderNumber: string;
    workOrderId: string;
    workOrderType: string;
    status: string;
    // Financials
    sellingPrice: number;
    materialCost: number;
    laborCost: number;
    plannedLaborCost: number;
    transportShare: number;
    servicesTotal: number;
    profit: number;
    profitMargin: number;
    // Workers
    workers: DashboardWorker[];
    // Daily breakdown
    dailyBreakdown: DailyEntry[];
}

export interface DashboardSummary {
    totalRevenue: number;
    totalMaterialCost: number;
    totalLaborCost: number;
    totalPlannedLaborCost: number;
    totalProfit: number;
    avgProfitMargin: number;
    activeProductCount: number;
    activeWorkOrderCount: number;
}

export interface ProfitDashboardData {
    products: DashboardProduct[];
    summary: DashboardSummary;
}

// ============================================
// GET ACTIVE PROFIT DASHBOARD
// ============================================

/**
 * Fetch all active work order items with full profit data in one call.
 * This is the main data source for the Profit Dashboard modal.
 */
export async function getActiveProfitDashboard(
    organizationId: string
): Promise<ProfitDashboardData> {
    if (!organizationId) {
        return { products: [], summary: emptySummary() };
    }

    try {
        // 1. Get all work orders (active ones)
        const workOrders = await queryByOrg<WorkOrder>(
            COLLECTIONS.WORK_ORDERS,
            organizationId
        );

        const activeWOs = workOrders.filter(
            wo => wo.Status === 'U toku' || wo.Status === 'Na čekanju'
        );

        if (activeWOs.length === 0) {
            return { products: [], summary: emptySummary() };
        }

        const woMap = new Map(activeWOs.map(wo => [wo.Work_Order_ID, wo]));
        const activeWOIds = activeWOs.map(wo => wo.Work_Order_ID);

        // 2. Get all work order items for active WOs
        const allItems = await queryByOrg<WorkOrderItem>(
            COLLECTIONS.WORK_ORDER_ITEMS,
            organizationId
        );

        const activeItems = allItems.filter(
            item => activeWOIds.includes(item.Work_Order_ID) &&
                    item.Status !== 'Završeno'
        );

        // 3. Get ALL work logs for these WOs (batch)
        const allWorkLogs = await queryByOrg<WorkLog>(
            COLLECTIONS.WORK_LOGS,
            organizationId
        );

        // Index work logs by Work_Order_Item_ID
        const logsByItem = new Map<string, WorkLog[]>();
        for (const log of allWorkLogs) {
            if (!activeWOIds.includes(log.Work_Order_ID)) continue;
            const existing = logsByItem.get(log.Work_Order_Item_ID) || [];
            existing.push(log);
            logsByItem.set(log.Work_Order_Item_ID, existing);
        }

        // 4. Build dashboard products
        const products: DashboardProduct[] = [];

        for (const item of activeItems) {
            const wo = woMap.get(item.Work_Order_ID);
            if (!wo) continue;

            const itemLogs = logsByItem.get(item.ID) || [];

            // Worker breakdown
            const workerMap = new Map<string, {
                name: string;
                baseDailyRate: number;
                uniqueDates: Set<string>;
                totalCost: number;
            }>();

            for (const log of itemLogs) {
                const existing = workerMap.get(log.Worker_ID);
                if (existing) {
                    existing.uniqueDates.add(log.Date);
                    existing.totalCost += log.Daily_Rate || 0;
                } else {
                    workerMap.set(log.Worker_ID, {
                        name: log.Worker_Name,
                        baseDailyRate: log.Original_Daily_Rate || log.Daily_Rate || 0,
                        uniqueDates: new Set([log.Date]),
                        totalCost: log.Daily_Rate || 0,
                    });
                }
            }

            const workers: DashboardWorker[] = Array.from(workerMap.entries()).map(
                ([workerId, data]) => ({
                    workerId,
                    name: data.name,
                    baseDailyRate: data.baseDailyRate,
                    splitDailyRate: data.uniqueDates.size > 0
                        ? Math.round((data.totalCost / data.uniqueDates.size) * 100) / 100
                        : 0,
                    days: data.uniqueDates.size,
                    totalCost: data.totalCost,
                })
            );

            // Daily breakdown
            const dayMap = new Map<string, { workerId: string; name: string; rate: number }[]>();
            for (const log of itemLogs) {
                const existing = dayMap.get(log.Date) || [];
                existing.push({
                    workerId: log.Worker_ID,
                    name: log.Worker_Name,
                    rate: log.Daily_Rate || 0,
                });
                dayMap.set(log.Date, existing);
            }

            const dailyBreakdown: DailyEntry[] = Array.from(dayMap.entries())
                .map(([date, workers]) => ({ date, workers }))
                .sort((a, b) => b.date.localeCompare(a.date));

            // Financials
            const sellingPrice = item.Product_Value || 0;
            const materialCost = item.Material_Cost || 0;
            const laborCost = itemLogs.reduce((sum, log) => sum + (log.Daily_Rate || 0), 0);
            const plannedLaborCost = item.Planned_Labor_Cost || 0;
            const transportShare = item.Transport_Share || 0;
            const servicesTotal = item.Services_Total || 0;

            const profit = sellingPrice - materialCost - laborCost - transportShare - servicesTotal;
            const profitMargin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;

            products.push({
                workOrderItemId: item.ID,
                productId: item.Product_ID,
                productName: item.Product_Name || 'Bez naziva',
                projectName: item.Project_Name || 'Nepoznat',
                workOrderNumber: wo.Work_Order_Number || '',
                workOrderId: item.Work_Order_ID,
                workOrderType: wo.Work_Order_Type || 'Proizvodnja',
                status: item.Status,
                sellingPrice,
                materialCost,
                laborCost,
                plannedLaborCost,
                transportShare,
                servicesTotal,
                profit,
                profitMargin: Math.round(profitMargin * 10) / 10,
                workers,
                dailyBreakdown,
            });
        }

        // Sort: by work order number, then by product name
        products.sort((a, b) => {
            const woCompare = a.workOrderNumber.localeCompare(b.workOrderNumber);
            if (woCompare !== 0) return woCompare;
            return a.productName.localeCompare(b.productName);
        });

        // 5. Build summary
        const uniqueWOs = new Set(products.map(p => p.workOrderId));
        const summary: DashboardSummary = {
            totalRevenue: products.reduce((s, p) => s + p.sellingPrice, 0),
            totalMaterialCost: products.reduce((s, p) => s + p.materialCost, 0),
            totalLaborCost: products.reduce((s, p) => s + p.laborCost, 0),
            totalPlannedLaborCost: products.reduce((s, p) => s + p.plannedLaborCost, 0),
            totalProfit: products.reduce((s, p) => s + p.profit, 0),
            avgProfitMargin: 0,
            activeProductCount: products.length,
            activeWorkOrderCount: uniqueWOs.size,
        };
        summary.avgProfitMargin = summary.totalRevenue > 0
            ? Math.round(((summary.totalProfit / summary.totalRevenue) * 100) * 10) / 10
            : 0;

        return { products, summary };
    } catch (error) {
        console.error('getActiveProfitDashboard error:', error);
        return { products: [], summary: emptySummary() };
    }
}




// ============================================
// HELPERS
// ============================================

function emptySummary(): DashboardSummary {
    return {
        totalRevenue: 0,
        totalMaterialCost: 0,
        totalLaborCost: 0,
        totalPlannedLaborCost: 0,
        totalProfit: 0,
        avgProfitMargin: 0,
        activeProductCount: 0,
        activeWorkOrderCount: 0,
    };
}
