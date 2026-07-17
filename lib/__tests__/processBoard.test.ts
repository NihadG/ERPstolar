import {
    buildProcessCells, buildProcessTasks, groupByOrder, groupByProcess,
    isOrderPaused, sortOrdersForBoard, isPlaceholderOnlyItem,
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

// Nalog B: jedan STVARAN proces van kataloga ("Poliranje") — aktivan odmah, sortira se na kraj.
// (Ranije je ovdje stajao generički "Rad"; on se sada ignoriše kao odsutnost plana — vidi dolje.)
const orderB: ProcessBoardOrderInput = {
    orderLabel: 'Nalog B',
    workOrder: { Work_Order_ID: 'WOB', Work_Order_Type: 'Proizvodnja', Status: 'U toku', Color_Code: '#34c759' },
    items: [item({
        ID: 'B1', Product_Name: 'Sto', Work_Order_ID: 'WOB',
        Assigned_Workers: [{ Worker_ID: 'w2', Worker_Name: 'Braco', Daily_Rate: 120 }],
        Processes: [{ Process_Name: 'Poliranje', Status: 'Na čekanju', Worker_ID: 'w2', Worker_Name: 'Braco' }],
    } as any)],
};

// Nalog RAD: legacy stavka kojoj je stari wizard upisao generički "Rad" (= nema plana).
const orderRad: ProcessBoardOrderInput = {
    orderLabel: 'Nalog Rad',
    workOrder: { Work_Order_ID: 'WOB', Work_Order_Type: 'Proizvodnja', Status: 'U toku' },
    items: [item({
        ID: 'B1', Product_Name: 'Sto', Work_Order_ID: 'WOB',
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

    test('proces van kataloga → catalogOrder null, odmah aktivan', () => {
        const pol = cells.find(c => c.workOrderId === 'WOB')!;
        expect(pol.processName).toBe('Poliranje');
        expect(pol.catalogOrder).toBeNull();
        expect(pol.gate).toBe('active');
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
    test('redoslijed: Krojenje(6) → Kantiranje(7) → Farbanje(16) → Poliranje(null na kraj)', () => {
        expect(groups.map(g => g.name)).toEqual(['Krojenje Iverala', 'Kantiranje', 'Farbanje i lakiranje', 'Poliranje']);
    });
    test('Kantiranje red čekanja aktivan; Farbanje blokiran', () => {
        expect(groups.find(g => g.name === 'Kantiranje')!.activeCount).toBe(1);
        expect(groups.find(g => g.name === 'Farbanje i lakiranje')!.blockedCount).toBe(1);
    });
});

// ISTI PROCES × VIŠE PROIZVODA = JEDAN ZADATAK (jedan klik, ne N klikova).
// Nalog E: 3 proizvoda dijele "Priprema masive" — realan slučaj iz proizvodnje.
const orderE: ProcessBoardOrderInput = {
    orderLabel: 'Umivaonici',
    workOrder: { Work_Order_ID: 'WOE', Work_Order_Type: 'Proizvodnja', Status: 'U toku' },
    items: ['Poz 1', 'Poz 3', 'Poz 5'].map((nm, i) => item({
        ID: `E${i + 1}`, Product_Name: nm, Work_Order_ID: 'WOE',
        Process_Stages: [{ processes: ['Krojenje Iverala'] }, { processes: ['Kantiranje'] }],
        Processes: [
            { Process_Name: 'Krojenje Iverala', Status: i === 0 ? 'Završeno' : 'Na čekanju', Worker_Name: i === 0 ? 'Bego' : undefined },
            { Process_Name: 'Kantiranje', Status: 'Na čekanju' },
        ],
    } as any)),
};

describe('buildProcessTasks — agregat nalog×proces', () => {
    const tasks = buildProcessTasks(buildProcessCells([orderE], catalog, []));

    test('3 proizvoda × 2 procesa → 2 zadatka (ne 6 ćelija za klikanje)', () => {
        expect(tasks.length).toBe(2);
        expect(tasks.map(t => t.processName)).toEqual(['Krojenje Iverala', 'Kantiranje']);
    });

    test('zadatak nosi sve svoje ćelije + nazive proizvoda', () => {
        const kroj = tasks.find(t => t.processName === 'Krojenje Iverala')!;
        expect(kroj.totalCount).toBe(3);
        expect(kroj.cells.length).toBe(3);
        expect(kroj.itemNames).toEqual(['Poz 1', 'Poz 3', 'Poz 5']);
    });

    test('djelimično završen proces → status Djelimično (1/3), pamti ko je završio', () => {
        const kroj = tasks.find(t => t.processName === 'Krojenje Iverala')!;
        expect(kroj.status).toBe('Djelimično');
        expect(kroj.doneCount).toBe(1);
        expect(kroj.workerNames).toEqual(['Bego']);
    });

    test('zadatak je Završeno tek kad su SVI proizvodi gotovi', () => {
        const allDone: ProcessBoardOrderInput = {
            ...orderE,
            items: orderE.items.map(it => ({
                ...it, Processes: (it.Processes || []).map(p => ({ ...p, Status: 'Završeno' })),
            })) as any,
        };
        const t = buildProcessTasks(buildProcessCells([allDone], catalog, []));
        expect(t.find(x => x.processName === 'Krojenje Iverala')!.status).toBe('Završeno');
    });

    test('redoslijed toka: faza → katalog', () => {
        expect(tasks.map(t => t.phaseIndex)).toEqual([0, 1]);
    });
});

describe('groupByOrder — svi procesi naloga, brojanje po procesima', () => {
    test('nalog A: 3 procesa (1 gotov), na redu = kantiranje', () => {
        const a = groupByOrder(buildProcessCells([orderA], catalog, []))[0];
        expect(a.tasks.map(t => t.processName)).toEqual(['Krojenje Iverala', 'Kantiranje', 'Farbanje i lakiranje']);
        expect(a.doneCount).toBe(1);
        expect(a.totalCount).toBe(3);
        expect(a.activeCount).toBe(1);
        expect(a.productCount).toBe(1);
    });

    test('nalog s 3 proizvoda broji PROCESE (2), ne ćelije (6)', () => {
        const e = groupByOrder(buildProcessCells([orderE], catalog, []))[0];
        expect(e.totalCount).toBe(2);
        expect(e.productCount).toBe(3);
        expect(e.doneCount).toBe(0);   // krojenje je tek 1/3 → nije završen proces
    });

    test('blokirani procesi su i dalje u listi (vidi se CIJELI tok)', () => {
        const a = groupByOrder(buildProcessCells([orderA], catalog, []))[0];
        expect(a.tasks.find(t => t.processName === 'Farbanje i lakiranje')!.gate).toBe('blocked');
    });
});

// ════════════════════════════════════════════════════════════════════
// PRIORITET NALOGA: danas se radi → najsvježiji; pauzirani ispod; završeni van opsega.
// ════════════════════════════════════════════════════════════════════
const rankOrder = (id: string, opts: { status?: string; created: string; paused?: boolean; itemStatus?: string } ) => ({
    workOrder: { Work_Order_ID: id, Status: opts.status || 'U toku', Created_Date: opts.created },
    items: [{ Status: opts.itemStatus || 'U toku', Is_Paused: !!opts.paused }],
});

describe('isOrderPaused — isto pravilo kao dugme Pauza u kartici naloga', () => {
    test('sve otvorene stavke pauzirane → nalog pauziran', () => {
        expect(isOrderPaused([{ Status: 'U toku', Is_Paused: true }, { Status: 'U toku', Is_Paused: true }])).toBe(true);
    });
    test('bar jedna otvorena radi → nalog NIJE pauziran', () => {
        expect(isOrderPaused([{ Status: 'U toku', Is_Paused: true }, { Status: 'U toku', Is_Paused: false }])).toBe(false);
    });
    test('završene stavke se ne broje — pauza se gleda samo po otvorenim', () => {
        expect(isOrderPaused([{ Status: 'Završeno', Is_Paused: false }, { Status: 'U toku', Is_Paused: true }])).toBe(true);
    });
    test('nema otvorenih stavki → nije pauziran (nema šta da stoji)', () => {
        expect(isOrderPaused([{ Status: 'Završeno', Is_Paused: false }])).toBe(false);
        expect(isOrderPaused([])).toBe(false);
    });
});

describe('sortOrdersForBoard — u toku → pauzirani → na čekanju', () => {
    test('najnoviji prvi kad se ni na jednom danas ne radi', () => {
        const out = sortOrdersForBoard([
            rankOrder('stari', { created: '2026-07-01T08:00:00.000Z' }),
            rankOrder('novi', { created: '2026-07-16T08:00:00.000Z' }),
            rankOrder('srednji', { created: '2026-07-10T08:00:00.000Z' }),
        ], new Set());
        expect(out.map(o => o.workOrder.Work_Order_ID)).toEqual(['novi', 'srednji', 'stari']);
    });

    test('DANAŠNJI rad pretiče svježinu — stari nalog na kojem se danas radi ide na vrh', () => {
        const out = sortOrdersForBoard([
            rankOrder('novi', { created: '2026-07-16T08:00:00.000Z' }),
            rankOrder('stari-ali-danas', { created: '2026-07-01T08:00:00.000Z' }),
        ], new Set(['stari-ali-danas']));
        expect(out.map(o => o.workOrder.Work_Order_ID)).toEqual(['stari-ali-danas', 'novi']);
    });

    test('pauzirani padaju ispod svih aktivnih — čak i ako se danas knjižilo', () => {
        const out = sortOrdersForBoard([
            rankOrder('pauza-danas', { created: '2026-07-16T08:00:00.000Z', paused: true }),
            rankOrder('aktivan-star', { created: '2026-07-01T08:00:00.000Z' }),
        ], new Set(['pauza-danas']));
        expect(out.map(o => o.workOrder.Work_Order_ID)).toEqual(['aktivan-star', 'pauza-danas']);
    });

    test('„Na čekanju" ide na dno (ispod pauziranih)', () => {
        const out = sortOrdersForBoard([
            rankOrder('cekanje', { status: 'Na čekanju', created: '2026-07-16T08:00:00.000Z', itemStatus: 'Na čekanju' }),
            rankOrder('pauziran', { created: '2026-07-02T08:00:00.000Z', paused: true }),
            rankOrder('utoku', { created: '2026-07-01T08:00:00.000Z' }),
        ], new Set());
        expect(out.map(o => o.workOrder.Work_Order_ID)).toEqual(['utoku', 'pauziran', 'cekanje']);
    });

    test('ne mutira ulaz i stabilan je za identične naloge', () => {
        const input = [rankOrder('a', { created: '2026-07-01T08:00:00.000Z' }), rankOrder('b', { created: '2026-07-01T08:00:00.000Z' })];
        const out = sortOrdersForBoard(input, new Set());
        expect(out.map(o => o.workOrder.Work_Order_ID)).toEqual(['a', 'b']);
        expect(input.map(o => o.workOrder.Work_Order_ID)).toEqual(['a', 'b']);
    });

    test('nalog bez Created_Date ne ruši sort (ide iza onih koji ga imaju)', () => {
        const out = sortOrdersForBoard([
            { workOrder: { Work_Order_ID: 'bez', Status: 'U toku' }, items: [{ Status: 'U toku' }] },
            rankOrder('sa', { created: '2026-07-01T08:00:00.000Z' }),
        ], new Set());
        expect(out.map(o => o.workOrder.Work_Order_ID)).toEqual(['sa', 'bez']);
    });
});

// ════════════════════════════════════════════════════════════════════
// GENERIČKI „Rad" = odsutnost plana, ne proces. Stari wizard ga je upisivao
// proizvodu bez plana; tabla ga mora ignorisati (korisnik: „ne želim ga vidjeti nikako").
// ════════════════════════════════════════════════════════════════════
const catalogKeys = new Set(catalog.map(c => c.Name.trim().toLowerCase()));

describe('isPlaceholderOnlyItem — usko pravilo, da ne pojede stvaran rad', () => {
    test('jedini proces „Rad" i nije u katalogu → placeholder', () => {
        expect(isPlaceholderOnlyItem({ Processes: [{ Process_Name: 'Rad' }] }, catalogKeys)).toBe(true);
    });
    test('case/razmaci ne varaju', () => {
        expect(isPlaceholderOnlyItem({ Processes: [{ Process_Name: '  rAd ' }] }, catalogKeys)).toBe(true);
    });
    test('„Rad" uz stvarne procese NIJE placeholder (neko ga je namjerno dodao)', () => {
        expect(isPlaceholderOnlyItem({ Processes: [{ Process_Name: 'Rad' }, { Process_Name: 'Kantiranje' }] }, catalogKeys)).toBe(false);
    });
    test('„Rad" IZ KATALOGA je legitiman proces → nije placeholder', () => {
        expect(isPlaceholderOnlyItem({ Processes: [{ Process_Name: 'Rad' }] }, new Set([...Array.from(catalogKeys), 'rad']))).toBe(false);
    });
    test('jedini proces koji nije „Rad" → nije placeholder', () => {
        expect(isPlaceholderOnlyItem({ Processes: [{ Process_Name: 'Kantiranje' }] }, catalogKeys)).toBe(false);
    });
    test('stavka bez procesa → nije placeholder (nema šta ignorisati)', () => {
        expect(isPlaceholderOnlyItem({ Processes: [] }, catalogKeys)).toBe(false);
        expect(isPlaceholderOnlyItem({}, catalogKeys)).toBe(false);
    });
});

describe('buildProcessCells — nalog s generičkim „Rad" ne daje ćelije', () => {
    test('nalog sa samo „Rad" nestaje s table → pada u „Bez definisanih procesa"', () => {
        const cells = buildProcessCells([orderA, orderRad], catalog, []);
        expect(cells.some(c => c.workOrderId === 'WOB')).toBe(false);
        expect(cells.some(c => c.processName === 'Rad')).toBe(false);
        expect(cells.some(c => c.workOrderId === 'WOA')).toBe(true);   // stvarni plan ostaje netaknut
    });

    test('„Rad" NE nestaje ako je u katalogu (korisnik ga je proglasio procesom)', () => {
        const withRad = [...catalog, { Name: 'Rad', Order: 99 }];
        const cells = buildProcessCells([orderRad], withRad, []);
        expect(cells.some(c => c.processName === 'Rad')).toBe(true);
    });

    test('mješovit nalog: placeholder stavka ispada, stavka s planom ostaje', () => {
        const mixed: ProcessBoardOrderInput = {
            orderLabel: 'Nalog M',
            workOrder: { Work_Order_ID: 'WOM', Work_Order_Type: 'Proizvodnja', Status: 'U toku' },
            items: [
                item({ ID: 'M1', Product_Name: 'Bez plana', Work_Order_ID: 'WOM', Processes: [{ Process_Name: 'Rad', Status: 'Na čekanju' }] } as any),
                item({
                    ID: 'M2', Product_Name: 'S planom', Work_Order_ID: 'WOM',
                    Process_Stages: [{ processes: ['Kantiranje'] }],
                    Processes: [{ Process_Name: 'Kantiranje', Status: 'Na čekanju' }],
                } as any),
            ],
        };
        const cells = buildProcessCells([mixed], catalog, []);
        expect(cells.map(c => c.itemName)).toEqual(['S planom']);
    });

    test('čvor „Rad" u SNIMLJENOM grafu ne uskrsava red ako je stavka placeholder', () => {
        const savedRad: ProcessBoardOrderInput = {
            orderLabel: 'Nalog R',
            workOrder: {
                Work_Order_ID: 'WOR', Work_Order_Type: 'Proizvodnja', Status: 'U toku',
                Process_Graph: { nodes: [{ id: 'n-rad', name: 'Rad', itemIds: ['R1'] }], edges: [] },
            },
            items: [item({ ID: 'R1', Product_Name: 'Sto', Work_Order_ID: 'WOR', Processes: [{ Process_Name: 'Rad', Status: 'Na čekanju' }] } as any)],
        };
        expect(buildProcessCells([savedRad], catalog, [])).toEqual([]);
    });
});
