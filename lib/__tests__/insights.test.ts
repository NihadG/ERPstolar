import { distribution, coefficientOfVariation, percentileOf, sharePct } from '../insights/stats';
import { buildWorkerAffinity, processOwnership, SPEED_INDEX_MIN_SAMPLES } from '../insights/workerAffinity';
import { buildTypeProfiles, driverRates } from '../insights/typeProfile';
import { findComparable, describeComparable } from '../insights/comparable';
import { buildFlowSummary } from '../insights/processFlow';
import type { ProductionSnapshot, ProductionSnapshotItem, SnapshotWorker } from '../types';

// ── Fixture ─────────────────────────────────────────────────────────
let seq = 0;
const worker = (id: string, days: number, over: Partial<SnapshotWorker> = {}): SnapshotWorker => ({
    Worker_ID: id, Worker_Name: id.toUpperCase(), Role: 'Opći', Worker_Type: 'Glavni',
    Days_Worked: Math.ceil(days), Worker_Days: days, Daily_Rate: 100, Total_Cost: days * 100,
    Share_Of_Item: 1, ...over,
} as SnapshotWorker);

const snapItem = (over: Partial<ProductionSnapshotItem> = {}): ProductionSnapshotItem => ({
    Product_ID: `p${++seq}`, Product_Name: 'Komoda', Product_Types: ['komoda'],
    Material_Types: ['furnir', 'masiv'], Height: 0, Width: 0, Depth: 0,
    Volume_M3: 0, Surface_M2: 0, Quantity: 1,
    Materials: [], Material_Count: 0, Has_Glass: false, Has_Alu_Door: false,
    Total_Material_Cost: 100, Material_Per_M2: 0, Material_Per_M3: 0, Material_Per_Unit: 100,
    Planned_Labor_Days: 2, Planned_Worker_Days: 2, Actual_Labor_Days: 2,
    Workers_Assigned: [worker('w1', 2)], Processes: [],
    Selling_Price: 1000, Margin_Percent: 0, Margin_Type: 'Percentage',
    LED_Meters: 0, LED_Price_Per_Meter: 0, LED_Total: 0, Transport_Share: 0,
    Extras: [], Profit: 0, Margin_Applied: 0,
    ...over,
} as ProductionSnapshotItem);

const snap = (over: Partial<ProductionSnapshot> = {}): ProductionSnapshot => ({
    Snapshot_ID: `s${++seq}`, Organization_ID: 'org',
    Work_Order_ID: `wo${seq}`, Work_Order_Number: `2026-07/R${seq}`,
    Created_At: '2026-07-10T00:00:00Z', Snapshot_Version: 3,
    Work_Order_Type: 'Proizvodnja', Work_Order_Name: 'Komoda Novak',
    Project_ID: 'pr1', Client_Name: 'Novak', Project_Deadline: '',
    Items: [snapItem()],
    Total_Products: 1, Total_Quantity: 1, Total_Material_Cost: 100, Total_Selling_Price: 1000,
    Avg_Material_Per_M2: 0, Avg_Material_Per_M3: 0,
    Planned_Days: 2, Actual_Days: 2, Duration_Variance: 0,
    Planned_Labor_Cost: 0, Actual_Labor_Cost: 200, Labor_Cost_Variance: 0, Labor_Variance_Percent: 0,
    Gross_Profit: 0, Net_Profit: 0, Profit_Margin_Percent: 0,
    Workers_Count: 1, Total_Worker_Days: 2, Avg_Daily_Rate: 100,
    Production_Steps: [], Month: 7, Quarter: 3, Day_Of_Week_Start: 1,
    Quality_Score: 100, Data_Issues: [], Is_Valid_For_AI: true, Normalized_Product_Types: ['komoda'],
    Materials_Snapshot_Time: '', Materials_Are_Final: true,
    ...over,
} as ProductionSnapshot);

// ════════════════════════════════════════════════════════════════════
describe('stats', () => {
    test('percentil interpolira', () => {
        expect(percentileOf([1, 2, 3, 4], 0.5)).toBe(2.5);
        expect(percentileOf([10], 0.9)).toBe(10);
        expect(percentileOf([], 0.5)).toBeNaN();
    });

    test('prazan uzorak → null, nikad izmišljena nula', () => {
        expect(distribution([])).toBeNull();
        expect(distribution([NaN, Infinity])).toBeNull();
    });

    test('medijan je otporan na jedan katastrofalan nalog, prosjek nije', () => {
        const d = distribution([2, 2, 2, 2, 40])!;
        expect(d.p50).toBe(2);
        expect(d.mean).toBe(9.6);   // zato se prikazuje medijan
    });

    test('CV mjeri predvidivost; ispod 2 uzorka nema smisla', () => {
        expect(coefficientOfVariation([5, 5, 5, 5])).toBe(0);      // savršeno predvidivo
        expect(coefficientOfVariation([1, 10, 3, 8])!).toBeGreaterThan(0.5);
        expect(coefficientOfVariation([5])).toBeNull();
        expect(coefficientOfVariation([0, 0])).toBeNull();          // prosjek 0 → omjer besmislen
    });

    test('sharePct ne dijeli nulom', () => {
        expect(sharePct(1, 0)).toBe(0);
        expect(sharePct(1, 4)).toBe(25);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('afinitet radnika', () => {
    test('udjeli po tipu proizvoda, u radnik-danima', () => {
        const { profiles } = buildWorkerAffinity([
            snap({ Items: [snapItem({ Product_Types: ['kuhinja'], Workers_Assigned: [worker('w1', 6)], Actual_Labor_Days: 6 })] }),
            snap({ Items: [snapItem({ Product_Types: ['komoda'], Workers_Assigned: [worker('w1', 2)], Actual_Labor_Days: 2 })] }),
        ]);
        const p = profiles.find(x => x.Worker_ID === 'w1')!;
        expect(p.totalWorkerDays).toBe(8);
        expect(p.byProductType).toEqual([
            { key: 'kuhinja', workerDays: 6, sharePct: 75, orders: 1 },
            { key: 'komoda', workerDays: 2, sharePct: 25, orders: 1 },
        ]);
    });

    test('montazaShare odgovara na „ko ide na montažu"', () => {
        const { profiles } = buildWorkerAffinity([
            snap({ Work_Order_Type: 'Montaža', Items: [snapItem({ Workers_Assigned: [worker('w1', 3)], Actual_Labor_Days: 3 })] }),
            snap({ Work_Order_Type: 'Proizvodnja', Items: [snapItem({ Workers_Assigned: [worker('w1', 1)], Actual_Labor_Days: 1 })] }),
        ]);
        expect(profiles.find(x => x.Worker_ID === 'w1')!.montazaShare).toBe(0.75);
    });

    test('dani po procesu iz Process_Days', () => {
        const { profiles } = buildWorkerAffinity([
            snap({
                Items: [snapItem({
                    Actual_Labor_Days: 3,
                    Workers_Assigned: [worker('w1', 3, { Process_Days: { Lakiranje: 2, Brušenje: 1 } })],
                })],
            }),
        ]);
        expect(profiles[0].byProcess).toEqual([
            { key: 'Lakiranje', workerDays: 2, sharePct: 66.7, orders: 1 },
            { key: 'Brušenje', workerDays: 1, sharePct: 33.3, orders: 1 },
        ]);
    });

    test('speedIndex je null ispod praga — bez lažne preciznosti', () => {
        const few = Array.from({ length: SPEED_INDEX_MIN_SAMPLES - 1 }, () =>
            snap({ Items: [snapItem({ Planned_Worker_Days: 2, Actual_Labor_Days: 3, Workers_Assigned: [worker('w1', 3)] })] }));
        expect(buildWorkerAffinity(few).profiles[0].speedIndex).toBeNull();

        const enough = Array.from({ length: SPEED_INDEX_MIN_SAMPLES }, () =>
            snap({ Items: [snapItem({ Planned_Worker_Days: 2, Actual_Labor_Days: 3, Workers_Assigned: [worker('w1', 3)] })] }));
        const s = buildWorkerAffinity(enough).profiles[0].speedIndex!;
        expect(s.n).toBe(SPEED_INDEX_MIN_SAMPLES);
        expect(s.p50).toBe(1.5);       // 50% duže od plana
    });

    test('radnik koji NIJE nosio stavku ne ulazi u speedIndex', () => {
        const many = Array.from({ length: 10 }, () =>
            snap({
                Items: [snapItem({
                    Planned_Worker_Days: 2, Actual_Labor_Days: 10,
                    Workers_Assigned: [worker('w1', 9, { Share_Of_Item: 0.9 }), worker('w2', 1, { Share_Of_Item: 0.1 })],
                })],
            }));
        const { profiles } = buildWorkerAffinity(many);
        expect(profiles.find(p => p.Worker_ID === 'w1')!.speedIndex).not.toBeNull();
        expect(profiles.find(p => p.Worker_ID === 'w2')!.speedIndex).toBeNull();
    });

    test('v2 snapshoti se PRESKAČU (nemaju ispravne radnik-dane) i broje', () => {
        const r = buildWorkerAffinity([snap({ Snapshot_Version: 2 }), snap()]);
        expect(r.skippedLegacy).toBe(1);
        expect(r.profiles).toHaveLength(1);
    });

    test('ekipe koje se same formiraju', () => {
        const { profiles } = buildWorkerAffinity([
            snap({ Items: [snapItem({ Actual_Labor_Days: 5, Workers_Assigned: [worker('w1', 3), worker('w2', 2)] })] }),
        ]);
        expect(profiles.find(p => p.Worker_ID === 'w1')!.pairedWith[0]).toMatchObject({
            Worker_ID: 'w2', sharedDays: 2, orders: 1,
        });
    });

    test('processOwnership — ko nosi proces u cijeloj firmi', () => {
        const { profiles } = buildWorkerAffinity([
            snap({ Items: [snapItem({ Actual_Labor_Days: 10, Workers_Assigned: [
                worker('w1', 8, { Process_Days: { Lakiranje: 8 } }),
                worker('w2', 2, { Process_Days: { Lakiranje: 2 } }),
            ] })] }),
        ]);
        const own = processOwnership(profiles).find(o => o.process === 'Lakiranje')!;
        expect(own.totalDays).toBe(10);
        expect(own.workers[0]).toMatchObject({ Worker_ID: 'w1', sharePct: 80 });
    });
});

// ════════════════════════════════════════════════════════════════════
describe('profil tipa proizvoda', () => {
    test('trajanje se normalizuje PO KOMADU', () => {
        const { profiles } = buildTypeProfiles([
            snap({ Items: [snapItem({ Quantity: 3, Actual_Labor_Days: 9 })] }),   // 3 po komadu
            snap({ Items: [snapItem({ Quantity: 1, Actual_Labor_Days: 3 })] }),   // 3 po komadu
        ]);
        const komoda = profiles.find(p => p.type === 'komoda')!;
        expect(komoda.workerDaysPerUnit!.p50).toBe(3);
        expect(komoda.n).toBe(2);
    });

    test('predvidivost (CV) razlikuje stabilan tip od haotičnog', () => {
        const stabilan = Array.from({ length: 5 }, () =>
            snap({ Items: [snapItem({ Product_Types: ['komoda'], Actual_Labor_Days: 3 })] }));
        const haotican = [1, 2, 9, 14, 3].map(d =>
            snap({ Items: [snapItem({ Product_Types: ['kuhinja'], Actual_Labor_Days: d })] }));
        const { profiles } = buildTypeProfiles([...stabilan, ...haotican]);
        const k = profiles.find(p => p.type === 'komoda')!;
        const ku = profiles.find(p => p.type === 'kuhinja')!;
        expect(k.predictability).toBe(0);
        expect(ku.predictability!).toBeGreaterThan(0.7);
    });

    test('plan vs stvarno u ISTOJ jedinici (radnik-dani)', () => {
        const { profiles } = buildTypeProfiles([
            snap({ Items: [snapItem({ Planned_Worker_Days: 4, Actual_Labor_Days: 6 })] }),
        ]);
        expect(profiles[0].plannedVsActual!.p50).toBe(1.5);
    });

    test('„Zadaci" nalog: tip dolazi iz naziva naloga kad ga stavka nema', () => {
        const { profiles } = buildTypeProfiles([
            snap({
                Work_Order_Type: 'Zadaci',
                Name_Derived_Types: ['polica'],
                Items: [snapItem({ Product_Types: [], Actual_Labor_Days: 2 })],
            }),
        ]);
        expect(profiles.map(p => p.type)).toEqual(['polica']);
    });

    test('driverRates — cijena rada po jedinici pokretača, radi i za nov proizvod', () => {
        const rates = driverRates([
            snap({ Items: [snapItem({ Actual_Labor_Days: 8, Work_Drivers: { veneer_m2: 16 } })] }),
            snap({ Items: [snapItem({ Actual_Labor_Days: 4, Work_Drivers: { veneer_m2: 8 } })] }),
        ]);
        const v = rates.find(r => r.driver === 'veneer_m2')!;
        expect(v.workerDaysPerUnit.p50).toBe(0.5);   // 0.5 radnik-dana po m² furnira
        expect(v.workerDaysPerUnit.n).toBe(2);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('sličan posao — ljestvica poštenja', () => {
    const komodaFurnirMasiv = (days: number) => snap({
        Items: [snapItem({
            Product_Types: ['komoda'], Material_Types: ['furnir', 'masiv', 'sper'],
            Actual_Labor_Days: days,
            Processes: [{ Process_Name: 'Savijanje', Status: 'Završeno', Duration_Days: 1, Helpers_Count: 0 }],
        })],
    });

    test('n ≥ 15 → raspodjela', () => {
        const res = findComparable(
            Array.from({ length: 15 }, () => komodaFurnirMasiv(4)),
            { productTypes: ['komoda'], materialTypes: ['furnir', 'masiv'] }
        );
        expect(res.confidence).toBe('distribution');
        expect(res.n).toBe(15);
        expect(describeComparable(res)).toContain('medijan 4');
    });

    test('n 3–14 → raspon, uz broj poslova', () => {
        const res = findComparable([komodaFurnirMasiv(3), komodaFurnirMasiv(5), komodaFurnirMasiv(4)],
            { productTypes: ['komoda'] });
        expect(res.confidence).toBe('range');
        expect(describeComparable(res)).toContain('na osnovu 3 posla');
    });

    test('n 1–2 → PRIKAŽI TE NALOGE, ne pravi statistiku', () => {
        const res = findComparable([komodaFurnirMasiv(4), komodaFurnirMasiv(6), snap()],
            { productTypes: ['komoda'], materialTypes: ['sper'], processes: ['Savijanje'] });
        expect(res.n).toBe(2);
        expect(res.confidence).toBe('examples');
        expect(res.matched).toHaveLength(2);
        expect(describeComparable(res)).toContain('2 slična posla');
    });

    test('svi uslovi moraju biti ispunjeni — presjek, ne unija', () => {
        const res = findComparable([komodaFurnirMasiv(4)],
            { productTypes: ['komoda'], materialTypes: ['furnir', 'staklo'] });
        // staklo nema → puni upit prazan → popušteno
        expect(res.relaxed.length).toBeGreaterThan(0);
    });

    test('kad nema pogotka, popušta se JEDAN uslov i KAŽE se koji', () => {
        const res = findComparable(
            [snap({ Items: [snapItem({ Product_Types: ['komoda'], Material_Types: ['iveral'], Actual_Labor_Days: 3 })] })],
            { productTypes: ['komoda'], materialTypes: ['iveral'], processes: ['Savijanje'] }
        );
        expect(res.relaxed).toEqual(['procesi']);
        expect(res.n).toBe(1);
        expect(describeComparable(res)).toContain('popušteno: procesi');
    });

    test('tačan pogodak se NE popušta — 2 tačna vrijede više od 40 labavih', () => {
        const pool = [komodaFurnirMasiv(4), ...Array.from({ length: 40 }, () => snap())];
        const res = findComparable(pool, { productTypes: ['komoda'], materialTypes: ['sper'] });
        expect(res.relaxed).toEqual([]);
        expect(res.n).toBe(1);
    });

    test('prazna istorija → none, bez izmišljanja', () => {
        const res = findComparable([], { productTypes: ['komoda'] });
        expect(res.confidence).toBe('none');
        expect(res.workerDaysPerUnit).toBeNull();
        expect(describeComparable(res)).toBe('Nema uporedivog posla u istoriji');
    });

    test('ko je radio te poslove — opis, ne dodjela', () => {
        const res = findComparable([
            snap({ Items: [snapItem({ Product_Types: ['komoda'], Actual_Labor_Days: 10, Workers_Assigned: [worker('w1', 8), worker('w2', 2)] })] }),
        ], { productTypes: ['komoda'] });
        expect(res.topWorkers[0]).toMatchObject({ Worker_ID: 'w1', sharePct: 80 });
    });
});

// ════════════════════════════════════════════════════════════════════
describe('tok procesa', () => {
    const withFlow = (wait: number, from = 'Krojenje', to = 'Lakiranje', source: 'graph' | 'observed' = 'graph') => snap({
        Lead_Days: 10, Touch_Days: 4, Active_Days: 4, Flow_Efficiency: 0.4,
        Process_Runs: [
            { Node_ID: 'n1', Process_Name: from, Resolved_By: 'node', First_Day: '2026-07-01', Last_Day: '2026-07-02', Worker_Days: 2, Active_Days: 2, Span_Days: 2, Workers: [] },
            { Node_ID: 'n2', Process_Name: to, Resolved_By: 'node', First_Day: '2026-07-05', Last_Day: '2026-07-06', Worker_Days: 2, Active_Days: 2, Span_Days: 2, Workers: [] },
        ],
        Transitions: [{
            From_Node_ID: 'n1', From_Name: from, To_Node_ID: 'n2', To_Name: to,
            Source: source, Wait_Days: wait, End_To_End_Days: wait + 1,
        }],
    });

    test('usko grlo je gdje se najviše ČEKA, ne gdje se najduže radi', () => {
        const s = buildFlowSummary([
            ...Array.from({ length: 3 }, () => withFlow(8, 'Krojenje', 'Lakiranje')),
            ...Array.from({ length: 3 }, () => withFlow(1, 'Brušenje', 'Pakovanje')),
        ]);
        expect(s.bottlenecks[0].from).toBe('Krojenje');
        expect(s.bottlenecks[0].totalWaitDays).toBe(24);   // medijan 8 × 3 pojave
        expect(s.bottlenecks[1].totalWaitDays).toBe(3);
    });

    test('prelaz koji graf NEMA se izdvaja kao nedokumentovan', () => {
        const s = buildFlowSummary([withFlow(2, 'Krojenje', 'Farbanje', 'observed')]);
        expect(s.undocumented.map(t => `${t.from}→${t.to}`)).toEqual(['Krojenje→Farbanje']);
    });

    test('nazivi s nevidljivim znakom su ISTI prelaz (ne dva reda)', () => {
        const s = buildFlowSummary([
            withFlow(2, 'Krojenje', 'Lakiranje'),
            withFlow(4, 'Krojenje', 'Lakiranje​'),
        ]);
        expect(s.transitions).toHaveLength(1);
        expect(s.transitions[0].n).toBe(2);
    });

    test('flow efficiency i lead time se agregiraju', () => {
        const s = buildFlowSummary([withFlow(3), withFlow(5)]);
        expect(s.flowEfficiency!.p50).toBe(0.4);
        expect(s.leadDays!.p50).toBe(10);
        expect(s.orders).toBe(2);
    });

    test('v2 snapshoti se preskaču i broje', () => {
        const s = buildFlowSummary([snap({ Snapshot_Version: 2 }), withFlow(1)]);
        expect(s.skippedLegacy).toBe(1);
        expect(s.orders).toBe(1);
    });
});
