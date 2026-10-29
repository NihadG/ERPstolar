// ════════════════════════════════════════════════════════════════════
// STANDARDNI PROCESI I PRAVILA (Lux) — čista logika (bez Firebase)
//
// Jedan izvor za: kanonske nazive procesa i njihov redoslijed (katalog),
// stare nazive koji se spajaju u kanonske (normalizacija cijele baze kroz
// applyProcessConsolidation) i pravila materijal → procesi. Dogovoreno s
// korisnikom 25.10.2026 (vodič „Dnevni upis rada — kako radi"), dopunjeno
// istog dana ispravkama (krevet, ladice, priprema furnira, boja, HPL, OSB,
// Kerrock/Corian).
//
// Kako pravila daju tok: svako pravilo je lanac; isti proces iz dva pravila
// je jedan čvor, pa se grane tu spajaju (kutije od iverala čekaju fronte na
// probnoj montaži). Pravila s jednim procesom (Okivanje, Izrada ladica) dobiju
// mjesto po redoslijedu kataloga (buildGraphFromRules s katalogom).
// Vrste proizvoda s vlastitim tokom (sobna vrata) idu kroz šablon toka, ne pravila.
// jest: lib/__tests__/processStandard.test.ts
// ════════════════════════════════════════════════════════════════════

import { normKey } from './processConsolidation';
import type { RuleLite } from './productProcesses';
import type { ProcessCatalogItem, ProcessMaterialRule } from './types';

/**
 * Verzija standarda — povećaj pri svakoj izmjeni kataloga, preimenovanja ili pravila.
 * Pravila koja standard upiše nose je (Standard_Version); Auto prijedlog primijeni
 * standard ponovo čim baza ima stariju verziju („zadnja pravila aplikacije").
 */
export const STANDARD_VERSION = '2026-10-29.1';

/** Kanonski redoslijed proizvodnje. Procesi van liste ostaju u katalogu, iza ovih. */
export const STANDARD_CATALOG: string[] = [
    'Priprema masive',
    'Lijepljenje i obrada masive',
    'Krojenje iverala',
    'Krojenje leđa',
    'Krojenje MDF-a',
    'Krojenje šperploče',
    'Krojenje OSB-a',
    'Priprema furnira',
    'Krojenje HPL-a',
    'Furniranje',
    'Presovanje HPL-a',
    'Srezivanje na tačnu mjeru',
    'Izrada zaobljenih dijelova',
    'Frezanje kanalica (za lajsne)',
    'Kantiranje iverala',
    'Kantiranje furnira',
    'Izrada fronti',
    // Podkonstrukcije (OSB, jela/smreka) prije sklapanja: iveral se montira NA podkonstrukciju.
    'Izrada podkonstrukcije od OSB-a',
    'Izrada podkonstrukcije od jele/smreke',
    'Sklapanje kutija',
    'Postavljanje leđa',
    'Izrada cokla',
    'Izrada rešetke baze',
    'Izrada ladica',
    'Probna montaža',
    'Brušenje',
    'Farbanje',
    'Lakiranje',
    // Akrilni kamen: vlastita grana; prije završnog sklapanja i okivanja (krajevi grana se vežu za kasniji).
    'Krojenje Kerrocka',
    'Lijepljenje Kerrocka',
    'Brušenje Kerrocka',
    'Montaža Kerrocka',
    'Krojenje Coriana',
    'Lijepljenje Coriana',
    'Brušenje Coriana',
    'Montaža Coriana',
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
    // Kantiranje iverala ide odmah poslije krojenja; furnira tek poslije srezivanja na tačnu mjeru.
    { canonical: 'Kantiranje iverala', members: ['Kantiranje'] },
    { canonical: 'Kantiranje furnira', members: ['Kantiranje fronti'] },
    // Do 29.10. jedna „Izrada podkonstrukcije" (samo od OSB-a); jela/smreka dobija vlastiti korak.
    { canonical: 'Izrada podkonstrukcije od OSB-a', members: ['Izrada podkonstrukcije'] },
];

export type StandardRule = RuleLite & { note: string };

interface RuleOptions {
    /** „osim ako ima" — pravilo ne okida kad je prisutan ijedan od ovih tipova. */
    except?: string[];
    /** Samo za proizvode čiji naziv ima riječ. */
    only?: string[];
    /** Ne za proizvode čiji naziv ima riječ. */
    notFor?: string[];
}

const rule = (types: string[], processes: string[], note: string, o: RuleOptions = {}): StandardRule => ({
    ...(types.length === 1
        ? { Match_Kind: 'material_type' as const, Match_Value: types[0] }
        : { Match_Kind: 'material_type_combo' as const, Match_Value: '', Match_Types: types }),
    ...(o.except?.length ? { Exclude_Types: o.except } : {}),
    ...(o.only?.length ? { Product_Keywords: o.only } : {}),
    ...(o.notFor?.length ? { Exclude_Product_Keywords: o.notFor } : {}),
    Processes: processes,
    note,
});

/** Ormari dobijaju cokl od jele/smreke (riječ naziva počinje ovim). */
const ORMAR = ['ormar', 'garderob', 'plakar'];
/** Krevet nema kutija; masiv/jela kod kreveta je rešetka baze. */
const KREVET = ['krevet'];

/** Furnirani dijelovi poslije krojenja ploče: kantiranje furnira tek poslije srezivanja na tačnu mjeru. */
const FURNIR_TOK = ['Furniranje', 'Srezivanje na tačnu mjeru', 'Kantiranje furnira', 'Probna montaža', 'Brušenje', 'Lakiranje', 'Završno sklapanje'];
const FARBANI_MDF = ['Krojenje MDF-a', 'Probna montaža', 'Brušenje', 'Farbanje', 'Završno sklapanje'];
const BEZ_IVERALA = ['iveral'];

export const STANDARD_RULES: StandardRule[] = [
    // ── Iveral ──
    rule(['iveral'], ['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija'], 'Kutije od iverala — sklope se jednom, bez probne montaže', { notFor: KREVET }),
    rule(['iveral'], ['Krojenje iverala', 'Kantiranje iverala', 'Probna montaža'], 'Krevet: nema kutija — dijelovi od iverala idu na probnu montažu', { only: KREVET }),

    // ── MDF: farbani; uz furnir se farba samo kad ima boje ──
    rule(['mdf'], FARBANI_MDF, 'Farbani MDF', { except: ['furnir', 'hpl'] }),
    rule(['mdf', 'boja'], FARBANI_MDF, 'Boja za MDF — dio MDF-a se farba i kad se dio furnira'),

    // ── Furnir: priprema furnira teče paralelno s krojenjem ploča ──
    rule(['furnir', 'mdf'], ['Krojenje MDF-a', ...FURNIR_TOK], 'Furnir na MDF-u'),
    rule(['furnir', 'mdf'], ['Priprema furnira', 'Furniranje'], 'Priprema furnira paralelno s krojenjem MDF-a'),
    rule(['sper', 'furnir'], ['Krojenje šperploče', ...FURNIR_TOK], 'Ravna šperploča s furnirom — kao furnir na MDF-u'),
    rule(['sper', 'furnir'], ['Priprema furnira', 'Furniranje'], 'Priprema furnira paralelno s krojenjem šperploče'),
    rule(['oblikovna', 'furnir'], ['Priprema furnira', 'Izrada zaobljenih dijelova', 'Probna montaža', 'Brušenje', 'Lakiranje', 'Završno sklapanje'], 'Oblikovna šperploča + furnir — zaobljeni dijelovi'),

    // ── HPL: kao furnir (presuje se na MDF), ali bez brušenja i lakiranja ──
    rule(['hpl'], ['Krojenje HPL-a', 'Presovanje HPL-a', 'Srezivanje na tačnu mjeru', 'Probna montaža', 'Završno sklapanje'], 'HPL — krojenje, presovanje, srezivanje; bez brušenja i lakiranja'),
    rule(['hpl', 'mdf'], ['Krojenje MDF-a', 'Presovanje HPL-a'], 'HPL se presuje na MDF'),

    // ── Spojevi: kutije od iverala čekaju fronte na probnoj montaži ──
    rule(['iveral', 'mdf'], ['Sklapanje kutija', 'Probna montaža'], 'Spoj: kutije čekaju fronte', { notFor: KREVET }),
    rule(['iveral', 'furnir'], ['Sklapanje kutija', 'Probna montaža'], 'Spoj: kutije čekaju furnirane fronte', { notFor: KREVET }),
    rule(['iveral', 'hpl'], ['Sklapanje kutija', 'Probna montaža'], 'Spoj: kutije čekaju HPL fronte', { notFor: KREVET }),

    // ── Ladice: nikad u prvoj fazi ──
    rule(['vodilice'], ['Izrada ladica'], 'Ladice — svi sitni procesi u jednom koraku'),
    rule(['iveral', 'vodilice'], ['Krojenje iverala', 'Kantiranje iverala', 'Izrada ladica'], 'Ladice od iverala — poslije kantiranja iverala, paralelno sa sklapanjem kutija'),
    rule(['iveral', 'vodilice', 'mdf'], ['Izrada ladica', 'Probna montaža'], 'Ladice od iverala gotove prije probne montaže'),
    rule(['iveral', 'vodilice', 'furnir'], ['Izrada ladica', 'Probna montaža'], 'Ladice od iverala gotove prije probne montaže'),
    rule(['iveral', 'vodilice', 'hpl'], ['Izrada ladica', 'Probna montaža'], 'Ladice od iverala gotove prije probne montaže'),
    rule(['vodilice', 'furnir', 'mdf'], ['Kantiranje furnira', 'Izrada ladica', 'Brušenje'], 'Bez iverala ladice su od furniranog MDF-a — kad i probna montaža', { except: BEZ_IVERALA }),
    rule(['vodilice', 'furnir', 'sper'], ['Kantiranje furnira', 'Izrada ladica', 'Brušenje'], 'Bez iverala ladice su od furnirane šperploče — kad i probna montaža', { except: BEZ_IVERALA }),
    rule(['vodilice', 'hpl'], ['Srezivanje na tačnu mjeru', 'Izrada ladica', 'Završno sklapanje'], 'Bez iverala ladice su od HPL ploča — kad i probna montaža', { except: ['iveral', 'furnir'] }),
    rule(['vodilice', 'mdf'], ['Krojenje MDF-a', 'Izrada ladica', 'Brušenje'], 'Bez iverala ladice su od farbanog MDF-a — kad i probna montaža', { except: ['iveral', 'furnir', 'hpl'] }),

    rule(['okov'], ['Okivanje'], 'Bilo koji okov osim vodilica'),

    // ── Masiv, jela/smreka ──
    rule(['masiv'], ['Priprema masive'], 'Vidljivi masiv (hrast, tik, jasen) — priprema'),
    rule(['masiv', 'furnir'], ['Priprema masive', 'Probna montaža'], 'Masivni detalji uz furnirane dijelove — probaju se zajedno', { notFor: KREVET }),
    rule(['masiv'], ['Priprema masive', 'Izrada rešetke baze', 'Probna montaža'], 'Krevet: masiv je za rešetku baze', { only: KREVET }),
    rule(['jela'], ['Priprema masive'], 'Jela/smreka — priprema letvi'),
    // Podkonstrukcija od jele/smreke (stolovi, obloge…); kod ormara jela je cokl, kod kreveta rešetka baze.
    rule(['jela'], ['Priprema masive', 'Izrada podkonstrukcije od jele/smreke'], 'Jela/smreka — podkonstrukcija', { notFor: [...ORMAR, ...KREVET] }),
    rule(['jela'], ['Priprema masive', 'Izrada rešetke baze', 'Probna montaža'], 'Krevet: rešetka baze od jele/smreke', { only: KREVET }),
    rule(['jela', 'iveral'], ['Priprema masive', 'Izrada cokla'], 'Cokl od jele/smreke kod ormara', { only: ORMAR }),
    rule(['jela', 'furnir'], ['Priprema masive', 'Izrada cokla'], 'Cokl od jele/smreke kod ormara', { only: ORMAR }),

    // ── OSB: podkonstrukcija ──
    rule(['osb'], ['Krojenje OSB-a', 'Izrada podkonstrukcije od OSB-a'], 'OSB — uglavnom podkonstrukcija'),

    // ── Podkonstrukcija + iveral: iveral se montira na podkonstrukciju (sklapanje kutija) ──
    rule(['osb', 'iveral'], ['Izrada podkonstrukcije od OSB-a', 'Sklapanje kutija'], 'Iveral se sklapa na podkonstrukciju od OSB-a', { notFor: KREVET }),
    rule(['jela', 'iveral'], ['Izrada podkonstrukcije od jele/smreke', 'Sklapanje kutija'], 'Iveral se sklapa na podkonstrukciju od jele/smreke', { notFor: [...ORMAR, ...KREVET] }),

    // ── Akrilni kamen ──
    rule(['kerrock'], ['Krojenje Kerrocka', 'Lijepljenje Kerrocka', 'Brušenje Kerrocka', 'Montaža Kerrocka'], 'Kerrock — krojenje, lijepljenje, brušenje, montaža'),
    rule(['corian'], ['Krojenje Coriana', 'Lijepljenje Coriana', 'Brušenje Coriana', 'Montaža Coriana'], 'Corian — isto kao Kerrock'),
];

/** Vrste proizvoda: šablon toka (po nazivu šablona) i riječi naziva proizvoda koje ga biraju. */
export const STANDARD_TEMPLATE_KEYWORDS: { template: string; keywords: string[]; note: string }[] = [
    { template: 'Furnirana vrata (obična)', keywords: ['vrata'], note: 'Tok sa Šišić vrata: krila, štokovi, lajsne' },
];

// ─── Koja pravila standard zamjenjuje ─────────────────────────────────

/**
 * Pravila koja standard zamjenjuje: ona koja je standard upisao (Standard_Version).
 * Dok nijedno nije označeno (standard primijenjen prije verzija ili nikad), zamjenjuju se sva.
 * Korisnikova pravila (dodana ili izmijenjena u prozoru pravila) ostaju.
 */
export function standardRulesIn<T extends Pick<ProcessMaterialRule, 'Standard_Version'>>(rules: T[]): T[] {
    const tagged = rules.filter(r => r.Standard_Version);
    return tagged.length ? tagged : rules;
}

/** Baza ima pravila ove verzije standarda — Auto prijedlog ne mora ništa primijeniti. */
export function standardIsCurrent(rules: Pick<ProcessMaterialRule, 'Standard_Version'>[]): boolean {
    return rules.some(r => r.Standard_Version === STANDARD_VERSION);
}

/** Stari naziv procesa → kanonski (za poređenje statusa prije i poslije preimenovanja). */
export function canonicalProcessName(name: string): string {
    const k = normKey(name);
    return STANDARD_RENAMES.find(g => g.members.some(m => normKey(m) === k))?.canonical || name;
}


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
 * @param ruleCount broj pravila koja standard zamjenjuje (standardRulesIn); korisnikova ostaju
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

// ─── Kako korisnik zove procese ───────────────────────────────────────

/**
 * Kanonski proces → riječi kojima ga korisnik govori botu („montaža iverala" = Sklapanje kutija).
 * Aliasi se prepoznaju kad su SVE njihove riječi u rečenoj frazi („montaža iverala na podkonstrukcije").
 * Korisnik dodaje svoje u Procesi → ⚙ (ProcessCatalogItem.Aliases), a bot ih uči iz izbora dugmadima.
 */
export const STANDARD_ALIASES: Record<string, string[]> = {
    'Sklapanje kutija': ['montaža iverala', 'sklapanje iverala', 'sklapanje korpusa', 'montaža korpusa', 'montaža kutija'],
    'Izrada podkonstrukcije od OSB-a': ['podkonstrukcija od osb', 'podkonstrukcija osb', 'osb podkonstrukcija'],
    'Izrada podkonstrukcije od jele/smreke': ['podkonstrukcija od jele', 'podkonstrukcija od smreke', 'podkonstrukcija jela smreka'],
    'Krojenje iverala': ['rezanje iverala', 'sječenje iverala'],
    'Postavljanje leđa': ['stavljanje leđa', 'montaža leđa'],
    'Izrada ladica': ['sklapanje ladica', 'montaža ladica'],
    'Okivanje': ['montaža okova', 'ugradnja okova', 'stavljanje okova'],
    'Završno sklapanje': ['završna montaža', 'finalno sklapanje'],
};
