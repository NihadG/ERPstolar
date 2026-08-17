// ════════════════════════════════════════════════════════════════════
// PLATNO — BOJA PROJEKTA
//
// Na platnu boja kodira VRSTU bloka, a skoro sve je vrsta „nalog" — pa osam
// naloga izgleda kao jedna plava masa i projekti se ne razlikuju.
//
// Ovdje je drugi kanal: stabilna nijansa po projektu, izvedena iz njegovog ID-a.
// Stabilna znači da isti projekt ima istu boju u svakoj sesiji i na svakom
// ekranu — bez čuvanja ičega u bazi.
//
// Zasad je koristi kalendar radnika. Trake na osi su namjerno netaknute: to je
// zaseban zahvat i ne smije se prošvercati kroz ovu promjenu.
// ════════════════════════════════════════════════════════════════════

/**
 * Deset nijansi biranih da se razlikuju i na svijetloj i na tamnoj podlozi, i
 * da bijeli tekst na njima ostane čitljiv (kontrast ≥ 4.5:1 na svakoj).
 */
export const PROJECT_HUES = [
    '#3457d5', '#0c7268', '#9a3d86', '#a5550a', '#2f7d32',
    '#6a4bc4', '#0d6f9e', '#b03652', '#5d6f2c', '#4b5b78',
] as const;

/**
 * Nijansa za blok bez projekta — namjerno neutralna, da ne glumi projekt.
 * Dovoljno tamna da bijeli natpis na traci ostane čitljiv (≥4.5:1).
 */
export const NO_PROJECT_HUE = '#5b6573';

/**
 * FNV-1a. Bilo koji stabilan hash bi radio; bitno je da ne ovisi o redoslijedu
 * učitavanja projekata (indeks u nizu bi se mijenjao kad se doda novi projekt,
 * pa bi cijela radionica preko noći promijenila boje).
 */
function hash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Boja projekta po njegovom ID-u (ili nazivu kad ID-a nema). */
export function projectHue(key: string | undefined | null): string {
    if (!key) return NO_PROJECT_HUE;
    return PROJECT_HUES[hash(key) % PROJECT_HUES.length];
}
