/**
 * Unit testovi za prirodno sortiranje (lib/naturalCompare.ts) i lib/sortProducts.ts.
 * Pokriva bug iz PDF-a: CSV proizvodi moraju uvijek biti E1 < E2 < E10 i 1 < 2 < 10.
 */

import { naturalCompare } from '../naturalCompare';
import { sortProductsByName } from '../sortProducts';

describe('naturalCompare', () => {
    test('E-serija: brojevi po vrijednosti, ne leksikografski', () => {
        const sorted = ['E1', 'E10', 'E2', 'E11', 'E3'].sort(naturalCompare);
        expect(sorted).toEqual(['E1', 'E2', 'E3', 'E10', 'E11']);
    });

    test('čisti brojevi: 1 < 2 < 10 < 11', () => {
        const sorted = ['1', '10', '2', '11'].sort(naturalCompare);
        expect(sorted).toEqual(['1', '2', '10', '11']);
    });

    test('case/akcenat neosjetljivo za šifre', () => {
        expect(naturalCompare('e1', 'E1')).toBe(0);
    });

    test('prazne/undefined vrijednosti ne pucaju', () => {
        expect(naturalCompare(undefined, 'A')).toBeLessThan(0);
        expect(naturalCompare('A', null)).toBeGreaterThan(0);
        expect(naturalCompare(undefined, null)).toBe(0);
    });
});

describe('sortProductsByName', () => {
    const wrap = (names: string[]) => names.map(n => ({ Name: n }));
    const names = (items: { Name: string }[]) => items.map(i => i.Name);

    test('E-serija bez "poz" prefiksa se sortira prirodno (regresija iz PDF-a)', () => {
        const out = sortProductsByName(wrap(['E1', 'E10', 'E2', 'E3']), p => p.Name);
        expect(names(out)).toEqual(['E1', 'E2', 'E3', 'E10']);
    });

    test('hijerarhijske "Poz" pozicije: 1 < 1.1 < 1.2 < 2 < 10', () => {
        const out = sortProductsByName(
            wrap(['Poz 10', 'Poz 2', 'Poz 1.2', 'Poz 1', 'Poz 1.1']),
            p => p.Name,
        );
        expect(names(out)).toEqual(['Poz 1', 'Poz 1.1', 'Poz 1.2', 'Poz 2', 'Poz 10']);
    });

    test('pozicionirani proizvodi dolaze prije nepozicioniranih', () => {
        const out = sortProductsByName(wrap(['Ormar', 'Poz 1', 'Astal']), p => p.Name);
        expect(names(out)[0]).toBe('Poz 1');
    });

    test('ne mutira ulazni niz', () => {
        const input = wrap(['E10', 'E1']);
        const snapshot = names(input);
        sortProductsByName(input, p => p.Name);
        expect(names(input)).toEqual(snapshot);
    });
});
