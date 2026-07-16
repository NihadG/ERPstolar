/**
 * SCENARIO / INTEGRACIJSKI TESTOVI — kompleksne situacije iz prakse.
 *
 * Cilj: provjeriti da su međusobno KONZISTENTNI i bez "drifta" (gubitka/duplanja centa):
 *   1) podjela dnevnice na proizvode (lib/laborSplit.ts → saveDailyWorkBooking),
 *   2) trošak rada po proizvodu i zarada radnika (lib/productivity.ts, lib/attendance.ts),
 *   3) rok naloga / praćenje datuma (lib/planning.ts),
 *   4) formula profita po proizvodu i po nalogu (lib/productivity.ts).
 *
 * Čista logika (planning, laborSplit) se uvozi DIREKTNO iz produkcije.
 * Formule troška i profita su VJERNO preslikane iz lib/productivity.ts
 * (reference na linije u komentarima) kako bismo numerički, bez Firebase-a,
 * pokazali (ne)konzistentnost i pronašli granične greške.
 */

import { splitDnevnicaExact, normalizePresence } from '../laborSplit';
import { workOrderDueDate, isWorkingDay, buildSaturdayChecker, type AttendanceLite } from '../planning';
import { itemMaterialTotal, isItemMaterialFrozen } from '../materialCost';
import { projectProfitBreakdown } from '../projectProfit';
import { distributeAmountByQuantity } from '../invoicePricing';
import { resolveLaborCostTarget, type LaborTargetItem } from '../laborTarget';

// ── helpers ─────────────────────────────────────────────────────────────────
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (a: number[]) => round2(a.reduce((s, x) => s + x, 0));

/** In-memory work log, kakav saveDailyWorkBooking upisuje (attendance.ts ~924). */
interface Log {
    worker: string;
    workerName: string;
    date: string;
    itemId: string;
    rate: number;          // Daily_Rate (već podijeljen)
    originalRate: number;  // Original_Daily_Rate (puna dnevnica)
    dayFraction: number;   // Day_Fraction = presence / N
    presence: number;
}

/**
 * Mirror saveDailyWorkBooking-a (attendance.ts:903-950): dnevnica × presence
 * RAVNOMJERNO na N proizvoda na kojima radnik radi taj dan.
 */
function book(opts: {
    worker: string; workerName?: string; dnevnica: number; date: string;
    presence?: number; items: string[];
}): Log[] {
    const presence = normalizePresence(opts.presence);
    const n = opts.items.length;
    if (n === 0) return [];
    const { amounts, dayFraction } = splitDnevnicaExact(opts.dnevnica, presence, n);
    return opts.items.map((itemId, i) => ({
        worker: opts.worker,
        workerName: opts.workerName ?? opts.worker,
        date: opts.date,
        itemId,
        rate: amounts[i] ?? 0,
        originalRate: opts.dnevnica,
        dayFraction,
        presence,
    }));
}

/** Trošak rada proizvoda = Σ Daily_Rate svih logova tog itema (productivity.ts:242, attendance.ts:2635). */
function itemLaborCost(logs: Log[], itemId: string): number {
    return round2(logs.filter(l => l.itemId === itemId).reduce((s, l) => s + l.rate, 0));
}

/** Zarada radnika: dani = BROJ JEDINSTVENIH DATUMA (PROFIT-07), total = Σ rate (productivity.ts:423-451). */
function workerEarnings(logs: Log[], worker: string): { days: number; total: number } {
    const mine = logs.filter(l => l.worker === worker);
    const days = new Set(mine.map(l => l.date)).size;
    return { days, total: round2(mine.reduce((s, l) => s + l.rate, 0)) };
}

// ── Formule profita — VJERAN MIRROR lib/productivity.ts ───────────────────────
interface ItemFin {
    selling: number; material: number; transport: number; services: number;
    plannedLabor: number; actualLabor: number;
}
/** Profit po proizvodu — productivity.ts:253-255. */
function itemProfit(f: ItemFin) {
    const gross = f.selling - f.material - f.transport - f.services;
    const net = gross - f.actualLabor;
    const margin = f.selling > 0 ? (net / f.selling) * 100 : 0;
    return { gross, net, margin };
}
/** Profit po nalogu (agregat) — productivity.ts:341-356 (usluge se oduzimaju, isto kao per-item). */
function workOrderProfit(items: ItemFin[]) {
    const totalValue = items.reduce((s, p) => s + p.selling, 0);
    const material = items.reduce((s, p) => s + p.material, 0);
    const transport = items.reduce((s, p) => s + p.transport, 0);
    const services = items.reduce((s, p) => s + p.services, 0);
    const actualLabor = items.reduce((s, p) => s + p.actualLabor, 0);
    const gross = totalValue - material - transport - services;
    const net = gross - actualLabor;
    const margin = totalValue > 0 ? (net / totalValue) * 100 : 0;
    return { totalValue, material, transport, services, actualLabor, gross, net, margin };
}

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ 1 — Jedan radnik, jedan dan, više proizvoda (osnovna invarijanta)
// ════════════════════════════════════════════════════════════════════════════
describe('Scenarij 1 — dnevnica se TAČNO raspodijeli na proizvode (bez drifta)', () => {
    test('Marko (130 KM) cijeli dan na 3 proizvoda → Σ = 130, day_fraction = 1/3', () => {
        const logs = book({ worker: 'M', dnevnica: 130, date: '2026-06-22', items: ['A', 'B', 'C'] });
        expect(logs).toHaveLength(3);
        expect(sum(logs.map(l => l.rate))).toBe(130);
        logs.forEach(l => expect(l.dayFraction).toBeCloseTo(1 / 3, 6));
        // Σ Day_Fraction == presence (1 cijeli radni dan)
        expect(round2(logs.reduce((s, l) => s + l.dayFraction, 0))).toBe(1);
    });

    test('Pola dana na 2 proizvoda → Σ = 65, day_fraction = 0.25', () => {
        const logs = book({ worker: 'M', dnevnica: 130, date: '2026-06-22', presence: 0.5, items: ['A', 'B'] });
        expect(sum(logs.map(l => l.rate))).toBe(65);
        logs.forEach(l => expect(l.dayFraction).toBeCloseTo(0.25, 6));
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ 2 — Cijela radna sedmica: 3 radnika, polu-dani, multi-proizvod dani
// Provjera: po (radnik,dan) Σ = dnevnica×presence; ukupni trošak = Σ svih dnevnica;
// trošak po proizvodu i zarada radnika konzistentni i bez gubitka centa.
// ════════════════════════════════════════════════════════════════════════════
describe('Scenarij 2 — sedmica rada (konzistentnost troška rada na svim nivoima)', () => {
    // Dnevnice
    const RATE = { Marko: 130, Ivan: 100, Ante: 80 } as const;

    // Pon: Marko A+B, Ivan A, Ante B+C
    // Uto: Marko A (cijeli), Ivan B+C (pola dana), Ante C
    // Sri: Marko A+B+C, Ivan A+B, Ante odsutan (nema logova)
    const logs: Log[] = [
        ...book({ worker: 'Marko', dnevnica: RATE.Marko, date: '2026-06-22', items: ['A', 'B'] }),
        ...book({ worker: 'Ivan', dnevnica: RATE.Ivan, date: '2026-06-22', items: ['A'] }),
        ...book({ worker: 'Ante', dnevnica: RATE.Ante, date: '2026-06-22', items: ['B', 'C'] }),

        ...book({ worker: 'Marko', dnevnica: RATE.Marko, date: '2026-06-23', items: ['A'] }),
        ...book({ worker: 'Ivan', dnevnica: RATE.Ivan, date: '2026-06-23', presence: 0.5, items: ['B', 'C'] }),
        ...book({ worker: 'Ante', dnevnica: RATE.Ante, date: '2026-06-23', items: ['C'] }),

        ...book({ worker: 'Marko', dnevnica: RATE.Marko, date: '2026-06-24', items: ['A', 'B', 'C'] }),
        ...book({ worker: 'Ivan', dnevnica: RATE.Ivan, date: '2026-06-24', items: ['A', 'B'] }),
    ];

    test('po (radnik, dan): Σ Daily_Rate == round(dnevnica × presence) — nikad dvostruka dnevnica', () => {
        const byWorkerDay = new Map<string, Log[]>();
        logs.forEach(l => {
            const k = `${l.worker}|${l.date}`;
            const arr = byWorkerDay.get(k) ?? [];
            arr.push(l);
            byWorkerDay.set(k, arr);
        });
        Array.from(byWorkerDay.values()).forEach((group: Log[]) => {
            const presence = group[0].presence;
            const dnevnica = group[0].originalRate;
            expect(sum(group.map(l => l.rate))).toBe(round2(dnevnica * presence));
        });
    });

    test('ukupni trošak rada == Σ (dnevnica × presence) po radniku-danu (bez gubitka/duplanja centa)', () => {
        const total = sum(logs.map(l => l.rate));
        // Očekivano: Pon (130+100+80) + Uto (130 + 50 + 80) + Sri (130 + 100)
        const expected = round2((130 + 100 + 80) + (130 + 100 * 0.5 + 80) + (130 + 100));
        expect(total).toBe(expected); // 880
    });

    test('trošak rada po proizvodu = Σ logova tog proizvoda; Σ proizvoda == ukupno', () => {
        const a = itemLaborCost(logs, 'A');
        const b = itemLaborCost(logs, 'B');
        const c = itemLaborCost(logs, 'C');
        expect(round2(a + b + c)).toBe(sum(logs.map(l => l.rate)));
        // svaki trošak je nenegativan
        [a, b, c].forEach(x => expect(x).toBeGreaterThanOrEqual(0));
    });

    test('zarada radnika: dani = jedinstveni datumi (multi-proizvod dan = 1 dan), total = Σ rate', () => {
        const marko = workerEarnings(logs, 'Marko');
        expect(marko.days).toBe(3);                     // radio pon/uto/sri (ne 6 jer je više proizvoda)
        expect(marko.total).toBe(round2(130 * 3));      // 3 pune dnevnice = 390

        const ivan = workerEarnings(logs, 'Ivan');
        expect(ivan.days).toBe(3);
        expect(ivan.total).toBe(round2(100 + 50 + 100)); // 250 (uto pola dana)

        const ante = workerEarnings(logs, 'Ante');
        expect(ante.days).toBe(2);                       // pon + uto (sri odsutan)
        expect(ante.total).toBe(round2(80 + 80));        // 160
    });

    test('Σ zarada svih radnika == ukupni trošak rada (zatvorena bilanca)', () => {
        const everyone = ['Marko', 'Ivan', 'Ante'].map(w => workerEarnings(logs, w).total);
        expect(round2(everyone.reduce((s, x) => s + x, 0))).toBe(sum(logs.map(l => l.rate)));
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ 3 — Profit po proizvodu i nalogu (formula iz productivity.ts)
// ════════════════════════════════════════════════════════════════════════════
describe('Scenarij 3 — profitabilnost: trošak rada iz logova ulazi u net profit', () => {
    test('proizvod A: net = selling - material - transport - services - actualLabor', () => {
        const logs = [
            ...book({ worker: 'Marko', dnevnica: 130, date: '2026-06-22', items: ['A'] }),
            ...book({ worker: 'Ivan', dnevnica: 100, date: '2026-06-23', items: ['A', 'B'] }), // pola na A
        ];
        const actualLabor = itemLaborCost(logs, 'A'); // 130 + 50 = 180
        expect(actualLabor).toBe(180);

        const fin: ItemFin = { selling: 1000, material: 300, transport: 50, services: 70, plannedLabor: 200, actualLabor };
        const p = itemProfit(fin);
        expect(p.gross).toBe(1000 - 300 - 50 - 70);      // 580
        expect(p.net).toBe(580 - 180);                   // 400
        expect(round2(p.margin)).toBe(round2((400 / 1000) * 100)); // 40%
    });

    test('varijanta rada: planirano vs stvarno (overrun se vidi u net profitu)', () => {
        const logs = [
            ...book({ worker: 'Marko', dnevnica: 130, date: '2026-06-22', items: ['A'] }),
            ...book({ worker: 'Marko', dnevnica: 130, date: '2026-06-23', items: ['A'] }),
            ...book({ worker: 'Marko', dnevnica: 130, date: '2026-06-24', items: ['A'] }),
        ];
        const actualLabor = itemLaborCost(logs, 'A'); // 390
        const fin: ItemFin = { selling: 800, material: 200, transport: 0, services: 0, plannedLabor: 260, actualLabor };
        const variance = fin.plannedLabor - actualLabor;
        expect(variance).toBe(-130); // prekoračenje za jednu dnevnicu
        expect(itemProfit(fin).net).toBe(800 - 200 - 390); // 210
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ 4 — Rok naloga / praćenje datuma (kompleks: granice mjeseca/godine,
// suma planiranih dana po proizvodima, subotnja rotacija)
// ════════════════════════════════════════════════════════════════════════════
describe('Scenarij 4 — rok naloga preko granica i sa subotnjom rotacijom', () => {
    /** Broj radnih dana (default: sve osim nedjelje) u [start, end] inkluzivno. */
    function workingDaysInclusive(startISO: string, endISO: string, isSatWorking?: (d: Date) => boolean): number {
        let d = new Date(startISO + 'T00:00:00');
        const end = new Date(endISO + 'T00:00:00');
        let count = 0;
        const working = (x: Date) => {
            const dow = x.getDay();
            if (dow === 0) return false;
            if (dow === 6) return isSatWorking ? isSatWorking(x) : true;
            return true;
        };
        while (d <= end) { if (working(d)) count++; d.setDate(d.getDate() + 1); }
        return count;
    }
    const firstWorkingFrom = (startISO: string) => {
        let d = new Date(startISO + 'T00:00:00');
        while (!isWorkingDay(d)) d.setDate(d.getDate() + 1);
        return d;
    };

    test('INVARIJANTA: due sadrži tačno N radnih dana od starta (raspon datuma, sve granice)', () => {
        const starts = ['2026-06-22', '2026-06-26', '2026-12-28', '2026-12-31', '2027-02-25', '2028-02-27'];
        const durations = [1, 2, 3, 5, 7, 12, 26];
        for (const start of starts) {
            for (const N of durations) {
                const due = workOrderDueDate(start, N);
                const fw = firstWorkingFrom(start);
                const fwISO = `${fw.getFullYear()}-${String(fw.getMonth() + 1).padStart(2, '0')}-${String(fw.getDate()).padStart(2, '0')}`;
                // due je radni dan
                expect(isWorkingDay(new Date(due + 'T00:00:00'))).toBe(true);
                // tačno N radnih dana u [prvi-radni-dan, due]
                expect(workingDaysInclusive(fwISO, due)).toBe(N);
            }
        }
    });

    test('granica godine: kraj decembra + 5 radnih dana prelazi u januar, preskače nedjelje', () => {
        // 2026-12-31 je četvrtak. čet(1),pet(2),sub(3),[ned],pon(4),uto(5) → 2027-01-05
        expect(workOrderDueDate('2026-12-31', 5)).toBe('2027-01-05');
    });

    test('suma planiranih dana više proizvoda određuje rok (2 + 3 = 5 dana)', () => {
        const plannedA = 2, plannedB = 3;
        const due = workOrderDueDate('2026-06-22', plannedA + plannedB); // pon + 5
        // pon(1),uto(2),sri(3),čet(4),pet(5) → petak 26.
        expect(due).toBe('2026-06-26');
    });

    test('subotnja rotacija produžava rok kad dodijeljeni radnik NE radi tu subotu', () => {
        const att: AttendanceLite[] = [{ Worker_ID: 'W1', Date: '2026-06-20', Status: 'Prisutan' }]; // 27. ne radi
        const checker = buildSaturdayChecker(['W1'], att);
        const withRotation = workOrderDueDate('2026-06-26', 4, checker);   // preskače sub 27.
        const withoutRotation = workOrderDueDate('2026-06-26', 4);         // subota se radi
        expect(withoutRotation).toBe('2026-06-30');
        expect(withRotation).toBe('2026-07-01');
        expect(new Date(withRotation).getTime()).toBeGreaterThan(new Date(withoutRotation).getTime());
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ 5 — KONZISTENTNOST: profit po nalogu == zbir profita proizvoda
// (usluge se oduzimaju na OBA nivoa — productivity.ts:253 i :354 usklađeni).
// Ovaj test je REGRESIJSKI ČUVAR: padne ako neko ponovo razdvoji tretman usluga.
// ════════════════════════════════════════════════════════════════════════════
describe('Scenarij 5 — invarijanta: net naloga == Σ net proizvoda (i sa uslugama)', () => {
    const items: ItemFin[] = [
        { selling: 1000, material: 300, transport: 40, services: 70, plannedLabor: 0, actualLabor: 180 },
        { selling: 600, material: 150, transport: 20, services: 30, plannedLabor: 0, actualLabor: 90 },
    ];

    test('bez usluga: Σ(net proizvoda) == net naloga', () => {
        const noSvc = items.map(i => ({ ...i, services: 0 }));
        const sumItems = round2(noSvc.reduce((s, i) => s + itemProfit(i).net, 0));
        expect(sumItems).toBe(round2(workOrderProfit(noSvc).net));
    });

    test('SA uslugama: Σ(net proizvoda) == net naloga (nema više nesklada)', () => {
        const sumItems = round2(items.reduce((s, i) => s + itemProfit(i).net, 0));
        const wo = round2(workOrderProfit(items).net);
        expect(sumItems).toBe(wo);
        // konkretni iznos: gross naloga = 1600-450-60-100 = 990; net = 990 - 270 = 720
        expect(wo).toBe(720);
    });

    test('gross naloga == Σ gross proizvoda (usluge uračunate jednom)', () => {
        const sumGross = round2(items.reduce((s, i) => s + itemProfit(i).gross, 0));
        expect(sumGross).toBe(round2(workOrderProfit(items).gross));
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ 6 — Materijal × KOLIČINA (bug iz PDF-a: Igor Gavrilović, 15 stolova)
// Materijal se u bazi čuva PO KOMADU, prihod je UKUPAN → materijal se MORA množiti
// količinom pri računanju profita, inače je profit precijenjen za svaki nalog Qty>1.
// ════════════════════════════════════════════════════════════════════════════
describe('Scenarij 6 — trošak materijala se množi količinom (itemMaterialTotal)', () => {
    test('15 stolova × 255 = 3825 (a ne 255) — tačan primjer iz PDF-a', () => {
        expect(itemMaterialTotal(255, 15)).toBe(3825);
    });

    test('Qty nedostaje ili < 1 → tretira se kao 1 komad', () => {
        expect(itemMaterialTotal(255, undefined)).toBe(255);
        expect(itemMaterialTotal(255, 0)).toBe(255);
        expect(itemMaterialTotal(255, 1)).toBe(255);
    });

    test('profit koristi UKUPAN materijal: prihod(ukupan) − materijal(po komadu × qty) − rad', () => {
        const unitMaterial = 100, qty = 3;
        // prihod je ukupan: jedinična prodajna 400 × 3 = 1200
        const fin: ItemFin = {
            selling: 1200,
            material: itemMaterialTotal(unitMaterial, qty), // 300
            transport: 0, services: 0, plannedLabor: 0, actualLabor: 180,
        };
        expect(fin.material).toBe(300);
        expect(itemProfit(fin).net).toBe(1200 - 300 - 180); // 720
    });

    test('miješane količine: net naloga == Σ net proizvoda (materijal × qty na oba nivoa)', () => {
        const mk = (unit: number, qty: number, selling: number, labor: number): ItemFin => ({
            selling, material: itemMaterialTotal(unit, qty), transport: 0, services: 0, plannedLabor: 0, actualLabor: labor,
        });
        const items = [mk(100, 3, 1200, 180), mk(50, 2, 400, 90), mk(255, 15, 6000, 500)];
        const sumItems = round2(items.reduce((s, i) => s + itemProfit(i).net, 0));
        expect(round2(workOrderProfit(items).net)).toBe(sumItems);
        // materijal naloga = 300 + 100 + 3825 = 4225
        expect(round2(workOrderProfit(items).material)).toBe(4225);
    });

    test('zamrznuti/manual materijal se prepoznaje (koristi pohranjeni po komadu, pa × qty)', () => {
        expect(isItemMaterialFrozen({ Status: 'Završeno' })).toBe(true);
        expect(isItemMaterialFrozen({ Completed_At: '2026-07-01T10:00:00Z' })).toBe(true);
        expect(isItemMaterialFrozen({ Material_Cost_Source: 'manual' })).toBe(true);
        expect(isItemMaterialFrozen({ Status: 'U toku' })).toBe(false);
        // frozen ili ne — ukupno je uvijek po komadu × qty
        expect(itemMaterialTotal(255, 15)).toBe(3825);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ — Montaža nalog nikad ne nosi prihod/materijal (WS-0 guard)
// Vjeran mirror lib/attendance.ts recalculateWorkOrder montaža grane (:3144-3254):
// bez obzira na stanje stavke (stari backfill prije guarda, override, sačuvan
// materijal), montaža stavka mora agregirati na 0 prihoda/materijala — samo rad
// ulazi u trošak. Self-heal: korumpirani Product_Value > 0 vraća se na 0.
// ════════════════════════════════════════════════════════════════════════════
interface MontazaAwareItem {
    Product_Value?: number;
    Material_Cost?: number;
    Profit_Overrides?: { Selling_Price?: number };
}
/** Mirror attendance.ts:3144-3254 (isMontaza grana). */
function recalcItemValueAndMaterial(item: MontazaAwareItem, isMontaza: boolean): { itemValue: number; itemMaterialCost: number } {
    if (isMontaza) return { itemValue: 0, itemMaterialCost: 0 };
    let itemValue = item.Product_Value || 0;
    if (item.Profit_Overrides?.Selling_Price != null && item.Profit_Overrides.Selling_Price > 0) {
        itemValue = item.Profit_Overrides.Selling_Price;
    }
    return { itemValue, itemMaterialCost: item.Material_Cost || 0 };
}
/** Mirror self-heal payload iz batch sync-a (attendance.ts ~3298-3301). */
function selfHealMontazaProductValue(item: MontazaAwareItem, isMontaza: boolean): number | undefined {
    return isMontaza && (item.Product_Value || 0) !== 0 ? 0 : undefined;
}

describe('Scenarij — montaža nalog ne nosi prihod/materijal (WS-0 guard)', () => {
    test('montaža stavka korumpirana starim backfillom → agregat je 0 bez obzira na stored/override', () => {
        const corrupted: MontazaAwareItem = { Product_Value: 500, Material_Cost: 120, Profit_Overrides: { Selling_Price: 999 } };
        const r = recalcItemValueAndMaterial(corrupted, true);
        expect(r.itemValue).toBe(0);
        expect(r.itemMaterialCost).toBe(0);
    });
    test('proizvodna (ne-montaža) stavka i dalje poštuje override i sačuvan materijal', () => {
        const item: MontazaAwareItem = { Product_Value: 500, Material_Cost: 120, Profit_Overrides: { Selling_Price: 600 } };
        const r = recalcItemValueAndMaterial(item, false);
        expect(r.itemValue).toBe(600);
        expect(r.itemMaterialCost).toBe(120);
    });
    test('self-heal: korumpirana montaža stavka dobija Product_Value:0 u sync payloadu', () => {
        expect(selfHealMontazaProductValue({ Product_Value: 500 }, true)).toBe(0);
        expect(selfHealMontazaProductValue({ Product_Value: 0 }, true)).toBeUndefined();
        expect(selfHealMontazaProductValue({ Product_Value: 500 }, false)).toBeUndefined();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ — Završni račun: izdavanje mijenja profit projekta, storno ga vraća
// Koristi STVARNE produkcijske funkcije (projectProfitBreakdown, distributeAmountByQuantity)
// — ne mirror — jer je invoiceService.ts Firestore-ovisan (batch writes); ovdje se
// provjerava da OBLIK upisa koji issueInvoice/cancelInvoice rade (Profit_Overrides.Selling_Price
// + Product_Value mirror; brisanje override-a + restauracija iz ponude) zaista mijenja/vraća
// profit projekta preko istog izvora kao kartica/nalozi.
// ════════════════════════════════════════════════════════════════════════════
describe('Scenarij — Završni račun mijenja i vraća profit projekta (issueInvoice/cancelInvoice oblik upisa)', () => {
    // Ponuda: PA (400/kom × 2 = 800), PB (500/kom × 1 = 500). Materijal: PA 100/kom, PB 50/kom.
    const offerSellingPerUnitPA = 400;
    const baseItems = () => [
        { ID: 'A1', Project_ID: 'P1', Product_ID: 'PA', Product_Value: 800, Material_Cost: 100, Quantity: 2 },
        { ID: 'A2', Project_ID: 'P1', Product_ID: 'PB', Product_Value: 500, Material_Cost: 50, Quantity: 1 },
    ];
    const workOrders = (items: ReturnType<typeof baseItems>) => [
        { Work_Order_ID: 'WO1', Status: 'U toku' as const, Work_Order_Type: 'Proizvodnja' as const, items },
    ];

    test('prije fakturisanja: profit projekta = Σ Product_Value ponude', () => {
        const before = projectProfitBreakdown({ projectId: 'P1', workOrders: workOrders(baseItems()), workLogs: [] });
        expect(before.revenue).toBe(1300); // 800 + 500
        expect(before.material).toBe(250); // 100×2 + 50×1
        expect(before.profit).toBe(1050);
    });

    test('izdavanje računa (nova cijena samo za PA=900) → revenue projekta se mijenja SAMO za PA', () => {
        const items = baseItems();
        // issueInvoice: raspodijeli Final_Total (900) na stavke proizvoda PA po količini (ovdje 1 stavka).
        const distribution = distributeAmountByQuantity(900, [{ id: 'A1', qty: items[0].Quantity }]);
        expect(distribution).toEqual([{ id: 'A1', amount: 900 }]);
        // Isti oblik upisa kao issueInvoice: Profit_Overrides.Selling_Price + Product_Value mirror.
        const invoiced = items.map(it => it.ID === 'A1'
            ? { ...it, Profit_Overrides: { Selling_Price: 900 }, Product_Value: 900 }
            : it);

        const after = projectProfitBreakdown({ projectId: 'P1', workOrders: workOrders(invoiced), workLogs: [] });
        expect(after.revenue).toBe(1400); // 900 (fakturisano) + 500 (nepromijenjeno)
        expect(after.material).toBe(250); // materijal se ne mijenja izdavanjem
        expect(after.profit).toBe(1150);
    });

    test('storno: brisanje override-a + restauracija Product_Value iz ponude (Selling_Price × qty) vraća profit na pretfakturisano stanje', () => {
        const items = baseItems();
        const invoiced = items.map(it => it.ID === 'A1'
            ? { ...it, Profit_Overrides: { Selling_Price: 900 }, Product_Value: 900 }
            : it);

        // cancelInvoice: Profit_Overrides:{} (brisanje) + Product_Value = offerSellingPerUnit × qty (EKSPLICITNO, ne backfill).
        const restored = invoiced.map(it => it.ID === 'A1'
            ? { ...it, Profit_Overrides: {}, Product_Value: offerSellingPerUnitPA * it.Quantity }
            : it);

        const afterCancel = projectProfitBreakdown({ projectId: 'P1', workOrders: workOrders(restored), workLogs: [] });
        const before = projectProfitBreakdown({ projectId: 'P1', workOrders: workOrders(items), workLogs: [] });
        expect(afterCancel.revenue).toBe(before.revenue); // 1300 — potpuno vraćeno
        expect(afterCancel.profit).toBe(before.profit);
    });

    test('proizvod podijeljen na 2 stavke (2 naloga): distributeAmountByQuantity + projectProfitBreakdown daju Σ == fakturisani total', () => {
        // PA podijeljen 2+1 komada kroz dva proizvodna naloga.
        const split = [
            { ID: 'S1', Project_ID: 'P1', Product_ID: 'PA', Product_Value: 800, Material_Cost: 100, Quantity: 2 },
            { ID: 'S2', Project_ID: 'P1', Product_ID: 'PA', Material_Cost: 100, Quantity: 1, Product_Value: 400 },
        ];
        const distribution = distributeAmountByQuantity(1500, [
            { id: 'S1', qty: split[0].Quantity },
            { id: 'S2', qty: split[1].Quantity },
        ]);
        // Σ raspodjele == fakturisani total, bez drifta
        expect(distribution.reduce((s, d) => s + d.amount, 0)).toBe(1500);

        const invoicedSplit = split.map(it => {
            const d = distribution.find(x => x.id === it.ID)!;
            return { ...it, Profit_Overrides: { Selling_Price: d.amount }, Product_Value: d.amount };
        });
        const wo = [{ Work_Order_ID: 'WOA', Status: 'U toku' as const, Work_Order_Type: 'Proizvodnja' as const, items: invoicedSplit }];
        const result = projectProfitBreakdown({ projectId: 'P1', workOrders: wo, workLogs: [] });
        expect(result.revenue).toBe(1500);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIJ — Povezani "razni poslovi": rad se preusmjerava na proizvod i ULAZI
// u njegov profit projekta. Mirror onoga što bookWorkerDayItems/saveWorkOrderDayBooking
// rade pri upisu (resolveLaborCostTarget → log na povezanu stavku), pa se provjeri
// da projectProfitBreakdown (stvarna funkcija) taj rad uračuna u trošak proizvoda.
// ════════════════════════════════════════════════════════════════════════════
describe('Scenarij — povezani razni posao uračunava rad u trošak proizvoda', () => {
    // Proizvod P1 u proizvodnom nalogu (projekat PRJ), prihod 1000, materijal 0 (jednostavno).
    const product: LaborTargetItem & { Project_ID: string; Product_Value: number; Material_Cost: number; Quantity: number } =
        { ID: 'P1', Work_Order_ID: 'WO-prod', Product_ID: 'prod-1', Product_Name: 'Ormar', Item_Type: 'product', Project_ID: 'PRJ', Product_Value: 1000, Material_Cost: 0, Quantity: 1 };
    // Custom zadatak "Montaža vrata" u Zadaci-nalogu, povezan s P1, prazan Project_ID (kao u praksi).
    const customTask: LaborTargetItem & { Project_ID: string; Quantity: number } =
        { ID: 'C1', Work_Order_ID: 'WO-zad', Product_ID: 'custom-x', Product_Name: 'Montaža vrata', Item_Type: 'custom', Linked_Item_ID: 'P1', Project_ID: '', Quantity: 1 };
    const byId = new Map<string, LaborTargetItem>([[product.ID, product], [customTask.ID, customTask]]);

    // Radnik knjiži 130 KM na custom zadatak → helper preusmjerava log na P1.
    const { target, redirected } = resolveLaborCostTarget(customTask, byId);
    const retargetedLog = { Work_Order_Item_ID: target.ID, Daily_Rate: 130 };

    test('helper preusmjeri log s custom zadatka na povezanu stavku proizvoda', () => {
        expect(redirected).toBe(true);
        expect(retargetedLog.Work_Order_Item_ID).toBe('P1');
    });

    test('projectProfitBreakdown uračuna preusmjereni rad u trošak proizvoda (profit = 1000 − 130)', () => {
        const workOrders = [
            { Work_Order_ID: 'WO-prod', Status: 'U toku' as const, Work_Order_Type: 'Proizvodnja' as const, items: [product] },
            // Zadaci-nalog: custom stavka ostaje, ali njen rad je fizički na P1 (nije ovdje) →
            // Zadaci-nalog ne nosi trošak; proizvod ga nosi.
            { Work_Order_ID: 'WO-zad', Status: 'U toku' as const, Work_Order_Type: 'Zadaci' as unknown as 'Proizvodnja', items: [customTask] },
        ];
        const r = projectProfitBreakdown({ projectId: 'PRJ', workOrders, workLogs: [retargetedLog] });
        expect(r.labor).toBe(130);
        expect(r.revenue).toBe(1000);
        expect(r.profit).toBe(870);
    });

    test('bez preusmjeravanja (da log ostane na custom stavci) rad bi se IZGUBIO iz profita projekta', () => {
        // Kontra-primjer: log na custom stavci (Project_ID prazan) → projectProfitBreakdown ga preskače.
        const lostLog = { Work_Order_Item_ID: 'C1', Daily_Rate: 130 };
        const workOrders = [
            { Work_Order_ID: 'WO-prod', Status: 'U toku' as const, Work_Order_Type: 'Proizvodnja' as const, items: [product] },
            { Work_Order_ID: 'WO-zad', Status: 'U toku' as const, Work_Order_Type: 'Zadaci' as unknown as 'Proizvodnja', items: [customTask] },
        ];
        const r = projectProfitBreakdown({ projectId: 'PRJ', workOrders, workLogs: [lostLog] });
        expect(r.labor).toBe(0);            // rad se izgubio — upravo problem koji preusmjeravanje rješava
        expect(r.profit).toBe(1000);
    });
});
