import { isMaterialOrderable, materialCoverage, settledMaterialStatus } from '../materialCoverage';

const mat = (over: Record<string, unknown> = {}) => ({ Quantity: 25, Status: 'Nije naručeno', ...over }) as any;

describe('materialCoverage', () => {
    it('ostatak djelimične narudžbe ostaje za naručivanje', () => {
        const c = materialCoverage(mat({ Status: 'Naručeno', Ordered_Quantity: 5 }));
        expect(c.toOrder).toBe(20);
        expect(c.open).toBe(20);
    });

    it('množi količinom proizvoda i odbija zalihu, naručeno i primljeno', () => {
        const c = materialCoverage(mat({ Quantity: 3, On_Stock: 1, Ordered_Quantity: 2, Received_Quantity: 1 }), 4);
        expect(c.needed).toBe(12);
        expect(c.open).toBe(9);      // zaliha se ne oduzima — čarobnjak je unosi sam
        expect(c.toOrder).toBe(8);
    });

    it('stari zapis bez količina i „Na stanju" su pokriveni', () => {
        expect(isMaterialOrderable(mat({ Status: 'Naručeno' }))).toBe(false);
        expect(isMaterialOrderable(mat({ Status: 'Primljeno' }))).toBe(false);
        expect(isMaterialOrderable(mat({ Status: 'Na stanju', On_Stock: 3 }))).toBe(false);
        expect(isMaterialOrderable(mat({ Status: 'Primljeno', Received_Quantity: 10 }))).toBe(true);
    });

    it('naručeno preko potrebe nije negativno', () => {
        expect(materialCoverage(mat({ Status: 'Naručeno', Ordered_Quantity: 30 })).toOrder).toBe(0);
    });
});

describe('settledMaterialStatus', () => {
    it('prijem jedne od dvije narudžbe ostavlja „Naručeno"', () => {
        expect(settledMaterialStatus('Primljeno', 20, 5)).toBe('Naručeno');
        expect(settledMaterialStatus('Primljeno', 0, 25)).toBe('Primljeno');
    });

    it('vraćanje jedne narudžbe u nacrt ne briše drugu', () => {
        expect(settledMaterialStatus('Nije naručeno', 5, 0)).toBe('Naručeno');
        expect(settledMaterialStatus('Nije naručeno', 0, 5)).toBe('Primljeno');
        expect(settledMaterialStatus('Nije naručeno', 0, 0)).toBe('Nije naručeno');
    });
});
