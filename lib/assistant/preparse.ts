// ════════════════════════════════════════════════════════════════════
// PREDOBRADA PORUKE — ERP prvo pročita poruku, model tek onda (čisto)
//
//   • normalizacija: „1000 puta 1100" → 1000x1100, „e 108" → E108,
//     „hodnik e4" → hodnik E4, tipfeleri poznatih predmeta („pgledalo")
//   • činjenice: lokacije i mjere koje je ERP našao — model ih dobije uz
//     poruku, a poslije upisa se provjeri da nijedna nije izgubljena
//     (pokrivenost: C604 s dvije mjere ne smije postati jedna stavka)
//   • fokus: „u tom stanu", „na istom hodniku" → lokacija iz razgovora
// jest: lib/__tests__/preparse.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from '@/lib/voice/text';

export interface MessageFacts {
    /** Mjere kao „1000x1100" (cm pretvoreni u mm, kao parseDimensions). */
    dims: string[];
    /** Samo širina: „š 800". */
    widths: string[];
    /** Lokacije u obliku koji ERP koristi: E108, hodnik E4. */
    locations: string[];
    /** Poruka upućuje na lokaciju iz razgovora („u tom stanu", „na istom hodniku"). */
    deictic: boolean;
}

export interface Preparsed {
    /** Poruka za model: normalizovana. Original ostaje u dnevniku. */
    text: string;
    facts: MessageFacts;
}

/** Predmeti bilježnice koje ERP ispravlja kad su pogrešno otkucani. */
const DEFAULT_SUBJECTS = ['ogledalo', 'ogledala', 'lajsna', 'lajsne', 'umivaonik', 'ormar', 'vrata', 'ploča', 'ploče', 'staklo', 'polica'];

/** Slova koja su u bosanskom česte riječi — „a 404" i „u 308" nisu lokacije. */
const WORD_LETTERS = new Set(['a', 'i', 'o', 'u', 's', 'k', 'v', 'z']);

function normalizeDims(text: string): string {
    return text
        .replace(/(\d{2,4})\s*(?:x|×|✕|\*|puta|na)\s*(\d{2,4})(?!\d)/gi, '$1x$2');
}

function normalizeLocations(text: string, prefixes: Set<string>): string {
    // „hodnik e4", „hodniku E 4" → „hodnik E4"
    let out = text.replace(/\b(hodnik\w*)\s+([a-z])\s?(\d{1,2})\b/gi, (_, h: string, l: string, n: string) => `${h} ${l.toUpperCase()}${n}`);
    // „e108", „E 108", „c-604" → E108; slovo mora biti poznat ulaz (ili B–E), ne „a"/„u".
    out = out.replace(/(^|[^\p{L}\d])([a-z])[\s-]?(\d{3})(?!\d)/giu, (m, pre: string, l: string, n: string) => {
        const low = l.toLowerCase();
        if (WORD_LETTERS.has(low) && !prefixes.has(low)) return m;
        if (!prefixes.has(low) && !'bcde'.includes(low)) return m;
        return `${pre}${l.toUpperCase()}${n}`;
    });
    return out;
}

/** Levenshtein, dovoljno za kratke riječi. */
function editDistance(a: string, b: string): number {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return d[a.length][b.length];
}

function fixTypos(text: string, subjects: string[]): string {
    const known = Array.from(new Set([...DEFAULT_SUBJECTS, ...subjects.map(s => s.toLowerCase())])).filter(s => s.length >= 5);
    return text.replace(/\p{L}{5,}/gu, word => {
        const w = foldText(word);
        if (known.some(k => foldText(k) === w)) return word;
        // Samo očit tipfeler (jedno slovo): „pgledalo" → „ogledalo".
        const best = known.find(k => editDistance(w, foldText(k)) === 1);
        return best || word;
    });
}

const PAIR = /(\d{2,4})x(\d{2,4})/gi;
const WIDTH = /(\d{2,4})\s*(?:mm|cm|milimet\w*|centimet\w*)?\s*(?:sirok\w*|sirin\w*|širok\w*|širin\w*)|(?:sirin\w*|širin\w*|sirok\w*|širok\w*)\s*(\d{2,4})/gi;

function mm(a: number, b?: number): [number, number?] {
    if (b === undefined) return [a < 400 ? a * 10 : a];
    return a < 400 && b < 400 ? [a * 10, b * 10] : [a, b];
}

export function messageFacts(text: string, knownLocations: string[] = []): MessageFacts {
    const dims = Array.from(text.matchAll(PAIR)).map(m => {
        const [a, b] = mm(Number(m[1]), Number(m[2]));
        return `${a}x${b}`;
    });
    const withoutPairs = text.replace(PAIR, ' ');
    const widths = Array.from(withoutPairs.matchAll(WIDTH)).map(m => `š ${mm(Number(m[1] || m[2]))[0]}`);
    const locations = new Set<string>();
    for (const m of Array.from(text.matchAll(/\bhodnik\w*\s+([A-Z]\d{1,2})\b/g))) locations.add(`hodnik ${m[1]}`);
    for (const m of Array.from(text.matchAll(/(^|[^\p{L}\d])([A-Z]\d{3})(?!\d)/gu))) locations.add(m[2]);
    // Poznate lokacije rečene drugačije („C5" za hodnik C5, „kombi").
    const folded = foldText(text);
    for (const loc of knownLocations) {
        const k = foldText(loc);
        if (k.length >= 3 && new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(folded)) locations.add(loc);
    }
    const deictic = /\b(u tom stanu|u istom stanu|na istom hodniku|na tom hodniku|u njemu|tu je|tamo je|isti stan|istom mjestu)\b/.test(folded);
    return { dims, widths, locations: Array.from(locations), deictic };
}

/** Normalizovana poruka + činjenice koje je ERP u njoj našao. */
export function preparseMessage(text: string, opts: { knownLocations?: string[]; subjects?: string[] } = {}): Preparsed {
    const prefixes = new Set((opts.knownLocations || []).map(l => l.trim().charAt(0).toLowerCase()).filter(c => /[a-z]/.test(c)));
    const normalized = fixTypos(normalizeLocations(normalizeDims(text), prefixes), opts.subjects || []);
    return { text: normalized, facts: messageFacts(normalized, opts.knownLocations) };
}

/** Kratka napomena za model, uz poruku. Prazno kad ERP ništa nije našao. */
export function factsNote(f: MessageFacts, focusLocation?: string, extra: string[] = []): string {
    const parts: string[] = [];
    if (f.locations.length) parts.push(`lokacije ${f.locations.join(', ')}`);
    const sizes = [...f.dims, ...f.widths];
    if (sizes.length) parts.push(`mjere ${sizes.join(', ')} (${sizes.length} — svaka je posebna stvar, osim kad je rečeno da je ista)`);
    if (focusLocation && (f.deictic || !f.locations.length)) parts.push(`lokacija iz razgovora: ${focusLocation}${f.deictic ? ' („u tom stanu" / „na istom hodniku" = ona)' : ''}`);
    parts.push(...extra);
    return parts.length ? `[ERP u poruci: ${parts.join('; ')}]` : '';
}

/** Brojevi mjere bez redoslijeda: 1000x1350 i 1350x1000 su ista mjera. */
export function sizeKey(size: string): string {
    return Array.from(size.matchAll(/\d{2,4}/g)).map(m => Number(m[0])).sort((a, b) => a - b).join('x');
}

/**
 * Pokrivenost: mjere i lokacije iz poruke koje nisu završile ni u jednoj
 * upisanoj stavci. `written` = tekst upisanih stavki (naslov, opis, lokacija, stanje).
 */
export function uncovered(f: MessageFacts, written: string[]): { sizes: string[]; locations: string[] } {
    const hay = written.join(' | ');
    const hayKeys = new Set(Array.from(hay.matchAll(/(\d{2,4})\s*x\s*(\d{2,4})/g)).map(m => sizeKey(`${m[1]}x${m[2]}`)));
    const hayNums = new Set(Array.from(hay.matchAll(/\d{2,4}/g)).map(m => m[0]));
    const sizes = [
        ...f.dims.filter(d => !hayKeys.has(sizeKey(d))),
        ...f.widths.filter(w => !hayNums.has(w.replace(/\D/g, ''))),
    ];
    const foldedHay = foldText(hay);
    const locations = f.locations.filter(l => !foldedHay.includes(foldText(l)));
    return { sizes: Array.from(new Set(sizes)), locations };
}
