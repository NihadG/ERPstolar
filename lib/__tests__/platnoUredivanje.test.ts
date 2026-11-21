// PLATNO · FAZA 5 — brze akcije nad nalogom (lib/canvas/quickActions.ts) i reducer
// SPLIT_BLOCK / MERGE_BLOCKS (jedan Ctrl+Z). Izmišljena imena.

import type { PlanBlock, PlanScenario } from '@/lib/types';
import { adjustHalfDay, halfSpan, mergeBlocks, splitBlock, swapCrewPatch } from '@/lib/canvas/quickActions';
import { initialState, scenarioReducer } from '@/lib/canvas/scenarioReducer';

// Pon 30.11.2026; subota 5.12. ne radi; 8.12. uzet kao praznik za test.
const isWork = (iso: string) => {
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return dow !== 0 && iso !== '2026-12-05' && iso !== '2026-12-08';
};
const MON = '2026-11-30';
const AMER = { id: 'amer', name: 'Amer Hodžić' }, EDIN = { id: 'edin', name: 'Edin Begić' }, HASO = { id: 'haso', name: 'Haso Mujić' };
const PAR = { id: 'c1', lead: AMER, members: [EDIN] };
const SOLO = { id: 'c2', lead: HASO, members: [] };

function block(id: string, workerDays: number, extra: Partial<PlanBlock> = {}): PlanBlock {
    return {
        id, kind: 'order', title: `Nalog ${id}`, startISO: MON, endISO: MON, workerDays, crew: 2,
        projectRef: { id: 'pA', name: 'Projekat A' }, crewOptions: [PAR, SOLO], workerRefs: [AMER, EDIN], ...extra,
    } as PlanBlock;
}

describe('trajanje u polovinama dana', () => {
    it.each([
        [1, false, '2026-11-30', false],
        [1.5, false, '2026-12-01', true],
        [1.5, true, '2026-12-01', false],
        [0.5, true, '2026-11-30', false],
        [5, false, '2026-12-04', false],
        [6, false, '2026-12-07', false],       // subota 5.12. ne radi, nedjelja → pon 7.12.
        [7.5, false, '2026-12-10', true],      // 8.12. praznik
    ])('%s dana (od podne: %s) → %s, do podne %s', (need, pm, end, am) => {
        expect(halfSpan(MON, pm as boolean, need as number, isWork)).toEqual({ endISO: end, endsAM: am });
    });
});

describe('±½ dana', () => {
    const b = { ...block('a', 3), endISO: '2026-12-01', endsAM: true };   // par, 1,5 dan
    it('+½: 2 dana, kraj utorak cijeli', () => {
        expect(adjustHalfDay(b, 0.5, isWork)).toEqual({ workerDays: 4, crew: 2, endISO: '2026-12-01', endsAM: false });
    });
    it('−½: 1 dan, kraj ponedjeljak', () => {
        expect(adjustHalfDay(b, -0.5, isWork)).toEqual({ workerDays: 2, crew: 2, endISO: MON, endsAM: false });
    });
    it('ispod pola dana ne ide', () => {
        expect(adjustHalfDay(block('x', 1), -0.5, isWork)).toBeNull();
    });
});

describe('zamijeni par', () => {
    it('isti posao, druga ekipa: 4 rd paru = 2 dana, samcu = 4 dana', () => {
        const p = swapCrewPatch(block('a', 4), SOLO, isWork);
        expect(p).toMatchObject({ crew: 1, workerDays: 4, endISO: '2026-12-03', assignedCrewId: 'c2' });
        expect(p.workerRefs?.map(r => r.id)).toEqual(['haso']);
    });
});

describe('podijeli i spoji', () => {
    const products = [{ id: 'p1', name: 'Ormar', qty: 1 }, { id: 'p2', name: 'Komoda', qty: 2 }, { id: 'p3', name: 'Polica', qty: 1 }];
    it('podijeli: pola posla u svakom dijelu, proizvodi raspoređeni, drugi dio poslije prvog', () => {
        const [a, b] = splitBlock(block('a', 6, { productRefs: products, linkedWorkOrderId: 'wo1' }), isWork, 'novi')!;
        expect(a).toMatchObject({ id: 'a', title: 'Nalog a (1/2)', workerDays: 3, endISO: '2026-12-01', endsAM: true, linkedWorkOrderId: 'wo1' });
        expect(b).toMatchObject({ id: 'novi', title: 'Nalog a (2/2)', workerDays: 3, startISO: '2026-12-02', endISO: '2026-12-03', endsAM: true });
        expect(b.linkedWorkOrderId).toBeUndefined();
        expect(a.productRefs?.map(p => p.id)).toEqual(['p1', 'p2']);
        expect(b.productRefs?.map(p => p.id)).toEqual(['p3']);
    });
    it('kraći od dana ekipe se ne dijeli', () => {
        expect(splitBlock(block('a', 1), isWork, 'n')).toBeNull();
    });
    it('spoji: posao se sabira od ranijeg početka, proizvodi spajaju, viši prioritet ostaje', () => {
        const a = block('a', 4, { startISO: '2026-12-02', priority: 'low', productRefs: [products[0]] });
        const b = block('b', 2, { startISO: MON, priority: 'high', productRefs: [products[1]] });
        const m = mergeBlocks(a, b, isWork) as PlanBlock;
        expect(m).toMatchObject({ id: 'a', startISO: MON, workerDays: 6, endISO: '2026-12-02', priority: 'high' });
        expect(m.productRefs?.map(p => p.id)).toEqual(['p1', 'p2']);
    });
    it('spajaju se samo isti projekat i vrsta', () => {
        expect(mergeBlocks(block('a', 2), block('b', 2, { projectRef: { id: 'pB', name: 'B' } }), isWork)).toMatch(/istog projekta/);
        expect(mergeBlocks(block('a', 2), block('b', 2, { kind: 'montaza' }), isWork)).toMatch(/iste vrste/);
        expect(mergeBlocks(block('a', 2, { linkedWorkOrderId: 'w1' }), block('b', 2, { linkedWorkOrderId: 'w2' }), isWork)).toMatch(/stvarni nalozi/);
    });
});

describe('reducer: jedna izmjena, jedan Ctrl+Z', () => {
    const buy = { id: 'm', kind: 'purchase', title: 'Ploče', startISO: MON, endISO: MON } as PlanBlock;
    const sc = { Scenario_ID: 's', Name: 'T', Blocks: [buy, block('a', 6), block('b', 2), block('c', 2)], Links: [
        { id: 'l1', from: 'm', to: 'a', kind: 'delivery-to-start' },
        { id: 'l2', from: 'a', to: 'c', kind: 'finish-to-start' },
        { id: 'l3', from: 'b', to: 'c', kind: 'finish-to-start' },
    ] } as unknown as PlanScenario;

    it('SPLIT_BLOCK: oba dijela nasljeđuju veze; undo vraća jedan nalog', () => {
        const parts = splitBlock(sc.Blocks[1], isWork, 'a2')!;
        const s = scenarioReducer(initialState(sc), { type: 'SPLIT_BLOCK', id: 'a', parts });
        expect(s.scenario.Blocks.map(b => b.id)).toEqual(['m', 'a', 'a2', 'b', 'c']);
        const ln = s.scenario.Links.map(l => `${l.from}>${l.to}`);
        expect(ln).toEqual(expect.arrayContaining(['m>a', 'm>a2', 'a>c', 'a2>c']));
        const u = scenarioReducer(s, { type: 'UNDO' });
        expect(u.scenario.Blocks.map(b => b.id)).toEqual(['m', 'a', 'b', 'c']);
        expect(u.scenario.Links).toHaveLength(3);
    });

    it('MERGE_BLOCKS: veze prelaze na spojeni, bez duplikata i petlji', () => {
        const merged = mergeBlocks(sc.Blocks[1], sc.Blocks[2], isWork) as PlanBlock;
        const s = scenarioReducer(initialState(sc), { type: 'MERGE_BLOCKS', keepId: 'a', removeId: 'b', merged });
        expect(s.scenario.Blocks.map(b => b.id)).toEqual(['m', 'a', 'c']);
        expect(s.scenario.Links.map(l => `${l.from}>${l.to}`).sort()).toEqual(['a>c', 'm>a']);
        expect(s.scenario.Blocks[1].workerDays).toBe(8);
        expect(scenarioReducer(s, { type: 'UNDO' }).scenario.Blocks).toHaveLength(4);
    });
});
