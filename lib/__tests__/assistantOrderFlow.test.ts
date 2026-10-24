/**
 * @jest-environment node
 */
// Rubni slučajevi toka narudžbe preko asistenta, direktno kroz alate (bez
// modela): narudžbe napravljene u ERP-u (stari zapis bez raspodjele), više
// dobavljača, proizvod s količinom > 1, djelimičan prijem, dvije narudžbe na
// istom materijalu, vraćanje u nacrt, brisanje s potvrdom i ↩️ Poništi.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';
import { loadProjectMaterials } from '@/lib/server/orderWrites';

let turn = 0;
function env(): ToolEnv {
    return {
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date('2026-10-24T10:00:00Z'),
        turnId: `turn${++turn}`, dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ctx: {
            workers: [], suppliers: [], memory: [], tasks: [], names: [],
            projects: [{ alias: 'P1', value: { id: 'p1', client: 'Budnjo', name: 'Hotel Budnjo' } }],
        },
    } as unknown as ToolEnv;
}
const mat = (id: string) => docs('product_materials').find(m => m.ID === id)!;
const orderByNo = (no: string) => docs('orders').find(o => o.Order_Number === no)!;
const itemsOf = (orderId: string) => docs('order_items').filter(i => i.Order_ID === orderId);
const numberOf = (res: Record<string, unknown>) => String((res.orders as string[])[0]).split(' ')[0];
const available = async (id: string) => (await loadProjectMaterials('org1', ['p1'])).find(r => r.materialId === id)!.available;

beforeAll(() => {
    store.set('projects/p1', { Project_ID: 'p1', Organization_ID: 'org1', Client_Name: 'Budnjo', Name: 'Hotel Budnjo', Status: 'Odobreno' });
    store.set('products/a', { Product_ID: 'pa', Organization_ID: 'org1', Project_ID: 'p1', Name: 'Ormar', Quantity: 2, Status: 'Na čekanju' });
    store.set('products/b', { Product_ID: 'pb', Organization_ID: 'org1', Project_ID: 'p1', Name: 'Komoda', Quantity: 1, Status: 'Na čekanju' });
    // Ormar ×2: 10 baglama po komadu = 20. Komoda: 5 baglama + 4 m² iverala.
    store.set('product_materials/1', { ID: 'm1', Organization_ID: 'org1', Product_ID: 'pa', Material_ID: 'cat-b', Material_Name: 'Baglama ravna', Quantity: 10, Unit: 'kom', Unit_Price: 2, Total_Price: 20, Status: 'Naručeno', Supplier: 'Häfele', Order_ID: 'erp1', Ordered_Quantity: 5 });
    store.set('product_materials/2', { ID: 'm2', Organization_ID: 'org1', Product_ID: 'pb', Material_ID: 'cat-b', Material_Name: 'Baglama ravna', Quantity: 5, Unit: 'kom', Unit_Price: 2, Total_Price: 10, Status: 'Naručeno', Supplier: 'Häfele', Order_ID: 'erp1', Ordered_Quantity: 5 });
    store.set('product_materials/3', { ID: 'm3', Organization_ID: 'org1', Product_ID: 'pb', Material_ID: 'cat-i', Material_Name: 'Iveral bijeli 18', Quantity: 4, Unit: 'm²', Unit_Price: 30, Total_Price: 120, Status: 'Nije naručeno', Supplier: 'Kronospan', Order_ID: '' });
    store.set('materials/b', { Material_ID: 'cat-b', Organization_ID: 'org1', Name: 'Baglama ravna', Unit: 'kom', Default_Supplier: 'Häfele', Default_Unit_Price: 2 });
    store.set('suppliers/h', { Supplier_ID: 'sh', Organization_ID: 'org1', Name: 'Häfele' });
    store.set('suppliers/k', { Supplier_ID: 'sk', Organization_ID: 'org1', Name: 'Kronospan' });
    // Narudžba napravljena u ERP-u PRIJE raspodjele po materijalu: 10 baglama na m1+m2 (dijeli se 5/5).
    store.set('orders/erp1', { Order_ID: 'erp1', Organization_ID: 'org1', Order_Number: 'N2026-09/E1', Supplier_ID: 'sh', Supplier_Name: 'Häfele', Status: 'Poslano', Order_Date: '2026-09-20T08:00:00Z', Total_Amount: 20, Notes: '' });
    store.set('order_items/erp1a', { ID: 'e1a', Organization_ID: 'org1', Order_ID: 'erp1', Product_Material_ID: 'm1', Product_Material_IDs: ['m1', 'm2'], Product_ID: 'pa', Product_Name: 'Ormar', Project_ID: 'p1', Material_Name: 'Baglama ravna', Quantity: 10, Unit: 'kom', Expected_Price: 20, Actual_Price: 0, Received_Quantity: 0, Status: 'Naručeno' });
});

describe('kreiranje: ulazi koji ne smiju proći tiho', () => {
    it('negativna ili nulta količina je greška, ne „sav ostatak"', async () => {
        for (const quantity of [-5, 0]) {
            const res = await runTool(env(), 'create_order', { lines: [{ material: 'iveral', project: 'P1', quantity }] });
            expect(res.ok).toBe(false);
        }
        expect(docs('orders')).toHaveLength(1);
    });

    it('nepostojeći projekat i nepostojeći ref su greške', async () => {
        expect((await runTool(env(), 'create_order', { lines: [{ material: 'iveral', project: 'P9', quantity: 1 }] })).ok).toBe(false);
        expect((await runTool(env(), 'create_order', { lines: [{ ref: 'O7', quantity: 1 }] })).ok).toBe(false);
    });

    it('ostatak uzima u obzir staru ERP narudžbu (5+5 naručeno od 25)', async () => {
        expect(await available('m1')).toBe(15);
        expect(await available('m2')).toBe(0);
    });
});

describe('dva dobavljača, proizvod ×2, višak u sastavnicu', () => {
    let haefele = '';
    let krono = '';

    it('dvije stavke različitih dobavljača → dvije narudžbe', async () => {
        const e = env();
        const res = await runTool(e, 'create_order', { lines: [
            { material: 'baglama', project: 'P1', quantity: 19 },
            { material: 'iveral', project: 'P1', quantity: 2 },
        ] });
        expect(res.ok).toBe(true);
        const nums = res.orders as string[];
        expect(nums).toHaveLength(2);
        haefele = nums.find(n => n.includes('Häfele'))!.split(' ')[0];
        krono = nums.find(n => n.includes('Kronospan'))!.split(' ')[0];
        // 15 ostalo + 4 viška → višak ide ormaru (najveća potreba), PO KOMADU: 4 / 2 = +2.
        expect(mat('m1')).toMatchObject({ Quantity: 12, Total_Price: 24 });
        expect(docs('products').find(p => p.Product_ID === 'pa')!.Material_Cost).toBe(24);
        const [item] = itemsOf(orderByNo(haefele).Order_ID);
        expect(item.Product_Material_Quantities).toEqual({ m1: 19 });
        expect(e.summaries.join('\n')).toMatch(/15 po sastavnici \+ 4 dodano u sastavnicu \(Ormar\)/);
        expect(itemsOf(orderByNo(krono).Order_ID)[0]).toMatchObject({ Quantity: 2, Product_Material_Quantities: { m3: 2 } });
    });

    it('nacrt nije „naručeno" — ostatak iverala gleda nacrt', async () => {
        expect(mat('m3').Ordered_Quantity || 0).toBe(0);
        expect(await available('m3')).toBe(2);
    });

    it('prijem nacrta nije dozvoljen; slanje dvaput nije dozvoljeno', async () => {
        const r1 = await runTool(env(), 'manage_order', { number: haefele, action: 'receive' });
        expect(r1).toMatchObject({ ok: false, error: expect.stringMatching(/još nacrt/) });
        expect((await runTool(env(), 'manage_order', { number: haefele, action: 'send' })).ok).toBe(true);
        expect(mat('m1')).toMatchObject({ Ordered_Quantity: 24, Status: 'Naručeno' });
        expect(docs('projects')[0].Status).toBe('U proizvodnji');
        const r2 = await runTool(env(), 'manage_order', { number: haefele, action: 'send' });
        expect(r2).toMatchObject({ ok: false, error: expect.stringMatching(/već „Poslano"/) });
    });

    it('prijem stare ERP narudžbe ne zatvara materijal koji čeka drugu narudžbu', async () => {
        const e = env();
        expect((await runTool(e, 'manage_order', { number: 'E1', action: 'receive' })).ok).toBe(true);
        expect(orderByNo('N2026-09/E1').Status).toBe('Primljeno');
        // m1: 24 naručeno − 5 primljeno = 19 još čeka (Häfele nacrt poslan) → ostaje „Naručeno".
        expect(mat('m1')).toMatchObject({ Ordered_Quantity: 19, Received_Quantity: 5, Status: 'Naručeno' });
        // m2: samo stara narudžba → primljeno.
        expect(mat('m2')).toMatchObject({ Ordered_Quantity: 0, Received_Quantity: 5, Status: 'Primljeno' });
        expect((await runTool(env(), 'manage_order', { number: 'E1', action: 'receive' })).ok).toBe(false);
    });

    it('↩️ Poništi vraća prijem (stavke, narudžbu, materijale)', async () => {
        const e = env();
        await runTool(e, 'manage_order', { number: 'E1', action: 'draft' }); // primljena se ne vraća u nacrt
        expect(e.changes).toHaveLength(0);
        // Ponovo: primi Kronospan nakon slanja, pa poništi.
        await runTool(env(), 'manage_order', { number: krono, action: 'send' });
        const r = env();
        await runTool(r, 'manage_order', { number: krono, action: 'receive' });
        expect(mat('m3')).toMatchObject({ Received_Quantity: 2, Ordered_Quantity: 0 });
        await undoTurn(r.turnId, 'u1');
        expect(mat('m3')).toMatchObject({ Received_Quantity: 0, Ordered_Quantity: 2, Status: 'Naručeno' });
        expect(orderByNo(krono).Status).toBe('Poslano');
        expect(itemsOf(orderByNo(krono).Order_ID)[0].Status).toBe('Naručeno');
    });

    it('djelimičan prijem po nazivu; nepostojeći materijal u narudžbi je greška', async () => {
        const bad = await runTool(env(), 'manage_order', { number: krono, action: 'receive', materials: ['ogledalo'] });
        expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/nema tih materijala.*Iveral/) });
        const e = env();
        const ok = await runTool(e, 'manage_order', { number: krono, action: 'receive', materials: ['iveral'] });
        expect(ok).toMatchObject({ ok: true, detail: 'cijela narudžba primljena' });
    });
});

describe('vraćanje u nacrt i brisanje', () => {
    let no = '';

    it('vraćanje u nacrt skida naručeno; ostatak se opet nudi', async () => {
        const res = await runTool(env(), 'create_order', { lines: [{ material: 'baglama', project: 'P1', quantity: 3, product: 'Komoda' }] });
        no = numberOf(res);
        // Komoda je pokrivena, sve ide kao višak na komodu.
        expect(mat('m2')).toMatchObject({ Quantity: 8 });
        await runTool(env(), 'manage_order', { number: no, action: 'send' });
        expect(mat('m2')).toMatchObject({ Ordered_Quantity: 3, Status: 'Naručeno' });
        await runTool(env(), 'manage_order', { number: no, action: 'draft' });
        expect(mat('m2')).toMatchObject({ Ordered_Quantity: 0, Received_Quantity: 5, Status: 'Primljeno' });
        expect(orderByNo(no).Status).toBe('Nacrt');
    });

    it('brisanje traži potvrdu', async () => {
        const res = await runTool(env(), 'manage_order', { number: no, action: 'delete' });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/potvrdu/) });
        expect(orderByNo(no)).toBeDefined();
    });

    it('brisanje poslane narudžbe skida naručeno s materijala, poništi je vraća', async () => {
        await runTool(env(), 'manage_order', { number: no, action: 'send' });
        const e = env();
        const res = await runTool(e, 'manage_order', { number: no, action: 'delete', confirmed: true });
        expect(res).toMatchObject({ ok: true, detail: 'iz sastavnice skinuto: 3 kom Baglama ravna' });
        expect(orderByNo(no)).toBeUndefined();
        // Naručeno skinuto, a višak koji je narudžba dodala vraćen — trošak nije naduvan.
        expect(mat('m2')).toMatchObject({ Ordered_Quantity: 0, Quantity: 5, Total_Price: 10 });
        expect(docs('products').find(p => p.Product_ID === 'pb')!.Material_Cost).toBe(130);

        await undoTurn(e.turnId, 'u1');
        expect(orderByNo(no)).toMatchObject({ Status: 'Poslano' });
        expect(itemsOf(orderByNo(no).Order_ID)).toHaveLength(1);
        expect(mat('m2')).toMatchObject({ Ordered_Quantity: 3, Quantity: 8 });
    });

    it('brisanje nacrta s novim materijalom uklanja i taj materijal iz sastavnice', async () => {
        const res = await runTool(env(), 'create_order', { lines: [{ material: 'ogledalo', project: 'P1', product: 'Ormar', quantity: 4 }] });
        const added = docs('product_materials').find(m => m.Material_Name === 'ogledalo')!;
        expect(added).toMatchObject({ Product_ID: 'pa', Quantity: 2 }); // 4 ukupno / 2 ormara
        const costBefore = docs('products').find(p => p.Product_ID === 'pa')!.Material_Cost;
        await runTool(env(), 'manage_order', { number: numberOf(res), action: 'delete', confirmed: true });
        expect(docs('product_materials').some(m => m.Material_Name === 'ogledalo')).toBe(false);
        expect(docs('products').find(p => p.Product_ID === 'pa')!.Material_Cost).toBe(costBefore);
    });

    it('dvosmislen broj → pita koju', async () => {
        const res = await runTool(env(), 'manage_order', { number: 'N2026', action: 'send' });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Više narudžbi odgovara/) });
    });

    it('nepoznata radnja ili broj su greške', async () => {
        expect((await runTool(env(), 'manage_order', { number: no, action: 'archive' })).ok).toBe(false);
        expect((await runTool(env(), 'manage_order', { number: 'ZZ99', action: 'send' })).ok).toBe(false);
    });
});
