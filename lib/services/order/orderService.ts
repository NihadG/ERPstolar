/**
 * orderService.ts — Order CRUD + status automation + material tracking
 * 
 * Extracted from database.ts (functions: getOrders, getOrder, getOrderItems,
 * createOrder, saveOrder, deleteOrder, updateOrderStatus, markOrderSent,
 * markMaterialsReceived, deleteOrderItemsByIds, updateOrderItem,
 * recalculateOrderTotal)
 */

import { COLLECTIONS } from '../shared/collections';
import {
    queryByOrg,
    findByIdAndOrg,
    findRef,
    createDoc,
    updateDocByRef,
    getDb,
    query,
    collection,
    where,
    getDocs,
    writeBatch,
    doc,
    deleteDoc,
} from '../shared/firestoreClient';
import { eventBus } from '../eventBus';
import { assembleOrders } from '../shared/dataAssembler';
import type { Order, OrderItem } from '../../types';

// ============================================
// READ
// ============================================

export async function getOrders(organizationId: string): Promise<Order[]> {
    if (!organizationId) return [];

    const db = getDb();
    const orgFilter = where('Organization_ID', '==', organizationId);

    const [ordersSnap, orderItemsSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.ORDERS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.ORDER_ITEMS), orgFilter)),
    ]);

    const orders = ordersSnap.docs.map(d => ({ ...d.data() } as Order));
    const orderItems = orderItemsSnap.docs.map(d => ({ ...d.data() } as OrderItem));

    assembleOrders(orders, orderItems);

    return orders;
}

export async function getOrder(orderId: string, organizationId: string): Promise<Order | null> {
    if (!organizationId) return null;
    const result = await findByIdAndOrg<Order>(COLLECTIONS.ORDERS, 'Order_ID', orderId, organizationId);
    if (!result.data) return null;

    result.data.items = await getOrderItems(orderId, organizationId);
    return result.data;
}

export async function getOrderItems(orderId: string, organizationId: string): Promise<OrderItem[]> {
    return queryByOrg<OrderItem>(COLLECTIONS.ORDER_ITEMS, organizationId, where('Order_ID', '==', orderId));
}

// ============================================
// CREATE
// ============================================

/**
 * Create order with items — delegates to database.ts for the full logic.
 */
export async function createOrder(
    data: Partial<Order> & {
        items?: (Partial<OrderItem> & { Product_Material_IDs?: string[] })[];
        onStockData?: Record<string, number>;
    },
    organizationId: string
): Promise<{ success: boolean; data?: { Order_ID: string; Order_Number: string }; message: string }> {
    const { createOrder: _create } = await import('../../database');
    return _create(data, organizationId);
}

// ============================================
// UPDATE
// ============================================

export async function saveOrder(
    data: Partial<Order>,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };

    try {
        const ref = await findRef(COLLECTIONS.ORDERS, 'Order_ID', data.Order_ID!, organizationId);
        if (!ref) return { success: false, message: 'Narudžba nije pronađena' };

        const { Organization_ID, ...updateData } = data;
        await updateDocByRef(ref, updateData as Record<string, unknown>);

        return { success: true, message: 'Narudžba ažurirana' };
    } catch (error) {
        console.error('saveOrder error:', error);
        return { success: false, message: 'Greška pri spremanju narudžbe' };
    }
}

export async function updateOrderItem(
    itemId: string,
    data: Partial<OrderItem>,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { updateOrderItem: _update } = await import('../../database');
    return _update(itemId, data, organizationId);
}

// ============================================
// DELETE
// ============================================

export async function deleteOrder(
    orderId: string,
    organizationId: string,
    materialAction?: 'received' | 'reset'
): Promise<{ success: boolean; message: string }> {
    const { deleteOrder: _delete } = await import('../../database');
    return _delete(orderId, organizationId, materialAction);
}

export async function deleteOrderItemsByIds(
    itemIds: string[],
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { deleteOrderItemsByIds: _delete } = await import('../../database');
    return _delete(itemIds, organizationId);
}

// ============================================
// STATUS MANAGEMENT
// ============================================

export async function updateOrderStatus(
    orderId: string,
    status: string,
    organizationId: string
): Promise<{ success: boolean; message: string; postCascade?: Promise<void> }> {
    const { updateOrderStatus: _update } = await import('../../database');
    const result = await _update(orderId, status, organizationId);

    if (result.success) {
        eventBus.emit('order:statusChanged', { orderId, newStatus: status, organizationId });
    }

    return result;
}

export async function markOrderSent(
    orderId: string,
    organizationId: string
): Promise<{ success: boolean; message: string; postCascade?: Promise<void> }> {
    // 'Poslano' je jedini validan "poslano" status narudžbe (ORDER_STATUSES / ALLOWED_ORDER_TRANSITIONS).
    // Ranije je slalo 'Naručeno' (status MATERIJALA, ne narudžbe) → tranzicija bi pala.
    return updateOrderStatus(orderId, 'Poslano', organizationId);
}

export async function markMaterialsReceived(
    orderItemIds: string[],
    organizationId: string
): Promise<{ success: boolean; message: string; postCascade?: Promise<void> }> {
    const { markMaterialsReceived: _mark } = await import('../../database');
    return _mark(orderItemIds, organizationId);
}

// ============================================
// RECALCULATION
// ============================================

export async function recalculateOrderTotal(
    orderId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { recalculateOrderTotal: _recalc } = await import('../../database');
    return _recalc(orderId, organizationId);
}

// ============================================
// MATERIAL STATUS BATCH UPDATE
// ============================================

export async function batchUpdateMaterialStatuses(
    updates: { materialId: string; status: string; orderId: string; orderedQty?: number; receivedQty?: number; onStock?: number; forceResetQty?: boolean }[],
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    const { batchUpdateMaterialStatuses: _update } = await import('../../database');
    return _update(updates, organizationId);
}
