// ════════════════════════════════════════════════════════════════════
// POVEZIVANJE TELEGRAMA S ERP NALOGOM (Postavke → Telegram asistent)
//
//   GET     stanje: je li bot podešen i je li ovaj korisnik povezan
//   POST    novi jednokratni kod (10 min) + t.me link koji ga šalje botu
//   DELETE  prekini vezu
//
// Veza nosi uid i orgId iz TOKENA — Telegram poruka ih nikad ne bira.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { createLinkCode, getLinkByUid, unlinkUid } from '@/lib/assistant/store';
import { botUsername, isTelegramConfigured } from '@/lib/telegram/api';
import { errorResponse, requireStaff } from '@/lib/server/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const caller = await requireStaff(req);
        const link = await getLinkByUid(caller.uid);
        return NextResponse.json({
            configured: isTelegramConfigured(),
            linked: link ? { telegramName: link.telegramName, linkedAt: link.linkedAt } : null,
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function POST(req: Request) {
    try {
        const caller = await requireStaff(req);
        if (!isTelegramConfigured()) {
            return NextResponse.json({ error: 'Telegram bot nije podešen na serveru (TELEGRAM_BOT_TOKEN).' }, { status: 503 });
        }
        const { code, expiresAt } = await createLinkCode(caller.uid, caller.orgId);
        const username = await botUsername();
        return NextResponse.json({
            code,
            expiresAt,
            botUsername: username,
            deepLink: username ? `https://t.me/${username}?start=${code}` : null,
        });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function DELETE(req: Request) {
    try {
        const caller = await requireStaff(req);
        await unlinkUid(caller.uid);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return errorResponse(e);
    }
}
