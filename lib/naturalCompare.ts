/**
 * Prirodno (alfanumeričko) poređenje stringova.
 *
 * Ključ je `{ numeric: true }` — bez njega `localeCompare` daje LEKSIKOGRAFSKI poredak
 * pa je "E10" prije "E2" (jer '1' < '2' znak-po-znak). S `numeric: true` brojevi u nizu
 * porede se po vrijednosti: "E1" < "E2" < "E10", "1" < "2" < "10".
 *
 * `sensitivity: 'base'` → poredak je case/akcenat-neosjetljiv (npr. "E1" == "e1"),
 * što je poželjno za šifre pozicija i proizvoda.
 */
export const naturalCollator = new Intl.Collator('hr', { numeric: true, sensitivity: 'base' });

/** Poredi dva (moguće prazna) stringa prirodnim redoslijedom. */
export const naturalCompare = (a: string | null | undefined, b: string | null | undefined): number =>
    naturalCollator.compare(a || '', b || '');
