// Stvarna sastavnica iz pogona (ST15 Sprat/Biblioteka, 3710×2920×450) — regresijski
// test na PRAVIM nazivima, ne izmišljenim. Ako neko izmijeni MATERIAL_TYPES i pokvari
// prepoznavanje ovih artikala, ovdje pukne.
import { materialTypeFromName, materialTypesFromName } from '../productProcesses';

const BOM = [
    { name: 'KT / Textil F416 22 / 1', qty: 150, unit: 'm', total: 225.00, supplier: 'Frischeis' },
    { name: 'Oblikovna špera', qty: 3, unit: 'Kom', total: 450.00, supplier: 'Frischeis' },
    { name: 'Stelujuce nogice - 103323535', qty: 10, unit: 'Kom', total: 20.00, supplier: 'Schachermayer' },
    { name: 'Parsol / Bronza', qty: 0.5, unit: 'm²', total: 43.74, supplier: 'Frischeis' },
    { name: 'MDF 18', qty: 5, unit: 'Kom', total: 500.00, supplier: 'Frischeis' },
    { name: 'Vodilice Blum 350', qty: 3, unit: 'Kom', total: 150.00, supplier: 'Schachermayer' },
    { name: 'Furnir / Jasen', qty: 16, unit: 'm2', total: 480.00, supplier: 'Frischeis' },
    { name: 'Iveral / F416 Textil Bež', qty: 4, unit: 'Kom', total: 560.00, supplier: 'Frischeis' },
    { name: 'Lakiranje', qty: 16, unit: 'm2', total: 240.00, supplier: 'Interni' },
    { name: 'Baglama ravna (sa ublazivacem)', qty: 20, unit: 'Kom', total: 120.00, supplier: 'Schachermayer' },
];

describe('stvarna sastavnica — šta taksonomija prepozna', () => {
    test.each([
        ['KT / Textil F416 22 / 1', 'kant'],
        ['Oblikovna špera', 'sper'],
        ['MDF 18', 'mdf'],
        ['Vodilice Blum 350', 'vodilice'],
        ['Furnir / Jasen', 'furnir'],
        ['Iveral / F416 Textil Bež', 'iveral'],
        ['Baglama ravna (sa ublazivacem)', 'sarke'],
        ['Lakiranje', 'lak'],
        // Dodano NAKON što je ova sastavnica pokazala rupu u taksonomiji:
        ['Stelujuce nogice - 103323535', 'nogice'],  // stojeći element, ne viseći
        ['Parsol / Bronza', 'staklo'],               // Parsol = tonirano float staklo
    ])('%s → %s', (name, expected) => {
        expect(materialTypeFromName(name)).toBe(expected);
    });

    test('„Oblikovna špera" se prepoznaje — signal savijanja/prese', () => {
        expect(materialTypesFromName('Oblikovna špera')).toContain('sper');
    });

    test('cijela sastavnica je prepoznata', () => {
        const untyped = BOM.filter(m => materialTypesFromName(m.name).length === 0);
        expect(untyped.map(m => m.name)).toEqual([]);
    });

    test('„disperzija" NE smije pasti u šperu — zato pattern traži š ili sperploc', () => {
        expect(materialTypesFromName('Disperzija bijela')).not.toContain('sper');
    });
});

describe('pokrivenost se mjeri TROŠKOM, ne brojem redova', () => {
    const sum = (xs: typeof BOM) => xs.reduce((s, m) => s + m.total, 0);

    test('nepoznati artikli su obično jeftini — zato broj redova vara', () => {
        // Simulacija stanja PRIJE dodavanja tipova: nogice i Parsol nepoznati.
        const nepoznati = BOM.filter(m =>
            m.name.includes('nogice') || m.name.includes('Parsol'));
        expect(nepoznati).toHaveLength(2);
        expect(nepoznati.length / BOM.length).toBe(0.2);             // 20% redova...
        expect(sum(nepoznati) / sum(BOM)).toBeLessThan(0.03);        // ...ali <3% novca
        // Zaključak: pokrivenost po redovima bi rekla 80%, po trošku 97% —
        // druga brojka je ta koja govori koliko se zaključku smije vjerovati.
    });
});

describe('sastavnica opisuje proizvod bolje od naziva', () => {
    test('furnir + špera + MDF zajedno = furniranje, presovanje, savijanje', () => {
        const types = new Set(BOM.flatMap(m => materialTypesFromName(m.name)));
        expect(types.has('furnir')).toBe(true);
        expect(types.has('sper')).toBe(true);
        expect(types.has('mdf')).toBe(true);
    });

    test('okov otkriva da proizvod ima i vrata i ladice', () => {
        const types = new Set(BOM.flatMap(m => materialTypesFromName(m.name)));
        expect(types.has('sarke')).toBe(true);      // 20 baglama → vrata
        expect(types.has('vodilice')).toBe(true);   // 3 vodilice → ladice
    });

    test('„Lakiranje" je USLUGA u sastavnici (dobavljač Interni), ne kupljeni materijal', () => {
        const lak = BOM.find(m => m.name === 'Lakiranje')!;
        expect(lak.supplier).toBe('Interni');
        expect(lak.unit).toBe('m2');   // 16 m² — količina koja predviđa sate, ne komad
    });
});
