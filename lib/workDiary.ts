// ════════════════════════════════════════════════════════════════════
// DNEVNI UPIS RADA — čista logika (bez Firebase)
//
// Asistent (Haiku) samo pretvori poruku „Amer i Kerim krojili iveral za
// kuhinju Čorluka, Edin kantirao gardarobere — završio" u stavke
// {radnici, posao (tekst), proces, udio dana, gotovo}. SVE ostalo je ovdje,
// deterministički i provjerljivo:
//   • koji nalog/proizvod je „kuhinja Čorluka" (ili pitanje kad nije jasno)
//   • koji proces iz kataloga je „iveral krojili"
//   • koliki je udio dana po poslu (Day_Weight) i prisutnost
//   • kako se graf naloga dopunjava i koji proces se čekira
// Upis u bazu radi lib/server/workDiary.ts.
// ════════════════════════════════════════════════════════════════════

import { foldText, stem, tokens } from './voice/text';
import { tokenSimilarity } from './voice/match';
import { nodeMatchesProcess } from './productProcesses';
import type { ItemProcessStatus, ProcessGraph, ProcessNode, WorkOrder } from './types';

// ─── Poslovi na koje se može upisati rad ──────────────────────────────

export interface DiaryTarget {
    workOrderId: string;
    workOrderName: string;
    itemId: string;
    productId: string;
    productName: string;
    projectName: string;
    finished: boolean;
}

/** Stavke naloga koji primaju rad (otvoreni + završeni, kao šihtarica). */
export function diaryTargets(orders: WorkOrder[], projectNameOf: (projectId: string) => string): DiaryTarget[] {
    return orders
        .filter(o => o.Status !== 'Otkazano')
        .flatMap(o => (o.items || []).map(i => ({
            workOrderId: o.Work_Order_ID,
            workOrderName: o.Name || o.Work_Order_Number || 'Nalog',
            itemId: i.ID,
            productId: i.Product_ID || '',
            productName: i.Product_Name || '',
            projectName: i.Project_ID ? projectNameOf(i.Project_ID) : '',
            finished: o.Status === 'Završeno',
        })));
}

/** Koliki dio riječi upita se nađe u tekstu (0..1), s tolerancijom na padeže i tipfelere. */
export function coverage(query: string, haystack: string): number {
    const q = tokens(foldText(query)).filter(w => w.length > 1);
    if (!q.length) return 0;
    const h = tokens(foldText(haystack));
    let hit = 0;
    for (const w of q) {
        const sw = stem(w);
        if (h.some(x => x === w || stem(x) === sw || tokenSimilarity(w, x) >= 0.82)) hit++;
    }
    return hit / q.length;
}

export type TargetMatch =
    | { kind: 'ok'; workOrderId: string; workOrderName: string; items: DiaryTarget[] }
    | { kind: 'ambiguous'; candidates: { workOrderId: string; workOrderName: string; projectName: string }[] }
    | { kind: 'none' };

const CLOSE = 0.15;

/**
 * „kuhinja Čorluka" → nalog i stavke. Ako upit pogađa jedan nalog, a unutar
 * njega jasno jedan proizvod („gardaroberi u dječijoj sobi"), to je ta
 * stavka; inače sve žive stavke naloga (kao šihtarica). Više naloga podjednako
 * dobrih → kandidati za pitanje. Otvoreni nalozi imaju prednost pred završenim.
 */
export function matchTarget(query: string, targets: DiaryTarget[]): TargetMatch {
    const scored = targets
        .map(t => ({
            t,
            wo: coverage(query, `${t.workOrderName} ${t.projectName}`),
            item: coverage(query, `${t.workOrderName} ${t.productName} ${t.projectName}`),
        }))
        .map(x => ({ ...x, s: Math.max(x.wo, x.item) - (x.t.finished ? 0.05 : 0) }))
        .filter(x => x.s >= 0.5)
        .sort((a, b) => b.s - a.s);
    if (!scored.length) return { kind: 'none' };

    const top = scored[0].s;
    let near = scored.filter(x => x.s >= top - CLOSE);
    // Završen i otvoren nalog podjednako dobri → rad ide na otvoreni.
    const open = near.filter(x => !x.t.finished);
    if (open.length && new Set(open.map(x => x.t.workOrderId)).size < new Set(near.map(x => x.t.workOrderId)).size) near = open;
    const orders = Array.from(new Set(near.map(x => x.t.workOrderId)));
    if (orders.length > 1) {
        const seen = new Set<string>();
        return {
            kind: 'ambiguous',
            candidates: near.filter(x => !seen.has(x.t.workOrderId) && seen.add(x.t.workOrderId))
                .slice(0, 5)
                .map(x => ({ workOrderId: x.t.workOrderId, workOrderName: x.t.workOrderName, projectName: x.t.projectName })),
        };
    }

    const woId = orders[0];
    const inOrder = scored.filter(x => x.t.workOrderId === woId).sort((a, b) => b.item - a.item);
    // Proizvod je izdvojen samo ako ga upit pogađa jasno bolje od ostalih stavki naloga.
    const single = inOrder.length === 1 || (inOrder[0].item - (inOrder[1]?.item ?? 0) >= CLOSE && inOrder[0].item > inOrder[0].wo);
    const items = single ? [inOrder[0].t] : targets.filter(t => t.workOrderId === woId);
    return { kind: 'ok', workOrderId: woId, workOrderName: items[0].workOrderName, items };
}

// ─── Proces ───────────────────────────────────────────────────────────

/**
 * Kao `coverage`, ali procesi se izgovaraju glagolom („krojili", „kantirao",
 * „lakirali") a u katalogu stoje imenicom („Krojenje", „Kantiranje") — pa se
 * riječi poklapaju i po zajedničkom korijenu (bar 4 slova i pola kraće riječi).
 */
function processCoverage(query: string, haystack: string): number {
    const q = tokens(foldText(query)).filter(w => w.length > 1);
    if (!q.length) return 0;
    const h = tokens(foldText(haystack));
    const root = (a: string, b: string) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return i >= Math.max(4, Math.floor(Math.min(a.length, b.length) / 2));
    };
    let hit = 0;
    for (const w of q) {
        if (h.some(x => x === w || stem(x) === stem(w) || tokenSimilarity(w, x) >= 0.82 || root(w, x))) hit++;
    }
    return hit / q.length;
}

/** Naziv iz poruke → proces iz rječnika (katalog + čvorovi grafova). null = nepoznat. */
export function matchProcess(name: string, vocabulary: string[]): string | null {
    const q = foldText(name);
    if (!q) return null;
    const exact = vocabulary.find(v => foldText(v) === q);
    if (exact) return exact;
    const ranked = vocabulary
        .map(v => ({ v, s: Math.min(processCoverage(name, v), processCoverage(v, name) + 0.25) }))
        .filter(x => x.s >= 0.75)
        .sort((a, b) => b.s - a.s || a.v.length - b.v.length);
    return ranked[0]?.v || null;
}

// ─── Udio dana ────────────────────────────────────────────────────────

export interface DayPlan {
    presence: 0.5 | 1;
    /** Udio dana po stavci upisa; undefined = ravnomjerno (nalog → proizvod), bez težine. */
    weights: (number | undefined)[];
}

/**
 * Udjeli dana jednog radnika. Bez ijednog rečenog udjela → ravnomjerno.
 * „pola dana X" kao jedini posao → prisutnost 0.5. Rečeni udjeli se poštuju,
 * ostatak dana se ravnomjerno dijeli na poslove bez udjela.
 */
export function planWorkerDay(fractions: (number | undefined)[]): DayPlan {
    const given = fractions.map(f => (typeof f === 'number' && f > 0 ? Math.min(f, 1) : undefined));
    if (given.every(f => f === undefined)) return { presence: 1, weights: given };
    const sum = given.reduce((s: number, f) => s + (f || 0), 0);
    const missing = given.filter(f => f === undefined).length;
    if (!missing && sum <= 0.5 + 1e-9) return { presence: 0.5, weights: given.map(f => (f as number) / sum) };
    if (missing && sum < 1) {
        const rest = (1 - sum) / missing;
        return { presence: 1, weights: given.map(f => f ?? rest) };
    }
    // Rečeno ≥ cijeli dan (ili bez ostatka za neimenovane): srazmjerno, neimenovani dijele jednako.
    const all = given.map(f => f ?? sum / given.length);
    const total = all.reduce((s, f) => s + f, 0);
    return { presence: 1, weights: all.map(f => f / total) };
}

// ─── Graf naloga i čekiranje ──────────────────────────────────────────

/** Čvorovi koji pokrivaju stavku, redom kojim teku (izvori prvo). */
function itemNodes(graph: ProcessGraph, itemId: string): ProcessNode[] {
    const nodes = graph.nodes.filter(n => !(n.itemIds || []).length || n.itemIds.includes(itemId));
    const ids = new Set(nodes.map(n => n.id));
    const indeg = new Map(nodes.map(n => [n.id, 0]));
    graph.edges.forEach(e => { if (ids.has(e.source) && ids.has(e.target)) indeg.set(e.target, (indeg.get(e.target) || 0) + 1); });
    const out: ProcessNode[] = [];
    const queue = nodes.filter(n => !indeg.get(n.id));
    while (queue.length) {
        const n = queue.shift()!;
        out.push(n);
        graph.edges.filter(e => e.source === n.id && ids.has(e.target)).forEach(e => {
            indeg.set(e.target, (indeg.get(e.target) || 0) - 1);
            if (!indeg.get(e.target)) queue.push(nodes.find(x => x.id === e.target)!);
        });
    }
    return out.length === nodes.length ? out : nodes;
}

/**
 * Proces u grafu naloga za stavku: postojeći čvor (i proširen na stavku ako
 * je bio za druge proizvode) ili nov čvor iza zadnjeg procesa te stavke.
 * Generički čvor „Rad" (nalozi Zadaci) se ne koristi kao prethodnik — stvarni
 * procesi ga zamjenjuju u prikazu toka.
 */
export function ensureGraphNode(graph: ProcessGraph | undefined, itemId: string, processName: string, newId: () => string): { graph: ProcessGraph; nodeId: string; added: boolean } {
    const g: ProcessGraph = graph ? { ...graph, nodes: graph.nodes.map(n => ({ ...n })), edges: [...graph.edges] } : { nodes: [], edges: [] };
    const covering = g.nodes.find(n => nodeMatchesProcess(n, processName) && (!(n.itemIds || []).length || n.itemIds.includes(itemId)));
    if (covering) return { graph: g, nodeId: covering.id, added: false };
    const sameName = g.nodes.find(n => nodeMatchesProcess(n, processName));
    if (sameName) {
        sameName.itemIds = Array.from(new Set([...(sameName.itemIds || []), itemId]));
        return { graph: g, nodeId: sameName.id, added: false };
    }
    const chain = itemNodes(g, itemId).filter(n => foldText(n.name) !== 'rad');
    const node: ProcessNode = { id: newId(), name: processName, itemIds: [itemId] };
    g.nodes.push(node);
    const last = chain[chain.length - 1];
    if (last) g.edges.push({ id: newId(), source: last.id, target: node.id });
    return { graph: g, nodeId: node.id, added: true };
}

/** Čekiranje procesa na stavci: postojeći → u toku / završen; nov se dodaje. */
export function markItemProcess(
    processes: ItemProcessStatus[] | undefined,
    processName: string,
    done: boolean,
    worker: { id: string; name: string },
    atIso: string,
): { processes: ItemProcessStatus[]; change: 'added' | 'started' | 'completed' | 'none' } {
    const list = (processes || []).map(p => ({ ...p }));
    const existing = list.find(p => foldText(p.Process_Name) === foldText(processName));
    if (!existing) {
        list.push({
            Process_Name: processName,
            Status: done ? 'Završeno' : 'U toku',
            Started_At: atIso,
            ...(done ? { Completed_At: atIso } : {}),
            Worker_ID: worker.id,
            Worker_Name: worker.name,
        });
        return { processes: list, change: 'added' };
    }
    if (existing.Status === 'Završeno') return { processes: list, change: 'none' };
    if (done) {
        existing.Status = 'Završeno';
        existing.Completed_At = atIso;
        existing.Started_At = existing.Started_At || atIso;
        return { processes: list, change: 'completed' };
    }
    if (existing.Status !== 'U toku') {
        existing.Status = 'U toku';
        existing.Started_At = existing.Started_At || atIso;
        existing.Worker_ID = existing.Worker_ID || worker.id;
        existing.Worker_Name = existing.Worker_Name || worker.name;
        return { processes: list, change: 'started' };
    }
    return { processes: list, change: 'none' };
}

