import { buildProductionSnapshot, SNAPSHOT_VERSION, type BuildSnapshotInput } from '../snapshot/buildSnapshot';
import type { WorkOrder, WorkOrderItem, WorkLog, Worker, Material, ProductMaterial, Product } from '../types';

// ── Fixture helperi ─────────────────────────────────────────────────
const item = (over: Partial<WorkOrderItem> = {}): WorkOrderItem => ({
    ID: 'it1', Work_Order_ID: 'wo1', Organization_ID: 'org', Product_ID: 'p1',
    Product_Name: 'Kuhinja donji elementi', Project_ID: 'pr1', Project_Name: 'Novak',
    Quantity: 1, Status: 'Završeno',
    Product_Value: 1000, Planned_Labor_Days: 2, Planned_Labor_Workers: 2,
    ...over,
} as WorkOrderItem);

const wo = (over: Partial<WorkOrder> = {}): WorkOrder => ({
    Work_Order_ID: 'wo1', Organization_ID: 'org', Work_Order_Number: '2026-07/R1',
    Name: 'Kuhinja Novak', Status: 'Završeno', Work_Order_Type: 'Proizvodnja',
    Created_Date: '2026-07-01', Due_Date: '2026-07-10',
    Started_At: '2026-07-01', Completed_At: '2026-07-05',
    Production_Steps: [], Notes: '',
    items: [item()],
    ...over,
} as WorkOrder);

const log = (over: Partial<WorkLog> = {}): WorkLog => ({
    WorkLog_ID: `wl${Math.random()}`, Organization_ID: 'org',
    Work_Order_ID: 'wo1', Work_Order_Item_ID: 'it1', Product_ID: 'p1',
    Worker_ID: 'w1', Worker_Name: 'Ismet', Date: '2026-07-01',
    Daily_Rate: 100, Hours_Worked: 8, Created_At: '2026-07-01',
    ...over,
} as WorkLog);

const base = (over: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput => ({
    workOrder: wo(),
    workLogs: [log()],
    workers: [{ Worker_ID: 'w1', Name: 'Ismet', Role: 'Rezač', Worker_Type: 'Glavni' } as Worker],
    snapshotId: 'snap1',
    now: new Date('2026-07-06T10:00:00'),
    ...over,
});

describe('INVARIJANTA #1 — Σ Worker_Days === Actual_Labor_Days', () => {
    test('puni dani', () => {
        const s = buildProductionSnapshot(base({
            workLogs: [
                log({ Date: '2026-07-01', Worker_ID: 'w1' }),
                log({ Date: '2026-07-02', Worker_ID: 'w2', Worker_Name: 'Adnan' }),
            ],
        }));
        const it = s.Items[0];
        const sum = it.Workers_Assigned.reduce((a, w) => a + w.Worker_Days, 0);
        expect(sum).toBe(it.Actual_Labor_Days);
        expect(sum).toBe(2);
    });

    test('POLA DANA — ovdje je v2 pucao (brojao redove, pa je 0.5 vrijedilo 1)', () => {
        const s = buildProductionSnapshot(base({
            workLogs: [
                log({ Date: '2026-07-01', Day_Fraction: 0.5 }),
                log({ Date: '2026-07-02', Day_Fraction: 0.5 }),
            ],
        }));
        const it = s.Items[0];
        expect(it.Actual_Labor_Days).toBe(1);
        expect(it.Workers_Assigned[0].Worker_Days).toBe(1);
        expect(it.Workers_Assigned.reduce((a, w) => a + w.Worker_Days, 0)).toBe(it.Actual_Labor_Days);
        // Days_Worked je NEŠTO DRUGO i sada je jasno definisan: broj različitih datuma
        expect(it.Workers_Assigned[0].Days_Worked).toBe(2);
    });

    test('isti dan, dvije stavke → radnik-dani se ne dupliraju po stavci', () => {
        const s = buildProductionSnapshot(base({
            workOrder: wo({ items: [item({ ID: 'it1' }), item({ ID: 'it2', Product_ID: 'p2' })] }),
            workLogs: [
                log({ Work_Order_Item_ID: 'it1', Day_Fraction: 0.5 }),
                log({ Work_Order_Item_ID: 'it2', Day_Fraction: 0.5 }),
            ],
        }));
        expect(s.Items[0].Actual_Labor_Days).toBe(0.5);
        expect(s.Items[1].Actual_Labor_Days).toBe(0.5);
        expect(s.Total_Worker_Days).toBe(1);
    });

    test('Share_Of_Item pokazuje ko je nosio posao', () => {
        const s = buildProductionSnapshot(base({
            workLogs: [
                log({ Date: '2026-07-01', Worker_ID: 'w1' }),
                log({ Date: '2026-07-02', Worker_ID: 'w1' }),
                log({ Date: '2026-07-03', Worker_ID: 'w2', Worker_Name: 'Adnan' }),
            ],
        }));
        const ws = s.Items[0].Workers_Assigned;
        expect(ws[0].Worker_ID).toBe('w1');
        expect(ws[0].Share_Of_Item).toBeCloseTo(0.67, 2);
        expect(ws[1].Share_Of_Item).toBeCloseTo(0.33, 2);
    });
});

describe('#2 — materijal: kategorija, ne dobavljač', () => {
    const materials: ProductMaterial[] = [{
        ID: 'pm1', Organization_ID: 'org', Product_ID: 'p1', Material_ID: 'm1',
        Material_Name: 'Iveral U702 18mm', Quantity: 3, Unit: 'm²',
        Unit_Price: 40, Total_Price: 120, Status: 'Primljeno', Supplier: 'Drvoprom', Order_ID: '',
    }];
    const catalog = new Map<string, Material>([
        ['m1', { Material_ID: 'm1', Name: 'Iveral U702', Category: 'Ploče i trake' } as Material],
    ]);

    test('Category dolazi iz kataloga, Supplier ima svoje polje', () => {
        const s = buildProductionSnapshot(base({
            materialsByProduct: new Map([['p1', materials]]),
            materialCatalogById: catalog,
        }));
        const m = s.Items[0].Materials[0];
        expect(m.Category).toBe('Ploče i trake');   // v2 je ovdje pisao 'Drvoprom'
        expect(m.Supplier).toBe('Drvoprom');
    });

    test('Material_Type se izvodi iz NAZIVA (kategorije su preširoke)', () => {
        const s = buildProductionSnapshot(base({
            materialsByProduct: new Map([['p1', materials]]),
            materialCatalogById: catalog,
        }));
        expect(s.Items[0].Materials[0].Material_Type).toBe('iveral');
        expect(s.Items[0].Material_Types).toContain('iveral');
    });

    test('materijal bez unosa u katalogu → "Ostalo", ne pada', () => {
        const s = buildProductionSnapshot(base({ materialsByProduct: new Map([['p1', materials]]) }));
        expect(s.Items[0].Materials[0].Category).toBe('Ostalo');
    });
});

describe('#3/#5 — klasifikacija i tip naloga', () => {
    test('Work_Order_Type se upisuje — bez njega nema odgovora „ko ide na montažu"', () => {
        const s = buildProductionSnapshot(base({ workOrder: wo({ Work_Order_Type: 'Montaža' }) }));
        expect(s.Work_Order_Type).toBe('Montaža');
    });

    test('nalog „Zadaci" klasifikovan IZ NAZIVA (v2 naziv naloga nije ni gledao)', () => {
        const s = buildProductionSnapshot(base({
            workOrder: wo({
                Work_Order_Type: 'Zadaci',
                Name: 'Razni poslovi — 2 komode i polica',
                items: [item({ Product_Name: 'Razni poslovi' })],
            }),
        }));
        expect(s.Name_Derived_Types).toEqual(['komoda', 'polica']);
        expect(s.Classification_Source).toBe('order-name');
        expect(s.Normalized_Product_Types).toEqual(['komoda', 'polica']);
    });

    test('nepoznati tokeni se čuvaju kao hrana za petlju učenja', () => {
        const s = buildProductionSnapshot(base({ workOrder: wo({ Name: 'Kuhinja Hadžić' }) }));
        expect(s.Unmatched_Name_Tokens).toContain('hadzic');
    });

    test('Taxonomy_Version se upisuje → klasifikacija je reproducibilna', () => {
        const s = buildProductionSnapshot(base());
        expect(typeof s.Taxonomy_Version).toBe('number');
        expect(s.Classification_Method).toBe('rule');
    });
});

describe('#10/#11 — dani u radnik-danima, kalendar odvojen', () => {
    test('Planned_Days = Σ dani × radnici (v2: Planned_Labor_Cost / 100)', () => {
        const s = buildProductionSnapshot(base({
            workOrder: wo({
                Planned_Labor_Cost: 99999,   // v2 bi odavde izveo "1000 dana"
                items: [item({ Planned_Labor_Days: 2, Planned_Labor_Workers: 2 })],
            }),
        }));
        expect(s.Planned_Days).toBe(4);
    });

    test('Actual_Days ne mjeri „do danas" za nalog bez kraja', () => {
        const s = buildProductionSnapshot(base({
            workOrder: wo({ Completed_At: undefined }),
            workLogs: [log({ Date: '2026-07-01' })],
            now: new Date('2027-01-01T10:00:00'),   // pola godine kasnije
        }));
        expect(s.Actual_Days).toBe(1);       // jedan zabilježen radnik-dan
    });

    test('Duration_Variance poredi iste jedinice (radnik-dani)', () => {
        const s = buildProductionSnapshot(base({
            workLogs: [log({ Date: '2026-07-01' }), log({ Date: '2026-07-02' })],
        }));
        expect(s.Planned_Days).toBe(4);
        expect(s.Actual_Days).toBe(2);
        expect(s.Duration_Variance).toBe(-2);   // brže od plana
    });

    test('kalendarsko vrijeme je Lead_Days, odvojeno od radnik-dana', () => {
        const s = buildProductionSnapshot(base({
            workLogs: [log({ Date: '2026-07-01' }), log({ Date: '2026-07-08' })],
        }));
        expect(s.Touch_Days).toBe(2);        // rad
        expect(s.Lead_Days).toBe(8);         // proteklo
        expect(s.Flow_Efficiency).toBe(0.25);
    });
});

describe('#6 — procesi iz dnevnica', () => {
    test('Process_Runs i Transitions dolaze iz logova, ne iz legacy checkliste', () => {
        const s = buildProductionSnapshot(base({
            workLogs: [
                log({ Date: '2026-07-01', Process_Node_ID: 'n1', Process_Name: 'Krojenje' }),
                log({ Date: '2026-07-05', Process_Node_ID: 'n2', Process_Name: 'Lakiranje' }),
            ],
            graph: { nodes: [{ id: 'n1', name: 'Krojenje', itemIds: [] }, { id: 'n2', name: 'Lakiranje', itemIds: [] }], edges: [{ id: 'e1', source: 'n1', target: 'n2' }] },
        }));
        expect(s.Process_Runs?.map(r => r.Process_Name)).toEqual(['Krojenje', 'Lakiranje']);
        const tr = s.Transitions?.[0];
        expect(tr?.Wait_Days).toBe(4);
        expect(tr?.Source).toBe('graph');
    });

    test('radnikovi dani po procesu se pripisuju (osnova za afinitet)', () => {
        const s = buildProductionSnapshot(base({
            workLogs: [
                log({ Date: '2026-07-01', Process_Node_ID: 'n1', Process_Name: 'Lakiranje' }),
                log({ Date: '2026-07-02', Process_Node_ID: 'n1', Process_Name: 'Lakiranje' }),
            ],
        }));
        expect(s.Items[0].Workers_Assigned[0].Process_Days).toEqual({ Lakiranje: 2 });
    });
});

describe('kvalitet i verzija', () => {
    test('verzija je 3', () => {
        expect(buildProductionSnapshot(base()).Snapshot_Version).toBe(SNAPSHOT_VERSION);
        expect(SNAPSHOT_VERSION).toBe(3);
    });

    test('nedostatak procesa i klasifikacije obara ocjenu s razlogom', () => {
        const s = buildProductionSnapshot(base({
            workOrder: wo({ Name: 'RN-2026-07/R9', items: [item({ Product_Name: 'xyz', Planned_Labor_Days: 0 })] }),
        }));
        expect(s.Data_Issues).toEqual(expect.arrayContaining([
            expect.stringContaining('procesima'),
            expect.stringContaining('klasifikovan'),
            expect.stringContaining('planiranih dana'),
        ]));
        expect(s.Quality_Score).toBeLessThan(100);
    });

    test('nalog bez ijednog loga ne ruši gradnju', () => {
        const s = buildProductionSnapshot(base({ workLogs: [] }));
        expect(s.Actual_Days).toBe(0);
        expect(s.Lead_Days).toBe(0);
        expect(s.Flow_Efficiency).toBeNull();
        expect(s.Is_Valid_For_AI).toBe(false);
    });

    test('deterministično uz fiksni `now` — rebuild daje identičan rezultat', () => {
        const input = base();
        expect(buildProductionSnapshot(input)).toEqual(buildProductionSnapshot(input));
    });
});

describe('profit ide kroz lib/profit.ts', () => {
    test('overrides se poštuju (isto kao kartica naloga i analitika)', () => {
        const s = buildProductionSnapshot(base({
            workOrder: wo({
                items: [item({ Product_Value: 1000, Profit_Overrides: { Selling_Price: 1500 } } as Partial<WorkOrderItem>)],
            }),
        }));
        expect(s.Items[0].Selling_Price).toBe(1500);
        expect(s.Total_Selling_Price).toBe(1500);
    });

    test('materijal se množi količinom (prihod je ukupan)', () => {
        const materials: ProductMaterial[] = [{
            ID: 'pm1', Organization_ID: 'org', Product_ID: 'p1', Material_ID: 'm1',
            Material_Name: 'Iveral', Quantity: 1, Unit: 'm²', Unit_Price: 100, Total_Price: 100,
            Status: 'Primljeno', Supplier: 'X', Order_ID: '',
        }];
        const s = buildProductionSnapshot(base({
            workOrder: wo({ items: [item({ Quantity: 3 })] }),
            materialsByProduct: new Map([['p1', materials]]),
        }));
        expect(s.Items[0].Material_Per_Unit).toBe(100);
        expect(s.Items[0].Total_Material_Cost).toBe(300);
    });
});
