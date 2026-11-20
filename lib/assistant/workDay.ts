// ════════════════════════════════════════════════════════════════════
// DAN IZ PORUKE — za upis rada i prisustva (čisto)
//
// „Amer i Edin su u petak radili stolove" (rečeno u subotu) → petak koji je
// prošao, ne danas. Dan čita ERP iz riječi poruke; model ga više ne mora
// pogoditi (14.11.: stavio ga je u polje koje alat ne zna → upis na danas).
// Rad se upisuje unazad: dan po imenu je ZADNJI takav dan (ili danas).
//
// „I jučer su isto", „i u petak isto stavi", „isto i za jučer": zadnji upis
// rada iz razgovora se ponavlja za taj dan (repeatDay). Rečenica koja to
// kaže ne određuje dan ostatka poruke.
// jest: lib/__tests__/workDaySaid.test.ts
// ════════════════════════════════════════════════════════════════════

import { addDays, weekday, type IsoDate } from '@/lib/voice/dates';
import { foldText } from '@/lib/voice/text';
import { workerMentioned, type GroundRef } from './grounding';

const WEEKDAYS: [number, RegExp][] = [
    [1, /^pon(e)?d(j)?elj(ak|ka|ku|kom)$/], [2, /^utor(ak|ka|ku|kom)$/], [3, /^sr(ij)?ed(a|u|e|i|om)$/],
    [4, /^cetvrt(ak|ka|ku|kom)$/], [5, /^pet(ak|ka|ku|kom)$/], [6, /^subot(a|u|e|i|om)$/], [0, /^ned(j)?elj(a|u|e|i|om)$/],
];
/** „nedjelja" je i sedmica: kao dan samo iza prijedloga („u nedjelju"). */
const SUNDAY_BEFORE = new Set(['u', 'za', 'prosle', 'proslu', 'prosla']);

/** Dan po imenu iza ovih riječi je rok ili plan („do petka", „za idući utorak"), ne dan rada. */
const FUTURE_CUE = new Set(['do', 'iduci', 'iduceg', 'iducu', 'iduce', 'sljedeci', 'sljedeceg', 'sljedecu', 'sljedece', 'naredni', 'narednog', 'narednu', 'naredne']);

interface DayHit { date: IsoDate; at: number }

function dayHits(folded: string, today: IsoDate, forRepeat = false): DayHit[] {
    const out: DayHit[] = [];
    // „12.11." / „12.11.2026" — prije riječi, jer foldText ostavlja tačke.
    const dated = /(?:^|[^\d.])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}))?/g;
    for (let m = dated.exec(folded); m; m = dated.exec(folded)) {
        const d = Number(m[1]), mo = Number(m[2]);
        if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
        let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
        const iso = (yy: number) => `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (!m[3] && iso(y) > today) y -= 1;
        out.push({ date: iso(y), at: m.index });
    }
    const t = folded.replace(/[.]/g, ' ').split(/\s+/).filter(Boolean);
    let pos = 0;
    t.forEach((w, i) => {
        const at = folded.indexOf(w, pos);
        pos = at >= 0 ? at + w.length : pos;
        // „isto kao jučer", „kao i u petak" je poređenje (šta se radi), ne dan upisa.
        if (t[i - 1] === 'kao' || (t[i - 2] === 'kao' && (t[i - 1] === 'i' || t[i - 1] === 'u')) || (t[i - 3] === 'kao' && t[i - 2] === 'i' && t[i - 1] === 'u')) return;
        if (w === 'danas') out.push({ date: today, at });
        else if (w === 'jucer' || w === 'juce') out.push({ date: addDays(today, -1), at });
        else if (w === 'prekjucer' || w === 'prekjuce') out.push({ date: addDays(today, -2), at });
        else {
            const wd = WEEKDAYS.find(([, re]) => re.test(w));
            if (!wd || (wd[0] === 0 && !SUNDAY_BEFORE.has(t[i - 1] || ''))) return;
            const before = [t[i - 1] || '', t[i - 2] || ''];
            if (before.some(b => FUTURE_CUE.has(b)) || (!forRepeat && before[0] === 'za')) return;
            out.push({ date: addDays(today, -((weekday(today) - wd[0] + 7) % 7)), at });
        }
    });
    return out;
}

const sentencesOf = (text: string) => (text || '').split(/[\n!?;]+|\.(?!\d)/).map(s => s.trim()).filter(Boolean);
const REPEAT_WORD = /\b(isto|takodje|takodjer)\b/;
/** Rečenica o drugima ili o nastavku („ostali isto", „isto kao jučer") nije ponavljanje zadnjeg upisa. */
const NOT_REPEAT = /\b(ostal\w*|ostatak|kao|nego)\b/;

/**
 * „I jučer su isto" / „i u petak isto stavi" / „isto i za jučer": kratka rečenica s jednim danom
 * i riječju „isto", bez imena radnika. Vraća taj dan i rečenicu (da je ostatak poruke ne čita kao svoj dan).
 */
export function repeatDay(text: string, today: IsoDate, workers: GroundRef[] = []): { date: IsoDate; sentence: string } | null {
    for (const s of sentencesOf(text)) {
        const f = foldText(s);
        const words = f.split(' ').filter(Boolean);
        if (words.length > 7 || !REPEAT_WORD.test(f) || NOT_REPEAT.test(f)) continue;
        if (workers.some(w => workerMentioned(s, w, workers))) continue;
        const days = Array.from(new Set(dayHits(f, today, true).map(h => h.date)));
        if (days.length === 1) return { date: days[0], sentence: s };
    }
    return null;
}

/** Dani koje poruka kaže za rad (bez rečenice „i jučer isto" i bez budućih), bez ponavljanja. */
export function saidWorkDays(text: string, today: IsoDate, workers: GroundRef[] = []): IsoDate[] {
    const repeat = repeatDay(text, today, workers);
    const rest = repeat ? (text || '').replace(repeat.sentence, ' ') : text || '';
    return Array.from(new Set(dayHits(foldText(rest), today).map(h => h.date))).filter(d => d <= today);
}

// ── PERIOD RADA ───────────────────────────────────────────────────────
//
// Vlasnik rad javlja po sedmici: „ove sedmice su radili na…", „cijelu sedmicu", „od srijede",
// „srijedu, četvrtak i danas", „u ponedjeljak". Dan po pozivu (log_work) to nije mogao, pa je
// model tražio fill_work_days s oznakama R# i ispravka perioda se nije dala uraditi (20.11.).
// Dane perioda čita ERP iz riječi koje model prepiše (`days`): raspon ide samo radnim danima
// (pon–pet), a dan rečen imenom ostaje i kad je subota. Budući dani ispadaju.

const WEEK = /\b(cijel\w*|ov\w*|cel\w*|tokom|kroz)\s+(sedmic\w*|tjed\w*|nedjelj\w*|nedelj\w*)\b|^\s*(sedmic\w*|tjed\w*)\s*$/;
const LAST_WEEK = /\b(prosl\w*)\s+(sedmic\w*|tjed\w*|nedjelj\w*|nedelj\w*)\b/;

function weekdayOf(word: string): number | null {
    const wd = WEEKDAYS.find(([, re]) => re.test(word));
    return wd ? wd[0] : null;
}

/** Zadnji takav dan zaključno s danas (0 = nedjelja). */
const lastWeekday = (today: IsoDate, wd: number) => addDays(today, -((weekday(today) - wd + 7) % 7));

function workingRange(from: IsoDate, to: IsoDate): IsoDate[] {
    const out: IsoDate[] = [];
    for (let d = from; d <= to && out.length < 40; d = addDays(d, 1)) if (weekday(d) !== 0 && weekday(d) !== 6) out.push(d);
    return out;
}

/** Ponedjeljak sedmice u kojoj je dan. */
export const mondayOf = (d: IsoDate): IsoDate => addDays(d, -((weekday(d) + 6) % 7));

/**
 * Dani perioda rečenog riječima („cijelu sedmicu", „od srijede", „od ponedjeljka do srijede",
 * „srijedu, četvrtak i danas", „u ponedjeljak", „prošle sedmice"). Null kad riječi ne kažu dan.
 */
export function workPeriod(said: string, today: IsoDate): IsoDate[] | null {
    const f = foldText(said || '');
    if (!f.trim()) return null;
    const out = new Set<IsoDate>();
    if (LAST_WEEK.test(f)) {
        const mon = addDays(mondayOf(today), -7);
        workingRange(mon, addDays(mon, 4)).forEach(d => out.add(d));
    } else if (WEEK.test(f)) {
        workingRange(mondayOf(today), today).forEach(d => out.add(d));
    }
    const t = f.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
    // „od srijede (do petka)", „ponedjeljak do srijede", „pon-sri"
    const dayAt = (i: number): IsoDate | null => {
        const w = t[i] || '';
        if (w === 'danas') return today;
        if (w === 'jucer' || w === 'juce') return addDays(today, -1);
        const wd = weekdayOf(w);
        return wd === null ? null : lastWeekday(today, wd);
    };
    const used = new Set<number>();
    t.forEach((w, i) => {
        if (w !== 'od' && w !== 'do') return;
        if (w === 'od') {
            const from = dayAt(i + 1);
            if (!from) return;
            const to = t[i + 2] === 'do' ? dayAt(i + 3) : null;
            workingRange(from, to && to >= from ? to : today).forEach(d => out.add(d));
            [i + 1, i + 2, i + 3].forEach(k => used.add(k));
        } else if (!used.has(i)) {
            const from = dayAt(i - 1), to = dayAt(i + 1);
            if (from && to && to >= from) { workingRange(from, to).forEach(d => out.add(d)); used.add(i - 1); used.add(i + 1); }
        }
    });
    // Dani rečeni imenom ili datumom („srijedu, četvrtak i danas", „12.11.").
    // Na cijelom tekstu: datumi nose tačke, a dani iz raspona su ionako već unutra.
    dayHits(f, today).forEach(h => out.add(h.date));
    t.forEach((w, i) => { if (!used.has(i) && weekdayOf(w) === 0 && /^(u|za)$/.test(t[i - 1] || '')) out.add(lastWeekday(today, 0)); });
    const days = Array.from(out).filter(d => d <= today).sort();
    return days.length ? days : null;
}

/** Jedan rečen dan → taj dan; nijedan ili više („jučer i danas") → null (odlučuje se kao i prije). */
export function saidWorkDay(text: string, today: IsoDate, workers: GroundRef[] = []): IsoDate | null {
    const days = saidWorkDays(text, today, workers);
    return days.length === 1 ? days[0] : null;
}
