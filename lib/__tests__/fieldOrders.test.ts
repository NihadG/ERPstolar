// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA NALOGA
//
// `WorkOrder` nosi Total_Value, Profit i Material_Cost, a `WorkOrderItem` još
// i Product_Value i Profit_Overrides. Kontrolor gleda te naloge cijeli dan —
// ovo je funkcija koja garantuje da mu iznosi ne stignu u telefon.
// ════════════════════════════════════════════════════════════════════

import {
    buildFieldOrderDetail, buildFieldOrdersList,
    type FieldOrderDetailInput, type FieldOrdersListInput,
} from '@/lib/field/fieldOrders';
import type { Task, WorkOrder, WorkOrderItem } from '@/lib/types';

const TODAY = '2026-07-15';

const FORBIDDEN_KEYS = [
    'Total_Value', 'Profit', 'Profit_Margin', 'Material_Cost', 'Planned_Labor_Cost',
    'Actual_Labor_Cost', 'Labor_Cost', 'Labor_Cost_Variance', 'Product_Value',
    'Services_Total', 'Transport_Share', 'Profit_Overrides', 'Daily_Rate',
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
        ID: 'item-1', Work_Order_ID: 'wo-1', Product_ID: 'p-1',
        Product_Name: 'Kuhinja gornji element',
        Project_ID: 'proj-1', Project_Name: 'Stan Hrasno',
        Quantity: 2, Status: 'U toku',
        Process_Stages: [{ processes: ['Rezanje'] }, { processes: ['Kantiranje'] }],
        Processes: [
            { Process_Name: 'Rezanje', Status: 'Završeno', Worker_Name: 'Mujo', Completed_At: `${TODAY}T10:00:00.000Z` },
            { Process_Name: 'Kantiranje', Status: 'Na čekanju' },
        ],
        Assigned_Workers: [{ Worker_ID: 'w-1', Worker_Name: 'Mujo', Daily_Rate: 90 }],
        // Novčana polja NAMJERNO postavljena.
        Product_Value: 4200, Material_Cost: 1800, Actual_Labor_Cost: 540,
        ...over,
    } as WorkOrderItem;
}

function makeOrder(over: Partial<WorkOrder> = {}): WorkOrder {
    return {
        Work_Order_ID: 'wo-1', Organization_ID: 'org-1',
        Name: 'Stan Hrasno — kuhinja', Work_Order_Number: '2026-07/R1',
        Created_Date: '2026-07-01T08:00:00.000Z', Due_Date: '2026-07-20',
        Status: 'U toku', Production_Steps: [], Notes: 'pazi na furnir',
        Started_At: '2026-07-05T07:00:00.000Z',
        Total_Value: 12000, Material_Cost: 5400, Actual_Labor_Cost: 2100,
        Profit: 4500, Profit_Margin: 37.5,
        items: [makeItem()],
        ...over,
    } as WorkOrder;
}

const task = (over: Partial<Task> = {}): Task => ({
    Task_ID: 't-1', Organization_ID: 'org-1', Title: 'Naručiti okov',
    Description: '', Status: 'pending', Priority: 'high', Category: 'general',
    Created_Date: '2026-07-10T08:00:00.000Z',
    Links: [{ Entity_Type: 'work_order', Entity_ID: 'wo-1', Entity_Name: 'Stan Hrasno' }],
    ...over,
} as Task);

const listInput = (over: Partial<FieldOrdersListInput> = {}): FieldOrdersListInput => ({
    today: TODAY, orders: [makeOrder()], tasks: [task()],
    workedTodayOrderIds: new Set<string>(),
    ...over,
});

const detailInput = (over: Partial<FieldOrderDetailInput> = {}): FieldOrderDetailInput => ({
    today: TODAY, order: makeOrder(), graph: null, tasks: [task()],
    workers: [{ Worker_ID: 'w-1', Name: 'Mujo Mujić' }, { Worker_ID: 'w-2', Name: 'Haso Hasić' }],
    ...over,
});

describe('buildFieldOrdersList — novac ne izlazi', () => {
    it('nijedno novčano polje se ne pojavljuje', () => {
        const { keys } = walk(buildFieldOrdersList(listInput()));
        for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
    });

    it('nijedan iznos iz ulaza ne procuri kao broj', () => {
        const rows = buildFieldOrdersList(listInput({
            orders: [makeOrder({
                Total_Value: 98765, Material_Cost: 54321, Profit: 43210,
                items: [makeItem({ Product_Value: 76543, Actual_Labor_Cost: 32109 })],
            })],
        }));
        const { numbers } = walk(rows);
        for (const a of [98765, 54321, 43210, 76543, 32109]) expect(numbers).not.toContain(a);
    });
});

describe('buildFieldOrdersList — poredak za pogon', () => {
    it('nalog s radom knjiženim danas ide na vrh', () => {
        const rows = buildFieldOrdersList(listInput({
            orders: [
                makeOrder({ Work_Order_ID: 'wo-1', Name: 'Bez rada danas' }),
                makeOrder({ Work_Order_ID: 'wo-2', Name: 'Radi se danas' }),
            ],
            workedTodayOrderIds: new Set(['wo-2']),
        }));
        expect(rows[0].name).toBe('Radi se danas');
    });

    it('unutar istog ranga prvi je najhitniji rok', () => {
        const rows = buildFieldOrdersList(listInput({
            orders: [
                makeOrder({ Work_Order_ID: 'wo-1', Name: 'Kasni', Due_Date: '2026-07-10' }),
                makeOrder({ Work_Order_ID: 'wo-2', Name: 'Ima vremena', Due_Date: '2026-08-30' }),
            ],
        }));
        expect(rows.map(r => r.name)).toEqual(['Kasni', 'Ima vremena']);
    });

    it('broji samo OTVORENE zadatke naloga', () => {
        const rows = buildFieldOrdersList(listInput({
            tasks: [task(), task({ Task_ID: 't-2', Status: 'completed' })],
        }));
        expect(rows[0].openTasks).toBe(1);
    });

    it('napredak i rok se izvode', () => {
        const row = buildFieldOrdersList(listInput())[0];
        expect(row.progressPct).toBe(50);      // 1 od 2 procesa
        expect(row.daysUntilDue).toBe(5);      // 15. → 20. juli
    });
});

describe('buildFieldOrderDetail — novac ne izlazi', () => {
    it('nijedno novčano polje se ne pojavljuje, ni u toku ni u stavkama', () => {
        const { keys } = walk(buildFieldOrderDetail(detailInput()));
        for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
    });

    it('nijedan iznos iz ulaza ne procuri kao broj', () => {
        const detail = buildFieldOrderDetail(detailInput({
            order: makeOrder({
                Total_Value: 98765, Profit: 43210,
                items: [makeItem({ Product_Value: 76543, Material_Cost: 65432 })],
            }),
        }));
        const { numbers } = walk(detail);
        for (const a of [98765, 43210, 76543, 65432]) expect(numbers).not.toContain(a);
    });

    it('ekipa ne nosi dnevnicu — samo id i ime', () => {
        const detail = buildFieldOrderDetail(detailInput());
        expect(Object.keys(detail.crew[0]).sort()).toEqual(['name', 'workerId']);
    });
});

describe('buildFieldOrderDetail — sadržaj', () => {
    it('tok se gradi iz plana procesa kad nema snimljenog grafa', () => {
        const detail = buildFieldOrderDetail(detailInput());
        expect(detail.flow.map(r => r.name)).toEqual(['Rezanje', 'Kantiranje']);
    });

    it('gejtovanje: prvi proces je gotov, drugi je na redu', () => {
        const detail = buildFieldOrderDetail(detailInput());
        expect(detail.flow[0].state).toBe('done');
        expect(detail.flow[1].state).toBe('active');
    });

    it('svaka stavka nosi TAČAN naziv procesa (za upis)', () => {
        const detail = buildFieldOrderDetail(detailInput());
        expect(detail.flow[1].perItem[0].procName).toBe('Kantiranje');
    });

    it('proizvod se ne može zatvoriti dok svi procesi nisu gotovi', () => {
        const detail = buildFieldOrderDetail(detailInput());
        expect(detail.items[0].canComplete).toBe(false);
    });

    it('proizvod SE može zatvoriti kad su svi procesi gotovi', () => {
        const detail = buildFieldOrderDetail(detailInput({
            order: makeOrder({
                items: [makeItem({
                    Processes: [
                        { Process_Name: 'Rezanje', Status: 'Završeno' },
                        { Process_Name: 'Kantiranje', Status: 'Završeno' },
                    ],
                })],
            }),
        }));
        expect(detail.items[0].canComplete).toBe(true);
    });

    it('već završen proizvod se ne nudi za zatvaranje', () => {
        const detail = buildFieldOrderDetail(detailInput({
            order: makeOrder({
                items: [makeItem({
                    Status: 'Završeno',
                    Processes: [{ Process_Name: 'Rezanje', Status: 'Završeno' }],
                })],
            }),
        }));
        expect(detail.items[0].canComplete).toBe(false);
    });

    it('ekipa naloga je na vrhu liste radnika', () => {
        const detail = buildFieldOrderDetail(detailInput({
            workers: [{ Worker_ID: 'w-2', Name: 'Haso Hasić' }, { Worker_ID: 'w-1', Name: 'Mujo Mujić' }],
        }));
        // w-1 je dodijeljen na stavci, pa ide prvi iako je abecedno drugi.
        expect(detail.crew[0].workerId).toBe('w-1');
    });

    it('uzima samo zadatke ovog naloga', () => {
        const detail = buildFieldOrderDetail(detailInput({
            tasks: [
                task(),
                task({ Task_ID: 't-9', Links: [{ Entity_Type: 'work_order', Entity_ID: 'wo-9', Entity_Name: 'Drugi' }] }),
            ],
        }));
        expect(detail.tasks.map(t => t.taskId)).toEqual(['t-1']);
    });
});
