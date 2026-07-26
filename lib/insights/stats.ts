// ════════════════════════════════════════════════════════════════════
// STATISTIČKI HELPERI ZA PROFILE
//
// PRAVILO CIJELOG SLOJA: nijedan broj ne izlazi bez svog UZORKA (n).
// Medijan od dva naloga i medijan od pedeset izgledaju identično na ekranu,
// a znače potpuno različite stvari — pa `n` mora putovati uz vrijednost.
//
// Koristi se MEDIJAN i kvartili, ne prosjek: jedan katastrofalan nalog
// (dupli rad, čekanje mjesec dana) pomjeri prosjek, a medijan ne pomjeri.
// ════════════════════════════════════════════════════════════════════

export interface Dist {
    n: number;
    min: number;
    p25: number;
    p50: number;   // medijan — glavna mjera
    p75: number;
    max: number;
    mean: number;  // samo za poređenje s medijanom (razlika = iskošenost)
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Percentil linearnom interpolacijom nad SORTIRANIM nizom.
 * p ∈ [0,1]. Prazan niz → NaN (pozivalac mora provjeriti n).
 */
export function percentileOf(sorted: number[], p: number): number {
    const len = sorted.length;
    if (len === 0) return NaN;
    if (len === 1) return sorted[0];
    const pos = (len - 1) * Math.min(1, Math.max(0, p));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Raspodjela vrijednosti. `null` za prazan uzorak — nikad izmišljena nula. */
export function distribution(values: number[]): Dist | null {
    const clean = values.filter(v => typeof v === 'number' && isFinite(v));
    if (clean.length === 0) return null;
    const sorted = [...clean].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
        n: sorted.length,
        min: r2(sorted[0]),
        p25: r2(percentileOf(sorted, 0.25)),
        p50: r2(percentileOf(sorted, 0.5)),
        p75: r2(percentileOf(sorted, 0.75)),
        max: r2(sorted[sorted.length - 1]),
        mean: r2(sum / sorted.length),
    };
}

/**
 * Koeficijent varijacije (σ/μ) — mjera KOLIKO SE UOPŠTE MOŽE PREDVIDJETI.
 * Ključno za indikator spremnosti: ako je CV visok, procjena neće biti precizna
 * ma koliko podataka skupili. Bez ovog mjerila bi indikator pokazivao 95%,
 * a planiranje i dalje promašivalo.
 * `null` kad je uzorak < 2 ili je prosjek ~0 (omjer nema smisla).
 */
export function coefficientOfVariation(values: number[]): number | null {
    const clean = values.filter(v => typeof v === 'number' && isFinite(v));
    if (clean.length < 2) return null;
    const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
    if (Math.abs(mean) < 1e-9) return null;
    // Uzoračka varijansa (n−1): procjenjujemo populaciju iz uzorka, ne opisujemo uzorak.
    const variance = clean.reduce((s, v) => s + (v - mean) ** 2, 0) / (clean.length - 1);
    return r2(Math.sqrt(variance) / Math.abs(mean));
}

/** Udio u postotku, zaokružen na 1 decimalu. Djelitelj 0 → 0. */
export function sharePct(part: number, total: number): number {
    if (!total) return 0;
    return Math.round((part / total) * 1000) / 10;
}

/** Sortiraj silazno po `value`, pa stabilno po ključu (deterministično). */
export function sortByValueDesc<T extends { value: number; key: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key, 'hr'));
}

export { r2 as round2 };
