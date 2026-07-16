import { resolveLaborCostTarget, type LaborTargetItem } from '../laborTarget';

function mapOf(items: LaborTargetItem[]): Map<string, LaborTargetItem> {
    return new Map(items.map(i => [i.ID, i]));
}

describe('resolveLaborCostTarget — povezani "razni poslovi" → trošak na proizvod', () => {
    const product: LaborTargetItem = { ID: 'P1', Work_Order_ID: 'WO-prod', Product_ID: 'prod-1', Product_Name: 'Ormar', Item_Type: 'product' };
    const customLinked: LaborTargetItem = { ID: 'C1', Work_Order_ID: 'WO-zad', Product_ID: 'custom-x', Product_Name: 'Montaža vrata', Item_Type: 'custom', Linked_Item_ID: 'P1' };
    const customUnlinked: LaborTargetItem = { ID: 'C2', Work_Order_ID: 'WO-zad', Product_ID: 'custom-y', Product_Name: 'Čišćenje pogona', Item_Type: 'custom' };

    test('custom + Linked_Item_ID koji postoji → preusmjeri na povezani proizvod', () => {
        const r = resolveLaborCostTarget(customLinked, mapOf([product, customLinked]));
        expect(r.redirected).toBe(true);
        expect(r.target.ID).toBe('P1');
        expect(r.target.Work_Order_ID).toBe('WO-prod');
        expect(r.target.Product_ID).toBe('prod-1');
        expect(r.source?.ID).toBe('C1');
    });

    test('obična (product) stavka → nema preusmjeravanja', () => {
        const r = resolveLaborCostTarget(product, mapOf([product]));
        expect(r.redirected).toBe(false);
        expect(r.target.ID).toBe('P1');
        expect(r.source).toBeUndefined();
    });

    test('custom bez veze → nema preusmjeravanja (samostalan trošak)', () => {
        const r = resolveLaborCostTarget(customUnlinked, mapOf([customUnlinked]));
        expect(r.redirected).toBe(false);
        expect(r.target.ID).toBe('C2');
    });

    test('custom s vezom na NEPOSTOJEĆU (obrisanu) stavku → pada na sam zadatak (ne gubi trošak)', () => {
        const r = resolveLaborCostTarget(customLinked, mapOf([customLinked])); // P1 nije u mapi
        expect(r.redirected).toBe(false);
        expect(r.target.ID).toBe('C1');
    });

    test('povezan i sa ZAVRŠENIM proizvodom → i dalje preusmjeri (rad nije zamrznut kao materijal)', () => {
        const finished: LaborTargetItem = { ...product, ID: 'PF', Product_ID: 'prod-f' };
        const linkToFinished: LaborTargetItem = { ...customLinked, ID: 'CF', Linked_Item_ID: 'PF' };
        const r = resolveLaborCostTarget(linkToFinished, mapOf([finished, linkToFinished]));
        expect(r.redirected).toBe(true);
        expect(r.target.ID).toBe('PF');
    });
});
