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
});
