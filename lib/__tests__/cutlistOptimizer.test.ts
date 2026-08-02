// ════════════════════════════════════════════════════════════════════
// TESTOVI OPTIMIZATORA KROJENJA
//
// Benchmark podaci su REKONSTRUISANI iz stvarnog projekta (PDF izvještaj
// "rezultati mog softwarea", 2026-07): stari optimizator je za ovih 114
// komada potrošio 12 ploča 2800×2070, a profesionalni softver 11 ploča
// na MANJOJ ploči 2790×2060. Novi optimizator mora dostići profesionalni
// nivo: ≤ 11 ploča na 2790×2060.
// ════════════════════════════════════════════════════════════════════

import { packGroup, packGroups } from '../cutlist/optimizer';
import { edgeBandingMeters, type CutPart, type CutlistSettings, type SheetLayout } from '../cutlist';

// [naziv, širina, visina, količina]
const BENCHMARK_PARTS: [string, number, number, number][] = [
    ['Dio 101', 1264, 988, 2],
    ['Component#32', 2598, 417, 1],
    ['Dio 58', 2598, 417, 1],
    ['Dio 34', 1488, 80, 1],
    ['Dio 72', 580, 80, 1],
    ['Dio 74', 467, 80, 1],
    ['Dio 57', 300, 80, 1],
    ['Component#25', 2598, 400, 1],
    ['Dio 59', 2598, 400, 1],
    ['Dio 105', 1230, 800, 1],
    ['Desna bočna 708', 1257, 708, 1],
    ['Desna bočna 378', 1357, 378, 1],
    ['Lijeva bočna 378', 1357, 378, 1],
    ['Lijeva bočna 708', 1257, 708, 1],
    ['Dio 63', 1257, 708, 1],
    ['Dio 64', 1257, 708, 1],
    ['Dio 97', 1357, 580, 1],
    ['Component#13 a', 1355, 577, 1],
    ['Dio 62', 1355, 577, 1],
    ['Dio 106', 1100, 790, 1],
    ['Dio 76', 1230, 553, 1],
    ['Dio 100', 1157, 580, 1],
    ['Dio 35', 1264, 528, 4],
    ['Dio 53', 528, 458, 4],
    ['Dio 39', 1264, 528, 4],
    ['Dio 75', 1230, 528, 1],
    ['Dio 60', 1357, 378, 1],
    ['Dio 61', 1357, 378, 1],
    ['Component#13 b', 1155, 577, 1],
    ['Dio 71', 1155, 577, 1],
    ['Dio 77', 1230, 528, 1],
    ['Dio 112', 800, 795, 1],
    ['Dio 107', 800, 790, 1],
    ['Dio 103', 1264, 494, 2],
    ['Dio 80', 1100, 553, 1],
    ['Dio 43', 1262, 491, 2],
    ['Dio 45', 1262, 491, 2],
    ['Dio 47', 1262, 491, 2],
    ['Dio 98', 1257, 480, 2],
    ['Component#13 c', 1255, 477, 2],
    ['Dio 67', 1255, 477, 2],
    ['Dio 81', 1064, 528, 2],
    ['Dio 78', 1228, 397, 1],
    ['Dio 49', 952, 528, 4],
    ['Dio 79', 1228, 397, 1],
    ['Desna bočna police', 1257, 378, 1],
    ['Lijeva bočna police', 1257, 378, 1],
    ['Dio 65', 1257, 378, 1],
    ['Dio 85', 790, 528, 2],
    ['Dio 66', 1257, 378, 1],
    ['Dio 83', 818, 553, 1],
    ['Dio 108', 795, 563, 1],
    ['Dio 109', 795, 563, 1],
    ['Desna bočna mala', 1157, 378, 1],
    ['Lijeva bočna mala', 1157, 378, 1],
    ['Dio 69', 1157, 378, 1],
    ['Dio 70', 1157, 378, 1],
    ['Dio 21', 544, 378, 7],
    ['Dio 28', 444, 378, 6],
    ['Dio 84', 790, 553, 1],
    ['Dio 89', 788, 548, 2],
    ['Dio 110', 764, 563, 2],
    ['Dio 87', 790, 528, 2],
    ['Dio 93', 764, 528, 4],
    ['Dio 113', 793, 397, 1],
    ['Dio 114', 793, 397, 1],
    ['Dio 91', 788, 397, 1],
    ['Dio 15', 708, 444, 6],
    ['Dio 92', 788, 397, 1],
    ['Dio 73', 544, 378, 1],
];

function makeParts(rows: [string, number, number, number][], materialKey = 'iveral-18'): CutPart[] {
    return rows.map(([name, width, height, qty], i) => ({
        id: `p${i}`,
        name,
        width,
        height,
        qty,
        materialRaw: materialKey,
        materialKey,
    }));
}

const SETTINGS: CutlistSettings = { kerf: 4, trim: 0, allowRotation: true };

/** Validacija fizike rasporeda: granice ploče, preklapanja, razmak reza. */
function validateSheets(sheets: SheetLayout[], usableW: number, usableH: number, kerf: number) {
    for (const sheet of sheets) {
        const pl = sheet.placements;
        for (const p of pl) {
            expect(p.x).toBeGreaterThanOrEqual(-0.01);
            expect(p.y).toBeGreaterThanOrEqual(-0.01);
            expect(p.x + p.w).toBeLessThanOrEqual(usableW + 0.01);
            expect(p.y + p.h).toBeLessThanOrEqual(usableH + 0.01);
        }
        for (let i = 0; i < pl.length; i++) {
            for (let j = i + 1; j < pl.length; j++) {
                const a = pl[i], b = pl[j];
                const sepX = a.x + a.w + kerf <= b.x + 0.01 || b.x + b.w + kerf <= a.x + 0.01;
                const sepY = a.y + a.h + kerf <= b.y + 0.01 || b.y + b.h + kerf <= a.y + 0.01;
                // Komadi moraju biti razdvojeni bar rezom po JEDNOJ osi.
                expect(sepX || sepY).toBe(true);
            }
        }
    }
}

describe('packGroup — benchmark protiv profesionalnog softvera', () => {
    const parts = makeParts(BENCHMARK_PARTS);
    const board = { width: 2790, height: 2060 };
    const result = packGroup(parts, board, SETTINGS, { timeBudgetMs: 8000, maxRestarts: 400 });

    const totalParts = BENCHMARK_PARTS.reduce((s, r) => s + r[3], 0);

    it('postavlja sve komade (114)', () => {
        expect(result.unplaced).toHaveLength(0);
        const placed = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);
        expect(placed).toBe(totalParts);
    });

    it('dostiže profesionalni nivo: ≤ 11 ploča (stari kod: 12)', () => {
        const avgEff = result.sheets.reduce((s, sh) => s + sh.efficiency, 0) / result.sheets.length;
        // eslint-disable-next-line no-console
        console.log(`[benchmark] ploča: ${result.sheets.length}, prosječna iskorištenost: ${avgEff.toFixed(1)}%, ` +
            `površina komada: ${(result.totalPartsArea / 1e6).toFixed(2)} m²`);
        expect(result.sheets.length).toBeLessThanOrEqual(11);
    });

    it('raspored je fizički validan (granice, preklapanja, kerf)', () => {
        validateSheets(result.sheets, result.usable.width, result.usable.height, SETTINGS.kerf);
    });

    it('ploče su sortirane od najpunije, rezovi imaju redoslijed', () => {
        for (let i = 1; i < result.sheets.length; i++) {
            expect(result.sheets[i - 1].usedArea + 0.01).toBeGreaterThanOrEqual(result.sheets[i].usedArea);
        }
        for (const sheet of result.sheets) {
            const orders = sheet.cuts.map(c => c.order);
            expect(orders).toEqual([...orders].sort((a, b) => a - b));
        }
    });
});

describe('packGroup — osnovna svojstva', () => {
    it('koristi rotaciju kad je isplativa (10× 500×400 na 2000×1000, kerf 0 → 1 ploča)', () => {
        const parts = makeParts([['P', 500, 400, 10]]);
        const result = packGroup(parts, { width: 2000, height: 1000 }, { kerf: 0, trim: 0, allowRotation: true });
        expect(result.sheets).toHaveLength(1);
    });

    it('bez rotacije isti slučaj traži 2 ploče', () => {
        const parts = makeParts([['P', 500, 400, 10]]);
        const result = packGroup(parts, { width: 2000, height: 1000 }, { kerf: 0, trim: 0, allowRotation: false });
        expect(result.sheets.length).toBeGreaterThanOrEqual(2);
    });

    it('poštuje canRotate=false po komadu', () => {
        const parts = makeParts([['P', 500, 400, 10]]).map(p => ({ ...p, canRotate: false }));
        const result = packGroup(parts, { width: 2000, height: 1000 }, { kerf: 0, trim: 0, allowRotation: true });
        for (const sheet of result.sheets) {
            for (const p of sheet.placements) expect(p.rotated).toBe(false);
        }
        expect(result.sheets.length).toBeGreaterThanOrEqual(2);
    });

    it('obrez ruba smanjuje korisnu površinu', () => {
        const parts = makeParts([['P', 2790, 2060, 1]]);
        const result = packGroup(parts, { width: 2800, height: 2070 }, { kerf: 4, trim: 10, allowRotation: true });
        // 2800−20=2780 < 2790 → komad ne staje.
        expect(result.unplaced).toHaveLength(1);
        expect(result.sheets).toHaveLength(0);
    });

    it('prevelik komad ide u unplaced, ostali se pakuju', () => {
        const parts = makeParts([['Prevelik', 3000, 500, 1], ['OK', 600, 400, 3]]);
        const result = packGroup(parts, { width: 2800, height: 2070 }, SETTINGS);
        expect(result.unplaced.map(p => p.name)).toEqual(['Prevelik']);
        expect(result.sheets.reduce((s, sh) => s + sh.placements.length, 0)).toBe(3);
    });

    it('determinističnost: isti unos → isti rezultat', () => {
        const parts = makeParts(BENCHMARK_PARTS.slice(0, 20));
        const a = packGroup(parts, { width: 2790, height: 2060 }, SETTINGS, { timeBudgetMs: 500, maxRestarts: 40 });
        const b = packGroup(parts, { width: 2790, height: 2060 }, SETTINGS, { timeBudgetMs: 500, maxRestarts: 40 });
        expect(JSON.stringify(a.sheets)).toBe(JSON.stringify(b.sheets));
    });
});

describe('VR grupa iz prakse (usmjereni dekor, 12 komada)', () => {
    // Stvaran slučaj (PDF 23.07.2026): korisnik pita zašto 12. komad ide na
    // svoju ploču. Bez rotacije je 12-na-1 MATEMATIČKI nemoguće: svi komadi
    // su ≥764 mm široki → max 3 "trake" po širini; visine 2×548 + 8×528 +
    // 2×397 se ni na koji način ne dijele u 3 stuba ≤2050 mm (4×528=2112).
    const rows: [string, number, number, number][] = [
        ['Dio 40', 788, 548, 2],
        ['Dio 43', 764, 528, 4],
        ['Dio 38', 790, 528, 2],
        ['Dio 39', 790, 528, 2],
        ['Dio 41', 788, 397, 1],
        ['Dio 42', 788, 397, 1],
    ];
    const board = { width: 2800, height: 2070 };

    it('bez rotacije: tačno 2 ploče (dokazani optimum)', () => {
        const r = packGroup(makeParts(rows), board,
            { kerf: 4, trim: 10, allowRotation: false }, { timeBudgetMs: 4000, maxRestarts: 300 });
        expect(r.sheets).toHaveLength(2);
        expect(r.sheets.reduce((s, sh) => s + sh.placements.length, 0)).toBe(12);
    });

    it('s rotacijom: svih 12 na JEDNU ploču', () => {
        const r = packGroup(makeParts(rows), board,
            { kerf: 4, trim: 10, allowRotation: true }, { timeBudgetMs: 4000, maxRestarts: 300 });
        expect(r.sheets).toHaveLength(1);
    });
});

describe('Nalog "Ormar na ulazu" (PDF 23.07.2026) — 4 grupe materijala', () => {
    // Drugi stvarni nalog: stari kod 12 ploča, profesionalni softver 11.
    // Nakon uvođenja globalnih traka + eliminacije s više kandidata: 10 —
    // SVE grupe na donjoj granici površine. Ovi pragovi su regresiona brana.
    const board = { width: 2800, height: 2070 };
    const cases: { name: string; rows: [string, number, number, number][]; rot: boolean; max: number }[] = [
        {
            name: 'K164', rot: true, max: 3, rows: [
                ['Dio 5', 1264, 528, 4], ['Dio 6', 1264, 528, 4], ['Dio 7', 1262, 491, 2],
                ['Dio 8', 1262, 491, 2], ['Dio 9', 1262, 491, 2], ['Dio 10', 952, 528, 4],
                ['Dio 11', 528, 458, 4], ['Dio 1', 708, 444, 6], ['Dio 2', 544, 378, 3],
                ['Dio 3', 444, 378, 6], ['Dio 4', 1488, 80, 1], ['Dio 12', 300, 80, 1],
            ],
        },
        {
            name: 'K003 (bez rotacije)', rot: false, max: 3, rows: [
                ['Dio 13', 2598, 417, 1], ['Dio 14', 2598, 400, 1], ['Dio 18', 1257, 708, 1],
                ['Dio 19', 1257, 708, 1], ['Dio 20', 1257, 378, 1], ['Dio 21', 1257, 378, 1],
                ['Dio 22', 1255, 477, 2], ['Dio 15', 1357, 378, 1], ['Dio 16', 1357, 378, 1],
                ['Dio 17', 1355, 577, 1], ['Dio 25', 1155, 577, 1], ['Dio 29', 1230, 528, 1],
                ['Dio 23', 1157, 378, 1], ['Dio 24', 1157, 378, 1], ['Dio 44', 795, 563, 1],
                ['Dio 45', 795, 563, 1], ['Dio 46', 764, 563, 2], ['Dio 47', 793, 397, 1],
                ['Dio 48', 793, 397, 1], ['Dio 49', 544, 378, 4], ['Dio 26', 580, 80, 1],
                ['Dio 27', 544, 378, 1], ['Dio 28', 467, 80, 1],
            ],
        },
        {
            name: 'VR (bez rotacije)', rot: false, max: 2, rows: [
                ['Dio 30', 1230, 553, 1], ['Dio 34', 1100, 553, 1], ['Dio 31', 1230, 528, 1],
                ['Dio 35', 1064, 528, 2], ['Dio 36', 818, 553, 1], ['Dio 37', 790, 553, 1],
                ['Dio 32', 1228, 397, 1], ['Dio 33', 1228, 397, 1],
                ['Dio 40', 788, 548, 2], ['Dio 43', 764, 528, 4], ['Dio 38', 790, 528, 2],
                ['Dio 39', 790, 528, 2], ['Dio 41', 788, 397, 1], ['Dio 42', 788, 397, 1],
            ],
        },
        {
            name: 'Lesomal', rot: true, max: 2, rows: [
                ['Dio 53', 1264, 988, 2], ['Dio 54', 1264, 494, 2], ['Dio 50', 1357, 580, 1],
                ['Dio 51', 1257, 480, 2], ['Dio 52', 1157, 580, 1], ['Dio 55', 1230, 800, 1],
                ['Dio 56', 1100, 790, 1], ['Dio 57', 800, 790, 1], ['Dio 58', 800, 795, 1],
            ],
        },
    ];

    let total = 0;

    it.each(cases)('$name: donja granica ploča + validan raspored', ({ rows, rot, max }) => {
        const result = packGroup(makeParts(rows), board,
            { kerf: 4, trim: 10, allowRotation: rot }, { timeBudgetMs: 5000, maxRestarts: 350 });
        total += result.sheets.length;
        expect(result.unplaced).toHaveLength(0);
        const placed = result.sheets.reduce((s, sh) => s + sh.placements.length, 0);
        expect(placed).toBe(rows.reduce((s, r) => s + r[3], 0));
        expect(result.sheets.length).toBeLessThanOrEqual(max);
        validateSheets(result.sheets, result.usable.width, result.usable.height, 4);
    });

    it('ukupno ≤ 10 ploča (profesionalni softver: 11, stari kod: 12)', () => {
        // eslint-disable-next-line no-console
        console.log(`[nalog-2] ukupno ploča: ${total}`);
        expect(total).toBeLessThanOrEqual(10);
    });
});

describe('packGroups — više materijala', () => {
    it('pakuje grupe odvojeno i čuva redoslijed', async () => {
        const iveral = makeParts([['A', 600, 400, 6]], 'iveral');
        const mdf = makeParts([['B', 800, 600, 4]], 'mdf');
        const results = await packGroups(
            [
                { parts: iveral, board: { width: 2800, height: 2070 } },
                { parts: mdf, board: { width: 2440, height: 1220 } },
            ],
            SETTINGS,
        );
        expect(results).toHaveLength(2);
        expect(results[0].materialKey).toBe('iveral');
        expect(results[1].materialKey).toBe('mdf');
        expect(results[0].sheets.reduce((s, sh) => s + sh.placements.length, 0)).toBe(6);
        expect(results[1].sheets.reduce((s, sh) => s + sh.placements.length, 0)).toBe(4);
    });
});

describe('regresija: dugačke tanke trake ne izlaze van ploče (iskoristivost ≤ 100%)', () => {
    // Realan slučaj koji je stari kod rušio: 300× 2560×120 se NE mogu rotirati
    // (2560 > korisna visina), pa je strip-pakovanje forsiralo portret i slagalo
    // komade IZVAN ploče → iskoristivost 119% i lažno manji broj ploča.
    const parts = makeParts([
        ['A dugačka', 2154, 110, 50],
        ['B dugačka', 2560, 120, 300],
        ['C srednja', 1250, 500, 50],
    ]);
    const board = { width: 2800, height: 2070 };
    const localSettings: CutlistSettings = { kerf: 4, trim: 10, allowRotation: true };
    const usableW = board.width - 2 * localSettings.trim;
    const usableH = board.height - 2 * localSettings.trim;
    const result = packGroup(parts, board, localSettings, { timeBudgetMs: 3000, maxRestarts: 150 });

    it('svi komadi unutar granica ploče i bez preklapanja', () => {
        expect(result.unplaced).toHaveLength(0);
        validateSheets(result.sheets, usableW, usableH, localSettings.kerf);
    });

    it('nijedna ploča nema iskoristivost > 100% (nema over-packinga)', () => {
        for (const sh of result.sheets) {
            expect(sh.efficiency).toBeLessThanOrEqual(100.01);
        }
    });

    it('broj ploča je fizički moguć (≥ ukupna površina / površina ploče)', () => {
        const minSheets = Math.ceil(result.totalPartsArea / (usableW * usableH));
        expect(result.sheets.length).toBeGreaterThanOrEqual(minSheets);
    });
});

describe('edgeBandingMeters', () => {
    it('računa metre kant trake po ivicama', () => {
        const parts: CutPart[] = [{
            id: 'x', name: 'Front', width: 600, height: 400, qty: 2,
            materialRaw: 'u', materialKey: 'u', edgeL: 2, edgeW: 1,
        }];
        // 2 kom × (2×600 + 1×400) = 3200 mm = 3.2 m
        expect(edgeBandingMeters(parts)).toBeCloseTo(3.2);
    });
});
