// ════════════════════════════════════════════════════════════════════
// PONAVLJAJUĆI PODSJETNIK — prepoznavanje i sljedeći termin (čista logika)
//
// „Napomeni me svaki dan u 7", „radnim danima u 15:30", „ponedjeljkom i
// četvrtkom", „svake sedmice u petak", „svaki mjesec" → jedan zadatak koji
// se sam ponavlja. Ponavljanje čita ERP iz poruke, ne model (isto svaki put,
// 0 tokena). Tick poslije slanja pomjeri `Reminder_At` na sljedeći termin u
// isto lokalno vrijeme (`Time`), i kad je podsjetnik bio odgođen.
// jest: lib/__tests__/assistantRepeat.test.ts
// ════════════════════════════════════════════════════════════════════

import { addDays, weekday, type IsoDate } from '@/lib/voice/dates';
import { foldText } from '@/lib/voice/text';
import { toZoned, zonedToUtcMs } from './datetime';
import type { ReminderRepeat } from '@/lib/types';

/** Dani u sedmici: 0 = nedjelja … 6 = subota (kao `weekday`). */
const DAY_STEMS: [number, RegExp][] = [
    [1, /^pone?dj?elj(ak|ka|ku|kom|ke|cima)$/],
    [2, /^utor(ak|ka|ku|kom|cima)$/],
    [3, /^sri?j?ed(a|e|u|om|ama)$/],
    [4, /^cetvrt(ak|ka|ku|kom|cima)$/],
    [5, /^pet(ak|ka|ku|kom|cima)$/],
    [6, /^subot(a|e|u|om|ama)$/],
    [0, /^nedj?elj(a|e|u|om|ama)$/],
];
/** „petkom", „ponedjeljkom i četvrtkom" — oblik koji sam kaže „svaki taj dan". */
const ON_DAY = ['nedjeljom', 'ponedjeljkom', 'utorkom', 'srijedom', 'četvrtkom', 'petkom', 'subotom'];

function dayOf(word: string): number | null {
    for (const [d, re] of DAY_STEMS) if (re.test(word)) return d;
    return null;
}

/** Riječ dana u obliku koji sam znači „svaki taj dan": ponedjeljkom, petkom, nedjeljom, utorcima. */
const HABITUAL = /^(pone?dj?eljkom|utorkom|sri?j?edom|cetvrtkom|petkom|subotom|nedj?eljom|\w+cima|subotama|nedj?eljama|sri?j?edama)$/;

const EVERY = /^svak(i|a|o|og|om|e|u|og|ome|oga)$/;

/**
 * Ponavljanje rečeno u poruci, ili null. `time` je lokalno „HH:MM" prvog
 * termina (iz razriješenog podsjetnika); `firstDate` je njegov dan.
 */
export function parseRepeat(message: string, time: string, firstDate: IsoDate): ReminderRepeat | null {
    const words = foldText(message).split(/[\s.,;:!?]+/).filter(Boolean);
    const text = ` ${words.join(' ')} `;
    // „svaki put kad…", „svaki komad", „svaki stan" nisu raspored: pravila niže traže dan, sedmicu ili mjesec.

    // Radni dani.
    if (/ (radnim danima|svak\w* radn\w* dan\w*|od pone?dj?eljka do petka|pon ?- ?pet) /.test(text)) {
        return { Every: 'workday', Time: time };
    }

    // Dani u sedmici: „svakog petka", „svaki ponedjeljak", „petkom", „ponedjeljkom i četvrtkom".
    const days = new Set<number>();
    words.forEach((w, i) => {
        const d = dayOf(w);
        if (d === null) return;
        if (HABITUAL.test(w) || (i > 0 && EVERY.test(words[i - 1]))) days.add(d);
    });
    // „ponedjeljkom i četvrtkom": drugi dan bez „svaki" ide uz prvi.
    if (days.size) {
        words.forEach((w, i) => {
            const d = dayOf(w);
            if (d !== null && i > 0 && /^(i|ili|te)$/.test(words[i - 1]) && i > 1 && dayOf(words[i - 2]) !== null && days.has(dayOf(words[i - 2])!)) days.add(d);
        });
        return { Every: 'week', Time: time, Days: [...days].sort((a, b) => a - b) };
    }

    // Svaki dan.
    if (/ (svak\w* (dan|dana|jutro|jutra|vecer|veceri|noc|podne)|svakodnevno|dnevno|svaki bozji dan) /.test(text)) {
        return { Every: 'day', Time: time };
    }

    // Sedmično bez rečenog dana → dan prvog termina.
    if (/ (svak\w* (sedmic\w*|nedjelj\w*|hefte)|sedmicno|jednom sedmicno|jednom nedjeljno|nedjeljno) /.test(text)) {
        return { Every: 'week', Time: time, Days: [weekday(firstDate)] };
    }

    // Mjesečno → isti dan u mjesecu kao prvi termin.
    if (/ (svak\w* mjesec\w*|mjesecno|jednom mjesecno) /.test(text)) {
        return { Every: 'month', Time: time, Day_Of_Month: Number(firstDate.slice(8, 10)) };
    }
    return null;
}

/** Da li dan pripada rasporedu. */
export function matchesDay(r: ReminderRepeat, date: IsoDate): boolean {
    const wd = weekday(date);
    switch (r.Every) {
        case 'day': return true;
        case 'workday': return wd >= 1 && wd <= 5;
        case 'week': return (r.Days || []).includes(wd);
        case 'month': {
            const want = r.Day_Of_Month || 1;
            const d = Number(date.slice(8, 10));
            // 31. u mjesecu od 30 dana → zadnji dan tog mjeseca.
            const last = Number(lastDayOfMonth(date).slice(8, 10));
            return d === Math.min(want, last);
        }
    }
}

function lastDayOfMonth(date: IsoDate): IsoDate {
    const [y, m] = date.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return addDays(next as IsoDate, -1);
}

/**
 * Prvi termin rasporeda strogo poslije `after` (ISO), u lokalno vrijeme `Time`.
 * Traži najviše 62 dana unaprijed; prazan raspored → null.
 */
export function nextOccurrence(r: ReminderRepeat, after: Date, tz: string): string | null {
    const [h, m] = r.Time.split(':').map(Number);
    let day = toZoned(after, tz).date;
    for (let i = 0; i <= 62; i++, day = addDays(day, 1)) {
        if (!matchesDay(r, day)) continue;
        const ms = zonedToUtcMs(day, h, m, tz);
        if (ms > after.getTime()) return new Date(ms).toISOString();
    }
    return null;
}

/**
 * Prvi termin novog ponavljajućeg podsjetnika: razriješeni podsjetnik ako pada
 * na dan rasporeda („svaki dan u 7" → sutra u 7), inače prvi dan rasporeda
 * poslije njega („radnim danima" rečeno u subotu → ponedjeljak).
 */
export function firstOccurrence(r: ReminderRepeat, resolvedIso: string, tz: string): string | null {
    const date = toZoned(resolvedIso, tz).date;
    if (matchesDay(r, date)) return resolvedIso;
    return nextOccurrence(r, new Date(Date.parse(resolvedIso)), tz);
}

/** „svaki dan", „radnim danima", „petkom", „ponedjeljkom i četvrtkom", „svaki mjesec (15.)". */
export function repeatLabel(r: ReminderRepeat): string {
    switch (r.Every) {
        case 'day': return 'svaki dan';
        case 'workday': return 'radnim danima';
        case 'week': {
            // Sedmica od ponedjeljka: nedjelja na kraj.
            const days = [...(r.Days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => ON_DAY[d]);
            if (days.length === 7) return 'svaki dan';
            return days.length > 1 ? `${days.slice(0, -1).join(', ')} i ${days[days.length - 1]}` : days[0] || 'svake sedmice';
        }
        case 'month': return `svaki mjesec (${r.Day_Of_Month}.)`;
    }
}
