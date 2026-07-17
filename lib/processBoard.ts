// ════════════════════════════════════════════════════════════════════
// PROCESI PREKO SVIH NALOGA — čista logika (bez Firebase), pokrivena testovima.
//
// Model proizvodnje: zanatske EKIPE (majstor+pomoćnik) nose cijeli nalog kroz
// sve procese; više ekipa paralelno. Dvije leće: "po nalozima" (napredak ekipe
// kroz tok) i "po procesima" (red čekanja po stanici).
//
// SLOJEVI:
//   buildProcessCells → ćelija = nalog×proizvod×proces (najsitniji zapis, gating)
//   buildProcessTasks → ZADATAK = nalog×proces preko SVIH pokrivenih proizvoda.
//     Zadatak je JEDINICA RADA i JEDAN KLIK: „priprema masive" za 3 proizvoda
//     jednog naloga radi se odjednom, pa se i čekira odjednom (ranije 3 klika).
//   groupByOrder/groupByProcess → čiste projekcije nad zadacima.
// jest: lib/__tests__/processBoard.test.ts
// ════════════════════════════════════════════════════════════════════

import type {
    WorkOrder, WorkOrderItem, WorkLog, ProcessCatalogItem, ProcessGraph,
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
    workOrder: Pick<WorkOrder, 'Work_Order_ID' | 'Work_Order_Type' | 'Status' | 'Color_Code'>
    & { Process_Graph?: ProcessGraph; Created_Date?: string };
    items: WorkOrderItem[];
    orderLabel: string;         // unaprijed izračunat (workOrderDisplayName) — modul ostaje čist
}

// ════════════════════════════════════════════════════════════════════
// PRIORITET NALOGA NA TABLI — šta majstor treba vidjeti prvo.
// ════════════════════════════════════════════════════════════════════

/** Minimum za rangiranje — namjerno labav da ga zadovolji i ProcessBoardOrderInput. */
export interface BoardOrderRank {
    workOrder: { Work_Order_ID: string; Status: string; Created_Date?: string };
    items: { Status?: string; Is_Paused?: boolean }[];
}

/**
 * Nalog je PAUZIRAN kad su SVE njegove otvorene stavke pauzirane — isto pravilo
 * kao dugme Pauza/Nastavi u kartici naloga (WorkOrderExpandedDetail.allPaused),
 * da tabla i kartica nikad ne tvrde suprotno.
 */
export function isOrderPaused(items: { Status?: string; Is_Paused?: boolean }[]): boolean {
    const open = (items || []).filter(i => {
        const s = i.Status || 'Na čekanju';
        return s !== 'Završeno' && s !== 'Otkazano';
    });
    return open.length > 0 && open.every(i => !!i.Is_Paused);
}

/**
 * Rang naloga — DOSLOVNO korisnikov redoslijed, četiri nivoa:
 *   0) u toku, s DANAS proknjiženim radnicima   ← ovdje se upravo radi
 *   1) u toku, bez današnjih dnevnica
 *   2) pauzirani
 *   3) ostali (na čekanju)                      ← završeni/otkazani ni ne ulaze u opseg
 * Pauza je JAČA od „danas": pauziran nalog ne ide u vrh ni ako je danas nešto knjiženo.
 */
export function orderBoardRank<T extends BoardOrderRank>(order: T, workedTodayOrderIds: Set<string>): 0 | 1 | 2 | 3 {
    if (order.workOrder.Status === 'Na čekanju') return 3;
    if (isOrderPaused(order.items)) return 2;
    return workedTodayOrderIds.has(order.workOrder.Work_Order_ID) ? 0 : 1;
}

/**
 * Redoslijed naloga: rang (gore), pa najnoviji (Created_Date opadajuće; ISO string →
 * leksikografski = hronološki). Stabilno: jednaki nalozi zadržavaju ulazni redoslijed.
 */
export function sortOrdersForBoard<T extends BoardOrderRank>(orders: T[], workedTodayOrderIds: Set<string>): T[] {
    return orders
        .map((o, i) => ({ o, i }))
        .sort((a, b) => {
            const rankDiff = orderBoardRank(a.o, workedTodayOrderIds) - orderBoardRank(b.o, workedTodayOrderIds);
            if (rankDiff) return rankDiff;
            const byNewest = (b.o.workOrder.Created_Date || '').localeCompare(a.o.workOrder.Created_Date || '');
            return byNewest || a.i - b.i;
        })
        .map(x => x.o);
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

/** Naziv generičkog placeholdera koji je STARI wizard upisivao proizvodu bez plana. */
const PLACEHOLDER_PROCESS = 'rad';

/**
 * Je li ovo generički „Rad" — placeholder starog wizarda, a ne stvaran proces?
 *
 * Stari wizard je proizvodu BEZ plana upisivao jedan generički proces „Rad". To NIJE
 * proces nego ODSUTNOST plana: ne kaže ništa („nalog ima posla" — pa naravno), ne može
 * se gatati, i korisnik ga ne može smisleno završiti. Tabla ga zato nigdje ne prikazuje
 * kao korak toka; nalog kojem je to jedini „proces" ispada u „Bez definisanih procesa".
 *
 * Escape hatch: ako korisnik doda „Rad" u KATALOG procesa, on postaje legitiman proces
 * i prikazuje se normalno. Katalog je vokabular firme — to je mjesto gdje se odlučuje.
 *
 * Filtrira se na nivou ČVORA/PROCESA, nikad stavke: stavka može imati legacy „Rad" u
 * item.Processes dok PRAVE procese nosi graf naloga (tako je nastao bug gdje je nalog
 * s punim grafom prikazan kao „bez procesa"). Podatak se NE dira — auto-knjiženje
 * dnevnica i dalje čita item.Processes.
 */
export function isPlaceholderProcess(name: string, catalogKeys: Set<string>): boolean {
    const k = norm(name);
    return k === PLACEHOLDER_PROCESS && !catalogKeys.has(k);
}

export function buildProcessCells(
    orders: ProcessBoardOrderInput[],
    catalog: Pick<ProcessCatalogItem, 'Name' | 'Order'>[],
    workLogs: Pick<WorkLog, 'Work_Order_ID' | 'Work_Order_Item_ID' | 'Worker_ID' | 'Process_Name' | 'Process_Node_ID' | 'Date'>[],
): ProcessCell[] {
    const catalogOrderByName = new Map(catalog.map(c => [norm(c.Name), c.Order]));
    const catalogKeys = new Set(catalogOrderByName.keys());
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
        const resolved = resolveOrderGraph(order);
        const { edges, phaseByName } = resolved;
        // Generički „Rad" ispada OVDJE (na nivou čvora) — bilo da dolazi iz snimljenog grafa
        // ili iz sinteze sa stavki. Nalog kojem ostane 0 čvorova nema plan → „Bez definisanih
        // procesa". Stavke se NE diraju: legacy „Rad" u item.Processes smije koegzistirati s
        // pravim procesima iz grafa.
        const nodes = resolved.nodes.filter(n => !isPlaceholderProcess(n.name, catalogKeys));

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
// ZADATAK = nalog × proces (preko svih pokrivenih proizvoda) — jedinica rada.
// ════════════════════════════════════════════════════════════════════

export interface ProcessTask {
    key: string;                 // workOrderId|nodeId — stabilan ključ odabira
    workOrderId: string;
    orderLabel: string;
    orderColor?: string;
    processName: string;
    nodeId: string;
    catalogOrder: number | null;
    phaseIndex: number;
    gate: 'done' | 'active' | 'blocked';
    /** Ćelije po proizvodu — za djelimičan odabir i prikaz „na kojim proizvodima". */
    cells: ProcessCell[];
    itemNames: string[];         // nazivi pokrivenih proizvoda (redoslijed ćelija)
    doneCount: number;
    totalCount: number;
    /** Završeno = SVI proizvodi; Djelimično = neki; U toku = bar jedan pokrenut. */
    status: 'Na čekanju' | 'U toku' | 'Djelimično' | 'Završeno';
    hasLoggedWork: boolean;
    crewWorkerIds: string[];
    completedAt?: string;        // najkasniji datum završetka među proizvodima
    workerNames: string[];       // ko je završio (glavni + pomoćnici, distinct)
}

/** Ćelije → zadaci (nalog×proces). Redoslijed toka: faza → katalog → naziv. */
export function buildProcessTasks(cells: ProcessCell[]): ProcessTask[] {
    const byKey = new Map<string, ProcessCell[]>();
    const order: string[] = [];
    for (const c of cells) {
        const k = `${c.workOrderId}|${c.nodeId}`;
        if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
        byKey.get(k)!.push(c);
    }
    const tasks = order.map(k => {
        const list = byKey.get(k)!;
        const first = list[0];
        const doneCount = list.filter(c => c.status === 'Završeno').length;
        const totalCount = list.length;
        const status: ProcessTask['status'] =
            doneCount === totalCount ? 'Završeno'
                : list.some(c => c.status === 'U toku') ? 'U toku'
                    : doneCount > 0 ? 'Djelimično'
                        : 'Na čekanju';
        const completedAt = list.map(c => c.completedAt).filter(Boolean).sort().slice(-1)[0];
        const names = new Set<string>();
        list.forEach(c => {
            if (c.status !== 'Završeno') return;
            if (c.workerName) names.add(c.workerName);
            (c.helpers || []).forEach(h => h.Worker_Name && names.add(h.Worker_Name));
        });
        return {
            key: k,
            workOrderId: first.workOrderId, orderLabel: first.orderLabel, orderColor: first.orderColor,
            processName: first.processName, nodeId: first.nodeId, catalogOrder: first.catalogOrder,
            phaseIndex: first.phaseIndex, gate: first.gate,
            cells: list, itemNames: list.map(c => c.itemName),
            doneCount, totalCount, status,
            hasLoggedWork: list.some(c => c.hasLoggedWork),
            crewWorkerIds: first.crewWorkerIds,
            completedAt, workerNames: Array.from(names),
        };
    });
    return tasks.sort((a, b) =>
        a.phaseIndex - b.phaseIndex ||
        (a.catalogOrder ?? Number.MAX_SAFE_INTEGER) - (b.catalogOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.processName.localeCompare(b.processName, 'hr'));
}

// ════════════════════════════════════════════════════════════════════
// PROJEKCIJE (grupacije) — čiste transformacije nad zadacima.
// ════════════════════════════════════════════════════════════════════

export interface OrderGroup {
    workOrderId: string;
    orderLabel: string;
    orderColor?: string;
    crewWorkerIds: string[];
    /** SVI procesi naloga u redoslijedu toka (ne samo „na redu") — pregled cijelog toka. */
    tasks: ProcessTask[];
    activeCount: number;
    doneCount: number;           // broji PROCESE (zadatke), ne ćelije
    totalCount: number;
    productCount: number;
}

/**
 * PO NALOGU (default): ekipa + svi procesi naloga u redoslijedu toka.
 *
 * REDOSLIJED NALOGA = redoslijed pojave u `cells`, tj. onaj koji je pozivalac već
 * odredio (sortOrdersForBoard). NE smije se izvoditi iz buildProcessTasks: on sortira
 * zadatke po TOKU (faza → katalog) GLOBALNO preko svih naloga, pa bi karticama redoslijed
 * određivalo to koji nalog slučajno ima proces s najmanjom fazom — a ne rang naloga.
 * (Baš tako je pauziran nalog završio iznad onog na kojem se danas radi.)
 */
export function groupByOrder(cells: ProcessCell[]): OrderGroup[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const c of cells) {
        if (!seen.has(c.workOrderId)) { seen.add(c.workOrderId); order.push(c.workOrderId); }
    }
    const byOrder = new Map<string, ProcessTask[]>();
    for (const t of buildProcessTasks(cells)) {   // zadaci ostaju u redoslijedu toka UNUTAR naloga
        if (!byOrder.has(t.workOrderId)) byOrder.set(t.workOrderId, []);
        byOrder.get(t.workOrderId)!.push(t);
    }
    return order.map(woId => {
        const list = byOrder.get(woId)!;
        const first = list[0];
        const products = new Set<string>();
        list.forEach(t => t.cells.forEach(c => products.add(c.itemId)));
        return {
            workOrderId: woId, orderLabel: first.orderLabel, orderColor: first.orderColor,
            crewWorkerIds: first.crewWorkerIds,
            tasks: list,
            activeCount: list.filter(t => t.gate === 'active' && t.status !== 'Završeno').length,
            doneCount: list.filter(t => t.status === 'Završeno').length,
            totalCount: list.length,
            productCount: products.size,
        };
    });
}

export interface ProcessGroup {
    key: string;
    name: string;
    catalogOrder: number | null;
    /** Jedan zadatak po nalogu — u ovoj leći su NALOZI/PROIZVODI istaknuti, ne naziv procesa. */
    tasks: ProcessTask[];
    activeCount: number;
    blockedCount: number;
    doneCount: number;
    totalCount: number;
    hasLoggedWork: boolean;
}

/**
 * PO PROCESU (stanice): katalog redoslijed; procesi van kataloga na kraj.
 * Unutar procesa nalozi idu ISTIM rangom kao u leći „po nalozima" (redoslijed pojave u
 * `cells`) — a ne po fazi, koja se za isti proces razlikuje od naloga do naloga.
 */
export function groupByProcess(cells: ProcessCell[]): ProcessGroup[] {
    const orderIndex = new Map<string, number>();
    for (const c of cells) if (!orderIndex.has(c.workOrderId)) orderIndex.set(c.workOrderId, orderIndex.size);
    const rankOf = (t: ProcessTask) => orderIndex.get(t.workOrderId) ?? Number.MAX_SAFE_INTEGER;

    const byKey = new Map<string, ProcessTask[]>();
    for (const t of buildProcessTasks(cells)) {
        const key = norm(t.processName);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(t);
    }
    const groups: ProcessGroup[] = [];
    byKey.forEach((list, key) => {
        list.sort((a, b) => rankOf(a) - rankOf(b));
        groups.push({
            key, name: list[0].processName, catalogOrder: list[0].catalogOrder,
            tasks: list,
            activeCount: list.filter(t => t.gate === 'active' && t.status !== 'Završeno').length,
            blockedCount: list.filter(t => t.gate === 'blocked' && t.status !== 'Završeno').length,
            doneCount: list.filter(t => t.status === 'Završeno').length,
            totalCount: list.length,
            hasLoggedWork: list.some(t => t.hasLoggedWork),
        });
    });
    // Katalog redoslijed (Order), pa procesi van kataloga (catalogOrder null) na kraj, po nazivu.
    return groups.sort((a, b) => {
        const ao = a.catalogOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.catalogOrder ?? Number.MAX_SAFE_INTEGER;
        return ao - bo || a.name.localeCompare(b.name, 'hr');
    });
}
