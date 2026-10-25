// ════════════════════════════════════════════════════════════════════
// SAT ASISTENTA — dospjeli podsjetnici, jutarnji pregled (s rupama u
// upisu rada) i večernji prijedlog rada.
//
// Poziva ga Cloudflare Worker svake minute (tools/cloudflare-cron) s
// `Authorization: Bearer <CRON_SECRET>`. Isti oblik zaglavlja šalje i
// Vercel Cron, pa radi i bez Cloudflarea ako se ikad pređe na Vercel Pro.
// Poziv je idempotentan: poslan podsjetnik gubi `Reminder_Pending`.
// ════════════════════════════════════════════════════════════════════

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assistantTimezone } from '@/lib/assistant/datetime';
import { sendDayProposals, sendDueReminders, sendMorningDigests } from '@/lib/assistant/reminders';
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
        const proposals = await sendDayProposals(now, tz);
        return NextResponse.json({ ok: true, ...reminders, digests, proposals, at: now.toISOString() });
    } catch (e) {
        return errorResponse(e);
    }
}

export const GET = tick;
export const POST = tick;
