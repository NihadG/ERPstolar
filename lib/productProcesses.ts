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
