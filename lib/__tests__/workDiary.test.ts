import { splitDnevnicaByOrder, splitWorkerDay } from '../laborSplit';
import {
    applyPlanToItem, completeUpstream, coverage, ensureGraphNode, graphFromStages, itemHasPlan, markItemProcess,
    matchProcess, matchTarget, planProcessNames, planWorkerDay, type DiaryTarget,
} from '../workDiary';
import { buildGraphFromRules } from '../productProcesses';

describe('splitWorkerDay — podjela dana s izričitim udjelom', () => {
    it('bez težina je identično dvonivovskoj podjeli', () => {
        const logs = [{ Work_Order_ID: 'a' }, { Work_Order_ID: 'b' }, { Work_Order_ID: 'b' }];
        const shares = splitWorkerDay(100.01, 1, logs);
        const { amounts, dayFractions } = splitDnevnicaByOrder(100.01, 1, [1, 2]);
        expect(shares.map(s => s.amount)).toEqual([amounts[0][0], amounts[1][0], amounts[1][1]]);
        expect(shares.map(s => s.dayFraction)).toEqual([dayFractions[0][0], dayFractions[1][0], dayFractions[1][1]]);
        expect(shares.map(s => s.splitFactor)).toEqual([2, 4, 4]);
    });

    it('pola dana na jednom poslu, ostatak na dva druga naloga: 0.5 / 0.25 / 0.25', () => {
        const shares = splitWorkerDay(100, 1, [{ Work_Order_ID: 'a', Day_Weight: 0.5 }, { Work_Order_ID: 'b' }, { Work_Order_ID: 'c' }]);
        expect(shares.map(s => s.amount)).toEqual([50, 25, 25]);
        expect(shares.map(s => s.dayFraction)).toEqual([0.5, 0.25, 0.25]);
    });

    it('težine uz pola dana prisutnosti i tačan zbir centi', () => {
        const shares = splitWorkerDay(85, 0.5, [{ Day_Weight: 2 / 3 }, { Day_Weight: 1 / 3 }]);
        expect(shares.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(42.5, 6);
        expect(shares.map(s => s.dayFraction)).toEqual([0.333333, 0.166667]);
    });

    it('kasnije dodan zapis bez težine uz pun dan s težinama dobije 1/N', () => {
        const shares = splitWorkerDay(90, 1, [{ Day_Weight: 0.5 }, { Day_Weight: 0.5 }, {}]);
        expect(shares.map(s => s.amount)).toEqual([30, 30, 30]);
        expect(shares.reduce((s, x) => s + x.dayFraction, 0)).toBeCloseTo(1, 5);
    });
});

const T = (wo: string, woName: string, item: string, product: string, project = 'Jerko Čorluka - Kuća', finished = false): DiaryTarget =>
    ({ workOrderId: wo, workOrderName: woName, itemId: item, productId: `p-${item}`, productName: product, projectName: project, finished });
const targets = [
    T('r7', 'Corluka - Kuhinja', 'k1', 'Donji elementi'),
    T('r7', 'Corluka - Kuhinja', 'k2', 'Gornji elementi'),
    T('r5', 'Corluka - Gardaroberi u djecijoj sobi', 'g1', 'Gardarober'),
    T('r3', 'Meliha A501 - Vrata', 'm1', 'Vrata sobna', 'Melihin stan'),
    T('z21', 'Montaža vrata E5', 'e1', 'Montaža vrata E5', ''),
];

describe('matchTarget — koji nalog/proizvod', () => {
    it('„kuhinja Čorluka" → cijeli nalog (sve stavke)', () => {
        const m = matchTarget('kuhinja Čorluka', targets);
        expect(m).toMatchObject({ kind: 'ok', workOrderId: 'r7' });
        expect(m.kind === 'ok' && m.items.map(i => i.itemId)).toEqual(['k1', 'k2']);
    });

    it('jasno imenovan proizvod unutar naloga → samo ta stavka', () => {
        const m = matchTarget('gornji elementi kuhinja', targets);
        expect(m.kind === 'ok' && m.items.map(i => i.itemId)).toEqual(['k2']);
    });

    it('„Čorluka" sama → dva naloga, pitanje', () => {
        const m = matchTarget('Čorluka', targets);
        expect(m.kind).toBe('ambiguous');
        expect(m.kind === 'ambiguous' && m.candidates.map(c => c.workOrderId).sort()).toEqual(['r5', 'r7']);
    });

    it('padeži i dijakritika: „vratima kod Melihe"', () => {
        expect(matchTarget('vrata Meliha', targets)).toMatchObject({ kind: 'ok', workOrderId: 'r3' });
    });

    it('nepoznat posao → none', () => {
        expect(matchTarget('hotel Kladanj', targets).kind).toBe('none');
    });

    it('otvoren nalog ima prednost pred završenim istog imena', () => {
        const list = [T('old', 'Corluka - Kuhinja', 'o1', 'Kuhinja', 'Jerko Čorluka - Kuća', true), ...targets];
        expect(matchTarget('kuhinja Čorluka', list)).toMatchObject({ kind: 'ok', workOrderId: 'r7' });
    });
});

describe('matchProcess — proces iz kataloga', () => {
    const vocab = ['Krojenje Iverala', 'Krojenje MDF-a', 'Kantiranje', 'Sklapanje kutija', 'Farbanje i lakiranje', 'Postavljanje leđa'];
    it.each([
        ['krojili iveral', 'Krojenje Iverala'],
        ['krojenje mdf', 'Krojenje MDF-a'],
        ['kantirao', 'Kantiranje'],
        ['sklapali kutije', 'Sklapanje kutija'],
        ['postavljali leđa', 'Postavljanje leđa'],
        ['KANTIRANJE', 'Kantiranje'],
    ])('„%s" → %s', (said, expected) => {
        expect(matchProcess(said, vocab)).toBe(expected);
    });

    it('nepoznat proces → null (bot pita)', () => {
        expect(matchProcess('frezanje utora', vocab)).toBeNull();
        expect(matchProcess('montaža', vocab)).toBeNull();
    });

    it('coverage toleriše padeže', () => {
        expect(coverage('kuhinji Čorluke', 'Corluka - Kuhinja')).toBe(1);
    });
});

describe('matchProcess — dva kantiranja i proces iz plana stavke', () => {
    const vocab = ['Krojenje iverala', 'Kantiranje iverala', 'Kantiranje furnira', 'Brušenje', 'Brušenje Kerrocka', 'Furniranje', 'Priprema furnira'];

    it('„kantiranje" bez plana = kantiranje iverala (stari naziv); „kantiranje fronti" = furnira', () => {
        expect(matchProcess('kantirao', vocab)).toBe('Kantiranje iverala');
        expect(matchProcess('kantiranje', vocab)).toBe('Kantiranje iverala');
        expect(matchProcess('kantiranje fronti', vocab)).toBe('Kantiranje furnira');
        expect(matchProcess('kantirao furnir', vocab)).toBe('Kantiranje furnira');
    });

    it('proizvod koji ima samo furnir: „kantiranje" je kantiranje furnira', () => {
        expect(matchProcess('kantiranje', vocab, ['Kantiranje furnira', 'Brušenje'])).toBe('Kantiranje furnira');
        expect(matchProcess('kantirao', vocab, ['Furniranje', 'Kantiranje furnira'])).toBe('Kantiranje furnira');
    });

    it('oba kantiranja u planu: iverala je „kantiranje", furnira kad se kaže', () => {
        const plan = ['Kantiranje iverala', 'Kantiranje furnira'];
        expect(matchProcess('kantiranje', vocab, plan)).toBe('Kantiranje iverala');
        expect(matchProcess('kantirali fronte', vocab, plan)).toBe('Kantiranje furnira');
    });

    it('Kerrock proizvod: „brusio" je brušenje Kerrocka; tačan naziv uvijek pobjeđuje', () => {
        expect(matchProcess('brusio', vocab, ['Krojenje Kerrocka', 'Brušenje Kerrocka'])).toBe('Brušenje Kerrocka');
        expect(matchProcess('brušenje', vocab, ['Brušenje Kerrocka'])).toBe('Brušenje');
        expect(matchProcess('furniranje', vocab, ['Priprema furnira'])).toBe('Furniranje');
    });

    it('planProcessNames: nezavršeni prvo, redom toka, bez „Rad"', () => {
        const graph = {
            nodes: [{ id: 'a', name: 'Krojenje iverala', itemIds: ['x'] }, { id: 'b', name: 'Kantiranje iverala', itemIds: ['x'] }, { id: 'c', name: 'Rad', itemIds: [] }, { id: 'd', name: 'Lakiranje', itemIds: ['y'] }],
            edges: [{ id: 'e', source: 'a', target: 'b' }],
        };
        expect(planProcessNames(graph, [{ ID: 'x', Processes: [{ Process_Name: 'Krojenje iverala', Status: 'Završeno' }] }]))
            .toEqual(['Kantiranje iverala', 'Krojenje iverala']);
    });
});

describe('planWorkerDay — udio dana', () => {
    it('ništa rečeno → ravnomjerno, bez težina', () => {
        expect(planWorkerDay([undefined, undefined])).toEqual({ presence: 1, weights: [undefined, undefined] });
    });
    it('„pola dana" kao jedini posao → prisutnost 0.5', () => {
        expect(planWorkerDay([0.5])).toEqual({ presence: 0.5, weights: [1] });
    });
    it('pola + pola → pun dan 0.5/0.5', () => {
        expect(planWorkerDay([0.5, 0.5])).toEqual({ presence: 1, weights: [0.5, 0.5] });
    });
    it('pola na jednom, ostatak na dva neimenovana → 0.5/0.25/0.25', () => {
        expect(planWorkerDay([0.5, undefined, undefined])).toEqual({ presence: 1, weights: [0.5, 0.25, 0.25] });
    });
    it('rečeno više od dana → srazmjerno', () => {
        const p = planWorkerDay([1, 1]);
        expect(p).toEqual({ presence: 1, weights: [0.5, 0.5] });
    });
});

describe('graf naloga i čekiranje', () => {
    let n = 0;
    const id = () => `n${++n}`;
    const graph = {
        nodes: [{ id: 'a', name: 'Krojenje Iverala', itemIds: [] }, { id: 'b', name: 'Kantiranje', itemIds: ['k1'] }],
        edges: [{ id: 'e', source: 'a', target: 'b' }],
    };

    it('postojeći čvor za stavku se koristi', () => {
        expect(ensureGraphNode(graph, 'k2', 'Krojenje Iverala', id)).toMatchObject({ nodeId: 'a', added: false });
    });

    it('čvor istog naziva za drugi proizvod se proširi na stavku', () => {
        const r = ensureGraphNode(graph, 'k2', 'Kantiranje', id);
        expect(r).toMatchObject({ nodeId: 'b', added: false });
        expect(r.graph.nodes.find(x => x.id === 'b')!.itemIds).toEqual(['k1', 'k2']);
        expect(graph.nodes[1].itemIds).toEqual(['k1']); // ulaz se ne mijenja
    });

    it('nov proces ide iza zadnjeg procesa stavke', () => {
        const r = ensureGraphNode(graph, 'k1', 'Sklapanje kutija', id);
        expect(r.added).toBe(true);
        expect(r.graph.edges.at(-1)).toMatchObject({ source: 'b', target: r.nodeId });
    });

    it('generički „Rad" nije prethodnik', () => {
        const r = ensureGraphNode({ nodes: [{ id: 'rad', name: 'Rad', itemIds: [] }], edges: [] }, 'e1', 'Montaža', id);
        expect(r.added).toBe(true);
        expect(r.graph.edges).toHaveLength(0);
    });

    it('čekiranje: na čekanju → u toku → završeno; nov proces se doda', () => {
        const w = { id: 'w1', name: 'Edin' };
        const start = markItemProcess([{ Process_Name: 'Kantiranje', Status: 'Na čekanju' }], 'kantiranje', false, w, 't1');
        expect(start).toMatchObject({ change: 'started', processes: [{ Status: 'U toku', Started_At: 't1', Worker_Name: 'Edin' }] });
        const done = markItemProcess(start.processes, 'Kantiranje', true, w, 't2');
        expect(done).toMatchObject({ change: 'completed', processes: [{ Status: 'Završeno', Completed_At: 't2', Started_At: 't1' }] });
        expect(markItemProcess(done.processes, 'Kantiranje', false, w, 't3').change).toBe('none');
        expect(markItemProcess([], 'Lakiranje', true, w, 't4')).toMatchObject({ change: 'added', processes: [{ Status: 'Završeno' }] });
    });
});

describe('plan iz pravila materijala i pretpostavljeno završeni koraci', () => {
    let n = 0;
    const id = () => `x${++n}`;
    // Furnir + MDF = jedna grana, iveral paralelno; obje se spajaju na sklapanju.
    const rules = [
        { Match_Kind: 'material_type_combo' as const, Match_Value: '', Match_Types: ['furnir', 'mdf'],
            Processes: ['Krojenje MDF-a', 'Priprema furnira', 'Furniranje', 'Srezivanje', 'Brušenje', 'Lakiranje', 'Sklapanje'] },
        { Match_Kind: 'material_type' as const, Match_Value: 'iveral', Processes: ['Krojenje Iverala', 'Kantiranje', 'Sklapanje'] },
    ];
    const materials = [{ Material_Name: 'MDF 18mm' }, { Material_Name: 'Furnir hrast' }, { Material_Name: 'Iveral bijeli 18' }];
    const plan = buildGraphFromRules(materials, rules).graph;

    it('stavka s procesima ili stvarnim čvorom ima plan; „Rad" se ne broji', () => {
        expect(itemHasPlan(undefined, { ID: 'a', Processes: [{ Process_Name: 'X', Status: 'Na čekanju' }] })).toBe(true);
        expect(itemHasPlan({ nodes: [{ id: 'r', name: 'Rad', itemIds: [] }], edges: [] }, { ID: 'a' })).toBe(false);
        expect(itemHasPlan({ nodes: [{ id: 'k', name: 'Kantiranje', itemIds: ['b'] }], edges: [] }, { ID: 'a' })).toBe(false);
        expect(itemHasPlan({ nodes: [{ id: 'k', name: 'Kantiranje', itemIds: [] }], edges: [] }, { ID: 'a' })).toBe(true);
    });

    it('faze → graf: svaki iz faze vodi u svaki iz sljedeće', () => {
        const g = graphFromStages([['A', 'B'], ['C']]);
        expect(g.nodes.map(x => x.name)).toEqual(['A', 'B', 'C']);
        expect(g.edges.map(e => `${e.source}>${e.target}`)).toEqual(['s0-0>s1-0', 's0-1>s1-0']);
    });

    it('plan se ulije u graf naloga: postojeći čvor se proširi, procesi stavke „Na čekanju" redom toka', () => {
        const wo = { nodes: [{ id: 'kant', name: 'Kantiranje', itemIds: ['drugi'] }, { id: 'rad', name: 'Rad', itemIds: [] }], edges: [] };
        const r = applyPlanToItem(wo, undefined, 'k1', plan, id);
        expect(r.graph.nodes.find(x => x.id === 'kant')!.itemIds).toEqual(['drugi', 'k1']);
        expect(r.graph.nodes.filter(x => x.name === 'Kantiranje')).toHaveLength(1);
        expect(r.processes.every(p => p.Status === 'Na čekanju')).toBe(true);
        expect(r.added.indexOf('Krojenje MDF-a')).toBeLessThan(r.added.indexOf('Brušenje'));
        expect(r.added.indexOf('Kantiranje')).toBeLessThan(r.added.indexOf('Sklapanje'));
        expect(r.added).not.toContain('Rad');
        expect(r.added).toHaveLength(9);
        expect(wo.nodes[0].itemIds).toEqual(['drugi']); // ulaz se ne mijenja
    });

    it('brušenje upisano → raniji koraci grane završeni (pretpostavka), paralelna grana i kasniji ne', () => {
        const seeded = applyPlanToItem(undefined, undefined, 'k1', plan, id);
        const brus = seeded.graph.nodes.find(x => x.name === 'Brušenje')!;
        const marked = markItemProcess(seeded.processes, 'Brušenje', false, { id: 'w', name: 'Amer' }, 't1');
        const r = completeUpstream(seeded.graph, 'k1', brus.id, marked.processes, 't1');
        expect(r.completed).toEqual(['Krojenje MDF-a', 'Priprema furnira', 'Furniranje', 'Srezivanje']);
        const status = Object.fromEntries(r.processes.map(p => [p.Process_Name, p.Status]));
        expect(status).toMatchObject({ 'Krojenje MDF-a': 'Završeno', Srezivanje: 'Završeno', Brušenje: 'U toku', Lakiranje: 'Na čekanju', 'Krojenje Iverala': 'Na čekanju', Kantiranje: 'Na čekanju' });
        expect(r.processes.find(p => p.Process_Name === 'Furniranje')).toMatchObject({ Assumed_Done: true, Completed_At: 't1' });
        expect(r.processes.find(p => p.Process_Name === 'Brušenje')!.Assumed_Done).toBeUndefined();
    });

    it('sklapanje upisano → obje grane prije njega završene; već završen korak se ne dira', () => {
        const seeded = applyPlanToItem(undefined, [{ Process_Name: 'Krojenje Iverala', Status: 'Završeno', Completed_At: 'ranije' }], 'k1', plan, id);
        const skl = seeded.graph.nodes.find(x => x.name === 'Sklapanje')!;
        const r = completeUpstream(seeded.graph, 'k1', skl.id, seeded.processes, 't2');
        expect(r.completed).not.toContain('Krojenje Iverala');
        expect(r.completed).toEqual(expect.arrayContaining(['Kantiranje', 'Lakiranje', 'Krojenje MDF-a']));
        expect(r.processes.find(p => p.Process_Name === 'Krojenje Iverala')).toEqual({ Process_Name: 'Krojenje Iverala', Status: 'Završeno', Completed_At: 'ranije' });
    });

    it('čvorovi drugih proizvoda se ne završavaju', () => {
        const g = {
            nodes: [{ id: 'a', name: 'Krojenje MDF-a', itemIds: ['drugi'] }, { id: 'b', name: 'Brušenje', itemIds: ['k1', 'drugi'] }],
            edges: [{ id: 'e', source: 'a', target: 'b' }],
        };
        expect(completeUpstream(g, 'k1', 'b', [], 't').completed).toEqual([]);
    });
});
