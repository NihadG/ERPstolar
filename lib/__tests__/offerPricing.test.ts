// ════════════════════════════════════════════════════════════════════
// Testovi detekcije zastarjelih cijena ponude (lib/offerPricing.ts)
// Zastarjelost = snapshot Material_Cost u ponudi ≠ trenutni Product.Material_Cost.
// Pokriva i promjenu cijene postojećeg materijala i dodavanje/uklanjanje materijala
// (oboje mijenja Product.Material_Cost).
// ════════════════════════════════════════════════════════════════════

import { offerPriceChanges, isOfferStale } from '../offerPricing';
import type { Offer, Product } from '../types';

function product(id: string, materialCost: number): Product {
    return { Product_ID: id, Name: `P-${id}`, Material_Cost: materialCost } as Product;
}
function offer(products: { id: string; name: string; cost: number; included?: boolean }[]): Offer {
    return {
        Offer_ID: 'O1',
        products: products.map(p => ({
            ID: `op-${p.id}`, Offer_ID: 'O1', Product_ID: p.id, Product_Name: p.name,
            Material_Cost: p.cost, Included: p.included,
        })),
    } as unknown as Offer;
}

describe('offerPriceChanges', () => {
    it('nema promjene kad se snapshot poklapa s trenutnom cijenom', () => {
        const off = offer([{ id: 'a', name: 'Kuhinja', cost: 500 }]);
        expect(offerPriceChanges(off, [product('a', 500)])).toEqual([]);
        expect(isOfferStale(off, [product('a', 500)])).toBe(false);
    });

    it('detektuje poskupljenje materijala (delta pozitivna)', () => {
        const off = offer([{ id: 'a', name: 'Kuhinja', cost: 500 }]);
        const changes = offerPriceChanges(off, [product('a', 620)]);
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ productId: 'a', snapshot: 500, current: 620, delta: 120 });
        expect(isOfferStale(off, [product('a', 620)])).toBe(true);
    });

    it('dodavanje materijala (viši Product.Material_Cost) je takođe zastarjelost', () => {
        const off = offer([{ id: 'a', name: 'Ormar', cost: 300 }]);
        // proizvodu je dodan materijal → cijena narasla na 450
        expect(isOfferStale(off, [product('a', 450)])).toBe(true);
    });

    it('ignoriše isključene proizvode (Included === false)', () => {
        const off = offer([{ id: 'a', name: 'Kuhinja', cost: 500, included: false }]);
        expect(offerPriceChanges(off, [product('a', 900)])).toEqual([]);
    });

    it('ignoriše proizvod obrisan iz projekta (nije u listi)', () => {
        const off = offer([{ id: 'a', name: 'Kuhinja', cost: 500 }]);
        expect(offerPriceChanges(off, [])).toEqual([]);
    });

    it('tolerancija na nivou centa (0.004 razlike se ne broji)', () => {
        const off = offer([{ id: 'a', name: 'Kuhinja', cost: 500.001 }]);
        expect(isOfferStale(off, [product('a', 500.004)])).toBe(false);
    });
});
