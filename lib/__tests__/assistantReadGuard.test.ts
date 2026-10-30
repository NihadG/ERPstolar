// Stvarni promašaji iz dnevnika (30.10.): odgovor „nemam" bez ijednog čitanja ERP-a.
import { asksForData, shouldReadFirst } from '../assistant/readGuard';

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

describe('odgovor iz prompta', () => {
    it('odgovor koji citira zadatak/bilježnicu (T#/M#) ne tjera čitanje, osim kad kaže „nemam"', () => {
        expect(shouldReadFirst({ ...base, question: 'ko radi ploču?', answer: 'Ploču za Dinu (T7) radi Amer (W1).' })).toBe(false);
        expect(shouldReadFirst({ ...base, question: 'ko radi ploču?', answer: 'Nemam podatak (T7).' })).toBe(true);
    });
});
