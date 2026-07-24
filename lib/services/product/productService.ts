/**
 * productService.ts — Product CRUD + cost calculation
 * 
 * Extracted from database.ts (functions: getProductsByProject, getProduct,
 * saveProduct, deleteProduct, updateProductStatus, recalculateProductCost)
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
    deleteDoc,
    writeBatch,
} from '../shared/firestoreClient';
import { eventBus } from '../eventBus';
import { v4 as uuidv4 } from 'uuid';
import type { Product, ProductCutList, ProductMaterial, ProductNote } from '../../types';

// ============================================
// HELPERS
// ============================================

/**
 * When a product is renamed, propagate the new name to all collections
 * that store a denormalised Product_Name field.
 */
async function propagateProductNameChange(
    productId: string,
    newName: string,
    organizationId: string
): Promise<void> {
    const db = getDb();
    const batch = writeBatch(db);
    let hasChanges = false;

    // 1. offer_products
    const offerProductsSnap = await getDocs(query(
        collection(db, COLLECTIONS.OFFER_PRODUCTS),
        where('Product_ID', '==', productId),
        where('Organization_ID', '==', organizationId)
    ));
    offerProductsSnap.docs.forEach(d => { batch.update(d.ref, { Product_Name: newName }); hasChanges = true; });

    // 2. work_order_items
    const woItemsSnap = await getDocs(query(
        collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
        where('Product_ID', '==', productId),
        where('Organization_ID', '==', organizationId)
    ));
    woItemsSnap.docs.forEach(d => { batch.update(d.ref, { Product_Name: newName }); hasChanges = true; });

    // 3. order_items
    const orderItemsSnap = await getDocs(query(
        collection(db, COLLECTIONS.ORDER_ITEMS),
        where('Product_ID', '==', productId),
        where('Organization_ID', '==', organizationId)
    ));
    orderItemsSnap.docs.forEach(d => { batch.update(d.ref, { Product_Name: newName }); hasChanges = true; });

    if (hasChanges) {
        await batch.commit();
    }
}

// ============================================
// READ
// ============================================

export async function getProductsByProject(projectId: string, organizationId: string): Promise<Product[]> {
    if (!organizationId) return [];

    const db = getDb();
    const q = query(
        collection(db, COLLECTIONS.PRODUCTS),
        where('Project_ID', '==', projectId),
        where('Organization_ID', '==', organizationId)
    );
    const snapshot = await getDocs(q);
    const products = snapshot.docs.map(doc => ({ ...doc.data() } as Product));

    if (products.length === 0) return products;

    // PERFORMANCE: Batch-fetch all materials for all products instead of N queries
    const productIds = products.map(p => p.Product_ID);
    const materialsByProduct = new Map<string, ProductMaterial[]>();

    const batchSize = 30; // Firestore 'in' query limit
    for (let i = 0; i < productIds.length; i += batchSize) {
        const batchIds = productIds.slice(i, i + batchSize);
        const materialsQ = query(
            collection(db, COLLECTIONS.PRODUCT_MATERIALS),
            where('Product_ID', 'in', batchIds),
            where('Organization_ID', '==', organizationId)
        );
        const materialsSnap = await getDocs(materialsQ);

        materialsSnap.docs.forEach(doc => {
            const mat = doc.data() as ProductMaterial;
            if (!materialsByProduct.has(mat.Product_ID)) {
                materialsByProduct.set(mat.Product_ID, []);
            }
            materialsByProduct.get(mat.Product_ID)!.push(mat);
        });
    }

    products.forEach(product => {
        product.materials = materialsByProduct.get(product.Product_ID) || [];
    });

    return products;
}

export async function getProduct(productId: string, organizationId: string): Promise<Product | null> {
    if (!organizationId) return null;
    const result = await findByIdAndOrg<Product>(COLLECTIONS.PRODUCTS, 'Product_ID', productId, organizationId);
    if (!result.data) return null;

    const { getProductMaterials } = await import('../../database');
    result.data.materials = await getProductMaterials(productId, organizationId);
    return result.data;
}

// ============================================
// WRITE
// ============================================

export async function saveProduct(
    data: Partial<Product>,
    organizationId: string
): Promise<{ success: boolean; data?: { Product_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Product_ID;

        if (isNew) {
            data.Product_ID = uuidv4();
            data.Organization_ID = organizationId;
            data.Status = data.Status || 'Na čekanju';
            data.Material_Cost = 0;
            await createDoc(COLLECTIONS.PRODUCTS, data as Record<string, unknown>);
        } else {
            const ref = await findRef(COLLECTIONS.PRODUCTS, 'Product_ID', data.Product_ID!, organizationId);
            if (ref) {
                const { Organization_ID, ...updateData } = data;
                await updateDocByRef(ref, updateData as Record<string, unknown>);

                // Propagate name change to all dependent collections
                if (data.Name) {
                    await propagateProductNameChange(data.Product_ID!, data.Name, organizationId);
                }
            }
        }

        return {
            success: true,
            data: { Product_ID: data.Product_ID! },
            message: isNew ? 'Proizvod kreiran' : 'Proizvod ažuriran',
        };
    } catch (error) {
        console.error('saveProduct error:', error);
        return { success: false, message: 'Greška pri spremanju proizvoda' };
    }
}

export async function deleteProduct(
    productId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const db = getDb();

        // S5.2: Block deletion if product is in an active work order
        const woItemsQ = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Product_ID', '==', productId),
            where('Organization_ID', '==', organizationId)
        );
        const woItemsSnap = await getDocs(woItemsQ);
        const activeItem = woItemsSnap.docs.find(d => d.data().Status !== 'Završeno');
        if (activeItem) {
            const woId = activeItem.data().Work_Order_ID;
            return {
                success: false,
                message: `Proizvod je u aktivnom radnom nalogu (${woId}). Završite radni nalog prije brisanja proizvoda.`
            };
        }

        // Cascade delete via original database functions (using exported helpers)
        const dbModule = await import('../../database');
        const cascadeDeleteOrderItemsForProduct = dbModule.cascadeDeleteOrderItemsForProduct;
        const deleteProductMaterials = dbModule.deleteProductMaterials;
        await cascadeDeleteOrderItemsForProduct(productId, organizationId);
        await deleteProductMaterials(productId, organizationId);

        // Delete the product itself
        const ref = await findRef(COLLECTIONS.PRODUCTS, 'Product_ID', productId, organizationId);
        if (ref) {
            await deleteDoc(ref);
        }

        eventBus.emit('product:deleted', { productId, projectId: '', organizationId });

        return { success: true, message: 'Proizvod obrisan sa povezanim narudžbama' };
    } catch (error) {
        console.error('deleteProduct error:', error);
        return { success: false, message: 'Greška pri brisanju proizvoda' };
    }
}

export async function updateProductStatus(
    productId: string,
    status: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const { updateByIdAndOrg } = await import('../shared/firestoreClient');
        await updateByIdAndOrg(COLLECTIONS.PRODUCTS, 'Product_ID', productId, organizationId, { Status: status });

        eventBus.emit('product:statusChanged', { productId, newStatus: status, organizationId });

        return { success: true, message: 'Status ažuriran' };
    } catch (error) {
        console.error('updateProductStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa' };
    }
}

/**
 * Upiši SAMO listu pitanja/napomena proizvoda (Product.Questions) — ne dira
 * ostatak dokumenta. Pozivalac drži cijeli niz (čista logika iz lib/productNotes.ts)
 * i predaje ga cijelog; ovdje se samo perzistira, pa se dva istovremena uređivanja
 * ne mogu djelimično pregaziti kao kod polja-po-polje.
 */
export async function updateProductNotes(
    productId: string,
    notes: ProductNote[],
    organizationId: string,
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const ref = await findRef(COLLECTIONS.PRODUCTS, 'Product_ID', productId, organizationId);
        if (!ref) return { success: false, message: 'Proizvod nije pronađen' };
        await updateDocByRef(ref, { Questions: notes });
        return { success: true, message: 'Napomene ažurirane' };
    } catch (error) {
        console.error('updateProductNotes error:', error);
        return { success: false, message: 'Greška pri spremanju napomena' };
    }
}

/**
 * Upiši SAMO krojne liste proizvoda (Product.Cut_Lists) — isti princip kao
 * updateProductNotes: pozivalac drži cijeli niz i predaje ga cijelog.
 */
export async function updateProductCutLists(
    productId: string,
    cutLists: ProductCutList[],
    organizationId: string,
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    try {
        const ref = await findRef(COLLECTIONS.PRODUCTS, 'Product_ID', productId, organizationId);
        if (!ref) return { success: false, message: 'Proizvod nije pronađen' };
        await updateDocByRef(ref, { Cut_Lists: cutLists });
        return { success: true, message: 'Krojna lista sačuvana' };
    } catch (error) {
        console.error('updateProductCutLists error:', error);
        return { success: false, message: 'Greška pri spremanju krojne liste' };
    }
}

export async function recalculateProductCost(productId: string, organizationId: string): Promise<number> {
    if (!organizationId) return 0;

    const { getProductMaterials } = await import('../../database');
    const materials = await getProductMaterials(productId, organizationId);
    const totalCost = materials.reduce((sum: number, m: ProductMaterial) => sum + (m.Total_Price || 0), 0);

    const { updateByIdAndOrg } = await import('../shared/firestoreClient');
    await updateByIdAndOrg(COLLECTIONS.PRODUCTS, 'Product_ID', productId, organizationId, { Material_Cost: totalCost });

    // Propagate cost change to work orders
    try {
        const db = getDb();
        const woItemsQ = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Product_ID', '==', productId),
            where('Organization_ID', '==', organizationId)
        );
        const woItemsSnap = await getDocs(woItemsQ);
        const woIds = new Set<string>();
        woItemsSnap.docs.forEach(d => {
            const woId = d.data().Work_Order_ID;
            if (woId) woIds.add(woId);
        });

        if (woIds.size > 0) {
            const { recalculateWorkOrder } = await import('../../attendance');
            for (const woId of Array.from(woIds)) {
                await recalculateWorkOrder(woId);
            }
        }
    } catch (err) {
        console.warn('recalculateProductCost: WO sync failed (non-critical):', err);
    }

    eventBus.emit('product:costRecalculated', { productId, newCost: totalCost, organizationId });

    return totalCost;
}
