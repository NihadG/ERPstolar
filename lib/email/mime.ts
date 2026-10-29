// ════════════════════════════════════════════════════════════════════
// MIME PORUKA ZA GMAIL API (users.messages.send → raw)
//
// Čisto i bez biblioteke: UTF-8 naslov i imena (encoded-word), tekst u
// base64, prilozi u base64 s RFC 2231 imenom fajla („Narudžba … LUXCO.pdf").
// Odgovor u istoj niti nosi In-Reply-To / References.
//
// Svaka vrijednost zaglavlja se čisti od CR/LF — tekst iz modela ili iz
// maila ne smije ubaciti vlastito zaglavlje (Bcc: …).
// ════════════════════════════════════════════════════════════════════

export interface MailAddress {
    name?: string;
    email: string;
}

export interface MailAttachment {
    filename: string;
    contentType: string;
    /** Sirovi bajtovi priloga. */
    data: Uint8Array;
}

export interface MailMessage {
    from?: MailAddress;
    to: MailAddress[];
    cc?: MailAddress[];
    subject: string;
    text: string;
    attachments?: MailAttachment[];
    /** Message-ID poruke na koju se odgovara (`<…@mail.gmail.com>`). */
    inReplyTo?: string;
    references?: string;
}

const CRLF = '\r\n';

/** Bez novih redova i kontrolnih znakova u zaglavlju. */
export function headerSafe(value: string): string {
    return (value || '').replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

const b64 = (bytes: Uint8Array | string) =>
    (typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes)).toString('base64');

/** Base64 u redovima od 76 znakova (RFC 2045). */
export function wrap76(base64: string): string {
    return (base64.match(/.{1,76}/g) || ['']).join(CRLF);
}

/**
 * „Narudžba ogledala" → =?UTF-8?B?…?= ; dugi tekst se dijeli na više riječi
 * (svaka ≤ 75 znakova) i nikad ne cijepa višebajtni znak.
 */
export function encodeWord(text: string): string {
    const clean = headerSafe(text);
    if (isAscii(clean)) return clean;
    const words: string[] = [];
    let chunk = '';
    for (const ch of Array.from(clean)) {
        if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {   // 45 B → 60 znakova base64 + omotač ≤ 75
            words.push(chunk);
            chunk = '';
        }
        chunk += ch;
    }
    if (chunk) words.push(chunk);
    return words.map(w => `=?UTF-8?B?${b64(w)}?=`).join(`${CRLF} `);
}

export function formatMailbox(a: MailAddress): string {
    const email = headerSafe(a.email).replace(/[<>",;\s]/g, '');
    const name = headerSafe(a.name || '').replace(/["\\]/g, '');
    if (!name) return email;
    return isAscii(name) ? `"${name}" <${email}>` : `${encodeWord(name)} <${email}>`;
}

/** Ime fajla za Content-Disposition: ASCII zamjena + puno ime po RFC 2231. */
function filenameParams(filename: string): string {
    const clean = headerSafe(filename).replace(/["\\/]/g, '_') || 'prilog';
    if (isAscii(clean)) return `filename="${clean}"`;
    const fallback = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_');
    return `filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

let counter = 0;
function boundary(): string {
    counter = (counter + 1) % 1e6;
    return `erp_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Cijela poruka kao tekst (RFC 5322), redovi s CRLF. */
export function buildMime(msg: MailMessage, opts: { boundary?: string; date?: Date } = {}): string {
    if (!msg.to.length) throw new Error('Mail nema primaoca.');
    const headers: string[] = [];
    if (msg.from) headers.push(`From: ${formatMailbox(msg.from)}`);
    headers.push(`To: ${msg.to.map(formatMailbox).join(', ')}`);
    if (msg.cc?.length) headers.push(`Cc: ${msg.cc.map(formatMailbox).join(', ')}`);
    headers.push(`Subject: ${encodeWord(msg.subject)}`);
    headers.push(`Date: ${(opts.date || new Date()).toUTCString().replace('GMT', '+0000')}`);
    if (msg.inReplyTo) headers.push(`In-Reply-To: ${headerSafe(msg.inReplyTo)}`);
    if (msg.references || msg.inReplyTo) headers.push(`References: ${headerSafe(msg.references || msg.inReplyTo!)}`);
    headers.push('MIME-Version: 1.0');

    const textPart = [
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(b64(msg.text || '')),
    ].join(CRLF);

    if (!msg.attachments?.length) return [...headers, textPart].join(CRLF);

    const b = opts.boundary || boundary();
    const parts = [textPart, ...msg.attachments.map(att => [
        `Content-Type: ${headerSafe(att.contentType) || 'application/octet-stream'}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; ${filenameParams(att.filename)}`,
        '',
        wrap76(b64(att.data)),
    ].join(CRLF))];

    return [
        ...headers,
        `Content-Type: multipart/mixed; boundary="${b}"`,
        '',
        ...parts.map(p => `--${b}${CRLF}${p}`),
        `--${b}--`,
        '',
    ].join(CRLF);
}

/** Za `raw` polje Gmail API-ja (base64url, bez paddinga). */
export function toBase64Url(text: string): string {
    return Buffer.from(text, 'utf8').toString('base64url');
}
