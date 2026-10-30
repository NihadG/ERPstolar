/**
 * @jest-environment node
 */
jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
jest.mock('@/lib/telegram/api', () => ({ sendMessage: jest.fn(async () => ({ message_id: 1 })), sendDocument: jest.fn() }));
jest.mock('@/lib/server/orderPdf', () => ({
    buildOrderPdf: () => Buffer.from('%PDF-1.4 lazni'),
    orderPdfFileName: (o: { Order_Number: string }) => `Narudzba_${o.Order_Number}.pdf`,
}));

import { fakeStore as store } from '@/lib/testing/fakeFirestore';
import { sendMessage } from '@/lib/telegram/api';
import { saveEmailAccount, GMAIL_SCOPES } from '@/lib/server/gmail';
import { checkBounces, createOrderDraft, DraftError, getDraft, sendDraft, updateDraft } from '@/lib/server/emailDrafts';

const ENV = { ...process.env };
const fetchMock = jest.fn();
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

const ORG = 'org1';
const UID = 'u1';

function seed() {
    store.set('org_settings/org1', { companyInfo: { name: 'Lux-co d.o.o.' } });
    store.set('users/u1', { Name: 'Test Korisnik', Phone: '061 000 000' });
    store.set('projects/p1', { Project_ID: 'p1', Organization_ID: ORG, Name: 'Park Plaza', Client_Name: 'Plaza Invest', Status: 'Odobreno' });
    store.set('suppliers/s1', { Supplier_ID: 's1', Organization_ID: ORG, Name: 'Staklo Demo', Email: 'prodaja@staklo-demo.example' });
    store.set('product_materials/m1', { ID: 'm1', Organization_ID: ORG, Product_ID: 'pr1', Material_Name: 'Ogledalo 4mm', Quantity: 3, Unit: 'kom', Status: 'Nije naručeno', Supplier: 'Staklo Demo', Order_ID: '' });
    store.set('products/pr1', { Product_ID: 'pr1', Organization_ID: ORG, Project_ID: 'p1', Name: 'Ogledalo kupatilo', Quantity: 3, Status: 'Na čekanju' });
    store.set('orders/o1', { Order_ID: 'o1', Organization_ID: ORG, Order_Number: 'N2026-10/07', Name: 'ogledala', Supplier_ID: 's1', Supplier_Name: 'Staklo Demo', Status: 'Nacrt', Order_Date: '2026-10-29T08:00:00Z', Expected_Delivery: '', Total_Amount: 0, Notes: '' });
    store.set('order_items/i1', { ID: 'i1', Organization_ID: ORG, Order_ID: 'o1', Product_Material_ID: 'm1', Product_ID: 'pr1', Product_Name: 'Ogledalo kupatilo', Project_ID: 'p1', Material_Name: 'Ogledalo 4mm', Quantity: 3, Unit: 'kom', Expected_Price: 0, Actual_Price: 0, Received_Quantity: 0, Status: 'Na čekanju' });
    store.set('contacts/c1', { Contact_ID: 'c1', Organization_ID: ORG, First_Name: 'Amra', Last_Name: 'Delić', Email: 'amra@staklo-demo.example', Kind: 'supplier', Supplier_ID: 's1', Is_Default: true, Address_Form: 'ti', Created_At: 'x' });
    store.set('contacts/c2', { Contact_ID: 'c2', Organization_ID: ORG, First_Name: 'Mirza', Last_Name: 'Avdić', Email: 'mirza@staklo-demo.example', Kind: 'supplier', Supplier_ID: 's1', Created_At: 'x' });
    store.set('contacts/c9', { Contact_ID: 'c9', Organization_ID: ORG, First_Name: 'Ured', Last_Name: '', Email: 'ured@luxco-demo.example', Kind: 'internal', Copy_On: ['order'], Created_At: 'x' });
}

beforeEach(async () => {
    store.clear();
    fetchMock.mockReset();
    (sendMessage as jest.Mock).mockClear();
    (global as any).fetch = fetchMock;
    process.env = { ...ENV, GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', EMAIL_TOKEN_KEY: 'test-kljuc-dovoljno-dug' };
    seed();
    await saveEmailAccount({ uid: UID, orgId: ORG, email: 'ja@luxco-demo.example', refreshToken: 'R', scopes: GMAIL_SCOPES });
});
afterAll(() => { process.env = ENV; });

const docWhere = (prefix: string, pred: (d: any) => boolean) => Array.from(store.entries()).find(([k, v]) => k.startsWith(prefix) && pred(v))?.[1];

describe('nacrt narudžbe', () => {
    it('glavni kontakt dobavljača, kopija uredu, naslov i tijelo po obrascu', async () => {
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        expect(v.recipient).toBe('contact');
        expect(v.draft.To).toEqual([{ name: 'Amra Delić', email: 'amra@staklo-demo.example' }]);
        expect(v.draft.Cc).toEqual([{ name: 'Ured', email: 'ured@luxco-demo.example' }]);
        expect(v.draft.Subject).toBe('Narudžba ogledala Park Plaza LUXCO');
        expect(v.draft.Attachments).toEqual([{ kind: 'order', id: 'o1', filename: 'Narudžba ogledala Park Plaza LUXCO.pdf' }]);
        expect(v.draft.Body).toBe('Pozdrav Amra,\n\nU prilogu možeš pronaći narudžbu N2026-10/07. Javi mi rok isporuke kad budeš znao.\n\nSrdačno,\n\nTest Korisnik\n061 000 000');
        expect(v.draft.Status).toBe('draft');
        expect(v.orderStatus).toBe('Nacrt');
        expect(fetchMock).not.toHaveBeenCalled();   // nacrt ne šalje ništa
    });

    it('bez glavnog kontakta: izbor između ljudi dobavljača, bez primaoca', async () => {
        store.set('contacts/c1', { ...store.get('contacts/c1'), Is_Default: false });
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        expect(v.recipient).toBe('choose');
        expect(v.draft.To).toEqual([]);
        expect(v.draft.Candidates!.map(c => c.email).sort()).toEqual(['amra@staklo-demo.example', 'mirza@staklo-demo.example']);
        expect(v.draft.Body.startsWith('Poštovani,')).toBe(true);
        await expect(sendDraft(ORG, UID, v.draft.Draft_ID)).rejects.toThrow('Izaberi kome');
    });

    it('bez kontakata: adresa s kartice dobavljača', async () => {
        store.delete('contacts/c1');
        store.delete('contacts/c2');
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        expect(v.recipient).toBe('supplier-email');
        expect(v.draft.To).toEqual([{ email: 'prodaja@staklo-demo.example' }]);
    });

    it('bez Gmail veze nema nacrta', async () => {
        store.delete('email_accounts/u1');
        await expect(createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' })).rejects.toMatchObject({ code: 'not-connected' });
    });

    it('izmjena prima samo ispravne adrese, a naslov mijenja i ime priloga', async () => {
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        await expect(updateDraft(ORG, UID, v.draft.Draft_ID, { To: ['nije adresa'] })).rejects.toBeInstanceOf(DraftError);
        const d = await updateDraft(ORG, UID, v.draft.Draft_ID, { To: ['Mirza@Staklo-Demo.example', 'mirza@staklo-demo.example'], Subject: 'Hitno: ogledala' });
        expect(d.To).toEqual([{ email: 'mirza@staklo-demo.example' }]);
        expect(d.Attachments[0].filename).toBe('Hitno ogledala.pdf');
    });

    it('tuđi nacrt se ne vidi', async () => {
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        await expect(getDraft(ORG, 'drugi', v.draft.Draft_ID)).rejects.toMatchObject({ status: 404 });
    });
});

describe('slanje', () => {
    it('Gmail → nacrt poslan → narudžba Poslano s niti i adresama, kontakt dobija zadnji mail', async () => {
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A', expires_in: 3600 }))
            .mockResolvedValueOnce(json(200, { id: 'gm1', threadId: 'th1' }));
        const res = await sendDraft(ORG, UID, v.draft.Draft_ID, new Date('2026-10-29T09:00:00Z'));
        expect(res).toEqual({ threadId: 'th1', to: ['amra@staklo-demo.example'], orderSent: true, orderNumber: 'N2026-10/07' });

        const mime = Buffer.from(JSON.parse(fetchMock.mock.calls[1][1].body).raw, 'base64url').toString('utf8');
        expect(mime).toMatch(/^To: =\?UTF-8\?B\?.+\?= <amra@staklo-demo\.example>$/m);   // ime s kvačicom ide kodirano
        expect(mime).toContain('Cc: "Ured" <ured@luxco-demo.example>');
        expect(mime).toContain(`filename*=UTF-8''${encodeURIComponent('Narudžba ogledala Park Plaza LUXCO.pdf')}`);
        expect(mime).toContain(Buffer.from('%PDF-1.4 lazni').toString('base64'));

        const order = store.get('orders/o1')!;
        expect(order).toMatchObject({ Status: 'Poslano', Gmail_Thread_ID: 'th1', Emailed_To: ['amra@staklo-demo.example'], Emailed_At: '2026-10-29T09:00:00.000Z', Email_Bounced: false });
        expect(store.get('order_items/i1')!.Status).toBe('Naručeno');
        expect(store.get('contacts/c1')!.Last_Emailed_At).toBe('2026-10-29T09:00:00.000Z');
        expect(store.get('contacts/c9')!.Last_Emailed_At).toBe('2026-10-29T09:00:00.000Z');
        expect(store.get('contacts/c2')!.Last_Emailed_At).toBeUndefined();
        const draft = docWhere('email_drafts/', d => d.Draft_ID === v.draft.Draft_ID);
        expect(draft).toMatchObject({ Status: 'sent', Thread_ID: 'th1', Gmail_Message_ID: 'gm1', Bounce_Pending: true });

        await expect(sendDraft(ORG, UID, v.draft.Draft_ID)).rejects.toThrow('već poslan');
    });

    it('Gmail odbije: nacrt „failed", narudžba ostaje nacrt', async () => {
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A', expires_in: 3600 }))
            .mockResolvedValueOnce(json(500, { error: { message: 'Backend Error' } }));
        await expect(sendDraft(ORG, UID, v.draft.Draft_ID)).rejects.toMatchObject({ code: 'api' });
        expect(store.get('orders/o1')!.Status).toBe('Nacrt');
        expect(store.get('order_items/i1')!.Status).toBe('Na čekanju');
        expect(docWhere('email_drafts/', d => d.Draft_ID === v.draft.Draft_ID)).toMatchObject({ Status: 'failed', Error: 'Gmail: Backend Error' });
    });

    it('već poslana narudžba se šalje ponovo bez mijenjanja statusa', async () => {
        store.set('orders/o1', { ...store.get('orders/o1'), Status: 'Poslano', Sent_At: '2026-10-20T08:00:00Z' });
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A', expires_in: 3600 }))
            .mockResolvedValueOnce(json(200, { id: 'gm2', threadId: 'th2' }));
        const res = await sendDraft(ORG, UID, v.draft.Draft_ID);
        expect(res.orderSent).toBe(false);
        expect(store.get('orders/o1')).toMatchObject({ Status: 'Poslano', Sent_At: '2026-10-20T08:00:00Z', Gmail_Thread_ID: 'th2' });
    });
});

describe('vraćeni mail', () => {
    async function sentDraft(at: string) {
        const v = await createOrderDraft({ orgId: ORG, uid: UID, orderId: 'o1', source: 'app' });
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A', expires_in: 3600 }))
            .mockResolvedValueOnce(json(200, { id: 'gm1', threadId: 'th1' }));
        await sendDraft(ORG, UID, v.draft.Draft_ID, new Date(at));
        fetchMock.mockReset();
        store.set('assistant_links/l1', { uid: UID, chatId: 77, orgId: ORG });
        return v.draft.Draft_ID;
    }
    const thread = (...froms: string[]) => json(200, { messages: froms.map(f => ({ payload: { headers: [{ name: 'From', value: f }] } })) });

    it('MAILER-DAEMON u niti → oznaka na narudžbi i poruka na Telegram', async () => {
        const id = await sentDraft('2026-10-29T09:00:00Z');
        fetchMock.mockResolvedValueOnce(thread('ja@luxco-demo.example', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>'));
        expect(await checkBounces(new Date('2026-10-29T09:20:00Z'))).toBe(1);
        expect(store.get('orders/o1')!.Email_Bounced).toBe(true);
        expect(docWhere('email_drafts/', d => d.Draft_ID === id)).toMatchObject({ Bounced: true, Bounce_Pending: false });
        expect((sendMessage as jest.Mock).mock.calls[0][0]).toBe(77);
        expect((sendMessage as jest.Mock).mock.calls[0][1]).toContain('Mail se vratio');
    });

    it('prerano se ne provjerava; poslije 2 sata bez povrata se odustaje', async () => {
        const id = await sentDraft('2026-10-29T09:00:00Z');
        expect(await checkBounces(new Date('2026-10-29T09:05:00Z'))).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValueOnce(thread('ja@luxco-demo.example'));
        await checkBounces(new Date('2026-10-29T11:30:00Z'));
        expect(docWhere('email_drafts/', d => d.Draft_ID === id)).toMatchObject({ Bounce_Pending: false });
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
