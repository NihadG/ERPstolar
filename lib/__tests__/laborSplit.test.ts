/**
 * Unit testovi za kanonsku podjelu dnevnice (lib/laborSplit.ts).
 * Invarijanta: dnevnica radnika za dan se RAVNOMJERNO dijeli na N proizvoda,
 * a zbir podijeljenih iznosa = round(dnevnica × presence) na cent.
 */

import { splitDnevnicaExact, splitDnevnica, splitDnevnicaByOrder, normalizePresence } from '../laborSplit';

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (a: number[]) => round2(a.reduce((s, x) => s + x, 0));
const flat = (a: number[][]) => a.reduce((acc, x) => acc.concat(x), [] as number[]);

describe('normalizePresence', () => {
    test('0.5 ostaje 0.5; sve ostalo → 1', () => {
        expect(normalizePresence(0.5)).toBe(0.5);
        expect(normalizePresence(1)).toBe(1);
        expect(normalizePresence(undefined)).toBe(1);
        expect(normalizePresence(0)).toBe(1);
        expect(normalizePresence(0.25)).toBe(1);
    });
});

describe('splitDnevnicaExact — scenario iz prijave (130 KM, 6 proizvoda)', () => {
    test('cijeli dan: zbir je TAČNO 130, svaki ~21.67', () => {
        const { amounts, dayFraction } = splitDnevnicaExact(130, 1, 6);
        expect(amounts).toHaveLength(6);
        expect(sum(amounts)).toBe(130);                 // ne 6×130=780
        amounts.forEach(a => expect(a).toBeGreaterThanOrEqual(21.66));
        amounts.forEach(a => expect(a).toBeLessThanOrEqual(21.67));
        expect(dayFraction).toBeCloseTo(1 / 6, 6);
    });

    test('pola dana: zbir je TAČNO 65', () => {
        const { amounts, dayFraction } = splitDnevnicaExact(130, 0.5, 6);
        expect(sum(amounts)).toBe(65);
        expect(dayFraction).toBeCloseTo(0.5 / 6, 6);
    });
});

describe('splitDnevnicaExact — osnovni slučajevi', () => {
    test('1 proizvod = puna dnevnica', () => {
        expect(splitDnevnicaExact(130, 1, 1).amounts).toEqual([130]);
        expect(splitDnevnicaExact(80, 1, 1).amounts).toEqual([80]);
    });

    test('2 proizvoda = pola-pola', () => {
        expect(splitDnevnicaExact(130, 1, 2).amounts).toEqual([65, 65]);
    });

    test('3 proizvoda: zaostatak centa ide na prvi (Σ = 130)', () => {
        const { amounts } = splitDnevnicaExact(130, 1, 3);
        expect(amounts).toEqual([43.34, 43.33, 43.33]);
        expect(sum(amounts)).toBe(130);
    });

    test('pola dana, 1 proizvod = pola dnevnice', () => {
        expect(splitDnevnicaExact(80, 0.5, 1).amounts).toEqual([40]);
    });

    test('dnevnica 0 → svi iznosi 0', () => {
        const { amounts } = splitDnevnicaExact(0, 1, 4);
        expect(amounts).toEqual([0, 0, 0, 0]);
    });

    test('n<=0 se tretira kao 1 (bez dijeljenja s nulom)', () => {
        expect(splitDnevnicaExact(100, 1, 0).amounts).toEqual([100]);
    });
});

describe('splitDnevnicaExact — INVARIJANTA zbira (mnogo kombinacija)', () => {
    const rates = [0, 50, 80, 100, 130, 137, 200, 333.33];
    const counts = [1, 2, 3, 4, 5, 6, 7, 9, 12];
    const presences = [1, 0.5];

    test('Σ amounts === round(dnevnica × presence) za svaku kombinaciju', () => {
        for (const rate of rates) {
            for (const p of presences) {
                for (const n of counts) {
                    const { amounts, dayFraction } = splitDnevnicaExact(rate, p, n);
                    expect(amounts).toHaveLength(n);
                    expect(sum(amounts)).toBe(round2(rate * p));      // zbir uvijek tačan
                    expect(dayFraction).toBeCloseTo(p / n, 6);        // težina dana po proizvodu
                    // ni jedan iznos ne smije biti negativan, niti veći od pune dnevnice
                    amounts.forEach(a => {
                        expect(a).toBeGreaterThanOrEqual(0);
                        expect(a).toBeLessThanOrEqual(round2(rate * p) + 0.01);
                    });
                }
            }
        }
    });
});

describe('splitDnevnicaByOrder — dvonivovska podjela (po nalogu pa po proizvodu)', () => {
    test('SCENARIO KORISNIKA: nalog A (12 proizvoda) + nalog B (1), cijeli dan → 65 na A, 65 na B', () => {
        const { amounts, dayFractions } = splitDnevnicaByOrder(130, 1, [12, 1]);
        // svaki nalog dobije po 65 (NE 130/13)
        expect(sum(amounts[0])).toBe(65);
        expect(sum(amounts[1])).toBe(65);
        expect(amounts[1]).toEqual([65]);            // jedini proizvod naloga B = pun udio naloga
        // ukupno tačno 130, bez gubitka centa
        expect(sum(flat(amounts))).toBe(130);
        // Σ Day_Fraction == presence (1)
        expect(round2(flat(dayFractions).reduce((s, x) => s + x, 0))).toBe(1);
        // proizvod naloga B nosi mnogo veći Day_Fraction (0.5) od proizvoda naloga A (1/24)
        expect(dayFractions[1][0]).toBeCloseTo(0.5, 6);
        dayFractions[0].forEach(df => expect(df).toBeCloseTo(1 / 24, 6));
    });

    test('dva naloga [3,2], cijeli dan → 65/65; unutar naloga ravnomjerno', () => {
        const { amounts } = splitDnevnicaByOrder(130, 1, [3, 2]);
        expect(sum(amounts[0])).toBe(65);            // nalog A: 3 proizvoda → ~21.67 svaki
        expect(sum(amounts[1])).toBe(65);            // nalog B: 2 proizvoda → 32.5 svaki
        expect(amounts[1]).toEqual([32.5, 32.5]);
        expect(sum(flat(amounts))).toBe(130);
    });

    test('jedan nalog [n] == splitDnevnicaExact (kompatibilnost unazad)', () => {
        for (const n of [1, 2, 3, 6, 13]) {
            for (const p of [1, 0.5]) {
                const byOrder = splitDnevnicaByOrder(130, p, [n]);
                const exact = splitDnevnicaExact(130, p, n);
                expect(flat(byOrder.amounts)).toEqual(exact.amounts);
                expect(byOrder.dayFractions[0][0]).toBeCloseTo(exact.dayFraction, 6);
            }
        }
    });

    test('pola dana, dva naloga [2,2] → Σ = 65, po nalogu 32.5', () => {
        const { amounts, dayFractions } = splitDnevnicaByOrder(130, 0.5, [2, 2]);
        expect(sum(flat(amounts))).toBe(65);
        expect(sum(amounts[0])).toBe(32.5);
        expect(sum(amounts[1])).toBe(32.5);
        expect(round2(flat(dayFractions).reduce((s, x) => s + x, 0))).toBe(0.5);
    });

    test('INVARIJANTA: Σ == round(dnevnica × presence) i Σ dayFraction == presence (mnogo kombinacija)', () => {
        const rates = [0, 80, 130, 137, 333.33];
        const presences = [1, 0.5];
        const layouts = [[1], [12, 1], [3, 2], [5, 5, 5], [7, 1, 1, 1], [2, 9, 4]];
        for (const rate of rates) {
            for (const p of presences) {
                for (const layout of layouts) {
                    const { amounts, dayFractions } = splitDnevnicaByOrder(rate, p, layout);
                    expect(sum(flat(amounts))).toBe(round2(rate * p));
                    expect(round2(flat(dayFractions).reduce((s, x) => s + x, 0))).toBeCloseTo(p, 6);
                    // svaki nalog dobije jednak udio (±1 cent zbog raspodjele)
                    layout.forEach((_, oi) => {
                        const share = sum(amounts[oi]);
                        expect(Math.abs(share - round2(rate * p) / layout.length)).toBeLessThanOrEqual(0.01);
                    });
                }
            }
        }
    });
});

describe('splitDnevnica (prikaz uživo)', () => {
    test('vraća iznos po proizvodu, zaokružen na 2 decimale', () => {
        expect(splitDnevnica(130, 1, 6)).toBe(21.67);
        expect(splitDnevnica(130, 1, 2)).toBe(65);
        expect(splitDnevnica(130, 0.5, 6)).toBe(10.83);
        expect(splitDnevnica(80, 1, 1)).toBe(80);
    });
});
