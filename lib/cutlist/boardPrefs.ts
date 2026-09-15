// ════════════════════════════════════════════════════════════════════
// DIMENZIJE PLOČA — presetovi i zapamćeni izbor po materijalu
//
// Dijeli ih krojenje na kartici proizvoda (CutlistModal) i kalkulator
// ploča u izboru materijala (BoardCalculatorModal) — da korisnik ne bira
// istu ploču dva puta na dva mjesta.
// ════════════════════════════════════════════════════════════════════

export interface BoardPreset {
    label: string;
    w: number;
    h: number;
}

export const BOARD_PRESETS: BoardPreset[] = [
    { label: '2800 × 2070 (iverica standard)', w: 2800, h: 2070 },
    { label: '2790 × 2060 (obrezana)', w: 2790, h: 2060 },
    { label: '2750 × 1830 (MDF)', w: 2750, h: 1830 },
    { label: '2440 × 1220', w: 2440, h: 1220 },
    { label: '2500 × 1250', w: 2500, h: 1250 },
    { label: '3050 × 1220', w: 3050, h: 1220 },
];

const BOARD_DIMS_STORAGE = 'cutlist-board-dims';

/** Zapamćene dimenzije ploče po materijalu (localStorage). */
export function loadSavedBoardDims(): Record<string, { w: number; h: number }> {
    try {
        return JSON.parse(localStorage.getItem(BOARD_DIMS_STORAGE) || '{}');
    } catch {
        return {};
    }
}

export function saveBoardDims(materialId: string, w: number, h: number): void {
    if (!materialId) return;
    try {
        const all = loadSavedBoardDims();
        all[materialId] = { w, h };
        localStorage.setItem(BOARD_DIMS_STORAGE, JSON.stringify(all));
    } catch { /* localStorage nedostupan — nije kritično */ }
}

/** Zapamćena ploča za materijal, uz podrazumijevani prvi preset. */
export function boardDimsFor(materialId: string): { w: number; h: number } {
    const saved = materialId ? loadSavedBoardDims()[materialId] : undefined;
    return saved || { w: BOARD_PRESETS[0].w, h: BOARD_PRESETS[0].h };
}
