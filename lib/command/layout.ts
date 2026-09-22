// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — PRILAGODLJIV RASPORED TABLE
//
// Tabla ima dvije kolone: lijevo ono što se PRAVI (proizvodi, nalozi),
// desno ono što se PRATI (narudžbe, zadaci, napomene). Dok je podjela
// širine bila fiksna, otvorena narudžba je u uskoj desnoj koloni bila
// zgužvana tabela, a lijevo je stajalo pola praznog prostora.
//
// Pravilo je sada jedno: ŠIRINA IDE ZA ONIM ŠTO SI ZADNJE OTVORIO.
//   • otvoriš narudžbu        → desna kolona se raširi, lijeva suzi
//   • otvoriš proizvod/nalog  → lijeva dobije širinu nazad
//   • ⤢ na ploči              → ploča ostaje široka dok je ne vratiš
//   • sklopiš cijelu kolonu   → ona postane uska traka, druga uzme sve
// Ploče se NIKAD ne premještaju — mijenja se samo širina. Ranije
// preslagivanje strane na svaki klik je gubilo mjesto na kojem si bio.
//
// Sve je čisto (bez Reacta), da se pravila mogu testirati.
// ════════════════════════════════════════════════════════════════════

export type PanelId = 'calendar' | 'products' | 'workorders' | 'purchases' | 'tasks' | 'notes';

export const PANEL_IDS: PanelId[] = ['calendar', 'products', 'workorders', 'purchases', 'tasks', 'notes'];
export const MAIN_PANELS: PanelId[] = ['products', 'workorders'];
export const RAIL_PANELS: PanelId[] = ['purchases', 'tasks', 'notes'];

export type BoardColumn = 'top' | 'main' | 'rail';

export function panelColumn(panel: PanelId): BoardColumn {
    if (MAIN_PANELS.includes(panel)) return 'main';
    if (RAIL_PANELS.includes(panel)) return 'rail';
    return 'top';
}

export function isPanelId(value: unknown): value is PanelId {
    return typeof value === 'string' && (PANEL_IDS as string[]).includes(value);
}

/**
 * Zašto je ploča „u fokusu":
 *   pin  — korisnik je svjesno kliknuo ⤢ (ostaje dok se ne vrati)
 *   auto — nešto je otvoreno unutar ploče (nestaje kad se zatvori)
 */
export interface FocusEntry {
    panel: PanelId;
    source: 'pin' | 'auto';
}

/** Podjela širine između kolona. */
export type BoardSplit = 'balanced' | 'main-wide' | 'rail-wide' | 'main-slim' | 'rail-slim';

/**
 * Stavlja ploču na vrh fokusa. Pin je samo jedan — novi pin skida stari,
 * inače bi dvije ploče istovremeno tražile punu širinu.
 */
export function pushFocus(stack: FocusEntry[], entry: FocusEntry): FocusEntry[] {
    const rest = stack.filter(f => !(f.panel === entry.panel && f.source === entry.source)
        && !(entry.source === 'pin' && f.source === 'pin'));
    return [...rest, entry];
}

export function dropFocus(stack: FocusEntry[], panel: PanelId, source?: FocusEntry['source']): FocusEntry[] {
    const next = stack.filter(f => !(f.panel === panel && (!source || f.source === source)));
    return next.length === stack.length ? stack : next;
}

export function pinnedPanel(stack: FocusEntry[]): PanelId | null {
    return stack.find(f => f.source === 'pin')?.panel ?? null;
}

/**
 * Podjela širine iz stanja ploča.
 *
 * Automatski fokus u LIJEVOJ koloni vraća samo ravnotežu, ne širi je dalje:
 * lijeva je po zadanom već šira, a prošireni nalog na njoj ionako ima
 * prostora viška. Dodatno širenje na svaki klik bi samo tjeralo tekst da
 * se prelama. Svjesni ⤢ je druga priča — tu korisnik traži više.
 */
export function boardSplit(collapsed: ReadonlySet<PanelId>, focus: FocusEntry[]): BoardSplit {
    const mainClosed = MAIN_PANELS.every(p => collapsed.has(p));
    const railClosed = RAIL_PANELS.every(p => collapsed.has(p));
    if (mainClosed && !railClosed) return 'main-slim';
    if (railClosed && !mainClosed) return 'rail-slim';

    const top = [...focus].reverse().find(f => !collapsed.has(f.panel) && panelColumn(f.panel) !== 'top');
    if (!top) return 'balanced';
    if (panelColumn(top.panel) === 'rail') return 'rail-wide';
    return top.source === 'pin' ? 'main-wide' : 'balanced';
}

/**
 * Koliko širine dobija koja kolona (flex-grow, osnova 0). Brojevi su
 * odmjereni na stvarnom sadržaju:
 *   balanced  ≈ 65 : 35 — lista proizvoda nosi najviše teksta
 *   rail-wide ≈ 44 : 56 — tabela narudžbe dobije sve kolone, a red
 *                         proizvoda i dalje stane u jedan red
 *   main-wide ≈ 75 : 25 — desna kolona pada na svoj minimum
 * Uske kolone („slim") imaju fiksnu osnovu: sklopljene ploče su samo
 * zaglavlja i ne trebaju više od toga.
 */
export interface ColumnSizing {
    mainGrow: number;
    railGrow: number;
    mainBasis: number;
    railBasis: number;
}

export function columnSizing(split: BoardSplit): ColumnSizing {
    switch (split) {
        case 'rail-wide': return { mainGrow: 1, railGrow: 1.28, mainBasis: 0, railBasis: 0 };
        case 'main-wide': return { mainGrow: 2.4, railGrow: 0.8, mainBasis: 0, railBasis: 0 };
        case 'rail-slim': return { mainGrow: 1, railGrow: 0, mainBasis: 0, railBasis: 290 };
        case 'main-slim': return { mainGrow: 0, railGrow: 1, mainBasis: 300, railBasis: 0 };
        default: return { mainGrow: 1.55, railGrow: 0.85, mainBasis: 0, railBasis: 0 };
    }
}

/** Uključi/isključi ploču u skupu sklopljenih — vraća novi niz za upis. */
export function toggleCollapsed(current: readonly PanelId[], panel: PanelId): PanelId[] {
    return current.includes(panel) ? current.filter(p => p !== panel) : [...current, panel];
}
