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

describe('kontekst i intuicija (30.10.)', () => {
    beforeEach(() => {
        store.set('contacts/c1', { ...store.get('contacts/c1'), Is_Default: true });
        store.set('contacts/c4', { Contact_ID: 'c4', Organization_ID: ORG, First_Name: 'Zaim', Last_Name: 'Hodžić', Email: 'zaim@staklo-demo.example', Kind: 'supplier', Supplier_ID: 's1', Address_Form: 'ti', Created_At: 'x' });
        // Novija narudžba istog dobavljača — „ova narudžba" ipak znači onu iz razgovora.
        store.set('orders/o2', { ...store.get('orders/o1'), Order_ID: 'o2', Order_Number: 'N2026-10/99', Order_Date: '2026-10-30T08:00:00Z' });
        store.set('order_items/i2', { ...store.get('order_items/i1'), ID: 'i2', Order_ID: 'o2' });
    });

    it('rečena adresa ima prednost pred glavnim kontaktom', async () => {
        const e = env('pošalji narudžbu na nihad.test@gmail.com');
        const res = await runTool(e, 'email_order', { number: 'N2026-10/07', to: 'nihad.test@gmail.com' });
        expect(res.ok).toBe(true);
        expect(drafts()[0].To).toEqual([{ email: 'nihad.test@gmail.com' }]);
        expect(drafts()[0].Body.startsWith('Poštovani,')).toBe(true);
    });

    it('„pošalji ovu narudžbu Zaimu": narudžba iz razgovora i Zaim iz Kontakata', async () => {
        const e = env('pošalji ovu narudžbu Zaimu');
        e.focusOrder = { id: 'o1', number: 'N2026-10/07', supplier: 'Staklo Demo' };
        const res = await runTool(e, 'email_order', { to: 'Zaimu' });
        expect(res).toMatchObject({ ok: true, order: 'N2026-10/07' });
        expect(drafts()[0].To).toEqual([{ name: 'Zaim Hodžić', email: 'zaim@staklo-demo.example' }]);
        expect(drafts()[0].Body.startsWith('Pozdrav Zaim,')).toBe(true);
        expect(e.touchedOrder).toEqual({ id: 'o1', number: 'N2026-10/07', supplier: 'Staklo Demo' });
    });

    it('bez narudžbe iz razgovora i bez oznake: najnovija', async () => {
        await runTool(env(), 'email_order', {});
        expect(drafts()[0].Entity_ID).toBe('o2');
    });

    it('izmišljena adresa u „to" se odbija', async () => {
        const res = await runTool(env('pošalji narudžbu Zaimu'), 'email_order', { to: 'zaim@izmisljeno.example' });
        expect(res.ok).toBe(false);
        expect(drafts()).toHaveLength(0);
    });

    it('tipfeler u adresi: upozorenje u nacrtu i „Ispravi" ga zamijeni', async () => {
        const typo = 'info@staklo-dmeo.example';
        await runTool(env(`pošalji mail na ${typo} da zanemare narudžbu`), 'email_contact', { to: typo, subject: 'Narudžba N2026-10/07 - zanemarite', text: 'Narudžba je poslana greškom, zanemarite je.' });
        const d = drafts()[0];
        expect(d.Warnings).toEqual([{ email: typo, suggestion: 'info@staklo-demo.example' }]);
        const msg = draftMessage(d);
        expect(msg.text).toContain(`⚠️ ${typo} — da li si mislio info@staklo-demo.example?`);
        expect(msg.buttons[0][0]).toEqual({ text: '✏️ Ispravi na info@staklo-demo.example', data: `em:${d.Draft_ID}:f` });
        await handleEmailButton({ chatId: 77, messageId: 5, callbackId: 'cb' }, link, d.Draft_ID, 'f');
        expect(drafts()[0].To).toEqual([{ email: 'info@staklo-demo.example' }]);
        expect(drafts()[0].Warnings).toEqual([]);
    });

    it('poslije slanja narudžbe: dugme „Vrati narudžbu u nacrt"', async () => {
        await runTool(env(), 'email_order', { number: 'N2026-10/07' });
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A', expires_in: 3600 }))
            .mockResolvedValueOnce(json(200, { id: 'gm1', threadId: 'th1' }));
        await handleEmailButton({ chatId: 77, messageId: 5, callbackId: 'cb' }, link, drafts()[0].Draft_ID, 's');
        const [, , text, buttons] = (editMessageText as jest.Mock).mock.calls[0];
        expect(text).toContain('prešla u „Poslano"');
        expect(buttons).toEqual([[{ text: '↩️ Vrati narudžbu u nacrt', data: 'ordback:o1' }]]);
    });
});

describe('PDF „ove narudžbe"', () => {
    it('order_pdf bez oznake šalje PDF narudžbe iz razgovora, ne najnovije', async () => {
        store.set('orders/o2', { ...store.get('orders/o1'), Order_ID: 'o2', Order_Number: 'N2026-10/99', Order_Date: '2026-10-30T08:00:00Z' });
        const e = env();
        e.focusOrder = { id: 'o1', number: 'N2026-10/07', supplier: 'Staklo Demo' };
        const res = await runTool(e, 'order_pdf', {});
        expect(res).toMatchObject({ ok: true, order: 'N2026-10/07' });
        expect(e.documents).toEqual([{ orderId: 'o1', draft: true }]);
    });
});

// Revizija 02.11.2026 (P-032): „potvrdi predračun koji je Amra poslala i reci da može u
// proizvodnju" → tri poruke bez nacrta. Sad: odgovor u istoj niti + potvrda na narudžbi.
describe('reply_mail: odgovor na mail koji je stigao', () => {
    const intent = (t: string) => messageIntent(t, [], { dims: [], widths: [], locations: [] });
    const MID = 'a1b2c3d4e5f6';

    function gmail(opts: { labels?: string[] } = {}) {
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).includes('oauth2')) return json(200, { access_token: 'A', expires_in: 3600 });
            if (String(url).includes('/messages?')) return json(200, { messages: [{ id: MID }] });
            if (String(url).includes(`/messages/${MID}`)) return json(200, {
                id: MID, threadId: 'th9', labelIds: opts.labels || ['INBOX'], snippet: '', internalDate: '1',
                payload: { headers: [
                    { name: 'From', value: 'Amra Delić <amra@staklo-demo.example>' },
                    { name: 'Subject', value: 'Predračun 331594' },
                    { name: 'Message-ID', value: '<pr331594@staklo-demo.example>' },
                ] },
            });
            throw new Error(`neočekivan poziv ${url}`);
        });
    }

    it('„potvrdi predračun… reci da može u proizvodnju" je mail i bez riječi „mail"', () => {
        expect(intent('Potvrdi mi Amri predračun i reci da može u proizvodnju.')).toMatchObject({ kinds: ['email'], expectsWrite: true });
        expect(intent('Ovaj predračun što je Amra poslala na mail, potvrdi ga i reci joj isto da može to početi proizvoditi.').kinds).toEqual(['email']);
        // Izvještaj o poslanom i dalje nije nalog za mail.
        expect(intent('Naručio sam preko emaila, poslao Amri').kinds).toEqual(['question']);
    });

    it('zadnji primljen mail od osobe → nacrt „Re: …" u istoj niti; predračun potvrđen na narudžbi; Poništi vraća', async () => {
        store.set(`mail_inbox/u1_${MID}`, {
            Item_ID: MID, Organization_ID: ORG, Owner_UID: 'u1', Message_ID: MID, Thread_ID: 'th9', Rfc_Message_ID: '<pr331594@staklo-demo.example>',
            From: 'amra@staklo-demo.example', From_Name: 'Amra Delić', Subject: 'Predračun 331594', Snippet: '', Received_At: '2026-10-29T08:00:00Z',
            Kind: 'quote', Doc_Kind: 'predracun', Doc_No: '331594', Order_IDs: ['o1'], State: 'new', Created_At: 'x',
        });
        gmail();
        const e = env('Potvrdi mi Amri predračun i reci da može u proizvodnju.');
        const res = await runTool(e, 'reply_mail', { who: 'Amra', words: 'predračun', text: 'Potvrđujem predračun 331594. Može u proizvodnju.', confirm: true });
        expect(res).toMatchObject({ ok: true, draft: true, to: 'amra@staklo-demo.example', subject: 'Re: Predračun 331594' });
        const [d] = drafts();
        expect(d).toMatchObject({ Thread_ID: 'th9', In_Reply_To: '<pr331594@staklo-demo.example>', Status: 'draft' });
        expect(d.To[0].email).toBe('amra@staklo-demo.example');
        expect(d.Body).toContain('Potvrđujem predračun 331594. Može u proizvodnju.');
        expect(e.emailDrafts).toEqual([d.Draft_ID]);
        expect(store.get('orders/o1')).toMatchObject({ Supplier_Doc: { No: '331594', Kind: 'predracun' }, Confirmed_At: expect.any(String) });
        expect(store.get(`mail_inbox/u1_${MID}`)!.State).toBe('applied');
        expect(e.summaries[0]).toMatch(/^✔ Predračun 331594 potvrđen na narudžbi N2026-10\/07\.\n✉️ Nacrt odgovora za Amra Delić u istoj niti/);
        // Ništa nije poslano.
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/send'))).toBe(false);

        await undoTurn(e.turnId, 'u1');
        expect(store.get('orders/o1')!.Confirmed_At).toBeUndefined();
    });

    it('narudžba nije u ERP-u (naručeno mailom): samo odgovor, bez upisa', async () => {
        gmail();
        const e = env();
        const res = await runTool(e, 'reply_mail', { id: MID, text: 'Potvrđujem. Može u proizvodnju.', confirm: true });
        expect(res).toMatchObject({ ok: true, note: expect.stringMatching(/nije u ERP-u/) });
        expect(e.changes).toEqual([]);
        expect(drafts()[0].Thread_ID).toBe('th9');
    });

    it('bez teksta ili bez traga koji mail → jasna greška, ništa se ne pravi', async () => {
        await expect(runTool(env(), 'reply_mail', { who: 'Amra' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Treba text/) });
        await expect(runTool(env(), 'reply_mail', { text: 'Važi.' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Na koji mail/) });
    });
});

// Revizija 03.11.2026: tabela iz pročitanih mailova; „ovaj mail je za projekat X".
describe('tabela iz pročitanog teksta', () => {
    const mail = 'Od: Selma Ribić <selma@projekt-demo.example>\nNaslov: Primjedbe kupaca\n\nStan B206: unutar ormarića nedostaje pregrada (LuxCo). Stan B505: šteke na stolariji dotegnuti (LuxCo). Moleraj u dnevnom boravku (Molerski Demo).';

    it('redovi iz pročitanog maila → PDF tabela; filter („samo naše") primijeni model', async () => {
        const e = env();
        e.readTexts = [mail];
        const res = await runTool(e, 'make_table', { source: 'tekst', title: 'Primjedbe kupaca — naše', columns: ['stan', 'primjedba'], rows: [['B206', 'unutar ormarića nedostaje pregrada'], ['B505', 'šteke na stolariji dotegnuti']] });
        expect(res).toMatchObject({ ok: true, count: 2 });
        expect(e.tables?.[0]).toMatchObject({ title: 'Primjedbe kupaca — naše', subtitle: 'iz pročitanog teksta · 2 redova', columns: [{ label: 'Stan' }, { label: 'Primjedba' }] });
        expect(e.tables?.[0].groups[0].rows).toEqual([['B206', 'unutar ormarića nedostaje pregrada'], ['B505', 'šteke na stolariji dotegnuti']]);
    });

    it('red kojeg nema u pročitanom se odbija — ništa iz glave', async () => {
        const e = env();
        e.talkText = mail;
        const res = await runTool(e, 'make_table', { source: 'tekst', columns: ['stan', 'primjedba'], rows: [['C708', 'zamijeniti radnu ploču u kuhinji']] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/nisu u pročitanom tekstu: „C708/) });
        expect(e.tables).toBeUndefined();
    });
});

describe('link_mail: mail se odnosi na drugi projekat', () => {
    const MID = 'b1c2d3e4f5a6';

    it('veza maila prelazi na rečeni projekat; narudžbe drugih projekata se skidaju; Poništi vraća', async () => {
        store.set('projects/p2', { Project_ID: 'p2', Organization_ID: ORG, Name: 'Kuća Brdo', Client_Name: 'Brdo', Status: 'Odobreno' });
        store.set(`mail_inbox/u1_${MID}`, {
            Item_ID: MID, Organization_ID: ORG, Owner_UID: 'u1', Message_ID: MID, Thread_ID: 'th1', From: 'amra@staklo-demo.example', From_Name: 'Amra Delić',
            Subject: 'Ponuda umivaonici', Snippet: '', Received_At: '2026-11-03T08:00:00Z', Kind: 'quote', Order_IDs: ['o1'], Project_IDs: ['p1'], State: 'new', Created_At: 'x',
        });
        const e = env();
        e.ctx.projects.push({ alias: 'P2', value: { id: 'p2', client: 'Brdo', name: 'Kuća Brdo' } } as any);
        const res = await runTool(e, 'link_mail', { id: MID, project: 'P2' });
        expect(res).toMatchObject({ ok: true, mail: 'Ponuda umivaonici' });
        expect(store.get(`mail_inbox/u1_${MID}`)).toMatchObject({ Project_IDs: ['p2'], Order_IDs: [] });
        expect(e.summaries[0]).toMatch(/^🔗 Mail „Ponuda umivaonici" \(Amra Delić\) vezan za projekat/);
        await undoTurn(e.turnId, 'u1');
        expect(store.get(`mail_inbox/u1_${MID}`)).toMatchObject({ Project_IDs: ['p1'], Order_IDs: ['o1'] });
    });
});
