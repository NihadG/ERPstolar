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
