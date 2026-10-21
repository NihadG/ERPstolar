// ════════════════════════════════════════════════════════════════════
// Normalizacija teksta za glasovni unos.
//
// Whisper zna napisati „Dzenan" umjesto „Dženan", „Djuro" umjesto „Đuro",
// a padeži mijenjaju završetke („za Hodžića", „kod Emira"). Sve poređenje
// imena i prepoznavanje datuma radi nad ovim oblikom: mala slova, bez
// dijakritika, đ → dj, interpunkcija → razmak.
// ════════════════════════════════════════════════════════════════════

export function foldText(s: string): string {
    return (s || '')
        .toLowerCase()
        .replace(/đ/g, 'dj')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9.\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Riječi (bez tačaka/crtica) iz već presavijenog teksta. */
export function tokens(folded: string): string[] {
    return folded.split(/[\s.\-]+/).filter(Boolean);
}

// Padežni nastavci, od najdužeg ka najkraćem. Za imena i prezimena je
// dovoljno: Hodžića/Hodžiću/Hodžićem → hodzic, Emira/Emiru/Emirom → emir.
const SUFFIXES = ['ovima', 'evima', 'ima', 'ama', 'om', 'em', 'og', 'eg', 'oj', 'u', 'a', 'e', 'i', 'o'];

export function stem(token: string): string {
    if (token.length < 4) return token;
    for (const suf of SUFFIXES) {
        if (token.endsWith(suf) && token.length - suf.length >= 3) return token.slice(0, -suf.length);
    }
    return token;
}

/** Levenshtein s ranim izlazom kad razlika pređe `max`. */
export function editDistance(a: string, b: string, max = 3): number {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
}
