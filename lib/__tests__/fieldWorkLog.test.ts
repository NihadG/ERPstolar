// Knjiga rada na telefonu. Dvije stvari koje ovdje moraju držati:
//   1. NOVAC izlazi samo kad ga ruta izričito traži (`includeCost`) — kontrolor
//      raspoređuje ljude, ne vidi cijene.
//   2. Zapisi se grupišu PO RADNIKU po danu; radnik na tri proizvoda je JEDAN
//      red s tri stavke, ne tri reda.

import { buildFieldWorkLog } from '../field/fieldWorkLog';
import type { WorkLog, WorkOrder, WorkOrderItem } from '../types';

const TODAY = '2026-06-25';

const order = (opts: Partial<WorkOrder> = {}): WorkOrder => ({
    Work_Order_ID: 'WO1',
    Organization_ID: 'org',
    Work_Order_Number: '2026-06/R1',
    Name: 'Kuhinja — Dino',
    Status: 'U toku',
    Started_At: '2026-06-23',
    Created_Date: '2026-06-22',
    ...opts,
} as unknown as WorkOrder);

const item = (ID: string, name: string, opts: Partial<WorkOrderItem> = {}): WorkOrderItem => ({
    ID,
    Work_Order_ID: 'WO1',
    Product_ID: `p-${ID}`,
    Product_Name: name,
    Status: 'U toku',
    ...opts,
} as unknown as WorkOrderItem);

const log = (date: string, workerId: string, itemId: string, rate: number, presence = 1): WorkLog => ({
    WorkLog_ID: `${date}-${workerId}-${itemId}`,
    Organization_ID: 'org',
    Work_Order_ID: 'WO1',
    Work_Order_Item_ID: itemId,
    Worker_ID: workerId,
    Worker_Name: 'staro ime',
    Date: date,
    Daily_Rate: rate,
    Presence: presence,
} as unknown as WorkLog);

const names = new Map([['W1', 'Amir Berisalić'], ['W2', 'Emrah Gluhić']]);

const build = (logs: WorkLog[], includeCost: boolean, items = [item('i1', 'Korpusi'), item('i2', 'Fronte')]) =>
    buildFieldWorkLog({ today: TODAY, order: order(), items, logs, workerNames: names, includeCost });

describe('buildFieldWorkLog', () => {
    test('radnik na više stavki istog dana → JEDAN red s obje stavke', () => {
        const out = build([log('2026-06-24', 'W1', 'i1', 50), log('2026-06-24', 'W1', 'i2', 50)], false);
        const day = out.days.find(d => d.date === '2026-06-24')!;
        expect(day.workers).toHaveLength(1);
        expect(day.workers[0].itemIds.sort()).toEqual(['i1', 'i2']);
        expect(day.dayType).toBe('working');
    });

    test('ime dolazi iz EVIDENCIJE, ne s denormalizovanog zapisa', () => {
        const out = build([log('2026-06-24', 'W1', 'i1', 100)], false);
        expect(out.days.find(d => d.date === '2026-06-24')!.workers[0].name).toBe('Amir Berisalić');
    });

    test('bez includeCost nijedan iznos ne izlazi', () => {
        const out = build([log('2026-06-24', 'W1', 'i1', 100), log('2026-06-24', 'W2', 'i1', 80)], false);
        expect(out.canSeeMoney).toBe(false);
        expect(out.totalCost).toBeUndefined();
        const day = out.days.find(d => d.date === '2026-06-24')!;
        expect(day.cost).toBeUndefined();
        day.workers.forEach(w => expect(w.cost).toBeUndefined());
        expect(JSON.stringify(out)).not.toContain('100');
    });

    test('s includeCost iznosi se zbrajaju po radniku i po danu', () => {
        const out = build([
            log('2026-06-24', 'W1', 'i1', 50),
            log('2026-06-24', 'W1', 'i2', 50),
            log('2026-06-24', 'W2', 'i1', 80),
        ], true);
        expect(out.canSeeMoney).toBe(true);
        const day = out.days.find(d => d.date === '2026-06-24')!;
        expect(day.cost).toBe(180);
        expect(day.workers.find(w => w.workerId === 'W1')!.cost).toBe(100);
        expect(out.totalCost).toBe(180);
    });

    test('pola dana se prenosi na red radnika', () => {
        const out = build([log('2026-06-24', 'W1', 'i1', 50, 0.5)], false);
        expect(out.days.find(d => d.date === '2026-06-24')!.workers[0].presence).toBe(0.5);
    });

    test('najnoviji dan je prvi — na telefonu se popravlja današnji unos', () => {
        const out = build([log('2026-06-23', 'W1', 'i1', 100), log('2026-06-25', 'W1', 'i1', 100)], false);
        expect(out.days[0].date).toBe(TODAY);
        expect(out.days[out.days.length - 1].date).toBe('2026-06-23');
    });

    test('ekipa = dodijeljeni radnici naloga', () => {
        const out = buildFieldWorkLog({
            today: TODAY,
            order: order(),
            items: [item('i1', 'Korpusi', {
                Assigned_Workers: [{ Worker_ID: 'W2', Worker_Name: 'Emrah', Daily_Rate: 80 }],
            } as Partial<WorkOrderItem>)],
            logs: [],
            workerNames: names,
            includeCost: false,
        });
        expect(out.crew).toEqual([{ workerId: 'W2', name: 'Emrah Gluhić' }]);
    });

    test('bez dodijeljenih radnika → ekipa je zadnja proknjižena', () => {
        const out = build([log('2026-06-23', 'W1', 'i1', 100), log('2026-06-24', 'W2', 'i1', 80)], false, [item('i1', 'Korpusi')]);
        expect(out.crew.map(c => c.workerId)).toEqual(['W2']);
    });
});
