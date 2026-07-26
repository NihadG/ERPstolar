// ════════════════════════════════════════════════════════════════════
// SLIČAN POSAO — „jesmo li ovo već radili, koliko je trajalo, ko ga je radio".
//
// Odgovara na pitanja tipa: „komoda od furniranog hrasta i masiva, s oblikovnom
// šperom (dakle savijanje) — koliko traje i ko to radi?"
//
// KLJUČNO: presjek uslova brzo pojede uzorak. U pogonu ove veličine
// „komoda ∧ furnir ∧ masiv ∧ savijanje" je vjerovatno n=2, ne n=50. Zato izlaz
// NIJE jedan broj nego LJESTVICA POŠTENJA:
//
//   n ≥ 15  → raspodjela (p25/p50/p75)
//   n 3–14  → raspon, uz „na osnovu n naloga"
//   n 1–2   → PRIKAŽI TE NALOGE — i dalje ogromno korisno, samo nije statistika
//   n = 0   → popusti JEDAN uslov i KAŽI KOJI
//
// Za stolariju je to korisnije od lažnog prosjeka.
// ════════════════════════════════════════════════════════════════════

import type { ProductionSnapshot, WorkDrivers } from '../types';
import { distribution, sharePct, round2, type Dist } from './stats';

export interface ComparableQuery {
    /** Svi navedeni tipovi moraju biti prisutni na stavci (ILI u nazivu naloga). */
    productTypes?: string[];
    /** Svi navedeni tipovi materijala moraju biti prisutni u sastavnici. */
    materialTypes?: string[];
    /** Svi navedeni procesi moraju biti odrađeni. */
    processes?: string[];
}

export type Confidence = 'distribution' | 'range' | 'examples' | 'none';

export interface ComparableItem {
    Work_Order_ID: string;
    Work_Order_Number: string;
    Work_Order_Name?: string;
    Product_Name: string;
    Quantity: number;
    workerDaysPerUnit: number;
    actualWorkerDays: number;
    plannedWorkerDays: number | null;
    productTypes: string[];
    materialTypes: string[];
    processes: string[];
    drivers?: WorkDrivers;
    workers: { Worker_ID: string; Worker_Name: string; days: number; sharePct: number }[];
    finishedAt?: string;
}

export interface ComparableResult {
    matched: ComparableItem[];
    n: number;
    confidence: Confidence;
    /** Uslovi koji su POPUŠTENI da bi se išta našlo — moraju se prikazati korisniku. */
    relaxed: string[];
    workerDaysPerUnit: Dist | null;
    /** Ko je radio na tim poslovima, po udjelu dana. Opis, ne dodjela. */
    topWorkers: { Worker_ID: string; Worker_Name: string; days: number; sharePct: number }[];
}

export const DISTRIBUTION_MIN = 15;
export const RANGE_MIN = 3;

const norm = (s: string) => s.trim().toLowerCase();

function itemToComparable(snap: ProductionSnapshot, item: ProductionSnapshot['Items'][number]): ComparableItem {
    const qty = item.Quantity > 0 ? item.Quantity : 1;
    const actual = item.Actual_Labor_Days || 0;
    const workers = (item.Workers_Assigned || []).map(w => ({
        Worker_ID: w.Worker_ID,
        Worker_Name: w.Worker_Name,
        days: w.Worker_Days || 0,
        sharePct: sharePct(w.Worker_Days || 0, actual),
    })).sort((a, b) => b.days - a.days);

    return {
        Work_Order_ID: snap.Work_Order_ID,
        Work_Order_Number: snap.Work_Order_Number,
        Work_Order_Name: snap.Work_Order_Name,
        Product_Name: item.Product_Name,
        Quantity: item.Quantity,
        workerDaysPerUnit: round2(actual / qty),
        actualWorkerDays: round2(actual),
        plannedWorkerDays: item.Planned_Worker_Days ?? null,
        productTypes: item.Product_Types?.length ? item.Product_Types : (snap.Name_Derived_Types || []),
        materialTypes: item.Material_Types || [],
        processes: (item.Processes || []).map(p => p.Process_Name).filter(Boolean),
        drivers: item.Work_Drivers,
        workers,
        finishedAt: snap.Actual_End,
    };
}

function matches(c: ComparableItem, q: ComparableQuery): boolean {
    if (q.productTypes?.length) {
        const have = new Set(c.productTypes.map(norm));
        if (!q.productTypes.every(t => have.has(norm(t)))) return false;
    }
    if (q.materialTypes?.length) {
        const have = new Set(c.materialTypes.map(norm));
        if (!q.materialTypes.every(t => have.has(norm(t)))) return false;
    }
    if (q.processes?.length) {
        const have = new Set(c.processes.map(norm));
        if (!q.processes.every(p => have.has(norm(p)))) return false;
    }
    return true;
}

function confidenceOf(n: number): Confidence {
    if (n >= DISTRIBUTION_MIN) return 'distribution';
    if (n >= RANGE_MIN) return 'range';
    if (n >= 1) return 'examples';
    return 'none';
}

/**
 * Nađi uporedive prošle poslove.
 *
 * Uslovi se popuštaju SAMO kad nema nijednog pogotka — dva TAČNA pogotka vrijede
 * više od četrdeset labavih, i korisnik ih može otvoriti i pogledati.
 * Redoslijed popuštanja ide od najspecifičnijeg: procesi → materijali → tip proizvoda.
 */
export function findComparable(
    snapshots: ProductionSnapshot[],
    query: ComparableQuery
): ComparableResult {
    const pool: ComparableItem[] = [];
    for (const snap of snapshots) {
        if ((snap.Snapshot_Version || 1) < 3) continue;   // v2 nema tipove ni ispravne dane
        for (const item of snap.Items || []) {
            if (!(item.Actual_Labor_Days > 0)) continue;   // bez rada nema šta porediti
            pool.push(itemToComparable(snap, item));
        }
    }

    const ladder: { q: ComparableQuery; relaxed: string[] }[] = [
        { q: query, relaxed: [] },
        { q: { ...query, processes: undefined }, relaxed: ['procesi'] },
        { q: { productTypes: query.productTypes }, relaxed: ['procesi', 'materijali'] },
        { q: {}, relaxed: ['procesi', 'materijali', 'tip proizvoda'] },
    ];

    for (const step of ladder) {
        // Preskoči korak koji ne popušta ništa novo (npr. upit bez procesa)
        const matched = pool.filter(c => matches(c, step.q));
        if (matched.length === 0) continue;

        const days = matched.map(c => c.workerDaysPerUnit).filter(v => v > 0);
        const byWorker = new Map<string, { name: string; days: number }>();
        let totalWorkerDays = 0;
        for (const c of matched) {
            for (const w of c.workers) {
                const e = byWorker.get(w.Worker_ID) || { name: w.Worker_Name, days: 0 };
                e.days += w.days;
                byWorker.set(w.Worker_ID, e);
                totalWorkerDays += w.days;
            }
        }

        return {
            matched: matched.sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || '')),
            n: matched.length,
            confidence: confidenceOf(matched.length),
            relaxed: step.relaxed,
            workerDaysPerUnit: distribution(days),
            topWorkers: Array.from(byWorker.entries())
                .map(([Worker_ID, e]) => ({
                    Worker_ID, Worker_Name: e.name,
                    days: round2(e.days), sharePct: sharePct(e.days, totalWorkerDays),
                }))
                .sort((a, b) => b.days - a.days || a.Worker_ID.localeCompare(b.Worker_ID)),
        };
    }

    return {
        matched: [], n: 0, confidence: 'none', relaxed: [],
        workerDaysPerUnit: null, topWorkers: [],
    };
}

/**
 * Rečenica za prikaz — namjerno različita po nivou pouzdanosti, da se n=2
 * nikad ne pročita kao statistika.
 */
export function describeComparable(res: ComparableResult): string {
    const relaxNote = res.relaxed.length
        ? ` (popušteno: ${res.relaxed.join(', ')})`
        : '';
    const d = res.workerDaysPerUnit;
    switch (res.confidence) {
        case 'distribution':
            return `${d!.p25}–${d!.p75} radnik-dana po komadu, medijan ${d!.p50} (n=${res.n})${relaxNote}`;
        case 'range':
            return `${d!.min}–${d!.max} radnik-dana po komadu, medijan ${d!.p50} — na osnovu ${res.n} posla${relaxNote}`;
        case 'examples':
            return `${res.n === 1 ? 'Jedan sličan posao' : `${res.n} slična posla`} — pogledaj ih${relaxNote}`;
        default:
            return 'Nema uporedivog posla u istoriji';
    }
}
