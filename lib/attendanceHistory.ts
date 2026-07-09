// ════════════════════════════════════════════════════════════════════
// ČISTA LOGIKA "NEDOSTAJE PRISUSTVO" (bez Firebase, pokrivena testovima).
//
// Kartica naloga upozorava na dane bez knjižene dnevnice za dodijeljene radnike. Ranije je
// gledala SAMO work_logove OVOG naloga (pon–pet), pa je lažno prijavljivala dane kad je radnik:
//   • radio na DRUGOM nalogu tog dana (dnevnica postoji, ali ne na ovom nalogu), ili
//   • bio odsutan/na odmoru/nezabilježen u šihtarici (nije ni trebao raditi).
//
// Ispravno: dan se prijavljuje SAMO kad je radnik bio PRISUTAN (šihtarica: Prisutan/Teren)
// a NEMA dnevnicu ni na jednom nalogu tog dana → stvaran, akcijski propust knjiženja.
// ════════════════════════════════════════════════════════════════════

/** Lokalni YYYY-MM-DD (bez UTC pomaka). */
function toLocalISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface MissingAttendanceInput {
    startISO: string;                       // prvi dan (YYYY-MM-DD, lokalno)
    endISO: string;                         // zadnji dan (uklj.)
    workers: { id: string; name: string }[];
    presentByWorkerDate: Set<string>;       // `${workerId}_${YYYY-MM-DD}` — šihtarica = Prisutan/Teren
    bookedByWorkerDate: Set<string>;        // `${workerId}_${YYYY-MM-DD}` — dnevnica na BILO kojem nalogu
}

/**
 * Dani (po radniku) gdje je radnik bio prisutan u šihtarici, ali nema dnevnicu nigdje.
 * Čisto (bez Firebase) — pozivalac dohvaća šihtaricu i work_logove i gradi skupove.
 */
export function computeMissingAttendanceDays(input: MissingAttendanceInput): { date: string; workerName: string }[] {
    const { startISO, endISO, workers, presentByWorkerDate, bookedByWorkerDate } = input;
    const out: { date: string; workerName: string }[] = [];
    const d = new Date(startISO + 'T00:00:00');
    const end = new Date(endISO + 'T00:00:00');
    while (d <= end) {
        const dateStr = toLocalISO(d);
        for (const w of workers) {
            const key = `${w.id}_${dateStr}`;
            if (presentByWorkerDate.has(key) && !bookedByWorkerDate.has(key)) {
                out.push({ date: dateStr, workerName: w.name });
            }
        }
        d.setDate(d.getDate() + 1);
    }
    return out;
}
