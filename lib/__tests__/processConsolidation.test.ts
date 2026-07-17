import {
    normKey,
    collectProcessUsage,
    similarityRatio,
    suggestConsolidationGroups,
    pickCanonical,
    buildRenameMap,
    renameName,
    renameList,
    renameStages,
    mergeItemProcesses,
    renameGraphNodes,
    computeGroupImpact,
    type UsageInputs,
} from '../processConsolidation';
import type { ProcessGraph } from '../types';

describe('normKey — normalizacija naziva', () => {
    test('case, razmaci, dijakritike', () => {
        expect(normKey('  Krojenje   Iverala ')).toBe('krojenje iverala');
        expect(normKey('Bušenje')).toBe(normKey('busenje'));
        expect(normKey('Šarke')).toBe('sarke');
        expect(normKey('Đonovi')).toBe('djonovi');
    });
    test('prazno/null', () => {
        expect(normKey('')).toBe('');
        expect(normKey(undefined)).toBe('');
    });
});

describe('collectProcessUsage — skupljanje upotrebe po izvorima', () => {
    const inputs: UsageInputs = {
        catalog: [{ Name: 'Kantiranje', Order: 2 }, { Name: 'Krojenje iverala', Order: 1 }],
        rules: [{ Processes: ['Kantiranje', 'kantiranje'] }],   // isti ključ u jednom pravilu = broji se jednom
        stageTemplates: [{ Stages: [{ processes: ['Kantiranje'] }, { processes: ['Sklapanje'] }] }],
        flowTemplates: [{ nodes: [{ name: 'Farbanje' }] }],
        products: [
            { Process_Plan: ['Krojenje iverala', 'Kantiranje'], Process_Stages: [{ processes: ['Krojenje iverala'] }] },
            { Process_Stages: [{ processes: ['Krojenje Ivarala'] }] },   // tipfeler — poseban ključ
        ],
        workOrders: [{
            items: [{ Processes: [{ Process_Name: 'Kantiranje' }], Process_Stages: [{ processes: ['Kantiranje'] }] }],
            graph: { nodes: [{ name: 'Kantiranje', aliases: ['kantiranje ploča'] }] },
        }],
    };
    const usage = collectProcessUsage(inputs);
    const byKey = new Map(usage.map(u => [u.key, u]));

    test('katalog/pravila/šabloni/proizvodi/nalozi se broje', () => {
        const kant = byKey.get('kantiranje')!;
        expect(kant.inCatalog).toBe(true);
        expect(kant.catalogOrder).toBe(2);
        expect(kant.counts.rules).toBe(1);
        expect(kant.counts.stageTemplates).toBe(1);
        expect(kant.counts.products).toBe(1);      // jedan proizvod (dedupe unutar proizvoda)
        expect(kant.counts.orderItems).toBe(1);    // jedna stavka
        expect(kant.counts.orderGraphs).toBe(1);
    });
    test('tipfeler je odvojen ključ, van kataloga', () => {
        const typo = byKey.get('krojenje ivarala')!;
        expect(typo).toBeDefined();
        expect(typo.inCatalog).toBe(false);
        expect(typo.counts.products).toBe(1);
    });
    test('alias čvora grafa se evidentira', () => {
        expect(byKey.get('kantiranje ploca')).toBeDefined();
    });
});

describe('suggestConsolidationGroups — prijedlog grupa', () => {
    const mkUsage = (inputs: UsageInputs) => collectProcessUsage(inputs);

    test('tipfeler (ivarala/iverala) → high grupa; različite operacije se NE spajaju', () => {
        const usage = mkUsage({
            catalog: [{ Name: 'Krojenje iverala', Order: 1 }, { Name: 'Kantiranje', Order: 2 }],
            rules: [], stageTemplates: [], flowTemplates: [],
            products: [{ Process_Plan: ['Krojenje ivarala'] }],
            workOrders: [],
        });
        const groups = suggestConsolidationGroups(usage);
        const g = groups.find(x => x.memberKeys.includes('krojenje ivarala'));
        expect(g).toBeDefined();
        expect(g!.memberKeys).toContain('krojenje iverala');
        expect(g!.confidence).toBe('high');
        expect(g!.canonical).toBe('Krojenje iverala');   // katalog pobjeđuje
        // Kantiranje ne smije upasti ni u jednu grupu
        expect(groups.some(x => x.memberKeys.includes('kantiranje'))).toBe(false);
    });

    test('podskup tokena (Krojenje vs Krojenje iverala) se NE grupiše automatski', () => {
        const usage = mkUsage({
            catalog: [{ Name: 'Krojenje', Order: 1 }, { Name: 'Krojenje iverala', Order: 2 }],
            rules: [], stageTemplates: [], flowTemplates: [], products: [], workOrders: [],
        });
        expect(suggestConsolidationGroups(usage)).toHaveLength(0);
    });

    test('više display oblika istog ključa → exact grupa', () => {
        const usage = mkUsage({
            catalog: [{ Name: 'Kantiranje', Order: 1 }],
            rules: [{ Processes: ['KANTIRANJE'] }],
            stageTemplates: [], flowTemplates: [], products: [], workOrders: [],
        });
        const groups = suggestConsolidationGroups(usage);
        expect(groups).toHaveLength(1);
        expect(groups[0].confidence).toBe('exact');
        expect(groups[0].members.sort()).toEqual(['KANTIRANJE', 'Kantiranje'].sort());
    });
});

describe('similarityRatio', () => {
    test('tipfeler visok, nepovezano nisko', () => {
        expect(similarityRatio('Krojenje ivarala', 'Krojenje iverala')).toBeGreaterThanOrEqual(0.85);
        expect(similarityRatio('Kantiranje', 'Farbanje')).toBeLessThan(0.6);
    });
});

describe('pickCanonical', () => {
    test('katalog > frekvencija > dužina', () => {
        expect(pickCanonical([
            { display: 'krojenje iverala', total: 10, inCatalog: false },
            { display: 'Krojenje iverala', total: 2, inCatalog: true },
        ])).toBe('Krojenje iverala');
        expect(pickCanonical([
            { display: 'Kant', total: 3, inCatalog: false },
            { display: 'Kantiranje', total: 3, inCatalog: false },
        ])).toBe('Kantiranje');
    });
});

describe('rename primjene', () => {
    const map = buildRenameMap([
        { canonical: 'Krojenje iverala', members: ['Krojenje ivarala', 'krojenje iverala'] },
        { canonical: 'Farbanje i lakiranje', members: ['Farbanje', 'Lakiranje'] },
    ]);

    test('renameName — član i sam canonical se normalizuju', () => {
        expect(renameName('Krojenje ivarala', map)).toBe('Krojenje iverala');
        expect(renameName('  krojenje   iverala ', map)).toBe('Krojenje iverala');
        expect(renameName('Kantiranje', map)).toBe('Kantiranje');   // netaknut
    });

    test('renameList — dedupe nakon preimenovanja', () => {
        expect(renameList(['Farbanje', 'Lakiranje', 'Kantiranje'], map))
            .toEqual(['Farbanje i lakiranje', 'Kantiranje']);
    });

    test('renameStages — dedupe kroz faze, prazne faze ispadaju', () => {
        const out = renameStages([
            { processes: ['Krojenje ivarala'] },
            { processes: ['krojenje iverala', 'Kantiranje'] },
            { processes: ['Farbanje'] },
            { processes: ['Lakiranje'] },
        ], map);
        expect(out).toEqual([['Krojenje iverala'], ['Kantiranje'], ['Farbanje i lakiranje']]);
    });

    test('mergeItemProcesses — završeni zapis preživljava spajanje', () => {
        const out = mergeItemProcesses([
            { Process_Name: 'Farbanje', Status: 'Na čekanju' },
            { Process_Name: 'Lakiranje', Status: 'Završeno', Worker_Name: 'Emir', Completed_At: '2026-07-01' } as any,
            { Process_Name: 'Kantiranje', Status: 'U toku' },
        ], map);
        expect(out).toHaveLength(2);
        const merged = out.find(p => p.Process_Name === 'Farbanje i lakiranje')! as any;
        expect(merged.Status).toBe('Završeno');
        expect(merged.Worker_Name).toBe('Emir');
        expect(out[1].Process_Name).toBe('Kantiranje');
    });
});

describe('renameGraphNodes — spajanje čvorova uz čuvanje ID-eva', () => {
    const map = buildRenameMap([
        { canonical: 'Farbanje i lakiranje', members: ['Farbanje', 'Lakiranje'] },
    ]);
    const graph: ProcessGraph = {
        nodes: [
            { id: 'n1', name: 'Krojenje', itemIds: ['a'] },
            { id: 'n2', name: 'Farbanje', itemIds: ['a'], position: { x: 1, y: 2 } },
            { id: 'n3', name: 'Lakiranje', itemIds: ['b'], aliases: ['Lakiranje'] },
        ],
        edges: [
            { id: 'e1', source: 'n1', target: 'n2' },
            { id: 'e2', source: 'n1', target: 'n3' },   // nakon spajanja duplikat e1
            { id: 'e3', source: 'n2', target: 'n3' },   // postaje self-loop → ispada
        ],
    };

    test('merge: survivor prvi, itemIds/aliases unija, remap ivica, self-loop drop', () => {
        const res = renameGraphNodes(graph, map);
        expect(res.mergedCount).toBe(1);
        expect(res.changed).toBe(true);
        expect(res.graph.nodes).toHaveLength(2);
        const merged = res.graph.nodes.find(n => n.name === 'Farbanje i lakiranje')!;
        expect(merged.id).toBe('n2');                                  // ID preživio
        expect(merged.itemIds.sort()).toEqual(['a', 'b']);
        expect(merged.aliases).toEqual(expect.arrayContaining(['Farbanje', 'Lakiranje', 'Farbanje i lakiranje']));
        expect(res.nodeIdRemap).toEqual({ n3: 'n2' });                 // za WorkLog remap
        expect(res.graph.edges).toHaveLength(1);
        expect(res.graph.edges[0]).toMatchObject({ source: 'n1', target: 'n2' });
    });

    test('preferSurvivorIds — čvor s knjiženim radom čuva svoj ID', () => {
        const res = renameGraphNodes(graph, map, new Set(['n3']));
        const merged = res.graph.nodes.find(n => n.name === 'Farbanje i lakiranje')!;
        expect(merged.id).toBe('n3');
        expect(res.nodeIdRemap).toEqual({ n2: 'n3' });
        expect(merged.position).toEqual({ x: 1, y: 2 });               // pozicija se čuva od ranijeg
    });

    test('bez promjena → changed=false, ništa se ne dira', () => {
        const res = renameGraphNodes({ nodes: [{ id: 'x', name: 'Kantiranje', itemIds: [] }], edges: [] }, map);
        expect(res.changed).toBe(false);
        expect(res.mergedCount).toBe(0);
    });
});

describe('computeGroupImpact', () => {
    test('zbraja upotrebu članova grupe', () => {
        const usage = collectProcessUsage({
            catalog: [{ Name: 'Farbanje', Order: 1 }],
            rules: [{ Processes: ['Farbanje'] }],
            stageTemplates: [], flowTemplates: [],
            products: [{ Process_Plan: ['Lakiranje'] }, { Process_Plan: ['Farbanje'] }],
            workOrders: [{ items: [{ Processes: [{ Process_Name: 'Lakiranje' }] }] }],
        });
        const [impact] = computeGroupImpact(
            [{ canonical: 'Farbanje i lakiranje', members: ['Farbanje', 'Lakiranje'] }], usage);
        expect(impact.products).toBe(2);
        expect(impact.orderItems).toBe(1);
        expect(impact.rules).toBe(1);
    });
});
