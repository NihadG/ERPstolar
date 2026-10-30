// ════════════════════════════════════════════════════════════════════
// NACRT → PREGLED → SLANJE (jedan motor za ERP i Telegram bota)
//
//   createOrderDraft   primalac iz Kontakata (★ glavni kontakt dobavljača;
//                      bez kontakata → adresa dobavljača iz ERP-a), kopija po
//                      Copy_On, naslov/prilog/potpis po obrascu (lib/email/compose)
//   updateDraft        Kome / Kopija / Naslov / Tekst (samo važeće adrese)
//   sendDraft          Gmail → nacrt „sent" → narudžba Nacrt → Poslano
//                      (postojeći sendOrder), nit i adrese na narudžbi,
//                      Last_Emailed_At na kontaktima. Gmail odbije → „failed",
//                      narudžba ostaje kakva je bila.
//   checkBounces       sat (tick): MAILER-DAEMON u niti → upozorenje na Telegram
//
// Mail se ne može poništiti, pa se ništa ne šalje bez izričitog poziva sendDraft.
// ════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { adminDb } from './firebaseAdmin';
import { getEmailAccount, getThreadSenders, GmailError, sendGmail } from './gmail';
import { getOrderWithItems, getSupplier, loadOrderSpecs, sendOrder } from './orderWrites';
import { buildOrderPdf } from './orderPdf';
import { companyOf } from '@/lib/assistant/orderDocuments';
import { getLinkByUid } from '@/lib/assistant/store';
import { sendMessage } from '@/lib/telegram/api';
import {
    attachmentName, companyTag, composeText, defaultSignature, greeting, orderBody, orderSubject, addressFormFor,
} from '@/lib/email/compose';
import { contactFullName, isValidEmail, normalizeEmail, resolveRecipient, splitEmails } from '@/lib/contacts';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { Contact, EmailDraft, EmailDraftAddress, Order, Project } from '@/lib/types';

const drafts = () => adminDb().collection(COLLECTIONS.EMAIL_DRAFTS);

export class DraftError extends Error {
    constructor(message: string, public status = 400) {
        super(message);
        this.name = 'DraftError';
    }
}

export async function loadContacts(orgId: string): Promise<Contact[]> {
    const snap = await adminDb().collection(COLLECTIONS.CONTACTS).where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => d.data() as Contact);
}

const addr = (c: Contact): EmailDraftAddress => {
    const name = contactFullName(c);
    return name !== c.Email ? { name, email: normalizeEmail(c.Email) } : { email: normalizeEmail(c.Email) };
};

async function projectNames(orgId: string, order: Order): Promise<string[]> {
    const ids = Array.from(new Set((order.items || []).map(i => i.Project_ID).filter(Boolean)));
    if (!ids.length) return [];
    const snap = await adminDb().collection(COLLECTIONS.PROJECTS).where('Organization_ID', '==', orgId).get();
    const byId = new Map(snap.docs.map(d => [(d.data() as Project).Project_ID, d.data() as Project]));
    return ids.map(id => byId.get(id)).filter(Boolean).map(p => (p!.Name || p!.Client_Name || '').trim()).filter(Boolean);
}

/** Potpis s Gmail naloga, inače „Srdačno, ime + telefon" iz korisničkog profila. */
async function signatureFor(uid: string, own?: string): Promise<string> {
    if (own?.trim()) return own.trim();
    const snap = await adminDb().collection('users').doc(uid).get();
    const p = (snap.data() || {}) as { Name?: string; Phone?: string };
    return defaultSignature(p.Name || '', p.Phone);
}

export interface DraftView {
    draft: EmailDraft;
    /** Kontakti za izbor primaoca (naziv, adresa, firma). */
    contacts: { name: string; email: string; company?: string }[];
    /** Koliko je ERP bio siguran u primaoca. */
    recipient: 'contact' | 'choose' | 'supplier-email' | 'none';
    orderStatus?: string;
}

function contactOptions(contacts: Contact[], supplierName: (id?: string) => string | undefined) {
    return contacts.filter(c => !c.Receive_Only && isValidEmail(c.Email)).map(c => ({
        name: contactFullName(c), email: normalizeEmail(c.Email), company: supplierName(c.Supplier_ID) || c.Company || undefined,
    }));
}

/** Standardni tekst narudžbe po obraćanju primaoca + rečenica koju je korisnik dodao. */
function orderText(order: Order, contact: Contact | undefined, extra: string): string {
    return [orderBody(order, addressFormFor(contact)), extra].filter(Boolean).join(' ');
}

export async function createOrderDraft(input: {
    orgId: string; uid: string; orderId: string; source: EmailDraft['Source']; now?: Date;
    /** Rečenica koju je korisnik rekao botu („isporuka do petka") — ide iza standardne. */
    extraText?: string;
}): Promise<DraftView> {
    const { orgId, uid, orderId } = input;
    const account = await getEmailAccount(uid);
    if (!account || account.Organization_ID !== orgId) throw new GmailError('not-connected', 'Gmail nije povezan — poveži ga u Postavke → Kontakti.');

    const order = await getOrderWithItems(orgId, orderId);
    if (!order) throw new DraftError('Narudžba više ne postoji.', 404);
    if (!(order.items || []).length) throw new DraftError(`Narudžba ${order.Order_Number} nema stavki.`);

    const [contacts, supplier, projects, company] = await Promise.all([
        loadContacts(orgId), getSupplier(orgId, order.Supplier_ID, order.Supplier_Name), projectNames(orgId, order), companyOf(orgId),
    ]);
    const supplierNames = new Map<string, string>([[order.Supplier_ID, order.Supplier_Name]]);
    const choice = resolveRecipient(contacts, { purpose: 'order', supplierId: order.Supplier_ID });

    let to: EmailDraftAddress[] = [];
    let candidates: EmailDraftAddress[] | undefined;
    let recipient: DraftView['recipient'] = 'none';
    let toContact: Contact | undefined;
    if (choice.status === 'ok') {
        toContact = choice.to;
        to = [addr(choice.to)];
        recipient = 'contact';
    } else if (choice.status === 'choose') {
        candidates = choice.candidates.map(addr);
        recipient = 'choose';
    } else {
        // Bez kontakata: adresa upisana na dobavljaču u ERP-u (nikad izmišljena).
        const fallback = splitEmails(supplier?.Email || '')[0];
        if (fallback) { to = [{ email: fallback }]; recipient = 'supplier-email'; }
    }

    const subject = orderSubject(order, projects, companyTag(company.name || ''));
    const raw = (input.extraText || '').trim();
    const extra = raw && !/[.!?]$/.test(raw) ? `${raw}.` : raw;
    const parts = {
        greeting: greeting(toContact),
        text: orderText(order, toContact, extra),
        signature: await signatureFor(uid, account.Signature),
        auto: true,
        extra,
    };
    const body = composeText({ greeting: parts.greeting, body: parts.text, signature: parts.signature });
    const now = (input.now || new Date()).toISOString();
    const draft: EmailDraft = {
        Draft_ID: randomUUID(),
        Organization_ID: orgId,
        Owner_UID: uid,
        Purpose: 'order',
        Entity_ID: orderId,
        To: to,
        Cc: choice.cc.map(addr),
        ...(candidates ? { Candidates: candidates } : {}),
        Subject: subject,
        Body: body,
        Parts: parts,
        Attachments: [{ kind: 'order', id: orderId, filename: attachmentName(subject) }],
        Status: 'draft',
        Source: input.source,
        Created_At: now,
        Updated_At: now,
    };
    await drafts().doc(draft.Draft_ID).set(draft);
    return { draft, contacts: contactOptions(contacts, id => (id ? supplierNames.get(id) : undefined)), recipient, orderStatus: order.Status };
}

/**
 * Opšti mail osobi iz Kontakata („javi Selmi mailom da kasnimo s lajsnama"):
 * naslov i tekst piše model, pozdrav i potpis ERP. Više mogućih osoba → izbor.
 */
export async function createContactDraft(input: {
    orgId: string; uid: string; recipients: Contact[]; subject: string; text: string; source: EmailDraft['Source']; now?: Date;
}): Promise<EmailDraft> {
    const { orgId, uid } = input;
    const account = await getEmailAccount(uid);
    if (!account || account.Organization_ID !== orgId) throw new GmailError('not-connected', 'Gmail nije povezan — poveži ga u Postavke → Kontakti.');
    if (!input.recipients.length) throw new DraftError('Nema primaoca.');
    const single = input.recipients.length === 1 ? input.recipients[0] : undefined;
    const parts = {
        greeting: greeting(single),
        text: input.text.trim(),
        signature: await signatureFor(uid, account.Signature),
    };
    const now = (input.now || new Date()).toISOString();
    const draft: EmailDraft = {
        Draft_ID: randomUUID(),
        Organization_ID: orgId,
        Owner_UID: uid,
        Purpose: 'general',
        To: single ? [addr(single)] : [],
        Cc: [],
        ...(single ? {} : { Candidates: input.recipients.slice(0, 6).map(addr) }),
        Subject: input.subject.replace(/\s+/g, ' ').trim().slice(0, 200),
        Body: composeText({ greeting: parts.greeting, body: parts.text, signature: parts.signature }),
        Parts: parts,
        Attachments: [],
        Status: 'draft',
        Source: input.source,
        Created_At: now,
        Updated_At: now,
    };
    await drafts().doc(draft.Draft_ID).set(draft);
    return draft;
}

/** Izabran primalac iz ponuđenih: pozdrav se prilagodi njemu (ti/vi, ime). */
export async function chooseRecipient(orgId: string, uid: string, draftId: string, index: number): Promise<EmailDraft> {
    const d = await getDraft(orgId, uid, draftId);
    if (d.Status !== 'draft') throw new DraftError('Nacrt je već poslan ili otkazan.', 409);
    const pick = d.Candidates?.[index];
    if (!pick) throw new DraftError('Taj izbor više ne postoji.', 404);
    const contact = (await loadContacts(orgId)).find(c => normalizeEmail(c.Email) === pick.email);
    const next: Partial<EmailDraft> = { To: [pick], Candidates: [], Updated_At: new Date().toISOString() };
    if (d.Parts) {
        const parts = { ...d.Parts, greeting: greeting(contact) };
        // Tekst koji je ERP složio za narudžbu prati obraćanje izabrane osobe (ti/vi); ručno pisan ostaje.
        if (d.Purpose === 'order' && d.Parts.auto && d.Entity_ID) {
            const order = await getOrderWithItems(orgId, d.Entity_ID);
            if (order) parts.text = orderText(order, contact, d.Parts.extra || '');
        }
        next.Parts = parts;
        next.Body = composeText({ greeting: parts.greeting, body: parts.text, signature: parts.signature });
    }
    await drafts().doc(draftId).set(next, { merge: true });
    return { ...d, ...next } as EmailDraft;
}

/** Novi tekst maila (bez pozdrava i potpisa — njih zadržava ERP). */
export async function setDraftText(orgId: string, uid: string, draftId: string, text: string): Promise<EmailDraft> {
    const d = await getDraft(orgId, uid, draftId);
    if (d.Status !== 'draft' && d.Status !== 'failed') throw new DraftError('Nacrt je već poslan ili otkazan.', 409);
    const clean = text.trim().slice(0, 10_000);
    if (!clean) throw new DraftError('Tekst je prazan.');
    const parts = { greeting: d.Parts?.greeting || '', text: clean, signature: d.Parts?.signature || '', auto: false };
    const next: Partial<EmailDraft> = {
        Parts: parts,
        Body: composeText({ greeting: parts.greeting, body: parts.text, signature: parts.signature }),
        Awaiting_Text_Since: null,
        Updated_At: new Date().toISOString(),
    };
    await drafts().doc(draftId).set(next, { merge: true });
    return { ...d, ...next } as EmailDraft;
}

const AWAIT_MS = 15 * 60_000;

/** „Izmijeni tekst" na Telegramu: sljedeća poruka (u 15 min) postaje tekst ovog nacrta. */
export async function awaitDraftText(orgId: string, uid: string, draftId: string, now = new Date()): Promise<void> {
    const d = await getDraft(orgId, uid, draftId);
    if (d.Status !== 'draft' && d.Status !== 'failed') throw new DraftError('Nacrt je već poslan ili otkazan.', 409);
    // Samo jedan nacrt čeka tekst.
    const others = await drafts().where('Owner_UID', '==', uid).get();
    await Promise.all(others.docs
        .filter(doc => (doc.data() as EmailDraft).Awaiting_Text_Since && doc.id !== draftId)
        .map(doc => doc.ref.set({ Awaiting_Text_Since: null }, { merge: true })));
    await drafts().doc(draftId).set({ Awaiting_Text_Since: now.toISOString() }, { merge: true });
}

/** Nacrt koji čeka novi tekst (klik prije najviše 15 min), ako postoji. */
export async function draftAwaitingText(orgId: string, uid: string, now = new Date()): Promise<EmailDraft | null> {
    const snap = await drafts().where('Owner_UID', '==', uid).get();
    const waiting = snap.docs.map(d => d.data() as EmailDraft)
        .filter(d => d.Organization_ID === orgId && (d.Status === 'draft' || d.Status === 'failed') && d.Awaiting_Text_Since
            && now.getTime() - new Date(d.Awaiting_Text_Since).getTime() <= AWAIT_MS)
        .sort((a, b) => String(b.Awaiting_Text_Since).localeCompare(String(a.Awaiting_Text_Since)));
    return waiting[0] || null;
}

export async function getDraft(orgId: string, uid: string, draftId: string): Promise<EmailDraft> {
    const snap = await drafts().doc(draftId).get();
    const d = snap.exists ? (snap.data() as EmailDraft) : null;
    if (!d || d.Organization_ID !== orgId || d.Owner_UID !== uid) throw new DraftError('Nacrt ne postoji.', 404);
    return d;
}

function cleanAddresses(list: unknown, label: string): EmailDraftAddress[] {
    if (!Array.isArray(list)) return [];
    const out: EmailDraftAddress[] = [];
    for (const raw of list) {
        const email = normalizeEmail(typeof raw === 'string' ? raw : (raw as EmailDraftAddress)?.email || '');
        if (!isValidEmail(email)) throw new DraftError(`Neispravna adresa u polju ${label}: ${email || '(prazno)'}`);
        if (out.some(a => a.email === email)) continue;
        const name = typeof raw === 'object' && raw && typeof (raw as EmailDraftAddress).name === 'string' ? (raw as EmailDraftAddress).name!.trim() : '';
        out.push(name ? { name, email } : { email });
    }
    return out;
}

export async function updateDraft(orgId: string, uid: string, draftId: string, patch: { To?: unknown; Cc?: unknown; Subject?: unknown; Body?: unknown }): Promise<EmailDraft> {
    const d = await getDraft(orgId, uid, draftId);
    if (d.Status !== 'draft' && d.Status !== 'failed') throw new DraftError('Nacrt je već poslan ili otkazan.', 409);
    const next: Partial<EmailDraft> = { Updated_At: new Date().toISOString() };
    if (patch.To !== undefined) next.To = cleanAddresses(patch.To, 'Kome');
    if (patch.Cc !== undefined) next.Cc = cleanAddresses(patch.Cc, 'Kopija');
    if (typeof patch.Subject === 'string') next.Subject = patch.Subject.replace(/\s+/g, ' ').trim().slice(0, 300);
    // Ručno prepravljen cijeli tekst: dijelovi (pozdrav/tekst/potpis) više ne važe.
    if (typeof patch.Body === 'string' && patch.Body !== d.Body) { next.Body = patch.Body.slice(0, 20_000); next.Parts = null; }
    if (next.Subject !== undefined && d.Purpose === 'order') {
        next.Attachments = d.Attachments.map(a => ({ ...a, filename: attachmentName(next.Subject || d.Subject) }));
    }
    await drafts().doc(draftId).set(next, { merge: true });
    return { ...d, ...next } as EmailDraft;
}

export async function cancelDraft(orgId: string, uid: string, draftId: string): Promise<void> {
    const d = await getDraft(orgId, uid, draftId);
    if (d.Status === 'sent') throw new DraftError('Mail je već poslan.', 409);
    await drafts().doc(draftId).set({ Status: 'cancelled', Updated_At: new Date().toISOString() }, { merge: true });
}

export interface SendResult {
    threadId: string;
    to: string[];
    /** Narudžba je ovim slanjem prešla iz Nacrta u Poslano. */
    orderSent: boolean;
    orderNumber?: string;
}

async function orderRef(orgId: string, orderId: string) {
    const snap = await adminDb().collection(COLLECTIONS.ORDERS).where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).limit(1).get();
    return snap.empty ? null : snap.docs[0].ref;
}

export async function sendDraft(orgId: string, uid: string, draftId: string, now = new Date()): Promise<SendResult> {
    const d = await getDraft(orgId, uid, draftId);
    if (d.Status === 'sent') throw new DraftError('Ovaj mail je već poslan.', 409);
    if (d.Status === 'cancelled') throw new DraftError('Nacrt je otkazan.', 409);
    if (!d.To.length) throw new DraftError('Izaberi kome ide mail.');
    if (!d.Subject.trim()) throw new DraftError('Mail nema naslov.');

    // Prilozi se prave u trenutku slanja — PDF uvijek odgovara narudžbi kakva je sad.
    const attachments: { filename: string; contentType: string; data: Uint8Array }[] = [];
    let order: Order | null = null;
    for (const a of d.Attachments) {
        if (a.kind !== 'order') continue;
        order = await getOrderWithItems(orgId, a.id);
        if (!order) throw new DraftError('Narudžba iz priloga više ne postoji.', 404);
        const [supplier, specs, company] = await Promise.all([
            getSupplier(orgId, order.Supplier_ID, order.Supplier_Name), loadOrderSpecs(orgId, order), companyOf(orgId),
        ]);
        attachments.push({ filename: a.filename, contentType: 'application/pdf', data: new Uint8Array(buildOrderPdf({ order, supplier, specs, company })) });
    }

    let sent: { id: string; threadId: string };
    try {
        sent = await sendGmail(uid, { to: d.To, cc: d.Cc, subject: d.Subject, text: d.Body, attachments, threadId: d.Thread_ID, inReplyTo: d.In_Reply_To });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await drafts().doc(draftId).set({ Status: 'failed', Error: message, Updated_At: now.toISOString() }, { merge: true });
        throw e;
    }

    const at = now.toISOString();
    const recipients = [...d.To, ...d.Cc].map(a => a.email);
    await drafts().doc(draftId).set({
        Status: 'sent', Sent_At: at, Gmail_Message_ID: sent.id, Thread_ID: sent.threadId,
        Bounce_Pending: true, Error: null, Updated_At: at,
    }, { merge: true });

    // Narudžba: Nacrt → Poslano (materijali naručeni, Sent_At) + trag maila.
    let orderSent = false;
    if (d.Purpose === 'order' && d.Entity_ID && order) {
        if (order.Status === 'Nacrt') {
            const res = await sendOrder(orgId, d.Entity_ID);
            orderSent = res.ok;
        }
        const ref = await orderRef(orgId, d.Entity_ID);
        if (ref) await ref.set({ Emailed_At: at, Emailed_To: d.To.map(a => a.email), Gmail_Thread_ID: sent.threadId, Email_Bounced: false }, { merge: true });
    }

    // Zadnji mail na kontaktima kojima je otišao.
    const contactSnap = await adminDb().collection(COLLECTIONS.CONTACTS).where('Organization_ID', '==', orgId).get();
    await Promise.all(contactSnap.docs
        .filter(doc => recipients.includes(normalizeEmail((doc.data() as Contact).Email)))
        .map(doc => doc.ref.set({ Last_Emailed_At: at }, { merge: true })));

    return { threadId: sent.threadId, to: d.To.map(a => a.email), orderSent, orderNumber: order?.Order_Number };
}

// ── Vraćeni mailovi ──────────────────────────────────────────────────

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery (sub)?system/i;
const CHECK_AFTER_MS = 10 * 60_000;
const GIVE_UP_AFTER_MS = 2 * 60 * 60_000;

/** Jednom svakih nekoliko minuta (tick): nit poslanog maila dobila odgovor od MAILER-DAEMON-a? */
export async function checkBounces(now = new Date()): Promise<number> {
    const snap = await drafts().where('Bounce_Pending', '==', true).get();
    let bounced = 0;
    for (const doc of snap.docs) {
        const d = doc.data() as EmailDraft;
        const age = now.getTime() - new Date(d.Sent_At || d.Updated_At).getTime();
        if (age < CHECK_AFTER_MS || !d.Thread_ID) {
            if (!d.Thread_ID) await doc.ref.set({ Bounce_Pending: false }, { merge: true });
            continue;
        }
        try {
            const senders = await getThreadSenders(d.Owner_UID, d.Thread_ID);
            if (senders.some(s => BOUNCE_FROM.test(s))) {
                bounced++;
                await doc.ref.set({ Bounced: true, Bounce_Pending: false }, { merge: true });
                if (d.Purpose === 'order' && d.Entity_ID) {
                    const ref = await orderRef(d.Organization_ID, d.Entity_ID);
                    if (ref) await ref.set({ Email_Bounced: true }, { merge: true });
                }
                const link = await getLinkByUid(d.Owner_UID);
                if (link) {
                    await sendMessage(link.chatId,
                        `⚠️ Mail se vratio: „${d.Subject}" → ${d.To.map(a => a.email).join(', ')}.\nAdresa vjerovatno ne postoji — provjeri je u Postavke → Kontakti i pošalji ponovo.`);
                }
            } else if (age > GIVE_UP_AFTER_MS) {
                await doc.ref.set({ Bounce_Pending: false }, { merge: true });
            }
        } catch (e) {
            // Gmail veza istekla ili nit nedostupna: ne provjeravaj u krug.
            if (e instanceof GmailError) await doc.ref.set({ Bounce_Pending: false }, { merge: true });
            else console.error('[email] provjera vraćenog maila', e);
        }
    }
    return bounced;
}

/**
 * Odgovor u istoj niti (ulazna pošta: „Potvrđujem" na predračun). Ide kao
 * nacrt s dugmetom „Pošalji", kao i svaki drugi mail.
 */
export async function createReplyDraft(input: {
    orgId: string; uid: string; to: EmailDraftAddress; subject: string; text: string;
    threadId: string; inReplyTo?: string; source: EmailDraft['Source']; now?: Date;
}): Promise<EmailDraft> {
    const { orgId, uid } = input;
    const account = await getEmailAccount(uid);
    if (!account || account.Organization_ID !== orgId) throw new GmailError('not-connected', 'Gmail nije povezan — poveži ga u Postavke → Kontakti.');
    const contact = (await loadContacts(orgId)).find(c => normalizeEmail(c.Email) === normalizeEmail(input.to.email));
    const parts = { greeting: greeting(contact), text: input.text.trim(), signature: await signatureFor(uid, account.Signature) };
    const now = (input.now || new Date()).toISOString();
    const subject = /^\s*(re|odg|aw)\s*:/i.test(input.subject) ? input.subject.trim() : `Re: ${input.subject.trim()}`;
    const draft: EmailDraft = {
        Draft_ID: randomUUID(),
        Organization_ID: orgId,
        Owner_UID: uid,
        Purpose: 'general',
        To: [contact ? addr(contact) : input.to],
        Cc: [],
        Subject: subject.slice(0, 200),
        Body: composeText({ greeting: parts.greeting, body: parts.text, signature: parts.signature }),
        Parts: parts,
        Attachments: [],
        Status: 'draft',
        Source: input.source,
        Thread_ID: input.threadId,
        ...(input.inReplyTo ? { In_Reply_To: input.inReplyTo } : {}),
        Created_At: now,
        Updated_At: now,
    };
    await drafts().doc(draft.Draft_ID).set(draft);
    return draft;
}
