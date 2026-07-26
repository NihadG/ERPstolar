import { normalizePattern, stripDiacritics } from '../classify/patternNormalize';
import { dedupeProcessKey } from '../orderProcessRows';
import { productTypesFromName } from '../classify/classify';
import { materialTypesFromName, MATERIAL_TYPES, type MaterialType } from '../productProcesses';
import { PRODUCT_TYPES, type ProductType } from '../classify/taxonomy';

describe('stripDiacritics', () => {
    test('bosanski znakovi', () => {
        expect(stripDiacritics('špera')).toBe('spera');
        expect(stripDiacritics('Ćošak čačak žito')).toBe('Cosak cacak zito');
    });

    test('„đ" — jedini koji NFD ne razlaže, pa ide kroz eksplicitnu mapu', () => {
        expect('đ'.normalize('NFD').length).toBe(1);   // dokaz zašto mapa postoji
        expect(stripDiacritics('Vođice')).toBe('Vodice');
        expect(stripDiacritics('đubre')).toBe('dubre');
    });
});

describe('dedupeProcessKey dijeli isto preklapanje slova', () => {
    test('„Vođice" i „Vodice" daju ISTI ključ (bez ovoga bi bila dva reda)', () => {
        expect(dedupeProcessKey('Vođice')).toBe(dedupeProcessKey('Vodice'));
        expect(dedupeProcessKey('Bušenje i vođica')).toBe(dedupeProcessKey('Busenje i vodica'));
    });
});

describe('normalizePattern — mora se poklopiti s normalizacijom POTROŠAČA', () => {
    test('proizvod: BEZ dijakritike (normalizeName je skida iz teksta)', () => {
        expect(normalizePattern('Špera', 'product')).toEqual(['spera']);
        expect(normalizePattern('BIBLIOTEK', 'product')).toEqual(['bibliotek']);
    });

    test('materijal: OBJE varijante (norm zadržava dijakritiku)', () => {
        expect(normalizePattern('Špera', 'material')).toEqual(['špera', 'spera']);
    });

    test('materijal bez dijakritike daje jednu varijantu', () => {
        expect(normalizePattern('nogic', 'material')).toEqual(['nogic']);
    });

    test('prekratak pattern se odbacuje — hvatao bi nevezane riječi', () => {
        expect(normalizePattern('ab', 'product')).toEqual([]);
        expect(normalizePattern('  ', 'material')).toEqual([]);
    });

    test('višestruki razmaci se sažimaju', () => {
        expect(normalizePattern('  radna    ploca ', 'product')).toEqual(['radna ploca']);
    });
});

// ── Ovo je pravi test: da li se upisano pravilo STVARNO okine ───────
describe('pravilo se okida nakon normalizacije (integracija)', () => {
    test('pravilo za PROIZVOD hvata naziv s dijakritikom', () => {
        const patterns = normalizePattern('Ćoškasti element', 'product');
        const custom: ProductType[] = [
            ...PRODUCT_TYPES,
            { key: 'coskasti', label: 'Ćoškasti element', patterns },
        ];
        expect(productTypesFromName('Ćoškasti element hrast', custom).types).toContain('coskasti');
        expect(productTypesFromName('Coskasti element hrast', custom).types).toContain('coskasti');
    });

    test('pravilo za MATERIJAL hvata i pisano s dijakritikom i bez nje', () => {
        const patterns = normalizePattern('Šperploča', 'material');
        const custom: MaterialType[] = [
            { key: 'test_sper', label: 'Test šper', patterns },
            ...MATERIAL_TYPES,
        ];
        expect(materialTypesFromName('Šperploča 18mm', custom)).toContain('test_sper');
        expect(materialTypesFromName('Sperploca 18mm', custom)).toContain('test_sper');
    });

    test('REGRESIJA: pattern S dijakritikom NE bi radio za proizvode', () => {
        // Ovo je greška koju normalizePattern sprječava — dokumentovana da se ne vrati.
        const naivan: ProductType[] = [
            ...PRODUCT_TYPES,
            { key: 'x', label: 'X', patterns: ['ćoškast'] },   // sirov, nenormalizovan
        ];
        expect(productTypesFromName('Ćoškasti element', naivan).types).not.toContain('x');
    });
});
