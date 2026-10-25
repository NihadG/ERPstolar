// ════════════════════════════════════════════════════════════════════
// STANDARDNI PROCESI I PRAVILA (Lux) — čista logika (bez Firebase)
//
// Jedan izvor za: kanonske nazive procesa i njihov redoslijed (katalog),
// stare nazive koji se spajaju u kanonske (normalizacija cijele baze kroz
// applyProcessConsolidation) i pravila materijal → procesi. Dogovoreno s
// korisnikom 25.10.2026 (vodič „Dnevni upis rada — kako radi").
//
// Kako pravila daju tok: svako pravilo je lanac; isti proces iz dva pravila
// je jedan čvor, pa se grane tu spajaju (kutije od iverala čekaju fronte na
// probnoj montaži). Pravila s jednim procesom (Okivanje, Izrada ladica) dobiju
// mjesto po redoslijedu kataloga (buildGraphFromRules s katalogom).
// Vrste proizvoda s vlastitim tokom (sobna vrata) idu kroz šablon toka, ne pravila.
// jest: lib/__tests__/processStandard.test.ts
// ════════════════════════════════════════════════════════════════════

import { normKey } from './processConsolidation';
import type { ProcessCatalogItem, ProcessMaterialRule } from './types';

/** Kanonski redoslijed proizvodnje. Procesi van liste ostaju u katalogu, iza ovih. */
export const STANDARD_CATALOG: string[] = [
    'Priprema masive',
    'Lijepljenje i obrada masive',
    'Krojenje iverala',
    'Krojenje leđa',
    'Krojenje MDF-a',
    'Krojenje šperploče',
    'Priprema furnira',
    'Furniranje',
    'Srezivanje na tačnu mjeru',
    'Izrada zaobljenih dijelova',
    'Frezanje kanalica (za lajsne)',
    'Kantiranje',
    'Kantiranje fronti',
    'Izrada fronti',
    'Sklapanje kutija',
    'Postavljanje leđa',
    'Izrada cokla',
    'Izrada ladica',
    'Probna montaža',
    'Brušenje',
    'Farbanje',
    'Lakiranje',
    'Završno sklapanje',
    'Okivanje',
    'Pakovanje',
];

/** Stari nazivi → kanonski. Spaja se u katalogu, pravilima, planovima, nalozima i dnevnicama. */
export const STANDARD_RENAMES: { canonical: string; members: string[] }[] = [
    { canonical: 'Krojenje iverala', members: ['Krojenje Iverala'] },
    { canonical: 'Krojenje MDF-a', members: ['Krojenje MDF'] },
    { canonical: 'Priprema furnira', members: ['Krojenje furnira', 'Priprema Furnira'] },
    { canonical: 'Srezivanje na tačnu mjeru', members: ['Srezivanje elemenata iz prese na tačne mjere'] },
    { canonical: 'Lijepljenje i obrada masive', members: ['Lijepljenje masive'] },
    { canonical: 'Brušenje', members: ['Brušenje furniranih elemenata'] },
    // Spojeni proces se ne može razdvojiti po starim podacima; posao je pretežno furnir/lak.
    { canonical: 'Lakiranje', members: ['Farbanje i lakiranje'] },
    { canonical: 'Farbanje', members: ['Frabanje'] },
    { canonical: 'Završno sklapanje', members: ['Sklapanje furniranih elemenata'] },
    { canonical: 'Okivanje', members: ['Okivanje vrata i fronti', 'Okivanje vrata'] },
    { canonical: 'Izrada ladica', members: ['Okivanje ladica', 'Priprema ladica'] },
];

export type StandardRule = Pick<ProcessMaterialRule, 'Match_Kind' | 'Match_Value' | 'Match_Types' | 'Exclude_Types' | 'Product_Keywords' | 'Processes'> & { note: string };

const rule = (types: string[], processes: string[], note: string, exclude: string[] = [], keywords: string[] = []): StandardRule => ({
    ...(types.length === 1
        ? { Match_Kind: 'material_type' as const, Match_Value: types[0] }
        : { Match_Kind: 'material_type_combo' as const, Match_Value: '', Match_Types: types }),
    ...(exclude.length ? { Exclude_Types: exclude } : {}),
    ...(keywords.length ? { Product_Keywords: keywords } : {}),
    Processes: processes,
    note,
});

/** Ormari dobijaju cokl od jele/smreke (riječ naziva počinje ovim). */
const ORMAR = ['ormar', 'garderob', 'plakar'];

export const STANDARD_RULES: StandardRule[] = [
    rule(['iveral'], ['Krojenje iverala', 'Kantiranje', 'Sklapanje kutija'], 'Kutije od iverala — sklope se jednom, bez probne montaže'),
    rule(['mdf'], ['Krojenje MDF-a', 'Probna montaža', 'Brušenje', 'Farbanje', 'Završno sklapanje'], 'Farbani MDF', ['furnir']),
    rule(['furnir', 'mdf'], ['Krojenje MDF-a', 'Priprema furnira', 'Furniranje', 'Srezivanje na tačnu mjeru', 'Kantiranje fronti', 'Probna montaža', 'Brušenje', 'Lakiranje', 'Završno sklapanje'], 'Furnir na MDF-u'),
    rule(['sper', 'furnir'], ['Krojenje šperploče', 'Priprema furnira', 'Furniranje', 'Srezivanje na tačnu mjeru', 'Kantiranje fronti', 'Probna montaža', 'Brušenje', 'Lakiranje', 'Završno sklapanje'], 'Ravna šperploča s furnirom — kao furnir na MDF-u'),
    rule(['oblikovna', 'furnir'], ['Priprema furnira', 'Izrada zaobljenih dijelova', 'Probna montaža', 'Brušenje', 'Lakiranje', 'Završno sklapanje'], 'Oblikovna šperploča + furnir — zaobljeni dijelovi'),
    rule(['iveral', 'mdf'], ['Sklapanje kutija', 'Probna montaža'], 'Spoj: kutije čekaju fronte'),
    rule(['iveral', 'furnir'], ['Sklapanje kutija', 'Probna montaža'], 'Spoj: kutije čekaju furnirane fronte'),
    rule(['vodilice'], ['Izrada ladica'], 'Ladice — svi sitni procesi u jednom koraku'),
    rule(['iveral', 'vodilice'], ['Krojenje iverala', 'Izrada ladica'], 'Ladice poslije krojenja, paralelno sa sklapanjem kutija'),
    rule(['vodilice', 'mdf'], ['Izrada ladica', 'Probna montaža'], 'Ladice gotove prije probne montaže'),
    rule(['vodilice', 'furnir'], ['Izrada ladica', 'Probna montaža'], 'Ladice gotove prije probne montaže'),
    rule(['okov'], ['Okivanje'], 'Bilo koji okov osim vodilica'),
    rule(['masiv'], ['Priprema masive'], 'Vidljivi masiv (hrast, tik, jasen) — priprema'),
    rule(['masiv', 'furnir'], ['Priprema masive', 'Probna montaža'], 'Masivni detalji uz furnirane dijelove — probaju se zajedno'),
    rule(['jela'], ['Priprema masive'], 'Jela/smreka — letve i podkonstrukcije'),
    rule(['jela', 'iveral'], ['Priprema masive', 'Izrada cokla'], 'Cokl od jele/smreke kod ormara', [], ORMAR),
    rule(['jela', 'furnir'], ['Priprema masive', 'Izrada cokla'], 'Cokl od jele/smreke kod ormara', [], ORMAR),
];

/** Vrste proizvoda: šablon toka (po nazivu šablona) i riječi naziva proizvoda koje ga biraju. */
export const STANDARD_TEMPLATE_KEYWORDS: { template: string; keywords: string[]; note: string }[] = [
    { template: 'Furnirana vrata (obična)', keywords: ['vrata'], note: 'Tok sa Šišić vrata: krila, štokovi, lajsne' },
];

// ─── Pregled izmjena prije primjene ───────────────────────────────────

export interface StandardizationPlan {
    /** Grupe preimenovanja koje stvarno nešto mijenjaju (stari naziv postoji u bazi). */
    renames: { canonical: string; members: string[] }[];
    /** Kanonski procesi kojih nema u katalogu (dodaju se). */
    addToCatalog: string[];
    /** Konačni redoslijed kataloga po nazivu (kanonski prvo, ostali iza, stabilno). */
    order: string[];
    rulesToRemove: number;
    rulesToAdd: StandardRule[];
    /** Šabloni vrste proizvoda koji postoje i dobijaju ključne riječi. */
    templates: { template: string; keywords: string[]; note: string }[];
}

/**
 * @param catalog trenutni katalog
 * @param usedNames svi nazivi procesa koji se igdje koriste (katalog, planovi, nalozi, pravila, dnevnice)
 * @param ruleCount broj postojećih pravila (sva se zamjenjuju standardnim)
 * @param flowTemplateNames nazivi postojećih šablona toka (vrste proizvoda)
 */
export function planStandardization(
    catalog: Pick<ProcessCatalogItem, 'Name' | 'Order'>[],
    usedNames: string[],
    ruleCount: number,
    flowTemplateNames: string[] = [],
): StandardizationPlan {
    const used = new Set(usedNames.map(normKey));
    const renames = STANDARD_RENAMES
        .map(g => ({ canonical: g.canonical, members: g.members.filter(m => used.has(normKey(m))) }))
        .filter(g => g.members.length);
    const renamed = new Map(STANDARD_RENAMES.flatMap(g => g.members.map(m => [normKey(m), g.canonical] as const)));
    const afterRename = Array.from(new Set(catalog
        .slice().sort((a, b) => (a.Order || 0) - (b.Order || 0))
        .map(c => renamed.get(normKey(c.Name)) || c.Name)
        .map(n => STANDARD_CATALOG.find(s => normKey(s) === normKey(n)) || n)));
    const inCatalog = new Set(afterRename.map(normKey));
    const addToCatalog = STANDARD_CATALOG.filter(s => !inCatalog.has(normKey(s)));
    const others = afterRename.filter(n => !STANDARD_CATALOG.some(s => normKey(s) === normKey(n)));
    return {
        renames,
        addToCatalog,
        order: [...STANDARD_CATALOG, ...others],
        rulesToRemove: ruleCount,
        rulesToAdd: STANDARD_RULES,
        templates: STANDARD_TEMPLATE_KEYWORDS.filter(t => flowTemplateNames.some(n => normKey(n) === normKey(t.template))),
    };
}
