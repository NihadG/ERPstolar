// ════════════════════════════════════════════════════════════════════
// TELEGRAM → ASISTENT
//
// Jedan update = jedna od ovih stvari:
//   /start KOD          povezivanje s ERP nalogom (kod iz Postavki)
//   /danas /otvoreno    brzi pregledi bez AI-ja
//   tekst / glas        → dnevnik (assistant_entries) → mozak → odgovor
//   proslijeđena poruka isto, ali uz „od koga i kad" (radnikov izvještaj)
//   dugme               odgovor na pitanje, ↩️ Poništi, ✅ Urađeno, ⏰ odgodi,
//                       prijedlog dana (dp:), rupa iz jutarnjeg pregleda (gap:),
//                       provjera materijala (mc:), narudžba stigla (ordrcv:)
//   /prijedlog          prijedlog rada za danas na zahtjev
//
// Nepovezan Telegram korisnik ne dobija ništa osim uputstva za povezivanje.
// ════════════════════════════════════════════════════════════════════

import { setTaskStatus, taskRef } from '@/lib/server/fieldWrites';
import { receiveOrderItems, sendOrder } from '@/lib/server/orderWrites';
import {
    answerCallbackQuery, downloadFile, editMessageText, sendMessage, sendTyping, tg,
} from '@/lib/telegram/api';
import { sendOrderPdf } from './orderDocuments';
import { handleMaterialButton, sendMaterialAlerts, setOrderReceivedDaysAgo, setOrderSentDaysAgo } from './materialAlerts';
import { normalizeUpdate, type Incoming, type TgUpdate } from '@/lib/telegram/update';
import { transcribeAudio } from '@/lib/voice/transcribeServer';
import { runAssistant, runPendingAction, type AssistantTurnOutput } from './brain';
import { memoryButtonState } from './tools';
import { loadNames } from './context';
import { assistantTimezone, formatReminder, toZoned } from './datetime';
import { createProposalMessage, handleProposalButton } from './dayProposals';
import { shortDate } from './dayProposalText';
import { isIsoDate } from '@/lib/voice/dates';
import { buildOpenMemory, buildTodayDigest } from './digest';
import { snoozeUntil } from './reminders';
import {
    addEntry, claimUpdate, consumeLinkCode, getEntry, getLinkByTelegramId,
    getSession, recordEntryOutcome, saveSession, undoTurn, type AssistantLink, type AssistantSession,
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
    '• „Svi su prisutni", „Kerim bolovanje" → šihtarica (dnevnice kao u aplikaciji)\n' +
    '• „Amer i Kerim krojili iveral za kuhinju Čorluka, Edin kantirao — završio" → Knjiga rada\n' +
    '• „Sve za Čorluku osim vrata je gotovo" → procesi (dan zadnjeg rada iz Knjige rada)\n' +
    '• „Dokle je kuhinja Čorluka?" → stanje naloga\n' +
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
    input: { text: string; forward?: { from: string; date: string }; entryId?: string; heard?: string; session?: AssistantSession; now?: Date },
): Promise<AssistantTurnOutput> {
    const started = Date.now();
    const session = input.session || await getSession(chatId);
    const out = await runAssistant({
        orgId: link.orgId,
        uid: link.uid,
        text: input.text,
        forward: input.forward,
        entryId: input.entryId,
        session,
        ...(input.now ? { now: input.now } : {}),
    });
    // Prvo odgovor korisniku, pa spremanje — sesija i dnevnik ne trebaju da ga čekaju.
    const prefix = input.heard ? `🎙 „${input.heard}"\n\n` : '';
    await deliver(link, chatId, out, input.entryId, prefix);
    console.log(`[assistant] odgovor za ${Date.now() - started} ms`);
    return out;
}

/** Odgovor u Telegram, pa sesija, dnevnik, PDF-ovi i kapije materijala — isto za poruku i za dugme. */
async function deliver(link: AssistantLink, chatId: number, out: AssistantTurnOutput, entryId: string | undefined, prefix = ''): Promise<void> {
    await sendMessage(chatId, prefix + out.reply, out.buttons);
    await Promise.all([
        saveSession(chatId, out.session),
        entryId
            ? recordEntryOutcome(entryId, {
                outcome: out.outcome || (out.changed ? 'written' : 'answer'), reply: out.reply, changes: out.changes || [],
                taskIds: out.created.taskIds, memoryIds: Array.from(new Set(out.created.memoryIds)),
            })
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
    // Upisan rad može pomjeriti nalog do kapije (počelo okivanje, a ručke nisu stigle).
    if (out.changed) {
        await sendMaterialAlerts(new Date(), assistantTimezone(), { orgId: link.orgId })
            .catch(e => console.error('[assistant] kapije materijala:', e));
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

    // ERP-ovo pitanje (nalog, proces, materijal): izbor završava upis bez modela.
    if (kind === 'act') {
        const session = await getSession(inc.chatId);
        const answer = session.pending?.action ? session.pending.options[Number(arg)] : undefined;
        if (!answer) {
            await answerCallbackQuery(inc.callbackId, 'Pitanje je isteklo — napiši odgovor porukom.');
            return;
        }
        await answerCallbackQuery(inc.callbackId);
        // Ostala dugmad pitanja nestaju; ↩️ Poništi za ono što je već upisano ostaje.
        await editMessageText(inc.chatId, inc.messageId, `${inc.messageText}\n→ ${answer}`, inc.buttons?.filter(row => row.every(b => !b.data.startsWith('act:'))));
        await sendTyping(inc.chatId);
        const out = await runPendingAction({ orgId: link.orgId, uid: link.uid, session, choice: Number(arg) });
        await deliver(link, inc.chatId, out, session.pending?.entryId);
        return;
    }

    // „Kad je naručeno?" / „Kad je stiglo?" uz prijem: datumi za rok isporuke dobavljača.
    if (kind === 'ordd' || kind === 'rcvd') {
        const days = Number(extra);
        if (!Number.isFinite(days) || days < 0 || days > 120) {
            await answerCallbackQuery(inc.callbackId);
            return;
        }
        const ok = kind === 'ordd'
            ? await setOrderSentDaysAgo(link.orgId, arg, days, tz)
            : await setOrderReceivedDaysAgo(link.orgId, arg, days, tz);
        await answerCallbackQuery(inc.callbackId, ok ? 'Zabilježeno' : 'Narudžba više ne postoji.');
        if (ok) await editMessageText(inc.chatId, inc.messageId, inc.messageText, inc.buttons?.filter(row => !row.some(b => b.data === inc.data)));
        return;
    }

    // Stanje stavke bilježnice jednim dodirom — bez modela, bez tokena.
    if (kind === 'mem') {
        const result = await memoryButtonState(link.orgId, link.uid, arg, extra === 'f' ? 'fali' : 'postavljeno');
        await answerCallbackQuery(inc.callbackId, result.ok ? 'Sačuvano' : result.error);
        if (result.ok) await editMessageText(inc.chatId, inc.messageId, `${inc.messageText}\n→ ${result.line}`, inc.buttons?.filter(row => row.every(b => b.data !== inc.data)));
        return;
    }

    // „Pokušaj ponovo": ista poruka iz dnevnika, obrađena iznova (nije upisano / AI nije radio).
    if (kind === 'retry') {
        const entry = await getEntry(arg);
        if (!entry || entry.Owner_UID !== link.uid || entry.Organization_ID !== link.orgId) {
            await answerCallbackQuery(inc.callbackId, 'Poruka više ne postoji.');
            return;
        }
        if (entry.Outcome === 'written') {
            await answerCallbackQuery(inc.callbackId, 'Ova poruka je već upisana.');
            return;
        }
        await answerCallbackQuery(inc.callbackId, 'Obrađujem ponovo…');
        await tg('editMessageReplyMarkup', { chat_id: inc.chatId, message_id: inc.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
        await sendTyping(inc.chatId);
        await reprocessEntry(link, entry.Entry_ID);
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
            await sendMessage(inc.chatId, `📤 Narudžba ${result.orderNumber} je poslana — materijali se sad vode kao naručeni.`,
                [[{ text: '📦 Stiglo sve', data: `ordrcv:${arg}` }]]);
        }
        return;
    }

    if (kind === 'ordrcv') {
        const result = await receiveOrderItems(link.orgId, arg, 'all');
        await answerCallbackQuery(inc.callbackId, result.ok ? 'Primljeno' : result.error);
        await tg('editMessageReplyMarkup', { chat_id: inc.chatId, message_id: inc.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
        if (result.ok) {
            await sendMessage(inc.chatId, `📦 Narudžba ${result.orderNumber} je stigla${result.detail ? ` (${result.detail})` : ''} — materijali su na stanju.`);
        }
        return;
    }

    // Provjera materijala (kapije): označavanje, potvrda, narudžba — bez modela.
    if (kind === 'mc') {
        const reply = await handleMaterialButton(link, arg, extra, inc.data.split(':')[3] || '', tz);
        await answerCallbackQuery(inc.callbackId, reply.toast);
        if (reply.text) await editMessageText(inc.chatId, inc.messageId, reply.text, reply.buttons);
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

/**
 * Ponovna obrada poruke iz dnevnika (dugme „Pokušaj ponovo" ili ERP → Poruke botu).
 * Tumači se kao da je rečena tada (datum poruke), a odgovor stiže na Telegram
 * s ↩️ Poništi, kao i svaki drugi upis.
 */
export async function reprocessEntry(link: AssistantLink, entryId: string): Promise<{ ok: true; outcome: string; reply: string } | { ok: false; error: string }> {
    const entry = await getEntry(entryId);
    if (!entry || entry.Owner_UID !== link.uid || entry.Organization_ID !== link.orgId) return { ok: false, error: 'Poruka ne postoji.' };
    if (entry.Outcome === 'written') return { ok: false, error: 'Ova poruka je već upisana.' };
    const out = await converse(link, link.chatId, {
        text: entry.Raw_Text, entryId: entry.Entry_ID, now: new Date(entry.Created_At),
        ...(entry.Forward_From && entry.Forward_Date ? { forward: { from: entry.Forward_From, date: entry.Forward_Date } } : {}),
    });
    return { ok: true, outcome: out.outcome || 'answer', reply: out.reply };
}
