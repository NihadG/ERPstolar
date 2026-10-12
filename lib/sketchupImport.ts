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

type UnitClass = 'area' | 'volume' | 'length' | 'count';
function unitClass(u: string): UnitClass {
    const n = normName(u);
    if (/^m(2|²)$|^m\^2$/.test(n.replace(/\s/g, ''))) return 'area';
    // masivno drvo se vodi po m³ — nije „komad", pa se ne veže za materijal u Kom
    if (/^m(3|³)$|^m\^3$/.test(n.replace(/\s/g, ''))) return 'volume';
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

/** „Okov (srednji)", „ručno", „Ostali", „#N/A" — cijena nije od stvarnog dobavljača. */
export function isRealSupplier(name?: string): boolean {
    const n = normName(name || '');
    if (!n || n === '#n/a' || n === 'n/a') return false;
    if (/^rucno|^okov\b|^procjena|^ostali$/.test(n)) return false;
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
    /** Isti SketchUp materijal i debljina (ploča / kant / obloga) — za usklađenost unutar uvoza. */
    ident: string;
    /** Materijal koji projekt već koristi za ovu stavku (vidi consistencyIssues). */
    project: { material: Material; how: 'ranije' | 'projekt'; usedIn: string[] } | null;
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
    /** Proizvodi projekta — cilj dopune / zamjene (ne mora imati isti naziv). */
    projectProducts: Product[];
}

function lineKey(l: SuLine, catalogById: Map<string, Material>): string {
    if (l.erpId && catalogById.has(l.erpId)) return `id:${l.erpId}`;
    if (l.erp) return `erp:${looseKey(l.erp)}`;
    const src = l.vrsta === 'ploca' || l.vrsta === 'kant' ? (l.materijal || l.naziv) : l.naziv;
    return `${l.vrsta}:${looseKey(src)}${l.debljina ? `|${l.debljina}` : ''}`;
}

const unordered = (m: ProductMaterial) => !m.Order_ID && (!m.Status || m.Status === 'Nije naručeno');
const importedOf = (p: Product) => (p.materials || []).filter(m => m.Import_Source === 'sketchup');

/**
 * Stavka sastavnice koja se pri zamjeni NE smije brisati: naručena / poslana /
 * primljena, u narudžbi ili uzeta sa stanja. Isto pravilo koristi brisanje u
 * bazi (deleteReplaceableProductMaterials).
 */
export function isLockedMaterial(m: Pick<ProductMaterial, 'Order_ID' | 'Status' | 'On_Stock' | 'Ordered_Quantity'>): boolean {
    return !!m.Order_ID || (!!m.Status && m.Status !== 'Nije naručeno') || (m.On_Stock || 0) > 0 || (m.Ordered_Quantity || 0) > 0;
}

/** Stanje postojećeg proizvoda za izbor dopune / zamjene. */
export function existingInfo(p: Product): { imported: number; manual: number; locked: ProductMaterial[]; canReplace: boolean } {
    const all = p.materials || [];
    const imp = importedOf(p);
    return { imported: imp.length, manual: all.length - imp.length, locked: all.filter(isLockedMaterial), canReplace: imp.every(unordered) };
}

/** Proizvod projekta u koji ide uvoz: ručni izbor, pa proizvod istog naziva. */
export function targetOf(p: PlannedProduct, plan: ImportPlan, choices: ImportChoices): Product | null {
    const id = choices.targets?.[p.key];
    if (id) return (plan.projectProducts || []).find(x => x.Product_ID === id) || null;
    return p.existing;
}

/** Šta projekt već koristi: materijal → proizvodi, i ključ ranijeg uvoza → materijal. */
function projectUse(projectProducts: Product[], byId: Map<string, Material>) {
    const usedIn = new Map<string, string[]>();
    const byKey = new Map<string, Map<string, number>>();
    for (const p of projectProducts) {
        for (const m of p.materials || []) {
            if (!m.Material_ID || !byId.has(m.Material_ID)) continue;
            const names = usedIn.get(m.Material_ID) || [];
            if (!names.includes(p.Name)) names.push(p.Name);
            usedIn.set(m.Material_ID, names);
            if (m.Import_Key) {
                const c = byKey.get(m.Import_Key) || new Map<string, number>();
                c.set(m.Material_ID, (c.get(m.Material_ID) || 0) + 1);
                byKey.set(m.Import_Key, c);
            }
        }
    }
    const described = describeMaterials(Array.from(usedIn.keys()).map(id => byId.get(id)!));
    return { usedIn, byKey, described };
}

/** Identitet stavke iz modela: isti SketchUp materijal i debljina = ista stvar. */
function lineIdent(l: SuLine): string {
    if (!(l.vrsta === 'ploca' || l.vrsta === 'kant' || l.vrsta === 'obloga') || !l.materijal) return '';
    return `${l.vrsta}|${looseKey(l.materijal)}|${l.debljina ?? ''}`;
}

export function buildImportPlan(exp: SuExport, catalog: Material[], suppliers: Supplier[], projectProducts: Product[] = []): ImportPlan {
    const byId = new Map(catalog.map(m => [m.Material_ID, m] as const));
    const use = projectUse(projectProducts, byId);
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
                // Projekt već ima ovu stavku: isti ključ iz ranijeg uvoza, ili materijal
                // projekta koji prepoznavanje drži za istu stvar (isti dekor, isti okov).
                let project: PlannedMaterial['project'] = null;
                const earlier = use.byKey.get(key);
                if (earlier && earlier.size) {
                    let id = '', n = 0;
                    earlier.forEach((c, k) => { if (c > n) { id = k; n = c; } });
                    project = { material: byId.get(id)!, how: 'ranije', usedIn: use.usedIn.get(id) || [] };
                } else if (!(match && use.usedIn.has(match.Material_ID)) && use.described.length) {
                    const pr = matchLine(l, use.described);
                    if (pr.best && (pr.auto || pr.best.score >= SUGGEST_SCORE)) {
                        const pmat = pr.best.item.m;
                        project = { material: pmat, how: 'projekt', usedIn: use.usedIn.get(pmat.Material_ID) || [] };
                    }
                }
                pm = {
                    key, vrsta: l.vrsta,
                    name: conventionalName(l),
                    category: CATEGORY_FOR_KIND[l.vrsta],
                    unit,
                    supplier: isRealSupplier(l.dobavljac) ? l.dobavljac! : '',
                    // kataloška cijena novog materijala u njegovoj jedinici (ploča → Kom, HPL m² → Kom)
                    unitPrice: round4(convertToUnit(l, unit).unitPrice),
                    match, how, candidates, suggestion, score: r.best?.score ?? 0, lines: 0, sources: [],
                    ident: lineIdent(l), project,
                };
                if (project && !candidates.some(c => c.Material_ID === project!.material.Material_ID)) {
                    pm.candidates = [...candidates, project.material];
                }
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
        projectProducts,
    };
}

// ─── izbori korisnika i rezolucija ───────────────────────────────────

/**
 * new        — novi proizvod u projektu
 * replace    — u postojeći: obriši ranije UVEZENE stavke, ručne ostaju (dopuna)
 * replaceAll — u postojeći: obriši SAV nenaručeni materijal i upiši uvezeni;
 *              naručeno / primljeno / sa stanja ostaje, a uvezena količina istog
 *              materijala se umanji za to (bez dupliranja)
 * skip       — preskoči
 */
export type ProductAction = 'new' | 'skip' | 'replace' | 'replaceAll';

export interface ImportChoices {
    /** key materijala → Material_ID postojećeg ili 'new'. */
    materials: Record<string, string>;
    products: Record<string, ProductAction>;
    /** key proizvoda → Product_ID postojećeg proizvoda u koji ide uvoz (dopuna / zamjena). */
    targets?: Record<string, string>;
    /** key materijala → 'keep': odstupanje od projekta je potvrđeno (ostaje prijedlog). */
    consistency?: Record<string, 'keep'>;
}

// ─── usklađenost s projektom ─────────────────────────────────────────
// Ista stvar u projektu mora biti isti materijal: ako uvoz za stavku
// predlaže drugo od onoga što projekt već koristi (ranije uvezeno, isti
// dekor / okov u drugom proizvodu) ili od iste stavke u drugom proizvodu
// ovog uvoza, korisnik bira — isto kao u projektu ili ostaje prijedlog.

export interface ConsistencyIssue {
    key: string;
    /** S čim treba biti isto. */
    target: Material;
    /** ranije = isti naziv iz ranijeg uvoza; projekt = isti artikl u projektu; uvoz = ista stavka u drugom proizvodu uvoza. */
    reason: 'ranije' | 'projekt' | 'uvoz';
    /** Proizvodi gdje se target već koristi. */
    usedIn: string[];
}

export function consistencyIssues(plan: ImportPlan, choices: ImportChoices, catalog: Material[]): ConsistencyIssue[] {
    const byId = new Map(catalog.map(m => [m.Material_ID, m] as const));
    const choiceOf = (k: string) => choices.materials[k] || 'new';
    // samo materijali proizvoda koji se uvoze
    const active = new Map<string, Set<string>>();
    for (const p of plan.products) {
        if ((choices.products[p.key] || 'new') === 'skip') continue;
        for (const l of p.lines) {
            const s = active.get(l.materialKey) || new Set<string>();
            s.add(p.name);
            active.set(l.materialKey, s);
        }
    }
    const mats = plan.materials.filter(m => active.has(m.key));
    const out: ConsistencyIssue[] = [];
    for (const m of mats) {
        if (choices.consistency?.[m.key] === 'keep') continue;
        const t = m.project;
        if (t) {
            if (choiceOf(m.key) !== t.material.Material_ID && byId.has(t.material.Material_ID)) {
                out.push({ key: m.key, target: t.material, reason: t.how, usedIn: t.usedIn });
            }
            continue;
        }
        if (!m.ident) continue;
        // Ista stavka u više proizvoda ovog uvoza (npr. drugi naziv kod drugog
        // dobavljača): većina odlučuje, ostali se pitaju.
        const peers = mats.filter(x => x.ident === m.ident);
        const votes = new Map<string, number>();
        for (const x of peers) {
            const c = choiceOf(x.key);
            if (c !== 'new') votes.set(c, (votes.get(c) || 0) + x.lines);
        }
        let best = '', n = 0;
        votes.forEach((c, id) => { if (c > n) { best = id; n = c; } });
        if (best && best !== choiceOf(m.key) && byId.has(best)) {
            const names = new Set<string>();
            peers.filter(x => choiceOf(x.key) === best).forEach(x => active.get(x.key)!.forEach(nm => names.add(nm)));
            out.push({ key: m.key, target: byId.get(best)!, reason: 'uvoz', usedIn: Array.from(names) });
        }
    }
    return out;
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
    const targets: Record<string, string> = {};
    for (const p of plan.products) if (p.existing) targets[p.key] = p.existing.Product_ID;
    return { materials, products, targets };
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
    /** Zamjena svega: dio količine koji je već naručen / primljen (ostaje u sastavnici). */
    lockedQuantity?: number;
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
    // Zamjena svega: naručeno / primljeno ostaje u sastavnici, pa se uvezena
    // količina istog materijala (ista jedinica) umanji za to — zbir je kao u ponudi.
    const target = choices.products[product.key] === 'replaceAll' ? targetOf(product, plan, choices) : null;
    if (target) {
        const kept = new Map<string, number>();
        for (const m of (target.materials || []).filter(isLockedMaterial)) {
            const k = `${m.Material_ID}|${normName(m.Unit || '')}`;
            kept.set(k, (kept.get(k) || 0) + (m.Quantity || 0));
        }
        for (const l of out) {
            if (!l.materialId) continue;
            const k = `${l.materialId}|${normName(l.unit)}`;
            const have = kept.get(k) || 0;
            if (have <= 0) continue;
            const used = Math.min(have, l.quantity);
            l.lockedQuantity = round3(used);
            l.quantity = round3(l.quantity - used);
            kept.set(k, have - used);
        }
        return out.filter(l => l.quantity > 0.0005);
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
        if (a === 'replace' || a === 'replaceAll') productsReplace++; else productsNew++;
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
    /** Obriše SAV nenaručeni materijal proizvoda (i staklo / alu stavke uz njega). */
    deleteReplaceableProductMaterials?: (productId: string) => Promise<{ deleted: number; kept: number }>;
}

export interface ImportResult {
    suppliersCreated: number;
    materialsCreated: number;
    productsCreated: number;
    productsReplaced: number;
    linesWritten: number;
    /** Zamjena svega: stavke koje su ostale jer su naručene / primljene / sa stanja. */
    linesKept?: number;
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
        const target = action === 'replace' || action === 'replaceAll' ? targetOf(p, plan, choices) : null;
        if ((action === 'replace' || action === 'replaceAll') && !target) {
            res.errors.push(`Proizvod „${p.name}": nije izabran postojeći proizvod.`);
            continue;
        }
        if (target) {
            if (action === 'replace' && !existingInfo(target).canReplace) {
                res.errors.push(`Proizvod „${target.Name}": dio uvezene sastavnice je naručen — dopuna nije moguća.`);
                continue;
            }
            if (action === 'replaceAll' && !deps.deleteReplaceableProductMaterials) {
                res.errors.push(`Proizvod „${target.Name}": zamjena svega nije dostupna.`);
                continue;
            }
            productId = target.Product_ID;
            const r = await deps.saveProduct({
                Product_ID: productId, Width: p.width, Height: p.height, Depth: p.depth, Quantity: p.quantity,
            });
            if (!r.success) { res.errors.push(`Proizvod „${target.Name}": ${r.message}`); continue; }
            if (action === 'replaceAll') {
                const d = await deps.deleteReplaceableProductMaterials!(productId);
                res.linesKept = (res.linesKept || 0) + d.kept;
            } else {
                await deps.deleteImportedProductMaterials(productId);
            }
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
                Import_Key: l.materialKey,
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
