// ════════════════════════════════════════════════════════════════════
// KAPIJE MATERIJALA U TELEGRAMU — sat, provjere s dugmadima, upisi (Admin SDK)
//
// Sat (/api/assistant/tick) svakih 10 minuta pogleda naloge u toku:
// lib/materialGates odluči šta pitati (pokretanje, najava, kapija), a ovdje
// se pošalje poruka s označavanjem. Odgovor dugmadima ide bez modela:
//   ☐/☑ red  → „tu je"   (primi stavku poslane narudžbe ili „Na stanju")
//   Naruči   → nacrti po dobavljaču + PDF (isti put kao create_order)
//   Pitaj sutra → ista provjera sutra u 8, s osvježenim stanjem
//
// material_alerts/{org_wo}  — šta je za nalog već pitano (Seen)
// material_checks/{id}      — jedna poslana provjera i njeni redovi
// ════════════════════════════════════════════════════════════════════

import { adminDb } from '@/lib/server/firebaseAdmin';
import { attachItems, getItemsForWorkOrders, getOpenWorkOrders, processGraphOf } from '@/lib/server/fieldRepo';
import { createTask } from '@/lib/server/fieldWrites';
import {
    createDraftOrder, loadProductMaterials, loadProjectMaterials, receiveOrderItems, sendOrder, type BeforeHook, type DraftLine,
} from '@/lib/server/orderWrites';
import { orderItemAllocations } from '@/lib/orderMaterialAllocation';
import { materialGroupKey, roundQty } from '@/lib/orderItemGroups';
import { foldText } from '@/lib/voice/text';
import { addDays, findDateMentions } from '@/lib/voice/dates';
import { matchScore } from '@/lib/voice/match';
import { sendMessage } from '@/lib/telegram/api';
import { workOrderDisplayName } from '@/lib/utils';
import {
    DEFAULT_STOCK_RULES, buildGates, candidateKeys, dueAlerts, rowIsReady, rowLabel, supplierLeadDays,
    type AlertKind, type Gate, type GateMaterialInput, type GateRow, type OrderRef, type StockRules,
} from '@/lib/materialGates';
import { answeredMessage, checkMessage, needsOrder, type CheckView } from './materialText';
import { toZoned, zonedToUtcMs } from './datetime';
import { sendOrderPdf } from './orderDocuments';
import { listLinks, recordOp, type AssistantLink } from './store';
import type { ButtonRows } from '@/lib/telegram/api';
import type { Material, Order, OrderItem, Product, ProductMaterial, Supplier, WorkOrder } from '@/lib/types';

const ALERTS = 'material_alerts';
const CHECKS = 'material_checks';
/** Sat pita od 6 do 21 h, svakih 10 minuta. */
const FROM_HOUR = 6;
const UNTIL_HOUR = 21;
const EVERY_MIN = 10;
/** Nalog koji je krenuo prije ovoga (npr. prije uvođenja kapija) ne dobija pitanje pri pokretanju. */
const START_GRACE_DAYS = 2;
const INTERNAL = /^(interni|interno|vlastito|in-house)$/i;
const CHUNK = 30;

interface StoredCheck {
    Check_ID: string;
    Organization_ID: string;
    Owner_UID: string;
    Chat_ID: number;
    Work_Order_ID: string;
    Work_Order_Label: string;
    Project_IDs: string[];
    Kind: AlertKind;
    Processes: string[];
    Rows: GateRow[];
    Long_Lead: GateRow[];
    Selected: number[];
    /** Poslije odgovora: šta nije bilo tu (za „Naruči što fali"). */
    Rest?: GateRow[];
    Status: 'open' | 'answered' | 'snoozed' | 'closed';
    Remind_At?: string;
    Created_At: string;
    Answered_At?: string;
}

export interface MaterialReply { text?: string; buttons?: ButtonRows; toast?: string }

// ─── Učitavanje ───────────────────────────────────────────────────────

function chunks<T>(arr: T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
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

export async function loadStockRules(orgId: string): Promise<StockRules> {
    const snap = await adminDb().collection('org_settings').doc(orgId).get();
    const s = (snap.data() as { materialStock?: Partial<StockRules> } | undefined)?.materialStock;
    if (!s) return DEFAULT_STOCK_RULES;
    return { types: Array.isArray(s.types) ? s.types : DEFAULT_STOCK_RULES.types, phrases: Array.isArray(s.phrases) ? s.phrases : DEFAULT_STOCK_RULES.phrases };
}

/** Naučeni rok isporuke po dobavljaču; keš 1 h po firmi (sat ga ne računa svakih 10 minuta). */
const leadCache = new Map<string, { at: number; value: Map<string, number> }>();

export async function loadLeadDays(orgId: string): Promise<Map<string, number>> {
    const hit = leadCache.get(orgId);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
    const db = adminDb();
    const [orders, items] = await Promise.all([
        db.collection('orders').where('Organization_ID', '==', orgId).get(),
        db.collection('order_items').where('Organization_ID', '==', orgId).where('Status', '==', 'Primljeno').get(),
    ]);
    const byId = new Map(orders.docs.map(d => d.data() as Order).map(o => [o.Order_ID, o]));
    // Narudžba kojoj datum slanja nije poznat (nacrt primljen porukom) ne uči rok isporuke.
    const value = supplierLeadDays(items.docs.map(d => d.data() as OrderItem).flatMap(i => {
        const o = byId.get(i.Order_ID);
        if (!o || !i.Received_Date || o.Sent_At_Assumed) return [];
        // Dobavljač je javio mailom da je spremno (PR ulazne pošte) — to je njegov stvarni rok, ne naše preuzimanje.
        const ready = o.Ready_At && o.Ready_At < i.Received_Date ? o.Ready_At : i.Received_Date;
        return [{ supplier: o.Supplier_Name, orderedAt: o.Sent_At || o.Order_Date, receivedAt: ready }];
    }));
    leadCache.set(orgId, { at: Date.now(), value });
    return value;
}

export interface WorkOrderGates {
    wo: WorkOrder;
    label: string;
    projectIds: string[];
    gates: Gate[];
}

/** Kapije za naloge (stavke moraju biti zakačene): sastavnice, katalog i narudžbe u nekoliko upita. */
export async function workOrderGates(orgId: string, wos: WorkOrder[], stock?: StockRules): Promise<WorkOrderGates[]> {
    const items = wos.flatMap(w => w.items || []);
    const productIds = items.map(i => i.Product_ID).filter(Boolean);
    const [rules, products, materials, leadDays] = await Promise.all([
        stock ? Promise.resolve(stock) : loadStockRules(orgId),
        byIds<Product>(orgId, 'products', 'Product_ID', productIds),
        loadProductMaterials(orgId, productIds),
        loadLeadDays(orgId).catch(() => new Map<string, number>()),
    ]);
    const [catalog, orders] = await Promise.all([
        byIds<Material>(orgId, 'materials', 'Material_ID', materials.map(m => m.Material_ID)),
        byIds<Order>(orgId, 'orders', 'Order_ID', materials.map(m => m.Order_ID)),
    ]);
    const catalogById = new Map(catalog.map(c => [c.Material_ID, c]));
    const productQty = new Map(products.map(p => [p.Product_ID, p.Quantity || 1]));
    const orderRefs = new Map<string, OrderRef>(orders.map(o => [o.Order_ID, { number: o.Order_Number, supplier: o.Supplier_Name, date: o.Order_Date, status: o.Status }]));
    const inputs: GateMaterialInput[] = materials.map(m => ({ ...m, catalog: catalogById.get(m.Material_ID) }));

    return wos.map(wo => {
        const its = (wo.items || []).filter(i => i.Item_Type !== 'custom');
        const mine = new Set(its.map(i => i.Product_ID));
        return {
            wo,
            label: workOrderDisplayName(wo),
            projectIds: Array.from(new Set(its.map(i => i.Project_ID).filter(Boolean))),
            gates: buildGates({
                graph: processGraphOf(wo),
                items: its.map(i => ({ ID: i.ID, Product_ID: i.Product_ID, Product_Name: i.Product_Name, Product_Quantity: productQty.get(i.Product_ID), Status: i.Status, Processes: i.Processes })),
                materials: inputs.filter(m => mine.has(m.Product_ID)),
                stock: rules,
                orders: orderRefs,
                leadDays,
            }),
        };
    });
}

/** Otvoreni nalozi u toku, sa stavkama. */
async function runningWorkOrders(orgId: string): Promise<WorkOrder[]> {
    const wos = (await getOpenWorkOrders(orgId)).filter(w => w.Status === 'U toku');
    if (!wos.length) return [];
    return attachItems(wos, await getItemsForWorkOrders(orgId, wos.map(w => w.Work_Order_ID)));
}

// ─── Sat ──────────────────────────────────────────────────────────────

const alertDocId = (orgId: string, woId: string) => `${orgId}_${woId}`.replace(/\//g, '_');

/**
 * Pošalji dospjele provjere. Bez `orgId` je to sat (prozor 6–21 h, svakih 10 min);
 * s `orgId` je odmah poslije upisa rada iz Telegrama (proces je možda baš počeo).
 */
export async function sendMaterialAlerts(now: Date, tz: string, only?: { orgId: string }): Promise<number> {
    const local = toZoned(now, tz);
    if (!only && (local.hour < FROM_HOUR || local.hour >= UNTIL_HOUR || local.minute % EVERY_MIN !== 0)) return 0;

    const links = (await listLinks()).filter(l => !only || l.orgId === only.orgId);
    const byOrg = new Map<string, AssistantLink[]>();
    links.forEach(l => byOrg.set(l.orgId, [...(byOrg.get(l.orgId) || []), l]));

    let sent = 0;
    for (const [orgId, orgLinks] of Array.from(byOrg.entries())) {
        try {
            sent += await alertsForOrg(orgId, orgLinks, now);
            if (!only) sent += await resendSnoozed(orgId, orgLinks, now);
        } catch (e) {
            console.error('[materialAlerts] firma', orgId, e);
        }
    }
    return sent;
}

async function alertsForOrg(orgId: string, links: AssistantLink[], now: Date): Promise<number> {
    const wos = await runningWorkOrders(orgId);
    if (!wos.length) return 0;
    const db = adminDb();
    const refs = wos.map(w => db.collection(ALERTS).doc(alertDocId(orgId, w.Work_Order_ID)));
    const snaps = await Promise.all(refs.map(r => r.get()));
    const seenOf = new Map<string, Set<string>>();
    const graceIso = new Date(now.getTime() - START_GRACE_DAYS * 86_400_000).toISOString();

    const pending: WorkOrder[] = [];
    for (let i = 0; i < wos.length; i++) {
        const wo = wos[i];
        const seen = new Set<string>(((snaps[i].data() as { Seen?: string[] } | undefined)?.Seen) || []);
        if (!snaps[i].exists && wo.Started_At && wo.Started_At < graceIso) {
            // Nalog je radio i prije kapija: bez pitanja „krenuo", najave idu normalno.
            seen.add('start');
            await refs[i].set({ Organization_ID: orgId, Work_Order_ID: wo.Work_Order_ID, Seen: ['start'], Updated_At: now.toISOString() });
        }
        seenOf.set(wo.Work_Order_ID, seen);
        const items = (wo.items || []).filter(it => it.Item_Type !== 'custom');
        const keys = candidateKeys(true, processGraphOf(wo), items.map(it => ({ ID: it.ID, Product_ID: it.Product_ID, Product_Name: it.Product_Name, Status: it.Status, Processes: it.Processes })));
        if (keys.some(k => !seen.has(k))) pending.push(wo);
    }
    if (!pending.length) return 0;

    let sent = 0;
    for (const g of await workOrderGates(orgId, pending)) {
        const seen = seenOf.get(g.wo.Work_Order_ID)!;
        const { alerts, consumed } = dueAlerts(true, g.gates, seen);
        for (const alert of alerts) {
            for (const link of links) {
                await sendCheck(link, g, alert.kind, alert.processes, alert.rows, alert.longLead, now);
                sent++;
            }
            if (alert.kind === 'gate') await gateTask(orgId, links[0], g, alert.processes[0], alert.rows);
        }
        if (consumed.length) {
            await db.collection(ALERTS).doc(alertDocId(orgId, g.wo.Work_Order_ID)).set({
                Organization_ID: orgId, Work_Order_ID: g.wo.Work_Order_ID,
                Seen: Array.from(new Set([...Array.from(seen), ...consumed])), Updated_At: now.toISOString(),
            });
        }
    }
    return sent;
}

async function sendCheck(
    link: AssistantLink, g: Pick<WorkOrderGates, 'wo' | 'label' | 'projectIds'>, kind: AlertKind, processes: string[],
    rows: GateRow[], longLead: GateRow[], now: Date,
): Promise<void> {
    const ref = adminDb().collection(CHECKS).doc();
    const check: StoredCheck = {
        Check_ID: ref.id, Organization_ID: link.orgId, Owner_UID: link.uid, Chat_ID: link.chatId,
        Work_Order_ID: g.wo.Work_Order_ID, Work_Order_Label: g.label, Project_IDs: g.projectIds,
        Kind: kind, Processes: processes, Rows: rows, Long_Lead: longLead, Selected: [],
        Status: rows.length ? 'open' : 'answered', Created_At: now.toISOString(),
        ...(rows.length ? {} : { Rest: [] }),
    };
    await ref.set(JSON.parse(JSON.stringify(check)));
    const msg = checkMessage(view(check));
    await sendMessage(link.chatId, msg.text, msg.buttons);
}

/** Kapija bez materijala = zadatak u Zadacima (vidi se i u ERP-u). */
async function gateTask(orgId: string, link: AssistantLink | undefined, g: WorkOrderGates, process: string, rows: GateRow[]): Promise<void> {
    try {
        await createTask(orgId, {
            title: `Materijal za ${process.toLowerCase()}: ${g.label}`,
            description: rows.map(r => `• ${rowLabel(r)}`).join('\n'),
            category: 'ordering',
            priority: 'high',
            workOrderId: g.wo.Work_Order_ID,
            checklist: rows.map(r => r.name),
            source: 'telegram',
            createdByUid: link?.uid,
        });
    } catch (e) {
        console.error('[materialAlerts] zadatak kapije nije napravljen:', e);
    }
}

/** „Pitaj sutra": ista provjera ponovo, s redovima koji ni sad nisu tu. */
async function resendSnoozed(orgId: string, links: AssistantLink[], now: Date): Promise<number> {
    const snap = await adminDb().collection(CHECKS).where('Organization_ID', '==', orgId).where('Status', '==', 'snoozed').get();
    const due = snap.docs.map(d => d.data() as StoredCheck).filter(c => (c.Remind_At || '') <= now.toISOString());
    if (!due.length) return 0;
    const wos = await runningWorkOrders(orgId);
    const gates = await workOrderGates(orgId, wos.filter(w => due.some(c => c.Work_Order_ID === w.Work_Order_ID)));
    let sent = 0;
    for (const c of due) {
        await adminDb().collection(CHECKS).doc(c.Check_ID).update({ Status: 'closed' });
        const g = gates.find(x => x.wo.Work_Order_ID === c.Work_Order_ID);
        const link = links.find(l => l.uid === c.Owner_UID);
        if (!g || !link) continue;
        const wanted = new Set((c.Rest || c.Rows).map(r => `${r.process}|${r.key}`));
        const rows = g.gates.flatMap(x => x.rows).filter(r => wanted.has(`${r.process}|${r.key}`) && !rowIsReady(r));
        if (!rows.length) continue;
        await sendCheck(link, g, c.Kind, c.Processes, rows, [], now);
        sent++;
    }
    return sent;
}

// ─── Dugmad ───────────────────────────────────────────────────────────

function view(c: StoredCheck): CheckView {
    return { id: c.Check_ID, kind: c.Kind, label: c.Work_Order_Label, processes: c.Processes, rows: c.Rows, longLead: c.Long_Lead || [], selected: c.Selected || [] };
}

/** `mc:<id>:<radnja>[:<arg>]` — t (označi red), all, ok, ord, long, snz. */
export async function handleMaterialButton(link: AssistantLink, id: string, action: string, arg: string, tz: string): Promise<MaterialReply> {
    const ref = adminDb().collection(CHECKS).doc(id);
    const c = (await ref.get()).data() as StoredCheck | undefined;
    if (!c || c.Owner_UID !== link.uid || c.Organization_ID !== link.orgId) return { toast: 'Provjera više ne postoji.' };

    if (action === 't' || action === 'all' || action === 'ok') {
        if (c.Status !== 'open') return { toast: 'Već odgovoreno.' };
        if (action === 't') {
            const i = Number(arg);
            if (!Number.isInteger(i) || i < 0 || i >= c.Rows.length) return { toast: 'Nepoznat red.' };
            const selected = c.Selected.includes(i) ? c.Selected.filter(x => x !== i) : [...c.Selected, i];
            await ref.update({ Selected: selected });
            return checkMessage(view({ ...c, Selected: selected }));
        }
        const selected = action === 'all' ? c.Rows.map((_, i) => i) : c.Selected;
        return confirmCheck(link, ref, { ...c, Selected: selected });
    }

    if (action === 'ord' || action === 'long') {
        const rows = action === 'long' ? c.Long_Lead || [] : (c.Rest || []).filter(needsOrder);
        if (!rows.length) return { toast: 'Nema šta naručiti.' };
        const created = await orderRows(link, c, rows);
        if (!created.length) return { toast: 'Sve je već naručeno ili u nacrtu.' };
        const base = action === 'long' ? checkMessage(view(c)) : answeredMessage(view(c), [], c.Rest || []);
        const buttons = (base.buttons || []).filter(row => row.every(b => !b.data.endsWith(`:${action}`)));
        return { text: `${base.text}\n→ 🧾 ${created.join(', ')} — PDF stiže ispod`, buttons, toast: 'Nacrt narudžbe napravljen' };
    }

    if (action === 'snz') {
        const today = toZoned(new Date(), tz).date;
        const at = new Date(zonedToUtcMs(addDays(today, 1), 8, 0, tz)).toISOString();
        await ref.update({ Status: 'snoozed', Remind_At: at });
        const base = c.Rest ? answeredMessage(view(c), [], c.Rest) : checkMessage(view(c));
        return { text: `${base.text}\n→ ⏰ pitaću sutra u 8`, toast: 'Pitaću sutra' };
    }
    return { toast: 'Nepoznata radnja.' };
}

async function confirmCheck(link: AssistantLink, ref: FirebaseFirestore.DocumentReference, c: StoredCheck): Promise<MaterialReply> {
    const marked = c.Rows.filter((_, i) => c.Selected.includes(i));
    const rest = c.Rows.filter((_, i) => !c.Selected.includes(i));
    const turnId = `mc-${c.Check_ID}`;
    if (marked.length) {
        const befores = new Map<string, Record<string, unknown>>();
        await markRowsHere(link.orgId, marked, (path, data) => { if (!befores.has(path)) befores.set(path, data); });
        await Promise.all(Array.from(befores.entries()).map(([path, before]) =>
            recordOp({ turnId, uid: link.uid, orgId: link.orgId, path, before, label: `materijal ${c.Work_Order_Label}` })));
    }
    await ref.update({ Status: 'answered', Selected: c.Selected, Rest: JSON.parse(JSON.stringify(rest)), Answered_At: new Date().toISOString() });
    return { ...answeredMessage(view(c), marked, rest), toast: marked.length ? 'Upisano' : 'Zabilježeno' };
}

// ─── Upisi ────────────────────────────────────────────────────────────

/**
 * „Tu je": materijal iz POSLANE narudžbe se prima kroz narudžbu (stavka, količine,
 * status narudžbe); ostalo (zaliha, kupljeno usput) postaje „Na stanju".
 */
export async function markMaterialsHere(orgId: string, materialIds: string[], before?: BeforeHook): Promise<number> {
    const db = adminDb();
    const pms: { ref: FirebaseFirestore.DocumentReference; data: ProductMaterial }[] = [];
    for (const part of chunks(Array.from(new Set(materialIds)))) {
        const snap = await db.collection('product_materials').where('Organization_ID', '==', orgId).where('ID', 'in', part).get();
        snap.docs.forEach(d => pms.push({ ref: d.ref, data: d.data() as ProductMaterial }));
    }
    const ids = new Set(pms.map(p => p.data.ID));
    const handled = new Set<string>();

    const orderIds = Array.from(new Set(pms.map(p => p.data.Order_ID).filter(Boolean)));
    const orders = await byIds<Order>(orgId, 'orders', 'Order_ID', orderIds);
    for (const order of orders.filter(o => o.Status === 'Poslano')) {
        const items = await byIds<OrderItem>(orgId, 'order_items', 'Order_ID', [order.Order_ID]);
        const hit = items.filter(i => i.Status !== 'Primljeno' && Object.keys(orderItemAllocations(i)).some(id => ids.has(id)));
        if (!hit.length) continue;
        const res = await receiveOrderItems(orgId, order.Order_ID, hit.map(i => i.ID), before);
        if (res.ok) hit.forEach(i => Object.keys(orderItemAllocations(i)).forEach(id => handled.add(id)));
    }

    let count = handled.size;
    const batch = db.batch();
    for (const p of pms) {
        if (handled.has(p.data.ID) || p.data.Status === 'Na stanju') continue;
        before?.(p.ref.path, p.data as unknown as Record<string, unknown>);
        batch.update(p.ref, { Status: 'Na stanju' });
        count++;
    }
    await batch.commit();
    return count;
}

async function markRowsHere(orgId: string, rows: GateRow[], before: BeforeHook): Promise<number> {
    return markMaterialsHere(orgId, rows.flatMap(r => r.materialIds), before);
}

/** Nacrti po dobavljaču za redove koji fale + PDF u Telegram. */
async function orderRows(link: AssistantLink, c: StoredCheck, rows: GateRow[]): Promise<string[]> {
    const drafts = await draftOrdersFor(link.orgId, c.Project_IDs, rows.flatMap(r => r.materialIds), c.Work_Order_Label,
        'Kreirano iz provjere materijala (Telegram).', (path, label) => recordOp({ turnId: `mc-${c.Check_ID}-o`, uid: link.uid, orgId: link.orgId, path, before: null, label }));
    for (const d of drafts) {
        try {
            await sendOrderPdf(link.chatId, link.orgId, d.orderId, true);
        } catch (e) {
            console.error('[materialAlerts] PDF narudžbe pao:', e);
        }
    }
    return drafts.map(d => `${d.orderNumber} (${d.supplier})`);
}

/**
 * Nacrti narudžbi po dobavljaču za te materijale: ostatak za naručiti, bez
 * onog što je već u nacrtima; interni dobavljač (usluga) se ne naručuje.
 */
export async function draftOrdersFor(
    orgId: string, projectIds: string[], materialIds: string[], name: string, notes: string,
    onCreated?: (path: string, label: string) => Promise<void>,
): Promise<{ orderId: string; orderNumber: string; supplier: string }[]> {
    const ids = new Set(materialIds);
    const available = (await loadProjectMaterials(orgId, projectIds))
        .filter(r => ids.has(r.materialId) && r.available > 0 && !INTERNAL.test((r.supplier || '').trim()));
    if (!available.length) return [];

    const supplierSnap = await adminDb().collection('suppliers').where('Organization_ID', '==', orgId).get();
    const suppliers = supplierSnap.docs.map(d => d.data() as Supplier);
    const resolve = (name: string) => {
        const hit = name ? suppliers.find(s => foldText(s.Name) === foldText(name)) || suppliers.find(s => matchScore(name, [s.Name]) >= 0.85) : undefined;
        return { id: hit?.Supplier_ID || '', name: hit?.Name || name || 'Neodređen' };
    };

    const bySupplier = new Map<string, Map<string, DraftLine>>();
    for (const r of available) {
        const supplier = resolve(r.supplier).name;
        const lines = bySupplier.get(supplier) || new Map<string, DraftLine>();
        const key = materialGroupKey(r.name, r.unit);
        const line = lines.get(key) || { materialName: r.name, unit: r.unit, quantity: 0, unitPrice: r.unitPrice, members: [] };
        line.quantity = roundQty(line.quantity + r.available);
        line.members.push({ materialId: r.materialId, productId: r.productId, productName: r.productName, projectId: r.projectId, allocation: r.available });
        lines.set(key, line);
        bySupplier.set(supplier, lines);
    }

    const created: { orderId: string; orderNumber: string; supplier: string }[] = [];
    for (const [supplierName, lines] of Array.from(bySupplier.entries())) {
        const supplier = resolve(supplierName);
        const draft = await createDraftOrder(orgId, {
            supplierId: supplier.id, supplierName: supplier.name, name, notes, lines: Array.from(lines.values()),
        });
        if (onCreated) await Promise.all(draft.paths.map(path => onCreated(path, `narudžba ${draft.orderNumber}`)));
        created.push({ orderId: draft.orderId, orderNumber: draft.orderNumber, supplier: supplier.name });
    }
    return created;
}

// ─── Za alate i pregled ───────────────────────────────────────────────

/** Kapije naloga projekta (ili svih u toku) — za pitanje „šta fali za Jerka". */
export async function gatesForProjects(orgId: string, projectIds: string[] | null): Promise<WorkOrderGates[]> {
    const wos = await runningWorkOrders(orgId);
    const mine = projectIds ? wos.filter(w => (w.items || []).some(i => projectIds.includes(i.Project_ID))) : wos;
    return mine.length ? workOrderGates(orgId, mine) : [];
}

/** Jutarnji pregled: kasne narudžbe i ono što treba uskoro, a nije tu. null kad nema ničega. */
export async function materialDigest(orgId: string, today: string): Promise<string | null> {
    const ordersSnap = await adminDb().collection('orders').where('Organization_ID', '==', orgId).where('Status', '==', 'Poslano').get();
    const late = ordersSnap.docs.map(d => d.data() as Order)
        .filter(o => o.Expected_Delivery && o.Expected_Delivery.slice(0, 10) < today)
        .sort((a, b) => a.Expected_Delivery.localeCompare(b.Expected_Delivery));
    const soon: string[] = [];
    for (const g of await gatesForProjects(orgId, null)) {
        for (const gate of g.gates) {
            if (gate.status === 'done' || gate.distance == null || gate.distance > 2) continue;
            const missing = gate.rows.filter(r => !r.stock && !rowIsReady(r));
            if (missing.length) soon.push(`• ${g.label} · ${gate.process.toLowerCase()}: ${missing.slice(0, 4).map(r => r.name).join(', ')}${missing.length > 4 ? ` +${missing.length - 4}` : ''}`);
        }
    }
    if (!late.length && !soon.length) return null;
    const lines = ['📦 Materijal:'];
    late.slice(0, 6).forEach(o => lines.push(`• kasni ${o.Order_Number} (${o.Supplier_Name}) — trebalo ${Number(o.Expected_Delivery.slice(8, 10))}.${Number(o.Expected_Delivery.slice(5, 7))}.`));
    soon.slice(0, 8).forEach(l => lines.push(l));
    return lines.join('\n');
}

// ─── „Stiglo je …" porukom ────────────────────────────────────────────

export interface ArrivalOutcome {
    ok: boolean;
    /** Red za potvrdu („📦 Stiglo: …"). */
    line?: string;
    error?: string;
    /** Više različitih materijala pristaje rečenom nazivu — korisnik bira dugmetom. */
    candidates?: string[];
    /** Narudžbe kojima ERP ne zna kad su naručene (bile nacrt ili su sad napravljene). */
    assumed?: { orderId: string; orderNumber: string }[];
    /** Narudžbe čije su stavke sad primljene (za „kad je stiglo?"). */
    received?: { orderId: string; orderNumber: string }[];
    /** Ništa nije promijenjeno (sve je već bilo primljeno). */
    unchanged?: boolean;
}

/**
 * „Stigao Kerrock za Budnju": ERP nađe materijal u SASTAVNICI projekta (ne samo u
 * kapijama naloga u toku) i njegovu narudžbu, pa je završi po pravilu korisnika:
 *   • poslana narudžba → primi stavke;
 *   • nacrt → označi poslanim (datum narudžbe nepoznat — ne ulazi u rok isporuke) i primi;
 *   • narudžbe nema → napravi je iz sastavnice, označi poslanom i primi.
 * Rečena količina manja od ostatka = djelimičan prijem. Više različitih materijala
 * istog naziva („kerrock" → ploča i ljepilo) → izbor; `all` = svi.
 */
export async function receiveArrival(
    orgId: string,
    input: { projectIds: string[]; name: string; quantity?: number; exact?: boolean; all?: boolean; orderName?: string; receivedAt?: string },
    before: BeforeHook,
    onCreated: (path: string) => void,
): Promise<ArrivalOutcome> {
    const rows = await loadProjectMaterials(orgId, input.projectIds);
    const scored = rows
        .map(r => ({ r, s: input.exact ? (foldText(r.name) === foldText(input.name) ? 1 : 0) : matchScore(input.name, [r.name]) }))
        .filter(x => x.s >= 0.7);
    if (!scored.length) return { ok: false, error: `„${input.name}" nije u sastavnici tih projekata.` };
    const best = Math.max(...scored.map(x => x.s));
    const top = scored.filter(x => x.s >= best - 0.05).map(x => x.r);
    const names = Array.from(new Map(top.map(r => [materialGroupKey(r.name, r.unit), r.name])).values());
    if (names.length > 1 && !input.all) {
        return { ok: false, error: `„${input.name}" odgovara za više materijala.`, candidates: names.slice(0, 5) };
    }
    const label = names.length === 1 ? names[0] : names.join(', ');
    const open = top.filter(r => roundQty(r.received + r.onStock) < roundQty(r.needed) || r.needed === 0);
    if (!open.length) return { ok: true, unchanged: true, line: `✔ ${label} — već je bilo primljeno, ništa nije mijenjano.` };
    const ids = new Set(open.map(r => r.materialId));

    const db = adminDb();
    const [ordersSnap, itemsSnap] = await Promise.all([
        db.collection('orders').where('Organization_ID', '==', orgId).get(),
        db.collection('order_items').where('Organization_ID', '==', orgId).get(),
    ]);
    const orders = new Map(ordersSnap.docs.map(d => d.data() as Order).map(o => [o.Order_ID, o]));
    const hits = itemsSnap.docs.map(d => d.data() as OrderItem)
        .filter(i => i.Status !== 'Primljeno' && Object.keys(orderItemAllocations(i)).some(id => ids.has(id)))
        .filter(i => ['Poslano', 'Nacrt'].includes(orders.get(i.Order_ID)?.Status || ''));
    const covered = new Set(hits.flatMap(i => Object.keys(orderItemAllocations(i))));

    let left = input.quantity;
    const parts: string[] = [];
    const assumed: { orderId: string; orderNumber: string }[] = [];
    const received: { orderId: string; orderNumber: string }[] = [];
    // Rečena količina se troši redom po stavkama; bez nje stiže sve što je ostalo.
    const receive = async (orderId: string, items: OrderItem[]) => {
        const qty: Record<string, number> = {};
        for (const i of items) {
            const rest = Math.max(0, roundQty((i.Quantity || 0) - (i.Received_Quantity || 0)));
            const take = left === undefined ? rest : Math.min(rest, left);
            if (take <= 0) continue;
            qty[i.ID] = take;
            if (left !== undefined) left = roundQty(left - take);
        }
        if (!Object.keys(qty).length) return null;
        const res = await receiveOrderItems(orgId, orderId, Object.keys(qty), before, qty, input.receivedAt);
        if (res.ok) received.push({ orderId, orderNumber: res.orderNumber });
        return res;
    };

    for (const orderId of Array.from(new Set(hits.map(i => i.Order_ID)))) {
        const order = orders.get(orderId)!;
        const mine = hits.filter(i => i.Order_ID === orderId);
        const draft = order.Status === 'Nacrt';
        if (draft) {
            const sent = await sendOrder(orgId, orderId, before, { assumed: true });
            if (!sent.ok) { parts.push(sent.error); continue; }
            assumed.push({ orderId, orderNumber: order.Order_Number });
        }
        const res = await receive(orderId, mine);
        if (res?.ok) parts.push(`${draft ? 'nacrt' : 'narudžba'} ${order.Order_Number} (${order.Supplier_Name})${draft ? ' → poslano i primljeno' : ' primljena'}${res.detail && !/cijela/.test(res.detail) ? ` (${res.detail})` : ''}`);
    }

    // Narudžbe nije bilo: napravi je iz sastavnice (po dobavljaču), pa poslano + primljeno.
    const missing = open.filter(r => !covered.has(r.materialId));
    if (missing.length && (left === undefined || left > 0)) {
        const created = await draftOrdersFor(orgId, Array.from(new Set(missing.map(r => r.projectId))), missing.map(r => r.materialId),
            input.orderName || label, 'Napravljeno pri prijemu (Telegram) — narudžbe u ERP-u nije bilo.', async path => onCreated(path));
        for (const d of created) {
            const sent = await sendOrder(orgId, d.orderId, before, { assumed: true });
            if (!sent.ok) { parts.push(sent.error); continue; }
            assumed.push({ orderId: d.orderId, orderNumber: d.orderNumber });
            const items = await byIds<OrderItem>(orgId, 'order_items', 'Order_ID', [d.orderId]);
            const res = await receive(d.orderId, items);
            if (res?.ok) parts.push(`narudžbe nije bilo — napravljena ${d.orderNumber} (${d.supplier}) i primljena`);
        }
        // Ništa za naručiti (interni dobavljač, već vođeno kao naručeno) → samo „na stanju".
        if (!created.length && await markMaterialsHere(orgId, missing.map(r => r.materialId), before)) parts.push('upisano kao na stanju');
    }
    if (!parts.length) return { ok: false, error: `„${label}": nema ničega za primiti.` };
    const q = input.quantity !== undefined ? `${input.quantity} ` : '';
    return { ok: true, line: `📦 Stiglo: ${q}${label} — ${parts.join('; ')}`, assumed, received };
}

/**
 * Odgovor na „Kad je naručeno?" (dugme uz prijem nacrta): datum slanja prije `days` dana
 * u 9 h — od sad narudžba uči rok isporuke dobavljača. false = narudžba ne postoji.
 */
export async function setOrderSentDaysAgo(orgId: string, orderId: string, days: number, tz: string, now = new Date()): Promise<boolean> {
    const snap = await adminDb().collection('orders').where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).limit(1).get();
    if (snap.empty) return false;
    const day = addDays(toZoned(now, tz).date, -days);
    await snap.docs[0].ref.update({ Sent_At: new Date(zonedToUtcMs(day, 9, 0, tz)).toISOString(), Sent_At_Assumed: false });
    leadCache.delete(orgId);
    return true;
}

/**
 * Dan prijema rečen u poruci: „danas je došao", „jučer stiglo", „prekjučer", „26.10.".
 * null = nije rečeno → bot pita dugmadima (prijem se upisuje kao danas dok se ne odgovori).
 */
export function arrivalDay(text: string, today: string): string | null {
    const t = ` ${foldText(text)} `;
    if (/\bprekjuc?er\w*/.test(t)) return addDays(today, -2);
    if (/\bjuc?er\w*/.test(t)) return addDays(today, -1);
    if (/\b(danas|jutros|maloprije|upravo|sad|sada|evo)\b/.test(t)) return today;
    const said = findDateMentions(text, today).map(m => m.date).find(d => d <= today);
    return said || null;
}

/**
 * Odgovor na „Kad je stiglo?": stavke te narudžbe primljene ovim prijemom (danas)
 * dobiju dan prije `days` dana. false = narudžba ne postoji.
 */
export async function setOrderReceivedDaysAgo(orgId: string, orderId: string, days: number, tz: string, now = new Date()): Promise<boolean> {
    const db = adminDb();
    const items = await db.collection('order_items').where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).get();
    if (items.empty) return false;
    const today = toZoned(now, tz).date;
    const at = new Date(zonedToUtcMs(addDays(today, -days), 10, 0, tz)).toISOString();
    const batch = db.batch();
    items.docs.forEach(d => {
        const i = d.data() as OrderItem;
        if (i.Received_Date && toZoned(i.Received_Date, tz).date === today) batch.update(d.ref, { Received_Date: at });
    });
    await batch.commit();
    leadCache.delete(orgId);
    return true;
}

export type ArrivalResult =
    | { ok: true; line: string }
    | { ok: false; error: string; candidates?: string[] };

/**
 * Materijal koji je stigao, po nazivu (i količini kad je rečena). Traži se u
 * kapijama naloga u toku (redovi koji nisu tu), pa u stavkama poslanih
 * narudžbi. Rečena količina manja od ostatka = djelimičan prijem narudžbe.
 */
export async function receiveByName(
    orgId: string, projectIds: string[] | null, name: string, quantity: number | undefined, before: BeforeHook,
): Promise<ArrivalResult> {
    const score = (label: string) => matchScore(name, [label]);
    const rows = (await gatesForProjects(orgId, projectIds)).flatMap(g => g.gates.flatMap(x => x.rows))
        .filter(r => !rowIsReady(r))
        .map(r => ({ r, s: score(r.name) }))
        .filter(x => x.s >= 0.7);
    const best = rows.length ? Math.max(...rows.map(x => x.s)) : 0;
    const top = rows.filter(x => x.s >= best - 0.05);
    const names = Array.from(new Set(top.map(x => x.r.name)));
    if (names.length > 1) return { ok: false, error: `„${name}" odgovara za više materijala — pitaj koji.`, candidates: names.slice(0, 6) };

    const materialIds = Array.from(new Set(top.flatMap(x => x.r.materialIds)));
    const ordersSnap = await adminDb().collection('orders').where('Organization_ID', '==', orgId).where('Status', '==', 'Poslano').get();
    const sent = ordersSnap.docs.map(d => d.data() as Order);
    const items = sent.length ? await byIds<OrderItem>(orgId, 'order_items', 'Order_ID', sent.map(o => o.Order_ID)) : [];
    const open = items.filter(i => i.Status !== 'Primljeno' && (!projectIds || projectIds.includes(i.Project_ID)));
    // U narudžbi: stavke koje pokrivaju te materijale; bez kapije — po nazivu stavke.
    const hit = materialIds.length
        ? open.filter(i => Object.keys(orderItemAllocations(i)).some(id => materialIds.includes(id)))
        : open.filter(i => score(i.Material_Name) >= 0.7);
    const label = names[0] || hit[0]?.Material_Name;
    if (!label) return { ok: false, error: `Nema otvorenog materijala „${name}"${projectIds ? ' za taj projekat' : ''} — ni u kapijama ni u poslanim narudžbama.` };

    if (hit.length) {
        let left = quantity;
        const byOrder = new Map<string, Record<string, number>>();
        for (const i of hit) {
            const rest = Math.max(0, roundQty((i.Quantity || 0) - (i.Received_Quantity || 0)));
            const take = left === undefined ? rest : Math.min(rest, left);
            if (take <= 0) continue;
            byOrder.set(i.Order_ID, { ...(byOrder.get(i.Order_ID) || {}), [i.ID]: take });
            if (left !== undefined) left = roundQty(left - take);
        }
        const parts: string[] = [];
        for (const [orderId, qty] of Array.from(byOrder.entries())) {
            const res = await receiveOrderItems(orgId, orderId, Object.keys(qty), before, qty);
            if (res.ok) parts.push(`${res.orderNumber}${res.detail ? ` (${res.detail})` : ''}`);
        }
        if (parts.length) {
            const q = quantity !== undefined ? `${quantity} ` : '';
            return { ok: true, line: `📦 Stiglo: ${q}${label} — narudžba ${parts.join(', ')}` };
        }
    }
    if (!materialIds.length) return { ok: false, error: `„${label}" nije u poslanoj narudžbi ni u kapijama naloga.` };
    // Nije naručeno preko ERP-a (zaliha, kupljeno usput) → na stanju.
    await markMaterialsHere(orgId, materialIds, before);
    return { ok: true, line: `✔ Tu je: ${label} (na stanju)` };
}

/** Kratak pregled kapija za model: šta je tu, šta se čeka, šta fali. */
export function gatesText(list: WorkOrderGates[]): string[] {
    const out: string[] = [];
    for (const g of list) {
        const open = g.gates.filter(x => x.status !== 'done' && x.rows.length);
        if (!open.length) continue;
        out.push(`${g.label}:`);
        for (const gate of open.slice(0, 6)) {
            const when = gate.status === 'active' ? 'u toku' : gate.distance === 0 ? 'na redu' : gate.distance != null ? `za ${gate.distance} koraka` : 'kasnije';
            const bits = gate.rows.map(r => `${r.state === 'here' ? '✔' : r.state === 'ordered' ? '🚚' : r.state === 'partial' ? '◐' : r.state === 'stock' ? '📦' : '✖'} ${rowLabel(r)}`);
            out.push(`  ${gate.process} (${when}): ${bits.join('; ')}`);
        }
    }
    return out;
}
