import {
    scenarioReducer, initialState, canUndo, canRedo, UNDO_LIMIT,
    type ScenarioState, type ScenarioAction,
} from '../canvas/scenarioReducer';
import { emptyScenario, newBlock, MAX_BLOCKS_PER_SCENARIO } from '../canvas/model';
import type { PlanBlock } from '../types';

const run = (state: ScenarioState, ...actions: ScenarioAction[]): ScenarioState =>
    actions.reduce(scenarioReducer, state);

const base = () => initialState(emptyScenario('org', 'Test'));

const block = (over: Partial<PlanBlock> = {}) =>
    newBlock('order', '2026-08-03', '2026-08-07', over);

describe('blokovi', () => {
    test('dodavanje bloka ga i selektuje', () => {
        const b = block();
        const s = run(base(), { type: 'ADD_BLOCK', block: b });
        expect(s.scenario.Blocks).toHaveLength(1);
        expect(s.selectedIds).toEqual([b.id]);
        expect(s.dirty).toBe(true);
    });

    test('pomjeranje mijenja oba datuma', () => {
        const b = block();
        const s = run(base(), { type: 'ADD_BLOCK', block: b }, { type: 'MOVE_BLOCKS', ids: [b.id], days: 3 });
        expect(s.scenario.Blocks[0].startISO).toBe('2026-08-06');
        expect(s.scenario.Blocks[0].endISO).toBe('2026-08-10');
    });

    test('pomjeranje narudžbe nosi i datum slanja', () => {
        const b = newBlock('purchase', '2026-08-20', '2026-08-26', { orderByISO: '2026-08-20' });
        const s = run(base(), { type: 'ADD_BLOCK', block: b }, { type: 'MOVE_BLOCKS', ids: [b.id], days: -2 });
        expect(s.scenario.Blocks[0].orderByISO).toBe('2026-08-18');
        expect(s.scenario.Blocks[0].endISO).toBe('2026-08-24');
    });

    test('pomak od 0 dana ne dira istoriju', () => {
        const b = block();
        const s1 = run(base(), { type: 'ADD_BLOCK', block: b });
        const s2 = scenarioReducer(s1, { type: 'MOVE_BLOCKS', ids: [b.id], days: 0 });
        expect(s2).toBe(s1);
    });

    test('brisanje bloka briše i veze na njega (nema strelica u prazno)', () => {
        const a = block({ id: 'a' });
        const c = block({ id: 'c' });
        const s = run(base(),
            { type: 'ADD_BLOCK', block: a },
            { type: 'ADD_BLOCK', block: c },
            { type: 'ADD_LINK', from: 'a', to: 'c', kind: 'finish-to-start' },
            { type: 'DELETE_BLOCKS', ids: ['a'] },
        );
        expect(s.scenario.Blocks.map(b => b.id)).toEqual(['c']);
        expect(s.scenario.Links).toHaveLength(0);
    });

    test('dupliranje NE kopira veze', () => {
        const a = block({ id: 'a' });
        const c = block({ id: 'c' });
        const s = run(base(),
            { type: 'ADD_BLOCK', block: a },
            { type: 'ADD_BLOCK', block: c },
            { type: 'ADD_LINK', from: 'a', to: 'c', kind: 'finish-to-start' },
            { type: 'DUPLICATE_BLOCKS', ids: ['a'] },
        );
        expect(s.scenario.Blocks).toHaveLength(3);
        expect(s.scenario.Links).toHaveLength(1);
        expect(s.scenario.Blocks[2].title).toContain('kopija');
        // Kopija mora dobiti STVARAN novi id. `id: undefined` u spreadu bi pregazio
        // uuid iz newBlock-a i sve kopije bi imale isti (nedefinisan) ključ.
        expect(s.scenario.Blocks[2].id).toBeTruthy();
        expect(s.scenario.Blocks[2].id).not.toBe('a');
        expect(typeof s.scenario.Blocks[2].id).toBe('string');
    });

    test('dvije kopije dobiju RAZLIČITE id-eve', () => {
        const a = block({ id: 'a' });
        const s = run(base(),
            { type: 'ADD_BLOCK', block: a },
            { type: 'DUPLICATE_BLOCKS', ids: ['a'] },
            { type: 'DUPLICATE_BLOCKS', ids: ['a'] },
        );
        const ids = s.scenario.Blocks.map(b => b.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('izmjena nepostojećeg bloka je bez efekta', () => {
        const s1 = base();
        expect(scenarioReducer(s1, { type: 'UPDATE_BLOCK', id: 'nema', patch: { title: 'x' } })).toBe(s1);
    });
});

describe('granica broja blokova', () => {
    test('preko granice se odbija uz poruku, ne tiho', () => {
        let s = base();
        s = {
            ...s,
            scenario: {
                ...s.scenario,
                Blocks: Array.from({ length: MAX_BLOCKS_PER_SCENARIO }, () => block()),
            },
        };
        const after = scenarioReducer(s, { type: 'ADD_BLOCK', block: block() });
        expect(after.scenario.Blocks).toHaveLength(MAX_BLOCKS_PER_SCENARIO);
        expect(after.notice).toContain(String(MAX_BLOCKS_PER_SCENARIO));
    });
});

describe('veze', () => {
    const two = () => {
        const a = block({ id: 'a' });
        const c = block({ id: 'c' });
        return run(base(), { type: 'ADD_BLOCK', block: a }, { type: 'ADD_BLOCK', block: c });
    };

    test('veza se dodaje', () => {
        const s = scenarioReducer(two(), { type: 'ADD_LINK', from: 'a', to: 'c', kind: 'finish-to-start' });
        expect(s.scenario.Links).toHaveLength(1);
    });

    test('duplikat veze se ignoriše', () => {
        const s = run(two(),
            { type: 'ADD_LINK', from: 'a', to: 'c', kind: 'finish-to-start' },
            { type: 'ADD_LINK', from: 'a', to: 'c', kind: 'finish-to-start' },
        );
        expect(s.scenario.Links).toHaveLength(1);
    });

    test('CIKLUS se odbija uz poruku — bez toga lančani preračun vrti beskonačno', () => {
        const s = run(two(),
            { type: 'ADD_LINK', from: 'a', to: 'c', kind: 'finish-to-start' },
            { type: 'ADD_LINK', from: 'c', to: 'a', kind: 'finish-to-start' },
        );
        expect(s.scenario.Links).toHaveLength(1);
        expect(s.notice).toContain('krug');
    });

    test('veza na nepostojeći blok se ignoriše', () => {
        const s1 = two();
        expect(scenarioReducer(s1, { type: 'ADD_LINK', from: 'a', to: 'nema', kind: 'finish-to-start' })).toBe(s1);
    });
});

describe('lančani preračun', () => {
    test('primjenjuje datume, ali NE dira zaključane blokove', () => {
        const free = block({ id: 'free' });
        const locked = block({ id: 'locked', locked: true });
        const s = run(base(),
            { type: 'ADD_BLOCK', block: free },
            { type: 'ADD_BLOCK', block: locked },
            {
                type: 'APPLY_DATE_DIFF', changes: [
                    { id: 'free', startISO: '2026-09-01', endISO: '2026-09-05' },
                    { id: 'locked', startISO: '2026-09-01', endISO: '2026-09-05' },
                ],
            },
        );
        expect(s.scenario.Blocks.find(b => b.id === 'free')!.startISO).toBe('2026-09-01');
        expect(s.scenario.Blocks.find(b => b.id === 'locked')!.startISO).toBe('2026-08-03');
    });

    test('cijeli preračun je JEDAN korak undo-a', () => {
        const a = block({ id: 'a' });
        const c = block({ id: 'c' });
        let s = run(base(), { type: 'ADD_BLOCK', block: a }, { type: 'ADD_BLOCK', block: c });
        s = scenarioReducer(s, {
            type: 'APPLY_DATE_DIFF', changes: [
                { id: 'a', startISO: '2026-09-01', endISO: '2026-09-05' },
                { id: 'c', startISO: '2026-09-10', endISO: '2026-09-14' },
            ],
        });
        s = scenarioReducer(s, { type: 'UNDO' });
        expect(s.scenario.Blocks.every(b => b.startISO === '2026-08-03')).toBe(true);
    });
});

describe('undo / redo', () => {
    test('undo vraća TAČNO prethodno stanje', () => {
        const b = block();
        const s1 = run(base(), { type: 'ADD_BLOCK', block: b });
        const before = s1.scenario;
        const s2 = run(s1, { type: 'MOVE_BLOCKS', ids: [b.id], days: 5 });
        const s3 = scenarioReducer(s2, { type: 'UNDO' });
        expect(s3.scenario).toEqual(before);
    });

    test('redo vraća poništeno', () => {
        const b = block();
        const s = run(base(),
            { type: 'ADD_BLOCK', block: b },
            { type: 'MOVE_BLOCKS', ids: [b.id], days: 5 },
            { type: 'UNDO' },
            { type: 'REDO' },
        );
        expect(s.scenario.Blocks[0].startISO).toBe('2026-08-08');
    });

    test('nova akcija poništava redo (grananje se ne čuva)', () => {
        const b = block();
        let s = run(base(),
            { type: 'ADD_BLOCK', block: b },
            { type: 'MOVE_BLOCKS', ids: [b.id], days: 5 },
            { type: 'UNDO' },
        );
        expect(canRedo(s)).toBe(true);
        s = scenarioReducer(s, { type: 'MOVE_BLOCKS', ids: [b.id], days: 1 });
        expect(canRedo(s)).toBe(false);
    });

    test('undo na praznoj istoriji ne ruši i ne mijenja stanje', () => {
        const s = base();
        expect(scenarioReducer(s, { type: 'UNDO' })).toBe(s);
        expect(scenarioReducer(s, { type: 'REDO' })).toBe(s);
        expect(canUndo(s)).toBe(false);
    });

    test('istorija je ograničena na UNDO_LIMIT', () => {
        const b = block();
        let s = run(base(), { type: 'ADD_BLOCK', block: b });
        for (let i = 0; i < UNDO_LIMIT + 20; i++) {
            s = scenarioReducer(s, { type: 'MOVE_BLOCKS', ids: [b.id], days: 1 });
        }
        expect(s.past.length).toBe(UNDO_LIMIT);
    });

    test('LOAD reset-uje istoriju — undo ne smije preći u prethodni scenarij', () => {
        const b = block();
        let s = run(base(), { type: 'ADD_BLOCK', block: b }, { type: 'MOVE_BLOCKS', ids: [b.id], days: 2 });
        expect(canUndo(s)).toBe(true);
        s = scenarioReducer(s, { type: 'LOAD', scenario: emptyScenario('org', 'Drugi') });
        expect(canUndo(s)).toBe(false);
        expect(s.scenario.Blocks).toHaveLength(0);
        expect(s.dirty).toBe(false);
    });
});

describe('pogled i izbor NE ulaze u undo', () => {
    test('promjena zuma ne pravi korak istorije', () => {
        const s1 = run(base(), { type: 'ADD_BLOCK', block: block() });
        const s2 = scenarioReducer(s1, { type: 'SET_VIEW', view: { zoom: 'mjesec' } });
        expect(s2.past.length).toBe(s1.past.length);
        expect(s2.scenario.View?.zoom).toBe('mjesec');
    });

    test('izbor ne pravi korak istorije', () => {
        const s1 = run(base(), { type: 'ADD_BLOCK', block: block() });
        const s2 = scenarioReducer(s1, { type: 'SELECT', ids: ['x'] });
        expect(s2.past.length).toBe(s1.past.length);
        expect(s2.selectedIds).toEqual(['x']);
    });

    test('undo poslije promjene zuma vraća SADRŽAJ, ne zum', () => {
        const b = block();
        const s = run(base(),
            { type: 'ADD_BLOCK', block: b },
            { type: 'MOVE_BLOCKS', ids: [b.id], days: 4 },
            { type: 'SET_VIEW', view: { zoom: 'dan' } },
            { type: 'UNDO' },
        );
        expect(s.scenario.Blocks[0].startISO).toBe('2026-08-03');
        expect(s.scenario.View?.zoom).toBe('dan');
    });
});

describe('spremanje', () => {
    test('MARK_SAVED čisti dirty i postavlja verziju', () => {
        const s = run(base(),
            { type: 'ADD_BLOCK', block: block() },
            { type: 'MARK_SAVED', version: 7 },
        );
        expect(s.dirty).toBe(false);
        expect(s.scenario.Version).toBe(7);
    });

    test('izmjena poslije spremanja opet prlja dokument', () => {
        const b = block();
        const s = run(base(),
            { type: 'ADD_BLOCK', block: b },
            { type: 'MARK_SAVED', version: 2 },
            { type: 'MOVE_BLOCKS', ids: [b.id], days: 1 },
        );
        expect(s.dirty).toBe(true);
    });
});
