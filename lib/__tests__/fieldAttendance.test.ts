// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA ŠIHTARICE
//
// Kontrolor nema pristup Firestoreu, pa je ova funkcija jedina granica između
// njegovog telefona i podataka firme. Najvažniji test je „ne propušta novac":
// `Worker` nosi Daily_Rate i cijelu istoriju cijena, a `WorkLog` nosi iznos
// svake dnevnice — ništa od toga ne smije izaći.
// ════════════════════════════════════════════════════════════════════

import {
    bookedKey, buildFieldAttendance, unbookedPresentWorkers,
    type FieldAttendanceInput,
} from '@/lib/field/fieldAttendance';
import type { Worker, WorkerAttendance, WorkLog } from '@/lib/types';

const FORBIDDEN_KEYS = [
    'Daily_Rate', 'Daily_Rate_History', 'Original_Daily_Rate', 'Rate',
    'Split_Factor', 'Hours_Worked', 'Effective_From',
];

function walk(value: unknown, keys: string[] = [], numbers: number[] = []): { keys: string[]; numbers: number[] } {
    if (Array.isArray(value)) {
        value.forEach(v => walk(v, keys, numbers));
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            keys.push(k);
            walk(v, keys, numbers);
        }
    } else if (typeof value === 'number') {
        numbers.push(value);
    }
    return { keys, numbers };
}

const worker = (over: Partial<Worker> = {}): Worker => ({
    Worker_ID: 'w-1', Organization_ID: 'org-1', Name: 'Mujo Mujić',
    Role: 'Rezač', Worker_Type: 'Glavni', Phone: '', Status: 'Aktivan',
    // Novčana polja NAMJERNO postavljena — test dokazuje da ne izlaze.
    Daily_Rate: 93.75,
    Daily_Rate_History: [{ Effective_From: '2026-01-01', Rate: 87.5 }],
    ...over,
});

const attendance = (over: Partial<WorkerAttendance> = {}): WorkerAttendance => ({
    Attendance_ID: 'a-1', Organization_ID: 'org-1',
    Worker_ID: 'w-1', Worker_Name: 'Mujo Mujić',
    Date: '2026-07-15', Status: 'Prisutan', Notes: '',
    Created_Date: '2026-07-15T07:00:00.000Z',
    ...over,
});

const workLog = (over: Partial<WorkLog> = {}): WorkLog => ({
    WorkLog_ID: 'l-1', Organization_ID: 'org-1', Date: '2026-07-15',
    Worker_ID: 'w-1', Worker_Name: 'Mujo Mujić',
    Daily_Rate: 46.88, Original_Daily_Rate: 93.75, Hours_Worked: 8,
    Split_Factor: 2, Day_Fraction: 0.5,
    Work_Order_ID: 'wo-1', Work_Order_Item_ID: 'item-1', Product_ID: 'p-1',
    Is_From_Attendance: true, Created_At: '',
    ...over,
} as WorkLog);

const makeInput = (over: Partial<FieldAttendanceInput> = {}): FieldAttendanceInput => ({
    from: '2026-07-13', to: '2026-07-19', today: '2026-07-15',
    workers: [worker()],
    attendance: [attendance()],
    workLogs: [workLog()],
    ...over,
});

describe('buildFieldAttendance — novac ne izlazi', () => {
    it('nijedno polje o dnevnici se ne pojavljuje u izlazu', () => {
        const { keys } = walk(buildFieldAttendance(makeInput()));
        for (const forbidden of FORBIDDEN_KEYS) {
            expect(keys).not.toContain(forbidden);
        }
    });

    it('nijedan iznos iz ulaza ne procuri kao broj', () => {
        const payload = buildFieldAttendance(makeInput({
            workers: [worker({ Daily_Rate: 12345, Daily_Rate_History: [{ Effective_From: '2026-01-01', Rate: 54321 }] })],
            workLogs: [workLog({ Daily_Rate: 67890, Original_Daily_Rate: 98765 })],
        }));
        const { numbers } = walk(payload);
        for (const amount of [12345, 54321, 67890, 98765]) {
            expect(numbers).not.toContain(amount);
        }
    });

    it('radnik je samo ime, uloga i tip', () => {
        const payload = buildFieldAttendance(makeInput());
        expect(Object.keys(payload.workers[0]).sort()).toEqual(['name', 'role', 'workerId', 'workerType']);
    });

    it('cijeli mjesec dnevnica svede se na ključeve, ne dokumente', () => {
        const payload = buildFieldAttendance(makeInput({
            workLogs: [
                workLog({ WorkLog_ID: 'l-1', Work_Order_Item_ID: 'item-1' }),
                workLog({ WorkLog_ID: 'l-2', Work_Order_Item_ID: 'item-2' }),
            ],
        }));
        // Dva zapisa istog radnika istog dana → jedan ključ.
        expect(payload.bookedKeys).toEqual(['w-1|2026-07-15']);
    });
});

describe('buildFieldAttendance — sadržaj', () => {
    it('arhivirani radnici se ne prikazuju', () => {
        const payload = buildFieldAttendance(makeInput({
            workers: [worker(), worker({ Worker_ID: 'w-2', Name: 'Haso Hasić', Status: 'Obrisan' })],
        }));
        expect(payload.workers.map(w => w.workerId)).toEqual(['w-1']);
    });

    it('radnici su poredani po imenu', () => {
        const payload = buildFieldAttendance(makeInput({
            workers: [
                worker({ Worker_ID: 'w-2', Name: 'Zlatan Zukić' }),
                worker({ Worker_ID: 'w-1', Name: 'Amir Alić' }),
            ],
        }));
        expect(payload.workers.map(w => w.name)).toEqual(['Amir Alić', 'Zlatan Zukić']);
    });

    it('prisustvo arhiviranog radnika se odbacuje (nema ga u listi)', () => {
        const payload = buildFieldAttendance(makeInput({
            workers: [worker()],
            attendance: [attendance(), attendance({ Attendance_ID: 'a-2', Worker_ID: 'w-9' })],
        }));
        expect(payload.entries).toHaveLength(1);
        expect(payload.entries[0].workerId).toBe('w-1');
    });

    it('datum se skraćuje na dan i kad zapis nosi puni ISO', () => {
        const payload = buildFieldAttendance(makeInput({
            attendance: [attendance({ Date: '2026-07-15T00:00:00.000Z' })],
        }));
        expect(payload.entries[0].date).toBe('2026-07-15');
    });
});

describe('unbookedPresentWorkers', () => {
    const base = buildFieldAttendance(makeInput({ workLogs: [] }));

    it('prisutan bez dnevnice se prijavljuje', () => {
        expect(unbookedPresentWorkers(base, '2026-07-15')).toEqual([
            { workerId: 'w-1', workerName: 'Mujo Mujić', status: 'Prisutan' },
        ]);
    });

    it('prisutan s dnevnicom se NE prijavljuje', () => {
        const withLog = buildFieldAttendance(makeInput());
        expect(unbookedPresentWorkers(withLog, '2026-07-15')).toEqual([]);
    });

    it('odsutan se ne prijavljuje ni bez dnevnice', () => {
        const absent = buildFieldAttendance(makeInput({
            attendance: [attendance({ Status: 'Odsutan' })], workLogs: [],
        }));
        expect(unbookedPresentWorkers(absent, '2026-07-15')).toEqual([]);
    });

    it('teren se prijavljuje isto kao prisutan', () => {
        const teren = buildFieldAttendance(makeInput({
            attendance: [attendance({ Status: 'Teren' })], workLogs: [],
        }));
        expect(unbookedPresentWorkers(teren, '2026-07-15')).toHaveLength(1);
    });

    it('gleda samo traženi dan', () => {
        expect(unbookedPresentWorkers(base, '2026-07-16')).toEqual([]);
    });
});

describe('bookedKey', () => {
    it('spaja radnika i datum', () => {
        expect(bookedKey('w-1', '2026-07-15')).toBe('w-1|2026-07-15');
    });
});
