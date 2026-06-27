/**
 * analyticsService.ts — Jedinstvena analitika (Profiti → full-screen).
 *
 * Jedan batch dohvat (work_orders, work_order_items, work_logs) + čiste agregacije
 * iz lib/analytics.ts. Uzor: profitDashboardService (batch + index u memoriji).
 */

import { COLLECTIONS } from '../shared/collections';
import { queryByOrg } from '../shared/firestoreClient';
import type { WorkOrderItem, WorkLog, WorkOrder } from '../../types';
import {
    aggregateProducts, aggregateProjects, planVsActual, aggregateWorkers,
    weeklyLaborTrend, computeKpis,
    type AItem, type ALog, type DateRange,
    type ProductRow, type ProjectRow, type WorkerRow, type PvARow, type WeekBucket, type Kpis,
} from '../../analytics';

export type AnalyticsScope = 'active' | 'all';

export interface AnalyticsOptions {
    from?: string;            // YYYY-MM-DD (radnici + trend)
    to?: string;
    scope?: AnalyticsScope;   // profitabilnost: aktivni nalozi vs svi (default 'active')
}

export interface AnalyticsData {
    kpis: Kpis;
    products: ProductRow[];
    projects: ProjectRow[];
    workers: WorkerRow[];
    planVsActual: { total: PvARow; byProject: PvARow[] };
    weeklyTrend: WeekBucket[];
    range: DateRange;
    scope: AnalyticsScope;
}

function emptyData(scope: AnalyticsScope, range: DateRange): AnalyticsData {
    return {
        kpis: { revenue: 0, material: 0, labor: 0, services: 0, transport: 0, profit: 0, margin: 0, productCount: 0 },
        products: [], projects: [], workers: [],
        planVsActual: { total: { projectId: '', projectName: '', plannedLabor: 0, actualLabor: 0, variance: 0, variancePct: 0 }, byProject: [] },
        weeklyTrend: [], range, scope,
    };
}

export async function getAnalytics(organizationId: string, opts: AnalyticsOptions = {}): Promise<AnalyticsData> {
    const scope: AnalyticsScope = opts.scope || 'active';
    const range: DateRange = { from: opts.from, to: opts.to };
    if (!organizationId) return emptyData(scope, range);

    try {
        // Batch dohvat
        const [workOrders, allItems, allLogs] = await Promise.all([
            queryByOrg<WorkOrder>(COLLECTIONS.WORK_ORDERS, organizationId),
            queryByOrg<WorkOrderItem>(COLLECTIONS.WORK_ORDER_ITEMS, organizationId),
            queryByOrg<WorkLog>(COLLECTIONS.WORK_LOGS, organizationId),
        ]);

        const woById = new Map(workOrders.map(w => [w.Work_Order_ID, w]));

        // Scope: aktivni (U toku/Na čekanju) ili svi (osim Otkazano)
        const woAllowed = (woId: string): boolean => {
            const st = woById.get(woId)?.Status;
            if (!st) return false;
            if (st === 'Otkazano') return false;
            if (scope === 'active') return st === 'U toku' || st === 'Na čekanju';
            return true;
        };

        const items: AItem[] = allItems
            .filter(it => woAllowed(it.Work_Order_ID))
            .map(it => {
                const wo = woById.get(it.Work_Order_ID);
                return {
                    ID: it.ID,
                    Product_ID: it.Product_ID,
                    Product_Name: it.Product_Name,
                    Project_ID: it.Project_ID,
                    Project_Name: it.Project_Name,
                    Work_Order_ID: it.Work_Order_ID,
                    Work_Order_Number: wo?.Work_Order_Number,
                    Work_Order_Type: wo?.Work_Order_Type,
                    Status: it.Status,
                    Product_Value: it.Product_Value,
                    Material_Cost: it.Material_Cost,
                    Services_Total: (it as { Services_Total?: number }).Services_Total,
                    Transport_Share: it.Transport_Share,
                    Planned_Labor_Cost: it.Planned_Labor_Cost,
                    Profit_Overrides: (it as { Profit_Overrides?: { Selling_Price?: number; Transport_Share?: number } }).Profit_Overrides,
                };
            });

        const logs: ALog[] = allLogs.map(l => ({
            Date: l.Date,
            Worker_ID: l.Worker_ID,
            Worker_Name: l.Worker_Name,
            Daily_Rate: l.Daily_Rate || 0,
            Day_Fraction: l.Day_Fraction,
            Work_Order_Item_ID: l.Work_Order_Item_ID,
            Product_ID: l.Product_ID,
        }));

        const products = aggregateProducts(items, logs);
        const projects = aggregateProjects(items, logs);
        const kpis = computeKpis(products);
        const pva = planVsActual(items, logs);
        const workers = aggregateWorkers(logs, range);     // period se primjenjuje na radnike
        const weeklyTrend = weeklyLaborTrend(logs, range);

        return { kpis, products, projects, workers, planVsActual: pva, weeklyTrend, range, scope };
    } catch (error) {
        console.error('getAnalytics error:', error);
        return emptyData(scope, range);
    }
}
