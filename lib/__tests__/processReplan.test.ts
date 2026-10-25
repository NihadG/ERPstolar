import { replanOrderItem, type ReplanInput } from '../processReplan';
import { buildGraphFromRules, mergeProductGraphs } from '../productProcesses';
import { STANDARD_CATALOG, STANDARD_RULES } from '../processStandard';
import type { ItemProcessStatus, ProcessGraph } from '../types';

const catalog = STANDARD_CATALOG.map((Name, i) => ({ Name, Order: i + 1 }));
const M = (...names: string[]) => names.map(n => {
    const [Material_Name, Category = ''] = n.split('@');
    return { Material_Name, Category };
});

/** Lanci naziva → graf plana (svaki lanac je grana; isti naziv = isti čvor). */
function plan(...chains: string[][]): ProcessGraph {
    const ids = new Map<string, string>();
    const id = (n: string) => ids.get(n) || (ids.set(n, `p-${ids.size}`), ids.get(n)!);
    const edges = chains.flatMap(c => c.slice(1).map((n, i) => ({ id: `${c[i]}>${n}`, source: id(c[i]), target: id(n) })));
    chains.flat().forEach(id);
    return { nodes: Array.from(ids.entries()).map(([name, nid]) => ({ id: nid, name, itemIds: [] })), edges };
}
const P = (name: string, Status: ItemProcessStatus['Status'] = 'Na čekanju', extra: Partial<ItemProcessStatus> = {}): ItemProcessStatus => ({ Process_Name: name, Status, ...extra });

function run(over: Partial<ReplanInput> & Pick<ReplanInput, 'newPlan'>) {
    let seq = 0;
    const res = replanOrderItem({
        graph: undefined, itemId: 'i1', allItemIds: ['i1'], processes: [], oldPlan: undefined, otherPlans: [],
        loggedProcesses: [], loggedNodeIds: [], atIso: 'T', newId: () => `new-${++seq}`, ...over,
    });
    const name = new Map(res.graph.nodes.map(n => [n.id, n.name]));
    return {
        ...res,
        edges: new Set(res.graph.edges.map(e => `${name.get(e.source)} > ${name.get(e.target)}`)),
        status: (p: string) => res.processes.find(x => x.Process_Name === p),
        node: (p: string) => res.graph.nodes.find(n => n.name === p),
    };
}

describe('Auto prijedlog u nalogu koji je u toku', () => {
    // Retropult komoda po STAROM standardu: priprema furnira poslije krojenja, ladice u prvoj fazi.
    const oldPlan = plan(
        ['Krojenje MDF-a', 'Priprema furnira', 'Furniranje', 'Srezivanje na tačnu mjeru', 'Kantiranje fronti', 'Probna montaža', 'Brušenje', 'Lakiranje', 'Završno sklapanje', 'Okivanje'],
        ['Izrada ladica', 'Probna montaža'],
    );
    const orderGraph = mergeProductGraphs([{ itemId: 'i1', graph: oldPlan }]).graph;
    const komoda = M('Baglama ravna (sa ublazivacem)@Okovi', 'Furnir / Orah', 'Lakiranje', 'MDF 18', 'Vodilice Blum 500@Okovi');
    const newPlan = buildGraphFromRules(komoda, STANDARD_RULES, undefined, catalog, 'Poz 2 - Retropult komoda').graph;
    const processes = [
        P('Krojenje MDF-a', 'Završeno'), P('Priprema furnira', 'Završeno'), P('Furniranje', 'U toku'),
        P('Srezivanje na tačnu mjeru'), P('Kantiranje fronti'), P('Izrada ladica'), P('Probna montaža'),
        P('Brušenje'), P('Lakiranje'), P('Završno sklapanje'), P('Okivanje'),
    ];
    const r = run({ graph: orderGraph, processes, oldPlan, newPlan });

    it('urađeno ostaje urađeno, stari naziv prelazi u novi', () => {
        expect(r.status('Krojenje MDF-a')?.Status).toBe('Završeno');
        expect(r.status('Furniranje')?.Status).toBe('U toku');
        expect(r.status('Kantiranje furnira')?.Status).toBe('Na čekanju');
        expect(r.status('Kantiranje fronti')).toBeUndefined();
        expect(r.added).toEqual([]);
    });

    it('graf naloga dobija novi tok; čvorovi čuvaju ID (dnevnice)', () => {
        expect(r.edges).not.toContain('Krojenje MDF-a > Priprema furnira');
        expect(r.edges).not.toContain('Izrada ladica > Probna montaža');
        ['Krojenje MDF-a > Furniranje', 'Priprema furnira > Furniranje', 'Kantiranje furnira > Izrada ladica', 'Izrada ladica > Brušenje']
            .forEach(e => expect(r.edges).toContain(e));
        const before = orderGraph.nodes.find(n => n.name === 'Kantiranje fronti')!;
        expect(r.node('Kantiranje furnira')).toMatchObject({ id: before.id });
        expect(r.node('Kantiranje furnira')!.aliases).toEqual(expect.arrayContaining(['Kantiranje fronti', 'Kantiranje furnira']));
        expect(r.node('Furniranje')!.id).toBe(orderGraph.nodes.find(n => n.name === 'Furniranje')!.id);
        expect(r.graphChanged).toBe(true);
        // Lista procesa naloga se ređa po koloni: ladice više nisu u prvoj.
        expect(r.node('Izrada ladica')!.position!.x).toBe(r.node('Probna montaža')!.position!.x);
    });

    it('raniji koraci novog plana prije urađenog su podrazumijevano završeni', () => {
        const res = run({
            graph: mergeProductGraphs([{ itemId: 'i1', graph: plan(['Krojenje MDF-a', 'Furniranje', 'Brušenje']) }]).graph,
            oldPlan: plan(['Krojenje MDF-a', 'Furniranje', 'Brušenje']),
            processes: [P('Krojenje MDF-a', 'Završeno'), P('Furniranje', 'Završeno'), P('Brušenje', 'U toku')],
            newPlan: plan(['Krojenje MDF-a', 'Furniranje', 'Brušenje'], ['Priprema furnira', 'Furniranje']),
        });
        expect(res.status('Priprema furnira')).toMatchObject({ Status: 'Završeno', Assumed_Done: true, Completed_At: 'T' });
        expect(res.assumed).toEqual(['Priprema furnira']);
        expect(res.status('Brušenje')?.Status).toBe('U toku');
    });

    it('proces van novog plana ostaje samo uz rad', () => {
        const old = plan(['Krojenje iverala', 'Kantiranje', 'Sklapanje kutija']);
        const next = plan(['Krojenje iverala', 'Kantiranje iverala', 'Probna montaža']);
        const base = { graph: mergeProductGraphs([{ itemId: 'i1', graph: old }]).graph, oldPlan: old, newPlan: next };
        const noWork = run({ ...base, processes: [P('Krojenje iverala', 'Završeno'), P('Kantiranje'), P('Sklapanje kutija')] });
        expect(noWork.removed).toEqual(['Sklapanje kutija']);
        expect(noWork.node('Sklapanje kutija')).toBeUndefined();
        expect(noWork.status('Kantiranje iverala')?.Status).toBe('Na čekanju');

        const worked = run({ ...base, processes: [P('Krojenje iverala', 'Završeno'), P('Kantiranje', 'Završeno'), P('Sklapanje kutija', 'U toku')] });
        expect(worked.status('Sklapanje kutija')?.Status).toBe('U toku');
        expect(worked.node('Sklapanje kutija')).toBeDefined();

        const logged = run({ ...base, processes: [P('Sklapanje kutija')], loggedProcesses: ['Sklapanje kutija'] });
        expect(logged.status('Sklapanje kutija')).toBeDefined();
    });

    it('drugi proizvod u nalogu zadržava svoje veze i čvorove', () => {
        const old = plan(['Krojenje MDF-a', 'Priprema furnira', 'Furniranje']);
        const other = plan(['Krojenje MDF-a', 'Priprema furnira', 'Furniranje']);
        const graph = mergeProductGraphs([{ itemId: 'i1', graph: old }, { itemId: 'i2', graph: other }]).graph;
        const res = run({
            graph, oldPlan: old, otherPlans: [other], allItemIds: ['i1', 'i2'],
            newPlan: plan(['Krojenje MDF-a', 'Furniranje'], ['Priprema furnira', 'Furniranje']),
        });
        expect(res.edges).toContain('Krojenje MDF-a > Priprema furnira'); // i2 je još po starom
        expect(res.edges).toContain('Krojenje MDF-a > Furniranje');
    });

    it('čvor s knjiženim radom ne nestaje ni kad ga više nijedna stavka nema', () => {
        const old = plan(['Krojenje iverala', 'Sklapanje kutija']);
        const graph = mergeProductGraphs([{ itemId: 'i1', graph: old }]).graph;
        const sk = graph.nodes.find(n => n.name === 'Sklapanje kutija')!;
        const res = run({ graph, oldPlan: old, newPlan: plan(['Krojenje iverala', 'Probna montaža']), processes: [P('Sklapanje kutija')], loggedNodeIds: [sk.id] });
        expect(res.node('Sklapanje kutija')).toBeDefined();
    });

    it('čvor koji pokriva sve stavke (prazan itemIds) postaje eksplicitan za ostale', () => {
        const graph: ProcessGraph = { nodes: [{ id: 'a', name: 'Rad', itemIds: [] }], edges: [] };
        const res = run({ graph, allItemIds: ['i1', 'i2'], newPlan: plan(['Krojenje iverala']) });
        expect(res.node('Rad')!.itemIds).toEqual(['i2']);
        expect(res.node('Krojenje iverala')!.itemIds).toEqual(['i1']);
    });

    it('isti plan ne mijenja graf ni raspored', () => {
        const p = plan(['Krojenje MDF-a', 'Furniranje']);
        const graph = mergeProductGraphs([{ itemId: 'i1', graph: p }]).graph;
        graph.nodes.forEach((n, i) => { n.position = { x: 500 + i, y: 7 }; });
        const res = run({ graph, oldPlan: p, newPlan: p, processes: [P('Krojenje MDF-a', 'Završeno'), P('Furniranje')] });
        expect(res.graphChanged).toBe(false);
        expect(res.node('Furniranje')!.position).toEqual({ x: 501, y: 7 });
    });
});
