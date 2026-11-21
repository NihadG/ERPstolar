// ════════════════════════════════════════════════════════════════════
// PLATNO — NATPIS TRAKE
//
// Stari natpis je bio cijeli naslov u traci s `overflow: hidden`: kratka traka
// (1–2 dana) ostajala je prazna ili s „Poz 11 -", a duga je sjekla riječ na
// pola („Ogledalo (iste sob"). Radionica naloge zove po POZICIJI („Poz 9.1"),
// pa je šifra pozicije najkraći natpis koji jednoznačno kaže šta je šta.
//
// Pravila:
//   1. „Poz 9.1 - Unutrašnja obloga · Hotel Grude" → šifra „9.1", naziv
//      „Unutrašnja obloga", sufiks „Hotel Grude" (samo ako je to projekat).
//   2. Traka nosi šifru + naziv; ako naziv ne stane, skraćuje se NA GRANICI
//      RIJEČI s „…" (i bez visećeg veznika na kraju: nikad „Obloga u…").
//   3. Kad ni prva riječ ne stane — samo šifra (u znački ili gola).
//
// Mjerenje teksta je ubrizgano (`MeasureText`) — u pregledniku ga daje canvas
// (components/canvas/measure.ts), u testu jednostavna funkcija po znaku.
// ════════════════════════════════════════════════════════════════════

/** Širina teksta u pikselima za dati font (težina, veličina u px). */
export type MeasureText = (text: string, weight: number, px: number) => number;

export interface ParsedTitle {
    /** Šifra pozicije („12", „9.1"); prazno kad naslov nema „Poz". */
    code: string;
    /** Naziv bez „Poz N -" i bez sufiksa projekta. */
    name: string;
    /** „ · Hotel Grude" s kraja naslova, kad je to ime projekta (bez „ · "). */
    suffix: string;
}

/** Mjere natpisa — iste vrijednosti koristi CSS (.cv-code, .cv-lbl). */
export const LABEL = {
    namePx: 12,
    codePx: 11.5,
    codeWeight: 600,
    nameWeight: 500,
    /** Unutrašnji razmak značke šifre (lijevo + desno). */
    pillPad: 8,
    /** Razmak između značke i naziva. */
    gap: 6,
    /** Unutrašnji razmak natpisa u traci (lijevo + desno). */
    pad: 14,
} as const;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words4 = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 4);

/**
 * Rastavi naslov plan-bloka. Sufiks „ · X" se odvaja samo kad X dijeli riječ
 * (≥ 4 slova) s nazivom projekta — „Meliha stan" uz projekat „Melihin stan -
 * A5" se prepoznaje po „stan", a „Ormar · bijeli" ostaje cio naziv.
 */
export function parsePlanTitle(title: string, projectName?: string): ParsedTitle {
    let t = (title || '').trim();
    let suffix = '';
    const i = t.lastIndexOf(' · ');
    if (i > 0) {
        const sfx = t.slice(i + 3).trim();
        const projectWords = new Set(words4(projectName || ''));
        if (sfx && (!projectName || words4(sfx).some(w => projectWords.has(w)))) {
            suffix = sfx;
            t = t.slice(0, i).trim();
        }
    }
    const m = t.match(/^poz(?:icija)?\.?\s*([0-9]+(?:[.,][0-9]+)*)\s*[-–:.]?\s*(.*)$/i);
    if (m) return { code: m[1], name: m[2].trim(), suffix };
    return { code: '', name: t, suffix };
}

/** Veznici i crtice koje ne smiju ostati na kraju skraćenog naziva. */
const DANGLING = new Set(['u', 'i', 'sa', 's', 'od', 'na', 'za', 'iz', 'do', 'po', 'uz', 'te', 'ili', '-', '–', '+', '&']);

/**
 * Najduži početak teksta (cijele riječi) s „…" koji stane u `avail`.
 * Null kad ni prva riječ ne stane.
 */
export function truncateWords(
    text: string, avail: number, measure: MeasureText, weight: number, px: number
): string | null {
    const words = text.trim().split(/\s+/).filter(Boolean);
    for (let k = words.length - 1; k >= 1; k--) {
        const ws = words.slice(0, k);
        while (ws.length && DANGLING.has(norm(ws[ws.length - 1]).replace(/[^a-z0-9\-–+&]/g, ''))) ws.pop();
        let s = ws.join(' ').replace(/[\s\-–,·(:/+&]+$/, '');
        // Ne ostavljaj otvorenu zagradu: „Velika obloga (desno…" → „Velika obloga…".
        if ((s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length) {
            s = s.slice(0, s.lastIndexOf('(')).replace(/[\s\-–,·(:/+&]+$/, '');
        }
        if (!s) continue;
        const out = `${s}…`;
        if (measure(out, weight, px) <= avail) return out;
    }
    return null;
}

/** Tekst za kolonu: cijeli, ili skraćen na granici riječi; krajnja nužda — prva riječ. */
export function fitWords(
    text: string, avail: number, measure: MeasureText, weight = 500, px = 13
): string {
    if (measure(text, weight, px) <= avail) return text;
    return truncateWords(text, avail, measure, weight, px) ?? text.trim().split(/\s+/)[0] ?? '';
}

/** Prva (najpotpunija) varijanta koja stane; inače posljednja (najkraća). */
export function fitVariants(
    variants: string[], avail: number, measure: MeasureText, weight = 400, px = 12
): string {
    for (const v of variants) if (measure(v, weight, px) <= avail) return v;
    return variants[variants.length - 1] ?? '';
}

export interface BlockLabelFit {
    code: string;
    /** Naziv (cio ili skraćen s „…"); nema ga kad stane samo šifra. */
    name?: string;
    /** Sufiks projekta, samo kad je tražen i stane. */
    suffix?: string;
    /** Samo šifra, centrirana u traci. */
    centered?: boolean;
    /** Šifra bez značke (traka uža od značke). */
    bare?: boolean;
}

/**
 * Natpis za traku širine `widthPx`. Null kad ne stane ništa (npr. dan od 11 px
 * na mjesečnom zumu) — tada puni naziv nosi kartica na hover.
 */
export function fitBlockLabel(
    p: ParsedTitle,
    widthPx: number,
    measure: MeasureText,
    opts: { withSuffix?: boolean; reserve?: number } = {}
): BlockLabelFit | null {
    const w = widthPx - (opts.reserve || 0);
    const codeW = p.code ? measure(p.code, LABEL.codeWeight, LABEL.codePx) : 0;
    const pillW = codeW + LABEL.pillPad;
    const base = p.code ? pillW + LABEL.gap : 0;
    const avail = w - LABEL.pad;

    if (p.name) {
        const nameW = measure(p.name, LABEL.nameWeight, LABEL.namePx);
        if (base + nameW <= avail) {
            const suffix = opts.withSuffix && p.suffix
                && base + nameW + measure(` · ${p.suffix}`, 400, LABEL.namePx) <= avail
                ? p.suffix : undefined;
            return { code: p.code, name: p.name, ...(suffix ? { suffix } : {}) };
        }
        const short = truncateWords(p.name, avail - base, measure, LABEL.nameWeight, LABEL.namePx);
        if (short) return { code: p.code, name: short };
    }
    if (p.code) {
        if (pillW + 4 <= w) return { code: p.code, centered: true };
        if (codeW + 2 <= w) return { code: p.code, centered: true, bare: true };
    }
    return null;
}

/** Natpis koji je cio stao (nije samo šifra i nije skraćen). */
export function isFullLabel(fit: BlockLabelFit | null): boolean {
    return !!fit && !fit.centered && !!fit.name && !fit.name.endsWith('…');
}
