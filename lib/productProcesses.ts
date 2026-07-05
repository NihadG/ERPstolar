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

/**
 * Prijedlog plana procesa iz materijala proizvoda po KORISNIKOVIM pravilima.
 * Unija procesa svih pogođenih pravila, redoslijed iz kataloga. Bez pogodaka → [].
 */
export function suggestProcessesFromMaterials(
    materials: RuleMaterialLite[],
    rules: Pick<ProcessMaterialRule, 'Match_Kind' | 'Match_Value' | 'Processes'>[],
    catalog: Pick<ProcessCatalogItem, 'Name' | 'Order'>[]
): string[] {
    if (!materials.length || !rules.length) return [];
    const hit = new Map<string, string>(); // normKey → display naziv
    for (const rule of rules) {
        const mv = norm(rule.Match_Value);
        if (!mv) continue;
        const matches = materials.some(m => rule.Match_Kind === 'category'
            ? norm(m.Category || '') === mv
            : norm(m.Material_Name || '').includes(mv));
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
    graph: ProcessGraph;   // bez pozicija — layout radi pozivalac (layoutProcessGraph)
    warnings: string[];    // ispuštene ivice koje bi zatvorile ciklus
}

/**
 * Sinteza grafa naloga iz FAZNIH planova proizvoda:
 * - čvor po normalizovanom nazivu (display = prvi viđeni), itemIds = stavke čiji plan ga sadrži
 * - ivice = SVAKI proces faze N → SVAKI proces faze N+1 (po proizvodu; dedupe preko svih)
 * - cycle-guard: ivica koja bi zatvorila ciklus se ispušta (uz upozorenje)
 */
export function synthesizeOrderGraph(items: SynthesisItem[]): SynthesisResult {
    const warnings: string[] = [];
    const nodeByKey = new Map<string, ProcessNode>();
    let seq = 0;
    const nodeFor = (name: string): ProcessNode => {
        const k = norm(name);
        let n = nodeByKey.get(k);
        if (!n) {
            n = { id: `n-${++seq}-${k.replace(/[^a-z0-9]+/g, '-')}`, name: name.trim(), itemIds: [] };
            nodeByKey.set(k, n);
        }
        return n;
    };

    // Čvorovi + pripadnost stavki
    for (const it of items) {
        for (const stage of it.stages || []) {
            for (const p of stage) {
                if (!norm(p)) continue;
                const n = nodeFor(p);
                if (!n.itemIds.includes(it.itemId)) n.itemIds.push(it.itemId);
            }
        }
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

    return { graph: { nodes: Array.from(nodeByKey.values()), edges }, warnings };
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
    const ck = norm(current);
    return graph.nodes.find(n =>
        norm(n.name) === ck && ((n.itemIds || []).length === 0 || n.itemIds.includes(itemId))
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
