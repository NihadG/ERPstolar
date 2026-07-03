// ════════════════════════════════════════════════════════════════════
// PLANIRANJE ROKA NALOGA
// Rok = projekcija planiranih radnih dana (suma "dani" po proizvodu iz ponude)
// na kalendar, počevši od dana početka naloga.
// Radni dan = svaki dan OSIM NEDJELJE (subota se RAČUNA — kod korisnika se radi subotom).
// Praznici / subotnja rotacija po radniku = zaseban korak (kasnije).
// ════════════════════════════════════════════════════════════════════

function toISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Radni dan = nije nedjelja. (Subota je radni dan.) */
export function isWorkingDay(d: Date): boolean {
    return d.getDay() !== 0; // 0 = nedjelja
}

/**
 * Vrati ISO datum (YYYY-MM-DD) ROKA: datum `durationDays`-tog RADNOG dana,
 * računajući od `startISO` (start dan se broji kao 1. radni dan, ako je radni).
 * Nedjelje se preskaču; subota se računa — OSIM ako `isSaturdayWorking(d)` vrati false
 * (subotnja rotacija po radniku, vidi buildSaturdayChecker).
 * Primjeri (pon 2026-06-22 je ponedjeljak):
 *   workOrderDueDate('2026-06-22', 4) → '2026-06-25' (pon,uto,sri,čet)
 *   workOrderDueDate('2026-06-26', 4) → '2026-06-30' (pet,sub,[ned],pon,uto)
 */
export function workOrderDueDate(
    startISO: string,
    durationDays: number,
    isSaturdayWorking?: (d: Date) => boolean
): string {
    const start = new Date(startISO + 'T00:00:00');
    if (isNaN(start.getTime())) return startISO;
    const working = (d: Date): boolean => {
        const dow = d.getDay();
        if (dow === 0) return false;                                   // nedjelja — ne radi
        if (dow === 6) return isSaturdayWorking ? isSaturdayWorking(d) : true; // subota — rotacija/po defaultu radi
        return true;                                                  // pon–pet
    };
    const d = new Date(start);
    while (!working(d)) d.setDate(d.getDate() + 1);  // pomakni na prvi radni dan
    if (!durationDays || durationDays <= 0) return toISO(d);
    let counted = 1; // `d` je 1. radni dan
    while (counted < durationDays) {
        d.setDate(d.getDate() + 1);
        if (working(d)) counted++;
    }
    return toISO(d);
}

/** Današnji datum kao lokalni ISO (bez UTC pomaka). */
export function todayISO(): string {
    return toISO(new Date());
}

// ════════════════════════════════════════════════════════════════════
// SUBOTNJA ROTACIJA PO RADNIKU (auto iz šihtarice)
// Pravilo: nađi zadnju PROŠLU subotu radnika u šihtarici; ako je tada RADIO
// (Prisutan/Teren) → narednu subotu NE radi, pa alternira (svaku drugu subotu).
// Bez istorije → pretpostavi da radi (da rok ne bude predug).
// ════════════════════════════════════════════════════════════════════

export interface AttendanceLite { Worker_ID: string; Date: string; Status: string }

const SATURDAY = 6;
const WORKED_STATUSES = new Set(['Prisutan', 'Teren']);

/** Da li `workerId` radi subotu `saturdayISO`, prema alternaciji iz šihtarice. */
export function workerWorksSaturday(workerId: string, saturdayISO: string, attendance: AttendanceLite[]): boolean {
    const target = new Date(saturdayISO + 'T00:00:00');
    if (isNaN(target.getTime()) || target.getDay() !== SATURDAY) return true;
    // zadnji subotnji zapis radnika PRIJE ciljane subote
    let ref: { time: number; worked: boolean } | null = null;
    for (const a of attendance) {
        if (a.Worker_ID !== workerId) continue;
        const d = new Date(a.Date + 'T00:00:00');
        if (isNaN(d.getTime()) || d.getDay() !== SATURDAY || d >= target) continue;
        if (!ref || d.getTime() > ref.time) ref = { time: d.getTime(), worked: WORKED_STATUSES.has(a.Status) };
    }
    if (!ref) return true; // nema istorije → radi
    const weeks = Math.round((target.getTime() - ref.time) / (7 * 86400000));
    return weeks % 2 === 0 ? ref.worked : !ref.worked;  // alternacija po parnosti sedmica
}

/**
 * Provjera za rok: subota je RADNA za nalog ako je BAR JEDAN dodijeljeni radnik radi.
 * Nema dodijeljenih radnika → subota radna (shop-level fallback).
 */
export function buildSaturdayChecker(workerIds: string[], attendance: AttendanceLite[]): (d: Date) => boolean {
    return (d: Date) => {
        if (!workerIds.length) return true;
        const iso = toISO(d);
        return workerIds.some(w => workerWorksSaturday(w, iso, attendance));
    };
}

// ════════════════════════════════════════════════════════════════════
// SEDMIČNI KAPACITET (Planer): raspoloživi radnik-dani vs planirani
// raspoloživo = radnici × radni dani sedmice (ned isključena; subota po
//   rotaciji radnika; budući unosi u šihtarici imaju prednost — Odmor/
//   Bolovanje oduzima, Prisutan/Teren garantuje dan)
// planirano = preostali planirani radnik-dani aktivnih naloga, ravnomjerno
//   po radnim danima preostalog raspona naloga (prekoračen rok → ova sedmica)
// ════════════════════════════════════════════════════════════════════

const ABSENT_STATUSES = new Set(['Odsutan', 'Bolovanje', 'Odmor', 'Vikend', 'Praznik']);

export interface CapacityOrderInput {
    id: string;
    startISO: string;             // efektivni početak (Started_At || Planned_Start_Date || danas)
    endISO: string;               // rok (Due_Date/Planned_End_Date); prazan → tretiraj kao startISO
    remainingWorkerDays: number;  // planirani − potrošeni radnik-dani (≥ 0)
}

export interface WeekCapacity {
    weekStartISO: string;  // ponedjeljak
    weekEndISO: string;    // nedjelja
    available: number;     // raspoloživi radnik-dani
    planned: number;       // planirani radnik-dani
    ratio: number | null;  // planned/available (null kad je available 0)
}

function mondayOf(iso: string): Date {
    const d = new Date(iso + 'T00:00:00');
    const dow = d.getDay(); // 0=ned
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return d;
}

/** Radni dani (pon–sub, shop-level) u [fromISO, untilISO], uključivo. */
function shopWorkingDays(fromISO: string, untilISO: string): string[] {
    const out: string[] = [];
    const d = new Date(fromISO + 'T00:00:00');
    const end = new Date(untilISO + 'T00:00:00');
    if (isNaN(d.getTime()) || isNaN(end.getTime())) return out;
    while (d <= end) {
        if (d.getDay() !== 0) out.push(toISO(d));
        d.setDate(d.getDate() + 1);
    }
    return out;
}

export function weeklyCapacity(
    fromISO: string,
    numWeeks: number,
    workerIds: string[],
    attendance: AttendanceLite[],
    orders: CapacityOrderInput[]
): WeekCapacity[] {
    if (numWeeks <= 0) return [];
    const weekStart = mondayOf(fromISO);
    const attByKey = new Map<string, string>(); // workerId|date → status
    for (const a of attendance) attByKey.set(`${a.Worker_ID}|${a.Date}`, a.Status);

    // Raspodjela planiranih dana po datumu (jednom za sve sedmice)
    const plannedByDate = new Map<string, number>();
    for (const o of orders) {
        if (o.remainingWorkerDays <= 0) continue;
        const start = o.startISO < fromISO ? fromISO : o.startISO;   // prošlost ne planiramo
        const end = o.endISO && o.endISO >= start ? o.endISO : start; // prekoračen/bez roka → sabij na start
        const span = shopWorkingDays(start, end);
        if (span.length === 0) continue;
        const perDay = o.remainingWorkerDays / span.length;
        for (const day of span) plannedByDate.set(day, (plannedByDate.get(day) || 0) + perDay);
    }

    const weeks: WeekCapacity[] = [];
    for (let wk = 0; wk < numWeeks; wk++) {
        const ws = new Date(weekStart);
        ws.setDate(ws.getDate() + wk * 7);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);

        let available = 0;
        let planned = 0;
        const d = new Date(ws);
        while (d <= we) {
            const iso = toISO(d);
            const dow = d.getDay();
            if (dow !== 0) {
                planned += plannedByDate.get(iso) || 0;
                for (const w of workerIds) {
                    const marked = attByKey.get(`${w}|${iso}`);
                    if (marked) {
                        // budući unos u šihtarici ima prednost (planiran odmor / potvrđen rad)
                        if (!ABSENT_STATUSES.has(marked)) available += 1;
                    } else if (dow === 6) {
                        if (workerWorksSaturday(w, iso, attendance)) available += 1;
                    } else {
                        available += 1;
                    }
                }
            }
            d.setDate(d.getDate() + 1);
        }

        const r2 = (n: number) => Math.round(n * 100) / 100;
        weeks.push({
            weekStartISO: toISO(ws),
            weekEndISO: toISO(we),
            available: r2(available),
            planned: r2(planned),
            ratio: available > 0 ? r2(planned / available) : null,
        });
    }
    return weeks;
}

// ════════════════════════════════════════════════════════════════════
// PLANIRANO vs POTROŠENO RADNIK-DANA
// Jedinica poređenja = RADNIK-DAN (direktno skalira trošak rada):
//   planirano = Σ (Planned_Labor_Workers||1) × Planned_Labor_Days po stavci
//   potrošeno = Σ Day_Fraction iz work logova (= Σ Actual_Labor_Days sync-ovano
//               kroz recalculateWorkOrder kad logovi nisu pri ruci)
// ════════════════════════════════════════════════════════════════════

export interface DaysProgressItem {
    ID?: string;
    Planned_Labor_Days?: number;
    Planned_Labor_Workers?: number;
    Actual_Labor_Days?: number;
}

export interface DaysProgressLog {
    Work_Order_Item_ID?: string;
    Day_Fraction?: number;
}

export interface DaysProgress {
    planned: number;   // planirani radnik-dani (0 = nema plana)
    actual: number;    // potrošeni radnik-dani
    ratio: number | null; // actual/planned; null kad nema plana
}

/**
 * Planirani vs potrošeni radnik-dani naloga.
 * Ako su `workLogs` dati, potrošeno = Σ Day_Fraction logova stavki naloga (svjež izvor);
 * inače koristi `Actual_Labor_Days` sync-ovan na stavkama (recalculateWorkOrder).
 */
export function plannedVsActualDays(items: DaysProgressItem[], workLogs?: DaysProgressLog[]): DaysProgress {
    const planned = items.reduce((s, it) => {
        const days = it.Planned_Labor_Days || 0;
        if (days <= 0) return s;
        return s + days * (it.Planned_Labor_Workers || 1);
    }, 0);
    let actual: number;
    if (workLogs) {
        const itemIds = new Set(items.map(it => it.ID).filter(Boolean));
        actual = workLogs.reduce((s, wl) =>
            wl.Work_Order_Item_ID && itemIds.has(wl.Work_Order_Item_ID) ? s + (wl.Day_Fraction ?? 1) : s, 0);
    } else {
        actual = items.reduce((s, it) => s + (it.Actual_Labor_Days || 0), 0);
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
        planned: round2(planned),
        actual: round2(actual),
        ratio: planned > 0 ? round2(actual / planned) : null,
    };
}
