// ════════════════════════════════════════════════════════════════════
// PODSJETNICI I SAŽETAK POŠTE (sat) — bez AI-ja
//
//   sendMailFollowUps   dospjeli podsjetnici (Next_Follow_At ≤ sada), samo
//                       7–20 h; „spremno" se samo zatvori kad je narudžba
//                       u međuvremenu primljena
//   sendMailDigests     svaka 3 dana ujutro (7–11 h): završeno / čeka odgovor /
//                       spremno a nije preuzeto / gradilište
//   handleFollowButton  mf:<messageId>:d (riješeno) | s (sutra) | x (ne podsjećaj)
//   openMailFor         /posta — sve otvoreno s dugmadima
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import { updateEmailAccount, type EmailAccount } from './gmail';
import { receiveOrderItems } from './orderWrites';
import { inboxRef } from './mailSync';
import { digestText, followMessage, nextFollowAt, openList } from '@/lib/email/followUp';
import { toZoned } from '@/lib/assistant/datetime';
import { getLinkByUid } from '@/lib/assistant/store';
import { answerCallbackQuery, editMessageText, sendMessage, type ButtonRows } from '@/lib/telegram/api';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { MailInboxItem, Order } from '@/lib/types';

const DAY = 86_400_000;
const QUIET = { from: 7, until: 20 };
const DIGEST = { from: 7, until: 11, everyDays: 3 };

async function ordersOf(orgId: string): Promise<Map<string, Order>> {
    const snap = await adminDb().collection(COLLECTIONS.ORDERS).where('Organization_ID', '==', orgId).get();
    return new Map(snap.docs.map(d => [(d.data() as Order).Order_ID, d.data() as Order]));
}

/** Dospjeli podsjetnici. Vraća broj poslanih. */
export async function sendMailFollowUps(now: Date, tz: string): Promise<number> {
    const hour = toZoned(now.toISOString(), tz).hour;
    if (hour < QUIET.from || hour >= QUIET.until) return 0;
    const snap = await adminDb().collection(COLLECTIONS.MAIL_INBOX).where('Next_Follow_At', '<=', now.toISOString()).get();
    let sent = 0;
    const orders = new Map<string, Map<string, Order>>();
    for (const doc of snap.docs) {
        const item = doc.data() as MailInboxItem;
        if (!item.Follow || item.Done_At) {
            await doc.ref.set({ Next_Follow_At: null }, { merge: true });
            continue;
        }
        if (!orders.has(item.Organization_ID)) orders.set(item.Organization_ID, await ordersOf(item.Organization_ID));
        const byId = orders.get(item.Organization_ID)!;
        // Spremno, a narudžba je u međuvremenu primljena (ERP ili bot) — nema šta podsjećati.
        if (item.Follow === 'pickup' && item.Order_IDs.length && item.Order_IDs.every(id => byId.get(id)?.Status === 'Primljeno')) {
            await doc.ref.set({ Done_At: now.toISOString(), Done_How: 'received', Next_Follow_At: null }, { merge: true });
            continue;
        }
        const link = await getLinkByUid(item.Owner_UID);
        const count = item.Follow_Count || 0;
        if (link) {
            const m = followMessage(item, now, id => byId.get(id)?.Order_Number);
            await sendMessage(link.chatId, m.text, m.buttons);
            sent++;
        }
        await doc.ref.set({ Follow_Count: count + 1, Next_Follow_At: nextFollowAt(item.Received_At, item.Follow, count + 1) }, { merge: true });
    }
    return sent;
}

/** Sažetak svaka 3 dana, ujutro. Vraća broj poslanih. */
export async function sendMailDigests(now: Date, tz: string): Promise<number> {
    const hour = toZoned(now.toISOString(), tz).hour;
    if (hour < DIGEST.from || hour >= DIGEST.until) return 0;
    const accounts = await adminDb().collection(COLLECTIONS.EMAIL_ACCOUNTS).get();
    let sent = 0;
    for (const doc of accounts.docs) {
        const account = doc.data() as EmailAccount;
        const last = account.Mail_Digest_At ? Date.parse(account.Mail_Digest_At) : 0;
        // Malo manje od 3 dana, da ne klizi po satima.
        if (last && now.getTime() - last < DIGEST.everyDays * DAY - 6 * 3_600_000) continue;
        if (!last) {
            // Prvi put samo zapamti početak — sažetak ide za 3 dana.
            await updateEmailAccount(account.UID, { Mail_Digest_At: now.toISOString() });
            continue;
        }
        try {
            const since = new Date(last);
            const snap = await adminDb().collection(COLLECTIONS.MAIL_INBOX).where('Owner_UID', '==', account.UID).get();
            const items = snap.docs.map(d => d.data() as MailInboxItem).filter(i => i.Organization_ID === account.Organization_ID);
            const text = digestText(items, since, now);
            const link = await getLinkByUid(account.UID);
            if (text && link) {
                await sendMessage(link.chatId, text);
                sent++;
            }
        } catch (e) {
            console.error('[mail] sažetak', account.UID, e);
        }
        await updateEmailAccount(account.UID, { Mail_Digest_At: now.toISOString() });
    }
    return sent;
}

/** /posta: otvoreno u pošti s dugmetom po stavci. */
export async function openMailFor(uid: string, orgId: string, now = new Date()): Promise<{ text: string; buttons: ButtonRows }> {
    const snap = await adminDb().collection(COLLECTIONS.MAIL_INBOX).where('Owner_UID', '==', uid).get();
    return openList(snap.docs.map(d => d.data() as MailInboxItem).filter(i => i.Organization_ID === orgId), now);
}

/** Dugmad podsjetnika: d = riješeno (preuzeto prima narudžbu), s = sutra, x = ne podsjećaj. */
export async function handleFollowButton(
    inc: { chatId: number; messageId: number; callbackId: string; messageText?: string },
    link: { uid: string; orgId: string },
    messageId: string,
    action: string,
    now = new Date(),
): Promise<void> {
    const ref = inboxRef(link.uid, messageId);
    const snap = await ref.get();
    const item = snap.exists ? (snap.data() as MailInboxItem) : null;
    if (!item || item.Organization_ID !== link.orgId) {
        await answerCallbackQuery(inc.callbackId, 'Ovaj mail više nije u ERP-u.');
        return;
    }
    if (item.Done_At) {
        await answerCallbackQuery(inc.callbackId, 'Već riješeno.');
        await editMessageText(inc.chatId, inc.messageId, `${inc.messageText || ''}\n→ već riješeno`.trim(), []);
        return;
    }
    const at = now.toISOString();
    if (action === 's') {
        await ref.set({ Next_Follow_At: new Date(now.getTime() + DAY).toISOString() }, { merge: true });
        await answerCallbackQuery(inc.callbackId, 'Podsjetiću te sutra');
        await editMessageText(inc.chatId, inc.messageId, `${inc.messageText || ''}\n→ ⏰ sutra opet`.trim(), []);
        return;
    }
    if (action === 'x') {
        await ref.set({ Done_At: at, Done_How: 'stopped', Next_Follow_At: null }, { merge: true });
        await answerCallbackQuery(inc.callbackId, 'Bez podsjetnika');
        await editMessageText(inc.chatId, inc.messageId, `${inc.messageText || ''}\n→ 🔕 bez podsjetnika`.trim(), []);
        return;
    }
    // d: riješeno. Preuzeto s jednom poslanom narudžbom — prijem i u ERP-u.
    let note = '✅ riješeno';
    if (item.Follow === 'pickup' && item.Order_IDs.length === 1) {
        const res = await receiveOrderItems(link.orgId, item.Order_IDs[0], 'all');
        note = res.ok ? `📦 preuzeto — narudžba ${res.orderNumber} primljena` : `✅ preuzeto (narudžba: ${res.error})`;
        await ref.set({ Done_At: at, Done_How: 'received', Next_Follow_At: null, State: 'applied', Applied: note }, { merge: true });
    } else {
        await ref.set({ Done_At: at, Done_How: 'button', Next_Follow_At: null }, { merge: true });
    }
    await answerCallbackQuery(inc.callbackId, 'Riješeno');
    await editMessageText(inc.chatId, inc.messageId, `${inc.messageText || ''}\n→ ${note}`.trim(), []);
}
