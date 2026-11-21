/**
 * @jest-environment node
 */
// Platno · model rasporeda (faza 1): kalendar radnika, ocjena plana (provjere + cilj),
// donje granice i izvještaj o kvalitetu. Izmišljena imena; fiksni plan je stvarni plan
// s Platna (21.11.2026) sa izmijenjenim imenima i id-evima.
import fs from 'fs';
import path from 'path';
import type { PlanBlock, PlanScenario } from '@/lib/types';
import { buildWorkerCalendar } from '@/lib/canvas/opt/calendar';
import { buildInstance, isoAt } from '@/lib/canvas/opt/instance';
import { compareObjectives, evaluate, placementsFromScenario, type Placement } from '@/lib/canvas/opt/evaluate';
import { lowerBounds } from '@/lib/canvas/opt/bounds';
import { qualityReport } from '@/lib/canvas/opt/quality';
import { autoSchedule, toAssignments } from '@/lib/canvas/autoSchedule';

const MON = '2026-11-30';
const ref = (id: string, name: string) => ({ id, name });
const AMER = ref('amer', 'Amer Hodžić'), EDIN = ref('edin', 'Edin Begić'), HASO = ref('haso', 'Haso Mujić'), TARIK = ref('tarik', 'Tarik Zukić');
const PAR1 = { id: 'c1', lead: AMER, members: [EDIN] };
const PAR2 = { id: 'c2', lead: HASO, members: [TARIK] };
const K1 = 'amer+edin', K2 = 'haso+tarik';

function block(id: string, workerDays: number, start: string, end: string, extra: Partial<PlanBlock> = {}): PlanBlock {
    return {
        id, kind: 'order', title: `Nalog ${id}`, startISO: start, endISO: end, workerDays, crew: 2,
        projectRef: { id: 'pA', name: 'Projekat A' }, crewOptions: [PAR1], workerRefs: [AMER, EDIN], ...extra,
    } as PlanBlock;
}
const scenario = (blocks: PlanBlock[], links: PlanScenario['Links'] = []) => ({ Blocks: blocks, Links: links } as unknown as PlanScenario);
// Svi rade subote 28.11., 12.12.… (5.12. ne radi); bez odsustava.
const workers = ['amer', 'edin', 'haso', 'tarik'].map(id => ({ Worker_ID: id, Saturday_Anchor: '2026-11-28' }));
const cal = (holidays: string[] = []) => buildWorkerCalendar({ workers, attendance: [], holidays });

describe('kalendar radnika', () => {
    const c = buildWorkerCalendar({
        workers: [{ Worker_ID: 'amer', Saturday_Anchor: '2026-11-28' }, { Worker_ID: 'edin', Saturday_Anchor: '2026-12-05' }],
        attendance: [{ Worker_ID: 'amer', Date: '2026-12-02', Status: 'Bolovanje' }, { Worker_ID: 'edin', Date: '2026-12-12', Status: 'Prisutan' }],
        holidays: ['2027-01-01'],
    });
    it.each([
        ['amer', '2026-11-30', 1, 'radni dan'],
        ['amer', '2026-12-06', 0, 'nedjelja'],
        ['amer', '2026-12-05', 0, 'subota van smjene'],
        ['amer', '2026-12-12', 1, 'subota smjene'],
        ['edin', '2026-12-05', 1, 'subota druge smjene'],
        ['amer', '2026-12-02', 0, 'bolovanje iz šihtarice'],
        ['edin', '2026-12-12', 1, 'zapis „Prisutan" ima prednost nad smjenom'],
        ['amer', '2027-01-01', 0, 'praznik'],
    ])('%s %s → %s (%s)', (w, iso, want) => {
        expect(c.available(w as string, iso as string)).toBe(want);
    });
});

describe('ocjena plana', () => {
    // 4 + 6 + 8 radnik-dana = 2 + 3 + 4 dana para; jedan par, redom bez rupa.
    const seq = [block('a', 4, '2026-11-30', '2026-12-01'), block('b', 6, '2026-12-02', '2026-12-04'), block('c', 8, '2026-12-07', '2026-12-10')];

    it('plan bez rupa: sve provjere prolaze i plan je dokazano najbrži (granica = kraj)', () => {
        const inst = buildInstance(scenario(seq), { startISO: MON, calendar: cal() });
        const r = qualityReport(inst, placementsFromScenario(inst, seq));
        expect(r.evaluation.violations).toEqual([]);
        expect(r.evaluation.makespanISO).toBe('2026-12-10');
        expect(r.bounds.makespan?.iso).toBe('2026-12-10');
        expect(r.bounds.makespan?.kind).toBe('crew-set');
        expect(r.bounds.makespan?.text).toContain('Amer i Edin: 18 radnik-dana posla koji mogu samo oni');
        expect(r.gapDays).toBe(0);
        expect(r.lines[0]).toContain('plan je dokazano najbrži');
    });

    it('dva naloga istog para iste dane → radnik preko kapaciteta', () => {
        const bad = [block('a', 4, '2026-11-30', '2026-12-01'), block('b', 4, '2026-11-30', '2026-12-01')];
        const inst = buildInstance(scenario(bad), { startISO: MON, calendar: cal() });
        const v = evaluate(inst, placementsFromScenario(inst, bad)).violations;
        expect(v.filter(x => x.kind === 'overload').map(x => `${x.workerId} ${x.dateISO}`).sort())
            .toEqual(['amer 2026-11-30', 'amer 2026-12-01', 'edin 2026-11-30', 'edin 2026-12-01']);
    });

    it('raspon kraći od posla, neradna subota se ne računa', () => {
        // 6 radnik-dana = 3 dana para; pet. 4.12. + sub. 5.12. (ne radi) + ned. = samo 1 radni dan
        const bad = [block('a', 6, '2026-12-04', '2026-12-06')];
        const inst = buildInstance(scenario(bad), { startISO: MON, calendar: cal() });
        const v = evaluate(inst, placementsFromScenario(inst, bad)).violations;
        expect(v).toEqual([expect.objectContaining({ kind: 'too-short', jobId: 'a', amount: 2 })]);
    });

    it('pola dana: dva naloga od po pola dana para dijele isti dan bez prekoračenja', () => {
        const ok = [block('a', 1, '2026-11-30', '2026-11-30'), block('b', 1, '2026-11-30', '2026-11-30')];
        const inst = buildInstance(scenario(ok), { startISO: MON, calendar: cal() });
        expect(evaluate(inst, placementsFromScenario(inst, ok)).violations).toEqual([]);
    });

    it('prethodnik, ekipa van kandidata, bez ekipe', () => {
        const bad = [
            block('a', 4, '2026-11-30', '2026-12-01'),
            block('b', 4, '2026-12-01', '2026-12-02', { workerRefs: [HASO, TARIK] }),
            block('c', 4, '2026-12-07', '2026-12-08', { workerRefs: [] }),
        ];
        const inst = buildInstance(scenario(bad, [{ id: 'l', from: 'a', to: 'b', kind: 'finish-to-start' }]), { startISO: MON, calendar: cal() });
        const kinds = evaluate(inst, placementsFromScenario(inst, bad)).violations.map(v => `${v.kind}:${v.jobId}`).sort();
        expect(kinds).toEqual(['crew-not-allowed:b', 'precedence:b', 'unassigned:c']);
    });

    it('izvodljiv plan je uvijek bolji od neizvodljivog, i kad kasnije završi', () => {
        const ok = { violation: 0, makespan: 40, urgentEnd: 40, highEnd: 40, tardiness: 9, switches: 9, moved: 9, shiftDays: 9 };
        expect(compareObjectives(ok, { ...ok, violation: 0.5, makespan: 1, urgentEnd: 1 })).toBeLessThan(0);
    });

    it('cilj se poredi redom: kraj → hitno → visoko → kašnjenje → promjene projekta → pomjeranja', () => {
        const base = { violation: 0, makespan: 10, urgentEnd: 5, highEnd: 7, tardiness: 0, switches: 3, moved: 0, shiftDays: 0 };
        expect(compareObjectives(base, { ...base, makespan: 11, urgentEnd: 0 })).toBeLessThan(0);
        expect(compareObjectives(base, { ...base, urgentEnd: 4, switches: 9 })).toBeGreaterThan(0);
        expect(compareObjectives(base, { ...base, switches: 2, moved: 10 })).toBeGreaterThan(0);
        expect(compareObjectives(base, { ...base })).toBe(0);
    });

    it('promjene projekta u nizu ekipe i pomjeranja prema prethodnom planu', () => {
        const plan = [
            block('a', 2, '2026-11-30', '2026-11-30'),
            block('b', 2, '2026-12-01', '2026-12-01', { projectRef: { id: 'pB', name: 'Projekat B' } }),
            block('c', 2, '2026-12-02', '2026-12-02'),
        ];
        const inst = buildInstance(scenario(plan), { startISO: MON, calendar: cal() });
        const now = placementsFromScenario(inst, plan);
        const before: Placement[] = now.map(p => (p.jobId === 'c' ? { ...p, startISO: '2026-12-04', endISO: '2026-12-04' } : p));
        const e = evaluate(inst, now, before);
        expect(e.objective.switches).toBe(2);
        expect(e.objective.moved).toBe(1);
        expect(e.objective.shiftDays).toBe(2);
        expect(e.crews[0].projects).toEqual(['Projekat A', 'Projekat B', 'Projekat A']);
    });
});

describe('donje granice', () => {
    it('posao koji može samo jedan par drži granicu i kad drugi par stoji', () => {
        const blocks = [
            block('a', 20, MON, MON),                                              // samo par 1: 10 dana
            block('b', 4, MON, MON, { crewOptions: [PAR1, PAR2] }),
        ];
        const inst = buildInstance(scenario(blocks), { startISO: MON, calendar: cal() });
        const b = lowerBounds(inst);
        // 10 radnih dana para 1 od 30.11. (subota 5.12. ne radi) → pet. 11.12.
        expect(b.makespan?.iso).toBe('2026-12-11');
        expect(b.makespan?.text).toContain('Amer i Edin');
    });

    it('lanac: nasljednik ne može prije kraja prethodnika i najranijeg početka', () => {
        const blocks = [block('a', 4, MON, MON), block('b', 4, MON, MON, { crewOptions: [PAR2], workerRefs: [HASO, TARIK] })];
        const inst = buildInstance(scenario(blocks, [{ id: 'l', from: 'a', to: 'b', kind: 'finish-to-start', lagDays: 1 }]), { startISO: MON, calendar: cal() });
        // a: 30.11.–1.12.; razmak 1 dan → b od 3.12., 2 dana → 4.12.
        expect(lowerBounds(inst).makespan).toMatchObject({ kind: 'chain', iso: '2026-12-04' });
    });

    it('hitni i visoki projekti dobijaju svoju granicu', () => {
        const blocks = [
            block('u', 6, MON, MON, { priority: 'urgent', projectRef: { id: 'pU', name: 'Hitni' } }),
            block('h', 2, MON, MON, { priority: 'high', crewOptions: [PAR2], workerRefs: [HASO, TARIK], projectRef: { id: 'pH', name: 'Visoki' } }),
        ];
        const b = lowerBounds(buildInstance(scenario(blocks), { startISO: MON, calendar: cal() }));
        expect(b.urgent?.iso).toBe('2026-12-02');
        expect(b.high?.iso).toBe('2026-11-30');
    });

    // Granica mora biti ispod SVAKOG izvodljivog plana: 60 slučajnih planova, raspoređenih
    // postojećim auto-rasporedom Platna, bez ijedne prekršene provjere.
    it.each(Array.from({ length: 60 }, (_, i) => i + 1))('slučajni plan %i: auto-raspored je izvodljiv, a granica nije iznad njegovog kraja', seed => {
        let x = seed * 7919;
        const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
        const people = Array.from({ length: 8 }, (_, i) => ref(`w${i}`, `Radnik${i} X`));
        const crews = Array.from({ length: 4 }, (_, i) => ({ id: `k${i}`, lead: people[2 * i], members: [people[2 * i + 1]] }));
        const saturdays: string[] = [];
        for (let d = 5; d < 200; d += 7) saturdays.push(isoAt(MON, d));
        const blocks: PlanBlock[] = Array.from({ length: 6 + Math.floor(rnd() * 10) }, (_, i) => {
            const opts = crews.filter(() => rnd() < 0.5);
            return block(`j${i}`, 1 + Math.floor(rnd() * 16), MON, MON, {
                crewOptions: opts.length ? opts : [crews[i % 4]], workerRefs: [],
                priority: (['urgent', 'high', 'medium', 'low'] as const)[Math.floor(rnd() * 4)],
                projectRef: { id: `p${Math.floor(rnd() * 3)}`, name: 'P' },
            });
        });
        const sc = scenario(blocks);
        const ws = people.map(p => ({ Worker_ID: p.id }));
        const res = autoSchedule(sc, { workers: ws as never, workOrders: [], attendance: [], projects: [], isSaturdayWorking: () => false }, { startISO: MON });
        expect(res.unscheduled).toEqual([]);
        const byId = new Map(toAssignments(res).map(a => [a.blockId, a]));
        const placed = blocks.map(b => ({ ...b, ...byId.get(b.id)! }));
        const inst = buildInstance(sc, { startISO: MON, calendar: buildWorkerCalendar({ workers: ws, attendance: [], holidays: saturdays }) });
        const e = evaluate(inst, placementsFromScenario(inst, placed));
        expect(e.violations).toEqual([]);
        const lb = lowerBounds(inst);
        expect(lb.makespan!.day).toBeLessThanOrEqual(e.objective.makespan);
        if (lb.urgent) expect(lb.urgent.day).toBeLessThanOrEqual(e.objective.urgentEnd);
        if (lb.high) expect(lb.high.day).toBeLessThanOrEqual(e.objective.highEnd);
    });
});

describe('stvarni plan s Platna (41 nalog, 7 parova, subotnje smjene)', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'platnoPlan41.json'), 'utf8'));
    const calendar = buildWorkerCalendar({ workers: fx.workers, attendance: fx.attendance, holidays: fx.holidays });
    const inst = buildInstance(fx.scenario, { startISO: fx.startISO, calendar });
    const report = qualityReport(inst, placementsFromScenario(inst, fx.scenario.Blocks));

    it('model prepoznaje 41 posao i 7 parova', () => {
        expect(inst.jobs).toHaveLength(41);
        expect(inst.crews.size).toBe(7);
    });

    it('kraj plana i granica: ručni raspored je 2 dana iznad dokazano najranijeg kraja', () => {
        expect(report.evaluation.makespanISO).toBe('2027-01-13');
        expect(report.bounds.makespan?.iso).toBe('2027-01-11');
        expect(report.bounds.makespan?.text).toMatch(/: 64 radnik-dana posla koji mogu samo oni → najranije 11\.1\./);
        expect(report.gapDays).toBe(2);
        // Hitni projekat (Recepcija) drži isti par → završen tačno na granici.
        expect(report.urgentGapDays).toBe(0);
    });

    // Plan je poslije redizajna ručno mijenjan (21.11. ujutro): izmjena se ne širi na sljedeći
    // nalog istog para (faza 4), pa ocjena nalazi prekratke raspone i preklapanja.
    it('provjere nalaze prekratke raspone i preklapanja nastala ručnim izmjenama', () => {
        const v = report.evaluation.violations;
        const short = v.filter(x => x.kind === 'too-short').map(x => inst.jobs.find(j => j.id === x.jobId)!.title.split(' · ')[0]).sort();
        expect(short).toEqual(['Poz 3 - Kuhinja', 'Poz 4 - Obloge stubova', 'Poz 5 - Konzola u hodniku', 'Poz 7.1 - Retropult recepcija Fitness']);
        // Konzola preko 1. i 2.1. i neradne subote 26.12.: 6 radnih dana para za 8 dana posla.
        expect(v.find(x => x.kind === 'too-short' && x.text.startsWith('Poz 5 - Konzola'))?.amount).toBe(2);
        const over = Array.from(new Set(v.filter(x => x.kind === 'overload').map(x => x.dateISO))).sort();
        expect(over).toEqual(['2026-12-03', '2026-12-15', '2027-01-07', '2027-01-08', '2027-01-11']);
        expect(report.evaluation.objective.violation).toBeCloseTo(15.38, 2);
        expect(report.lines.find(l => l.startsWith('Provjere'))).toContain('plan NIJE izvodljiv');
    });

    it('stari auto-raspored Platna računa subote i praznike kao radne: rani kraj je neizvodljiv', () => {
        const sc = { ...fx.scenario, Blocks: fx.scenario.Blocks.map((b: PlanBlock) => ({ ...b, assignedCrewId: undefined })) };
        const res = autoSchedule(sc, { workers: fx.workers, workOrders: [], attendance: fx.attendance, projects: [] }, { startISO: fx.startISO });
        const byId = new Map(toAssignments(res).map(a => [a.blockId, a]));
        const placed = sc.Blocks.map((b: PlanBlock) => ({ ...b, ...(byId.get(b.id) || {}) }));
        const old = evaluate(inst, placementsFromScenario(inst, placed));
        expect(old.violations.filter(x => x.kind === 'too-short')).toHaveLength(11);
        expect(old.objective.violation).toBeGreaterThan(0);
        // Završava (6.1.) PRIJE dokazane donje granice (11.1.) — to je moguće samo kršenjem
        // kalendara, pa granica ujedno razotkriva neizvodljiv „brz" plan.
        expect(old.objective.makespan).toBeLessThan(report.bounds.makespan!.day);
    });
});
