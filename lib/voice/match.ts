// ════════════════════════════════════════════════════════════════════
// Prepoznavanje radnika i projekta iz diktata.
//
// Prije: `Client_Name.includes(prijedlog)` — puklo bi čim model vrati
// „Hodžić (Ilidža)" (tako mu je lista bila formatirana), „Hodžića", „Dzenan"
// ili ime koje dijele dvojica radnika. Sada se poredi riječ po riječ, bez
// dijakritika i padežnih nastavaka, uz toleranciju na jedno-dva slova
// greške transkripcije — a dvosmislen pogodak se NE pogađa (vraća null).
// ════════════════════════════════════════════════════════════════════

import { foldText, tokens, stem, editDistance } from './text';

export interface MatchCandidate {
    id: string;
    /** Sve po čemu se entitet može izgovoriti: ime, klijent, naziv, mjesto… */
    names: string[];
}

// Riječi koje ne nose identitet („kuhinja za Hodžića", „kod Emira").
const STOP = new Set([
    'za', 'kod', 'od', 'do', 'u', 'na', 'i', 'sa', 's', 'iz', 'projekat', 'projekt', 'klijent', 'klijenta',
    'gospodin', 'gospodina', 'gospodja', 'gospodje', 'firma', 'firme', 'doo', 'd.o.o', 'radnik', 'radnika',
]);

function words(s: string): string[] {
    return tokens(foldText(s)).filter(w => w.length > 1 && !STOP.has(w));
}

/** 1 = isto, 0.9 = isti korijen/prefiks, 0.8 = sitna greška u slovima, 0 = ne. */
export function tokenSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    const sa = stem(a), sb = stem(b);
    if (sa === sb) return 0.92;
    const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
    if (short.length >= 4 && long.startsWith(short)) return 0.88;
    const len = Math.max(sa.length, sb.length);
    if (len >= 5) {
        const d = editDistance(sa, sb, 2);
        if (d === 1) return 0.82;
        if (d === 2 && len >= 8) return 0.75;
    }
    return 0;
}

/**
 * Koliko dobro izgovoreni izraz pokriva kandidata (0..1). Svaka riječ upita
 * mora naći par među riječima kandidata; prosjek tih sličnosti je ocjena.
 */
export function matchScore(query: string, candidateNames: string[]): number {
    const q = words(query);
    if (!q.length) return 0;
    let best = 0;
    for (const name of candidateNames) {
        const c = words(name);
        if (!c.length) continue;
        let sum = 0;
        for (const qw of q) {
            let w = 0;
            for (const cw of c) w = Math.max(w, tokenSimilarity(qw, cw));
            if (w === 0) { sum = -1; break; }
            sum += w;
        }
        if (sum > 0) best = Math.max(best, sum / q.length);
    }
    return best;
}

export interface MatchResult { id: string; score: number }

/**
 * Najbolji kandidat ili null. Null i kad su dva kandidata podjednako dobra
 * (dva „Emira") — bolje ostaviti prazno nego dodijeliti pogrešnom.
 */
export function bestMatch(query: string | null | undefined, candidates: MatchCandidate[], minScore = 0.74): MatchResult | null {
    if (!query || !query.trim()) return null;
    const scored = candidates
        .map(c => ({ id: c.id, score: matchScore(query, c.names) }))
        .filter(s => s.score >= minScore)
        .sort((a, b) => b.score - a.score);
    if (!scored.length) return null;
    if (scored.length > 1 && scored[1].score >= scored[0].score - 0.02 && scored[1].id !== scored[0].id) return null;
    return scored[0];
}
