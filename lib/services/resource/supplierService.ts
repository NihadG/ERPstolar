/**
 * supplierService.ts — Supplier CRUD
 * 
 * Extracted from database.ts (functions: getSuppliers, saveSupplier, deleteSupplier)
 */

import { COLLECTIONS } from '../shared/collections';
import { queryByOrg, findRef, createDoc, updateDocByRef } from '../shared/firestoreClient';
import { v4 as uuidv4 } from 'uuid';
import type { Supplier } from '../../types';

// ============================================
// READ
// ============================================

export async function getSuppliers(organizationId: string): Promise<Supplier[]> {
    return queryByOrg<Supplier>(COLLECTIONS.SUPPLIERS, organizationId);
}

// ============================================
// WRITE
// ============================================

export async function saveSupplier(
    data: Partial<Supplier>,
    organizationId: string
): Promise<{ success: boolean; data?: { Supplier_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Supplier_ID;

        if (isNew) {
            data.Supplier_ID = uuidv4();
            data.Organization_ID = organizationId;
            await createDoc(COLLECTIONS.SUPPLIERS, data as Record<string, unknown>);
        } else {
            const ref = await findRef(COLLECTIONS.SUPPLIERS, 'Supplier_ID', data.Supplier_ID!, organizationId);
            if (ref) {
                const { Organization_ID, ...updateData } = data;
                await updateDocByRef(ref, updateData as Record<string, unknown>);
            }
        }

        return {
            success: true,
            data: { Supplier_ID: data.Supplier_ID! },
            message: isNew ? 'Dobavljač kreiran' : 'Dobavljač ažuriran',
        };
    } catch (error) {
        console.error('saveSupplier error:', error);
        return { success: false, message: 'Greška pri spremanju dobavljača' };
    }
}

export async function deleteSupplier(
    supplierId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const ref = await findRef(COLLECTIONS.SUPPLIERS, 'Supplier_ID', supplierId, organizationId);
        if (ref) {
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(ref);
        }

        return { success: true, message: 'Dobavljač obrisan' };
    } catch (error) {
        console.error('deleteSupplier error:', error);
        return { success: false, message: 'Greška pri brisanju dobavljača' };
    }
}
