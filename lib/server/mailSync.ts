// ════════════════════════════════════════════════════════════════════
// ULAZNA POŠTA — sat čita nove mailove i javlja šta je stiglo
//
//   email_accounts/{uid}.History_ID   odakle se čita (prvi put: od sada, bez starih)
//   mail_inbox/{uid}_{messageId}       prepoznat mail (idempotentno)
//
// Čita se samo pošta od Kontakata, domena dobavljača i niti koje je ERP
// započeo (lib/email/classify.ts). Za predračun, „spremno", račun, odobrenje
// i primjedbe s gradilišta stiže poruka na Telegram s dugmadima; u ERP se
// upisuje tek na klik (lib/assistant/mailButtons.ts). U Gmailu ništa ne dira.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import {
    getMessageMeta, getProfile, GmailError, listHistory, READ_SCOPE, updateEmailAccount, type EmailAccount,
} from './gmail';
import { loadContacts } from './emailDrafts';
import { classifyMail, type MailContext, type MailOrderRef } from '@/lib/email/classify';
import { mailMessage, NOTIFY_KINDS } from '@/lib/assistant/mailText';
import { getLinkByUid } from '@/lib/assistant/store';
import { sendMessage } from '@/lib/telegram/api';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { EmailDraft, MailInboxItem, Order, Supplier } from '@/lib/types';

/** Najviše poruka po krugu — sat ima 60 s; ostatak čeka sljedeći krug. */
const MAX_PER_RUN = 25;

export const inboxRef = (uid: string, messageId: string) => adminDb().collection(COLLECTIONS.MAIL_INBOX).doc(`${uid}_${messageId}`);

async function loadContext(account: EmailAccount): Promise<MailContext> {
    const db = adminDb();
    const [contacts, suppliersSnap, ordersSnap, draftsSnap] = await Promise.all([
        loadContacts(account.Organization_ID),
        db.collection(COLLECTIONS.SUPPLIERS).where('Organization_ID', '==', account.Organization_ID).get(),
        db.collection(COLLECTIONS.ORDERS).where('Organization_ID', '==', account.Organization_ID).get(),
        db.collection(COLLECTIONS.EMAIL_DRAFTS).where('Owner_UID', '==', account.UID).get(),
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
    };
}

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
    let notified = 0;

    for (const id of page.messageIds.slice(-MAX_PER_RUN)) {
        const ref = inboxRef(uid, id);
        if ((await ref.get()).exists) continue;
        let meta;
        try {
            meta = await getMessageMeta(uid, id, ['From', 'Subject', 'Message-ID']);
        } catch (e) {
            if (e instanceof GmailError && e.status === 404) continue;   // obrisana u međuvremenu
            throw e;
        }
        const cls = classifyMail({ id, threadId: meta.threadId, from: meta.headers.from || '', subject: meta.headers.subject || '', snippet: meta.snippet, labelIds: meta.labelIds }, ctx);
        if (cls.kind === 'ignore') continue;

        const item: MailInboxItem = {
            Item_ID: `${uid}_${id}`,
            Organization_ID: account.Organization_ID,
            Owner_UID: uid,
            Message_ID: id,
            Thread_ID: meta.threadId,
            ...(meta.headers['message-id'] ? { Rfc_Message_ID: meta.headers['message-id'] } : {}),
            From: cls.fromEmail,
            From_Name: cls.fromName,
            Subject: meta.headers.subject || '',
            Snippet: meta.snippet,
            Received_At: meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : now.toISOString(),
            Kind: cls.kind,
            ...(cls.docKind ? { Doc_Kind: cls.docKind } : {}),
            ...(cls.docNo ? { Doc_No: cls.docNo } : {}),
            ...(cls.supplierId ? { Supplier_ID: cls.supplierId } : {}),
            ...(cls.supplierName ? { Supplier_Name: cls.supplierName } : {}),
            Order_IDs: cls.orderIds,
            ...(cls.contact?.Contact_ID ? { Contact_ID: cls.contact.Contact_ID } : {}),
            State: 'new',
            Created_At: now.toISOString(),
        };
        if (link && NOTIFY_KINDS.has(item.Kind)) {
            const m = mailMessage(item, o => orderNo.get(o));
            await sendMessage(link.chatId, m.text, m.buttons.length ? m.buttons : undefined);
            item.Notified_At = now.toISOString();
            notified++;
        }
        await ref.set(item);
    }
    await updateEmailAccount(uid, { History_ID: page.historyId });
    return notified;
}

/** Svi povezani sandučići (sat). Greška jednog ne zaustavlja ostale. */
export async function syncAllMailboxes(now = new Date()): Promise<number> {
    const snap = await adminDb().collection(COLLECTIONS.EMAIL_ACCOUNTS).get();
    let total = 0;
    for (const doc of snap.docs) {
        try {
            total += await syncMailbox(doc.data() as EmailAccount, now);
        } catch (e) {
            console.error('[mail] sinhronizacija', doc.id, e instanceof Error ? e.message : e);
        }
    }
    return total;
}
