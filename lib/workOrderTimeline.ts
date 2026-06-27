// ════════════════════════════════════════════════════════════════════
// ČISTA LOGIKA TIMELINE-a NALOGA (bez Firebase, pokrivena testovima).
//
// Gradi uređenu listu dana (Started_At/najraniji log → danas/Completed_At, + ručno dodani dani)
// sa tipom dana, AGREGIRANO preko SVIH proizvoda jednog naloga.
//
// INVARIJANTA: dan s BILO KOJIM zapisom rada je UVIJEK 'working' — i unutar pauze.
// (Trošak = Σ Daily_Rate; pauza se prikazuje samo za dane bez rada.) Isti princip kao
// ProductTimelineModal, ali za cijeli nalog.
// ════════════════════════════════════════════════════════════════════

export type WorkDayType = 'working' | 'paused' | 'weekend' | 'holiday' | 'no_work' | 'future';

export interface TimelineLog {
    Date: string;                 // YYYY-MM-DD
    Worker_ID: string;
    Worker_Name: string;
    Daily_Rate: number;
    Product_ID?: string;
    Work_Order_Item_ID?: string;
}

export interface PausePeriodLite {
    Started_At: string;           // ISO (datum ili datetime)
    Ended_At?: string;            // ISO; ako nema → još traje
}

export interface WorkTimelineDay {
    date: string;                 // YYYY-MM-DD
    dayOfWeek: number;            // 0=ned … 6=sub
    dayType: WorkDayType;
    logs: TimelineLog[];
    dailyLaborCost: number;
    cumulativeLaborCost: number;
}

export interface BuildWorkTimelineParams {
    logs: TimelineLog[];
    startedAt?: string | null;    // ISO — početak rada na nalogu
    completedAt?: string | null;  // ISO — kraj (ako je završen)
    createdDate?: string | null;  // ISO — fallback za početak
    holidays?: Set<string>;       // YYYY-MM-DD
    pausePeriods?: PausePeriodLite[];
    extraDates?: Set<string>;     // YYYY-MM-DD — ručno dodani dani (prošire raspon / prikažu prazan dan)
    today?: Date;                 // injektabilno za testove (default: sada)
}

/** Lokalni YYYY-MM-DD (bez UTC pomaka). */
function toLocalISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateOnly(iso: string): string {
    return iso.split('T')[0];
}

export function buildWorkTimeline(params: BuildWorkTimelineParams): WorkTimelineDay[] {
    const {
        logs,
        startedAt,
        completedAt,
        createdDate,
        holidays = new Set<string>(),
        pausePeriods = [],
        extraDates = new Set<string>(),
    } = params;

    const today = params.today ? new Date(params.today) : new Date();
    today.setHours(0, 0, 0, 0);

    // ── Početak raspona ────────────────────────────────────────────────
    let startDate: Date | null = startedAt
        ? new Date(dateOnly(startedAt) + 'T12:00:00')
        : (createdDate ? new Date(dateOnly(createdDate) + 'T12:00:00') : null);

    if (logs.length > 0) {
        const earliestLog = [...logs].sort((a, b) => a.Date.localeCompare(b.Date))[0].Date;
        const e = new Date(earliestLog + 'T12:00:00');
        if (!startDate || e < startDate) startDate = e;
    }
    if (!startDate && extraDates.size > 0) {
        const earliest = Array.from(extraDates).sort()[0];
        startDate = new Date(earliest + 'T12:00:00');
    }
    if (!startDate) return [];

    // ── Kraj raspona ───────────────────────────────────────────────────
    const endDate = completedAt ? new Date(dateOnly(completedAt) + 'T12:00:00') : new Date(today);

    // Proširi raspon na sve ručno dodane dane
    if (extraDates.size > 0) {
        extraDates.forEach(d => {
            const ed = new Date(d + 'T12:00:00');
            if (ed < startDate!) startDate = new Date(ed);
            if (ed > endDate) endDate.setTime(ed.getTime());
        });
    }

    // ── Logovi po datumu ───────────────────────────────────────────────
    const logsByDate = new Map<string, TimelineLog[]>();
    logs.forEach(l => {
        const arr = logsByDate.get(l.Date) || [];
        arr.push(l);
        logsByDate.set(l.Date, arr);
    });

    const isPausedOnDate = (dateStr: string): boolean =>
        pausePeriods.some(p => {
            const start = dateOnly(p.Started_At);
            const end = p.Ended_At ? dateOnly(p.Ended_At) : toLocalISO(today);
            return dateStr >= start && dateStr <= end;
        });

    // ── Iteracija dan po dan ───────────────────────────────────────────
    const days: WorkTimelineDay[] = [];
    let cumulative = 0;
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const endCmp = new Date(endDate);
    endCmp.setHours(0, 0, 0, 0);

    while (current <= endCmp) {
        const dateStr = toLocalISO(current);
        const dow = current.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isHoliday = holidays.has(dateStr);
        const isFuture = current > today;
        const dayLogs = logsByDate.get(dateStr) || [];

        let dayType: WorkDayType;
        if (isFuture) dayType = 'future';
        else if (dayLogs.length > 0) dayType = 'working';   // rad uvijek pobjeđuje (i u pauzi)
        else if (isHoliday) dayType = 'holiday';
        else if (isWeekend) dayType = 'weekend';
        else if (isPausedOnDate(dateStr)) dayType = 'paused';
        else dayType = 'no_work';

        const dailyLaborCost = Math.round(dayLogs.reduce((s, l) => s + (l.Daily_Rate || 0), 0) * 100) / 100;
        cumulative = Math.round((cumulative + dailyLaborCost) * 100) / 100;

        days.push({ date: dateStr, dayOfWeek: dow, dayType, logs: dayLogs, dailyLaborCost, cumulativeLaborCost: cumulative });
        current.setDate(current.getDate() + 1);
    }

    return days;
}

/** Sažetak timeline-a (radni/pauzirani/ukupno dana, ukupan trošak rada). */
export function summarizeWorkTimeline(days: WorkTimelineDay[]) {
    const workingDays = days.filter(d => d.dayType === 'working').length;
    const pausedDays = days.filter(d => d.dayType === 'paused').length;
    const totalDays = days.filter(d => d.dayType !== 'future').length;
    const totalLaborCost = Math.round(days.reduce((s, d) => s + d.dailyLaborCost, 0) * 100) / 100;
    return { workingDays, pausedDays, totalDays, totalLaborCost };
}
