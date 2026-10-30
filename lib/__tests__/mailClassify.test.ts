/**
 * @jest-environment node
 */
// Naslovi i tekstovi su oblikovani po stvarnoj poslovnoj pošti, s izmišljenim
// imenima i domenama.
import { classifyMail, documentNumber, plainTextOf, type IncomingMail, type MailContext } from '../email/classify';
import { mailMessage } from '../assistant/mailText';
import type { Contact, MailInboxItem } from '../types';

const c = (id: string, email: string, extra: Partial<Contact> = {}): Contact => ({
    Contact_ID: id, Organization_ID: 'o', First_Name: '', Last_Name: '', Email: email, Kind: 'supplier', Created_At: '', ...extra,
});

const ctx: MailContext = {
    own: ['ja@luxco-demo.example'],
    contacts: [
        c('c1', 'amra@staklo-demo.example', { First_Name: 'Amra', Last_Name: 'Delić', Supplier_ID: 's-staklo' }),
        c('c2', 'emir@ploce-demo.example', { First_Name: 'Emir', Supplier_ID: 's-ploce' }),
        c('c3', 'selma@projekt-demo.example', { First_Name: 'Selma', Kind: 'site', Company: 'Projekt Demo' }),
        c('c4', 'adnan@kuca-demo.example', { First_Name: 'Adnan', Kind: 'client', Project_Roles: [{ Project_ID: 'p', Role: 'kupac' }] }),
    ],
    suppliers: [
        { Supplier_ID: 's-staklo', Name: 'Staklo Demo', Email: '' },
        { Supplier_ID: 's-ploce', Name: 'Ploče Demo', Email: 'prodaja@ploce-demo.example' },
        { Supplier_ID: 's-okovi', Name: 'Okovi Demo', Email: 'info@okovi-demo.example' },
    ],
    threads: new Map([['th-o1', { orderId: 'o1' }], ['th-gen', {}]]),
    orders: [
        { Order_ID: 'o1', Order_Number: 'N2026-10/07', Supplier_ID: 's-staklo', Status: 'Poslano', Order_Date: '2026-10-20' },
        { Order_ID: 'o2', Order_Number: 'N2026-10/09', Supplier_ID: 's-ploce', Status: 'Nacrt', Order_Date: '2026-10-25' },
        { Order_ID: 'o3', Order_Number: 'N2026-10/10', Supplier_ID: 's-ploce', Status: 'Poslano', Order_Date: '2026-10-26' },
        { Order_ID: 'o4', Order_Number: 'N2026-09/01', Supplier_ID: 's-ploce', Status: 'Primljeno', Order_Date: '2026-09-01' },
    ],
};

const mail = (from: string, subject: string, snippet = '', extra: Partial<IncomingMail> = {}): IncomingMail => ({
    id: 'm', threadId: 't-novi', from, subject, snippet, labelIds: ['INBOX'], ...extra,
});

describe('dobavljač', () => {
    it('predračun u niti narudžbe se veže na tu narudžbu', () => {
        const r = classifyMail(mail('Amra Delić <amra@staklo-demo.example>', 'STAKLO Predracun 330421 - LUX CO doo - Narudzba ogledala', 'U prilogu predračun', { threadId: 'th-o1' }), ctx);
        expect(r).toMatchObject({ kind: 'supplier_doc', docKind: 'predracun', docNo: '330421', supplierId: 's-staklo', orderIds: ['o1'], fromName: 'Amra Delić' });
    });

    it('ponuda s druge adrese iste firme: dobavljač po domenu, otvorene narudžbe, najnovija prva', () => {
        const r = classifyMail(mail('referent@ploce-demo.example', 'PLOCE Ponuda 226230825', 'Poštovani poslovni partneru, u prilogu dostavljamo ponudu'), ctx);
        expect(r).toMatchObject({ kind: 'supplier_doc', docKind: 'ponuda', docNo: '226230825', supplierId: 's-ploce', orderIds: ['o3', 'o2'] });
    });

    it('račun: naslov samo broj (automatska adresa za račune)', () => {
        const r = classifyMail(mail('racuni@ploce-demo.example', '9960754685', 'U prilogu dostavljamo Vaš račun u PDF-formatu.'), ctx);
        expect(r).toMatchObject({ kind: 'invoice', docNo: '9960754685', orderIds: ['o3', 'o4'] });
    });

    it('spremno za preuzimanje', () => {
        const r = classifyMail(mail('amra@staklo-demo.example', 'RE: Dodatna ogledala', '12 kom spremna za preuzimanje'), ctx);
        expect(r).toMatchObject({ kind: 'ready', orderIds: ['o1'] });
        const r2 = classifyMail(mail('info@okovi-demo.example', 'Narudzba', 'Ogledala za Begu su završena'), ctx);
        expect(r2).toMatchObject({ kind: 'ready', supplierId: 's-okovi', orderIds: [] });
    });

    it('običan odgovor u niti narudžbe', () => {
        expect(classifyMail(mail('amra@staklo-demo.example', 'RE: Narudžba', 'Hvala, javljam se sutra', { threadId: 'th-o1' }), ctx).kind).toBe('reply');
    });
});

describe('klijenti i gradilište', () => {
    it('primjedbe s rokom od nadzora/gradilišta', () => {
        const r = classifyMail(mail('selma@projekt-demo.example', 'Kompletiranje pozicija kula B', 'Potrebno je da ugradite vrata u stanu B003. Rok za završetak je 17.10.'), ctx);
        expect(r).toMatchObject({ kind: 'site', fromName: 'Selma' });
    });

    it('odobrena ponuda', () => {
        expect(classifyMail(mail('selma@projekt-demo.example', 'RE: Ponuda montaža-demontaža vrata', 'Vaša ponuda br. 39/08-26 je odobrena.'), ctx).kind).toBe('accepted');
        expect(classifyMail(mail('adnan@kuca-demo.example', 'Re: Konačna ponuda', 'Potvrđujem, može u proizvodnju.'), ctx).kind).toBe('accepted');
    });

    it('kupac s primjedbom nije gradilište, a običan mail poznatog je samo kontakt', () => {
        expect(classifyMail(mail('adnan@kuca-demo.example', 'Pitanje', 'Kad dolazite?'), ctx).kind).toBe('contact');
    });

    it('odgovor u našoj niti od nepoznate adrese', () => {
        expect(classifyMail(mail('neko@drugi.example', 'Re: x', 'ok', { threadId: 'th-gen' }), ctx).kind).toBe('reply');
    });
});

describe('šta se ne dira', () => {
    it.each([
        ['nepoznat pošiljalac', mail('reklama@shop.example', 'Akcija 50%', 'samo danas')],
        ['promocija', mail('amra@staklo-demo.example', 'Newsletter', '', { labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] })],
        ['moj poslani mail', mail('ja@luxco-demo.example', 'Narudžba', '', { labelIds: ['SENT'] })],
        ['vraćen mail', mail('mailer-daemon@googlemail.com', 'Delivery Status Notification', '', { threadId: 'th-o1' })],
        ['gmail adresa sa istim domenom kao kontakt', mail('neko@gmail.com', 'Ponuda 123456', '')],
    ])('%s', (_, m) => {
        expect(classifyMail(m, { ...ctx, contacts: [...ctx.contacts, c('g', 'drugi@gmail.com', { Supplier_ID: 's-staklo' })] }).kind).toBe('ignore');
    });

    it('broj dokumenta', () => {
        expect(documentNumber('SCH Ponuda 226230825')).toBe('226230825');
        expect(documentNumber('Narudzba 12')).toBeUndefined();
    });
});

describe('tekst maila za bilježnicu', () => {
    const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
    it('uzima text/plain i reže citat stare poruke', () => {
        const payload = { mimeType: 'multipart/alternative', parts: [
            { mimeType: 'text/plain', body: { data: b64('Stanovi B102 i B108 — nedostaju lajsne.\nRok 17.10.\n\nOn Mon, Oct 12, 2026 at 9:00 Ja <ja@x> wrote:\n> stara poruka') } },
            { mimeType: 'text/html', body: { data: b64('<p>html</p>') } },
        ] };
        expect(plainTextOf(payload)).toBe('Stanovi B102 i B108 — nedostaju lajsne.\nRok 17.10.');
    });

    it('bez text/plain: html bez oznaka', () => {
        expect(plainTextOf({ mimeType: 'text/html', body: { data: b64('<div>Rok&nbsp;je <b>30.10.</b></div><div>Hvala</div>') } })).toBe('Rok je 30.10.\nHvala');
    });
});

describe('poruka u Telegramu', () => {
    const item = (extra: Partial<MailInboxItem>): MailInboxItem => ({
        Item_ID: 'x', Organization_ID: 'o', Owner_UID: 'u', Message_ID: 'abc', Thread_ID: 't', From: 'amra@staklo-demo.example',
        From_Name: 'Amra Delić', Subject: 'STAKLO Predracun 330421', Snippet: '12 kom spremna za preuzimanje', Received_At: '',
        Kind: 'supplier_doc', Order_IDs: ['o1'], State: 'new', Created_At: '', Supplier_Name: 'Staklo Demo', ...extra,
    });
    const no = (id: string) => ({ o1: 'N2026-10/07', o3: 'N2026-10/10', o2: 'N2026-10/09' } as Record<string, string>)[id];

    it('predračun s jednom narudžbom: veži i potvrdi', () => {
        const m = mailMessage(item({ Doc_Kind: 'predracun', Doc_No: '330421' }), no);
        expect(m.text.split('\n')[0]).toBe('📄 Predračun 330421 od Amra Delić · Staklo Demo');
        expect(m.buttons.flat().map(b => b.data)).toEqual(['mx:abc:c', 'mx:abc:l0', 'mx:abc:i']);
    });

    it('ponuda s dvije narudžbe: izbor', () => {
        const m = mailMessage(item({ Doc_Kind: 'ponuda', Order_IDs: ['o3', 'o2'] }), no);
        expect(m.buttons.flat().map(b => b.text)).toEqual(['🔗 N2026-10/10', '🔗 N2026-10/09', 'Zanemari']);
    });

    it('spremno: preuzeto danas ili samo spremno', () => {
        expect(mailMessage(item({ Kind: 'ready' }), no).buttons[0].map(b => b.data)).toEqual(['mx:abc:r0', 'mx:abc:y0']);
    });

    it('gradilište ide u bilježnicu', () => {
        expect(mailMessage(item({ Kind: 'site', From_Name: 'Selma', Supplier_Name: undefined }), no).buttons[0][0].data).toBe('mx:abc:n');
    });
});
