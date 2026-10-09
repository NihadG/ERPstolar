// ════════════════════════════════════════════════════════════════════
// UVOZ PONUDE IZ SKETCHUPA (Component Manager → „Izvoz za ERP")
//
// Plugin izvozi JSON (format `nt-sketchup-erp`): pozicije ponude su
// proizvodi, a stavke ploča / kant traka / okov su njihova sastavnica — s
// dobavljačem i cijenom koje je ponuda izabrala. Ovaj modul je ČISTA logika:
//
//   parseSketchUpExport   fajl → provjeren izvoz
//   buildImportPlan       izvoz + katalog + dobavljači → šta se povezuje,
//                         šta se pravi (dobavljači → materijali → proizvodi)
//   runImport             izvršava plan preko ubrizganih servisa
//   buildErpCatalog       katalog za plugin (`erp_katalog.json`), da ponuda
//                         u SketchUpu prepozna materijale iz baze
//
// Veza stavke s katalogom ide redom: Material_ID (plugin ga zna iz
// erp_katalog.json) → tačan naziv (kolona „ERP materijal" u cjenovniku) →
// šifra dekora + vrsta + debljina (ploče i kant) / riječi i mjera (okov) →
// novi materijal. Usluge (rezanje, kantovanje, CNC) se zasad ne uvoze.
//
// KOLIČINE: plugin izvozi ukupno za poziciju (sve kopije komponente), a ERP
// sastavnicu drži PO KOMADU proizvoda (Material_Cost × Quantity) — zato se
// količina dijeli brojem komada.
// ════════════════════════════════════════════════════════════════════

import type { Material, Product, ProductMaterial, Supplier } from './types';
import {
    normName, looseKey, describe, describeCatalog, matchDescribed, SUGGEST_SCORE,
    type CatalogItem, type MatchDesc, type MatchHint, type MatchKind, type MatchResult,
} from './sketchup/match';

export const SU_EXPORT_FORMAT = 'nt-sketchup-erp';
export const ERP_CATALOG_FORMAT = 'nt-erp-katalog';

/** ploca = ploča (i MDF jezgro), obloga = furnir / HPL u m², obrada = lakiranje / farbanje. */
export type SuLineKind = 'ploca' | 'obloga' | 'kant' | 'okov' | 'obrada' | 'usluga' | 'ostalo';

export interface SuLine {
    vrsta: SuLineKind;
    /** Naziv stavke u ponudi (artikl izabranog dobavljača). */
    naziv: string;
    /** Tačan naziv u ERP katalogu (kolona „ERP materijal" ili erp_katalog.json). */
    erp?: string;
    /** Material_ID kad je plugin stavku našao u erp_katalog.json. */
    erpId?: string;
    /** Odakle je ERP veza: kolona „ERP materijal" u cjenovniku ili prepoznavanje u katalogu. */
    erpVeza?: 'cjenovnik' | 'katalog';
    /** SketchUp materijal (ploče i kant). */
    materijal?: string;
    /** Debljina ploče u mm (kod kant trake — debljina ploče na koju ide). */
    debljina?: number;
    /** Površina jedne ploče u m² — za preračun „ploča" → m². */
    povrsinaPloce?: number;
    /** Izabrani dobavljač; prazno kad cijena nije od stvarnog dobavljača. */
    dobavljac?: string;
    jm: string;
    /** UKUPNO za poziciju (sve kopije komponente). */
    kolicina: number;
    /** KM po jm, s PDV-om. */
    cijena: number;
    napomena?: string;
}

export interface SuProduct {
    /** Naziv globalne komponente u SketchUpu. */
    kljuc: string;
    /** Naziv u ponudi (ili kljuc). */
    naziv: string;
    /** Broj istih komponenti (komada proizvoda). */
    kolicina: number;
    sirina?: number;
    visina?: number;
    dubina?: number;
    stavke: SuLine[];
    ponuda?: { materijal?: number; rad?: number; marza?: number; ukupno?: number; jedinicna?: number };
}

export interface SuExport {
    format: typeof SU_EXPORT_FORMAT;
    verzija: number;
    datum?: string;
    model?: string;
    komponenta?: string;
    cjenovnik?: string;
    klijent?: string;
    proizvodi: SuProduct[];
}

// ─── parsiranje ──────────────────────────────────────────────────────

const KINDS: SuLineKind[] = ['ploca', 'obloga', 'kant', 'okov', 'obrada', 'usluga', 'ostalo'];

const num = (v: unknown): number => {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'string') {
        const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }
    return 0;
};
const optNum = (v: unknown): number | undefined => {
    const n = num(v);
    return n > 0 ? n : undefined;
};
const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

export function parseSketchUpExport(text: string): { data?: SuExport; error?: string } {
    let raw: any;
    try {
        raw = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
        return { error: 'Fajl nije ispravan JSON. Izvezi ga ponovo iz SketchUpa (Ponuda → Izvoz za ERP).' };
    }
    if (!raw || raw.format !== SU_EXPORT_FORMAT) {
        return { error: 'Ovo nije izvoz iz SketchUpa. Očekuje se fajl iz Component Managera: Ponuda → Izvoz za ERP.' };
    }
    if (!Array.isArray(raw.proizvodi) || raw.proizvodi.length === 0) {
        return { error: 'Izvoz nema nijednu poziciju.' };
    }

    const proizvodi: SuProduct[] = raw.proizvodi.map((p: any, i: number) => {
        const kljuc = str(p?.kljuc) || `Pozicija ${i + 1}`;
        const stavke: SuLine[] = (Array.isArray(p?.stavke) ? p.stavke : []).map((s: any) => ({
            vrsta: KINDS.includes(s?.vrsta) ? s.vrsta : 'ostalo',
            naziv: str(s?.naziv),
            erp: str(s?.erp) || undefined,
            erpId: str(s?.erpId) || undefined,
            erpVeza: s?.erpVeza === 'cjenovnik' || s?.erpVeza === 'katalog' ? s.erpVeza : undefined,
            materijal: str(s?.materijal) || undefined,
            debljina: optNum(s?.debljina),
            povrsinaPloce: optNum(s?.povrsinaPloce),
            dobavljac: str(s?.dobavljac) || undefined,
            jm: str(s?.jm) || 'kom',
            kolicina: num(s?.kolicina),
            cijena: num(s?.cijena),
            napomena: str(s?.napomena) || undefined,
        })).filter((s: SuLine) => s.naziv || s.erp);
        return {
            kljuc,
            naziv: str(p?.naziv) || kljuc,
            kolicina: Math.max(1, Math.round(num(p?.kolicina)) || 1),
            sirina: optNum(p?.sirina),
            visina: optNum(p?.visina),
            dubina: optNum(p?.dubina),
            stavke,
            ponuda: p?.ponuda && typeof p.ponuda === 'object' ? p.ponuda : undefined,
        };
    });

    return {
        data: {
            format: SU_EXPORT_FORMAT,
            verzija: num(raw.verzija) || 1,
            datum: str(raw.datum) || undefined,
            model: str(raw.model) || undefined,
            komponenta: str(raw.komponenta) || undefined,
            cjenovnik: str(raw.cjenovnik) || undefined,
            klijent: str(raw.klijent) || undefined,
            proizvodi,
        },
    };
}

// ─── prepoznavanje — zajednički modul lib/sketchup/match.ts ──────────
// Isti algoritam radi i u pluginu (Component Manager), pa ponuda i uvoz
// isti naziv vežu za isti materijal.

export { normName };
export type MatchHow = 'id' | 'naziv' | 'sifra' | 'slicno' | 'novi';

const HINT_KIND: Record<SuLineKind, MatchKind | null> = {
    ploca: 'ploca', obloga: 'ploca', kant: 'kant', okov: 'okov', obrada: 'obrada', usluga: null, ostalo: null,
};

export function lineHint(l: Pick<SuLine, 'vrsta' | 'debljina'>): MatchHint {
    return {
        kind: HINT_KIND[l.vrsta],
        thickness: l.vrsta === 'ploca' || l.vrsta === 'kant' ? (l.debljina ?? null) : null,
    };
}

type CatEntry = CatalogItem & { m: Material };
type Described = { item: CatEntry; desc: MatchDesc }[];

function describeMaterials(catalog: Material[]): Described {
    return describeCatalog(catalog.map(m => ({ id: m.Material_ID, naziv: m.Name, kategorija: m.Category, jm: m.Unit, m })));
}

/** Najbolji pogodak za stavku: ERP naziv, pa SketchUp materijal (ploče i kant), pa naziv iz ponude. */
function matchLine(l: SuLine, described: Described): MatchResult<CatEntry> {
    const texts = [l.erp, (l.vrsta === 'ploca' || l.vrsta === 'kant') ? l.materijal : undefined, l.naziv]
        .filter((t): t is string => !!t && !!t.trim());
    let best: MatchResult<CatEntry> | null = null;
    for (const t of Array.from(new Set(texts))) {
        const r = matchDescribed(describe(t, lineHint(l)), described);
        if (!best || (r.auto && !best.auto) || (r.auto === best.auto && (r.best?.score ?? 0) > (best.best?.score ?? 0))) best = r;
    }
    return best || { best: null, auto: false, how: null, ranked: [] };
}

// ─── konvencije baze za NOVE materijale ──────────────────────────────
// Novi materijal mora izgledati kao postojeći: ista kategorija, ista
// jedinica kao srodni materijali u katalogu (ploče „Kom", kant „m",
// okov „Kom", furnir i obrada „m2") i naziv u obliku „Vrsta / Dekor".

const FALLBACK_UNIT: Record<SuLineKind, string> = {
    ploca: 'Kom', kant: 'm', okov: 'Kom', obloga: 'm2', obrada: 'm2', usluga: 'Kom', ostalo: 'Kom',
};

export const CATEGORY_FOR_KIND: Record<SuLineKind, string> = {
    ploca: 'Ploče i trake',
    obloga: 'Ploče i trake',
    kant: 'Ploče i trake',
    okov: 'Okovi',
    obrada: 'Ostalo',
    ostalo: 'Ostalo',
    usluga: 'Ostalo',
};

/** Najčešća jedinica srodnih materijala (ista vrsta i vrsta ploče). */
export function conventionalUnit(l: SuLine, described: Described): string {
    const q = describe(l.erp || l.naziv, lineHint(l));
    const peers = described.filter(({ desc }) =>
        desc.kind === q.kind && (q.kind !== 'ploca' || !q.types.length || q.types.some(t => desc.types.includes(t))) && desc.radna === q.radna);
    const count = new Map<string, number>();
    for (const { item } of peers) {
        const u = (item.jm || '').trim();
        if (u) count.set(u, (count.get(u) || 0) + 1);
    }
    let best = '', n = 0;
    count.forEach((c, u) => { if (c > n) { best = u; n = c; } });
    return best || FALLBACK_UNIT[l.vrsta];
}

const cleanName = (s: string) => s
    .replace(/\s*·\s*\d+(?:[.,]\d+)?\s*mm\s*$/i, '')       // „… · 18 mm" iz ponude
    .replace(/\s*·\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Naziv novog materijala kad cjenovnik nema kolonu ERP materijal. */
export function conventionalName(l: SuLine): string {
    if (l.erp) return l.erp.trim();
    const base = cleanName(l.vrsta === 'ploca' || l.vrsta === 'kant' ? (l.materijal || l.naziv) : l.naziv);
    if (l.vrsta === 'ploca') {
        if (base.includes('/') || /^(mdf|osb|hdf)\s+\d/i.test(base)) return base;
        const d = describe(base, { kind: 'ploca' });
        const decor = base.replace(/\b(egger|kronospan|iveral|iverica)\b/gi, '').replace(/\s+/g, ' ').trim();
        const th = l.debljina && Math.abs(l.debljina - 18) > 0.6 && !/\d\s*mm/i.test(decor) ? ` ${Math.round(l.debljina)}mm` : '';
        return d.types.length && !d.types.includes('iveral') ? base : `Iveral / ${decor || base}${th}`;
    }
    if (l.vrsta === 'kant') {
        if (/^kt\b/i.test(base)) return base;
        const decor = base.replace(/\b(kant\s*traka|kant|traka|egger|iveral)\b/gi, '').replace(/^[\s–-]+/, '').replace(/\s+/g, ' ').trim();
        return `KT / ${decor || base}`;
    }
    return base;
}

// ─── jedinice ────────────────────────────────────────────────────────

type UnitClass = 'area' | 'length' | 'count';
function unitClass(u: string): UnitClass {
    const n = normName(u);
    if (/^m(2|²)$|^m\^2$/.test(n.replace(/\s/g, ''))) return 'area';
    if (n === 'm' || n === 'dm' || n === 'm1') return 'length';
    return 'count';
}

/** Preračun stavke u jedinicu kataloškog materijala; iznos ostaje isti. */
export function convertToUnit(line: Pick<SuLine, 'jm' | 'kolicina' | 'cijena' | 'povrsinaPloce'>, targetUnit: string):
    { unit: string; quantity: number; unitPrice: number; converted: boolean; compatible: boolean } {
    const total = line.kolicina * line.cijena;
    const from = unitClass(line.jm);
    const to = unitClass(targetUnit);
    const isBoard = /^plo[cč]a$/i.test(line.jm.trim());
    if (from === to) {
        return { unit: targetUnit, quantity: line.kolicina, unitPrice: line.cijena, converted: false, compatible: true };
    }
    if (isBoard && to === 'area' && line.povrsinaPloce) {
        const q = line.kolicina * line.povrsinaPloce;
        return { unit: targetUnit, quantity: q, unitPrice: q ? total / q : line.cijena, converted: true, compatible: true };
    }
    // m² → ploča/komad (HPL se kupuje po ploči 2800 × 1310)
    if (from === 'area' && to === 'count' && line.povrsinaPloce) {
        const q = line.kolicina / line.povrsinaPloce;
        return { unit: targetUnit, quantity: q, unitPrice: q ? total / q : line.cijena, converted: true, compatible: true };
    }
    return { unit: line.jm, quantity: line.kolicina, unitPrice: line.cijena, converted: false, compatible: false };
}

// ─── dobavljači ──────────────────────────────────────────────────────

/** „Okov (srednji)", „ručno", „#N/A" — cijena nije od stvarnog dobavljača. */
export function isRealSupplier(name?: string): boolean {
    const n = normName(name || '');
    if (!n || n === '#n/a' || n === 'n/a') return false;
    if (/^rucno|^okov\b|^procjena/.test(n)) return false;
    return true;
}

// ─── plan ────────────────────────────────────────────────────────────

export interface PlannedMaterial {
    key: string;
    vrsta: SuLineKind;
    /** Naziv novog materijala, ako se pravi. */
    name: string;
    category: string;
    unit: string;
    supplier: string;
    unitPrice: number;
    match: Material | null;
    how: MatchHow;
    candidates: Material[];
    /** Novi materijal kojem katalog ima vjerovatan par — pokaži ga prije nego što se napravi duplikat. */
    suggestion: Material | null;
    /** Bodovi prepoznavanja najboljeg kandidata (0 kad nema). */
    score: number;
    lines: number;
    /** Nazivi iz ponude koji vode na ovaj materijal (za prikaz). */
    sources: string[];
}

export interface PlannedLine {
    materialKey: string;
    offerName: string;
    /** Iz ponude: ukupno za poziciju, u jedinici ponude. */
    srcQuantity: number;
    srcUnit: string;
    srcPrice: number;
    povrsinaPloce?: number;
    supplier: string;
    napomena?: string;
}

export interface PlannedProduct {
    key: string;
    name: string;
    quantity: number;
    width: number;
    height: number;
    depth: number;
    lines: PlannedLine[];
    /** Isti naziv već postoji u projektu. */
    existing: Product | null;
    /** Stavke postojećeg proizvoda iz ranijeg uvoza / dodane ručno. */
    existingImported: number;
    existingManual: number;
    /**
     * Zamjena je sigurna: ranije uvezene stavke nisu naručene ni primljene.
     * Zamjena briše SAMO ranije uvezene stavke — ručno dodane (staklo, alu
     * vrata, dopune) ostaju.
     */
    canReplace: boolean;
    offer?: SuProduct['ponuda'];
}

export interface ImportPlan {
    source: SuExport;
    products: PlannedProduct[];
    materials: PlannedMaterial[];
    skippedServices: number;
    skippedEmpty: number;
}

function lineKey(l: SuLine, catalogById: Map<string, Material>): string {
    if (l.erpId && catalogById.has(l.erpId)) return `id:${l.erpId}`;
    if (l.erp) return `erp:${looseKey(l.erp)}`;
    const src = l.vrsta === 'ploca' || l.vrsta === 'kant' ? (l.materijal || l.naziv) : l.naziv;
    return `${l.vrsta}:${looseKey(src)}${l.debljina ? `|${l.debljina}` : ''}`;
}

const unordered = (m: ProductMaterial) => !m.Order_ID && (!m.Status || m.Status === 'Nije naručeno');
const importedOf = (p: Product) => (p.materials || []).filter(m => m.Import_Source === 'sketchup');

export function buildImportPlan(exp: SuExport, catalog: Material[], suppliers: Supplier[], projectProducts: Product[] = []): ImportPlan {
    const byId = new Map(catalog.map(m => [m.Material_ID, m] as const));
    const byName = new Map<string, Material>();
    for (const m of catalog) {
        const k = looseKey(m.Name);
        if (k && !byName.has(k)) byName.set(k, m);
    }
    const described = describeMaterials(catalog);
    const existingByName = new Map<string, Product>();
    for (const p of projectProducts) existingByName.set(normName(p.Name), p);

    const materials = new Map<string, PlannedMaterial>();
    let skippedServices = 0;
    let skippedEmpty = 0;

    const products: PlannedProduct[] = exp.proizvodi.map(p => {
        const lines: PlannedLine[] = [];
        for (const l of p.stavke) {
            if (l.vrsta === 'usluga') { skippedServices++; continue; }
            if (!(l.kolicina > 0)) { skippedEmpty++; continue; }
            const key = lineKey(l, byId);
            let pm = materials.get(key);
            if (!pm) {
                let match: Material | null = null;
                let how: MatchHow = 'novi';
                if (l.erpId && byId.has(l.erpId)) {
                    match = byId.get(l.erpId)!; how = 'id';
                } else if (l.erp && byName.has(looseKey(l.erp))) {
                    match = byName.get(looseKey(l.erp))!; how = 'naziv';
                }
                const r = matchLine(l, described);
                // Naziv iz kolone „ERP materijal" kojeg nema u katalogu je namjera da
                // se napravi baš taj materijal — prepoznavanje ga samo predlaže. Naziv
                // koji je plugin sam prepoznao (veza „katalog") ne blokira ništa.
                const explicitErp = !!l.erp && l.erpVeza !== 'katalog';
                if (!match && !explicitErp && r.auto && r.best) {
                    match = r.best.item.m;
                    how = r.how === 'sifra' ? 'sifra' : r.how === 'naziv' ? 'naziv' : 'slicno';
                }
                let candidates = r.ranked.map(x => x.item.m);
                if (match && !candidates.some(c => c.Material_ID === match!.Material_ID)) candidates = [match, ...candidates];
                const suggestion = !match && r.best && r.best.score >= SUGGEST_SCORE ? r.best.item.m : null;
                const unit = conventionalUnit(l, described);
                pm = {
                    key, vrsta: l.vrsta,
                    name: conventionalName(l),
                    category: CATEGORY_FOR_KIND[l.vrsta],
                    unit,
                    supplier: isRealSupplier(l.dobavljac) ? l.dobavljac! : '',
                    // kataloška cijena novog materijala u njegovoj jedinici (ploča → Kom, HPL m² → Kom)
                    unitPrice: round4(convertToUnit(l, unit).unitPrice),
                    match, how, candidates, suggestion, score: r.best?.score ?? 0, lines: 0, sources: [],
                };
                materials.set(key, pm);
            }
            pm.lines++;
            if (!pm.supplier && isRealSupplier(l.dobavljac)) pm.supplier = l.dobavljac!;
            if (!pm.sources.includes(l.naziv)) pm.sources.push(l.naziv);
            lines.push({
                materialKey: key,
                offerName: l.naziv,
                srcQuantity: l.kolicina,
                srcUnit: l.jm,
                srcPrice: l.cijena,
                povrsinaPloce: l.povrsinaPloce,
                supplier: isRealSupplier(l.dobavljac) ? l.dobavljac! : '',
                napomena: l.napomena,
            });
        }
        const existing = existingByName.get(normName(p.naziv)) || null;
        return {
            key: p.kljuc,
            name: p.naziv,
            quantity: p.kolicina,
            width: Math.round(p.sirina || 0),
            height: Math.round(p.visina || 0),
            depth: Math.round(p.dubina || 0),
            lines,
            existing,
            existingImported: existing ? importedOf(existing).length : 0,
            existingManual: existing ? (existing.materials || []).length - importedOf(existing).length : 0,
            canReplace: existing ? importedOf(existing).every(unordered) : false,
            offer: p.ponuda,
        };
    });

    return {
        source: exp,
        products,
        materials: Array.from(materials.values()),
        skippedServices,
        skippedEmpty,
    };
}

// ─── izbori korisnika i rezolucija ───────────────────────────────────

export type ProductAction = 'new' | 'skip' | 'replace';

export interface ImportChoices {
    /** key materijala → Material_ID postojećeg ili 'new'. */
    materials: Record<string, string>;
    products: Record<string, ProductAction>;
}

export function defaultChoices(plan: ImportPlan): ImportChoices {
    const materials: Record<string, string> = {};
    for (const m of plan.materials) materials[m.key] = m.match ? m.match.Material_ID : 'new';
    const products: Record<string, ProductAction> = {};
    for (const p of plan.products) {
        // Postojeći proizvod se dopunjava kad je prazan ili kad mu je sastavnica
        // već iz SketchUpa; ručno razrađen se ne dira bez izričitog izbora.
        products[p.key] = !p.existing ? 'new'
            : p.canReplace && (p.existingImported > 0 || p.existingManual === 0) ? 'replace' : 'skip';
    }
    return { materials, products };
}

export interface ResolvedLine {
    materialKey: string;
    materialId: string | null;   // null = novi (ID poslije kreiranja)
    materialName: string;
    unit: string;
    /** Po komadu proizvoda. */
    quantity: number;
    unitPrice: number;
    supplier: string;
    unitMismatch: boolean;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stavke proizvoda u ERP obliku za date izbore; iste stavke se sabiraju. */
export function resolveProductLines(product: PlannedProduct, plan: ImportPlan, choices: ImportChoices, catalog: Material[]): ResolvedLine[] {
    const byId = new Map(catalog.map(m => [m.Material_ID, m] as const));
    const pmByKey = new Map(plan.materials.map(m => [m.key, m] as const));
    const out: ResolvedLine[] = [];
    for (const l of product.lines) {
        const pm = pmByKey.get(l.materialKey);
        if (!pm) continue;
        const choice = choices.materials[l.materialKey] || 'new';
        const existing = choice !== 'new' ? byId.get(choice) || null : null;
        const unit = existing ? existing.Unit || pm.unit : pm.unit;
        const conv = convertToUnit({ jm: l.srcUnit, kolicina: l.srcQuantity, cijena: l.srcPrice, povrsinaPloce: l.povrsinaPloce }, unit);
        const compatible = conv.compatible;
        const qtyTotal = compatible ? conv.quantity : l.srcQuantity;
        const price = compatible ? conv.unitPrice : l.srcPrice;
        const quantity = round3(qtyTotal / Math.max(1, product.quantity));
        const supplier = l.supplier || (existing ? (isRealSupplier(existing.Default_Supplier) ? existing.Default_Supplier : '') : pm.supplier);
        const line: ResolvedLine = {
            materialKey: l.materialKey,
            materialId: existing ? existing.Material_ID : null,
            materialName: existing ? existing.Name : pm.name,
            unit: compatible ? unit : l.srcUnit,
            quantity,
            unitPrice: round4(price),
            supplier,
            unitMismatch: !compatible,
        };
        const same = out.find(o => o.materialKey === line.materialKey && o.unit === line.unit
            && o.supplier === line.supplier && Math.abs(o.unitPrice - line.unitPrice) < 0.0001);
        if (same) same.quantity = round3(same.quantity + line.quantity);
        else out.push(line);
    }
    return out;
}

/** Dobavljači koje treba napraviti za date izbore (stavke + novi materijali). */
export function suppliersToCreate(plan: ImportPlan, choices: ImportChoices, catalog: Material[], suppliers: Supplier[]): string[] {
    const have = new Set(suppliers.map(s => normName(s.Name)));
    const need = new Map<string, string>();
    const add = (name: string) => {
        if (!isRealSupplier(name)) return;
        const k = normName(name);
        if (!have.has(k) && !need.has(k)) need.set(k, name.trim());
    };
    const used = new Set<string>();
    for (const p of plan.products) {
        if (choices.products[p.key] === 'skip') continue;
        for (const l of resolveProductLines(p, plan, choices, catalog)) {
            add(l.supplier);
            used.add(l.materialKey);
        }
    }
    for (const m of plan.materials) if (used.has(m.key) && (choices.materials[m.key] || 'new') === 'new') add(m.supplier);
    return Array.from(need.values());
}

export interface PlanSummary {
    products: number;
    productsNew: number;
    productsReplace: number;
    productsSkip: number;
    lines: number;
    materialsLinked: number;
    materialsNew: number;
    suppliersNew: string[];
    unitMismatches: number;
    /** Po komadu × komada, svih proizvoda koji se uvoze. */
    materialTotal: number;
}

export function summarizePlan(plan: ImportPlan, choices: ImportChoices, catalog: Material[], suppliers: Supplier[]): PlanSummary {
    let lines = 0, unitMismatches = 0, materialTotal = 0;
    let productsNew = 0, productsReplace = 0, productsSkip = 0;
    const usedKeys = new Set<string>();
    for (const p of plan.products) {
        const a = choices.products[p.key] || 'new';
        if (a === 'skip') { productsSkip++; continue; }
        if (a === 'replace') productsReplace++; else productsNew++;
        for (const l of resolveProductLines(p, plan, choices, catalog)) {
            lines++;
            usedKeys.add(l.materialKey);
            if (l.unitMismatch) unitMismatches++;
            materialTotal += l.quantity * l.unitPrice * p.quantity;
        }
    }
    let materialsLinked = 0, materialsNew = 0;
    for (const m of plan.materials) {
        if (!usedKeys.has(m.key)) continue;
        if ((choices.materials[m.key] || 'new') === 'new') materialsNew++; else materialsLinked++;
    }
    return {
        products: plan.products.length, productsNew, productsReplace, productsSkip,
        lines, materialsLinked, materialsNew,
        suppliersNew: suppliersToCreate(plan, choices, catalog, suppliers),
        unitMismatches, materialTotal: round2(materialTotal),
    };
}

// ─── izvršenje ───────────────────────────────────────────────────────

type SaveResult<K extends string> = { success: boolean; data?: Record<K, string>; message: string };

export interface ImportDeps {
    saveSupplier: (data: Partial<Supplier>) => Promise<SaveResult<'Supplier_ID'>>;
    saveMaterial: (data: Partial<Material>) => Promise<SaveResult<'Material_ID'>>;
    saveProduct: (data: Partial<Product>) => Promise<SaveResult<'Product_ID'>>;
    /** Upiše sve stavke odjednom, pa jednom preračuna trošak proizvoda. */
    addProductMaterials: (productId: string, items: Partial<ProductMaterial>[]) => Promise<{ success: boolean; message: string }>;
    /** Obriše ranije uvezene (Import_Source = 'sketchup'), nenaručene stavke proizvoda. */
    deleteImportedProductMaterials: (productId: string) => Promise<void>;
}

export interface ImportResult {
    suppliersCreated: number;
    materialsCreated: number;
    productsCreated: number;
    productsReplaced: number;
    linesWritten: number;
    errors: string[];
}

export async function runImport(
    plan: ImportPlan,
    choices: ImportChoices,
    ctx: { projectId: string; catalog: Material[]; suppliers: Supplier[]; note?: string },
    deps: ImportDeps,
    onProgress?: (step: string, done: number, total: number) => void,
): Promise<ImportResult> {
    const res: ImportResult = { suppliersCreated: 0, materialsCreated: 0, productsCreated: 0, productsReplaced: 0, linesWritten: 0, errors: [] };
    const active = plan.products.filter(p => (choices.products[p.key] || 'new') !== 'skip');

    // 1) dobavljači
    const newSuppliers = suppliersToCreate(plan, choices, ctx.catalog, ctx.suppliers);
    for (let i = 0; i < newSuppliers.length; i++) {
        onProgress?.('Dobavljači', i, newSuppliers.length);
        const r = await deps.saveSupplier({ Name: newSuppliers[i], Contact_Person: '', Phone: '', Email: '', Address: '', Categories: '' });
        if (r.success) res.suppliersCreated++;
        else res.errors.push(`Dobavljač „${newSuppliers[i]}": ${r.message}`);
    }

    // 2) materijali — samo oni koje aktivni proizvodi stvarno koriste
    const used = new Set<string>();
    for (const p of active) for (const l of p.lines) used.add(l.materialKey);
    const created = new Map<string, string>(); // key → Material_ID
    const toCreate = plan.materials.filter(m => used.has(m.key) && (choices.materials[m.key] || 'new') === 'new');
    for (let i = 0; i < toCreate.length; i++) {
        const m = toCreate[i];
        onProgress?.('Materijali', i, toCreate.length);
        const r = await deps.saveMaterial({
            Name: m.name,
            Category: m.category,
            Unit: m.unit,
            Default_Supplier: m.supplier,
            Default_Unit_Price: m.unitPrice,
            Description: 'Iz SketchUp ponude',
        });
        if (r.success && r.data?.Material_ID) { created.set(m.key, r.data.Material_ID); res.materialsCreated++; }
        else res.errors.push(`Materijal „${m.name}": ${r.message}`);
    }

    // 3) proizvodi + 4) sastavnice
    for (let i = 0; i < active.length; i++) {
        const p = active[i];
        onProgress?.('Proizvodi', i, active.length);
        const action = choices.products[p.key] || 'new';
        let productId: string | undefined;
        if (action === 'replace' && p.existing && p.canReplace) {
            productId = p.existing.Product_ID;
            const r = await deps.saveProduct({
                Product_ID: productId, Width: p.width, Height: p.height, Depth: p.depth, Quantity: p.quantity,
            });
            if (!r.success) { res.errors.push(`Proizvod „${p.name}": ${r.message}`); continue; }
            await deps.deleteImportedProductMaterials(productId);
            res.productsReplaced++;
        } else {
            const r = await deps.saveProduct({
                Project_ID: ctx.projectId,
                Name: p.name,
                Width: p.width,
                Height: p.height,
                Depth: p.depth,
                Quantity: p.quantity,
                Notes: ctx.note || '',
                Status: 'Na čekanju',
            });
            if (!r.success || !r.data?.Product_ID) { res.errors.push(`Proizvod „${p.name}": ${r.message}`); continue; }
            productId = r.data.Product_ID;
            res.productsCreated++;
        }

        const items: Partial<ProductMaterial>[] = [];
        for (const l of resolveProductLines(p, plan, choices, ctx.catalog)) {
            const materialId = l.materialId || created.get(l.materialKey);
            if (!materialId) continue;   // materijal nije napravljen — greška je već upisana
            items.push({
                Product_ID: productId,
                Material_ID: materialId,
                Material_Name: l.materialName,
                Quantity: l.quantity,
                Unit: l.unit,
                Unit_Price: l.unitPrice,
                Supplier: l.supplier,
                Status: 'Nije naručeno',
                Order_ID: '',
                Import_Source: 'sketchup',
            });
        }
        if (items.length) {
            const r = await deps.addProductMaterials(productId, items);
            if (r.success) res.linesWritten += items.length;
            else res.errors.push(`Materijali za „${p.name}": ${r.message}`);
        }
    }
    onProgress?.('Gotovo', 1, 1);
    return res;
}

// ─── katalog za plugin ───────────────────────────────────────────────

export interface ErpCatalogExport {
    format: typeof ERP_CATALOG_FORMAT;
    verzija: 1;
    datum: string;
    organizacija?: string;
    materijali: { id: string; naziv: string; kategorija: string; jm: string; cijena: number; dobavljac: string }[];
    dobavljaci: string[];
}

export function buildErpCatalog(materials: Material[], suppliers: Supplier[], organizacija?: string, now = new Date()): ErpCatalogExport {
    return {
        format: ERP_CATALOG_FORMAT,
        verzija: 1,
        datum: now.toISOString(),
        organizacija,
        materijali: materials
            .filter(m => m.Material_ID && (m.Name || '').trim())
            .map(m => ({
                id: m.Material_ID,
                naziv: m.Name.trim(),
                kategorija: m.Category || '',
                jm: m.Unit || '',
                cijena: Number(m.Default_Unit_Price) || 0,
                dobavljac: isRealSupplier(m.Default_Supplier) ? m.Default_Supplier.trim() : '',
            }))
            .sort((a, b) => a.kategorija.localeCompare(b.kategorija, 'bs') || a.naziv.localeCompare(b.naziv, 'bs')),
        dobavljaci: suppliers.map(s => (s.Name || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'bs')),
    };
}
