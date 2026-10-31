// ════════════════════════════════════════════════════════════════════
// PRATEĆI MATERIJALI — „Obično ide uz to" u modalu Dodaj Materijale
//
// Čista, deterministička logika (bez AI-ja i bez Firebase). Tri izvora:
//   1. STATISTIKA — koliko često se dva materijala nađu u ISTOJ sastavnici
//      proizvoda (podrška = broj proizvoda, pouzdanost = udio proizvoda s A
//      koji imaju i B). Par mora postojati u ≥ 2 projekta: jedan projekat s
//      20 istih proizvoda inače „nauči" slučajnost (npr. jasen ↔ F416).
//   2. DEKOR — iveral/HPL/furnir ↔ kant traka istog dekora (šifra U702,
//      H3395… ili riječi „hrast", „bijeli za korpus" kad šifre nema).
//   3. TIP — furnir se lijepi na MDF, MDF se najčešće furnira
//      (tip iz naziva: materialTypeFromName u lib/productProcesses).
//
// Ne predlaže ništa što proizvod već ima (ni ono što je već odabrano),
// staklo ni alu vrata (imaju svoj tok), ni kant čiji dekor proizvod nema.
// jest: lib/__tests__/materialCompanions.test.ts
// ════════════════════════════════════════════════════════════════════

import { materialTypeFromName } from './productProcesses';
import { normalizeForSearch } from './searchMatch';

/** Stavka sastavnice (ProductMaterial ili odabir u modalu). */
export interface CompanionItemLite {
    Material_ID?: string;
    Material_Name?: string;
}

/** Artikal kataloga (Material) — samo polja koja logika čita. */
export interface CompanionCatalogLite {
    Material_ID: string;
    Name: string;
    Category?: string;
    Is_Glass?: boolean;
    Is_Alu_Door?: boolean;
}

/** Sastavnica jednog proizvoda iz istorije. */
export interface CompanionBundle {
    projectId?: string;
    materials: CompanionItemLite[];
}

export interface CompanionStats {
    /** Broj proizvoda (s bar jednim materijalom) u istoriji. */
    products: number;
    /** ključ → u koliko proizvoda se javlja */
    count: Map<string, number>;
    /** A → B → { proizvoda s oba, projekata s oba } */
    pairs: Map<string, Map<string, { products: number; projects: Set<string> }>>;
}

export type CompanionKind = 'dekor' | 'statistika' | 'tip';

export interface CompanionReason {
    kind: CompanionKind;
    text: string;
}

export interface CompanionSuggestion<M extends CompanionCatalogLite = CompanionCatalogLite> {
    material: M;
    score: number;
    /** Najjači razlog prvi — UI prikazuje prvi, ostale u title. */
    reasons: CompanionReason[];
}

export interface CompanionOptions {
    minSupport?: number;
    minProjects?: number;
    minConfidence?: number;
    limit?: number;
}

const DEFAULTS: Required<CompanionOptions> = { minSupport: 3, minProjects: 2, minConfidence: 0.4, limit: 6 };

/** Bodovi po izvoru: dekor je pravilo (skoro sigurno), tip je slabiji nagovještaj. */
const DECOR_SCORE = 0.92;
const TYPE_SCORE = 0.55;
/** Prijedlog iz materijala koji proizvod VEĆ ima je malo manje bitan od upravo odabranog. */
const EXISTING_WEIGHT = 0.9;

const BOARD_TYPES = new Set(['iveral', 'hpl', 'furnir']);

// ────────────────────────────────────────────────────────────────────
// Ključ materijala: ID iz kataloga; bez njega (stari/uvezeni redovi) po nazivu.
// ────────────────────────────────────────────────────────────────────

interface CatalogIndex<M extends CompanionCatalogLite> {
    byId: Map<string, M>;
    byName: Map<string, M>;
}

function indexCatalog<M extends CompanionCatalogLite>(catalog: M[]): CatalogIndex<M> {
    const byId = new Map<string, M>();
    const byName = new Map<string, M>();
    for (const m of catalog || []) {
        byId.set(m.Material_ID, m);
        const n = normalizeForSearch(m.Name);
        if (n && !byName.has(n)) byName.set(n, m);
    }
    return { byId, byName };
}

function keyOf(item: CompanionItemLite, idx: CatalogIndex<CompanionCatalogLite>): string | null {
    if (item.Material_ID && idx.byId.has(item.Material_ID)) return item.Material_ID;
    const n = normalizeForSearch(item.Material_Name);
    if (!n) return item.Material_ID || null;
    const hit = idx.byName.get(n);
    return hit ? hit.Material_ID : `name:${n}`;
}

// ────────────────────────────────────────────────────────────────────
// 1. STATISTIKA
// ────────────────────────────────────────────────────────────────────

export function buildCompanionStats(bundles: CompanionBundle[], catalog: CompanionCatalogLite[]): CompanionStats {
    const idx = indexCatalog(catalog);
    const count = new Map<string, number>();
    const pairs: CompanionStats['pairs'] = new Map();
    let products = 0;
    bundles.forEach((b, i) => {
        const keys = Array.from(new Set((b.materials || []).map(m => keyOf(m, idx)).filter((k): k is string => !!k)));
        if (!keys.length) return;
        products++;
        const project = b.projectId || `#${i}`;
        for (const a of keys) {
            count.set(a, (count.get(a) || 0) + 1);
            let row = pairs.get(a);
            if (!row) pairs.set(a, row = new Map());
            for (const c of keys) {
                if (c === a) continue;
                let cell = row.get(c);
                if (!cell) row.set(c, cell = { products: 0, projects: new Set() });
                cell.products++;
                cell.projects.add(project);
            }
        }
    });
    return { products, count, pairs };
}

/** Najjači parovi (za izvještaj i provjeru): A → B s podrškom i pouzdanošću. */
export function topCompanionPairs(stats: CompanionStats, opts: CompanionOptions = {}) {
    const o = { ...DEFAULTS, ...opts };
    const out: { from: string; to: string; support: number; projects: number; confidence: number }[] = [];
    stats.pairs.forEach((row, a) => {
        const n = stats.count.get(a) || 0;
        row.forEach((cell, b) => {
            const confidence = n ? cell.products / n : 0;
            if (cell.products >= o.minSupport && cell.projects.size >= o.minProjects && confidence >= o.minConfidence) {
                out.push({ from: a, to: b, support: cell.products, projects: cell.projects.size, confidence });
            }
        });
    });
    return out.sort((x, y) => y.support - x.support || y.confidence - x.confidence || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
}

// ────────────────────────────────────────────────────────────────────
// 2. DEKOR — šifra (U702, H3395, F416, 0077) ili riječi bez tipa i dimenzija
// ────────────────────────────────────────────────────────────────────

/** Riječi koje kažu ŠTA je materijal, ne kakav je — ne ulaze u dekor. */
const TYPE_WORDS = new Set(['iveral', 'iverica', 'univer', 'furnir', 'kk', 'hpl', 'kt', 'kant', 'abs', 'traka', 'mdf', 'masiv', 'ploca']);

export interface Decor {
    codes: string[];
    words: string[];
}

/** Bosanski pridjevi mijenjaju nastavak (bijeli/bijela, crni/crna) — skini zadnji samoglasnik. */
function stem(w: string): string {
    return w.length > 3 ? w.replace(/[aeiou]$/, '') : w;
}

export function decorOf(name: string | undefined): Decor {
    const tokens = normalizeForSearch(name).split(/[\s/\-–,()]+/).filter(Boolean);
    const codes: string[] = [];
    const words: string[] = [];
    for (const t of tokens) {
        // ST9/ST10 je struktura površine, ne dekor; 16mm je debljina.
        if (/^st\d+$/.test(t)) continue;
        if (/^([a-z]{1,2}\d{2,4}|\d{4})$/.test(t)) codes.push(t);
        else if (/^[a-z]{3,}$/.test(t) && !TYPE_WORDS.has(t)) words.push(stem(t));
    }
    return { codes, words };
}

/** Isti dekor: zajednička šifra; bez šifre na ploči — sve riječi ploče u nazivu trake (koja nema šifru). */
function boardMatchesEdge(board: Decor, edge: Decor): boolean {
    if (board.codes.length) return edge.codes.some(c => board.codes.includes(c));
    return !edge.codes.length && board.words.length > 0 && board.words.every(w => edge.words.includes(w));
}

/** Obrnuto (traka → ploča): šifra trake na ploči; bez šifre — sve riječi trake u ploči bez šifre. */
function edgeMatchesBoard(edge: Decor, board: Decor): boolean {
    if (edge.codes.length) return board.codes.some(c => edge.codes.includes(c));
    return !board.codes.length && edge.words.length > 0 && edge.words.every(w => board.words.includes(w));
}

/** Dvije ploče istog tipa, isti dekor: ista šifra, ili bez šifre iste riječi. */
function sameDecor(a: Decor, b: Decor): boolean {
    if (a.codes.length || b.codes.length) return a.codes.some(c => b.codes.includes(c));
    return a.words.length > 0 && a.words.length === b.words.length && a.words.every(w => b.words.includes(w));
}

/** Tip za prijedloge: okovi („Vodilice za klizna vrata / Furnir Hrast") nisu ploča ni traka. */
function typeOf(m: { Name?: string; Material_Name?: string; Category?: string }): string | null {
    if (normalizeForSearch(m.Category) === 'okovi') return null;
    return materialTypeFromName(m.Name ?? m.Material_Name);
}

function isRedirect(m: CompanionCatalogLite): boolean {
    return m.Is_Glass === true || m.Is_Alu_Door === true || m.Category === 'Staklo' || m.Category === 'Alu vrata';
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const quote = (s: string) => `„${s}"`;

// ────────────────────────────────────────────────────────────────────
// PRIJEDLOG
// ────────────────────────────────────────────────────────────────────

export interface SuggestCompanionsInput<M extends CompanionCatalogLite> {
    /** Upravo odabrano u modalu (najjači signal). */
    selected: CompanionItemLite[];
    /** Šta proizvod već ima u sastavnici. */
    existing: CompanionItemLite[];
    catalog: M[];
    stats: CompanionStats;
    options?: CompanionOptions;
}

export function suggestCompanions<M extends CompanionCatalogLite>(input: SuggestCompanionsInput<M>): CompanionSuggestion<M>[] {
    const o = { ...DEFAULTS, ...(input.options || {}) };
    const idx = indexCatalog(input.catalog);
    const usage = (id: string) => input.stats.count.get(id) || 0;

    // Sidra: odabrano + postojeće (bez duplikata; odabrano ima prednost).
    type Anchor = { key: string; name: string; weight: number; type: string | null; decor: Decor };
    const anchors: Anchor[] = [];
    const taken = new Set<string>();
    const push = (items: CompanionItemLite[], weight: number) => {
        for (const it of items || []) {
            const key = keyOf(it, idx);
            if (!key || taken.has(key)) continue;
            taken.add(key);
            const cat = idx.byId.get(key);
            const name = cat?.Name || it.Material_Name || '';
            anchors.push({ key, name, weight, type: typeOf(cat || { Name: name }), decor: decorOf(name) });
        }
    };
    push(input.selected, 1);
    push(input.existing, EXISTING_WEIGHT);
    if (!anchors.length) return [];

    const presentTypes = new Set(anchors.map(a => a.type).filter(Boolean));
    const boards = anchors.filter(a => a.type && BOARD_TYPES.has(a.type));
    const edges = anchors.filter(a => a.type === 'kant');

    const found = new Map<string, { material: M; score: number; reasons: (CompanionReason & { score: number })[] }>();
    const offer = (m: M | undefined, score: number, reason: CompanionReason) => {
        if (!m || taken.has(m.Material_ID) || isRedirect(m)) return;
        let f = found.get(m.Material_ID);
        if (!f) found.set(m.Material_ID, f = { material: m, score: 0, reasons: [] });
        if (f.reasons.some(r => r.kind === reason.kind)) {
            // Isti izvor iz drugog sidra — zadrži jači razlog.
            const prev = f.reasons.find(r => r.kind === reason.kind)!;
            if (score > prev.score) Object.assign(prev, reason, { score });
        } else {
            f.reasons.push({ ...reason, score });
        }
    };

    const catalogOfType = (t: string) => input.catalog.filter(m => typeOf(m) === t && !isRedirect(m));

    // ── DEKOR: ploča → traka istog dekora (jedna, najkorištenija) ──
    const edgeCatalog = catalogOfType('kant').map(m => ({ m, decor: decorOf(m.Name) }));
    for (const b of boards) {
        if (edges.some(e => boardMatchesEdge(b.decor, e.decor))) continue; // već ima traku tog dekora
        const best = edgeCatalog
            .filter(e => boardMatchesEdge(b.decor, e.decor))
            .sort((x, y) =>
                // furnir hrast → „KT / Furnir Hrast", ne „KT / Orah Arrezo" iverala
                Number(b.type === 'furnir' && !/furnir/i.test(y.m.Name)) - Number(b.type === 'furnir' && !/furnir/i.test(x.m.Name))
                || (x.decor.words.length - y.decor.words.length)
                || usage(y.m.Material_ID) - usage(x.m.Material_ID)
                || x.m.Name.localeCompare(y.m.Name))[0];
        if (best) offer(best.m, DECOR_SCORE * b.weight, { kind: 'dekor', text: `kant istog dekora kao ${quote(b.name)}` });
    }
    // ── DEKOR: traka → ploča istog dekora ──
    const boardCatalog = input.catalog
        .filter(m => { const t = typeOf(m); return !!t && BOARD_TYPES.has(t) && !isRedirect(m); })
        .map(m => ({ m, decor: decorOf(m.Name) }));
    for (const e of edges) {
        if (boards.some(b => edgeMatchesBoard(e.decor, b.decor))) continue;
        const best = boardCatalog
            .filter(b => edgeMatchesBoard(e.decor, b.decor))
            .sort((x, y) => (x.decor.words.length - y.decor.words.length)
                || usage(y.m.Material_ID) - usage(x.m.Material_ID)
                || x.m.Name.localeCompare(y.m.Name))[0];
        if (best) offer(best.m, DECOR_SCORE * e.weight, { kind: 'dekor', text: `ploča istog dekora kao ${quote(e.name)}` });
    }

    // ── STATISTIKA ──
    for (const a of anchors) {
        const n = usage(a.key);
        const row = input.stats.pairs.get(a.key);
        if (!n || !row) continue;
        row.forEach((cell, bKey) => {
            const conf = cell.products / n;
            if (cell.products < o.minSupport || cell.projects.size < o.minProjects || conf < o.minConfidence) return;
            const m = idx.byId.get(bKey);
            if (!m) return;
            const t = typeOf(m);
            const d = decorOf(m.Name);
            // Traka ide samo uz ploču njenog dekora — statistika zna „naučiti" tuđu traku iz istog projekta.
            if (t === 'kant' && !boards.some(b => boardMatchesEdge(b.decor, d))) return;
            // Proizvod već ima furnir orah → ne nudi furnir hrast; „Furnir KK / Hrast" uz hrast ostaje.
            if (t && BOARD_TYPES.has(t)) {
                const same = boards.filter(b => b.type === t);
                if (same.length && !same.some(b => sameDecor(b.decor, d))) return;
            }
            offer(m, conf * a.weight, { kind: 'statistika', text: `u ${pct(conf)} proizvoda s ${quote(a.name)}` });
        });
    }

    // ── TIP: furnir ↔ MDF (samo ako proizvod nema tip koji se predlaže) ──
    const mostUsed = (t: string, prefer?: RegExp) => catalogOfType(t)
        .sort((x, y) => usage(y.Material_ID) - usage(x.Material_ID)
            || Number(!!prefer && prefer.test(y.Name)) - Number(!!prefer && prefer.test(x.Name))
            || x.Name.localeCompare(y.Name))[0];
    const furnir = anchors.find(a => a.type === 'furnir');
    if (furnir && !presentTypes.has('mdf')) {
        offer(mostUsed('mdf', /\b18\b/), TYPE_SCORE * furnir.weight, { kind: 'tip', text: 'furnir se lijepi na MDF' });
    }
    const mdf = anchors.find(a => a.type === 'mdf');
    if (mdf && !presentTypes.has('furnir')) {
        offer(mostUsed('furnir'), TYPE_SCORE * mdf.weight, { kind: 'tip', text: 'MDF se najčešće furnira' });
    }

    return Array.from(found.values())
        .map(f => {
            const reasons = f.reasons.sort((x, y) => y.score - x.score);
            // Više nezavisnih izvora za isti artikal = malo jači prijedlog.
            const score = reasons[0].score + 0.04 * (reasons.length - 1);
            return { material: f.material, score, reasons: reasons.map(({ kind, text }) => ({ kind, text })) };
        })
        .sort((x, y) => y.score - x.score || x.material.Name.localeCompare(y.material.Name))
        .slice(0, o.limit);
}
