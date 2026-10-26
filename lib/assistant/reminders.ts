// ════════════════════════════════════════════════════════════════════
// SLANJE PODSJETNIKA — poziva ga /api/assistant/tick (Cloudflare cron,
// svake minute).
//
// Upit je samo `Reminder_Pending == true` (automatski indeks, bez
// kompozitnog): podsjetnika na čekanju je malo, pa se vrijeme filtrira u
// memoriji. Podsjetnik ide korisniku koji je zadatak napravio
// (`Created_By_UID`) — svako dobija svoje, ne tuđe.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from '@/lib/server/firebaseAdmin';
import { sendMessage, type ButtonRows } from '@/lib/telegram/api';
import { addDays } from '@/lib/voice/dates';
import { toZoned, zonedToUtcMs } from './datetime';
import { buildTodayDigest } from './digest';
import { createProposalMessage, gapsForDigest, isWorkingDayFor } from './dayProposals';
import { materialDigest } from './materialAlerts';
import { getLinkByUid, listLinks, setDigestDate, setProposalDate, type AssistantLink } from './store';
import type { Task } from '@/lib/types';

const BATCH = 50;
/** Jutarnji pregled: od 07:00, ali ne kasnije od 11:00 (pregled u podne nema smisla). */
const DIGEST_FROM_HOUR = 7;
const DIGEST_UNTIL_HOUR = 11;
/** Večernji prijedlog rada: 16:30–20:00 (u minutama od ponoći). */
const PROPOSAL_FROM_MIN = 16 * 60 + 30;
const PROPOSAL_UNTIL_MIN = 20 * 60;

export function reminderButtons(taskId: string): ButtonRows {
    return [
        [{ text: '✅ Urađeno', data: `done:${taskId}` }],
        [{ text: '⏰ Za sat', data: `snz:${taskId}:1h` }, { text: '🌅 Sutra u 8', data: `snz:${taskId}:tm` }],
    ];
}

export function reminderText(t: Task): string {
    const lines = [`⏰ ${t.Title}`];
    if (t.Description) lines.push(t.Description);
    const project = t.Links?.find(l => l.Entity_Type === 'project');
    if (project) lines.push(`📁 ${project.Entity_Name}`);
    if (t.Assigned_Worker_Name) lines.push(`👷 ${t.Assigned_Worker_Name}`);
    const pending = (t.Checklist || []).filter(c => !c.completed);
    if (pending.length) lines.push(...pending.slice(0, 8).map(c => `☐ ${c.text}`));
    return lines.join('\n');
}

/** Novo vrijeme za „odgodi": za sat ili sutra u 08:00 po lokalnom vremenu. */
export function snoozeUntil(kind: string, now: Date, tz: string): Date {
    if (kind === 'tm') return new Date(zonedToUtcMs(addDays(toZoned(now, tz).date, 1), 8, 0, tz));
    return new Date(now.getTime() + 60 * 60_000);
}

export async function sendDueReminders(now: Date, tz: string): Promise<{ sent: number; skipped: number }> {
    const snap = await adminDb().collection('tasks').where('Reminder_Pending', '==', true).get();
    const nowIso = now.toISOString();
    const due = snap.docs
        .filter(d => String(d.data().Reminder_At || '') <= nowIso)
        .slice(0, BATCH);

    const links = new Map<string, AssistantLink | null>();
    const linkFor = async (uid: string) => {
        if (!links.has(uid)) links.set(uid, await getLinkByUid(uid));
        return links.get(uid) || null;
    };

    let sent = 0, skipped = 0;
    for (const doc of due) {
        const t = doc.data() as Task;
        if (t.Status === 'completed' || t.Status === 'cancelled') {
            await doc.ref.update({ Reminder_Pending: false });
            continue;
        }
        const link = t.Created_By_UID ? await linkFor(t.Created_By_UID) : null;
        if (!link || link.orgId !== t.Organization_ID) {
            // Autor nema Telegram — ne pokušavaj svake minute.
            await doc.ref.update({ Reminder_Pending: false, Reminder_Sent_At: nowIso, Reminder_Skipped: 'no-telegram' });
            skipped++;
            continue;
        }
        try {
            await sendMessage(link.chatId, reminderText(t), reminderButtons(t.Task_ID));
            await doc.ref.update({ Reminder_Pending: false, Reminder_Sent_At: nowIso });
            sent++;
        } catch (e) {
            // Ostaje na čekanju — sljedeći tick pokušava ponovo.
            console.error('[reminders] slanje nije uspjelo:', t.Task_ID, e);
        }
    }
    return { sent, skipped };
}

export async function sendMorningDigests(now: Date, tz: string): Promise<number> {
    const local = toZoned(now, tz);
    if (local.hour < DIGEST_FROM_HOUR || local.hour >= DIGEST_UNTIL_HOUR) return 0;

    let sent = 0;
    for (const link of await listLinks()) {
        if (link.digestDate === local.date) continue;
        // Datum se upisuje i kad nema šta poslati — da se ne provjerava svake minute.
        await setDigestDate(link.telegramUserId, local.date);
        try {
            // Rupe u upisu rada idu u isti pregled; njihova greška ne smije ugasiti zadatke.
            const [digest, gaps, material] = await Promise.all([
                buildTodayDigest(link.orgId, now, tz),
                gapsForDigest(link.orgId, local.date).catch(e => { console.error('[reminders] rupe nisu izračunate:', e); return null; }),
                materialDigest(link.orgId, local.date).catch(e => { console.error('[reminders] materijal nije izračunat:', e); return null; }),
            ]);
            if (!digest && !gaps && !material) continue;
            await sendMessage(link.chatId, ['Dobro jutro ☀️', digest, material, gaps?.text].filter(Boolean).join('\n\n'), gaps?.buttons);
            sent++;
        } catch (e) {
            console.error('[reminders] jutarnji pregled nije poslan:', e);
        }
    }
    return sent;
}

/**
 * Večernji prijedlog rada: radnim danom od 16:30 do 20:00, jednom dnevno.
 * Subota/nedjelja samo kad je neko po šihtarici radio. Prazan prijedlog se ne šalje.
 */
export async function sendDayProposals(now: Date, tz: string): Promise<number> {
    const local = toZoned(now, tz);
    const minutes = local.hour * 60 + local.minute;
    if (minutes < PROPOSAL_FROM_MIN || minutes >= PROPOSAL_UNTIL_MIN) return 0;

    let sent = 0;
    for (const link of await listLinks()) {
        if (link.proposalDate === local.date) continue;
        await setProposalDate(link.telegramUserId, local.date);
        try {
            if (!(await isWorkingDayFor(link.orgId, local.date))) continue;
            const msg = await createProposalMessage(link, local.date, local.date);
            if (!msg) continue;
            await sendMessage(link.chatId, msg.text, msg.buttons);
            sent++;
        } catch (e) {
            console.error('[reminders] večernji prijedlog nije poslan:', e);
        }
    }
    return sent;
}

