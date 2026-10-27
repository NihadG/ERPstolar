import { factsNote, preparseMessage, sizeKey, uncovered } from '../assistant/preparse';

const known = ['E108', 'E308', 'C403', 'C604', 'hodnik C5', 'Kombi'];

describe('predobrada poruke: stvarne poruke iz Telegrama (26.10.)', () => {
    it('glasovna poruka E308: „puta" → x, širina, lokacija', () => {
        const p = preparseMessage('U stanu 308 imam jedno ogledalo široko 800 milimetara, a nisam postavio jedno ogledalo 1000 puta 1100, jedno ogledalo 800 puta 900 i jedno ogledalo 800 puta 900 i jedan gornji 1100 širine.', { knownLocations: known });
        expect(p.text).toContain('1000x1100');
        expect(p.facts.dims).toEqual(['1000x1100', '800x900', '800x900']);
        expect(p.facts.widths).toEqual(['š 800', 'š 1100']);
    });

    it('„e108", „hodnik e4", tipfeler „pgledalo"; „a 404" i „u 308" nisu ulazi A/U', () => {
        const p = preparseMessage('Stan e302 ima pgledalo 1000x1600 nije postavljeno. I na hodniku e4 imam dva ogledala', { knownLocations: known });
        expect(p.text).toBe('Stan E302 ima ogledalo 1000x1600 nije postavljeno. I na hodniku E4 imam dva ogledala');
        expect(p.facts.locations).toEqual(['hodnik E4', 'E302']);
        expect(preparseMessage('C403 fali 1000x1350, a 404 fali 1000x1600', { knownLocations: known }).text).toBe('C403 fali 1000x1350, a 404 fali 1000x1600');
        expect(preparseMessage('u 308 fali', { knownLocations: known }).text).toBe('u 308 fali');
    });

    it('„u tom stanu" upućuje na lokaciju iz razgovora', () => {
        const p = preparseMessage('I ima u tom stanu ogledalo 1000x800', { knownLocations: known });
        expect(p.facts.deictic).toBe(true);
        expect(factsNote(p.facts, 'E108')).toMatch(/lokacija iz razgovora: E108/);
    });

    it('pokrivenost: C604 s dvije mjere i jednom stavkom → 1720x1000 nedostaje', () => {
        const p = preparseMessage('U c604 imam ogledalo 1720x1000, a fali 1000x1350', { knownLocations: known });
        expect(p.facts.locations).toEqual(['C604']);
        const miss = uncovered(p.facts, ['Ogledalo 1000x1350 · C604 · u stanu, 1720x1000']);
        // Broj u opisu stanja nije stavka — ali ključ mjere jeste prisutan, pa se ovo smatra pokrivenim:
        expect(miss.sizes).toEqual([]);
        expect(uncovered(p.facts, ['Ogledalo 1000x1350 · C604 · fali']).sizes).toEqual(['1720x1000']);
        expect(sizeKey('1350x1000')).toBe(sizeKey('1000x1350'));
    });

    it('napomena za model nabraja šta je ERP našao', () => {
        const p = preparseMessage('U e108 pogresno postavljeno ogledalo, treba 1100x1000. I ima u tom stanu ogledalo 1000x800', { knownLocations: known });
        expect(factsNote(p.facts)).toBe('[ERP u poruci: lokacije E108; mjere 1100x1000, 1000x800 (2 — svaka je posebna stvar, osim kad je rečeno da je ista)]');
    });
});
