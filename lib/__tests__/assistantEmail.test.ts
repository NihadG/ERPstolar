/**
 * @jest-environment node
 */
// Mail preko bota, bez modela: alati prave NACRT (nikad ne šalju), dugmad u
// Telegramu šalju / mijenjaju primaoca / tekst, a namjera „mail" ne pravi
// usput narudžbu ni zadatak.

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
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';
import { saveEmailAccount, GMAIL_SCOPES } from '@/lib/server/gmail';
import { draftMessage } from '@/lib/assistant/emailText';
import { consumeDraftText, handleEmailButton } from '@/lib/assistant/emailButtons';
import { messageIntent } from '@/lib/assistant/intent';
import { editMessageText, sendMessage } from '@/lib/telegram/api';
import type { EmailDraft } from '@/lib/types';

const ENV = { ...process.env };
const fetchMock = jest.fn();
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const ORG = 'org1';
const link = { uid: 'u1', orgId: ORG, chatId: 77, telegramUserId: 1, telegramName: 'x', linkedAt: '' };

let turn = 0;
function env(groundText?: string): ToolEnv {
    return {
        orgId: ORG, uid: 'u1', tz: 'Europe/Sarajevo', now: new Date('2026-10-29T10:00:00Z'),
        turnId: `turn${++turn}`, dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [], groundText,
        ctx: { workers: [], suppliers: [], memory: [], tasks: [], names: [], projects: [{ alias: 'P1', value: { id: 'p1', client: 'Plaza Invest', name: 'Park Plaza' } }] },
    } as unknown as ToolEnv;
}

const drafts = () => docs('email_drafts') as unknown as EmailDraft[];

beforeEach(async () => {
    store.clear();
    fetchMock.mockReset();
    jest.clearAllMocks();
    (global as any).fetch = fetchMock;
    process.env = { ...ENV, GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', EMAIL_TOKEN_KEY: 'test-kljuc-dovoljno-dug' };
    store.set('org_settings/org1', { companyInfo: { name: 'Lux-co d.o.o.' } });
    store.set('users/u1', { Name: 'Test Korisnik' });
    store.set('projects/p1', { Project_ID: 'p1', Organization_ID: ORG, Name: 'Park Plaza', Client_Name: 'Plaza Invest', Status: 'Odobreno' });
    store.set('suppliers/s1', { Supplier_ID: 's1', Organization_ID: ORG, Name: 'Staklo Demo', Email: '' });
    store.set('products/pr1', { Product_ID: 'pr1', Organization_ID: ORG, Project_ID: 'p1', Name: 'Ogledalo', Quantity: 3, Status: 'Na čekanju' });
    store.set('product_materials/m1', { ID: 'm1', Organization_ID: ORG, Product_ID: 'pr1', Material_Name: 'Ogledalo 4mm', Quantity: 3, Unit: 'kom', Status: 'Nije naručeno', Supplier: 'Staklo Demo', Order_ID: '' });
    store.set('orders/o1', { Order_ID: 'o1', Organization_ID: ORG, Order_Number: 'N2026-10/07', Name: 'ogledala', Supplier_ID: 's1', Supplier_Name: 'Staklo Demo', Status: 'Nacrt', Order_Date: '2026-10-29T08:00:00Z', Expected_Delivery: '', Total_Amount: 0, Notes: '' });
    store.set('order_items/i1', { ID: 'i1', Organization_ID: ORG, Order_ID: 'o1', Product_Material_ID: 'm1', Product_ID: 'pr1', Product_Name: 'Ogledalo', Project_ID: 'p1', Material_Name: 'Ogledalo 4mm', Quantity: 3, Unit: 'kom', Expected_Price: 0, Actual_Price: 0, Received_Quantity: 0, Status: 'Na čekanju' });
    store.set('contacts/c1', { Contact_ID: 'c1', Organization_ID: ORG, First_Name: 'Amra', Last_Name: 'Delić', Email: 'amra@staklo-demo.example', Kind: 'supplier', Supplier_ID: 's1', Address_Form: 'ti', Created_At: 'x' });
    store.set('contacts/c2', { Contact_ID: 'c2', Organization_ID: ORG, First_Name: 'Mirza', Last_Name: 'Avdić', Email: 'mirza@staklo-demo.example', Kind: 'supplier', Supplier_ID: 's1', Address_Form: 'vi', Created_At: 'x' });
    store.set('contacts/c3', { Contact_ID: 'c3', Organization_ID: ORG, First_Name: 'Selma', Last_Name: 'Ribić', Email: 'selma@projekt-demo.example', Kind: 'site', Company: 'Projekt Demo', Address_Form: 'ti', Created_At: 'x' });
    await saveEmailAccount({ uid: 'u1', orgId: ORG, email: 'ja@luxco-demo.example', refreshToken: 'R', scopes: GMAIL_SCOPES });
});
afterAll(() => { process.env = ENV; });

describe('namjera „mail"', () => {
    const intent = (t: string) => messageIntent(t, [], { dims: [], widths: [], locations: [] });

    it('mail nije nova narudžba, zadatak ni stanje procesa', () => {
        expect(intent('pošalji Amri narudžbu ogledala mailom').kinds).toEqual(['email']);
        expect(intent('javi Selmi mailom da su lajsne gotove').kinds).toEqual(['email']);
        expect(intent('pošalji Amri narudžbu ogledala mailom').expectsWrite).toBe(true);
    });

    it('pitanje o adresi nije mail', () => {
        const i = intent('koji je mail od Stakla?');
        expect(i.kinds).not.toContain('email');
        expect(i.expectsWrite).toBe(false);
    });
});

describe('email_order: samo nacrt', () => {
    it('nacrt narudžbe s dodatnom rečenicom; ništa nije poslano', async () => {
        store.set('contacts/c1', { ...store.get('contacts/c1'), Is_Default: true });
        const e = env();
        const res = await runTool(e, 'email_order', { supplier: 'Staklo Demo', text: 'Isporuka nam treba do petka' });
        expect(res).toMatchObject({ ok: true, draft: true, order: 'N2026-10/07' });
        expect(e.emailDrafts).toHaveLength(1);
        expect(e.summaries[0]).toContain('ništa još nije poslano');
        const d = drafts()[0];
        expect(d.Source).toBe('telegram');
        expect(d.Parts!.text).toBe('U prilogu možeš pronaći narudžbu N2026-10/07. Javi mi rok isporuke kad budeš znao. Isporuka nam treba do petka.');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(store.get('orders/o1')!.Status).toBe('Nacrt');
    });

    it('bez Gmail veze: jasna poruka, bez nacrta', async () => {
        store.delete('email_accounts/u1');
        const res = await runTool(env(), 'email_order', { supplier: 'Staklo Demo' });
        expect(res.ok).toBe(false);
        expect(String(res.error)).toContain('Postavke → Kontakti');
        expect(drafts()).toHaveLength(0);
    });

    it('nepoznata narudžba je greška', async () => {
        expect((await runTool(env(), 'email_order', { number: 'X99' })).ok).toBe(false);
    });
});

describe('dugmad nacrta u Telegramu', () => {
    async function orderDraftWithChoice(): Promise<EmailDraft> {
        await runTool(env(), 'email_order', { supplier: 'Staklo Demo' });   // dva kontakta, nijedan ★
        return drafts()[0];
    }

    it('izbor primaoca: pozdrav i tekst prate obraćanje te osobe (ti za Amru)', async () => {
        const d = await orderDraftWithChoice();
        const msg = draftMessage(d);
        expect(msg.text).toContain('Kome: — izaberi ispod');
        expect(msg.buttons.flat().map(b => b.data)).toEqual([`em:${d.Draft_ID}:t0`, `em:${d.Draft_ID}:t1`, `em:${d.Draft_ID}:x`]);
        expect(d.Body.startsWith('Poštovani,\n\nU prilogu Vam dostavljamo')).toBe(true);
        const amra = d.Candidates!.findIndex(c => c.email === 'amra@staklo-demo.example');
        await handleEmailButton({ chatId: 77, messageId: 5, callbackId: 'cb' }, link, d.Draft_ID, `t${amra}`);
        const after = drafts()[0];
        expect(after.To).toEqual([{ name: 'Amra Delić', email: 'amra@staklo-demo.example' }]);
        expect(after.Body.startsWith('Pozdrav Amra,\n\nU prilogu možeš pronaći narudžbu N2026-10/07.')).toBe(true);
        const edited = (editMessageText as jest.Mock).mock.calls[0];
        expect(edited[2]).toContain('Kome: Amra Delić <amra@staklo-demo.example>');
        expect(edited[3].flat().map((b: { data: string }) => b.data)).toEqual([`em:${d.Draft_ID}:s`, `em:${d.Draft_ID}:e`, `em:${d.Draft_ID}:x`]);
    });

    it('izbor osobe na „vi" daje vi-tekst; ručno pisan tekst se ne dira', async () => {
        const d = await orderDraftWithChoice();
        const mirza = d.Candidates!.findIndex(c => c.email === 'mirza@staklo-demo.example');
        await consumeDraftText(77, link, 'x');   // ništa ne čeka tekst
        await handleEmailButton({ chatId: 77, messageId: 5, callbackId: 'cb' }, link, d.Draft_ID, `t${mirza}`);
        expect(drafts()[0].Body.startsWith('Poštovani,\n\nU prilogu Vam dostavljamo narudžbu')).toBe(true);
    });

    it('„Izmijeni tekst": sljedeća poruka postaje tekst, pozdrav i potpis ostaju', async () => {
        store.set('contacts/c1', { ...store.get('contacts/c1'), Is_Default: true });
        await runTool(env(), 'email_order', { supplier: 'Staklo Demo' });
        const d = drafts()[0];
        await handleEmailButton({ chatId: 77, messageId: 5, callbackId: 'cb' }, link, d.Draft_ID, 'e');
        expect((sendMessage as jest.Mock).mock.calls.at(-1)[1]).toContain('Napiši novi tekst');
        expect(await consumeDraftText(77, link, 'Šaljem narudžbu, treba nam do petka.')).toBe(true);
        const after = drafts()[0];
        expect(after.Body).toBe('Pozdrav Amra,\n\nŠaljem narudžbu, treba nam do petka.\n\nSrdačno,\n\nTest Korisnik');
        expect(after.Awaiting_Text_Since).toBeNull();
        // Sljedeća poruka opet ide botu.
        expect(await consumeDraftText(77, link, 'nešto drugo')).toBe(false);
    });

    it('„Pošalji": Gmail, narudžba u Poslano, poruka se pretvori u potvrdu', async () => {
        store.set('contacts/c1', { ...store.get('contacts/c1'), Is_Default: true });
        await runTool(env(), 'email_order', { supplier: 'Staklo Demo' });
        const d = drafts()[0];
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A', expires_in: 3600 }))
            .mockResolvedValueOnce(json(200, { id: 'gm1', threadId: 'th1' }));
        await handleEmailButton({ chatId: 77, messageId: 5, callbackId: 'cb' }, link, d.Draft_ID, 's');
        expect(store.get('orders/o1')!.Status).toBe('Poslano');
        const text = (editMessageText as jest.Mock).mock.calls[0][2];
        expect(text).toContain('📤 Poslano: „Narudžba ogledala Park Plaza LUXCO" → amra@staklo-demo.example');
        expect(text).toContain('prešla u „Poslano"');
    });

    it('„Otkaži": ništa se ne šalje', async () => {
        store.set('contacts/c1', { ...store.get('contacts/c1'), Is_Default: true });
        await runTool(env(), 'email_order', { supplier: 'Staklo Demo' });
        const d = drafts()[0];
        await handleEmailButton({ chatId: 77, messageId: 5, callbackId: 'cb' }, link, d.Draft_ID, 'x');
        expect(drafts()[0].Status).toBe('cancelled');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(store.get('orders/o1')!.Status).toBe('Nacrt');
    });

    it('Gmail odbije: poruka greške, narudžba ostaje nacrt', async () => {
        store.set('contacts/c1', { ...store.get('contacts/c1'), Is_Default: true });
        await runTool(env(), 'email_order', { supplier: 'Staklo Demo' });
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A', expires_in: 3600 }))
            .mockResolvedValueOnce(json(500, { error: { message: 'Backend Error' } }));
        await handleEmailButton({ chatId: 77, messageId: 5, callbackId: 'cb' }, link, drafts()[0].Draft_ID, 's');
        expect((sendMessage as jest.Mock).mock.calls.at(-1)[1]).toContain('Gmail nije prihvatio mail');
        expect(store.get('orders/o1')!.Status).toBe('Nacrt');
    });
});

describe('email_contact: opšti mail', () => {
    it('osoba iz Kontakata (padež), pozdrav i potpis dodaje ERP', async () => {
        const e = env();
        const res = await runTool(e, 'email_contact', { to: 'Selmi', subject: 'Lajsne kula B', text: 'Lajsne u kuli B su gotove, sutra ih montiramo.' });
        expect(res).toMatchObject({ ok: true, draft: true, to: ['selma@projekt-demo.example'] });
        const d = drafts()[0];
        expect(d.Purpose).toBe('general');
        expect(d.Body).toBe('Pozdrav Selma,\n\nLajsne u kuli B su gotove, sutra ih montiramo.\n\nSrdačno,\n\nTest Korisnik');
        expect(d.Attachments).toEqual([]);
    });

    it('više osoba iste firme → izbor', async () => {
        const res = await runTool(env(), 'email_contact', { to: 'Staklo Demo', subject: 'x', text: 'y' });
        expect(res.ok).toBe(true);
        expect(drafts()[0].To).toEqual([]);
        expect(drafts()[0].Candidates).toHaveLength(2);
    });

    it('nepoznata osoba: traži adresu, ništa ne pravi', async () => {
        const res = await runTool(env(), 'email_contact', { to: 'Nepoznati Čovjek', subject: 'x', text: 'y' });
        expect(res.ok).toBe(false);
        expect(String(res.error)).toContain('nije u Kontaktima');
        expect(drafts()).toHaveLength(0);
    });

    it('izmišljena adresa se odbija, napisana prolazi', async () => {
        const made = await runTool(env('pošalji mail Hasanu da kasnimo'), 'email_contact', { to: 'hasan@izmisljeno.example', subject: 'x', text: 'y' });
        expect(made.ok).toBe(false);
        const said = await runTool(env('pošalji mail na hasan@firma.example da kasnimo'), 'email_contact', { to: 'hasan@firma.example', subject: 'Kašnjenje', text: 'Kasnimo dva dana.' });
        expect(said.ok).toBe(true);
        expect(drafts()[0].To).toEqual([{ email: 'hasan@firma.example' }]);
        expect(drafts()[0].Body.startsWith('Poštovani,')).toBe(true);
    });
});

describe('kontakti preko bota', () => {
    it('find_contact daje ime, adresu i firmu', async () => {
        const res = await runTool(env(), 'find_contact', { query: 'Staklo' });
        expect(res.contacts).toEqual(['Amra Delić <amra@staklo-demo.example> · Staklo Demo', 'Mirza Avdić <mirza@staklo-demo.example> · Staklo Demo']);
    });

    it('save_contact: adresa iz poruke, dobavljač po imenu, prvi kontakt dobavljača je ★; poništi briše', async () => {
        store.set('suppliers/s2', { Supplier_ID: 's2', Organization_ID: ORG, Name: 'Okovi Demo' });
        const e = env('sačuvaj Marka iz Okova, marko@okovi-demo.example, komercijalista');
        const res = await runTool(e, 'save_contact', { first_name: 'Marko', email: 'marko@okovi-demo.example', supplier: 'Okovi Demo', role: 'komercijalista' });
        expect(res).toMatchObject({ ok: true, saved: 'Marko', supplier: 'Okovi Demo' });
        const saved = docs('contacts').find(c => c.Email === 'marko@okovi-demo.example')!;
        expect(saved).toMatchObject({ Supplier_ID: 's2', Kind: 'supplier', Is_Default: true, Role: 'komercijalista' });
        expect(e.summaries[0]).toBe('👤 U Kontakte: Marko <marko@okovi-demo.example> · Okovi Demo ★ · komercijalista');
        await undoTurn(e.turnId, 'u1');
        expect(docs('contacts').some(c => c.Email === 'marko@okovi-demo.example')).toBe(false);
    });

    it('save_contact: adresa koju korisnik nije napisao i duplikat se odbijaju', async () => {
        expect((await runTool(env('sačuvaj Marka iz Okova'), 'save_contact', { email: 'marko@okovi-demo.example' })).ok).toBe(false);
        expect((await runTool(env('selma@projekt-demo.example'), 'save_contact', { email: 'selma@projekt-demo.example' })).ok).toBe(false);
    });
});
