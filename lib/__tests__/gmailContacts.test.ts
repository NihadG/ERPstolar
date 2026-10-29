import type { Contact } from '../types';
import { addressFormOf, gmailContactCandidates, type SentMessageMeta } from '../email/gmailContacts';

const contact = (id: string, email: string, extra: Partial<Contact> = {}): Contact => ({
    Contact_ID: id, Organization_ID: 'o', First_Name: '', Last_Name: '', Email: email, Kind: 'supplier',
    Created_At: '2026-10-01T00:00:00Z', ...extra,
});

const suppliers = [
    { Supplier_ID: 's-ploce', Name: 'Ploče Demo', Contact_Person: '', Phone: '', Email: 'prodaja@ploce-demo.example' },
    { Supplier_ID: 's-staklo', Name: 'Staklo Demo', Contact_Person: '', Phone: '', Email: '' },
];

const msg = (to: string, date: string, snippet = '', cc = ''): SentMessageMeta => ({ to, cc, date, snippet });

describe('obraćanje iz pozdrava', () => {
    it.each([
        ['Pozdrav Selma, U prilogu mozes pronaci ponudu', 'ti'],
        ['Hvala Selma, šta nam je sljedeće činiti?', 'ti'],
        ['Emire, uredu je ovo.', undefined],
        ['Poštovani, u prilogu dostavljamo', 'vi'],
        ['Postovani,', 'vi'],
        ['Dear Ivan, please find', 'vi'],
        ['Pozdrav, šaljem', undefined],
        ['', undefined],
    ])('%s → %s', (snippet, form) => {
        expect(addressFormOf(snippet)).toBe(form);
    });
});

describe('prijedlog kontakata iz poslane pošte', () => {
    const messages = [
        msg('"Emir Hadžić" <emir@ploce-demo.example>', '2026-10-22T08:00:00Z', 'Pozdrav Emire, potvrđujem'),
        msg('Emir Hadžić <emir@ploce-demo.example>', '2026-10-12T08:00:00Z', 'Hvala Emire'),
        msg('emir@ploce-demo.example, Lamija Begić <lamija@ploce-demo.example>', '2026-09-01T08:00:00Z'),
        msg('Selma Ribić <selma@projekt-demo.example>', '2026-10-06T12:00:00Z', 'Poštovani,', 'ja@moj.example, ured@moj.example'),
        msg('no-reply@banka.example', '2026-10-01T08:00:00Z'),
        msg('Top Boja d.o.o. <info@boja-demo.example>', '2026-08-01T08:00:00Z'),
        msg('postojeci@staklo-demo.example', '2026-10-20T08:00:00Z'),
    ];
    const existing = [contact('c1', 'postojeci@staklo-demo.example', { Supplier_ID: 's-staklo', Is_Default: true })];
    const list = gmailContactCandidates(messages, { own: ['ja@moj.example', 'ured@moj.example'], contacts: existing, suppliers });
    const by = (email: string) => list.find(c => c.draft.Email === email);

    it('najčešći primaoci prvi, s brojem mailova i zadnjim datumom', () => {
        expect(list[0].draft.Email).toBe('emir@ploce-demo.example');
        expect(list[0].source).toBe('Gmail: 3 maila, zadnji 22.10.');
        expect(by('selma@projekt-demo.example')!.source).toBe('Gmail: 1 mail, zadnji 6.10.');
    });

    it('preskače svoje adrese, no-reply i postojeće kontakte', () => {
        const emails = list.map(c => c.draft.Email);
        expect(emails).not.toContain('ja@moj.example');
        expect(emails).not.toContain('ured@moj.example');
        expect(emails).not.toContain('no-reply@banka.example');
        expect(emails).not.toContain('postojeci@staklo-demo.example');
    });

    it('domen dobavljača daje dobavljača i jednu ★', () => {
        expect(by('emir@ploce-demo.example')!.draft).toMatchObject({ Kind: 'supplier', Supplier_ID: 's-ploce', Is_Default: true, First_Name: 'Emir', Last_Name: 'Hadžić' });
        expect(by('lamija@ploce-demo.example')!.draft).toMatchObject({ Supplier_ID: 's-ploce', First_Name: 'Lamija' });
        expect(by('lamija@ploce-demo.example')!.draft.Is_Default).toBeUndefined();
    });

    it('obraćanje po pozdravu, samo kad je mail bio upućen samo toj osobi', () => {
        expect(by('emir@ploce-demo.example')!.draft.Address_Form).toBe('ti');
        expect(by('selma@projekt-demo.example')!.draft.Address_Form).toBe('vi');
        expect(by('lamija@ploce-demo.example')!.draft.Address_Form).toBeUndefined();
    });

    it('ime firme ide u Firmu, nepoznat domen je „ostalo"', () => {
        expect(by('info@boja-demo.example')!.draft).toMatchObject({ Company: 'Top Boja d.o.o.', First_Name: '', Kind: 'other' });
        expect(by('selma@projekt-demo.example')!.draft).toMatchObject({ Kind: 'other', First_Name: 'Selma', Last_Name: 'Ribić' });
    });

    it('dobavljač koji već ima ★ ne dobija novu', () => {
        const l = gmailContactCandidates([msg('nova@staklo-demo.example', '2026-10-01T00:00:00Z')], { own: [], contacts: existing, suppliers });
        expect(l[0].draft).toMatchObject({ Supplier_ID: 's-staklo' });
        expect(l[0].draft.Is_Default).toBeUndefined();
    });

    it('gmail.com ne veže za dobavljača', () => {
        const l = gmailContactCandidates([msg('neko@gmail.com', '2026-10-01T00:00:00Z')],
            { own: [], contacts: [contact('c2', 'drugi@gmail.com', { Supplier_ID: 's-ploce' })], suppliers });
        expect(l[0].draft.Supplier_ID).toBeUndefined();
    });
});

describe('unaprijed označeno za uvoz', () => {
    it('dobavljač i češći primalac jesu, jedan mail nepoznatoj adresi nije', () => {
        const list = gmailContactCandidates([
            msg('emir@ploce-demo.example', '2026-10-01T00:00:00Z'),
            msg('selma@projekt-demo.example', '2026-10-01T00:00:00Z'),
            msg('selma@projekt-demo.example', '2026-10-02T00:00:00Z'),
            msg('jednom@nepoznato.example', '2026-10-03T00:00:00Z'),
        ], { own: [], contacts: [], suppliers });
        const pre = Object.fromEntries(list.map(c => [c.draft.Email, c.preselect]));
        expect(pre).toEqual({ 'selma@projekt-demo.example': true, 'emir@ploce-demo.example': true, 'jednom@nepoznato.example': false });
    });
});
