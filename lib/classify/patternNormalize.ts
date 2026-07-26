// ════════════════════════════════════════════════════════════════════
// NORMALIZACIJA PATTERNA ZA PRAVILA KLASIFIKACIJE
//
// Dvije vrste patterna se porede protiv RAZLIČITO normalizovanog teksta:
//
//   PROIZVODI  → lib/classify/classify.ts → normalizeName (dedupeProcessKey)
//                SKIDA dijakritiku  ⇒ pattern mora biti BEZ nje
//                („špera" se nikad ne bi poklopio jer tekst postane „spera")
//
//   MATERIJALI → lib/productProcesses.ts → norm = trim().toLowerCase()
//                ZADRŽAVA dijakritiku ⇒ treba i varijanta S njom
//                (postojeći kod već ima taj obrazac: patterns ['šark','sark'])
//
// Bez ovoga bi pravilo bilo uredno upisano u bazu, a nikad se ne bi okinulo —
// tiha greška koju bi korisnik vidio tek kao „AI ne radi".
// ════════════════════════════════════════════════════════════════════

/** Minimalna dužina patterna — kraći hvata nevezane riječi. */
export const MIN_PATTERN_LEN = 3;

/**
 * Slova koja NFD ne razlaže, pa ih Unicode normalizacija sama ne bi presložila.
 * č/ć/ž/š jesu baza + kombinujući znak (razlažu se), ali `đ` je JEDAN kodni znak
 * (U+0111 — d s precrtom), pa bi bez ovoga „Vođice" i „Vodice" bili različiti
 * ključevi. Isto vrijedi za ostatak sistema, zato ovu mapu dijeli i dedupeProcessKey.
 */
export const SPECIAL_LETTERS: Record<string, string> = {
    'đ': 'd', 'Đ': 'd',
    'ǆ': 'dz', 'ǅ': 'dz', 'Ǆ': 'dz',
};

/** Skini dijakritiku (NFD razlaganje + brisanje kombinujućih znakova U+0300–U+036F). */
export function stripDiacritics(s: string): string {
    let out = '';
    for (const ch of s || '') out += SPECIAL_LETTERS[ch] ?? ch;
    return out.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Pripremi pattern za upis u pravilo. Vraća prazan niz kad je pattern neupotrebljiv
 * (prekratak) — pozivalac takav prijedlog odbacuje.
 */
export function normalizePattern(raw: string, kind: 'product' | 'material'): string[] {
    const base = (raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!base || base.length < MIN_PATTERN_LEN) return [];

    if (kind === 'product') return [stripDiacritics(base)];

    const stripped = stripDiacritics(base);
    return stripped === base ? [base] : [base, stripped];
}
