import {
    normalizeName,
    tokenize,
    productTypesFromName,
    classifyWorkOrder,
    collectUnmatched,
} from '../classify/classify';
import { PRODUCT_TYPES, TAXONOMY_VERSION, type ProductType } from '../classify/taxonomy';

describe('normalizeName', () => {
    test('skida dijakritiku — "Ćošak" i "Cosak" daju isti ključ', () => {
        expect(normalizeName('Ćošak')).toBe(normalizeName('Cosak'));
        expect(normalizeName('Kuhinja Hadžić')).toBe('kuhinja hadzic');
    });

    test('skida nevidljive znakove iz kopiranog teksta', () => {
        expect(normalizeName('Kuhinja​')).toBe('kuhinja');
        expect(normalizeName('  Kuhinja   Novak  ')).toBe('kuhinja novak');
    });

    test('prazno / null → prazan string', () => {
        expect(normalizeName(null)).toBe('');
        expect(normalizeName(undefined)).toBe('');
    });
});

describe('tokenize', () => {
    test('razdvaja po svemu što nije slovo/cifra', () => {
        expect(tokenize('kuhinja + 2 ormara')).toEqual(['kuhinja', '2', 'ormara']);
        expect(tokenize('tv-element/polica')).toEqual(['tv', 'element', 'polica']);
    });
});

describe('productTypesFromName — najduži prefiks pobjeđuje', () => {
    test('"stolica" NE pada u "stol"', () => {
        expect(productTypesFromName('Stolica').types).toEqual(['stolica']);
        expect(productTypesFromName('6 stolica').types).toEqual(['stolica']);
    });

    test('"stol" ostaje stol', () => {
        expect(productTypesFromName('Stol').types).toEqual(['stol']);
        expect(productTypesFromName('Stolovi za trpezariju').types).toEqual(['stol']);
    });

    test('stol I stolice u istom nazivu → oba tipa', () => {
        expect(productTypesFromName('Stol i 4 stolice').types).toEqual(['stol', 'stolica']);
    });

    test('"stolarija" je struka, ne tip proizvoda', () => {
        expect(productTypesFromName('Stolarija Nihad').types).toEqual([]);
        expect(productTypesFromName('stolarski radovi').types).toEqual([]);
    });

    test('tačan token "sto" je stol, ali "stotinu" nije', () => {
        expect(productTypesFromName('Sto za blagovaonicu').types).toEqual(['stol']);
        expect(productTypesFromName('stotinu komada').types).toEqual([]);
    });
});

describe('productTypesFromName — više tipova i višerječni pojmovi', () => {
    test('"Kuhinja + 2 ormara" → oba tipa, redoslijed po taksonomiji', () => {
        expect(productTypesFromName('Kuhinja + 2 ormara').types).toEqual(['kuhinja', 'ormar']);
    });

    test('sinonimi za ormar', () => {
        for (const n of ['Plakar', 'Garderober', 'Šifonjer', 'ormar sa kliznim vratima']) {
            expect(productTypesFromName(n).types).toContain('ormar');
        }
    });

    test('višerječni "TV element" — i "tv" se ne prijavljuje kao nepoznata riječ', () => {
        const r = productTypesFromName('TV element dnevni boravak');
        expect(r.types).toContain('tv_element');
        expect(r.unmatched).not.toContain('tv');
        expect(r.unmatched).not.toContain('element');
    });

    test('"radna ploča" hvata i deklinirani oblik', () => {
        expect(productTypesFromName('Radna ploča granit').types).toContain('radna_ploca');
    });
});

describe('productTypesFromName — neprepoznati tokeni', () => {
    test('šum (brojevi, količine, veznici) se ne prijavljuje', () => {
        const r = productTypesFromName('2x kuhinja i 3 kom ormara');
        expect(r.types).toEqual(['kuhinja', 'ormar']);
        expect(r.unmatched).toEqual([]);
    });

    test('radnje se ne prijavljuju kao nepoznate (montaža, dostava)', () => {
        const r = productTypesFromName('Montaža i dostava kuhinje');
        expect(r.types).toEqual(['kuhinja']);
        expect(r.unmatched).toEqual([]);
    });

    test('stvarno nepoznata riječ SE prijavljuje — to je hrana za petlju učenja', () => {
        const r = productTypesFromName('Lamperija i bibliotekа');
        expect(r.unmatched.length).toBeGreaterThan(0);
    });

    test('ime klijenta ostaje u nepoznatim — ne pogađamo ga', () => {
        const r = productTypesFromName('Kuhinja Hadžić');
        expect(r.types).toEqual(['kuhinja']);
        expect(r.unmatched).toEqual(['hadzic']);
    });
});

describe('classifyWorkOrder', () => {
    test('nalog tipa Zadaci — klasifikovan SAMO iz naziva naloga', () => {
        const r = classifyWorkOrder({ Name: 'Razni poslovi — 2 komode i polica' }, []);
        expect(r.types).toEqual(['komoda', 'polica']);
        expect(r.source).toBe('order-name');
        expect(r.fromItems).toEqual([]);
    });

    test('naziv naloga DOPUNJUJE stavke (source = both)', () => {
        const r = classifyWorkOrder(
            { Name: 'Kuhinja + ugradnja ogledala' },
            [{ Product_Name: 'Kuhinjski element gornji' }]
        );
        expect(r.fromItems).toEqual(['kuhinja']);
        expect(r.fromOrderName).toEqual(['kuhinja', 'ogledalo']);
        expect(r.types).toEqual(['kuhinja', 'ogledalo']);
        expect(r.source).toBe('both');
    });

    test('samo stavke → source = items', () => {
        const r = classifyWorkOrder({ Name: 'RN-2026-07/R1' }, [{ Product_Name: 'Komoda 3 ladice' }]);
        expect(r.source).toBe('items');
        expect(r.types).toEqual(['komoda']);
    });

    test('ništa prepoznato → source = none', () => {
        const r = classifyWorkOrder({ Name: 'RN-2026-07/R4' }, []);
        expect(r.source).toBe('none');
        expect(r.types).toEqual([]);
    });
});

describe('determinizam i proširivost', () => {
    test('isti ulaz → identičan izlaz (bez ovoga rebuild nije reproducibilan)', () => {
        const name = 'Kuhinja + 2 ormara i stolica, Hadžić';
        const a = productTypesFromName(name);
        const b = productTypesFromName(name);
        expect(a).toEqual(b);
    });

    test('korisnikovo pravilo se dodaje bez diranja koda', () => {
        const custom: ProductType[] = [
            ...PRODUCT_TYPES,
            { key: 'biblioteka', label: 'Biblioteka', patterns: ['bibliotek'] },
        ];
        expect(productTypesFromName('Biblioteka hrast', custom).types).toEqual(['biblioteka']);
        // bez pravila je isti naziv neprepoznat
        expect(productTypesFromName('Biblioteka hrast').types).toEqual([]);
    });

    test('TAXONOMY_VERSION je broj koji se upisuje u snapshot', () => {
        expect(typeof TAXONOMY_VERSION).toBe('number');
    });
});

describe('collectUnmatched', () => {
    test('grupiše po učestalosti, s primjerima naziva', () => {
        const orders = [
            { wo: { Name: 'Lamperija hodnik' } },
            { wo: { Name: 'Lamperija dnevni' } },
            { wo: { Name: 'Kuhinja Novak' } },
        ];
        const out = collectUnmatched(orders);
        const hodnik = out.find(x => x.token === 'hodnik');
        expect(hodnik?.count).toBe(1);
        // lamperija je u taksonomiji (obloga) → ne smije biti u nepoznatima
        expect(out.find(x => x.token === 'lamperija')).toBeUndefined();
        expect(out.every(x => x.count > 0)).toBe(true);
    });
});
