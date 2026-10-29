import {
    addressFormFor, attachmentName, companyTag, composeText, defaultSignature, greeting, orderBody, orderSubject,
} from '../email/compose';

describe('naslov po obrascu „<Vrsta> <predmet> <projekat> FIRMA"', () => {
    it('oznaka firme bez pravnog oblika i znakova', () => {
        expect(companyTag('Lux-co d.o.o.')).toBe('LUXCO');
        expect(companyTag('Stolarija Šehić doo')).toBe('STOLARIJASEHIC');
        expect(companyTag('')).toBe('');
    });

    it('naziv narudžbe + projekat + oznaka', () => {
        expect(orderSubject({ Name: 'ogledala', Order_Number: 'N1' }, ['Park Plaza'], 'LUXCO')).toBe('Narudžba ogledala Park Plaza LUXCO');
        expect(orderSubject({ Name: 'Ogledala', Order_Number: 'N1' }, ['Park Plaza'], 'LUXCO')).toBe('Narudžba ogledala Park Plaza LUXCO');
    });

    it('ne ponavlja ono što naziv već kaže', () => {
        expect(orderSubject({ Name: 'Narudžba dodatnih ogledala za Park Plaza', Order_Number: 'N1' }, ['Park Plaza'], 'LUXCO'))
            .toBe('Narudžba dodatnih ogledala za Park Plaza LUXCO');
        expect(orderSubject({ Name: 'Narudzba ploca LUXCO', Order_Number: 'N1' }, [], 'LUXCO')).toBe('Narudzba ploca LUXCO');
    });

    it('bez naziva ide broj; najviše dva projekta', () => {
        expect(orderSubject({ Name: '', Order_Number: 'N2026-10/07' }, ['A', 'B', 'C'], '')).toBe('Narudžba N2026-10/07 A B');
    });

    it('prilog nosi ime naslova', () => {
        expect(attachmentName('Narudžba ogledala Park Plaza LUXCO')).toBe('Narudžba ogledala Park Plaza LUXCO.pdf');
        expect(attachmentName('Narudžba N2026-10/07')).toBe('Narudžba N2026-10 07.pdf');
        expect(attachmentName('   ')).toBe('Prilog.pdf');
    });
});

describe('pozdrav i tijelo', () => {
    it('ti s imenom, inače Poštovani', () => {
        expect(greeting({ First_Name: 'Amra', Address_Form: 'ti' })).toBe('Pozdrav Amra,');
        expect(greeting({ First_Name: 'Amra' })).toBe('Pozdrav Amra,');
        expect(greeting({ First_Name: 'Amra', Address_Form: 'vi' })).toBe('Poštovani,');
        expect(greeting({ First_Name: '' })).toBe('Poštovani,');
        expect(greeting(undefined)).toBe('Poštovani,');
        expect(addressFormFor(undefined)).toBe('vi');
    });

    it('rok se traži samo kad ga narudžba nema', () => {
        expect(orderBody({ Order_Number: 'N7', Expected_Delivery: '' }, 'ti')).toBe('U prilogu možeš pronaći narudžbu N7. Javi mi rok isporuke kad budeš znao.');
        expect(orderBody({ Order_Number: 'N7', Expected_Delivery: '2026-11-05' }, 'ti')).toBe('U prilogu možeš pronaći narudžbu N7.');
        expect(orderBody({ Order_Number: 'N7', Expected_Delivery: '' }, 'vi')).toBe('U prilogu Vam dostavljamo narudžbu N7. Molimo potvrdu i rok isporuke.');
    });

    it('potpis i sastav', () => {
        expect(defaultSignature('Ime Prezime', '061 000 000')).toBe('Srdačno,\n\nIme Prezime\n061 000 000');
        expect(defaultSignature('', '')).toBe('Srdačno,');
        expect(composeText({ greeting: 'Pozdrav Amra,', body: ' U prilogu je narudžba. ', signature: 'Srdačno,\n\nIme' }))
            .toBe('Pozdrav Amra,\n\nU prilogu je narudžba.\n\nSrdačno,\n\nIme');
    });
});
