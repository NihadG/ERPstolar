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
    /**
     * Ručno PRIKOVAN početak. Poštuje se u SVAKOM načinu, i nadjačava `startISO`.
     *
     * Bez ovoga se datum pojedinog naloga mogao pomjeriti samo prebacivanjem
     * CIJELE tabele u „Ručno", čime se gubi automatika za sve ostale redove.
     * Prikivanje je po redu: jedan nalog ide gdje kažeš, ostali se i dalje slažu sami.
     */
    pinnedISO?: string;
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

    /** Prikovan red ide na svoj datum, bez obzira na način. */
    const place = (r: BatchScheduleRow, startRaw: string): PlacedRow => {
        const start = firstWorkingDay(startRaw, isSat);
        return { id: r.id, startISO: start, endISO: endFor(start, r.durationDays, isSat) };
    };

    if (mode === 'manual') {
        return rows.map(r => place(r, r.pinnedISO || r.startISO || ctx.startISO));
    }

    if (mode === 'parallel') {
        return rows.map(r => place(r, r.pinnedISO || ctx.startISO));
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
        // Prikovan red ne troši kursor kao „sljedeći slobodan", nego ga POMJERA:
        // ono što dolazi iza njega mora krenuti poslije njega, inače bi se
        // nadovezani nalozi tiho preklopili s ručno postavljenim datumom.
        const from = r.pinnedISO || cursor.get(worker) || laneStart(worker);
        const placed = place(r, from);
        const next = addDays(placed.endISO, 1);
        const cur = cursor.get(worker);
        cursor.set(worker, !cur || next > cur ? next : cur);
        out.push(placed);
    }
    return out;
}
