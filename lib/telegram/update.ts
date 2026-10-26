// ════════════════════════════════════════════════════════════════════
// TELEGRAM UPDATE → jedan oblik koji ostatak koda razumije.
//
// Čista funkcija (bez mreže) da se može testirati: poruka, glasovna poruka,
// proslijeđena poruka (radnikov izvještaj), komanda ili pritisak dugmeta.
// Sve što nije privatni chat se ignoriše — bot ne radi u grupama.
// ════════════════════════════════════════════════════════════════════

export interface TgUser {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
}

interface TgFile {
    file_id: string;
    mime_type?: string;
    duration?: number;
    file_size?: number;
}

export interface TgMessage {
    message_id: number;
    date: number;
    chat: { id: number; type: string; title?: string };
    from?: TgUser;
    text?: string;
    caption?: string;
    voice?: TgFile;
    audio?: TgFile;
    forward_origin?: {
        type: 'user' | 'hidden_user' | 'chat' | 'channel';
        date: number;
        sender_user?: TgUser;
        sender_user_name?: string;
        sender_chat?: { title?: string };
        chat?: { title?: string };
    };
    // Stari oblik (prije Bot API 7.0) — neki klijenti ga još šalju.
    forward_from?: TgUser;
    forward_sender_name?: string;
    forward_date?: number;
    reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] };
}

export interface TgCallbackQuery {
    id: string;
    from: TgUser;
    data?: string;
    message?: TgMessage;
}

export interface TgUpdate {
    update_id: number;
    message?: TgMessage;
    callback_query?: TgCallbackQuery;
}

export interface IncomingPerson {
    id: number;
    name: string;
}

export type Incoming =
    | {
        type: 'message';
        updateId: number;
        chatId: number;
        from: IncomingPerson;
        messageId: number;
        /** Tekst ili opis uz medij; prazan za glasovnu poruku dok se ne transkribuje. */
        text: string;
        voice?: { fileId: string; mime: string; duration: number };
        /** Proslijeđena poruka: od koga i kad je izvorno poslana. */
        forward?: { from: string; date: string };
        command?: { name: string; arg: string };
    }
    | {
        type: 'callback';
        updateId: number;
        chatId: number;
        from: IncomingPerson;
        callbackId: string;
        data: string;
        messageId: number;
        messageText: string;
        /** Dugmad poruke na kojoj je pritisnuto (da se ostala zadrže pri izmjeni). */
        buttons?: { text: string; data: string }[][];
    }
    | { type: 'ignored'; updateId: number; reason: string; chatId?: number };

export function personName(u: TgUser | undefined): string {
    if (!u) return '';
    const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return full || (u.username ? `@${u.username}` : String(u.id));
}

function forwardOf(m: TgMessage): { from: string; date: string } | undefined {
    const o = m.forward_origin;
    if (o) {
        const from = o.type === 'user' ? personName(o.sender_user)
            : o.type === 'hidden_user' ? (o.sender_user_name || 'nepoznat')
                : (o.sender_chat?.title || o.chat?.title || 'kanal');
        return { from, date: new Date(o.date * 1000).toISOString() };
    }
    if (m.forward_from || m.forward_sender_name || m.forward_date) {
        return {
            from: m.forward_from ? personName(m.forward_from) : (m.forward_sender_name || 'nepoznat'),
            date: new Date((m.forward_date || m.date) * 1000).toISOString(),
        };
    }
    return undefined;
}

/** „/start ABC123" → { name: 'start', arg: 'ABC123' }; „/danas@moj_bot" → 'danas'. */
export function parseCommand(text: string): { name: string; arg: string } | undefined {
    const m = text.trim().match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
    if (!m) return undefined;
    return { name: m[1].toLowerCase(), arg: (m[2] || '').trim() };
}

export function normalizeUpdate(u: TgUpdate): Incoming {
    if (u.callback_query) {
        const q = u.callback_query;
        const chat = q.message?.chat;
        if (!chat || chat.type !== 'private') return { type: 'ignored', updateId: u.update_id, reason: 'not-private' };
        return {
            type: 'callback',
            updateId: u.update_id,
            chatId: chat.id,
            from: { id: q.from.id, name: personName(q.from) },
            callbackId: q.id,
            data: q.data || '',
            messageId: q.message?.message_id || 0,
            messageText: q.message?.text || '',
            buttons: q.message?.reply_markup?.inline_keyboard?.map(r => r.map(b => ({ text: b.text, data: b.callback_data || '' }))),
        };
    }

    const m = u.message;
    if (!m) return { type: 'ignored', updateId: u.update_id, reason: 'no-message' };
    if (m.chat.type !== 'private') return { type: 'ignored', updateId: u.update_id, reason: 'not-private', chatId: m.chat.id };
    if (!m.from || m.from.is_bot) return { type: 'ignored', updateId: u.update_id, reason: 'bot', chatId: m.chat.id };

    const text = (m.text ?? m.caption ?? '').trim();
    const media = m.voice || m.audio;
    const forward = forwardOf(m);
    if (!text && !media) return { type: 'ignored', updateId: u.update_id, reason: 'unsupported', chatId: m.chat.id };

    return {
        type: 'message',
        updateId: u.update_id,
        chatId: m.chat.id,
        from: { id: m.from.id, name: personName(m.from) },
        messageId: m.message_id,
        text,
        ...(media ? {
            voice: {
                fileId: media.file_id,
                mime: media.mime_type || 'audio/ogg',
                duration: media.duration || 0,
            },
        } : {}),
        ...(forward ? { forward } : {}),
        // Proslijeđeni tekst koji počinje kosom crtom nije komanda za bota.
        ...(!forward && text.startsWith('/') ? { command: parseCommand(text) } : {}),
    };
}
