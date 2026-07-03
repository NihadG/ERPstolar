// ════════════════════════════════════════════════════════════════════
// MJESEČNI OBRAČUN PLATA (iz šihtarice + dnevnika rada)
// Izvor iznosa = Σ WorkLog.Daily_Rate (ISTA istina kao trošak rada/profit —
// obračun i trošak se ne mogu razići). Šihtarica daje dane po statusu.
// Čista logika, bez Firebase — jest: lib/__tests__/payroll.test.ts
// ════════════════════════════════════════════════════════════════════

export interface PayrollAttendanceLite {
    Worker_ID: string;
    Worker_Name?: string;
    Date: string;      // YYYY-MM-DD
    Status: string;
}

export interface PayrollLogLite {
    Worker_ID: string;
    Worker_Name?: string;
    Date: string;      // YYYY-MM-DD
    Daily_Rate?: number;    // već PODIJELJEN iznos po proizvodu
    Day_Fraction?: number;  // udio radnog dana (presence / N)
}

export interface PayrollWorkerLite {
    Worker_ID: string;
    Name: string;
    Status?: string;   // 'Obrisan' = soft-delete
}

export interface WorkerPayrollRow {
    workerId: string;
    name: string;
    deleted: boolean;              // soft-obrisan radnik (prikaži ako ima podatke u mjesecu)
    daysByStatus: Record<string, number>;
    presentDays: number;           // Prisutan + Teren (iz šihtarice)
    saturdaysWorked: number;       // subote sa Prisutan/Teren
    bookedDays: number;            // Σ Day_Fraction iz dnevnika (radnik-dani)
    totalPay: number;              // Σ Daily_Rate iz dnevnika (KM)
    unbookedPresentDays: number;   // prisutan po šihtarici, a bez ijedne dnevnice taj dan
}

export interface MonthlyPayroll {
    year: number;
    month: number;                 // 1–12
    rows: WorkerPayrollRow[];
    totalPay: number;
    totalPresentDays: number;
}

const PRESENT_STATUSES = new Set(['Prisutan', 'Teren']);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Da li ISO datum pada u (year, month)? Radi bez Date parsiranja (leksički prefiks). */
function inMonth(dateISO: string, year: number, month: number): boolean {
    return typeof dateISO === 'string' && dateISO.startsWith(`${year}-${String(month).padStart(2, '0')}-`);
}

function isSaturday(dateISO: string): boolean {
    const d = new Date(dateISO + 'T00:00:00');
    return !isNaN(d.getTime()) && d.getDay() === 6;
}

/**
 * Mjesečni obračun po radniku: dani po statusu (šihtarica), odrađene subote,
 * radnik-dani i ukupne dnevnice (dnevnik rada). Radnik ulazi u obračun ako je
 * u listi `workers` (osim obrisanih bez podataka) ili ima bilo kakav zapis u mjesecu.
 */
export function computeMonthlyPayroll(
    year: number,
    month: number,
    attendance: PayrollAttendanceLite[],
    workLogs: PayrollLogLite[],
    workers: PayrollWorkerLite[]
): MonthlyPayroll {
    const monthAtt = attendance.filter(a => inMonth(a.Date, year, month));
    const monthLogs = workLogs.filter(l => inMonth(l.Date, year, month));

    // Skupovi po radniku
    const attByWorker = new Map<string, PayrollAttendanceLite[]>();
    for (const a of monthAtt) {
        const arr = attByWorker.get(a.Worker_ID) || [];
        arr.push(a);
        attByWorker.set(a.Worker_ID, arr);
    }
    const logsByWorker = new Map<string, PayrollLogLite[]>();
    for (const l of monthLogs) {
        const arr = logsByWorker.get(l.Worker_ID) || [];
        arr.push(l);
        logsByWorker.set(l.Worker_ID, arr);
    }

    const workerById = new Map(workers.map(w => [w.Worker_ID, w]));
    const allIds = new Set<string>(workers.filter(w => w.Status !== 'Obrisan').map(w => w.Worker_ID));
    attByWorker.forEach((_v, k) => allIds.add(k));
    logsByWorker.forEach((_v, k) => allIds.add(k));

    const rows: WorkerPayrollRow[] = [];
    for (const workerId of Array.from(allIds)) {
        const w = workerById.get(workerId);
        const att = attByWorker.get(workerId) || [];
        const logs = logsByWorker.get(workerId) || [];

        const daysByStatus: Record<string, number> = {};
        let presentDays = 0;
        let saturdaysWorked = 0;
        const presentDates: string[] = [];
        for (const a of att) {
            daysByStatus[a.Status] = (daysByStatus[a.Status] || 0) + 1;
            if (PRESENT_STATUSES.has(a.Status)) {
                presentDays++;
                presentDates.push(a.Date);
                if (isSaturday(a.Date)) saturdaysWorked++;
            }
        }

        let bookedDays = 0;
        let totalPay = 0;
        const bookedDates = new Set<string>();
        for (const l of logs) {
            bookedDays += l.Day_Fraction ?? 1;
            totalPay += l.Daily_Rate || 0;
            bookedDates.add(l.Date);
        }

        const unbookedPresentDays = presentDates.filter(d => !bookedDates.has(d)).length;

        // Preskoči potpuno prazne redove (aktivan radnik bez ijednog zapisa u mjesecu ostaje — vidi se da nije radio)
        rows.push({
            workerId,
            name: w?.Name || logs[0]?.Worker_Name || att[0]?.Worker_Name || workerId,
            deleted: w?.Status === 'Obrisan',
            daysByStatus,
            presentDays,
            saturdaysWorked,
            bookedDays: round2(bookedDays),
            totalPay: round2(totalPay),
            unbookedPresentDays,
        });
    }

    // Obrisani radnici bez ijednog podatka u mjesecu se ne prikazuju
    const visible = rows.filter(r => !r.deleted || r.presentDays > 0 || r.bookedDays > 0 || r.totalPay > 0);
    visible.sort((a, b) => a.name.localeCompare(b.name, 'hr'));

    return {
        year,
        month,
        rows: visible,
        totalPay: round2(visible.reduce((s, r) => s + r.totalPay, 0)),
        totalPresentDays: visible.reduce((s, r) => s + r.presentDays, 0),
    };
}

/** CSV (Excel-friendly, ; separator) za izvoz obračuna. */
export function payrollToCSV(p: MonthlyPayroll): string {
    const header = ['Radnik', 'Prisutan', 'Teren', 'Subote', 'Bolovanje', 'Odmor', 'Odsutan', 'Radnik-dani (knjiga)', 'Dnevnice (KM)', 'Prisutan bez knjiženja'];
    const lines = [header.join(';')];
    for (const r of p.rows) {
        lines.push([
            r.name + (r.deleted ? ' (obrisan)' : ''),
            r.daysByStatus['Prisutan'] || 0,
            r.daysByStatus['Teren'] || 0,
            r.saturdaysWorked,
            r.daysByStatus['Bolovanje'] || 0,
            r.daysByStatus['Odmor'] || 0,
            r.daysByStatus['Odsutan'] || 0,
            r.bookedDays,
            r.totalPay.toFixed(2).replace('.', ','),
            r.unbookedPresentDays,
        ].join(';'));
    }
    lines.push(['UKUPNO', '', '', '', '', '', '', '', p.totalPay.toFixed(2).replace('.', ','), ''].join(';'));
    return lines.join('\r\n');
}
