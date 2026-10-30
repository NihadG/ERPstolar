// ════════════════════════════════════════════════════════════════════
// ULAZNA POŠTA — sat čita nove mailove i javlja šta je stiglo
//
//   email_accounts/{uid}.History_ID   odakle se čita (prvi put: od sada, bez starih)
//   mail_inbox/{uid}_{messageId}       prepoznat mail (idempotentno)
//
// Čita se samo pošta od Kontakata, domena dobavljača, ljudi iz imenika pošte
// (kojima si pisao — lib/server/mailDirectory.ts) i niti koje je ERP započeo
// (lib/email/classify.ts). Mail koji spominje projekat veže se za njega.
// Pri povezivanju: imenik iz poslane pošte, pa jednom tiho unazad 60 dana
// (bez poruka i podsjetnika) — da „Gotova su ogledala" od prije bude u ERP-u. Za predračun, „spremno", račun, odobrenje
// i primjedbe s gradilišta stiže poruka na Telegram s dugmadima; u ERP se
// upisuje tek na klik (lib/assistant/mailButtons.ts). U Gmailu ništa ne dira.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import {
    getMessageMeta, getProfile, GmailError, listHistory, listMessageIds, mapLimit, READ_SCOPE, updateEmailAccount,
    type EmailAccount, type GmailMessageMeta,
} from './gmail';
import { loadMailPeople, notePeople, peopleStale, refreshMailPeople } from './mailDirectory';
import type { MailHeaders } from '@/lib/email/directory';
import { loadContacts } from './emailDrafts';
import { classifyMail, type MailClass, type MailContext, type MailOrderRef } from '@/lib/email/classify';
import { mailMessage, NOTIFY_KINDS } from '@/lib/assistant/mailText';
import { companyOf } from '@/lib/assistant/orderDocuments';
import { addressedToMe, followMessage, followOf, needsReply, nextFollowAt } from '@/lib/email/followUp';
import { companyTag } from '@/lib/email/compose';
import { getLinkByUid } from '@/lib/assistant/store';
import { sendMessage } from '@/lib/telegram/api';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { EmailDraft, MailInboxItem, Order, Project, Supplier } from '@/lib/types';

/** Najviše poruka po krugu — sat ima 60 s; ostatak čeka sljedeći krug. */
const MAX_PER_RUN = 25;
/** Popunjavanje unazad: koliko dana i najviše poruka. */
export const BACKFILL_DAYS = 60;
const BACKFILL_MAX = 150;
const HEADERS = ['From', 'To', 'Cc', 'Subject', 'Message-ID'];

export const inboxRef = (uid: string, messageId: string) => adminDb().collection(COLLECTIONS.MAIL_INBOX).doc(`${uid}_${messageId}`);

async function loadContext(account: EmailAccount): Promise<MailContext> {
    const db = adminDb();
    const [contacts, suppliersSnap, ordersSnap, draftsSnap, projectsSnap, people] = await Promise.all([
        loadContacts(account.Organization_ID),
        db.collection(COLLECTIONS.SUPPLIERS).where('Organization_ID', '==', account.Organization_ID).get(),
        db.collection(COLLECTIONS.ORDERS).where('Organization_ID', '==', account.Organization_ID).get(),
        db.collection(COLLECTIONS.EMAIL_DRAFTS).where('Owner_UID', '==', account.UID).get(),
        db.collection(COLLECTIONS.PROJECTS).where('Organization_ID', '==', account.Organization_ID).get(),
        loadMailPeople(account.UID),
    ]);
    const orders = ordersSnap.docs.map(d => d.data() as Order);
    const threads = new Map<string, { orderId?: string }>();
    draftsSnap.docs.map(d => d.data() as EmailDraft).filter(d => d.Status === 'sent' && d.Thread_ID)
        .forEach(d => threads.set(d.Thread_ID!, d.Purpose === 'order' && d.Entity_ID ? { orderId: d.Entity_ID } : {}));
    orders.filter(o => o.Gmail_Thread_ID).forEach(o => threads.set(o.Gmail_Thread_ID!, { orderId: o.Order_ID }));
    return {
        own: [account.Email, account.Send_As || ''].filter(Boolean),
        contacts,
        suppliers: suppliersSnap.docs.map(d => d.data() as Supplier),
        threads,
        orders: orders.map((o): MailOrderRef => ({ Order_ID: o.Order_ID, Order_Number: o.Order_Number, Supplier_ID: o.Supplier_ID, Status: o.Status, Order_Date: o.Order_Date })),
        people: new Set(people.map(p => p.Email)),
        projects: projectsSnap.docs.map(d => d.data() as Project).filter(p => !p.Hidden && p.Project_ID)
            .map(p => ({ id: p.Project_ID, name: [p.Client_Name, p.Name].filter(Boolean).join(' · ') })),
    };
}

const receivedAt = (meta: GmailMessageMeta, now: Date) => (meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : now.toISOString());

/** Stavka ulazne pošte iz zaglavlja i razvrstavanja (bez praćenja — to dodaje sat). */
function inboxItem(account: EmailAccount, id: string, meta: GmailMessageMeta, cls: MailClass, now: Date): MailInboxItem {
    return {
        Item_ID: `${account.UID}_${id}`,
        Organization_ID: account.Organization_ID,
        Owner_UID: account.UID,
        Message_ID: id,
        Thread_ID: meta.threadId,
        ...(meta.headers['message-id'] ? { Rfc_Message_ID: meta.headers['message-id'] } : {}),
        From: cls.fromEmail,
        From_Name: cls.fromName,
        Subject: meta.headers.subject || '',
        Snippet: meta.snippet,
        Received_At: receivedAt(meta, now),
        Kind: cls.kind as MailInboxItem['Kind'],
        ...(cls.docKind ? { Doc_Kind: cls.docKind } : {}),
        ...(cls.docNo ? { Doc_No: cls.docNo } : {}),
        ...(cls.supplierId ? { Supplier_ID: cls.supplierId } : {}),
        ...(cls.supplierName ? { Supplier_Name: cls.supplierName } : {}),
        Order_IDs: cls.orderIds,
        ...(cls.contact?.Contact_ID ? { Contact_ID: cls.contact.Contact_ID } : {}),
        ...(cls.projectIds?.length ? { Project_IDs: cls.projectIds } : {}),
        State: 'new',
        Created_At: now.toISOString(),
    };
}

const classify = (id: string, meta: GmailMessageMeta, ctx: MailContext) =>
    classifyMail({ id, threadId: meta.threadId, from: meta.headers.from || '', subject: meta.headers.subject || '', snippet: meta.snippet, labelIds: meta.labelIds }, ctx);

/** Jedan sanduče: nove poruke od zadnjeg kruga. Vraća broj poruka o kojima je bot javio. */
export async function syncMailbox(account: EmailAccount, now = new Date()): Promise<number> {
    const uid = account.UID;
    if (account.Status !== 'ok' || !account.Scopes.includes(READ_SCOPE)) return 0;
    if (!account.History_ID) {
        // Prvi krug: kreće se od sada — stara pošta se ne obrađuje naknadno.
        const profile = await getProfile(uid);
        await updateEmailAccount(uid, { History_ID: profile.historyId });
        return 0;
    }

    let page: { messageIds: string[]; historyId: string };
    try {
        page = await listHistory(uid, account.History_ID);
    } catch (e) {
        if (e instanceof GmailError && e.status === 404) {
            // Predug razmak (Gmail čuva istoriju ograničeno) — kreni od sada.
            const profile = await getProfile(uid);
            await updateEmailAccount(uid, { History_ID: profile.historyId });
            return 0;
        }
        throw e;
    }
    if (!page.messageIds.length) {
        if (page.historyId !== account.History_ID) await updateEmailAccount(uid, { History_ID: page.historyId });
        return 0;
    }

    const ctx = await loadContext(account);
    const link = await getLinkByUid(uid);
    const orderNo = new Map(ctx.orders.map(o => [o.Order_ID, o.Order_Number]));
    // „Luxco treba ugraditi…" u masovnom mailu gradilišta znači tebe.
    const tag = companyTag((await companyOf(account.Organization_ID)).name || '');
    let notified = 0;
    // Imenik: kome si pisao i ko od poznatih je pisao tebi (ime, datum).
    const seen: MailHeaders[] = [];

    for (const id of page.messageIds.slice(-MAX_PER_RUN)) {
        const ref = inboxRef(uid, id);
        if ((await ref.get()).exists) continue;
        let meta;
        try {
            meta = await getMessageMeta(uid, id, HEADERS);
        } catch (e) {
            if (e instanceof GmailError && e.status === 404) continue;   // obrisana u međuvremenu
            throw e;
        }
        if (meta.labelIds.includes('SENT')) {
            seen.push({ to: meta.headers.to || '', cc: meta.headers.cc || '', date: receivedAt(meta, now), sent: true });
            // Tvoj odgovor u niti zatvara podsjetnik „čeka tvoj odgovor".
            await closeReplied(uid, meta.threadId, meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : now.toISOString());
            continue;
        }
        const cls = classify(id, meta, ctx);
        if (cls.kind === 'ignore') continue;
        seen.push({ from: meta.headers.from || '', date: receivedAt(meta, now), sent: false });

        const item = inboxItem(account, id, meta, cls, now);
        // Praćenje: šta čeka tebe (odgovor, preuzimanje, gradilište) i kad podsjetiti.
        const addressing = {
            subject: item.Subject, snippet: item.Snippet, to: meta.headers.to || '', cc: meta.headers.cc || '',
            own: ctx.own, companyWords: tag ? [tag] : [],
        };
        const follow = followOf(item.Kind, needsReply(addressing), addressedToMe(addressing));
        if (follow) Object.assign(item, { Follow: follow, Follow_Count: 0, Next_Follow_At: nextFollowAt(item.Received_At, follow, 0) });

        if (link && NOTIFY_KINDS.has(item.Kind)) {
            const m = mailMessage(item, o => orderNo.get(o));
            await sendMessage(link.chatId, m.text, m.buttons.length ? m.buttons : undefined);
            item.Notified_At = now.toISOString();
            notified++;
        } else if (link && follow === 'reply') {
            // Običan mail poznatog koji pita nešto: javi odmah, s dugmetom „Odgovorio sam".
            const m = followMessage(item, now, o => orderNo.get(o));
            await sendMessage(link.chatId, m.text, m.buttons);
            item.Notified_At = now.toISOString();
            notified++;
        }
        await ref.set(item);
    }
    await notePeople(account, seen, () => true, now).catch(e => console.warn('[mail] imenik:', e));
    await updateEmailAccount(uid, { History_ID: page.historyId });
    return notified;
}

/**
 * Jednom po povezivanju: prepoznata pošta zadnjih 60 dana ulazi u mail_inbox
 * tiho — bez Telegram poruka i podsjetnika (stare stvari ne smiju zvoniti),
 * ali bot i kartica projekta je vide („Gotova su ogledala" od 3.9.).
 */
export async function backfillMailbox(account: EmailAccount, now = new Date()): Promise<number> {
    const uid = account.UID;
    const ids = await listMessageIds(uid, `-in:sent -in:draft newer_than:${BACKFILL_DAYS}d -category:promotions -category:social`, BACKFILL_MAX);
    const ctx = await loadContext(account);
    const seen: MailHeaders[] = [];
    let stored = 0;
    await mapLimit(ids, 6, async id => {
        const ref = inboxRef(uid, id);
        if ((await ref.get()).exists) return;
        const meta = await getMessageMeta(uid, id, HEADERS).catch(e => {
            if (e instanceof GmailError && e.status === 404) return null;
            throw e;
        });
        if (!meta) return;
        const cls = classify(id, meta, ctx);
        if (cls.kind === 'ignore') return;
        await ref.set({ ...inboxItem(account, id, meta, cls, now), Backfilled: true });
        seen.push({ from: meta.headers.from || '', date: receivedAt(meta, now), sent: false });
        stored++;
    });
    await notePeople(account, seen, () => true, now);
    await updateEmailAccount(uid, { Backfill_At: now.toISOString() });
    return stored;
}

/** Poslan mail u niti: otvoreni „čeka tvoj odgovor" iz te niti (stigli prije njega) su odgovoreni. */
export async function closeReplied(uid: string, threadId: string, sentAt: string): Promise<number> {
    const snap = await adminDb().collection(COLLECTIONS.MAIL_INBOX).where('Thread_ID', '==', threadId).get();
    const open = snap.docs.filter(d => {
        const i = d.data() as MailInboxItem;
        return i.Owner_UID === uid && i.Follow === 'reply' && !i.Done_At && i.Received_At <= sentAt;
    });
    await Promise.all(open.map(d => d.ref.set({ Done_At: sentAt, Done_How: 'replied', Next_Follow_At: null }, { merge: true })));
    return open.length;
}

/** Svi povezani sandučići (sat). Greška jednog ne zaustavlja ostale. */
export async function syncAllMailboxes(now = new Date()): Promise<number> {
    const snap = await adminDb().collection(COLLECTIONS.EMAIL_ACCOUNTS).get();
    let total = 0;
    for (const doc of snap.docs) {
        try {
            const account = doc.data() as EmailAccount;
            // Jedan teži posao po krugu (sat ima 60 s): imenik, pa popunjavanje unazad, pa obično čitanje.
            if (account.Status === 'ok' && account.Scopes.includes(READ_SCOPE)) {
                if (peopleStale(account, now)) { await refreshMailPeople(account, now); continue; }
                if (!account.Backfill_At) { await backfillMailbox(account, now); continue; }
            }
            total += await syncMailbox(account, now);
        } catch (e) {
            console.error('[mail] sinhronizacija', doc.id, e instanceof Error ? e.message : e);
        }
    }
    return total;
}
