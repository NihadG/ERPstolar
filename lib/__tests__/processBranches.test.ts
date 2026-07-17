import {
    buildGraphFromRules,
    stagesFromGraph,
    mergeProductGraphs,
    ruleMatches,
    presentMaterialTypes,
} from '../productProcesses';
import type { ProcessGraph } from '../types';

// ── Korisnikov stvarni scenario (dječiji garderober / komoda) ─────────
// Iveral se SAMO kroji, kantira i sklapa. MDF se kroji, furnira, formatira,
// brusi. Grane su PARALELNE i sastaju se tek na sklapanju/okivanju.
const RULES = [
    { Match_Kind: 'material_type' as const, Match_Value: 'iveral', Processes: ['Krojenje iverala', 'Kantiranje', 'Sklapanje'] },
    {
        Match_Kind: 'material_type_combo' as const, Match_Value: '', Match_Types: ['furnir', 'mdf'],
        Processes: ['Krojenje MDF-a', 'Krojenje furnira', 'Furniranje', 'Srezivanje elemenata iz prese', 'Brušenje', 'Sklapanje'],
    },
    { Match_Kind: 'material_type' as const, Match_Value: 'lak', Processes: ['Farbanje i lakiranje'] },
    { Match_Kind: 'material_type' as const, Match_Value: 'sarke', Processes: ['Sklapanje', 'Okivanje'] },
];

const GARDEROBER_MATERIJALI = [
    { Material_Name: 'Iveral / F416 Textil Bež' },
    { Material_Name: 'MDF 18' },
    { Material_Name: 'Furnir / Jasen' },
    { Material_Name: 'Lakiranje' },
    { Material_Name: 'Baglama ravna (sa ublazivacem)' },   // šarke
];

const nodeByName = (g: ProcessGraph, name: string) => g.nodes.find(n => n.name === name)!;
const hasEdge = (g: ProcessGraph, from: string, to: string) =>
    g.edges.some(e => e.source === nodeByName(g, from)?.id && e.target === nodeByName(g, to)?.id);

describe('buildGraphFromRules — grane po pravilu, spoj na istoimenim čvorovima', () => {
    const res = buildGraphFromRules(GARDEROBER_MATERIJALI, RULES);

    test('svaka grana čuva SVOJ redoslijed (iz pravila, ne iz kataloga)', () => {
        expect(hasEdge(res.graph, 'Krojenje iverala', 'Kantiranje')).toBe(true);
        expect(hasEdge(res.graph, 'Kantiranje', 'Sklapanje')).toBe(true);
        expect(hasEdge(res.graph, 'Krojenje MDF-a', 'Krojenje furnira')).toBe(true);
        expect(hasEdge(res.graph, 'Furniranje', 'Srezivanje elemenata iz prese')).toBe(true);
        expect(hasEdge(res.graph, 'Brušenje', 'Sklapanje')).toBe(true);
    });

    test('grane su paralelne: NEMA veze između krojenja iverala i MDF lanca', () => {
        expect(hasEdge(res.graph, 'Krojenje iverala', 'Krojenje MDF-a')).toBe(false);
        expect(hasEdge(res.graph, 'Krojenje MDF-a', 'Krojenje iverala')).toBe(false);
        expect(hasEdge(res.graph, 'Kantiranje', 'Furniranje')).toBe(false);
    });

    test('zajednički proces = JEDAN čvor (Sklapanje spaja iveral, MDF i okove)', () => {
        const skl = res.graph.nodes.filter(n => n.name === 'Sklapanje');
        expect(skl).toHaveLength(1);
        const incoming = res.graph.edges.filter(e => e.target === skl[0].id);
        expect(incoming.length).toBeGreaterThanOrEqual(2);   // iz Kantiranja i iz Brušenja
        expect(hasEdge(res.graph, 'Sklapanje', 'Okivanje')).toBe(true);
    });

    test('lak grana bez veza (samostalan čvor dok je korisnik ne poveže)', () => {
        const lak = nodeByName(res.graph, 'Farbanje i lakiranje');
        expect(lak).toBeDefined();
        const touching = res.graph.edges.filter(e => e.source === lak.id || e.target === lak.id);
        expect(touching).toHaveLength(0);
    });

    test('branches za UI prikaz grana', () => {
        const labels = res.branches.map(b => b.label);
        expect(labels).toContain('iveral');
        expect(labels).toContain('furnir + mdf');
        const mdf = res.branches.find(b => b.label === 'furnir + mdf')!;
        expect(mdf.processes[0]).toBe('Krojenje MDF-a');   // redoslijed pravila očuvan
    });

    test('pravila koja ne okidaju ne prave grane; bez materijala → prazno', () => {
        const none = buildGraphFromRules([{ Material_Name: 'Staklo kaljeno' }], RULES);
        expect(none.graph.nodes).toHaveLength(0);
        expect(buildGraphFromRules([], RULES).graph.nodes).toHaveLength(0);
    });

    test('ciklus među pravilima se presiječe uz upozorenje', () => {
        const cyc = buildGraphFromRules(
            [{ Material_Name: 'Iveral' }, { Material_Name: 'MDF' }],
            [
                { Match_Kind: 'material_type', Match_Value: 'iveral', Processes: ['A', 'B'] },
                { Match_Kind: 'material_type', Match_Value: 'mdf', Processes: ['B', 'A'] },
            ]
        );
        expect(cyc.warnings.length).toBe(1);
        expect(cyc.graph.edges).toHaveLength(1);   // samo A→B preživi
    });
});

describe('stagesFromGraph — topološki derivat faza', () => {
    test('garderober: krojenja u fazi 1, sklapanje poslije obje grane', () => {
        const { graph } = buildGraphFromRules(GARDEROBER_MATERIJALI, RULES);
        const stages = stagesFromGraph(graph);
        expect(stages[0]).toEqual(expect.arrayContaining(['Krojenje iverala', 'Krojenje MDF-a', 'Farbanje i lakiranje']));
        const idxOf = (name: string) => stages.findIndex(s => s.includes(name));
        expect(idxOf('Sklapanje')).toBeGreaterThan(idxOf('Kantiranje'));
        expect(idxOf('Sklapanje')).toBeGreaterThan(idxOf('Brušenje'));
        expect(idxOf('Okivanje')).toBeGreaterThan(idxOf('Sklapanje'));
        expect(idxOf('Furniranje')).toBeLessThan(idxOf('Srezivanje elemenata iz prese'));   // NE na kraju!
    });
    test('prazan graf → prazno', () => {
        expect(stagesFromGraph({ nodes: [], edges: [] })).toEqual([]);
        expect(stagesFromGraph(undefined)).toEqual([]);
    });
});

describe('mergeProductGraphs — objedinjavanje grafova proizvoda u nalog', () => {
    const komoda = buildGraphFromRules(
        [{ Material_Name: 'Iveral U702' }, { Material_Name: 'Baglama' }],
        RULES
    ).graph;   // iveral grana + okivanje
    const ormar = buildGraphFromRules(GARDEROBER_MATERIJALI, RULES).graph;   // sve grane

    const merged = mergeProductGraphs([
        { itemId: 'komoda', graph: komoda },
        { itemId: 'ormar', graph: ormar },
    ]);

    test('isti proces preko proizvoda = jedan čvor s oba itemId', () => {
        const kroj = merged.graph.nodes.filter(n => n.name === 'Krojenje iverala');
        expect(kroj).toHaveLength(1);
        expect(kroj[0].itemIds.sort()).toEqual(['komoda', 'ormar']);
    });

    test('procesi samo jednog proizvoda nose samo njegov itemId', () => {
        const furn = merged.graph.nodes.find(n => n.name === 'Furniranje')!;
        expect(furn.itemIds).toEqual(['ormar']);
    });

    test('ivice obje strukture postoje bez duplikata; columns prate topologiju', () => {
        expect(hasEdge(merged.graph, 'Krojenje iverala', 'Kantiranje')).toBe(true);
        expect(hasEdge(merged.graph, 'Brušenje', 'Sklapanje')).toBe(true);
        const ids = merged.graph.edges.map(e => `${e.source}→${e.target}`);
        expect(new Set(ids).size).toBe(ids.length);
        expect(merged.columns.length).toBeGreaterThanOrEqual(4);
    });

    test('proizvodi bez grafa se preskaču', () => {
        const only = mergeProductGraphs([
            { itemId: 'x', graph: { nodes: [], edges: [] } },
            { itemId: 'komoda', graph: komoda },
        ]);
        expect(only.graph.nodes.every(n => n.itemIds.includes('komoda'))).toBe(true);
    });
});

describe('ruleMatches / presentMaterialTypes — smoke', () => {
    test('kombinacija traži SVE tipove', () => {
        const combo = RULES[1];
        const both = new Set(presentMaterialTypes([{ Material_Name: 'MDF 18' }, { Material_Name: 'Furnir Jasen' }]));
        const onlyMdf = new Set(presentMaterialTypes([{ Material_Name: 'MDF 18' }]));
        expect(ruleMatches(combo, [], both)).toBe(true);
        expect(ruleMatches(combo, [], onlyMdf)).toBe(false);
    });
});
