// ════════════════════════════════════════════════════════════════════
// NOVI PLAN PROIZVODA U NALOGU KOJI JE VEĆ U TOKU — čista logika (bez Firebase)
//
// Auto prijedlog na kartici proizvoda preračuna plan po zadnjim pravilima, a
// ovdje se taj plan ulije u stavku naloga — bez obzira dokle je proizvod stigao:
//  • urađeno ostaje urađeno (status po nazivu, i preko starih naziva:
//    „Kantiranje" → „Kantiranje iverala"),
//  • koraci novog plana PRIJE urađenog/započetog procesa su podrazumijevano
//    završeni (Assumed_Done) — proizvod ne ide unazad,
//  • proces kojeg nema u novom planu ostaje samo ako je na njemu bilo rada,
//  • graf naloga: čvorovi čuvaju ID (dnevnice ga referenciraju); veze starog
//    plana stavke se uklanjaju osim ako ih daje i drugi proizvod; ručne ostaju.
// jest: lib/__tests__/processReplan.test.ts
// ════════════════════════════════════════════════════════════════════

import type { ItemProcessStatus, ProcessEdge, ProcessGraph, ProcessNode } from './types';
import { normKey } from './processConsolidation';
import { canonicalProcessName } from './processStandard';
import { stagesFromGraph } from './productProcesses';
import { computeGraphDepths, layoutColumns } from './processLayout';

/** Ključ procesa: stari standardni naziv i kanonski su isti proces. */
const key = (name: string) => normKey(canonicalProcessName(name || ''));
const nodeKeys = (n: ProcessNode) => [n.name, ...(n.aliases || [])].map(key);

export interface ReplanInput {
    /** Graf naloga (zajednički za sve stavke). */
    graph: ProcessGraph | undefined;
    itemId: string;
    /** Sve stavke naloga — čvor s praznim itemIds pokriva sve. */
    allItemIds: string[];
    processes: ItemProcessStatus[] | undefined;
    /** Dosadašnji plan stavke (snimak) — njegove veze se mijenjaju novim. */
    oldPlan: ProcessGraph | undefined;
    /** Planovi ostalih stavki naloga — njihove veze ostaju. */
    otherPlans: ProcessGraph[];
    newPlan: ProcessGraph;
    /** Procesi s knjiženim radom na ovoj stavci (Process_Name/Process_Tags dnevnica). */
    loggedProcesses: string[];
    /** Čvorovi naloga s knjiženim radom (bilo koja stavka) — ne brišu se. */
    loggedNodeIds: string[];
    atIso: string;
    newId: () => string;
}

export interface ReplanResult {
    graph: ProcessGraph;
    processes: ItemProcessStatus[];
    added: string[];
    removed: string[];
    assumed: string[];
    /** Graf naloga se promijenio (čvorovi ili veze). */
    graphChanged: boolean;
}

const progress = (p: ItemProcessStatus) =>
    p.Status === 'Završeno' ? (p.Assumed_Done ? 2 : 3) : p.Status === 'U toku' ? 1 : 0;

function reaches(edges: ProcessEdge[], from: string, to: string): boolean {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
        const cur = stack.pop()!;
        if (cur === to) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        edges.forEach(e => { if (e.source === cur) stack.push(e.target); });
    }
    return false;
}

function namePairs(g: ProcessGraph | undefined): Set<string> {
    const name = new Map((g?.nodes || []).map(n => [n.id, n.name]));
    return new Set((g?.edges || []).map(e => `${key(name.get(e.source) || '')}→${key(name.get(e.target) || '')}`));
}

const signature = (g: ProcessGraph) =>
    `${g.nodes.map(n => `${n.id}:${n.name}:${(n.itemIds || []).join(',')}`).sort().join('|')}#${g.edges.map(e => `${e.source}>${e.target}`).sort().join('|')}`;

export function replanOrderItem(input: ReplanInput): ReplanResult {
    const { itemId, newPlan, atIso, newId } = input;
    const planNodes = (newPlan.nodes || []).filter(n => (n.name || '').trim() && key(n.name) !== 'rad');
    const planIds = new Set(planNodes.map(n => n.id));
    const planEdges = (newPlan.edges || []).filter(e => planIds.has(e.source) && planIds.has(e.target));
    const ordered = stagesFromGraph({ nodes: planNodes, edges: planEdges }).flat();

    // ── 1) Procesi stavke: redom novog plana, statusi preneseni ──
    const old = (input.processes || []).map(p => ({ ...p }));
    const taken = new Set<number>();
    const added: string[] = [];
    const processes: ItemProcessStatus[] = ordered.map(name => {
        const matches = old.map((p, i) => ({ p, i })).filter(x => !taken.has(x.i) && key(x.p.Process_Name) === key(name));
        if (!matches.length) {
            added.push(name);
            return { Process_Name: name, Status: 'Na čekanju' };
        }
        // Isti proces dvaput (stari i novi naziv) → najodmakliji status.
        matches.forEach(x => taken.add(x.i));
        const best = matches.reduce((a, b) => (progress(b.p) > progress(a.p) ? b : a)).p;
        return { ...best, Process_Name: name };
    });
    const logged = new Set(input.loggedProcesses.map(key));
    const removed: string[] = [];
    old.forEach((p, i) => {
        if (taken.has(i)) return;
        const worked = p.Status === 'U toku' || (p.Status === 'Završeno' && !p.Assumed_Done) || logged.has(key(p.Process_Name));
        if (worked) processes.push(p);
        else removed.push(p.Process_Name);
    });

    // ── 2) Raniji koraci novog plana prije urađenog/započetog su podrazumijevano završeni ──
    const byKey = new Map(processes.map(p => [key(p.Process_Name), p]));
    const preds = new Map<string, string[]>();
    planEdges.forEach(e => preds.set(e.target, [...(preds.get(e.target) || []), e.source]));
    const nameOf = new Map(planNodes.map(n => [n.id, n.name]));
    const assumed: string[] = [];
    const visited = new Set<string>();
    for (const n of planNodes) {
        const st = byKey.get(key(n.name))?.Status;
        if (st !== 'Završeno' && st !== 'U toku') continue;
        const stack = [...(preds.get(n.id) || [])];
        while (stack.length) {
            const id = stack.pop()!;
            if (visited.has(id)) continue;
            visited.add(id);
            const p = byKey.get(key(nameOf.get(id) || ''));
            if (p && p.Status === 'Na čekanju') {
                Object.assign(p, { Status: 'Završeno', Completed_At: atIso, Assumed_Done: true });
                assumed.push(p.Process_Name);
            }
            stack.push(...(preds.get(id) || []));
        }
    }

    // ── 3) Graf naloga ──
    const g: ProcessGraph = input.graph
        ? { ...input.graph, nodes: input.graph.nodes.map(n => ({ ...n })), edges: input.graph.edges.map(e => ({ ...e })) }
        : { nodes: [], edges: [] };
    const before = signature(g);
    const covers = (n: ProcessNode) => !(n.itemIds || []).length || n.itemIds.includes(itemId);
    const keep = new Set(processes.map(p => key(p.Process_Name)));
    const loggedNodes = new Set(input.loggedNodeIds);
    const others = input.allItemIds.filter(id => id !== itemId);

    // 3a) Stavka napušta čvorove kojih više nema u njenom planu; čvor bez ijedne stavke i bez rada nestaje.
    const dropped = new Set<string>();
    for (const n of g.nodes) {
        if (!covers(n) || nodeKeys(n).some(k => keep.has(k))) continue;
        const rest = (n.itemIds || []).length ? n.itemIds.filter(id => id !== itemId) : others;
        if (rest.length) n.itemIds = rest;
        else if (!loggedNodes.has(n.id)) dropped.add(n.id);
    }
    g.nodes = g.nodes.filter(n => !dropped.has(n.id));
    g.edges = g.edges.filter(e => !dropped.has(e.source) && !dropped.has(e.target));

    // 3b) Čvorovi novog plana: postojeći (i pod starim nazivom) se prošire na stavku, ostali su novi.
    const idFor = new Map<string, string>();
    for (const p of planNodes) {
        const name = p.name.trim();
        const existing = g.nodes.find(n => nodeKeys(n).includes(key(name)));
        if (existing) {
            if ((existing.itemIds || []).length && !existing.itemIds.includes(itemId)) existing.itemIds = [...existing.itemIds, itemId];
            if (existing.name !== name) {
                // Stari naziv ostaje sinonim — procesi drugih stavki pod njim i dalje nalaze čvor.
                existing.aliases = Array.from(new Set([...(existing.aliases || []), existing.name, name]));
                existing.name = name;
            }
            idFor.set(p.id, existing.id);
        } else {
            const node: ProcessNode = { id: newId(), name, itemIds: [itemId], aliases: [name] };
            g.nodes.push(node);
            idFor.set(p.id, node.id);
        }
    }

    // 3c) Veze: stare veze plana stavke odlaze (osim ako ih daje novi plan ili drugi proizvod), nove dolaze.
    const oldPairs = namePairs(input.oldPlan);
    const keepPairs = new Set([...Array.from(namePairs({ nodes: planNodes, edges: planEdges })), ...input.otherPlans.flatMap(pg => Array.from(namePairs(pg)))]);
    const nameById = new Map(g.nodes.map(n => [n.id, n.name]));
    g.edges = g.edges.filter(e => {
        const pair = `${key(nameById.get(e.source) || '')}→${key(nameById.get(e.target) || '')}`;
        return !oldPairs.has(pair) || keepPairs.has(pair);
    });
    for (const e of planEdges) {
        const a = idFor.get(e.source), b = idFor.get(e.target);
        if (!a || !b || a === b || g.edges.some(x => x.source === a && x.target === b) || reaches(g.edges, b, a)) continue;
        g.edges.push({ id: newId(), source: a, target: b });
    }

    // 3d) Raspored: lista procesa naloga se ređa po koloni (x), pa promijenjen tok dobija nove kolone.
    // S vizuelnim grupama se pomjeraju samo novi čvorovi.
    const graphChanged = signature(g) !== before;
    if (graphChanged) {
        const depth = computeGraphDepths(g.nodes, g.edges);
        const columns: string[][] = [];
        g.nodes.forEach(n => { const d = depth.get(n.id) || 0; (columns[d] = columns[d] || []).push(n.id); });
        const pos = layoutColumns(columns.filter(Boolean));
        const grouped = (g.groups || []).length > 0;
        g.nodes.forEach(n => { if (!grouped || !n.position) n.position = pos[n.id]; });
    }

    return { graph: g, processes, added, removed, assumed, graphChanged };
}
