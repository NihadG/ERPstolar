import { computeReadiness, type ReadinessInput } from '../insights/readiness';
import type { ProductionSnapshot, ProductionSnapshotItem } from '../types';

let seq = 0;
const item = (over: Partial<ProductionSnapshotItem> = {}): ProductionSnapshotItem => ({
    Product_ID: `p${++seq}`, Product_Name: 'Komoda', Product_Types: ['komoda'],
    Material_Types: [], Height: 0, Width: 0, Depth: 0, Volume_M3: 0, Surface_M2: 0, Quantity: 1,
    Materials: [], Material_Count: 0, Has_Glass: false, Has_Alu_Door: false,
    Total_Material_Cost: 100, Material_Per_M2: 0, Material_Per_M3: 0, Material_Per_Unit: 100,
    Planned_Labor_Days: 2, Planned_Worker_Days: 2, Actual_Labor_Days: 2,
    Workers_Assigned: [], Processes: [],
    Selling_Price: 0, Margin_Percent: 0, Margin_Type: 'Percentage',
    LED_Meters: 0, LED_Price_Per_Meter: 0, LED_Total: 0, Transport_Share: 0,
    Extras: [], Profit: 0, Margin_Applied: 0, ...over,
} as ProductionSnapshotItem);

const snap = (over: Partial<ProductionSnapshot> = {}): ProductionSnapshot => ({
    Snapshot_ID: `s${++seq}`, Organization_ID: 'org', Work_Order_ID: `wo${seq}`,
    Work_Order_Number: 'X', Created_At: '', Snapshot_Version: 3,
    Project_ID: '', Client_Name: '', Project_Deadline: '',
    Actual_End: '2026-07-01',
    Items: [item()], Normalized_Product_Types: ['komoda'],
    Total_Products: 1, Total_Quantity: 1, Total_Material_Cost: 0, Total_Selling_Price: 0,
    Avg_Material_Per_M2: 0, Avg_Material_Per_M3: 0,
    Planned_Days: 2, Actual_Days: 2, Duration_Variance: 0,
    Planned_Labor_Cost: 0, Actual_Labor_Cost: 0, Labor_Cost_Variance: 0, Labor_Variance_Percent: 0,
    Gross_Profit: 0, Net_Profit: 0, Profit_Margin_Percent: 0,
    Workers_Count: 0, Total_Worker_Days: 0, Avg_Daily_Rate: 0,
    Production_Steps: [], Month: 7, Quarter: 3, Day_Of_Week_Start: 1,
    Quality_Score: 100, Data_Issues: [], Is_Valid_For_AI: true,
    Materials_Snapshot_Time: '', Materials_Are_Final: true, ...over,
} as ProductionSnapshot);

const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
    snapshots: [], completedWorkOrders: 0, workLogsTotal: 0, workLogsWithProcess: 0,
    today: '2026-07-26', ...over,
});

describe('prazan sistem', () => {
    const r = computeReadiness(input());

    test('rezultat 0 i nivo „samo evidencija"', () => {
        expect(r.score).toBe(0);
        expect(r.level).toBe('evidencija');
    });

    test('svako mjerilo objašnjava ZAŠTO je bitno', () => {
        expect(r.metrics).toHaveLength(8);
        expect(r.metrics.every(m => m.why.length > 10)).toBe(true);
    });

    test('nivo govori šta otključava i šta je sljedeće', () => {
        expect(r.unlocked).toContain('nema osnove');
        expect(r.nextUnlock).toContain('30');
    });
});

describe('mjerila pokazuju konkretne radnje', () => {
    test('nalozi bez snapshota → radnja „regeneriši"', () => {
        const r = computeReadiness(input({ snapshots: [snap()], completedWorkOrders: 10 }));
        const m = r.metrics.find(x => x.key === 'coverage')!;
        expect(m.score).toBe(10);
        expect(m.actions[0]).toContain('9 naloga bez v3 snapshota');
    });

    test('dnevnice bez procesa → broj i radnja', () => {
        const r = computeReadiness(input({ workLogsTotal: 500, workLogsWithProcess: 88 }));
        const m = r.metrics.find(x => x.key === 'processAttribution')!;
        expect(m.actions[0]).toContain('412 dnevnica bez procesa');
    });

    test('neprepoznata riječ i materijal se imenuju s brojem pojava', () => {
        const r = computeReadiness(input({
            completedWorkOrders: 2,
            snapshots: [
                snap({ Unmatched_Name_Tokens: ['lamperija'], Unmatched_Materials: ['Parsol / Bronza'] }),
                snap({ Unmatched_Name_Tokens: ['lamperija'], Unmatched_Materials: [] }),
            ],
        }));
        const m = r.metrics.find(x => x.key === 'classification')!;
        expect(m.actions.join(' ')).toContain('„lamperija" (2×)');
        expect(m.actions.join(' ')).toContain('„Parsol / Bronza" (1×)');
    });

    test('stavke bez planiranih dana → radnja o dopuni ponuda', () => {
        const r = computeReadiness(input({
            completedWorkOrders: 1,
            snapshots: [snap({ Items: [item({ Planned_Worker_Days: 0 }), item()] })],
        }));
        const m = r.metrics.find(x => x.key === 'planVsActual')!;
        expect(m.score).toBe(50);
        expect(m.actions[0]).toContain('1 stavki bez planiranih dana');
    });
});

describe('STABILNOST ograničava nivo — ovo je poenta indikatora', () => {
    /** Sve popunjeno, ali trajanje divlje varira. */
    const chaotic = () => {
        const days = [1, 2, 12, 3, 15, 2, 14, 1, 11, 4, 13, 2, 16, 3, 12, 1, 14, 2, 13, 3];
        return input({
            completedWorkOrders: days.length,
            workLogsTotal: 100, workLogsWithProcess: 100,
            snapshots: days.map(d => snap({
                Items: [item({ Actual_Labor_Days: d, Planned_Worker_Days: 2 })],
                Transitions: [{
                    From_Node_ID: 'a', From_Name: 'A', To_Node_ID: 'b', To_Name: 'B',
                    Source: 'graph', Wait_Days: 1, End_To_End_Days: 2,
                }],
            })),
        });
    };

    test('visok zbir, ali nivo spušten zbog rasipanja', () => {
        const r = computeReadiness(chaotic());
        expect(r.score).toBeGreaterThan(80);
        expect(r.level).not.toBe('precizno');
        expect(r.cappedBy).toContain('rasipanje');
        expect(r.cappedBy).toContain('Više podataka to neće popraviti');
    });

    test('isti obim podataka, ali stabilno trajanje → nivo „precizno"', () => {
        const steady = input({
            completedWorkOrders: 20,
            workLogsTotal: 100, workLogsWithProcess: 100,
            snapshots: Array.from({ length: 20 }, () => snap({
                Items: [item({ Actual_Labor_Days: 3, Planned_Worker_Days: 3 })],
                Transitions: [{
                    From_Node_ID: 'a', From_Name: 'A', To_Node_ID: 'b', To_Name: 'B',
                    Source: 'graph', Wait_Days: 1, End_To_End_Days: 2,
                }],
            })),
        });
        const r = computeReadiness(steady);
        expect(r.level).toBe('precizno');
        expect(r.cappedBy).toBeNull();
    });
});

describe('detalji', () => {
    test('v2 snapshoti se ne broje kao pokrivenost', () => {
        const r = computeReadiness(input({
            snapshots: [snap({ Snapshot_Version: 2 }), snap({ Snapshot_Version: 2 })],
            completedWorkOrders: 2,
        }));
        expect(r.metrics.find(m => m.key === 'coverage')!.score).toBe(0);
    });

    test('svježina pada za staru istoriju', () => {
        const r = computeReadiness(input({
            completedWorkOrders: 2,
            snapshots: [snap({ Actual_End: '2026-07-01' }), snap({ Actual_End: '2020-01-01' })],
        }));
        expect(r.metrics.find(m => m.key === 'freshness')!.score).toBe(50);
    });

    test('dubina po tipu daje djelimičan kredit (n=7 ≈ pola od n=15)', () => {
        const r = computeReadiness(input({
            completedWorkOrders: 7,
            snapshots: Array.from({ length: 7 }, () => snap()),
        }));
        const m = r.metrics.find(x => x.key === 'typeDepth')!;
        expect(m.score).toBeCloseTo(46.67, 1);
    });

    test('najgora mjerila su prva u listi — odmah se vidi šta koči', () => {
        const r = computeReadiness(input({ completedWorkOrders: 10, snapshots: [snap()] }));
        const scores = r.metrics.map(m => m.score);
        expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    });

    test('topActions su ograničene i konkretne', () => {
        const r = computeReadiness(input({
            completedWorkOrders: 20, workLogsTotal: 100, workLogsWithProcess: 10,
            snapshots: [snap({ Unmatched_Name_Tokens: ['xyz'] })],
        }));
        expect(r.topActions.length).toBeGreaterThan(0);
        expect(r.topActions.length).toBeLessThanOrEqual(6);
    });
});
