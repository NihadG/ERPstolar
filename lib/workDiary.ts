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
import { STANDARD_RENAMES } from './processStandard';
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

/**
 * Naziv iz poruke → proces iz rječnika (katalog + čvorovi grafova). null = nepoznat.
 * Stari standardni nazivi vode na novi („kantiranje fronti" → Kantiranje furnira).
 * Kad pristaje više procesa („kantiranje" → iverala ili furnira), prednost ima proces iz
 * plana stavki (`preferred`, redom: nezavršeni prvo) — tačan naziv procesa uvijek pobjeđuje.
 */
export function matchProcess(name: string, vocabulary: string[], preferred: string[] = []): string | null {
    const q = foldText(name);
    if (!q) return null;
    const exact = vocabulary.find(v => foldText(v) === q);
    if (exact) return exact;
    const fit = (v: string) => Math.min(processCoverage(name, v), processCoverage(v, name) + 0.25);
    const rank = (v: string) => {
        const i = preferred.findIndex(p => foldText(p) === foldText(v));
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const ranked = vocabulary
        .map(v => {
            const old = STANDARD_RENAMES.find(g => foldText(g.canonical) === foldText(v))?.members || [];
            // Stari naziv izgovoren tačno je jak, ali ne prejak: plan stavke i dalje bira.
            const s = Math.max(fit(v), ...old.map(o => (foldText(o) === q ? 1.5 : fit(o))));
            return { v, s, r: rank(v) };
        })
        .filter(x => x.s >= 0.75);
    const inPlan = ranked.filter(x => x.r !== Number.MAX_SAFE_INTEGER);
    return (inPlan.length ? inPlan : ranked)
        .sort((a, b) => b.s - a.s || a.r - b.r || a.v.length - b.v.length)[0]?.v || null;
}

/**
 * Procesi iz plana stavki u grafu naloga (bez „Rad"), za prepoznavanje rečenog procesa:
 * nezavršeni prvo, pa redom toka.
 */
export function planProcessNames(graph: ProcessGraph | undefined, items: { ID: string; Processes?: ItemProcessStatus[] }[]): string[] {
    const open: string[] = [];
    const done: string[] = [];
    for (const item of items) {
        const names = graph?.nodes?.length
            ? itemNodes(graph, item.ID).map(n => n.name)
            : (item.Processes || []).map(p => p.Process_Name);
        for (const name of names) {
            if (!name || foldText(name) === 'rad' || open.includes(name) || done.includes(name)) continue;
            const st = (item.Processes || []).find(p => foldText(p.Process_Name) === foldText(name))?.Status;
            (st === 'Završeno' ? done : open).push(name);
        }
    }
    return [...open, ...done];
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
export function itemNodes(graph: ProcessGraph, itemId: string): ProcessNode[] {
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
 * procesi ga zamjenjuju u prikazu toka. `covered` = proces je već bio u planu
 * stavke (samo tada se raniji koraci smiju pretpostaviti završenim).
 */
export function ensureGraphNode(graph: ProcessGraph | undefined, itemId: string, processName: string, newId: () => string): { graph: ProcessGraph; nodeId: string; added: boolean; covered: boolean } {
    const g: ProcessGraph = graph ? { ...graph, nodes: graph.nodes.map(n => ({ ...n })), edges: [...graph.edges] } : { nodes: [], edges: [] };
    const covering = g.nodes.find(n => nodeMatchesProcess(n, processName) && (!(n.itemIds || []).length || n.itemIds.includes(itemId)));
    if (covering) return { graph: g, nodeId: covering.id, added: false, covered: true };
    const sameName = g.nodes.find(n => nodeMatchesProcess(n, processName));
    if (sameName) {
        sameName.itemIds = Array.from(new Set([...(sameName.itemIds || []), itemId]));
        return { graph: g, nodeId: sameName.id, added: false, covered: false };
    }
    const chain = itemNodes(g, itemId).filter(n => foldText(n.name) !== 'rad');
    const node: ProcessNode = { id: newId(), name: processName, itemIds: [itemId] };
    g.nodes.push(node);
    const last = chain[chain.length - 1];
    if (last) g.edges.push({ id: newId(), source: last.id, target: node.id });
    return { graph: g, nodeId: node.id, added: true, covered: false };
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


// ─── Plan za proizvod bez procesa ─────────────────────────────────────

const coversItem = (n: ProcessNode, itemId: string) => !(n.itemIds || []).length || n.itemIds.includes(itemId);

/** Stavka već ima plan: procese ili stvaran (ne „Rad") čvor u grafu naloga koji je pokriva. */
export function itemHasPlan(graph: ProcessGraph | undefined, item: { ID: string; Processes?: ItemProcessStatus[] }): boolean {
    if ((item.Processes || []).length) return true;
    return (graph?.nodes || []).some(n => foldText(n.name) !== 'rad' && coversItem(n, item.ID));
}

/** Faze plana proizvoda kao graf: svaki proces faze vodi u svaki proces sljedeće. */
export function graphFromStages(stages: string[][]): ProcessGraph {
    const nodes: ProcessNode[] = [];
    const edges: ProcessGraph['edges'] = [];
    let prev: ProcessNode[] = [];
    stages.forEach((stage, s) => {
        const cur = stage.filter(Boolean).map((name, i) => ({ id: `s${s}-${i}`, name, itemIds: [] as string[] }));
        if (!cur.length) return;
        nodes.push(...cur);
        prev.forEach(a => cur.forEach(b => edges.push({ id: `${a.id}>${b.id}`, source: a.id, target: b.id })));
        prev = cur;
    });
    return { nodes, edges };
}

/**
 * Plan proizvoda (iz pravila materijala ili s kartice proizvoda) se ulije u graf
 * naloga za jednu stavku: isti proces = postojeći čvor proširen na stavku, ostali
 * su novi; veze se preslikaju bez duplikata i bez kruga. Procesi stavke dobiju
 * cijeli plan kao „Na čekanju", redom toka.
 */
export function applyPlanToItem(
    graph: ProcessGraph | undefined,
    processes: ItemProcessStatus[] | undefined,
    itemId: string,
    plan: ProcessGraph,
    newId: () => string,
): { graph: ProcessGraph; processes: ItemProcessStatus[]; added: string[] } {
    const g: ProcessGraph = graph ? { ...graph, nodes: graph.nodes.map(n => ({ ...n })), edges: [...graph.edges] } : { nodes: [], edges: [] };
    const idFor = new Map<string, string>();                  // čvor plana → čvor naloga
    for (const p of plan.nodes) {
        if (!p.name?.trim() || foldText(p.name) === 'rad') continue;
        const existing = g.nodes.find(n => foldText(n.name) !== 'rad' && nodeMatchesProcess(n, p.name));
        if (existing) {
            if ((existing.itemIds || []).length && !existing.itemIds.includes(itemId)) existing.itemIds = [...existing.itemIds, itemId];
            idFor.set(p.id, existing.id);
        } else {
            const node: ProcessNode = { id: newId(), name: p.name.trim(), itemIds: [itemId] };
            g.nodes.push(node);
            idFor.set(p.id, node.id);
        }
    }
    const reaches = (from: string, to: string): boolean => {
        const seen = new Set<string>();
        const stack = [from];
        while (stack.length) {
            const cur = stack.pop()!;
            if (cur === to) return true;
            if (seen.has(cur)) continue;
            seen.add(cur);
            g.edges.filter(e => e.source === cur).forEach(e => stack.push(e.target));
        }
        return false;
    };
    for (const e of plan.edges) {
        const a = idFor.get(e.source), b = idFor.get(e.target);
        if (!a || !b || a === b) continue;
        if (g.edges.some(x => x.source === a && x.target === b) || reaches(b, a)) continue;
        g.edges.push({ id: newId(), source: a, target: b });
    }
    const list = (processes || []).map(p => ({ ...p }));
    const added: string[] = [];
    const planIds = new Set(idFor.values());
    for (const n of itemNodes(g, itemId)) {
        if (!planIds.has(n.id) || list.some(p => nodeMatchesProcess(n, p.Process_Name))) continue;
        list.push({ Process_Name: n.name, Status: 'Na čekanju' });
        added.push(n.name);
    }
    return { graph: g, processes: list, added };
}

/**
 * Upisan proces znači da su raniji koraci iste stavke gotovi: svi PRETHODNICI
 * čvora u grafu (ne paralelne grane) koji nisu završeni postaju „Završeno" s
 * oznakom Assumed_Done. Dnevnica se na njih ne knjiži — samo status.
 */
export function completeUpstream(
    graph: ProcessGraph,
    itemId: string,
    nodeId: string,
    processes: ItemProcessStatus[] | undefined,
    atIso: string,
): { processes: ItemProcessStatus[]; completed: string[] } {
    const mine = new Map(graph.nodes.filter(n => coversItem(n, itemId)).map(n => [n.id, n]));
    const before = new Set<string>();
    const stack = [nodeId];
    while (stack.length) {
        const cur = stack.pop()!;
        graph.edges.forEach(e => {
            if (e.target === cur && mine.has(e.source) && !before.has(e.source)) { before.add(e.source); stack.push(e.source); }
        });
    }
    const list = (processes || []).map(p => ({ ...p }));
    const completed: string[] = [];
    for (const n of itemNodes(graph, itemId)) {
        if (!before.has(n.id) || foldText(n.name) === 'rad') continue;
        const existing = list.find(p => nodeMatchesProcess(n, p.Process_Name));
        if (existing?.Status === 'Završeno') continue;
        if (existing) Object.assign(existing, { Status: 'Završeno', Completed_At: atIso, Assumed_Done: true });
        else list.push({ Process_Name: n.name, Status: 'Završeno', Completed_At: atIso, Assumed_Done: true });
        completed.push(n.name);
    }
    return { processes: list, completed };
}

// ─── „Završi sve" i prazni dani ───────────────────────────────────────

/**
 * Vlasnik javi da je proizvod gotov („sve zapakovali"): svaki proces iz plana
 * stavke (graf naloga) i sa stavke postaje „Završeno" — potvrđeno, ne
 * pretpostavljeno. „Rad" (generički čvor) se ne dodaje.
 */
export function finishAllProcesses(
    graph: ProcessGraph | undefined,
    itemId: string,
    processes: ItemProcessStatus[] | undefined,
    atIso: string,
): { processes: ItemProcessStatus[]; finished: string[] } {
    const list = (processes || []).map(p => ({ ...p }));
    for (const n of graph ? itemNodes(graph, itemId) : []) {
        if (foldText(n.name) === 'rad' || list.some(p => nodeMatchesProcess(n, p.Process_Name))) continue;
        list.push({ Process_Name: n.name, Status: 'Na čekanju' });
    }
    const finished: string[] = [];
    for (const p of list) {
        if (p.Status === 'Završeno' && !p.Assumed_Done) continue;
        Object.assign(p, { Status: 'Završeno', Completed_At: p.Completed_At && p.Status === 'Završeno' ? p.Completed_At : atIso });
        delete p.Assumed_Done;
        finished.push(p.Process_Name);
    }
    return { processes: list, finished };
}

const ABSENT_STATUSES = new Set(['Odsutan', 'Bolovanje', 'Odmor', 'Vikend', 'Praznik']);
const PRESENT_STATUSES = new Set(['Prisutan', 'Teren']);

/**
 * Dani u [from, to] (do danas) u kojima radnik nema POTVRĐEN upis rada.
 * Automatska podjela iz prisustva se računa kao prazan dan (diktat je mijenja).
 * Preskače se odsutan dan i vikend na koji radnik nije bio prisutan po šihtarici.
 */
export function emptyWorkDays(input: {
    from: string;
    to: string;
    today: string;
    workerIds: string[];
    logs: { Date: string; Worker_ID: string; Entry_Source?: string; Booking_Source?: string; Is_From_Attendance?: boolean; Work_Order_Deleted?: boolean }[];
    attendance: { Worker_ID: string; Date: string; Status: string }[];
}): { date: string; workerIds: string[] }[] {
    const end = input.to < input.today ? input.to : input.today;
    const confirmed = (l: (typeof input.logs)[number]) => !l.Work_Order_Deleted
        && (l.Entry_Source === 'telegram' || !(l.Booking_Source === 'attendance' || (l.Booking_Source !== 'manual' && l.Is_From_Attendance)));
    const out: { date: string; workerIds: string[] }[] = [];
    for (let t = Date.parse(`${input.from}T12:00:00Z`); t <= Date.parse(`${end}T12:00:00Z`); t += 86_400_000) {
        const date = new Date(t).toISOString().slice(0, 10);
        const weekend = [0, 6].includes(new Date(t).getUTCDay());
        const workerIds = input.workerIds.filter(w => {
            const status = input.attendance.find(a => a.Worker_ID === w && a.Date.slice(0, 10) === date)?.Status;
            if (status && ABSENT_STATUSES.has(status)) return false;
            if (weekend && !(status && PRESENT_STATUSES.has(status))) return false;
            return !input.logs.some(l => l.Worker_ID === w && l.Date.slice(0, 10) === date && confirmed(l));
        });
        if (workerIds.length) out.push({ date, workerIds });
    }
    return out;
}
