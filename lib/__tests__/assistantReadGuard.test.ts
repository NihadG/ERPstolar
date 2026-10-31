// Stvarni promašaji iz dnevnika (30.10.): odgovor „nemam" bez ijednog čitanja ERP-a.
import { asksForData, mailFirstNote, shouldCheckMail, shouldReadFirst } from '../assistant/readGuard';

const base = { isQuestion: true, readUsed: false, readAsked: false, changed: false, answer: 'Evo.' };

describe('pitanje traži podatke iz ERP-a', () => {
    it.each([
        'Koji iveral smo koristili (koji dekor)',
        'Koji je verališao za projekat Švicarska umivaonici?',
        'Kad smo poceli corluku raditi',
        'Jesu li spremna ogledala iz ramaglasa, ova za crni vrh',
        'Koliko je baglama naručeno za Budnju?',
        'Ko je radio montažu kod Jerke?',
    ])('%s → da', q => expect(asksForData(q)).toBe(true));

    it.each([
        'Šta imam sutra?',
        'Koji su mi podsjetnici za danas?',
        'Šta je u bilježnici za E lamelu?',
        'Kako si?',
    ])('%s → ne (već u promptu ili nije podatak)', q => expect(asksForData(q)).toBe(false));
});

describe('kad se tjera čitanje', () => {
    it('pitanje o podacima bez čitanja', () => {
        expect(shouldReadFirst({ ...base, question: 'Koji iveral smo koristili (koji dekor)' })).toBe(true);
    });

    it('„nemam / ne vidim / nisam siguran" bez čitanja, i kad pitanje nema riječi podataka', () => {
        expect(shouldReadFirst({ ...base, question: 'A za drugu fazu?', answer: 'Nemam zapisan dekor iverala za Švicarsku.' })).toBe(true);
        expect(shouldReadFirst({ ...base, question: 'A to?', answer: 'Ne vidim u ERP-u podatke o tome.' })).toBe(true);
        expect(shouldReadFirst({ ...base, question: 'A to?', answer: 'Nisam siguran na šta misliš.' })).toBe(true);
    });

    it('ne tjera: već je čitao, već je tjeran, upisivao je, nije pitanje, ili pitanje o zadacima', () => {
        const q = 'Koji iveral smo koristili?';
        expect(shouldReadFirst({ ...base, question: q, readUsed: true })).toBe(false);
        expect(shouldReadFirst({ ...base, question: q, readAsked: true })).toBe(false);
        expect(shouldReadFirst({ ...base, question: q, changed: true })).toBe(false);
        expect(shouldReadFirst({ ...base, question: q, isQuestion: false })).toBe(false);
        expect(shouldReadFirst({ ...base, question: 'Šta imam sutra?', answer: 'Sutra imaš dva zadatka.' })).toBe(false);
    });
});

// 31.10.: „Ne kontam ovu računicu…" i „Pa uradi to" nisu pitanja — model je odgovarao iz glave
// („ispravio" tačan broj) i obećavao „pozvat ću pregled materijala" bez poziva. brain.ts takve
// poruke (bez upisa) šalje kao isQuestion.
describe('obećanje bez poziva', () => {
    it('„pozvat ću / još nisam pozvao / mogu da pročitam" bez čitanja → prvo čitaj', () => {
        expect(shouldReadFirst({ ...base, question: 'Ok', answer: 'Hvala na strpljenju. Još nisam pozvao pregled materijala.' })).toBe(true);
        expect(shouldReadFirst({ ...base, question: 'Ovo je pogrešno', answer: 'U pravu si. Pozvat ću pregled materijala i ponovo izračunati.' })).toBe(true);
        expect(shouldReadFirst({ ...base, question: 'Pa uradi to', answer: 'Mogu da je pročitam iz kartice projekta.' })).toBe(true);
        expect(shouldReadFirst({ ...base, question: 'Ne kontam ovu računicu, treba 256 a pošto ništa nije naručeno treba 181', answer: 'Cijelih 256 treba naručiti.' })).toBe(true);
    });

    it('ne tjera kad je već čitao ili je obično zahvaljivanje', () => {
        expect(shouldReadFirst({ ...base, question: 'Ok', answer: 'Pozvat ću ponovo ako treba.', readUsed: true })).toBe(false);
        expect(shouldReadFirst({ ...base, question: 'Hvala', answer: 'Nema na čemu.' })).toBe(false);
    });
});

describe('odgovor iz prompta', () => {
    it('odgovor koji citira zadatak/bilježnicu (T#/M#) ne tjera čitanje, osim kad kaže „nemam"', () => {
        expect(shouldReadFirst({ ...base, question: 'ko radi ploču?', answer: 'Ploču za Dinu (T7) radi Amer (W1).' })).toBe(false);
        expect(shouldReadFirst({ ...base, question: 'ko radi ploču?', answer: 'Nemam podatak (T7).' })).toBe(true);
    });
});

// PDF 30.10.: „Jesu li spremna ogledala iz Ramaglasa?" → „ne mogu potvrditi", a u pošti piše „Gotova su ogledala".
describe('pošta prije „ne" (stanje kod dobavljača)', () => {
    const mail = { isQuestion: true, asked: false, mailSearched: false, firmMentioned: false };

    it('pitanje o stanju kod dobavljača + odgovor „ne / nema" → prvo pošta', () => {
        expect(shouldCheckMail({ ...mail, firmMentioned: true, question: 'Jesu li spremna ogledala iz Stakloreza, ova za Kuću?', answer: 'Ne mogu potvrditi da su ogledala spremna. U ERP-u nema nijedne stavke.' })).toBe(true);
        expect(shouldCheckMail({ ...mail, question: 'Je li ko potvrdio na email?', answer: 'Ne, nema odgovora ni potvrde.' })).toBe(true);
        expect(shouldCheckMail({ ...mail, question: 'jel stigao predračun za vrata', answer: 'Nije stiglo ništa.' })).toBe(true);
    });

    it('ne tjera: odgovor iz podataka, pošta već pogledana, već vraćeno, nije pitanje, pitanje nije o dobavljaču', () => {
        const q = 'Jesu li spremna ogledala iz Stakloreza?';
        expect(shouldCheckMail({ ...mail, firmMentioned: true, question: q, answer: 'Da, Staklorez je 3.9. javio da su gotova.' })).toBe(false);
        expect(shouldCheckMail({ ...mail, firmMentioned: true, mailSearched: true, question: q, answer: 'Nema odgovora od njih.' })).toBe(false);
        expect(shouldCheckMail({ ...mail, firmMentioned: true, asked: true, question: q, answer: 'Nema odgovora.' })).toBe(false);
        expect(shouldCheckMail({ ...mail, firmMentioned: true, isQuestion: false, question: q, answer: 'Nema.' })).toBe(false);
        expect(shouldCheckMail({ ...mail, question: 'ko radi sutra?', answer: 'Nemam zapisano.' })).toBe(false);
    });

    it('napomena imenuje firmu i traži search_mail bez riječi', () => {
        expect(mailFirstNote('Staklorez')).toContain('search_mail s who=„Staklorez"');
        expect(mailFirstNote()).toContain('NOVIM mailom');
    });
});
