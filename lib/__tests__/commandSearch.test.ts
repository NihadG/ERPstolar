import { editDistance, fold, matchScore, prepare, queryTokens, searchBy } from '../command/search';
import { compareProducts, isProductDone, productSearchText, sortProductsForBoard } from '../command/products';
import type { CommandMaterialRow } from '../command/materialOrder';
import type { Product } from '../types';

const hit = (text: string, query: string) => matchScore(prepare(text), queryTokens(query)) !== null;

test('dijakritika se zanemaruje u oba smjera', () => {
    expect(fold('Jerko Čorluka — Kuća')).toBe('jerko corluka kuca');
    expect(hit('Jerko Čorluka', 'corluka')).toBe(true);
    expect(hit('Jerko Corluka', 'čorluka')).toBe(true);
    expect(hit('Vođice pune izvlake', 'vodice')).toBe(true);
});

test('redoslijed riječi nije bitan, a svaka riječ mora biti nađena', () => {
    expect(hit('DO1 — Drvena obloga zida', 'obloga drvena')).toBe(true);
    expect(hit('DO1 — Drvena obloga zida', 'zida drvena obloga')).toBe(true);
    expect(hit('DO1 — Drvena obloga zida', 'drvena kuhinja')).toBe(false);
});

test('razmaci i interpunkcija ne razdvajaju pojam', () => {
    expect(hit('T1.A Ormar i elementi', 't1a')).toBe(true);
    expect(hit('T1.A Ormar i elementi', 't1 a ormar')).toBe(true);
    expect(hit('Drvena obloga zida', 'drvenaobloga')).toBe(true);
    expect(hit('Radna ploča kompakt', 'radnaploca')).toBe(true);
});

test('tipfeler se oprašta srazmjerno dužini riječi', () => {
    expect(hit('Drvena obloga zida', 'obloge')).toBe(true);     // zamjena
    expect(hit('Drvena obloga zida', 'oblga')).toBe(true);      // ispušteno slovo
    expect(hit('Kantiranje', 'kantiranj')).toBe(true);          // nedovršeno
    expect(hit('Iveral', 'xyz')).toBe(false);                   // tri slova, nula tolerancije
});

test('bliži pogodak ide prvi', () => {
    const rows = ['Zidna obloga hrast', 'Drvena obloga zida', 'Obloga zida DO1'];
    expect(searchBy(rows, 'obloga', r => r)[0]).toBe('Obloga zida DO1');
    expect(searchBy(rows, '', r => r)).toEqual(rows);
});

test('udaljenost staje čim pređe granicu (bez skupog računanja)', () => {
    expect(editDistance('kantiranje', 'kantiranje', 2)).toBe(0);
    expect(editDistance('a', 'potpuno drugo', 2)).toBe(3);
});

// ── Redoslijed pozicija ─────────────────────────────────────────────

const product = (Name: string, Status: string): Product => ({ Product_ID: Name, Name, Status } as Product);
const withCount = (Name: string, Status: string, materialCount: number) => ({ product: product(Name, Status), materialCount });

test('završene pozicije idu na dno, bez obzira na materijal', () => {
    expect(isProductDone('Spremno')).toBe(true);
    expect(isProductDone('Instalirano')).toBe(true);
    expect(isProductDone('Rezanje')).toBe(false);
    expect(isProductDone('nepoznat status')).toBe(false);
    // Završena pozicija S materijalom i dalje pada ispod nezavršene BEZ materijala.
    expect(compareProducts(withCount('A', 'Spremno', 5), withCount('B', 'Rezanje', 0))).toBeGreaterThan(0);
});

test('među nezavršenima pozicija s materijalom ima prednost', () => {
    expect(compareProducts(withCount('Z', 'Rezanje', 1), withCount('A', 'Rezanje', 0))).toBeLessThan(0);
    expect(compareProducts(withCount('A', 'Na čekanju', 0), withCount('B', 'Rezanje', 2))).toBeGreaterThan(0);
});

test('pozicije iz naloga „U toku" idu na vrh, i one same po abecedi', () => {
    const inProgress = (Name: string, Status: string, materialCount: number) =>
        ({ product: product(Name, Status), materialCount, inProgress: true });
    // U toku tuče i „ima materijal" i abecedu.
    expect(compareProducts(inProgress('Z', 'Rezanje', 0), withCount('A', 'Rezanje', 9))).toBeLessThan(0);
    // Dvije aktivne pozicije se međusobno porede abecedno.
    expect(compareProducts(inProgress('A', 'Rezanje', 0), inProgress('B', 'Rezanje', 0))).toBeLessThan(0);
});

test('poredak liste: u toku → s materijalom → bez materijala → završeno', () => {
    const materials = new Map([
        ['ST19.B', [{} as CommandMaterialRow]], ['ST19.A', []],
        ['ST6.A', [{} as CommandMaterialRow]], ['ST9', []], ['Gotov', [{} as CommandMaterialRow]],
    ]);
    const sorted = sortProductsForBoard([
        product('ST9', 'Rezanje'),
        product('Gotov', 'Spremno'),
        product('ST19.B', 'Sklapanje'),
        product('ST6.A', 'Rezanje'),
        product('ST19.A', 'Sklapanje'),
    ], materials, new Set(['ST19.A', 'ST19.B']));
    expect(sorted.map(p => p.Name)).toEqual(['ST19.A', 'ST19.B', 'ST6.A', 'ST9', 'Gotov']);
});

test('sve ostalo je abeceda, prirodno (T2 prije T10)', () => {
    const materials = new Map([
        ['T10', [{} as CommandMaterialRow]], ['T2', [{} as CommandMaterialRow]], ['T1', [{} as CommandMaterialRow]],
        ['Gotov', [{} as CommandMaterialRow]], ['Bez', []],
    ]);
    const sorted = sortProductsForBoard([
        product('Gotov', 'Spremno'),
        product('T10', 'Rezanje'),
        product('Bez', 'Rezanje'),
        product('T1', 'Rezanje'),
        product('T2', 'Rezanje'),
    ], materials);
    expect(sorted.map(p => p.Name)).toEqual(['T1', 'T2', 'T10', 'Bez', 'Gotov']);
});
test('pozicija se nalazi i po materijalu i po dobavljaču', () => {
    const rows = [{ Material_Name: 'Iveral bijeli', Supplier: 'Frischeis' }] as CommandMaterialRow[];
    const text = productSearchText(product('DO1 obloga', 'Spremno'), rows);
    expect(hit(text, 'iveral')).toBe(true);
    expect(hit(text, 'frischeis')).toBe(true);
    expect(hit(text, 'friseis')).toBe(true);
});

test('pozicija se nalazi i kroz naziv projekta — „corluka obloga" je stvaran upit', () => {
    const text = productSearchText(product('DO1 — Drvena obloga zida', 'Na čekanju'), [], 'Jerko Čorluka — Kuća');
    expect(hit(text, 'corluka obloga')).toBe(true);
    expect(hit(text, 'corluka kuhinja')).toBe(false);
});
