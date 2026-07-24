/**
 * materialCatalogService.ts — Materials Catalog CRUD + price propagation
 * 
 * Extracted from database.ts (functions: getMaterialsCatalog, saveMaterial, 
 * deleteMaterial, deleteDuplicateMaterials, propagateMaterialPriceChange)
 */

import { COLLECTIONS } from '../shared/collections';
import { queryByOrg, findByIdAndOrg, findRef, createDoc, updateDocByRef, getDb, query, collection, doc, where, getDocs, writeBatch } from '../shared/firestoreClient';
import { eventBus } from '../eventBus';
import { v4 as uuidv4 } from 'uuid';
import type { Material, MaterialTemplate } from '../../types';
import type { ProjectBasisReview } from '../../profitBasis';

// ============================================
// READ
// ============================================

export async function getMaterialsCatalog(organizationId: string): Promise<Material[]> {
    return queryByOrg<Material>(COLLECTIONS.MATERIALS_DB, organizationId);
}

// ============================================
// WRITE
// ============================================

export async function saveMaterial(
    data: Partial<Material>,
    organizationId: string
): Promise<{ success: boolean; data?: { Material_ID: string }; message: string; basisReview?: ProjectBasisReview[] }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Material_ID;
        const oldData = !isNew ? (await import('../shared/firestoreClient').then(fc =>
            fc.findByIdAndOrg<Material>(COLLECTIONS.MATERIALS_DB, 'Material_ID', data.Material_ID!, organizationId)
        )).data : null;

        if (isNew) {
            data.Material_ID = uuidv4();
            data.Organization_ID = organizationId;
            await createDoc(COLLECTIONS.MATERIALS_DB, data as Record<string, unknown>);
        } else {
            const ref = await findRef(COLLECTIONS.MATERIALS_DB, 'Material_ID', data.Material_ID!, organizationId);
            if (ref) {
                const { Organization_ID, ...updateData } = data;
                await updateDocByRef(ref, updateData as Record<string, unknown>);
            }
        }

        // REACTIVE: If price or name changed, propagate to all ProductMaterials
        let basisReview: ProjectBasisReview[] = [];
        if (!isNew && oldData) {
            const priceChanged = data.Default_Unit_Price !== undefined && data.Default_Unit_Price !== oldData.Default_Unit_Price;
            const nameChanged = data.Name !== undefined && data.Name !== oldData.Name;
            const supplierChanged = data.Default_Supplier !== undefined && data.Default_Supplier !== oldData.Default_Supplier;

            if (priceChanged || nameChanged || supplierChanged) {
                basisReview = await propagateMaterialChange(data.Material_ID!, data, organizationId);
                eventBus.emit('material:priceChanged', { materialId: data.Material_ID!, organizationId });
            }
        }

        return {
            success: true,
            data: { Material_ID: data.Material_ID! },
            message: isNew ? 'Materijal kreiran' : 'Materijal ažuriran',
            basisReview,
        };
    } catch (error) {
        console.error('saveMaterial error:', error);
        return { success: false, message: 'Greška pri spremanju materijala' };
    }
}

export async function deleteMaterial(
    materialId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const ref = await findRef(COLLECTIONS.MATERIALS_DB, 'Material_ID', materialId, organizationId);
        if (ref) {
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(ref);
        }

        return { success: true, message: 'Materijal obrisan' };
    } catch (error) {
        console.error('deleteMaterial error:', error);
        return { success: false, message: 'Greška pri brisanju materijala' };
    }
}

// ============================================
// REACTIVE PROPAGATION
// ============================================

async function propagateMaterialChange(
    materialId: string,
    updatedData: Partial<Material>,
    organizationId: string
): Promise<ProjectBasisReview[]> {
    const db = getDb();
    const pmQ = query(
        collection(db, COLLECTIONS.PRODUCT_MATERIALS),
        where('Material_ID', '==', materialId),
        where('Organization_ID', '==', organizationId)
    );
    const pmSnap = await getDocs(pmQ);
    if (pmSnap.empty) return [];

    const affectedProductIds = new Set<string>();
    // Δ troška materijala PO KOMADU po proizvodu (Σ Δ Total_Price OVE izmjene) — osnovica
    // za gejtovani pregled. Primljeni (zamrznuti) materijali se izostavljaju iz delte.
    const productDelta = new Map<string, number>();
    const batch = writeBatch(db);

    pmSnap.docs.forEach(docSnap => {
        const pm = docSnap.data();
        const updates: Record<string, unknown> = {};

        if (updatedData.Name !== undefined) {
            updates.Material_Name = updatedData.Name;
        }
        if (updatedData.Default_Supplier !== undefined) {
            updates.Supplier = updatedData.Default_Supplier;
        }
        if (updatedData.Default_Unit_Price !== undefined) {
            const isSpecialMaterial = pm.Is_Glass || pm.Is_Alu_Door;
            if (!isSpecialMaterial) {
                const oldTotal = (pm.Quantity || 0) * (pm.Unit_Price || 0);
                const newTotal = (pm.Quantity || 0) * updatedData.Default_Unit_Price;
                updates.Unit_Price = updatedData.Default_Unit_Price;
                updates.Total_Price = newTotal;
                // Primljeni materijal je zaključan na prijemu → ne ulazi u Δ osnovice profita.
                if (pm.Product_ID && pm.Status !== 'Primljeno') {
                    productDelta.set(pm.Product_ID, (productDelta.get(pm.Product_ID) || 0) + (newTotal - oldTotal));
                }
            }
        }

        if (Object.keys(updates).length > 0) {
            batch.update(docSnap.ref, updates);
            if (pm.Product_ID) affectedProductIds.add(pm.Product_ID);
        }
    });

    await batch.commit();

    // ŽIVA product cijena (kartica proizvoda / zastarjelost ponude) se ažurira odmah;
    // osnovica proizvodnih naloga ostaje frozen (recalculateProductCost više ne dira nalog).
    const { recalculateProductCost, buildBasisReview } = await import('../../database');
    for (const productId of Array.from(affectedProductIds)) {
        try {
            await recalculateProductCost(productId, organizationId);
        } catch (err) {
            console.warn(`propagateMaterialChange: Failed to recalculate product ${productId}:`, err);
        }
    }

    // GEJT: vrati Δ profita po projektu (samo proizvodne, ne-zamrznute stavke).
    const changedProducts = Array.from(productDelta.entries()).filter(([, d]) => d !== 0).map(([pid]) => pid);
    return buildBasisReview(organizationId, changedProducts, productDelta);
}

// ============================================
// MATERIAL TEMPLATES — named bundles of materials
// ============================================

export async function getMaterialTemplates(organizationId: string): Promise<MaterialTemplate[]> {
    return queryByOrg<MaterialTemplate>(COLLECTIONS.MATERIAL_TEMPLATES, organizationId);
}

export async function saveMaterialTemplate(
    data: Partial<MaterialTemplate>,
    organizationId: string
): Promise<{ success: boolean; data?: { Template_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }
    if (!data.Name || !data.Name.trim()) {
        return { success: false, message: 'Unesite naziv templejta' };
    }

    try {
        const isNew = !data.Template_ID;

        if (isNew) {
            data.Template_ID = uuidv4();
            data.Organization_ID = organizationId;
            data.Created_Date = new Date().toISOString();
            data.Items = data.Items || [];
            await createDoc(COLLECTIONS.MATERIAL_TEMPLATES, data as Record<string, unknown>);
        } else {
            const ref = await findRef(COLLECTIONS.MATERIAL_TEMPLATES, 'Template_ID', data.Template_ID!, organizationId);
            if (ref) {
                const { Organization_ID, ...updateData } = data;
                await updateDocByRef(ref, updateData as Record<string, unknown>);
            }
        }

        return {
            success: true,
            data: { Template_ID: data.Template_ID! },
            message: isNew ? 'Templejt sačuvan' : 'Templejt ažuriran',
        };
    } catch (error) {
        console.error('saveMaterialTemplate error:', error);
        return { success: false, message: 'Greška pri spremanju templejta' };
    }
}

export async function deleteMaterialTemplate(
    templateId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const ref = await findRef(COLLECTIONS.MATERIAL_TEMPLATES, 'Template_ID', templateId, organizationId);
        if (ref) {
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(ref);
        }
        return { success: true, message: 'Templejt obrisan' };
    } catch (error) {
        console.error('deleteMaterialTemplate error:', error);
        return { success: false, message: 'Greška pri brisanju templejta' };
    }
}

/** Loads a template and bulk-creates all its materials in the catalog. */
export async function applyMaterialTemplate(
    templateId: string,
    organizationId: string
): Promise<{ success: boolean; created: number; message: string }> {
    if (!organizationId) {
        return { success: false, created: 0, message: 'Organization ID is required' };
    }

    try {
        const { data: template } = await findByIdAndOrg<MaterialTemplate>(
            COLLECTIONS.MATERIAL_TEMPLATES, 'Template_ID', templateId, organizationId
        );

        const items = (template?.Items || []).filter(i => i.Name && i.Name.trim());
        if (items.length === 0) {
            return { success: false, created: 0, message: 'Templejt je prazan' };
        }

        const db = getDb();
        const batch = writeBatch(db);
        for (const item of items) {
            const ref = doc(collection(db, COLLECTIONS.MATERIALS_DB));
            batch.set(ref, {
                Material_ID: uuidv4(),
                Organization_ID: organizationId,
                Name: item.Name.trim(),
                Category: item.Category || 'Ostalo',
                Unit: item.Unit || 'kom',
                Default_Unit_Price: item.Default_Unit_Price || 0,
                Default_Supplier: item.Default_Supplier || '',
                Description: item.Description || '',
            });
        }
        await batch.commit();

        return { success: true, created: items.length, message: `Dodano ${items.length} materijala iz templejta` };
    } catch (error) {
        console.error('applyMaterialTemplate error:', error);
        return { success: false, created: 0, message: 'Greška pri učitavanju templejta' };
    }
}

export async function deleteDuplicateMaterials(
    organizationId: string
): Promise<{ success: boolean; deletedCount: number; message: string }> {
    if (!organizationId) {
        return { success: false, deletedCount: 0, message: 'Organization ID is required' };
    }

    try {
        const materials = await getMaterialsCatalog(organizationId);
        const seen = new Map<string, string>(); // name -> first Material_ID
        const duplicateIds: string[] = [];

        for (const mat of materials) {
            const key = mat.Name.toLowerCase().trim();
            if (seen.has(key)) {
                duplicateIds.push(mat.Material_ID);
            } else {
                seen.set(key, mat.Material_ID);
            }
        }

        if (duplicateIds.length === 0) {
            return { success: true, deletedCount: 0, message: 'Nema duplikata' };
        }

        const db = getDb();
        const batchSize = 30;
        let deleted = 0;

        for (let i = 0; i < duplicateIds.length; i += batchSize) {
            const chunk = duplicateIds.slice(i, i + batchSize);
            const q = query(
                collection(db, COLLECTIONS.MATERIALS_DB),
                where('Material_ID', 'in', chunk),
                where('Organization_ID', '==', organizationId)
            );
            const snap = await getDocs(q);

            if (!snap.empty) {
                const batch = writeBatch(db);
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                deleted += snap.size;
            }
        }

        return {
            success: true,
            deletedCount: deleted,
            message: `Obrisano ${deleted} duplikata`,
        };
    } catch (error) {
        console.error('deleteDuplicateMaterials error:', error);
        return { success: false, deletedCount: 0, message: 'Greška pri brisanju duplikata' };
    }
}
