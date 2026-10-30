// ════════════════════════════════════════════════════════════════════
// DUGMAD ULAZNE POŠTE (mx:<messageId>:<radnja>) — upis u ERP tek na klik
//
//   c      predračun → narudžba (Supplier_Doc, Confirmed_At) + nacrt odgovora
//          „Potvrđujem…" u istoj niti (šalje se tek dugmetom nacrta)
//   l<n>   samo veži dokument na narudžbu n
//   r<n>   spremno + preuzeto danas (postojeći prijem cijele narudžbe)
//   y<n>   samo zabilježi da je spremno (Ready_At — tačniji rok dobavljača)
//   v<n>   račun → narudžba (Invoice)
//   n      tekst maila ide botu kao proslijeđena poruka (Bilježnica, zadaci)
//   i      zanemari
// ════════════════════════════════════════════════════════════════════

import { adminDb } from '@/lib/server/firebaseAdmin';
import { getMessageFull, GmailError } from '@/lib/server/gmail';
import { createReplyDraft, DraftError } from '@/lib/server/emailDrafts';
import { receiveOrderItems } from '@/lib/server/orderWrites';
import { inboxRef } from '@/lib/server/mailSync';
import { plainTextOf } from '@/lib/email/classify';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import { answerCallbackQuery, editMessageText, sendMessage } from '@/lib/telegram/api';
import { sendDraftToChat } from './emailButtons';
import type { AssistantLink } from './store';
import type { MailInboxItem, Order } from '@/lib/types';

async function orderDoc(orgId: string, orderId: string) {
    const snap = await adminDb().collection(COLLECTIONS.ORDERS).where('Organization_ID', '==', orgId).where('Order_ID', '==', orderId).limit(1).get();
    return snap.empty ? null : snap.docs[0];
}

export interface MailButtonResult {
    /** Tekst maila za bota (radnja „n"). */
    forward?: { text: string; from: string; date: string };
}

export async function handleMailButton(
    inc: { chatId: number; messageId: number; callbackId: string; messageText?: string },
    link: AssistantLink,
    messageId: string,
    action: string,
): Promise<MailButtonResult> {
    const ref = inboxRef(link.uid, messageId);
    const snap = await ref.get();
    const item = snap.exists ? (snap.data() as MailInboxItem) : null;
    if (!item || item.Organization_ID !== link.orgId) {
        await answerCallbackQuery(inc.callbackId, 'Ovaj mail više nije u ERP-u.');
        return {};
    }
    if (item.State !== 'new') {
        await answerCallbackQuery(inc.callbackId, item.State === 'applied' ? `Već urađeno: ${item.Applied || ''}`.slice(0, 190) : 'Već zanemareno.');
        return {};
    }

    const done = async (applied: string, state: MailInboxItem['State'] = 'applied', closeFollow = true) => {
        const close = closeFollow && item.Follow && !item.Done_At
            ? { Done_At: new Date().toISOString(), Done_How: state === 'dismissed' ? 'dismissed' : action.startsWith('r') ? 'received' : 'applied', Next_Follow_At: null }
            : {};
        await ref.set({ State: state, Applied: applied, ...close }, { merge: true });
        await editMessageText(inc.chatId, inc.messageId, `${inc.messageText || ''}\n→ ${applied}`.trim(), []);
    };

    try {
        if (action === 'i') {
            await answerCallbackQuery(inc.callbackId, 'Zanemareno');
            await done('zanemareno', 'dismissed');
            return {};
        }

        if (action === 'n') {
            await answerCallbackQuery(inc.callbackId, 'Čitam mail…');
            const full = await getMessageFull(link.uid, item.Message_ID);
            const body = plainTextOf(full?.payload) || item.Snippet;
            await done('poslano botu na obradu');
            return { forward: { text: `${item.Subject}\n${body}`, from: item.From_Name, date: item.Received_At } };
        }

        const n = Number(action.slice(1)) || 0;
        const orderId = item.Order_IDs[action === 'c' ? 0 : n];
        const doc = orderId ? await orderDoc(link.orgId, orderId) : null;
        if (!doc) {
            await answerCallbackQuery(inc.callbackId, 'Narudžba više ne postoji.');
            return {};
        }
        const order = doc.data() as Order;
        const now = new Date().toISOString();

        if (action === 'c' || action.startsWith('l')) {
            await doc.ref.set({
                Supplier_Doc: { No: item.Doc_No || '', Date: item.Received_At, Message_ID: item.Message_ID, Kind: item.Doc_Kind || 'ponuda' },
                ...(action === 'c' ? { Confirmed_At: now } : {}),
            }, { merge: true });
            const what = `${item.Doc_Kind === 'predracun' ? 'predračun' : 'ponuda'}${item.Doc_No ? ` ${item.Doc_No}` : ''}`;
            if (action === 'c') {
                const draft = await createReplyDraft({
                    orgId: link.orgId, uid: link.uid, to: { name: item.From_Name, email: item.From },
                    subject: item.Subject, text: `Potvrđujem ${what}. Može u proizvodnju.`,
                    threadId: item.Thread_ID, inReplyTo: item.Rfc_Message_ID, source: 'telegram',
                });
                await answerCallbackQuery(inc.callbackId, 'Vezano — odgovor je ispod');
                await done(`✔ ${what} vezan na ${order.Order_Number}; odgovor čeka tvoj klik ispod`, 'applied', false);
                await sendDraftToChat(inc.chatId, link, draft.Draft_ID);
                return {};
            }
            await answerCallbackQuery(inc.callbackId, 'Vezano');
            await done(`✔ ${what} vezan na ${order.Order_Number}`);
            return {};
        }

        if (action.startsWith('r') || action.startsWith('y')) {
            await doc.ref.set({ Ready_At: item.Received_At }, { merge: true });
            if (action.startsWith('r')) {
                const res = await receiveOrderItems(link.orgId, orderId, 'all');
                if (!res.ok) {
                    await answerCallbackQuery(inc.callbackId, res.error.slice(0, 190));
                    await done(`🕒 spremno zabilježeno na ${order.Order_Number}; prijem nije uspio: ${res.error}`);
                    return {};
                }
                await answerCallbackQuery(inc.callbackId, 'Primljeno');
                await done(`📦 ${order.Order_Number} preuzeta danas — materijali su na stanju`);
                return {};
            }
            await answerCallbackQuery(inc.callbackId, 'Zabilježeno');
            await done(`🕒 ${order.Order_Number}: spremno za preuzimanje (rok dobavljača se uči od ovog dana); podsjetiću te da preuzmeš`, 'applied', false);
            return {};
        }

        if (action.startsWith('v')) {
            await doc.ref.set({ Invoice: { No: item.Doc_No || '', Date: item.Received_At, Message_ID: item.Message_ID } }, { merge: true });
            await answerCallbackQuery(inc.callbackId, 'Vezano');
            await done(`🧾 račun${item.Doc_No ? ` ${item.Doc_No}` : ''} vezan na ${order.Order_Number}`);
            return {};
        }

        await answerCallbackQuery(inc.callbackId);
        return {};
    } catch (e) {
        const text = e instanceof GmailError || e instanceof DraftError ? e.message : 'Nešto nije uspjelo — pokušaj ponovo.';
        if (!(e instanceof GmailError || e instanceof DraftError)) console.error('[mail] dugme', e);
        await answerCallbackQuery(inc.callbackId, text.slice(0, 190)).catch(() => undefined);
        await sendMessage(inc.chatId, `⚠️ ${text}`);
        return {};
    }
}
