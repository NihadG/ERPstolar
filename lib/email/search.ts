// ════════════════════════════════════════════════════════════════════
// PRETRAGA POŠTE NA ZAHTJEV — Gmail upit i kratki redovi za bota (čisto)
//
// Bez vektorske baze: Gmail već ima dobru pretragu. ERP od onoga što je
// korisnik rekao (riječi, osoba iz Kontakata, projekat) složi Gmail upit,
// a nađene poruke vrati kao kratke redove. Cijeli tekst jedne poruke čita
// se tek na zahtjev. Sadržaj maila je podatak, nikad naredba.
//
// Učitavanje je u lib/server/mailSearch.ts.
// ════════════════════════════════════════════════════════════════════

import { parseMailbox } from './addresses';

export type MailDirection = 'in' | 'out' | 'all';

export interface MailSearch {
    /** Riječi iz naslova ili teksta („predračun ogledala"). */
    words?: string;
    /** Adrese osoba (od njih ili njima). */
    addresses?: string[];
    /** Fraza koja može stajati umjesto adresa (naziv projekta). */
    phrase?: string;
    /** Koliko dana unazad. */
    days?: number;
    direction?: MailDirection;
    attachment?: boolean;
}

export const DEFAULT_DAYS = 120;
export const MAX_DAYS = 730;

/** Riječ bez Gmail sintakse: korisnikov tekst ne smije postati operator (from:, OR, zagrade). */
function cleanTerm(t: string): string {
    return t.replace(/[{}()"<>:\\*]/g, ' ').replace(/^-+/, '').trim();
}

function terms(text: string): string[] {
    return text.split(/\s+/).map(cleanTerm).filter(t => t && !/^(or|and|around)$/i.test(t)).slice(0, 8);
}

const email = (a: string) => /^[^\s@{}()"<>:]+@[^\s@{}()"<>:]+\.[a-z]{2,}$/i.test(a) ? a.toLowerCase() : '';

/** Gmail upit; prazan string znači da nema po čemu tražiti. */
export function gmailQuery(s: MailSearch): string {
    const parts: string[] = [];
    const words = terms(s.words || '');
    const addresses = Array.from(new Set((s.addresses || []).map(email).filter(Boolean))).slice(0, 12);
    const phrase = terms(s.phrase || '').join(' ');
    if (!words.length && !addresses.length && !phrase) return '';

    parts.push(...words);
    const who: string[] = [];
    if (addresses.length) {
        if (s.direction !== 'out') who.push(...addresses.map(a => `from:${a}`));
        if (s.direction !== 'in') who.push(...addresses.map(a => `to:${a}`), ...addresses.map(a => `cc:${a}`));
    }
    if (phrase) who.push(`"${phrase}"`);
    if (who.length === 1) parts.push(who[0]);
    else if (who.length) parts.push(`{${who.join(' ')}}`);

    if (s.direction === 'out') parts.push('in:sent');
    else if (s.direction === 'in') parts.push('-in:sent');
    if (s.attachment) parts.push('has:attachment');
    const days = Math.min(MAX_DAYS, Math.max(1, Math.round(s.days || DEFAULT_DAYS)));
    parts.push(`newer_than:${days}d`);
    // Promocije i društvene mreže nikad nisu ono što se traži.
    parts.push('-category:promotions', '-category:social');
    return parts.join(' ');
}

export interface FoundMail {
    id: string;
    threadId: string;
    /** ISO vrijeme. */
    at: string;
    from: string;
    to: string;
    subject: string;
    snippet: string;
    sent: boolean;
    attachment: boolean;
}

const dayOf = (iso: string, zone: (iso: string) => string) => {
    const d = zone(iso);
    return `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}`;
};

function who(raw: string): string {
    const first = raw.split(',')[0] || '';
    const m = parseMailbox(first);
    if (!m) return first.trim().slice(0, 60);
    return m.name ? `${m.name} <${m.email}>` : m.email;
}

/** Gmail isječak dolazi s HTML entitetima („&#39;", „&quot;"). */
export function unescapeSnippet(s: string): string {
    return s.replace(/&#(\d{2,6});/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
}

/**
 * Jedan red po poruci, najnovije prvo:
 * „• 28.10.2026 · od Merima K. <…> · „RAMA Predracun 330421" · 📎 · isječak… [id 18f…]".
 */
export function foundMailLines(mails: FoundMail[], zone: (iso: string) => string): string[] {
    return [...mails]
        .sort((a, b) => b.at.localeCompare(a.at))
        .map(m => {
            const dir = m.sent ? `ti → ${who(m.to)}` : `od ${who(m.from)}`;
            const snip = unescapeSnippet(m.snippet);
            return [
                `• ${dayOf(m.at, zone)}`,
                dir,
                `„${(m.subject || '(bez naslova)').trim().slice(0, 120)}"`,
                m.attachment ? '📎' : '',
                snip ? `${snip.slice(0, 160)}${snip.length > 160 ? '…' : ''}` : '',
            ].filter(Boolean).join(' · ') + ` [id ${m.id}]`;
        });
}

/** Poruka ima prilog: multipart/mixed (Gmail metapodaci ne daju imena priloga). */
export function hasAttachmentHeader(contentType: string | undefined): boolean {
    return /multipart\/mixed/i.test(contentType || '');
}

export interface MailPart {
    filename?: string;
    mimeType?: string;
    parts?: MailPart[];
}

/** Imena priloga iz pune poruke. */
export function attachmentNames(payload: MailPart | undefined): string[] {
    const out: string[] = [];
    const walk = (p?: MailPart) => {
        if (!p) return;
        if (p.filename) out.push(p.filename);
        (p.parts || []).forEach(walk);
    };
    walk(payload);
    return out;
}
