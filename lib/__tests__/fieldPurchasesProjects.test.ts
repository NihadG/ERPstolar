// ════════════════════════════════════════════════════════════════════
// PROJEKCIJE NARUDŽBI I PROJEKATA
//
// Dvije stvari koje ne smiju procuriti kontroloru:
//   • novac — Total_Amount, Expected_Price, Unit_Price, Total_Price, Material_Cost
//   • kontakt klijenta — telefon, email, ID i PDV broj (lični podaci)
// ════════════════════════════════════════════════════════════════════

import {
    buildFieldPurchaseDetail, buildFieldPurchasesList, purchaseDisplayStatus,
} from '@/lib/field/fieldPurchases';
import {
    buildFieldProductDetail, buildFieldProjectDetail, buildFieldProjectsList, isMaterialReady,
} from '@/lib/field/fieldProjects';
import type { Order, OrderItem, Product, ProductMaterial, Project } from '@/lib/types';

const FORBIDDEN_KEYS = [
    'Total_Amount', 'Expected_Price', 'Actual_Price', 'Unit_Price', 'Total_Price',
    'Material_Cost', 'Client_Phone', 'Client_Email', 'Client_ID_Number', 'Client_PDV_Number',
];

function walk(value: unknown, keys: string[] = [], numbers: number[] = [], strings: string[] = []) {
    if (Array.isArray(value)) {
        value.forEach(v => walk(v, keys, numbers, strings));
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            keys.push(k);
            walk(v, keys, numbers, strings);
        }
    } else if (typeof value === 'number') {
        numbers.push(value);
    } else if (typeof value === 'string') {
        strings.push(value);
    }
    return { keys, numbers, strings };
}

// ─── Narudžbe ─────────────────────────────────────────────────────────

const orderItem = (over: Partial<OrderItem> = {}): OrderItem => ({
    ID: 'oi-1', Order_ID: 'o-1', Product_Material_ID: 'pm-1',
    Product_ID: 'p-1', Product_Name: 'Kuhinja', Project_ID: 'proj-1',
    Material_Name: 'Iveral 18mm', Quantity: 12, Unit: 'm²',
    Expected_Price: 47.5, Actual_Price: 49.9, Received_Quantity: 0,
    Status: 'Naručeno',
    ...over,
});

const order = (over: Partial<Order> = {}): Order => ({
    Order_ID: 'o-1', Organization_ID: 'org-1', Order_Number: 'N2026-07/K7',
    Supplier_ID: 's-1', Supplier_Name: 'Drvo doo',
    Order_Date: '2026-07-10T08:00:00.000Z', Expected_Delivery: '2026-07-18',
    Status: 'Poslano', Total_Amount: 1234.56, Notes: 'zvati prije dostave',
    items: [orderItem()],
    ...over,
} as Order);

const projectNames = new Map([['proj-1', 'Stan Hrasno']]);

describe('purchaseDisplayStatus', () => {
    it('sve stavke primljene → Primljeno', () => {
        expect(purchaseDisplayStatus(order({
            items: [orderItem({ Status: 'Primljeno' })],
        }))).toBe('Primljeno');
    });

    it('dio primljen → Djelomično', () => {
        expect(purchaseDisplayStatus(order({
            items: [orderItem({ Status: 'Primljeno' }), orderItem({ ID: 'oi-2' })],
        }))).toBe('Djelomično');
    });

    it('poslano bez ijednog prijema ostaje Poslano', () => {
        expect(purchaseDisplayStatus(order())).toBe('Poslano');
    });

    it('nacrt ostaje nacrt', () => {
        expect(purchaseDisplayStatus(order({ Status: 'Nacrt' }))).toBe('Nacrt');
    });
});

describe('narudžbe — novac ne izlazi', () => {
    it('lista ne nosi nijedno novčano polje', () => {
        const { keys } = walk(buildFieldPurchasesList({ orders: [order()], projectNames }));
        for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
    });

    it('detalj ne nosi nijedno novčano polje ni iznos', () => {
        const detail = buildFieldPurchaseDetail(
            order({ Total_Amount: 98765, items: [orderItem({ Expected_Price: 54321, Actual_Price: 43210 })] }),
            projectNames
        );
        const { keys, numbers } = walk(detail);
        for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
        for (const a of [98765, 54321, 43210]) expect(numbers).not.toContain(a);
    });
});

describe('narudžbe — sadržaj i poredak', () => {
    it('ono što se čeka ide prije onog što je stiglo', () => {
        const rows = buildFieldPurchasesList({
            orders: [
                order({ Order_ID: 'o-1', Name: 'Stiglo', Status: 'Primljeno', items: [orderItem({ Status: 'Primljeno' })] }),
                order({ Order_ID: 'o-2', Name: 'Čeka se' }),
            ],
            projectNames,
        });
        expect(rows.map(r => r.name)).toEqual(['Čeka se', 'Stiglo']);
    });

    it('neprimljene stavke idu na vrh detalja', () => {
        const detail = buildFieldPurchaseDetail(order({
            items: [
                orderItem({ ID: 'oi-1', Material_Name: 'Stiglo', Status: 'Primljeno' }),
                orderItem({ ID: 'oi-2', Material_Name: 'Fali' }),
            ],
        }), projectNames);
        expect(detail.items.map(i => i.materialName)).toEqual(['Fali', 'Stiglo']);
    });

    it('naziv projekta se razrješava iz stavki', () => {
        expect(buildFieldPurchasesList({ orders: [order()], projectNames })[0].projectName).toBe('Stan Hrasno');
    });

    it('broji primljene stavke', () => {
        const rows = buildFieldPurchasesList({
            orders: [order({ items: [orderItem({ Status: 'Primljeno' }), orderItem({ ID: 'oi-2' })] })],
            projectNames,
        });
        expect(rows[0].receivedCount).toBe(1);
        expect(rows[0].itemCount).toBe(2);
    });
});

// ─── Projekti ─────────────────────────────────────────────────────────

const material = (over: Partial<ProductMaterial> = {}): ProductMaterial => ({
    ID: 'pm-1', Organization_ID: 'org-1', Product_ID: 'p-1', Material_ID: 'm-1',
    Material_Name: 'Iveral 18mm', Quantity: 12, Unit: 'm²',
    Unit_Price: 47.5, Total_Price: 570, Status: 'Primljeno',
    Supplier: 'Drvo doo', Order_ID: 'o-1',
    ...over,
});

const product = (over: Partial<Product> = {}): Product => ({
    Product_ID: 'p-1', Organization_ID: 'org-1', Project_ID: 'proj-1',
    Name: 'Kuhinja donji elementi', Height: 720, Width: 2400, Depth: 600,
    Quantity: 1, Status: 'Na čekanju', Material_Cost: 1570, Notes: '',
    materials: [material()],
    Process_Stages: [{ processes: ['Rezanje'] }, { processes: ['Kantiranje'] }],
    ...over,
} as Product);

const project = (over: Partial<Project> = {}): Project => ({
    Project_ID: 'proj-1', Organization_ID: 'org-1',
    Client_Name: 'Mujo Mujić', Client_Phone: '061 111 222', Client_Email: 'mujo@mail.ba',
    Client_ID_Number: '1234567890123', Client_PDV_Number: '4200000000001',
    Address: 'Trg heroja 12', Notes: '', Status: 'U proizvodnji',
    Created_Date: '2026-07-01T08:00:00.000Z', Deadline: '2026-08-01',
    products: [product()],
    ...over,
} as Project);

describe('projekti — ne izlazi ni novac ni kontakt klijenta', () => {
    it('detalj projekta ne nosi zabranjena polja', () => {
        const { keys } = walk(buildFieldProjectDetail(project()));
        for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
    });

    it('telefon, email i ID broj klijenta ne procure kao vrijednost', () => {
        const { strings } = walk(buildFieldProjectDetail(project()));
        for (const secret of ['061 111 222', 'mujo@mail.ba', '1234567890123', '4200000000001']) {
            expect(strings).not.toContain(secret);
        }
    });

    it('cijene materijala ne procure kao broj', () => {
        const detail = buildFieldProductDetail(
            product({ Material_Cost: 98765, materials: [material({ Unit_Price: 54321, Total_Price: 43210 })] }),
            'Stan Hrasno'
        );
        const { numbers } = walk(detail);
        for (const a of [98765, 54321, 43210]) expect(numbers).not.toContain(a);
    });
});

describe('isMaterialReady', () => {
    it('primljeno i na stanju su spremni', () => {
        expect(isMaterialReady('Primljeno')).toBe(true);
        expect(isMaterialReady('Na stanju')).toBe(true);
    });

    it('naručeno još nije spremno', () => {
        expect(isMaterialReady('Naručeno')).toBe(false);
        expect(isMaterialReady('Nije naručeno')).toBe(false);
    });
});

describe('projekti — sadržaj', () => {
    it('prikazuju se samo aktivni projekti', () => {
        const rows = buildFieldProjectsList([
            project({ Project_ID: 'a', Status: 'U proizvodnji' }),
            project({ Project_ID: 'b', Status: 'Završeno' }),
            project({ Project_ID: 'c', Status: 'Nacrt' }),
        ]);
        expect(rows.map(r => r.projectId)).toEqual(['a']);
    });

    it('skriveni projekat se ne prikazuje', () => {
        expect(buildFieldProjectsList([project({ Hidden: true })])).toEqual([]);
    });

    it('broji esencijalne materijale koji fale', () => {
        const detail = buildFieldProductDetail(product({
            materials: [
                material({ ID: 'pm-1', Is_Essential: true, Status: 'Naručeno' }),
                material({ ID: 'pm-2', Is_Essential: true, Status: 'Primljeno' }),
                material({ ID: 'pm-3', Is_Essential: false, Status: 'Nije naručeno' }),
            ],
        }), 'Stan Hrasno');
        expect(detail.essentialMissing).toBe(1);
        expect(detail.materialsReady).toBe(1);
    });

    it('materijal koji fali ide na vrh, a esencijalni prvi od njih', () => {
        const detail = buildFieldProductDetail(product({
            materials: [
                material({ ID: 'pm-1', Material_Name: 'Spremno', Status: 'Primljeno' }),
                material({ ID: 'pm-2', Material_Name: 'Fali obično', Status: 'Naručeno' }),
                material({ ID: 'pm-3', Material_Name: 'Fali ključno', Status: 'Naručeno', Is_Essential: true }),
            ],
        }), 'Stan Hrasno');
        expect(detail.materials.map(m => m.name)).toEqual(['Fali ključno', 'Fali obično', 'Spremno']);
    });

    it('procesi se čitaju iz faza, a fallback je ravni plan', () => {
        expect(buildFieldProductDetail(product(), 'x').processes).toEqual(['Rezanje', 'Kantiranje']);
        expect(buildFieldProductDetail(
            product({ Process_Stages: undefined, Process_Plan: ['Bušenje'] }), 'x'
        ).processes).toEqual(['Bušenje']);
    });

    it('broji samo neriješena pitanja', () => {
        const detail = buildFieldProductDetail(product({
            Questions: [
                { id: 'q1', Text: 'a', Audience: 'client', Resolved: false, Created_At: '' },
                { id: 'q2', Text: 'b', Audience: 'client', Resolved: true, Created_At: '' },
            ],
        }), 'x');
        expect(detail.openQuestions).toBe(1);
    });

    it('proizvod je spreman tek kad su SVI materijali spremni', () => {
        const rows = buildFieldProjectsList([project({
            products: [
                product({ Product_ID: 'p-1', materials: [material({ Status: 'Primljeno' })] }),
                product({ Product_ID: 'p-2', materials: [material({ ID: 'pm-9', Status: 'Naručeno' })] }),
            ],
        })]);
        expect(rows[0].productsReady).toBe(1);
        expect(rows[0].productCount).toBe(2);
    });
});
