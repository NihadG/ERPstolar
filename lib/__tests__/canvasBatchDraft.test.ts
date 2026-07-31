import {
    emptyBatchRow, newCrew, effectiveWorkerDaysPerUnit, rowWorkerDays, rowTitle,
    deriveProjectRef, isRowFilled, rowWarnings, rowToBlock, batchToBlocks, batchSummary,
    type BatchRow, type BatchProductPick,
} from '../canvas/batchDraft';
import { DEFAULT_OFFER_CREW, type ProductCandidate } from '../canvas/fromProducts';
import type { PlanRef } from '../types';

const START = '2026-08-03';   // ponedjeljak

const cand = (over: Partial<ProductCandidate> = {}): ProductCandidate => ({
    productId: 'p1', productName: 'Kuhinja', projectId: 'pr1', projectName: 'Novak',
    totalQty: 2, usedQty: 0, availableQty: 2,
    laborDays: 6, laborWorkers: 2, workerDaysPerUnit: 12,
    materialCount: 0, hasEssential: false, status: '', missingLabor: false, crewAssumed: false,
    productTypes: [], materialTypes: [], ...over,
});

const pick = (c: ProductCandidate, qty = 1, over: Partial<BatchProductPick> = {}): BatchProductPick =>
    ({ candidate: c, qty, ...over });

const ref = (id: string, name: string): PlanRef => ({ id, name });
const crew2 = () => newCrew(ref('w1', 'Ismet'), ref('w2', 'Adnan'));
const crew1 = () => newCrew(ref('w3', 'Mirza'));

const prodRow = (over: Partial<BatchRow> = {}): BatchRow =>
    ({ ...emptyBatchRow('proizvodni'), products: [pick(cand())], ...over });

// ════════════════════════════════════════════════════════════════════
describe('radnik-dani po komadu', () => {
    test('poznata ekipa iz ponude → vrijednost kandidata', () => {
        expect(effectiveWorkerDaysPerUnit(pick(cand()))).toBe(12);
    });

    test('crewAssumed bez ispravke → dani × norma (2)', () => {
        const c = cand({ laborDays: 6, laborWorkers: 0, workerDaysPerUnit: 12, crewAssumed: true });
        expect(effectiveWorkerDaysPerUnit(pick(c))).toBe(6 * DEFAULT_OFFER_CREW);
    });

    test('crewAssumed s ručnim brojem radnika → dani × taj broj', () => {
        const c = cand({ laborDays: 6, laborWorkers: 0, crewAssumed: true });
        expect(effectiveWorkerDaysPerUnit(pick(c, 1, { workersOverride: 3 }))).toBe(18);
    });

    test('missingLabor s ručnim radnik-danima → taj unos', () => {
        const c = cand({ laborDays: 0, workerDaysPerUnit: 0, missingLabor: true });
        expect(effectiveWorkerDaysPerUnit(pick(c, 1, { workerDaysPerUnitOverride: 5 }))).toBe(5);
    });
});

describe('radnik-dani reda', () => {
    test('proizvodni: zbir po komadu × količina', () => {
        const row = prodRow({ products: [pick(cand(), 2), pick(cand({ productId: 'p2', workerDaysPerUnit: 4 }), 3)] });
        expect(rowWorkerDays(row)).toBe(12 * 2 + 4 * 3);   // 36
    });

    test('montaza/razni: ručni unos', () => {
        expect(rowWorkerDays({ ...emptyBatchRow('montaza'), manualWorkerDays: 4 })).toBe(4);
        expect(rowWorkerDays({ ...emptyBatchRow('razni'), manualWorkerDays: 0 })).toBe(0);
    });
});

describe('naziv i projekt', () => {
    test('jedan proizvod → njegov naziv', () => {
        expect(rowTitle(prodRow())).toBe('Kuhinja');
    });

    test('više proizvoda istog projekta → „Projekt — N proizvoda"', () => {
        const row = prodRow({ products: [pick(cand()), pick(cand({ productId: 'p2', productName: 'Ormar' }))] });
        expect(rowTitle(row)).toBe('Novak — 2 proizvoda');
    });

    test('montaza/razni default naziv', () => {
        expect(rowTitle(emptyBatchRow('montaza'))).toBe('Montaža');
        expect(rowTitle(emptyBatchRow('razni'))).toBe('Razni nalog');
    });

    test('eksplicitan naziv ima prednost', () => {
        expect(rowTitle({ ...emptyBatchRow('razni'), title: '  Popravka  ' })).toBe('Popravka');
    });

    test('projekt se izvodi kad su svi proizvodi iz istog', () => {
        expect(deriveProjectRef(prodRow())).toEqual({ id: 'pr1', name: 'Novak' });
    });

    test('proizvodi iz DVA projekta → bez projekta', () => {
        const row = prodRow({ products: [pick(cand()), pick(cand({ projectId: 'pr2', projectName: 'Begović' }))] });
        expect(deriveProjectRef(row)).toBeUndefined();
    });
});

describe('validacija reda', () => {
    test('proizvodni bez proizvoda nije popunjen', () => {
        expect(isRowFilled(emptyBatchRow('proizvodni'))).toBe(false);
        expect(isRowFilled(prodRow())).toBe(true);
    });

    test('razni je popunjen ako ima naziv, radnik-dane ili ekipu', () => {
        expect(isRowFilled(emptyBatchRow('razni'))).toBe(false);
        expect(isRowFilled({ ...emptyBatchRow('razni'), title: 'X' })).toBe(true);
        expect(isRowFilled({ ...emptyBatchRow('razni'), manualWorkerDays: 3 })).toBe(true);
        expect(isRowFilled({ ...emptyBatchRow('razni'), crewOptions: [crew1()] })).toBe(true);
    });

    test('upozorenja: bez radnik-dana, crewAssumed, bez ekipe', () => {
        const bare = prodRow({ products: [pick(cand({ laborDays: 0, workerDaysPerUnit: 0, missingLabor: true }))] });
        expect(rowWarnings(bare)).toContain('no-worker-days');
        expect(rowWarnings(bare)).toContain('no-crew');

        const assumed = prodRow({
            products: [pick(cand({ laborDays: 6, laborWorkers: 0, crewAssumed: true }))],
            crewOptions: [crew2()],
        });
        expect(rowWarnings(assumed)).toContain('crew-assumed');
        expect(rowWarnings(assumed)).not.toContain('no-crew');

        const clean = prodRow({ crewOptions: [crew2()] });
        expect(rowWarnings(clean)).toEqual([]);
    });

    test('razriješen crewAssumed (ručni radnici) više nije upozorenje', () => {
        const row = prodRow({
            products: [pick(cand({ laborDays: 6, laborWorkers: 0, crewAssumed: true }), 1, { workersOverride: 2 })],
            crewOptions: [crew2()],
        });
        expect(rowWarnings(row)).not.toContain('crew-assumed');
    });
});

describe('red → blok', () => {
    const opts = { startISO: START };

    test('proizvodni → kind order, s productRefs i workerDays', () => {
        const b = rowToBlock(prodRow({ priority: 'high', crewOptions: [crew2()] }), opts);
        expect(b.kind).toBe('order');
        expect(b.workerDays).toBe(12);
        expect(b.productRefs).toEqual([{ id: 'p1', name: 'Kuhinja', qty: 1 }]);
        expect(b.projectRef).toEqual({ id: 'pr1', name: 'Novak' });
        expect(b.priority).toBe('high');
        expect(b.crewOptions).toHaveLength(1);
        expect(b.crew).toBe(2);                 // nominalna = veličina prve ekipe
        expect(b.endISO > b.startISO).toBe(true);
    });

    test('montaza → kind montaza, slobodan naziv, bez productRefs', () => {
        const b = rowToBlock({ ...emptyBatchRow('montaza'), title: 'Montaža Novak', manualWorkerDays: 2 }, opts);
        expect(b.kind).toBe('montaza');
        expect(b.title).toBe('Montaža Novak');
        expect(b.productRefs).toBeUndefined();
        expect(b.workerDays).toBe(2);
    });

    test('razni → kind order, bez proizvoda i projekta', () => {
        const b = rowToBlock({ ...emptyBatchRow('razni'), title: 'Servis', manualWorkerDays: 1 }, opts);
        expect(b.kind).toBe('order');
        expect(b.title).toBe('Servis');
        expect(b.productRefs).toBeUndefined();
        expect(b.projectRef).toBeUndefined();
    });

    test('bez radnik-dana → endISO == startISO (nema širine)', () => {
        const b = rowToBlock({ ...emptyBatchRow('razni'), title: 'X' }, opts);
        expect(b.endISO).toBe(b.startISO);
    });

    test('nominalna ekipa = norma kad nema kandidat-ekipa', () => {
        const b = rowToBlock(prodRow(), opts);
        expect(b.crew).toBe(DEFAULT_OFFER_CREW);
    });
});

describe('batchToBlocks', () => {
    test('prazni redovi se preskaču, popunjeni prave blokove', () => {
        const rows = [
            prodRow(),
            emptyBatchRow('proizvodni'),          // prazan
            { ...emptyBatchRow('montaza'), title: 'M', manualWorkerDays: 1 },
            emptyBatchRow('razni'),               // prazan
        ];
        const { blocks, skipped } = batchToBlocks(rows, { startISO: START });
        expect(blocks).toHaveLength(2);
        expect(skipped).toBe(2);
    });
});

describe('batchSummary', () => {
    test('broji redove, radnik-dane, crewAssumed i bez-ekipe', () => {
        const rows = [
            prodRow({ crewOptions: [crew2()] }),                                  // 12 rd, ekipa ok
            prodRow({ products: [pick(cand({ laborDays: 6, laborWorkers: 0, crewAssumed: true }))] }), // crewAssumed, bez ekipe
            emptyBatchRow('razni'),                                               // prazan, ne broji se
        ];
        const s = batchSummary(rows);
        expect(s.rowCount).toBe(2);
        expect(s.crewAssumedCount).toBe(1);
        expect(s.noCrewCount).toBe(1);
        expect(s.totalWorkerDays).toBe(12 + 6 * DEFAULT_OFFER_CREW);
    });
});
