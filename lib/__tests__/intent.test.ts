import { messageIntent } from '../assistant/intent';
import { preparseMessage } from '../assistant/preparse';

const workers = [
    { id: 'imer', name: 'Imer Plećan' }, { id: 'kerim', name: 'Kerim Alić' }, { id: 'emir', name: 'Emir Kos' },
    { id: 'bego', name: 'Bego Saka' }, { id: 'amer', name: 'Amer Berisalić' },
];
const intent = (text: string) => messageIntent(text, workers, preparseMessage(text, { knownLocations: ['E108', 'C604'] }).facts);

describe('šta poruka traži: stvarne poruke 23.–27.10.', () => {
    it('podsjetnici i zadaci', () => {
        expect(intent('Napisi mi u 00:01 poruku za laku noc')).toMatchObject({ kinds: ['reminder'], expectsWrite: true, times: ['00:01'] });
        expect(intent('Neka imer napravi Dini dasku')).toMatchObject({ kinds: ['task'], expectsWrite: true, workerIds: ['imer'] });
        expect(intent('Napomeni da se sutra ujutro javim kerimu da pitam kako ide zavrsavanje knjiga')).toMatchObject({ expectsWrite: true, workerIds: ['kerim'] });
        expect(intent('Sutra javiti Emiru da ne mozemo stici napraviti vrata').kinds).toContain('reminder');
    });

    it('bilježnica, rad, prisustvo, narudžba', () => {
        expect(intent('U e108 pogresno postavljeno ogledalo, treba 1100x1000').kinds).toEqual(['notebook']);
        expect(intent('U kombiju imam 2 ploce hrasta').kinds).toEqual(['notebook']);
        expect(intent('Bego danas pakuje sve proizvode za Čorluku osim vrata').kinds).toEqual(['work']);
        expect(intent('Moras zabiljeziti da su svi prisutni').kinds).toEqual(['presence']);
        expect(intent('Naruci 50 ravnih baglama za Budnju').kinds).toEqual(['order']);
    });

    it('pitanja ne traže upis', () => {
        expect(intent('Sta imam za ponedjeljak')).toMatchObject({ kinds: ['question'], expectsWrite: false });
        expect(intent('Sta sam sve narucio do sada za budnju')).toMatchObject({ expectsWrite: false });
        expect(intent('Kad se zadnji put radilo na Čorluki?').expectsWrite).toBe(false);
        expect(intent('Da').expectsWrite).toBe(false);
    });

    // 31.10.: „Naručio sam preko emaila, poslao Amri" → ERP je tražio upis → „Ništa nije upisano".
    it('„poslao sam mailom" je trag gdje tražiti (pitanje), ne nalog za novi mail', () => {
        expect(intent('Narucio sam preko emaila, poslao amri')).toMatchObject({ kinds: ['question'], expectsWrite: false });
        expect(intent('Poslao sam joj mail prošle sedmice')).toMatchObject({ kinds: ['question'], expectsWrite: false });
        expect(intent('Pošalji Amri narudžbu mailom').kinds).toEqual(['email']);
        expect(intent('Poslao sam mail, napiši Amri još jedan').kinds).toEqual(['email']);
    });
});

// Revizija 11.11.2026 (P-071): pitanje se obrađivalo kao upis.
import { questionOf } from '../assistant/intent';

describe('pitanje nije upis', () => {
    it.each([
        'Na kojim nalozima rade Amer i Bego danas',
        'na čemu radi Imer',
        'Za koga je ova narudžba',
        'Od čega su fronte za kuhinju',
        'Jesu li stigle ručke',
        'Treba li još furnira za hotel',
        'Može li Imer sutra na montažu',
        'Šta je Bego radio ovaj mjesec',
    ])('„%s" počinje kao pitanje → samo pitanje, bez upisa', text => {
        expect(questionOf(text)).toEqual({ question: true, asks: true });
        expect(intent(text)).toMatchObject({ kinds: ['question'], expectsWrite: false, pureQuestion: true });
    });

    it('pitanje o pošti ostaje u skupu za mail, ali ne tjera upis', () => {
        expect(intent('Imaju li ovakvi mailovi od racuni@okovi-demo.example')).toMatchObject({ kinds: ['email', 'question'], expectsWrite: false });
    });

    it('pitanje iza zalijepljenog teksta maila', () => {
        const text = 'Poštovani poslovni partneru, U prilogu dostavljamo Vaš račun u PDF-formatu. Za dodatne informacije obratite se Vašoj kontakt osobi. Imaju li ovakvi emailovi od racuni@okovi-demo.example';
        expect(questionOf(text)).toEqual({ question: true, asks: false });
        expect(intent(text).expectsWrite).toBe(false);
    });

    it.each([
        ['Možeš li otkazati zadatak za Amera?', false],
        ['Hoćeš li me napomenuti sutra u 8 da nazovem Kerima?', false],
        ['Da li možeš naručiti 50 baglama', false],
        ['Hoćeš li me napomenuti sutra za staklo i kad', true],
    ])('molba botu nije pitanje: „%s" → pitanje %s', (text, question) => {
        expect(questionOf(text).question).toBe(question);
    });

    it('molba s upitnikom i dalje upisuje', () => {
        expect(intent('Hoćeš li me napomenuti sutra u 8 da nazovem Kerima?')).toMatchObject({ kinds: ['reminder'], expectsWrite: true, pureQuestion: false });
        expect(intent('Da li možeš naručiti 50 baglama')).toMatchObject({ kinds: ['order'], expectsWrite: true });
    });

    it('izvještaj o radu nije pitanje i dalje je upis', () => {
        expect(intent('Bego i Amer su danas radili kuhinju')).toMatchObject({ kinds: ['work'], expectsWrite: true, pureQuestion: false });
        expect(intent('Svi su prisutni danas').kinds).toEqual(['presence']);
        // Upitnik na kraju izvještaja: ne tjera upis, ali nije „čisto pitanje".
        expect(intent('Bego je danas radio kuhinju, šta još fali?')).toMatchObject({ expectsWrite: false, pureQuestion: false });
    });
});
