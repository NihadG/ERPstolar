// ════════════════════════════════════════════════════════════════════
// ŠTA JE STIGLO — klasifikacija ulazne pošte bez modela (čisto)
//
// Redom, od najsigurnijeg:
//   1. nit koju je ERP započeo (narudžba poslana mailom) → zna se narudžba
//   2. pošiljalac iz Kontakata, pa domen poznatog dobavljača
//   3. obrazac naslova/teksta: predračun / ponuda / račun / spremno /
//      odobreno / primjedbe s gradilišta
// Nepoznat pošiljalac izvan naših niti se ne dira (promocije, šum).
// Ništa se ovdje ne upisuje — rezultat je prijedlog za dugmad.
// ════════════════════════════════════════════════════════════════════

import { fold } from '../command/search';
import { emailDomain, isSharedMailDomain, matchSender, normalizeEmail, splitEmails } from '../contacts';
import { parseMailbox } from './addresses';
import type { Contact, MailKind } from '../types';

export interface IncomingMail {
    id: string;
    threadId: string;
    from: string;
    subject: string;
    snippet: string;
    labelIds: string[];
}

export interface MailOrderRef {
    Order_ID: string;
    Order_Number: string;
    Supplier_ID: string;
    Status: string;
    Order_Date: string;
}

export interface MailContext {
    own: string[];
    contacts: Contact[];
    suppliers: { Supplier_ID: string; Name: string; Email?: string }[];
    /** Niti koje je ERP započeo: nit → narudžba (ako je mail bio narudžba). */
    threads: Map<string, { orderId?: string }>;
    orders: MailOrderRef[];
}

export interface MailClass {
    kind: MailKind | 'ignore';
    docKind?: 'predracun' | 'ponuda';
    docNo?: string;
    supplierId?: string;
    supplierName?: string;
    orderIds: string[];
    contact?: Contact;
    fromEmail: string;
    fromName: string;
}

const IGNORED_LABELS = ['SENT', 'DRAFT', 'SPAM', 'TRASH', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL'];
const AUTOMATED = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i;

const INVOICE = /\b(racun|faktura|fakturu|invoice|rechnung)\b/;
const DOC = /\b(predracun|predracuna|profaktur\w*|ponuda|ponudu|ponude|offer|quotation|angebot)\b/;
const READY = /\b(spreman|spremna|spremne|spremno|spremni|zavrsen\w*|gotov\w*|za preuzimanje|mozete preuzeti|moze se preuzeti|mozete doci|isporucen\w*|poslan\w* kurir\w*)\b/;
const ACCEPTED = /\b(odobren\w*|prihvacen\w*|potvrdjuj\w*|potvrdujem|potvrdjujemo|moze u proizvodnju|slazemo se|saglasn\w*)\b/;
const SITE = /\b(primjedb\w*|kompletir\w*|nedostaj\w*|nedostaje|popravi\w*|ugradi\w*|demontaz\w*|dinamik\w*|reklamaci\w*|rok za|rok je|stan [a-z]?\d{3})\b/;

/** Najduži broj u naslovu (≥ 5 cifara): broj predračuna/računa/ponude. */
export function documentNumber(subject: string): string | undefined {
    const nums = (subject || '').match(/\d{5,}/g) || [];
    return nums.sort((a, b) => b.length - a.length)[0];
}

export function classifyMail(mail: IncomingMail, ctx: MailContext): MailClass {
    const sender = parseMailbox(mail.from) || { email: normalizeEmail(mail.from) };
    const base: MailClass = { kind: 'ignore', orderIds: [], fromEmail: sender.email, fromName: sender.name || sender.email };
    if (mail.labelIds.some(l => IGNORED_LABELS.includes(l))) return base;
    if (!sender.email || ctx.own.map(normalizeEmail).includes(sender.email) || AUTOMATED.test(sender.email)) return base;

    const thread = ctx.threads.get(mail.threadId);
    const match = matchSender(ctx.contacts, sender.email);
    const contact = match.contact;
    if (contact && contact.First_Name) base.fromName = [contact.First_Name, contact.Last_Name].filter(Boolean).join(' ');

    // Dobavljač: nit narudžbe → kontakt → domen kontakta → domen s kartice dobavljača.
    const threadOrder = thread?.orderId ? ctx.orders.find(o => o.Order_ID === thread.orderId) : undefined;
    let supplierId = threadOrder?.Supplier_ID || contact?.Supplier_ID || match.viaDomain?.Supplier_ID;
    if (!supplierId && !isSharedMailDomain(sender.email)) {
        const domain = emailDomain(sender.email);
        supplierId = ctx.suppliers.find(s => splitEmails(s.Email || '').some(e => emailDomain(e) === domain))?.Supplier_ID;
    }
    if (!thread && !contact && !match.viaDomain && !supplierId) return base;   // nepoznat — ne diramo

    const text = fold(`${mail.subject} ${mail.snippet}`);
    const subject = fold(mail.subject);
    const out: MailClass = { ...base, contact, supplierId, supplierName: ctx.suppliers.find(s => s.Supplier_ID === supplierId)?.Name };

    if (supplierId) {
        const open = (statuses: string[]) => threadOrder ? [threadOrder.Order_ID] : ctx.orders
            .filter(o => o.Supplier_ID === supplierId && statuses.includes(o.Status))
            .sort((a, b) => String(b.Order_Date).localeCompare(String(a.Order_Date)))
            .slice(0, 4).map(o => o.Order_ID);
        if (INVOICE.test(text) || /^\s*\d{8,}\s*$/.test(mail.subject)) {
            return { ...out, kind: 'invoice', docNo: documentNumber(mail.subject), orderIds: open(['Poslano', 'Primljeno', 'Djelimično primljeno']) };
        }
        if (DOC.test(subject) || (DOC.test(text) && documentNumber(mail.subject))) {
            return { ...out, kind: 'supplier_doc', docKind: /predracun|profaktur/.test(text) ? 'predracun' : 'ponuda', docNo: documentNumber(mail.subject), orderIds: open(['Nacrt', 'Poslano']) };
        }
        if (READY.test(text)) return { ...out, kind: 'ready', orderIds: open(['Poslano', 'Djelimično primljeno']) };
        return { ...out, kind: thread ? 'reply' : 'contact', orderIds: threadOrder ? [threadOrder.Order_ID] : [] };
    }

    // Odobrenje je određenije od „gradilišta" (naslov ponude zna imati „demontaža").
    if (ACCEPTED.test(text)) return { ...out, kind: 'accepted' };
    const onSite = contact && (contact.Kind === 'site' || (contact.Project_Roles || []).some(r => r.Role !== 'kupac'));
    if (onSite && SITE.test(text)) return { ...out, kind: 'site' };
    return { ...out, kind: thread ? 'reply' : 'contact' };
}

// ── Tekst poruke (za Bilježnicu) ─────────────────────────────────────

interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[] }

function walk(p: Part | undefined, out: { plain: string[]; html: string[] }) {
    if (!p) return;
    const data = p.body?.data ? Buffer.from(p.body.data, 'base64url').toString('utf8') : '';
    if (p.mimeType === 'text/plain' && data) out.plain.push(data);
    else if (p.mimeType === 'text/html' && data) out.html.push(data);
    (p.parts || []).forEach(c => walk(c, out));
}

/** Tekst maila bez citata prethodne poruke i potpisa-bannera; najviše `max` znakova. */
export function plainTextOf(payload: Part | undefined, max = 4000): string {
    const found = { plain: [] as string[], html: [] as string[] };
    walk(payload, found);
    let text = found.plain[0] || (found.html[0] || '')
        .replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    // Citat stare poruke: „On … wrote:", „-----Original Message", „From: … Sent:".
    const cut = text.search(/\n\s*(On .{5,120} wrote:|.{0,40}je napisao|-{3,}\s*Original Message|From:\s.+\n\s*Sent:|Od:\s.+\n\s*Poslano:|-{5,} Forwarded message)/i);
    if (cut > 0) text = text.slice(0, cut);
    return text.replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
        .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
