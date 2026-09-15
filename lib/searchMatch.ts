// ════════════════════════════════════════════════════════════════════
// PRETRAGA U KORISNIČKOM SUČELJU
//
// Jedno mjesto za "kucaj i nađi" polja (projekti u narudžbi, radnici u
// batchu…). Dvije stvari koje naivni `includes()` ne rješava:
//
//   1. DIJAKRITIKA — korisnik kuca "cosic" a u bazi piše "Čošić". Bez
//      skidanja kvačica pretraga tiho ne vraća ništa, pa polje izgleda
//      pokvareno.
//   2. REDOSLIJED RIJEČI — "bajrak nedim" mora naći "Nedim Bajraktarević".
//      Zato se upit cijepa na tokene i svaki se traži nezavisno.
//
// Rangiranje postoji da bi Enter na prvom rezultatu bio predvidiv: tačan
// pogodak → početak riječi → bilo gdje u tekstu.
// ════════════════════════════════════════════════════════════════════

import { SPECIAL_LETTERS } from './classify/patternNormalize';

/** Mala slova, bez dijakritike, sa kolapsiranim razmacima. */
export function normalizeForSearch(value: string | null | undefined): string {
    let out = '';
    for (const ch of value || '') out += SPECIAL_LETTERS[ch] ?? ch;
    return out
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

/** Upit → lista tokena (prazan upit daje prazan niz = "sve prolazi"). */
export function searchTokens(query: string | null | undefined): string[] {
    const norm = normalizeForSearch(query);
    return norm ? norm.split(' ') : [];
}

/** Da li svi tokeni upita postoje negdje u ponuđenim poljima. */
export function matchesSearch(tokens: string[], ...fields: (string | null | undefined)[]): boolean {
    if (tokens.length === 0) return true;
    const haystack = fields.map(normalizeForSearch).filter(Boolean).join(' ');
    if (!haystack) return false;
    return tokens.every(t => haystack.includes(t));
}

/**
 * Ocjena poklapanja za sortiranje rezultata — veće je bolje, 0 znači "nije pogodak".
 * Primarno polje (prvo u nizu) nosi više bodova od sporednih.
 */
export function searchScore(tokens: string[], ...fields: (string | null | undefined)[]): number {
    if (tokens.length === 0) return 1;
    const normFields = fields.map(normalizeForSearch);
    const haystack = normFields.filter(Boolean).join(' ');
    if (!haystack) return 0;

    let score = 0;
    for (const token of tokens) {
        if (!haystack.includes(token)) return 0;

        let best = 1; // pogodak bilo gdje
        normFields.forEach((field, idx) => {
            if (!field) return;
            const fieldWeight = idx === 0 ? 2 : 1;
            let points = 0;
            if (field === token) points = 8;
            else if (field.startsWith(token)) points = 6;
            else if (field.split(' ').some(w => w.startsWith(token))) points = 4;
            else if (field.includes(token)) points = 2;
            best = Math.max(best, points * fieldWeight);
        });
        score += best;
    }
    return score;
}

/**
 * Rasponi [start, end) u IZVORNOM tekstu koje treba podebljati.
 *
 * Poređenje ide nad normalizovanim tekstom, pa se indeksi moraju vratiti nazad:
 * za svaki normalizovani znak pamtimo iz kojeg je izvornog nastao. Bez te mape
 * bi "cosic" podebljao pogrešne znakove u "Čošić" (dijakritički znakovi se u NFD
 * razlažu na dva koda, a `ǆ` se preslikava u dva slova).
 */
export function highlightRanges(text: string, tokens: string[]): [number, number][] {
    if (!text || tokens.length === 0) return [];

    let norm = '';
    const srcIdx: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const mapped = SPECIAL_LETTERS[text[i]] ?? text[i];
        const clean = mapped.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        for (const c of clean) { norm += c; srcIdx.push(i); }
    }
    if (!norm) return [];

    const ranges: [number, number][] = [];
    for (const token of tokens) {
        if (!token) continue;
        // Korak je 1, ne dužina tokena: u „banana" se „ana" javlja i na 1 i na 3,
        // a preskakanje bi drugo pojavljivanje ostavilo neosvijetljeno. Preklapanja
        // sređuje spajanje ispod.
        let from = norm.indexOf(token);
        while (from !== -1) {
            ranges.push([srcIdx[from], srcIdx[from + token.length - 1] + 1]);
            from = norm.indexOf(token, from + 1);
        }
    }
    if (ranges.length === 0) return [];

    // Spoji preklapanja — dva tokena mogu pogoditi isti dio riječi.
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [ranges[0]];
    for (const [s, e] of ranges.slice(1)) {
        const last = merged[merged.length - 1];
        if (s <= last[1]) last[1] = Math.max(last[1], e);
        else merged.push([s, e]);
    }
    return merged;
}
