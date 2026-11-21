// ════════════════════════════════════════════════════════════════════
// PLATNO · MODEL RASPOREDA — KALENDAR RADNIKA
//
// Raspoloživost radnika po danu kao broj 0..1 (dio dana koji radnik može dati).
// Jedan izvor istine za ocjenu plana, donje granice i (u fazi 3) optimizator,
// da sve mjeri vrijeme istim pravilima:
//
//   • nedjelja i praznik → 0
//   • zapis iz šihtarice ima prednost: odsustvo → 0, rad (Prisutan/Teren) → 1,
//     „Vikend" na suboti → 0
//   • subota bez zapisa → po smjeni radnika (Worker.Saturday_Anchor), inače po
//     procjeni rotacije iz šihtarice (lib/planning.ts) — isto pravilo kao rok naloga
//   • ostali dani → 1
//
// Čista funkcija, bez Firebase i Reacta. jest: lib/__tests__/platnoModel.test.ts
// ════════════════════════════════════════════════════════════════════

import { shiftWorksSaturday, workerWorksSaturday, type AttendanceLite } from '../../planning';

export interface CalendarWorker { Worker_ID: string; Saturday_Anchor?: string }

export interface CalendarInput {
    workers: CalendarWorker[];
    attendance: AttendanceLite[];
    /** Neradni dani za sve (YYYY-MM-DD). */
    holidays?: string[];
}

export interface WorkerCalendar {
    /** Dio dana (0..1) koji radnik može dati tog dana. */
    available(workerId: string, iso: string): number;
}

const ABSENT = new Set(['Odsutan', 'Bolovanje', 'Odmor', 'Praznik']);
const WORKED = new Set(['Prisutan', 'Teren']);

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

export function buildWorkerCalendar(input: CalendarInput): WorkerCalendar {
    const holidays = new Set(input.holidays || []);
    const anchor = new Map(input.workers.map(w => [w.Worker_ID, w.Saturday_Anchor]));
    const record = new Map<string, string>();
    for (const a of input.attendance) record.set(`${a.Worker_ID}|${String(a.Date).slice(0, 10)}`, a.Status);
    const cache = new Map<string, number>();

    return {
        available(workerId: string, iso: string): number {
            const key = `${workerId}|${iso}`;
            const hit = cache.get(key);
            if (hit !== undefined) return hit;
            let out = 1;
            const wd = weekdayOf(iso);
            const status = record.get(key);
            if (wd === 0 || holidays.has(iso)) out = 0;
            else if (status && ABSENT.has(status)) out = 0;
            else if (status && WORKED.has(status)) out = 1;
            else if (wd === 6) {
                if (status === 'Vikend') out = 0;
                else out = (shiftWorksSaturday(anchor.get(workerId), iso) ?? workerWorksSaturday(workerId, iso, input.attendance)) ? 1 : 0;
            }
            cache.set(key, out);
            return out;
        },
    };
}
