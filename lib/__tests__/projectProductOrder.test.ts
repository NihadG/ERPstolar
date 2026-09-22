import { productStage, sortProjectProducts } from '../projectProductOrder';
import type { Product, WorkOrder } from '../types';

const product = (id: string, name: string, status: string, materials = 0): Product => ({
    Product_ID: id, Name: name, Status: status,
    materials: Array.from({ length: materials }, (_, i) => ({ ID: `${id}-m${i}` })),
} as unknown as Product);

const order = (type: string, productId: string, itemStatus = 'U toku'): WorkOrder => ({
    Work_Order_ID: `wo-${productId}-${type}`, Status: 'U toku', Work_Order_Type: type,
    items: [{ ID: `it-${productId}`, Product_ID: productId, Status: itemStatus }],
} as unknown as WorkOrder);

describe('sortProjectProducts — status → materijal → abeceda', () => {
    test('status ide prvi: proizvodnja, montaža, čekanje, završeno', () => {
        const products = [
            product('a', 'A gotov', 'Spremno', 2),
            product('b', 'B čeka', 'Na čekanju', 2),
            product('c', 'C montaža', 'Montaža', 2),
            product('d', 'D proizvodnja', 'Rezanje', 2),
        ];
        const sorted = sortProjectProducts(products, [order('Proizvodnja', 'd')]);
        expect(sorted.map(p => p.Product_ID)).toEqual(['d', 'c', 'b', 'a']);
    });

    test('unutar istog statusa: s materijalom ispred bez materijala', () => {
        const products = [
            product('a', 'Aaa', 'Na čekanju', 0),
            product('b', 'Bbb', 'Na čekanju', 3),
            product('c', 'Ccc', 'Na čekanju', 0),
            product('d', 'Ddd', 'Na čekanju', 1),
        ];
        expect(sortProjectProducts(products, []).map(p => p.Name)).toEqual(['Bbb', 'Ddd', 'Aaa', 'Ccc']);
    });

    test('pa abecedno, prirodno za brojeve', () => {
        const products = [
            product('a', 'Poz 10 — Ormar', 'Na čekanju', 1),
            product('b', 'Poz 2 — Vrata', 'Na čekanju', 1),
            product('c', 'poz 1 — Kuhinja', 'Na čekanju', 1),
        ];
        expect(sortProjectProducts(products, []).map(p => p.Product_ID)).toEqual(['c', 'b', 'a']);
    });

    test('ne mijenja ulaznu listu', () => {
        const products = [product('b', 'B', 'Na čekanju'), product('a', 'A', 'Na čekanju')];
        sortProjectProducts(products, []);
        expect(products.map(p => p.Product_ID)).toEqual(['b', 'a']);
    });
});

describe('productStage', () => {
    test('ime procesa bez aktivnog naloga = na čekanju (zastario status)', () => {
        expect(productStage(product('x', 'X', 'Kantiranje'), [])).toBe('Na čekanju');
    });
    test('ime procesa potvrđeno stavkom u toku = u proizvodnji', () => {
        expect(productStage(product('x', 'X', 'Kantiranje'), [order('Proizvodnja', 'x')])).toBe('U proizvodnji');
    });
    test('aktivan montažni nalog = u montaži', () => {
        expect(productStage(product('x', 'X', 'Sklapanje na licu mjesta'), [order('Montaža', 'x')])).toBe('U montaži');
    });
    test('poznati statusi', () => {
        expect(productStage(product('x', 'X', 'Materijali spremni'), [])).toBe('Na čekanju');
        expect(productStage(product('x', 'X', 'Instalirano'), [])).toBe('Završeno');
        expect(productStage(product('x', 'X', 'Transport'), [])).toBe('U montaži');
        expect(productStage(product('x', 'X', ''), [])).toBe('Na čekanju');
    });
});
