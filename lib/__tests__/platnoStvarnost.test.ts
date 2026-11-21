// PLATNO · FAZA 6 — plan vs stvarnost iz Knjige rada (lib/canvas/opt/reality.ts) i
// „šta ako" poređenje planova po modelu (compareModel + modelKpi). Izmišljena imena.

import type { PlanBlock, PlanScenario } from '@/lib/types';
import { planVsReality } from '@/lib/canvas/opt/reality';
import { modelKpi } from '@/lib/canvas/opt/propose';
import { compareModel } from '@/lib/canvas/compare';

const TODAY = '2026-12-09';    // srijeda
const isWork = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay() !== 0 && iso !== '2026-12-12';
const AMER = { id: 'amer', name: 'Amer Hodžić' }, EDIN = { id: 'edin', name: 'Edin Begić' };
const PAR = { id: 'c1', lead: AMER, members: [EDIN] };

function block(id: string, start: string, end: string, workerDays: number, extra: Partial<PlanBlock> = {}): PlanBlock {
    return {
        id, kind: 'order', title: `Nalog ${id}`, startISO: start, endISO: end, workerDays, crew: 2,
        projectRef: { id: 'pA', name: 'Projekat A' }, crewOptions: [PAR], workerRefs: [AMER, EDIN], ...extra,
    } as PlanBlock;
}
const scenario = (blocks: PlanBlock[]) => ({ Scenario_ID: 's', Name: 'Plan', Blocks: blocks, Links: [] } as unknown as PlanScenario);
const logs = (wo: string, dates: string[], f = 1) => dates.map(Date => ({ Work_Order_ID: wo, Date, Day_Fraction: f }));

describe('plan vs stvarnost', () => {
    const sc = scenario([
        block('kasno', '2026-11-30', '2026-12-02', 6, { linkedWorkOrderId: 'w1' }),
        block('rano', '2026-11-30', '2026-12-04', 10, { linkedWorkOrderId: 'w2' }),
        block('toku', '2026-12-07', '2026-12-10', 8, { linkedWorkOrderId: 'w3' }),
        block('preko', '2026-12-01', '2026-12-03', 4, { linkedWorkOrderId: 'w4' }),
        block('ceka', '2026-12-07', '2026-12-08', 4, { linkedWorkOrderId: 'w5' }),
        block('nacrt', '2026-12-02', '2026-12-03', 4),
        block('buduci', '2026-12-20', '2026-12-21', 4),
    ]);
    const workOrders = [
        { Work_Order_ID: 'w1', Status: 'Završeno', Completed_At: '2026-12-04T15:00:00Z' },
        { Work_Order_ID: 'w2', Status: 'Završeno', Completed_At: '2026-12-03T10:00:00Z' },
        { Work_Order_ID: 'w3', Status: 'U toku' },
        { Work_Order_ID: 'w4', Status: 'U toku' },
        { Work_Order_ID: 'w5', Status: 'Na čekanju' },
    ];
    const workLogs = [
        ...logs('w1', ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'], 2),     // 10 rd od 6
        ...logs('w2', ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'], 2),                   // 8 rd od 10
        { Work_Order_ID: 'w2', Date: '2026-12-03', Day_Fraction: 5, Work_Order_Deleted: true },
        ...logs('w3', ['2026-12-08', '2026-12-09'], 2),                                               // 4 od 8
        ...logs('w4', ['2026-12-01', '2026-12-02', '2026-12-03'], 2),                                 // 6 od 4
    ];
    const r = planVsReality({ scenario: sc, workOrders, workLogs, todayISO: TODAY, isWorkFor: () => isWork });
    const row = (id: string) => r.rows.find(x => x.blockId === id)!;

    it('završen kasnije i s više rada od plana', () => {
        expect(row('kasno')).toMatchObject({ status: 'gotov', bookedWD: 10, doneISO: '2026-12-04', endDelta: 2, late: true });
        expect(row('kasno').verdict).toBe('završen 2 dana kasnije · rad 167 % plana');
    });
    it('završen ranije, obrisani upisi se ne broje', () => {
        expect(row('rano')).toMatchObject({ status: 'gotov', bookedWD: 8, endDelta: -1, late: false });
        expect(row('rano').verdict).toBe('završen 1 dan ranije · rad 80 % plana');
    });
    it('u toku: prognoza od danas, preostali rad ekipom bloka (subota 12.12. ne radi)', () => {
        // ostalo 4 rd ÷ 2 = 2 dana: sri 9., čet 10. → u planu
        expect(row('toku')).toMatchObject({ status: 'u-toku', forecastEndISO: '2026-12-10', endDelta: 0, late: false, startDelay: 1 });
        expect(row('toku').verdict).toMatch(/u planu · ostalo 4 rd/);
    });
    it('prekoračen plan rada, nalog nije zatvoren', () => {
        expect(row('preko')).toMatchObject({ status: 'u-toku', late: true });
        expect(row('preko').verdict).toMatch(/plan rada prekoračen/);
    });
    it('pokrenut, ali bez upisa — početak kasni', () => {
        expect(row('ceka')).toMatchObject({ status: 'ceka', startDelay: 2, late: true });
    });
    it('nacrt koji je trebao početi, a nije pokrenut; budući nacrt se ne poredi', () => {
        expect(row('nacrt')).toMatchObject({ status: 'nije-pokrenut', startDelay: 7, late: true });
        expect(r.rows.find(x => x.blockId === 'buduci')).toBeUndefined();
    });
    it('sažetak: kasni prvi, tačnost procjene na završenima', () => {
        expect(r.rows.slice(0, r.late).every(x => x.late)).toBe(true);
        expect(r.late).toBe(4);
        expect(r.effortAccuracy).toBeCloseTo(18 / 16);
        expect(r.lines[1]).toMatch(/upisano 113 % planiranog — plan potcjenjuje posao/);
    });
});

describe('šta ako: poređenje planova po modelu', () => {
    const workers = ['amer', 'edin'].map(id => ({ Worker_ID: id, Saturday_Anchor: '2026-11-28' }));
    const ctx = { workers: workers as never, workOrders: [], attendance: [], projects: [], holidays: [] };
    const T = '2026-11-30';
    const a = scenario([block('x', '2026-11-30', '2026-12-01', 4)]);
    const b = scenario([block('x', '2026-11-30', '2026-12-01', 4), block('novi', '2026-12-02', '2026-12-03', 4, { priority: 'urgent' })]);

    it('novi posao pomjera dokazano najraniji kraj — to je njegova cijena', () => {
        const ka = modelKpi(a, ctx, T)!, kb = modelKpi(b, ctx, T)!;
        expect(ka).toMatchObject({ feasible: true, endISO: '2026-12-01', boundISO: '2026-12-01' });
        expect(kb).toMatchObject({ feasible: true, endISO: '2026-12-03', boundISO: '2026-12-03', urgentEndISO: '2026-12-03' });
        const rows = compareModel(ka, kb);
        expect(rows.map(r => r.key)).toEqual(['m-feasible', 'm-end', 'm-bound', 'm-urgent', 'm-late']);
        expect(rows.find(r => r.key === 'm-bound')).toMatchObject({ delta: '+2 d', worse: true });
    });
    it('sudar u kopiji se vidi kao prekršaj', () => {
        const c = scenario([block('x', '2026-11-30', '2026-12-01', 4), block('y', '2026-11-30', '2026-12-01', 4)]);
        const rows = compareModel(modelKpi(a, ctx, T), modelKpi(c, ctx, T));
        expect(rows[0]).toMatchObject({ a: 'izvodljiv', worse: true });
        expect(rows[0].b).toMatch(/prekršaja/);
    });
    it('bez modela nema redova', () => {
        expect(compareModel(null, null)).toEqual([]);
    });
});
