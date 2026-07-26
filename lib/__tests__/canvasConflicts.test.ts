import { detectConflicts, ordersDueSoon, type ConflictContext } from '../canvas/conflicts';
import { dailyCapacity, overloadedDays, capacitySummary } from '../canvas/capacity';
import { buildSupplierLeadTimes, suggestLeadDays, MIN_LEAD_SAMPLES } from '../canvas/leadTime';
import { emptyScenario, newBlock, newLink } from '../canvas/model';
import type {
    PlanScenario, PlanBlock, PlanLink, Worker, WorkOrder, WorkerAttendance, Project, Order,
} from '../types';

const TODAY = '2026-08-03';   // ponedjeljak

const worker = (id: string, name: string): Worker =>
    ({ Worker_ID: id, Name: name, Role: 'Stolar', Worker_Type: 'Glavni', Status: 'Aktivan' } as Worker);

const scenarioOf = (blocks: PlanBlock[], links: PlanLink[] = []): PlanScenario => ({
    ...emptyScenario('org', 'T'), Blocks: blocks, Links: links,
});

const ctx = (over: Partial<ConflictContext> = {}): ConflictContext => ({
    workers: [worker('w1', 'Ismet'), worker('w2', 'Adnan')],
    workOrders: [], attendance: [], projects: [], todayISO: TODAY,
    ...over,
});

const kinds = (s: PlanScenario, c = ctx()) => detectConflicts(s, c).map(x => x.kind);

// ════════════════════════════════════════════════════════════════════
describe('materijal kasni', () => {
    test('dostava POSLIJE starta je greška', () => {
        const s = scenarioOf(
            [
                newBlock('purchase', '2026-08-01', '2026-08-10', { id: 'n', title: 'Frischeis' }),
                newBlock('order', '2026-08-05', '2026-08-12', { id: 'p', title: 'Kuhinja' }),
            ],
            [newLink('n', 'p', 'delivery-to-start')]
        );
        const c = detectConflicts(s, ctx()).find(x => x.kind === 'material-late')!;
        expect(c.severity).toBe('error');
        expect(c.message).toContain('5 dana poslije starta');
        expect(c.blockIds).toEqual(['n', 'p']);
    });

    test('dostava NA DAN starta NIJE konflikt (pola dana nije kašnjenje)', () => {
        const s = scenarioOf(
            [
                newBlock('purchase', '2026-08-01', '2026-08-05', { id: 'n' }),
                newBlock('order', '2026-08-05', '2026-08-12', { id: 'p' }),
            ],
            [newLink('n', 'p', 'delivery-to-start')]
        );
        expect(kinds(s)).not.toContain('material-late');
    });

    test('dostava dan prije starta je uredna', () => {
        const s = scenarioOf(
            [
                newBlock('purchase', '2026-08-01', '2026-08-04', { id: 'n' }),
                newBlock('order', '2026-08-05', '2026-08-12', { id: 'p' }),
            ],
            [newLink('n', 'p', 'delivery-to-start')]
        );
        expect(kinds(s)).not.toContain('material-late');
    });
});

describe('narudžba probila rok slanja', () => {
    test('rok u prošlosti je greška', () => {
        const s = scenarioOf([
            newBlock('purchase', '2026-08-10', '2026-08-16', { id: 'n', title: 'Frischeis', orderByISO: '2026-07-30' }),
        ]);
        const c = detectConflicts(s, ctx()).find(x => x.kind === 'order-overdue')!;
        expect(c.message).toContain('4 dana');
    });

    test('narudžba označena kao poslana se ne prijavljuje', () => {
        const s = scenarioOf([
            newBlock('purchase', '2026-08-10', '2026-08-16', { id: 'n', orderByISO: '2026-07-30', isSent: true }),
        ]);
        expect(kinds(s)).not.toContain('order-overdue');
    });

    test('rok danas nije probijen', () => {
        const s = scenarioOf([newBlock('purchase', '2026-08-10', '2026-08-16', { id: 'n', orderByISO: TODAY })]);
        expect(kinds(s)).not.toContain('order-overdue');
    });
});

describe('prebukiran radnik', () => {
    test('dva bloka scenarija istovremeno', () => {
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', title: 'A', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
            newBlock('order', '2026-08-05', '2026-08-10', { id: 'b', title: 'B', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]);
        const c = detectConflicts(s, ctx()).find(x => x.kind === 'worker-overbooked')!;
        expect(c.message).toContain('Ismet');
    });

    test('blokovi koji se NE preklapaju nisu konflikt', () => {
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
            newBlock('order', '2026-08-08', '2026-08-12', { id: 'b', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]);
        expect(kinds(s)).not.toContain('worker-overbooked');
    });

    test('različiti radnici u isto vrijeme nisu konflikt', () => {
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'b', workerRefs: [{ id: 'w2', name: 'Adnan' }] }),
        ]);
        expect(kinds(s)).not.toContain('worker-overbooked');
    });

    test('KLJUČNO: računa se i STVARNI preuzet nalog', () => {
        const real: WorkOrder = {
            Work_Order_ID: 'wo1', Work_Order_Number: '2026-07/R1', Name: 'Stvarni',
            Status: 'U toku', Planned_Start_Date: '2026-08-05', Due_Date: '2026-08-12',
            items: [{ ID: 'i1', Assigned_Workers: [{ Worker_ID: 'w1', Worker_Name: 'Ismet', Daily_Rate: 0 }] }],
        } as WorkOrder;
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]);
        const c = detectConflicts(s, ctx({ workOrders: [real] })).find(x => x.kind === 'worker-overbooked')!;
        expect(c.severity).toBe('error');
        expect(c.message).toContain('Stvarni');
    });

    test('završeni stvarni nalog ne blokira', () => {
        const real = {
            Work_Order_ID: 'wo1', Work_Order_Number: 'X', Status: 'Završeno',
            Planned_Start_Date: '2026-08-05', Due_Date: '2026-08-12',
            items: [{ ID: 'i1', Assigned_Workers: [{ Worker_ID: 'w1', Worker_Name: 'Ismet', Daily_Rate: 0 }] }],
        } as WorkOrder;
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]);
        expect(kinds(s, ctx({ workOrders: [real] }))).not.toContain('worker-overbooked');
    });
});

describe('radnik odsutan', () => {
    const att = (date: string, status = 'Odmor'): WorkerAttendance =>
        ({ Attendance_ID: `a${date}`, Worker_ID: 'w1', Date: date, Status: status } as WorkerAttendance);

    test('godišnji unutar raspona bloka', () => {
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', title: 'Kuhinja', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]);
        const c = detectConflicts(s, ctx({ attendance: [att('2026-08-05')] })).find(x => x.kind === 'worker-absent')!;
        expect(c.message).toContain('Ismet');
        expect(c.message).toContain('Odmor');
    });

    test('više dana se broji', () => {
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]);
        const c = detectConflicts(s, ctx({ attendance: [att('2026-08-04'), att('2026-08-05')] }))
            .find(x => x.kind === 'worker-absent')!;
        expect(c.message).toContain('2 dana');
    });

    test('odsustvo izvan raspona se ne prijavljuje', () => {
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]);
        expect(kinds(s, ctx({ attendance: [att('2026-08-20')] }))).not.toContain('worker-absent');
    });

    test('prisutnost nije odsustvo', () => {
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-07', { id: 'a', workerRefs: [{ id: 'w1', name: 'Ismet' }] }),
        ]);
        expect(kinds(s, ctx({ attendance: [att('2026-08-05', 'Prisutan')] }))).not.toContain('worker-absent');
    });
});

describe('ostala pravila', () => {
    test('montaža prije kraja proizvodnje', () => {
        const s = scenarioOf(
            [
                newBlock('order', '2026-08-03', '2026-08-20', { id: 'p', title: 'Kuhinja' }),
                newBlock('montaza', '2026-08-15', '2026-08-16', { id: 'm', title: 'Montaža' }),
            ],
            [newLink('p', 'm', 'finish-to-montaza')]
        );
        expect(kinds(s)).toContain('montaza-early');
    });

    test('probijen rok projekta', () => {
        const projects = [{ Project_ID: 'pr1', Deadline: '2026-08-10' } as Project];
        const s = scenarioOf([
            newBlock('order', '2026-08-03', '2026-08-20', { id: 'p', projectRef: { id: 'pr1', name: 'Novak' } }),
        ]);
        const c = detectConflicts(s, ctx({ projects })).find(x => x.kind === 'deadline-missed')!;
        expect(c.message).toContain('10 dana poslije roka');
    });

    test('blok koji počinje nedjeljom', () => {
        const s = scenarioOf([newBlock('order', '2026-08-09', '2026-08-12', { id: 'p' })]);
        expect(kinds(s)).toContain('nonworking-day');
    });

    test('subota je radna po defaultu', () => {
        const s = scenarioOf([newBlock('order', '2026-08-08', '2026-08-12', { id: 'p' })]);
        expect(kinds(s)).not.toContain('nonworking-day');
    });

    test('proizvodnja BEZ vezane narudžbe — najtiši propust', () => {
        const s = scenarioOf([newBlock('order', '2026-08-03', '2026-08-07', { id: 'p', title: 'Kuhinja' })]);
        const c = detectConflicts(s, ctx()).find(x => x.kind === 'orphan-production')!;
        expect(c.message).toContain('nema vezanu narudžbu');
    });

    test('proizvodnja s narudžbom nije siroče', () => {
        const s = scenarioOf(
            [
                newBlock('purchase', '2026-08-01', '2026-08-02', { id: 'n' }),
                newBlock('order', '2026-08-03', '2026-08-07', { id: 'p' }),
            ],
            [newLink('n', 'p', 'delivery-to-start')]
        );
        expect(kinds(s)).not.toContain('orphan-production');
    });

    test('greške su ispred upozorenja', () => {
        const s = scenarioOf(
            [
                newBlock('purchase', '2026-08-01', '2026-08-10', { id: 'n' }),
                newBlock('order', '2026-08-05', '2026-08-12', { id: 'p' }),
                newBlock('order', '2026-08-09', '2026-08-12', { id: 'x' }),
            ],
            [newLink('n', 'p', 'delivery-to-start')]
        );
        const list = detectConflicts(s, ctx());
        const firstWarning = list.findIndex(c => c.severity === 'warning');
        const lastError = list.map(c => c.severity).lastIndexOf('error');
        expect(lastError).toBeLessThan(firstWarning);
    });

    test('prazan scenarij nema problema', () => {
        expect(detectConflicts(emptyScenario('org'), ctx())).toEqual([]);
    });
});

describe('naruči danas', () => {
    test('narudžbe kojima rok ističe uskoro', () => {
        const s = scenarioOf([
            newBlock('purchase', '2026-08-20', '2026-08-26', { id: 'a', title: 'Skoro', orderByISO: '2026-08-05' }),
            newBlock('purchase', '2026-09-20', '2026-09-26', { id: 'b', title: 'Daleko', orderByISO: '2026-09-14' }),
            newBlock('purchase', '2026-08-01', '2026-08-07', { id: 'c', title: 'Prošlo', orderByISO: '2026-07-28' }),
        ]);
        const due = ordersDueSoon(s, TODAY);
        expect(due.map(d => d.block.id)).toEqual(['c', 'a']);   // najhitnije prvo
        expect(due[0].daysLeft).toBe(-6);
    });

    test('poslane se ne nude', () => {
        const s = scenarioOf([
            newBlock('purchase', '2026-08-20', '2026-08-26', { id: 'a', orderByISO: '2026-08-04', isSent: true }),
        ]);
        expect(ordersDueSoon(s, TODAY)).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('dnevni kapacitet', () => {
    const capCtx = { workers: [worker('w1', 'A'), worker('w2', 'B')], workOrders: [], attendance: [] };

    test('dva radnika daju 2 radnik-dana po radnom danu', () => {
        const cap = dailyCapacity(emptyScenario('org'), capCtx, '2026-08-03', 3);
        expect(cap.map(d => d.available)).toEqual([2, 2, 2]);
    });

    test('nedjelja ima 0 raspoloživih', () => {
        const cap = dailyCapacity(emptyScenario('org'), capCtx, '2026-08-09', 1);
        expect(cap[0].isWorkingDay).toBe(false);
        expect(cap[0].available).toBe(0);
    });

    test('godišnji iz šihtarice smanjuje raspoloživost', () => {
        const att = [{ Attendance_ID: 'a', Worker_ID: 'w1', Date: '2026-08-04', Status: 'Odmor' } as WorkerAttendance];
        const cap = dailyCapacity(emptyScenario('org'), { ...capCtx, attendance: att }, '2026-08-04', 1);
        expect(cap[0].available).toBe(1);
    });

    test('blok scenarija se ravnomjerno raspoređuje po RADNIM danima', () => {
        // 6 radnik-dana, pon 03.08 → sub 08.08 = 6 radnih dana → 1/dan
        const s = { ...emptyScenario('org'), Blocks: [newBlock('order', '2026-08-03', '2026-08-08', { workerDays: 6 })] };
        const cap = dailyCapacity(s, capCtx, '2026-08-03', 7);
        expect(cap[0].planned).toBe(1);
        expect(cap.find(d => d.dateISO === '2026-08-09')!.planned).toBe(0);   // nedjelja
    });

    test('KLJUČNO: stvarni preuzet nalog troši kapacitet', () => {
        const real = {
            Work_Order_ID: 'wo1', Status: 'U toku',
            Planned_Start_Date: '2026-08-03', Due_Date: '2026-08-05',
            items: [{ ID: 'i1', Planned_Labor_Days: 3, Planned_Labor_Workers: 1, Assigned_Workers: [] }],
        } as unknown as WorkOrder;
        const cap = dailyCapacity(emptyScenario('org'), { ...capCtx, workOrders: [real] }, '2026-08-03', 3);
        expect(cap[0].committed).toBe(1);
        expect(cap[0].ratio).toBe(0.5);
    });

    test('preopterećenje se prepozna', () => {
        const s = { ...emptyScenario('org'), Blocks: [newBlock('order', '2026-08-03', '2026-08-04', { workerDays: 10 })] };
        const cap = dailyCapacity(s, capCtx, '2026-08-03', 2);
        expect(overloadedDays(cap)).toHaveLength(2);
        expect(capacitySummary(cap).peakRatio!).toBeGreaterThan(1);
    });

    test('narudžbe i prekretnice NE troše ljude', () => {
        const s = {
            ...emptyScenario('org'),
            Blocks: [
                newBlock('purchase', '2026-08-03', '2026-08-10'),
                newBlock('milestone', '2026-08-03'),
            ],
        };
        expect(dailyCapacity(s, capCtx, '2026-08-03', 3).every(d => d.planned === 0)).toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════
describe('empirijski rokovi dobavljača', () => {
    const order = (id: string, supplier: string, ordered: string, received: string | null): Order =>
        ({
            Order_ID: id, Supplier_Name: supplier, Order_Date: ordered,
            items: received ? [{ ID: `${id}-1`, Received_Date: received }] : [],
        } as Order);

    test('rok se računa iz Order_Date → Received_Date', () => {
        const table = buildSupplierLeadTimes([
            order('1', 'Frischeis', '2026-07-01', '2026-07-07'),
            order('2', 'Frischeis', '2026-07-10', '2026-07-16'),
            order('3', 'Frischeis', '2026-07-20', '2026-07-25'),
        ]);
        const s = suggestLeadDays('Frischeis', table)!;
        expect(s.days).toBe(6);
        expect(s.label).toContain('n=3');
    });

    test('narudžba koja JOŠ NIJE stigla se preskače (nije podatak)', () => {
        const table = buildSupplierLeadTimes([
            order('1', 'Frischeis', '2026-07-01', '2026-07-07'),
            order('2', 'Frischeis', '2026-07-10', null),
        ]);
        expect(table.get('frischeis')!.dist.n).toBe(1);
    });

    test('ispod praga uzorka NEMA prijedloga — traži se ručni unos', () => {
        const table = buildSupplierLeadTimes([
            order('1', 'Frischeis', '2026-07-01', '2026-07-07'),
            order('2', 'Frischeis', '2026-07-10', '2026-07-16'),
        ]);
        expect(table.get('frischeis')!.dist.n).toBe(MIN_LEAD_SAMPLES - 1);
        expect(suggestLeadDays('Frischeis', table)).toBeNull();
    });

    test('medijan, ne prosjek — jedna zaboravljena narudžba ne ruši planiranje', () => {
        const table = buildSupplierLeadTimes([
            order('1', 'X', '2026-07-01', '2026-07-06'),
            order('2', 'X', '2026-07-01', '2026-07-06'),
            order('3', 'X', '2026-07-01', '2026-07-06'),
            order('4', 'X', '2026-07-01', '2026-08-30'),   // zaboravljena 60 dana
        ]);
        expect(suggestLeadDays('X', table)!.days).toBe(5);
    });

    test('nemoguć rok (negativan ili preko 180 dana) se odbacuje', () => {
        const table = buildSupplierLeadTimes([
            order('1', 'X', '2026-07-10', '2026-07-01'),   // primljeno prije narudžbe
            order('2', 'X', '2020-01-01', '2026-01-01'),   // 6 godina
        ]);
        expect(table.get('x')).toBeUndefined();
    });

    test('nepoznat dobavljač nema prijedlog', () => {
        expect(suggestLeadDays('Nepostojeci', buildSupplierLeadTimes([]))).toBeNull();
    });

    test('naziv nije osjetljiv na velika slova i razmake', () => {
        const table = buildSupplierLeadTimes([
            order('1', ' Frischeis ', '2026-07-01', '2026-07-07'),
            order('2', 'FRISCHEIS', '2026-07-10', '2026-07-16'),
            order('3', 'frischeis', '2026-07-20', '2026-07-26'),
        ]);
        expect(suggestLeadDays('Frischeis', table)!.dist.n).toBe(3);
    });
});
