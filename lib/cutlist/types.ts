// ════════════════════════════════════════════════════════════════════
// KROJENJE PLOČA — tipovi
//
// Runtime tipovi optimizatora krojenja (guillotine rezanje ploča).
// Perzistirani oblik (Product.Cut_Lists) živi u lib/types.ts —
// ovdje su samo strukture koje koriste optimizator, parser i UI.
// ════════════════════════════════════════════════════════════════════

/** Jedan tip komada iz krojne liste (količina se raspakuje u optimizatoru). */
export interface CutPart {
    id: string;
    name: string;
    /** mm — dimenzija duž X ose ploče (dužina komada). */
    width: number;
    /** mm — dimenzija duž Y ose ploče (širina komada). */
    height: number;
    qty: number;
    /** Sirovi naziv materijala iz uploada (npr. "Iveral bijeli 18mm"). */
    materialRaw: string;
    /** Normalizovan ključ grupe materijala — komadi istog ključa idu na iste ploče. */
    materialKey: string;
    /** Smije li se rotirati 90° (false za usmjerene dekore). Default true. */
    canRotate?: boolean;
    /** Kant traka: broj kantiranih ivica po DUŽINI komada (0–2). */
    edgeL?: number;
    /** Kant traka: broj kantiranih ivica po ŠIRINI komada (0–2). */
    edgeW?: number;
}

export interface BoardDims {
    width: number;
    height: number;
}

export interface CutlistSettings {
    /** Debljina reza pile (mm). */
    kerf: number;
    /** Obrez ruba ploče po JEDNOJ strani (mm) — korisna površina = ploča − 2×obrez po osi. */
    trim: number;
    allowRotation: boolean;
}

/** Postavljen komad na ploči (koordinate u korisnoj površini, mm). */
export interface PlacedPart {
    partId: string;
    name: string;
    /** Dimenzije KAKO LEŽI na ploči (nakon eventualne rotacije). */
    w: number;
    h: number;
    x: number;
    y: number;
    rotated: boolean;
}

/** Guillotine rez — segment linije preko trenutne zone (za crtež i listu rezova). */
export interface CutSegment {
    axis: 'h' | 'v';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** Redoslijed izvođenja (1-bazirano, po ploči). */
    order: number;
}

export interface FreeRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Jedna izračunata ploča. */
export interface SheetLayout {
    placements: PlacedPart[];
    cuts: CutSegment[];
    /** Iskoristivi ostaci (veće slobodne zone — kandidati za skladište). */
    offcuts: FreeRect[];
    usedArea: number;
    /** % korisne površine ploče pokriven komadima. */
    efficiency: number;
    cutLength: number;
}

/** Rezultat pakovanja jedne grupe materijala. */
export interface GroupPackResult {
    materialKey: string;
    board: BoardDims;
    /** Korisna površina (nakon obreza). */
    usable: BoardDims;
    sheets: SheetLayout[];
    totalPartsArea: number;
    /** Komadi koji ne stanu ni na praznu ploču (prevelike dimenzije). */
    unplaced: CutPart[];
}

/** Ukupna dužina kant trake u METRIMA za listu komada (bez dodatka za otpad). */
export function edgeBandingMeters(parts: CutPart[]): number {
    let mm = 0;
    for (const p of parts) {
        const l = Math.min(2, Math.max(0, p.edgeL || 0));
        const w = Math.min(2, Math.max(0, p.edgeW || 0));
        mm += p.qty * (l * p.width + w * p.height);
    }
    return mm / 1000;
}
