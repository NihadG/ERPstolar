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
    /** Domeni firmi („rama-glas.com") — svi ljudi iz firme, i nove niti. */
    domains?: string[];
    /** Ime bez adrese („merima") — Gmail ga traži u zaglavljima Od/Za. */
    names?: string[];
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

// ── Padeži (31.10.): „staklo za Dinu" → mail „Narudzba stakala - Dino Kuća".
// Gmail traži tačnu riječ, pa ERP riječ proširi na njene oblike:
// osnova bez padežnog nastavka + česti nastavci, i nepostojano a
// („stakl-o" → „stakala"). Šifre i brojevi („A406", „2257x110") ostaju tačni.

const ENDINGS = ['ima', 'ama', 'om', 'em', 'a', 'e', 'i', 'o', 'u'];
const FORMS = ['', 'a', 'e', 'i', 'o', 'u', 'om', 'ima'];

/** Oblici jedne riječi; riječ koja nije obična (šifra, broj, kratka) → samo ona. */
export function wordForms(word: string): string[] {
    const w = word.toLowerCase();
    if (w.length < 4 || !/^[a-zčćšžđ]+$/.test(w)) return [word];
    const end = ENDINGS.find(e => w.endsWith(e) && w.length - e.length >= 3);
    const stem = end ? w.slice(0, -end.length) : w;
    const forms = FORMS.map(f => stem + f);
    // Nepostojano a u genitivu množine: stakl → stakala, ogledal → (ništa).
    if (/[^aeiou][lrnkmtvd]$/.test(stem) && !/(nj|lj|dž)$/.test(stem)) forms.push(`${stem.slice(0, -1)}a${stem.slice(-1)}a`);
    return Array.from(new Set([w, ...forms]));
}

function wordTerm(word: string): string {
    const forms = wordForms(word);
    return forms.length === 1 ? forms[0] : `{${forms.join(' ')}}`;
}

const email = (a: string) => /^[^\s@{}()"<>:]+@[^\s@{}()"<>:]+\.[a-z]{2,}$/i.test(a) ? a.toLowerCase() : '';
const domain = (d: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(d) ? d.toLowerCase() : '';
const name = (n: string) => cleanTerm(n).split(/\s+/)[0].toLowerCase();

/** Gmail upit; prazan string znači da nema po čemu tražiti. */
export function gmailQuery(s: MailSearch): string {
    const parts: string[] = [];
    const words = terms(s.words || '');
    const addresses = Array.from(new Set((s.addresses || []).map(email).filter(Boolean))).slice(0, 12);
    // Adresa iz domena već pokrivenog domenom ne treba posebno.
    const domains = Array.from(new Set((s.domains || []).map(domain).filter(Boolean))).slice(0, 4);
    const people = [...addresses.filter(a => !domains.includes(a.slice(a.indexOf('@') + 1))), ...domains];
    const names = Array.from(new Set((s.names || []).map(name).filter(n => n.length >= 3))).slice(0, 3);
    const phrase = terms(s.phrase || '').join(' ');
    if (!words.length && !people.length && !names.length && !phrase) return '';

    parts.push(...words.map(wordTerm));
    const who: string[] = [];
    const sides = [...people, ...names];
    if (sides.length) {
        if (s.direction !== 'out') who.push(...sides.map(a => `from:${a}`));
        if (s.direction !== 'in') who.push(...sides.map(a => `to:${a}`), ...people.map(a => `cc:${a}`));
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
