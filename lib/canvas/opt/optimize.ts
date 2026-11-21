// ════════════════════════════════════════════════════════════════════
// PLATNO · OPTIMIZATOR v2 — lista prioriteta + lokalna pretraga
//
// Raspored = dekodirana lista prioriteta (sgs.ts). Traži se lista (i po potrebi
// ekipa po poslu) čiji raspored ima najbolji LEKSIKOGRAFSKI cilj iz ocjene
// (evaluate.ts): izvodljivost → sve gotovo → hitno → visok prioritet → rokovi →
// par ostaje na projektu → što manje pomjeranja u odnosu na plan na platnu.
//
//   1. Početne liste: po prioritetu i projektu, po redu s platna, po najdužem
//      ostatku lanca (repu), i sam plan s platna (njegov red i njegove ekipe).
//      Uzima se najbolja — preračun zato ne može biti lošiji od postojećeg plana.
//   2. Lokalna pretraga (prvo poboljšanje): pomjeri posao u listi naprijed/nazad,
//      zamijeni ekipu poslu s više kandidata. Prihvata se samo strogo bolji cilj.
//   3. Staje kad prolaz ništa ne popravi ili kad se potroši budžet dekodiranja.
//      Bez slučajnosti i bez sata: isti ulaz → isti prijedlog.
//
// Uz rezultat ide i rezerva (koliko posao smije kasniti a da kraj plana ostane
// isti) i objašnjenje po poslu. Ništa se ne primjenjuje — ovo je prijedlog.
//
// jest: lib/__tests__/platnoOptimizator.test.ts
// ════════════════════════════════════════════════════════════════════

import type { Instance, Job } from './instance';
import { crewCapacity, dayIndex, isoAt } from './instance';
import { compareObjectives, evaluate, type Evaluation, type Placement } from './evaluate';
import { Decoder, type Decoded } from './sgs';

const RANK: Record<Job['priority'], number> = { urgent: 4, high: 3, medium: 2, low: 1 };

export interface OptimizeOptions {
    /** Najviše dekodiranja (≈ vrijeme). Zadano 1200. */
    budget?: number;
}

export interface JobSlack {
    /** Radnih dana ekipe koliko posao smije kasniti bez pomjeranja kraja plana. */
    slackDays: number;
    critical: boolean;
}

export interface OptimizeResult {
    placements: Placement[];
    evaluation: Evaluation;
    decoded: Decoded;
    slack: Map<string, JobSlack>;
    /** Koliko je rasporeda isprobano. */
    evals: number;
    /** Ocjena početne (najbolje početne liste) i konačne — da se vidi šta je pretraga dala. */
    initialObjective: Evaluation['objective'];
}

/** Rep: najduži lanac (dani najbrže ekipe) od posla do kraja preko veza. */
function tails(inst: Instance): Map<string, number> {
    const succ = new Map<string, { to: string; lag: number }[]>();
    for (const p of inst.precedence) succ.set(p.from, [...(succ.get(p.from) || []), { to: p.to, lag: p.lagDays }]);
    const dur = (j: Job) => Math.min(...j.crews.map(k => j.workerDays / (inst.crews.get(k)?.workerIds.length || 1)), j.workerDays || 0);
    const byId = new Map(inst.jobs.map(j => [j.id, j]));
    const memo = new Map<string, number>();
    const visit = (id: string, depth: number): number => {
        if (memo.has(id)) return memo.get(id)!;
        const j = byId.get(id);
        if (!j || depth > 200) return 0;
        const t = dur(j) + Math.max(0, ...(succ.get(id) || []).map(s => s.lag + visit(s.to, depth + 1)));
        memo.set(id, t);
        return t;
    };
    inst.jobs.forEach(j => visit(j.id, 0));
    return memo;
}

function initialOrders(inst: Instance, movable: Job[], current: Map<string, Placement>): string[][] {
    const tail = tails(inst);
    const projRank = new Map<string, number>();
    const projStart = new Map<string, string>();
    for (const j of movable) {
        projRank.set(j.projectKey, Math.max(projRank.get(j.projectKey) || 0, RANK[j.priority]));
        const s = current.get(j.id)?.startISO || '9999';
        if (s < (projStart.get(j.projectKey) || '9999')) projStart.set(j.projectKey, s);
    }
    const cur = (j: Job) => current.get(j.id)?.startISO || '9999';
    const byPriority = movable.slice().sort((a, b) =>
        RANK[b.priority] - RANK[a.priority]
        || (projRank.get(b.projectKey)! - projRank.get(a.projectKey)!)
        || (projStart.get(a.projectKey)!).localeCompare(projStart.get(b.projectKey)!)
        || a.projectKey.localeCompare(b.projectKey)
        || (tail.get(b.id)! - tail.get(a.id)!)
        || a.id.localeCompare(b.id));
    const byCanvas = movable.slice().sort((a, b) => cur(a).localeCompare(cur(b)) || a.id.localeCompare(b.id));
    const byTail = movable.slice().sort((a, b) => (tail.get(b.id)! - tail.get(a.id)!) || RANK[b.priority] - RANK[a.priority] || a.id.localeCompare(b.id));
    return [byPriority, byCanvas, byTail].map(l => l.map(j => j.id));
}

/** Pomjeri element s pozicije i na poziciju j (vraća novu listu). */
function moved(order: string[], i: number, j: number): string[] {
    const out = order.slice();
    const [x] = out.splice(i, 1);
    out.splice(j, 0, x);
    return out;
}

/** Optimizator kao generator: daje broj isprobanih rasporeda poslije svakog — da UI može disati. */
export function* optimizeSteps(inst: Instance, current: Placement[], movableIds: Set<string>, opts: OptimizeOptions = {}): Generator<number, OptimizeResult, void> {
    const budget = opts.budget ?? 1200;
    const fixed = current.filter(p => !movableIds.has(p.jobId));
    const decoder = new Decoder(inst, fixed, movableIds);
    const curById = new Map(current.map(p => [p.jobId, p]));
    let evals = 0;

    const run = (order: string[], forced: Map<string, string>) => {
        evals++;
        const decoded = decoder.decode(order, forced);
        return { order, forced, decoded, evaluation: evaluate(inst, decoded.placements, current) };
    };
    type Cand = ReturnType<typeof run>;
    const better = (a: Cand, b: Cand) => compareObjectives(a.evaluation.objective, b.evaluation.objective) < 0;

    let best: Cand | null = null;
    for (const order of initialOrders(inst, decoder.movable, curById)) {
        const c = run(order, new Map());
        yield evals;
        if (!best || better(c, best)) best = c;
    }
    // Plan s platna kao početna tačka: redom kojim nalozi počinju, s ekipama koje sad imaju.
    // Dekoder ga složi najranije moguće, pa preračun nikad nije lošiji od postojećeg plana
    // (osim kad je postojeći plan neizvodljiv — tad ga dekoder popravi).
    {
        const forced = new Map<string, string>();
        for (const j of decoder.movable) {
            const k = curById.get(j.id)?.crewKey;
            if (k && j.crews.includes(k)) forced.set(j.id, k);
        }
        const order = decoder.movable.slice()
            .sort((a, b) => (curById.get(a.id)?.startISO || '9999').localeCompare(curById.get(b.id)?.startISO || '9999')
                || Number(!!curById.get(a.id)?.startsPM) - Number(!!curById.get(b.id)?.startsPM)
                || a.id.localeCompare(b.id))
            .map(j => j.id);
        const c = run(order, forced);
        yield evals;
        if (!best || better(c, best)) best = c;
    }
    if (!best) {
        const decoded = decoder.decode([]);
        const evaluation = evaluate(inst, decoded.placements, current);
        return { placements: decoded.placements, evaluation, decoded, slack: new Map(), evals, initialObjective: evaluation.objective };
    }
    const initialObjective = best.evaluation.objective;

    const n = best.order.length;
    const STEPS = [-1, 1, -2, 2, -4, 4, -8, 8, -16, 16];
    let improved = true;
    while (improved && evals < budget) {
        improved = false;
        for (let i = 0; i < n && evals < budget; i++) {
            const id = best.order[i];
            // a) premjesti u listi
            for (const s of STEPS) {
                const j = i + s;
                if (j < 0 || j >= n || evals >= budget) continue;
                const c = run(moved(best.order, i, j), best.forced);
                yield evals;
                if (better(c, best)) { best = c; improved = true; break; }
            }
            // b) druga ekipa
            const job = decoder.movable.find(x => x.id === id);
            const chosen = best.decoded.placements.find(p => p.jobId === id)?.crewKey;
            for (const k of job?.crews || []) {
                if (k === chosen || evals >= budget) continue;
                const forced = new Map(best.forced);
                forced.set(id, k);
                const c = run(best.order, forced);
                yield evals;
                if (better(c, best)) { best = c; improved = true; }
            }
        }
    }

    return {
        placements: best.decoded.placements,
        evaluation: best.evaluation,
        decoded: best.decoded,
        slack: slackOf(inst, best.decoded.placements, movableIds),
        evals,
        initialObjective,
    };
}

export function optimize(inst: Instance, current: Placement[], movableIds: Set<string>, opts: OptimizeOptions = {}): OptimizeResult {
    const gen = optimizeSteps(inst, current, movableIds, opts);
    for (;;) {
        const r = gen.next();
        if (r.done) return r.value;
    }
}

/**
 * Isto kao optimize, ali svakih `chunk` rasporeda pusti preglednik (setTimeout 0) — dugme i
 * ekran ostaju živi. Rezultat je identičan sinhronom (budžet je broj rasporeda, ne vrijeme).
 */
export async function optimizeAsync(inst: Instance, current: Placement[], movableIds: Set<string>, opts: OptimizeOptions & { chunk?: number; onProgress?: (evals: number, budget: number) => void } = {}): Promise<OptimizeResult> {
    const gen = optimizeSteps(inst, current, movableIds, opts);
    const chunk = opts.chunk ?? 40;
    let i = 0;
    for (;;) {
        const r = gen.next();
        if (r.done) return r.value;
        if (++i % chunk === 0) {
            opts.onProgress?.(r.value, opts.budget ?? 1200);
            await new Promise(res => setTimeout(res, 0));
        }
    }
}

/**
 * Rezerva po poslu: koliko radnih dana ekipe posao smije kasniti a da se ne pomjeri
 * kraj plana, uz isti redoslijed (prethodnost + sljedeći posao istih radnika).
 */
export function slackOf(inst: Instance, placements: Placement[], movableIds?: Set<string>): Map<string, JobSlack> {
    const out = new Map<string, JobSlack>();
    const P = placements.filter(p => p.crewKey);
    const s = (p: Placement) => dayIndex(inst.startISO, p.startISO);
    const e = (p: Placement) => dayIndex(inst.startISO, p.endISO);
    const M = Math.max(-1, ...P.map(e));
    const ws = (p: Placement) => inst.crews.get(p.crewKey!)?.workerIds || p.crewKey!.split('+');
    const succ = new Map<string, { to: string; lag: number }[]>();
    for (const pr of inst.precedence) succ.set(pr.from, [...(succ.get(pr.from) || []), { to: pr.to, lag: pr.lagDays }]);
    const byId = new Map(P.map(p => [p.jobId, p]));
    const LS = new Map<string, number>();     // najkasniji početak (dan)
    const sorted = P.slice().sort((a, b) => s(b) - s(a) || e(b) - e(a));
    for (const p of sorted) {
        let lf = M;
        for (const x of succ.get(p.jobId) || []) {
            const k = byId.get(x.to);
            if (k && LS.has(k.jobId)) lf = Math.min(lf, LS.get(k.jobId)! - 1 - x.lag);
        }
        const mine = new Set(ws(p));
        for (const k of P) {
            if (k === p || !LS.has(k.jobId) || s(k) < e(p) || (s(k) === e(p) && !(k.startsPM && p.endsAM))) continue;
            if (!ws(k).some(w => mine.has(w))) continue;
            lf = Math.min(lf, s(k) === e(p) ? LS.get(k.jobId)! : LS.get(k.jobId)! - 1);
        }
        lf = Math.max(lf, e(p));
        LS.set(p.jobId, s(p) + (lf - e(p)));
        let days = 0;
        for (let d = e(p) + 1; d <= lf; d++) if (crewCapacity(inst, p.crewKey!, isoAt(inst.startISO, d)) > 0) days++;
        if (!movableIds || movableIds.has(p.jobId)) out.set(p.jobId, { slackDays: days, critical: days === 0 });
    }
    return out;
}
