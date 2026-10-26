import { locationKey, memoryTitle, normalizeLocation, parseDimensions, relevantMemory, stateLabel } from '../assistant/memoryRules';
import type { MemoryItem } from '../types';

describe('lokacije iz današnjeg razgovora', () => {
    const known = ['E302', 'E303', 'E101', 'E108', 'C404', 'C604', 'Hodnik C5', 'Kombi'];

    it.each([
        ['e004', 'E004'], ['Stan E004', 'E004'], ['u stanu c604', 'C604'], ['hodnik e4', 'Hodnik E4'], ['na hodniku C5', 'Hodnik C5'],
        ['kombi', 'Kombi'], ['Radionica 2', 'Radionica 2'],
    ])('„%s" → %s', (said, expected) => {
        expect(normalizeLocation(said, known)).toEqual({ location: expected });
    });

    it('„308" bez slova: jedina zgrada s 3xx stanovima je E → E308', () => {
        expect(normalizeLocation('stan 308', known)).toEqual({ location: 'E308' });
        expect(normalizeLocation('404', known)).toEqual({ location: 'C404' });
    });

    it('isti broj u dvije zgrade → pitanje', () => {
        expect(normalizeLocation('308', [...known, 'C301'])).toEqual({ ambiguous: ['E308', 'C308'] });
    });

    it('bez ikakvih poznatih lokacija broj ostaje stan', () => {
        expect(normalizeLocation('304', [])).toEqual({ location: 'Stan 304' });
        expect(locationKey('Stan E004')).toBe(locationKey('E004'));
    });
});

describe('mjere i naslov', () => {
    it.each([
        ['1000x1350', '1000x1350', ''], ['1000 x 1350', '1000x1350', ''], ['1000×1350', '1000x1350', ''],
        ['1000 puta 1100', '1000x1100', ''], ['100 puta 135', '1000x1350', ''], ['800 mm širine', 'š 800', ''],
        ['široko 800 milimetara', 'š 800', ''], ['gornje, 1100 širine', 'š 1100', 'gornje'], ['sva', undefined, 'sva'],
    ])('„%s" → %s', (spec, dims, rest) => {
        expect(parseDimensions(spec)).toEqual({ ...(dims ? { dims } : {}), rest });
    });

    it('naslov = predmet + mjere (+ za koji stan)', () => {
        expect(memoryTitle('ogledalo', '1000x1350')).toBe('Ogledalo 1000x1350');
        expect(memoryTitle('ogledalo', undefined, 'C502')).toBe('Ogledalo za C502');
    });

    it('stanje: fiksni naziv + dopuna', () => {
        expect(stateLabel('pogresno', 'treba 1100x1000')).toBe('pogrešno postavljeno, treba 1100x1000');
        expect(stateLabel('nije_postavljeno')).toBe('u stanu, nije postavljeno');
        expect(stateLabel('info', 'prolaz 590 mm')).toBe('prolaz 590 mm');
    });
});

describe('u prompt idu samo stavke o kojima poruka govori', () => {
    const item = (i: number, loc: string, subject = 'ogledalo', at = '2026-10-01'): { alias: string; value: MemoryItem } => ({
        alias: `M${i}`,
        value: { Item_ID: `m${i}`, Subject: subject, Title: subject, Location: loc, Updated_At: at } as MemoryItem,
    });
    const many = Array.from({ length: 80 }, (_, i) => item(i + 1, `E${100 + i}`, i % 2 ? 'umivaonik' : 'lajsna'));

    it('lokacija iz poruke + zadnje dirane', () => {
        const list = [...many, item(81, 'E308', 'ogledalo', '2026-10-02'), item(82, 'Hodnik E4', 'ogledalo', '2026-10-26')];
        const r = relevantMemory(list, 'To je sve E308', { recent: 1 });
        expect(r.map(x => x.alias)).toEqual(['M81', 'M82']);
    });

    it('predmet iz poruke', () => {
        const list = [...many, item(81, 'C404', 'ogledalo')];
        expect(relevantMemory(list, 'gdje sve imam ogledala', { recent: 0 }).map(x => x.alias)).toEqual(['M81']);
    });

    it('mala bilježnica ide cijela', () => {
        expect(relevantMemory(many.slice(0, 10), 'bilo šta')).toHaveLength(10);
    });
});
