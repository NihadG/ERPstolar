// PLATNO · FAZA 4 — preračun: zamrznut period (3 radna dana), prijedlog oko zamrznutog
// i zdravlje plana poslije izmjene. Izmišljena imena.

import type { PlanBlock, PlanScenario } from '@/lib/types';
import { FREEZE_WORK_DAYS, freezeEndISO, frozenBlockIds } from '@/lib/canvas/opt/freeze';
import { planHealth, proposeSchedule } from '@/lib/canvas/opt/propose';

const AMER = { id: 'amer', name: 'Amer Hodžić' }, EDIN = { id: 'edin', name: 'Edin Begić' };
const HASO = { id: 'haso', name: 'Haso Mujić' }, TARIK = { id: 'tarik', name: 'Tarik Zukić' };
const PAR1 = { id: 'c1', lead: AMER, members: [EDIN] };
const PAR2 = { id: 'c2', lead: HASO, members: [TARIK] };
const workers = ['amer', 'edin', 'haso', 'tarik'].map(id => ({ Worker_ID: id, Saturday_Anchor: '2026-11-28', Name: id, Status: 'Aktivan' }));
const ctx = { workers: workers as never, workOrders: [], attendance: [], projects: [], holidays: ['2026-11-25'] };
const TODAY = '2026-11-23';   // ponedjeljak

function block(id: string, workerDays: number, start: string, end: string, extra: Partial<PlanBlock> = {}): PlanBlock {
    return {
        id, kind: 'order', title: `Nalog ${id}`, startISO: start, endISO: end, workerDays, crew: 2,
        projectRef: { id: 'pA', name: 'Projekat A' }, crewOptions: [PAR1], workerRefs: [AMER, EDIN], ...extra,
    } as PlanBlock;
}
const scenario = (blocks: PlanBlock[]) => ({ Blocks: blocks, Links: [] } as unknown as PlanScenario);

describe('zamrznut period', () => {
    it.each([
        ['2026-11-21', '2026-11-26', 'subota: pon, uto, (sri praznik), čet'],
        ['2026-11-23', '2026-11-26', 'ponedjeljak se broji'],
        ['2026-11-26', '2026-11-30', 'čet, pet, (vikend), pon'],
    ])('od %s → do %s (%s)', (today, want) => {
        expect(freezeEndISO(today, ['2026-11-25'])).toBe(want);
    });
    it('odluka vlasnika: 3 radna dana', () => expect(FREEZE_WORK_DAYS).toBe(3));

    it('zamrznut je raspoređen nalog koji počinje do kraja perioda; nov i kasniji nisu', () => {
        const sc = scenario([
            block('u-toku', 4, '2026-11-19', '2026-11-24'),
            block('sutra', 2, '2026-11-24', '2026-11-24'),
            block('kasnije', 2, '2026-11-27', '2026-11-27'),
            block('nov', 2, TODAY, TODAY, { workerRefs: [] }),
        ]);
        expect([...frozenBlockIds(sc, freezeEndISO(TODAY, ['2026-11-25']))].sort()).toEqual(['sutra', 'u-toku']);
    });
});

describe('preračun oko zamrznutog', () => {
    // „z" je zamrznut na paru 1 (24.–26.11.), iako bi ga raspored pomjerio; „a" i „b" idu oko njega.
    const sc = scenario([
        block('z', 4, '2026-11-24', '2026-11-26', { priority: 'low' }),
        block('a', 4, '2026-11-30', '2026-12-01', { priority: 'urgent', crewOptions: [PAR1, PAR2], workerRefs: [] }),
        block('b', 2, '2026-12-02', '2026-12-02', { workerRefs: [] }),
    ]);

    it('zamrznut nalog ostaje gdje je; ostali dobiju prijedlog oko njega', () => {
        const p = proposeSchedule(sc, ctx, { startISO: TODAY, todayISO: TODAY, freezeDays: 3 });
        expect(p.quality.frozen).toEqual(['z']);
        expect(p.quality.freezeEndISO).toBe('2026-11-26');
        expect(p.scheduled.find(s => s.blockId === 'z')).toBeUndefined();
        const a = p.scheduled.find(s => s.blockId === 'a')!;
        expect(a).toMatchObject({ crewId: 'c2', startISO: TODAY });            // par 2 je slobodan odmah
        const b = p.scheduled.find(s => s.blockId === 'b')!;
        expect(b.startISO > '2026-11-26' || b.startISO === TODAY).toBe(true);
        expect(p.quality.after.evaluation.violations).toEqual([]);
    });

    it('bez zamrzavanja isti nalog smije da se pomjeri', () => {
        const p = proposeSchedule(sc, ctx, { startISO: TODAY, todayISO: TODAY });
        expect(p.quality.frozen).toEqual([]);
        expect(p.scheduled.map(s => s.blockId).sort()).toEqual(['a', 'b', 'z']);
    });
});

describe('zdravlje plana', () => {
    it('sudar poslije izmjene: broji prekršaje i daje primjer', () => {
        // a i b na istom paru u isto vrijeme
        const sc = scenario([block('a', 4, TODAY, '2026-11-24'), block('b', 4, TODAY, '2026-11-24')]);
        const h = planHealth(sc, ctx, TODAY)!;
        expect(h.feasible).toBe(false);
        expect(h.violationCount).toBeGreaterThan(0);
        expect(h.examples[0]).toMatch(/dana posla, može 1/);
    });

    it('izvodljiv plan s rupom: koliko se može ranije', () => {
        // jedan nalog od 2 dana stavljen tek u četvrtak — može odmah u ponedjeljak
        const sc = scenario([block('a', 4, '2026-11-26', '2026-11-27')]);
        const h = planHealth(sc, ctx, TODAY)!;
        expect(h.feasible).toBe(true);
        expect(h.endISO).toBe('2026-11-27');
        expect(h.boundISO).toBe('2026-11-24');
        expect(h.gapDays).toBe(3);
    });

    it('prošli sudari se ne prijavljuju (gotovo je)', () => {
        const sc = scenario([block('a', 4, '2026-11-16', '2026-11-17'), block('b', 4, '2026-11-16', '2026-11-17'), block('c', 2, TODAY, TODAY)]);
        expect(planHealth(sc, ctx, TODAY)!.feasible).toBe(true);
    });

    it('prazan plan → nema ocjene', () => {
        expect(planHealth(scenario([]), ctx, TODAY)).toBeNull();
    });
});
