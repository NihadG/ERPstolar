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

/**
 * DVONIVOVSKA PODJELA — dnevnica × presence se prvo RAVNOMJERNO dijeli na NALOGE
 * (na kojima je radnik radio taj dan), pa se udio svakog naloga RAVNOMJERNO dijeli
 * na njegove proizvode. Centi se raspoređuju na oba nivoa tako da je Σ TAČAN.
 *
 *   udio_naloga   = round2(dnevnica × presence / brojNaloga)
 *   iznos_proizvoda = round2(udio_naloga / proizvodaUNalogu)
 *   Day_Fraction  = presence / (brojNaloga × proizvodaUNalogu)
 *   Σ svih iznosa = round2(dnevnica × presence)        ← invarijanta (≤ 1 dnevnica/dan)
 *   Σ svih Day_Fraction = presence
 *
 * Za jedan nalog ([n]) rezultat je IDENTIČAN splitDnevnicaExact(dnevnica, presence, n).
 *
 * @param orderItemCounts broj proizvoda po nalogu, npr. [12, 1] = prvi nalog 12, drugi 1
 * @returns amounts[oi][j] i dayFractions[oi][j] u istom redoslijedu kao orderItemCounts
 */
export interface RateHistoryEntry { Effective_From: string; Rate: number }

/**
 * Dnevnica radnika VAŽEĆA na zadati datum (YYYY-MM-DD). Čita iz `Daily_Rate_History`
 * (najkasniji unos čiji je `Effective_From` ≤ date). Ako je datum prije svih unosa →
 * najraniji poznati. Ako nema istorije → fallback na trenutnu `Daily_Rate`.
 * Sprječava da retroaktivni unos ili preračun starog dana koristi pogrešnu (današnju) cijenu.
 */
export function effectiveDailyRate(
    worker: { Daily_Rate?: number; Daily_Rate_History?: RateHistoryEntry[] } | undefined | null,
    date: string
): number {
    if (!worker) return 0;
    const hist = worker.Daily_Rate_History;
    if (Array.isArray(hist) && hist.length > 0 && date) {
        const d = date.split('T')[0];
        let best: RateHistoryEntry | undefined; let bestFrom = '';
        let earliest: RateHistoryEntry | undefined; let earliestFrom = '';
        for (const h of hist) {
            if (!h || typeof h.Rate !== 'number' || !h.Effective_From) continue;
            const ef = h.Effective_From.split('T')[0];
            if (!earliest || ef < earliestFrom) { earliest = h; earliestFrom = ef; }
            if (ef <= d && (!best || ef > bestFrom)) { best = h; bestFrom = ef; }
        }
        if (best) return best.Rate;
        if (earliest) return earliest.Rate;
    }
    return worker.Daily_Rate || 0;
}

export function splitDnevnicaByOrder(
    dnevnica: number,
    presence: number,
    orderItemCounts: number[]
): { amounts: number[][]; dayFractions: number[][] } {
    const p = normalizePresence(presence);
    const counts = (orderItemCounts.length > 0 ? orderItemCounts : [1]).map(c => Math.max(1, Math.round(c)));
    const numOrders = counts.length;
    const totalCents = Math.max(0, Math.round((dnevnica || 0) * p * 100));

    // Nivo 1: totalCents → nalozi (zaostatak centa na prve naloge)
    const baseO = Math.floor(totalCents / numOrders);
    const remO = totalCents - baseO * numOrders;
    const orderCents = counts.map((_, i) => baseO + (i < remO ? 1 : 0));

    const amounts: number[][] = [];
    const dayFractions: number[][] = [];
    counts.forEach((count, oi) => {
        // Nivo 2: orderCents[oi] → proizvodi tog naloga
        const baseI = Math.floor(orderCents[oi] / count);
        const remI = orderCents[oi] - baseI * count;
        amounts.push(Array.from({ length: count }, (_, j) => (baseI + (j < remI ? 1 : 0)) / 100));
        const df = Math.round((p / (numOrders * count)) * 1e6) / 1e6;
        dayFractions.push(Array.from({ length: count }, () => df));
    });
    return { amounts, dayFractions };
}

// ════════════════════════════════════════════════════════════════════
// PODJELA DANA PO ZAPISIMA — s izričitim udjelom (Day_Weight)
//
// Dnevni upis rada („Imer pola dana lakiranje, ostatak na dva druga posla")
// zna TAČAN udio dana po poslu. Taj udio nosi zapis kao `Day_Weight` (0–1)
// i svaka renormalizacija dana ga mora poštovati — inače bi sljedeća izmjena
// u šihtarici tiho vratila jednaku podjelu.
//
//   • nijedan zapis nema težinu → IDENTIČNO splitDnevnicaByOrder (nalog → proizvod)
//   • Σ težina < 1 → zapisi s težinom dobiju tačno svoj udio, ostatak se dijeli
//     dvonivovski na zapise bez težine
//   • zapisi bez težine uz Σ težina ≥ 1 (npr. kasnije dodan ručni unos) → svaki
//     takav zapis dobije 1/N dana, a težinski dijele ostatak srazmjerno
//
// Invarijanta ostaje: Σ iznosa = round2(dnevnica × presence), Σ Day_Fraction = presence.
// ════════════════════════════════════════════════════════════════════

export interface DayLogInput { Work_Order_ID?: string; Day_Weight?: number }
export interface DayLogShare { amount: number; dayFraction: number; splitFactor: number }

export function splitWorkerDay(dnevnica: number, presence: number, logs: DayLogInput[]): DayLogShare[] {
    if (logs.length === 0) return [];
    const p = normalizePresence(presence);
    const weightOf = (l: DayLogInput) => (typeof l.Day_Weight === 'number' && l.Day_Weight > 0 ? l.Day_Weight : 0);

    if (!logs.some(weightOf)) {
        const orderIds: string[] = [];
        const byOrder = new Map<string, number[]>();
        logs.forEach((l, i) => {
            const id = l.Work_Order_ID || '__none__';
            if (!byOrder.has(id)) { byOrder.set(id, []); orderIds.push(id); }
            byOrder.get(id)!.push(i);
        });
        const { amounts, dayFractions } = splitDnevnicaByOrder(dnevnica, p, orderIds.map(id => byOrder.get(id)!.length));
        const out: DayLogShare[] = new Array(logs.length);
        orderIds.forEach((id, oi) => byOrder.get(id)!.forEach((idx, j) => {
            out[idx] = { amount: amounts[oi][j], dayFraction: dayFractions[oi][j], splitFactor: orderIds.length * byOrder.get(id)!.length };
        }));
        return out;
    }

    // Udio dana (zbir 1) po zapisu.
    const share = new Array<number>(logs.length).fill(0);
    const weighted = logs.map((l, i) => i).filter(i => weightOf(logs[i]) > 0);
    const plain = logs.map((l, i) => i).filter(i => weightOf(logs[i]) === 0);
    const W = weighted.reduce((s, i) => s + weightOf(logs[i]), 0);
    if (W < 1 && plain.length) {
        weighted.forEach(i => { share[i] = weightOf(logs[i]); });
        const rest = 1 - W;
        const orderIds: string[] = [];
        const byOrder = new Map<string, number[]>();
        plain.forEach(i => {
            const id = logs[i].Work_Order_ID || '__none__';
            if (!byOrder.has(id)) { byOrder.set(id, []); orderIds.push(id); }
            byOrder.get(id)!.push(i);
        });
        orderIds.forEach(id => byOrder.get(id)!.forEach(i => { share[i] = rest / orderIds.length / byOrder.get(id)!.length; }));
    } else {
        const plainShare = plain.length ? 1 / logs.length : 0;
        const forWeighted = 1 - plainShare * plain.length;
        plain.forEach(i => { share[i] = plainShare; });
        weighted.forEach(i => { share[i] = forWeighted * weightOf(logs[i]) / W; });
    }

    // Centi: najveći ostatak, pa je zbir tačan.
    const totalCents = Math.max(0, Math.round((dnevnica || 0) * p * 100));
    const exact = share.map(s => totalCents * s);
    const cents = exact.map(Math.floor);
    let rem = totalCents - cents.reduce((s, c) => s + c, 0);
    exact.map((v, i) => ({ i, r: v - cents[i] }))
        .sort((a, b) => b.r - a.r || a.i - b.i)
        .forEach(({ i }) => { if (rem > 0) { cents[i]++; rem--; } });
    return share.map((s, i) => ({
        amount: cents[i] / 100,
        dayFraction: Math.round(p * s * 1e6) / 1e6,
        splitFactor: Math.max(1, Math.round(1 / (s || 1))),
    }));
}
