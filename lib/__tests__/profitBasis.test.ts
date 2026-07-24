import { isChangeGateable, groupBasisReviewByProject, affectedWorkOrderIds, basisDriftReview, type ItemMaterialChange, type ItemDriftInput } from '../profitBasis';

function change(o: Partial<ItemMaterialChange> & { itemId: string; perUnitDelta: number }): ItemMaterialChange {
    return {
        workOrderId: 'WO1', workOrderStatus: 'U toku', isMontaza: false,
        projectId: 'P1', projectName: 'Klijent', productName: 'Proizvod',
        quantity: 1, basisPerUnit: 100,
        ...o,
    };
}

describe('isChangeGateable — koje izmjene idu u pregled', () => {
    test('aktivna proizvodna stavka → gateable', () => {
        expect(isChangeGateable(change({ itemId: 'a', perUnitDelta: 10 }))).toBe(true);
    });
    test('montaža → nikad (nema materijal)', () => {
        expect(isChangeGateable(change({ itemId: 'a', perUnitDelta: 10, isMontaza: true }))).toBe(false);
    });
    test('otkazan nalog → nikad', () => {
        expect(isChangeGateable(change({ itemId: 'a', perUnitDelta: 10, workOrderStatus: 'Otkazano' }))).toBe(false);
    });
    test('završena stavka → zamrznuta, ne nudi se', () => {
        expect(isChangeGateable(change({ itemId: 'a', perUnitDelta: 10, Status: 'Završeno' }))).toBe(false);
        expect(isChangeGateable(change({ itemId: 'a', perUnitDelta: 10, Completed_At: '2026-01-01' }))).toBe(false);
    });
    test('ručna cijena (manual) → poštuje se, ne nudi se', () => {
        expect(isChangeGateable(change({ itemId: 'a', perUnitDelta: 10, Material_Cost_Source: 'manual' }))).toBe(false);
    });
});

describe('groupBasisReviewByProject — grupisanje + Δ po projektu', () => {
    test('materijalna delta × količina; profit delta = −materijal', () => {
        // Ploča poskupila +40/komad, proizvod ide u 1.35 „komada" (m²).
        const rows = groupBasisReviewByProject([
            change({ itemId: 'i1', perUnitDelta: 40, quantity: 1.35, basisPerUnit: 740 }),
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0].materialDelta).toBeCloseTo(54, 1);      // 40 × 1.35
        expect(rows[0].profitDelta).toBeCloseTo(-54, 1);
        expect(rows[0].items[0].newBasisPerUnit).toBeCloseTo(780, 1);  // 740 + 40
    });

    test('više projekata → odvojeni redovi; zamrznute/montaža izostavljene', () => {
        const rows = groupBasisReviewByProject([
            change({ itemId: 'i1', perUnitDelta: 10, projectId: 'A', projectName: 'Klijent A', quantity: 2 }),
            change({ itemId: 'i2', perUnitDelta: 10, projectId: 'B', projectName: 'Klijent B', quantity: 1 }),
            change({ itemId: 'i3', perUnitDelta: 10, projectId: 'A', projectName: 'Klijent A', Status: 'Završeno' }), // izostavljen
            change({ itemId: 'i4', perUnitDelta: 10, projectId: 'C', projectName: 'Klijent C', isMontaza: true }),   // izostavljen
        ]);
        const byId = Object.fromEntries(rows.map(r => [r.projectId, r]));
        expect(Object.keys(byId).sort()).toEqual(['A', 'B']);
        expect(byId['A'].materialDelta).toBeCloseTo(20, 1);   // samo i1 (10×2)
        expect(byId['A'].items).toHaveLength(1);
        expect(byId['B'].materialDelta).toBeCloseTo(10, 1);
    });

    test('isti proizvod u dva naloga → svaka stavka svoja nova osnovica', () => {
        const rows = groupBasisReviewByProject([
            change({ itemId: 'i1', workOrderId: 'WO1', perUnitDelta: 25, basisPerUnit: 100 }),
            change({ itemId: 'i2', workOrderId: 'WO2', perUnitDelta: 25, basisPerUnit: 130 }), // druga osnovica
        ]);
        expect(rows[0].items).toHaveLength(2);
        const news = rows[0].items.map(i => i.newBasisPerUnit).sort((a, b) => a - b);
        expect(news).toEqual([125, 155]);   // svaka osnovica + 25
        expect(affectedWorkOrderIds(rows).sort()).toEqual(['WO1', 'WO2']);
    });

    test('izmjena bez efekta (perUnitDelta 0) se izostavlja', () => {
        expect(groupBasisReviewByProject([change({ itemId: 'i1', perUnitDelta: 0 })])).toHaveLength(0);
    });
});

describe('basisDriftReview — badge „profit zastario" (živo vs osnovica)', () => {
    function drift(o: Partial<ItemDriftInput> & { itemId: string; basisPerUnit: number; livePerUnit: number }): ItemDriftInput {
        return {
            workOrderId: 'WO1', workOrderStatus: 'U toku', isMontaza: false,
            projectId: 'P1', projectName: 'Klijent', productName: 'Proizvod', quantity: 1,
            ...o,
        };
    }
    test('perUnitDelta = živo − osnovica; sinhronizacija cilja živo', () => {
        // osnovica 740, živo 780 (poskupjelo), 1.35 komada
        const rows = basisDriftReview([drift({ itemId: 'i1', basisPerUnit: 740, livePerUnit: 780, quantity: 1.35 })]);
        expect(rows).toHaveLength(1);
        expect(rows[0].materialDelta).toBeCloseTo(54, 1);         // (780−740)×1.35
        expect(rows[0].profitDelta).toBeCloseTo(-54, 1);
        expect(rows[0].items[0].newBasisPerUnit).toBeCloseTo(780, 1);  // → živo
    });
    test('bez zaostajanja (živo == osnovica) → prazno (nema badge)', () => {
        expect(basisDriftReview([drift({ itemId: 'i1', basisPerUnit: 500, livePerUnit: 500 })])).toHaveLength(0);
    });
    test('zamrznuta/montaža stavka se ne prikazuje u driftu', () => {
        expect(basisDriftReview([drift({ itemId: 'i1', basisPerUnit: 100, livePerUnit: 200, Status: 'Završeno' })])).toHaveLength(0);
        expect(basisDriftReview([drift({ itemId: 'i2', basisPerUnit: 100, livePerUnit: 200, isMontaza: true })])).toHaveLength(0);
    });

    test('„odbijeno ostaje odbijeno": druga (odobrena) izmjena nosi samo svoj efekat', () => {
        // Izmjena 1 (+20) je ODBIJENA → osnovica ostaje 100 (ništa se ne primijeni).
        // Izmjena 2 (+10) je odobrena → primjenjuje se BAŠ +10 na osnovicu 100 = 110,
        // a NE „živo (130) − osnovica (100)". Simuliramo drugu izmjenu na netaknutoj osnovici.
        const rows = groupBasisReviewByProject([
            change({ itemId: 'i1', perUnitDelta: 10, basisPerUnit: 100, quantity: 1 }),
        ]);
        expect(rows[0].items[0].newBasisPerUnit).toBeCloseTo(110, 1);  // ne 130
    });
});
