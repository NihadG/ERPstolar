import { buildGraphFromRules, ruleMaterialTypes, materialTypeFromName } from '../productProcesses';
import { buildAutoPlan } from '../processAutoPlan';
import { planStandardization, STANDARD_CATALOG, STANDARD_RULES } from '../processStandard';

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
        expect(Array.from(f.edges).sort()).toEqual(['Kantiranje > Sklapanje kutija', 'Krojenje iverala > Kantiranje', 'Sklapanje kutija > Okivanje']);
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
        ['Sklapanje kutija > Probna montaža', 'Krojenje iverala > Izrada ladica', 'Izrada ladica > Probna montaža',
            'Krojenje MDF-a > Probna montaža', 'Brušenje > Farbanje', 'Završno sklapanje > Okivanje']
            .forEach(e => expect(f.edges).toContain(e));
        expect(f.nodes).not.toContain('Lakiranje');
        expect(f.edges).not.toContain('Sklapanje kutija > Izrada ladica'); // paralelno, ne poslije
    });

    it('iveral + furnir + MDF + LEGRABOX: lakiranje umjesto farbanja, kantiranje fronti', () => {
        const f = flow(M('Iveral / F416 Textil Bež', 'MDF 18', 'Furnir / Hrast', 'KT / Furnir Hrast 24 / 1',
            'LEGRABOX visina M 90.3 (siva) 450 103365637@Okovi', 'Baglama paralelna (sa ublazivacem)@Okovi'));
        expect(f.nodes).not.toContain('Farbanje');
        ['Krojenje MDF-a > Priprema furnira', 'Priprema furnira > Furniranje', 'Furniranje > Srezivanje na tačnu mjeru',
            'Srezivanje na tačnu mjeru > Kantiranje fronti', 'Kantiranje fronti > Probna montaža', 'Sklapanje kutija > Probna montaža',
            'Izrada ladica > Probna montaža', 'Brušenje > Lakiranje', 'Lakiranje > Završno sklapanje', 'Završno sklapanje > Okivanje']
            .forEach(e => expect(f.edges).toContain(e));
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
            'Kantiranje fronti > Probna montaža', 'Izrada zaobljenih dijelova > Probna montaža'].forEach(e => expect(f.edges).toContain(e));
    });

    it('iveral s furnir kant trakom nije furnirani proizvod', () => {
        expect(flow(M('Iveral / Bijeli za korpus', 'KT / Furnir Hrast 22 / 1')).nodes).toEqual(['Krojenje iverala', 'Kantiranje', 'Sklapanje kutija']);
    });

    it('samo vodilice kao okov: izrada ladica, bez okivanja', () => {
        const f = flow(M('Iveral / U702 ST9', 'Vodilice Blum 450@Okovi'));
        expect(f.nodes).not.toContain('Okivanje');
        expect(f.edges).toContain('Krojenje iverala > Izrada ladica');
    });

    it('čarobnjak naloga dobija iste faze kao graf (paralelne grane u istoj fazi)', () => {
        const r = buildAutoPlan(M('Iveral / Bijeli za korpus', 'MDF 18', 'Baglama@Okovi'), STANDARD_RULES, catalog, []);
        expect(r.stages[0]).toEqual(expect.arrayContaining(['Krojenje iverala', 'Krojenje MDF-a']));
        expect(r.stages.at(-1)).toEqual(['Okivanje']);
        expect(r.stages.flat()).toContain('Probna montaža');
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
