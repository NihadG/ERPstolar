// ════════════════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK
//
// Telegram šalje svaki update ovdje, s tajnom u zaglavlju
// `X-Telegram-Bot-Api-Secret-Token` (postavlja je scripts/telegram-set-webhook.mjs).
// Bez tačne tajne → 401, ništa se ne čita.
//
// Odgovor je uvijek 200 čim je tajna tačna: na grešku Telegram ponavlja isti
// update, a ponavljanje bi se ionako odbilo (assistant_updates). Korisnik
// umjesto tišine dobija poruku da nešto nije prošlo.
// ════════════════════════════════════════════════════════════════════

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/lib/assistant/telegramHandler';
import { sendMessage } from '@/lib/telegram/api';
import type { TgUpdate } from '@/lib/telegram/update';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Glasovna poruka = preuzimanje + transkripcija + nekoliko krugova modela.
export const maxDuration = 60;

function secretMatches(given: string | null): boolean {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!expected || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
    if (!secretMatches(req.headers.get('x-telegram-bot-api-secret-token'))) {
        return NextResponse.json({ error: 'Neovlašteno.' }, { status: 401 });
    }

    const update = await req.json().catch(() => null) as TgUpdate | null;
    if (!update || typeof update.update_id !== 'number') return NextResponse.json({ ok: true });

    try {
        await handleTelegramUpdate(update);
    } catch (e) {
        console.error('[telegram] obrada nije uspjela:', e);
        const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
        if (chatId) {
            await sendMessage(chatId, '⚠️ Nešto nije prošlo na serveru. Poruka je možda sačuvana u dnevnik — pokušaj ponovo.').catch(() => undefined);
        }
    }
    return NextResponse.json({ ok: true });
}
