// ════════════════════════════════════════════════════════════════════
// PROCESI PREKO SVIH NALOGA — čista logika (bez Firebase), pokrivena testovima.
//
// Model proizvodnje: zanatske EKIPE (majstor+pomoćnik) nose cijeli nalog kroz
// sve procese; više ekipa paralelno. Zato je primarna leća "po nalozima"
// (napredak ekipe kroz faze), a sekundarne "po procesima" (red čekanja po
// stanici) i "po radnicima".
//
// buildProcessCells → JEDAN skup ćelija (nalog×proizvod×proces) s gatingom;
// groupByOrder/Process/Worker su čiste projekcije nad istim ćelijama.
// jest: lib/__tests__/processBoard.test.ts
// ════════════════════════════════════════════════════════════════════

import type {
    WorkOrder, WorkOrderItem, WorkLog, Worker, ProcessCatalogItem, ProcessGraph,
} from './types';
import {
    planToStages, synthesizeOrderGraph, nodeMatchesProcess, computeProcessGating,
} from './productProcesses';

const norm = (s: string) => (s || '').trim().toLowerCase();

export interface ProcessCell {
    workOrderId: string;
    orderLabel: string;
    orderColor?: string;
    itemId: string;
    itemName: string;
    processName: string;        // prikazni (kanonski/node) naziv procesa
    itemProcessName: string;    // TAČNO pohranjeno ime procesa na stavci — sigurno za updateItemProcess
    nodeId: string;
    catalogOrder: number | null; // null = legacy/ad-hoc proces (van kataloga)
    gate: 'done' | 'active' | 'blocked';
    status: string;             // Na čekanju | U toku | Završeno | Odloženo
    hasLoggedWork: boolean;
    crewWorkerIds: string[];    // ekipa naloga (majstor+pomoćnici)
    phaseIndex: number;         // faza procesa u nalogu (za fazni stepper); 999 = van plana
    workerName?: string;
    helpers: { Worker_ID: string; Worker_Name: string }[];
    completedAt?: string;
}

export interface ProcessBoardOrderInput {
    workOrder: Pick<WorkOrder, 'Work_Order_ID' | 'Work_Order_Type' | 'Status' | 'Color_Code'> & { Process_Graph?: ProcessGraph };
    items: WorkOrderItem[];
    orderLabel: string;         // unaprijed izračunat (workOrderDisplayName) — modul ostaje čist
}

/** Ekipa naloga: dodijeljeni (Assigned_Workers/Processes/Helpers) ∪ radnici sa NAJNOVIJEG knjiženog datuma. */
function crewOfOrder(items: WorkOrderItem[], orderLogs: Pick<WorkLog, 'Worker_ID' | 'Date'>[]): string[] {
    const ids = new Set<string>();
    for (const it of items) {
        (it.Assigned_Workers || []).forEach(w => w.Worker_ID && ids.add(w.Worker_ID));
        (it.Processes || []).forEach(p => {
            const wid = (p as { Worker_ID?: string }).Worker_ID;
            if (wid) ids.add(wid);
            (p.Helpers || []).forEach(h => h.Worker_ID && ids.add(h.Worker_ID));
        });
    }
    if (orderLogs.length) {
        const latest = orderLogs.map(l => l.Date).filter(Boolean).sort().slice(-1)[0];
        orderLogs.filter(l => l.Date === latest).forEach(l => l.Worker_ID && ids.add(l.Worker_ID));
    }
    return Array.from(ids);
}

/**
 * Odredi čvorove/ivice za gating naloga:
 *  • snimljeni graf S ivicama → autoritativan (korisnik ga je uredio);
 *  • snimljeni graf BEZ ivica (>1 čvor) → tretiraj kao izveden: uzmi ivice iz sinteze,
 *    remapovane po IMENU na čvorove snimljenog grafa (pokriva naloge kreirane prije includeEdges);
 *  • nema grafa → sinteza iz faznih planova.
 * Vraća i phaseByName (iz sinteze) za fazni stepper.
 */
function resolveOrderGraph(order: ProcessBoardOrderInput): {
    nodes: { id: string; name: string; aliases?: string[]; itemIds: string[] }[];
    edges: { source: string; target: string }[];
    phaseByName: Map<string, number>;
} {
    const synthItems = order.items.map(it => ({
        itemId: it.ID,
        stages: planToStages((it as { Process_Stages?: { processes: string[] }[] }).Process_Stages,
            (it.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[]),
    })).filter(si => si.stages.length > 0);
    const synth = synthesizeOrderGraph(synthItems, undefined, { includeEdges: true });

    // Faza po imenu procesa (iz sinteze) — za stepper.
    const phaseByName = new Map<string, number>();
    synth.columns.forEach((col, phase) => {
        col.forEach(nodeId => {
            const n = synth.graph.nodes.find(x => x.id === nodeId);
            if (n) phaseByName.set(norm(n.name), phase);
        });
    });

    const saved = order.workOrder.Process_Graph;
    if (saved && saved.nodes && saved.nodes.length) {
        if (saved.edges && saved.edges.length > 0) {
            return { nodes: saved.nodes, edges: saved.edges, phaseByName };  // autoritativan
        }
        // Edgeless snimljeni graf → ivice iz sinteze remapovane po imenu na snimljene čvorove.
        if (saved.nodes.length > 1) {
            const idByName = new Map(saved.nodes.map(n => [norm(n.name), n.id]));
            const synthIdToName = new Map(synth.graph.nodes.map(n => [n.id, norm(n.name)]));
            const edges: { source: string; target: string }[] = [];
            const seen = new Set<string>();
            for (const e of synth.graph.edges) {
                const s = idByName.get(synthIdToName.get(e.source) || '');
                const t = idByName.get(synthIdToName.get(e.target) || '');
                if (s && t && s !== t) { const k = `${s}→${t}`; if (!seen.has(k)) { seen.add(k); edges.push({ source: s, target: t }); } }
            }
            return { nodes: saved.nodes, edges, phaseByName };
        }
        return { nodes: saved.nodes, edges: [], phaseByName };
    }
    return { nodes: synth.graph.nodes, edges: synth.graph.edges, phaseByName };
}

export function buildProcessCells(
    orders: ProcessBoardOrderInput[],
    catalog: Pick<ProcessCatalogItem, 'Name' | 'Order'>[],
    workLogs: Pick<WorkLog, 'Work_Order_ID' | 'Work_Order_Item_ID' | 'Worker_ID' | 'Process_Name' | 'Process_Node_ID' | 'Date'>[],
): ProcessCell[] {
    const catalogOrderByName = new Map(catalog.map(c => [norm(c.Name), c.Order]));
    const logsByOrder = new Map<string, typeof workLogs>();
    for (const l of workLogs) {
        if (!l.Work_Order_ID) continue;
        const arr = logsByOrder.get(l.Work_Order_ID) || [];
        arr.push(l); logsByOrder.set(l.Work_Order_ID, arr);
    }

    const cells: ProcessCell[] = [];
    for (const order of orders) {
        const woId = order.workOrder.Work_Order_ID;
        const orderLogs = logsByOrder.get(woId) || [];
        const crew = crewOfOrder(order.items, orderLogs);
        const itemById = new Map(order.items.map(it => [it.ID, it]));
        const { nodes, edges, phaseByName } = resolveOrderGraph(order);

        // doneByNodeId: čvor "done" ako je za SVE pokrivene stavke pripadajući proces Završen.
        const doneById = new Map<string, boolean>();
        const nodeCells = new Map<string, ProcessCell[]>();
        for (const n of nodes) {
            const coveredIds = (n.itemIds && n.itemIds.length) ? n.itemIds : order.items.map(i => i.ID);
            const list: ProcessCell[] = [];
            let doneCount = 0;
            for (const itemId of coveredIds) {
                const it = itemById.get(itemId);
                if (!it) continue;
                const proc = (it.Processes || []).find(p => nodeMatchesProcess({ name: n.name, aliases: n.aliases }, p.Process_Name));
                const status = (proc?.Status as string) || 'Na čekanju';
                if (status === 'Završeno') doneCount++;
                const hasLoggedWork = orderLogs.some(l => l.Work_Order_Item_ID === itemId && (
                    (!!l.Process_Node_ID && l.Process_Node_ID === n.id) ||
                    (!!l.Process_Name && nodeMatchesProcess({ name: n.name, aliases: n.aliases }, l.Process_Name))
                ));
                list.push({
                    workOrderId: woId, orderLabel: order.orderLabel, orderColor: order.workOrder.Color_Code,
                    itemId, itemName: it.Product_Name || '—',
                    processName: n.name,
                    itemProcessName: proc?.Process_Name || n.name,   // TAČNO ime za updateItemProcess
                    nodeId: n.id,
                    catalogOrder: catalogOrderByName.get(norm(n.name)) ?? null,
                    gate: 'blocked',  // popunjava se ispod
                    status, hasLoggedWork, crewWorkerIds: crew,
                    phaseIndex: phaseByName.get(norm(n.name)) ?? 999,
                    workerName: proc?.Worker_Name, helpers: proc?.Helpers || [], completedAt: proc?.Completed_At,
                });
            }
            const covered = list.length;
            doneById.set(n.id, covered > 0 && doneCount === covered);
            nodeCells.set(n.id, list);
        }

        const gating = computeProcessGating(nodes.map(n => n.id), edges, doneById);
        nodeCells.forEach((list, nodeId) => {
            const g = gating.get(nodeId) || 'blocked';
            list.forEach(c => { c.gate = g; cells.push(c); });
        });
    }
    return cells;
}

// ════════════════════════════════════════════════════════════════════
// PROJEKCIJE (grupacije) — čiste transformacije nad ćelijama.
// ════════════════════════════════════════════════════════════════════

export interface OrderPhase {
    phaseIndex: number;
    cells: ProcessCell[];
    allDone: boolean;
}
export interface OrderGroup {
    workOrderId: string;
    orderLabel: string;
    orderColor?: string;
    crewWorkerIds: string[];
    phases: OrderPhase[];
    currentPhaseIndex: number;   // prva faza koja NIJE cijela Završeno; -1 = sve gotovo
    activeCells: ProcessCell[];  // "na redu" (gate active, nezavršeni) u tekućoj fazi
    doneCount: number;
    totalCount: number;
}

/** PO NALOGU (default): ekipa + fazni pipeline + "na redu". */
export function groupByOrder(cells: ProcessCell[]): OrderGroup[] {
    const byOrder = new Map<string, ProcessCell[]>();
    const order: string[] = [];
    for (const c of cells) {
        if (!byOrder.has(c.workOrderId)) { byOrder.set(c.workOrderId, []); order.push(c.workOrderId); }
        byOrder.get(c.workOrderId)!.push(c);
    }
    return order.map(woId => {
        const list = byOrder.get(woId)!;
        const first = list[0];
        const phaseKeys = Array.from(new Set(list.map(c => c.phaseIndex))).sort((a, b) => a - b);
        const phases: OrderPhase[] = phaseKeys.map(pi => {
            const pc = list.filter(c => c.phaseIndex === pi);
            return { phaseIndex: pi, cells: pc, allDone: pc.length > 0 && pc.every(c => c.status === 'Završeno') };
        });
        const currentPhaseIndex = phases.findIndex(p => !p.allDone);
        const activeCells = currentPhaseIndex >= 0
            ? phases[currentPhaseIndex].cells.filter(c => c.status !== 'Završeno' && c.gate === 'active')
            : [];
        return {
            workOrderId: woId, orderLabel: first.orderLabel, orderColor: first.orderColor,
            crewWorkerIds: first.crewWorkerIds,
            phases, currentPhaseIndex,
            activeCells,
            doneCount: list.filter(c => c.status === 'Završeno').length,
            totalCount: list.length,
        };
    });
}

export interface ProcessGroup {
    key: string;
    name: string;
    catalogOrder: number | null;
    active: ProcessCell[];      // gate active, nezavršeni (red čekanja)
    blockedCount: number;
    doneCount: number;
    totalCount: number;
    hasLoggedWork: boolean;
}

/** PO PROCESU (stanice): katalog redoslijed; legacy/ad-hoc (van kataloga) na kraj. */
export function groupByProcess(cells: ProcessCell[]): ProcessGroup[] {
    const byKey = new Map<string, ProcessCell[]>();
    for (const c of cells) {
        const key = norm(c.processName);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(c);
    }
    const groups: ProcessGroup[] = [];
    byKey.forEach((list, key) => {
        groups.push({
            key, name: list[0].processName, catalogOrder: list[0].catalogOrder,
            active: list.filter(c => c.gate === 'active' && c.status !== 'Završeno'),
            blockedCount: list.filter(c => c.gate === 'blocked' && c.status !== 'Završeno').length,
            doneCount: list.filter(c => c.status === 'Završeno').length,
            totalCount: list.length,
            hasLoggedWork: list.some(c => c.hasLoggedWork),
        });
    });
    // Katalog redoslijed (Order), pa procesi van kataloga (catalogOrder null) na kraj, po nazivu.
    return groups.sort((a, b) => {
        const ao = a.catalogOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.catalogOrder ?? Number.MAX_SAFE_INTEGER;
        return ao - bo || a.name.localeCompare(b.name, 'hr');
    });
}

export interface WorkerGroup {
    workerId: string;
    workerName: string;
    orders: { workOrderId: string; orderLabel: string; orderColor?: string; activeCells: ProcessCell[]; currentPhaseIndex: number }[];
    activeCount: number;
}

/** PO RADNIKU (majstoru): njegovi nalozi + tekuća faza + "na redu". Ćelije bez ekipe → "Nedodijeljeno". */
export function groupByWorker(cells: ProcessCell[], workers: Pick<Worker, 'Worker_ID' | 'Name'>[]): WorkerGroup[] {
    const nameById = new Map(workers.map(w => [w.Worker_ID, w.Name]));
    const orderGroups = groupByOrder(cells);
    const UNASSIGNED = '__unassigned__';
    const byWorker = new Map<string, WorkerGroup>();
    const ensure = (workerId: string): WorkerGroup => {
        let g = byWorker.get(workerId);
        if (!g) {
            g = { workerId, workerName: workerId === UNASSIGNED ? 'Nedodijeljeno' : (nameById.get(workerId) || 'Nepoznat'), orders: [], activeCount: 0 };
            byWorker.set(workerId, g);
        }
        return g;
    };
    for (const og of orderGroups) {
        const targets = og.crewWorkerIds.length ? og.crewWorkerIds : [UNASSIGNED];
        for (const wid of targets) {
            const g = ensure(wid);
            g.orders.push({ workOrderId: og.workOrderId, orderLabel: og.orderLabel, orderColor: og.orderColor, activeCells: og.activeCells, currentPhaseIndex: og.currentPhaseIndex });
            g.activeCount += og.activeCells.length;
        }
    }
    // Radnici s aktivnim poslom prvi; Nedodijeljeno na kraj.
    return Array.from(byWorker.values()).sort((a, b) => {
        if (a.workerId === UNASSIGNED) return 1;
        if (b.workerId === UNASSIGNED) return -1;
        return b.activeCount - a.activeCount || a.workerName.localeCompare(b.workerName, 'hr');
    });
}
