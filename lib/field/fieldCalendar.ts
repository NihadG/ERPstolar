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
    summary: {
        presentDays: number;         // Prisutan + Teren
        workedDays: number;          // dani s bar jednom dnevnicom
        fieldDays: number;           // Teren
    };
}

export interface WorkerCalendarInput {
    month: string;                   // YYYY-MM
    workerId: string;
    /** Sve dnevnice organizacije za mjesec (za razrješenje kolega). */
    allLogs: WorkLog[];
    /** Prisustvo radnika za mjesec. */
    attendance: WorkerAttendance[];
    /** Product_ID → naziv (WorkLog ne nosi naziv proizvoda). Puni ga ruta. */
    productNameById: Map<string, string>;
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

    return {
        month,
        from,
        to,
        leadBlanks: dowMon(from),
        days: dayCells,
        summary: { presentDays, workedDays, fieldDays },
    };
}
