// ════════════════════════════════════════════════════════════════════
// SAT ASISTENTA — dospjeli podsjetnici, jutarnji pregled (s rupama u
// upisu rada), termini 10:30 i 14:30 (lib/assistant/slotRun.ts), kapije
// materijala i pošta. Poslije 15:00 bot sam šalje samo zadane podsjetnike.
//
// Poziva ga Cloudflare Worker svake minute (tools/cloudflare-cron) s
// `Authorization: Bearer <CRON_SECRET>`. Isti oblik zaglavlja šalje i
// Vercel Cron, pa radi i bez Cloudflarea ako se ikad pređe na Vercel Pro.
// Poziv je idempotentan: poslan podsjetnik gubi `Reminder_Pending`.
// ════════════════════════════════════════════════════════════════════

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assistantTimezone, toZoned } from '@/lib/assistant/datetime';
import { sendDueReminders, sendMorningDigests } from '@/lib/assistant/reminders';
import { sendSlots } from '@/lib/assistant/slotRun';
import { inNoticeWindow } from '@/lib/assistant/slots';
import { sendMaterialAlerts } from '@/lib/assistant/materialAlerts';
import { checkBounces } from '@/lib/server/emailDrafts';
import { flushMailNotices, syncAllMailboxes } from '@/lib/server/mailSync';
import { sendMailDigests, sendMailFollowUps } from '@/lib/server/mailFollow';
import { errorResponse } from '@/lib/server/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
    const expected = process.env.CRON_SECRET?.trim();
    const header = req.headers.get('authorization') || '';
    if (!expected || !header.startsWith('Bearer ')) return false;
    const a = Buffer.from(header.slice(7).trim());
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

async function tick(req: Request) {
    if (!authorized(req)) return NextResponse.json({ error: 'Neovlašteno.' }, { status: 401 });
    try {
        const now = new Date();
        const tz = assistantTimezone();
        const reminders = await sendDueReminders(now, tz);
        const digests = await sendMorningDigests(now, tz);
        // Termini 10:30 i 14:30: jedna poruka-spisak (narudžbe, obilazak, upis dana). Večernji prijedlog je ukinut.
        const slots = await sendSlots(now, tz).catch(e => { console.error('[tick] termini:', e); return 0; });
        // Sve što bot javlja sam (materijal, pošta) ide samo u prvih 15 min termina — bez zvonjenja tokom dana.
        const local = toZoned(now, tz);
        const notices = inNoticeWindow(local.hour * 60 + local.minute);
        const materials = notices
            ? await sendMaterialAlerts(now, tz).catch(e => { console.error('[tick] kapije materijala:', e); return 0; })
            : 0;
        // Vraćeni mailovi (svakih 5 min) — isto ne smije ugasiti ostatak sata.
        const bounces = now.getUTCMinutes() % 5 === 0
            ? await checkBounces(now).catch(e => { console.error('[tick] vraćeni mailovi:', e); return 0; })
            : 0;
        // Ulazna pošta se čita svake 2 min (bot je vidi odmah), ali obavijest čeka termin.
        const mail = now.getUTCMinutes() % 2 === 1
            ? await syncAllMailboxes(now).catch(e => { console.error('[tick] ulazna pošta:', e); return 0; })
            : 0;
        const mailNotices = notices
            ? await flushMailNotices(now).catch(e => { console.error('[tick] obavijesti pošte:', e); return 0; })
            : 0;
        const followUps = notices && now.getUTCMinutes() % 5 === 2
            ? await sendMailFollowUps(now, tz).catch(e => { console.error('[tick] podsjetnici pošte:', e); return 0; })
            : 0;
        const mailDigests = notices && now.getUTCMinutes() % 10 === 4
            ? await sendMailDigests(now, tz).catch(e => { console.error('[tick] sažetak pošte:', e); return 0; })
            : 0;
        return NextResponse.json({ ok: true, ...reminders, digests, slots, materials, bounces, mail, mailNotices, followUps, mailDigests, at: now.toISOString() });
    } catch (e) {
        return errorResponse(e);
    }
}

export const GET = tick;
export const POST = tick;
