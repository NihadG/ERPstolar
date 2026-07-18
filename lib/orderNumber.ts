// ════════════════════════════════════════════════════════════════════
// BROJ NARUDŽBE — format: N GODINA-MJESEC / SLOVO BROJ   (npr. N2026-07/K7)
//
//   N 2026-07 / K 7
//   ▲    ▲      ▲ ▲
//   │    │      │ └─ slučajan broj 1-99
//   │    │      └─── slučajno slovo (bez I i O — brkaju se s 1 i 0)
//   │    └────────── mjesec u kojem je narudžba nastala
//   └─────────────── N = narudžba (nalozi nemaju prefiks: 2026-07/R1)
//
// Za razliku od naloga (lib/workOrderNumber.ts) ovdje NEMA rednog broja:
// par slovo+broj se bira nasumično, pa se samo provjeri da nije zauzet
// unutar istog mjeseca. Broj ide dobavljaču, a redni broj bi mu odao
// koliko narudžbi mjesečno izlazi iz pogona.
//
// LEGACY: stari format (N-20260718-143022-847) parse NE prepoznaje →
// vraća null, pa ne učestvuje u provjeri zauzetosti. Stari brojevi
// ostaju na postojećim narudžbama; ovo mijenja samo NOVE.
// ════════════════════════════════════════════════════════════════════

/** Slova bez I i O — na papiru se brkaju s 1 i 0. */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Najveći nasumični broj. Kombinacija LETTERS × MAX_SEQ = 2376 po mjesecu. */
const MAX_SEQ = 99;

/** Koliko nasumičnih pokušaja prije nego se pređe na determinističko traženje. */
const RANDOM_ATTEMPTS = 40;

export interface ParsedOrderNumber {
    year: number;
    month: number;      // 1-12
    letter: string;     // A-Z (bez I i O kod novih; parse prihvata sve)
    seq: number;
}

export function formatOrderNumber(parts: ParsedOrderNumber): string {
    const mm = String(parts.month).padStart(2, '0');
    return `N${parts.year}-${mm}/${parts.letter}${parts.seq}`;
}

/**
 * Parsira NOVI format. Stari (N-20260718-143022-847) → null.
 * Strogo namjerno: labav regex bi stari broj protumačio kao novi i
 * lažno "zauzeo" kombinaciju koja je zapravo slobodna.
 */
export function parseOrderNumber(value: string | undefined | null): ParsedOrderNumber | null {
    if (!value) return null;
    const m = /^N(\d{4})-(\d{2})\/([A-Z])(\d{1,3})$/.exec(value.trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const seq = Number(m[4]);
    if (month < 1 || month > 12 || seq < 1) return null;
    return { year, month, letter: m[3], seq };
}

/** Je li broj u novom formatu (za prikaz/filtriranje starih narudžbi). */
export function isNewFormatOrderNumber(value: string | undefined | null): boolean {
    return parseOrderNumber(value) !== null;
}

function ymOf(dateISO: string): { year: number; month: number } {
    const d = new Date(dateISO);
    if (Number.isNaN(d.getTime())) {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * Slobodan broj za tekući mjesec. Gleda SAMO brojeve u novom formatu iz
 * istog mjeseca; stari se ignorišu (ne mogu se ni sudariti s novim).
 *
 * `rng` je parametar radi testova — proizvodni put koristi Math.random.
 */
export function nextOrderNumber(
    existingNumbers: (string | undefined | null)[],
    dateISO?: string,
    rng: () => number = Math.random,
): string {
    const { year, month } = ymOf(dateISO || new Date().toISOString());

    const taken = new Set<string>();
    for (const raw of existingNumbers) {
        const p = parseOrderNumber(raw);
        if (p && p.year === year && p.month === month) taken.add(`${p.letter}${p.seq}`);
    }

    // 1) Nasumično — ograničen broj pokušaja, da popunjen mjesec ne zavrti
    //    petlju koja se nikad ne završi.
    for (let i = 0; i < RANDOM_ATTEMPTS; i++) {
        const letter = LETTERS[Math.min(LETTERS.length - 1, Math.floor(rng() * LETTERS.length))];
        const seq = Math.min(MAX_SEQ, Math.floor(rng() * MAX_SEQ) + 1);
        if (!taken.has(`${letter}${seq}`)) return formatOrderNumber({ year, month, letter, seq });
    }

    // 2) Nasumično nije uspjelo (mjesec je gusto popunjen) → prvi slobodan
    //    par. Determinističan ishod je bolji od duplikata.
    for (const letter of LETTERS) {
        for (let seq = 1; seq <= MAX_SEQ; seq++) {
            if (!taken.has(`${letter}${seq}`)) return formatOrderNumber({ year, month, letter, seq });
        }
    }

    // 3) Svih 2376 kombinacija potrošeno u jednom mjesecu — proširi opseg
    //    broja umjesto da se ponovi identifikator.
    let seq = MAX_SEQ + 1;
    while (taken.has(`${LETTERS[0]}${seq}`)) seq++;
    return formatOrderNumber({ year, month, letter: LETTERS[0], seq });
}
