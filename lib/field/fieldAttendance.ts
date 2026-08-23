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

/** Vrijeme zapisa za odabir najsvježijeg duplikata (Modified pa Created). */
const attTime = (a: WorkerAttendance): number =>
    Date.parse(a.Modified_Date || a.Created_Date || '') || 0;

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

    // DEDUP (radnik, dan) → JEDAN status. U bazi znaju živjeti dva zapisa za
    // isti dan: jedan sa `Date` = "YYYY-MM-DD", drugi zaostali sa punim ISO
    // vremenom ("…T00:00:00Z"). `setAttendance` upsertuje po tačnom "YYYY-MM-DD",
    // pa nikad ne pogodi zaostali blizanac — a bez dedupa ovdje projekcija zna
    // vratiti baš njega (stari status), i ekran tvrdi da se „status ne sačuva".
    // Rješenje bez migracije: za svaki (radnik, dan) zadrži NAJSVJEŽIJI zapis.
    const latestByKey = new Map<string, WorkerAttendance>();
    for (const a of input.attendance) {
        if (!known.has(a.Worker_ID)) continue;
        const key = `${a.Worker_ID}|${dOnly(a.Date)}`;
        const prev = latestByKey.get(key);
        if (!prev || attTime(a) >= attTime(prev)) latestByKey.set(key, a);
    }

    const entries: FieldAttendanceEntry[] = Array.from(latestByKey.values()).map(a => ({
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
