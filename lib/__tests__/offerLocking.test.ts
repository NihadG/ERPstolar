import { isRowLocked, mergeOfferProducts } from '../offerLocking';

interface TestExisting {
    ID: string;
    Product_ID: string;
    Selling_Price?: number;
    Total_Price?: number;
    Included?: boolean;
}
interface TestIncoming {
    Product_ID: string;
    Product_Name?: string;
    Included?: boolean;
}

describe('isRowLocked — matrica pravila (status × cijena)', () => {
    test.each([
        ['Nacrt', 500, false],
        ['Poslano', 0, false],
        ['Poslano', 500, true],
        ['Prihvaćeno', 0, false],
        ['Prihvaćeno', 500, true],
        ['Odbijeno', 500, false],
        ['Isteklo', 500, false],
        ['Revidirano', 500, false],
        [undefined, 500, false],
    ] as [string | undefined, number, boolean][])('status=%s, Selling_Price=%d → locked=%s', (status, price, expected) => {
        expect(isRowLocked(status, { Selling_Price: price })).toBe(expected);
    });

    test('Total_Price>0 zaključava red i kad je Selling_Price 0/undefined', () => {
        expect(isRowLocked('Prihvaćeno', { Total_Price: 300 })).toBe(true);
        expect(isRowLocked('Prihvaćeno', { Selling_Price: 0, Total_Price: 300 })).toBe(true);
    });

    test('oba polja 0/undefined → nikad zaključano bez obzira na status', () => {
        expect(isRowLocked('Prihvaćeno', {})).toBe(false);
        expect(isRowLocked('Poslano', { Selling_Price: 0, Total_Price: 0 })).toBe(false);
    });
});

describe('mergeOfferProducts — inkrementalni tok (dio proizvoda definisan, dio prazan)', () => {
    test('4 od 15 proizvoda ima cijenu (Prihvaćeno) → ta 4 zaključana, ostalih 11 slobodno editabilno i snima se', () => {
        const existing: TestExisting[] = [
            { ID: 'e1', Product_ID: 'P1', Selling_Price: 800, Total_Price: 800, Included: true },
            { ID: 'e2', Product_ID: 'P2', Selling_Price: 0, Total_Price: 0, Included: true }, // prazan red
        ];
        const incoming: TestIncoming[] = [
            { Product_ID: 'P1', Product_Name: 'Stol (pokušaj izmjene)', Included: true }, // pokušaj izmjene zaključanog
            { Product_ID: 'P2', Product_Name: 'Stolica (dopunjeno)', Included: true },     // dopuna praznog
        ];
        const merge = mergeOfferProducts(existing, incoming, 'Prihvaćeno');

        expect(merge.toKeep).toHaveLength(1);
        expect(merge.toKeep[0].ID).toBe('e1'); // zaključan red netaknut — incoming se IGNORIŠE
        expect(merge.toUpdate).toHaveLength(1);
        expect(merge.toUpdate[0]).toEqual({ existingId: 'e2', incoming: incoming[1] }); // prazan red se update-uje
        expect(merge.toCreate).toHaveLength(0);
        expect(merge.toDeleteIds).toHaveLength(0);
    });

    test('nova stavka (nije postojala) uvijek ide u toCreate, bez obzira na status ponude', () => {
        const merge = mergeOfferProducts<TestExisting, TestIncoming>([], [{ Product_ID: 'NEW' }], 'Prihvaćeno');
        expect(merge.toCreate).toEqual([{ Product_ID: 'NEW' }]);
        expect(merge.toUpdate).toHaveLength(0);
        expect(merge.toKeep).toHaveLength(0);
    });

    test('zaključan red nestao iz incoming (korisnik ga "uklonio" u editoru) → ipak se ČUVA, ne briše', () => {
        const existing: TestExisting[] = [{ ID: 'e1', Product_ID: 'P1', Selling_Price: 800, Included: true }];
        const merge = mergeOfferProducts<TestExisting, TestIncoming>(existing, [], 'Poslano');
        expect(merge.toKeep).toEqual(existing);
        expect(merge.toDeleteIds).toHaveLength(0);
    });

    test('otključan red nestao iz incoming → briše se (korisnik ga stvarno uklonio)', () => {
        const existing: TestExisting[] = [{ ID: 'e1', Product_ID: 'P1', Selling_Price: 0, Included: true }];
        const merge = mergeOfferProducts<TestExisting, TestIncoming>(existing, [], 'Poslano');
        expect(merge.toDeleteIds).toEqual(['e1']);
        expect(merge.toKeep).toHaveLength(0);
    });

    test('Nacrt ponuda: sve otključano bez obzira na cijenu — merge degeneriše u obično update/create/delete', () => {
        const existing: TestExisting[] = [{ ID: 'e1', Product_ID: 'P1', Selling_Price: 800, Included: true }];
        const incoming: TestIncoming[] = [{ Product_ID: 'P1', Product_Name: 'Izmijenjeno' }];
        const merge = mergeOfferProducts(existing, incoming, 'Nacrt');
        expect(merge.toUpdate).toEqual([{ existingId: 'e1', incoming: incoming[0] }]);
        expect(merge.toKeep).toHaveLength(0);
    });

    test('unlockProductIds izuzeće (rješavanje konflikta): tretira zaključan red kao otključan', () => {
        const existing: TestExisting[] = [{ ID: 'e1', Product_ID: 'P1', Selling_Price: 800, Included: true }];
        const incoming: TestIncoming[] = [{ Product_ID: 'P1', Product_Name: 'Rezolvisan konflikt', Included: false }];
        const merge = mergeOfferProducts(existing, incoming, 'Prihvaćeno', { unlockProductIds: new Set(['P1']) });
        expect(merge.toUpdate).toEqual([{ existingId: 'e1', incoming: incoming[0] }]);
        expect(merge.toKeep).toHaveLength(0);
    });

    test('unlockProductIds ne utiče na druge (nezaključane) redove', () => {
        const existing: TestExisting[] = [
            { ID: 'e1', Product_ID: 'P1', Selling_Price: 800, Included: true },
            { ID: 'e2', Product_ID: 'P2', Selling_Price: 500, Included: true },
        ];
        const incoming: TestIncoming[] = [
            { Product_ID: 'P1', Included: false },
            { Product_ID: 'P2', Included: false }, // ovaj NIJE u unlock setu — ostaje zaključan
        ];
        const merge = mergeOfferProducts(existing, incoming, 'Prihvaćeno', { unlockProductIds: new Set(['P1']) });
        expect(merge.toUpdate.map(u => u.existingId)).toEqual(['e1']);
        expect(merge.toKeep.map(k => k.ID)).toEqual(['e2']);
    });

    test('dedup: existing i incoming spareni po Product_ID (ne po ID) — ID se ne šalje sa klijenta', () => {
        const existing: TestExisting[] = [{ ID: 'server-generated-uuid', Product_ID: 'P1', Selling_Price: 0, Included: true }];
        const incoming: TestIncoming[] = [{ Product_ID: 'P1', Product_Name: 'Dopunjeno' }];
        const merge = mergeOfferProducts(existing, incoming, 'Poslano');
        expect(merge.toUpdate[0].existingId).toBe('server-generated-uuid');
    });
});
