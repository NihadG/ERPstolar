/**
 * profitService.ts — Product/Work Order profitability + production snapshots
 * 
 * Facade over productivity.ts and database.ts snapshot functions.
 */

// ============================================
// PRODUCT PROFITABILITY
// ============================================

export async function calculateProductProfitability(
    workOrderItemId: string,
    organizationId: string
): Promise<any> {
    const { calculateProductProfitability: _calc } = await import('../../productivity');
    return _calc(workOrderItemId, organizationId);
}

export async function calculateWorkOrderProfitability(
    workOrderId: string,
    organizationId: string
): Promise<any> {
    const { calculateWorkOrderProfitability: _calc } = await import('../../productivity');
    return _calc(workOrderId, organizationId);
}

// ============================================
// WORKER PRODUCTIVITY
// ============================================

export async function calculateWorkerProductivity(
    workerId: string,
    dateFrom: string,
    dateTo: string,
    organizationId: string
): Promise<any> {
    const { calculateWorkerProductivity: _calc } = await import('../../productivity');
    return _calc(workerId, dateFrom, dateTo, organizationId);
}

// ============================================
// PROFIT OVERRIDES
// ============================================

export async function saveProfitOverrides(
    workOrderItemId: string,
    overrides: {
        Selling_Price?: number;
        Extras_Total?: number;
        Transport_Share?: number;
        Notes?: string;
    },
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { saveProfitOverrides: _save } = await import('../../database');
    return _save(workOrderItemId, overrides, organizationId);
}

// ============================================
// PRODUCTION SNAPSHOTS
// ============================================

export async function createProductionSnapshot(
    workOrderId: string,
    organizationId: string
): Promise<{ success: boolean; snapshotId?: string; message: string }> {
    const { createProductionSnapshot: _create } = await import('../../database');
    return _create(workOrderId, organizationId);
}

export async function getProductionSnapshots(
    organizationId: string
): Promise<any[]> {
    const { getProductionSnapshots: _get } = await import('../../database');
    return _get(organizationId);
}

// ============================================
// DATA GAP DETECTION (for notification-driven integrity)
// ============================================

export async function checkZeroMaterialCostProducts(
    organizationId: string,
    daysAhead?: number
): Promise<any[]> {
    const { checkZeroMaterialCostProducts: _check } = await import('../../database');
    return _check(organizationId, daysAhead);
}

export async function setManualMaterialCost(
    workOrderItemId: string,
    manualCost: number,
    organizationId: string,
    alsoUpdateProduct?: boolean
): Promise<{ success: boolean; message: string }> {
    const { setManualMaterialCost: _set } = await import('../../database');
    return _set(workOrderItemId, manualCost, organizationId, alsoUpdateProduct);
}

export async function checkUnassignedMontazaItems(organizationId: string): Promise<any[]> {
    const { checkUnassignedMontazaItems: _check } = await import('../../database');
    return _check(organizationId);
}

export async function checkZeroRateAssignedWorkers(organizationId: string): Promise<any[]> {
    const { checkZeroRateAssignedWorkers: _check } = await import('../../database');
    return _check(organizationId);
}

export async function checkProcessesWithoutWorkers(organizationId: string): Promise<any[]> {
    const { checkProcessesWithoutWorkers: _check } = await import('../../database');
    return _check(organizationId);
}

export async function checkMissingCostFields(organizationId: string): Promise<any[]> {
    const { checkMissingCostFields: _check } = await import('../../database');
    return _check(organizationId);
}

// ============================================
// DAILY PROFIT (Manual Entries)
// ============================================

export {
    saveDailyProfitEntry,
    getDailyProfitEntries,
    getDailyProfitSummary,
    deleteDailyProfitEntry,
    getTodaysMissingEntries,
} from './dailyProfitService';

export type { ProfitSummary } from './dailyProfitService';
