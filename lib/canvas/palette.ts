// ════════════════════════════════════════════════════════════════════
// PLATNO — BOJA PROJEKTA
//
// Na platnu boja kodira PROJEKT (ne vrstu bloka) — inače je 20 naloga jedna
// plava masa i projekti se ne razlikuju.
//
// Svaka nijansa ima TRI vrijednosti, jer traka nije puna zasićena boja nego
// MEKA TINTA s tamnim tekstom i tankom obojenom kapicom lijevo (smireniji,
// komercijalniji izgled — kao Motion/Asana/Linear):
//   • ink — zasićena boja: kapica, tačka grupe, akcent, montaža (puna ispuna)
//   • bar — vrlo svijetla tinta: ispuna trake naloga
//   • txt — tamni tekst na toj tinti (kontrast ≥ 7:1)
//
// Boje su MUTED (ne sirovo zasićene) i biraju se deterministički iz ID-a
// projekta — stabilno kroz sesije, bez ičega u bazi.
// ════════════════════════════════════════════════════════════════════

export interface ProjectColors {
    /** Zasićena boja — kapica, tačka, akcent, puna ispuna montaže. */
    ink: string;
    /** Svijetla tinta — ispuna trake naloga. */
    bar: string;
    /** Tamni tekst na tinti. */
    txt: string;
}

/** Šest usklađenih, prigušenih nijansi. */
export const PROJECT_COLORS: ProjectColors[] = [
    { ink: '#4f46e5', bar: '#ebeafc', txt: '#3730a3' },  // indigo
    { ink: '#0d9488', bar: '#d9f1ec', txt: '#0f5f57' },  // teal
    { ink: '#be185d', bar: '#fbe3ee', txt: '#8f1247' },  // rose
    { ink: '#b45309', bar: '#fbecd4', txt: '#83400b' },  // amber
    { ink: '#4338ca', bar: '#e7e6fb', txt: '#312a97' },  // violet
    { ink: '#0369a1', bar: '#dcecf8', txt: '#075283' },  // sky
];

/** Nijansa za blok bez projekta — neutralna, da ne glumi projekt. */
export const NO_PROJECT_COLORS: ProjectColors = { ink: '#5b6573', bar: '#e9ecf1', txt: '#3f4653' };

/** Zadržano zbog istorijske neutralne boje (kontrast bijelog ≥ 4.5:1). */
export const NO_PROJECT_HUE = NO_PROJECT_COLORS.ink;

/**
 * FNV-1a. Bilo koji stabilan hash radi; bitno je da NE ovisi o redoslijedu
 * učitavanja projekata (indeks u nizu bi se mijenjao kad se doda projekt, pa
 * bi cijela radionica preko noći promijenila boje).
 */
function hash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Sve tri boje projekta po ID-u (ili nazivu). Bez ključa → neutralna. */
export function projectColors(key: string | undefined | null): ProjectColors {
    if (!key) return NO_PROJECT_COLORS;
    return PROJECT_COLORS[hash(key) % PROJECT_COLORS.length];
}

/** Samo zasićena boja (ink) — za mjesta koja traže jedan hex (npr. kalendar radnika). */
export function projectHue(key: string | undefined | null): string {
    return projectColors(key).ink;
}
