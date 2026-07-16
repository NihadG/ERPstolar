import {
    orderByCatalog,
    suggestProcessesFromMaterials,
    synthesizeOrderGraph,
    nodeMatchesProcess,
    currentProcessName,
    resolveAutoProcessNode,
    planToStages,
    flattenStages,
    groupProcessesByStage,
    currentStageIndex,
    nextProcessNames,
    deriveItemStatus,
    computeProcessGating,
    mergeSynthesizedGraph,
    appendStagesTemplate,
    mergeFlowTemplateIntoGraph,
} from '../productProcesses';

const catalog = [
    { Name: 'Krojenje iverala', Order: 1 },
    { Name: 'Kantiranje', Order: 2 },
    { Name: 'Bušenje', Order: 3 },
    { Name: 'Farbanje', Order: 4 },
    { Name: 'Sklapanje', Order: 5 },
    { Name: 'Ugradnja stakla', Order: 6 },
];

describe('computeProcessGating — per-čvor gating iz veza grafa (P4 iz PDF-a)', () => {
    // krojenje → kantiranje; bušenje je nepovezano (paralelno).
    const edges = [{ source: 'krojenje', target: 'kantiranje' }];
    const ids = ['krojenje', 'kantiranje', 'busenje'];

    test('kantiranje se otvara ČIM je krojenje gotovo (ne čeka ostale prve procese)', () => {
        const g = computeProcessGating(ids, edges, { krojenje: true, kantiranje: false, busenje: false });
        expect(g.get('kantiranje')).toBe('active');   // jedini prethodnik (krojenje) gotov
        expect(g.get('krojenje')).toBe('done');
        expect(g.get('busenje')).toBe('active');       // bez prethodnika → odmah dostupno
    });

    test('dok krojenje NIJE gotovo, kantiranje je blokirano', () => {
        const g = computeProcessGating(ids, edges, { krojenje: false });
        expect(g.get('kantiranje')).toBe('blocked');
        expect(g.get('krojenje')).toBe('active');
    });

    test('više prethodnika: čeka SVE (AND semantika)', () => {
        const g = computeProcessGating(
            ['a', 'b', 'sklapanje'],
            [{ source: 'a', target: 'sklapanje' }, { source: 'b', target: 'sklapanje' }],
            { a: true, b: false },
        );
        expect(g.get('sklapanje')).toBe('blocked');    // b još nije gotov
        const g2 = computeProcessGating(
            ['a', 'b', 'sklapanje'],
            [{ source: 'a', target: 'sklapanje' }, { source: 'b', target: 'sklapanje' }],
            { a: true, b: true },
        );
        expect(g2.get('sklapanje')).toBe('active');
    });

    test('prihvata i Map i Record kao izvor doneByNodeId', () => {
        const asMap = new Map<string, boolean>([['krojenje', true]]);
        expect(computeProcessGating(ids, edges, asMap).get('kantiranje')).toBe('active');
    });
});

describe('mergeSynthesizedGraph — sinhronizacija bez brisanja ručnog rada', () => {
    // prev: ručni graf (ručna ivica kantiranje→bušenje, pozicija na krojenju)
    const prev = {
        nodes: [
            { id: 'PREV-kroj', name: 'Krojenje iverala', itemIds: ['i1'], aliases: ['Krojenje iverala'], position: { x: 100, y: 200 } },
            { id: 'PREV-kant', name: 'Kantiranje', itemIds: ['i1'], position: { x: 300, y: 200 } },
            { id: 'PREV-rucni', name: 'Ručni pregled', itemIds: [], position: { x: 500, y: 200 } },  // van planova
        ],
        edges: [{ id: 'e-manual', source: 'PREV-kant', target: 'PREV-rucni' }],  // ručna ivica
    };
    // synth iz faza: krojenje → kantiranje (+ novi čvor Farbanje)
    const synth = synthesizeOrderGraph([
        { itemId: 'i1', stages: [['Krojenje iverala'], ['Kantiranje'], ['Farbanje']] },
        { itemId: 'i2', stages: [['Krojenje iverala']] },
    ], undefined, { includeEdges: true }).graph;

    const r = mergeSynthesizedGraph(prev, synth);
    const byName = (n: string) => r.graph.nodes.find(x => x.name.toLowerCase() === n.toLowerCase())!;

    test('čuva ID i poziciju postojećih istoimenih čvorova (WorkLog.Process_Node_ID ne puca)', () => {
        expect(byName('Krojenje iverala').id).toBe('PREV-kroj');
        expect(byName('Krojenje iverala').position).toEqual({ x: 100, y: 200 });
        expect(byName('Kantiranje').id).toBe('PREV-kant');
    });
    test('osvježava itemIds iz sinteze (i2 dodan na krojenje)', () => {
        expect(byName('Krojenje iverala').itemIds.sort()).toEqual(['i1', 'i2']);
    });
    test('ručna ivica se ČUVA', () => {
        expect(r.graph.edges.some(e => e.source === 'PREV-kant' && e.target === 'PREV-rucni')).toBe(true);
    });
    test('synth ivica se dodaje remapovana na preživjele ID-eve (krojenje→kantiranje)', () => {
        expect(r.graph.edges.some(e => e.source === 'PREV-kroj' && e.target === 'PREV-kant')).toBe(true);
    });
    test('novi čvor iz sinteze se dodaje i prijavljuje', () => {
        expect(byName('Farbanje')).toBeTruthy();
        expect(r.addedNodeNames).toContain('Farbanje');
    });
    test('čvor van planova (ručni) se zadržava i prijavljuje kao stale', () => {
        expect(byName('Ručni pregled')).toBeTruthy();
        expect(r.staleNodeNames).toContain('Ručni pregled');
    });
    test('nema dupliranih ivica', () => {
        const keys = r.graph.edges.map(e => `${e.source}→${e.target}`);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('appendStagesTemplate — slaganje više šablona u plan', () => {
    test('dodaje faze na kraj; procesi koji već postoje se preskaču; prazne faze ispadaju', () => {
        const current = [['Krojenje iverala'], ['Kantiranje']];
        const tpl = [['Kantiranje', 'Bušenje'], [], ['Farbanje']];   // Kantiranje već postoji
        expect(appendStagesTemplate(current, tpl)).toEqual([
            ['Krojenje iverala'], ['Kantiranje'], ['Bušenje'], ['Farbanje'],
        ]);
    });
    test('prazan trenutni plan → čisti template', () => {
        expect(appendStagesTemplate([], [['A'], ['B']])).toEqual([['A'], ['B']]);
    });
});

describe('mergeFlowTemplateIntoGraph — aditivni import flow šablona u graf', () => {
    const graph = {
        nodes: [{ id: 'G1', name: 'Krojenje iverala', itemIds: ['i1'], position: { x: 0, y: 0 } }],
        edges: [] as { id: string; source: string; target: string }[],
    };
    const template = {
        nodes: [
            { id: 'T1', name: 'Krojenje iverala', position: { x: 10, y: 10 } },  // već postoji
            { id: 'T2', name: 'Lakiranje', position: { x: 200, y: 10 } },        // novi
        ],
        edges: [{ id: 'te', source: 'T1', target: 'T2' }],
    };
    const r = mergeFlowTemplateIntoGraph(graph, template);
    test('čvor šablona s postojećim imenom se NE duplira (koristi postojeći ID kao endpoint)', () => {
        expect(r.graph.nodes.filter(n => n.name.toLowerCase() === 'krojenje iverala').length).toBe(1);
        // ivica T1→T2 remapovana na postojeći G1 → novi Lakiranje
        const lak = r.graph.nodes.find(n => n.name === 'Lakiranje')!;
        expect(r.graph.edges.some(e => e.source === 'G1' && e.target === lak.id)).toBe(true);
    });
    test('novi čvor je offsetovan ispod postojećeg sadržaja i prijavljen', () => {
        const lak = r.graph.nodes.find(n => n.name === 'Lakiranje')!;
        expect(lak.position!.y).toBeGreaterThan(0);
        expect(r.addedNodeNames).toEqual(['Lakiranje']);
    });
});

describe('orderByCatalog — kanonski redoslijed iz kataloga', () => {
    test('sortira po Order; nepoznati na kraj, stabilno', () => {
        expect(orderByCatalog(['Sklapanje', 'Krojenje iverala', 'Xyz', 'Kantiranje'], catalog))
            .toEqual(['Krojenje iverala', 'Kantiranje', 'Sklapanje', 'Xyz']);
    });
    test('case-insensitive poklapanje naziva', () => {
        expect(orderByCatalog(['sklapanje', 'KANTIRANJE'], catalog)).toEqual(['KANTIRANJE', 'sklapanje']);
    });
});

describe('suggestProcessesFromMaterials — korisnikova pravila', () => {
    const rules = [
        { Match_Kind: 'category' as const, Match_Value: 'Ploče i trake', Processes: ['Krojenje iverala', 'Kantiranje', 'Sklapanje'] },
        { Match_Kind: 'category' as const, Match_Value: 'Staklo', Processes: ['Ugradnja stakla'] },
        { Match_Kind: 'name_contains' as const, Match_Value: 'lak', Processes: ['Farbanje'] },
    ];
    test('unija pogođenih pravila, redoslijed iz kataloga', () => {
        const materials = [
            { Material_Name: 'Iveral bijeli', Category: 'Ploče i trake' },
            { Material_Name: 'Staklo 6mm', Category: 'Staklo' },
            { Material_Name: 'Lak mat', Category: 'Ostalo' },
        ];
        expect(suggestProcessesFromMaterials(materials, rules, catalog))
            .toEqual(['Krojenje iverala', 'Kantiranje', 'Farbanje', 'Sklapanje', 'Ugradnja stakla']);
    });
    test('name_contains je case-insensitive podstring', () => {
        const materials = [{ Material_Name: 'POLIURETANSKI LAK sjaj', Category: 'Ostalo' }];
        expect(suggestProcessesFromMaterials(materials, rules, catalog)).toEqual(['Farbanje']);
    });
    test('bez pogodaka / bez materijala → []', () => {
        expect(suggestProcessesFromMaterials([{ Material_Name: 'Vijak', Category: 'Okovi' }], rules, catalog)).toEqual([]);
        expect(suggestProcessesFromMaterials([], rules, catalog)).toEqual([]);
    });
    test('duplikat procesa iz više pravila se ne ponavlja', () => {
        const r2 = [...rules, { Match_Kind: 'name_contains' as const, Match_Value: 'iveral', Processes: ['Kantiranje'] }];
        const materials = [{ Material_Name: 'Iveral hrast', Category: 'Ploče i trake' }];
        expect(suggestProcessesFromMaterials(materials, r2, catalog)).toEqual(['Krojenje iverala', 'Kantiranje', 'Sklapanje']);
    });
});

// helper: sekvencijalni plan → faze (svaki proces svoja faza)
const seq = (plan: string[]) => plan.map(p => [p]);

describe('planToStages / flattenStages — faze i fallback', () => {
    test('Process_Stages ima prednost; prazne faze/nazivi se čiste', () => {
        expect(planToStages([{ processes: ['A', ' '] }, { processes: [] }, { processes: ['B', 'C'] }], ['X']))
            .toEqual([['A'], ['B', 'C']]);
    });
    test('fallback ravni plan → svaki proces svoja faza (sekvencijalno)', () => {
        expect(planToStages(undefined, ['A', 'B'])).toEqual([['A'], ['B']]);
        expect(planToStages([], null)).toEqual([]);
    });
    test('flattenStages čuva redoslijed faza i dedupira', () => {
        expect(flattenStages([['Noge', 'Furnir'], ['Sklapanje'], ['sklapanje', 'Lak']]))
            .toEqual(['Noge', 'Furnir', 'Sklapanje', 'Lak']);
    });
});

describe('synthesizeOrderGraph — spajanje FAZNIH planova u graf naloga', () => {
    test('PRIMJER STOLA: noge ∥ (furnir, MDF) → sklapanje → lakiranje', () => {
        const { graph, warnings } = synthesizeOrderGraph([{
            itemId: 'sto',
            stages: [
                ['Izrada nogu', 'Krojenje furnira', 'Formatiranje MDF'],  // paralelno
                ['Sklapanje'],
                ['Lakiranje'],
            ],
        }]);
        expect(warnings).toEqual([]);
        expect(graph.nodes).toHaveLength(5);
        const edgePairs = graph.edges.map(e => {
            const s = graph.nodes.find(n => n.id === e.source)!.name;
            const t = graph.nodes.find(n => n.id === e.target)!.name;
            return `${s}→${t}`;
        }).sort();
        expect(edgePairs).toEqual([
            'Formatiranje MDF→Sklapanje',
            'Izrada nogu→Sklapanje',
            'Krojenje furnira→Sklapanje',
            'Sklapanje→Lakiranje',
        ]);
        // paralelni procesi NEMAJU međusobne veze
        expect(edgePairs.some(p => p.startsWith('Izrada nogu→Krojenje') || p.startsWith('Krojenje furnira→Izrada'))).toBe(false);
    });
    test('isti proces više proizvoda = JEDAN čvor; grananje i spajanje kroz ivice', () => {
        const { graph, warnings } = synthesizeOrderGraph([
            { itemId: 'A', stages: seq(['Krojenje', 'Kantiranje', 'Sklapanje']) },
            { itemId: 'B', stages: seq(['Krojenje', 'Farbanje', 'Sklapanje']) },
        ]);
        expect(warnings).toEqual([]);
        expect(graph.nodes).toHaveLength(4); // Krojenje, Kantiranje, Farbanje, Sklapanje
        const byName = (n: string) => graph.nodes.find(x => x.name === n)!;
        expect(byName('Krojenje').itemIds.sort()).toEqual(['A', 'B']);
        expect(byName('Kantiranje').itemIds).toEqual(['A']);
        expect(byName('Farbanje').itemIds).toEqual(['B']);
        expect(byName('Sklapanje').itemIds.sort()).toEqual(['A', 'B']);
        const edgePairs = graph.edges.map(e => {
            const s = graph.nodes.find(n => n.id === e.source)!.name;
            const t = graph.nodes.find(n => n.id === e.target)!.name;
            return `${s}→${t}`;
        }).sort();
        expect(edgePairs).toEqual([
            'Farbanje→Sklapanje',
            'Kantiranje→Sklapanje',
            'Krojenje→Farbanje',
            'Krojenje→Kantiranje',
        ]);
    });
    test('normalizacija naziva: " krojenje " i "Krojenje" su isti čvor', () => {
        const { graph } = synthesizeOrderGraph([
            { itemId: 'A', stages: seq([' krojenje ', 'Sklapanje']) },
            { itemId: 'B', stages: seq(['Krojenje', 'Sklapanje']) },
        ]);
        expect(graph.nodes).toHaveLength(2);
    });
    test('kružni redoslijed među proizvodima → ivica ispuštena + upozorenje', () => {
        const { graph, warnings } = synthesizeOrderGraph([
            { itemId: 'A', stages: seq(['X', 'Y']) },
            { itemId: 'B', stages: seq(['Y', 'X']) },
        ]);
        expect(graph.edges).toHaveLength(1); // samo X→Y (Y→X bi zatvorila ciklus)
        expect(warnings).toHaveLength(1);
    });
    test('isti proces u susjednim fazama se ne veže sam na sebe', () => {
        const { graph } = synthesizeOrderGraph([{ itemId: 'A', stages: seq(['X', 'X', 'Y']) }]);
        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);
    });
    test('prazni planovi → prazan graf', () => {
        const { graph } = synthesizeOrderGraph([{ itemId: 'A', stages: [] }]);
        expect(graph.nodes).toEqual([]);
        expect(graph.edges).toEqual([]);
    });
    test('bez konsolidacije: svaki čvor dobija aliases = [name]', () => {
        const { graph } = synthesizeOrderGraph([{ itemId: 'A', stages: seq(['Krojenje', 'Sklapanje']) }]);
        expect(graph.nodes.find(n => n.name === 'Krojenje')!.aliases).toEqual(['Krojenje']);
    });
    test('includeEdges:false → čvorovi bez veza, kolone po fazama', () => {
        const { graph, columns } = synthesizeOrderGraph([{
            itemId: 'sto',
            stages: [['Izrada nogu', 'Krojenje furnira'], ['Sklapanje'], ['Lakiranje']],
        }], undefined, { includeEdges: false });
        expect(graph.edges).toEqual([]);
        expect(graph.nodes).toHaveLength(4);
        // kolona 0 = 2 paralelna, kolona 1 = Sklapanje, kolona 2 = Lakiranje
        const nameById = (id: string) => graph.nodes.find(n => n.id === id)!.name;
        expect(columns).toHaveLength(3);
        expect(columns[0].map(nameById).sort()).toEqual(['Izrada nogu', 'Krojenje furnira']);
        expect(columns[1].map(nameById)).toEqual(['Sklapanje']);
        expect(columns[2].map(nameById)).toEqual(['Lakiranje']);
    });
    test('čvor u više faza (različiti proizvodi) → svrstan u NAJRANIJU fazu', () => {
        const { columns, graph } = synthesizeOrderGraph([
            { itemId: 'A', stages: [['Krojenje'], ['Sklapanje']] },       // Sklapanje = faza 1
            { itemId: 'B', stages: [['Sklapanje'], ['Lak']] },            // Sklapanje = faza 0
        ], undefined, { includeEdges: false });
        const nameById = (id: string) => graph.nodes.find(n => n.id === id)!.name;
        // Sklapanje ima min fazu 0 → kolona 0 (uz Krojenje)
        expect(columns[0].map(nameById).sort()).toEqual(['Krojenje', 'Sklapanje']);
    });
});

describe('nodeMatchesProcess — poklapanje po sinonimima', () => {
    test('poklapa po name kad nema aliasa (case/space-insensitive)', () => {
        expect(nodeMatchesProcess({ name: 'Lakiranje' }, ' lakiranje ')).toBe(true);
        expect(nodeMatchesProcess({ name: 'Lakiranje' }, 'Sklapanje')).toBe(false);
    });
    test('poklapa bilo koji alias', () => {
        const node = { name: 'Lijepljenje', aliases: ['Lijepljenje', 'lijepljenje furnira', 'Lijepljenje i obrada'] };
        expect(nodeMatchesProcess(node, 'Lijepljenje furnira')).toBe(true);
        expect(nodeMatchesProcess(node, 'Lijepljenje i obrada')).toBe(true);
        expect(nodeMatchesProcess(node, 'Bušenje')).toBe(false);
    });
    test('prazan naziv → false', () => {
        expect(nodeMatchesProcess({ name: 'X' }, '')).toBe(false);
    });
});

describe('synthesizeOrderGraph — konsolidacija (spajanje različitih naziva)', () => {
    test('dva različita naziva u jednoj grupi → JEDAN čvor s aliasima i unijom stavki', () => {
        const consolidation = { groups: [{ canonical: 'Lijepljenje', members: ['Lijepljenje furnira', 'Lijepljenje i obrada'] }] };
        const { graph } = synthesizeOrderGraph([
            { itemId: 'A', stages: seq(['Krojenje', 'Lijepljenje furnira']) },
            { itemId: 'B', stages: seq(['Krojenje', 'Lijepljenje i obrada']) },
        ], consolidation);
        // Krojenje + jedan spojeni Lijepljenje = 2 čvora
        expect(graph.nodes).toHaveLength(2);
        const lijep = graph.nodes.find(n => n.name === 'Lijepljenje')!;
        expect(lijep).toBeTruthy();
        expect(lijep.itemIds.sort()).toEqual(['A', 'B']);
        expect(lijep.aliases!.map(a => a.toLowerCase()).sort()).toEqual(['lijepljenje furnira', 'lijepljenje i obrada']);
    });
    test('konsolidovani čvor poklapa oba originalna procesa preko nodeMatchesProcess', () => {
        const consolidation = { groups: [{ canonical: 'Lijepljenje', members: ['Lijepljenje furnira', 'Lijepljenje i obrada'] }] };
        const { graph } = synthesizeOrderGraph([
            { itemId: 'A', stages: seq(['Lijepljenje furnira']) },
            { itemId: 'B', stages: seq(['Lijepljenje i obrada']) },
        ], consolidation);
        const node = graph.nodes.find(n => n.name === 'Lijepljenje')!;
        // auto-pripis dnevnice po TEKUĆEM (originalnom) nazivu stavke i dalje nalazi zajednički čvor
        expect(resolveAutoProcessNode(graph, 'A', [{ Process_Name: 'Lijepljenje furnira', Status: 'U toku' }])?.id).toBe(node.id);
        expect(resolveAutoProcessNode(graph, 'B', [{ Process_Name: 'Lijepljenje i obrada', Status: 'U toku' }])?.id).toBe(node.id);
    });
});

describe('currentProcessName + resolveAutoProcessNode — auto-pripis', () => {
    const procs = [
        { Process_Name: 'Krojenje', Status: 'Završeno' },
        { Process_Name: 'Kantiranje', Status: 'U toku' },
        { Process_Name: 'Sklapanje', Status: 'Na čekanju' },
    ];
    test('tekući = prvi nezavršen; sve završeno → null', () => {
        expect(currentProcessName(procs)).toBe('Kantiranje');
        expect(currentProcessName(procs.map(p => ({ ...p, Status: 'Završeno' })))).toBeNull();
        expect(currentProcessName([])).toBeNull();
    });
    test('resolver nađe čvor koji pokriva stavku s nazivom tekućeg procesa', () => {
        const { graph } = synthesizeOrderGraph([
            { itemId: 'A', stages: seq(['Krojenje', 'Kantiranje', 'Sklapanje']) },
            { itemId: 'B', stages: seq(['Krojenje', 'Sklapanje']) },
        ]);
        const node = resolveAutoProcessNode(graph, 'A', procs);
        expect(node?.name).toBe('Kantiranje');
        // B nema Kantiranje u planu → njegov tekući (Sklapanje po njegovoj checklisti) se traži po NJEGOVOJ listi
        const nodeB = resolveAutoProcessNode(graph, 'B', [
            { Process_Name: 'Krojenje', Status: 'Završeno' },
            { Process_Name: 'Sklapanje', Status: 'Na čekanju' },
        ]);
        expect(nodeB?.name).toBe('Sklapanje');
    });
    test('čvor s praznim itemIds pokriva sve stavke', () => {
        const graph = { nodes: [{ id: 'n1', name: 'Rad', itemIds: [] }], edges: [] };
        expect(resolveAutoProcessNode(graph, 'bilo-koja', [{ Process_Name: 'Rad', Status: 'U toku' }])?.id).toBe('n1');
    });
    test('bez grafa / bez tekućeg / čvor ne pokriva stavku → null', () => {
        expect(resolveAutoProcessNode(undefined, 'A', procs)).toBeNull();
        const graph = { nodes: [{ id: 'n1', name: 'Kantiranje', itemIds: ['X'] }], edges: [] };
        expect(resolveAutoProcessNode(graph, 'A', procs)).toBeNull();
    });
});

describe('groupProcessesByStage / currentStageIndex / nextProcessNames — fazno praćenje (primjer STOLA)', () => {
    // stol: faza 1 (3 paralelno) → sklapanje → lak
    const stages = [
        ['Izrada nogu', 'Krojenje furnira', 'Formatiranje MDF'],
        ['Sklapanje'],
        ['Lakiranje'],
    ];
    const mk = (name: string, status = 'Na čekanju') => ({ Process_Name: name, Status: status });

    test('grupisanje procesa u faze; procesi van plana → extra', () => {
        const procs = [
            mk('Izrada nogu'), mk('Krojenje furnira'), mk('Formatiranje MDF'),
            mk('Sklapanje'), mk('Lakiranje'), mk('Brušenje'), // Brušenje nije u planu → extra
        ];
        const { stageGroups, extra } = groupProcessesByStage(procs, stages);
        expect(stageGroups.map(g => g.map(p => p.Process_Name))).toEqual([
            ['Izrada nogu', 'Krojenje furnira', 'Formatiranje MDF'],
            ['Sklapanje'],
            ['Lakiranje'],
        ]);
        expect(extra.map(p => p.Process_Name)).toEqual(['Brušenje']);
    });

    test('tekuća faza ostaje 1 dok sva 3 paralelna nisu gotova; onda prelazi na Sklapanje', () => {
        const partial = [
            mk('Izrada nogu', 'Završeno'), mk('Krojenje furnira', 'Završeno'), mk('Formatiranje MDF', 'U toku'),
            mk('Sklapanje'), mk('Lakiranje'),
        ];
        let g = groupProcessesByStage(partial, stages).stageGroups;
        expect(currentStageIndex(g)).toBe(0); // MDF još nije gotov
        expect(nextProcessNames(g)).toEqual(['Formatiranje MDF']);

        const phase1done = partial.map(p => stages[0].includes(p.Process_Name) ? mk(p.Process_Name, 'Završeno') : p);
        g = groupProcessesByStage(phase1done, stages).stageGroups;
        expect(currentStageIndex(g)).toBe(1); // sad Sklapanje
        expect(nextProcessNames(g)).toEqual(['Sklapanje']);
    });

    test('sve gotovo → currentStageIndex −1, nextProcessNames prazno', () => {
        const allDone = stages.flat().map(n => mk(n, 'Završeno'));
        const g = groupProcessesByStage(allDone, stages).stageGroups;
        expect(currentStageIndex(g)).toBe(-1);
        expect(nextProcessNames(g)).toEqual([]);
    });

    test('extra kao završna pseudo-faza: kad su stages gotove ali extra nije, tekuće je extra', () => {
        const allStagesDone = [...stages.flat().map(n => mk(n, 'Završeno')), mk('Brušenje', 'U toku')];
        const { stageGroups, extra } = groupProcessesByStage(allStagesDone, stages);
        const groups = extra.length ? [...stageGroups, extra] : stageGroups;
        expect(currentStageIndex(groups)).toBe(3); // extra grupa
        expect(nextProcessNames(groups)).toEqual(['Brušenje']);
    });

    test('bez plana (prazne stages) → planToStages fallback: svaki proces svoja faza', () => {
        const names = ['A', 'B', 'C'];
        const derived = planToStages(undefined, names); // [['A'],['B'],['C']]
        const procs = names.map(n => mk(n));
        const { stageGroups, extra } = groupProcessesByStage(procs, derived);
        expect(stageGroups).toHaveLength(3);
        expect(extra).toEqual([]);
        expect(currentStageIndex(stageGroups)).toBe(0);
    });
});

describe('deriveItemStatus — pod "U toku" za pokrenute stavke (K1 fix)', () => {
    const P = (s: string) => ({ Status: s });
    test('svi završeni → Završeno (bez obzira na startedAt)', () => {
        expect(deriveItemStatus([P('Završeno'), P('Završeno')], '2026-07-01')).toBe('Završeno');
        expect(deriveItemStatus([P('Završeno')], undefined)).toBe('Završeno');
    });
    test('bilo koji U toku → U toku', () => {
        expect(deriveItemStatus([P('Na čekanju'), P('U toku')], undefined)).toBe('U toku');
    });
    test('KLJUČNO: pokrenuta stavka (startedAt) sa svim procesima Na čekanju → OSTAJE U toku (ne regresira)', () => {
        expect(deriveItemStatus([P('Na čekanju'), P('Na čekanju')], '2026-07-01T08:00:00Z')).toBe('U toku');
    });
    test('nepokrenuta stavka, svi Na čekanju → Na čekanju', () => {
        expect(deriveItemStatus([P('Na čekanju')], undefined)).toBe('Na čekanju');
        expect(deriveItemStatus([P('Na čekanju')], null)).toBe('Na čekanju');
    });
    test('prazna lista procesa → NIJE Završeno (Na čekanju bez starta, U toku sa startom)', () => {
        expect(deriveItemStatus([], undefined)).toBe('Na čekanju');
        expect(deriveItemStatus([], '2026-07-01')).toBe('U toku');
    });
    test('Odloženo se tretira kao nezavršeno', () => {
        expect(deriveItemStatus([P('Završeno'), P('Odloženo')], undefined)).toBe('Na čekanju');
        expect(deriveItemStatus([P('Završeno'), P('Odloženo')], '2026-07-01')).toBe('U toku');
    });
});
