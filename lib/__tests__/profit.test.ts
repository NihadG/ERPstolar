// ════════════════════════════════════════════════════════════════════
// Testovi jedinstvene profit formule (lib/profit.ts) — jedini izvor istine:
//   profit = prihod − materijal − rad − usluge − transport
// ════════════════════════════════════════════════════════════════════

import { profitFromTotals, itemProfitBreakdown, sumBreakdowns } from '../profit';

describe('profitFromTotals', () => {
    it('osnovna formula: prihod − materijal − rad − usluge − transport', () => {
        const b = profitFromTotals({ revenue: 1000, material: 300, labor: 200, services: 50, transport: 50 });
        expect(b.profit).toBe(400);
        expect(b.margin).toBe(40);
        expect(b.missingPrice).toBe(false);
        expect(b.missingMaterial).toBe(false);
    });

    it('bez prihoda: margin 0, missingPrice flag', () => {
        const b = profitFromTotals({ revenue: 0, material: 100, labor: 130, services: 0, transport: 0 });
        expect(b.profit).toBe(-230);
        expect(b.margin).toBe(0);
        expect(b.missingPrice).toBe(true);
    });

    it('bez materijala: missingMaterial flag (profit nepotpun)', () => {
        const b = profitFromTotals({ revenue: 500, material: 0, labor: 100, services: 0, transport: 0 });
        expect(b.missingMaterial).toBe(true);
        expect(b.profit).toBe(400);
    });

    it('komponente se zaokružuju na cent', () => {
        const b = profitFromTotals({ revenue: 100.005, material: 33.333, labor: 0, services: 0, transport: 0 });
        expect(b.revenue).toBe(100.01);
        expect(b.material).toBe(33.33);
        expect(b.profit).toBe(66.68);
    });
});

describe('itemProfitBreakdown', () => {
    it('materijal PO KOMADU se množi količinom, prihod je već UKUPAN (invarijanta baze)', () => {
        // 15 stolova: 255 KM materijala po komadu, 500 KM prodajna po komadu (ukupno 7500)
        const b = itemProfitBreakdown({
            productValue: 7500, materialPerUnit: 255, quantity: 15,
            laborTotal: 1000, servicesTotal: 0, transportShare: 0,
        });
        expect(b.material).toBe(3825);      // 255 × 15, ne 255
        expect(b.profit).toBe(7500 - 3825 - 1000);
    });

    it('Selling_Price override važi samo ako je > 0 (ista semantika kao recalculateWorkOrder)', () => {
        const base = { productValue: 1000, materialPerUnit: 100, quantity: 1, laborTotal: 0 };
        expect(itemProfitBreakdown({ ...base, sellingOverride: 1200 }).revenue).toBe(1200);
        expect(itemProfitBreakdown({ ...base, sellingOverride: 0 }).revenue).toBe(1000);
        expect(itemProfitBreakdown({ ...base, sellingOverride: null }).revenue).toBe(1000);
    });

    it('Transport_Share override važi čim postoji — i 0 je legitiman override', () => {
        const base = { productValue: 1000, materialPerUnit: 0, quantity: 1, laborTotal: 0, transportShare: 80 };
        expect(itemProfitBreakdown(base).transport).toBe(80);
        expect(itemProfitBreakdown({ ...base, transportOverride: 0 }).transport).toBe(0);
        expect(itemProfitBreakdown({ ...base, transportOverride: 120 }).transport).toBe(120);
    });

    it('nedostajuća/nevalidna količina se tretira kao 1 komad', () => {
        expect(itemProfitBreakdown({ productValue: 500, materialPerUnit: 100 }).material).toBe(100);
        expect(itemProfitBreakdown({ productValue: 500, materialPerUnit: 100, quantity: 0 }).material).toBe(100);
    });

    it('montaža stavka (sve nulirano osim rada) → profit = −rad, oba missing flaga', () => {
        const b = itemProfitBreakdown({ productValue: 0, materialPerUnit: 0, quantity: 1, laborTotal: 260 });
        expect(b.profit).toBe(-260);
        expect(b.missingPrice).toBe(true);
        expect(b.missingMaterial).toBe(true);
    });
});

describe('sumBreakdowns', () => {
    it('INVARIJANTA: Σ profit stavki == profit naloga (do centa)', () => {
        const items = [
            itemProfitBreakdown({ productValue: 1000.33, materialPerUnit: 100.11, quantity: 3, laborTotal: 130.67, servicesTotal: 20, transportShare: 10 }),
            itemProfitBreakdown({ productValue: 2500, materialPerUnit: 255, quantity: 2, laborTotal: 390.5, transportOverride: 0, transportShare: 50 }),
            itemProfitBreakdown({ productValue: 0, laborTotal: 65 }), // montaža-like
        ];
        const total = sumBreakdowns(items);
        const sumProfits = Math.round(items.reduce((s, b) => s + b.profit, 0) * 100) / 100;
        expect(total.profit).toBe(sumProfits);
        expect(total.revenue).toBe(Math.round(items.reduce((s, b) => s + b.revenue, 0) * 100) / 100);
    });

    it('missing flagovi se OR-uju preko stavki', () => {
        const ok = itemProfitBreakdown({ productValue: 500, materialPerUnit: 100, laborTotal: 0 });
        const noPrice = itemProfitBreakdown({ productValue: 0, materialPerUnit: 100, laborTotal: 0 });
        expect(sumBreakdowns([ok, ok]).missingPrice).toBe(false);
        expect(sumBreakdowns([ok, noPrice]).missingPrice).toBe(true);
    });

    it('prazan nalog → nule i missing flagovi false', () => {
        const total = sumBreakdowns([]);
        expect(total.profit).toBe(0);
        expect(total.missingPrice).toBe(false);
    });
});
