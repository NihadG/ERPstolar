// ════════════════════════════════════════════════════════════════════
// PORUKA ZA VIBER / WHATSAPP — kartica s gotovim tekstom i dugmadima (čisto)
//
// Bot ne može slati na Viber ni WhatsApp. ERP složi tekst (model ga piše
// korisnikovim stilom, CHAT_STYLE), a dugmad otvore aplikaciju:
//   WhatsApp — wa.me link, razgovor s tim brojem i tekst je već upisan;
//   Viber    — /poruka.html (Telegram ne otvara viber:// linkove): jedan
//              dodir kopira tekst i otvori razgovor, korisnik zalijepi i pošalje.
// Bez mobilnog broja oba linka otvore aplikaciju da korisnik izabere kome.
// „Sutra u 10" je običan podsjetnik (Task.Reminder_At) — kartica stiže tad.
// jest: lib/__tests__/chatMessage.test.ts
// ════════════════════════════════════════════════════════════════════

import type { ButtonRows } from '@/lib/telegram/api';
import type { ChatChannel, TaskChatMessage } from '@/lib/types';

const COUNTRY = '387';
/** Telegram kopira najviše 256 znakova. */
const COPY_MAX = 256;

/**
 * Kako korisnik piše poruke (iz njegovih mailova i poruka, 31.10.2026).
 * Ide u opis alata chat_message — model piše tekst, ERP ga samo očisti.
 */
export const CHAT_STYLE = [
    'Piši kao korisnik: kratko i direktno, kao poruka s telefona, 1–2 rečenice.',
    'Počni imenom u vokativu („Pozdrav Zaime," ili samo „Zaime,"); kad je kontakt na vi: „Pozdrav, kako ste?".',
    'Ti-forma s poznatim ljudima i radnicima („možeš li", „trebaju mi"); vi-forma samo kad je kontakt na vi.',
    'Traži jednostavno: „Možeš li mi poručiti…" (dobavljaču „poručiti", ne „naručiti"), „Treba mi…", „Javi mi…", „Da li su gotova…?"; kratak razlog samo kad je rečen („jer su nam se neka polomila").',
    'Radniku kao kolegi, bez pozdrava: „Harise, sutra dođi u 7."',
    'Kraj: „Hvala." ili „Hvala puno." — bez „Srdačno", potpisa, „Poštovani" i emojija.',
    'Samo ono što je korisnik rekao: količina, projekat i rok tek kad su rečeni; ništa ne izmišljaj.',
].join(' ');

/**
 * Broj u međunarodnom obliku bez + („061 234 567" → „38761234567").
 * null kad to nije broj.
 */
export function normalizePhone(raw: string | undefined | null): string | null {
    const s = String(raw || '').trim();
    if (!s) return null;
    let d = s.replace(/[^\d+]/g, '');
    if (d.startsWith('+')) d = d.slice(1);
    else if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = COUNTRY + d.slice(1);
    d = d.replace(/\D/g, '');
    return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Mobilni broj (Viber i WhatsApp rade samo na mobilnom): BiH 06x; strani brojevi se ne provjeravaju. */
export function isMobile(intl: string): boolean {
    return intl.startsWith(COUNTRY) ? intl.startsWith(`${COUNTRY}6`) : true;
}

const PLAIN: Record<string, string> = { č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'dj', Č: 'C', Ć: 'C', Š: 'S', Ž: 'Z', Đ: 'Dj' };

/** Kvačice: tekst ima ili nema č/ć/š/ž/đ kao korisnikova poruka (kuca bez njih, glas ih ima). */
export function matchDiacritics(message: string, userText: string): string {
    if (/[čćšžđ]/i.test(userText)) return message;
    return message.replace(/[čćšžđČĆŠŽĐ]/g, ch => PLAIN[ch] || ch);
}

/** Model ponekad doda potpis ili pozdrav s kraja maila — poruka ga nema. */
export function cleanChatText(text: string): string {
    return text
        .split('\n')
        .filter(l => !/^\s*(srdačno|srdacno|s poštovanjem|s postovanjem|lp|lijep pozdrav)\b[\s,.!]*$/i.test(l))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        // „…kolone.\n\nHvala." → jedna poruka, kao s telefona.
        .replace(/\s*\n+\s*(hvala[^\n]*)$/i, ' $1');
}

export function whatsappUrl(text: string, phone?: string): string {
    const to = phone && isMobile(phone) ? phone : '';
    return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** Stranica koja otvori Viber (Telegram dugme ne prima viber://). Tekst je u # — ne ide na server. */
export function viberPageUrl(base: string, text: string, phone?: string): string {
    const n = phone && isMobile(phone) ? `n=${phone}&` : '';
    return `${base.replace(/\/+$/, '')}/poruka.html#${n}t=${encodeURIComponent(text)}`;
}

/** Javna adresa ERP-a: APP_BASE_URL, inače produkcijska adresa na Vercelu. Prazno lokalno. */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
    if (env.APP_BASE_URL) return env.APP_BASE_URL;
    if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
    return '';
}

const CHANNEL_LABEL: Record<ChatChannel, string> = { viber: 'Viber', whatsapp: 'WhatsApp' };

export function chatCardText(m: TaskChatMessage): string {
    const reach = m.Phone && isMobile(m.Phone)
        ? (m.Channel === 'viber' ? 'Viber: dodir kopira tekst i otvori razgovor — zalijepi i pošalji.' : 'WhatsApp: tekst je već upisan — samo pošalji.')
        : 'Nema mobilnog broja u ERP-u — u aplikaciji izaberi kome ide.';
    return [`💬 ${CHANNEL_LABEL[m.Channel]} → ${m.To_Name}`, '', m.Text, '', reach].join('\n');
}

/** Dugmad kartice: traženi kanal prvi, drugi kanal pored; kopiraj; poslano / za sat. */
export function chatCardButtons(m: TaskChatMessage, taskId: string, base = appBaseUrl()): ButtonRows {
    const links: Record<ChatChannel, { text: string; data: string; url: string } | null> = {
        whatsapp: { text: '🟢 WhatsApp', data: '', url: whatsappUrl(m.Text, m.Phone) },
        viber: base ? { text: '🟣 Viber', data: '', url: viberPageUrl(base, m.Text, m.Phone) } : null,
    };
    const other: ChatChannel = m.Channel === 'viber' ? 'whatsapp' : 'viber';
    const open = [links[m.Channel], links[other]].filter((b): b is NonNullable<typeof b> => !!b);
    return [
        open,
        ...(m.Text.length <= COPY_MAX ? [[{ text: '📋 Kopiraj tekst', data: '', copy: m.Text }]] : []),
        [{ text: '✅ Poslano', data: `done:${taskId}` }, { text: '⏰ Za sat', data: `snz:${taskId}:1h` }],
    ];
}

export function chatChannelOf(raw: unknown, userText: string): ChatChannel {
    if (raw === 'viber' || raw === 'whatsapp') return raw;
    return /\b(whats ?app|wapp|vocap|vatsap|wa)\b/i.test(userText) ? 'whatsapp' : 'viber';
}

const TIME_WORD = /\b(sutra|prekosutra|danas|ponedjeljak|utorak|srijed\w*|cetvrtak|petak|subot\w*|nedjelj\w*|ujutro|navece|uvece|popodne|u \d{1,2}(?:[:.]\d{2})?)\b/;

/**
 * Da li je rečeno KAD poslati, a ne samo vrijeme u sadržaju poruke.
 * Sadržaj počinje na prvom „da", „:" ili „,": „javi Kerimu da sutra dođe u 7" → sadržaj (šalje se odmah);
 * „pošalji poruku Zaimu sutra u 10, naruči baglame" → vrijeme slanja.
 */
export function sendTimeSaid(userText: string): boolean {
    const t = userText.toLowerCase().replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'dj');
    const cut = t.search(/\bda\b|[:,]/);
    return TIME_WORD.test(cut >= 0 ? t.slice(0, cut) : t);
}
