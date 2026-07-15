import { buildInvoiceLines, distributeAmountByQuantity } from '../invoicePricing';
import type { OfferProduct, Product } from '../types';

function offerProduct(opts: Partial<OfferProduct> & { Product_ID: string }): OfferProduct {
    return {
        ID: 'op-' + opts.Product_ID, Offer_ID: 'O1', Product_Name: 'Proizvod', Quantity: 1, Included: true,
        Material_Cost: 0, Margin: 0, Margin_Type: 'Fixed', LED_Meters: 0, LED_Price: 0, LED_Total: 0,
        Grouting: false, Grouting_Price: 0, Sink_Faucet: false, Sink_Faucet_Price: 0,
        Transport_Share: 0, Discount_Share: 0, Selling_Price: 0, Total_Price: 0,
        Labor_Workers: 0, Labor_Days: 0, Labor_Daily_Rate: 0,
        ...opts,
    } as OfferProduct;
}

function product(opts: Partial<Product> & { Product_ID: string }): Product {
    return {
        Project_ID: 'P1', Name: 'Proizvod', Quantity: 1, Status: 'Na čekanju', Material_Cost: 0,
        ...opts,
    } as Product;
}

describe('buildInvoiceLines — formula paritet sa OffersTab calculateProductTotal (bez množenja količinom)', () => {
    test('rekalkulisana cijena = trenutni materijal + marža + usluge(extras) + rad, PO KOMADU', () => {
        const offerProducts = [offerProduct({
            Product_ID: 'PA', Product_Name: 'Stol', Quantity: 2, Selling_Price: 800, Margin: 200,
            Labor_Workers: 2, Labor_Days: 1, Labor_Daily_Rate: 65,
            extras: [{ ID: 'e1', Offer_Product_ID: 'op-PA', Name: 'Ugradnja', Quantity: 1, Unit: 'kom', Unit_Price: 50, Total: 50 }],
        })];
        const projectProducts = [product({
            Product_ID: 'PA',
            materials: [{ ID: 'm1', Product_ID: 'PA', Material_ID: 'M1', Name: 'Ploča', Quantity: 1, Unit_Price: 300, Total_Price: 300 } as any],
        })];
        const [line] = buildInvoiceLines(offerProducts, projectProducts);
        // rekalkulacija: 300 (materijal) + 200 (marža) + 50 (usluge) + 2×1×65=130 (rad) = 680
        expect(line.recalculatedUnitPrice).toBe(680);
        expect(line.offerUnitPrice).toBe(800);
        expect(line.finalUnitPrice).toBe(800); // default = ponuda
        expect(line.finalTotal).toBe(1600); // 800 × 2 (qty)
        expect(line.priceSource).toBe('offer');
    });

    test('isključeni proizvodi (Included=false) se ne uzimaju u obzir', () => {
        const offerProducts = [
            offerProduct({ Product_ID: 'PA', Included: true, Selling_Price: 500 }),
            offerProduct({ Product_ID: 'PB', Included: false, Selling_Price: 999 }),
        ];
        const lines = buildInvoiceLines(offerProducts, []);
        expect(lines).toHaveLength(1);
        expect(lines[0].productId).toBe('PA');
    });

    test('proizvod obrisan iz projekta → fallback na snapshot Material_Cost iz ponude', () => {
        const offerProducts = [offerProduct({ Product_ID: 'PA', Selling_Price: 500, Material_Cost: 150, Margin: 100 })];
        const [line] = buildInvoiceLines(offerProducts, []); // projekat nema taj proizvod
        expect(line.recalculatedUnitPrice).toBe(250); // 150 (snapshot) + 100 (marža)
    });

    test('bez ijednog materijala na proizvodu → materijal 0 u rekalkulaciji', () => {
        const offerProducts = [offerProduct({ Product_ID: 'PA', Selling_Price: 300, Margin: 300 })];
        const projectProducts = [product({ Product_ID: 'PA', materials: [] })];
        const [line] = buildInvoiceLines(offerProducts, projectProducts);
        expect(line.recalculatedUnitPrice).toBe(300); // samo marža
    });
});

describe('distributeAmountByQuantity — cent-tačna raspodjela (bez drifta)', () => {
    test('jedan dio → cijeli iznos', () => {
        const out = distributeAmountByQuantity(1234.56, [{ id: 'a', qty: 3 }]);
        expect(out).toEqual([{ id: 'a', amount: 1234.56 }]);
    });

    test('dva dijela proporcionalno količini, bez ostatka', () => {
        const out = distributeAmountByQuantity(900, [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }]);
        expect(out).toEqual([{ id: 'a', amount: 300 }, { id: 'b', amount: 600 }]);
        expect(out.reduce((s, o) => s + o.amount, 0)).toBe(900);
    });

    test('ostatak (zaokruživanje na cent) ide POSLJEDNJEM dijelu — Σ == total tačno', () => {
        // 100 / 3 = 33.333... → 33.33 + 33.33 + 33.34 = 100.00 (ne 99.99 ili 100.01)
        const out = distributeAmountByQuantity(100, [{ id: 'a', qty: 1 }, { id: 'b', qty: 1 }, { id: 'c', qty: 1 }]);
        const sum = out.reduce((s, o) => s + o.amount, 0);
        expect(Math.round(sum * 100) / 100).toBe(100);
        expect(out[0].amount).toBe(33.33);
        expect(out[1].amount).toBe(33.33);
        expect(out[2].amount).toBe(33.34); // ostatak
    });

    test('qty<=0 tretira se kao 1 (isto kao itemMaterialTotal)', () => {
        const out = distributeAmountByQuantity(200, [{ id: 'a', qty: 0 }, { id: 'b', qty: 1 }]);
        expect(out).toEqual([{ id: 'a', amount: 100 }, { id: 'b', amount: 100 }]);
    });

    test('prazna lista dijelova → prazan rezultat', () => {
        expect(distributeAmountByQuantity(500, [])).toEqual([]);
    });

    test('više dijelova (proizvod podijeljen na 3+ naloga)', () => {
        const out = distributeAmountByQuantity(1000, [{ id: 'a', qty: 2 }, { id: 'b', qty: 3 }, { id: 'c', qty: 5 }]);
        expect(out).toEqual([{ id: 'a', amount: 200 }, { id: 'b', amount: 300 }, { id: 'c', amount: 500 }]);
    });
});
