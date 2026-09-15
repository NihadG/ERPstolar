// Pretraga u sučelju — ono što naivni `includes()` ne rješava.

import { highlightRanges, matchesSearch, normalizeForSearch, searchScore, searchTokens } from '../searchMatch';

test('dijakritika se zanemaruje u oba smjera', () => {
    expect(normalizeForSearch('Čošić')).toBe('cosic');
    expect(normalizeForSearch('Vođice')).toBe('vodice');
    expect(matchesSearch(searchTokens('cosic'), 'Nermin Čošić')).toBe(true);
    expect(matchesSearch(searchTokens('čošić'), 'Nermin Cosic')).toBe(true);
});

test('redoslijed riječi nije bitan, ali svaka riječ mora biti nađena', () => {
    expect(matchesSearch(searchTokens('bajrak nedim'), 'Nedim Bajraktarević')).toBe(true);
    expect(matchesSearch(searchTokens('nedim kanjic'), 'Nedim Bajraktarević')).toBe(false);
});

test('prazan upit propušta sve — polje bez teksta ne smije sakriti listu', () => {
    expect(matchesSearch(searchTokens(''), 'bilo šta')).toBe(true);
    expect(matchesSearch(searchTokens('   '), 'bilo šta')).toBe(true);
    expect(searchTokens('')).toEqual([]);
});

test('tokeni se traže i kroz sporedna polja (npr. uloga radnika)', () => {
    expect(matchesSearch(searchTokens('rezac'), 'Samir Kanjić', 'Rezač')).toBe(true);
    expect(matchesSearch(searchTokens('rezac'), 'Samir Kanjić', 'Montaža')).toBe(false);
});

test('bolji pogodak nosi više bodova — Enter na vrhu liste mora biti predvidiv', () => {
    const tokens = searchTokens('mir');
    const exact = searchScore(tokens, 'Mir');
    const wordStart = searchScore(tokens, 'Samir Mirković');
    const inside = searchScore(tokens, 'Samir Kanjić');
    expect(exact).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
});

test('promašaj nosi nulu, pa se ne može uvrstiti među rezultate', () => {
    expect(searchScore(searchTokens('emir'), 'Samir Kanjić', 'Opći')).toBe(0);
    expect(searchScore(searchTokens('kanjic'), '', '')).toBe(0);
});

test('primarno polje tuče sporedno pri jednakom obliku pogotka', () => {
    const tokens = searchTokens('montaza');
    expect(searchScore(tokens, 'Montaža', 'Opći')).toBeGreaterThan(searchScore(tokens, 'Opći', 'Montaža'));
});

test('podebljanje pogađa izvorne znakove i kad je upit bez kvačica', () => {
    // „cosic" mora osvijetliti „Čošić" — NFD razlaganje ne smije pomjeriti indekse.
    expect(highlightRanges('Nermin Čošić', searchTokens('cosic'))).toEqual([[7, 12]]);
    expect('Nermin Čošić'.slice(7, 12)).toBe('Čošić');
});

test('podebljanje spaja preklapajuće pogotke i nalazi svako ponavljanje', () => {
    expect(highlightRanges('ana banana', searchTokens('ana nan'))).toEqual([[0, 3], [5, 10]]);
    expect(highlightRanges('bilo šta', searchTokens(''))).toEqual([]);
    expect(highlightRanges('', searchTokens('a'))).toEqual([]);
});
