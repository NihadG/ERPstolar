// PLATNO · FAZA 3 — optimizator v2: serijski SGS s polovinama dana (sgs.ts), lokalna
// pretraga po leksikografskom cilju (optimize.ts), rezerva i prijedlog za modal (propose.ts).
// Izmišljena imena; fixture je anonimizovan stvaran plan (41 nalog, 7 parova).

import fs from 'fs';
import path from 'path';
import type { PlanBlock, PlanScenario } from '@/lib/types';
import { buildWorkerCalendar } from '@/lib/canvas/opt/calendar';
import { buildInstance, isoAt } from '@/lib/canvas/opt/instance';
import { compareObjectives, evaluate, placementsFromScenario } from '@/lib/canvas/opt/evaluate';
import { lowerBounds } from '@/lib/canvas/opt/bounds';
import { Decoder } from '@/lib/canvas/opt/sgs';
import { optimize, optimizeAsync, slackOf } from '@/lib/canvas/opt/optimize';
import { movableBlockIds, proposeSchedule } from '@/lib/canvas/opt/propose';
import { toAssignments } from '@/lib/canvas/autoSchedule';
import { initialState, scenarioReducer } from '@/lib/canvas/scenarioReducer';

const MON = '2026-11-30';
const ref = (id: string, name: string) => ({ id, name });
const AMER = ref('amer', 'Amer Hodžić'), EDIN = ref('edin', 'Edin Begić'), HASO = ref('haso', 'Haso Mujić'), TARIK = ref('tarik', 'Tarik Zukić');
const PAR1 = { id: 'c1', lead: AMER, members: [EDIN] };
const PAR2 = { id: 'c2', lead: HASO, members: [TARIK] };
const workers = ['amer', 'edin', 'haso', 'tarik'].map(id => ({ Worker_ID: id, Saturday_Anchor: '2026-11-28' }));
const calendar = buildWorkerCalendar({ workers, attendance: [] });

function block(id: string, workerDays: number, extra: Partial<PlanBlock> = {}): PlanBlock {
    return {
        id, kind: 'order', title: `Nalog ${id}`, startISO: MON, endISO: MON, workerDays, crew: 2,
        projectRef: { id: 'pA', name: 'Projekat A' }, crewOptions: [PAR1], workerRefs: [AMER, EDIN], ...extra,
    } as PlanBlock;
}
const scenario = (blocks: PlanBlock[], links: PlanScenario['Links'] = []) => ({ Blocks: blocks, Links: links } as unknown as PlanScenario);

function solve(sc: PlanScenario, opts: { fixedLoad?: (w: string, iso: string) => number; budget?: number } = {}) {
    const inst = buildInstance(sc, { startISO: MON, calendar, fixedLoad: opts.fixedLoad });
    const current = placementsFromScenario(inst, sc.Blocks);
    const res = optimize(inst, current, movableBlockIds(sc), { budget: opts.budget });
    const at = (id: string) => res.placements.find(p => p.jobId === id)!;
    return { inst, res, at };
}

describe('dekoder (serijski SGS)', () => {
    it('dva posla para od po 1,5 dana dijele utorak: a do podne, b od podne', () => {
        const { res, at } = solve(scenario([block('a', 3), block('b', 3, { priority: 'low' })]));
        expect(at('a')).toMatchObject({ startISO: MON, endISO: '2026-12-01', endsAM: true });
        expect(at('b')).toMatchObject({ startISO: '2026-12-01', endISO: '2026-12-02', startsPM: true });
        expect(res.evaluation.violations).toEqual([]);
        expect(res.evaluation.makespanISO).toBe('2026-12-02');
    });

    it('veza: nasljednik počinje dan poslije kraja prethodnika (+ razmak)', () => {
        const sc = scenario([block('a', 4), block('b', 2, { crewOptions: [PAR2], workerRefs: [HASO, TARIK] })], [{ id: 'l', from: 'a', to: 'b', kind: 'finish-to-start', lagDays: 1 }]);
        const { at, res } = solve(sc);
        expect(at('a').endISO).toBe('2026-12-01');
        expect(at('b').startISO).toBe('2026-12-03');
        expect(res.decoded.info.get('b')?.binding).toMatchObject({ kind: 'precedence', jobId: 'a' });
    });

    it('najraniji početak iz narudžbe materijala', () => {
        const buy = { id: 'm', kind: 'purchase', title: 'Ploče', startISO: MON, endISO: '2026-12-02' } as PlanBlock;
        const { at } = solve(scenario([buy, block('a', 2)], [{ id: 'l', from: 'm', to: 'a', kind: 'delivery-to-start' }]));
        expect(at('a').startISO).toBe('2026-12-03');
    });

    it('zaključan blok ostaje gdje je i zauzima svoje radnike', () => {
        const locked = block('z', 4, { locked: true, startISO: MON, endISO: '2026-12-01' });
        const { at, res } = solve(scenario([locked, block('a', 2)]));
        expect(at('z')).toMatchObject({ startISO: MON, endISO: '2026-12-01' });
        expect(at('a').startISO).toBe('2026-12-02');
        expect(res.decoded.info.get('a')?.binding).toMatchObject({ kind: 'crew', jobId: 'z' });
    });

    it('stvarni nalog (fixedLoad) gura posao iza sebe; pola dana zauzetosti se ne dijeli', () => {
        const busy = (w: string, iso: string) => (w === 'amer' && iso === MON ? 1 : w === 'amer' && iso === '2026-12-01' ? 0.5 : 0);
        const { at, res } = solve(scenario([block('a', 2)]), { fixedLoad: busy });
        // 1.12. Amer ima pola dana: dan s djelimičnim kapacitetom daje 0,5 i ne dijeli se → 1.12. + 2.12.
        expect(at('a')).toMatchObject({ startISO: '2026-12-01', endISO: '2026-12-02' });
        expect(res.evaluation.violations).toEqual([]);
    });

    it('bira ekipu s ranijim krajem i to objašnjava', () => {
        const sc = scenario([
            block('x', 8, { locked: true, startISO: MON, endISO: '2026-12-03' }),
            block('a', 4, { crewOptions: [PAR1, PAR2], workerRefs: [] }),
        ]);
        const { at, res } = solve(sc);
        expect(at('a').crewKey).toBe('haso+tarik');
        expect(res.decoded.info.get('a')?.alternatives).toEqual(expect.arrayContaining([{ crewKey: 'amer+edin', endDay: 7 }, { crewKey: 'haso+tarik', endDay: 1 }]));
    });

    it('bez kandidat-ekipe: neraspoređen s razlogom', () => {
        const inst = buildInstance(scenario([block('a', 2)]), { startISO: MON, calendar });
        inst.jobs[0].crews = [];
        const d = new Decoder(inst, [], new Set(['a'])).decode(['a']);
        expect(d.unplaced).toEqual([{ jobId: 'a', reason: 'nema kandidat-ekipe' }]);
    });

    // Svaka permutacija daje izvodljiv raspored: pravila dekodera su ista kao u ocjeni.
    it.each(Array.from({ length: 40 }, (_, i) => i + 1))('slučajni plan %i: svaka lista daje raspored bez prekoračenja', seed => {
        let x = seed * 104729;
        const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
        const people = Array.from({ length: 8 }, (_, i) => ref(`w${i}`, `Radnik${i} X`));
        const crews = Array.from({ length: 4 }, (_, i) => ({ id: `k${i}`, lead: people[2 * i], members: [people[2 * i + 1]] }));
        const blocks: PlanBlock[] = Array.from({ length: 6 + Math.floor(rnd() * 10) }, (_, i) => {
            const opts = crews.filter(() => rnd() < 0.5);
            return block(`j${i}`, 0.5 * (1 + Math.floor(rnd() * 24)), {
                crewOptions: opts.length ? opts : [crews[i % 4]], workerRefs: [],
                priority: (['urgent', 'high', 'medium', 'low'] as const)[Math.floor(rnd() * 4)],
                projectRef: { id: `p${Math.floor(rnd() * 3)}`, name: 'P' },
            });
        });
        const links = blocks.slice(1).filter(() => rnd() < 0.25).map((b, i) => ({ id: `l${i}`, from: blocks[i].id, to: b.id, kind: 'finish-to-start' as const }));
        const ws = people.map(p => ({ Worker_ID: p.id, Saturday_Anchor: rnd() < 0.5 ? '2026-11-28' : '2026-12-05' }));
        const absent = people.filter(() => rnd() < 0.3).map(p => ({ Worker_ID: p.id, Date: isoAt(MON, Math.floor(rnd() * 20)), Status: 'Bolovanje' }));
        const cal = buildWorkerCalendar({ workers: ws, attendance: absent, holidays: ['2026-12-25'] });
        const sc = scenario(blocks, links);
        const inst = buildInstance(sc, { startISO: MON, calendar: cal, fixedLoad: (w, iso) => (w === 'w0' && iso <= '2026-12-02' ? 0.5 : 0) });
        const dec = new Decoder(inst, [], new Set(blocks.map(b => b.id)));
        const ids = blocks.map(b => b.id);
        for (const order of [ids, ids.slice().reverse(), ids.slice().sort(() => rnd() - 0.5)]) {
            const d = dec.decode(order);
            expect(d.unplaced).toEqual([]);
            expect(evaluate(inst, d.placements).violations).toEqual([]);
        }
        const res = optimize(inst, placementsFromScenario(inst, sc.Blocks), new Set(ids), { budget: 150 });
        expect(res.evaluation.violations).toEqual([]);
        expect(lowerBounds(inst).makespan!.day).toBeLessThanOrEqual(res.evaluation.objective.makespan);
    });
});

describe('rezerva', () => {
    it('lanac je kritičan, kratak paralelan posao ima rezervu', () => {
        const sc = scenario([block('a', 8), block('b', 2, { crewOptions: [PAR2], workerRefs: [HASO, TARIK] })]);
        const { inst, res } = solve(sc);
        const s = slackOf(inst, res.placements);
        expect(s.get('a')).toEqual({ slackDays: 0, critical: true });
        expect(s.get('b')).toEqual({ slackDays: 3, critical: false });
    });
});

describe('optimizator na stvarnom planu (fixture, 41 nalog)', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'platnoPlan41.json'), 'utf8'));
    const cal = buildWorkerCalendar({ workers: fx.workers, attendance: fx.attendance, holidays: fx.holidays });
    const inst = buildInstance(fx.scenario, { startISO: fx.startISO, calendar: cal });
    const current = placementsFromScenario(inst, fx.scenario.Blocks);
    const movable = movableBlockIds(fx.scenario);
    const res = optimize(inst, current, movable, { budget: 600 });
    const before = evaluate(inst, current, current);

    it('izvodljiv prijedlog koji završava na dokazanoj donjoj granici (ručni plan: 13.1., neizvodljiv)', () => {
        expect(before.objective.violation).toBeGreaterThan(0);
        expect(res.evaluation.violations).toEqual([]);
        expect(res.evaluation.makespanISO).toBe(lowerBounds(inst).makespan!.iso);
        expect(res.evaluation.makespanISO).toBe('2027-01-11');
        expect(res.decoded.unplaced).toEqual([]);
    });
    it('pretraga ne pogoršava početnu listu i poštuje budžet', () => {
        expect(res.evals).toBeLessThanOrEqual(600);
        expect(compareObjectives(res.evaluation.objective, res.initialObjective)).toBeLessThanOrEqual(0);
    });
    it('determinizam: isti ulaz → isti prijedlog, i u komadima (Platno) isto kao odjednom', async () => {
        const again = optimize(inst, current, movable, { budget: 600 });
        expect(again.placements).toEqual(res.placements);
        const progress: number[] = [];
        const chunked = await optimizeAsync(inst, current, movable, { budget: 600, chunk: 100, onProgress: e => progress.push(e) });
        expect(chunked.placements).toEqual(res.placements);
        expect(progress.length).toBeGreaterThan(2);
    });
});

describe('prijedlog za Platno i primjena', () => {
    const sc = scenario([block('a', 3), block('b', 3, { priority: 'low', crewOptions: [PAR1, PAR2] })]);
    const ctx = { workers: workers as never, workOrders: [], attendance: [], projects: [], holidays: [] };

    it('dodjela nosi id ekipe, radnike, polovine dana i objašnjenje; ocjena prije i poslije', () => {
        const p = proposeSchedule(sc, ctx, { startISO: MON });
        expect(p.unscheduled).toEqual([]);
        const a = p.scheduled.find(s => s.blockId === 'a')!;
        expect(a).toMatchObject({ crewId: 'c1', crew: 2, startISO: MON, endISO: '2026-12-01', endsAM: true });
        expect(a.workerRefs.map(r => r.id)).toEqual(['amer', 'edin']);
        expect(a.reasons.map(r => r.code)).toEqual(expect.arrayContaining(['wait-start', 'crew-only', 'half']));
        const b = p.scheduled.find(s => s.blockId === 'b')!;
        expect(b).toMatchObject({ crewId: 'c2', startISO: MON });        // drugi par je slobodan odmah
        expect(p.quality.after.evaluation.objective.violation).toBe(0);
        expect(p.quality.before.evaluation.objective.violation).toBeGreaterThan(0);   // oba na 30.11. u jednom danu
    });

    it('APPLY_SCHEDULE upiše polovine i obriše ih kad ih nova dodjela nema', () => {
        const p = proposeSchedule(sc, ctx, { startISO: MON });
        let s = initialState(sc as PlanScenario);
        s = scenarioReducer(s, { type: 'APPLY_SCHEDULE', assignments: toAssignments(p) });
        const a = s.scenario.Blocks.find(x => x.id === 'a')!;
        expect(a.endsAM).toBe(true);
        expect('startsPM' in a).toBe(false);
        s = scenarioReducer(s, { type: 'APPLY_SCHEDULE', assignments: [{ blockId: 'a', startISO: MON, endISO: '2026-12-01', crew: 2, workerRefs: [AMER, EDIN] }] });
        expect('endsAM' in s.scenario.Blocks.find(x => x.id === 'a')!).toBe(false);
    });
});
