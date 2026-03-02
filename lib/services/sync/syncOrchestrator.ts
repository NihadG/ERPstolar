/**
 * syncOrchestrator.ts — Central sync coordination via EventBus
 * 
 * This module wires up the event-driven pipeline by subscribing to
 * events and triggering the appropriate downstream actions.
 * 
 * Call `initSyncPipeline()` once at app startup to wire everything up.
 * 
 * Pipeline Overview:
 * 
 * material:priceChanged
 *   → Recalculate affected product costs
 *   → Recalculate affected work orders
 * 
 * attendance:marked
 *   → Work logs already created by markAttendanceAndRecalculate
 *   → Emit data refresh event for UI
 * 
 * workOrder:recalculated
 *   → Emit data refresh for workOrders collection
 * 
 * workOrder:completed
 *   → Create production snapshot
 *   → Sync product/project statuses
 *   → Emit data refresh for projects + workOrders
 * 
 * order:statusChanged
 *   → Emit data refresh for orders collection
 */

import { eventBus } from '../eventBus';

let initialized = false;

export function initSyncPipeline(): void {
    if (initialized) return;
    initialized = true;

    // ---- Material Price → Cost Cascade ----
    eventBus.on('material:priceChanged', async ({ materialId, organizationId }) => {
        console.log(`[SyncPipeline] Material price changed: ${materialId}`);
        // Cost propagation already handled in materialCatalogService.saveMaterial
        // Emit UI refresh
        eventBus.emit('data:collectionsChanged', { collections: ['projects', 'workOrders'] });
    });

    // ---- Product Cost → WO Recalculation ----
    eventBus.on('product:costRecalculated', async ({ productId, organizationId }) => {
        console.log(`[SyncPipeline] Product cost recalculated: ${productId}`);
        // WO recalculation already triggered in productService.recalculateProductCost
        eventBus.emit('data:collectionsChanged', { collections: ['projects', 'workOrders'] });
    });

    // ---- Attendance → UI Refresh ----
    eventBus.on('attendance:marked', async ({ workerId, date, organizationId }) => {
        console.log(`[SyncPipeline] Attendance marked: ${workerId} on ${date}`);
        // Work logs + recalculation already done by markAttendanceAndRecalculate
        eventBus.emit('data:collectionsChanged', { collections: ['workOrders', 'workLogs'] });
    });

    // ---- Work Order Completed → Snapshot + Status Sync ----
    eventBus.on('workOrder:completed', async ({ workOrderId, organizationId }) => {
        console.log(`[SyncPipeline] Work order completed: ${workOrderId}`);
        // Production snapshot + status sync handled by completeWorkOrderItem
        eventBus.emit('data:collectionsChanged', { collections: ['projects', 'workOrders'] });
    });

    // ---- Work Order Recalculated → UI Refresh ----
    eventBus.on('workOrder:recalculated', async ({ workOrderId }) => {
        eventBus.emit('data:collectionsChanged', { collections: ['workOrders'] });
    });

    // ---- Order Status Change → UI Refresh ----
    eventBus.on('order:statusChanged', async ({ orderId }) => {
        eventBus.emit('data:collectionsChanged', { collections: ['orders'] });
    });

    // ---- Project Status Change → UI Refresh ----
    eventBus.on('project:statusChanged', async ({ projectId }) => {
        eventBus.emit('data:collectionsChanged', { collections: ['projects'] });
    });

    console.log('[SyncPipeline] Initialized — event-driven pipeline active');
}

/**
 * Tear down the sync pipeline (for testing/hot-reload).
 */
export function destroySyncPipeline(): void {
    eventBus.off();
    initialized = false;
}

/**
 * Get pipeline status for diagnostics.
 */
export function getSyncPipelineStats() {
    return {
        initialized,
        eventBusStats: eventBus.stats,
    };
}
