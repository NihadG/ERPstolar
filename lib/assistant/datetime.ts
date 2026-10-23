// ════════════════════════════════════════════════════════════════════
// VRIJEME PODSJETNIKA — dan + sat, po lokalnom vremenu korisnika.
//
// Server (Vercel) radi u UTC-u, a korisnik kaže „sutra u 7". Zato se sve
// računa u zoni iz ASSISTANT_TIMEZONE (zadano Europe/Sarajevo) i tek na
// kraju pretvara u UTC ISO koji ide u bazu (`Task.Reminder_At`).
//
// Isto pravilo kao u lib/voice/dates: model PREDLAŽE („2026-10-26T08:00"),
// a prijedlog se prihvata samo ako ga tekst potvrđuje ili ako tekst ništa
// ne kaže. Dan čita postojeći parser (`findDateMentions`), sat se čita ovdje.
// ════════════════════════════════════════════════════════════════════

import { addDays, findDateMentions, isIsoDate, weekday, WEEKDAY_NAMES, type IsoDate } from '@/lib/voice/dates';
import { foldText } from '@/lib/voice/text';

export const DEFAULT_TIMEZONE = 'Europe/Sarajevo';
/** Kad je rečen samo dan („u ponedjeljak naručiti…"), podsjetnik stiže ujutro. */
export const DEFAULT_REMINDER_HOUR = 8;
const MAX_AHEAD_DAYS = 400;

export function assistantTimezone(): string {
    return process.env.ASSISTANT_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
}

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number }

function zonedParts(ms: number, tz: string): Parts {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
    return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Pomak zone u minutama za dati trenutak (+60 zimi, +120 ljeti za Sarajevo). */
export function tzOffsetMinutes(ms: number, tz: string): number {
    const p = zonedParts(ms, tz);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Lokalni dan + sat u zoni → UTC milisekunde (ispravno i na prelasku sata). */
export function zonedToUtcMs(date: IsoDate, hour: number, minute: number, tz: string): number {
    const [y, mo, d] = date.split('-').map(Number);
    const guess = Date.UTC(y, mo - 1, d, hour, minute);
    const off1 = tzOffsetMinutes(guess, tz);
    let utc = guess - off1 * 60000;
    const off2 = tzOffsetMinutes(utc, tz);
    if (off2 !== off1) utc = guess - off2 * 60000;
    return utc;
}

export interface ZonedMoment {
    date: IsoDate;
    /** HH:MM */
    time: string;
    hour: number;
    minute: number;
}

export function toZoned(input: Date | string | number, tz: string): ZonedMoment {
    const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
    const p = zonedParts(ms, tz);
    return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}`, hour: p.h, minute: p.mi };
}

const SHORT_DAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];

/** „danas u 15:00", „sutra u 07:30", „pon 26.10. u 08:00". */
export function formatReminder(iso: string, tz: string, now: Date = new Date()): string {
    const at = toZoned(iso, tz);
    const today = toZoned(now, tz).date;
    const day = at.date === today ? 'danas'
        : at.date === addDays(today, 1) ? 'sutra'
            : `${SHORT_DAYS[weekday(at.date)]} ${Number(at.date.slice(8, 10))}.${Number(at.date.slice(5, 7))}.`;
    return `${day} u ${at.time}`;
}

/** Red za prompt: „petak, 23.10.2026, 14:05". */
export function describeNow(now: Date, tz: string): string {
    const z = toZoned(now, tz);
    const [y, m, d] = z.date.split('-');
    return `${WEEKDAY_NAMES[weekday(z.date)]}, ${Number(d)}.${Number(m)}.${y}, ${z.time}`;
}

// ─── Sat iz teksta ────────────────────────────────────────────────────

export interface TimeMention {
    hour: number;
    minute: number;
    /** „za 2 sata", „za pola sata" — računa se od SADA, ne od dana. */
    relativeMinutes?: number;
    phrase: string;
}

const HOUR_WORDS: Record<string, number> = {
    jedan: 1, dva: 2, tri: 3, cetiri: 4, pet: 5, sest: 6, sedam: 7, osam: 8,
    devet: 9, deset: 10, jedanaest: 11, dvanaest: 12,
};
const HOUR_WORD = Object.keys(HOUR_WORDS).join('|');
const PM = /^(?:popodne|poslije podne|poslijepodne|po podne|navecer|uvece|uvecer|nocu|veceras)$/;
const AM = /^(?:ujutro|ujutru|jutros|izjutra)$/;
const DAYPART = '(?:ujutro|ujutru|jutros|izjutra|popodne|poslije podne|poslijepodne|po podne|navecer|uvece|uvecer|nocu|veceras)';
/**
 * Riječi koje smiju stajati iza golog „u 7": veznici, zamjenice i glagoli
 * kojima se diktat nastavlja („u 3 kaži radniku"). Imenice ne smiju, pa
 * „u 2 kombija" ostaje broj. Ako ovdje nešto fali, sat dopuni model.
 */
const BARE_HOUR_FOLLOW = new Set([
    'i', 'pa', 'da', 'kod', 'na', 'kad', 'ili', 'a', 'ako', 'sutra', 'danas', 'prekosutra', 'me', 'mi', 'ga', 'ih', 'se',
    'kazi', 'reci', 'zovi', 'nazovi', 'javi', 'posalji', 'naruci', 'idi', 'dodji', 'podsjeti', 'provjeri', 'uzmi',
    'pokupi', 'kupi', 'plati', 'vozi', 'trebam', 'treba', 'moram', 'mora', 'imam', 'ima', 'je', 'sam', 'smo', 'sastanak',
]);

function hourOf(raw: string): number {
    return /^\d+$/.test(raw) ? parseInt(raw, 10) : HOUR_WORDS[raw];
}

function withDaypart(hour: number, part: string | undefined): number {
    if (part && PM.test(part) && hour < 12) return hour + 12;
    if (part && AM.test(part) && hour === 12) return 0;
    // „u 3" bez dijela dana u radionici znači 15h, ne 3 ujutro.
    if (!part && hour >= 1 && hour <= 6) return hour + 12;
    return hour;
}

function valid(h: number, m: number): boolean {
    return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Prvi izraz sata u tekstu ili null. Ne dira datume („26.10.") ni brojeve stanova („u 304"). */
export function findTimeMention(text: string): TimeMention | null {
    // foldText briše dvotačku, pa „15:30" prije toga postaje „15h30".
    const t = ` ${foldText((text || '').replace(/(\d{1,2}):(\d{2})/g, '$1h$2'))} `;
    let m: RegExpMatchArray | null;

    // Relativno: „za pola sata", „za sat", „za 2 sata", „za 20 minuta".
    if ((m = t.match(/\bza pola sata\b/))) return { hour: 0, minute: 0, relativeMinutes: 30, phrase: m[0].trim() };
    if ((m = t.match(/\bza (?:jedan )?sat(?: vremena)?\b(?! i)/))) return { hour: 0, minute: 0, relativeMinutes: 60, phrase: m[0].trim() };
    if ((m = t.match(new RegExp(`\\bza (\\d{1,2}|${HOUR_WORD}|dva|dvije) sat(?:a|i)?\\b`)))) {
        const n = m[1] === 'dvije' ? 2 : hourOf(m[1]);
        if (n) return { hour: 0, minute: 0, relativeMinutes: n * 60, phrase: m[0].trim() };
    }
    if ((m = t.match(/\bza (\d{1,3}) min(?:uta|ute|utu)?\b/))) {
        return { hour: 0, minute: 0, relativeMinutes: parseInt(m[1], 10), phrase: m[0].trim() };
    }

    // „u podne"
    if ((m = t.match(/\bu podne\b/))) return { hour: 12, minute: 0, phrase: m[0].trim() };

    // „u 15:30", „u 7.15", „u 8h", „u 8 sati", „u 3 popodne", „u osam ujutro".
    // Golo „u 7" vrijedi samo kad iza ne stoji imenica: „u 2 kombija",
    // „od 1 m", „do 5 komada" nisu sati.
    const explicit = new RegExp(
        `\\b(u|oko|do|od|prije|poslije) (\\d{1,2}|${HOUR_WORD})(?:[h.](\\d{2}))?(?:\\s?(h|sati|sat|casova))?(?:\\s(${DAYPART}))?(?=[\\s,.!?])`,
        'g'
    );
    for (const mm of Array.from(t.matchAll(explicit))) {
        const [, prep, num, mins, suffix, part] = mm;
        if (!(mins || suffix || part)) {
            if (!/^\d+$/.test(num) || (prep !== 'u' && prep !== 'oko')) continue;
            const after = t.slice((mm.index || 0) + mm[0].length).replace(/^[\s,.!?]+/, '').split(' ')[0] || '';
            if (after && !BARE_HOUR_FOLLOW.has(after)) continue;
        }
        const h = withDaypart(hourOf(num), part);
        const min = mins ? parseInt(mins, 10) : 0;
        if (valid(h, min)) return { hour: h, minute: min, phrase: mm[0].trim() };
    }

    // Bez prijedloga: „15:30", „15h", „8 sati ujutro".
    if ((m = t.match(new RegExp(`\\b(\\d{1,2})h(\\d{2})(?:\\s?h)?(?:\\s(${DAYPART}))?(?=[\\s,])`)))) {
        const h = withDaypart(parseInt(m[1], 10), m[3] || 'x');
        const min = parseInt(m[2], 10);
        if (valid(h, min)) return { hour: h, minute: min, phrase: m[0].trim() };
    }
    if ((m = t.match(new RegExp(`\\b(\\d{1,2})\\s?(?:h|sati|casova)(?:\\s(${DAYPART}))?(?=[\\s,])`)))) {
        const h = withDaypart(parseInt(m[1], 10), m[2]);
        if (valid(h, 0)) return { hour: h, minute: 0, phrase: m[0].trim() };
    }

    // Samo dio dana.
    if ((m = t.match(/\b(?:ujutro|ujutru|izjutra)\b/))) return { hour: 8, minute: 0, phrase: m[0].trim() };
    if ((m = t.match(/\b(?:prijepodne|prije podne)\b/))) return { hour: 10, minute: 0, phrase: m[0].trim() };
    if ((m = t.match(/\b(?:popodne|poslije podne|poslijepodne|po podne)\b/))) return { hour: 15, minute: 0, phrase: m[0].trim() };
    if ((m = t.match(/\b(?:navecer|uvece|uvecer|veceras)\b/))) return { hour: 19, minute: 0, phrase: m[0].trim() };

    return null;
}

// ─── Konačni trenutak podsjetnika ─────────────────────────────────────

/** „2026-10-26T08:00" (lokalno) → dijelovi, ili null. */
export function parseLocalDateTime(s: unknown): { date: IsoDate; hour: number; minute: number } | null {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (!m || !isIsoDate(m[1])) return null;
    const hour = m[2] !== undefined ? parseInt(m[2], 10) : DEFAULT_REMINDER_HOUR;
    const minute = m[3] !== undefined ? parseInt(m[3], 10) : 0;
    if (!valid(hour, minute)) return null;
    return { date: m[1], hour, minute };
}

export interface ResolvedReminder {
    iso: string;
    date: IsoDate;
    time: string;
}

/**
 * Trenutak podsjetnika iz teksta korisnika i prijedloga modela.
 *
 * - „za 2 sata" → sada + 2h (model se ne pita).
 * - Dan: prijedlog modela ako ga tekst potvrđuje, inače prvi dan iz teksta,
 *   inače prijedlog modela ako je u razumnom rasponu.
 * - Sat: iz teksta, inače od modela, inače 08:00.
 * - Samo sat koji je danas već prošao („u 7" rečeno u 9) → sutra.
 * - Prošlo vrijeme za eksplicitno „danas" → za pola sata (da ne propadne).
 */
export function resolveReminderAt(opts: {
    text: string;
    now: Date;
    tz: string;
    modelLocal?: string | null;
}): ResolvedReminder | null {
    const { text, now, tz } = opts;
    const nowMs = now.getTime();
    const today = toZoned(now, tz).date;
    const finish = (ms: number): ResolvedReminder => {
        const z = toZoned(ms, tz);
        return { iso: new Date(ms).toISOString(), date: z.date, time: z.time };
    };

    const tm = findTimeMention(text);
    if (tm?.relativeMinutes) return finish(nowMs + tm.relativeMinutes * 60000);

    const model = parseLocalDateTime(opts.modelLocal);
    const modelHasTime = typeof opts.modelLocal === 'string' && /T\d{1,2}:\d{2}/.test(opts.modelLocal);
    const mentions = findDateMentions(text, today);

    let date: IsoDate | null = null;
    let explicitDate = false;
    if (mentions.length) {
        explicitDate = true;
        date = model && mentions.some(m => m.date === model.date) ? model.date : mentions[0].date;
    } else if (model && model.date >= today && (Date.parse(model.date) - Date.parse(today)) / 86_400_000 <= MAX_AHEAD_DAYS) {
        date = model.date;
    }

    let hour: number;
    let minute: number;
    if (tm) { hour = tm.hour; minute = tm.minute; }
    else if (model && modelHasTime && (date === model.date || !mentions.length)) { hour = model.hour; minute = model.minute; }
    else { hour = DEFAULT_REMINDER_HOUR; minute = 0; }

    if (!date) {
        if (!tm) return null;
        date = today;
    }

    let ms = zonedToUtcMs(date, hour, minute, tz);
    if (ms <= nowMs) {
        if (!explicitDate && date === today) {
            ms = zonedToUtcMs(addDays(today, 1), hour, minute, tz);
        } else if (date === today) {
            ms = Math.ceil((nowMs + 30 * 60000) / 300000) * 300000;
        } else {
            return null; // dan u prošlosti — bolje pitati nego zakazati unazad
        }
    }
    return finish(ms);
}
