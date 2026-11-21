import {
    parsePlanTitle, fitBlockLabel, truncateWords, fitWords, fitVariants, isFullLabel, type MeasureText,
} from '../canvas/label';

// 7 px po znaku — dovoljno blizu stvarnom fontu, a lako za računanje.
const m: MeasureText = (t) => t.length * 7;

describe('parsePlanTitle', () => {
    test('šifra pozicije, naziv i sufiks projekta', () => {
        expect(parsePlanTitle('Poz 9.1 - Unutrašnja obloga · Hotel Grude', 'Hotel Grude'))
            .toEqual({ code: '9.1', name: 'Unutrašnja obloga', suffix: 'Hotel Grude' });
    });

    test('razni zapisi crtice: „Poz 5 -Obloga", „Poz 7.5- Vrata"', () => {
        expect(parsePlanTitle('Poz 5 -Obloga TV-a').code).toBe('5');
        expect(parsePlanTitle('Poz 5 -Obloga TV-a').name).toBe('Obloga TV-a');
        expect(parsePlanTitle('Poz 7.5- Vrata toalet').name).toBe('Vrata toalet');
    });

    test('sufiks se odvaja samo kad je to projekat (dijeli riječ ≥ 4 slova)', () => {
        expect(parsePlanTitle('Poz 3 - Kuhinja · Meliha stan', 'Melihin stan - A5').suffix).toBe('Meliha stan');
        expect(parsePlanTitle('Ormar · bijeli', 'Hotel Grude')).toEqual({ code: '', name: 'Ormar · bijeli', suffix: '' });
    });

    test('naslov bez „Poz" ostaje cio naziv', () => {
        expect(parsePlanTitle('Montaža kuhinje')).toEqual({ code: '', name: 'Montaža kuhinje', suffix: '' });
    });
});

describe('truncateWords — nikad ne siječe riječ', () => {
    test('skraćuje na granici riječi s „…"', () => {
        expect(truncateWords('Ogledalo (iste sobe)', 80, m, 500, 12)).toBe('Ogledalo…');
    });

    test('ne ostavlja viseći veznik ili crticu na kraju', () => {
        // „Obloga u prolazu" → „Obloga u…" bi bilo nečitljivo
        expect(truncateWords('Obloga u prolazu Hodnik', 70, m, 500, 12)).toBe('Obloga…');
        expect(truncateWords('Hodnik - Dnevna soba', 100, m, 500, 12)).toBe('Hodnik…');
    });

    test('ne ostavlja otvorenu zagradu', () => {
        expect(truncateWords('Velika obloga (desno od vjetrobrana)', 170, m, 500, 12)).toBe('Velika obloga…');
    });

    test('null kad ni prva riječ ne stane', () => {
        expect(truncateWords('Recepcija u Fitnesu', 40, m, 500, 12)).toBeNull();
    });
});

describe('fitBlockLabel', () => {
    const p = parsePlanTitle('Poz 12 - Umivaonik · Hotel Grude', 'Hotel Grude');

    test('široka traka: šifra + cio naziv', () => {
        const f = fitBlockLabel(p, 200, m);
        expect(f).toEqual({ code: '12', name: 'Umivaonik' });
        expect(isFullLabel(f)).toBe(true);
    });

    test('sufiks projekta samo kad je tražen i stane', () => {
        expect(fitBlockLabel(p, 300, m, { withSuffix: true })!.suffix).toBe('Hotel Grude');
        expect(fitBlockLabel(p, 300, m)!.suffix).toBeUndefined();
    });

    test('kratka traka: samo šifra u znački, centrirana — nikad prazna', () => {
        const f = fitBlockLabel(p, 30, m);
        expect(f).toEqual({ code: '12', centered: true });
        expect(isFullLabel(f)).toBe(false);
    });

    test('preuska i za značku: gola šifra', () => {
        expect(fitBlockLabel(parsePlanTitle('Poz 9.1 - X'), 24, m)).toEqual({ code: '9.1', centered: true, bare: true });
    });

    test('rezerva za tačku statusa smanjuje mjesto za naziv', () => {
        expect(isFullLabel(fitBlockLabel(p, 110, m))).toBe(true);
        expect(isFullLabel(fitBlockLabel(p, 110, m, { reserve: 13 }))).toBe(false);
    });

    test('mjesečni zum (11 px): ništa — naziv je u kartici na hover', () => {
        expect(fitBlockLabel(p, 11, m)).toBeNull();
    });
});

describe('kolona', () => {
    test('fitWords: cio tekst, skraćen, ili bar prva riječ', () => {
        expect(fitWords('Hotel Grude', 200, m)).toBe('Hotel Grude');
        expect(fitWords('Park Residence - Recepcija', 120, m)).toBe('Park Residence…');
        expect(fitWords('Recepcija', 10, m)).toBe('Recepcija');
    });

    test('fitVariants: najpotpunija varijanta koja stane', () => {
        const v = ['8 naloga · 30.11.–11.1.', '8 naloga'];
        expect(fitVariants(v, 500, m)).toBe(v[0]);
        expect(fitVariants(v, 100, m)).toBe('8 naloga');
        expect(fitVariants(v, 10, m)).toBe('8 naloga');
    });
});
