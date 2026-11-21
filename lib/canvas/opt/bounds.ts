// ════════════════════════════════════════════════════════════════════
// PLATNO · MODEL RASPOREDA — DONJE GRANICE (dokaz kvaliteta plana)
//
// Najraniji kraj koji NIJEDAN plan ne može postići, uz razlog. Plan se onda
// mjeri prema granici („gotovo 13.1., najranije moguće 11.1."), pa je vidljivo
// koliko je blizu najboljeg — bez obećanja koje se ne može provjeriti.
//
// Svaka granica je opuštanje problema (izbaci se dio ograničenja, ostatak se
// riješi tačno), pa je zaista donja:
//
//   job      jedan posao sam, s najbržom ekipom, od najranijeg početka
//   chain    lanac prethodnosti (svaki posao sam, ali redom veza)
//   crew-set skup ekipa S: posao koji mogu raditi SAMO ekipe iz S (svi kandidati
//            u S) mora stati u radnik-dane radnika iz S — Hallov uslov iz teorije
//            raspoređivanja; za S = jedna ekipa to je „Kemo i Rijad sami imaju
//            32 dana posla", za S = sve ekipe ukupni kapacitet radionice
//   locked   zaključani posao završava kad završava
//
// Kapacitet je stvarni kalendar radnika (smjene, praznici, odsustva), umanjen
// za fiksno opterećenje. Ostali poslovi se ignorišu — zato je granica donja.
// ════════════════════════════════════════════════════════════════════

import type { Instance, Job } from './instance';
import { crewCapacity, crewDays, dayIndex, freeCapacity, isoAt } from './instance';
import type { Placement } from './evaluate';

export type BoundKind = 'job' | 'chain' | 'crew-set' | 'locked';

export interface Bound {
    kind: BoundKind;
    /** Indeks dana od početka plana; posao ne može završiti PRIJE ovog dana. */
    day: number;
    iso: string;
    text: string;
}

export interface BoundsResult {
    makespan: Bound | null;
    /** Granica za kraj hitnih / visokih (cilj 2). */
    urgent: Bound | null;
    high: Bound | null;
    all: Bound[];
}

const EPS = 1e-6;
const RANK: Record<Job['priority'], number> = { urgent: 4, high: 3, medium: 2, low: 1 };
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Najraniji dan kad zbir kapaciteta od `from` dostigne `amount` (null = ne stane u horizont). */
function earliestFinish(inst: Instance, cap: (iso: string) => number, from: number, amount: number): number | null {
    if (amount <= EPS) return Math.max(0, from);
    let acc = 0;
    for (let d = Math.max(0, from); d <= inst.horizonDays; d++) {
        acc += cap(isoAt(inst.startISO, d));
        if (acc >= amount - EPS) return d;
    }
    return null;
}

function jobFinish(inst: Instance, job: Job, from: number): number | null {
    if (!job.crews.length) return null;
    if (job.divisible) {
        const workers = Array.from(new Set(job.crews.flatMap(k => inst.crews.get(k)?.workerIds || [])));
        return earliestFinish(inst, iso => workers.reduce((s, w) => s + freeCapacity(inst, w, iso), 0), from, job.workerDays);
    }
    let best: number | null = null;
    for (const k of job.crews) {
        const f = earliestFinish(inst, iso => crewCapacity(inst, k, iso), from, crewDays(inst, job, k));
        if (f !== null && (best === null || f < best)) best = f;
    }
    return best;
}

const releaseDay = (inst: Instance, job: Job) => (job.releaseISO ? Math.max(0, dayIndex(inst.startISO, job.releaseISO)) : 0);

function bound(inst: Instance, kind: BoundKind, day: number, text: (iso: string) => string): Bound {
    const iso = isoAt(inst.startISO, day);
    return { kind, day, iso, text: text(iso) };
}

/** Granice za skup poslova (svi otključani, ili samo jedan prioritet). */
function boundsFor(inst: Instance, jobs: Job[], lockedEnd: Map<string, number>): Bound[] {
    const out: Bound[] = [];
    const ids = new Set(jobs.map(j => j.id));

    // job + chain (topološki, Kahn; ciklus → preostali bez lanca)
    const preds = new Map<string, { from: string; lag: number }[]>();
    for (const p of inst.precedence) preds.set(p.to, [...(preds.get(p.to) || []), { from: p.from, lag: p.lagDays }]);
    const all = inst.jobs.filter(j => !j.locked);
    const ef = new Map<string, number>(lockedEnd);
    const indeg = new Map(all.map(j => [j.id, (preds.get(j.id) || []).filter(p => all.some(a => a.id === p.from)).length]));
    const queue = all.filter(j => indeg.get(j.id) === 0);
    const done = new Set<string>();
    while (queue.length) {
        const j = queue.shift()!;
        done.add(j.id);
        let from = releaseDay(inst, j);
        for (const p of preds.get(j.id) || []) {
            const e = ef.get(p.from);
            if (e !== undefined) from = Math.max(from, e + p.lag + 1);
        }
        const solo = jobFinish(inst, j, releaseDay(inst, j));
        const f = jobFinish(inst, j, from);
        if (f !== null) ef.set(j.id, f);
        if (ids.has(j.id)) {
            if (solo !== null) out.push(bound(inst, 'job', solo, iso => `${j.title}: i sam, s najbržom ekipom, traje najranije do ${dm(iso)}`));
            if (f !== null && solo !== null && f > solo) out.push(bound(inst, 'chain', f, iso => `${j.title}: čeka prethodne korake, najranije do ${dm(iso)}`));
        }
        for (const p of inst.precedence) {
            if (p.from !== j.id || !indeg.has(p.to)) continue;
            indeg.set(p.to, indeg.get(p.to)! - 1);
            if (indeg.get(p.to) === 0) queue.push(all.find(a => a.id === p.to)!);
        }
    }

    // crew-set (Hall): sve kombinacije ekipa dok ih je ≤ 14, inače pojedinačne, po poslu i sve
    const keys = Array.from(new Set(jobs.flatMap(j => j.crews)));
    const sets: string[][] = [];
    if (keys.length <= 14) {
        for (let m = 1; m < 1 << keys.length; m++) sets.push(keys.filter((_, i) => m & (1 << i)));
    } else {
        keys.forEach(k => sets.push([k]));
        jobs.forEach(j => sets.push(j.crews));
        sets.push(keys);
    }
    for (const S of sets) {
        const inS = new Set(S);
        const J = jobs.filter(j => j.crews.length && j.crews.every(k => inS.has(k)));
        const W = J.reduce((s, j) => s + j.workerDays, 0);
        if (W <= EPS) continue;
        const workers = Array.from(new Set(S.flatMap(k => inst.crews.get(k)?.workerIds || [])));
        const from = Math.min(...J.map(j => releaseDay(inst, j)));
        const f = earliestFinish(inst, iso => workers.reduce((s, w) => s + freeCapacity(inst, w, iso), 0), from, W);
        if (f === null) continue;
        const labels = S.map(k => inst.crews.get(k)?.label || k);
        const who = S.length === keys.length && keys.length > 1 ? `Sve ekipe zajedno` : S.length === 1 ? labels[0] : labels.join(', ');
        const only = S.length === keys.length && keys.length > 1 ? 'posla ukupno' : S.length === 1 ? 'posla koji mogu samo oni' : 'posla koji može samo ova grupa';
        out.push(bound(inst, 'crew-set', f, iso => `${who}: ${r1(W)} radnik-dana ${only} → najranije ${dm(iso)}`));
    }
    return out;
}

/** Najjača (najkasnija) granica; kod jednakih ona s užim razlogom (ekipa prije zbira). */
function strongest(list: Bound[]): Bound | null {
    const order: BoundKind[] = ['crew-set', 'chain', 'job', 'locked'];
    return list.slice().sort((a, b) => b.day - a.day || order.indexOf(a.kind) - order.indexOf(b.kind) || a.text.length - b.text.length)[0] || null;
}

export function lowerBounds(inst: Instance, placements: Placement[] = []): BoundsResult {
    const lockedEnd = new Map<string, number>();
    for (const p of placements) {
        const job = inst.jobs.find(j => j.id === p.jobId);
        if (!job?.locked) continue;
        lockedEnd.set(job.id, Math.max(lockedEnd.get(job.id) ?? -1, dayIndex(inst.startISO, p.endISO)));
    }
    const open = inst.jobs.filter(j => !j.locked);
    const all = boundsFor(inst, open, lockedEnd);
    for (const [id, d] of lockedEnd) {
        const j = inst.jobs.find(x => x.id === id)!;
        all.push(bound(inst, 'locked', d, iso => `${j.title}: zaključan do ${dm(iso)}`));
    }
    const byRank = (r: number) => strongest(boundsFor(inst, open.filter(j => RANK[j.priority] === r), lockedEnd));
    return { makespan: strongest(all), urgent: byRank(4), high: byRank(3), all };
}
