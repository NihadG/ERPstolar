// ════════════════════════════════════════════════════════════════════
// PRIJEM MATERIJALA — kontrolorov upis
//
// Kad materijal stigne u pogon, kontrolor je taj ko fizički stoji pored njega.
// Ovdje čekira šta je došlo.
//
// NE DIRA NOVAC, i to je dokazivo: `Product.Material_Cost` je Σ `Total_Price`
// materijala (vidi recalculateProductCost), a prijem mijenja samo `Status` i
// količine — nikad `Unit_Price` ni `Total_Price`. Zato desktop preračun cijene
// ovdje nije potreban; on je i tamo samo sigurnosna mreža koja se vrti u pozadini.
//
// Kaskade su prenesene vjerno: sve stavke primljene → narudžba „Primljeno";
// svi materijali proizvoda spremni → proizvod „Materijali spremni".
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import type { OrderItem, ProductMaterial } from '@/lib/types';

const IN_CHUNK = 30;

function chunk<T>(arr: T[], size = IN_CHUNK): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/** Jedna stavka narudžbe može pokrivati više materijala (grupisane narudžbe). */
function materialIdsOf(item: OrderItem): string[] {
    if (item.Product_Material_IDs?.length) return item.Product_Material_IDs.filter(Boolean);
    return item.Product_Material_ID ? [item.Product_Material_ID] : [];
}

export interface ReceiveResult {
    changed: number;
    ordersClosed: number;
    productsReady: number;
}

/**
 * Označi stavke narudžbe primljenim (ili poništi prijem).
 *
 * Količine se vode DELTAMA, ne apsolutno: naručena količina se umanjuje za
 * primljenu, a primljena uvećava. Ista stavka može stizati u više navrata.
 */
export async function setItemsReceived(
    orgId: string,
    orderItemIds: string[],
    received: boolean
): Promise<ReceiveResult> {
    const db = adminDb();
    const ids = orderItemIds.filter(Boolean);
    if (ids.length === 0) return { changed: 0, ordersClosed: 0, productsReady: 0 };

    // ── Stavke narudžbe ──────────────────────────────────────────────
    const itemDocs: { ref: FirebaseFirestore.DocumentReference; data: OrderItem }[] = [];
    for (const part of chunk(ids)) {
        const snap = await db.collection('order_items')
            .where('Organization_ID', '==', orgId)
            .where('ID', 'in', part)
            .get();
        snap.docs.forEach(d => itemDocs.push({ ref: d.ref, data: d.data() as OrderItem }));
    }

    const nowIso = new Date().toISOString();
    const batch = db.batch();
    const affectedProducts = new Set<string>();
    const affectedOrders = new Set<string>();
    const materialDeltas = new Map<string, { status: string; ordered: number; receivedQty: number }>();
    let changed = 0;

    for (const { ref, data: item } of itemDocs) {
        const alreadyReceived = item.Status === 'Primljeno';
        if (alreadyReceived === received) continue;   // ništa za promijeniti

        batch.update(ref, received
            ? { Status: 'Primljeno', Received_Date: nowIso }
            : { Status: 'Naručeno', Received_Date: '' });
        changed++;

        const matIds = materialIdsOf(item);
        const perMaterial = matIds.length > 0 ? (item.Quantity || 0) / matIds.length : 0;
        for (const matId of matIds) {
            const prev = materialDeltas.get(matId) || { status: '', ordered: 0, receivedQty: 0 };
            materialDeltas.set(matId, {
                status: received ? 'Primljeno' : 'Naručeno',
                ordered: prev.ordered + (received ? -perMaterial : perMaterial),
                receivedQty: prev.receivedQty + (received ? perMaterial : -perMaterial),
            });
        }

        if (item.Product_ID) affectedProducts.add(item.Product_ID);
        if (item.Order_ID) affectedOrders.add(item.Order_ID);
    }

    if (changed === 0) return { changed: 0, ordersClosed: 0, productsReady: 0 };
    await batch.commit();

    // ── Materijali proizvoda ─────────────────────────────────────────
    const matIds = Array.from(materialDeltas.keys());
    for (const part of chunk(matIds)) {
        const snap = await db.collection('product_materials')
            .where('Organization_ID', '==', orgId)
            .where('ID', 'in', part)
            .get();

        const matBatch = db.batch();
        snap.docs.forEach(d => {
            const mat = d.data() as ProductMaterial;
            const delta = materialDeltas.get(mat.ID);
            if (!delta) return;
            matBatch.update(d.ref, {
                Status: delta.status,
                Ordered_Quantity: Math.max(0, (mat.Ordered_Quantity || 0) + delta.ordered),
                Received_Quantity: Math.max(0, (mat.Received_Quantity || 0) + delta.receivedQty),
            });
        });
        await matBatch.commit();
    }

    // ── Kaskade ──────────────────────────────────────────────────────
    let ordersClosed = 0;
    let productsReady = 0;

    await Promise.all([
        ...Array.from(affectedOrders).map(async orderId => {
            const all = await db.collection('order_items')
                .where('Organization_ID', '==', orgId)
                .where('Order_ID', '==', orderId)
                .get();
            if (all.empty) return;

            const total = all.docs.length;
            const recv = all.docs.filter(d => (d.data() as OrderItem).Status === 'Primljeno').length;

            const orderSnap = await db.collection('orders')
                .where('Organization_ID', '==', orgId)
                .where('Order_ID', '==', orderId)
                .limit(1)
                .get();
            if (orderSnap.empty) return;

            if (total > 0 && recv === total) {
                await orderSnap.docs[0].ref.update({ Status: 'Primljeno' });
                ordersClosed++;
            } else if ((orderSnap.docs[0].data().Status as string) === 'Primljeno') {
                // Poništen prijem vraća narudžbu iz „Primljeno" nazad u „Poslano".
                await orderSnap.docs[0].ref.update({ Status: 'Poslano' });
            }
        }),

        ...Array.from(affectedProducts).map(async productId => {
            const mats = await db.collection('product_materials')
                .where('Organization_ID', '==', orgId)
                .where('Product_ID', '==', productId)
                .get();
            if (mats.empty) return;

            const allReady = mats.docs.every(d =>
                ['Primljeno', 'Na stanju'].includes((d.data() as ProductMaterial).Status)
            );
            if (!allReady) return;

            const prod = await db.collection('products')
                .where('Organization_ID', '==', orgId)
                .where('Product_ID', '==', productId)
                .limit(1)
                .get();
            if (!prod.empty && prod.docs[0].data().Status !== 'Materijali spremni') {
                await prod.docs[0].ref.update({ Status: 'Materijali spremni' });
                productsReady++;
            }
        }),
    ]);

    return { changed, ordersClosed, productsReady };
}
