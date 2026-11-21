// ════════════════════════════════════════════════════════════════════
// PRAZNICI — neradni dani za cijelu radionicu
//
// Odluka vlasnika (21.11.2026): unaprijed upisani bh. praznici + njegovi,
// uređivi u Postavkama (org_settings.holidays). Dok lista nije sačuvana,
// važe zadani; kad je vlasnik jednom sačuva, važi tačno njegova lista.
//
// Zadani: državni praznici FBiH (fiksni datumi), Ramazanski i Kurban bajram
// (pomični — datum objavljuje Islamska zajednica, pa nose oznaku „provjeri"),
// katolički Božić. Ostale vjerske praznike vlasnik dodaje sam.
//
// Praznik u kalendaru: lib/planning.ts withHolidays (rok naloga, Platno, model).
// jest: lib/__tests__/holidays.test.ts
// ════════════════════════════════════════════════════════════════════

export interface Holiday {
    date: string;           // YYYY-MM-DD
    name: string;
    /** Pomični datum koji treba potvrditi (bajrami). */
    verify?: boolean;
}

const FIXED: [string, string][] = [
    ['01-01', 'Nova godina'],
    ['01-02', 'Nova godina (drugi dan)'],
    ['03-01', 'Dan nezavisnosti'],
    ['05-01', 'Praznik rada'],
    ['05-02', 'Praznik rada (drugi dan)'],
    ['11-25', 'Dan državnosti'],
    ['12-25', 'Božić'],
];

/** Prvi dani bajrama (procjena po objavljenim kalendarima; IZ BiH potvrđuje). */
const BAJRAM: Record<number, [string, string][]> = {
    2026: [['2026-03-20', 'Ramazanski bajram'], ['2026-05-27', 'Kurban bajram']],
    2027: [['2027-03-09', 'Ramazanski bajram'], ['2027-05-16', 'Kurban bajram']],
};

export function defaultHolidays(years: number[]): Holiday[] {
    const out: Holiday[] = [];
    for (const y of years) {
        FIXED.forEach(([md, name]) => out.push({ date: `${y}-${md}`, name }));
        (BAJRAM[y] || []).forEach(([date, name]) => out.push({ date, name, verify: true }));
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Godine za koje se nude zadani praznici: tekuća i sljedeća. */
export const defaultYears = (todayISO: string) => [Number(todayISO.slice(0, 4)), Number(todayISO.slice(0, 4)) + 1];

/** Važeća lista: sačuvana (ako postoji) ili zadana. */
export function effectiveHolidays(saved: Holiday[] | null | undefined, todayISO: string): Holiday[] {
    return saved && saved.length ? saved.slice().sort((a, b) => a.date.localeCompare(b.date)) : defaultHolidays(defaultYears(todayISO));
}

export const holidayDates = (list: Holiday[]) => list.map(h => h.date);

/** Provjera unosa: ispravan datum, bez duplikata. */
export function addHoliday(list: Holiday[], h: Holiday): Holiday[] | string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date) || isNaN(Date.parse(`${h.date}T12:00:00Z`))) return 'Datum nije ispravan.';
    if (!h.name.trim()) return 'Upiši naziv praznika.';
    if (list.some(x => x.date === h.date)) return 'Taj dan je već praznik.';
    return [...list, { date: h.date, name: h.name.trim() }].sort((a, b) => a.date.localeCompare(b.date));
}
