// ════════════════════════════════════════════════════════════════════
// RADNIKOVA PROJEKCIJA — nalozi, projekti, efikasnost
//
// Kao i kod fieldHome, najvažniji test je „ne propušta novac": radnik nema
// pristup Firestoreu, pa su ove funkcije jedina granica. Uz to provjeravamo
// da se lista suzi na RADNIKOVE naloge/proizvode i da „Tempo" drži planirano/
// utrošeno/moj-udio odvojeno (dijeljenje bi lagalo o timskom trošku).
// ════════════════════════════════════════════════════════════════════

import {
    buildWorkerOrders, buildWorkerProjects, buildWorkerEfficiency, myProductIds,
    type WorkerEfficiencyInput,
} from '@/lib/field/fieldWorker';
import type {
    Product, ProductMaterial, Project, WorkerAttendance, WorkLog, WorkOrder, WorkOrderItem,
} from '@/lib/types';

const TODAY = '2026-07-15';   // srijeda; sedmica 13.–19.

const FORBIDDEN_KEYS = [
    'Total_Value', 'Profit', 'Profit_Margin', 'Material_Cost', 'Planned_Labor_Cost',
    'Actual_Labor_Cost', 'Daily_Rate', 'Original_Daily_Rate', 'Product_Value',
    'Services_Total', 'Transport_Share', 'Unit_Price', 'Total_Price',
];

function walk(value: unknown, keys: string[] = [], numbers: number[] = []): { keys: string[]; numbers: number[] } {
    if (Array.isArray(value)) {
        value.forEach(v => walk(v, keys, numbers));
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            keys.push(k);
            walk(v, keys, numbers);
        }
    } else if (typeof value === 'number') {
        numbers.push(value);
    }
    return { keys, numbers };
}

function makeItem(over: Partial<WorkOrderItem> = {}): WorkOrderItem {
    return {
        ID: 'item-1',
        Work_Order_ID: 'wo-1',
        Product_ID: 'p-1',
        Product_Name: 'Kuhinja Gornji element',
        Project_ID: 'proj-1',
        Project_Name: 'Stan Hrasno',
        Quantity: 3,
        Status: 'U toku',
        Assigned_Workers: [{ Worker_ID: 'w-1', Worker_Name: 'Mujo', Daily_Rate: 90 }],
        Processes: [{ Process_Name: 'Rezanje', Status: 'U toku' }],
        Planned_Labor_Days: 2,
        Planned_Labor_Workers: 2,
        Product_Value: 4200,
        Material_Cost: 1800,
        Actual_Labor_Cost: 540,
        ...over,
    } as WorkOrderItem;
}

function makeOrder(over: Partial<WorkOrder> = {}): WorkOrder {
    return {
        Work_Order_ID: 'wo-1',
        Organization_ID: 'org-1',
        Name: 'Stan Hrasno — kuhinja',
        Work_Order_Number: '2026-07/R1',
        Created_Date: '2026-07-01T08:00:00.000Z',
        Due_Date: '2026-07-20',
        Status: 'U toku',
        Production_Steps: [],
        Notes: '',
        Started_At: '2026-07-05T07:00:00.000Z',
        Total_Value: 12000,
        Material_Cost: 5400,
        Profit: 4500,
        items: [makeItem()],
        ...over,
    } as WorkOrder;
}

describe('myProductIds / buildWorkerOrders — suženje na radnika', () => {
    it('uzima samo naloge s radnikovom nezavršenom stavkom', () => {
        const mine = makeOrder();
        const foreign = makeOrder({
            Work_Order_ID: 'wo-2',
            items: [makeItem({
                ID: 'item-2', Work_Order_ID: 'wo-2', Product_ID: 'p-2', Product_Name: 'Tuđi ormar',
                Assigned_Workers: [{ Worker_ID: 'w-9', Worker_Name: 'Haso', Daily_Rate: 80 }],
                Processes: [],
            })],
        });
        const rows = buildWorkerOrders({
            today: TODAY, workerId: 'w-1', orders: [mine, foreign], tasks: [], workedTodayOrderIds: new Set(),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].orderId).toBe('wo-1');
    });

    it('proizvod s dovršenom stavkom ne diže nalog', () => {
        const done = makeOrder({ items: [makeItem({ Status: 'Završeno' })] });
        const rows = buildWorkerOrders({
            today: TODAY, workerId: 'w-1', orders: [done], tasks: [], workedTodayOrderIds: new Set(),
        });
        expect(rows).toHaveLength(0);
    });

    it('myProductIds vraća samo proizvode radnika', () => {
        const wo = makeOrder({
            items: [
                makeItem(),
                makeItem({ ID: 'item-x', Product_ID: 'p-x', Assigned_Workers: [{ Worker_ID: 'w-9', Worker_Name: 'Haso', Daily_Rate: 80 }], Processes: [] }),
            ],
        });
        expect([...myProductIds([wo], 'w-1')]).toEqual(['p-1']);
    });

    it('ne propušta novac', () => {
        const rows = buildWorkerOrders({
            today: TODAY, workerId: 'w-1', orders: [makeOrder()], tasks: [], workedTodayOrderIds: new Set(),
        });
        const { keys, numbers } = walk(rows);
        for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
        for (const amt of [12000, 5400, 4500, 4200, 1800, 540]) expect(numbers).not.toContain(amt);
    });
});

function makeMaterial(over: Partial<ProductMaterial> = {}): ProductMaterial {
    return {
        ID: 'm-1', Organization_ID: 'org-1', Product_ID: 'p-1',
        Material_ID: 'cat-1', Material_Name: 'Iverica 18mm', Quantity: 4, Unit: 'ploča',
        Unit_Price: 55, Total_Price: 220, Status: 'Nije naručeno', Supplier: 'Jela', Order_ID: '',
        Is_Essential: true,
        ...over,
    } as ProductMaterial;
}

function makeProject(over: Partial<Project> = {}): Project {
    const products: Product[] = [
        { Product_ID: 'p-1', Project_ID: 'proj-1', Name: 'Kuhinja', Quantity: 3, Status: 'U proizvodnji', Material_Cost: 1800, materials: [makeMaterial()] } as Product,
        { Product_ID: 'p-2', Project_ID: 'proj-1', Name: 'Tuđi ormar', Quantity: 1, Status: 'U proizvodnji', Material_Cost: 900, materials: [makeMaterial({ ID: 'm-2', Product_ID: 'p-2' })] } as Product,
    ];
    return {
        Project_ID: 'proj-1', Organization_ID: 'org-1', Name: 'Stan Hrasno',
        Client_Name: 'Kupac', Client_Phone: '061', Client_Email: 'x@y.z',
        Address: 'Hrasno bb', Notes: '', Status: 'U proizvodnji', Created_Date: '2026-07-01', Deadline: '2026-07-30',
        products,
        ...over,
    } as Project;
}

describe('buildWorkerProjects — samo radnikovi proizvodi', () => {
    it('zadržava projekat, ali unutar njega samo proizvode radnika', () => {
        const out = buildWorkerProjects({ workerId: 'w-1', projects: [makeProject()], productIds: new Set(['p-1']) });
        expect(out).toHaveLength(1);
        expect(out[0].products.map(p => p.productId)).toEqual(['p-1']);
        expect(out[0].productCount).toBe(1);       // preračunato na suženi skup
    });

    it('izbacuje projekat bez ijednog radnikovog proizvoda', () => {
        const out = buildWorkerProjects({ workerId: 'w-1', projects: [makeProject()], productIds: new Set(['p-999']) });
        expect(out).toHaveLength(0);
    });

    it('ne propušta cijene materijala', () => {
        const out = buildWorkerProjects({ workerId: 'w-1', projects: [makeProject()], productIds: new Set(['p-1']) });
        const { keys, numbers } = walk(out);
        for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
        for (const amt of [55, 220, 1800]) expect(numbers).not.toContain(amt);
    });
});

function log(over: Partial<WorkLog>): WorkLog {
    return {
        WorkLog_ID: 'l', Organization_ID: 'org-1', Date: TODAY,
        Worker_ID: 'w-1', Worker_Name: 'Mujo', Daily_Rate: 12345, Original_Daily_Rate: 67890,
        Hours_Worked: 8, Work_Order_ID: 'wo-1', Work_Order_Item_ID: 'item-1', Product_ID: 'p-1',
        Is_From_Attendance: true, Created_At: TODAY, Day_Fraction: 1,
        ...over,
    } as WorkLog;
}

function att(date: string, status = 'Prisutan'): WorkerAttendance {
    return {
        Attendance_ID: `a-${date}`, Organization_ID: 'org-1', Worker_ID: 'w-1', Worker_Name: 'Mujo',
        Date: date, Status: status as WorkerAttendance['Status'], Created_Date: date,
    } as WorkerAttendance;
}

function effInput(over: Partial<WorkerEfficiencyInput> = {}): WorkerEfficiencyInput {
    return {
        today: TODAY, workerId: 'w-1',
        monthFrom: '2026-07-01', monthTo: '2026-07-31',
        workLogs: [log({ Date: '2026-07-14' }), log({ Date: '2026-07-15' })],
        itemLogs: [
            log({ Date: '2026-07-14' }), log({ Date: '2026-07-15' }),
            log({ WorkLog_ID: 'l3', Worker_ID: 'w-9', Worker_Name: 'Haso', Date: '2026-07-14' }),
        ],
        attendance: [att('2026-07-14'), att('2026-07-15')],
        items: [makeItem()],
        ...over,
    };
}

describe('buildWorkerEfficiency — suptilan uvid', () => {
    it('broji radne/prisutne dane i proizvode', () => {
        const eff = buildWorkerEfficiency(effInput());
        expect(eff.workedDays).toBe(2);
        expect(eff.presentDays).toBe(2);
        expect(eff.productsWorked).toBe(1);
    });

    it('Tempo drži planirano/utrošeno/moj-udio odvojeno', () => {
        const eff = buildWorkerEfficiency(effInput());
        expect(eff.tempo).toHaveLength(1);
        expect(eff.tempo[0].plannedDays).toBe(4);   // 2 dana × 2 radnika
        expect(eff.tempo[0].actualDays).toBe(3);    // 2 (Mujo) + 1 (Haso)
        expect(eff.tempo[0].myDays).toBe(2);        // samo Mujo
    });

    it('ritam pokriva 8 sedmica, tekuća je označena', () => {
        const eff = buildWorkerEfficiency(effInput());
        expect(eff.rhythm).toHaveLength(8);
        const cur = eff.rhythm.filter(w => w.isCurrent);
        expect(cur).toHaveLength(1);
        expect(cur[0].bookedDays).toBe(2);
        expect(cur[0].presentDays).toBe(2);
    });

    it('ne propušta dnevnicu', () => {
        const eff = buildWorkerEfficiency(effInput());
        const { keys, numbers } = walk(eff);
        for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
        expect(numbers).not.toContain(12345);
        expect(numbers).not.toContain(67890);
    });
});
