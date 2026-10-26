/**
 * @jest-environment node
 */
// Kapije materijala u Telegramu, od sata do baze: pitanje pri pokretanju,
// označavanje i potvrda (prijem kroz narudžbu / „Na stanju"), „Naruči što
// fali", najava pred okivanje, kapija sa zadatkom, „stiglo 18 od 24" i ↩️.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

const mockSent: { method: string; args: any[] }[] = [];
jest.mock('@/lib/telegram/api', () => {
    const rec = (method: string) => async (...args: any[]) => { mockSent.push({ method, args }); return { message_id: 1 }; };
    return { sendMessage: rec('sendMessage'), editMessageText: rec('editMessageText'), sendDocument: rec('sendDocument') };
});
const mockPdf: string[] = [];
jest.mock('@/lib/assistant/orderDocuments', () => ({ sendOrderPdf: async (_c: unknown, _o: unknown, orderId: string) => { mockPdf.push(orderId); } }));

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { handleMaterialButton, receiveByName, sendMaterialAlerts } from '@/lib/assistant/materialAlerts';
import { undoTurn, type AssistantLink } from '@/lib/assistant/store';

const TZ = 'Europe/Sarajevo';
const AT = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 26, h - 1, m));   // 26.10. je već zimsko vrijeme (UTC+1)
const link: AssistantLink = { telegramUserId: 7, chatId: 70, uid: 'u1', orgId: 'org1', telegramName: 'Nihad', linkedAt: '2026-10-01' };
const pm = (id: string) => docs('product_materials').find(m => m.ID === id)!;
const lastText = () => mockSent[mockSent.length - 1].args[1] as string;
const lastButtons = () => mockSent[mockSent.length - 1].args[2] as { text: string; data: string }[][];
const checkId = () => lastButtons()[0][0].data.split(':')[1];

const N = ['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija', 'Brušenje', 'Okivanje'];
const graph = {
    nodes: N.map((name, i) => ({ id: `n${i}`, name, itemIds: [] })),
    edges: N.slice(1).map((_, i) => ({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}` })),
};
const setItem = (processes: { Process_Name: string; Status: string }[]) => store.set('work_order_items/k1', {
    ID: 'k1', Organization_ID: 'org1', Work_Order_ID: 'r1', Product_ID: 'p1', Product_Name: 'Kuhinja', Project_ID: 'pj', Status: 'U toku', Processes: processes,
});

beforeAll(() => {
    store.set('assistant_links/7', link);
    store.set('work_orders/r1', { Work_Order_ID: 'r1', Organization_ID: 'org1', Name: 'Kuhinja Jerko', Status: 'U toku', Started_At: '2026-10-26T07:00:00Z', Process_Graph: graph });
    setItem([]);
    store.set('products/p1', { Product_ID: 'p1', Organization_ID: 'org1', Project_ID: 'pj', Name: 'Kuhinja', Quantity: 1 });
    store.set('materials/c1', { Material_ID: 'c1', Organization_ID: 'org1', Name: 'Šarke Blum', Category: 'Okovi' });
    const m = (id: string, name: string, extra: Record<string, unknown> = {}) => store.set(`product_materials/${id}`, {
        ID: id, Organization_ID: 'org1', Product_ID: 'p1', Material_ID: '', Material_Name: name, Quantity: 2, Unit: 'kom', Unit_Price: 10,
        Total_Price: 20, Status: 'Nije naručeno', Supplier: 'Frischeis', Order_ID: '', ...extra,
    });
    m('iv', 'Iveral U702 18mm', { Status: 'Naručeno', Ordered_Quantity: 2, Order_ID: 'o1', Unit: 'ploča' });
    m('kt', 'ABS kant traka 2mm', { Quantity: 40, Unit: 'm' });
    m('sa', 'Šarke Blum', { Quantity: 24, Material_ID: 'c1', Supplier: 'Blum' });
    m('ru', 'Ručke 160', { Quantity: 12, Status: 'Naručeno', Ordered_Quantity: 12, Order_ID: 'o2', Supplier: 'Häfele' });
    store.set('orders/o1', { Order_ID: 'o1', Organization_ID: 'org1', Order_Number: 'N-1', Supplier_Name: 'Frischeis', Status: 'Poslano', Order_Date: '2026-10-21T08:00:00Z', Expected_Delivery: '2026-10-24' });
    store.set('order_items/oi1', { ID: 'oi1', Organization_ID: 'org1', Order_ID: 'o1', Product_Material_ID: 'iv', Product_ID: 'p1', Project_ID: 'pj', Material_Name: 'Iveral U702 18mm', Quantity: 2, Unit: 'ploča', Received_Quantity: 0, Status: 'Naručeno', Expected_Price: 20, Actual_Price: 0 });
    store.set('orders/o2', { Order_ID: 'o2', Organization_ID: 'org1', Order_Number: 'N-2', Supplier_Name: 'Häfele', Status: 'Poslano', Order_Date: '2026-10-22T08:00:00Z', Expected_Delivery: '' });
    store.set('order_items/oi2', { ID: 'oi2', Organization_ID: 'org1', Order_ID: 'o2', Product_Material_ID: 'ru', Product_ID: 'p1', Project_ID: 'pj', Material_Name: 'Ručke 160', Quantity: 12, Unit: 'kom', Received_Quantity: 0, Status: 'Naručeno', Expected_Price: 120, Actual_Price: 0 });
});

beforeEach(() => { mockSent.length = 0; });

describe('kapije materijala u Telegramu', () => {
    it('sat pita samo u prozoru i svakih 10 minuta', async () => {
        expect(await sendMaterialAlerts(AT(10, 3), TZ)).toBe(0);
        expect(await sendMaterialAlerts(AT(22), TZ)).toBe(0);
        expect(mockSent).toEqual([]);
    });

    it('pokretanje: pita za prvu fazu; potvrda prima iveral kroz narudžbu', async () => {
        expect(await sendMaterialAlerts(AT(10), TZ)).toBe(1);
        expect(lastText()).toContain('🟢 Krenuo nalog: Kuhinja Jerko');
        expect(lastButtons()[0][0].text).toBe('☐ Iveral U702 18mm · 2 ploča · naručeno 21.10. (Frischeis)');
        // Kant traka je zaliha: pita se tek kad je kantiranje na redu.
        expect(lastText()).not.toContain('kant');

        const id = checkId();
        const toggled = await handleMaterialButton(link, id, 't', '0', TZ);
        expect(toggled.buttons![0][0].text.startsWith('☑')).toBe(true);
        const answered = await handleMaterialButton(link, id, 'ok', '', TZ);
        expect(answered.text).toContain('✔ Tu: Iveral U702 18mm');
        expect(pm('iv').Status).toBe('Primljeno');
        expect(docs('orders').find(o => o.Order_ID === 'o1')!.Status).toBe('Primljeno');

        // Drugi krug sata: ništa novo.
        mockSent.length = 0;
        expect(await sendMaterialAlerts(AT(10, 10), TZ)).toBe(0);

        // ↩️ vraća prijem.
        expect(await undoTurn(`mc-${id}`, 'u1')).not.toEqual([]);
        expect(pm('iv').Status).toBe('Naručeno');
    });

    it('kantiranje na redu: zaliha „imaš li?"; nema → narudžba za ono što fali', async () => {
        setItem([{ Process_Name: 'Krojenje iverala', Status: 'Završeno' }]);
        expect(await sendMaterialAlerts(AT(11), TZ)).toBe(1);
        expect(lastText()).toContain('🔔 Kuhinja Jerko: uskoro kantiranje iverala');
        expect(lastButtons()[0][0].text).toBe('☐ ABS kant traka 2mm · 40 m · zaliha');
        const id = checkId();
        const answered = await handleMaterialButton(link, id, 'ok', '', TZ);
        expect(answered.text).toContain('📦 Nema na zalihi: ABS kant traka 2mm');
        expect(answered.buttons!.map(r => r[0].data)).toEqual([`mc:${id}:ord`, `mc:${id}:snz`]);

        const ordered = await handleMaterialButton(link, id, 'ord', '', TZ);
        expect(ordered.text).toContain('🧾');
        const draft = docs('orders').find(o => o.Status === 'Nacrt')!;
        expect(draft.Supplier_Name).toBe('Frischeis');
        expect(mockPdf).toContain(draft.Order_ID);
        expect(docs('order_items').find(i => i.Order_ID === draft.Order_ID)!.Quantity).toBe(40);
    });

    it('2 koraka prije okivanja: šarke nisu naručene, ručke se čekaju', async () => {
        setItem([{ Process_Name: 'Krojenje iverala', Status: 'Završeno' }, { Process_Name: 'Kantiranje iverala', Status: 'Završeno' }]);
        expect(await sendMaterialAlerts(AT(12), TZ)).toBe(1);
        expect(lastText()).toContain('uskoro okivanje');
        expect(lastButtons().slice(0, 2).map(r => r[0].text)).toEqual([
            '☐ Šarke Blum · 24 kom · nije naručeno',
            '☐ Ručke 160 · 12 kom · naručeno 22.10. (Häfele)',
        ]);
        const id = checkId();
        await handleMaterialButton(link, id, 'snz', '', TZ);
        expect(docs('material_checks').find(c => c.Check_ID === id)!.Status).toBe('snoozed');
    });

    it('stiglo 18 od 24 → djelimičan prijem narudžbe', async () => {
        store.set('orders/o3', { Order_ID: 'o3', Organization_ID: 'org1', Order_Number: 'N-3', Supplier_Name: 'Blum', Status: 'Poslano', Order_Date: '2026-10-26T08:00:00Z', Expected_Delivery: '' });
        store.set('order_items/oi3', { ID: 'oi3', Organization_ID: 'org1', Order_ID: 'o3', Product_Material_ID: 'sa', Product_ID: 'p1', Project_ID: 'pj', Material_Name: 'Šarke Blum', Quantity: 24, Unit: 'kom', Received_Quantity: 0, Status: 'Naručeno', Expected_Price: 240, Actual_Price: 0 });
        store.set('product_materials/sa', { ...pm('sa'), Status: 'Naručeno', Ordered_Quantity: 24, Order_ID: 'o3' });

        const res = await receiveByName('org1', ['pj'], 'šarke', 18, () => undefined);
        expect(res).toEqual({ ok: true, line: '📦 Stiglo: 18 Šarke Blum — narudžba N-3 (primljeno 1 (1 djelimično), čeka još 1)' });
        const item = docs('order_items').find(i => i.ID === 'oi3')!;
        expect(item.Received_Quantity).toBe(18);
        expect(item.Status).toBe('Naručeno');
        expect(pm('sa').Received_Quantity).toBe(18);
        expect(pm('sa').Ordered_Quantity).toBe(6);
        expect(pm('sa').Status).toBe('Naručeno');
    });

    it('okivanje počelo, a ručke nisu stigle → upozorenje i zadatak', async () => {
        setItem([
            { Process_Name: 'Krojenje iverala', Status: 'Završeno' }, { Process_Name: 'Kantiranje iverala', Status: 'Završeno' },
            { Process_Name: 'Sklapanje kutija', Status: 'Završeno' }, { Process_Name: 'Brušenje', Status: 'Završeno' },
            { Process_Name: 'Okivanje', Status: 'U toku' },
        ]);
        expect(await sendMaterialAlerts(new Date(), TZ, { orgId: 'org1' })).toBe(1);
        expect(lastText()).toContain('⚠️ Kuhinja Jerko: počelo okivanje');
        expect(lastButtons().map(r => r[0].text)).toEqual(expect.arrayContaining(['☐ Ručke 160 · 12 kom · naručeno 22.10. (Häfele)']));
        const task = docs('tasks').find(t => String(t.Title).startsWith('Materijal za okivanje'))!;
        expect(task.Title).toBe('Materijal za okivanje: Kuhinja Jerko');
        expect(task.Category).toBe('ordering');
    });
});
