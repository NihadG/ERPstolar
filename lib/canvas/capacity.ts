// ════════════════════════════════════════════════════════════════════
// PLATNO — DNEVNI KAPACITET
//
// Odgovara na „mogu li ja ovo uopšte odraditi". Ključno: raspoloživost se umanjuje
// za STVARNO PREUZET posao, ne samo za ono što je na platnu. Kapacitet koji gleda
// samo scenarij pokazuje da je sve u redu dok radionica gori.
//
// Pravila radnih dana su ista kao u lib/planning.ts (nedjelja van, subota po
// rotaciji, budući unos u šihtarici ima prednost) — platno i stvarnost ne smiju
// mjeriti vrijeme različito.
// ════════════════════════════════════════════════════════════════════

import type { PlanScenario, PlanBlock, Worker, WorkOrder, WorkerAttendance } from '../types';
import { addDays, isWorkDay, blockDurationDays } from './model';

/** Statusi koji oduzimaju dan. Ostali (Prisutan/Teren) ga garantuju. */
const ABSENT = new Set(['Odsutan', 'Bolovanje', 'Odmor', 'Vikend', 'Praznik']);
/** Blokovi koji troše ljude. */
const CONSUMES = new Set<PlanBlock['kind']>(['order', 'montaza', 'transport']);

export interface DayCapacity {
    dateISO: string;
    isWorkingDay: boolean;
    /** Raspoloživi radnik-dani. */
    available: number;
    /** Radnik-dani iz blokova scenarija. */
    planned: number;
    /** Radnik-dani iz STVARNIH preuzetih naloga. */
    committed: number;
    /** (planned + committed) / available; null kad je available 0. */
    ratio: number | null;
}

export interface CapacityContext {
    workers: Worker[];
    workOrders: WorkOrder[];
    attendance: WorkerAttendance[];
    isSaturdayWorking?: (d: Date) => boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Radnik-dani po danu za jedan blok: posao ravnomjerno po RADNIM danima raspona.
 * Bez podataka o poslu pretpostavlja se po jedan čovjek po danu za svakog
 * dodijeljenog radnika — grubo, ali ne izmišlja obim koji nije unesen.
 */
function perDayLoad(block: PlanBlock, ctx: CapacityContext): { days: string[]; loadPerDay: number } {
    const days: string[] = [];
    let cur = block.startISO;
    for (let i = 0; i <= 400 && cur <= block.endISO; i++) {
        if (isWorkDay(cur, ctx.isSaturdayWorking)) days.push(cur);
        cur = addDays(cur, 1);
    }
    if (days.length === 0) return { days: [], loadPerDay: 0 };

    const workerDays = block.workerDays && block.workerDays > 0
        ? block.workerDays
        : (block.workerRefs?.length || 0) * days.length;

    return { days, loadPerDay: workerDays / days.length };
}

export function dailyCapacity(
    scenario: PlanScenario,
    ctx: CapacityContext,
    fromISO: string,
    numDays: number
): DayCapacity[] {
    const activeWorkers = ctx.workers.filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan');
    const attByKey = new Map<string, string>();
    for (const a of ctx.attendance) {
        if (a.Worker_ID && a.Date) attByKey.set(`${a.Worker_ID}|${a.Date}`, a.Status);
    }

    const plannedByDate = new Map<string, number>();
    for (const b of scenario.Blocks) {
        if (!CONSUMES.has(b.kind)) continue;
        const { days, loadPerDay } = perDayLoad(b, ctx);
        for (const d of days) plannedByDate.set(d, (plannedByDate.get(d) || 0) + loadPerDay);
    }

    // Stvarni preuzet posao — bez ovoga je kapacitet lažno optimističan
    const committedByDate = new Map<string, number>();
    for (const wo of ctx.workOrders) {
        if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
        const start = (wo.Started_At || wo.Planned_Start_Date || '').split('T')[0];
        const end = (wo.Due_Date || wo.Planned_End_Date || start).split('T')[0];
        if (!start || !end || end < start) continue;

        const workerIds = new Set<string>();
        let plannedWorkerDays = 0;
        for (const item of wo.items || []) {
            (item.Assigned_Workers || []).forEach(w => w.Worker_ID && workerIds.add(w.Worker_ID));
            (item.Processes || []).forEach(p => {
                if (p.Worker_ID) workerIds.add(p.Worker_ID);
                (p.Helpers || []).forEach(h => h.Worker_ID && workerIds.add(h.Worker_ID));
            });
            const d = item.Planned_Labor_Days || 0;
            if (d > 0) plannedWorkerDays += d * (item.Planned_Labor_Workers || 1);
        }

        const days: string[] = [];
        let cur = start;
        for (let i = 0; i <= 400 && cur <= end; i++) {
            if (isWorkDay(cur, ctx.isSaturdayWorking)) days.push(cur);
            cur = addDays(cur, 1);
        }
        if (days.length === 0) continue;

        const total = plannedWorkerDays > 0 ? plannedWorkerDays : workerIds.size * days.length;
        const perDay = total / days.length;
        for (const d of days) committedByDate.set(d, (committedByDate.get(d) || 0) + perDay);
    }

    const out: DayCapacity[] = [];
    for (let i = 0; i < numDays; i++) {
        const dateISO = addDays(fromISO, i);
        const working = isWorkDay(dateISO, ctx.isSaturdayWorking);

        let available = 0;
        if (working) {
            for (const w of activeWorkers) {
                const marked = attByKey.get(`${w.Worker_ID}|${dateISO}`);
                // Unos u šihtarici ima prednost nad pretpostavkom
                if (marked) { if (!ABSENT.has(marked)) available += 1; }
                else available += 1;
            }
        }

        const planned = r2(plannedByDate.get(dateISO) || 0);
        const committed = r2(committedByDate.get(dateISO) || 0);
        out.push({
            dateISO,
            isWorkingDay: working,
            available,
            planned,
            committed,
            ratio: available > 0 ? r2((planned + committed) / available) : null,
        });
    }
    return out;
}

/** Dani preko kapaciteta — ulaz u panel „Problemi". */
export function overloadedDays(cap: DayCapacity[]): DayCapacity[] {
    return cap.filter(d => d.isWorkingDay && d.ratio !== null && d.ratio > 1);
}

/** Sažetak za prikaz u doku. */
export function capacitySummary(cap: DayCapacity[]): {
    peakRatio: number | null;
    overloadedCount: number;
    totalAvailable: number;
    totalLoad: number;
} {
    const working = cap.filter(d => d.isWorkingDay);
    const ratios = working.map(d => d.ratio).filter((r): r is number => r !== null);
    return {
        peakRatio: ratios.length ? r2(Math.max(...ratios)) : null,
        overloadedCount: overloadedDays(cap).length,
        totalAvailable: r2(working.reduce((s, d) => s + d.available, 0)),
        totalLoad: r2(working.reduce((s, d) => s + d.planned + d.committed, 0)),
    };
}
