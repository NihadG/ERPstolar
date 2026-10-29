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
import { materialCoverage, settledMaterialStatus } from '@/lib/materialCoverage';
import { formatQty, roundQty } from '@/lib/orderItemGroups';
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

// ─── Sastavnica proizvoda (Projekti → proizvod → Materijali) ──────────
//
// Profit (lib/projectFinance) čita ŽIVU sastavnicu: trošak materijala
// proizvoda = Σ Total_Price × količina proizvoda. Zato sve što narudžba
// doda (novi materijal, količina preko potrebe) ide u sastavnicu — i time
// odmah u trošak i profit, isto kao „povećaj potrebu" u čarobnjaku narudžbi.

export async function loadProjectProducts(orgId: string, projectId: string): Promise<Product[]> {
    const snap = await adminDb().collection('products').where('Organization_ID', '==', orgId).where('Project_ID', '==', projectId).get();
    return snap.docs.map(d => d.data() as Product);
}

export async function loadProductMaterials(orgId: string, productIds: string[]): Promise<ProductMaterial[]> {
    return byIds<ProductMaterial>(orgId, 'product_materials', 'Product_ID', productIds);
}

/** Izmjena za ↩️ Poništi: putanja dokumenta i stanje prije (null = nov dokument). */
export interface WriteOp { path: string; before: Record<string, unknown> | null }

/** Product.Material_Cost = Σ Total_Price materijala (isto kao recalculateProductCost u ERP-u). */
async function refreshProductCost(orgId: string, productId: string): Promise<WriteOp | null> {
    const db = adminDb();
    const [prod, mats] = await Promise.all([
        db.collection('products').where('Organization_ID', '==', orgId).where('Product_ID', '==', productId).limit(1).get(),
        db.collection('product_materials').where('Organization_ID', '==', orgId).where('Product_ID', '==', productId).get(),
    ]);
    if (prod.empty) return null;
    const before = prod.docs[0].data();
    const cost = Math.round(mats.docs.reduce((s, d) => s + ((d.data() as ProductMaterial).Total_Price || 0), 0) * 100) / 100;
    if (before.Material_Cost === cost) return null;
    await prod.docs[0].ref.update({ Material_Cost: cost });
    return { path: prod.docs[0].ref.path, before };
}

/**
 * Novi materijal u sastavnici proizvoda, s naručenom količinom kao potrebom.
 * Količina u sastavnici je PO KOMADU proizvoda (kao u ERP-u), pa se ukupna
 * dijeli količinom proizvoda.
 */
export async function addMaterialToProduct(orgId: string, input: {
    product: Pick<Product, 'Product_ID' | 'Quantity'>;
    catalogId: string;
    name: string;
    unit: string;
    unitPrice: number;
    supplier: string;
    totalQuantity: number;
}): Promise<{ material: ProductMaterial; ops: WriteOp[] }> {
    const perPiece = Math.round(input.totalQuantity / (input.product.Quantity > 0 ? input.product.Quantity : 1) * 1_000_000) / 1_000_000;
    const material: ProductMaterial = {
        ID: uuidv4(),
        Organization_ID: orgId,
        Product_ID: input.product.Product_ID,
        Material_ID: input.catalogId,
        Material_Name: input.name,
        Quantity: perPiece,
        Unit: input.unit,
        Unit_Price: input.unitPrice,
        Total_Price: Math.round(perPiece * input.unitPrice * 100) / 100,
        Status: 'Nije naručeno',
        Supplier: input.supplier,
        Order_ID: '',
    };
    const ref = adminDb().collection('product_materials').doc();
    await ref.set(material);
    const cost = await refreshProductCost(orgId, input.product.Product_ID);
    return { material, ops: [{ path: ref.path, before: null }, ...(cost ? [cost] : [])] };
}

/** Potreba materijala raste za `extraTotal` (ukupno, ne po komadu) — kao needIncrease u čarobnjaku. */
export async function increaseMaterialNeed(orgId: string, materialId: string, extraTotal: number): Promise<WriteOp[]> {
    const db = adminDb();
    const snap = await db.collection('product_materials').where('Organization_ID', '==', orgId).where('ID', '==', materialId).limit(1).get();
    if (snap.empty || !(extraTotal > 0)) return [];
    const before = snap.docs[0].data() as ProductMaterial;
    const prod = await db.collection('products').where('Organization_ID', '==', orgId).where('Product_ID', '==', before.Product_ID).limit(1).get();
    const count = prod.empty ? 1 : ((prod.docs[0].data() as Product).Quantity || 1);
    const quantity = Math.round(((before.Quantity || 0) + extraTotal / count) * 1_000_000) / 1_000_000;
    await snap.docs[0].ref.update({ Quantity: quantity, Total_Price: Math.round(quantity * (before.Unit_Price || 0) * 100) / 100 });
    const cost = await refreshProductCost(orgId, before.Product_ID);
    return [{ path: snap.docs[0].ref.path, before: before as unknown as Record<string, unknown> }, ...(cost ? [cost] : [])];
}

// ─── Kreiranje nacrta ─────────────────────────────────────────────────

export interface DraftLine {
    materialName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    /** Materijali proizvoda kojima ide dio količine; prazno = samo za zalihu. */
    members: { materialId: string; productId: string; productName: string; projectId: string; allocation: number }[];
    /** Šta je ova stavka dodala u sastavnicu (vraća se pri brisanju narudžbe). */
    bomChange?: OrderItem['Bom_Change'];
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
        ...(line.bomChange ? { Bom_Change: line.bomChange } : {}),
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

/** Sve narudžbe firme sa stavkama — dva upita, bez upita po narudžbi. */
export async function listOrdersWithItems(orgId: string): Promise<Order[]> {
    const [orders, items] = await Promise.all([
        listOrders(orgId),
        adminDb().collection('order_items').where('Organization_ID', '==', orgId).get(),
    ]);
    const byOrder = new Map<string, OrderItem[]>();
    items.docs.forEach(d => {
        const item = d.data() as OrderItem;
        byOrder.set(item.Order_ID, [...(byOrder.get(item.Order_ID) || []), item]);
    });
    return orders.map(o => ({ ...o, items: byOrder.get(o.Order_ID) || [] }));
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

// ─── Životni ciklus narudžbe (bilo koje — i one napravljene u ERP-u) ──
//
// Iste kaskade kao updateOrderStatus / markMaterialsReceived / deleteOrder
// u ERP-u, uz jednu razliku: svaki dokument se prije izmjene preda `before`,
// da ↩️ Poništi u Telegramu može vratiti tačno stanje (narudžba, stavke,
// materijali, proizvod, projekat).

/** Prima putanju i stanje dokumenta PRIJE prve izmjene u ovoj radnji. */
export type BeforeHook = (path: string, data: Record<string, unknown>) => void;

type Snap = FirebaseFirestore.QueryDocumentSnapshot;

async function orderDocs(orgId: string, orderId: string): Promise<{ order: Snap; items: Snap[] } | null> {
    const db = adminDb();
    const [orderSnap, itemsSnap] = await Promise.all([
        db.collection('orders').where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).limit(1).get(),
        db.collection('order_items').where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).get(),
    ]);
    if (orderSnap.empty) return null;
    return { order: orderSnap.docs[0], items: itemsSnap.docs };
}

/** Promjena količina na materijalima; status se izvodi iz stanja (materijal može biti u više narudžbi). */
async function applyMaterialDeltas(
    orgId: string,
    deltas: Map<string, { ordered: number; received: number }>,
    requested: string,
    orderId: string,
    before?: BeforeHook,
): Promise<string[]> {
    const db = adminDb();
    const productIds: string[] = [];
    for (const part of chunks(Array.from(deltas.keys()))) {
        const snap = await db.collection('product_materials').where('Organization_ID', '==', orgId).where('ID', 'in', part).get();
        const batch = db.batch();
        snap.docs.forEach(d => {
            const m = d.data() as ProductMaterial;
            const delta = deltas.get(m.ID)!;
            before?.(d.ref.path, d.data());
            const ordered = Math.max(0, roundQty((m.Ordered_Quantity || 0) + delta.ordered));
            const received = Math.max(0, roundQty((m.Received_Quantity || 0) + delta.received));
            const status = settledMaterialStatus(requested, ordered, received);
            batch.update(d.ref, {
                Status: status,
                Order_ID: status === requested ? orderId : (m.Order_ID || orderId),
                Ordered_Quantity: ordered,
                Received_Quantity: received,
            });
            productIds.push(m.Product_ID);
        });
        await batch.commit();
    }
    return Array.from(new Set(productIds));
}

async function setStatusWhere(orgId: string, col: 'products' | 'projects', field: string, id: string, from: string[], to: string, before?: BeforeHook): Promise<void> {
    const p = await adminDb().collection(col).where('Organization_ID', '==', orgId).where(field, '==', id).limit(1).get();
    if (p.empty || !from.includes(p.docs[0].data().Status)) return;
    before?.(p.docs[0].ref.path, p.docs[0].data());
    await p.docs[0].ref.update({ Status: to });
}

export type OrderActionResult =
    | { ok: true; orderNumber: string; materials: number; detail?: string }
    | { ok: false; error: string };

/**
 * Nacrt → Poslano, ista kaskada kao updateOrderStatus u ERP-u.
 * `assumed`: materijal je već stigao, a kad je naručeno se ne zna (nacrt nije bio
 * označen poslanim) — datum slanja je datum nacrta i ne ulazi u rok isporuke dobavljača.
 */
export async function sendOrder(orgId: string, orderId: string, before?: BeforeHook, opts: { assumed?: boolean } = {}): Promise<OrderActionResult> {
    const docs = await orderDocs(orgId, orderId);
    if (!docs) return { ok: false, error: 'Narudžba više ne postoji.' };
    const order = docs.order.data() as Order;
    if (order.Status !== 'Nacrt') return { ok: false, error: `Narudžba ${order.Order_Number} je već „${order.Status}".` };
    if (!docs.items.length) return { ok: false, error: `Narudžba ${order.Order_Number} nema stavki.` };

    const deltas = new Map<string, { ordered: number; received: number }>();
    const productIds = new Set<string>();
    const projectIds = new Set<string>();
    const batch = adminDb().batch();
    before?.(docs.order.ref.path, docs.order.data());
    batch.update(docs.order.ref, opts.assumed
        ? { Status: 'Poslano', Sent_At: order.Order_Date || new Date().toISOString(), Sent_At_Assumed: true }
        : { Status: 'Poslano', Sent_At: new Date().toISOString() });
    for (const d of docs.items) {
        const item = d.data() as OrderItem;
        if (item.Status === 'Primljeno') continue;
        for (const [id, q] of Object.entries(orderItemAllocations(item))) {
            deltas.set(id, { ordered: (deltas.get(id)?.ordered || 0) + q, received: 0 });
        }
        before?.(d.ref.path, d.data());
        batch.update(d.ref, { Status: 'Naručeno' });
        if (item.Product_ID) productIds.add(item.Product_ID);
        if (item.Project_ID) projectIds.add(item.Project_ID);
    }
    await batch.commit();
    await applyMaterialDeltas(orgId, deltas, 'Naručeno', orderId, before);
    await Promise.all([
        ...Array.from(productIds).map(id => setStatusWhere(orgId, 'products', 'Product_ID', id, ['Na čekanju'], 'Materijali naručeni', before)),
        ...Array.from(projectIds).map(id => setStatusWhere(orgId, 'projects', 'Project_ID', id, ['Odobreno'], 'U proizvodnji', before)),
    ]);
    return { ok: true, orderNumber: order.Order_Number, materials: deltas.size };
}

/** Poslano → Nacrt: naručeno se skida s materijala (primljene stavke ostaju primljene). */
export async function revertOrderToDraft(orgId: string, orderId: string, before?: BeforeHook): Promise<OrderActionResult> {
    const docs = await orderDocs(orgId, orderId);
    if (!docs) return { ok: false, error: 'Narudžba više ne postoji.' };
    const order = docs.order.data() as Order;
    if (order.Status !== 'Poslano') return { ok: false, error: `Narudžba ${order.Order_Number} je „${order.Status}" — u nacrt se vraća samo poslana.` };

    const deltas = new Map<string, { ordered: number; received: number }>();
    const batch = adminDb().batch();
    before?.(docs.order.ref.path, docs.order.data());
    batch.update(docs.order.ref, { Status: 'Nacrt' });
    for (const d of docs.items) {
        const item = d.data() as OrderItem;
        if (item.Status === 'Primljeno') continue;
        for (const [id, q] of Object.entries(orderItemAllocations(item))) {
            deltas.set(id, { ordered: (deltas.get(id)?.ordered || 0) - q, received: 0 });
        }
        before?.(d.ref.path, d.data());
        batch.update(d.ref, { Status: 'Na čekanju' });
    }
    await batch.commit();
    await applyMaterialDeltas(orgId, deltas, 'Nije naručeno', '', before);
    return { ok: true, orderNumber: order.Order_Number, materials: deltas.size };
}

/**
 * Prijem stavki (sve ili samo neke). Narudžba mora biti poslana — kao u ERP-u,
 * prijem nacrta bi preskočio „naručeno" na materijalima.
 * `quantities` (ID stavke → stiglo sad) = djelimičan prijem: stavka ostaje
 * naručena dok ne stigne sve, a materijalima se dodaje srazmjeran dio.
 */
export async function receiveOrderItems(orgId: string, orderId: string, itemIds: string[] | 'all', before?: BeforeHook, quantities?: Record<string, number>, receivedAt?: string): Promise<OrderActionResult> {
    const docs = await orderDocs(orgId, orderId);
    if (!docs) return { ok: false, error: 'Narudžba više ne postoji.' };
    const order = docs.order.data() as Order;
    if (order.Status === 'Nacrt') return { ok: false, error: `Narudžba ${order.Order_Number} je još nacrt — prvo je pošalji, pa primi.` };
    if (order.Status === 'Primljeno') return { ok: false, error: `Narudžba ${order.Order_Number} je već primljena.` };

    const wanted = itemIds === 'all' ? null : new Set(itemIds);
    const deltas = new Map<string, { ordered: number; received: number }>();
    // Rečen dan prijema („jučer je stiglo"); inače sada.
    const nowIso = receivedAt || new Date().toISOString();
    const batch = adminDb().batch();
    let changed = 0;
    let completed = 0;
    for (const d of docs.items) {
        const item = d.data() as OrderItem;
        if (item.Status === 'Primljeno' || (wanted && !wanted.has(item.ID))) continue;
        const already = item.Received_Quantity || 0;
        const left = Math.max(0, roundQty((item.Quantity || 0) - already));
        const now = quantities?.[item.ID] !== undefined ? Math.min(left, Math.max(0, quantities[item.ID])) : left;
        if (now <= 0 && left > 0) continue;
        // Dio stigao: materijalima ide isti udio kao stavci.
        const share = item.Quantity > 0 ? now / item.Quantity : 1;
        for (const [id, q] of Object.entries(orderItemAllocations(item))) {
            const prev = deltas.get(id) || { ordered: 0, received: 0 };
            const part = roundQty(q * share);
            deltas.set(id, { ordered: prev.ordered - part, received: prev.received + part });
        }
        before?.(d.ref.path, d.data());
        const full = roundQty(already + now) >= roundQty(item.Quantity || 0);
        batch.update(d.ref, full
            ? { Status: 'Primljeno', Received_Date: nowIso, Received_Quantity: item.Quantity }
            : { Received_Quantity: roundQty(already + now), Received_Date: nowIso });
        changed++;
        if (full) completed++;
    }
    if (!changed) return { ok: false, error: 'Nema neprimljenih stavki za prijem.' };
    const remaining = docs.items.filter(d => (d.data() as OrderItem).Status !== 'Primljeno').length - completed;
    if (remaining === 0) {
        before?.(docs.order.ref.path, docs.order.data());
        batch.update(docs.order.ref, { Status: 'Primljeno' });
    }
    await batch.commit();

    const productIds = await applyMaterialDeltas(orgId, deltas, 'Primljeno', orderId, before);
    // Svi materijali proizvoda tu → „Materijali spremni" (kao ERP).
    await Promise.all(productIds.map(async id => {
        const mats = await adminDb().collection('product_materials').where('Organization_ID', '==', orgId).where('Product_ID', '==', id).get();
        if (mats.docs.every(m => ['Primljeno', 'Na stanju'].includes((m.data() as ProductMaterial).Status))) {
            await setStatusWhere(orgId, 'products', 'Product_ID', id, ['Na čekanju', 'Materijali naručeni'], 'Materijali spremni', before);
        }
    }));
    return {
        ok: true, orderNumber: order.Order_Number, materials: deltas.size,
        detail: remaining === 0
            ? 'cijela narudžba primljena'
            : `primljeno ${changed}${changed > completed ? ` (${changed - completed} djelimično)` : ''}, čeka još ${remaining}`,
    };
}

/**
 * Brisanje: nacrt se samo obriše; poslanoj se naručeno skida s materijala
 * (kao ERP „vrati materijale"), a već primljene stavke ostaju primljene.
 */
export async function deleteOrderWithItems(orgId: string, orderId: string, before?: BeforeHook): Promise<OrderActionResult> {
    const docs = await orderDocs(orgId, orderId);
    if (!docs) return { ok: false, error: 'Narudžba više ne postoji.' };
    const order = docs.order.data() as Order;
    const deltas = new Map<string, { ordered: number; received: number }>();
    if (order.Status !== 'Nacrt') {
        for (const d of docs.items) {
            const item = d.data() as OrderItem;
            if (item.Status === 'Primljeno') continue;
            for (const [id, q] of Object.entries(orderItemAllocations(item))) {
                deltas.set(id, { ordered: (deltas.get(id)?.ordered || 0) - q, received: 0 });
            }
        }
        await applyMaterialDeltas(orgId, deltas, 'Nije naručeno', '', before);
    }
    const batch = adminDb().batch();
    for (const d of [...docs.items, docs.order]) {
        before?.(d.ref.path, d.data());
        batch.delete(d.ref);
    }
    await batch.commit();
    const reverted = await revertBomChanges(orgId, docs.items.map(d => d.data() as OrderItem), before);
    return {
        ok: true, orderNumber: order.Order_Number, materials: deltas.size,
        ...(reverted.length ? { detail: `iz sastavnice skinuto: ${reverted.join(', ')}` } : {}),
    };
}

/**
 * Brisanje narudžbe vraća ono što je ona dodala u sastavnicu (višak ili nov
 * materijal) — inače bi trošak i profit ostali naduvani za nešto što se ne
 * naručuje. Nov materijal se briše samo ako na njemu nema ničeg naručenog ni
 * primljenog (npr. iz druge narudžbe).
 */
async function revertBomChanges(orgId: string, items: OrderItem[], before?: BeforeHook): Promise<string[]> {
    const db = adminDb();
    const labels: string[] = [];
    const products = new Set<string>();
    for (const item of items) {
        const change = item.Bom_Change;
        if (!change || item.Status === 'Primljeno') continue;
        const snap = await db.collection('product_materials').where('Organization_ID', '==', orgId).where('ID', '==', change.Material_ID).limit(1).get();
        if (snap.empty) continue;
        const m = snap.docs[0].data() as ProductMaterial;
        const prod = await db.collection('products').where('Organization_ID', '==', orgId).where('Product_ID', '==', m.Product_ID).limit(1).get();
        const count = prod.empty ? 1 : ((prod.docs[0].data() as Product).Quantity || 1);
        const quantity = Math.max(0, Math.round(((m.Quantity || 0) - change.Extra / count) * 1_000_000) / 1_000_000);
        before?.(snap.docs[0].ref.path, snap.docs[0].data());
        if (change.Added && quantity <= 0 && !(m.Ordered_Quantity || 0) && !(m.Received_Quantity || 0)) {
            await snap.docs[0].ref.delete();
        } else {
            await snap.docs[0].ref.update({ Quantity: quantity, Total_Price: Math.round(quantity * (m.Unit_Price || 0) * 100) / 100 });
        }
        labels.push(`${formatQty(change.Extra)} ${m.Unit || 'kom'} ${m.Material_Name}`);
        products.add(m.Product_ID);
    }
    for (const id of Array.from(products)) {
        const op = await refreshProductCost(orgId, id);
        if (op) before?.(op.path, op.before as Record<string, unknown>);
    }
    return labels;
}

