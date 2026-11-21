// ════════════════════════════════════════════════════════════════════
// PLATNO — BOJA PROJEKTA
//
// Na platnu boja kodira PROJEKT (ne vrstu bloka) — inače je 20 naloga jedna
// plava masa i projekti se ne razlikuju. U prikazu „Ekipe" red je par radnika,
// pa je boja JEDINI znak čiji je nalog — dva projekta s istom bojom tamo su
// nerazlučiva.
//
// Svaka nijansa ima TRI vrijednosti, jer traka nije puna zasićena boja nego
// MEKA TINTA s tamnim tekstom:
//   • ink — zasićena boja: kapica, tačka grupe, akcent, montaža (puna ispuna)
//   • bar — svijetla tinta (14 % inka na bijelom): ispuna trake naloga
//   • txt — tamni tekst na toj tinti (kontrast ≥ 6:1)
//
// Šest nijansi je razmaknuto po krugu boja (~28°, 85°, 175°, 220°, 270°, 335°).
// Ranije su indigo i violet bili gotovo ista boja, a sky je bio između teala i
// indiga — na svijetloj tinti se nisu razlikovali. Plava je namjerno „čista"
// plava (220°), ne indigo, da se na tinti ne stapa s ljubičastom.
// ════════════════════════════════════════════════════════════════════

export interface ProjectColors {
    /** Zasićena boja — kapica, tačka, akcent, puna ispuna montaže. */
    ink: string;
    /** Svijetla tinta — ispuna trake naloga. */
    bar: string;
    /** Tamni tekst na tinti. */
    txt: string;
}

/** Šest usklađenih, prigušenih nijansi, razmaknutih po krugu boja. */
export const PROJECT_COLORS: ProjectColors[] = [
    { ink: '#2563eb', bar: '#e0e9fc', txt: '#1e40af' },  // plava
    { ink: '#0f766e', bar: '#ddeceb', txt: '#115e59' },  // teal
    { ink: '#be185d', bar: '#f6dfe8', txt: '#9d174d' },  // rose
    { ink: '#b45309', bar: '#f5e7dd', txt: '#7c2d12' },  // amber
    { ink: '#4d7c0f', bar: '#e6eddd', txt: '#365314' },  // maslinasta
    { ink: '#9333ea', bar: '#f0e2fc', txt: '#6b21a8' },  // ljubičasta
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

/**
 * Boje za projekte JEDNOG plana — dva projekta nikad ne dijele boju dok ih je
 * najviše šest. Polazi od iste hash-nijanse kao `projectColors`; kad je zauzeta,
 * uzima sljedeću slobodnu. Ključevi se obrađuju sortirano, pa je dodjela
 * deterministička (ista za isti skup projekata, bez ičega u bazi).
 *
 * Primjer iz stvarnog plana: „Hotel Kladanj" i „Park Residence" su imali isti
 * hash-indeks, pa su na platnu bili iste boje.
 */
export function projectColorMap(keys: Iterable<string | undefined | null>): Map<string, ProjectColors> {
    const out = new Map<string, ProjectColors>();
    const taken = new Set<number>();
    const unique = Array.from(new Set(Array.from(keys).filter((k): k is string => !!k))).sort();
    for (const k of unique) {
        let i = hash(k) % PROJECT_COLORS.length;
        if (taken.size < PROJECT_COLORS.length) {
            while (taken.has(i)) i = (i + 1) % PROJECT_COLORS.length;
        }
        taken.add(i);
        out.set(k, PROJECT_COLORS[i]);
    }
    return out;
}
