import type { Contact } from '../types';
import {
    contactCountBySupplier, contactFullName, duplicateOf, emailDomain, filterContacts, formatAddress,
    groupContacts, importCandidates, isSharedMailDomain, isValidEmail, looksLikeCompany, matchSender,
    normalizeEmail, resolveRecipient, searchContacts, singleDefaults, splitEmails, splitName, staleDefaults,
} from '../contacts';

const person = (id: string, email: string, extra: Partial<Contact> = {}): Contact => ({
    Contact_ID: id, Organization_ID: 'org', First_Name: '', Last_Name: '', Email: email,
    Kind: 'supplier', Created_At: '2026-10-29T00:00:00Z', ...extra,
});

describe('adrese', () => {
    it('vadi adresu iz zaglavlja i svodi na mala slova', () => {
        expect(normalizeEmail('  Emir Hadžić <Emir.Hadzic@Ploce-Demo.EXAMPLE> ')).toBe('emir.hadzic@ploce-demo.example');
        expect(normalizeEmail('mailto:Info@Okovi-Demo.example')).toBe('info@okovi-demo.example');
    });

    it('prepoznaje ispravnu adresu', () => {
        expect(isValidEmail('luxco@bih.net.ba')).toBe(true);
        expect(isValidEmail('luxco@bih')).toBe(false);
        expect(isValidEmail('nije adresa')).toBe(false);
    });

    it('razdvaja više adresa i izbacuje duplikate', () => {
        expect(splitEmails('a@x.ba; B@x.ba, a@x.ba  c@y.com')).toEqual(['a@x.ba', 'b@x.ba', 'c@y.com']);
        expect(splitEmails('')).toEqual([]);
    });

    it('domen firme se razlikuje od zajedničkog domena', () => {
        expect(emailDomain('x@ploce-demo.example')).toBe('ploce-demo.example');
        expect(isSharedMailDomain('x@gmail.com')).toBe(true);
        expect(isSharedMailDomain('luxco@bih.net.ba')).toBe(true);
        expect(isSharedMailDomain('x@ploce-demo.example')).toBe(false);
    });
});

describe('imena', () => {
    it('prezime je zadnja riječ', () => {
        expect(splitName('Emir Hadžić')).toEqual({ first: 'Emir', last: 'Hadžić' });
        expect(splitName('Ana Marija Horvat')).toEqual({ first: 'Ana Marija', last: 'Horvat' });
        expect(splitName('Amra')).toEqual({ first: 'Amra', last: '' });
        expect(splitName('  ')).toEqual({ first: '', last: '' });
    });

    it('razlikuje firmu od osobe', () => {
        expect(looksLikeCompany('Boja Demo d.o.o. Sarajevo')).toBe(true);
        expect(looksLikeCompany('Mak studio Zec')).toBe(true);
        expect(looksLikeCompany('Adnan Kovač')).toBe(false);
    });

    it('ime za prikaz pada na adresu kad imena nema', () => {
        expect(contactFullName(person('1', 'info@x.ba'))).toBe('info@x.ba');
        expect(contactFullName(person('1', 'a@x.ba', { First_Name: 'Amra', Last_Name: 'Delić' }))).toBe('Amra Delić');
    });

    it('zaglavlje Kome ima ime pod navodnicima bez opasnih znakova', () => {
        expect(formatAddress(person('1', 'M@x.ba', { First_Name: 'Amra', Last_Name: 'De"lić' }))).toBe('"Amra Delić" <m@x.ba>');
        expect(formatAddress(person('1', 'info@x.ba'))).toBe('info@x.ba');
    });
});

describe('uvoz iz dobavljača i projekata', () => {
    const suppliers = [
        { Supplier_ID: 's1', Name: 'Staklo Demo', Contact_Person: 'Amra Delić', Phone: '033 111', Email: 'amra.delic@staklo-demo.example' },
        { Supplier_ID: 's2', Name: 'Ploče Demo', Contact_Person: 'Emir Hadžić', Phone: '', Email: 'emir@ploce-demo.example; lamija@ploce-demo.example' },
        { Supplier_ID: 's3', Name: 'Bez maila', Contact_Person: '', Phone: '', Email: '' },
    ];
    const projects = [
        { Project_ID: 'p1', Name: 'Kuća faza 2', Client_Name: 'Adnan Kovač', Client_Email: 'adnan@kuca-demo.example', Client_Phone: '061' },
        { Project_ID: 'p2', Name: 'Kuhinje', Client_Name: 'Boja Demo d.o.o.', Client_Email: 'dario@boja-demo.example', Client_Phone: '' },
        { Project_ID: 'p3', Name: 'Skriven', Client_Name: 'Neko', Client_Email: 'neko@x.ba', Client_Phone: '', Hidden: true },
    ];

    it('pravi kontakt po adresi s imenom samo kad je adresa jedna', () => {
        const list = importCandidates(suppliers, projects, []);
        const staklo = list.find(c => c.draft.Email === 'amra.delic@staklo-demo.example')!;
        expect(staklo.draft).toMatchObject({ First_Name: 'Amra', Last_Name: 'Delić', Supplier_ID: 's1', Kind: 'supplier', Is_Default: true });
        const sch = list.filter(c => c.draft.Supplier_ID === 's2');
        expect(sch.map(c => c.draft.Email)).toEqual(['emir@ploce-demo.example', 'lamija@ploce-demo.example']);
        expect(sch.map(c => c.draft.First_Name)).toEqual(['', '']);
        expect(sch.map(c => !!c.draft.Is_Default)).toEqual([true, false]);
    });

    it('klijent dobija ulogu kupca na projektu, firma ide u Company, skriveni projekti se preskaču', () => {
        const list = importCandidates(suppliers, projects, []);
        const adnan = list.find(c => c.draft.Email === 'adnan@kuca-demo.example')!;
        expect(adnan.draft).toMatchObject({ Kind: 'client', First_Name: 'Adnan', Last_Name: 'Kovač' });
        expect(adnan.draft.Project_Roles).toEqual([{ Project_ID: 'p1', Role: 'kupac' }]);
        const top = list.find(c => c.draft.Email === 'dario@boja-demo.example')!;
        expect(top.draft).toMatchObject({ Company: 'Boja Demo d.o.o.', First_Name: '' });
        expect(list.some(c => c.draft.Email === 'neko@x.ba')).toBe(false);
    });

    it('ne uvozi adrese koje već postoje i ne pravi drugog glavnog kontakta', () => {
        const existing = [person('e1', 'AMRA.DELIC@staklo-demo.example', { Supplier_ID: 's1', Is_Default: true }),
            person('e2', 'emir@ploce-demo.example', { Supplier_ID: 's2', Is_Default: true })];
        const list = importCandidates(suppliers, projects, existing);
        expect(list.some(c => c.draft.Email === 'amra.delic@staklo-demo.example')).toBe(false);
        expect(list.some(c => c.draft.Email === 'emir@ploce-demo.example')).toBe(false);
        const lamija = list.find(c => c.draft.Email === 'lamija@ploce-demo.example')!;
        expect(lamija.draft.Is_Default).toBeUndefined();
    });

    it('ista adresa na dobavljaču i projektu se uvozi jednom', () => {
        const same = importCandidates(
            [{ Supplier_ID: 's9', Name: 'A', Contact_Person: '', Phone: '', Email: 'x@a.ba' }],
            [{ Project_ID: 'p9', Client_Name: 'B', Client_Email: 'X@a.ba', Client_Phone: '' }], [],
        );
        expect(same).toHaveLength(1);
    });
});

describe('pretraga i grupisanje', () => {
    const names = (id: string) => ({ s1: 'Ploče Demo', s2: 'Staklo Demo' } as Record<string, string>)[id];
    const list = [
        person('1', 'emir@ploce-demo.example', { First_Name: 'Emir', Last_Name: 'Hadžić', Supplier_ID: 's1', Role: 'komercijalista' }),
        person('2', 'lamija@ploce-demo.example', { First_Name: 'Lamija', Last_Name: 'Begić', Supplier_ID: 's1', Is_Default: true }),
        person('3', 'amra@staklo-demo.example', { First_Name: 'Amra', Last_Name: 'Delić', Supplier_ID: 's2' }),
        person('4', 'selma@projekt-demo.example', { First_Name: 'Selma', Kind: 'site', Company: 'Projekt Demo' }),
        person('5', 'x@y.ba', { Kind: 'other' }),
    ];

    it('traži bez obzira na kvačice i po firmi dobavljača', () => {
        expect(filterContacts(list, { query: 'hadzic', supplierName: names }).map(c => c.Contact_ID)).toEqual(['1']);
        expect(filterContacts(list, { query: 'ploce-demo', supplierName: names }).map(c => c.Contact_ID)).toEqual(['1', '2']);
        expect(filterContacts(list, { query: 'emir komercijalista' }).map(c => c.Contact_ID)).toEqual(['1']);
    });

    it('filtrira po vrsti', () => {
        expect(filterContacts(list, { kind: 'site' }).map(c => c.Contact_ID)).toEqual(['4']);
        expect(filterContacts(list, { kind: 'all' })).toHaveLength(5);
    });

    it('grupiše po firmi: glavni prvi, bez firme na kraju', () => {
        const groups = groupContacts(list, names);
        expect(groups.map(g => g.company)).toEqual(['Ploče Demo', 'Projekt Demo', 'Staklo Demo', '']);
        const sch = groups.find(g => g.company === 'Ploče Demo')!;
        expect(sch.contacts.map(c => c.Contact_ID)).toEqual(['2', '1']);
    });

    it('adresa koja samo šalje ide na kraj grupe', () => {
        const group = groupContacts([
            person('a', 'racuni@x.example', { Supplier_ID: 's1', Receive_Only: true }),
            person('b', 'b@x.example', { Supplier_ID: 's1', Last_Name: 'Begić' }),
        ], names)[0];
        expect(group.contacts.map(c => c.Contact_ID)).toEqual(['b', 'a']);
    });

    it('broji kontakte po dobavljaču i hvata duplikat adrese', () => {
        expect(contactCountBySupplier(list).get('s1')).toBe(2);
        expect(duplicateOf(list, 'EMIR@ploce-demo.example')?.Contact_ID).toBe('1');
        expect(duplicateOf(list, 'emir@ploce-demo.example', '1')).toBeUndefined();
    });
});

describe('izbor primaoca', () => {
    const sch = [
        person('1', 'emir@ploce-demo.example', { Supplier_ID: 's1' }),
        person('2', 'lamija@ploce-demo.example', { Supplier_ID: 's1', Is_Default: true }),
        person('3', 'racuni@ploce-demo.example', { Supplier_ID: 's1', Receive_Only: true }),
    ];
    const office = person('9', 'luxco@bih.net.ba', { Kind: 'internal', Copy_On: ['order', 'offer'] });

    it('narudžba ide glavnom kontaktu dobavljača, adresa za račune se ignoriše', () => {
        const r = resolveRecipient([...sch, office], { purpose: 'order', supplierId: 's1' });
        expect(r.status).toBe('ok');
        if (r.status === 'ok') {
            expect(r.to.Contact_ID).toBe('2');
            expect(r.cc.map(c => c.Contact_ID)).toEqual(['9']);
        }
    });

    it('bez glavnog i s više ljudi traži izbor, a jedini kontakt ide sam', () => {
        const two = sch.slice(0, 1).concat(person('4', 'alen@ploce-demo.example', { Supplier_ID: 's1' }));
        const r = resolveRecipient(two, { purpose: 'order', supplierId: 's1' });
        expect(r.status).toBe('choose');
        if (r.status === 'choose') expect(r.candidates.map(c => c.Contact_ID)).toEqual(['4', '1']);
        expect(resolveRecipient(sch.slice(0, 1), { purpose: 'order', supplierId: 's1' }).status).toBe('ok');
    });

    it('dobavljač bez kontakata: nema primaoca, ali kopija ostaje', () => {
        const r = resolveRecipient([office], { purpose: 'order', supplierId: 'nepoznat' });
        expect(r.status).toBe('none');
        expect(r.cc.map(c => c.Contact_ID)).toEqual(['9']);
    });

    describe('ponuda i situacija po ulozi na projektu', () => {
        const site = [
            person('a', 'investitor.demo@gmail.com', { Kind: 'site', Project_Roles: [{ Project_ID: 'cv', Role: 'investitor' }] }),
            person('b', 'tarik@projekt-demo.example', { Kind: 'site', Project_Roles: [{ Project_ID: 'cv', Role: 'projektant' }], Copy_On: ['offer'] }),
            person('c', 'jasmina@plaza-invest.example', { Kind: 'site', Project_Roles: [{ Project_ID: 'cv', Role: 'finansije' }], Copy_On: ['offer'] }),
            person('d', 'nermin@situacije-demo.example', { Kind: 'site', Project_Roles: [{ Project_ID: 'cv', Role: 'finansije' }] }),
            person('e', 'drugi@x.ba', { Kind: 'site', Project_Roles: [{ Project_ID: 'drugi', Role: 'investitor' }], Copy_On: ['offer'] }),
        ];

        it('ponuda ide investitoru, u kopiji su oni koji je primaju na tom projektu', () => {
            const r = resolveRecipient([...site, office], { purpose: 'offer', projectId: 'cv' });
            expect(r.status).toBe('ok');
            if (r.status === 'ok') {
                expect(r.to.Contact_ID).toBe('a');
                expect(r.cc.map(c => c.Contact_ID).sort()).toEqual(['9', 'b', 'c']);   // ured + dvoje s kopijom ponude, ne i drugi projekat
            }
        });

        it('situacija ide ulozi finansije', () => {
            const r = resolveRecipient(site.slice(0, 4), { purpose: 'situation', projectId: 'cv' });
            expect(r.status).toBe('choose');
            if (r.status === 'choose') expect(r.candidates.map(c => c.Contact_ID).sort()).toEqual(['c', 'd']);
        });

        it('projekat bez kontakata nema primaoca', () => {
            expect(resolveRecipient(site, { purpose: 'offer', projectId: 'nema' }).status).toBe('none');
        });
    });

    it('opšti mail dobavljaču nema kopije', () => {
        const r = resolveRecipient([...sch, office], { purpose: 'general', supplierId: 's1' });
        expect(r.status).toBe('ok');
        expect(r.cc).toEqual([]);
    });
});

describe('pošiljalac ulazne pošte', () => {
    const list = [
        person('1', 'emir@ploce-demo.example', { Supplier_ID: 's1' }),
        person('2', 'investitor.demo@gmail.com', { Kind: 'site' }),
    ];

    it('ista adresa je kontakt', () => {
        expect(matchSender(list, 'Emir@Ploce-Demo.example').contact?.Contact_ID).toBe('1');
    });

    it('druga adresa iste firme se veže po domenu', () => {
        const m = matchSender(list, 'RACUNI@ploce-demo.example');
        expect(m.contact).toBeUndefined();
        expect(m.viaDomain?.Supplier_ID).toBe('s1');
    });

    it('gmail i slični domeni ne znače firmu', () => {
        expect(matchSender(list, 'neko.drugi@gmail.com')).toEqual({});
        expect(matchSender(list, 'nepoznat@nigdje.ba')).toEqual({ viaDomain: undefined });
    });
});

describe('glavni kontakt', () => {
    it('novi glavni skida oznaku sa starog glavnog istog dobavljača, ne i drugih', () => {
        const list = [
            person('1', 'a@x.ba', { Supplier_ID: 's1', Is_Default: true }),
            person('2', 'b@x.ba', { Supplier_ID: 's1' }),
            person('3', 'c@y.ba', { Supplier_ID: 's2', Is_Default: true }),
        ];
        expect(staleDefaults(list, { Contact_ID: '2', Supplier_ID: 's1', Is_Default: true }).map(c => c.Contact_ID)).toEqual(['1']);
        expect(staleDefaults(list, { Contact_ID: '2', Supplier_ID: 's1', Is_Default: false })).toEqual([]);
        expect(staleDefaults(list, { Contact_ID: '9', Is_Default: true })).toEqual([]);
    });
});

describe('uvoz iz više izvora', () => {
    it('jedna ★ po dobavljaču, nijedna ako dobavljač već ima glavnog', () => {
        const drafts = [
            { Email: 'a@x.example', Supplier_ID: 's1', Is_Default: true },
            { Email: 'b@x.example', Supplier_ID: 's1', Is_Default: true },
            { Email: 'c@y.example', Supplier_ID: 's2', Is_Default: true },
            { Email: 'd@z.example', Is_Default: true },
        ];
        const out = singleDefaults(drafts, [person('e', 'e@y.example', { Supplier_ID: 's2', Is_Default: true })]);
        expect(out.map(d => !!d.Is_Default)).toEqual([true, false, false, true]);
    });
});

describe('traženje osobe po imenu', () => {
    const names = (id: string) => ({ s1: 'Staklo Demo' } as Record<string, string>)[id];
    const list = [
        person('1', 'amra.delic@staklo-demo.example', { First_Name: 'Amra', Last_Name: 'Delić', Supplier_ID: 's1' }),
        person('2', 'selma@projekt-demo.example', { First_Name: 'Selma', Last_Name: 'Ribić', Kind: 'site', Company: 'Projekt Demo' }),
        person('3', 'racuni@staklo-demo.example', { Supplier_ID: 's1', Receive_Only: true }),
        person('4', 'emir@ploce-demo.example', { First_Name: 'Emir', Last_Name: 'Hadžić' }),
    ];
    const ids = (q: string) => searchContacts(list, q, names).map(c => c.Contact_ID);

    it('ime, prezime, firma i adresa', () => {
        expect(ids('Amra')).toEqual(['1']);
        expect(ids('Selma Projekt')).toEqual(['2']);
        expect(ids('Staklo Demo')).toEqual(['1']);   // adresa za račune nije primalac
        expect(ids('EMIR@ploce-demo.example')).toEqual(['4']);
    });

    it('padeži: „Amri", „Selmi", „Hadžiću"', () => {
        expect(ids('Amri')).toEqual(['1']);
        expect(ids('Selmi')).toEqual(['2']);
        expect(ids('Hadžiću')).toEqual(['4']);
    });

    it('nepoznato → prazno', () => {
        expect(ids('Nepoznati')).toEqual([]);
        expect(ids('neko@nigdje.example')).toEqual([]);
    });
});
