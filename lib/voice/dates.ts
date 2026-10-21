// ════════════════════════════════════════════════════════════════════
// ROK IZ DIKTATA — deterministički, po LOKALNOM danu korisnika.
//
// Prije je server računao „danas" preko toISOString() (UTC), pa je između
// ponoći i 01/02h po našem vremenu „sutra" ispadalo danas. Sada klijent
// šalje svoj lokalni datum, a izrazi se ovdje prepoznaju bez modela:
// danas/sutra/prekosutra, dani u sedmici, „za 3 dana", „za dvije sedmice",
// „sljedeće sedmice", „do kraja mjeseca", „15. 11.", „15. novembra"…
//
// Model i dalje predlaže datum (zna kontekst), ali se njegov prijedlog
// prihvata samo ako se poklapa s nekim izrazom iz teksta — ili ako ovdje
// nismo našli nijedan (pa se samo provjeri da je smislen).
// ════════════════════════════════════════════════════════════════════

import { foldText } from './text';

export type IsoDate = string; // YYYY-MM-DD

const DAY_MS = 86_400_000;

function toUtc(iso: IsoDate): number {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
    return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, n: number): IsoDate {
    return fromUtc(toUtc(iso) + n * DAY_MS);
}

/** 0 = nedjelja … 6 = subota */
export function weekday(iso: IsoDate): number {
    return new Date(toUtc(iso)).getUTCDay();
}

export function isIsoDate(s: unknown): s is IsoDate {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    return fromUtc(toUtc(s)) === s;
}

/** Lokalni datum uređaja (ne UTC!). */
export function localToday(now: Date = new Date()): IsoDate {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const WEEKDAY_NAMES = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

// Presavijeni oblici (bez dijakritika), svi padeži koji se realno izgovore.
const WEEKDAY_PATTERNS: [number, string][] = [
    [1, 'ponedjelj(?:ak|ka|ku)|ponedelj(?:ak|ka|ku)'],
    [2, 'utor(?:ak|ka|ku)'],
    [3, 'srijed(?:a|u|e|i)|sred(?:a|u|e|i)'],
    [4, 'cetvrt(?:ak|ka|ku)'],
    [5, 'pet(?:ak|ka|ku)'],
    [6, 'subot(?:a|u|e|i)'],
    // „nedjelja" znači i sedmicu — kao dan samo uz prijedlog/odrednicu.
    [0, '(?<=\\b(?:u|do|za|ove|ovu|ova|ovaj|ovo|iducu|sljedecu|slijedecu|narednu|iduce|sljedece|slijedece|naredne) )ned(?:j)?elj(?:u|e|a|i)'],
];

const MONTHS: [number, string][] = [
    [1, 'januar\\w*|sijecanj\\w*|sijecnj\\w*'],
    [2, 'februar\\w*|veljac\\w*'],
    [3, 'mart\\w*|ozujk\\w*|ozujak'],
    [4, 'april\\w*|travanj\\w*|travnj\\w*'],
    [5, 'maj\\w*|svibanj\\w*|svibnj\\w*'],
    [6, 'jun\\w*|lipanj\\w*|lipnj\\w*'],
    [7, 'jul\\w*|srpanj\\w*|srpnj\\w*'],
    [8, 'august\\w*|avgust\\w*|kolovoz\\w*'],
    [9, 'septemb\\w*|rujan\\w*|rujn\\w*'],
    [10, 'oktob\\w*|listopad\\w*'],
    [11, 'novemb\\w*|studen\\w*'],
    [12, 'decemb\\w*|prosin\\w*'],
];

const NUMBER_WORDS: Record<string, number> = {
    jedan: 1, jednu: 1, jedna: 1, dva: 2, dvije: 2, dve: 2, tri: 3, cetiri: 4, pet: 5, sest: 6,
    sedam: 7, osam: 8, devet: 9, deset: 10, petnaest: 15, dvadeset: 20, trideset: 30,
};
const NUM = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;
const num = (s: string) => (/^\d+$/.test(s) ? parseInt(s, 10) : NUMBER_WORDS[s]);

function nextWeekday(today: IsoDate, target: number, forceNextWeek = false): IsoDate {
    const wd = weekday(today);
    if (forceNextWeek) {
        // „sljedeći petak" = petak u narednoj kalendarskoj sedmici (pon–ned).
        const daysToNextMonday = ((8 - wd) % 7) || 7;
        const monday = addDays(today, daysToNextMonday);
        return addDays(monday, (target + 6) % 7);
    }
    let diff = (target - wd + 7) % 7;
    if (diff === 0) diff = 7; // „u petak" izgovoreno u petak = idući petak
    return addDays(today, diff);
}

function endOfMonth(today: IsoDate): IsoDate {
    const [y, m] = today.split('-').map(Number);
    return fromUtc(Date.UTC(y, m, 0));
}

function addMonths(today: IsoDate, n: number): IsoDate {
    const [y, m, d] = today.split('-').map(Number);
    const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
    return fromUtc(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}

/** Kalendarski datum dan/mjesec; ako je prošao — sljedeće godine. */
function dayMonth(today: IsoDate, day: number, month: number, year?: number): IsoDate | null {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const [ty] = today.split('-').map(Number);
    const build = (yy: number) => {
        const iso = `${yy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return isIsoDate(iso) ? iso : null;
    };
    if (year) return build(year < 100 ? 2000 + year : year);
    const thisYear = build(ty);
    if (thisYear && thisYear >= today) return thisYear;
    return build(ty + 1);
}

export interface DateMention {
    date: IsoDate;
    index: number;   // pozicija u presavijenom tekstu (redoslijed izgovora)
    phrase: string;
}

/** Svi izrazi roka u tekstu, redom kojim su izgovoreni. */
export function findDateMentions(text: string, today: IsoDate): DateMention[] {
    const t = ` ${foldText(text)} `;
    const out: DateMention[] = [];
    const taken: [number, number][] = [];
    const add = (re: RegExp, fn: (m: RegExpExecArray) => IsoDate | null) => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(t))) {
            const start = m.index, end = m.index + m[0].length;
            if (taken.some(([a, b]) => start < b && end > a)) continue;
            const date = fn(m);
            if (date) {
                out.push({ date, index: start, phrase: m[0].trim() });
                taken.push([start, end]);
            }
        }
    };

    // Redoslijed je bitan: duži/specifičniji izrazi prvi zauzmu svoj dio teksta.
    add(/\b(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{2,4})\.?)?(?=\s)/g, m => dayMonth(today, +m[1], +m[2], m[3] ? +m[3] : undefined));
    for (const [month, pat] of MONTHS) {
        add(new RegExp(`\\b(\\d{1,2})\\.?\\s(?:${pat})(?:\\s(\\d{4}))?\\b`, 'g'), m => dayMonth(today, +m[1], month, m[2] ? +m[2] : undefined));
    }
    add(/\bprekosutra\b/g, () => addDays(today, 2));
    add(/\bsutra\b/g, () => addDays(today, 1));
    add(/\b(?:danas|veceras|jutros|do kraja dana|odmah danas)\b/g, () => today);
    add(new RegExp(`\\bza ${NUM} (?:radn\\w+ )?dan\\w*\\b`, 'g'), m => addDays(today, num(m[1])));
    add(new RegExp(`\\bza ${NUM} (?:sedmic\\w*|tjed\\w*|nedjelj\\w*|nedelj\\w*)\\b`, 'g'), m => addDays(today, 7 * num(m[1])));
    add(/\bza (?:jednu )?(?:sedmicu|tjedan|nedjelju|nedelju)(?: dana)?\b/g, () => addDays(today, 7));
    add(new RegExp(`\\bza ${NUM} mjesec\\w*\\b`, 'g'), m => addMonths(today, num(m[1])));
    add(/\bza (?:jedan )?mjesec(?: dana)?\b/g, () => addMonths(today, 1));
    add(/\b(?:do )?kraj(?:a)? (?:ovog )?mjeseca\b/g, () => endOfMonth(today));
    add(/\b(?:iduc\w*|sljedec\w*|slijedec\w*|naredn\w*) (?:sedmic\w*|tjed\w*|nedjelj\w*|nedelj\w*)\b/g, () => nextWeekday(today, 1, true));
    add(/\b(?:do )?kraj(?:a)? (?:ove )?(?:sedmice|tjedna|nedjelje|nedelje)|\bove (?:sedmice|nedjelje|nedelje)|\bovaj tjedan|\bovu sedmicu\b/g, () => {
        const wd = weekday(today);
        return wd >= 1 && wd <= 5 ? addDays(today, 5 - wd) : today;
    });
    add(/\bza vikend\b|\bvikendom\b|\bpreko vikenda\b/g, () => nextWeekday(today, 6));
    for (const [wd, pat] of WEEKDAY_PATTERNS) {
        add(new RegExp(`\\b(?:(iduc\\w*|sljedec\\w*|slijedec\\w*|naredn\\w*) )?(?:${pat})\\b`, 'g'), m => nextWeekday(today, wd, !!m[1]));
    }
    // „do 20." / „do dvadesetog" se ne pokriva rječima; samo broj s tačkom uz „do/za/rok".
    add(/\b(?:do|rok|za) (\d{1,2})\.(?=\s)/g, m => {
        const day = +m[1];
        const [y, mo] = today.split('-').map(Number);
        const iso = dayMonth(today, day, mo, y);
        return iso && iso >= today ? iso : dayMonth(today, day, mo === 12 ? 1 : mo + 1, mo === 12 ? y + 1 : y);
    });

    return out.sort((a, b) => a.index - b.index);
}

const MAX_AHEAD_DAYS = 400;

/**
 * Konačni rok: prijedlog modela ako ga tekst potvrđuje, inače prvi izraz iz
 * teksta, inače prijedlog modela ako je u razumnom rasponu (danas … +400 dana).
 */
export function resolveDueDate(text: string, today: IsoDate, modelDate?: string | null): IsoDate | null {
    const mentions = findDateMentions(text, today);
    const model = isIsoDate(modelDate) ? modelDate : null;
    if (mentions.length) {
        if (model && mentions.some(m => m.date === model)) return model;
        return mentions[0].date;
    }
    if (model && model >= today && toUtc(model) - toUtc(today) <= MAX_AHEAD_DAYS * DAY_MS) return model;
    return null;
}

/** Kalendar za prompt: sljedeća dva tjedna s nazivima dana, da model ne računa sam. */
export function calendarHint(today: IsoDate, days = 14): string {
    const lines: string[] = [];
    for (let i = 0; i <= days; i++) {
        const d = addDays(today, i);
        const label = i === 0 ? ' (danas)' : i === 1 ? ' (sutra)' : i === 2 ? ' (prekosutra)' : '';
        lines.push(`${d} — ${WEEKDAY_NAMES[weekday(d)]}${label}`);
    }
    return lines.join('\n');
}
