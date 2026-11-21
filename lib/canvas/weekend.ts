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

/** Uzastopni dani trake iste vrste — radni (puna traka) ili neradni (tanka linija). */
export interface WorkRun {
    fromISO: string;
    toISO: string;
    working: boolean;
}

/**
 * Traka naloga razložena na RADNE i NERADNE komade. Platno crta radne dane kao
 * pune komade, a neradne (nedjelja, subota kad ekipa ne radi) kao tanku liniju
 * koja ih spaja — „pauza", ne greška. Ranije je neradni dan bio crveno
 * zatamnjenje preko trake i izgledao kao upozorenje.
 *
 * Ako u rasponu nema nijednog radnog dana (npr. blok ručno stavljen na
 * nedjelju), cijela traka se vraća kao radna — blok mora ostati vidljiv.
 */
export function workRuns(
    startISO: string,
    endISO: string,
    isSaturdayWorking?: (d: Date) => boolean
): WorkRun[] {
    if (endISO < startISO) return [{ fromISO: startISO, toISO: startISO, working: true }];
    const runs: WorkRun[] = [];
    let cur = startISO;
    for (let i = 0; i <= 400 && cur <= endISO; i++) {
        const d = new Date(`${cur}T12:00:00`);
        const dow = d.getDay();
        const working = dow === 0 ? false : dow === 6 ? (isSaturdayWorking ? isSaturdayWorking(d) : true) : true;
        const last = runs[runs.length - 1];
        if (last && last.working === working) last.toISO = cur;
        else runs.push({ fromISO: cur, toISO: cur, working });
        cur = addDays(cur, 1);
    }
    if (!runs.some(r => r.working)) return [{ fromISO: startISO, toISO: endISO, working: true }];
    return runs;
}

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
