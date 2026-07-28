// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA ŠIHTARICE — ono što kontrolorov telefon smije vidjeti
//
// Dvije stvari koje se ovdje NAMJERNO odbacuju:
//
//  1. `Worker.Daily_Rate` i `Daily_Rate_History`. Radnik u listi je ime,
//     uloga i tip — ništa više. Kontrolor raspoređuje ljude, ne plate.
//
//  2. Cijeli `work_logs` dokument. Ekranu treba samo odgovor na pitanje
//     „ima li ovaj radnik dnevnicu za taj dan?", a to je jedan ključ
//     `workerId|datum`. Desktop danas povuče cijeli mjesec zapisa na klijent
//     (a oni nose Daily_Rate i Original_Daily_Rate) samo da bi izračunao isti
//     taj skup ključeva.
//
// Kao i ostale projekcije: izlaz se gradi NABRAJANJEM polja, nikad spreadom.
// ════════════════════════════════════════════════════════════════════

import type { Worker, WorkerAttendance, WorkLog } from '@/lib/types';

export interface FieldWorkerRow {
    workerId: string;
    name: string;
    role: string;
    workerType: string;
}

export interface FieldAttendanceEntry {
    workerId: string;
    date: string;        // YYYY-MM-DD
    status: string;
    notes: string;
}

export interface FieldAttendancePayload {
    from: string;
    to: string;
    today: string;
    workers: FieldWorkerRow[];
    entries: FieldAttendanceEntry[];
    /** `${workerId}|${YYYY-MM-DD}` — radnik ima bar jednu dnevnicu tog dana. */
    bookedKeys: string[];
}

export interface FieldAttendanceInput {
    from: string;
    to: string;
    today: string;
    workers: Worker[];
    attendance: WorkerAttendance[];
    workLogs: WorkLog[];
}

export const bookedKey = (workerId: string, date: string) => `${workerId}|${date}`;

const dOnly = (iso?: string | null): string => (iso ? iso.split('T')[0] : '');

export function buildFieldAttendance(input: FieldAttendanceInput): FieldAttendancePayload {
    const workers: FieldWorkerRow[] = input.workers
        .filter(w => w.Status !== 'Obrisan')
        .map(w => ({
            workerId: w.Worker_ID,
            name: w.Name || '',
            role: w.Role || '',
            workerType: w.Worker_Type || 'Glavni',
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'bs'));

    const known = new Set(workers.map(w => w.workerId));

    const entries: FieldAttendanceEntry[] = input.attendance
        .filter(a => known.has(a.Worker_ID))
        .map(a => ({
            workerId: a.Worker_ID,
            date: dOnly(a.Date),
            status: a.Status,
            notes: a.Notes || '',
        }));

    // Cijeli mjesec dnevnica svede se na skup ključeva — nijedan iznos ne izlazi.
    const bookedKeys = Array.from(new Set(
        input.workLogs
            .filter(l => l.Worker_ID && l.Date)
            .map(l => bookedKey(l.Worker_ID, dOnly(l.Date)))
    ));

    return {
        from: input.from,
        to: input.to,
        today: input.today,
        workers,
        entries,
        bookedKeys,
    };
}

/**
 * Radnici koji su prisutni/na terenu, a nemaju nijednu dnevnicu za taj dan.
 * To je žuta traka „N bez dnevnice — Proknjiži".
 */
export function unbookedPresentWorkers(
    payload: Pick<FieldAttendancePayload, 'entries' | 'bookedKeys' | 'workers'>,
    date: string
): { workerId: string; workerName: string; status: string }[] {
    const booked = new Set(payload.bookedKeys);
    const nameById = new Map(payload.workers.map(w => [w.workerId, w.name]));

    return payload.entries
        .filter(e =>
            e.date === date
            && (e.status === 'Prisutan' || e.status === 'Teren')
            && !booked.has(bookedKey(e.workerId, date))
        )
        .map(e => ({
            workerId: e.workerId,
            workerName: nameById.get(e.workerId) || '',
            status: e.status,
        }));
}
