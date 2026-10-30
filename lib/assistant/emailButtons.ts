// ════════════════════════════════════════════════════════════════════
// NACRTI MAILOVA U TELEGRAMU — prikaz i dugmad (em:<id>:s|e|x|t<n>)
//
// Bot nikad ne šalje sam: alat napravi nacrt, ovdje se prikaže s dugmadima,
// a Gmail se zove tek na „📤 Pošalji". „✏️ Izmijeni tekst" čeka sljedeću
// poruku (15 min) i ona postaje tekst maila — bez modela, tačno kako je napisana.
// ════════════════════════════════════════════════════════════════════

import {
    awaitDraftText, cancelDraft, chooseRecipient, draftAwaitingText, DraftError, getDraft, sendDraft, setDraftText,
} from '@/lib/server/emailDrafts';
import { GmailError } from '@/lib/server/gmail';
import { answerCallbackQuery, editMessageText, sendMessage } from '@/lib/telegram/api';
import { draftMessage, EDIT_PROMPT, sentMessage } from './emailText';
import type { AssistantLink } from './store';

export async function sendDraftToChat(chatId: number, link: AssistantLink, draftId: string): Promise<void> {
    const d = await getDraft(link.orgId, link.uid, draftId);
    const m = draftMessage(d);
    await sendMessage(chatId, m.text, m.buttons);
}

function problem(e: unknown): string {
    if (e instanceof GmailError) {
        return e.code === 'not-connected' || e.code === 'reconnect' || e.code === 'not-configured'
            ? `${e.message} Postavke → Kontakti u ERP-u.`
            : `Gmail nije prihvatio mail: ${e.message}`;
    }
    if (e instanceof DraftError) return e.message;
    console.error('[email] dugme nacrta', e);
    return 'Nešto nije uspjelo — pokušaj ponovo ili pošalji iz ERP-a (Narudžbe → Pošalji emailom).';
}

export async function handleEmailButton(
    inc: { chatId: number; messageId: number; callbackId: string },
    link: AssistantLink,
    draftId: string,
    action: string,
): Promise<void> {
    try {
        if (action === 's') {
            await answerCallbackQuery(inc.callbackId, 'Šaljem…');
            const d = await getDraft(link.orgId, link.uid, draftId);
            const res = await sendDraft(link.orgId, link.uid, draftId);
            await editMessageText(inc.chatId, inc.messageId, sentMessage(d, res), []);
            return;
        }
        if (action === 'x') {
            await cancelDraft(link.orgId, link.uid, draftId);
            await answerCallbackQuery(inc.callbackId, 'Otkazano');
            await editMessageText(inc.chatId, inc.messageId, '✖ Nacrt maila je otkazan — ništa nije poslano.', []);
            return;
        }
        if (action === 'e') {
            await awaitDraftText(link.orgId, link.uid, draftId);
            await answerCallbackQuery(inc.callbackId);
            await sendMessage(inc.chatId, EDIT_PROMPT);
            return;
        }
        if (action.startsWith('t')) {
            const d = await chooseRecipient(link.orgId, link.uid, draftId, Number(action.slice(1)));
            await answerCallbackQuery(inc.callbackId, `Kome: ${d.To[0]?.name || d.To[0]?.email}`);
            const m = draftMessage(d);
            await editMessageText(inc.chatId, inc.messageId, m.text, m.buttons);
            return;
        }
        await answerCallbackQuery(inc.callbackId);
    } catch (e) {
        const text = problem(e);
        await answerCallbackQuery(inc.callbackId, text.slice(0, 190)).catch(() => undefined);
        await sendMessage(inc.chatId, `⚠️ ${text}`);
    }
}

/**
 * Poruka poslije „Izmijeni tekst": postaje tekst nacrta i bot pokaže novi nacrt.
 * Vraća true kad je poruka potrošena (ne ide modelu).
 */
export async function consumeDraftText(chatId: number, link: AssistantLink, text: string): Promise<boolean> {
    const waiting = await draftAwaitingText(link.orgId, link.uid);
    if (!waiting || !text.trim()) return false;
    try {
        const d = await setDraftText(link.orgId, link.uid, waiting.Draft_ID, text);
        const m = draftMessage(d);
        await sendMessage(chatId, m.text, m.buttons);
    } catch (e) {
        await sendMessage(chatId, `⚠️ ${problem(e)}`);
    }
    return true;
}
