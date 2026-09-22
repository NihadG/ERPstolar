import { commandMaterialRows, orderableIds, planFromSelection, planTotal, suggestOrderName } from '../command/materialOrder';
import type { Project } from '../types';

const projectWith = (materials: Record<string, unknown>[], productQty = 2): Project => ({
    Project_ID: 'p1', Name: 'Aamanns', Client_Name: 'Igor',
    products: [{ Product_ID: 'prod1', Name: 'Klupa', Quantity: productQty, materials }],
} as unknown as Project);

const material = (over: Record<string, unknown> = {}) => ({
    ID: 'm1', Material_Name: 'Iveral 18', Quantity: 3, Unit: 'm2', Unit_Price: 10,
    Status: 'Nije naručeno', Supplier: 'Frischeis', Order_ID: '', ...over,
});

test('potrebna količina množi se količinom proizvoda, a naručeno se računa kao pokriveno', () => {
    const [row] = commandMaterialRows([projectWith([material({ On_Stock: 1, Ordered_Quantity: 2, Received_Quantity: 1 })])]);
    expect(row.needed).toBe(6);            // 3 × 2 komada
    expect(row.remaining).toBe(4);         // nedostaje za RAD: bez naručenog
    expect(row.toOrder).toBe(2);           // za NARUDŽBU: naručeno se odbija
    expect(row.orderable).toBe(true);
});

test('pokriveni materijali se ne nude za narudžbu', () => {
    const rows = commandMaterialRows([projectWith([
        material({ ID: 'a', Status: 'Primljeno' }),
        material({ ID: 'b', Status: 'Na stanju' }),
        material({ ID: 'c', Status: 'Naručeno', Order_ID: 'ord1' }),
        material({ ID: 'd', Status: 'Naručeno', Order_ID: '' }),
        material({ ID: 'e', On_Stock: 99 }),
    ])]);
    expect(rows.filter(r => r.orderable).map(r => r.ID)).toEqual(['d']);
});

test('plan se grupiše po dobavljaču, sortira abecedno i nosi potrebnu, ne ukupnu količinu', () => {
    const rows = commandMaterialRows([projectWith([
        material({ ID: 'a', Material_Name: 'Vijak', Supplier: 'Zeta' }),
        material({ ID: 'b', Material_Name: 'Iveral', Supplier: 'Alfa' }),
        material({ ID: 'c', Material_Name: 'Drvo', Supplier: 'Alfa', On_Stock: 4 }),
    ])]);
    const plan = planFromSelection(rows, ['a', 'b', 'c']);
    expect(plan.map(g => g.supplierName)).toEqual(['Alfa', 'Zeta']);
    expect(plan[0].materials.map(m => m.materialName)).toEqual(['Drvo', 'Iveral']);
    expect(plan[0].materials.find(m => m.materialName === 'Drvo')!.quantity).toBe(2);
    expect(plan[0].materials[0].projectId).toBe('p1');
    expect(plan[0].materials[0].productName).toBe('Klupa');
});

test('neoznačeni i u međuvremenu pokriveni redovi se tiho ispuštaju', () => {
    const rows = commandMaterialRows([projectWith([
        material({ ID: 'a' }),
        material({ ID: 'b', Status: 'Primljeno' }),
    ])]);
    expect(planFromSelection(rows, ['a', 'b'])).toHaveLength(1);
    expect(planFromSelection(rows, [])).toEqual([]);
});

test('materijal bez dobavljača dobije svoju grupu umjesto da nestane', () => {
    const rows = commandMaterialRows([projectWith([material({ Supplier: '' })])]);
    expect(planFromSelection(rows, ['m1'])[0].supplierName).toBe('Nepoznat dobavljač');
});

test('ukupna vrijednost plana je zbir količina × jedinična cijena', () => {
    const rows = commandMaterialRows([projectWith([material({ Unit_Price: 12.5 })])]);
    expect(planTotal(planFromSelection(rows, ['m1']))).toBe(75);   // 6 kom × 12.5
});

// ── Izbor za narudžbu i naziv ───────────────────────────────────────

const twoProjects = (): Project[] => [
    {
        Project_ID: 'p1', Name: 'Aamanns', Client_Name: 'Igor',
        products: [
            { Product_ID: 'klupa', Name: 'Klupa', Quantity: 1, materials: [material({ ID: 'a' }), material({ ID: 'b', Status: 'Primljeno' })] },
            { Product_ID: 'sto', Name: 'Sto', Quantity: 1, materials: [material({ ID: 'c' })] },
        ],
    },
    {
        Project_ID: 'p2', Name: 'Melihin stan', Client_Name: 'Meliha',
        products: [{ Product_ID: 'vrata', Name: 'Vrata', Quantity: 1, materials: [material({ ID: 'd' })] }],
    },
] as unknown as Project[];

test('„naruči što fali" bira samo ono što se još može naručiti — po projektu, poziciji ili cijeloj tabli', () => {
    const rows = commandMaterialRows(twoProjects());
    expect(orderableIds(rows)).toEqual(['a', 'c', 'd']);
    expect(orderableIds(rows, { projectId: 'p1' })).toEqual(['a', 'c']);
    expect(orderableIds(rows, { productIds: ['klupa'] })).toEqual(['a']);   // 'b' je već primljen
});

test('naziv narudžbe se predlaže iz projekta i pozicije, nikad generičan', () => {
    const rows = commandMaterialRows(twoProjects());
    const order = new Map([['p1', 0], ['p2', 1]]);
    expect(suggestOrderName(rows, ['a'], order)).toBe('Aamanns — Klupa');
    expect(suggestOrderName(rows, ['a', 'c'], order)).toBe('Aamanns');
    // Redoslijed table, ne redoslijed izbora.
    expect(suggestOrderName(rows, ['d', 'a'], order)).toBe('Aamanns + Melihin stan');
    expect(suggestOrderName(rows, [], order)).toBe('');
});

test('više od dva projekta se skraćuje da naziv ostane čitljiv', () => {
    const projects = [...twoProjects(), {
        Project_ID: 'p3', Name: 'Kuća Čorluka', products: [{ Product_ID: 'orman', Name: 'Orman', Quantity: 1, materials: [material({ ID: 'e' })] }],
    } as unknown as Project];
    const rows = commandMaterialRows(projects);
    expect(suggestOrderName(rows, ['a', 'd', 'e'], new Map([['p1', 0], ['p2', 1], ['p3', 2]]))).toBe('Aamanns + još 2');
});
