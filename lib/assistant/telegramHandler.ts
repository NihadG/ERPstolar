// ════════════════════════════════════════════════════════════════════
// TELEGRAM → ASISTENT
//
// Jedan update = jedna od ovih stvari:
//   /start KOD          povezivanje s ERP nalogom (kod iz Postavki)
//   /danas /otvoreno    brzi pregledi bez AI-ja
//   tekst / glas        → dnevnik (assistant_entries) → mozak → odgovor
//   proslijeđena poruka isto, ali uz „od koga i kad" (radnikov izvještaj)
//   dugme               odgovor na pitanje, ↩️ Poništi, ✅ Urađeno, ⏰ odgodi
//
// Nepovezan Telegram korisnik ne dobija ništa osim uputstva za povezivanje.
// ════════════════════════════════════════════════════════════════════

import { setTaskStatus, taskRef } from '@/lib/server/fieldWrites';
import { sendOrder } from '@/lib/server/orderWrites';
import {
    answerCallbackQuery, downloadFile, editMessageText, sendMessage, sendTyping, tg,
} from '@/lib/telegram/api';
import { sendOrderPdf } from './orderDocuments';
import { normalizeUpdate, type Incoming, type TgUpdate } from '@/lib/telegram/update';
import { transcribeAudio } from '@/lib/voice/transcribeServer';
import { runAssistant } from './brain';
import { loadNames } from './context';
import { assistantTimezone, formatReminder } from './datetime';
import { buildOpenMemory, buildTodayDigest } from './digest';
import { snoozeUntil } from './reminders';
import {
    addEntry, attachEntryResults, claimUpdate, consumeLinkCode, getLinkByTelegramId,
    getSession, saveSession, undoTurn, type AssistantLink,
} from './store';
import type { Task } from '@/lib/types';

const HOW_TO_LINK =
    'Zdravo! Ovaj bot je lični asistent za ERP.\n\n' +
    'Da ga povežeš s nalogom: u aplikaciji otvori Postavke → Telegram asistent → „Poveži", ' +
    'pa pošalji ovdje kod koji dobiješ (ili klikni link).';

const HELP =
    'Šta mi možeš poslati (glasom ili tekstom):\n' +
    '• „U ponedjeljak naručiti 10 baglama" → podsjetnik u ponedjeljak u 8:00\n' +
    '• „Napomeni me da kažem Ameru da povuče ogledala u kombi"\n' +
    '• „U stanu 304 imam 3 ogledala od 1 m" → bilježnica\n' +
    '• Proslijeđenu poruku radnika → ažuriram stanje\n' +
    '• Pitanje: „Gdje sve imam nemontirana ogledala?"\n' +
    '• „Naruči 5 baglama za Stan 304" → narudžba (nacrt) + PDF\n' +
    '• „Pošalji mi PDF zadnje narudžbe za Begovića"\n\n' +
    'Komande: /danas · /otvoreno · /pomoc';

type MessageIncoming = Extract<Incoming, { type: 'message' }>;
type CallbackIncoming = Extract<Incoming, { type: 'callback' }>;

export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
    const inc = normalizeUpdate(update);
    if (inc.type === 'ignored') {
        if (inc.reason === 'unsupported' && inc.chatId && await claimUpdate(inc.updateId)) {
            await sendMessage(inc.chatId, 'Za sada primam tekst i glasovne poruke.');
        }
        return;
    }
    // Telegram ponavlja webhook kad odgovor kasni — drugi put se ništa ne radi.
    if (!(await claimUpdate(inc.updateId))) return;

    const link = await getLinkByTelegramId(inc.from.id);

    if (inc.type === 'message' && inc.command?.name === 'start') {
        if (inc.command.arg) {
            const linked = await consumeLinkCode(inc.command.arg, { id: inc.from.id, name: inc.from.name, chatId: inc.chatId });
            await sendMessage(inc.chatId, linked
                ? `✅ Povezano! Sve što mi pošalješ ide u tvoj ERP.\n\n${HELP}`
                : '❌ Kod nije važeći ili je istekao (vrijedi 10 minuta). Napravi novi u Postavkama.');
            return;
        }
        await sendMessage(inc.chatId, link ? HELP : HOW_TO_LINK);
        return;
    }
    if (!link) {
        if (inc.type === 'callback') await answerCallbackQuery(inc.callbackId);
        await sendMessage(inc.chatId, HOW_TO_LINK);
        return;
    }

    if (inc.type === 'callback') return handleCallback(inc, link);
    if (inc.command) return handleCommand(inc, link);
    return handleMessage(inc, link);
}

async function handleCommand(inc: MessageIncoming, link: AssistantLink): Promise<void> {
    const tz = assistantTimezone();
    switch (inc.command?.name) {
        case 'danas': {
            const digest = await buildTodayDigest(link.orgId, new Date(), tz);
            await sendMessage(inc.chatId, digest || 'Za danas nema podsjetnika ni zadataka, a ništa ne kasni. 👍');
            return;
        }
        case 'otvoreno':
            await sendMessage(inc.chatId, await buildOpenMemory(link.orgId, link.uid));
            return;
        default:
            await sendMessage(inc.chatId, HELP);
    }
}

async function handleMessage(inc: MessageIncoming, link: AssistantLink): Promise<void> {
    await sendTyping(inc.chatId);

    let text = inc.text;
    let heard = '';
    if (inc.voice) {
        const [names, file] = await Promise.all([loadNames(link.orgId), downloadFile(inc.voice.fileId)]);
        const result = await transcribeAudio({ buffer: file.buffer, mime: inc.voice.mime, names });
        if (!result.ok) {
            await sendMessage(inc.chatId, `🎙 ${result.error}`);
            return;
        }
        heard = result.text;
        text = [result.text, inc.text].filter(Boolean).join('\n');
        await sendTyping(inc.chatId);
    }

    const entryId = await addEntry({
        Organization_ID: link.orgId,
        Owner_UID: link.uid,
        Channel: 'telegram',
        Kind: inc.forward ? 'forward' : inc.voice ? 'voice' : 'text',
        Raw_Text: text,
        Forward_From: inc.forward?.from,
        Forward_Date: inc.forward?.date,
        Telegram_File_ID: inc.voice?.fileId,
    });

    await converse(link, inc.chatId, { text, forward: inc.forward, entryId, heard });
}

async function converse(
    link: AssistantLink,
    chatId: number,
    input: { text: string; forward?: { from: string; date: string }; entryId?: string; heard?: string },
): Promise<void> {
    const session = await getSession(chatId);
    const out = await runAssistant({
        orgId: link.orgId,
        uid: link.uid,
        text: input.text,
        forward: input.forward,
        entryId: input.entryId,
        session,
    });
    await saveSession(chatId, out.session);
    const prefix = input.heard ? `🎙 „${input.heard}"\n\n` : '';
    await sendMessage(chatId, prefix + out.reply, out.buttons);
    for (const doc of out.documents || []) {
        try {
            await sendOrderPdf(chatId, link.orgId, doc.orderId, doc.draft);
        } catch (e) {
            console.error('[assistant] PDF narudžbe pao:', e);
            await sendMessage(chatId, '📄 Narudžba je sačuvana, ali PDF nije uspio. Otvori je u ERP-u → Narudžbe.');
        }
    }
    if (input.entryId) {
        await attachEntryResults(input.entryId, out.created.taskIds, Array.from(new Set(out.created.memoryIds)));
    }
}

async function handleCallback(inc: CallbackIncoming, link: AssistantLink): Promise<void> {
    const [kind, arg, extra] = inc.data.split(':');
    const tz = assistantTimezone();

    if (kind === 'opt') {
        const session = await getSession(inc.chatId);
        const answer = session.pending?.options[Number(arg)];
        if (!answer) {
            await answerCallbackQuery(inc.callbackId, 'Pitanje je isteklo — napiši odgovor porukom.');
            return;
        }
        await answerCallbackQuery(inc.callbackId);
        await editMessageText(inc.chatId, inc.messageId, `${inc.messageText}\n→ ${answer}`);
        await sendTyping(inc.chatId);
        await converse(link, inc.chatId, { text: answer, entryId: session.pending?.entryId });
        return;
    }

    if (kind === 'undo') {
        const undone = await undoTurn(arg, link.uid);
        await answerCallbackQuery(inc.callbackId, undone.length ? 'Poništeno' : 'Već poništeno');
        if (undone.length) await editMessageText(inc.chatId, inc.messageId, `${inc.messageText}\n\n↩️ Poništeno: ${undone.join(', ')}`);
        return;
    }

    if (kind === 'ordsent') {
        const result = await sendOrder(link.orgId, arg);
        await answerCallbackQuery(inc.callbackId, result.ok ? 'Narudžba je poslana' : result.error);
        await tg('editMessageReplyMarkup', { chat_id: inc.chatId, message_id: inc.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
        if (result.ok) {
            await sendMessage(inc.chatId, `📤 Narudžba ${result.orderNumber} je poslana — materijali se sad vode kao naručeni.`);
        }
        return;
    }

    if (kind === 'done' || kind === 'snz') {
        let ref;
        try {
            ref = await taskRef(link.orgId, arg);
        } catch {
            await answerCallbackQuery(inc.callbackId, 'Zadatak više ne postoji.');
            return;
        }
        const task = (await ref.get()).data() as Task;
        if (kind === 'done') {
            await setTaskStatus(link.orgId, arg, true);
            await answerCallbackQuery(inc.callbackId, 'Označeno kao urađeno');
            await editMessageText(inc.chatId, inc.messageId, `✅ Urađeno: ${task.Title}`);
            return;
        }
        const until = snoozeUntil(extra, new Date(), tz);
        await ref.update({ Reminder_At: until.toISOString(), Reminder_Pending: true });
        const label = formatReminder(until.toISOString(), tz);
        await answerCallbackQuery(inc.callbackId, `Podsjetiću te ${label}`);
        await editMessageText(inc.chatId, inc.messageId, `⏰ ${task.Title}\n→ odgođeno za ${label}`);
        return;
    }

    await answerCallbackQuery(inc.callbackId);
}
