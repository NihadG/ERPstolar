// ════════════════════════════════════════════════════════════════════
// PREPOZNAVANJE MATERIJALA — zajedničko za ERP i SketchUp plugin
//
// Isti kod radi na obje strane: ERP ga koristi pri uvozu, a skripta
// scripts/sync-sketchup-plugin.mjs ga prevodi i ubacuje u Component Manager
// (blok NT-ERP-SHARED). Zato: bez importa, bez DOM-a, bez Node API-ja.
//
// Naziv se rastavi na OPIS (describe): vrsta stavke, vrsta ploče, KK,
// debljina, širina kant trake, šifra dekora, broj artikla, mjere, oznake
// (usporivač, Tip-on, negorivi…) i riječi svedene na korijen sa sinonimima
// (šarka = baglama, usporivač = ublaživač, HDF = lesonit…). Kandidat se
// boduje u dva sloja:
//
//   TVRDA PRAVILA — odbacuju pogrešne parove bez obzira na riječi:
//     druga vrsta stavke, druga vrsta ploče (iveral ≠ HPL ≠ MDF), radna
//     ploča ≠ obična, KK ≠ lice, druga debljina, uska ≠ široka traka,
//     druga šifra dekora / broj artikla / mjera okova, suprotna oznaka
//     (sa ↔ bez usporivača).
//   BODOVI — šifra (+60), broj artikla (+80), mjera (+20), vrsta (+15),
//     svaka zajednička riječ (+12), sve riječi pokrivene (+15); višak
//     riječi kandidata −4, upita −2.
//
// Automatski se veže samo siguran par (dovoljno bodova I jasna razlika do
// drugog kandidata); ostalo je PRIJEDLOG koji korisnik potvrdi.
// ════════════════════════════════════════════════════════════════════

export type MatchKind = 'ploca' | 'kant' | 'obrada' | 'okov' | 'staklo' | 'ostalo';

export interface CatalogItem {
    id: string;
    naziv: string;
    kategorija?: string;
    jm?: string;
}

export interface MatchDesc {
    kind: MatchKind | null;
    types: string[];
    radna: boolean;
    kk: boolean;
    flags: string[];
    codes: string[];
    articles: string[];
    sizes: number[];
    thickness: number | null;
    edge: number | null;
    words: string[];
    loose: string;
}

export interface MatchHint {
    kind?: MatchKind | null;
    thickness?: number | null;
    kategorija?: string;
}

export interface Ranked<T extends CatalogItem = CatalogItem> {
    item: T;
    score: number;
    /** Šifra dekora, broj artikla ili tačan naziv — najjači dokaz. */
    strong: boolean;
    /** Isti naziv (poslije tvrdih pravila). */
    exact: boolean;
}

export interface MatchResult<T extends CatalogItem = CatalogItem> {
    best: Ranked<T> | null;
    /** Siguran par — veže se bez pitanja. */
    auto: boolean;
    how: 'naziv' | 'sifra' | 'slicno' | null;
    ranked: Ranked<T>[];
}

export const AUTO_SCORE = 30;
export const AUTO_MARGIN = 8;
export const SUGGEST_SCORE = 14;

// ─── normalizacija ───────────────────────────────────────────────────

/** Mala slova, bez kvačica, „ / " → „/", decimalni zarez → tačka, bez zagrada i zareza. */
export function normName(s: string): string {
    return (s || '')
        .toLowerCase()
        .replace(/bež/g, 'beige')
        .replace(/đ/g, 'dj')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s*\/\s*/g, '/')
        .replace(/(\d),(\d)/g, '$1.$2')
        .replace(/[()[\],;·–—"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Ključ za poređenje „istog naziva": samo slova, cifre i tačke. */
export function looseKey(s: string): string {
    return normName(s).replace(/[^a-z0-9.]+/g, ' ').trim();
}

// ─── rječnik ─────────────────────────────────────────────────────────

const TYPE_GROUPS: [string, RegExp][] = [
    ['iveral', /\b(iveral|iverica|ivericu|dtd|pal|oplemenjen\w*)\b/],
    ['mdf', /\bmdf\b/],
    ['hpl', /\bhpl\b/],
    ['compact', /\b(compact|kompakt)\b/],
    ['akril', /\b(akril|acryl)\w*/],
    ['furnir', /\b(furnir|veneer)\w*/],
    ['lesonit', /\b(lesonit|lesomal|hdf)\b/],
    ['osb', /\bosb\b/],
    ['sper', /\b(sperploc\w*|sper\w*|multipleks|plywood)\b/],
    ['solid', /\b(kerrock|corian)\b/],
    ['masiv', /\bmasiv\w*/],
];

const FLAG_RULES: [string, RegExp][] = [
    ['bezubl', /\bbez\s+(ublaz\w*|uspori\w*|amortiz\w*)/],
    ['ubl', /\b(ublaz\w*|uspori\w*|soft\s?close|softclose|amortiz\w*)/],
    ['tipon', /\b(tip\s?-?\s?on|push|kpush)\b/],
    ['negor', /\bnegoriv\w*/],
    ['vlago', /\b(vlago\w*|hidro\w*)/],
];

const STOP = new Set([
    'za', 'sa', 's', 'i', 'od', 'do', 'na', 'u', 'iz', 'po', 'ili', 'and', 'with', 'for', 'the', 'bez',
    'kom', 'set', 'par', 'paket', 'mm', 'cm', 'm', 'm2', 'x', 'kg', 'km',
    // riječi vrste — nose ih types/kind, ne smiju dvaput bodovati
    'kant', 'kt', 'traka', 'trake', 'abs', 'radna', 'ploca', 'ploce', 'okov', 'materijal',
    'iveral', 'iverica', 'dtd', 'pal', 'mdf', 'hpl', 'compact', 'kompakt', 'akril', 'furnir', 'lesonit',
    'lesomal', 'hdf', 'osb', 'sperploca', 'multipleks', 'kerrock', 'corian', 'masiv', 'masivna', 'masivni',
    'kk', 'tip', 'on', 'push', 'kpush', 'st', 'ral', 'egger', 'kronospan',
    // uloga komada u SketchUpu nije identitet materijala; jednoslovni veznici
    'ledj', 'ledja', 'a', 'e', 'o',
]);

/** Korijen → kanonski oblik (sinonimi i različiti nazivi istog). */
const SYN: Record<string, string> = {
    sark: 'baglam', sarnir: 'baglam', hinge: 'baglam',
    nogic: 'nog', noz: 'nog', nozic: 'nog',
    ruckic: 'ruck', rucic: 'ruck',
    white: 'bijel', black: 'crn', grey: 'siv', gray: 'siv',
    oak: 'hrast', walnut: 'orah', ash: 'jasen', beech: 'bukv', cherry: 'tresnj', teak: 'tik',
    smrek: 'smrc', spruce: 'smrc',
    farbanj: 'farb', farban: 'farb', bojenj: 'farb', boj: 'farb', bojanj: 'farb', paint: 'farb',
    lakiranj: 'lak', lakiran: 'lak', lacquer: 'lak',
    bajcanj: 'bajc',
    horizontaln: 'horiz', vertikaln: 'vert',
    gardarobn: 'garderobn',
    stap: 'sipk', stapa: 'sipk',
    vjesalic: 'vjesal',
};

const SUFFIXES = ['ama', 'ima', 'ata', 'ova', 'eva', 'ove', 'ega', 'emu', 'ih', 'im', 'om', 'oj', 'og', 'eg', 'em', 'a', 'e', 'i', 'o', 'u'];

export function stem(w: string): string {
    let s = w;
    if (s.length >= 4) {
        for (const suf of SUFFIXES) {
            if (s.endsWith(suf) && s.length - suf.length >= 3) { s = s.slice(0, s.length - suf.length); break; }
        }
    }
    return SYN[s] || SYN[w] || s;
}

function sameWord(a: string, b: string): boolean {
    if (a === b) return true;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    return s.length >= 4 && l.startsWith(s);
}

const OKOV_WORDS = /\b(vodilic\w*|baglam\w*|sark\w*|ruck\w*|rukohvat\w*|legrabox|tandembox|antaro|nogic\w*|nosac\w*|okov\w*|aventos|tip\s?-?on|kosar\w*|kant[ae]\s+za\s+smece|lift|bravic\w*|brav[ae]\b|magnet\w*|tockic\w*|tockov\w*|vijc\w*|vijak|tiple|cilindar|stek[ae]|zaba\b|gola\b|gole\b|sipk\w*\s+za\s+ofing\w*|ofinger\w*|klizn\w*\s+vrat\w*|space\s+tower|revego|servetto|ukrut\w*|rozetn\w*|transformator|led\s+(profil|traka)|kutnik|okretn\w*)/;

function inferKind(n: string, kategorija?: string): MatchKind | null {
    if (/^kt\b|^kt\/|\bkant\s*traka|\bkant\b|\babs\s+traka/.test(n)) return 'kant';
    if (/\b(staklo|ogledalo|lakobel|parsol|planibel|float|lamistal)\b/.test(n) || kategorija === 'Staklo') return 'staklo';
    if (/\b(lakiranj\w*|farbanj\w*|bojenj\w*|bajcanj\w*|boja\s+za)\b/.test(n)) return 'obrada';
    if (OKOV_WORDS.test(n) || kategorija === 'Okovi') return 'okov';
    if (kategorija === 'Ploče i trake' || kategorija === 'Ploča') return 'ploca';
    if (TYPE_GROUPS.some(([, re]) => re.test(n)) || /radna\s+ploc/.test(n)) return 'ploca';
    return null;
}

// ─── opis naziva ─────────────────────────────────────────────────────

export function describe(text: string, hint: MatchHint = {}): MatchDesc {
    let n = normName(text);
    const kind = hint.kind !== undefined && hint.kind !== null ? hint.kind : inferKind(n, hint.kategorija);
    const boardish = kind === 'ploca' || kind === 'kant';

    const types = TYPE_GROUPS.filter(([, re]) => re.test(n)).map(([t]) => t);
    const radna = /radna\s+ploc|\bradne\s+ploc/.test(n);
    const kk = /\bkk\b|\bkontra\b/.test(n);
    let flags = FLAG_RULES.filter(([, re]) => re.test(n)).map(([f]) => f);
    // „bez usporivača" sadrži i riječ usporivač — nije oboje
    if (flags.includes('bezubl')) flags = flags.filter(f => f !== 'ubl');

    const sizes: number[] = [];
    let thickness: number | null = hint.thickness ?? null;
    let edge: number | null = null;
    const codes: string[] = [];
    const articles: string[] = [];
    const cut = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
        n = n.replace(re, (...args) => { fn(args as unknown as RegExpExecArray); return ' '; });
    };

    // kant: „23/0.8", „0.8/23", „42 / 1"
    cut(/\b(\d{1,2}(?:\.\d)?)\s*\/\s*(\d{1,2}(?:\.\d)?)\b/g, m => {
        const w = Math.max(+m[1], +m[2]);
        if (w >= 15 && w <= 100) edge = w;
    });
    // broj artikla
    cut(/\b\d{6,}\b/g, m => { articles.push(m[0]); });
    // dimenzije ploče 2800x2070(x18)
    cut(/\b(\d{3,4})\s*x\s*(\d{3,4})(?:\s*x\s*(\d{1,2}(?:\.\d)?))?\b/g, m => {
        sizes.push(+m[1], +m[2]);
        if (m[3] && thickness === null) thickness = +m[3];
    });
    // RAL boja
    cut(/\bral\s*(\d{4})\b/g, m => { codes.push('ral' + m[1]); });
    // struktura (ST9, ST10) — samo sekundarna, ne razlikuje dekor
    cut(/\bst\s?\d{1,2}\b/g, () => undefined);
    // šifre modela s tačkom (658.35, 176.8)
    cut(/\b\d{2,4}\.\d{1,3}\b/g, m => { codes.push(m[0]); });
    // mjere s jedinicom
    cut(/\b(\d{1,4}(?:\.\d)?)\s*cm\b/g, m => { sizes.push(Math.round(+m[1] * 10)); });
    cut(/\b(\d{1,4}(?:\.\d)?)\s*mm\b/g, m => {
        const v = +m[1];
        if (v <= 50 && boardish) { if (thickness === null) thickness = v; }
        else sizes.push(v);
    });
    // šifre dekora: U156, W960, H3331, F800, AL06
    cut(/\b([a-z]{1,2})(\d{2,4})\b/g, m => {
        if (['st', 'mm', 'cm', 'm', 'kt', 'x', 'ml', 'kg', 'l', 'm2'].includes(m[1])) return;
        if (m[1].length + m[2].length < 3) return;
        codes.push(m[1] + m[2]);
    });
    // goli brojevi: kod ploča 4 cifre = dekor (8685, 0125), 1–2 cifre = debljina;
    // kod okova = mjera (450, 1200)
    cut(/\b\d{1,4}\b/g, m => {
        const v = m[0];
        if (boardish && v.length === 4) codes.push(v);
        else if (boardish && v.length <= 2 && +v >= 3 && +v <= 50) { if (thickness === null) thickness = +v; }
        else if (+v >= 30) sizes.push(+v);
    });

    const words: string[] = [];
    for (const raw of n.split(/[^a-z0-9]+/)) {
        // jednoslovne oznake ostaju riječ: Gola L / C, Legrabox C / F
        if (!raw || STOP.has(raw) || /^\d+$/.test(raw)) continue;
        if (/^(ublaz|uspori|amortiz|softclose|negoriv|vlago|hidro)/.test(raw)) continue;
        const s = stem(raw);
        if (STOP.has(s) || words.includes(s)) continue;
        words.push(s);
    }

    return {
        kind, types, radna, kk, flags,
        codes: Array.from(new Set(codes)),
        articles,
        sizes: Array.from(new Set(sizes)),
        thickness,
        edge,
        words,
        loose: looseKey(text),
    };
}

// ─── bodovanje ───────────────────────────────────────────────────────

const LESONIT = 'lesonit';

/** Debljina kandidata bez broja u nazivu: iveral 18, radna 38, lesonit tanak. */
function impliedThicknessOk(c: MatchDesc, th: number): boolean {
    if (c.radna) return th >= 28;
    if (c.types.includes(LESONIT)) return th < 8;
    if (c.types.includes('furnir') || c.types.includes('hpl')) return true;   // obloga — debljina je jezgra
    if (c.types.includes('iveral') || c.types.length === 0) return th >= 15.5 && th <= 19.5;
    return true;
}

/** Bodovi kandidata za upit; null = odbačen tvrdim pravilom. */
export function scorePair(q: MatchDesc, c: MatchDesc): { score: number; strong: boolean; exact: boolean } | null {
    if (q.kind && c.kind && q.kind !== c.kind) return null;

    let score = 0;
    let strong = false;

    // vrsta ploče
    if (q.types.length && c.types.length) {
        if (!q.types.some(t => c.types.includes(t))) return null;
        score += 15;
    } else if (q.types.length && !c.types.length) score -= 12;
    else if (!q.types.length && c.types.length) {
        // Ploča bez oznake vrste je najčešće iveral; HPL, akril, kerrock… su rjeđi.
        score -= c.types.some(t => t !== 'iveral') ? 12 : 4;
    }
    if (q.radna !== c.radna && (q.kind === 'ploca' || c.kind === 'ploca')) return null;
    if (q.kk !== c.kk) return null;

    // debljina (samo ploče)
    if ((q.kind ?? c.kind) === 'ploca' && q.thickness != null) {
        if (c.thickness != null) {
            if (Math.abs(c.thickness - q.thickness) > 0.6) return null;
            score += 6;
        } else if (!impliedThicknessOk(c, q.thickness)) return null;
    }

    // širina kant trake: uska (22/23) ≠ široka (42/43)
    if ((q.kind ?? c.kind) === 'kant') {
        const qe = q.edge ?? (q.thickness != null ? (q.thickness >= 30 ? 43 : 23) : null);
        if (qe != null && c.edge != null) {
            if ((qe >= 30) !== (c.edge >= 30)) return null;
            score += 4;
        }
    }

    // šifre
    if (q.codes.length && c.codes.length) {
        if (!q.codes.some(x => c.codes.includes(x))) return null;
        score += 60;
        strong = true;
    } else if (q.codes.length && !c.codes.length && (q.kind === 'ploca' || q.kind === 'kant')) score -= 30;
    else if (!q.codes.length && c.codes.length && (q.kind === 'ploca' || q.kind === 'kant')) score -= 8;

    // broj artikla
    if (q.articles.length && c.articles.length) {
        if (!q.articles.some(x => c.articles.includes(x))) return null;
        score += 80;
        strong = true;
    }

    // mjere (dužina vodilice, visina nogice…)
    if (q.sizes.length && c.sizes.length) {
        if (!q.sizes.some(x => c.sizes.includes(x))) return null;
        score += 20;
    } else if (q.sizes.length && !c.sizes.length) score -= 4;
    else if (!q.sizes.length && c.sizes.length && q.kind === 'okov') score -= 6;

    // oznake
    const opposite = (a: string, b: string) =>
        (q.flags.includes(a) && c.flags.includes(b)) || (q.flags.includes(b) && c.flags.includes(a));
    if (opposite('ubl', 'bezubl')) return null;
    for (const f of ['negor', 'vlago']) {
        if (q.flags.includes(f) && !c.flags.includes(f)) return null;
        if (!q.flags.includes(f) && c.flags.includes(f)) score -= 15;
    }
    for (const f of ['ubl', 'bezubl', 'tipon']) {
        if (q.flags.includes(f) && c.flags.includes(f)) score += 8;
        else if (q.flags.includes(f) !== c.flags.includes(f)) score -= f === 'tipon' ? 12 : 4;
    }

    // riječi
    const common = c.words.filter(w => q.words.some(x => sameWord(w, x)));
    const extraC = c.words.length - common.length;
    const extraQ = q.words.filter(w => !c.words.some(x => sameWord(w, x))).length;
    score += common.length * 12 - extraC * 4 - extraQ * 2;
    // Kandidat bez viška riječi: bonus srazmjeran tome koliko upita objašnjava.
    if (c.words.length && extraC === 0 && common.length) score += 15 * common.length / Math.max(1, q.words.length);
    // Isti naziv — ali tek poslije tvrdih pravila (14 mm „Bijeli za korpus" ≠ onaj od 18).
    if (q.loose && q.loose === c.loose) return { score: Math.max(score, 0) + 100, strong: true, exact: true };
    // Bez ijedne zajedničke riječi i bez šifre par je slab (samo vrsta / mjera).
    if (!strong && common.length === 0 && q.words.length > 0) score /= 2;

    return { score, strong, exact: false };
}

export function describeCatalog<T extends CatalogItem>(items: T[]): { item: T; desc: MatchDesc }[] {
    return items
        .filter(i => (i.naziv || '').trim())
        .map(item => ({ item, desc: describe(item.naziv, { kategorija: item.kategorija }) }));
}

/** Najbolji kandidati iz kataloga (već opisanog) za upit. */
export function matchDescribed<T extends CatalogItem>(q: MatchDesc, catalog: { item: T; desc: MatchDesc }[], limit = 8): MatchResult<T> {
    const ranked: Ranked<T>[] = [];
    for (const { item, desc } of catalog) {
        const r = scorePair(q, desc);
        if (r && r.score > 0) ranked.push({ item, score: r.score, strong: r.strong, exact: r.exact });
    }
    ranked.sort((a, b) => b.score - a.score || a.item.naziv.length - b.item.naziv.length);
    const best = ranked[0] || null;
    const second = ranked[1];
    let auto = false;
    let how: MatchResult['how'] = null;
    if (best) {
        const margin = second ? best.score - second.score : Infinity;
        if (best.exact) { auto = true; how = 'naziv'; }
        // Jedini kandidat te vrste za upit bez riječi i šifre (HDF → Lesomal).
        else if (ranked.length === 1 && q.types.length && !q.words.length && !q.codes.length && best.score >= SUGGEST_SCORE) { auto = true; how = 'slicno'; }
        else if (best.strong && margin > 0) { auto = true; how = 'sifra'; }
        else if (best.score >= AUTO_SCORE && margin >= AUTO_MARGIN) { auto = true; how = 'slicno'; }
    }
    return { best, auto, how, ranked: ranked.slice(0, limit) };
}

export function matchCatalog<T extends CatalogItem>(text: string, hint: MatchHint, catalog: T[] | { item: T; desc: MatchDesc }[], limit = 8): MatchResult<T> {
    const described = (catalog.length && 'desc' in (catalog[0] as object))
        ? catalog as { item: T; desc: MatchDesc }[]
        : describeCatalog(catalog as T[]);
    return matchDescribed(describe(text, hint), described, limit);
}
