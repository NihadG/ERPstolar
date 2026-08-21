// ════════════════════════════════════════════════════════════════════
// PLATNO — VIKEND OZNAKE NA TRACI NALOGA
//
// Traka naloga preskače vikend, ali korisnik ne vidi ZAŠTO je duža: je li
// subota unutar nje radna za dodijeljenu ekipu ili ne. Ovdje se za dati raspon
// izdvoje vikend-dani sa statusom rada, pa ih platno oboji NA samoj traci —
// subota zelena kad ekipa radi, crvena kad ne, nedjelja uvijek crvena.
//
// Čista funkcija nad datumima — geometrija (piksel-pozicija u traci) ostaje na
// pozivaocu, jer je već riješena u geometry.ts. Status subote dolazi izvana kroz
// `isSaturdayWorking`, isti checker koji određuje i dužinu trake (planning.ts →
// workerWorksSaturday), da se boja i dužina ne raziđu.
// ════════════════════════════════════════════════════════════════════

import { addDays } from './model';

export interface WeekendMark {
    iso: string;
    kind: 'sat' | 'sun';
    /** Subota: radi li dodijeljena ekipa. Nedjelja je uvijek false. */
    working: boolean;
}

/**
 * Vikend-dani (subota i nedjelja) unutar [startISO, endISO], uključivo, sa
 * statusom rada. Nedjelja je uvijek neradna; subota po `isSaturdayWorking`
 * (rotacija ekipe naloga). Bez checkera subota se tretira kao radna — isti
 * default kao ostatak platna.
 */
export function weekendMarksInSpan(
    startISO: string,
    endISO: string,
    isSaturdayWorking?: (d: Date) => boolean
): WeekendMark[] {
    if (endISO < startISO) return [];
    const out: WeekendMark[] = [];
    let cur = startISO;
    // Granica 400 iteracija = ~13 mjeseci; nijedna traka ne treba više.
    for (let i = 0; i <= 400 && cur <= endISO; i++) {
        const d = new Date(`${cur}T12:00:00`);
        const dow = d.getDay();
        if (dow === 6) {
            out.push({ iso: cur, kind: 'sat', working: isSaturdayWorking ? isSaturdayWorking(d) : true });
        } else if (dow === 0) {
            out.push({ iso: cur, kind: 'sun', working: false });
        }
        cur = addDays(cur, 1);
    }
    return out;
}
