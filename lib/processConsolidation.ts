// ════════════════════════════════════════════════════════════════════
// KONSOLIDACIJA PROCESA — čista logika (bez Firebase), pokrivena testovima.
//
// Problem: isti proces unesen pod više imena ("Krojenje ivarala", "krojenje
// iverala", "Krojenje Iverala") živi u katalogu, pravilima, šablonima,
// planovima proizvoda, checklistama i grafovima naloga. Ovaj modul:
//  1. skuplja SVE nazive procesa s upotrebom po izvoru (collectProcessUsage)
//  2. predlaže grupe duplikata/sličnih (suggestConsolidationGroups)
//  3. primjenjuje preimenovanje na svaku strukturu (rename*/merge*) —
//     grafovi čuvaju ID-eve čvorova, a spajanje čvorova vraća nodeIdRemap
//     kojim pozivalac ažurira WorkLog.Process_Node_ID reference.
// Batch upis radi lib/database.ts (applyProcessConsolidation).
// jest: lib/__tests__/processConsolidation.test.ts
// ════════════════════════════════════════════════════════════════════

import type { ProcessGraph, ProcessNode, ProcessEdge } from './types';

// ── Normalizacija ─────────────────────────────────────────────────────

/** Ključ jednakosti: trim, kolaps razmaka, lowercase, bez dijakritika (š→s, đ→dj…). */
export function normKey(s: string | undefined | null): string {
    return (s || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .replace(/đ/g, 'dj')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

const displayTrim = (s: string) => (s || '').trim().replace(/\s+/g, ' ');

// ── Upotreba naziva po izvorima ───────────────────────────────────────

export interface ProcessSourceCounts {
    catalog: number;        // 0/1 — postoji u katalogu
    rules: number;          // broj pravila materijal→proces koja ga navode
    stageTemplates: number; // broj šablona faza
    flowTemplates: number;  // broj šablona toka (graf)
    products: number;       // broj proizvoda čiji plan ga sadrži
    orderItems: number;     // broj stavki naloga (checklist / snapshot faza)
    orderGraphs: number;    // broj naloga čiji graf ima čvor ili alias
}

export interface ProcessUsage {
    key: string;             // normKey
    display: string;         // preferirani prikazni oblik (najčešći; tie → prvi viđen)
    displays: string[];      // svi viđeni oblici
    counts: ProcessSourceCounts;
    total: number;
    inCatalog: boolean;
    catalogOrder: number | null;
}

export interface UsageInputs {
    catalog: { Name: string; Order?: number }[];
    rules: { Processes?: string[] }[];
    stageTemplates: { Stages?: { processes?: string[] }[] }[];
    flowTemplates: { nodes?: { name?: string }[] }[];
    products: { Process_Plan?: string[] | null; Process_Stages?: { processes?: string[] }[] | null }[];
    workOrders: {
        items?: { Processes?: { Process_Name?: string }[]; Process_Stages?: { processes?: string[] }[] }[];
        graph?: { nodes?: { name?: string; aliases?: string[] }[] } | null;
    }[];
}

const EMPTY_COUNTS = (): ProcessSourceCounts => ({
    catalog: 0, rules: 0, stageTemplates: 0, flowTemplates: 0, products: 0, orderItems: 0, orderGraphs: 0,
});

/** Skupi sve nazive procesa i njihovu upotrebu; sort: veći total prvi, pa abecedno. */
export function collectProcessUsage(inputs: UsageInputs): ProcessUsage[] {
    interface Acc { displays: Map<string, number>; counts: ProcessSourceCounts; catalogOrder: number | null }
    const acc = new Map<string, Acc>();
    const touch = (raw: string | undefined | null, kind: keyof ProcessSourceCounts, weight = 1) => {
        const k = normKey(raw);
        if (!k) return;
        let a = acc.get(k);
        if (!a) { a = { displays: new Map(), counts: EMPTY_COUNTS(), catalogOrder: null }; acc.set(k, a); }
        const d = displayTrim(raw as string);
        a.displays.set(d, (a.displays.get(d) || 0) + weight);
        a.counts[kind] += weight;
    };

    for (const c of inputs.catalog || []) {
        touch(c.Name, 'catalog');
        const k = normKey(c.Name);
        const a = k ? acc.get(k) : undefined;
        if (a && a.catalogOrder === null) a.catalogOrder = c.Order ?? null;
    }
    for (const r of inputs.rules || []) {
        const seen = new Set<string>();
        for (const p of r.Processes || []) { const k = normKey(p); if (k && !seen.has(k)) { seen.add(k); touch(p, 'rules'); } }
    }
    for (const t of inputs.stageTemplates || []) {
        const seen = new Set<string>();
        for (const s of t.Stages || []) for (const p of s.processes || []) {
            const k = normKey(p); if (k && !seen.has(k)) { seen.add(k); touch(p, 'stageTemplates'); }
        }
    }
    for (const t of inputs.flowTemplates || []) {
        const seen = new Set<string>();
        for (const n of t.nodes || []) { const k = normKey(n.name); if (k && !seen.has(k)) { seen.add(k); touch(n.name, 'flowTemplates'); } }
    }
    for (const p of inputs.products || []) {
        const seen = new Set<string>();
        const note = (name?: string | null) => { const k = normKey(name); if (k && !seen.has(k)) { seen.add(k); touch(name, 'products'); } };
        (p.Process_Plan || []).forEach(note);
        (p.Process_Stages || []).forEach(s => (s.processes || []).forEach(note));
    }
    for (const wo of inputs.workOrders || []) {
        const seenItems = new Set<string>();   // po stavci se broji jednom, ali stavke odvojeno
        for (const it of wo.items || []) {
            const seen = new Set<string>();
            const note = (name?: string | null) => {
                const k = normKey(name); if (k && !seen.has(k)) { seen.add(k); touch(name, 'orderItems'); }
            };
            (it.Processes || []).forEach(pr => note(pr.Process_Name));
            (it.Process_Stages || []).forEach(s => (s.processes || []).forEach(note));
            seenItems.add('x');
        }
        const seenG = new Set<string>();
        for (const n of wo.graph?.nodes || []) {
            const names = [n.name, ...(n.aliases || [])];
            for (const nm of names) { const k = normKey(nm); if (k && !seenG.has(k)) { seenG.add(k); touch(nm, 'orderGraphs'); } }
        }
    }

    return Array.from(acc.entries()).map(([key, a]) => {
        let display = ''; let best = -1;
        a.displays.forEach((cnt, d) => { if (cnt > best) { best = cnt; display = d; } });
        const counts = a.counts;
        const total = counts.catalog + counts.rules + counts.stageTemplates + counts.flowTemplates
            + counts.products + counts.orderItems + counts.orderGraphs;
        return {
            key, display, displays: Array.from(a.displays.keys()), counts, total,
            inCatalog: counts.catalog > 0, catalogOrder: a.catalogOrder,
        };
    }).sort((x, y) => y.total - x.total || x.display.localeCompare(y.display, 'hr'));
}

// ── Sličnost i prijedlog grupa ────────────────────────────────────────

function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= m; i++) {
        const cur = [i, ...new Array(n).fill(0)];
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[n];
}

/** Omjer sličnosti [0..1] nad normalizovanim stringovima (1 = identično). */
export function similarityRatio(a: string, b: string): number {
    const ka = normKey(a), kb = normKey(b);
    if (!ka || !kb) return 0;
    if (ka === kb) return 1;
    const maxLen = Math.max(ka.length, kb.length);
    return 1 - levenshtein(ka, kb) / maxLen;
}

const tokensOf = (s: string) => new Set(normKey(s).split(/[^a-z0-9]+/).filter(Boolean));

function tokenJaccard(a: string, b: string): number {
    const ta = tokensOf(a), tb = tokensOf(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    ta.forEach(t => { if (tb.has(t)) inter++; });
    return inter / (ta.size + tb.size - inter);
}

export interface ConsolidationGroupSuggestion {
    canonical: string;      // predloženo kanonsko ime (najčešći/najinformativniji oblik)
    members: string[];      // display oblici koje grupa spaja (uklj. canonical)
    memberKeys: string[];   // normKey članova
    confidence: 'exact' | 'high' | 'medium';
    totalUsage: number;
}

/**
 * Predloži grupe duplikata/sličnih naziva:
 *  - 'exact'  : isti normKey (case/dijakritike/razmaci) — više display oblika istog ključa
 *  - 'high'   : Levenshtein omjer ≥ 0.85 (tipfeleri: "ivarala"/"iverala")
 *  - 'medium' : omjer ≥ 0.72 ILI token-Jaccard ≥ 0.6 (redoslijed riječi, sufiksi)
 * Podskup tokena ("Krojenje" vs "Krojenje iverala") se NE spaja automatski —
 * to su često RAZLIČITE operacije; takve parove ostavljamo korisniku/AI-u.
 */
export function suggestConsolidationGroups(usage: ProcessUsage[]): ConsolidationGroupSuggestion[] {
    const n = usage.length;
    // Union-Find nad indeksima
    const parent = new Array(n).fill(0).map((_, i) => i);
    const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
    const confidence = new Map<string, 'high' | 'medium'>(); // "i|j" sortirano
    const union = (a: number, b: number, conf: 'high' | 'medium') => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent[rb] = ra;
        const kk = a < b ? `${a}|${b}` : `${b}|${a}`;
        const prev = confidence.get(kk);
        if (!prev || (prev === 'medium' && conf === 'high')) confidence.set(kk, conf);
    };

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const a = usage[i], b = usage[j];
            const ta = tokensOf(a.display), tb = tokensOf(b.display);
            // Striktan podskup tokena → preskoči (vjerovatno različite operacije).
            let inter = 0; ta.forEach(t => { if (tb.has(t)) inter++; });
            const strictSubset = (inter === ta.size && tb.size > ta.size) || (inter === tb.size && ta.size > tb.size);
            if (strictSubset) continue;
            const lev = similarityRatio(a.display, b.display);
            const jac = tokenJaccard(a.display, b.display);
            if (lev >= 0.85) union(i, j, 'high');
            else if (lev >= 0.72 || jac >= 0.6) union(i, j, 'medium');
        }
    }

    const byRoot = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const r = find(i);
        if (!byRoot.has(r)) byRoot.set(r, []);
        byRoot.get(r)!.push(i);
    }

    const groups: ConsolidationGroupSuggestion[] = [];
    byRoot.forEach(idxs => {
        const multiDisplay = idxs.some(i => usage[i].displays.length > 1);
        if (idxs.length === 1 && !multiDisplay) return;  // ništa za spajanje
        const members = idxs.map(i => usage[i]);
        const canonical = pickCanonical(members);
        const conf: ConsolidationGroupSuggestion['confidence'] = idxs.length === 1
            ? 'exact'
            : idxs.every((a, ai) => idxs.every((b, bi) => {
                if (bi <= ai) return true;
                const kk = a < b ? `${a}|${b}` : `${b}|${a}`;
                return confidence.get(kk) !== 'medium';
            })) ? 'high' : 'medium';
        groups.push({
            canonical,
            members: members.flatMap(m => m.displays),
            memberKeys: members.map(m => m.key),
            confidence: idxs.length === 1 ? 'exact' : conf,
            totalUsage: members.reduce((s, m) => s + m.total, 0),
        });
    });
    return groups.sort((a, b) => b.totalUsage - a.totalUsage || a.canonical.localeCompare(b.canonical, 'hr'));
}

/** Kanonski oblik grupe: iz kataloga ako postoji; inače najkorišteniji; tie → duži (informativniji). */
export function pickCanonical(members: Pick<ProcessUsage, 'display' | 'total' | 'inCatalog'>[]): string {
    if (!members.length) return '';
    const sorted = [...members].sort((a, b) =>
        (Number(b.inCatalog) - Number(a.inCatalog)) || (b.total - a.total) || (b.display.length - a.display.length));
    return sorted[0].display;
}

// ── Rename mapa i primjene ────────────────────────────────────────────

/** normKey(član) → kanonsko display ime. Uključuje i sam canonical (normalizacija zapisa). */
export type RenameMap = Map<string, string>;

export function buildRenameMap(groups: { canonical: string; members: string[] }[]): RenameMap {
    const map: RenameMap = new Map();
    for (const g of groups || []) {
        const canonical = displayTrim(g.canonical);
        if (!canonical) continue;
        map.set(normKey(canonical), canonical);
        for (const m of g.members || []) {
            const k = normKey(m);
            if (k) map.set(k, canonical);
        }
    }
    return map;
}

export const renameName = (name: string, map: RenameMap): string => map.get(normKey(name)) || displayTrim(name);

/** Rename + dedupe (prva pojava pobjeđuje), prazni ispadaju. */
export function renameList(list: (string | undefined | null)[] | undefined | null, map: RenameMap): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of list || []) {
        if (!raw) continue;
        const renamed = renameName(raw, map);
        const k = normKey(renamed);
        if (!k || seen.has(k)) continue;
        seen.add(k); out.push(renamed);
    }
    return out;
}

/** Rename po fazama + dedupe KROZ SVE faze (prva pojava pobjeđuje); prazne faze ispadaju. */
export function renameStages(stages: { processes?: string[] }[] | string[][] | undefined | null, map: RenameMap): string[][] {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const stage of stages || []) {
        const list = Array.isArray(stage) ? stage : (stage?.processes || []);
        const kept: string[] = [];
        for (const raw of list) {
            if (!raw) continue;
            const renamed = renameName(raw, map);
            const k = normKey(renamed);
            if (!k || seen.has(k)) continue;
            seen.add(k); kept.push(renamed);
        }
        if (kept.length) out.push(kept);
    }
    return out;
}

const STATUS_RANK: Record<string, number> = { 'Završeno': 3, 'U toku': 2, 'Odloženo': 1, 'Na čekanju': 0 };

/**
 * Rename procesa STAVKE naloga; duplikati nakon preimenovanja se SPAJAJU:
 * preživi zapis s najnaprednijim statusom (Završeno > U toku > Odloženo > Na čekanju)
 * — čuva Worker/Completed_At/Notes završenog rada. Redoslijed prve pojave.
 */
export function mergeItemProcesses<T extends { Process_Name: string; Status?: string }>(
    processes: T[] | undefined | null,
    map: RenameMap
): T[] {
    const out: T[] = [];
    const idxByKey = new Map<string, number>();
    for (const p of processes || []) {
        const renamed = renameName(p.Process_Name, map);
        const k = normKey(renamed);
        if (!k) continue;
        const existingIdx = idxByKey.get(k);
        if (existingIdx === undefined) {
            idxByKey.set(k, out.length);
            out.push({ ...p, Process_Name: renamed });
        } else {
            const existing = out[existingIdx];
            const rNew = STATUS_RANK[p.Status || ''] ?? 0;
            const rOld = STATUS_RANK[existing.Status || ''] ?? 0;
            if (rNew > rOld) out[existingIdx] = { ...p, Process_Name: renamed };
        }
    }
    return out;
}

export interface GraphRenameResult {
    graph: ProcessGraph;
    /** stari node.id → preživjeli node.id, SAMO za spojene čvorove (pozivalac remapuje WorkLog.Process_Node_ID). */
    nodeIdRemap: Record<string, string>;
    mergedCount: number;
    changed: boolean;
}

/**
 * Preimenuj čvorove grafa; čvorovi koji nakon preimenovanja dijele ime se SPAJAJU:
 *  - survivor = čvor iz preferSurvivorIds (ima knjižen rad) ili prvi viđeni — ID SE ČUVA
 *  - itemIds/aliases = unija (aliasi pamte sve originalne nazive → stari zapisi se i dalje poklapaju)
 *  - ivice se remapuju na preživjele ID-eve; duplikati i self-loop ispadaju
 */
export function renameGraphNodes(
    graph: ProcessGraph | undefined | null,
    map: RenameMap,
    preferSurvivorIds?: Set<string>
): GraphRenameResult {
    const nodes = graph?.nodes || [];
    const edges = graph?.edges || [];
    if (!nodes.length) return { graph: { nodes: [], edges: [] }, nodeIdRemap: {}, mergedCount: 0, changed: false };

    const outNodes: ProcessNode[] = [];
    const survivorByKey = new Map<string, number>();  // normKey(novo ime) → index u outNodes
    const idRemap: Record<string, string> = {};
    let mergedCount = 0;
    let changed = false;

    const addAliases = (target: ProcessNode, extra: (string | undefined)[]) => {
        const set = new Map<string, string>();
        [...(target.aliases || [target.name]), ...extra].forEach(a => {
            if (!a) return;
            const k = normKey(a);
            if (k && !set.has(k)) set.set(k, displayTrim(a));
        });
        target.aliases = Array.from(set.values());
    };

    for (const n of nodes) {
        const newName = renameName(n.name, map);
        if (newName !== n.name) changed = true;
        const k = normKey(newName);
        const existingIdx = survivorByKey.get(k);
        if (existingIdx === undefined) {
            const copy: ProcessNode = { ...n, name: newName };
            addAliases(copy, [n.name, newName]);
            survivorByKey.set(k, outNodes.length);
            outNodes.push(copy);
        } else {
            // merge u postojeći; ako je OVAJ čvor preferirani survivor a postojeći nije — zamijeni uloge (ID!)
            changed = true;
            mergedCount++;
            const existing = outNodes[existingIdx];
            const preferNew = !!preferSurvivorIds?.has(n.id) && !preferSurvivorIds?.has(existing.id);
            if (preferNew) {
                const replacement: ProcessNode = { ...n, name: newName };
                addAliases(replacement, [n.name, newName, ...(existing.aliases || [existing.name])]);
                replacement.itemIds = Array.from(new Set([...(n.itemIds || []), ...(existing.itemIds || [])]));
                replacement.position = existing.position ?? n.position;
                outNodes[existingIdx] = replacement;
                idRemap[existing.id] = n.id;
                // ranije remapovani na existing.id sada idu na n.id
                for (const [oldId, tgt] of Object.entries(idRemap)) if (tgt === existing.id) idRemap[oldId] = n.id;
            } else {
                addAliases(existing, [n.name, newName]);
                existing.itemIds = Array.from(new Set([...(existing.itemIds || []), ...(n.itemIds || [])]));
                if (!existing.position && n.position) existing.position = n.position;
                idRemap[n.id] = existing.id;
            }
        }
    }

    const resolve = (id: string) => idRemap[id] || id;
    const seenEdges = new Set<string>();
    const outEdges: ProcessEdge[] = [];
    for (const e of edges) {
        const s = resolve(e.source), t = resolve(e.target);
        if (!s || !t || s === t) { if (s === t) changed = true; continue; }
        const kk = `${s}→${t}`;
        if (seenEdges.has(kk)) { changed = true; continue; }
        seenEdges.add(kk);
        outEdges.push(s === e.source && t === e.target ? e : { id: `e-${s}-${t}`, source: s, target: t });
    }

    return { graph: { nodes: outNodes, edges: outEdges }, nodeIdRemap: idRemap, mergedCount, changed };
}

// ── Statistika za pregled prije primjene ──────────────────────────────

export interface GroupImpact {
    canonical: string;
    members: string[];
    products: number;
    orderItems: number;
    orderGraphs: number;
    rules: number;
    templates: number;
}

/** Zbroj upotrebe po grupi (za "šta će se promijeniti" pregled u wizardu). */
export function computeGroupImpact(
    groups: { canonical: string; members: string[] }[],
    usage: ProcessUsage[]
): GroupImpact[] {
    const byKey = new Map(usage.map(u => [u.key, u]));
    return (groups || []).map(g => {
        const keys = new Set((g.members || []).map(normKey).filter(Boolean));
        let products = 0, orderItems = 0, orderGraphs = 0, rules = 0, templates = 0;
        keys.forEach(k => {
            const u = byKey.get(k);
            if (!u) return;
            products += u.counts.products;
            orderItems += u.counts.orderItems;
            orderGraphs += u.counts.orderGraphs;
            rules += u.counts.rules;
            templates += u.counts.stageTemplates + u.counts.flowTemplates;
        });
        return { canonical: g.canonical, members: g.members || [], products, orderItems, orderGraphs, rules, templates };
    });
}
