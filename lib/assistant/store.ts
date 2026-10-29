// ════════════════════════════════════════════════════════════════════
// ASISTENT — upisi i čitanja (Admin SDK, samo server).
//
// Kolekcije:
//   assistant_links/{telegramUserId}   ko je taj Telegram korisnik u ERP-u
//   assistant_link_codes/{KOD}         jednokratni kod iz Postavki (10 min)
//   assistant_updates/{update_id}      zaštita od dvostruke obrade (Telegram
//                                      ponavlja webhook kad odgovor kasni)
//   assistant_sessions/{chatId}        kratka istorija razgovora + otvoreno pitanje
//   assistant_entries/{Entry_ID}       sirovi dnevnik — sve što je stiglo
//   assistant_ops/{opId}               „prije" snimak svake izmjene, za ↩️ Poništi
//   memory_items/{Item_ID}             bilježnica (stanje stvari)
//
// Organizacija i korisnik uvijek dolaze iz `assistant_links`, nikad iz
// poruke — isto pravilo kao `requireUser` za API rute.
// ════════════════════════════════════════════════════════════════════

import { randomInt } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { AssistantEntry, AssistantOutcome, MemoryItem } from '@/lib/types';

const LINK_CODE_TTL_MS = 10 * 60_000;
const HISTORY_TURNS = 12;

// ─── Veza Telegram ↔ ERP korisnik ─────────────────────────────────────

export interface AssistantLink {
    telegramUserId: number;
    chatId: number;
    uid: string;
    orgId: string;
    telegramName: string;
    linkedAt: string;
    /** Zadnji dan (lokalno) kad je poslan jutarnji pregled. */
    digestDate?: string;
    /** Zadnji dan (lokalno) kad je poslan večernji prijedlog rada. */
    proposalDate?: string;
}

export async function getLinkByTelegramId(telegramUserId: number): Promise<AssistantLink | null> {
    const snap = await adminDb().collection(COLLECTIONS.ASSISTANT_LINKS).doc(String(telegramUserId)).get();
    return snap.exists ? (snap.data() as AssistantLink) : null;
}

export async function getLinkByUid(uid: string): Promise<AssistantLink | null> {
    const snap = await adminDb().collection(COLLECTIONS.ASSISTANT_LINKS).where('uid', '==', uid).limit(1).get();
    return snap.empty ? null : (snap.docs[0].data() as AssistantLink);
}

export async function listLinks(): Promise<AssistantLink[]> {
    const snap = await adminDb().collection(COLLECTIONS.ASSISTANT_LINKS).get();
    return snap.docs.map(d => d.data() as AssistantLink);
}

export async function setDigestDate(telegramUserId: number, date: string): Promise<void> {
    await adminDb().collection(COLLECTIONS.ASSISTANT_LINKS).doc(String(telegramUserId)).update({ digestDate: date });
}

export async function setProposalDate(telegramUserId: number, date: string): Promise<void> {
    await adminDb().collection(COLLECTIONS.ASSISTANT_LINKS).doc(String(telegramUserId)).update({ proposalDate: date });
}

// Bez 0/O/1/I — kod se prekucava s ekrana.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export async function createLinkCode(uid: string, orgId: string): Promise<{ code: string; expiresAt: string }> {
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
    await adminDb().collection(COLLECTIONS.ASSISTANT_LINK_CODES).doc(code).set({ uid, orgId, expiresAt });
    return { code, expiresAt };
}

/**
 * Iskoristi kod iz Postavki. Jedan ERP korisnik = jedan Telegram nalog:
 * stara veza istog korisnika se briše (novi telefon zamjenjuje stari).
 */
export async function consumeLinkCode(
    rawCode: string,
    telegram: { id: number; name: string; chatId: number }
): Promise<AssistantLink | null> {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return null;
    const db = adminDb();
    const codeRef = db.collection(COLLECTIONS.ASSISTANT_LINK_CODES).doc(code);

    return db.runTransaction(async tx => {
        const snap = await tx.get(codeRef);
        const data = snap.data() as { uid: string; orgId: string; expiresAt: string } | undefined;
        if (!data || Date.parse(data.expiresAt) < Date.now()) return null;

        const old = await tx.get(db.collection(COLLECTIONS.ASSISTANT_LINKS).where('uid', '==', data.uid));
        old.docs.forEach(d => { if (d.id !== String(telegram.id)) tx.delete(d.ref); });

        const link: AssistantLink = {
            telegramUserId: telegram.id,
            chatId: telegram.chatId,
            uid: data.uid,
            orgId: data.orgId,
            telegramName: telegram.name,
            linkedAt: new Date().toISOString(),
        };
        tx.set(db.collection(COLLECTIONS.ASSISTANT_LINKS).doc(String(telegram.id)), link);
        tx.delete(codeRef);
        return link;
    });
}

export async function unlinkUid(uid: string): Promise<void> {
    const snap = await adminDb().collection(COLLECTIONS.ASSISTANT_LINKS).where('uid', '==', uid).get();
    await Promise.all(snap.docs.map(d => d.ref.delete()));
}

// ─── Dvostruka obrada ─────────────────────────────────────────────────

/**
 * true = ovaj update se obrađuje prvi put. `create()` je atomičan: drugi
 * pokušaj s istim ID-jem pada s ALREADY_EXISTS (gRPC 6).
 */
export async function claimUpdate(updateId: number): Promise<boolean> {
    try {
        await adminDb().collection(COLLECTIONS.ASSISTANT_UPDATES).doc(String(updateId)).create({
            at: new Date().toISOString(),
        });
        return true;
    } catch (e: any) {
        if (e?.code === 6 || /already exists/i.test(String(e?.message))) return false;
        throw e;
    }
}

// ─── Sesija razgovora ─────────────────────────────────────────────────

export interface SessionTurn {
    role: 'user' | 'model';
    text: string;
    at: string;
}

export interface PendingQuestion {
    question: string;
    options: string[];
    askedAt: string;
    /** Unos koji je pokrenuo pitanje — zadatak nastao iz odgovora veže se za njega. */
    entryId?: string;
    /** ERP-ovo pitanje: za svako dugme gotov poziv alata (`act:<i>` ga izvrši bez modela). */
    action?: PendingAction;
}

export interface PendingAction {
    tool: string;
    /** Argumenti alata po opciji, istim redom kao `options`. */
    args: Record<string, unknown>[];
    /** Šta je korisnik rekao — upis i dalje smije sadržati samo to (grounding). */
    groundText: string;
    dateText: string;
}

/**
 * Oznake iz rezultata alata (O#, K#, S#, R#). Istorija razgovora je samo tekst,
 * pa bi se bez ovoga gubile čim bot nešto pita: „koje baglame?" → „ravne".
 * Žive koliko i istorija; vrijednosti su ono što alati razrješavaju.
 */
export interface SessionRefs {
    at: string;
    orderGroups?: unknown[];
    catalogHits?: unknown[];
    searchHits?: unknown[];
    diaryCandidates?: unknown[];
    /** Riječi za koje je ERP ponudio izbor — odgovor se zapamti u rječnik. */
    pendingVocab?: unknown[];
}

/** Šta je u fokusu razgovora — „u tom stanu", „na istom hodniku" znače ovo. Vodi ga ERP, ne model. */
export interface SessionFocus {
    location?: string;
    at: string;
}

export interface AssistantSession {
    history: SessionTurn[];
    pending?: PendingQuestion | null;
    refs?: SessionRefs | null;
    focus?: SessionFocus | null;
}

export async function getSession(chatId: number): Promise<AssistantSession> {
    const snap = await adminDb().collection(COLLECTIONS.ASSISTANT_SESSIONS).doc(String(chatId)).get();
    const data = snap.data() as Partial<AssistantSession> | undefined;
    return { history: Array.isArray(data?.history) ? data!.history : [], pending: data?.pending || null, refs: data?.refs || null, focus: data?.focus || null };
}

export async function saveSession(chatId: number, session: AssistantSession): Promise<void> {
    await adminDb().collection(COLLECTIONS.ASSISTANT_SESSIONS).doc(String(chatId)).set({
        history: session.history.slice(-HISTORY_TURNS),
        // JSON: argumenti ERP-ovog pitanja smiju imati undefined, Firestore ga ne prima.
        pending: session.pending ? JSON.parse(JSON.stringify(session.pending)) : null,
        refs: session.refs ? JSON.parse(JSON.stringify(session.refs)) : null,
        focus: session.focus || null,
        updatedAt: new Date().toISOString(),
    });
}

// ─── Dnevnik ──────────────────────────────────────────────────────────

export async function addEntry(input: Omit<AssistantEntry, 'Entry_ID' | 'Created_At'>): Promise<string> {
    const id = uuidv4();
    const entry: AssistantEntry = { ...input, Entry_ID: id, Created_At: new Date().toISOString() };
    Object.keys(entry).forEach(k => { if ((entry as any)[k] === undefined) delete (entry as any)[k]; });
    await adminDb().collection(COLLECTIONS.ASSISTANT_ENTRIES).doc(id).set(entry);
    return id;
}

/** Ishod obrade poruke u dnevnik — da se vidi šta je bot stvarno uradio. Greška ne ruši odgovor. */
export async function recordEntryOutcome(entryId: string, input: {
    outcome: AssistantOutcome; reply: string; changes: string[]; taskIds: string[]; memoryIds: string[]; turnId?: string;
}): Promise<void> {
    try {
        const ref = adminDb().collection(COLLECTIONS.ASSISTANT_ENTRIES).doc(entryId);
        const prev = (await ref.get()).data() as AssistantEntry | undefined;
        if (!prev) return;
        await ref.update({
            Outcome: input.outcome,
            Reply_Text: input.reply.slice(0, 2000),
            Changes: input.changes.slice(0, 40),
            Processed_At: new Date().toISOString(),
            Attempts: (prev.Attempts || 0) + 1,
            ...(input.turnId ? { Turn_ID: input.turnId } : {}),
            ...(input.taskIds.length ? { Task_IDs: Array.from(new Set([...(prev.Task_IDs || []), ...input.taskIds])) } : {}),
            ...(input.memoryIds.length ? { Memory_IDs: Array.from(new Set([...(prev.Memory_IDs || []), ...input.memoryIds])) } : {}),
        });
    } catch (e) {
        console.warn('[assistant] ishod unosa nije zapisan:', entryId, e);
    }
}

export async function getEntry(entryId: string): Promise<AssistantEntry | null> {
    const snap = await adminDb().collection(COLLECTIONS.ASSISTANT_ENTRIES).doc(entryId).get();
    return snap.exists ? (snap.data() as AssistantEntry) : null;
}

/** Veza unos → nastali zadaci/stavke. Knjigovodstvo: greška ovdje ne smije srušiti odgovor. */
export async function attachEntryResults(entryId: string, taskIds: string[], memoryIds: string[]): Promise<void> {
    if (!taskIds.length && !memoryIds.length) return;
    try {
        await adminDb().collection(COLLECTIONS.ASSISTANT_ENTRIES).doc(entryId).update({
            ...(taskIds.length ? { Task_IDs: taskIds } : {}),
            ...(memoryIds.length ? { Memory_IDs: memoryIds } : {}),
        });
    } catch (e) {
        console.warn('[assistant] unos nije povezan s rezultatima:', entryId, e);
    }
}

/** Unosi korisnika od datuma (za pretragu po starim porukama). */
export async function listEntriesSince(orgId: string, uid: string, sinceIso: string): Promise<AssistantEntry[]> {
    const snap = await adminDb().collection(COLLECTIONS.ASSISTANT_ENTRIES)
        .where('Owner_UID', '==', uid)
        .get();
    return snap.docs
        .map(d => d.data() as AssistantEntry)
        .filter(e => e.Organization_ID === orgId && e.Created_At >= sinceIso)
        .sort((a, b) => b.Created_At.localeCompare(a.Created_At));
}

// ─── Bilježnica ───────────────────────────────────────────────────────

export function memoryRef(itemId: string) {
    return adminDb().collection(COLLECTIONS.MEMORY_ITEMS).doc(itemId);
}

export async function listMemory(orgId: string, uid: string, includeResolved = false): Promise<MemoryItem[]> {
    const snap = await adminDb().collection(COLLECTIONS.MEMORY_ITEMS)
        .where('Owner_UID', '==', uid)
        .get();
    return snap.docs
        .map(d => d.data() as MemoryItem)
        .filter(m => m.Organization_ID === orgId && (includeResolved || m.State === 'open'))
        .sort((a, b) => a.Created_At.localeCompare(b.Created_At));
}

export async function getMemory(orgId: string, uid: string, itemId: string): Promise<MemoryItem | null> {
    const snap = await memoryRef(itemId).get();
    const m = snap.data() as MemoryItem | undefined;
    return m && m.Organization_ID === orgId && m.Owner_UID === uid ? m : null;
}

// ─── Poništavanje ─────────────────────────────────────────────────────

/**
 * Svaka izmjena koju asistent napravi bilježi dokument PRIJE izmjene
 * (`before: null` = dokument je tek nastao). Dugme ↩️ Poništi vraća sve
 * izmjene jednog odgovora (`turnId`), obrnutim redom.
 */
export async function recordOp(input: {
    turnId: string;
    uid: string;
    orgId: string;
    path: string;
    before: Record<string, unknown> | null;
    label: string;
}): Promise<void> {
    await adminDb().collection(COLLECTIONS.ASSISTANT_OPS).add({ ...input, at: new Date().toISOString() });
}

export async function undoTurn(turnId: string, uid: string): Promise<string[]> {
    const db = adminDb();
    const snap = await db.collection(COLLECTIONS.ASSISTANT_OPS).where('turnId', '==', turnId).get();
    const ops = snap.docs
        .map(d => ({ ref: d.ref, ...(d.data() as { uid: string; path: string; before: Record<string, unknown> | null; label: string; at: string; undone?: boolean }) }))
        .filter(o => o.uid === uid && !o.undone)
        .sort((a, b) => b.at.localeCompare(a.at));

    // Narudžba koja je u međuvremenu poslana već je pomjerila količine na
    // materijalima — brisanje bi ih ostavilo naduvane. Ona se ne poništava.
    const sent = new Set<string>();
    for (const op of ops) {
        if (op.before || !op.path.startsWith('orders/')) continue;
        const order = (await db.doc(op.path).get()).data() as { Order_ID?: string; Status?: string } | undefined;
        if (order?.Order_ID && order.Status !== 'Nacrt') sent.add(order.Order_ID);
    }

    // Ista poruka je možda mijenjala i sastavnicu (višak, novi materijal) — ni
    // ona se ne vraća, inače naručena količina ne bi imala pokriće u sastavnici.
    if (sent.size) {
        const orderLabels = ops.filter(o => !o.before && o.path.startsWith('orders/')).map(o => o.label);
        return Array.from(new Set(orderLabels)).map(l => `ništa — ${l} je već poslana; vrati je u nacrt u ERP-u`);
    }

    const labels: string[] = [];
    for (const op of ops) {
        const target = db.doc(op.path);
        if (op.before) await target.set(op.before);
        else await target.delete();
        await op.ref.update({ undone: true });
        labels.push(op.label);
    }
    return Array.from(new Set(labels));
}
