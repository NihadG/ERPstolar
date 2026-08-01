// ════════════════════════════════════════════════════════════════════
// RADNIKOV KALENDAR — šta je koji dan radio i s kim
//
// Mreža mjeseca. Po danu: prisustvo, proizvodi na kojima je radio i imena
// kolega koji su tog dana bili na ISTOJ stavci. Suradnici se izvode iz
// dnevnica cijele organizacije za mjesec, grupisanjem po (stavka, datum) —
// isti primitiv koji koristi dnevno knjiženje.
//
// NEMA NOVCA. Iz WorkLog-a se prepisuju samo Worker_Name, Product_ID/Name,
// Process_Name, Date, Day_Fraction — nikad Daily_Rate/Original_Daily_Rate.
// (Test to provjerava.)
// ════════════════════════════════════════════════════════════════════

import type { WorkerAttendance, WorkLog } from '@/lib/types';

const dOnly = (iso?: string | null): string => (iso ? iso.split('T')[0] : '');

export interface CalendarWork {
    productName: string;
    processName: string | null;
}

/** Nalog na kalendaru: raspon dana koji pokriva + status (za boju trake). */
export interface CalendarOrderSpan {
    orderId: string;
    name: string;
    status: string;                  // Na čekanju | U toku | …
    isPaused: boolean;
    startDate: string;               // YYYY-MM-DD (prvi dan trake, može biti < mjesec)
    endDate: string;                 // YYYY-MM-DD (zadnji dan trake, može biti > mjesec)
}

export interface CalendarDay {
    date: string;                    // YYYY-MM-DD
    dow: number;                     // 0 = ponedjeljak … 6 = nedjelja
    attendanceStatus: string | null;
    /** Koliko je dana proknjiženo (Σ Day_Fraction) — može biti 0.5. */
    bookedDays: number;
    work: CalendarWork[];
    coworkers: string[];             // imena, bez ponavljanja
}

export interface WorkerCalendarMonth {
    month: string;                   // YYYY-MM
    from: string;                    // prvi dan mjeseca
    to: string;                      // zadnji dan mjeseca
    /** Broj praznih ćelija prije prvog dana (poravnanje na ponedjeljak). */
    leadBlanks: number;
    days: CalendarDay[];
    /** Aktivni nalozi kao višednevne trake (presijecaju ovaj mjesec). */
    orders: CalendarOrderSpan[];
    summary: {
        presentDays: number;         // Prisutan + Teren
        workedDays: number;          // dani s bar jednom dnevnicom
        fieldDays: number;           // Teren
    };
}

/** Sirovi nalog za projekciju na kalendar (bez novca). */
export interface WorkerCalendarOrderInput {
    orderId: string;
    name: string;
    status: string;
    isPaused: boolean;
    plannedStart: string | null;     // Planned_Start_Date
    plannedEnd: string | null;       // Planned_End_Date
    startedAt: string | null;        // Started_At
    dueDate: string | null;          // Due_Date
}

export interface WorkerCalendarInput {
    month: string;                   // YYYY-MM
    workerId: string;
    /** Današnji datum (YYYY-MM-DD) — za fallback raspon nezakazanih naloga. */
    today: string;
    /** Sve dnevnice organizacije za mjesec (za razrješenje kolega). */
    allLogs: WorkLog[];
    /** Prisustvo radnika za mjesec. */
    attendance: WorkerAttendance[];
    /** Product_ID → naziv (WorkLog ne nosi naziv proizvoda). Puni ga ruta. */
    productNameById: Map<string, string>;
    /** Radnikovi aktivni nalozi — projektuju se u višednevne trake. */
    orders?: WorkerCalendarOrderInput[];
}

/**
 * Raspon trake naloga na kalendaru:
 *   • zakazan (Planned_Start + Planned_End) → tačno kako je planirano;
 *   • inače od danas (ili Started_At u budućnosti) do roka (Due_Date).
 * Bez ijednog upotrebljivog datuma → null (nalog se ne crta).
 */
export function computeOrderSpan(
    o: WorkerCalendarOrderInput, today: string
): { startDate: string; endDate: string } | null {
    const ps = dOnly(o.plannedStart);
    const pe = dOnly(o.plannedEnd);
    if (ps && pe) return { startDate: ps, endDate: ps <= pe ? pe : ps };

    const due = dOnly(o.dueDate);
    if (!due) return null;
    const started = dOnly(o.startedAt);
    // Traka kreće od danas (ili budućeg Started_At), ne od davne prošlosti.
    const start = started && started > today ? started : today;
    return { startDate: start, endDate: due >= start ? due : start };
}

/** Broj dana u mjesecu i granice. */
function monthBounds(month: string): { from: string; to: string; days: number } {
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const p = (n: number) => String(n).padStart(2, '0');
    return { from: `${month}-01`, to: `${month}-${p(days)}`, days };
}

/** 0 = ponedjeljak … 6 = nedjelja. */
function dowMon(iso: string): number {
    return (new Date(iso + 'T00:00:00').getDay() + 6) % 7;
}

export function buildWorkerCalendar(input: WorkerCalendarInput): WorkerCalendarMonth {
    const { workerId, month } = input;
    const { from, to, days } = monthBounds(month);

    const myLogs = input.allLogs.filter(l => l.Worker_ID === workerId);
    const myLogsByDate = new Map<string, WorkLog[]>();
    for (const l of myLogs) {
        const d = dOnly(l.Date);
        if (d < from || d > to) continue;
        const list = myLogsByDate.get(d) || [];
        list.push(l);
        myLogsByDate.set(d, list);
    }

    // Kolege po (datum, stavka): ko je još bio na istoj stavci istog dana.
    const attByDate = new Map<string, WorkerAttendance>();
    for (const a of input.attendance) {
        if (a.Worker_ID === workerId) attByDate.set(dOnly(a.Date), a);
    }

    const dayCells: CalendarDay[] = [];
    let presentDays = 0, workedDays = 0, fieldDays = 0;

    for (let d = 1; d <= days; d++) {
        const date = `${month}-${String(d).padStart(2, '0')}`;
        const logs = myLogsByDate.get(date) || [];
        const att = attByDate.get(date) || null;

        const bookedDays = logs.reduce((s, l) => s + (l.Day_Fraction ?? 1), 0);

        // Radovi dana (proizvod + trenutni proces) — bez dupliranja po proizvodu.
        const workByProduct = new Map<string, CalendarWork>();
        for (const l of logs) {
            const key = l.Product_ID || l.Work_Order_Item_ID || l.WorkLog_ID;
            if (!workByProduct.has(key)) {
                workByProduct.set(key, {
                    productName: input.productNameById.get(l.Product_ID) || 'Proizvod',
                    processName: l.Process_Name || null,
                });
            }
        }

        // Kolege: dnevnice drugih radnika za iste stavke tog dana.
        const myItemIds = new Set(logs.map(l => l.Work_Order_Item_ID).filter(Boolean));
        const coworkers = new Set<string>();
        if (myItemIds.size > 0) {
            for (const l of input.allLogs) {
                if (l.Worker_ID === workerId) continue;
                if (dOnly(l.Date) !== date) continue;
                if (l.Work_Order_Item_ID && myItemIds.has(l.Work_Order_Item_ID) && l.Worker_Name) {
                    coworkers.add(l.Worker_Name);
                }
            }
        }

        const status = att?.Status || null;
        if (status === 'Prisutan' || status === 'Teren') presentDays++;
        if (status === 'Teren') fieldDays++;
        if (logs.length > 0) workedDays++;

        dayCells.push({
            date,
            dow: dowMon(date),
            attendanceStatus: status,
            bookedDays: Math.round(bookedDays * 10) / 10,
            work: [...workByProduct.values()],
            coworkers: [...coworkers].sort((a, b) => a.localeCompare(b, 'bs')),
        });
    }

    // ── Nalozi kao trake (samo oni koji presijecaju ovaj mjesec) ─────
    const orderSpans: CalendarOrderSpan[] = [];
    for (const o of input.orders || []) {
        const span = computeOrderSpan(o, input.today);
        if (!span) continue;
        if (span.endDate < from || span.startDate > to) continue;   // van mjeseca
        orderSpans.push({
            orderId: o.orderId,
            name: o.name,
            status: o.status,
            isPaused: o.isPaused,
            startDate: span.startDate,
            endDate: span.endDate,
        });
    }
    // Raniji početak prvi; stabilno po nazivu (predvidiv raspored traka).
    orderSpans.sort((a, b) =>
        a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name, 'bs')
    );

    return {
        month,
        from,
        to,
        leadBlanks: dowMon(from),
        days: dayCells,
        orders: orderSpans,
        summary: { presentDays, workedDays, fieldDays },
    };
}
