// ════════════════════════════════════════════════════════════════════
// KANONSKA PODJELA DNEVNICE — čista logika (bez Firebase), jedini izvor istine.
//
// Dnevnica radnika za jedan dan (× presence) RAVNOMJERNO se dijeli na N proizvoda
// na kojima je radnik radio tog dana. Centi se raspoređuju tako da je zbir TAČAN.
//
//   Daily_Rate_i  = round2(dnevnica × presence / N)   (uz raspodjelu zaostatka u centima)
//   Day_Fraction  = presence / N
//   Σ Daily_Rate  = round2(dnevnica × presence)        ← invarijanta (≤ 1 dnevnica/dan)
// ════════════════════════════════════════════════════════════════════

/** Normalizuj presence na dozvoljene vrijednosti: 0.5 (pola dana) ili 1 (cijeli dan). */
export function normalizePresence(presence: number | undefined | null): number {
    return presence === 0.5 ? 0.5 : 1;
}

/**
 * Niz iznosa za N logova tako da je Σ = round(dnevnica × presence) na cent.
 * Zaostatak u centima ide na prvih `rem` logova (npr. 130/6 → 21.67×4 + 21.66×2 = 130.00).
 */
export function splitDnevnicaExact(
    dnevnica: number,
    presence: number,
    n: number
): { amounts: number[]; dayFraction: number } {
    const p = normalizePresence(presence);
    const count = Math.max(1, Math.round(n));
    const totalCents = Math.max(0, Math.round((dnevnica || 0) * p * 100));
    const base = Math.floor(totalCents / count);
    const rem = totalCents - base * count;             // prvih `rem` logova dobije +1 cent
    const amounts = Array.from({ length: count }, (_, i) => (base + (i < rem ? 1 : 0)) / 100);
    const dayFraction = Math.round((p / count) * 1e6) / 1e6;
    return { amounts, dayFraction };
}

/** Jedan iznos po proizvodu (za UI prikaz uživo). Zbir može odstupati < 1 cent/proizvod. */
export function splitDnevnica(dnevnica: number, presence: number, n: number): number {
    const p = normalizePresence(presence);
    const count = Math.max(1, Math.round(n));
    return Math.round(((dnevnica || 0) * p / count) * 100) / 100;
}
