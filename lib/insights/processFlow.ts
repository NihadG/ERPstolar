// ════════════════════════════════════════════════════════════════════
// TOK PROCESA KROZ POGON — gdje se stvarno gubi vrijeme.
//
// U pogonu ovog tipa ČEKANJE je po pravilu veći dio proteklog vremena od samog
// rada. Rad se planira, čekanje se ne planira — pa se ni ne vidi. Ovaj modul ga
// mjeri: po svakom prelazu A→B, koliko se čekalo i koliko je prošlo od kraja do kraja.
//
// Usko grlo NIJE proces koji najduže traje, nego onaj ISPRED kojeg se najviše čeka.
// Zato se rang uskih grla računa po UKUPNOM čekanju (medijan × broj pojava),
// ne po trajanju procesa.
// ════════════════════════════════════════════════════════════════════

import type { ProductionSnapshot } from '../types';
import { distribution, round2, type Dist } from './stats';
import { dedupeProcessKey } from '../orderProcessRows';

export interface TransitionStat {
    from: string;
    to: string;
    n: number;
    /** Čekanje između procesa (dani). Ovo je mrtvo vrijeme. */
    waitDays: Dist;
    /** Od kraja prvog do kraja drugog procesa (dani). */
    endToEndDays: Dist | null;
    /** Koliko puta je veza došla iz grafa, a koliko iz STVARNOG redoslijeda. */
    fromGraph: number;
    fromObserved: number;
    /** Koliko su se puta procesi preklapali (radilo se paralelno). */
    overlapped: number;
    /** medijan × n — mjera ukupnog gubitka, osnov za rang uskih grla. */
    totalWaitDays: number;
}

export interface ProcessStat {
    name: string;
    n: number;                  // na koliko naloga
    workerDays: Dist;           // stvarni rad
    spanDays: Dist | null;      // kalendarski raspon (uključuje prekide)
    /** workerDays.p50 / spanDays.p50 — koliko je proces „zbijen" kad se radi. */
    density: number | null;
}

export interface FlowSummary {
    orders: number;
    leadDays: Dist | null;
    touchDays: Dist | null;
    /** Udio proteklih dana u kojima se stvarno radilo. Nisko = puno čekanja. */
    flowEfficiency: Dist | null;
    processes: ProcessStat[];
    transitions: TransitionStat[];
    /** Prelazi sortirani po ukupnom čekanju — prvi je najveće usko grlo. */
    bottlenecks: TransitionStat[];
    /** Prelazi koje graf NEMA, a stvarno se dešavaju — graf je kriv ili se improvizuje. */
    undocumented: TransitionStat[];
    skippedLegacy: number;
}

/** Naziv procesa se normalizuje isto kao svugdje (nevidljivi znakovi, dijakritika). */
const key = (s: string) => dedupeProcessKey(s || '');

export function buildFlowSummary(snapshots: ProductionSnapshot[]): FlowSummary {
    let skippedLegacy = 0;
    let orders = 0;

    const leadDays: number[] = [];
    const touchDays: number[] = [];
    const flowEff: number[] = [];

    const procAcc = new Map<string, { label: string; work: number[]; span: number[]; orders: Set<string> }>();
    const transAcc = new Map<string, {
        from: string; to: string;
        wait: number[]; e2e: number[];
        graph: number; observed: number; overlapped: number;
    }>();

    for (const snap of snapshots) {
        if ((snap.Snapshot_Version || 1) < 3) { skippedLegacy++; continue; }
        orders++;

        if (typeof snap.Lead_Days === 'number' && snap.Lead_Days > 0) leadDays.push(snap.Lead_Days);
        if (typeof snap.Touch_Days === 'number' && snap.Touch_Days > 0) touchDays.push(snap.Touch_Days);
        if (typeof snap.Flow_Efficiency === 'number' && snap.Flow_Efficiency !== null) {
            flowEff.push(snap.Flow_Efficiency);
        }

        for (const run of snap.Process_Runs || []) {
            const k = key(run.Process_Name);
            if (!k) continue;
            const e = procAcc.get(k) || { label: run.Process_Name, work: [], span: [], orders: new Set<string>() };
            if (run.Worker_Days > 0) e.work.push(run.Worker_Days);
            if (run.Span_Days > 0) e.span.push(run.Span_Days);
            e.orders.add(snap.Work_Order_ID);
            procAcc.set(k, e);
        }

        for (const tr of snap.Transitions || []) {
            const kf = key(tr.From_Name);
            const kt = key(tr.To_Name);
            if (!kf || !kt) continue;
            const id = `${kf}→${kt}`;
            const e = transAcc.get(id) || {
                from: tr.From_Name, to: tr.To_Name,
                wait: [], e2e: [], graph: 0, observed: 0, overlapped: 0,
            };
            e.wait.push(tr.Wait_Days);
            if (typeof tr.End_To_End_Days === 'number') e.e2e.push(tr.End_To_End_Days);
            if (tr.Source === 'graph') e.graph++; else e.observed++;
            if (tr.Overlapped) e.overlapped++;
            transAcc.set(id, e);
        }
    }

    const processes: ProcessStat[] = Array.from(procAcc.values())
        .map(e => {
            const work = distribution(e.work);
            const span = distribution(e.span);
            return {
                name: e.label,
                n: e.orders.size,
                workerDays: work!,
                spanDays: span,
                density: work && span && span.p50 > 0 ? round2(work.p50 / span.p50) : null,
            };
        })
        .filter(p => p.workerDays)
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'hr'));

    const transitions: TransitionStat[] = Array.from(transAcc.values())
        .map(e => {
            const wait = distribution(e.wait)!;
            return {
                from: e.from, to: e.to,
                n: e.wait.length,
                waitDays: wait,
                endToEndDays: distribution(e.e2e),
                fromGraph: e.graph,
                fromObserved: e.observed,
                overlapped: e.overlapped,
                totalWaitDays: round2(wait.p50 * e.wait.length),
            };
        })
        .filter(t => t.waitDays)
        .sort((a, b) => b.totalWaitDays - a.totalWaitDays
            || `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`, 'hr'));

    return {
        orders,
        leadDays: distribution(leadDays),
        touchDays: distribution(touchDays),
        flowEfficiency: distribution(flowEff),
        processes,
        transitions,
        // Rang uskih grla = po UKUPNOM čekanju; prikazuju se samo oni gdje se stvarno čeka
        bottlenecks: transitions.filter(t => t.totalWaitDays > 0).slice(0, 10),
        // Stvarni tok koji graf ne poznaje — vrijedi znati je li graf kriv ili se improvizuje
        undocumented: transitions.filter(t => t.fromGraph === 0 && t.fromObserved > 0),
        skippedLegacy,
    };
}
