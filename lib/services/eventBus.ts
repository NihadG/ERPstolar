/**
 * eventBus.ts — Typed in-memory event emitter for cross-service communication
 * 
 * Replaces imperative sync calls with declarative event-driven pipeline.
 * 
 * Instead of:
 *   await recalculateWorkOrder(woId);
 *   await syncProductStatuses(items);
 *   await syncProjectStatus(projectId);
 * 
 * Services now emit events:
 *   eventBus.emit('workOrder:recalculated', { workOrderId, organizationId });
 * 
 * And other services subscribe:
 *   eventBus.on('workOrder:recalculated', async ({ workOrderId }) => {
 *     await syncProductStatuses(...);
 *   });
 * 
 * Benefits:
 * - Services don't need to know about each other
 * - Adding new reactions doesn't require modifying existing code
 * - Pipeline is visible and documented in one place
 */

// ============================================
// EVENT TYPE DEFINITIONS
// ============================================

export interface EventMap {
    // Material events
    'material:priceChanged': { materialId: string; organizationId: string };
    'material:added': { materialId: string; productId: string; organizationId: string };
    'material:removed': { materialId: string; productId: string; organizationId: string };
    'material:statusChanged': { materialId: string; newStatus: string; organizationId: string };

    // Product events
    'product:costRecalculated': { productId: string; newCost: number; organizationId: string };
    'product:statusChanged': { productId: string; newStatus: string; organizationId: string };
    'product:deleted': { productId: string; projectId: string; organizationId: string };

    // Project events
    'project:statusChanged': { projectId: string; newStatus: string; organizationId: string };

    // Work Order events
    'workOrder:created': { workOrderId: string; organizationId: string };
    'workOrder:started': { workOrderId: string; organizationId: string };
    'workOrder:completed': { workOrderId: string; organizationId: string };
    'workOrder:recalculated': { workOrderId: string; organizationId: string };
    'workOrder:itemUpdated': { workOrderId: string; itemId: string; organizationId: string };

    // Attendance / Labor events
    'attendance:marked': { workerId: string; date: string; status: string; organizationId: string };
    'workLog:created': { workLogId: string; workOrderId: string; organizationId: string };
    'workLog:deleted': { workerId: string; date: string; organizationId: string };
    'labor:workersChanged': { workOrderId: string; itemId: string; organizationId: string };

    // Offer events
    'offer:accepted': { offerId: string; projectId: string; organizationId: string };
    'offer:statusChanged': { offerId: string; newStatus: string; organizationId: string };

    // Order events
    'order:statusChanged': { orderId: string; newStatus: string; organizationId: string };
    'order:materialsReceived': { orderId: string; materialIds: string[]; organizationId: string };

    // Data refresh events (for UI state updates)
    'data:collectionsChanged': { collections: string[] };
    'data:fullRefreshNeeded': {};
}

// ============================================
// EVENT BUS IMPLEMENTATION
// ============================================

type EventHandler<T> = (payload: T) => void | Promise<void>;

class EventBus {
    private handlers = new Map<string, Set<EventHandler<any>>>();
    private asyncErrors: Array<{ event: string; error: unknown }> = [];

    /**
     * Subscribe to an event.
     * Returns an unsubscribe function.
     */
    on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(handler);

        return () => {
            this.handlers.get(event)?.delete(handler);
        };
    }

    /**
     * Emit an event. All handlers are called.
     * Async handlers run in parallel — errors are logged but don't break the chain.
     * 
     * @param event - Event name
     * @param payload - Event data
     * @param options - { sequential: true } to run handlers in order
     */
    async emit<K extends keyof EventMap>(
        event: K,
        payload: EventMap[K],
        options?: { sequential?: boolean }
    ): Promise<void> {
        const eventHandlers = this.handlers.get(event);
        if (!eventHandlers || eventHandlers.size === 0) return;

        const handlers = Array.from(eventHandlers);

        if (options?.sequential) {
            // Run handlers one by one (for ordered pipelines)
            for (const handler of handlers) {
                try {
                    await handler(payload);
                } catch (error) {
                    console.error(`[EventBus] Error in sequential handler for "${String(event)}":`, error);
                    this.asyncErrors.push({ event: String(event), error });
                }
            }
        } else {
            // Run all handlers in parallel (default)
            const results = await Promise.allSettled(
                handlers.map(handler => Promise.resolve(handler(payload)))
            );

            results.forEach((result, i) => {
                if (result.status === 'rejected') {
                    console.error(`[EventBus] Error in handler for "${String(event)}":`, result.reason);
                    this.asyncErrors.push({ event: String(event), error: result.reason });
                }
            });
        }
    }

    /**
     * Remove all handlers for an event, or all handlers if no event specified.
     */
    off<K extends keyof EventMap>(event?: K): void {
        if (event) {
            this.handlers.delete(event);
        } else {
            this.handlers.clear();
        }
    }

    /**
     * Get count of handlers for diagnostics.
     */
    get stats() {
        const counts: Record<string, number> = {};
        this.handlers.forEach((handlers, event) => {
            counts[event] = handlers.size;
        });
        return {
            handlerCounts: counts,
            recentErrors: this.asyncErrors.slice(-10),
        };
    }
}

// Singleton instance — shared across all services
export const eventBus = new EventBus();
