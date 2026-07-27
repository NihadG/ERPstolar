import { computeScenarioKpi, compareScenarios } from '../canvas/compare';
import { emptyScenario, newBlock, newLink } from '../canvas/model';
import type { ConflictContext } from '../canvas/conflicts';
import type { CapacityContext } from '../canvas/capacity';
import type { PlanScenario, PlanBlock, PlanLink, Worker } from '../types';

const TODAY = '2026-08-03';

const worker = (id: string, name: string): Worker =>
    ({ Worker_ID: id, Name: name, Role: 'Stolar', Worker_Type: 'Glavni', Status: 'Aktivan' } as Worker);

const conflictCtx: ConflictContext = {
    workers: [worker('w1', 'Ismet'), worker('w2', 'Adnan')],
    workOrders: [], attendance: [], projects: [], todayISO: TODAY,
};
const capacityCtx: CapacityContext = {
    workers: [worker('w1', 'Ismet'), worker('w2', 'Adnan')],
    workOrders: [], attendance: [],
};
const opts = { fromISO: TODAY, days: 30 };

const scenarioOf = (name: string, blocks: PlanBlock[], links: PlanLink[] = []): PlanScenario => ({
    ...emptyScenario('org', name), Blocks: blocks, Links: links,
});

const kpi = (s: PlanScenario) => computeScenarioKpi(s, conflictCtx, capacityCtx, opts);

describe('computeScenarioKpi', () => {
    test('prazan scenarij daje nule i nema zadnjeg datuma', () => {
        const k = kpi(emptyScenario('org', 'Prazan'));
        expect(k.blockCount).toBe(0);
        expect(k.conflictCount).toBe(0);
        expect(k.lastEndISO).toBeNull();
        expect(k.totalWorkerDays).toBe(0);
    });

    test('zadnji završetak je NAJKASNIJI kraj, ne zadnji dodani blok', () => {
        const k = kpi(scenarioOf('X', [
            newBlock('order', '2026-09-01', '2026-09-20', { id: 'a' }),
            newBlock('order', '2026-08-05', '2026-08-07', { id: 'b' }),
        ]));
        expect(k.lastEndISO).toBe('2026-09-20');
    });

    test('radnik-dani se broje SAMO za blokove koji troše ljude', () => {
        const k = kpi(scenarioOf('X', [
            newBlock('order', '2026-08-05', '2026-08-07', { id: 'a', workerDays: 6 }),
            newBlock('montaza', '2026-08-10', '2026-08-11', { id: 'm', workerDays: 4 }),
            // Narudžba i rok NE troše ljude
            newBlock('purchase', '2026-08-01', '2026-08-04', { id: 'n', leadDays: 3 }),
            newBlock('milestone', '2026-09-01', undefined, { id: 'v' }),
        ]));
        expect(k.totalWorkerDays).toBe(10);
    });

    test('greške se broje odvojeno od svih problema', () => {
        const s = scenarioOf('X', [
            // Materijal kasni = greška; nalog bez narudžbe = upozorenje
            newBlock('purchase', '2026-08-01', '2026-08-20', { id: 'n' }),
            newBlock('order', '2026-08-05', '2026-08-12', { id: 'p' }),
            newBlock('order', '2026-08-15', '2026-08-18', { id: 'q' }),
        ], [newLink('n', 'p', 'delivery-to-start')]);
        const k = kpi(s);
        expect(k.errorCount).toBeGreaterThan(0);
        expect(k.conflictCount).toBeGreaterThan(k.errorCount);
    });

    test('preopterećenje se mjeri protiv stvarnog kapaciteta', () => {
        // 2 radnika; 40 radnik-dana u 2 dana = daleko preko
        const k = kpi(scenarioOf('X', [
            newBlock('order', '2026-08-03', '2026-08-04', { id: 'a', workerDays: 40 }),
        ]));
        expect(k.peakCapacityRatio!).toBeGreaterThan(1);
        expect(k.overloadedDays).toBeGreaterThan(0);
    });
});

describe('compareScenarios', () => {
    const base = () => scenarioOf('Bez Novaka', [
        newBlock('order', '2026-08-05', '2026-08-07', { id: 'a', workerDays: 4 }),
    ]);
    const withMore = () => scenarioOf('S Novakom', [
        newBlock('order', '2026-08-05', '2026-08-07', { id: 'a', workerDays: 4 }),
        newBlock('order', '2026-08-05', '2026-08-06', { id: 'b', workerDays: 30 }),
    ]);

    test('nema promjene → prazna razlika i neutralno', () => {
        const rows = compareScenarios(kpi(base()), kpi(base()));
        expect(rows.every(r => r.delta === '')).toBe(true);
        expect(rows.every(r => !r.worse)).toBe(true);
    });

    test('više preopterećenih dana je GORE', () => {
        const rows = compareScenarios(kpi(base()), kpi(withMore()));
        const over = rows.find(r => r.key === 'overloadedDays')!;
        expect(over.worse).toBe(true);
        expect(over.delta.startsWith('+')).toBe(true);
    });

    test('MANJE grešaka je BOLJE (smjer se poštuje)', () => {
        const bad = scenarioOf('Loš', [
            newBlock('purchase', '2026-08-01', '2026-08-20', { id: 'n' }),
            newBlock('order', '2026-08-05', '2026-08-12', { id: 'p' }),
        ], [newLink('n', 'p', 'delivery-to-start')]);
        const good = scenarioOf('Dobar', [
            newBlock('purchase', '2026-08-01', '2026-08-04', { id: 'n' }),
            newBlock('order', '2026-08-05', '2026-08-12', { id: 'p' }),
        ], [newLink('n', 'p', 'delivery-to-start')]);

        const rows = compareScenarios(kpi(bad), kpi(good));
        const errors = rows.find(r => r.key === 'errorCount')!;
        expect(errors.worse).toBe(false);            // manje grešaka nije gore
        expect(errors.delta.startsWith('-') || errors.delta.startsWith('−')).toBe(true);
    });

    test('kasniji završetak je GORE i mjeri se u danima', () => {
        const later = scenarioOf('Kasnije', [
            newBlock('order', '2026-08-05', '2026-08-17', { id: 'a', workerDays: 4 }),
        ]);
        const row = compareScenarios(kpi(base()), kpi(later)).find(r => r.key === 'lastEndISO')!;
        expect(row.worse).toBe(true);
        expect(row.delta).toBe('+10 d');
    });

    test('VIŠE POSLA nije samo po sebi loše — to je prihod, ne problem', () => {
        const row = compareScenarios(kpi(base()), kpi(withMore())).find(r => r.key === 'totalWorkerDays')!;
        expect(row.worse).toBe(false);
        expect(row.neutral).toBe(true);
        expect(row.delta).toBe('+30');
    });

    test('vršno opterećenje bez kapaciteta (nema radnika) je neutralno, ne lažno dobro', () => {
        const noWorkers: CapacityContext = { workers: [], workOrders: [], attendance: [] };
        const a = computeScenarioKpi(base(), conflictCtx, noWorkers, opts);
        const b = computeScenarioKpi(withMore(), conflictCtx, noWorkers, opts);
        const row = compareScenarios(a, b).find(r => r.key === 'peakCapacityRatio')!;
        expect(row.neutral).toBe(true);
        expect(row.a).toBe('—');
    });
});
