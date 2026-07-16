// ════════════════════════════════════════════════════════════════════
// PROCESI PO PROIZVODU — čista logika (bez Firebase)
// - prijedlog plana iz korisnikovih pravila materijal→proces
// - sinteza grafa naloga iz planova proizvoda (isti proces = jedan čvor,
//   redoslijed svakog proizvoda čuvaju ivice; paralelizam nastaje prirodno)
// - tekući proces proizvoda + auto-pripis čvora dnevnici
// jest: lib/__tests__/productProcesses.test.ts
// ════════════════════════════════════════════════════════════════════

import type { ProcessGraph, ProcessNode, ProcessEdge, ProcessCatalogItem, ProcessMaterialRule } from './types';

const norm = (s: string) => (s || '').trim().toLowerCase();

/** Sortiraj nazive procesa po kanonskom redoslijedu kataloga (nepoznati na kraj, stabilno). */
export function orderByCatalog(names: string[], catalog: Pick<ProcessCatalogItem, 'Name' | 'Order'>[]): string[] {
    const orderOf = new Map(catalog.map(c => [norm(c.Name), c.Order]));
    return names
        .map((name, idx) => ({ name, idx, ord: orderOf.get(norm(name)) ?? Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => a.ord - b.ord || a.idx - b.idx)
        .map(x => x.name);
}

export interface RuleMaterialLite {
    Material_Name?: string;
    Category?: string; // kategorija iz kataloga materijala (ako je poznata pri pozivu)
}

// ════════════════════════════════════════════════════════════════════
// TIPOVI MATERIJALA IZ NAZIVA — kategorije kataloga ("Ploče i trake", "Okovi")
// su preširoke za pravila; tip se izvodi iz NAZIVA ("Iveral U702" → 'iveral').
// patterns = substringovi (norm) koji označavaju tip; prvi pogodak pobjeđuje.
// ════════════════════════════════════════════════════════════════════
export interface MaterialType {
    key: string;      // stabilan ključ (koristi se u pravilima/šablonima)
    label: string;    // prikazni naziv
    patterns: string[];
}
export const MATERIAL_TYPES: MaterialType[] = [
    { key: 'iveral', label: 'Iveral', patterns: ['iveral', 'ivera', 'univer'] },
    { key: 'mdf', label: 'MDF', patterns: ['mdf'] },
    { key: 'furnir', label: 'Furnir', patterns: ['furnir'] },
    { key: 'masiv', label: 'Masiv', patterns: ['masiv'] },
    { key: 'lak', label: 'Lak / boja', patterns: ['lak', 'farb', 'boja'] },
    { key: 'vodilice', label: 'Vodilice', patterns: ['vodilic'] },
    { key: 'sarke', label: 'Šarke', patterns: ['šark', 'sark'] },
    { key: 'rucke', label: 'Ručke', patterns: ['ručk', 'ruck'] },
    { key: 'staklo', label: 'Staklo', patterns: ['staklo', 'plexi'] },
    { key: 'ogledalo', label: 'Ogledalo', patterns: ['ogledal'] },
    { key: 'led', label: 'LED', patterns: ['led'] },
    { key: 'kant', label: 'Kant traka', patterns: ['kant', 'abs'] },
    { key: 'hdf', label: 'HDF / lesonit', patterns: ['hdf', 'lesonit'] },
    { key: 'alu', label: 'Alu', patterns: ['alu'] },
];

/** Tip materijala iz naziva (prvi tip čiji pattern se javlja u nazivu); null ako nijedan. */
export function materialTypeFromName(name: string | undefined): string | null {
    const n = norm(name || '');
    if (!n) return null;
    for (const t of MATERIAL_TYPES) {
        if (t.patterns.some(p => n.includes(p))) return t.key;
    }
    return null;
}

/** Skup tipova prisutnih u sastavnici (distinct, redoslijed po MATERIAL_TYPES). */
export function presentMaterialTypes(materials: RuleMaterialLite[]): string[] {
    const present = new Set<string>();
    for (const m of materials || []) {
        const t = materialTypeFromName(m.Material_Name);
        if (t) present.add(t);
    }
    return MATERIAL_TYPES.map(t => t.key).filter(k => present.has(k));
}

/**
 * Prijedlog plana procesa iz materijala proizvoda po KORISNIKOVIM pravilima.
 * Unija procesa svih pogođenih pravila, redoslijed iz kataloga. Bez pogodaka → [].
 * Zaključak se donosi nad SVIM materijalima zajedno (kombinacije: npr. furnir+mdf → srezivanje iz prese).
 */
export function suggestProcessesFromMaterials(
    materials: RuleMaterialLite[],
    rules: Pick<ProcessMaterialRule, 'Match_Kind' | 'Match_Value' | 'Match_Types' | 'Processes'>[],
    catalog: Pick<ProcessCatalogItem, 'Name' | 'Order'>[]
): string[] {
    if (!materials.length || !rules.length) return [];
    const presentTypes = new Set(presentMaterialTypes(materials));
    const hit = new Map<string, string>(); // normKey → display naziv
    for (const rule of rules) {
        let matches = false;
        if (rule.Match_Kind === 'material_type_combo') {
            const types = (rule.Match_Types || []).filter(Boolean);
            matches = types.length > 0 && types.every(t => presentTypes.has(t));
        } else if (rule.Match_Kind === 'material_type') {
            matches = presentTypes.has(rule.Match_Value);
        } else {
            const mv = norm(rule.Match_Value);
            if (!mv) continue;
            matches = materials.some(m => rule.Match_Kind === 'category'
                ? norm(m.Category || '') === mv
                : norm(m.Material_Name || '').includes(mv));
        }
        if (!matches) continue;
        for (const p of rule.Processes || []) {
            const k = norm(p);
            if (k && !hit.has(k)) hit.set(k, p.trim());
        }
    }
    return orderByCatalog(Array.from(hit.values()), catalog);
}

/** Faza plana: procesi unutar faze teku PARALELNO; sljedeća faza čeka prethodnu. */
export interface ProcessStage {
    processes: string[];
}

/**
 * Normalizuj plan u faze: prioritet Process_Stages; fallback ravni Process_Plan
 * (svaki proces = svoja faza, tj. sekvencijalno). Prazne faze/nazivi se čiste.
 */
export function planToStages(stages?: ProcessStage[] | null, flatPlan?: string[] | null): string[][] {
    const fromStages = (stages || [])
        .map(s => (s?.processes || []).map(p => (p || '').trim()).filter(Boolean))
        .filter(s => s.length > 0);
    if (fromStages.length > 0) return fromStages;
    return (flatPlan || []).map(p => (p || '').trim()).filter(Boolean).map(p => [p]);
}

/** Ravni redoslijed procesa iz faza (za checklist / legacy Process_Plan). */
export function flattenStages(stages: string[][]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const stage of stages) {
        for (const p of stage) {
            const k = norm(p);
            if (k && !seen.has(k)) { seen.add(k); out.push(p.trim()); }
        }
    }
    return out;
}

export interface SynthesisItem {
    itemId: string;
    stages: string[][]; // faze plana proizvoda (unutar faze paralelno)
}

export interface SynthesisResult {
    graph: ProcessGraph;   // bez pozicija — layout radi pozivalac (layoutProcessGraph/layoutColumns)
    warnings: string[];    // ispuštene ivice koje bi zatvorile ciklus
    columns: string[][];   // ID-evi čvorova grupisani po fazi (min faza pojave) → fazni raspored bez veza
}

export interface SynthesisOptions {
    /** false → NE generiši veze (čvorovi bez ivica; korisnik ih ručno povezuje). Default true. */
    includeEdges?: boolean;
}

/** Grupa konsolidacije: `canonical` = prikazni naziv zajedničkog čvora, `members` = originalni nazivi procesa koje spaja. */
export interface ConsolidationGroup {
    canonical: string;
    members: string[];
}
export interface Consolidation {
    groups: ConsolidationGroup[];
}

/** Da li čvor predstavlja dati proces stavke — poklapanje po skupu sinonima (aliases), fallback na `name`. */
export function nodeMatchesProcess(node: { name: string; aliases?: string[] }, processName: string): boolean {
    const k = norm(processName);
    if (!k) return false;
    const names = node.aliases && node.aliases.length ? node.aliases : [node.name];
    return names.some(a => norm(a) === k);
}

/**
 * PER-ČVOR gating toka procesa (autoritet: veze grafa, ne "faze").
 * Čvor je:
 *   - 'done'    ako je sam završen (doneByNodeId),
 *   - 'active'  ako su SVI njegovi DIREKTNI prethodnici završeni (ili ih nema),
 *   - 'blocked' inače.
 * Time se npr. "kantiranje" otvara ČIM je "krojenje" (njegov jedini prethodnik) gotov,
 * umjesto da čeka SVE procese prve faze (dense sinteza je gatela cijelu fazu).
 */
export function computeProcessGating(
    nodeIds: string[],
    edges: { source: string; target: string }[],
    doneByNodeId: Map<string, boolean> | Record<string, boolean>,
): Map<string, 'done' | 'active' | 'blocked'> {
    const isDone = (id: string) => doneByNodeId instanceof Map ? !!doneByNodeId.get(id) : !!doneByNodeId[id];
    const preds = new Map<string, string[]>();
    nodeIds.forEach(id => preds.set(id, []));
    edges.forEach(e => { if (preds.has(e.target)) preds.get(e.target)!.push(e.source); });
    const out = new Map<string, 'done' | 'active' | 'blocked'>();
    for (const id of nodeIds) {
        if (isDone(id)) { out.set(id, 'done'); continue; }
        const ps = preds.get(id) || [];
        out.set(id, ps.every(p => isDone(p)) ? 'active' : 'blocked');
    }
    return out;
}

/**
 * Sinteza grafa naloga iz FAZNIH planova proizvoda:
 * - čvor po normalizovanom nazivu (display = prvi viđeni), itemIds = stavke čiji plan ga sadrži
 * - ivice = SVAKI proces faze N → SVAKI proces faze N+1 (po proizvodu; dedupe preko svih)
 * - cycle-guard: ivica koja bi zatvorila ciklus se ispušta (uz upozorenje)
 *
 * `consolidation` (opciono, iz wizarda): procesi s RAZLIČITIM imenima koji pripadaju istoj grupi
 * spajaju se u JEDAN čvor (ključ = kanonski naziv grupe), a `aliases` čvora pamti sve originalne
 * nazive — da poklapanje statusa/auto-knjiženja po proizvodu ostane tačno.
 */
export function synthesizeOrderGraph(items: SynthesisItem[], consolidation?: Consolidation, opts?: SynthesisOptions): SynthesisResult {
    const includeEdges = opts?.includeEdges !== false;
    const warnings: string[] = [];
    const nodeByKey = new Map<string, ProcessNode>();
    const phaseOf = new Map<string, number>(); // node.id → najranija faza pojave (fazni raspored kolona)
    let seq = 0;

    // norm(originalni naziv) → kanonski naziv grupe (spajanje različitih imena u jedan čvor)
    const canonicalByMember = new Map<string, string>();
    for (const g of consolidation?.groups || []) {
        const canonical = (g.canonical || '').trim();
        if (!canonical) continue;
        for (const m of g.members || []) {
            const mk = norm(m);
            if (mk) canonicalByMember.set(mk, canonical);
        }
    }

    const nodeFor = (name: string): ProcessNode => {
        const canonical = canonicalByMember.get(norm(name)) || name.trim();
        const k = norm(canonical);
        let n = nodeByKey.get(k);
        if (!n) {
            n = { id: `n-${++seq}-${k.replace(/[^a-z0-9]+/g, '-')}`, name: canonical, itemIds: [], aliases: [] };
            nodeByKey.set(k, n);
        }
        // Zapamti originalni naziv kao sinonim (distinct, case-insensitive)
        if (!n.aliases!.some(a => norm(a) === norm(name))) n.aliases!.push(name.trim());
        return n;
    };

    // Čvorovi + pripadnost stavki + najranija faza (za fazni raspored kolona)
    for (const it of items) {
        (it.stages || []).forEach((stage, si) => {
            for (const p of stage) {
                if (!norm(p)) continue;
                const n = nodeFor(p);
                if (!n.itemIds.includes(it.itemId)) n.itemIds.push(it.itemId);
                const cur = phaseOf.get(n.id);
                if (cur === undefined || si < cur) phaseOf.set(n.id, si);
            }
        });
    }

    // Ivice: uzastopni parovi po planu, dedupe; cycle-guard preko dostižnosti
    const edgeKeys = new Set<string>();
    const adj = new Map<string, Set<string>>(); // source → targets
    const reaches = (from: string, to: string): boolean => {
        if (from === to) return true;
        const seen = new Set<string>([from]);
        const stack = [from];
        let found = false;
        while (stack.length && !found) {
            const cur = stack.pop()!;
            (adj.get(cur) || new Set<string>()).forEach(nxt => {
                if (nxt === to) found = true;
                else if (!seen.has(nxt)) { seen.add(nxt); stack.push(nxt); }
            });
        }
        return found;
    };

    const edges: ProcessEdge[] = [];
    if (includeEdges) {
        for (const it of items) {
            const stages = (it.stages || []).map(s => s.filter(p => norm(p))).filter(s => s.length > 0);
            for (let i = 0; i + 1 < stages.length; i++) {
                // svaka→svaka između susjednih faza (paralelni procesi faze se slijevaju u sljedeću)
                for (const pa of stages[i]) {
                    for (const pb of stages[i + 1]) {
                        const a = nodeFor(pa);
                        const b = nodeFor(pb);
                        if (a.id === b.id) continue; // isti proces u susjednim fazama
                        const ek = `${a.id}→${b.id}`;
                        if (edgeKeys.has(ek)) continue;
                        // ivica b→…→a već postoji → a→b bi zatvorila ciklus
                        if (reaches(b.id, a.id)) {
                            warnings.push(`Preskočena veza "${a.name}" → "${b.name}" (kružni redoslijed među proizvodima)`);
                            continue;
                        }
                        edgeKeys.add(ek);
                        if (!adj.has(a.id)) adj.set(a.id, new Set());
                        adj.get(a.id)!.add(b.id);
                        edges.push({ id: `e-${a.id}-${b.id}`, source: a.id, target: b.id });
                    }
                }
            }
        }
    }

    // Kolone po fazama (ID-evi čvorova) — prazne faze se ispuštaju, poredak lijevo→desno očuvan.
    const byPhase = new Map<number, string[]>();
    for (const n of Array.from(nodeByKey.values())) {
        const ph = phaseOf.get(n.id) ?? 0;
        if (!byPhase.has(ph)) byPhase.set(ph, []);
        byPhase.get(ph)!.push(n.id);
    }
    const columns = Array.from(byPhase.keys()).sort((a, b) => a - b).map(k => byPhase.get(k)!);

    return { graph: { nodes: Array.from(nodeByKey.values()), edges }, warnings, columns };
}

// ════════════════════════════════════════════════════════════════════
// MERGE SINTEZE U POSTOJEĆI GRAF — "Sinhronizuj iz proizvoda" bez brisanja
// ručnog rada. Ključ čvora = norm(name). Match → ČUVA prev ID (WorkLog.Process_Node_ID
// referencira ID!) + poziciju, osvježi itemIds/aliases. Synth-only → dodaj. Prev-only →
// zadrži + prijavi stale. Sve prev ivice ostaju; synth ivice se dodaju bez duplikata.
// ════════════════════════════════════════════════════════════════════
export interface GraphMergeResult {
    graph: ProcessGraph;
    addedNodeNames: string[];   // čvorovi dodati iz sinteze (novi u planovima)
    staleNodeNames: string[];   // čvorovi koji postoje ručno ali NISU u planovima proizvoda
}

export function mergeSynthesizedGraph(prev: ProcessGraph, synth: ProcessGraph): GraphMergeResult {
    const prevNodes = prev?.nodes || [];
    const synthNodes = synth?.nodes || [];
    const keyOf = (n: { name: string }) => norm(n.name);

    const prevByKey = new Map(prevNodes.map(n => [keyOf(n), n]));
    const synthByKey = new Map(synthNodes.map(n => [keyOf(n), n]));

    const outNodes: ProcessNode[] = [];
    const idByKey = new Map<string, string>();          // norm(name) → node.id (za remap ivica)
    const addedNodeNames: string[] = [];
    const staleNodeNames: string[] = [];

    // 1) Postojeći čvorovi: zadrži ID + poziciju; ako ima synth pandan, osvježi itemIds/aliases.
    for (const p of prevNodes) {
        const k = keyOf(p);
        const s = synthByKey.get(k);
        const merged: ProcessNode = { ...p };
        if (s) {
            merged.itemIds = Array.from(new Set([...(p.itemIds || []), ...(s.itemIds || [])]));
            const aliasSet = new Map<string, string>();
            [...(p.aliases || [p.name]), ...(s.aliases || [s.name])].forEach(a => {
                const ak = norm(a); if (ak && !aliasSet.has(ak)) aliasSet.set(ak, a.trim());
            });
            merged.aliases = Array.from(aliasSet.values());
        } else {
            staleNodeNames.push(p.name);
        }
        outNodes.push(merged);
        idByKey.set(k, merged.id);
    }
    // 2) Synth-only čvorovi: dodaj kako jesu (novi ID iz sinteze).
    for (const s of synthNodes) {
        const k = keyOf(s);
        if (prevByKey.has(k)) continue;
        outNodes.push({ ...s });
        idByKey.set(k, s.id);
        addedNodeNames.push(s.name);
    }

    // 3) Ivice: sve prev ivice (endpointi uvijek prežive) + synth ivice remapovane na preživjele ID-eve.
    const edgeKeys = new Set<string>();
    const outEdges: ProcessEdge[] = [];
    const pushEdge = (source: string, target: string) => {
        if (!source || !target || source === target) return;
        const ek = `${source}→${target}`;
        if (edgeKeys.has(ek)) return;
        edgeKeys.add(ek);
        outEdges.push({ id: `e-${source}-${target}`, source, target });
    };
    for (const e of prev?.edges || []) pushEdge(e.source, e.target);
    // synth ivice: mapiraj synth node.id → key → preživjeli id
    const synthIdToKey = new Map(synthNodes.map(n => [n.id, keyOf(n)]));
    for (const e of synth?.edges || []) {
        const sk = synthIdToKey.get(e.source); const tk = synthIdToKey.get(e.target);
        if (!sk || !tk) continue;
        const sid = idByKey.get(sk); const tid = idByKey.get(tk);
        if (sid && tid) pushEdge(sid, tid);
    }

    return { graph: { nodes: outNodes, edges: outEdges }, addedNodeNames, staleNodeNames };
}

// ════════════════════════════════════════════════════════════════════
// KOMPOZITNI ŠABLONI — spajanje više šablona u isti plan/graf ("canvas").
// ════════════════════════════════════════════════════════════════════

/**
 * Dodaj faze šablona NA KRAJ postojećeg plana (append). Procesi koji već postoje
 * u planu (bilo kojoj fazi) se preskaču (dedupe po normalizovanom imenu); prazne
 * faze ispadaju. Omogućava slaganje više šablona u jedan plan proizvoda.
 */
export function appendStagesTemplate(currentStages: string[][], templateStages: string[][]): string[][] {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const stage of currentStages || []) {
        const kept = (stage || []).map(p => p.trim()).filter(p => { const k = norm(p); if (!k || seen.has(k)) return false; seen.add(k); return true; });
        if (kept.length) out.push(kept);
    }
    for (const stage of templateStages || []) {
        const kept = (stage || []).map(p => p.trim()).filter(p => { const k = norm(p); if (!k || seen.has(k)) return false; seen.add(k); return true; });
        if (kept.length) out.push(kept);
    }
    return out;
}

/**
 * Aditivni import FLOW šablona u postojeći graf ("dodaj u graf"):
 *  - čvor šablona čije norm ime VEĆ postoji → koristi postojeći (endpoint za ivice), ne duplira;
 *  - novi čvorovi šablona dobijaju nove ID-eve, pozicije offsetovane ISPOD postojećeg sadržaja;
 *  - ivice remapovane; duplikati (source,target) preskočeni.
 */
export function mergeFlowTemplateIntoGraph(
    graph: ProcessGraph,
    template: { nodes: { id: string; name: string; position?: { x: number; y: number } }[]; edges: ProcessEdge[] }
): GraphMergeResult {
    const nodes: ProcessNode[] = (graph?.nodes || []).map(n => ({ ...n }));
    const idByKey = new Map<string, string>(nodes.map(n => [norm(n.name), n.id]));
    // Offset ispod postojećeg sadržaja (bounding box + margina).
    const maxY = nodes.reduce((m, n) => Math.max(m, (n.position?.y ?? 0)), 0);
    const offsetY = nodes.length ? maxY + 140 : 0;
    let seq = 0;
    const tplIdToNodeId = new Map<string, string>();
    const addedNodeNames: string[] = [];

    for (const t of template?.nodes || []) {
        const nm = (t.name || '').trim();
        const k = norm(nm);
        if (!k) continue;
        const existing = idByKey.get(k);
        if (existing) { tplIdToNodeId.set(t.id, existing); continue; }
        const id = `tpl-${++seq}-${k.replace(/[^a-z0-9]+/g, '-')}`;
        nodes.push({ id, name: nm, itemIds: [], aliases: [nm], position: { x: (t.position?.x ?? 24), y: (t.position?.y ?? 24) + offsetY } });
        idByKey.set(k, id);
        tplIdToNodeId.set(t.id, id);
        addedNodeNames.push(nm);
    }

    const edgeKeys = new Set<string>();
    const edges: ProcessEdge[] = [];
    const pushEdge = (source: string, target: string) => {
        if (!source || !target || source === target) return;
        const ek = `${source}→${target}`;
        if (edgeKeys.has(ek)) return;
        edgeKeys.add(ek); edges.push({ id: `e-${source}-${target}`, source, target });
    };
    for (const e of graph?.edges || []) pushEdge(e.source, e.target);
    for (const e of template?.edges || []) {
        const s = tplIdToNodeId.get(e.source); const t = tplIdToNodeId.get(e.target);
        if (s && t) pushEdge(s, t);
    }
    return { graph: { nodes, edges }, addedNodeNames, staleNodeNames: [] };
}

export interface ItemProcessLite {
    Process_Name: string;
    Status?: string;
}

/** Tekući proces proizvoda = prvi u checklisti koji NIJE 'Završeno' (null = sve završeno/prazno). */
export function currentProcessName(itemProcesses: ItemProcessLite[] | undefined): string | null {
    for (const p of itemProcesses || []) {
        if (p.Process_Name && p.Status !== 'Završeno') return p.Process_Name;
    }
    return null;
}

/**
 * Auto-pripis: čvor grafa za dnevnicu bez ručnog izbora —
 * čvor koji POKRIVA stavku (itemIds sadrži ili prazan = svi) i čiji naziv == tekući proces stavke.
 * Nema kandidata → null (ništa se ne upisuje).
 */
export function resolveAutoProcessNode(
    graph: ProcessGraph | undefined,
    itemId: string,
    itemProcesses: ItemProcessLite[] | undefined
): ProcessNode | null {
    if (!graph || !graph.nodes?.length) return null;
    const current = currentProcessName(itemProcesses);
    if (!current) return null;
    return graph.nodes.find(n =>
        nodeMatchesProcess(n, current) && ((n.itemIds || []).length === 0 || n.itemIds.includes(itemId))
    ) || null;
}

// ════════════════════════════════════════════════════════════════════
// FAZNO PRAĆENJE u nalogu: grupiši žive procese (ItemProcessStatus) po fazama
// plana proizvoda; procesi kojih nema u planu (dodati u toku) → `extra`.
// ════════════════════════════════════════════════════════════════════

/**
 * Rasporedi procese stavke naloga u faze prema `stages` (nazivi po fazi).
 * Match po nazivu (case-insensitive). Procesi van plana → `extra`.
 */
export function groupProcessesByStage<T extends { Process_Name: string }>(
    processes: T[],
    stages: string[][]
): { stageGroups: T[][]; extra: T[] } {
    const byName = new Map<string, T>();
    for (const p of processes) {
        const k = norm(p.Process_Name);
        if (k && !byName.has(k)) byName.set(k, p);
    }
    const used = new Set<string>();
    const stageGroups: T[][] = (stages || []).map(stage => {
        const group: T[] = [];
        for (const name of stage) {
            const k = norm(name);
            const proc = byName.get(k);
            if (proc && !used.has(k)) { group.push(proc); used.add(k); }
        }
        return group;
    });
    const extra: T[] = [];
    for (const p of processes) {
        const k = norm(p.Process_Name);
        if (k && !used.has(k)) { extra.push(p); used.add(k); }
    }
    return { stageGroups, extra };
}

/** Indeks PRVE faze koja NIJE cijela 'Završeno' (prazne faze se preskaču). −1 = sve gotovo. */
export function currentStageIndex(groups: { Status?: string }[][]): number {
    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        if (!g || g.length === 0) continue;
        if (!g.every(p => p.Status === 'Završeno')) return i;
    }
    return -1;
}

/** Nezavršeni procesi tekuće faze (mogu paralelno) = „gdje nastaviti". */
export function nextProcessNames(groups: { Process_Name: string; Status?: string }[][]): string[] {
    const idx = currentStageIndex(groups);
    if (idx < 0) return [];
    return groups[idx].filter(p => p.Status !== 'Završeno').map(p => p.Process_Name);
}

/**
 * Derivacija statusa STAVKE iz procesa, s podom 'U toku' za pokrenute stavke:
 * pokrenuta stavka (startedAt / knjižen rad) NIKAD ne regresira na 'Na čekanju'
 * kad se proces vrati iz 'U toku' — regresija bi kaskadno gasila status naloga,
 * a šihtarica auto-knjiži samo na aktivne naloge.
 */
export function deriveItemStatus(
    processes: { Status?: string }[],
    startedAt?: string | null
): 'Na čekanju' | 'U toku' | 'Završeno' {
    const list = processes || [];
    const allCompleted = list.length > 0 && list.every(p => p.Status === 'Završeno');
    if (allCompleted) return 'Završeno';
    const anyInProgress = list.some(p => p.Status === 'U toku');
    if (anyInProgress || startedAt) return 'U toku';
    return 'Na čekanju';
}
