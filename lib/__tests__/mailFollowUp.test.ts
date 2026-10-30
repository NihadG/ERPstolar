/**
 * @jest-environment node
 */
import { digestText, followMessage, followOf, needsReply, nextFollowAt, openList } from '../email/followUp';
import type { MailInboxItem } from '../types';

const own = ['ja@luxco-demo.example'];
const ask = (subject: string, snippet: string, to = 'ja@luxco-demo.example', cc = '') => needsReply({ subject, snippet, to, cc, own, companyWords: ['Luxco'] });

describe('treba li odgovor', () => {
    it('pitanje ili molba upućena meni', () => {
        expect(ask('Ponuda za kuhinju', 'Možete li nam poslati cijenu do petka?')).toBe(true);
        expect(ask('Narudžba', 'Molim potvrdu narudžbe.')).toBe(true);
        expect(ask('Dostava', 'Kada možete doći po robu?')).toBe(true);
    });

    it('zahvala i obavijest bez pitanja ne traže odgovor', () => {
        expect(ask('Re: Narudžba', 'Hvala, primljeno.')).toBe(false);
        expect(ask('Info', 'U prilogu je katalog novih proizvoda.')).toBe(false);
    });

    it('masovni mail 10+ primalaca samo kad spominje firmu', () => {
        const many = Array.from({ length: 12 }, (_, i) => `izvodjac${i}@x.example`).join(', ');
        expect(ask('CV_Lamela C', 'Molim sve izvođače da završe radove do petka.', many)).toBe(false);
        expect(ask('CV_Dinamika', 'Luxco treba ugraditi sva ogledala — molim potvrdu roka.', many)).toBe(true);
    });

    it('mail upućen dvoma osobama je direktan', () => {
        expect(ask('Pitanje', 'Da li je moguće pomjeriti montažu?', 'drugi@x.example', 'treci@x.example')).toBe(true);
    });
});

describe('šta se prati i kad se podsjeća', () => {
    it('vrsta → praćenje', () => {
        expect(followOf('ready', false)).toBe('pickup');
        expect(followOf('site', false)).toBe('task');
        expect(followOf('supplier_doc', false)).toBe('reply');
        expect(followOf('contact', true)).toBe('reply');
        expect(followOf('contact', false)).toBeNull();
        expect(followOf('invoice', true)).toBeNull();
    });

    it('raspored: 1, 3, 7 dana; poslije zadnjeg ništa', () => {
        const at = '2026-10-30T08:00:00.000Z';
        expect(nextFollowAt(at, 'reply', 0)).toBe('2026-10-31T08:00:00.000Z');
        expect(nextFollowAt(at, 'reply', 1)).toBe('2026-11-02T08:00:00.000Z');
        expect(nextFollowAt(at, 'reply', 2)).toBe('2026-11-06T08:00:00.000Z');
        expect(nextFollowAt(at, 'reply', 3)).toBeNull();
        expect(nextFollowAt(at, 'pickup', 2)).toBe('2026-11-05T08:00:00.000Z');
    });
});

const item = (id: string, extra: Partial<MailInboxItem>): MailInboxItem => ({
    Item_ID: id, Organization_ID: 'o', Owner_UID: 'u', Message_ID: id, Thread_ID: 't' + id, From: 'x@y.example',
    From_Name: 'Amra Delić', Subject: 'Pitanje', Snippet: 'Možete li potvrditi?', Received_At: '2026-10-28T08:00:00.000Z',
    Kind: 'contact', Order_IDs: [], State: 'new', Created_At: '', ...extra,
});
const now = new Date('2026-10-30T09:00:00.000Z');

describe('podsjetnik', () => {
    it('odgovor: tekst i dugmad', () => {
        const m = followMessage(item('m1', { Follow: 'reply', Follow_Count: 0 }), now);
        expect(m.text.split('\n')[0]).toBe('↩️ Čeka tvoj odgovor — Amra Delić, prije 2 dana:');
        expect(m.buttons.flat().map(b => b.data)).toEqual(['mf:m1:d', 'mf:m1:s', 'mf:m1:x']);
    });

    it('preuzimanje s jednom narudžbom: primi u ERP; zadnji podsjetnik je označen', () => {
        const m = followMessage(item('m2', { Follow: 'pickup', Follow_Count: 2, Kind: 'ready', Supplier_Name: 'Staklo Demo', Order_IDs: ['o1'] }), now, () => 'N2026-10/07');
        expect(m.text).toContain('📦 Još nije preuzeto — Amra Delić · Staklo Demo je javio prije 2 dana');
        expect(m.text).toContain('Narudžba: N2026-10/07');
        expect(m.text).toContain('(zadnji podsjetnik)');
        expect(m.buttons[0][0].text).toBe('📦 Preuzeto (primi u ERP)');
    });

    it('gradilište: urađeno ili u bilježnicu', () => {
        expect(followMessage(item('m3', { Follow: 'task', Kind: 'site' }), now).buttons[0].map(b => b.data)).toEqual(['mf:m3:d', 'mx:m3:n']);
    });
});

describe('sažetak i /posta', () => {
    const since = new Date('2026-10-27T09:00:00.000Z');
    const items = [
        item('a', { Follow: 'reply', Subject: 'Ponuda kuhinja' }),
        item('b', { Follow: 'pickup', Kind: 'ready', Subject: 'Ogledala spremna', Received_At: '2026-10-29T08:00:00.000Z' }),
        item('c', { Follow: 'reply', Done_At: '2026-10-29T10:00:00.000Z', Done_How: 'replied', Subject: 'Predračun 330421' }),
        item('d', { Kind: 'invoice', Subject: '9960754685', Received_At: '2026-10-29T08:00:00.000Z' }),
        item('e', { Follow: 'task', Kind: 'site', Subject: 'Kompletiranje kula B', Received_At: '2026-10-10T08:00:00.000Z' }),   // staro, ali otvoreno
    ];

    it('završeno, čeka odgovor, spremno, gradilište i računi bez veze', () => {
        const t = digestText(items, since, now)!;
        expect(t.split('\n')[0]).toBe('📬 Pošta 27.10.–30.10.: stiglo 4 od poznatih');
        expect(t).toContain('✅ Završeno (1):\n• Amra Delić: „Predračun 330421" — odgovoreno');
        expect(t).toContain('↩️ Čeka tvoj odgovor (1):');
        expect(t).toContain('📦 Spremno, nije preuzeto (1):');
        expect(t).toContain('🏗 Gradilište, otvoreno (1):\n• Amra Delić: „Kompletiranje kula B" — prije 20 dana');
        expect(t).toContain('📄 Predračuni/računi bez veze s narudžbom (1):');
        expect(t).toContain('/posta');
    });

    it('prazan period bez otvorenog → nema sažetka', () => {
        expect(digestText([item('z', { Received_At: '2026-10-01T08:00:00.000Z' })], since, now)).toBeNull();
    });

    it('/posta: otvoreno, najstarije prvo, dugme po stavci', () => {
        const l = openList(items, now);
        expect(l.text.split('\n').slice(1)).toEqual([
            '1. 🏗 Amra Delić: „Kompletiranje kula B" — prije 20 dana',
            '2. ↩️ Amra Delić: „Ponuda kuhinja" — prije 2 dana',
            '3. 📦 Amra Delić: „Ogledala spremna" — prije 1 dana'.replace('prije 1 dana', 'jučer'),
        ]);
        expect(l.buttons.map(r => r[0].data)).toEqual(['mf:e:d', 'mf:a:d', 'mf:b:d']);
        expect(openList([], now).text).toBe('📭 U pošti ništa ne čeka na tebe.');
    });
});

describe('gradilište samo kad je upućeno tebi', () => {
    it('masovni mail bez imena firme nije zadatak', () => {
        expect(followOf('site', false, false)).toBeNull();
        expect(followOf('site', false, true)).toBe('task');
    });
});
