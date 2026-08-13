// ════════════════════════════════════════════════════════════════════
// PLATNO — RASPORED BATCH UNOSA
//
// Iz brzog tabelarnog unosa (naziv, trajanje, radnici) izračunaj GDJE svaki
// nalog pada na kalendaru. Tri načina:
//
//  • sequential — nalozi ISTOG radnika idu jedan za drugim (bez preklapanja),
//    a kreću tek nakon što se radnik oslobodi već preuzetog posla. Različiti
//    radnici teku paralelno. Ovo je „rasporedi kako treba".
//  • parallel   — svi kreću od zadanog datuma (kad se radi na svemu odjednom).
//  • manual     — svaki nalog na datum koji je korisnik upisao.
//
// Radni dani su ista pravila kao ostatak platna (nedjelja van, subota po
// rotaciji) preko `workOrderDueDate` — platno i stvarnost mjere vrijeme isto.
// ════════════════════════════════════════════════════════════════════

import { workOrderDueDate } from '../planning';
import { addDays } from './model';

export type BatchScheduleMode = 'sequential' | 'parallel' | 'manual';

export interface BatchScheduleRow {
    id: string;
    /** Dodijeljeni radnici; prvi određuje „traku" u sequential modu. Prazno = nedodijeljeno. */
    workerIds: string[];
    /** Trajanje u RADNIM danima (>= 1). */
    durationDays: number;
    /** Datum početka — koristi se samo u `manual` modu. */
    startISO?: string;
}

export interface BatchScheduleCtx {
    /** „Kreni od" — zajednički najraniji početak. */
    startISO: string;
    isSaturdayWorking?: (d: Date) => boolean;
    /** Zadnji zauzet dan po radniku (stvarni nalozi + postojeći blokovi) — da se novi ne slože na tekući posao. */
    busyUntilByWorker?: Map<string, string>;
}

export interface PlacedRow {
    id: string;
    startISO: string;
    endISO: string;
}

const UNASSIGNED = '__none__';

/** Prvi radni dan na ili poslije `iso` (workOrderDueDate s trajanjem 1 to i radi). */
function firstWorkingDay(iso: string, isSat?: (d: Date) => boolean): string {
    return workOrderDueDate(iso, 1, isSat);
}

/** Kraj naloga: `durationDays` radnih dana od početka, uključivo. */
function endFor(startISO: string, durationDays: number, isSat?: (d: Date) => boolean): string {
    return workOrderDueDate(startISO, Math.max(1, Math.floor(durationDays) || 1), isSat);
}

/**
 * Rasporedi batch redove u konkretne (startISO, endISO) parove.
 * Čista funkcija — ne dira scenarij, samo računa datume za nove blokove.
 */
export function scheduleBatch(
    rows: BatchScheduleRow[],
    mode: BatchScheduleMode,
    ctx: BatchScheduleCtx
): PlacedRow[] {
    const isSat = ctx.isSaturdayWorking;

    if (mode === 'manual') {
        return rows.map(r => {
            const start = firstWorkingDay(r.startISO || ctx.startISO, isSat);
            return { id: r.id, startISO: start, endISO: endFor(start, r.durationDays, isSat) };
        });
    }

    if (mode === 'parallel') {
        const start = firstWorkingDay(ctx.startISO, isSat);
        return rows.map(r => ({ id: r.id, startISO: start, endISO: endFor(start, r.durationDays, isSat) }));
    }

    // sequential: kursor po radniku; nova traka kreće nakon već preuzetog posla.
    const cursor = new Map<string, string>();
    const laneStart = (worker: string): string => {
        const busy = ctx.busyUntilByWorker?.get(worker);
        const base = busy && busy >= ctx.startISO ? addDays(busy, 1) : ctx.startISO;
        return firstWorkingDay(base, isSat);
    };

    const out: PlacedRow[] = [];
    for (const r of rows) {
        const worker = r.workerIds[0] || UNASSIGNED;
        const from = cursor.get(worker) ?? laneStart(worker);
        const start = firstWorkingDay(from, isSat);
        const end = endFor(start, r.durationDays, isSat);
        cursor.set(worker, addDays(end, 1));   // sljedeći nalog istog radnika ide dan poslije
        out.push({ id: r.id, startISO: start, endISO: end });
    }
    return out;
}
