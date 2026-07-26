// ════════════════════════════════════════════════════════════════════
// AFINITET RADNIKA — ko na čemu stvarno radi.
//
// OVO JE OPIS PROŠLOSTI, NE PREDVIĐANJE. Izlaz je oblika „Ismet je 62% svojih
// radnik-dana odradio na kuhinjama (n=14 naloga)" — činjenica koju čovjek koristi
// pri odluci. Sistem NE dodjeljuje radnika i ne prognozira.
//
// Jedinica je svuda RADNIK-DAN (Σ Day_Fraction). Broj naloga bi izjednačio
// jednodnevnu intervenciju i tronedjeljnu kuhinju.
// ════════════════════════════════════════════════════════════════════

import type { ProductionSnapshot } from '../types';
import { distribution, sharePct, round2, type Dist } from './stats';

export interface AffinityRow {
    key: string;          // ključ tipa proizvoda / materijala / naziv procesa
    workerDays: number;   // radnikovi dani na tome
    sharePct: number;     // udio u UKUPNIM danima tog radnika
    orders: number;       // na koliko različitih naloga
}

export interface PairRow {
    Worker_ID: string;
    Worker_Name: string;
    sharedDays: number;   // Σ min(dani A, dani B) po zajedničkoj stavci
    orders: number;
}

export interface WorkerProfile {
    Worker_ID: string;
    Worker_Name: string;
    totalWorkerDays: number;
    orders: number;
    byProductType: AffinityRow[];
    byMaterialType: AffinityRow[];
    byProcess: AffinityRow[];
    /** Udio dana na nalozima tipa „Montaža" ∈ [0,1]. Odgovor na „ko ide na montažu". */
    montazaShare: number | null;
    pairedWith: PairRow[];
    /**
     * Stvarno/planirano na stavkama gdje je radnik nosio ≥50% posla.
     * `null` ispod praga uzorka — radije ništa nego brojka koja se čita kao ocjena.
     * Nije mjera kvaliteta: veći broj može značiti i teži posao, i lošiju procjenu u ponudi.
     */
    speedIndex: Dist | null;
}

/** Ispod ovoliko uzoraka speedIndex se NE prikazuje. */
export const SPEED_INDEX_MIN_SAMPLES = 5;

/** Radnik mora nositi bar ovoliki udio stavke da bi njeno trajanje govorilo o njemu. */
const DOMINANCE_THRESHOLD = 0.5;

interface Acc {
    name: string;
    totalDays: number;
    orders: Set<string>;
    byProductType: Map<string, { days: number; orders: Set<string> }>;
    byMaterialType: Map<string, { days: number; orders: Set<string> }>;
    byProcess: Map<string, { days: number; orders: Set<string> }>;
    montazaDays: number;
    pairs: Map<string, { name: string; days: number; orders: Set<string> }>;
    speedSamples: number[];
}

function bump(
    map: Map<string, { days: number; orders: Set<string> }>,
    key: string, days: number, orderId: string
) {
    const e = map.get(key) || { days: 0, orders: new Set<string>() };
    e.days += days;
    e.orders.add(orderId);
    map.set(key, e);
}

function toRows(
    map: Map<string, { days: number; orders: Set<string> }>,
    total: number
): AffinityRow[] {
    return Array.from(map.entries())
        .map(([key, e]) => ({
            key,
            workerDays: round2(e.days),
            sharePct: sharePct(e.days, total),
            orders: e.orders.size,
        }))
        .sort((a, b) => b.workerDays - a.workerDays || a.key.localeCompare(b.key, 'hr'));
}

/**
 * Profili svih radnika iz snapshota.
 * Koriste se SAMO v3 snapshoti — v2 nema ispravne radnik-dane (brojao je redove),
 * pa bi ih miješanje tiho iskrivilo. Broj preskočenih vraća `skippedLegacy`.
 */
export function buildWorkerAffinity(snapshots: ProductionSnapshot[]): {
    profiles: WorkerProfile[];
    skippedLegacy: number;
} {
    const byWorker = new Map<string, Acc>();
    let skippedLegacy = 0;

    for (const snap of snapshots) {
        if ((snap.Snapshot_Version || 1) < 3) { skippedLegacy++; continue; }
        const orderId = snap.Work_Order_ID;
        const isMontaza = snap.Work_Order_Type === 'Montaža';

        for (const item of snap.Items || []) {
            const workers = item.Workers_Assigned || [];
            const productTypes = item.Product_Types?.length
                ? item.Product_Types
                : (snap.Name_Derived_Types || []);   // „Zadaci" nalozi: tip je samo u nazivu
            const materialTypes = item.Material_Types || [];

            for (const w of workers) {
                if (!w.Worker_ID) continue;
                const days = w.Worker_Days || 0;
                if (days <= 0) continue;

                let acc = byWorker.get(w.Worker_ID);
                if (!acc) {
                    acc = {
                        name: w.Worker_Name || w.Worker_ID,
                        totalDays: 0, orders: new Set(),
                        byProductType: new Map(), byMaterialType: new Map(), byProcess: new Map(),
                        montazaDays: 0, pairs: new Map(), speedSamples: [],
                    };
                    byWorker.set(w.Worker_ID, acc);
                }
                if (w.Worker_Name) acc.name = w.Worker_Name;
                acc.totalDays += days;
                acc.orders.add(orderId);
                if (isMontaza) acc.montazaDays += days;

                for (const t of productTypes) bump(acc.byProductType, t, days, orderId);
                for (const t of materialTypes) bump(acc.byMaterialType, t, days, orderId);
                for (const [proc, d] of Object.entries(w.Process_Days || {})) {
                    if (d > 0) bump(acc.byProcess, proc, d, orderId);
                }

                // Ko s kim radi — ekipe koje se same formiraju
                for (const other of workers) {
                    if (!other.Worker_ID || other.Worker_ID === w.Worker_ID) continue;
                    const p = acc.pairs.get(other.Worker_ID)
                        || { name: other.Worker_Name || other.Worker_ID, days: 0, orders: new Set<string>() };
                    p.days += Math.min(days, other.Worker_Days || 0);
                    p.orders.add(orderId);
                    acc.pairs.set(other.Worker_ID, p);
                }

                // Brzina: samo stavke koje je RADNIK NOSIO i koje imaju plan u istoj jedinici
                const planned = item.Planned_Worker_Days || 0;
                const actual = item.Actual_Labor_Days || 0;
                const share = w.Share_Of_Item ?? (actual > 0 ? days / actual : 0);
                if (planned > 0 && actual > 0 && share >= DOMINANCE_THRESHOLD) {
                    acc.speedSamples.push(actual / planned);
                }
            }
        }
    }

    const profiles: WorkerProfile[] = Array.from(byWorker.entries()).map(([id, a]) => {
        const speed = distribution(a.speedSamples);
        return {
            Worker_ID: id,
            Worker_Name: a.name,
            totalWorkerDays: round2(a.totalDays),
            orders: a.orders.size,
            byProductType: toRows(a.byProductType, a.totalDays),
            byMaterialType: toRows(a.byMaterialType, a.totalDays),
            byProcess: toRows(a.byProcess, a.totalDays),
            montazaShare: a.totalDays > 0 ? round2(a.montazaDays / a.totalDays) : null,
            pairedWith: Array.from(a.pairs.entries())
                .map(([wid, p]) => ({
                    Worker_ID: wid, Worker_Name: p.name,
                    sharedDays: round2(p.days), orders: p.orders.size,
                }))
                .sort((x, y) => y.sharedDays - x.sharedDays || x.Worker_ID.localeCompare(y.Worker_ID)),
            speedIndex: speed && speed.n >= SPEED_INDEX_MIN_SAMPLES ? speed : null,
        };
    });

    profiles.sort((a, b) => b.totalWorkerDays - a.totalWorkerDays
        || a.Worker_Name.localeCompare(b.Worker_Name, 'hr'));

    return { profiles, skippedLegacy };
}

/**
 * „Ko najviše radi ovaj proces" — obrnut pogled, preko svih radnika.
 * Vraća udio u UKUPNIM danima tog procesa u firmi, uz `n`.
 */
export function processOwnership(profiles: WorkerProfile[]): {
    process: string;
    totalDays: number;
    workers: { Worker_ID: string; Worker_Name: string; days: number; sharePct: number }[];
}[] {
    const byProcess = new Map<string, { total: number; rows: { id: string; name: string; days: number }[] }>();
    for (const p of profiles) {
        for (const row of p.byProcess) {
            const e = byProcess.get(row.key) || { total: 0, rows: [] };
            e.total += row.workerDays;
            e.rows.push({ id: p.Worker_ID, name: p.Worker_Name, days: row.workerDays });
            byProcess.set(row.key, e);
        }
    }
    return Array.from(byProcess.entries())
        .map(([process, e]) => ({
            process,
            totalDays: round2(e.total),
            workers: e.rows
                .map(r => ({
                    Worker_ID: r.id, Worker_Name: r.name,
                    days: round2(r.days), sharePct: sharePct(r.days, e.total),
                }))
                .sort((a, b) => b.days - a.days || a.Worker_ID.localeCompare(b.Worker_ID)),
        }))
        .sort((a, b) => b.totalDays - a.totalDays || a.process.localeCompare(b.process, 'hr'));
}
