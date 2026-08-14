// ════════════════════════════════════════════════════════════════════
// PLATNO — KALENDAR JEDNOG RADNIKA
//
// Osa platna odgovara na „šta se dešava u radionici". Na pitanje „šta radi Bego"
// odgovara loše: njegov raspored je razbacan po zajedničkoj osi, pa se čita
// skeniranjem jednog reda kroz vrijeme umjesto gledanjem u jedan mjesec.
//
// Ovdje je drugi oblik za isto pitanje: mjesečna mreža za JEDNOG radnika.
// Čista funkcija nad podacima koje CanvasTab ionako već ima (blokovi scenarija,
// šihtarica, stvarni nalozi) — bez novih upita i bez pisanja.
//
// IZOLACIJA: kao i ostatak platna, ovo samo ČITA. Stvarni nalozi ulaze kao
// zaključane sjene, šihtarica kao odsustva.
// ════════════════════════════════════════════════════════════════════

import type { PlanBlock, WorkerAttendance, WorkOrder } from '../types';
import { addDays, isWorkDay, toISODate } from './model';
import { realWorkOrdersByWorker, type ShadowBar } from './rows';

/**
 * Odsustva koja se PRIKAZUJU u kalendaru. Isti skup koji platno već crta kao
 * sjenu odsustva (rows.ts) — da se dva prikaza istog čovjeka ne razilaze.
 */
const SHOWN_ABSENCE = new Set(['Odsutan', 'Bolovanje', 'Odmor']);

/**
 * Odsustva koja oduzimaju RASPOLOŽIV dan. Šire od gornjeg skupa: 'Vikend' i
 * 'Praznik' se ne crtaju kao odsustvo (nisu ničija odluka), ali svejedno znače
 * da tog dana čovjeka nema — isto pravilo koje već koristi capacity.ts. Bez ove
 * razlike bi nazivnik opterećenja bio veći nego što stvarnost dozvoljava.
 */
const UNAVAILABLE = new Set(['Odsutan', 'Bolovanje', 'Odmor', 'Vikend', 'Praznik']);

/** Blokovi koji troše čovjekov dan. Napomena i prekretnica ne troše. */
const CONSUMES = new Set<PlanBlock['kind']>(['order', 'montaza', 'transport']);

export interface WorkerCalendarCtx {
    /** Blokovi scenarija — filtriraju se po `workerRefs`. */
    blocks: PlanBlock[];
    attendance: WorkerAttendance[];
    /** Stvarni preuzeti nalozi — ulaze kao zaključane sjene. */
    workOrders: WorkOrder[];
    /** Subotnja rotacija; bez nje subota radi. */
    isSaturdayWorking?: (d: Date) => boolean;
}

export interface CalendarDay {
    dateISO: string;
    dayOfMonth: number;
    /** false za dane susjednih mjeseci koji popunjavaju prvu/zadnju sedmicu. */
    inMonth: boolean;
    isToday: boolean;
    /** Radni dan po pravilima radionice (nedjelja ne, subota po rotaciji). */
    isWorkingDay: boolean;
    /** Planirani blokovi koji pokrivaju ovaj dan. */
    blocks: PlanBlock[];
    /** Stvarni nalozi koji pokrivaju ovaj dan — čita se, ne mijenja. */
    shadows: ShadowBar[];
    /** Prikazano odsustvo iz šihtarice. */
    absence?: string;
    /**
     * Dva posla u istom danu, ili posao preko odsustva. Ovo je jedini crveni
     * signal u kalendaru — ne izmišlja se iz procenata, nego iz stvarnog sudara.
     */
    conflict: boolean;
    /** Radni dan, raspoloživ, bez ijednog posla — rupa koju vrijedi popuniti. */
    free: boolean;
}

export interface CalendarWeek {
    /** ISO broj sedmice — isti broj koji stoji na osi platna. */
    weekNo: number;
    days: CalendarDay[];
    busyDays: number;
    availableDays: number;
}

export interface WorkerLoadStats {
    busy: number;
    available: number;
    /** busy / available, zaokruženo na cijeli postotak; 0 kad nema raspoloživih dana. */
    pct: number;
    conflicts: number;
    /**
     * Prvi radni dan od danas bez posla i bez odsustva. Namjerno smije izaći iz
     * traženog raspona — „nema slobodnog dana u ovom mjesecu" nije koristan odgovor.
     */
    firstFreeISO: string | null;
}

export interface WorkerCalendarMonth {
    /** YYYY-MM */
    monthISO: string;
    year: number;
    /** 0-11, kao Date.getMonth(). */
    month: number;
    weeks: CalendarWeek[];
    /** Opterećenje za PRIKAZANI mjesec — ne za cijeli plan. */
    stats: WorkerLoadStats;
}

// ── Pomoćne ─────────────────────────────────────────────────────────

/** ISO 8601 broj sedmice (sedmica počinje ponedjeljkom, četvrtak određuje godinu). */
export function isoWeekNumber(iso: string): number {
    const d = new Date(`${iso}T12:00:00`);
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() + 4 - (t.getDay() || 7));
    const yearStart = new Date(t.getFullYear(), 0, 1);
    return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Ponedjeljak one sedmice u kojoj dati datum leži. */
export function mondayOf(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    const shift = (d.getDay() + 6) % 7;      // pon=0 … ned=6
    return addDays(iso, -shift);
}

/** `YYYY-MM` pomjeren za n mjeseci — bez prelijevanja dana (uvijek 1. u mjesecu). */
export function shiftMonth(monthISO: string, n: number): string {
    const [y, m] = monthISO.split('-').map(Number);
    const d = new Date(y, (m - 1) + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM` datuma. */
export function monthOf(iso: string): string {
    return iso.slice(0, 7);
}

// ── Dnevno očitanje ─────────────────────────────────────────────────

interface DayReading {
    blocks: PlanBlock[];
    absence?: string;
    /** Odsutan po ŠIREM skupu — određuje raspoloživost, ne prikaz. */
    unavailable: boolean;
}

function readDay(
    dateISO: string,
    blocksOfWorker: PlanBlock[],
    attByDate: Map<string, string>
): DayReading {
    const status = attByDate.get(dateISO);
    return {
        blocks: blocksOfWorker.filter(b => b.startISO <= dateISO && dateISO <= b.endISO),
        absence: status && SHOWN_ABSENCE.has(status) ? status : undefined,
        unavailable: !!status && UNAVAILABLE.has(status),
    };
}

/** Blokovi koji troše dan ovog radnika. */
function blocksOf(workerId: string, blocks: PlanBlock[]): PlanBlock[] {
    return blocks.filter(b =>
        CONSUMES.has(b.kind) && (b.workerRefs || []).some(r => r.id === workerId));
}

/** Šihtarica radnika kao `datum → status`. */
function attendanceOf(workerId: string, attendance: WorkerAttendance[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const a of attendance) {
        if (a.Worker_ID === workerId && a.Date && a.Status) out.set(a.Date, a.Status);
    }
    return out;
}

// ── Opterećenje ─────────────────────────────────────────────────────

/**
 * Opterećenje radnika u rasponu [fromISO, toISO].
 *
 * Raspon je OBAVEZAN jer se isti broj čita na dva mjesta s različitim prozorom:
 * red na osi gleda cijeli plan, kalendar gleda svoj mjesec. Bez toga bi iznad
 * mjesečne mreže stajao postotak koji se na nju ne odnosi.
 */
export function workerLoadStats(
    workerId: string,
    fromISO: string,
    toISO: string,
    ctx: WorkerCalendarCtx,
    todayISOValue: string
): WorkerLoadStats {
    const mine = blocksOf(workerId, ctx.blocks);
    const att = attendanceOf(workerId, ctx.attendance);

    let busy = 0;
    let available = 0;
    let conflicts = 0;

    let cur = fromISO;
    for (let i = 0; i <= 400 && cur <= toISO; i++) {
        if (isWorkDay(cur, ctx.isSaturdayWorking)) {
            const r = readDay(cur, mine, att);
            if (!r.unavailable) available++;
            if (r.blocks.length > 0) busy++;
            if (r.blocks.length > 1 || (r.blocks.length > 0 && r.absence)) conflicts++;
        }
        cur = addDays(cur, 1);
    }

    // Prvi slobodan gleda UNAPRIJED od danas i smije izaći iz raspona.
    let firstFreeISO: string | null = null;
    let scan = todayISOValue > fromISO ? todayISOValue : fromISO;
    for (let i = 0; i < 200 && !firstFreeISO; i++) {
        if (isWorkDay(scan, ctx.isSaturdayWorking)) {
            const r = readDay(scan, mine, att);
            if (r.blocks.length === 0 && !r.unavailable) firstFreeISO = scan;
        }
        scan = addDays(scan, 1);
    }

    return {
        busy,
        available,
        pct: available > 0 ? Math.round((busy / available) * 100) : 0,
        conflicts,
        firstFreeISO,
    };
}

// ── Mjesečna mreža ──────────────────────────────────────────────────

/**
 * Mjesečna mreža za jednog radnika: pune sedmice od ponedjeljka do nedjelje,
 * dopunjene danima susjednih mjeseci (`inMonth: false`) da mreža ostane 7 kolona.
 *
 * Statistika se računa SAMO za dane unutar mjeseca — inače bi rubni dani
 * susjednog mjeseca ulazili u postotak koji stoji iznad mreže.
 */
export function buildWorkerCalendar(
    workerId: string,
    monthISO: string,
    ctx: WorkerCalendarCtx,
    todayISOValue: string
): WorkerCalendarMonth {
    const [year, month1] = monthISO.split('-').map(Number);
    const month = month1 - 1;

    const firstOfMonth = toISODate(new Date(year, month, 1));
    const lastOfMonth = toISODate(new Date(year, month + 1, 0));

    const mine = blocksOf(workerId, ctx.blocks);
    const att = attendanceOf(workerId, ctx.attendance);
    const shadows = realWorkOrdersByWorker(ctx.workOrders).get(workerId) || [];

    const weeks: CalendarWeek[] = [];
    let cursor = mondayOf(firstOfMonth);

    // Mreža ide do sedmice koja sadrži zadnji dan mjeseca; 6 je gornja granica
    // (mjesec od 31 dana koji počinje u nedjelju).
    for (let w = 0; w < 6; w++) {
        const days: CalendarDay[] = [];
        let busyDays = 0;
        let availableDays = 0;

        for (let i = 0; i < 7; i++) {
            const dateISO = addDays(cursor, i);
            const inMonth = dateISO >= firstOfMonth && dateISO <= lastOfMonth;
            const isWorkingDay = isWorkDay(dateISO, ctx.isSaturdayWorking);
            const r = readDay(dateISO, mine, att);
            const conflict = r.blocks.length > 1 || (r.blocks.length > 0 && !!r.absence);

            if (inMonth && isWorkingDay) {
                if (!r.unavailable) availableDays++;
                if (r.blocks.length > 0) busyDays++;
            }

            days.push({
                dateISO,
                dayOfMonth: Number(dateISO.slice(8, 10)),
                inMonth,
                isToday: dateISO === todayISOValue,
                isWorkingDay,
                blocks: r.blocks,
                shadows: shadows.filter(s => s.startISO <= dateISO && dateISO <= s.endISO),
                absence: r.absence,
                conflict,
                free: inMonth && isWorkingDay && !r.unavailable && r.blocks.length === 0,
            });
        }

        weeks.push({ weekNo: isoWeekNumber(cursor), days, busyDays, availableDays });

        cursor = addDays(cursor, 7);
        if (cursor > lastOfMonth) break;
    }

    return {
        monthISO,
        year,
        month,
        weeks,
        stats: workerLoadStats(workerId, firstOfMonth, lastOfMonth, ctx, todayISOValue),
    };
}
