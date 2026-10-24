// ════════════════════════════════════════════════════════════════════
// NARUDŽBE NA SERVERU — Telegram asistent
//
// Isti model kao ERP (lib/database.ts createOrder / updateOrderStatus):
//   • narudžba nastaje kao „Nacrt", materijali se tad NE diraju;
//   • stavka nosi Product_Material_Quantities — koliko ide kojem materijalu
//     proizvoda; zbir manji od Quantity = višak naručen za zalihu;
//   • slanje (Nacrt → Poslano) dodaje naručeno na materijale i pomjera
//     proizvod („Materijali naručeni") i projekat („U proizvodnji").
//
// Koliko još treba naručiti računa lib/materialCoverage (iz količina), a
// ovdje se dodatno oduzima ono što već stoji u nacrtima — da bot ne naruči
// dvaput isto dok nacrt čeka slanje.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { adminDb } from './firebaseAdmin';
import { nextOrderNumber } from '@/lib/orderNumber';
import { orderItemAllocations } from '@/lib/orderMaterialAllocation';
import { materialCoverage } from '@/lib/materialCoverage';
import { roundQty } from '@/lib/orderItemGroups';
import type { AluDoorItem, GlassItem, Order, OrderItem, Product, ProductMaterial, Supplier } from '@/lib/types';

const IN_CHUNK = 30;

function chunks<T>(arr: T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += IN_CHUNK) out.push(arr.slice(i, i + IN_CHUNK));
    return out;
}

async function byIds<T>(orgId: string, col: string, field: string, ids: string[]): Promise<T[]> {
    const out: T[] = [];
    for (const part of chunks(Array.from(new Set(ids.filter(Boolean))))) {
        const snap = await adminDb().collection(col).where('Organization_ID', '==', orgId).where(field, 'in', part).get();
        snap.docs.forEach(d => out.push(d.data() as T));
    }
    return out;
}

// ─── Šta projekti trebaju ─────────────────────────────────────────────

export interface OrderableRow {
    materialId: string;
    catalogId: string;
    name: string;
    unit: string;
    supplier: string;
    unitPrice: number;
    productId: string;
    productName: string;
    projectId: string;
    needed: number;
    onStock: number;
    ordered: number;
    received: number;
    /** Već u nacrtima narudžbi (još nije poslano). */
    inDrafts: number;
    /** Koliko se još može naručiti za projekat: preostalo minus nacrti. */
    available: number;
}

/** Svi materijali proizvoda tih projekata, s računicom šta je ostalo za naručiti. */
export async function loadProjectMaterials(orgId: string, projectIds: string[]): Promise<OrderableRow[]> {
    if (!projectIds.length) return [];
    const products = await byIds<Product>(orgId, 'products', 'Project_ID', projectIds);
    const materials = await byIds<ProductMaterial>(orgId, 'product_materials', 'Product_ID', products.map(p => p.Product_ID));
    const drafts = await draftAllocations(orgId);
    const productById = new Map(products.map(p => [p.Product_ID, p]));

    return materials.flatMap(m => {
        const product = productById.get(m.Product_ID);
        if (!product) return [];
        const c = materialCoverage(m, product.Quantity);
        const inDrafts = drafts.get(m.ID) || 0;
        return [{
            materialId: m.ID,
            catalogId: m.Material_ID || '',
            name: m.Material_Name,
            unit: m.Unit || 'kom',
            supplier: m.Supplier || '',
            unitPrice: m.Unit_Price || 0,
            productId: product.Product_ID,
            productName: product.Name || 'Proizvod',
            projectId: product.Project_ID,
            needed: c.needed,
            onStock: c.onStock,
            ordered: c.ordered,
            received: c.received,
            inDrafts,
            available: Math.max(0, roundQty(c.toOrder - inDrafts)),
        }];
    });
}

/** Materijal → količina u nacrtima (narudžbe „Nacrt"). */
async function draftAllocations(orgId: string): Promise<Map<string, number>> {
    const orders = await adminDb().collection('orders').where('Organization_ID', '==', orgId).get();
    const draftIds = orders.docs.map(d => d.data() as Order).filter(o => o.Status === 'Nacrt').map(o => o.Order_ID);
    const items = await byIds<OrderItem>(orgId, 'order_items', 'Order_ID', draftIds);
    const out = new Map<string, number>();
    for (const item of items) {
        for (const [id, q] of Object.entries(orderItemAllocations(item))) out.set(id, roundQty((out.get(id) || 0) + q));
    }
    return out;
}

// ─── Kreiranje nacrta ─────────────────────────────────────────────────

export interface DraftLine {
    materialName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    /** Materijali proizvoda kojima ide dio količine; prazno = samo za zalihu. */
    members: { materialId: string; productId: string; productName: string; projectId: string; allocation: number }[];
}

export interface DraftInput {
    supplierName: string;
    supplierId: string;
    name?: string;
    notes: string;
    expectedDelivery?: string;
    lines: DraftLine[];
}

export interface CreatedDraft {
    orderId: string;
    orderNumber: string;
    /** Putanje upisanih dokumenata (za ↩️ Poništi). */
    paths: string[];
}

export function draftOrderItem(line: DraftLine, orderId: string, orgId: string): OrderItem & { Organization_ID: string } {
    const assigned = line.members.filter(m => m.allocation > 0);
    const first = assigned[0] || line.members[0];
    return {
        ID: uuidv4(),
        Organization_ID: orgId,
        Order_ID: orderId,
        Product_Material_ID: first?.materialId || '',
        ...(assigned.length > 1 ? { Product_Material_IDs: assigned.map(m => m.materialId) } : {}),
        ...(line.members.length ? { Product_Material_Quantities: Object.fromEntries(assigned.map(m => [m.materialId, m.allocation])) } : {}),
        Product_ID: first?.productId || '',
        Product_Name: first?.productName || '',
        Project_ID: first?.projectId || '',
        Material_Name: line.materialName,
        Quantity: roundQty(line.quantity),
        Unit: line.unit,
        // UKUPNA cijena stavke (qty × jedinična) — isti invarijant kao čarobnjak.
        Expected_Price: Math.round(line.quantity * line.unitPrice * 100) / 100,
        Actual_Price: 0,
        Received_Quantity: 0,
        Status: 'Na čekanju',
    };
}

export async function createDraftOrder(orgId: string, input: DraftInput): Promise<CreatedDraft> {
    const db = adminDb();
    const existing = await db.collection('orders').where('Organization_ID', '==', orgId).get();
    const orderNumber = nextOrderNumber(existing.docs.map(d => (d.data() as Order).Order_Number));
    const orderId = uuidv4();
    const items = input.lines.filter(l => l.quantity > 0).map(l => draftOrderItem(l, orderId, orgId));

    const order: Order & { Organization_ID: string } = {
        Order_ID: orderId,
        Organization_ID: orgId,
        Order_Number: orderNumber,
        ...(input.name?.trim() ? { Name: input.name.trim() } : {}),
        Supplier_ID: input.supplierId,
        Supplier_Name: input.supplierName,
        Order_Date: new Date().toISOString(),
        Status: 'Nacrt',
        Expected_Delivery: input.expectedDelivery || '',
        Total_Amount: Math.round(items.reduce((s, i) => s + i.Expected_Price, 0) * 100) / 100,
        Notes: input.notes,
    };

    const batch = db.batch();
    const orderRef = db.collection('orders').doc();
    batch.set(orderRef, order);
    const paths = [orderRef.path];
    for (const item of items) {
        const ref = db.collection('order_items').doc();
        batch.set(ref, item);
        paths.push(ref.path);
    }
    await batch.commit();
    return { orderId, orderNumber, paths };
}

// ─── Čitanje i slanje ─────────────────────────────────────────────────

export async function getOrderWithItems(orgId: string, orderId: string): Promise<Order | null> {
    const snap = await adminDb().collection('orders').where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).limit(1).get();
    if (snap.empty) return null;
    const items = await adminDb().collection('order_items').where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).get();
    return { ...(snap.docs[0].data() as Order), items: items.docs.map(d => d.data() as OrderItem) };
}

export async function listOrders(orgId: string): Promise<Order[]> {
    const snap = await adminDb().collection('orders').where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => d.data() as Order);
}

export async function getSupplier(orgId: string, supplierId: string, name: string): Promise<Supplier | undefined> {
    const snap = await adminDb().collection('suppliers').where('Organization_ID', '==', orgId).get();
    const all = snap.docs.map(d => d.data() as Supplier);
    return all.find(s => supplierId && s.Supplier_ID === supplierId) || all.find(s => s.Name === name);
}

/** Staklo i alu vrata materijala iz narudžbe — za specifikaciju u PDF-u. */
export async function loadOrderSpecs(orgId: string, order: Order): Promise<ProductMaterial[]> {
    const ids = (order.items || []).flatMap(i => Object.keys(orderItemAllocations(i)).concat(i.Product_Material_IDs || [], i.Product_Material_ID || []));
    if (!ids.length) return [];
    const [glass, doors] = await Promise.all([
        byIds<GlassItem>(orgId, 'glass_items', 'Product_Material_ID', ids),
        byIds<AluDoorItem>(orgId, 'alu_door_items', 'Product_Material_ID', ids),
    ]);
    return Array.from(new Set(ids)).map(id => ({
        ID: id,
        glassItems: glass.filter(g => g.Product_Material_ID === id),
        aluDoorItems: doors.filter(d => d.Product_Material_ID === id),
    }) as ProductMaterial);
}

export type SendResult =
    | { ok: true; orderNumber: string; materials: number }
    | { ok: false; error: string };

/** Nacrt → Poslano, ista kaskada kao updateOrderStatus u ERP-u. */
export async function sendOrder(orgId: string, orderId: string): Promise<SendResult> {
    const db = adminDb();
    const orderSnap = await db.collection('orders').where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).limit(1).get();
    if (orderSnap.empty) return { ok: false, error: 'Narudžba više ne postoji.' };
    const order = orderSnap.docs[0].data() as Order;
    if (order.Status !== 'Nacrt') return { ok: false, error: `Narudžba ${order.Order_Number} je već „${order.Status}".` };

    const itemsSnap = await db.collection('order_items').where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).get();
    const deltas = new Map<string, number>();
    const productIds = new Set<string>();
    const projectIds = new Set<string>();
    const batch = db.batch();
    batch.update(orderSnap.docs[0].ref, { Status: 'Poslano' });
    for (const d of itemsSnap.docs) {
        const item = d.data() as OrderItem;
        if (item.Status === 'Primljeno') continue;
        for (const [id, q] of Object.entries(orderItemAllocations(item))) deltas.set(id, (deltas.get(id) || 0) + q);
        batch.update(d.ref, { Status: 'Naručeno' });
        if (item.Product_ID) productIds.add(item.Product_ID);
        if (item.Project_ID) projectIds.add(item.Project_ID);
    }
    await batch.commit();

    for (const part of chunks(Array.from(deltas.keys()))) {
        const snap = await db.collection('product_materials').where('Organization_ID', '==', orgId).where('ID', 'in', part).get();
        const matBatch = db.batch();
        snap.docs.forEach(d => {
            const m = d.data() as ProductMaterial;
            const ordered = Math.max(0, (m.Ordered_Quantity || 0) + (deltas.get(m.ID) || 0));
            matBatch.update(d.ref, {
                Status: 'Naručeno',
                Order_ID: orderId,
                Ordered_Quantity: ordered,
            });
        });
        await matBatch.commit();
    }

    await Promise.all([
        ...Array.from(productIds).map(async id => {
            const p = await db.collection('products').where('Organization_ID', '==', orgId).where('Product_ID', '==', id).limit(1).get();
            if (!p.empty && p.docs[0].data().Status === 'Na čekanju') await p.docs[0].ref.update({ Status: 'Materijali naručeni' });
        }),
        ...Array.from(projectIds).map(async id => {
            const p = await db.collection('projects').where('Organization_ID', '==', orgId).where('Project_ID', '==', id).limit(1).get();
            if (!p.empty && p.docs[0].data().Status === 'Odobreno') await p.docs[0].ref.update({ Status: 'U proizvodnji' });
        }),
    ]);

    return { ok: true, orderNumber: order.Order_Number, materials: deltas.size };
}
