/**
 * MODEL = STVARNO (snapshot, parity sa karticom projekta / WorkOrderExpandedDetail).
 *
 * Analitika više NE čita živu ponudu ni katalog materijala za STVARNI prihod/materijal/usluge —
 * to su snapshot polja na WorkOrderItem (Product_Value, Material_Cost, Services_Total,
 * Transport_Share), sabrana preko SVIH ne-otkazanih stavki proizvoda (bez "reprezentativne
 * stavke"). Svježina tih snapshot-a se garantuje WRITE-TIME u lib/attendance.ts
 * recalculateWorkOrder (materijal/usluge se osvježe pri svakom recalc-u za aktivne,
 * ne-zamrznute, ne-montaža stavke), ne ovdje. PLAN kolone (iz ponude) su nezavisne i
 * i dalje padaju na živu ponudu kad WO item nema svoj planirani snapshot.
 */

// computeAnalytics je čista (in-memory) funkcija, ali živi u istom modulu kao getAnalyticsRaw,
// koji uvozi firestoreClient → lib/firebase.ts (inicijalizuje pravi Firebase pri importu, što puca
// u Jest/jsdom okruženju). Mock-uj samo taj Firebase-dotični uvoz — computeAnalytics ga nikad ne zove.
jest.mock('../services/shared/firestoreClient', () => ({ queryByOrg: jest.fn() }));

import { computeAnalytics, type AnalyticsRaw } from '../services/profit/analyticsService';
import type { WorkOrder, WorkOrderItem, Offer, OfferProduct } from '../types';

function baseRaw(overrides: Partial<AnalyticsRaw> = {}): AnalyticsRaw {
    return {
        workOrders: [], items: [], logs: [],
        actualLaborByProduct: new Map(), offerProductByProduct: new Map(),
        ...overrides,
    };
}

const wo = (id: string, status: string = 'U toku', type: string = 'Proizvodnja'): WorkOrder => ({
    Work_Order_ID: id, Organization_ID: 'org', Work_Order_Number: id, Status: status,
    Work_Order_Type: type, Created_Date: '2026-07-01',
} as unknown as WorkOrder);

const item = (opts: Partial<WorkOrderItem> & { ID: string; Product_ID: string; Work_Order_ID: string }): WorkOrderItem => ({
    Product_Name: 'Proizvod', Project_ID: 'P1', Project_Name: 'Projekat', Quantity: 1,
    Status: 'U toku', Product_Value: 1000, Services_Total: 0,
    ...opts,
} as unknown as WorkOrderItem);

const offerProduct = (opts: Partial<OfferProduct> & { Product_ID: string }): OfferProduct => ({
    ID: 'op1', Offer_ID: 'O1', Product_Name: 'Proizvod', Quantity: 1, Included: true,
    Material_Cost: 0, Margin: 0, Margin_Type: 'Fixed', LED_Meters: 0, LED_Price: 0, LED_Total: 0,
    Grouting: false, Grouting_Price: 0, Sink_Faucet: false, Sink_Faucet_Price: 0,
    Transport_Share: 0, Discount_Share: 0, Selling_Price: 0, Total_Price: 0,
    Labor_Workers: 0, Labor_Days: 0, Labor_Daily_Rate: 0,
    ...opts,
} as unknown as OfferProduct);

describe('computeAnalytics — usluge (services) = snapshot item.Services_Total (STVARNO model)', () => {
    test('usluge NE padaju na živu ponudu — samo pohranjeni item.Services_Total (svježina je write-time posao recalculateWorkOrder)', () => {
        const op = offerProductByProductOf(offerProduct({
            Product_ID: 'PA',
            extras: [{ ID: 'e1', Offer_Product_ID: 'op1', Name: 'Ugradnja', Quantity: 1, Unit: 'kom', Unit_Price: 850, Total: 850 }],
        }));
        const raw = baseRaw({
            workOrders: [wo('WO1')],
            // Services_Total = 0 na stavci — analitika više NE gleda op.extras (850) da je "popravi"
            items: [item({ ID: 'I1', Product_ID: 'PA', Work_Order_ID: 'WO1', Services_Total: 0 })],
            offerProductByProduct: op,
        });
        const data = computeAnalytics(raw);
        const row = data.products.find(p => p.productId === 'PA')!;
        expect(row.services).toBe(0);
    });

    test('bez vezane ponude (ad-hoc/custom stavka) → koristi pohranjeni item.Services_Total', () => {
        const raw = baseRaw({
            workOrders: [wo('WO1')],
            items: [item({ ID: 'I1', Product_ID: 'PA', Work_Order_ID: 'WO1', Services_Total: 120 })],
        });
        const data = computeAnalytics(raw);
        const row = data.products.find(p => p.productId === 'PA')!;
        expect(row.services).toBe(120);
    });

    test('Profit_Overrides.Extras_Total nema poseban read-time efekat (već mirrorovan u Services_Total pri snimanju — saveProfitOverrides)', () => {
        // Services_Total=850 je "istinita" vrijednost (kao da je override 300 već primijenjen ranije
        // pa PA nakon toga izmijenjena na 850 nekim drugim putem) — Profit_Overrides.Extras_Total sam
        // za sebe ne mijenja agregaciju, jer nema servicesOverride parametar u lib/profit.ts.
        const raw = baseRaw({
            workOrders: [wo('WO1')],
            items: [item({
                ID: 'I1', Product_ID: 'PA', Work_Order_ID: 'WO1', Services_Total: 850,
                Profit_Overrides: { Extras_Total: 300, Updated_At: '2026-07-05T00:00:00Z' },
            } as any)],
        });
        const data = computeAnalytics(raw);
        const row = data.products.find(p => p.productId === 'PA')!;
        expect(row.services).toBe(850);
    });

    test('profit u analitici ispravno oduzima usluge iz snapshot-a stavke', () => {
        const raw = baseRaw({
            workOrders: [wo('WO1')],
            items: [item({ ID: 'I1', Product_ID: 'PA', Work_Order_ID: 'WO1', Product_Value: 1000, Services_Total: 200 })],
        });
        const data = computeAnalytics(raw);
        const row = data.products.find(p => p.productId === 'PA')!;
        expect(row.services).toBe(200);
        expect(row.profit).toBe(1000 - 0 - 0 - 200 - 0); // selling - material - labor - services - transport
    });
});

describe('computeAnalytics — proizvod s PROIZVODNIM (završenim) i MONTAŽNIM (aktivnim) nalogom', () => {
    // REGRESIJA (screenshot "Dino Deović"): pod opsegom "Aktivni" bi završeni proizvodni nalog
    // ispao iz agregacije, pa je aktivna MONTAŽNA stavka (nulirane finansije) predstavljala
    // proizvod: cijena/materijal "—", planirani rad 0, profit = −rad. Finansije se sada
    // računaju iz KOMPLETNE slike, a opseg samo bira koji proizvodi ulaze.
    const rawProdDoneMontActive = () => baseRaw({
        workOrders: [wo('WOP', 'Završeno'), wo('WOM', 'U toku', 'Montaža')],
        items: [
            item({ ID: 'IP', Product_ID: 'PA', Work_Order_ID: 'WOP', Status: 'Završeno', Product_Value: 2000, Quantity: 1, Material_Cost: 700, Planned_Labor_Cost: 600, Transport_Share: 50 } as any),
            // Montažna stavka: finansije nulirane pri kreiranju (ProductionTab isMontazaMode)
            item({ ID: 'IM', Product_ID: 'PA', Work_Order_ID: 'WOM', Status: 'U toku', Product_Value: 0, Quantity: 1, Material_Cost: 0, Planned_Labor_Cost: 0, Transport_Share: 0 } as any),
        ],
        actualLaborByProduct: new Map([['PA', 900]]),
    });

    test('opseg "Aktivni": red proizvoda nosi PUNE finansije proizvodnog naloga, ne nule montaže', () => {
        const data = computeAnalytics(rawProdDoneMontActive(), { scope: 'active' });
        const row = data.products.find(p => p.productId === 'PA')!;
        expect(row).toBeDefined();
        expect(row.woType).toBe('Proizvodnja');       // reprezentativna = proizvodna stavka
        expect(row.nonRevenue).toBe(false);
        expect(row.selling).toBe(2000);
        expect(row.material).toBe(700);
        expect(row.labor).toBe(900);                  // rad kroz SVE naloge (uklj. montažu)
        expect(row.transport).toBe(50);
        expect(row.plannedLabor).toBe(600);           // plan sa završene proizvodne stavke
        expect(row.profit).toBe(2000 - 700 - 900 - 0 - 50);
    });

    test('opseg "Aktivni" i "Svi" daju ISTE finansije proizvoda (opseg bira samo koji proizvodi ulaze)', () => {
        const a = computeAnalytics(rawProdDoneMontActive(), { scope: 'active' }).products.find(p => p.productId === 'PA')!;
        const s = computeAnalytics(rawProdDoneMontActive(), { scope: 'all' }).products.find(p => p.productId === 'PA')!;
        expect(a.selling).toBe(s.selling);
        expect(a.material).toBe(s.material);
        expect(a.plannedLabor).toBe(s.plannedLabor);
        expect(a.profit).toBe(s.profit);
    });

    test('proizvod SAMO s montažnim nalogom ostaje ne-prihodovni (profit = −rad)', () => {
        const raw = baseRaw({
            workOrders: [wo('WOM', 'U toku', 'Montaža')],
            items: [item({ ID: 'IM', Product_ID: 'PM', Work_Order_ID: 'WOM', Product_Value: 0, Planned_Labor_Cost: 0 } as any)],
            actualLaborByProduct: new Map([['PM', 250]]),
        });
        const row = computeAnalytics(raw, { scope: 'active' }).products.find(p => p.productId === 'PM')!;
        expect(row.nonRevenue).toBe(true);
        expect(row.profit).toBe(-250);
    });
});

describe('computeAnalytics — planirani rad i prodajna cijena iz ponude', () => {
    test('REGRESIJA: stavke bez Planned_Labor_Cost → fallback na ponudu (radnici × dani × dnevnica × količina)', () => {
        const op = offerProductByProductOf(offerProduct({
            Product_ID: 'PA', Quantity: 2, Labor_Workers: 2, Labor_Days: 3, Labor_Daily_Rate: 65,
        }));
        const raw = baseRaw({
            workOrders: [wo('WO1')],
            items: [item({ ID: 'I1', Product_ID: 'PA', Work_Order_ID: 'WO1', Quantity: 2 })],  // bez Planned_Labor_Cost
            offerProductByProduct: op,
        });
        const row = computeAnalytics(raw).products.find(p => p.productId === 'PA')!;
        expect(row.plannedLabor).toBe(2 * 3 * 65 * 2);   // 780
    });

    test('snapshot sa stavke ima prednost nad fallback-om ponude', () => {
        const op = offerProductByProductOf(offerProduct({
            Product_ID: 'PA', Labor_Workers: 5, Labor_Days: 5, Labor_Daily_Rate: 100,
        }));
        const raw = baseRaw({
            workOrders: [wo('WO1')],
            items: [item({ ID: 'I1', Product_ID: 'PA', Work_Order_ID: 'WO1', Planned_Labor_Cost: 300, Quantity: 1 } as any)],
            offerProductByProduct: op,
        });
        const row = computeAnalytics(raw).products.find(p => p.productId === 'PA')!;
        expect(row.plannedLabor).toBe(300);
    });

    test('STVARNI prihod NE pada na živu ponudu: Product_Value=0 (ponuda još nije backfillovana na stavku) → selling je 0', () => {
        // Parity sa karticom projekta/WorkOrderExpandedDetail: dok recalculateWorkOrder ne
        // backfilluje Product_Value iz prihvaćene ponude na stavku, STVARNI prihod je 0 —
        // analitika ga ne "glumi" iz žive ponude (to bi sakrilo da backfill još nije prošao).
        const op = offerProductByProductOf(offerProduct({
            Product_ID: 'PA', Quantity: 3, Selling_Price: 500, Total_Price: 1500,
        }));
        const raw = baseRaw({
            workOrders: [wo('WO1')],
            items: [item({ ID: 'I1', Product_ID: 'PA', Work_Order_ID: 'WO1', Product_Value: 0, Quantity: 3 })],
            offerProductByProduct: op,
        });
        const row = computeAnalytics(raw).products.find(p => p.productId === 'PA')!;
        expect(row.selling).toBe(0);
    });

    test('Product_Value postavljen na stavci (nakon backfilla) → STVARNI prihod ga direktno koristi', () => {
        const raw = baseRaw({
            workOrders: [wo('WO1')],
            items: [item({ ID: 'I1', Product_ID: 'PA', Work_Order_ID: 'WO1', Product_Value: 1500, Quantity: 3 })],
        });
        const row = computeAnalytics(raw).products.find(p => p.productId === 'PA')!;
        expect(row.selling).toBe(1500);
    });
});

function offerProductByProductOf(op: OfferProduct): Map<string, OfferProduct> {
    return new Map([[op.Product_ID, op]]);
}
