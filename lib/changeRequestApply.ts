'use client';

// ════════════════════════════════════════════════════════════════════
// PRIMJENA MATERIJALNIH PRIJEDLOGA NA DESKTOPU
//
// material_usage i material_order mijenjaju materijale proizvoda koji je već na
// nalogu, pa moraju proći kroz postojeće desktop funkcije (i time kroz gejt
// osnovice profita — izmjena materijala diže „profit zastario" na nalogu).
// Server ih zato NE primjenjuje; vlasnik ih izvede ovdje i zatim zatvori
// prijedlog (resolve).
//
// Ostale odobrene vrste (procesi, zadaci, zatvaranje) primjenjuje server.
// ════════════════════════════════════════════════════════════════════

import {
    addMaterialToProduct, recalculateProductCost, getProductMaterials, getProduct, getSuppliers, createOrder,
} from '@/lib/services';
import type { ChangeRequest } from '@/lib/types';
import type { MaterialOrderPayload } from '@/lib/changeRequests';

export interface AdjustedUsageLine {
    materialId?: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
}

/**
 * „Ugradio sam" → doda linije u sastavnicu proizvoda (status Primljeno, s
 * cijenom koju je vlasnik unio) i preračuna trošak. Vlasnik je linije već
 * prilagodio (količine + cijene) u modalu.
 */
export async function applyMaterialUsage(
    orgId: string, productId: string, lines: AdjustedUsageLine[]
): Promise<void> {
    for (const line of lines) {
        const qty = line.quantity > 0 ? line.quantity : 0;
        const price = line.unitPrice >= 0 ? line.unitPrice : 0;
        await addMaterialToProduct({
            Product_ID: productId,
            Material_ID: line.materialId || '',
            Material_Name: line.name,
            Quantity: qty,
            Unit: line.unit || 'kom',
            Unit_Price: price,
            Total_Price: Math.round(price * qty * 100) / 100,
            Status: 'Primljeno',
            Supplier: '',
        }, orgId);
    }
    await recalculateProductCost(productId, orgId);
}

/**
 * „Predloži narudžbu" → kreira nacrt narudžbe (ili više, grupisano po dobavljaču)
 * iz predloženih materijala. Cijene i dobavljača uzima iz postojećih linija
 * proizvoda; vlasnik nacrt dovršava u tabu Narudžbe (količine, slanje).
 * Vraća kreirane brojeve narudžbi.
 */
export async function applyMaterialOrder(orgId: string, req: ChangeRequest): Promise<string[]> {
    const productId = req.Product_ID;
    if (!productId) throw new Error('Proizvod nije određen.');
    const payload = req.Payload as MaterialOrderPayload;

    const [pms, product, suppliers] = await Promise.all([
        getProductMaterials(productId, orgId),
        getProduct(productId, orgId),
        getSuppliers(orgId),
    ]);

    const pmById = new Map<string, any>();
    for (const m of pms as any[]) {
        pmById.set(m.ID, m);
        if (m.Material_ID) pmById.set(m.Material_ID, m);
    }

    // Grupisanje po dobavljaču (iz linije ili iz postojeće sastavnice).
    const groups = new Map<string, MaterialOrderPayload['lines']>();
    for (const line of payload.lines) {
        const pm = line.materialId ? pmById.get(line.materialId) : undefined;
        const supplierName = line.supplier || pm?.Supplier || 'Nepoznat dobavljač';
        const arr = groups.get(supplierName) || [];
        arr.push(line);
        groups.set(supplierName, arr);
    }

    const orderNumbers: string[] = [];
    for (const [supplierName, lines] of groups) {
        const supplier = (suppliers as any[]).find(s => s.Name === supplierName);
        let total = 0;
        const items = lines.map(line => {
            const pm = line.materialId ? pmById.get(line.materialId) : undefined;
            const unitPrice = Number(pm?.Unit_Price) || 0;
            const expected = Math.round(unitPrice * line.quantity * 100) / 100;
            total += expected;
            return {
                Product_Material_ID: line.materialId || '',
                Product_ID: productId,
                Product_Name: product?.Name || req.Product_Name || '',
                Project_ID: product?.Project_ID || '',
                Material_Name: line.name,
                Quantity: line.quantity,
                Unit: line.unit || 'kom',
                Expected_Price: expected,
                Status: 'Na čekanju',
                Received_Quantity: 0,
            };
        });

        const res = await createOrder({
            Supplier_ID: supplier?.Supplier_ID || '',
            Supplier_Name: supplierName,
            Name: req.Product_Name ? `Prijedlog: ${req.Product_Name}` : undefined,
            Total_Amount: total,
            // createOrder popunjava ID/Order_ID/Actual_Price u batchu — šaljemo djelimične stavke.
            items: items as any,
        }, orgId);
        if (res.success && res.data) orderNumbers.push(res.data.Order_Number);
    }

    return orderNumbers;
}
