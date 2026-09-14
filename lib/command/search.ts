// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — TOLERANTNA PRETRAGA
//
// Nazivi pozicija se kucaju u žurbi i pretraga mora oprostiti ono što
// ljudi stvarno rade:
//   • dijakritiku      — „corluka" nađe „Čorluka", „ploca" nađe „ploča"
//   • redoslijed       — „obloga drvena" nađe „Drvena obloga zida"
//   • razmake i tačke  — „t1a" nađe „T1.A", „drvenaobloga" nađe „Drvena obloga"
//   • tipfelere        — „obloge"/„oblga" nađe „obloga"
//
// Svaki token upita mora biti pronađen (I, ne ILI) — inače bi duži upit
// vraćao SVE umjesto da sužava. Ocjena služi samo za redoslijed rezultata.
// ════════════════════════════════════════════════════════════════════

import { stripDiacritics } from '../classify/patternNormalize';

/** Tekst sveden na uporediv oblik: bez dijakritike, mala slova, samo alfanum. */
export function fold(text: string): string {
    return stripDiacritics(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** Upit → tokeni. Prazan upit = nema filtera. */
export function queryTokens(query: string): string[] {
    const folded = fold(query);
    return folded ? folded.split(' ').filter(Boolean) : [];
}

/**
 * Levenshtein s gornjom granicom — prekida čim je jasno da je razlika veća
 * od `max`, pa cijena ostaje mala i kad se pretražuje kroz stotine pozicija.
 */
export function editDistance(a: string, b: string, max: number): number {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let best = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
            if (row[j] < best) best = row[j];
        }
        if (best > max) return max + 1;   // cijeli red je već predaleko
        prev = row;
    }
    return prev[b.length];
}

/**
 * Koliko grešaka token smije imati. Kratke riječi ne toleriraju ništa —
 * na tri slova je svaka zamjena već druga riječ.
 */
export function tolerance(len: number): number {
    if (len <= 3) return 0;
    if (len <= 6) return 1;
    return 2;
}

export interface FoldedText {
    /** Normalizovan tekst s razmacima. */
    text: string;
    /** Bez razmaka — hvata „t1a" u „T1.A" i „drvenaobloga" u „Drvena obloga". */
    squeezed: string;
    words: string[];
}

export function prepare(text: string): FoldedText {
    const folded = fold(text);
    return { text: folded, squeezed: folded.replace(/ /g, ''), words: folded ? folded.split(' ') : [] };
}

/**
 * Ocjena poklapanja, ili `null` kad neki token nije nađen.
 * Veće = bliže: doslovan početak riječi > doslovan podniz > spojeno > tipfeler.
 */
export function matchScore(prepared: FoldedText, tokens: string[]): number | null {
    if (tokens.length === 0) return 0;
    let score = 0;
    for (const token of tokens) {
        const hit = tokenScore(prepared, token);
        if (hit === null) return null;
        score += hit;
    }
    // Upit koji pogađa sam početak naziva je skoro uvijek ono što se tražilo.
    if (prepared.text.startsWith(tokens[0])) score += 3;
    return score;
}

function tokenScore(prepared: FoldedText, token: string): number | null {
    if (prepared.words.some(w => w === token)) return 6;
    if (prepared.words.some(w => w.startsWith(token))) return 5;
    if (prepared.text.includes(token)) return 4;
    if (prepared.squeezed.includes(token)) return 3;

    const max = tolerance(token.length);
    if (max === 0) return null;
    for (const word of prepared.words) {
        if (editDistance(word, token, max) <= max) return 2;
        // Tipfeler u dužoj riječi: poredi samo njen početak iste dužine
        // („kantiranj" ≈ „kantiranje"), inače razlika u dužini pojede budžet.
        if (word.length > token.length && editDistance(word.slice(0, token.length), token, max) <= max) return 1;
    }
    return null;
}

/** Filtriraj i poredaj po bliskosti; prazan upit vraća ulaz nepromijenjen. */
export function searchBy<T>(rows: T[], query: string, textOf: (row: T) => string): T[] {
    const tokens = queryTokens(query);
    if (tokens.length === 0) return rows;
    return rows
        .map(row => ({ row, score: matchScore(prepare(textOf(row)), tokens) }))
        .filter((r): r is { row: T; score: number } => r.score !== null)
        .sort((a, b) => b.score - a.score)
        .map(r => r.row);
}

/** Da li red prolazi upit (kad redoslijed određuje neko drugi). */
export function matches(text: string, tokens: string[]): boolean {
    return tokens.length === 0 || matchScore(prepare(text), tokens) !== null;
}
