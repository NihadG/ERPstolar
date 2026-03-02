/**
 * projectService.ts — Project CRUD + status orchestration
 * 
 * Extracted from database.ts (functions: saveProject, deleteProject, 
 * getProjects, getProject, updateProjectStatus)
 * 
 * All original function signatures preserved for backward compatibility.
 */

import { COLLECTIONS } from '../shared/collections';
import {
    queryByOrg,
    findByIdAndOrg,
    findRef,
    createDoc,
    updateDocByRef,
    deleteByIdAndOrg,
    getDb,
    query,
    collection,
    where,
    getDocs,
    writeBatch,
} from '../shared/firestoreClient';
import { eventBus } from '../eventBus';
import { v4 as uuidv4 } from 'uuid';
import type { Project, Product, ProductMaterial, GlassItem, AluDoorItem, Offer, OfferProduct, OfferExtra } from '../../types';
import { assembleProjectGraph } from '../shared/dataAssembler';

// ============================================
// READ
// ============================================

export async function getProjects(organizationId: string): Promise<Project[]> {
    if (!organizationId) return [];

    const orgFilter = where('Organization_ID', '==', organizationId);
    const db = getDb();

    const [projectsSnap, productsSnap, productMaterialsSnap, glassItemsSnap, aluDoorItemsSnap, offersSnap, offerProductsSnap, offerExtrasSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.PROJECTS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.PRODUCTS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.PRODUCT_MATERIALS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.GLASS_ITEMS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.ALU_DOOR_ITEMS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.OFFERS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.OFFER_PRODUCTS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.OFFER_EXTRAS), orgFilter)),
    ]);

    const projects = projectsSnap.docs.map(doc => ({ ...doc.data() } as Project));
    const products = productsSnap.docs.map(doc => ({ ...doc.data() } as Product));
    const productMaterials = productMaterialsSnap.docs.map(doc => ({ ...doc.data() } as ProductMaterial));
    const glassItems = glassItemsSnap.docs.map(doc => ({ ...doc.data() } as GlassItem));
    const aluDoorItems = aluDoorItemsSnap.docs.map(doc => ({ ...doc.data() } as AluDoorItem));
    const offers = offersSnap.docs.map(doc => ({ ...doc.data() } as Offer));
    const offerProducts = offerProductsSnap.docs.map(doc => ({ ...doc.data() } as OfferProduct));
    const offerExtras = offerExtrasSnap.docs.map(doc => ({ ...doc.data() } as OfferExtra));

    assembleProjectGraph({
        projects, products, productMaterials,
        glassItems, aluDoorItems,
        offers, offerProducts, offerExtras
    });

    return projects;
}

export async function getProject(projectId: string, organizationId: string): Promise<Project | null> {
    if (!organizationId) return null;
    const result = await findByIdAndOrg<Project>(COLLECTIONS.PROJECTS, 'Project_ID', projectId, organizationId);
    if (!result.data) return null;

    // Lazy-load products for single project view
    const { getProductsByProject } = await import('../product/productService');
    result.data.products = await getProductsByProject(projectId, organizationId);
    return result.data;
}

// ============================================
// WRITE
// ============================================

export async function saveProject(
    data: Partial<Project>,
    organizationId: string
): Promise<{ success: boolean; data?: { Project_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Project_ID;

        if (isNew) {
            data.Project_ID = uuidv4();
            data.Organization_ID = organizationId;
            data.Created_Date = new Date().toISOString();
            data.Status = data.Status || 'Nacrt';
            await createDoc(COLLECTIONS.PROJECTS, data as Record<string, unknown>);
        } else {
            const ref = await findRef(COLLECTIONS.PROJECTS, 'Project_ID', data.Project_ID!, organizationId);
            if (!ref) {
                return { success: false, message: 'Projekat nije pronađen ili nemate pristup' };
            }
            const { Organization_ID, ...updateData } = data;
            await updateDocByRef(ref, updateData as Record<string, unknown>);
        }

        return {
            success: true,
            data: { Project_ID: data.Project_ID! },
            message: isNew ? 'Projekat kreiran' : 'Projekat ažuriran',
        };
    } catch (error) {
        console.error('saveProject error:', error);
        return { success: false, message: 'Greška pri spremanju projekta' };
    }
}

export async function deleteProject(
    projectId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const db = getDb();

        // S5.1: Block deletion if project has active work orders
        const woQuery = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Project_ID', '==', projectId),
            where('Organization_ID', '==', organizationId)
        );
        const woItemsSnap = await getDocs(woQuery);

        if (!woItemsSnap.empty) {
            const activeWoIds = new Set<string>();
            for (const itemDoc of woItemsSnap.docs) {
                const item = itemDoc.data();
                if (item.Status !== 'Završeno') {
                    activeWoIds.add(item.Work_Order_ID);
                }
            }
            if (activeWoIds.size > 0) {
                return {
                    success: false,
                    message: `Projekat ima ${activeWoIds.size} aktivni(h) radni(h) nalog(a). Završite ili obrišite radne naloge prije brisanja projekta.`
                };
            }
        }

        // Import product-level cascade functions
        const { getProductsByProject } = await import('../product/productService');
        const { cascadeDeleteOrderItemsForProduct, deleteProductMaterials } = await import('../../database');

        const products = await getProductsByProject(projectId, organizationId);
        for (const product of products) {
            await cascadeDeleteOrderItemsForProduct(product.Product_ID, organizationId);
            await deleteProductMaterials(product.Product_ID, organizationId);
        }

        // ATOMIC batch delete: products + project
        const deleteBatch = writeBatch(db);

        for (const product of products) {
            const pRef = await findRef(COLLECTIONS.PRODUCTS, 'Product_ID', product.Product_ID, organizationId);
            if (pRef) deleteBatch.delete(pRef);
        }

        const projectRef = await findRef(COLLECTIONS.PROJECTS, 'Project_ID', projectId, organizationId);
        if (projectRef) deleteBatch.delete(projectRef);

        await deleteBatch.commit();

        return { success: true, message: 'Projekat obrisan sa svim povezanim narudžbama' };
    } catch (error) {
        console.error('deleteProject error:', error);
        return { success: false, message: 'Greška pri brisanju projekta' };
    }
}

export async function updateProjectStatus(
    projectId: string,
    status: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const updated = await import('../shared/firestoreClient').then(fc =>
            fc.updateByIdAndOrg(COLLECTIONS.PROJECTS, 'Project_ID', projectId, organizationId, { Status: status })
        );

        if (updated) {
            eventBus.emit('project:statusChanged', { projectId, newStatus: status, organizationId });
        }

        return { success: true, message: 'Status ažuriran' };
    } catch (error) {
        console.error('updateProjectStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa' };
    }
}
