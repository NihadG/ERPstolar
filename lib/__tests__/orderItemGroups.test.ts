import {
    groupOrderItems, groupPricing, materialGroupKey, productNamesResolver, productNamesLabel, formatQty,
} from '../orderItemGroups';
import { orderItemPricing } from '../orderPricing';
import type { OrderItem, Project } from '../types';

let seq = 0;
function item(over: Partial<OrderItem>): OrderItem {
    seq++;
    return {
        ID: `oi-${seq}`, Order_ID: 'O1', Product_Material_ID: `pm-${seq}`, Product_ID: `p-${seq}`,
        Product_Name: `Pozicija ${seq}`, Project_ID: 'pr-1', Material_Name: 'Iveral bijeli 18mm',
        Quantity: 1, Unit: 'm²', Expected_Price: 10, Actual_Price: 0, Received_Quantity: 0, Status: 'Naručeno',
        ...over,
    };
}

describe('groupOrderItems — isti materijal = jedan red', () => {
    test('isti naziv i jedinica se sabiraju; razrada po pozicijama ostaje', () => {
        const groups = groupOrderItems([
            item({ Material_Name: 'Iveral bijeli 18mm', Quantity: 4, Product_Name: 'Klupe' }),
            item({ Material_Name: 'Šarke Blum', Quantity: 8, Unit: 'kom', Product_Name: 'Klupe' }),
            item({ Material_Name: 'Iveral bijeli 18mm', Quantity: 2.5, Product_Name: 'L-klupa' }),
        ]);
        expect(groups).toHaveLength(2);
        const iveral = groups.find(g => g.name === 'Iveral bijeli 18mm')!;
        expect(iveral.quantity).toBe(6.5);
        expect(iveral.items).toHaveLength(2);
        expect(iveral.productNames).toEqual(['Klupe', 'L-klupa']);
    });

    test('abecedni poredak, prirodno za brojeve i bez obzira na velika slova', () => {
        const groups = groupOrderItems([
            item({ Material_Name: 'vodilice 500' }),
            item({ Material_Name: 'Aluminij profil' }),
            item({ Material_Name: 'MDF 18mm' }),
            item({ Material_Name: 'MDF 8mm' }),
            item({ Material_Name: 'Čep za šarku' }),
        ]);
        expect(groups.map(g => g.name)).toEqual(['Aluminij profil', 'Čep za šarku', 'MDF 8mm', 'MDF 18mm', 'vodilice 500']);
    });

    test('razlika u razmacima, velikim slovima i dijakritici ne razdvaja materijal', () => {
        expect(materialGroupKey('Šarke  Blum ', 'kom')).toBe(materialGroupKey('sarke blum', 'KOM'));
        expect(materialGroupKey('Đubrivo', 'kg')).toBe(materialGroupKey('dubrivo', 'kg'));
        const groups = groupOrderItems([
            item({ Material_Name: 'Šarke Blum', Unit: 'kom', Quantity: 4 }),
            item({ Material_Name: 'sarke  blum', Unit: 'kom', Quantity: 6 }),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].quantity).toBe(10);
        expect(groups[0].name).toBe('Šarke Blum');   // prikaz = prvi upis
    });

    test('isti naziv u različitim jedinicama su dva reda', () => {
        const groups = groupOrderItems([
            item({ Material_Name: 'Kant traka', Unit: 'm', Quantity: 12 }),
            item({ Material_Name: 'Kant traka', Unit: 'kom', Quantity: 2 }),
        ]);
        expect(groups).toHaveLength(2);
    });

    test('zbir decimala se zaokružuje (bez 0.30000000000000004)', () => {
        const groups = groupOrderItems([item({ Quantity: 0.1 }), item({ Quantity: 0.2 })]);
        expect(groups[0].quantity).toBe(0.3);
        expect(formatQty(groups[0].quantity)).toBe('0.3');
        expect(formatQty(7)).toBe('7');
        expect(formatQty(1.256)).toBe('1.26');
        expect(formatQty(2.5)).toBe('2.5');
    });

    test('status grupe: otvoreno / djelomično / primljeno', () => {
        const [open] = groupOrderItems([item({}), item({})]);
        expect(open.status).toBe('open');
        const [partial] = groupOrderItems([item({ Status: 'Primljeno' }), item({})]);
        expect(partial.status).toBe('partial');
        expect(partial.receivedCount).toBe(1);
        const [done] = groupOrderItems([item({ Status: 'Primljeno' }), item({ Status: 'Primljeno' })]);
        expect(done.status).toBe('received');
    });

    test('prazna / nepostojeća lista', () => {
        expect(groupOrderItems(undefined)).toEqual([]);
        expect(groupOrderItems([])).toEqual([]);
    });
});

describe('groupPricing', () => {
    test('ukupno = Σ stavki, jedinična = ukupno / Σ količine', () => {
        const items = [item({ Quantity: 2, Expected_Price: 84 }), item({ Quantity: 1, Expected_Price: 42 })];
        const pricing = orderItemPricing({ Total_Amount: 126, items });
        const [g] = groupOrderItems(items);
        const p = groupPricing(g, pricing);
        expect(p.total).toBe(126);
        expect(p.unitPrice).toBe(42);
    });
});

describe('productNamesResolver', () => {
    const projects = [{
        Project_ID: 'pr-1',
        products: [
            { Product_ID: 'p-a', Name: 'Klupe', materials: [{ ID: 'pm-a' }] },
            { Product_ID: 'p-b', Name: 'Stolovi', materials: [{ ID: 'pm-b' }] },
        ],
    }] as unknown as Project[];

    test('stavka spojena pri kreiranju vraća SVE pozicije, ne samo prvu', () => {
        const resolve = productNamesResolver(projects);
        const merged = item({ Product_Material_ID: 'pm-a', Product_Material_IDs: ['pm-a', 'pm-b'], Product_Name: 'Klupe' });
        expect(resolve(merged)).toEqual(['Klupe', 'Stolovi']);
    });

    test('materijal koji više ne postoji → Product_Name stavke', () => {
        const resolve = productNamesResolver(projects);
        expect(resolve(item({ Product_Material_ID: 'nema', Product_Name: 'Stara pozicija' }))).toEqual(['Stara pozicija']);
    });

    test('labela skraćuje dugu listu', () => {
        expect(productNamesLabel(['A', 'B'])).toBe('A, B');
        expect(productNamesLabel(['A', 'B', 'C', 'D'])).toBe('A, B +2');
    });
});
