// PLATNO · FAZA 2 — kalendari i preostali rad: praznici (lib/holidays.ts + withHolidays),
// preostali rad stvarnih naloga (lib/canvas/opt/remaining.ts) i jedinica ½ dana u ocjeni.
// Izmišljena imena; bez Firebasea.

import type { PlanBlock, PlanScenario } from '@/lib/types';
import { addHoliday, defaultHolidays, defaultYears, effectiveHolidays, holidayDates } from '@/lib/holidays';
import { buildSaturdayChecker, isHolidayFor, withHolidays, workOrderDueDate } from '@/lib/planning';
import { isWorkDay } from '@/lib/canvas/model';
import { weekendMarksInSpan, workRuns } from '@/lib/canvas/weekend';
import { buildWorkerCalendar } from '@/lib/canvas/opt/calendar';
import { buildInstance } from '@/lib/canvas/opt/instance';
import { evaluate, placementsFromScenario, type Placement } from '@/lib/canvas/opt/evaluate';
import { remainingLines, remainingWork, type RemainingWorkOrder } from '@/lib/canvas/opt/remaining';

const MON = '2026-11-30';
const AMER = { id: 'amer', name: 'Amer Hodžić' }, EDIN = { id: 'edin', name: 'Edin Begić' };
const PAR = { id: 'c1', lead: AMER, members: [EDIN] };
// Obojica rade subotu 28.11. i 12.12., a 5.12. ne.
const workers = ['amer', 'edin'].map(id => ({ Worker_ID: id, Saturday_Anchor: '2026-11-28' }));
const calendar = buildWorkerCalendar({ workers, attendance: [] });

describe('praznici: zadana lista i unos', () => {
    const list = defaultHolidays([2026, 2027]);
    it('zadani bh. praznici za obje godine, bajrami traže potvrdu', () => {
        const dates = holidayDates(list);
        expect(dates).toEqual(expect.arrayContaining(['2026-11-25', '2026-12-25', '2027-01-01', '2027-01-02', '2027-03-01', '2027-05-01']));
        expect(list.filter(h => h.verify).map(h => h.date)).toEqual(['2026-03-20', '2026-05-27', '2027-03-09', '2027-05-16']);
        expect(dates).toEqual(dates.slice().sort());
    });
    it('godine: tekuća i sljedeća', () => {
        expect(defaultYears('2026-11-21')).toEqual([2026, 2027]);
    });
    it('sačuvana lista ima prednost; prazna vraća zadanu', () => {
        expect(effectiveHolidays([{ date: '2027-01-07', name: 'Pravoslavni Božić' }], '2026-11-21')).toEqual([{ date: '2027-01-07', name: 'Pravoslavni Božić' }]);
        expect(effectiveHolidays([], '2026-11-21')).toEqual(list);
        expect(effectiveHolidays(null, '2026-11-21')).toEqual(list);
    });
    it('dodavanje: provjera datuma, naziva i duplikata, lista ostaje sortirana', () => {
        expect(addHoliday(list, { date: '2026-13-40', name: 'X' })).toBe('Datum nije ispravan.');
        expect(addHoliday(list, { date: '2027-01-07', name: '  ' })).toBe('Upiši naziv praznika.');
        expect(addHoliday(list, { date: '2026-12-25', name: 'Božić' })).toBe('Taj dan je već praznik.');
        const next = addHoliday(list, { date: '2027-01-07', name: ' Pravoslavni Božić ' }) as { date: string; name: string }[];
        expect(next.find(h => h.date === '2027-01-07')?.name).toBe('Pravoslavni Božić');
        expect(next.map(h => h.date)).toEqual(next.map(h => h.date).slice().sort());
    });
});

describe('praznik je neradan dan u svim kalendarima', () => {
    const noSat = () => false;
    const rule = withHolidays(noSat, ['2026-12-25']);
    const d = (iso: string) => new Date(`${iso}T00:00:00`);

    it('withHolidays nosi skup praznika i ne mijenja subotnje pravilo', () => {
        expect(isHolidayFor(rule, d('2026-12-25'))).toBe(true);
        expect(isHolidayFor(rule, d('2026-12-24'))).toBe(false);
        expect(rule(d('2026-12-26'))).toBe(false);
        expect(withHolidays(() => true, [])(d('2026-12-26'))).toBe(true);
    });
    it('rok naloga preskače praznik', () => {
        expect(workOrderDueDate('2026-12-23', 3, noSat)).toBe('2026-12-25');
        expect(workOrderDueDate('2026-12-23', 3, rule)).toBe('2026-12-28');
    });
    it('rok naloga ne počinje na prazniku', () => {
        expect(workOrderDueDate('2026-12-25', 1, rule)).toBe('2026-12-28');
    });
    it('Platno: isWorkDay, prekid trake i oznaka praznika', () => {
        expect(isWorkDay('2026-12-25', rule)).toBe(false);
        expect(isWorkDay('2026-12-24', rule)).toBe(true);
        expect(workRuns('2026-12-24', '2026-12-28', rule).map(r => r.working)).toEqual([true, false, true]);
        expect(weekendMarksInSpan('2026-12-21', '2026-12-27', rule)).toContainEqual(expect.objectContaining({ iso: '2026-12-25', kind: 'holiday', working: false }));
    });
    it('buildSaturdayChecker prima praznike', () => {
        const chk = buildSaturdayChecker([], [], [], ['2026-12-25']);
        expect(isWorkDay('2026-12-25', chk)).toBe(false);
        expect(isWorkDay('2026-12-26', chk)).toBe(true);
    });
    it('kalendar radnika modela', () => {
        const c = buildWorkerCalendar({ workers, attendance: [], holidays: ['2026-12-25'] });
        expect(c.available('amer', '2026-12-25')).toBe(0);
        expect(c.available('amer', '2026-12-24')).toBe(1);
    });
});

describe('preostali rad stvarnih naloga', () => {
    const item = (id: string, extra: Record<string, unknown> = {}) => ({
        ID: id, Status: 'U toku', Quantity: 1, Planned_Labor_Days: 0, Planned_Labor_Workers: 1,
        Assigned_Workers: [{ Worker_ID: 'amer' }, { Worker_ID: 'edin' }], ...extra,
    });
    const wo = (id: string, started: string, items: ReturnType<typeof item>[], extra: Partial<RemainingWorkOrder> = {}): RemainingWorkOrder =>
        ({ Work_Order_ID: id, Work_Order_Number: `2026-11/${id}`, Name: `Nalog ${id}`, Status: 'U toku', Started_At: started, items, ...extra });

    const orders: RemainingWorkOrder[] = [
        // 2 dana/kom × 2 kom × 2 radnika = 8 rd; upisano 3 (obrisani nalog se ne broji) → ostalo 5
        wo('A', '2026-11-02', [item('a1', { Planned_Labor_Days: 2, Quantity: 2, Planned_Labor_Workers: 2 }), item('a2', { Status: 'Završeno', Planned_Labor_Days: 9 })]),
        // samo Amer, 1,5 rd, kreće poslije A
        wo('B', '2026-11-10', [item('b1', { Planned_Labor_Days: 1.5, Assigned_Workers: [{ Worker_ID: 'amer' }] })]),
        wo('C', '2026-11-03', [item('c1')], { Due_Date: '2026-12-31' }),
        wo('D', '2026-11-04', [item('d1', { Planned_Labor_Days: 1 })]),
        wo('E', '2026-11-05', [item('e1', { Planned_Labor_Days: 4 })], { Status: 'Završeno' }),
        wo('F', '2026-11-06', [item('f1', { Planned_Labor_Days: 4 })]),
    ];
    const workLogs = [
        { Work_Order_Item_ID: 'a1', Day_Fraction: 1 }, { Work_Order_Item_ID: 'a1', Day_Fraction: 2 },
        { Work_Order_Item_ID: 'a1', Day_Fraction: 5, Work_Order_Deleted: true },
        { Work_Order_Item_ID: 'd1', Day_Fraction: 1.5 },
    ];
    const r = remainingWork({ workOrders: orders, workLogs, calendar, startISO: MON, skipWorkOrderIds: ['F'] });
    const row = (id: string) => r.orders.find(o => o.workOrderId === id)!;

    it('plan − upisano po otvorenoj stavci; završena stavka, završen i povezan nalog ne ulaze', () => {
        expect(row('A')).toMatchObject({ planned: 8, booked: 3, remaining: 5, source: 'plan', untilISO: '2026-12-02', workerIds: ['amer', 'edin'] });
        expect(r.orders.map(o => o.workOrderId)).toEqual(['A', 'C', 'D', 'B']);
    });
    it('ostatak se slaže od danas, stariji nalog prvi, koliko ko ima slobodno', () => {
        expect([r.fixedLoad('amer', MON), r.fixedLoad('edin', MON)]).toEqual([1, 1]);
        expect([r.fixedLoad('amer', '2026-12-02'), r.fixedLoad('edin', '2026-12-02')]).toEqual([1, 0]);
        // B (samo Amer): 2.12. je pun od A → 3.12. cijeli, 4.12. pola
        expect(row('B')).toMatchObject({ remaining: 1.5, untilISO: '2026-12-04' });
        expect(r.fixedLoad('amer', '2026-12-03')).toBe(1);
        expect(r.fixedLoad('amer', '2026-12-04')).toBe(0.5);
        expect(r.fixedLoad('amer', '2026-12-07')).toBe(0);
    });
    it('bez plana dana: ne zauzima ni do roka; prekoračen: ne zauzima, ali se prijavljuje', () => {
        expect(row('C')).toMatchObject({ source: 'bez-plana', remaining: 0 });
        expect(row('D')).toMatchObject({ source: 'prekoracen', planned: 1, booked: 1.5 });
        const lines = remainingLines(r.orders);
        expect(lines[1]).toMatch(/bez plana dana — ne zauzima/);
        expect(lines[2]).toMatch(/prekoračen/);
    });
    it('neradni dan ne nosi preostali rad', () => {
        const rr = remainingWork({ workOrders: [wo('S', '2026-11-01', [item('s1', { Planned_Labor_Days: 4, Assigned_Workers: [{ Worker_ID: 'amer' }] })])], calendar, startISO: '2026-12-03' });
        // čet 3., pet 4., sub 5. ne radi, ned 6. → pon 7., uto 8.
        expect(rr.orders[0].untilISO).toBe('2026-12-08');
        expect(rr.fixedLoad('amer', '2026-12-05')).toBe(0);
    });
    it('stavka čiji proizvod plan već nosi kao blok se ne broji (nema duplog rada)', () => {
        const w = wo('P', '2026-11-01', [item('p1', { Product_ID: 'prod-1', Planned_Labor_Days: 3 }), item('p2', { Product_ID: 'prod-2', Planned_Labor_Days: 1 })]);
        const rr = remainingWork({ workOrders: [w], calendar, startISO: MON, skipProductIds: ['prod-1'] });
        expect(rr.orders[0]).toMatchObject({ planned: 1, remaining: 1 });
    });

    it('bez Knjige rada čita Actual_Labor_Days stavke', () => {
        const rr = remainingWork({ workOrders: [wo('G', '2026-11-01', [item('g1', { Planned_Labor_Days: 3, Actual_Labor_Days: 2 })])], calendar, startISO: MON });
        expect(rr.orders[0]).toMatchObject({ booked: 2, remaining: 1 });
    });
    it('model: radnik zauzet stvarnim nalogom ne može dati taj dan planu', () => {
        const blocks = [{ id: 'x', kind: 'order', title: 'Nalog x', startISO: MON, endISO: '2026-12-01', workerDays: 4, crew: 2, crewOptions: [PAR], workerRefs: [AMER, EDIN] } as PlanBlock];
        const sc = { Blocks: blocks, Links: [] } as unknown as PlanScenario;
        const free = buildInstance(sc, { startISO: MON, calendar });
        expect(evaluate(free, placementsFromScenario(free, blocks)).objective.violation).toBe(0);
        const busy = buildInstance(sc, { startISO: MON, calendar, fixedLoad: r.fixedLoad });
        expect(evaluate(busy, placementsFromScenario(busy, blocks)).violations.map(v => v.kind)).toContain('too-short');
    });
});

describe('jedinica ½ dana', () => {
    // a: 3 rd para = 1,5 dana; b: 3 rd = 1,5 dana; dijele utorak 1.12.
    const blocks = (half: boolean) => [
        { id: 'a', kind: 'order', title: 'Nalog a', startISO: MON, endISO: '2026-12-01', workerDays: 3, crew: 2, crewOptions: [PAR], workerRefs: [AMER, EDIN], ...(half ? { endsAM: true } : {}) },
        { id: 'b', kind: 'order', title: 'Nalog b', startISO: '2026-12-01', endISO: '2026-12-02', workerDays: 3, crew: 2, crewOptions: [PAR], workerRefs: [AMER, EDIN], ...(half ? { startsPM: true } : {}) },
    ] as PlanBlock[];
    const run = (half: boolean) => {
        const sc = { Blocks: blocks(half), Links: [] } as unknown as PlanScenario;
        const inst = buildInstance(sc, { startISO: MON, calendar });
        return evaluate(inst, placementsFromScenario(inst, sc.Blocks));
    };
    it('bez oznaka: dva bloka u istom danu prekoračuju kapacitet', () => {
        expect(run(false).violations.filter(v => v.kind === 'overload').map(v => v.dateISO)).toEqual(['2026-12-01', '2026-12-01']);
    });
    it('a do podne, b od podne: dan se dijeli bez prekoračenja', () => {
        expect(run(true).violations).toEqual([]);
    });
    it('pola dana je i gornja granica: posao koji ne stane javlja prekratak raspon', () => {
        const sc = { Blocks: [{ ...blocks(true)[0], workerDays: 4 }], Links: [] } as unknown as PlanScenario;
        const inst = buildInstance(sc, { startISO: MON, calendar });
        const v = evaluate(inst, placementsFromScenario(inst, sc.Blocks)).violations;
        expect(v).toEqual([expect.objectContaining({ kind: 'too-short', amount: 0.5 })]);
    });
    it('placementsFromScenario prenosi oznake', () => {
        const sc = { Blocks: blocks(true), Links: [] } as unknown as PlanScenario;
        const inst = buildInstance(sc, { startISO: MON, calendar });
        const p: Placement[] = placementsFromScenario(inst, sc.Blocks);
        expect(p.map(x => [x.endsAM, x.startsPM])).toEqual([[true, undefined], [undefined, true]]);
    });
});
