import { buildGraphFromRules, ruleMaterialTypes, ruleMatches, materialTypeFromName, planGraphForProduct, nameHasKeyword, stagesFromGraph } from '../productProcesses';
import { buildAutoPlan } from '../processAutoPlan';
import {
    planStandardization, STANDARD_CATALOG, STANDARD_RULES, STANDARD_VERSION, standardRulesIn, standardIsCurrent, canonicalProcessName,
} from '../processStandard';

const catalog = STANDARD_CATALOG.map((Name, i) => ({ Name, Order: i + 1 }));
const M = (...names: string[]) => names.map(n => {
    const [Material_Name, Category = ''] = n.split('@');
    return { Material_Name, Category };
});
function flow(materials: ReturnType<typeof M>) {
    const { graph } = buildGraphFromRules(materials, STANDARD_RULES, undefined, catalog);
    const name = new Map(graph.nodes.map(n => [n.id, n.name]));
    return {
        nodes: graph.nodes.map(n => n.name),
        edges: new Set(graph.edges.map(e => `${name.get(e.source)} > ${name.get(e.target)}`)),
    };
}

describe('prepoznavanje materijala za pravila', () => {
    it('kant traka i boja po početku naziva', () => {
        expect(materialTypeFromName('KT / Furnir Hrast 24 / 1')).toBe('kant');
        expect(materialTypeFromName('Boja za MDF')).toBe('lak');
        expect(materialTypeFromName('Lakiranje')).toBe('lak');
        expect(materialTypeFromName('MDF 18')).toBe('mdf');
    });

    it('sistemi ladica su vodilice', () => {
        expect(materialTypeFromName('LEGRABOX visina M 90.3 (siva) 350 103365635')).toBe('vodilice');
        expect(materialTypeFromName('Antaro Tandembox Sivi - Dubina = 500mm')).toBe('vodilice');
    });

    it('furnirana šperploča = furnir + šperploča; okov iz kategorije, ali ne vodilice', () => {
        expect(Array.from(ruleMaterialTypes(M('Furnirana šperploča')))).toEqual(['furnir', 'sper']);
        expect(ruleMaterialTypes(M('Tip on (sa čahurom)@Okovi')).has('okov')).toBe(true);
        expect(ruleMaterialTypes(M('Baglama ravna (sa ublazivacem)')).has('okov')).toBe(true);
        expect(ruleMaterialTypes(M('Vodilice Blum 500@Okovi')).has('okov')).toBe(false);
        expect(ruleMaterialTypes(M('Ogledalo / Clear')).has('led')).toBe(false);
    });
});

describe('standardni tokovi po vrsti proizvoda', () => {
    it('ormar od iverala: sklopi se jednom, bez probne montaže, pa okivanje', () => {
        const f = flow(M('Iveral / H3395 Hrast', 'KT / H3395 23 / 0.8', 'Baglama ravna (sa ublazivacem)@Okovi'));
        expect(f.nodes).not.toContain('Probna montaža');
        expect(Array.from(f.edges).sort()).toEqual(['Kantiranje iverala > Sklapanje kutija', 'Krojenje iverala > Kantiranje iverala', 'Sklapanje kutija > Okivanje']);
    });

    it('sam MDF: probna montaža, brušenje, farbanje, sklapanje nakon farbanja, okivanje', () => {
        const f = flow(M('MDF 18', 'Boja za MDF', 'Baglama ravna (sa ublazivacem)@Okovi'));
        expect(Array.from(f.edges).sort()).toEqual([
            'Brušenje > Farbanje', 'Farbanje > Završno sklapanje', 'Krojenje MDF-a > Probna montaža',
            'Probna montaža > Brušenje', 'Završno sklapanje > Okivanje',
        ]);
    });

    it('iveral + farbani MDF + vodilice: kutije i ladice čekaju fronte na probnoj montaži', () => {
        const f = flow(M('Iveral / Bijeli za korpus', 'MDF 18', 'Vodilice Blum 500@Okovi', 'Baglama ravna (sa ublazivacem)@Okovi'));
        ['Sklapanje kutija > Probna montaža', 'Kantiranje iverala > Izrada ladica', 'Izrada ladica > Probna montaža',
            'Krojenje MDF-a > Probna montaža', 'Brušenje > Farbanje', 'Završno sklapanje > Okivanje']
            .forEach(e => expect(f.edges).toContain(e));
        expect(f.nodes).not.toContain('Lakiranje');
        expect(f.edges).not.toContain('Sklapanje kutija > Izrada ladica'); // paralelno, ne poslije
    });

    it('iveral + furnir + MDF + LEGRABOX: lakiranje umjesto farbanja, kantiranje furnira', () => {
        const f = flow(M('Iveral / F416 Textil Bež', 'MDF 18', 'Furnir / Hrast', 'KT / Furnir Hrast 24 / 1',
            'LEGRABOX visina M 90.3 (siva) 450 103365637@Okovi', 'Baglama paralelna (sa ublazivacem)@Okovi'));
        expect(f.nodes).not.toContain('Farbanje');
        ['Krojenje MDF-a > Furniranje', 'Priprema furnira > Furniranje', 'Furniranje > Srezivanje na tačnu mjeru',
            'Srezivanje na tačnu mjeru > Kantiranje furnira', 'Kantiranje furnira > Probna montaža', 'Sklapanje kutija > Probna montaža',
            'Izrada ladica > Probna montaža', 'Brušenje > Lakiranje', 'Lakiranje > Završno sklapanje', 'Završno sklapanje > Okivanje']
            .forEach(e => expect(f.edges).toContain(e));
        expect(f.edges).not.toContain('Krojenje MDF-a > Priprema furnira'); // priprema furnira ne čeka krojenje
    });

    it('oblikovna šperploča + furnir: izrada zaobljenih dijelova umjesto srezivanja', () => {
        const f = flow(M('Oblikovna špera', 'Furnir / Orah'));
        expect(Array.from(f.edges).sort()).toEqual([
            'Brušenje > Lakiranje', 'Izrada zaobljenih dijelova > Probna montaža', 'Lakiranje > Završno sklapanje',
            'Priprema furnira > Izrada zaobljenih dijelova', 'Probna montaža > Brušenje',
        ]);
    });

    it('furnir + MDF + šperploča: priprema furnira hrani obje grane, spoj na probnoj montaži', () => {
        const f = flow(M('MDF 18', 'Furnir / Tik', 'Oblikovna špera'));
        ['Priprema furnira > Furniranje', 'Priprema furnira > Izrada zaobljenih dijelova',
            'Kantiranje furnira > Probna montaža', 'Izrada zaobljenih dijelova > Probna montaža'].forEach(e => expect(f.edges).toContain(e));
    });

    it('iveral s furnir kant trakom nije furnirani proizvod', () => {
        expect(flow(M('Iveral / Bijeli za korpus', 'KT / Furnir Hrast 22 / 1')).nodes).toEqual(['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija']);
    });

    it('samo vodilice kao okov: izrada ladica poslije kantiranja iverala, bez okivanja', () => {
        const f = flow(M('Iveral / U702 ST9', 'Vodilice Blum 450@Okovi'));
        expect(f.nodes).not.toContain('Okivanje');
        expect(f.edges).toContain('Kantiranje iverala > Izrada ladica');
    });

    it('čarobnjak naloga dobija iste faze kao graf (paralelne grane u istoj fazi)', () => {
        const r = buildAutoPlan(M('Iveral / Bijeli za korpus', 'MDF 18', 'Baglama@Okovi'), STANDARD_RULES, catalog, []);
        expect(r.stages[0]).toEqual(expect.arrayContaining(['Krojenje iverala', 'Krojenje MDF-a']));
        expect(r.stages.at(-1)).toEqual(['Okivanje']);
        expect(r.stages.flat()).toContain('Probna montaža');
    });
});

describe('šperploča, masiv, jela/smreka i cokl', () => {
    const flowFor = (name: string, materials: ReturnType<typeof M>) => {
        const { graph } = buildGraphFromRules(materials, STANDARD_RULES, undefined, catalog, name);
        const n = new Map(graph.nodes.map(x => [x.id, x.name]));
        return { nodes: graph.nodes.map(x => x.name), edges: new Set(graph.edges.map(e => `${n.get(e.source)} > ${n.get(e.target)}`)) };
    };

    it('ravna šperploča s furnirom ide kao furnir na MDF-u, bez zaobljenih dijelova', () => {
        const f = flowFor('Komoda', M('Šperploča breza CP / C 12', 'Furnir / Hrast'));
        expect(f.nodes).not.toContain('Izrada zaobljenih dijelova');
        ['Krojenje šperploče > Furniranje', 'Priprema furnira > Furniranje', 'Srezivanje na tačnu mjeru > Kantiranje furnira', 'Brušenje > Lakiranje'].forEach(e => expect(f.edges).toContain(e));
        expect(flowFor('Komoda', M('Furnirana šperploča')).nodes).toContain('Krojenje šperploče');
    });

    it('oblikovna šperploča se ne broji kao ravna', () => {
        expect(Array.from(ruleMaterialTypes(M('Oblikovna špera')))).toEqual(['oblikovna']);
        expect(flowFor('Obloga', M('Oblikovna špera', 'Furnir / Orah')).nodes).not.toContain('Krojenje šperploče');
    });

    it('vidljivi masiv uz furnirane dijelove ide na probnu montažu', () => {
        const f = flowFor('Pult umivaonika', M('Masiv / Hrast', 'Furnir / Hrast', 'MDF 18'));
        expect(f.edges).toContain('Priprema masive > Probna montaža');
        expect(materialTypeFromName('J / s masiv')).toBe('jela');
        expect(materialTypeFromName('Masiv Tik')).toBe('masiv');
    });

    it('jela/smreka: cokl samo kod ormara; inače samo priprema masive', () => {
        const ormar = flowFor('Poz 1.1 - Ormar', M('Iveral / Bijeli za korpus', 'J / s masiv', 'Baglama@Okovi'));
        expect(ormar.edges).toContain('Priprema masive > Izrada cokla');
        expect(ormar.edges).toContain('Izrada cokla > Okivanje');
        const krevet = flowFor('Poz 25 - Krevet', M('Iveral / Bijeli za korpus', 'J / s masiv'));
        expect(krevet.nodes).toContain('Priprema masive');
        expect(krevet.nodes).not.toContain('Izrada cokla');
        expect(flowFor('Garderober master', M('Furnir / Hrast', 'MDF 18', 'J / s masiv')).nodes).toContain('Izrada cokla');
    });
});

// Ispravke 25.10.2026 (PDF „Ispravke za app ERP"): stvarni proizvodi sa slajdova.
describe('ispravke: krevet, kuhinja, komoda, HPL, OSB, Kerrock/Corian', () => {
    const plan = (name: string, materials: ReturnType<typeof M>) => {
        const { graph } = buildGraphFromRules(materials, STANDARD_RULES, undefined, catalog, name);
        const n = new Map(graph.nodes.map(x => [x.id, x.name]));
        const stages = stagesFromGraph(graph);
        return {
            nodes: graph.nodes.map(x => x.name),
            edges: new Set(graph.edges.map(e => `${n.get(e.source)} > ${n.get(e.target)}`)),
            stages,
            phase: (p: string) => stages.findIndex(s => s.includes(p)),
        };
    };

    it('krevet: bez kutija, masiv za rešetku baze, priprema furnira odmah, kantiranje furnira poslije srezivanja', () => {
        const k = plan('Poz 1 - Kreveti 1800', M('Iveral / Bijeli za korpus', 'KT / W1000 Premium bijela', 'Šperploča breza 12',
            'Masiv / Hrast', 'Furnir / Hrast', 'KT / Furnir Hrast 24 / 1', 'Okov za krevet@Okovi'));
        expect(k.nodes).not.toContain('Sklapanje kutija');
        ['Krojenje iverala > Kantiranje iverala', 'Kantiranje iverala > Probna montaža',
            'Priprema masive > Izrada rešetke baze', 'Izrada rešetke baze > Probna montaža',
            'Srezivanje na tačnu mjeru > Kantiranje furnira'].forEach(e => expect(k.edges).toContain(e));
        expect(k.edges).not.toContain('Priprema masive > Probna montaža');
        expect(k.stages[0]).toEqual(expect.arrayContaining(['Krojenje iverala', 'Krojenje šperploče', 'Priprema masive', 'Priprema furnira']));
        expect(k.phase('Kantiranje iverala')).toBe(1);
        expect(k.phase('Kantiranje furnira')).toBeGreaterThan(k.phase('Srezivanje na tačnu mjeru'));
    });

    it('krevet s rešetkom od jele/smreke', () => {
        expect(plan('Krevet bračni', M('Iveral / Bijeli za korpus', 'J / s masiv')).edges).toContain('Priprema masive > Izrada rešetke baze');
        expect(plan('Ormar', M('Iveral / Bijeli za korpus', 'J / s masiv')).nodes).not.toContain('Izrada rešetke baze');
    });

    const kuhinja = M('Baglama ravna (bez ublazivaca)@Okovi', 'Boja za MDF', 'Furnir / Hrast', 'Horizontalna Gola L',
        'Iveral / W1000 Bijela', 'Izvlačna košara za korpus (720×300)@Okovi', 'KT / Furnir Hrast 24 / 1', 'KT / W1000 Premium bijela',
        'Lakiranje', 'Lesomal', 'MDF 18', 'Space tower Blum@Okovi', 'Vodilice Blum 550@Okovi');

    it('kuhinja: ladice poslije kantiranja iverala; dio MDF-a se furnira, dio farba', () => {
        const k = plan('Poz 3 - Kuhinja', kuhinja);
        expect(k.edges).toContain('Kantiranje iverala > Izrada ladica');
        expect(k.phase('Izrada ladica')).toBeGreaterThan(k.phase('Kantiranje iverala'));
        expect(k.stages[0]).toEqual(expect.arrayContaining(['Krojenje iverala', 'Krojenje MDF-a', 'Priprema furnira']));
        ['Krojenje MDF-a > Furniranje', 'Krojenje MDF-a > Probna montaža', 'Brušenje > Lakiranje', 'Brušenje > Farbanje',
            'Farbanje > Završno sklapanje'].forEach(e => expect(k.edges).toContain(e));
        expect(k.phase('Farbanje')).toBe(k.phase('Lakiranje'));
    });

    it('komoda bez iverala: ladice od furniranog MDF-a kad i probna montaža, ne u prvoj fazi', () => {
        const k = plan('Poz 2 - Retropult komoda', M('Baglama ravna (sa ublazivacem)@Okovi', 'Furnir / Orah', 'Lakiranje', 'MDF 18', 'Vodilice Blum 500@Okovi'));
        expect(k.phase('Izrada ladica')).toBe(k.phase('Probna montaža'));
        expect(k.edges).toContain('Kantiranje furnira > Izrada ladica');
        expect(k.edges).toContain('Izrada ladica > Brušenje');
        expect(k.nodes).not.toContain('Farbanje'); // „Lakiranje" nije boja
    });

    it('farbana komoda bez iverala: ladice kad i probna montaža', () => {
        const k = plan('Komoda', M('MDF 18', 'Boja za MDF', 'Vodilice Blum 500@Okovi'));
        expect(k.phase('Izrada ladica')).toBe(k.phase('Probna montaža'));
        expect(k.phase('Izrada ladica')).toBeGreaterThan(0);
    });

    it('HPL: krojenje, presovanje na MDF, srezivanje; bez brušenja i lakiranja; MDF nije farban', () => {
        const k = plan('Recepcija', M('HPL / Fenix 0720', 'MDF 18'));
        ['Krojenje HPL-a > Presovanje HPL-a', 'Krojenje MDF-a > Presovanje HPL-a', 'Presovanje HPL-a > Srezivanje na tačnu mjeru',
            'Srezivanje na tačnu mjeru > Probna montaža'].forEach(e => expect(k.edges).toContain(e));
        ['Brušenje', 'Lakiranje', 'Farbanje'].forEach(p => expect(k.nodes).not.toContain(p));
        expect(materialTypeFromName('HPL / Hrast dekor')).toBe('hpl');
    });

    it('OSB: krojenje OSB-a pa izrada podkonstrukcije', () => {
        expect(Array.from(plan('Zidna obloga', M('OSB 18')).edges)).toEqual(['Krojenje OSB-a > Izrada podkonstrukcije od OSB-a']);
    });

    // PDF 29.10.: Budnja — švedski stolovi od iverala na podkonstrukciji od OSB-a i jele/smreke.
    it('podkonstrukcije (OSB, jela/smreka) su odvojeni koraci prije sklapanja kutija', () => {
        const stol = plan('Poz 1 - Svedski stol', M('Iveral / Bijeli', 'KT / Bijeli', 'OSB 18', 'J / s masiv', 'Baglama ravna@Okovi'));
        ['Krojenje OSB-a > Izrada podkonstrukcije od OSB-a', 'Izrada podkonstrukcije od OSB-a > Sklapanje kutija',
            'Priprema masive > Izrada podkonstrukcije od jele/smreke', 'Izrada podkonstrukcije od jele/smreke > Sklapanje kutija',
            'Kantiranje iverala > Sklapanje kutija', 'Sklapanje kutija > Okivanje'].forEach(e => expect(stol.edges).toContain(e));
        expect(stol.phase('Sklapanje kutija')).toBeGreaterThan(stol.phase('Izrada podkonstrukcije od OSB-a'));
    });

    it('podkonstrukcija od jele/smreke: ne kod ormara (cokl) ni kreveta (rešetka baze)', () => {
        expect(plan('Garderober', M('Iveral / Bijeli', 'J / s masiv')).nodes).not.toContain('Izrada podkonstrukcije od jele/smreke');
        expect(plan('Krevet', M('Iveral / Bijeli', 'J / s masiv')).nodes).not.toContain('Izrada podkonstrukcije od jele/smreke');
        expect(plan('Krevet', M('Iveral / Bijeli', 'OSB 18')).edges).not.toContain('Izrada podkonstrukcije od OSB-a > Sklapanje kutija');
        expect(plan('Stol', M('J / s masiv')).nodes).toEqual(['Priprema masive', 'Izrada podkonstrukcije od jele/smreke']);
    });

    it('Kerrock i Corian: krojenje, lijepljenje, brušenje, montaža', () => {
        expect(Array.from(plan('Pult', M('Kerrock / 101 Bijela')).edges)).toEqual([
            'Krojenje Kerrocka > Lijepljenje Kerrocka', 'Lijepljenje Kerrocka > Brušenje Kerrocka', 'Brušenje Kerrocka > Montaža Kerrocka']);
        expect(plan('Pult', M('Corian Glacier White')).nodes).toEqual(['Krojenje Coriana', 'Lijepljenje Coriana', 'Brušenje Coriana', 'Montaža Coriana']);
        expect(materialTypeFromName('Kerrock ljepilo')).toBe('ljepilo');
        // „Bijela" nije jela/smreka (prije je „Kerrock / 101 Bijela" bio jela).
        expect(materialTypeFromName('Kerrock / 101 Bijela')).toBe('kerrock');
        expect(materialTypeFromName('Jela 50x50')).toBe('jela');
        expect(materialTypeFromName('Masiv jela')).toBe('jela');
        // Okivanje ostaje zadnje: montaža Kerrocka vodi u njega.
        expect(plan('Pult', M('Kerrock / 101 Bijela', 'Baglama@Okovi')).edges).toContain('Montaža Kerrocka > Okivanje');
    });

    it('boja je signal samo za boju/farbu, ne za „Lakiranje"', () => {
        expect(materialTypeFromName('Boja za MDF')).toBe('lak');
        expect(ruleMaterialTypes(M('Boja za MDF')).has('boja')).toBe(true);
        expect(ruleMaterialTypes(M('Lakiranje')).has('boja')).toBe(false);
        expect(ruleMaterialTypes(M('Iveral / bijela boja')).has('boja')).toBe(false);
    });

    it('nijedno pravilo ne stavlja izradu ladica u prvu fazu kad ima ploča', () => {
        for (const mats of [kuhinja, M('Furnir / Orah', 'MDF 18', 'Vodilice@Okovi'), M('Iveral / Bijeli', 'Vodilice@Okovi'), M('HPL / Fenix', 'MDF 18', 'Vodilice@Okovi')]) {
            expect(plan('Element', mats).phase('Izrada ladica')).toBeGreaterThan(0);
        }
    });
});

describe('verzija standarda i stari nazivi', () => {
    it('zamjenjuju se samo pravila standarda; dok nijedno nije označeno — sva', () => {
        const tagged: { ID: string; Standard_Version?: string }[] = [{ ID: 'a', Standard_Version: '2026-10-25.1' }, { ID: 'b' }];
        const legacy: { ID: string; Standard_Version?: string }[] = [{ ID: 'x' }, { ID: 'y' }];
        expect(standardRulesIn(tagged).map(r => r.ID)).toEqual(['a']);
        expect(standardRulesIn(legacy).map(r => r.ID)).toEqual(['x', 'y']);
        expect(standardIsCurrent(tagged)).toBe(false);
        expect(standardIsCurrent([{ Standard_Version: STANDARD_VERSION }])).toBe(true);
    });

    it('stari naziv procesa → kanonski', () => {
        expect(canonicalProcessName('Kantiranje fronti')).toBe('Kantiranje furnira');
        expect(canonicalProcessName('kantiranje')).toBe('Kantiranje iverala');
        expect(canonicalProcessName('Brušenje')).toBe('Brušenje');
        expect(canonicalProcessName('Izrada podkonstrukcije')).toBe('Izrada podkonstrukcije od OSB-a');
    });

    it('svaki proces iz pravila je u katalogu', () => {
        const inCatalog = new Set(STANDARD_CATALOG);
        STANDARD_RULES.flatMap(r => r.Processes).forEach(p => expect(inCatalog.has(p)).toBe(true));
    });

    it('„osim za proizvode": pravilo ne okida za taj naziv', () => {
        const r = { Match_Kind: 'material_type' as const, Match_Value: 'iveral', Exclude_Product_Keywords: ['krevet'] };
        const types = ruleMaterialTypes(M('Iveral / Bijeli'));
        expect(ruleMatches(r, [], types, 'Kreveti 1800')).toBe(false);
        expect(ruleMatches(r, [], types, 'Ormar')).toBe(true);
    });
});

describe('vrsta proizvoda → šablon toka (vrata)', () => {
    const doors = {
        name: 'Furnirana vrata (obična)', Product_Keywords: ['vrata'],
        nodes: [{ id: 'a', name: 'Priprema masive (ramova)' }, { id: 'b', name: 'Ramovi i cjevasta iverica' }, { id: 'c', name: 'Okivanje' }, { id: 'x', name: '' }],
        edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }, { id: 'e3', source: 'x', target: 'c' }],
    };
    const materials = M('Furnir / Hrast', 'MDF 6', 'J / s masiv', 'Baglame za vrata - Skrivene@Okovi');

    it('naziv s „vrata" dobija šablon umjesto pravila; prazan čvor ispada', () => {
        const p = planGraphForProduct({ productName: 'Poz 1 - Sobna vrata', materials, rules: STANDARD_RULES, catalog, flowTemplates: [doors] });
        expect(p).toMatchObject({ source: 'template', templateName: 'Furnirana vrata (obična)' });
        expect(p.graph.nodes.map(n => n.name)).toEqual(['Priprema masive (ramova)', 'Ramovi i cjevasta iverica', 'Okivanje']);
        expect(p.graph.edges).toHaveLength(2);
    });

    it('„vratima" u nazivu ormara nije vrsta vrata', () => {
        expect(planGraphForProduct({ productName: 'Ormar sa kliznim vratima', materials, rules: STANDARD_RULES, catalog, flowTemplates: [doors] }).source).toBe('rules');
        expect(nameHasKeyword('Garderober ormar', ['ormar'])).toBe(true);
        expect(nameHasKeyword('Noćni ormarići', ['ormar'])).toBe(true);
        expect(nameHasKeyword('Šišić - SOBNA VRATA', ['sobna vrata'])).toBe(true);
    });

    it('čarobnjak naloga uzima faze iz šablona', () => {
        const r = buildAutoPlan(materials, STANDARD_RULES, catalog, [], { name: 'Sobna vrata', flowTemplates: [doors] });
        expect(r).toMatchObject({ source: 'template', stages: [['Priprema masive (ramova)'], ['Ramovi i cjevasta iverica'], ['Okivanje']] });
    });
});

describe('pregled normalizacije', () => {
    const current = [
        { Name: 'Priprema masive', Order: 1 }, { Name: 'Krojenje furnira', Order: 2 }, { Name: 'Krojenje MDF-a', Order: 3 },
        { Name: 'Krojenje Iverala', Order: 5 }, { Name: 'Farbanje i lakiranje', Order: 15 }, { Name: 'Obrada na CNC', Order: 21 },
    ];
    const p = planStandardization(current, [...current.map(c => c.Name), 'Okivanje vrata'], 2);

    it('samo stari nazivi koji postoje', () => {
        expect(p.renames).toEqual(expect.arrayContaining([
            { canonical: 'Priprema furnira', members: ['Krojenje furnira'] },
            { canonical: 'Krojenje iverala', members: ['Krojenje Iverala'] },
            { canonical: 'Lakiranje', members: ['Farbanje i lakiranje'] },
            { canonical: 'Okivanje', members: ['Okivanje vrata'] },
        ]));
        expect(p.renames.find(g => g.canonical === 'Izrada ladica')).toBeUndefined();
    });

    it('katalog: standard prvo, ostali procesi iza; nedostajući se dodaju', () => {
        expect(p.order.slice(0, STANDARD_CATALOG.length)).toEqual(STANDARD_CATALOG);
        expect(p.order.at(-1)).toBe('Obrada na CNC');
        expect(p.addToCatalog).toContain('Probna montaža');
        expect(p.addToCatalog).not.toContain('Priprema furnira'); // nastaje preimenovanjem
        expect(p).toMatchObject({ rulesToRemove: 2, rulesToAdd: STANDARD_RULES });
    });
});
