import {
    buildProcessCells, groupByOrder, groupByProcess, groupByWorker,
    type ProcessBoardOrderInput,
} from '../processBoard';
import type { WorkOrderItem } from '../types';

const catalog = [
    { Name: 'Krojenje Iverala', Order: 6 },
    { Name: 'Kantiranje', Order: 7 },
    { Name: 'Farbanje i lakiranje', Order: 16 },
];

function item(opts: Partial<WorkOrderItem> & { ID: string; Product_Name: string }): WorkOrderItem {
    return {
        Work_Order_ID: 'WO', Product_ID: 'p', Project_ID: 'P', Project_Name: 'Proj', Quantity: 1,
        Status: 'U toku', Processes: [], ...opts,
    } as unknown as WorkOrderItem;
}

// Nalog A: katalog fazni plan (krojenje → kantiranje → farbanje), krojenje završeno.
const orderA: ProcessBoardOrderInput = {
    orderLabel: 'Nalog A',
    workOrder: { Work_Order_ID: 'WOA', Work_Order_Type: 'Proizvodnja', Status: 'U toku', Color_Code: '#0071e3' },
    items: [item({
        ID: 'A1', Product_Name: 'Ormar', Work_Order_ID: 'WOA',
        Process_Stages: [{ processes: ['Krojenje Iverala'] }, { processes: ['Kantiranje'] }, { processes: ['Farbanje i lakiranje'] }],
        Assigned_Workers: [{ Worker_ID: 'w1', Worker_Name: 'Bego', Daily_Rate: 130 }],
        Processes: [
            { Process_Name: 'Krojenje Iverala', Status: 'Završeno', Worker_ID: 'w1', Worker_Name: 'Bego' },
            { Process_Name: 'Kantiranje', Status: 'Na čekanju' },
            { Process_Name: 'Farbanje i lakiranje', Status: 'Na čekanju' },
        ],
    } as any)],
};

// Nalog B: legacy generički jedan proces "Rad" (van kataloga), aktivan odmah.
const orderB: ProcessBoardOrderInput = {
    orderLabel: 'Nalog B',
    workOrder: { Work_Order_ID: 'WOB', Work_Order_Type: 'Proizvodnja', Status: 'U toku', Color_Code: '#34c759' },
    items: [item({
        ID: 'B1', Product_Name: 'Sto', Work_Order_ID: 'WOB',
        Assigned_Workers: [{ Worker_ID: 'w2', Worker_Name: 'Braco', Daily_Rate: 120 }],
        Processes: [{ Process_Name: 'Rad', Status: 'Na čekanju', Worker_ID: 'w2', Worker_Name: 'Braco' }],
    } as any)],
};

describe('buildProcessCells — gating i tačno ime procesa', () => {
    const cells = buildProcessCells([orderA, orderB], catalog, []);

    test('kantiranje je NA REDU čim je krojenje gotovo (gating nezavisan po nalogu)', () => {
        const kant = cells.find(c => c.workOrderId === 'WOA' && c.processName === 'Kantiranje')!;
        expect(kant.gate).toBe('active');
        const kroj = cells.find(c => c.workOrderId === 'WOA' && c.processName === 'Krojenje Iverala')!;
        expect(kroj.gate).toBe('done');
        const farb = cells.find(c => c.workOrderId === 'WOA' && c.processName === 'Farbanje i lakiranje')!;
        expect(farb.gate).toBe('blocked');   // čeka kantiranje
    });

    test('legacy "Rad" (van kataloga) → catalogOrder null, odmah aktivan', () => {
        const rad = cells.find(c => c.workOrderId === 'WOB')!;
        expect(rad.processName).toBe('Rad');
        expect(rad.catalogOrder).toBeNull();
        expect(rad.gate).toBe('active');
    });

    test('itemProcessName = TAČNO pohranjeno ime (sigurno za updateItemProcess)', () => {
        const kant = cells.find(c => c.workOrderId === 'WOA' && c.processName === 'Kantiranje')!;
        expect(kant.itemProcessName).toBe('Kantiranje');
    });

    test('crewWorkerIds iz Assigned_Workers', () => {
        expect(cells.find(c => c.workOrderId === 'WOA')!.crewWorkerIds).toContain('w1');
        expect(cells.find(c => c.workOrderId === 'WOB')!.crewWorkerIds).toContain('w2');
    });
});

describe('buildProcessCells — alias čvor koristi pohranjeno ime stavke', () => {
    // Snimljeni graf: čvor "Farbanje i lakiranje" s aliasom "Farbanje"; stavka ima proces "Farbanje".
    const orderAlias: ProcessBoardOrderInput = {
        orderLabel: 'Nalog C',
        workOrder: {
            Work_Order_ID: 'WOC', Work_Order_Type: 'Proizvodnja', Status: 'U toku',
            Process_Graph: {
                nodes: [{ id: 'n-farb', name: 'Farbanje i lakiranje', aliases: ['Farbanje i lakiranje', 'Farbanje'], itemIds: ['C1'] }],
                edges: [{ id: 'e', source: 'n-farb', target: 'n-farb' }].filter(() => false) as any,
            },
        },
        items: [item({ ID: 'C1', Product_Name: 'Klupa', Work_Order_ID: 'WOC', Processes: [{ Process_Name: 'Farbanje', Status: 'Na čekanju' }] } as any)],
    };
    test('itemProcessName je "Farbanje" (alias), ne kanonski "Farbanje i lakiranje"', () => {
        const cells = buildProcessCells([orderAlias], catalog, []);
        const c = cells.find(x => x.workOrderId === 'WOC')!;
        expect(c.processName).toBe('Farbanje i lakiranje');   // prikaz = node
        expect(c.itemProcessName).toBe('Farbanje');           // upis = pohranjeno ime
    });
});

describe('buildProcessCells — hasLoggedWork', () => {
    test('po Process_Node_ID i po imenu', () => {
        const cells = buildProcessCells([orderA], catalog, [
            { Work_Order_ID: 'WOA', Work_Order_Item_ID: 'A1', Process_Name: 'Kantiranje', Date: '2026-07-15' } as any,
        ]);
        const kant = cells.find(c => c.processName === 'Kantiranje')!;
        expect(kant.hasLoggedWork).toBe(true);
        const farb = cells.find(c => c.processName === 'Farbanje i lakiranje')!;
        expect(farb.hasLoggedWork).toBe(false);
    });
});

describe('groupByProcess — katalog redoslijed + legacy sekcija', () => {
    const groups = groupByProcess(buildProcessCells([orderA, orderB], catalog, []));
    test('redoslijed: Krojenje(6) → Kantiranje(7) → Farbanje(16) → Rad(null na kraj)', () => {
        expect(groups.map(g => g.name)).toEqual(['Krojenje Iverala', 'Kantiranje', 'Farbanje i lakiranje', 'Rad']);
    });
    test('Kantiranje red čekanja aktivan; Farbanje blokiran', () => {
        expect(groups.find(g => g.name === 'Kantiranje')!.active.length).toBe(1);
        expect(groups.find(g => g.name === 'Farbanje i lakiranje')!.blockedCount).toBe(1);
    });
});

describe('groupByOrder — fazni pipeline', () => {
    const og = groupByOrder(buildProcessCells([orderA], catalog, []));
    test('tekuća faza = kantiranje (faza 1); na redu sadrži kantiranje', () => {
        const a = og[0];
        expect(a.currentPhaseIndex).toBe(1);   // faza 0 (krojenje) gotova
        expect(a.activeCells.map(c => c.processName)).toContain('Kantiranje');
        expect(a.doneCount).toBe(1);
        expect(a.totalCount).toBe(3);
    });
});

describe('groupByWorker — majstor s nalogom + Nedodijeljeno', () => {
    test('Bego ima nalog A; ćelije bez ekipe → Nedodijeljeno', () => {
        const noCrewOrder: ProcessBoardOrderInput = {
            orderLabel: 'Nalog D',
            workOrder: { Work_Order_ID: 'WOD', Work_Order_Type: 'Proizvodnja', Status: 'U toku' },
            items: [item({ ID: 'D1', Product_Name: 'Vrata', Work_Order_ID: 'WOD', Processes: [{ Process_Name: 'Rad', Status: 'Na čekanju' }] } as any)],
        };
        const wg = groupByWorker(buildProcessCells([orderA, noCrewOrder], catalog, []), [{ Worker_ID: 'w1', Name: 'Bego' }]);
        expect(wg.find(g => g.workerName === 'Bego')?.orders.some(o => o.workOrderId === 'WOA')).toBe(true);
        expect(wg.find(g => g.workerName === 'Nedodijeljeno')?.orders.some(o => o.workOrderId === 'WOD')).toBe(true);
    });
});
