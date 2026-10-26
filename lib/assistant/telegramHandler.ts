// ════════════════════════════════════════════════════════════════════
// TELEGRAM → ASISTENT
//
// Jedan update = jedna od ovih stvari:
//   /start KOD          povezivanje s ERP nalogom (kod iz Postavki)
//   /danas /otvoreno    brzi pregledi bez AI-ja
//   tekst / glas        → dnevnik (assistant_entries) → mozak → odgovor
//   proslijeđena poruka isto, ali uz „od koga i kad" (radnikov izvještaj)
//   dugme               odgovor na pitanje, ↩️ Poništi, ✅ Urađeno, ⏰ odgodi,
//                       prijedlog dana (dp:), rupa iz jutarnjeg pregleda (gap:)
//   /prijedlog          prijedlog rada za danas na zahtjev
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
import { memoryButtonState } from './tools';
import { loadNames } from './context';
import { assistantTimezone, formatReminder, toZoned } from './datetime';
import { createProposalMessage, handleProposalButton } from './dayProposals';
import { shortDate } from './dayProposalText';
import { isIsoDate } from '@/lib/voice/dates';
import { buildOpenMemory, buildTodayDigest } from './digest';
import { snoozeUntil } from './reminders';
import {
    addEntry, attachEntryResults, claimUpdate, consumeLinkCode, getLinkByTelegramId,
    getSession, saveSession, undoTurn, type AssistantLink, type AssistantSession,
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
    '• „Amer i Kerim krojili iveral za kuhinju Čorluka, Edin kantirao — završio" → dnevni rad\n' +
    '• „Pošalji mi PDF zadnje narudžbe za Begovića"\n\n' +
    'Radnim danom u 16:30 stiže prijedlog rada za taj dan — potvrdiš ga jednim klikom.\n\n' +
    'Komande: /danas · /otvoreno · /prijedlog · /pomoc';

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
    // Veza se čita usporedo: svaki krug do baze je vrijeme koje korisnik čeka.
    const [claimed, link] = await Promise.all([claimUpdate(inc.updateId), getLinkByTelegramId(inc.from.id)]);
    if (!claimed) return;

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
        case 'prijedlog': {
            const today = toZoned(new Date(), tz).date;
            const msg = await createProposalMessage(link, today, today);
            await sendMessage(inc.chatId, msg?.text || 'Nema prijedloga za danas — svi su upisani ili nema ranijeg upisa. Izdiktiraj dan porukom.', msg?.buttons);
            return;
        }
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

    const [entryId, session] = await Promise.all([
        addEntry({
            Organization_ID: link.orgId,
            Owner_UID: link.uid,
            Channel: 'telegram',
            Kind: inc.forward ? 'forward' : inc.voice ? 'voice' : 'text',
            Raw_Text: text,
            Forward_From: inc.forward?.from,
            Forward_Date: inc.forward?.date,
            Telegram_File_ID: inc.voice?.fileId,
        }),
        getSession(inc.chatId),
    ]);

    await converse(link, inc.chatId, { text, forward: inc.forward, entryId, heard, session });
}

async function converse(
    link: AssistantLink,
    chatId: number,
    input: { text: string; forward?: { from: string; date: string }; entryId?: string; heard?: string; session?: AssistantSession },
): Promise<void> {
    const started = Date.now();
    const session = input.session || await getSession(chatId);
    const out = await runAssistant({
        orgId: link.orgId,
        uid: link.uid,
        text: input.text,
        forward: input.forward,
        entryId: input.entryId,
        session,
    });
    // Prvo odgovor korisniku, pa spremanje — sesija i dnevnik ne trebaju da ga čekaju.
    const prefix = input.heard ? `🎙 „${input.heard}"\n\n` : '';
    await sendMessage(chatId, prefix + out.reply, out.buttons);
    console.log(`[assistant] odgovor za ${Date.now() - started} ms`);
    await Promise.all([
        saveSession(chatId, out.session),
        input.entryId
            ? attachEntryResults(input.entryId, out.created.taskIds, Array.from(new Set(out.created.memoryIds)))
            : Promise.resolve(),
        ...(out.documents || []).map(async doc => {
            try {
                await sendOrderPdf(chatId, link.orgId, doc.orderId, doc.draft);
            } catch (e) {
                console.error('[assistant] PDF narudžbe pao:', e);
                await sendMessage(chatId, '📄 Narudžba je sačuvana, ali PDF nije uspio. Otvori je u ERP-u → Narudžbe.');
            }
        }),
    ]);
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

    // Stanje stavke bilježnice jednim dodirom — bez modela, bez tokena.
    if (kind === 'mem') {
        const result = await memoryButtonState(link.orgId, link.uid, arg, extra === 'f' ? 'fali' : 'postavljeno');
        await answerCallbackQuery(inc.callbackId, result.ok ? 'Sačuvano' : result.error);
        if (result.ok) await editMessageText(inc.chatId, inc.messageId, `${inc.messageText}\n→ ${result.line}`, inc.buttons?.filter(row => row.every(b => b.data !== inc.data)));
        return;
    }

    if (kind === 'undo') {
        const undone = await undoTurn(arg, link.uid);
        await answerCallbackQuery(inc.callbackId, undone.length ? 'Poništeno' : 'Već poništeno');
        if (undone.length) await editMessageText(inc.chatId, inc.messageId, `${inc.messageText}\n\n↩️ Poništeno: ${undone.join(', ')}`);
        return;
    }

    if (kind === 'dp') {
        const reply = await handleProposalButton(link, arg, extra, inc.data.split(':')[3] || '', toZoned(new Date(), tz).date);
        await answerCallbackQuery(inc.callbackId, reply?.toast);
        if (reply?.text) await editMessageText(inc.chatId, inc.messageId, reply.text, reply.buttons);
        return;
    }

    if (kind === 'gap') {
        const today = toZoned(new Date(), tz).date;
        if (!isIsoDate(arg) || arg > today) {
            await answerCallbackQuery(inc.callbackId, 'Nepoznat dan.');
            return;
        }
        await answerCallbackQuery(inc.callbackId);
        const msg = await createProposalMessage(link, arg, today);
        await sendMessage(inc.chatId, msg?.text || `Za ${shortDate(arg)} nema prijedloga — nijedan radnik nema raniji upis. Izdiktiraj taj dan porukom.`, msg?.buttons);
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
