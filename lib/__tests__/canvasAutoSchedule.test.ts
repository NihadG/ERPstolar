import {
    autoSchedule, schedulableBlocks, toAssignments, scheduleSummary,
    type AutoScheduleContext,
} from '../canvas/autoSchedule';
import { emptyScenario, newBlock } from '../canvas/model';
import type { PlanScenario, PlanBlock, PlanCrew, Worker, WorkOrder } from '../types';

const START = '2026-08-03';   // ponedjeljak
// Subota NE radi → radni dani su Pon–Pet; lakša ručna računica.
const noSat = () => false;

const worker = (id: string, name: string): Worker =>
    ({ Worker_ID: id, Name: name, Status: 'Aktivan' } as Worker);

const C = (id: string, leadId: string, leadName: string, helperId?: string, helperName?: string): PlanCrew =>
    ({ id, lead: { id: leadId, name: leadName }, ...(helperId ? { helper: { id: helperId, name: helperName || helperId } } : {}) });

const blk = (id: string, over: Partial<PlanBlock>): PlanBlock =>
    newBlock('order', START, START, { id, ...over });

const scenarioOf = (blocks: PlanBlock[], links: PlanScenario['Links'] = []): PlanScenario =>
    ({ ...emptyScenario('org', 'T'), Blocks: blocks, Links: links });

const ctx = (over: Partial<AutoScheduleContext> = {}): AutoScheduleContext => ({
    workers: [worker('w1', 'Ismet'), worker('w2', 'Adnan'), worker('w3', 'Mirza')],
    workOrders: [], attendance: [], projects: [], isSaturdayWorking: noSat, ...over,
});

const run = (s: PlanScenario, c = ctx()) => autoSchedule(s, c, { startISO: START });
const found = (s: PlanScenario, id: string, c = ctx()) =>
    run(s, c).scheduled.find(x => x.blockId === id);

// ════════════════════════════════════════════════════════════════════
describe('šta se uopšte raspoređuje', () => {
    test('samo order/montaza s ekipama i bez locka', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 4, crewOptions: [C('c1', 'w1', 'Ismet')] }),
            blk('b', { workerDays: 4 }),                                   // bez ekipe
            blk('c', { workerDays: 4, locked: true, crewOptions: [C('c2', 'w1', 'Ismet')] }),
            newBlock('purchase', START, '2026-08-10', { id: 'd', crewOptions: [C('c3', 'w1', 'I')] }),
        ]);
        expect(schedulableBlocks(s).map(b => b.id)).toEqual(['a']);
    });
});

describe('osnovni raspored', () => {
    test('jedan nalog, ekipa 2, 6 rd → 3 radna dana (Pon–Sri)', () => {
        const s = scenarioOf([blk('a', { workerDays: 6, crewOptions: [C('c1', 'w1', 'Ismet', 'w2', 'Adnan')] })]);
        const a = found(s, 'a')!;
        expect(a.startISO).toBe('2026-08-03');
        expect(a.endISO).toBe('2026-08-05');
        expect(a.crew).toBe(2);
        expect(a.crewId).toBe('c1');
        expect(a.workerRefs.map(w => w.name)).toEqual(['Ismet', 'Adnan']);
    });

    test('jedna kandidat-ekipa → baš ta ekipa', () => {
        const s = scenarioOf([blk('a', { workerDays: 4, crewOptions: [C('only', 'w1', 'Ismet')] })]);
        expect(found(s, 'a')!.crewId).toBe('only');
    });
});

describe('jedan radnik = jedan nalog dnevno', () => {
    test('dva naloga istog radnika se NE preklapaju', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 2, crewOptions: [C('c1', 'w1', 'Ismet')] }),
            blk('b', { workerDays: 2, crewOptions: [C('c2', 'w1', 'Ismet')] }),
        ]);
        const r = run(s);
        const a = r.scheduled.find(x => x.blockId === 'a')!;
        const b = r.scheduled.find(x => x.blockId === 'b')!;
        expect(a.startISO).toBe('2026-08-03');
        expect(a.endISO).toBe('2026-08-04');
        expect(b.startISO).toBe('2026-08-05');   // tek nakon što se a završi
    });

    test('različiti radnici na istom projektu rade PARALELNO', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 4, projectRef: { id: 'p1', name: 'P1' }, crewOptions: [C('ca', 'w1', 'Ismet')] }),
            blk('b', { workerDays: 4, projectRef: { id: 'p1', name: 'P1' }, crewOptions: [C('cb', 'w2', 'Adnan')] }),
        ]);
        const r = run(s);
        expect(r.scheduled.find(x => x.blockId === 'a')!.startISO).toBe('2026-08-03');
        expect(r.scheduled.find(x => x.blockId === 'b')!.startISO).toBe('2026-08-03');
    });
});

describe('kontinuitet radnika na projektu', () => {
    test('drži istog glavnog radnika na projektu unutar prozora, iako druga ekipa završi ranije', () => {
        const s = scenarioOf([
            // b1 fiksira w1 na projekat (jedina ekipa)
            blk('b1', { workerDays: 2, projectRef: { id: 'p1', name: 'P1' }, crewOptions: [C('c1', 'w1', 'Ismet')] }),
            // b2 ima izbor: w1 (kontinuitet, ali kasnije jer je zauzet) ili w2 (ranije, ali novi)
            blk('b2', {
                workerDays: 2, projectRef: { id: 'p1', name: 'P1' },
                crewOptions: [C('c1w1', 'w1', 'Ismet'), C('c2w2', 'w2', 'Adnan')],
            }),
        ]);
        const b2 = found(s, 'b2')!;
        // Kontinuitet (w1) pobjeđuje jer je kašnjenje unutar prozora od 3 dana.
        expect(b2.crewId).toBe('c1w1');
        expect(b2.workerRefs[0].name).toBe('Ismet');
        expect(b2.reasons.some(r => r.code === 'crew-continuity')).toBe(true);
    });
});

describe('prioritet', () => {
    test('hitan projekat ide prije običnog kad dijele radnika', () => {
        const s = scenarioOf([
            blk('lo', { workerDays: 4, priority: 'low', projectRef: { id: 'a', name: 'A' }, crewOptions: [C('c1', 'w1', 'Ismet')] }),
            blk('hi', { workerDays: 4, priority: 'urgent', projectRef: { id: 'b', name: 'B' }, crewOptions: [C('c2', 'w1', 'Ismet')] }),
        ]);
        const r = run(s);
        const hi = r.scheduled.find(x => x.blockId === 'hi')!;
        const lo = r.scheduled.find(x => x.blockId === 'lo')!;
        expect(hi.startISO).toBe('2026-08-03');       // hitan prvi
        expect(lo.startISO > hi.startISO).toBe(true); // obični čeka
    });
});

describe('precedenca (veza)', () => {
    test('montaža ne počinje prije kraja proizvodnje', () => {
        const prod = blk('prod', { workerDays: 4, crewOptions: [C('cp', 'w1', 'Ismet')] });
        const mont = newBlock('montaza', START, START, { id: 'mont', workerDays: 2, crewOptions: [C('cm', 'w2', 'Adnan')] });
        const s = scenarioOf([prod, mont], [
            { id: 'l1', from: 'prod', to: 'mont', kind: 'finish-to-montaza' },
        ]);
        const r = run(s);
        const p = r.scheduled.find(x => x.blockId === 'prod')!;
        const m = r.scheduled.find(x => x.blockId === 'mont')!;
        expect(p.endISO).toBe('2026-08-06');          // Pon–Čet (4 dana)
        expect(m.startISO > p.endISO).toBe(true);     // montaža poslije
    });
});

describe('rubni slučajevi', () => {
    test('nema slobodne ekipe u horizontu → neraspoređen uz razlog (ne tihi promašaj)', () => {
        const s = scenarioOf([blk('a', { workerDays: 6, crewOptions: [C('c1', 'w1', 'Ismet')] })]);
        const r = autoSchedule(s, ctx(), { startISO: START, weights: { horizonDays: 1 } });
        expect(r.scheduled).toHaveLength(0);
        expect(r.unscheduled).toHaveLength(1);
        expect(r.unscheduled[0].blockId).toBe('a');
        expect(r.unscheduled[0].reason).toMatch(/slobodnih dana/);
    });

    test('stvarni preuzet nalog zauzima radnika (auto planira oko njega)', () => {
        const realWO: WorkOrder = {
            Work_Order_ID: 'wo1', Status: 'U toku',
            Planned_Start_Date: '2026-08-03', Due_Date: '2026-08-07',
            items: [{ ID: 'i1', Assigned_Workers: [{ Worker_ID: 'w1', Worker_Name: 'Ismet', Daily_Rate: 0 }] }],
        } as unknown as WorkOrder;
        const s = scenarioOf([blk('a', { workerDays: 2, crewOptions: [C('c1', 'w1', 'Ismet')] })]);
        const a = found(s, 'a', ctx({ workOrders: [realWO] }))!;
        // w1 zauzet 03–07 (Pon–Pet); prvi slobodan je 10. (naredni ponedjeljak)
        expect(a.startISO).toBe('2026-08-10');
    });
});

describe('determinizam', () => {
    test('dva poziva daju identičan rezultat', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 4, projectRef: { id: 'p1', name: 'P1' }, crewOptions: [C('ca', 'w1', 'I'), C('cb', 'w2', 'A')] }),
            blk('b', { workerDays: 6, projectRef: { id: 'p2', name: 'P2' }, priority: 'high', crewOptions: [C('cc', 'w2', 'A'), C('cd', 'w3', 'M')] }),
            blk('c', { workerDays: 2, projectRef: { id: 'p1', name: 'P1' }, crewOptions: [C('ce', 'w1', 'I')] }),
        ]);
        expect(run(s)).toEqual(run(s));
    });
});

describe('pretvaranje u dodjele', () => {
    test('toAssignments mapira polja za reducer', () => {
        const s = scenarioOf([blk('a', { workerDays: 6, crewOptions: [C('c1', 'w1', 'Ismet', 'w2', 'Adnan')] })]);
        const asg = toAssignments(run(s));
        expect(asg[0]).toMatchObject({ blockId: 'a', crew: 2, assignedCrewId: 'c1' });
        expect(asg[0].workerRefs).toHaveLength(2);
    });

    test('scheduleSummary broji raspoređene i zadnji kraj', () => {
        const s = scenarioOf([blk('a', { workerDays: 4, crewOptions: [C('c1', 'w1', 'I')] })]);
        const sum = scheduleSummary(s, run(s));
        expect(sum.scheduledCount).toBe(1);
        expect(sum.unscheduledCount).toBe(0);
        expect(sum.lastEndISO).toBe('2026-08-06');
    });
});
