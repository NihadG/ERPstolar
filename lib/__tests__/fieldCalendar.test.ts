// ════════════════════════════════════════════════════════════════════
// RADNIKOV KALENDAR
//
// Provjerava razrješenje kolega (ko je bio na istoj stavci istog dana),
// poravnanje mreže na ponedjeljak i — najvažnije — da iz WorkLog-a NE izlazi
// nijedna dnevnica.
// ════════════════════════════════════════════════════════════════════

import { buildWorkerCalendar, type WorkerCalendarInput } from '@/lib/field/fieldCalendar';
import type { WorkerAttendance, WorkLog } from '@/lib/types';

function log(over: Partial<WorkLog>): WorkLog {
    return {
        WorkLog_ID: 'l', Organization_ID: 'org-1', Date: '2026-07-14',
        Worker_ID: 'w-1', Worker_Name: 'Mujo', Daily_Rate: 12345, Original_Daily_Rate: 67890,
        Hours_Worked: 8, Work_Order_ID: 'wo-1', Work_Order_Item_ID: 'item-1', Product_ID: 'p-1',
        Process_Name: 'Kantiranje', Is_From_Attendance: true, Created_At: '2026-07-14', Day_Fraction: 1,
        ...over,
    } as WorkLog;
}

function att(date: string, status = 'Prisutan'): WorkerAttendance {
    return {
        Attendance_ID: `a-${date}`, Organization_ID: 'org-1', Worker_ID: 'w-1', Worker_Name: 'Mujo',
        Date: date, Status: status as WorkerAttendance['Status'], Created_Date: date,
    } as WorkerAttendance;
}

function input(over: Partial<WorkerCalendarInput> = {}): WorkerCalendarInput {
    return {
        month: '2026-07', workerId: 'w-1',
        allLogs: [
            log({ Date: '2026-07-14' }),
            log({ WorkLog_ID: 'l2', Worker_ID: 'w-9', Worker_Name: 'Haso', Date: '2026-07-14' }),   // kolega
        ],
        attendance: [att('2026-07-14')],
        productNameById: new Map([['p-1', 'Kuhinja Gornji element']]),
        ...over,
    };
}

describe('buildWorkerCalendar', () => {
    it('juli 2026 počinje u srijedu → 2 prazne ćelije (pon, uto)', () => {
        const cal = buildWorkerCalendar(input());
        expect(cal.leadBlanks).toBe(2);
        expect(cal.days).toHaveLength(31);
    });

    it('dan nosi radnikove proizvode i imena kolega sa iste stavke', () => {
        const cal = buildWorkerCalendar(input());
        const d14 = cal.days.find(d => d.date === '2026-07-14')!;
        expect(d14.attendanceStatus).toBe('Prisutan');
        expect(d14.bookedDays).toBe(1);
        expect(d14.work).toEqual([{ productName: 'Kuhinja Gornji element', processName: 'Kantiranje' }]);
        expect(d14.coworkers).toEqual(['Haso']);
    });

    it('kolega na DRUGOJ stavci istog dana se ne broji', () => {
        const cal = buildWorkerCalendar(input({
            allLogs: [
                log({ Date: '2026-07-14' }),
                log({ WorkLog_ID: 'l2', Worker_ID: 'w-9', Worker_Name: 'Haso', Work_Order_Item_ID: 'item-druga', Date: '2026-07-14' }),
            ],
        }));
        const d14 = cal.days.find(d => d.date === '2026-07-14')!;
        expect(d14.coworkers).toEqual([]);
    });

    it('sažetak broji radne, prisutne i terenske dane', () => {
        const cal = buildWorkerCalendar(input({
            allLogs: [log({ Date: '2026-07-14' }), log({ WorkLog_ID: 'lt', Date: '2026-07-16' })],
            attendance: [att('2026-07-14'), att('2026-07-16', 'Teren')],
        }));
        expect(cal.summary.workedDays).toBe(2);
        expect(cal.summary.presentDays).toBe(2);
        expect(cal.summary.fieldDays).toBe(1);
    });

    it('ne propušta dnevnicu ni ime firme', () => {
        const cal = buildWorkerCalendar(input());
        const numbers: number[] = [];
        const keys: string[] = [];
        const walk = (v: unknown) => {
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) { keys.push(k); walk(val); }
            else if (typeof v === 'number') numbers.push(v);
        };
        walk(cal);
        expect(keys).not.toContain('Daily_Rate');
        expect(keys).not.toContain('Original_Daily_Rate');
        expect(numbers).not.toContain(12345);
        expect(numbers).not.toContain(67890);
    });
});
