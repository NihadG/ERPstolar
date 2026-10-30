/**
 * @jest-environment node
 */
// Ulazna pošta od sata do baze i dugmadi: lažni Gmail odgovara po adresi
// zahtjeva, Firestore je u memoriji, Telegram je mock. Imena i domene su izmišljeni.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
jest.mock('@/lib/telegram/api', () => ({
    sendMessage: jest.fn(async () => ({ message_id: 1 })),
    sendDocument: jest.fn(),
    editMessageText: jest.fn(async () => undefined),
    answerCallbackQuery: jest.fn(async () => undefined),
}));
jest.mock('@/lib/server/orderPdf', () => ({
    buildOrderPdf: () => Buffer.from('%PDF-1.4 lazni'),
    orderPdfFileName: (o: { Order_Number: string }) => `Narudzba_${o.Order_Number}.pdf`,
}));

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { getEmailAccount, saveEmailAccount, GMAIL_SCOPES } from '@/lib/server/gmail';
import { syncAllMailboxes, syncMailbox } from '@/lib/server/mailSync';
import { handleMailButton } from '@/lib/assistant/mailButtons';
import { answerCallbackQuery, editMessageText, sendMessage } from '@/lib/telegram/api';
import type { EmailDraft, MailInboxItem } from '@/lib/types';

const ENV = { ...process.env };
const ORG = 'org1';
const UID = 'u1';
const link = { uid: UID, orgId: ORG, chatId: 77, telegramUserId: 1, telegramName: 'x', linkedAt: '' };

// ── Lažni Gmail ──────────────────────────────────────────────────────

interface FakeMsg { id: string; threadId: string; from: string; subject: string; snippet: string; labels?: string[]; rfc?: string; body?: string }
let gmail: { historyId: string; added: string[]; messages: Map<string, FakeMsg>; historyStatus?: number; sent: any[] };

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

const fetchMock = jest.fn(async (url: string, init?: { body?: string; method?: string }) => {
    const u = new URL(url);
    if (u.host === 'oauth2.googleapis.com') return res(200, { access_token: 'A', expires_in: 3600 });
    const path = u.pathname.replace('/gmail/v1/users/me', '');
    if (path === '/profile') return res(200, { emailAddress: 'ja@luxco-demo.example', historyId: gmail.historyId });
    if (path === '/history') {
        if (gmail.historyStatus) return res(gmail.historyStatus, { error: { message: 'Not Found' } });
        return res(200, { history: [{ messagesAdded: gmail.added.map(id => ({ message: { id } })) }], historyId: gmail.historyId });
    }
    if (path === '/messages/send') {
        gmail.sent.push(JSON.parse(init!.body!));
        return res(200, { id: 'sent1', threadId: JSON.parse(init!.body!).threadId || 'tnew' });
    }
    const m = path.match(/^\/messages\/([^/]+)$/);
    if (m) {
        const msg = gmail.messages.get(decodeURIComponent(m[1]));
        if (!msg) return res(404, { error: { message: 'Not Found' } });
        const headers = [{ name: 'From', value: msg.from }, { name: 'Subject', value: msg.subject }, ...(msg.rfc ? [{ name: 'Message-ID', value: msg.rfc }] : [])];
        const payload = u.searchParams.get('format') === 'full'
            ? { mimeType: 'text/plain', headers, body: { data: Buffer.from(msg.body || msg.snippet).toString('base64url') } }
            : { headers };
        return res(200, { id: msg.id, threadId: msg.threadId, snippet: msg.snippet, internalDate: String(Date.parse('2026-10-30T08:00:00Z')), labelIds: msg.labels || ['INBOX'], payload });
    }
    return res(404, { error: { message: `nepoznato ${path}` } });
});

function deliver(...msgs: FakeMsg[]) {
    msgs.forEach(m => gmail.messages.set(m.id, m));
    gmail.added = msgs.map(m => m.id);
    gmail.historyId = String(Number(gmail.historyId) + 1);
}

const inbox = () => docs('mail_inbox') as unknown as MailInboxItem[];
const item = (id: string) => store.get(`mail_inbox/${UID}_${id}`) as MailInboxItem | undefined;
const order = (id: string) => store.get(`orders/${id}`)!;
const lastSent = () => (sendMessage as jest.Mock).mock.calls.at(-1);
const btn = (id: string, action: string) => handleMailButton({ chatId: 77, messageId: 9, callbackId: 'cb', messageText: 'poruka' }, link, id, action);

beforeEach(async () => {
    store.clear();
    jest.clearAllMocks();
    gmail = { historyId: '100', added: [], messages: new Map(), sent: [] };
    (global as any).fetch = fetchMock;
    process.env = { ...ENV, GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', EMAIL_TOKEN_KEY: 'test-kljuc-dovoljno-dug' };

    store.set('users/u1', { Name: 'Test Korisnik' });
    store.set('assistant_links/l1', link);
    store.set('suppliers/s1', { Supplier_ID: 's1', Organization_ID: ORG, Name: 'Staklo Demo', Email: '' });
    store.set('suppliers/s2', { Supplier_ID: 's2', Organization_ID: ORG, Name: 'Ploče Demo', Email: 'prodaja@ploce-demo.example' });
    store.set('contacts/c1', { Contact_ID: 'c1', Organization_ID: ORG, First_Name: 'Amra', Last_Name: 'Delić', Email: 'amra@staklo-demo.example', Kind: 'supplier', Supplier_ID: 's1', Address_Form: 'ti', Created_At: 'x' });
    store.set('contacts/c3', { Contact_ID: 'c3', Organization_ID: ORG, First_Name: 'Selma', Email: 'selma@projekt-demo.example', Kind: 'site', Company: 'Projekt Demo', Created_At: 'x' });
    store.set('products/pr1', { Product_ID: 'pr1', Organization_ID: ORG, Project_ID: 'p1', Name: 'Ogledalo', Quantity: 3, Status: 'Materijali naručeni' });
    store.set('product_materials/m1', { ID: 'm1', Organization_ID: ORG, Product_ID: 'pr1', Material_Name: 'Ogledalo 4mm', Quantity: 3, Unit: 'kom', Status: 'Naručeno', Supplier: 'Staklo Demo', Order_ID: 'o1', Ordered_Quantity: 3 });
    store.set('orders/o1', { Order_ID: 'o1', Organization_ID: ORG, Order_Number: 'N2026-10/07', Supplier_ID: 's1', Supplier_Name: 'Staklo Demo', Status: 'Poslano', Order_Date: '2026-10-20T08:00:00Z', Sent_At: '2026-10-20T08:00:00Z', Gmail_Thread_ID: 'th-o1', Expected_Delivery: '', Total_Amount: 0, Notes: '' });
    store.set('order_items/i1', { ID: 'i1', Organization_ID: ORG, Order_ID: 'o1', Product_Material_ID: 'm1', Product_ID: 'pr1', Product_Name: 'Ogledalo', Project_ID: 'p1', Material_Name: 'Ogledalo 4mm', Quantity: 3, Unit: 'kom', Expected_Price: 0, Actual_Price: 0, Received_Quantity: 0, Status: 'Naručeno' });
    store.set('orders/o2', { Order_ID: 'o2', Organization_ID: ORG, Order_Number: 'N2026-10/09', Supplier_ID: 's2', Supplier_Name: 'Ploče Demo', Status: 'Nacrt', Order_Date: '2026-10-25T08:00:00Z', Expected_Delivery: '', Total_Amount: 0, Notes: '' });
    store.set('orders/o3', { Order_ID: 'o3', Organization_ID: ORG, Order_Number: 'N2026-10/10', Supplier_ID: 's2', Supplier_Name: 'Ploče Demo', Status: 'Poslano', Order_Date: '2026-10-26T08:00:00Z', Expected_Delivery: '', Total_Amount: 0, Notes: '' });

    await saveEmailAccount({ uid: UID, orgId: ORG, email: 'ja@luxco-demo.example', refreshToken: 'R', scopes: GMAIL_SCOPES });
});
afterAll(() => { process.env = ENV; });

const account = async () => (await getEmailAccount(UID))!;

describe('sinhronizacija', () => {
    it('prvi krug samo zapamti mjesto u istoriji — stara pošta se ne obrađuje', async () => {
        expect(await syncMailbox(await account())).toBe(0);
        expect((await account()).History_ID).toBe('100');
        expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/history'))).toBe(false);
        expect(inbox()).toHaveLength(0);
    });

    it('nove poruke: poznate se pamte i javljaju, nepoznate i promocije se ne diraju', async () => {
        await syncMailbox(await account());
        deliver(
            { id: 'a1', threadId: 'th-o1', from: 'Amra Delić <amra@staklo-demo.example>', subject: 'RE: Narudžba ogledala', snippet: '3 kom spremna za preuzimanje' },
            { id: 'a2', threadId: 'tx', from: 'referent@ploce-demo.example', subject: 'PLOCE Ponuda 226230825', snippet: 'U prilogu dostavljamo ponudu', rfc: '<p1@ploce>' },
            { id: 'a3', threadId: 'ty', from: 'Selma <selma@projekt-demo.example>', subject: 'Kompletiranje pozicija kula B', snippet: 'Nedostaju lajsne u stanu B102. Rok za završetak je 17.10.' },
            { id: 'a4', threadId: 'tz', from: 'reklama@shop.example', subject: 'Akcija', snippet: 'samo danas' },
            { id: 'a5', threadId: 'tw', from: 'amra@staklo-demo.example', subject: 'Newsletter', snippet: 'x', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] },
        );
        expect(await syncMailbox(await account())).toBe(3);
        expect(inbox().map(i => [i.Message_ID, i.Kind]).sort()).toEqual([['a1', 'ready'], ['a2', 'supplier_doc'], ['a3', 'site']]);
        expect(item('a1')).toMatchObject({ Order_IDs: ['o1'], Supplier_ID: 's1', From_Name: 'Amra Delić', State: 'new', Notified_At: expect.any(String) });
        expect(item('a2')).toMatchObject({ Doc_No: '226230825', Doc_Kind: 'ponuda', Order_IDs: ['o3', 'o2'], Rfc_Message_ID: '<p1@ploce>' });
        expect((sendMessage as jest.Mock).mock.calls.map(c => c[0])).toEqual([77, 77, 77]);
        expect((await account()).History_ID).toBe('101');
        // U Gmailu se ništa ne mijenja: samo GET pozivi prema Gmail API-ju.
        expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('gmail.googleapis.com')).every(c => !c[1]?.method || c[1].method === 'GET')).toBe(true);
    });

    it('ista poruka dvaput ne javlja dvaput', async () => {
        await syncMailbox(await account());
        const msg = { id: 'b1', threadId: 'th-o1', from: 'amra@staklo-demo.example', subject: 'Re', snippet: 'spremno za preuzimanje' };
        deliver(msg);
        await syncMailbox(await account());
        deliver(msg);   // istorija je opet vrati
        await syncMailbox(await account());
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(inbox()).toHaveLength(1);
    });

    it('običan mail poznatog se pamti, ali bot ne javlja', async () => {
        await syncMailbox(await account());
        deliver({ id: 'c1', threadId: 'tq', from: 'selma@projekt-demo.example', subject: 'Pozdrav', snippet: 'Kako ste?' });
        expect(await syncMailbox(await account())).toBe(0);
        expect(item('c1')!.Kind).toBe('contact');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('istorija prestara (404): kreće se od sada, bez greške', async () => {
        await syncMailbox(await account());
        gmail.historyStatus = 404;
        gmail.historyId = '500';
        expect(await syncMailbox(await account())).toBe(0);
        expect((await account()).History_ID).toBe('500');
    });

    it('nalog koji traži ponovno povezivanje se preskače; sat ide dalje i kad jedan padne', async () => {
        await syncMailbox(await account());
        store.set('email_accounts/u1', { ...store.get('email_accounts/u1'), Status: 'reconnect' });
        deliver({ id: 'd1', threadId: 'th-o1', from: 'amra@staklo-demo.example', subject: 'Re', snippet: 'spremno' });
        expect(await syncAllMailboxes()).toBe(0);
        store.set('email_accounts/u1', { ...store.get('email_accounts/u1'), Status: 'ok' });
        store.set('email_accounts/pokvaren', { UID: 'pokvaren', Organization_ID: ORG, Email: 'x@y.example', Status: 'ok', Scopes: GMAIL_SCOPES, Refresh_Token_Enc: 'smeće', History_ID: '1' });
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await syncAllMailboxes()).toBe(1);
        spy.mockRestore();
    });
});

describe('dugmad', () => {
    async function received(...msgs: FakeMsg[]) {
        await syncMailbox(await account());
        deliver(...msgs);
        await syncMailbox(await account());
        jest.clearAllMocks();
    }

    it('„Veži i odgovori": predračun na narudžbi, nacrt odgovora u istoj niti — ništa nije poslano', async () => {
        await received({ id: 'p1', threadId: 'th-o1', from: 'Amra Delić <amra@staklo-demo.example>', subject: 'STAKLO Predracun 330421', snippet: 'U prilogu predračun', rfc: '<rfc-p1@staklo>' });
        expect(item('p1')).toMatchObject({ Kind: 'supplier_doc', Doc_Kind: 'predracun', Order_IDs: ['o1'] });
        await btn('p1', 'c');
        expect(order('o1')).toMatchObject({ Supplier_Doc: { No: '330421', Kind: 'predracun', Message_ID: 'p1' }, Confirmed_At: expect.any(String) });
        const draft = docs('email_drafts')[0] as unknown as EmailDraft;
        expect(draft).toMatchObject({
            Status: 'draft', Thread_ID: 'th-o1', In_Reply_To: '<rfc-p1@staklo>', Subject: 'Re: STAKLO Predracun 330421',
            To: [{ name: 'Amra Delić', email: 'amra@staklo-demo.example' }],
        });
        expect(draft.Body).toBe('Pozdrav Amra,\n\nPotvrđujem predračun 330421. Može u proizvodnju.\n\nSrdačno,\n\nTest Korisnik');
        expect(gmail.sent).toHaveLength(0);
        expect(lastSent()[1]).toContain('✉️ Nacrt maila');
        expect(item('p1')!.State).toBe('applied');
        expect((editMessageText as jest.Mock).mock.calls[0][2]).toContain('vezan na N2026-10/07');
    });

    it('poslan odgovor nosi In-Reply-To i ostaje u niti', async () => {
        const { sendDraft } = await import('@/lib/server/emailDrafts');
        await received({ id: 'p2', threadId: 'th-o1', from: 'amra@staklo-demo.example', subject: 'Predracun 330422', snippet: 'x', rfc: '<rfc-p2@staklo>' });
        await btn('p2', 'c');
        const draft = docs('email_drafts')[0] as unknown as EmailDraft;
        await sendDraft(ORG, UID, draft.Draft_ID);
        expect(gmail.sent[0].threadId).toBe('th-o1');
        const mime = Buffer.from(gmail.sent[0].raw, 'base64url').toString('utf8');
        expect(mime).toContain('In-Reply-To: <rfc-p2@staklo>');
        expect(mime).toContain('Subject: Re: Predracun 330422');
    });

    it('ponuda s dvije narudžbe: veže se na izabranu', async () => {
        await received({ id: 'q1', threadId: 'tx', from: 'referent@ploce-demo.example', subject: 'PLOCE Ponuda 226230825', snippet: 'ponuda' });
        await btn('q1', 'l1');   // druga ponuđena = o2
        expect(order('o2').Supplier_Doc).toMatchObject({ No: '226230825', Kind: 'ponuda' });
        expect(order('o3').Supplier_Doc).toBeUndefined();
        expect(docs('email_drafts')).toHaveLength(0);
    });

    it('„Preuzeto danas": spremno + prijem cijele narudžbe', async () => {
        await received({ id: 'r1', threadId: 'th-o1', from: 'amra@staklo-demo.example', subject: 'Re', snippet: '3 kom spremna za preuzimanje' });
        await btn('r1', 'r0');
        expect(order('o1')).toMatchObject({ Ready_At: '2026-10-30T08:00:00.000Z', Status: 'Primljeno' });
        expect(store.get('order_items/i1')!.Status).toBe('Primljeno');
        expect((editMessageText as jest.Mock).mock.calls[0][2]).toContain('preuzeta danas');
    });

    it('„Samo spremno": bez prijema', async () => {
        await received({ id: 'r2', threadId: 'th-o1', from: 'amra@staklo-demo.example', subject: 'Re', snippet: 'roba je spremna' });
        await btn('r2', 'y0');
        expect(order('o1')).toMatchObject({ Ready_At: '2026-10-30T08:00:00.000Z', Status: 'Poslano' });
        expect(store.get('order_items/i1')!.Status).toBe('Naručeno');
    });

    it('račun na narudžbu', async () => {
        await received({ id: 'v1', threadId: 'tv', from: 'racuni@ploce-demo.example', subject: '9960754685', snippet: 'U prilogu dostavljamo Vaš račun' });
        expect(item('v1')).toMatchObject({ Kind: 'invoice', Order_IDs: ['o3'] });
        await btn('v1', 'v0');
        expect(order('o3').Invoice).toEqual({ No: '9960754685', Date: '2026-10-30T08:00:00.000Z', Message_ID: 'v1' });
    });

    it('„U bilježnicu": tekst maila ide botu kao proslijeđena poruka', async () => {
        await received({ id: 'n1', threadId: 'ty', from: 'Selma <selma@projekt-demo.example>', subject: 'Kompletiranje pozicija kula B', snippet: 'Nedostaju lajsne', body: 'Nedostaju lajsne u stanu B102.\nRok 17.10.\n\nOn Mon, Oct 12, 2026 at 9:00 Ja <ja@x.example> wrote:\n> staro' });
        const out = await btn('n1', 'n');
        expect(out.forward).toEqual({ text: 'Kompletiranje pozicija kula B\nNedostaju lajsne u stanu B102.\nRok 17.10.', from: 'Selma', date: '2026-10-30T08:00:00.000Z' });
        expect(item('n1')!.State).toBe('applied');
    });

    it('zanemari, pa drugi klik ne radi ništa', async () => {
        await received({ id: 'i1', threadId: 'th-o1', from: 'amra@staklo-demo.example', subject: 'Re', snippet: 'spremno' });
        await btn('i1', 'i');
        expect(item('i1')!.State).toBe('dismissed');
        await btn('i1', 'r0');
        expect((answerCallbackQuery as jest.Mock).mock.calls.at(-1)[1]).toBe('Već zanemareno.');
        expect(order('o1').Status).toBe('Poslano');
    });

    it('tuđi ili nepostojeći mail', async () => {
        await btn('nema', 'i');
        expect((answerCallbackQuery as jest.Mock).mock.calls[0][1]).toContain('nije u ERP-u');
    });
});
