// ════════════════════════════════════════════════════════════════════
// TERMINI (10:30 i 14:30) — podaci, slanje i upisi (Admin SDK)
//
// assistant_slots/{id}: stanje jedne poruke-spiska (lib/assistant/slots.ts).
// Dugme `sl:<id>:<radnja>` mijenja stanje i ISTU poruku; upisi idu kroz
// postojeće puteve (createQuickOrder, setProgress, bookDayAsProposed) i svaki
// se može poništiti („↩️ Poništi zadnje"). Bez modela.
// Plan: docs/bot/plan-ritam-dana.md
// ════════════════════════════════════════════════════════════════════

import { adminDb } from '@/lib/server/firebaseAdmin';
import { attachItems, getBookableWorkOrders, getItemsForWorkOrders, getWorkLogsInRange } from '@/lib/server/fieldRepo';
import { createBotWorkOrder } from '@/lib/server/fieldWorkOrders';
import { createQuickOrder, listOrders } from '@/lib/server/orderWrites';
import { setProgress } from '@/lib/server/workDiary';
import { buildOrderFlowRows } from '@/lib/orderProcessRows';
import { addDays } from '@/lib/voice/dates';
import { sendMessage, type ButtonRows } from '@/lib/telegram/api';
import type { Order, Project, Supplier, WorkOrder } from '@/lib/types';
import { toZoned } from './datetime';
import { bookDayAsProposed, createProposalMessage, dayProposalSize, isWorkingDayFor } from './dayProposals';
import {
    newSlotState, orderLine, plural, roundOptions, slotDone, slotDue, slotReopen, slotTap, slotText, slotUndo, slotView,
    type DayData, type OrdersData, type Pick, type RoundData, type SlotEffect, type SlotItem, type SlotKind, type SlotState,
} from './slots';
import { listLinks, noteBotMessage, recordOp, setSlotSent, undoTurn, type AssistantLink } from './store';

const COL = 'assistant_slots';
const DAY = 86_400_000;
/** Javljena narudžba se poslije ovoliko dana pita „je li stiglo?". */
const WAIT_DAYS = 7;
const AWAIT_MINUTES = 15;
const MAX_ROUND = 5;

interface StoredSlot {
    Slot_ID: string;
    Organization_ID: string;
    Owner_UID: string;
    Chat_ID: number;
    Message_ID?: number;
    State: SlotState;
    Awaiting: boolean;
    Created_At: string;
    Updated_At: string;
}

export interface SlotReply { text: string; buttons?: ButtonRows; toast?: string }

function reply(id: string, state: SlotState, toast?: string): SlotReply {
    const v = slotView(state);
    return { text: v.text, buttons: v.buttons.map(r => r.map(b => ({ text: b.text, data: `sl:${id}:${b.action}:${state.taps}` }))), ...(toast ? { toast } : {}) };
}

// ─── Podaci za stavke ─────────────────────────────────────────────────

const short = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const projectName = (p: Project) => short((p.Name || p.Client_Name || 'Projekat').trim());

async function ordersData(orgId: string, now: Date, orders: WorkOrder[], logs: { Work_Order_ID?: string }[]): Promise<OrdersData> {
    const db = adminDb();
    const [supSnap, projSnap, all] = await Promise.all([
        db.collection('suppliers').where('Organization_ID', '==', orgId).get(),
        db.collection('projects').where('Organization_ID', '==', orgId).get(),
        listOrders(orgId),
    ]);
    // Dobavljači po tome koliko se od njih naručivalo u zadnjih pola godine.
    const since = new Date(now.getTime() - 180 * DAY).toISOString();
    const used = new Map<string, number>();
    all.filter(o => String(o.Order_Date) >= since).forEach(o => used.set(o.Supplier_ID, (used.get(o.Supplier_ID) || 0) + 1));
    const suppliers = supSnap.docs.map(d => d.data() as Supplier)
        .filter(s => s.Name && s.Name !== 'Interni' && !s.Name.startsWith('#'))
        .sort((a, b) => (used.get(b.Supplier_ID) || 0) - (used.get(a.Supplier_ID) || 0) || a.Name.localeCompare(b.Name, 'bs'))
        .map(s => ({ id: s.Supplier_ID, name: short(s.Name, 22) }));

    // Projekti po radu u zadnjih 10 dana; bez rada → projekti u proizvodnji.
    const projects = projSnap.docs.map(d => d.data() as Project);
    const orderById = new Map(orders.map(o => [o.Work_Order_ID, o]));
    const work = new Map<string, number>();
    const jobWork = new Map<string, number>();
    for (const l of logs) {
        const o = l.Work_Order_ID ? orderById.get(l.Work_Order_ID) : undefined;
        if (!o) continue;
        const pids = new Set((o.items || []).map(i => i.Project_ID).filter(Boolean));
        if (!pids.size) jobWork.set(o.Work_Order_ID, (jobWork.get(o.Work_Order_ID) || 0) + 1);
        pids.forEach(pid => work.set(pid, (work.get(pid) || 0) + 1));
    }
    const ranked = projects.filter(p => work.has(p.Project_ID)).sort((a, b) => work.get(b.Project_ID)! - work.get(a.Project_ID)!);
    const fallback = projects.filter(p => p.Status === 'U proizvodnji' && !work.has(p.Project_ID));
    const projectPicks = [...ranked, ...fallback].slice(0, 4).map(p => ({ id: p.Project_ID, name: projectName(p) }));

    // Poslovi bez projekta: otvoreni nalozi čije stavke nemaju projekat.
    const jobs = orders
        .filter(o => o.Status !== 'Završeno' && o.Status !== 'Otkazano' && !(o.items || []).some(i => i.Project_ID))
        .sort((a, b) => (jobWork.get(b.Work_Order_ID) || 0) - (jobWork.get(a.Work_Order_ID) || 0) || String(b.Created_Date).localeCompare(String(a.Created_Date)))
        .slice(0, 4)
        .map(o => ({ id: o.Work_Order_ID, name: short(o.Name || o.Work_Order_Number || 'Posao') }));

    const waitBefore = new Date(now.getTime() - WAIT_DAYS * DAY).toISOString();
    const waiting = all
        .filter(o => o.Quick && o.Status === 'Poslano' && String(o.Sent_At || o.Order_Date) <= waitBefore)
        .sort((a, b) => String(a.Sent_At).localeCompare(String(b.Sent_At)))
        .slice(0, 2)
        .map(o => ({ orderId: o.Order_ID, label: short(`${o.Supplier_Name} · ${o.Quick_Target?.Name || o.Name || ''}`, 40) }));

    return { suppliers: suppliers.slice(0, 3), moreSuppliers: suppliers.slice(3, 9), projects: projectPicks, jobs, waiting };
}

/** Nalozi na kojima se radilo jučer ili danas, a tok im ima korak na redu. */
function roundData(orders: WorkOrder[], logs: { Work_Order_ID?: string; Date?: string }[], since: string): RoundData {
    const count = new Map<string, number>();
    logs.filter(l => String(l.Date || '').slice(0, 10) >= since && l.Work_Order_ID)
        .forEach(l => count.set(l.Work_Order_ID!, (count.get(l.Work_Order_ID!) || 0) + 1));
    const out: RoundData['orders'] = [];
    for (const o of orders.filter(x => count.has(x.Work_Order_ID) && x.Status !== 'Završeno').sort((a, b) => count.get(b.Work_Order_ID)! - count.get(a.Work_Order_ID)!)) {
        const items = (o.items || []).filter(i => i.Item_Type !== 'custom');
        if (!items.length) continue;
        const rows = buildOrderFlowRows(items, o.Process_Graph).map(r => ({
            name: r.name, state: r.state as 'done' | 'active' | 'blocked', done: r.done, total: r.total,
            inProgress: r.perItem.filter(p => p.status === 'U toku').length,
        }));
        const { last, options } = roundOptions(rows);
        if (!options.length) continue;
        out.push({ id: o.Work_Order_ID, name: short(o.Name || o.Work_Order_Number || 'Nalog', 34), last, options });
        if (out.length === MAX_ROUND) break;
    }
    return { orders: out };
}

async function dayData(orgId: string, date: string, label: string): Promise<DayData | null> {
    const size = await dayProposalSize(orgId, date);
    return size ? { date, label, ...size } : null;
}

/** Stavke termina: 10:30 = Narudžbe, Obilazak (+ jučerašnji upis dana ako je ostao); 14:30 = Upis dana, Obilazak, Narudžbe. */
export async function buildSlotItems(orgId: string, kind: SlotKind, date: string, now: Date, carryDay?: string): Promise<SlotItem[]> {
    const orders = await getBookableWorkOrders(orgId);
    attachItems(orders, await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID)));
    const logs = await getWorkLogsInRange(orgId, addDays(date, -10), date);
    const [od, day] = await Promise.all([
        ordersData(orgId, now, orders, logs),
        kind === 'b' ? dayData(orgId, date, 'danas') : carryDay ? dayData(orgId, carryDay, 'jučer') : Promise.resolve(null),
    ]);
    const round = roundData(orders, logs, addDays(date, -1));
    const items: SlotItem[] = [];
    const push = (it: SlotItem | null) => { if (it) items.push(it); };
    const dayItem: SlotItem | null = day ? { id: 'day', data: day, done: [] } : null;
    const roundItem: SlotItem | null = round.orders.length ? { id: 'round', data: round, done: [] } : null;
    const ordersItem: SlotItem = { id: 'orders', data: od, done: [] };
    if (kind === 'b') { push(dayItem); push(roundItem); push(ordersItem); }
    else { push(ordersItem); push(roundItem); push(dayItem); }
    return items;
}

// ─── Slanje ───────────────────────────────────────────────────────────

/** Šalje termin koji je na redu, jednom po danu i terminu. Vikendom samo ako se radi. */
export async function sendSlots(now: Date, tz: string): Promise<number> {
    const local = toZoned(now, tz);
    const kind = slotDue(local.hour * 60 + local.minute);
    if (!kind) return 0;
    let sent = 0;
    for (const link of await listLinks()) {
        if (link.slotDates?.[kind] === local.date) continue;
        const slotDates = { ...(link.slotDates || {}), [kind]: local.date };
        // Datum prvo: greška niže ne smije slati istu poruku svake minute.
        await setSlotSent(link.telegramUserId, { slotDates });
        try {
            if (!(await isWorkingDayFor(link.orgId, local.date))) continue;
            const prev = link.lastSlotId ? ((await adminDb().collection(COL).doc(link.lastSlotId).get()).data() as StoredSlot | undefined) : undefined;
            const missed = prev && prev.State.taps === 0 ? (link.slotMisses || 0) + 1 : 0;
            // Jučerašnji upis dana koji je ostao neodgovoren dolazi još jednom, ujutro.
            const prevDay = prev?.State.kind === 'b' ? prev.State.items.find(i => i.id === 'day') : undefined;
            const carry = kind === 'a' && prevDay && !prevDay.closed && prev!.State.date < local.date && prev!.State.date >= addDays(local.date, -3)
                ? prev!.State.date : undefined;
            const items = await buildSlotItems(link.orgId, kind, local.date, now, carry);
            const note = missed >= 3 ? 'Tri termina bez odgovora. Ako ti vrijeme ili oblik ne odgovara, napiši mi.' : undefined;
            const state = newSlotState(kind, local.date, items, note);
            const ref = adminDb().collection(COL).doc();
            const view = reply(ref.id, state);
            const msg = await sendMessage(link.chatId, view.text, view.buttons);
            const at = now.toISOString();
            const doc: StoredSlot = {
                Slot_ID: ref.id, Organization_ID: link.orgId, Owner_UID: link.uid, Chat_ID: link.chatId,
                ...(msg?.message_id ? { Message_ID: msg.message_id } : {}),
                State: state, Awaiting: false, Created_At: at, Updated_At: at,
            };
            await ref.set(doc);
            await setSlotSent(link.telegramUserId, { slotDates, lastSlotId: ref.id, slotMisses: missed >= 3 ? 0 : missed });
            await noteBotMessage(link.chatId, `termin ${kind === 'a' ? '10:30' : '14:30'}`, view.text, now);
            sent++;
        } catch (e) {
            console.error('[slots] termin nije poslan:', e);
        }
    }
    return sent;
}

// ─── Upisi ────────────────────────────────────────────────────────────

interface Ran { ok: boolean; line?: string; turnId?: string; close?: boolean; error?: string; extra?: { text: string; buttons?: ButtonRows } }

async function runEffect(link: AssistantLink, slotId: string, state: SlotState, effect: SlotEffect, now: Date, tz: string): Promise<Ran> {
    const today = toZoned(now, tz).date;
    // Broj dodira je jedinstven po upisu u terminu (dva upisa u istoj milisekundi ne dijele Poništi).
    const turnId = `sl-${slotId}-${state.taps}`;
    const op = (path: string, before: Record<string, unknown> | null, label: string) =>
        recordOp({ turnId, uid: link.uid, orgId: link.orgId, path, before, label });

    if (effect.type === 'order') {
        let target = effect.target;
        if (target.kind === 'newjob') {
            // „Novi posao": kratak nalog bez projekta, isti kakav bot pravi na „napravi nalog …".
            const made = await createBotWorkOrder(link.orgId, { name: target.name });
            await Promise.all(made.paths.map(p => op(p, null, `nalog „${target.name}"`)));
            target = { kind: 'job', id: made.workOrderId, name: target.name };
        }
        const created = await createQuickOrder(link.orgId, {
            supplierId: effect.supplier.id, supplierName: effect.supplier.name, at: now,
            target: { Kind: target.kind as NonNullable<Order['Quick_Target']>['Kind'], Name: target.name, ...('id' in target ? { ID: target.id } : {}) },
        });
        const line = orderLine(effect.supplier.name, target);
        await Promise.all(created.paths.map(p => op(p, null, line)));
        return { ok: true, line, turnId, close: true };
    }

    if (effect.type === 'arrived') {
        const snap = await adminDb().collection('orders').where('Organization_ID', '==', link.orgId).where('Order_ID', '==', effect.orderId).limit(1).get();
        if (snap.empty) return { ok: false, error: 'Narudžba više ne postoji.' };
        const doc = snap.docs[0];
        await op(doc.ref.path, doc.data() as Record<string, unknown>, `stiglo: ${effect.label}`);
        await doc.ref.update({ Status: 'Primljeno', Received_Date: now.toISOString() });
        return { ok: true, line: `Stiglo: ${effect.label}`, turnId };
    }

    if (effect.type === 'progress') {
        const befores = new Map<string, Record<string, unknown> | null>();
        const res = await setProgress(link.orgId, {
            workOrderIds: [effect.orderId], process: effect.process, exactProcess: true, state: effect.state, today,
        }, (path, data) => { if (!befores.has(path)) befores.set(path, data); });
        if (!res.ok) return { ok: false, error: res.error };
        await Promise.all(Array.from(befores.entries()).map(([path, before]) => op(path, before, `${effect.orderName}: ${effect.process}`)));
        // Red se piše tek na kraju obilaska (slots.finishRound); ovdje samo trag za Poništi.
        return { ok: true, turnId: befores.size ? turnId : undefined };
    }

    if (effect.type === 'day_same') {
        const res = await bookDayAsProposed(link, effect.date, today);
        if (!res.ok) return { ok: false, error: res.error };
        const who = `${res.workers} ${plural(res.workers, 'radnik', 'radnika', 'radnika')}`;
        return { ok: true, line: `Dan upisan (${effect.label}): ${who}`, turnId: res.turnId, close: true };
    }

    // day_list: stari prijedlog s kvačicama, kao posebna poruka.
    const msg = await createProposalMessage(link, effect.date, today);
    return msg ? { ok: true, extra: { text: msg.text, buttons: msg.buttons } } : { ok: false, error: 'Nema šta predložiti za taj dan.' };
}

async function load(link: AssistantLink, slotId: string): Promise<{ ref: FirebaseFirestore.DocumentReference; slot: StoredSlot } | null> {
    const ref = adminDb().collection(COL).doc(slotId);
    const slot = (await ref.get()).data() as StoredSlot | undefined;
    if (!slot || slot.Owner_UID !== link.uid || slot.Organization_ID !== link.orgId) return null;
    return { ref, slot };
}

async function save(ref: FirebaseFirestore.DocumentReference, state: SlotState, now: Date): Promise<void> {
    await ref.update({ State: JSON.parse(JSON.stringify(state)), Awaiting: !!state.awaiting, Updated_At: now.toISOString() });
}

/** Stanje poslije dodira + upis koji je dodir tražio. Neuspio upis vraća stavku na spisak. */
async function settle(link: AssistantLink, slotId: string, tapped: { state: SlotState; effect?: SlotEffect; toast?: string }, now: Date, tz: string): Promise<{ state: SlotState; toast?: string; extra?: Ran['extra'] }> {
    let state = tapped.state;
    if (!tapped.effect) return { state, toast: tapped.toast };
    const effect = tapped.effect;
    const item = effect.type === 'order' || effect.type === 'arrived' ? 'orders' : effect.type === 'progress' ? 'round' : 'day';
    let ran: Ran;
    try {
        ran = await runEffect(link, slotId, state, effect, now, tz);
    } catch (e) {
        console.error('[slots] upis pao:', e);
        ran = { ok: false, error: 'Upis nije prošao — pokušaj ponovo.' };
    }
    if (!ran.ok) {
        // Obilazak ide dalje i kad jedan nalog ne prođe; narudžba i dan se vraćaju na spisak.
        if (item !== 'round') state = slotReopen(state, item);
        return { state, toast: (ran.error || 'Upis nije prošao.').slice(0, 190) };
    }
    if (ran.line) state = slotDone(state, item, ran.line, ran.turnId, ran.close);
    else if (ran.turnId) state = { ...state, undo: [...state.undo, { turnId: ran.turnId, item, line: '' }] };
    return { state, toast: ran.line ? 'Upisano' : undefined, extra: ran.extra };
}

/** Dugme na poruci termina. */
export async function handleSlotButton(link: AssistantLink, slotId: string, action: string, now: Date, tz: string, stamp?: string): Promise<SlotReply & { extra?: Ran['extra'] }> {
    const found = await load(link, slotId);
    if (!found) return { text: '', toast: 'Ovaj termin više ne postoji.' };
    const { ref, slot } = found;
    // Dugme nosi broj dodira u času kad je nacrtano: dupli dodir ili stara poruka ne upisuju ništa.
    if (stamp !== undefined && stamp !== '' && Number(stamp) !== slot.State.taps) return { text: '', toast: 'Već zabilježeno.' };

    if (action === 'u') {
        const u = slotUndo(slot.State);
        if (!u) return { text: '', toast: 'Nema šta poništiti.' };
        // Obilazak: svi upisi istog obilaska idu zajedno (jedan red na spisku).
        const last = slot.State.undo[slot.State.undo.length - 1];
        let state = u.state;
        const turnIds = [u.turnId];
        if (last.item === 'round') {
            turnIds.push(...state.undo.filter(x => x.item === 'round').map(x => x.turnId));
            state = { ...state, undo: state.undo.filter(x => x.item !== 'round') };
        }
        for (const t of turnIds) await undoTurn(t, link.uid);
        await save(ref, state, now);
        return reply(slotId, state, 'Poništeno');
    }

    const tapped = slotTap(slot.State, action);
    if (tapped.state === slot.State) return { text: '', toast: tapped.toast || 'Ovo dugme više ne važi.' };
    const out = await settle(link, slotId, tapped, now, tz);
    await save(ref, out.state, now);
    return { ...reply(slotId, out.state, out.toast), extra: out.extra };
}

/**
 * Rečenica poslije „Novi posao" (Bez projekta): ide terminu, ne modelu.
 * Vraća poruku termina za osvježavanje, ili null kad se ništa ne čeka.
 */
export async function consumeSlotText(link: AssistantLink, text: string, now: Date, tz: string): Promise<(SlotReply & { chatId: number; messageId?: number }) | null> {
    if (!link.lastSlotId || !text.trim()) return null;
    const found = await load(link, link.lastSlotId);
    if (!found || !found.slot.Awaiting) return null;
    const { ref, slot } = found;
    if (now.getTime() - Date.parse(slot.Updated_At) > AWAIT_MINUTES * 60_000) {
        await ref.update({ Awaiting: false });
        return null;
    }
    const tapped = slotText(slot.State, text);
    if (!tapped) return null;
    const out = await settle(link, slot.Slot_ID, tapped, now, tz);
    await save(ref, out.state, now);
    return { ...reply(slot.Slot_ID, out.state, out.toast), chatId: slot.Chat_ID, messageId: slot.Message_ID };
}

export type { Pick };
