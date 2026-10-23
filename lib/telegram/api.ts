// ════════════════════════════════════════════════════════════════════
// TELEGRAM BOT API — tanki omotač oko fetch-a, bez biblioteke.
//
// Treba nam desetak poziva (poruka, dugmad, „piše…", preuzimanje glasovne
// poruke), pa biblioteka nije vrijedna zavisnosti. Token je u
// TELEGRAM_BOT_TOKEN i nikad ne izlazi u log ni u odgovor.
// ════════════════════════════════════════════════════════════════════

const API = 'https://api.telegram.org';
const TIMEOUT_MS = 15_000;

export class TelegramNotConfiguredError extends Error {
    constructor() {
        super('Telegram bot nije podešen — nedostaje TELEGRAM_BOT_TOKEN.');
        this.name = 'TelegramNotConfiguredError';
    }
}

function token(): string {
    const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!t) throw new TelegramNotConfiguredError();
    return t;
}

export function isTelegramConfigured(): boolean {
    return !!process.env.TELEGRAM_BOT_TOKEN?.trim();
}

export async function tg<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${API}/bot${token()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !data?.ok) {
        throw new Error(`Telegram ${method}: ${data?.description || res.status}`);
    }
    return data.result as T;
}

/** Dugme u poruci. `data` je najviše 64 bajta (ograničenje Telegrama). */
export interface InlineButton {
    text: string;
    data: string;
}

export type ButtonRows = InlineButton[][];

function keyboard(rows?: ButtonRows) {
    if (!rows?.length) return undefined;
    return {
        inline_keyboard: rows.map(r => r.map(b => ({ text: b.text, callback_data: b.data.slice(0, 64) }))),
    };
}

/** Telegram odbija poruke duže od 4096 znakova — dugi odgovori se režu. */
const MAX_TEXT = 4000;

export async function sendMessage(chatId: number | string, text: string, buttons?: ButtonRows): Promise<{ message_id: number }> {
    return tg('sendMessage', {
        chat_id: chatId,
        text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
        reply_markup: keyboard(buttons),
        link_preview_options: { is_disabled: true },
    });
}

export async function editMessageText(chatId: number | string, messageId: number, text: string, buttons?: ButtonRows): Promise<void> {
    try {
        await tg('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: text.slice(0, MAX_TEXT),
            reply_markup: keyboard(buttons) || { inline_keyboard: [] },
        });
    } catch (e) {
        // „message is not modified" nije greška za korisnika.
        if (!String((e as Error)?.message).includes('not modified')) throw e;
    }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await tg('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) }).catch(() => undefined);
}

/** „piše…" iznad chata dok se obrađuje — nestaje samo za ~5 s ili s odgovorom. */
export async function sendTyping(chatId: number | string): Promise<void> {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
}

/** Preuzmi fajl (glasovnu poruku) po file_id. Bot API daje do 20 MB. */
export async function downloadFile(fileId: string): Promise<{ buffer: Buffer; path: string }> {
    const file = await tg<{ file_path?: string }>('getFile', { file_id: fileId });
    if (!file.file_path) throw new Error('Telegram getFile: nema putanje');
    const res = await fetch(`${API}/file/bot${token()}/${file.file_path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Telegram preuzimanje: ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), path: file.file_path };
}

let cachedUsername: string | null = null;

/** Korisničko ime bota (za t.me link u Postavkama). */
export async function botUsername(): Promise<string | null> {
    if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
    if (cachedUsername) return cachedUsername;
    try {
        const me = await tg<{ username?: string }>('getMe');
        cachedUsername = me.username || null;
    } catch {
        cachedUsername = null;
    }
    return cachedUsername;
}
