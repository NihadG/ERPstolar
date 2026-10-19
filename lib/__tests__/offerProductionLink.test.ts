import {
    acceptedOfferProduct,
    projectStatusOnOfferAccepted,
    linkOfferToProduction,
    type LinkItem,
    type LinkWorkOrder,
} from '../offerProductionLink';
import { buildFinanceBasis, buildLaborIndex, computeProjectFinance, type FinOffer, type FinWorkOrder } from '../projectFinance';

describe('acceptedOfferProduct — stavka prihvaćene ponude za proizvod', () => {
    const offers = [
        { Status: 'Prihvaćeno', Accepted_Date: '2026-03-01', products: [{ Product_ID: 'a', Selling_Price: 100 }] },
        { Status: 'Prihvaćeno', Accepted_Date: '2026-05-01', products: [{ Product_ID: 'b', Selling_Price: 200 }, { Product_ID: 'a', Selling_Price: 150 }] },
        { Status: 'Nacrt', products: [{ Product_ID: 'c', Selling_Price: 300 }] },
    ];

    test('faze: proizvod iz DRUGE prihvaćene ponude se nalazi (ranije: samo prva prihvaćena)', () => {
        expect(acceptedOfferProduct(offers, 'b')?.Selling_Price).toBe(200);
    });
    test('isti proizvod u dvije prihvaćene → novije prihvaćena ima prednost (kao buildFinanceBasis)', () => {
        expect(acceptedOfferProduct(offers, 'a')?.Selling_Price).toBe(150);
    });
    test('neprihvaćena ponuda se ne računa', () => {
        expect(acceptedOfferProduct(offers, 'c')).toBeUndefined();
    });
    test('isključen red se preskače, traži se dalje', () => {
        const o = [
            { Status: 'Prihvaćeno', Accepted_Date: '2026-06-01', products: [{ Product_ID: 'a', Included: false, Selling_Price: 999 }] },
            { Status: 'Prihvaćeno', Accepted_Date: '2026-01-01', products: [{ Product_ID: 'a', Included: true, Selling_Price: 120 }] },
        ];
        expect(acceptedOfferProduct(o, 'a')?.Selling_Price).toBe(120);
    });
    test('bez ponuda → undefined', () => {
        expect(acceptedOfferProduct(undefined, 'a')).toBeUndefined();
    });
});

describe('projectStatusOnOfferAccepted — status ide samo naprijed', () => {
    test.each([
        ['Nacrt', 'Odobreno'],
        ['Ponuđeno', 'Odobreno'],
        ['Otkazano', 'Odobreno'],
        [undefined, 'Odobreno'],
        ['Odobreno', null],
        ['U proizvodnji', null],   // nalog pušten prije ponude — ne vraćaj nazad
        ['Završeno', null],
    ] as [string | undefined, string | null][])('%s → %s', (current, expected) => {
        expect(projectStatusOnOfferAccepted(current)).toBe(expected);
    });
});

describe('linkOfferToProduction — šta je već u nalogu, šta tek treba', () => {
    const workOrders: LinkWorkOrder[] = [
        { Work_Order_ID: 'w1', Work_Order_Number: '2026-06/R3', Status: 'Završeno', Work_Order_Type: 'Proizvodnja' },
        { Work_Order_ID: 'w2', Work_Order_Number: '2026-07/R1', Status: 'U toku', Work_Order_Type: 'Proizvodnja' },
        { Work_Order_ID: 'w3', Work_Order_Number: '2026-07/R2', Status: 'Otkazano', Work_Order_Type: 'Proizvodnja' },
        { Work_Order_ID: 'm1', Work_Order_Number: '2026-08/M1', Status: 'U toku', Work_Order_Type: 'Montaža' },
    ];
    const items: LinkItem[] = [
        { Product_ID: 'kuhinja', Quantity: 1, Status: 'Završeno', Work_Order_ID: 'w1' },
        { Product_ID: 'ormar', Quantity: 1, Status: 'U toku', Work_Order_ID: 'w2' },
        { Product_ID: 'vrata', Quantity: 2, Status: 'U toku', Work_Order_ID: 'w3' },   // otkazan nalog
        { Product_ID: 'kuhinja', Quantity: 1, Status: 'U toku', Work_Order_ID: 'm1' }, // montaža ne troši količinu
    ];
    const offerProducts = [
        { Product_ID: 'kuhinja', Product_Name: 'Kuhinja', Quantity: 1, Included: true },
        { Product_ID: 'ormar', Product_Name: 'Ormar', Quantity: 3, Included: true },
        { Product_ID: 'vrata', Product_Name: 'Vrata', Quantity: 2, Included: true },
        { Product_ID: 'polica', Product_Name: 'Polica', Quantity: 1, Included: false },
    ];

    const link = linkOfferToProduction(offerProducts, items, workOrders);

    test('završen proizvod pušten prije ponude je POVEZAN, ne nudi se novi nalog', () => {
        const k = link.linked.find(l => l.productId === 'kuhinja');
        expect(k).toEqual({ productId: 'kuhinja', productName: 'Kuhinja', offerQty: 1, inProductionQty: 1, finished: true, workOrderNumbers: ['2026-06/R3'] });
        expect(link.toStart.find(t => t.productId === 'kuhinja')).toBeUndefined();
    });
    test('djelimično u nalogu → povezan (u izradi) + ostatak količine za novi nalog', () => {
        const o = link.linked.find(l => l.productId === 'ormar');
        expect(o?.finished).toBe(false);
        expect(o?.inProductionQty).toBe(1);
        expect(link.toStart).toContainEqual({ productId: 'ormar', productName: 'Ormar', quantity: 2 });
    });
    test('otkazan nalog se ne broji — proizvod ide u „tek treba"', () => {
        expect(link.linked.find(l => l.productId === 'vrata')).toBeUndefined();
        expect(link.toStart).toContainEqual({ productId: 'vrata', productName: 'Vrata', quantity: 2 });
    });
    test('isključen proizvod ponude se ignoriše', () => {
        expect([...link.linked, ...link.toStart].some(x => x.productId === 'polica')).toBe(false);
    });
});

describe('profit: nalog prije ponude → prihvaćena ponuda se poveže sama', () => {
    // Proizvod je proizveden i završen BEZ ponude; ponuda je prihvaćena tek poslije.
    const products = [{ Product_ID: 'p1', Project_ID: 'pr1', Name: 'Kuhinja', Quantity: 1, Status: 'Spremno', materials: [{ Total_Price: 1000 }] }];
    const workOrders: FinWorkOrder[] = [{
        Work_Order_ID: 'w1', Work_Order_Number: '2026-06/R3', Status: 'Završeno', Work_Order_Type: 'Proizvodnja',
        items: [{ ID: 'i1', Work_Order_ID: 'w1', Product_ID: 'p1', Project_ID: 'pr1', Quantity: 1, Status: 'Završeno', Completed_At: '2026-06-20T10:00:00Z' }],
    }];
    const logs = [{ Work_Order_ID: 'w1', Work_Order_Item_ID: 'i1', Product_ID: 'p1', Daily_Rate: 300, Day_Fraction: 1, Date: '2026-06-18' }];
    const labor = buildLaborIndex(logs, workOrders);
    const lateOffer: FinOffer = {
        Offer_ID: 'o1', Project_ID: 'pr1', Offer_Number: 'P-2026/30', Status: 'Prihvaćeno', Accepted_Date: '2026-07-14T09:00:00Z',
        products: [{ Product_ID: 'p1', Included: true, Quantity: 1, Selling_Price: 2500 }],
    };

    test('prije prihvatanja: prihod s naloga (0), oznaka „bez ponude"', () => {
        const fin = computeProjectFinance({ projectId: 'pr1', products, basis: buildFinanceBasis(products, []), workOrders, labor, logs });
        const row = fin.products[0];
        expect(row.revenueSource).toBe('nalog');
        expect(row.flags.noOffer).toBe(true);
        expect(fin.profit).toBe(-1300);
    });
    test('poslije prihvatanja: završen proizvod računa cijenu iz ponude, bez ikakvog ručnog koraka', () => {
        const fin = computeProjectFinance({ projectId: 'pr1', products, basis: buildFinanceBasis(products, [lateOffer]), workOrders, labor, logs });
        const row = fin.products[0];
        expect(row.revenueSource).toBe('ponuda');
        expect(row.offerNumber).toBe('P-2026/30');
        expect(row.flags.noOffer).toBe(false);
        expect(row.stage).toBe('zavrseno');
        expect(fin.revenue).toBe(2500);
        expect(fin.profit).toBe(2500 - 1000 - 300);
        expect(fin.contracted).toBe(2500);
    });
});
