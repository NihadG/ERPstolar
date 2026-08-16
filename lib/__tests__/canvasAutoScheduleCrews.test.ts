// Ekipe od više ljudi + sabijanje rasporeda (popunjavanje rupa).
// Ključno svojstvo sabijanja: nikad ne smije pogoršati raspored.

import { autoSchedule, type AutoScheduleContext } from '../canvas/autoSchedule';
import { emptyScenario, newBlock } from '../canvas/model';
import type { PlanScenario, PlanBlock, PlanCrew, Worker, WorkOrder } from '../types';

const START = '2026-08-03';   // ponedjeljak
const noSat = () => false;    // subota ne radi → radni dani Pon–Pet

const worker = (id: string, name: string): Worker =>
    ({ Worker_ID: id, Name: name, Status: 'Aktivan' } as Worker);

/** Ekipa: glavni + proizvoljno pomoćnika (novi `members` oblik). */
const C = (id: string, lead: [string, string], ...members: [string, string][]): PlanCrew => ({
    id,
    lead: { id: lead[0], name: lead[1] },
    ...(members.length ? { members: members.map(([i, n]) => ({ id: i, name: n })) } : {}),
});

const blk = (id: string, over: Partial<PlanBlock>): PlanBlock =>
    newBlock('order', START, START, { id, ...over });

const scenarioOf = (blocks: PlanBlock[], links: PlanScenario['Links'] = []): PlanScenario =>
    ({ ...emptyScenario('org', 'T'), Blocks: blocks, Links: links });

const ctx = (over: Partial<AutoScheduleContext> = {}): AutoScheduleContext => ({
    workers: [
        worker('w1', 'Ismet'), worker('w2', 'Adnan'), worker('w3', 'Mirza'),
        worker('w4', 'Emir'), worker('w5', 'Haris'),
    ],
    workOrders: [], attendance: [], projects: [], isSaturdayWorking: noSat, ...over,
});

const run = (s: PlanScenario, c = ctx(), weights = {}) =>
    autoSchedule(s, c, { startISO: START, weights });
const one = (s: PlanScenario, id: string, c = ctx()) =>
    run(s, c).scheduled.find(x => x.blockId === id)!;

const addDay = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
};

describe('ekipe od više ljudi', () => {
    test('trajanje se dijeli s CIJELOM ekipom, ne samo s dvoje', () => {
        // 6 radnik-dana ÷ 3 čovjeka = 2 radna dana
        const s = scenarioOf([
            blk('a', { workerDays: 6, crewOptions: [C('c1', ['w1', 'Ismet'], ['w2', 'Adnan'], ['w3', 'Mirza'])] }),
        ]);
        const a = one(s, 'a');
        expect(a.crew).toBe(3);
        expect(a.workerRefs.map(r => r.id)).toEqual(['w1', 'w2', 'w3']);
        expect(a.startISO).toBe('2026-08-03');
        expect(a.endISO).toBe('2026-08-04');
    });

    test('veća ekipa se bira kad ranije završava', () => {
        const s = scenarioOf([
            blk('a', {
                workerDays: 6,
                crewOptions: [
                    C('solo', ['w1', 'Ismet']),                                    // 6 dana
                    C('trio', ['w2', 'Adnan'], ['w3', 'Mirza'], ['w4', 'Emir']),   // 2 dana
                ],
            }),
        ]);
        const a = one(s, 'a');
        expect(a.crew).toBe(3);
        expect(a.endISO).toBe('2026-08-04');
    });

    test('SVI članovi ekipe moraju biti slobodni', () => {
        // w3 zauzet stvarnim nalogom → trojka ne može odmah, solo preuzima
        const wo = {
            Work_Order_ID: 'wo1', Status: 'U toku',
            Planned_Start_Date: '2026-08-03', Due_Date: '2026-08-07',
            items: [{ Assigned_Workers: [{ Worker_ID: 'w3' }] }],
        } as unknown as WorkOrder;
        const s = scenarioOf([
            blk('a', {
                workerDays: 6,
                crewOptions: [
                    C('trio', ['w2', 'Adnan'], ['w3', 'Mirza'], ['w4', 'Emir']),
                    C('solo', ['w1', 'Ismet']),
                ],
            }),
        ]);
        const a = one(s, 'a', ctx({ workOrders: [wo] }));
        expect(a.workerRefs.map(r => r.id)).toEqual(['w1']);
    });

    test('stari `helper` oblik i dalje radi u rasporedu', () => {
        const legacy: PlanCrew = { id: 'c1', lead: { id: 'w1', name: 'Ismet' }, helper: { id: 'w2', name: 'Adnan' } };
        const s = scenarioOf([blk('a', { workerDays: 4, crewOptions: [legacy] })]);
        const a = one(s, 'a');
        expect(a.crew).toBe(2);
        expect(a.endISO).toBe('2026-08-04');    // 4 ÷ 2 = 2 radna dana
    });

    test('isti radnik u više kandidat-ekipa je dozvoljen', () => {
        const s = scenarioOf([
            blk('a', {
                workerDays: 4,
                crewOptions: [
                    C('k1', ['w1', 'Ismet'], ['w2', 'Adnan']),
                    C('k2', ['w1', 'Ismet'], ['w3', 'Mirza']),   // isti glavni, drugi pomoćnik
                ],
            }),
        ]);
        const a = one(s, 'a');
        expect(a.workerRefs[0].id).toBe('w1');
        expect(a.crew).toBe(2);
    });
});

describe('sabijanje rasporeda', () => {
    test('nalog uzima slobodnu ekipu umjesto da čeka zauzetu', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 5, crewOptions: [C('ca', ['w1', 'Ismet'])] }),
            blk('b', { workerDays: 3, crewOptions: [C('cb1', ['w1', 'Ismet']), C('cb2', ['w2', 'Adnan'])] }),
        ]);
        const b = one(s, 'b');
        expect(b.startISO).toBe(START);
        expect(b.workerRefs.map(r => r.id)).toEqual(['w2']);
    });

    test('sabijanje NIKAD ne pogorša kraj rasporeda', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 4, crewOptions: [C('c1', ['w1', 'I']), C('c2', ['w2', 'A'])] }),
            blk('b', { workerDays: 6, crewOptions: [C('c3', ['w1', 'I']), C('c4', ['w3', 'M'])] }),
            blk('c', { workerDays: 2, crewOptions: [C('c5', ['w2', 'A']), C('c6', ['w3', 'M'])] }),
        ]);
        const withC = run(s);
        const without = run(s, ctx(), { compactPasses: 0 });
        const last = (r: typeof withC) => r.scheduled.map(x => x.endISO).sort().pop()!;

        expect(last(withC) <= last(without)).toBe(true);
        expect(withC.scheduled).toHaveLength(without.scheduled.length);
        // Nijedan blok se ne izgubi ni ne duplira
        expect(new Set(withC.scheduled.map(x => x.blockId)).size).toBe(withC.scheduled.length);
    });

    test('deterministički — isti ulaz daje isti izlaz', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 4, crewOptions: [C('c1', ['w1', 'I']), C('c2', ['w2', 'A'])] }),
            blk('b', { workerDays: 3, crewOptions: [C('c3', ['w2', 'A']), C('c4', ['w3', 'M'])] }),
            blk('c', { workerDays: 5, crewOptions: [C('c5', ['w1', 'I']), C('c6', ['w3', 'M'])] }),
        ]);
        expect(JSON.stringify(run(s))).toBe(JSON.stringify(run(s)));
    });

    test('sabijanje ne gazi vezu prethodnik → nasljednik', () => {
        const s = scenarioOf(
            [
                blk('prvo', { workerDays: 5, crewOptions: [C('c1', ['w1', 'I'])] }),
                blk('drugo', { workerDays: 2, crewOptions: [C('c2', ['w2', 'A']), C('c3', ['w3', 'M'])] }),
            ],
            [{ id: 'l1', from: 'prvo', to: 'drugo', kind: 'finish-to-start' }]
        );
        const r = run(s);
        const prvo = r.scheduled.find(x => x.blockId === 'prvo')!;
        const drugo = r.scheduled.find(x => x.blockId === 'drugo')!;
        expect(drugo.startISO > prvo.endISO).toBe(true);
    });

    test('nijedan radnik nije na dva posla istog dana ni POSLIJE sabijanja', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 4, crewOptions: [C('c1', ['w1', 'I']), C('c2', ['w2', 'A'])] }),
            blk('b', { workerDays: 4, crewOptions: [C('c3', ['w1', 'I']), C('c4', ['w2', 'A'])] }),
            blk('c', { workerDays: 4, crewOptions: [C('c5', ['w1', 'I']), C('c6', ['w2', 'A'])] }),
            blk('d', { workerDays: 4, crewOptions: [C('c7', ['w1', 'I'], ['w2', 'A'])] }),
        ]);
        const r = run(s);
        const seen = new Map<string, Set<string>>();
        for (const sc of r.scheduled) {
            for (let d = sc.startISO; d <= sc.endISO; d = addDay(d)) {
                for (const ref of sc.workerRefs) {
                    const set = seen.get(ref.id!) || new Set<string>();
                    expect(set.has(d)).toBe(false);
                    set.add(d);
                    seen.set(ref.id!, set);
                }
            }
        }
    });

    test('compactPasses: 0 gasi sabijanje', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 5, crewOptions: [C('ca', ['w1', 'I'])] }),
            blk('b', { workerDays: 3, crewOptions: [C('cb', ['w1', 'I'])] }),
        ]);
        const r = run(s, ctx(), { compactPasses: 0 });
        expect(r.scheduled.every(x => !x.reasons.some(z => z.code === 'slot-compacted'))).toBe(true);
    });

    test('sabijanje poštuje odsustva iz šihtarice', () => {
        const s = scenarioOf([
            blk('a', { workerDays: 6, crewOptions: [C('ca', ['w1', 'I'])] }),
            blk('b', { workerDays: 2, crewOptions: [C('cb', ['w2', 'A'])] }),
        ]);
        const c = ctx({
            attendance: [
                { Worker_ID: 'w2', Date: '2026-08-03', Status: 'Odmor' },
                { Worker_ID: 'w2', Date: '2026-08-04', Status: 'Odmor' },
            ] as never,
        });
        const b = run(s, c).scheduled.find(x => x.blockId === 'b')!;
        expect(b.startISO).toBe('2026-08-05');   // ne smije u dane odmora
    });
});
