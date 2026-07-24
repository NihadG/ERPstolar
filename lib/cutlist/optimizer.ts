// ════════════════════════════════════════════════════════════════════
// OPTIMIZATOR KROJENJA — guillotine pakovanje ploča
//
// Zamjena za naivni algoritam iz starog cutlist.html (12 ploča tamo
// gdje profesionalni softver složi 11). Ključne razlike:
//
//  1. IZBOR KOMADA nije fiksni redoslijed: prije svakog postavljanja
//     traži se "savršen fit" preko SVIH preostalih dimenzija (komad
//     koji tačno popuni širinu/visinu zone), pa tek onda najveći
//     komad po sortu. Tako nastaju pune TRAKE istih visina — ono što
//     profesionalni programi (i sama pila) preferiraju.
//
//  2. SPLIT ODLUKA (kako se zona dijeli nakon reza) nije uvijek ista:
//     bira se varijanta čiji ostaci mogu primiti najviše preostalih
//     komada, a ne slijepo "desno u visini komada, gore puna širina".
//
//  3. MULTI-START: više determinističkih sortova + seedirani šum,
//     pa se zadrži najbolje rješenje (manje ploča → manje korišćena
//     zadnja ploča → kraći rezovi).
//
//  4. ELIMINACIJA PLOČA: komadi 2–3 najslabije popunjenih ploča se
//     pokušaju prepakovati u jednu ploču manje — to je korak koji
//     stvarno skida broj ploča, za razliku od SA/GRASP lutrije na
//     lošem jezgru.
//
// Sve je deterministički (seedirani RNG) — isti unos daje isti
// rezultat, pa se snimljena krojna lista ne mijenja sama od sebe.
// ════════════════════════════════════════════════════════════════════

import type {
    BoardDims,
    CutPart,
    CutSegment,
    CutlistSettings,
    FreeRect,
    GroupPackResult,
    PlacedPart,
    SheetLayout,
} from './types';

// ── Interne strukture ────────────────────────────────────────────────

/** Jedan FIZIČKI komad (qty raspakovan), s originalnim dimenzijama. */
interface PartInst {
    ref: CutPart;
    w: number;
    h: number;
    area: number;
}

interface SheetState {
    placements: PlacedPart[];
    cuts: CutSegment[];
    rects: FreeRect[];
    usedArea: number;
    cutLength: number;
    cutOrder: number;
}

interface Solution {
    sheets: SheetState[];
}

/** Ispod ove dimenzije (mm) ostatak se ne vodi kao iskoristiv offcut. */
const OFFCUT_MIN_SIDE = 100;
/** Zone uže/niže od ovoga se odbacuju odmah (ni najmanji komad ne stane). */
const RECT_DROP_EPS = 0.5;

/** Prag "savršenog fita" u score prostoru. */
const PERFECT_THRESHOLD = -1e8;

// ── Seedirani RNG (mulberry32) — determinističko "slučajno" ─────────
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ════════════════════════════════════════════════════════════════════
// PAKOVANJE JEDNE PLOČE
// ════════════════════════════════════════════════════════════════════

interface PlacementChoice {
    partIdx: number;
    rectIdx: number;
    w: number;
    h: number;
    rotated: boolean;
    score: number;
}

/**
 * Politika pakovanja — dimenzije pretrage za multi-start:
 *  - mode 'order':  komadi se nude redom sortiranja (veliki prvi);
 *    mode 'global': u svakom koraku se bira najbolji (komad × zona) par.
 *  - orient: preferisana orijentacija po TIPU komada ('wide' = položeno,
 *    'tall' = uspravno, mapa = po potpisu tipa). Preferencija je kazna u
 *    score-u, ne zabrana — savršeni fitovi je uvijek nadjačaju.
 */
interface PackPolicy {
    mode: 'order' | 'global';
    orient: 'none' | 'wide' | 'tall' | Map<number, 0 | 1>;
}

const ORIENT_PENALTY = 1e6;

const ORIENTS_BOTH: readonly (0 | 1)[] = [0, 1];
const ORIENTS_ONE: readonly (0 | 1)[] = [0];

function orientPenalty(policy: PackPolicy, sig: number, o: 0 | 1, w: number, h: number, rotatable: boolean): number {
    if (!rotatable || policy.orient === 'none') return 0;
    if (policy.orient === 'wide') return w >= h ? 0 : ORIENT_PENALTY;
    if (policy.orient === 'tall') return h >= w ? 0 : ORIENT_PENALTY;
    const preferred = policy.orient.get(sig);
    if (preferred === undefined) return 0;
    // 0 = normalno (w×h kao u unosu), 1 = rotirano.
    return o === preferred ? 0 : ORIENT_PENALTY;
}

/** Težina mrtvog (neiskoristivog) ostatka u score-u. */
const DEAD_WEIGHT = 500;

/**
 * Score kandidata: manji = bolji.
 *
 * `exactEps` — ostatak do ove veličine je STVARNO popunjen (pojede ga rez);
 * `eps` — ostatak manji od najmanje preostale dimenzije komada: MRTAV
 * (garantovan otpad). Mrtvi ostaci se KAŽNJAVAJU, ne nagrađuju — stara
 * verzija je "leftover koji ništa ne može primiti" tretirala kao savršen
 * fit, pa je algoritam sistematski proizvodio uske neiskoristive trake.
 */
function placementScore(
    dw: number, dh: number,
    eps: number, exactEps: number,
    rectArea: number, partArea: number,
): number {
    const exactW = dw <= exactEps;
    const exactH = dh <= exactEps;

    if (exactW && exactH) {
        // Zona tačno popunjena — najbolji mogući potez; veći komad prednost.
        return -1e12 + (dw + dh) - partArea * 1e-4;
    }
    if (exactH) {
        const dead = dw <= eps ? dw : 0;
        if (dead > 0) return dead * DEAD_WEIGHT + dw;      // kraj trake uz otpad — obična klasa
        return -1e9 + dw - partArea * 1e-4;                // čisto nastavljanje trake
    }
    if (exactW) {
        const dead = dh <= eps ? dh : 0;
        if (dead > 0) return dead * DEAD_WEIGHT + dh;
        return -1e9 + dh - partArea * 1e-4;
    }
    // Opšti slučaj: Best-Short-Side-Fit + kazna mrtvih ostataka + blaga
    // preferencija manjih zona (velike čuvamo za velike komade).
    const deadW = dw <= eps ? dw : 0;
    const deadH = dh <= eps ? dh : 0;
    return Math.min(dw, dh) * 100 + Math.max(dw, dh)
        + (deadW + deadH) * DEAD_WEIGHT
        + rectArea * 1e-6;
}

/** Najmanja "korisna" dimenzija među preostalim komadima (za eps prag). */
function minUsefulDim(remaining: PartInst[]): number {
    let m = Infinity;
    for (const p of remaining) {
        const d = Math.min(p.w, p.h);
        if (d < m) m = d;
    }
    return m === Infinity ? 30 : m;
}

function findPlacement(
    remaining: PartInst[],
    rects: FreeRect[],
    kerf: number,
    allowRotation: boolean,
    policy: PackPolicy,
): PlacementChoice | null {
    const eps = minUsefulDim(remaining) + kerf - 0.01;
    const exactEps = kerf + 2;

    let best: PlacementChoice | null = null;

    // PROLAZ 1 — savršeni fitovi preko svih RAZLIČITIH dimenzija.
    const seen = new Set<number>();
    for (let pi = 0; pi < remaining.length; pi++) {
        const part = remaining[pi];
        const sig = part.w * 100000 + part.h;
        if (seen.has(sig)) continue;
        seen.add(sig);

        const rotatable = allowRotation && part.ref.canRotate !== false && part.w !== part.h;
        for (let ri = 0; ri < rects.length; ri++) {
            const r = rects[ri];
            const rectArea = r.w * r.h;
            for (const o of (rotatable ? ORIENTS_BOTH : ORIENTS_ONE)) {
                const w = o === 0 ? part.w : part.h;
                const h = o === 0 ? part.h : part.w;
                if (w > r.w || h > r.h) continue;
                // Kazna orijentacije važi i ovdje: -1e9 + 1e6 ostaje u klasi
                // "savršenog" fita, ali politika bira redoslijed unutar klase.
                const s = placementScore(r.w - w, r.h - h, eps, exactEps, rectArea, part.area)
                    + orientPenalty(policy, sig, o, w, h, rotatable);
                if (s < PERFECT_THRESHOLD && (!best || s < best.score)) {
                    best = { partIdx: pi, rectIdx: ri, w, h, rotated: o === 1, score: s };
                }
            }
        }
    }
    if (best) return best;

    // PROLAZ 2 — po politici: 'order' uzima prvi komad po sortu koji igdje
    // staje (najbolja zona za njega); 'global' bira najbolji score preko
    // SVIH tipova komada.
    const failed = new Set<number>();
    for (let pi = 0; pi < remaining.length; pi++) {
        const part = remaining[pi];
        const sig = part.w * 100000 + part.h;
        if (failed.has(sig)) continue;
        failed.add(sig);

        const rotatable = allowRotation && part.ref.canRotate !== false && part.w !== part.h;
        let bestForPart: PlacementChoice | null = null;
        for (let ri = 0; ri < rects.length; ri++) {
            const r = rects[ri];
            const rectArea = r.w * r.h;
            for (const o of (rotatable ? ORIENTS_BOTH : ORIENTS_ONE)) {
                const w = o === 0 ? part.w : part.h;
                const h = o === 0 ? part.h : part.w;
                if (w > r.w || h > r.h) continue;
                const s = placementScore(r.w - w, r.h - h, eps, exactEps, rectArea, part.area)
                    + orientPenalty(policy, sig, o, w, h, rotatable);
                if (!bestForPart || s < bestForPart.score) {
                    bestForPart = { partIdx: pi, rectIdx: ri, w, h, rotated: o === 1, score: s };
                }
            }
        }
        if (bestForPart) {
            if (policy.mode === 'order') return bestForPart;
            if (!best || bestForPart.score < best.score) best = bestForPart;
        }
    }
    return best;
}

/** Koliko su pod-zone korisne za preostale komade (najveći komad koji stane). */
function rectUsefulness(rect: FreeRect | null, remaining: PartInst[], allowRotation: boolean): number {
    if (!rect || rect.w <= 0 || rect.h <= 0) return 0;
    let bestArea = 0;
    const seen = new Set<number>();
    for (const part of remaining) {
        const sig = part.w * 100000 + part.h;
        if (seen.has(sig)) continue;
        seen.add(sig);
        if (part.area <= bestArea) continue;
        const fitsNormal = part.w <= rect.w && part.h <= rect.h;
        const fitsRot = allowRotation && part.ref.canRotate !== false && part.h <= rect.w && part.w <= rect.h;
        if (fitsNormal || fitsRot) bestArea = part.area;
    }
    return bestArea;
}

/**
 * Postavi komad u donji-lijevi ugao zone i podijeli je guillotine rezom.
 * Bira split (horizontalni prvo ili vertikalni prvo) po korisnosti
 * ostataka za preostale komade; rezovi se bilježe redom izvođenja.
 */
function placeAndSplit(
    sheet: SheetState,
    rectIdx: number,
    part: PartInst,
    w: number,
    h: number,
    rotated: boolean,
    kerf: number,
    remaining: PartInst[],
    allowRotation: boolean,
): void {
    const rect = sheet.rects[rectIdx];
    const dw = rect.w - w;
    const dh = rect.h - h;

    sheet.placements.push({
        partId: part.ref.id,
        name: part.ref.name,
        w, h,
        x: rect.x,
        y: rect.y,
        rotated,
    });
    sheet.usedArea += w * h;

    // Kandidat pod-zone za obje split varijante (kerf pojede dio ostatka).
    const mk = (x: number, y: number, rw: number, rh: number): FreeRect | null =>
        rw > RECT_DROP_EPS && rh > RECT_DROP_EPS ? { x, y, w: rw, h: rh } : null;

    // H-split: prvo horizontalni rez preko cijele zone (traka visine h).
    const hRight = mk(rect.x + w + kerf, rect.y, dw - kerf, h);
    const hTop = mk(rect.x, rect.y + h + kerf, rect.w, dh - kerf);
    // V-split: prvo vertikalni rez preko cijele zone (kolona širine w).
    const vRight = mk(rect.x + w + kerf, rect.y, dw - kerf, rect.h);
    const vTop = mk(rect.x, rect.y + h + kerf, w, dh - kerf);

    let useH: boolean;
    if (dw <= RECT_DROP_EPS) useH = true;        // nema desnog ostatka — svejedno, H je čišći
    else if (dh <= RECT_DROP_EPS) useH = false;  // nema gornjeg ostatka
    else {
        const hValue = rectUsefulness(hRight, remaining, allowRotation) + rectUsefulness(hTop, remaining, allowRotation);
        const vValue = rectUsefulness(vRight, remaining, allowRotation) + rectUsefulness(vTop, remaining, allowRotation);
        if (hValue !== vValue) {
            useH = hValue > vValue;
        } else {
            // Nijedan komad ne profitira — zadrži veći pojedinačni ostatak.
            const hMax = Math.max(hRight ? hRight.w * hRight.h : 0, hTop ? hTop.w * hTop.h : 0);
            const vMax = Math.max(vRight ? vRight.w * vRight.h : 0, vTop ? vTop.w * vTop.h : 0);
            useH = hMax >= vMax;
        }
    }

    // Bilježenje rezova (linija na ivici komada; kerf ide u ostatak).
    const pushCut = (axis: 'h' | 'v', x1: number, y1: number, x2: number, y2: number) => {
        sheet.cutOrder += 1;
        sheet.cuts.push({ axis, x1, y1, x2, y2, order: sheet.cutOrder });
        sheet.cutLength += axis === 'h' ? (x2 - x1) : (y2 - y1);
    };

    if (useH) {
        if (dh > RECT_DROP_EPS) pushCut('h', rect.x, rect.y + h, rect.x + rect.w, rect.y + h);
        if (dw > RECT_DROP_EPS) pushCut('v', rect.x + w, rect.y, rect.x + w, rect.y + h);
    } else {
        if (dw > RECT_DROP_EPS) pushCut('v', rect.x + w, rect.y, rect.x + w, rect.y + rect.h);
        if (dh > RECT_DROP_EPS) pushCut('h', rect.x, rect.y + h, rect.x + w, rect.y + h);
    }

    const newRects = useH ? [hRight, hTop] : [vRight, vTop];
    sheet.rects.splice(rectIdx, 1);
    for (const r of newRects) {
        if (r) sheet.rects.push(r);
    }
}

/**
 * Napuni jednu ploču iz `remaining` (lista SE MUTIRA — postavljeni
 * komadi se uklanjaju). Vraća stanje ploče.
 */
function packSheet(
    remaining: PartInst[],
    usable: BoardDims,
    settings: CutlistSettings,
    policy: PackPolicy,
): SheetState {
    const sheet: SheetState = {
        placements: [],
        cuts: [],
        rects: [{ x: 0, y: 0, w: usable.width, h: usable.height }],
        usedArea: 0,
        cutLength: 0,
        cutOrder: 0,
    };

    for (;;) {
        const choice = findPlacement(remaining, sheet.rects, settings.kerf, settings.allowRotation, policy);
        if (!choice) break;
        const part = remaining[choice.partIdx];
        remaining.splice(choice.partIdx, 1);
        placeAndSplit(sheet, choice.rectIdx, part, choice.w, choice.h, choice.rotated, settings.kerf, remaining, settings.allowRotation);
    }
    return sheet;
}

// ════════════════════════════════════════════════════════════════════
// CIJELO RJEŠENJE (multi-start + eliminacija ploča)
// ════════════════════════════════════════════════════════════════════

function packAll(parts: PartInst[], usable: BoardDims, settings: CutlistSettings, policy: PackPolicy): Solution {
    const remaining = [...parts];
    const sheets: SheetState[] = [];
    while (remaining.length > 0) {
        const before = remaining.length;
        const sheet = packSheet(remaining, usable, settings, policy);
        if (remaining.length === before) break; // ništa ne staje (guard — ne bi smjelo nakon filtera)
        sheets.push(sheet);
    }
    return { sheets };
}

// ════════════════════════════════════════════════════════════════════
// GLOBALNO PAKOVANJE U TRAKE — kako rade profesionalni programi
//
// Pohlepa ploča-po-ploča napuni prve ploče do ~90% i ostavi "siročiće"
// za zadnju (1-2 komada na 6 m² ploče). Ovdje se prvo sagrade TRAKE
// preko CIJELOG naloga (FFDH: komadi sortirani po visini, best-fit u
// traku; sitni komadi se SLAŽU na vrh kolona), pa se trake bin-packuju
// na ploče po visini. Raspodjela po pločama ispadne ravnomjerna, bez
// nasukanih ostataka. Rezultat ulazi u isti multi-start kao i pohlepa —
// pobjeđuje ko da manje ploča.
// ════════════════════════════════════════════════════════════════════

interface StripPiece { inst: PartInst; w: number; h: number; rotated: boolean; }
interface StripColumn { x: number; width: number; usedH: number; parts: StripPiece[]; }
interface Strip { height: number; usedW: number; cols: StripColumn[]; }

function packStripsGlobal(
    instances: PartInst[],
    usable: BoardDims,
    settings: CutlistSettings,
    orient: 'asis' | 'land' | 'port',
    alpha: number,
    rng?: () => number,
): Solution {
    const kerf = settings.kerf;

    // Primarna orijentacija po komadu (varijanta pretrage). Uz rng, visina
    // za SORTIRANJE dobija džiter (±30mm) — bliske klase visina (553/548/528)
    // se izmiješaju, pa visoka traka može da primi i niže komade s alpha
    // pragom, umjesto da se klase kruto redaju jedna iza druge.
    const oriented = instances.map(inst => {
        const rotatable = settings.allowRotation && inst.ref.canRotate !== false && inst.w !== inst.h;
        let w = inst.w, h = inst.h, rotated = false;
        if (rotatable) {
            if (orient === 'land' && h > w) { w = inst.h; h = inst.w; rotated = true; }
            if (orient === 'port' && w > h) { w = inst.h; h = inst.w; rotated = true; }
        }
        const sortKey = h + (rng ? (rng() - 0.5) * 60 : 0);
        return { inst, w, h, rotated, rotatable, sortKey };
    }).sort((a, b) => b.sortKey - a.sortKey || b.w - a.w);

    const strips: Strip[] = [];

    for (const p of oriented) {
        const orients: [number, number, boolean][] = p.rotatable
            ? [[p.w, p.h, p.rotated], [p.h, p.w, !p.rotated]]
            : [[p.w, p.h, p.rotated]];

        // 1) Kandidatske trake: dovoljno visoke, ne prerastrošne (alpha
        //    ograničava bacanje visine), imaju širine. Rangira ih gubitak
        //    visine pa tjesnoća širine; uz rng ponekad uzmi drugoplasiranu —
        //    tako se razbija loše grupisanje najširih komada u istu traku.
        const stripCands: { s: Strip; w: number; h: number; rot: boolean; score: number }[] = [];
        for (const s of strips) {
            for (const [w, h, rot] of orients) {
                if (h > s.height || h < s.height * alpha) continue;
                const nextW = s.usedW + kerf + w;
                if (nextW > usable.width) continue;
                const score = (s.height - h) * 20 + (usable.width - nextW) * 0.05;
                stripCands.push({ s, w, h, rot, score });
            }
        }
        if (stripCands.length > 0) {
            stripCands.sort((a, b) => a.score - b.score);
            const pick = rng && stripCands.length > 1 && rng() < 0.35 ? 1 : 0;
            const { s, w, h, rot } = stripCands[pick];
            const x = s.usedW + kerf;
            s.cols.push({ x, width: w, usedH: h, parts: [{ inst: p.inst, w, h, rotated: rot }] });
            s.usedW = x + w;
            continue;
        }

        // 2) Slaganje na vrh postojeće kolone (hvata sitne komade).
        let bestCol: { s: Strip; c: StripColumn; w: number; h: number; rot: boolean; waste: number } | null = null;
        for (const s of strips) {
            for (const c of s.cols) {
                for (const [w, h, rot] of orients) {
                    if (w > c.width) continue;
                    if (c.usedH + kerf + h > s.height) continue;
                    const waste = c.width - w;
                    if (!bestCol || waste < bestCol.waste) bestCol = { s, c, w, h, rot, waste };
                }
            }
        }
        if (bestCol) {
            const { c, w, h, rot } = bestCol;
            c.parts.push({ inst: p.inst, w, h, rotated: rot });
            c.usedH += kerf + h;
            continue;
        }

        // 3) Nova traka (primarna orijentacija).
        strips.push({
            height: p.h,
            usedW: p.w,
            cols: [{ x: 0, width: p.w, usedH: p.h, parts: [{ inst: p.inst, w: p.w, h: p.h, rotated: p.rotated }] }],
        });
    }

    // Trake → ploče: best-fit decreasing po visini + randomizovani redoslijedi.
    // Sam BFD zna promašiti (npr. [553,553,548] zajedno pa zadnja 397-traka
    // otvori novu ploču, iako raspored [553,553,528,397]+[548,548,528,397]
    // staje u dvije) — bin packing traka je mali, pa se isplati više pokušaja.
    const assignStrips = (order: Strip[]): Strip[][] => {
        const bins: Strip[][] = [];
        const used: number[] = [];
        for (const s of order) {
            let bi = -1;
            let bRem = Infinity;
            for (let i = 0; i < bins.length; i++) {
                const need = used[i] + kerf + s.height;
                if (need <= usable.height && usable.height - need < bRem) {
                    bRem = usable.height - need;
                    bi = i;
                }
            }
            if (bi >= 0) { bins[bi].push(s); used[bi] += kerf + s.height; }
            else { bins.push([s]); used.push(s.height); }
        }
        return bins;
    };

    let sheetStrips = assignStrips([...strips].sort((a, b) => b.height - a.height));
    if (rng) {
        for (let t = 0; t < 40 && sheetStrips.length > 1; t++) {
            const shuffled = [...strips];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const bins = assignStrips(shuffled);
            if (bins.length < sheetStrips.length) sheetStrips = bins;
        }
    }

    // Sastavi SheetState (placements + rezovi + slobodne zone).
    const EPS = RECT_DROP_EPS;
    const sheets: SheetState[] = sheetStrips.map(list => {
        const st: SheetState = { placements: [], cuts: [], rects: [], usedArea: 0, cutLength: 0, cutOrder: 0 };
        const pushCut = (axis: 'h' | 'v', x1: number, y1: number, x2: number, y2: number) => {
            st.cutOrder += 1;
            st.cuts.push({ axis, x1, y1, x2, y2, order: st.cutOrder });
            st.cutLength += axis === 'h' ? (x2 - x1) : (y2 - y1);
        };

        list.sort((a, b) => b.height - a.height);
        let y = 0;
        for (const s of list) {
            const stripTop = y + s.height;
            // Horizontalni rez na vrhu trake (ako iznad ima još materijala).
            if (stripTop < usable.height - EPS) pushCut('h', 0, stripTop, usable.width, stripTop);

            s.cols.forEach((c, ci) => {
                let py = y;
                c.parts.forEach((part, pi) => {
                    st.placements.push({
                        partId: part.inst.ref.id,
                        name: part.inst.ref.name,
                        w: part.w, h: part.h,
                        x: c.x, y: py,
                        rotated: part.rotated,
                    });
                    st.usedArea += part.w * part.h;
                    if (pi < c.parts.length - 1) pushCut('h', c.x, py + part.h, c.x + c.width, py + part.h);
                    py += part.h + kerf;
                });
                // Ostatak na vrhu kolone.
                const leftoverH = s.height - c.usedH;
                if (leftoverH > EPS + kerf) {
                    pushCut('h', c.x, y + c.usedH, c.x + c.width, y + c.usedH);
                    st.rects.push({ x: c.x, y: y + c.usedH + kerf, w: c.width, h: leftoverH - kerf });
                }
                // Vertikalni rez na desnoj ivici kolone (osim zadnje flush).
                const rightEdge = c.x + c.width;
                if (ci < s.cols.length - 1 || rightEdge < s.usedW - EPS || s.usedW < usable.width - EPS) {
                    pushCut('v', rightEdge, y, rightEdge, stripTop);
                }
            });

            // Desni ostatak trake.
            const rightW = usable.width - s.usedW;
            if (rightW > EPS + kerf) {
                st.rects.push({ x: s.usedW + kerf, y, w: rightW - kerf, h: s.height });
            }
            y = stripTop + kerf;
        }
        // Donji ostatak ploče.
        if (usable.height - y > EPS) {
            st.rects.push({ x: 0, y, w: usable.width, h: usable.height - y });
        }
        return st;
    });

    return { sheets };
}

/** Deterministički skup politika za multi-start i eliminaciju. */
const BASE_POLICIES: PackPolicy[] = [
    { mode: 'order', orient: 'none' },
    { mode: 'order', orient: 'wide' },
    { mode: 'order', orient: 'tall' },
    { mode: 'global', orient: 'none' },
    { mode: 'global', orient: 'wide' },
    { mode: 'global', orient: 'tall' },
];

/** Slučajna politika: mod + orijentacija po tipu komada (seedirano). */
function randomPolicy(rng: () => number, parts: PartInst[]): PackPolicy {
    const roll = rng();
    if (roll < 0.4) {
        return { mode: rng() < 0.5 ? 'order' : 'global', orient: 'none' };
    }
    const map = new Map<number, 0 | 1>();
    const seen = new Set<number>();
    for (const p of parts) {
        const sig = p.w * 100000 + p.h;
        if (seen.has(sig)) continue;
        seen.add(sig);
        map.set(sig, rng() < 0.5 ? 0 : 1);
    }
    return { mode: rng() < 0.5 ? 'order' : 'global', orient: map };
}

/** Leksikografsko poređenje: broj ploča → popunjenost zadnje → dužina reza. */
function betterSolution(a: Solution, b: Solution | null): boolean {
    if (!b) return true;
    if (a.sheets.length !== b.sheets.length) return a.sheets.length < b.sheets.length;
    const lastA = a.sheets.length ? a.sheets[a.sheets.length - 1].usedArea : 0;
    const lastB = b.sheets.length ? b.sheets[b.sheets.length - 1].usedArea : 0;
    if (lastA !== lastB) return lastA < lastB;
    const cutA = a.sheets.reduce((s, x) => s + x.cutLength, 0);
    const cutB = b.sheets.reduce((s, x) => s + x.cutLength, 0);
    return cutA < cutB;
}

type SortFn = (a: PartInst, b: PartInst) => number;

const SORT_STRATEGIES: SortFn[] = [
    // Površina ↓, pa dimenzije — identični komadi ostaju zajedno (trake!).
    (a, b) => b.area - a.area || b.h - a.h || b.w - a.w,
    (a, b) => b.h - a.h || b.w - a.w,
    (a, b) => b.w - a.w || b.h - a.h,
    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.area - a.area,
    (a, b) => (b.w + b.h) - (a.w + a.h) || b.h - a.h,
];

/**
 * Eliminacija ploča — tri strategije, dok god ima poboljšanja:
 *  1. UBACIVANJE: komadi najslabije ploče u slobodne zone drugih ploča
 *     (pali tek nakon repacka — svjež packAll zatvara ploče "do kraja",
 *     ali repack u koraku 2/3 mijenja raspored pa se otvore rupe).
 *  2. PAR: najslabija + SVAKA druga ploča → pokušaj u jednu.
 *  3. TROJKA: tri najslabije → pokušaj u dvije.
 * Vremenski ograničeno da veliki nalozi ne vise.
 */
function tryEliminateSheets(
    solution: Solution,
    usable: BoardDims,
    settings: CutlistSettings,
    rng: () => number,
    refById: Map<string, CutPart>,
    budgetMs = 2000,
): Solution {
    let current = solution;
    const deadline = Date.now() + budgetMs;
    // Vlastiti tok za strip pokušaje u repacku (vidi rngStrips u packGroup).
    const rngS = mulberry32(0xABCD1234);

    // Placement → originalne dimenzije i referenca komada (zbog canRotate).
    const instOf = (pl: PlacedPart): PartInst => {
        const ow = pl.rotated ? pl.h : pl.w;
        const oh = pl.rotated ? pl.w : pl.h;
        const ref = refById.get(pl.partId) || ({ id: pl.partId, name: pl.name } as CutPart);
        return { ref, w: ow, h: oh, area: ow * oh };
    };

    /** Pokušaj spakovati pool u ≤ maxSheets ploča (trake + multi-start). */
    const repackAttempts = (pool: PartInst[], maxSheets: number, randomTries: number): Solution | null => {
        // Globalne trake prve — najčešće upravo one uspiju preraspodijeliti.
        for (const orient of ['asis', 'land', 'port'] as const) {
            for (const alpha of [1.0, 0.9, 0.8, 0.65]) {
                if (Date.now() > deadline) return null;
                const packed = packStripsGlobal(pool, usable, settings, orient, alpha);
                if (packed.sheets.length <= maxSheets) return packed;
            }
        }
        for (let t = 0; t < 30; t++) {
            if (Date.now() > deadline) return null;
            // Pre-shuffle poola: redoslijed komada mijenja mapiranje džitera,
            // pa uspjeh ne smije zavisiti od redoslijeda ploča u kompoziciji.
            const shuffledPool = [...pool];
            for (let i = shuffledPool.length - 1; i > 0; i--) {
                const j = Math.floor(rngS() * (i + 1));
                [shuffledPool[i], shuffledPool[j]] = [shuffledPool[j], shuffledPool[i]];
            }
            const orient = (['asis', 'land', 'port'] as const)[Math.floor(rngS() * 3)];
            const packed = packStripsGlobal(shuffledPool, usable, settings, orient, 0.6 + rngS() * 0.4, rngS);
            if (packed.sheets.length <= maxSheets) return packed;
        }
        const tries: { order: PartInst[]; policy: PackPolicy }[] = [];
        for (const sortFn of SORT_STRATEGIES) {
            const sorted = [...pool].sort(sortFn);
            for (const policy of BASE_POLICIES) tries.push({ order: sorted, policy });
        }
        for (let t = 0; t < randomTries; t++) {
            const noisy = [...pool].sort((a, b) =>
                (b.area * (0.85 + rng() * 0.3)) - (a.area * (0.85 + rng() * 0.3)));
            tries.push({ order: noisy, policy: randomPolicy(rng, pool) });
        }
        for (const attempt of tries) {
            if (Date.now() > deadline) return null;
            const packed = packAll(attempt.order, usable, settings, attempt.policy);
            if (packed.sheets.length <= maxSheets) return packed;
        }
        return null;
    };

    const cloneSheet = (s: SheetState): SheetState => ({
        placements: s.placements.map(p => ({ ...p })),
        cuts: s.cuts.map(c => ({ ...c })),
        rects: s.rects.map(r => ({ ...r })),
        usedArea: s.usedArea,
        cutLength: s.cutLength,
        cutOrder: s.cutOrder,
    });

    /** Ubaci SVE komade ploče fromIdx u slobodne zone ostalih; null ako ne mogu svi. */
    const tryInsertInto = (fromIdx: number): Solution | null => {
        const targets = current.sheets
            .map((s, i) => ({ i, used: s.usedArea }))
            .filter(x => x.i !== fromIdx)
            .sort((a, b) => b.used - a.used);
        const clones = new Map<number, SheetState>();
        const pieces = current.sheets[fromIdx].placements.map(instOf).sort((a, b) => b.area - a.area);

        for (const inst of pieces) {
            let placed = false;
            for (const t of targets) {
                let sheet = clones.get(t.i);
                if (!sheet) { sheet = cloneSheet(current.sheets[t.i]); clones.set(t.i, sheet); }
                const choice = findPlacement([inst], sheet.rects, settings.kerf, settings.allowRotation, { mode: 'order', orient: 'none' });
                if (choice) {
                    placeAndSplit(sheet, choice.rectIdx, inst, choice.w, choice.h, choice.rotated, settings.kerf, [], settings.allowRotation);
                    placed = true;
                    break;
                }
            }
            if (!placed) return null;
        }
        return {
            sheets: current.sheets
                .map((s, i) => (i === fromIdx ? null : clones.get(i) || s))
                .filter((s): s is SheetState => s !== null),
        };
    };

    for (;;) {
        if (Date.now() > deadline) return current;
        let improved = false;
        const byFill = current.sheets
            .map((s, i) => ({ i, used: s.usedArea }))
            .sort((a, b) => a.used - b.used);

        // 1) Ubacivanje najslabije ploče u ostatke drugih.
        if (current.sheets.length >= 2) {
            const inserted = tryInsertInto(byFill[0].i);
            if (inserted) { current = inserted; improved = true; }
        }

        // 2) Najslabija + svaka druga → jedna ploča.
        if (!improved && current.sheets.length >= 2) {
            const least = byFill[0].i;
            for (let n = 1; n < byFill.length && !improved; n++) {
                if (Date.now() > deadline) break;
                const j = byFill[n].i;
                const pool = [
                    ...current.sheets[least].placements,
                    ...current.sheets[j].placements,
                ].map(instOf);
                const packed = repackAttempts(pool, 1, n === 1 ? 40 : 12);
                if (packed) {
                    current = { sheets: [...current.sheets.filter((_, i) => i !== least && i !== j), ...packed.sheets] };
                    improved = true;
                }
            }
        }

        // 3) k najslabijih → k−1 (k=3..5): preraspodjela preko VIŠE ploča
        //    hvata slučajeve gdje nijedan par nije dovoljan.
        for (let k = 3; k <= Math.min(5, current.sheets.length) && !improved; k++) {
            if (Date.now() > deadline) break;
            const idxs = byFill.slice(0, k).map(x => x.i);
            const pool = idxs.flatMap(i => current.sheets[i].placements).map(instOf);
            const packed = repackAttempts(pool, k - 1, 30);
            if (packed) {
                current = { sheets: [...current.sheets.filter((_, i) => !idxs.includes(i)), ...packed.sheets] };
                improved = true;
            }
        }

        if (!improved) return current;
    }
}

/** Iskoristivi ostaci: slobodne zone ≥ OFFCUT_MIN_SIDE po obje dimenzije. */
function collectOffcuts(rects: FreeRect[]): FreeRect[] {
    return rects
        .filter(r => r.w >= OFFCUT_MIN_SIDE && r.h >= OFFCUT_MIN_SIDE)
        .sort((a, b) => (b.w * b.h) - (a.w * a.h));
}

function toLayout(sheet: SheetState, usable: BoardDims): SheetLayout {
    const boardArea = usable.width * usable.height;
    return {
        placements: sheet.placements,
        cuts: sheet.cuts,
        offcuts: collectOffcuts(sheet.rects),
        usedArea: sheet.usedArea,
        efficiency: boardArea > 0 ? (sheet.usedArea / boardArea) * 100 : 0,
        cutLength: sheet.cutLength,
    };
}

export interface PackGroupOptions {
    /** Vremenski budžet za multi-start fazu (ms). Default 2500. */
    timeBudgetMs?: number;
    /** Maksimalan broj slučajnih restarta. Default 300. */
    maxRestarts?: number;
    /** Seed za deterministički RNG. Default 1337. */
    seed?: number;
}

/**
 * Spakuj JEDNU grupu materijala (komadi istog dekora/debljine) na ploče
 * zadatih dimenzija. Glavna ulazna tačka optimizatora.
 */
export function packGroup(
    parts: CutPart[],
    board: BoardDims,
    settings: CutlistSettings,
    options: PackGroupOptions = {},
): GroupPackResult {
    const usable: BoardDims = {
        width: board.width - 2 * settings.trim,
        height: board.height - 2 * settings.trim,
    };

    // Raspakuj količine i odvoji komade koji fizički ne stanu na praznu ploču.
    const instances: PartInst[] = [];
    const unplaced: CutPart[] = [];
    for (const p of parts) {
        const fitsNormal = p.width <= usable.width && p.height <= usable.height;
        const fitsRot = settings.allowRotation && p.canRotate !== false
            && p.height <= usable.width && p.width <= usable.height;
        if (!fitsNormal && !fitsRot) {
            unplaced.push(p);
            continue;
        }
        for (let i = 0; i < Math.max(1, Math.round(p.qty)); i++) {
            instances.push({ ref: p, w: p.width, h: p.height, area: p.width * p.height });
        }
    }

    const totalPartsArea = instances.reduce((s, p) => s + p.area, 0);

    if (instances.length === 0) {
        return { materialKey: parts[0]?.materialKey || '', board, usable, sheets: [], totalPartsArea: 0, unplaced };
    }

    const rng = mulberry32(options.seed ?? 1337);
    // Odvojen RNG tok za trake — da strip-restarti ne pomjeraju niz brojeva
    // greedy restarta i eliminacije (rezultati moraju ostati stabilni kad se
    // faza traka doda/mijenja).
    const rngStrips = mulberry32((options.seed ?? 1337) ^ 0x9e3779b9);
    const timeBudget = options.timeBudgetMs ?? 2500;
    const maxRestarts = options.maxRestarts ?? 300;
    const start = Date.now();

    // Donja granica — kad je dostignemo, dalje traženje nema smisla.
    const boardArea = usable.width * usable.height;
    const lowerBound = Math.max(1, Math.ceil(totalPartsArea / boardArea));

    // Prate se DVA najbolja kandidata po porijeklu: pohlepni (guillotine
    // greedy) i trakasti. Eliminacija poslije kreće od OBA — kompozicija
    // ploča polazne tačke bitno određuje hoće li preraspodjela uspjeti,
    // pa "ukupno najbolji" nije uvijek i najbolji start za eliminaciju.
    let bestGreedy: Solution | null = null;
    let bestStrip: Solution | null = null;

    // 1) Deterministički sortovi × politike (mod izbora + orijentacija).
    for (const sortFn of SORT_STRATEGIES) {
        const sorted = [...instances].sort(sortFn);
        for (const policy of BASE_POLICIES) {
            const solution = packAll(sorted, usable, settings, policy);
            if (betterSolution(solution, bestGreedy)) bestGreedy = solution;
        }
    }

    // 1.5) Globalne trake (profesionalni stil) — orijentacija × prag visine,
    //      pa randomizovani restarti (džiter visine + slučajan izbor trake).
    for (const orient of ['asis', 'land', 'port'] as const) {
        for (const alpha of [1.0, 0.9, 0.8, 0.65]) {
            const solution = packStripsGlobal(instances, usable, settings, orient, alpha);
            if (betterSolution(solution, bestStrip)) bestStrip = solution;
        }
    }
    for (let t = 0; t < 80; t++) {
        if (Date.now() - start > timeBudget) break;
        if (bestStrip && bestStrip.sheets.length <= lowerBound) break;
        const orient = (['asis', 'land', 'port'] as const)[Math.floor(rngStrips() * 3)];
        const alpha = 0.6 + rngStrips() * 0.4;
        const solution = packStripsGlobal(instances, usable, settings, orient, alpha, rngStrips);
        if (betterSolution(solution, bestStrip)) bestStrip = solution;
    }

    let best: Solution | null = bestGreedy;
    if (bestStrip && betterSolution(bestStrip, best)) best = bestStrip;

    // 2) Slučajni restarti: šum na površini TIPA (identični komadi se drže
    //    zajedno) + slučajna politika.
    const areaNoise = new Map<number, number>();
    for (let t = 0; t < maxRestarts; t++) {
        if (Date.now() - start > timeBudget) break;
        if (best && best.sheets.length <= lowerBound) break;

        areaNoise.clear();
        const noisy = [...instances].sort((a, b) => {
            const sigA = a.w * 100000 + a.h;
            const sigB = b.w * 100000 + b.h;
            let nA = areaNoise.get(sigA);
            if (nA === undefined) { nA = 0.8 + rng() * 0.4; areaNoise.set(sigA, nA); }
            let nB = areaNoise.get(sigB);
            if (nB === undefined) { nB = 0.8 + rng() * 0.4; areaNoise.set(sigB, nB); }
            return b.area * nB - a.area * nA || b.h - a.h || b.w - a.w;
        });
        const solution = packAll(noisy, usable, settings, randomPolicy(rng, instances));
        if (betterSolution(solution, bestGreedy)) bestGreedy = solution;
        if (betterSolution(solution, best)) best = solution;
    }

    // 3) Eliminacija najslabijih ploča — od SVAKOG kandidata (ukupno
    //    najbolji, najbolji pohlepni, najbolji trakasti), jer polazna
    //    kompozicija određuje uspjeh preraspodjele.
    if (best && best.sheets.length > lowerBound) {
        const refById = new Map<string, CutPart>(parts.map(p => [p.id, p]));
        const seeds: Solution[] = [];
        for (const cand of [best, bestGreedy, bestStrip]) {
            if (cand && !seeds.includes(cand)) seeds.push(cand);
        }
        for (const seed of seeds) {
            const improved = tryEliminateSheets(seed, usable, settings, rng, refById, 1500);
            if (betterSolution(improved, best)) best = improved;
            if (best.sheets.length <= lowerBound) break;
        }
    }

    const sheets = (best?.sheets || [])
        .map(s => toLayout(s, usable))
        // Punije ploče prve — zadnja ostaje "načeta" (najveći ostaci).
        .sort((a, b) => b.usedArea - a.usedArea);

    return {
        materialKey: parts[0]?.materialKey || '',
        board,
        usable,
        sheets,
        totalPartsArea,
        unplaced,
    };
}

/**
 * Spakuj VIŠE grupa materijala odjednom (async, s povremenim yield-om
 * da UI ne zamrzne). Redoslijed grupa u rezultatu = redoslijed ulaza.
 * `allowRotation` po grupi (usmjereni dekor) nadjačava globalnu postavku.
 */
export async function packGroups(
    groups: { parts: CutPart[]; board: BoardDims; allowRotation?: boolean }[],
    settings: CutlistSettings,
    options: PackGroupOptions = {},
    onProgress?: (done: number, total: number) => void,
): Promise<GroupPackResult[]> {
    const results: GroupPackResult[] = [];
    for (let i = 0; i < groups.length; i++) {
        onProgress?.(i, groups.length);
        // Yield event-loopu prije svake grupe — pakovanje je CPU-vezano.
        await new Promise(resolve => setTimeout(resolve, 0));
        const groupSettings: CutlistSettings = {
            ...settings,
            allowRotation: groups[i].allowRotation ?? settings.allowRotation,
        };
        results.push(packGroup(groups[i].parts, groups[i].board, groupSettings, options));
    }
    onProgress?.(groups.length, groups.length);
    return results;
}