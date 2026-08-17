import { buildRows, groupRowsBySection, type RowContext } from '../canvas/rows';
import { emptyScenario, newBlock } from '../canvas/model';
import type { PlanScenario, PlanBlock, Worker, WorkOrder, WorkerAttendance } from '../types';

const worker = (id: string, name: string): Worker =>
    ({ Worker_ID: id, Name: name, Role: 'Stolar', Worker_Type: 'Glavni', Status: 'Aktivan' } as Worker);

const ctx = (over: Partial<RowContext> = {}): RowContext => ({
    workers: [worker('w1', 'Ismet'), worker('w2', 'Adnan')],
    workOrders: [],
    attendance: [],
    ...over,
});

const scenarioWith = (blocks: PlanBlock[]): PlanScenario => ({
    ...emptyScenario('org', 'Test'),
    Blocks: blocks,
});

describe('grupisanje je runtime pivot', () => {
    const blocks = [
        newBlock('order', '2026-08-03', '2026-08-07', {
            title: 'Kuhinja', projectRef: { id: 'p1', name: 'Novak' },
            workerRefs: [{ id: 'w1', name: 'Ismet' }],
        }),
        newBlock('order', '2026-08-10', '2026-08-14', {
            title: 'Ormar', projectRef: { id: 'p2', name: 'Begović' },
            workerRefs: [{ id: 'w2', name: 'Adnan' }],
        }),
    ];

    test('po projektu → red po projektu', () => {
        const rows = buildRows(scenarioWith(blocks), 'project', ctx());
        const nalozi = rows.filter(r => r.section === 'nalozi');
        expect(nalozi.map(r => r.label)).toEqual(['Begović', 'Novak']);
    });

    test('po radniku → red po radniku, ISTI blokovi', () => {
        const rows = buildRows(scenarioWith(blocks), 'worker', ctx());
        const nalozi = rows.filter(r => r.section === 'nalozi');
        expect(nalozi.map(r => r.label).sort()).toEqual(['Adnan', 'Ismet']);
        // Nijedan blok se nije izgubio pri promjeni pivota
        const all = new Set(nalozi.flatMap(r => r.blocks.map(b => b.id)));
        expect(all.size).toBe(2);
    });

    test('blok s DVA radnika se pojavljuje na oba reda — to je pogled, ne duplikat', () => {
        const b = newBlock('order', '2026-08-03', '2026-08-07', {
            title: 'Zajedno', workerRefs: [{ id: 'w1', name: 'Ismet' }, { id: 'w2', name: 'Adnan' }],
        });
        const rows = buildRows(scenarioWith([b]), 'worker', ctx());
        const nalozi = rows.filter(r => r.section === 'nalozi');
        expect(nalozi).toHaveLength(2);
        expect(nalozi.every(r => r.blocks[0].id === b.id)).toBe(true);
    });
});

describe('BUG STAROG PLANERA: nalog bez radnika', () => {
    test('ide u JEDAN sintetički red, ne na svaki red radnika', () => {
        const b = newBlock('order', '2026-08-03', '2026-08-07', { title: 'Neraspoređeno' });
        const rows = buildRows(scenarioWith([b]), 'worker', ctx());
        const nalozi = rows.filter(r => r.section === 'nalozi');
        expect(nalozi).toHaveLength(1);
        expect(nalozi[0].label).toBe('Nedodijeljeno');
        expect(nalozi[0].synthetic).toBe(true);
    });

    test('sintetički red ide na KRAJ liste', () => {
        const rows = buildRows(scenarioWith([
            newBlock('order', '2026-08-03', '2026-08-07', { title: 'Bez' }),
            newBlock('order', '2026-08-03', '2026-08-07', {
                title: 'Sa', projectRef: { id: 'p1', name: 'Novak' },
            }),
        ]), 'project', ctx());
        const nalozi = rows.filter(r => r.section === 'nalozi');
        expect(nalozi[nalozi.length - 1].label).toBe('Bez projekta');
    });
});

describe('sekcije', () => {
    test('obaveze (prekretnica, montaža, transport) idu u zaseban red na vrhu', () => {
        const rows = buildRows(scenarioWith([
            newBlock('order', '2026-08-03', '2026-08-07', { title: 'Nalog' }),
            newBlock('milestone', '2026-09-01', undefined, { title: 'Rok klijentu' }),
            newBlock('montaza', '2026-09-02', '2026-09-03', { title: 'Montaža' }),
            newBlock('transport', '2026-09-01', '2026-09-01', { title: 'Prevoz' }),
        ]), 'project', ctx());

        expect(rows[0].section).toBe('obaveze');
        expect(rows[0].blocks).toHaveLength(3);
        // Poredani hronološki
        expect(rows[0].blocks.map(b => b.startISO)).toEqual(['2026-09-01', '2026-09-01', '2026-09-02']);
    });

    test('bez obaveza nema praznog reda', () => {
        const rows = buildRows(scenarioWith([newBlock('order', '2026-08-03', '2026-08-07')]), 'project', ctx());
        expect(rows.some(r => r.section === 'obaveze')).toBe(false);
    });

    test('nabavka se grupiše po dobavljaču', () => {
        const rows = buildRows(scenarioWith([
            newBlock('purchase', '2026-08-01', '2026-08-07', { supplierRef: { id: 's1', name: 'Frischeis' } }),
            newBlock('purchase', '2026-08-02', '2026-08-06', { supplierRef: { id: 's1', name: 'Frischeis' } }),
            newBlock('purchase', '2026-08-03', '2026-08-05', { supplierRef: { id: 's2', name: 'Schachermayer' } }),
        ]), 'project', ctx());
        const nabavka = rows.filter(r => r.section === 'nabavka');
        expect(nabavka.map(r => r.label)).toEqual(['Frischeis', 'Schachermayer']);
        expect(nabavka[0].blocks).toHaveLength(2);
    });

    test('sekcije izlaze u fiksnom redoslijedu', () => {
        const rows = buildRows(scenarioWith([
            newBlock('purchase', '2026-08-01', '2026-08-07', { supplierRef: { name: 'X' } }),
            newBlock('milestone', '2026-09-01'),
            newBlock('order', '2026-08-03', '2026-08-07', { workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]), 'project', ctx());
        expect(groupRowsBySection(rows).map(g => g.section)).toEqual(['obaveze', 'nalozi', 'radnici', 'nabavka']);
    });
});

describe('sjene stvarnog posla (čita se, ne mijenja)', () => {
    const realWO = (over: Partial<WorkOrder> = {}): WorkOrder => ({
        Work_Order_ID: 'wo1', Organization_ID: 'org', Work_Order_Number: '2026-07/R1',
        Name: 'Stvarni nalog', Status: 'U toku',
        Planned_Start_Date: '2026-08-05', Due_Date: '2026-08-12',
        items: [{ ID: 'i1', Assigned_Workers: [{ Worker_ID: 'w1', Worker_Name: 'Ismet', Daily_Rate: 0 }] }],
        ...over,
    } as WorkOrder);

    test('stvarni nalog se pojavljuje kao sjena na redu radnika', () => {
        const rows = buildRows(
            scenarioWith([newBlock('order', '2026-08-03', '2026-08-07', { workerRefs: [{ id: 'w1', name: 'Ismet' }] })]),
            'project', ctx({ workOrders: [realWO()] })
        );
        const red = rows.find(r => r.id === 'radnik-w1')!;
        expect(red.shadows).toHaveLength(1);
        expect(red.shadows[0].kind).toBe('workorder');
        expect(red.shadows[0].hint).toContain('2026-07/R1');
    });

    test('završeni i otkazani nalozi NISU sjene (ne troše kapacitet)', () => {
        const rows = buildRows(
            scenarioWith([newBlock('order', '2026-08-03', '2026-08-07', { workerRefs: [{ id: 'w1', name: 'Ismet' }] })]),
            'project',
            ctx({ workOrders: [realWO({ Status: 'Završeno' }), realWO({ Work_Order_ID: 'wo2', Status: 'Otkazano' })] })
        );
        expect(rows.find(r => r.id === 'radnik-w1')!.shadows).toHaveLength(0);
    });

    test('odsustva iz šihtarice se spajaju u jednu traku', () => {
        const att: WorkerAttendance[] = ['2026-08-10', '2026-08-11', '2026-08-12'].map(d => ({
            Attendance_ID: `a-${d}`, Organization_ID: 'org', Worker_ID: 'w1', Date: d,
            Status: 'Odmor', Created_Date: '',
        } as WorkerAttendance));

        const rows = buildRows(
            scenarioWith([newBlock('order', '2026-08-03', '2026-08-07', { workerRefs: [{ id: 'w1', name: 'Ismet' }] })]),
            'project', ctx({ attendance: att })
        );
        const shadows = rows.find(r => r.id === 'radnik-w1')!.shadows;
        expect(shadows).toHaveLength(1);
        expect(shadows[0]).toMatchObject({ kind: 'absence', startISO: '2026-08-10', endISO: '2026-08-12' });
    });

    test('rupa u odsustvu pravi DVIJE trake', () => {
        const att: WorkerAttendance[] = ['2026-08-10', '2026-08-11', '2026-08-20'].map(d => ({
            Attendance_ID: `a-${d}`, Organization_ID: 'org', Worker_ID: 'w1', Date: d,
            Status: 'Odmor', Created_Date: '',
        } as WorkerAttendance));
        const rows = buildRows(
            scenarioWith([newBlock('order', '2026-08-03', '2026-08-07', { workerRefs: [{ id: 'w1', name: 'Ismet' }] })]),
            'project', ctx({ attendance: att })
        );
        expect(rows.find(r => r.id === 'radnik-w1')!.shadows).toHaveLength(2);
    });

    test('prisutnost nije odsustvo', () => {
        const att = [{
            Attendance_ID: 'a1', Organization_ID: 'org', Worker_ID: 'w1',
            Date: '2026-08-10', Status: 'Prisutan', Created_Date: '',
        } as WorkerAttendance];
        const rows = buildRows(
            scenarioWith([newBlock('order', '2026-08-03', '2026-08-07', { workerRefs: [{ id: 'w1', name: 'Ismet' }] })]),
            'project', ctx({ attendance: att })
        );
        expect(rows.find(r => r.id === 'radnik-w1')!.shadows).toHaveLength(0);
    });
});

describe('redovi radnika', () => {
    test('podrazumijevano samo radnici koji su u scenariju', () => {
        const rows = buildRows(
            scenarioWith([newBlock('order', '2026-08-03', '2026-08-07', { workerRefs: [{ id: 'w1', name: 'Ismet' }] })]),
            'project', ctx()
        );
        expect(rows.filter(r => r.section === 'radnici').map(r => r.label)).toEqual(['Ismet']);
    });

    test('showIdleWorkers pokazuje i slobodne (da se vidi ko je dostupan)', () => {
        const rows = buildRows(
            scenarioWith([newBlock('order', '2026-08-03', '2026-08-07', { workerRefs: [{ id: 'w1', name: 'Ismet' }] })]),
            'project', ctx({ showIdleWorkers: true })
        );
        expect(rows.filter(r => r.section === 'radnici').map(r => r.label)).toEqual(['Adnan', 'Ismet']);
    });

    test('prazan scenarij daje prazan skup redova', () => {
        expect(buildRows(emptyScenario('org'), 'project', ctx())).toEqual([]);
    });
});

// ── Layout 'rows': jedan nalog = jedan red ──────────────────────────
describe("layout 'rows' — red po nalogu", () => {
    const blocks = [
        newBlock('order', '2026-08-03', '2026-08-07', {
            id: 'o1', title: 'Kuhinja korpus', projectRef: { id: 'p1', name: 'Villa' },
            workerRefs: [{ id: 'w1', name: 'Ismet' }],
        }),
        newBlock('order', '2026-08-10', '2026-08-14', {
            id: 'o2', title: 'Kuhinja fronte', projectRef: { id: 'p1', name: 'Villa' },
        }),
        newBlock('order', '2026-08-03', '2026-08-06', {
            id: 'o3', title: 'Ograda', // bez projekta
        }),
    ];

    test('svaki nalog dobija svoj red, ime = naslov naloga', () => {
        const rows = buildRows(scenarioWith(blocks), 'project', ctx(), 'rows');
        const orderRows = rows.filter(r => r.id.startsWith('ord-'));
        expect(orderRows.map(r => r.label).sort()).toEqual(['Kuhinja fronte', 'Kuhinja korpus', 'Ograda']);
        // Svaki red nosi tačno svoj blok
        expect(orderRows.find(r => r.label === 'Kuhinja korpus')!.blocks.map(b => b.id)).toEqual(['o1']);
    });

    test('nalozi grupisani po projektu s naslovnim redom', () => {
        const rows = buildRows(scenarioWith(blocks), 'project', ctx(), 'rows');
        const headers = rows.filter(r => r.groupHeader);
        expect(headers.map(h => h.label)).toEqual(['Villa', 'Bez projekta']);
        expect(headers.find(h => h.label === 'Villa')!.groupHeader!.count).toBe(2);
    });

    test('„Bez projekta" grupa ide na kraj', () => {
        const rows = buildRows(scenarioWith(blocks), 'project', ctx(), 'rows');
        const headers = rows.filter(r => r.groupHeader);
        expect(headers[headers.length - 1].label).toBe('Bez projekta');
    });

    test('order redovi nose groupKey grupe kojoj pripadaju', () => {
        const rows = buildRows(scenarioWith(blocks), 'project', ctx(), 'rows');
        const villa = rows.filter(r => r.id.startsWith('ord-') && r.label!.startsWith('Kuhinja'));
        const key = rows.find(r => r.label === 'Villa')!.groupHeader!.key;
        expect(villa.every(r => r.groupKey === key)).toBe(true);
    });

    test('narudžba koja hrani nalog crta se u istom redu (sekundarno)', () => {
        const purchase = newBlock('purchase', '2026-08-01', '2026-08-02', { id: 'm1', title: 'Furnir' });
        const s: PlanScenario = {
            ...scenarioWith([blocks[0], purchase]),
            Links: [{ id: 'l1', from: 'm1', to: 'o1', kind: 'delivery-to-start' }] as PlanScenario['Links'],
        };
        const rows = buildRows(s, 'project', ctx(), 'rows');
        const orderRow = rows.find(r => r.id === 'ord-o1')!;
        expect(orderRow.blocks.map(b => b.id)).toEqual(['o1', 'm1']);
    });

    test('rok (milestone) ostaje u sekciji obaveze', () => {
        const milestone = newBlock('milestone', '2026-08-20', '2026-08-20', { id: 'ms', title: 'Rok' });
        const rows = buildRows(scenarioWith([blocks[0], milestone]), 'project', ctx(), 'rows');
        expect(rows.find(r => r.section === 'obaveze')!.blocks.map(b => b.id)).toEqual(['ms']);
        // Milestone NIJE dobio vlastiti order red
        expect(rows.some(r => r.id === 'ord-ms')).toBe(false);
    });

    test('radnici ostaju zasebna sekcija', () => {
        const rows = buildRows(scenarioWith(blocks), 'project', ctx(), 'rows');
        expect(rows.filter(r => r.section === 'radnici').map(r => r.label)).toContain('Ismet');
    });
});
