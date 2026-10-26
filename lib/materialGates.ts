// ════════════════════════════════════════════════════════════════════
// KAPIJE MATERIJALA — kad koji materijal mora biti tu (čista logika)
//
// Svaki materijal sastavnice se troši kod jednog procesa plana stavke:
// iveral kod krojenja iverala, okovi i stakla kod okivanja, lak kod
// lakiranja… Kapija = taj proces na nalogu, s materijalima svih proizvoda
// koji ga prolaze. ERP iz grafa naloga zna koliko je stavka daleko od
// kapije (koraka), pa bot pita u pravom trenutku:
//   • pri pokretanju naloga — šta je tu za prvu fazu (+ naruči ono s dugim rokom),
//   • najava — kapija je ≤ LOOKAHEAD koraka daleko,
//   • kapija — proces je počeo, a nešto nije stiglo.
//
// Zaliha (kupuje se na veliko: MDF, lesonit, kant traka, lak…) se ne naručuje
// po projektu; na kapiji je samo pitanje „imaš li?".
//
// Isti izračun koristi bot (lib/assistant/materialAlerts.ts) i ERP (nalog,
// narudžbe), pa prikaz i poruke ne mogu reći različito.
// jest: lib/__tests__/materialGates.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from './voice/text';
import { materialCoverage } from './materialCoverage';
import { materialTypeFromName, materialTypesFromName, nodeMatchesProcess } from './productProcesses';
import { STANDARD_CATALOG, canonicalProcessName } from './processStandard';
import { itemNodes } from './workDiary';
import type { ItemProcessStatus, ProcessGraph } from './types';

/** Najava stiže kad je kapija ovoliko koraka (procesa) daleko. */
export const LOOKAHEAD = 2;

// ─── Zaliha ───────────────────────────────────────────────────────────

/** Šta se kupuje na veliko: tipovi materijala (lib/productProcesses) i riječi naziva. */
export interface StockRules {
    types: string[];
    phrases: string[];
}

export const DEFAULT_STOCK_RULES: StockRules = {
    types: ['mdf', 'hdf', 'kant', 'lak', 'boja', 'ljepilo'],
    phrases: ['furnir hrast', 'vijak', 'vijci', 'tipl'],
};

export const STOCK_TYPE_LABELS: Record<string, string> = {
    mdf: 'MDF', hdf: 'HDF / lesonit', kant: 'Kant traka', lak: 'Lak', boja: 'Boja', ljepilo: 'Ljepilo',
    iveral: 'Iveral', furnir: 'Furnir (sav)', masiv: 'Masiv', jela: 'Jela / smreka', sper: 'Šperploča',
    osb: 'OSB', hpl: 'HPL', sarke: 'Šarke', vodilice: 'Vodilice', rucke: 'Ručke', okov: 'Okovi',
};

/** Polja kataloga materijala koja kapije čitaju. */
export interface GateCatalog {
    Category?: string;
    Is_Stock?: boolean | null;
    Need_By_Process?: string;
    Is_Glass?: boolean;
    Is_Alu_Door?: boolean;
}

/** Oznaka u katalogu ima prednost; inače tip ili riječ naziva iz pravila zalihe. */
export function isStockMaterial(name: string, catalog: GateCatalog | undefined, rules: StockRules): boolean {
    if (typeof catalog?.Is_Stock === 'boolean') return catalog.Is_Stock;
    const type = materialTypeFromName(name);
    if (type && rules.types.includes(type)) return true;
    const folded = ` ${foldText(name)} `;
    return rules.phrases.some(p => {
        const f = foldText(p).trim();
        return !!f && folded.includes(` ${f}`);
    });
}

// ─── Kod kojeg procesa se materijal troši ─────────────────────────────

const OKIVANJE = ['Okivanje', 'Završno sklapanje'];

/** Tip → procesi u kojima se troši (prvi koji stavka ima u planu). */
const NEED_BY: Record<string, string[]> = {
    masiv: ['Priprema masive', 'Izrada rešetke baze'],
    jela: ['Priprema masive', 'Izrada cokla', 'Izrada rešetke baze'],
    iveral: ['Krojenje iverala'],
    mdf: ['Krojenje MDF-a'],
    sper: ['Krojenje šperploče', 'Izrada zaobljenih dijelova'],
    oblikovna: ['Izrada zaobljenih dijelova', 'Krojenje šperploče'],
    osb: ['Krojenje OSB-a', 'Izrada podkonstrukcije'],
    hpl: ['Krojenje HPL-a', 'Presovanje HPL-a'],
    furnir: ['Priprema furnira', 'Furniranje'],
    kerrock: ['Krojenje Kerrocka'],
    corian: ['Krojenje Coriana'],
    kant: ['Kantiranje iverala', 'Kantiranje furnira'],
    hdf: ['Krojenje leđa', 'Postavljanje leđa', 'Sklapanje kutija'],
    lak: ['Lakiranje', 'Farbanje'],
    boja: ['Farbanje', 'Lakiranje'],
    vodilice: ['Izrada ladica', ...OKIVANJE],
    sarke: OKIVANJE, rucke: OKIVANJE, nogice: OKIVANJE, okov: OKIVANJE,
    staklo: OKIVANJE, ogledalo: OKIVANJE, alu: OKIVANJE, led: OKIVANJE,
};

/** Dug rok isporuke: naručuje se čim nalog krene, ne tek pred kapiju. */
const LONG_LEAD = new Set(['staklo', 'ogledalo', 'alu']);

export interface MaterialRole {
    type: string | null;
    /** Procesi u kojima se troši, redom prednosti; prazno = bez kapije (ljepilo, nepoznato). */
    candidates: string[];
    longLead: boolean;
}

export function materialRole(name: string, catalog?: GateCatalog): MaterialRole {
    const all = materialTypesFromName(name);
    let type = materialTypeFromName(name);
    // „Ogledalo" nosi i 'led' (og-led-alo) — ogledalo je jače.
    if (all.includes('ogledalo')) type = 'ogledalo';
    if (type === 'lak' && all.includes('boja')) type = 'boja';
    if (catalog?.Is_Glass) type = 'staklo';
    if (catalog?.Is_Alu_Door) type = 'alu';
    if (!type && foldText(catalog?.Category || '') === 'okovi') type = 'okov';

    let candidates = type ? [...(NEED_BY[type] || [])] : [];
    // Kant traka za furnir („KT / Furnir hrast") ide na kantiranje furnira.
    if (type === 'kant' && all.includes('furnir')) candidates = ['Kantiranje furnira', 'Kantiranje iverala'];
    if (catalog?.Need_By_Process?.trim()) candidates = [catalog.Need_By_Process.trim(), ...candidates];
    return { type, candidates, longLead: !!type && LONG_LEAD.has(type) };
}

// ─── Stanje materijala ────────────────────────────────────────────────

/**
 * here     — tu je (primljeno, na stanju, potvrđeno sa zalihe)
 * partial  — dio stigao
 * ordered  — naručeno, čeka se
 * stock    — sa zalihe, još nije potvrđeno da ima
 * missing  — niko nije naručio
 */
export type MaterialState = 'here' | 'partial' | 'ordered' | 'stock' | 'missing';

export interface GateMaterialInput {
    ID: string;
    Product_ID: string;
    Material_Name: string;
    Unit?: string;
    Quantity: number;
    Status?: string;
    On_Stock?: number;
    Ordered_Quantity?: number;
    Received_Quantity?: number;
    Supplier?: string;
    Order_ID?: string;
    catalog?: GateCatalog;
}

export function materialState(m: GateMaterialInput, productQty: number, stock: boolean): MaterialState {
    if (m.Status === 'Na stanju') return 'here';
    const c = materialCoverage({ Quantity: m.Quantity, Status: m.Status || '', On_Stock: m.On_Stock, Ordered_Quantity: m.Ordered_Quantity, Received_Quantity: m.Received_Quantity }, productQty);
    if (m.Status === 'Primljeno' && c.ordered === 0) return 'here';
    if (c.needed > 0 && c.received + c.onStock >= c.needed - 1e-9) return 'here';
    if (c.needed <= 0 && m.Status === 'Primljeno') return 'here';
    if (stock) return 'stock';
    if (c.ordered > 0 || m.Status === 'Naručeno') return c.received > 0 ? 'partial' : 'ordered';
    if (c.received > 0) return 'partial';
    return 'missing';
}

// ─── Gdje je stavka u toku ────────────────────────────────────────────

export interface GateItemInput {
    ID: string;
    Product_ID: string;
    Product_Name: string;
    /** Količina proizvoda (Product.Quantity) — sastavnica je po komadu. */
    Product_Quantity?: number;
    Status?: string;
    Processes?: ItemProcessStatus[];
}

export type StepStatus = 'done' | 'active' | 'waiting';

export interface ItemStep {
    name: string;
    status: StepStatus;
    /** Koraka do početka (0 = može odmah); null kad je završen. */
    distance: number | null;
}

const key = (s: string) => foldText(canonicalProcessName(s)).trim();

function stepStatus(item: GateItemInput, name: string, aliases?: string[]): Exclude<StepStatus, 'waiting'> | null {
    if (item.Status === 'Završeno') return 'done';
    const p = (item.Processes || []).find(x => nodeMatchesProcess({ name, aliases }, x.Process_Name) || key(x.Process_Name) === key(name));
    if (p?.Status === 'Završeno') return 'done';
    if (p?.Status === 'U toku') return 'active';
    return null;
}

/** Koraci stavke redom toka, sa stanjem i udaljenošću (graf naloga; bez grafa — lista procesa kao lanac). */
export function itemSteps(graph: ProcessGraph | undefined, item: GateItemInput): ItemStep[] {
    const nodes = graph?.nodes?.length ? itemNodes(graph, item.ID).filter(n => foldText(n.name) !== 'rad') : [];
    if (nodes.length) {
        const ids = new Set(nodes.map(n => n.id));
        const preds = new Map(nodes.map(n => [n.id, graph!.edges.filter(e => e.target === n.id && ids.has(e.source)).map(e => e.source)]));
        const out = new Map<string, ItemStep>();
        for (const n of nodes) {   // itemNodes je topološki redoslijed
            const st = stepStatus(item, n.name, n.aliases);
            if (st === 'done') { out.set(n.id, { name: n.name, status: 'done', distance: null }); continue; }
            const open = (preds.get(n.id) || []).map(p => out.get(p)!).filter(p => p && p.status !== 'done');
            const distance = open.length ? Math.min(...open.map(p => (p.distance ?? 0) + 1)) : 0;
            out.set(n.id, { name: n.name, status: st === 'active' ? 'active' : 'waiting', distance: st === 'active' ? 0 : distance });
        }
        return nodes.map(n => out.get(n.id)!);
    }
    let before = 0;   // nezavršenih koraka prije ovog
    return (item.Processes || []).map(p => {
        const st = stepStatus(item, p.Process_Name);
        if (st === 'done') return { name: p.Process_Name, status: 'done' as const, distance: null };
        const step: ItemStep = { name: p.Process_Name, status: st === 'active' ? 'active' : 'waiting', distance: st === 'active' ? 0 : before };
        before++;
        return step;
    });
}

const catalogIndex = (name: string) => {
    const k = key(name);
    const i = STANDARD_CATALOG.findIndex(c => key(c) === k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

/** Rani procesi (do pripreme furnira) — bez plana se pitaju pri pokretanju. */
const EARLY_LIMIT = catalogIndex('Furniranje');

/** Proces stavke u kojem se materijal troši; null = bez kapije. */
export function gateStepFor(role: MaterialRole, steps: ItemStep[]): { name: string; step: ItemStep | null } | null {
    if (!role.candidates.length) return null;
    for (const c of role.candidates) {
        const hit = steps.find(s => key(s.name) === key(c));
        if (hit) return { name: hit.name, step: hit };
    }
    if (!steps.length) {
        const name = role.candidates[0];
        return { name, step: { name, status: 'waiting', distance: catalogIndex(name) < EARLY_LIMIT ? 0 : null } };
    }
    // Proces nije u planu stavke: prvi kasniji po katalogu, inače zadnji korak.
    const want = catalogIndex(role.candidates[0]);
    const later = steps.filter(s => catalogIndex(s.name) >= want).sort((a, b) => catalogIndex(a.name) - catalogIndex(b.name))[0];
    const step = later || steps[steps.length - 1];
    return { name: step.name, step };
}

// ─── Kapije naloga ────────────────────────────────────────────────────

export interface OrderRef {
    number: string;
    supplier: string;
    date?: string;
    status: string;
}

/** Jedan red na kapiji: isti materijal (naziv + jedinica) iz svih proizvoda. */
export interface GateRow {
    key: string;
    name: string;
    unit: string;
    needed: number;
    state: MaterialState;
    stock: boolean;
    longLead: boolean;
    materialIds: string[];
    productNames: string[];
    supplier: string;
    order?: OrderRef;
    /** Kapija (proces) kojoj red pripada. */
    process?: string;
}

export interface Gate {
    process: string;
    status: StepStatus;
    /** Najmanja udaljenost među stavkama koje kapiju još nisu prošle; null = nepoznato/prošlo. */
    distance: number | null;
    itemIds: string[];
    rows: GateRow[];
}

const STATE_RANK: Record<MaterialState, number> = { missing: 4, stock: 3, ordered: 2, partial: 1, here: 0 };

export function rowIsReady(r: GateRow): boolean {
    return r.state === 'here';
}

function mergeState(a: MaterialState, b: MaterialState): MaterialState {
    if (a === b) return a;
    if (a === 'here' || b === 'here') {
        const other = a === 'here' ? b : a;
        return other === 'missing' || other === 'stock' ? other : 'partial';
    }
    return STATE_RANK[a] >= STATE_RANK[b] ? a : b;
}

export interface BuildGatesInput {
    graph: ProcessGraph | undefined;
    items: GateItemInput[];
    materials: GateMaterialInput[];
    stock: StockRules;
    orders?: Map<string, OrderRef>;
    /** Naučeni rok isporuke po dobavljaču (dana) — spor dobavljač = dug rok. */
    leadDays?: Map<string, number>;
}

/** Kapije naloga redom toka (najbliža prvo), svaka s redovima materijala. */
export function buildGates({ graph, items, materials, stock, orders, leadDays }: BuildGatesInput): Gate[] {
    const gates = new Map<string, Gate & { rowMap: Map<string, GateRow> }>();
    const byProduct = new Map<string, GateMaterialInput[]>();
    materials.forEach(m => byProduct.set(m.Product_ID, [...(byProduct.get(m.Product_ID) || []), m]));
    const seenMaterial = new Set<string>();   // isti proizvod u dvije stavke naloga → materijal jednom

    for (const item of items) {
        const steps = itemSteps(graph, item);
        for (const m of byProduct.get(item.Product_ID) || []) {
            if (seenMaterial.has(m.ID)) continue;
            const role = materialRole(m.Material_Name, m.catalog);
            const at = gateStepFor(role, steps);
            if (!at) continue;
            seenMaterial.add(m.ID);
            const isStock = isStockMaterial(m.Material_Name, m.catalog, stock);
            const productQty = item.Product_Quantity && item.Product_Quantity > 0 ? item.Product_Quantity : 1;
            const state = materialState(m, productQty, isStock);
            const needed = materialCoverage({ Quantity: m.Quantity, Status: m.Status || '' }, productQty).needed;

            const gk = key(at.name);
            let gate = gates.get(gk);
            if (!gate) {
                gate = { process: canonicalProcessName(at.name), status: 'done', distance: null, itemIds: [], rows: [], rowMap: new Map() };
                gates.set(gk, gate);
            }
            if (!gate.itemIds.includes(item.ID)) {
                gate.itemIds.push(item.ID);
                const st = at.step?.status ?? 'waiting';
                if (st === 'active') gate.status = 'active';
                else if (st === 'waiting' && gate.status === 'done') gate.status = 'waiting';
                if (st !== 'done' && at.step?.distance != null) {
                    gate.distance = gate.distance == null ? at.step.distance : Math.min(gate.distance, at.step.distance);
                }
            }

            const rk = `${foldText(m.Material_Name).trim()}|${foldText(m.Unit || '')}`;
            const row = gate.rowMap.get(rk);
            const order = m.Order_ID ? orders?.get(m.Order_ID) : undefined;
            if (row) {
                row.needed = Math.round((row.needed + needed) * 1000) / 1000;
                row.state = mergeState(row.state, state);
                row.materialIds.push(m.ID);
                if (!row.productNames.includes(item.Product_Name)) row.productNames.push(item.Product_Name);
                if (!row.order && order) row.order = order;
            } else {
                gate.rowMap.set(rk, {
                    key: rk, name: m.Material_Name, unit: m.Unit || 'kom', needed, state, stock: isStock,
                    longLead: role.longLead || isSlowSupplier(m.Supplier, leadDays), materialIds: [m.ID], productNames: [item.Product_Name],
                    supplier: m.Supplier || '', ...(order ? { order } : {}),
                });
            }
        }
    }

    return Array.from(gates.values())
        .map(({ rowMap, ...g }) => ({
            ...g,
            distance: g.status === 'done' ? null : g.distance,
            rows: Array.from(rowMap.values()).map(r => ({ ...r, process: g.process })).sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || a.name.localeCompare(b.name, 'bs')),
        }))
        .sort((a, b) => rankGate(a) - rankGate(b) || catalogIndex(a.process) - catalogIndex(b.process));
}

function rankGate(g: Gate): number {
    if (g.status === 'done') return 1000;
    if (g.status === 'active') return -1;
    return g.distance ?? 500;
}

// ─── Rok isporuke (učenje iz narudžbi) ────────────────────────────────

/** Dobavljač kojem treba ovoliko dana ili više naručuje se čim nalog krene. */
export const SLOW_SUPPLIER_DAYS = 5;
/** Toliko primljenih narudžbi treba prije nego rok vrijedi. */
const MIN_SAMPLES = 2;

export interface DeliverySample { supplier: string; orderedAt: string; receivedAt: string }

/** Medijan dana od slanja do prijema, po dobavljaču (samo stvarni prijemi, ≥ 2 uzorka). */
export function supplierLeadDays(samples: DeliverySample[]): Map<string, number> {
    const by = new Map<string, number[]>();
    for (const s of samples) {
        const from = Date.parse(s.orderedAt), to = Date.parse(s.receivedAt);
        if (!s.supplier || !Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
        const k = foldText(s.supplier).trim();
        by.set(k, [...(by.get(k) || []), (to - from) / 86_400_000]);
    }
    const out = new Map<string, number>();
    by.forEach((days, k) => {
        if (days.length < MIN_SAMPLES) return;
        const sorted = [...days].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        out.set(k, Math.round(median * 10) / 10);
    });
    return out;
}

export function isSlowSupplier(supplier: string | undefined, leadDays?: Map<string, number>): boolean {
    if (!supplier || !leadDays) return false;
    return (leadDays.get(foldText(supplier).trim()) ?? 0) >= SLOW_SUPPLIER_DAYS;
}

/** Kapija je spremna kad je sve tu. */
export function gateReady(g: Gate): boolean {
    return g.rows.every(rowIsReady);
}

// ─── Kad bot pita ─────────────────────────────────────────────────────

export type AlertKind = 'start' | 'pre' | 'gate';

export interface MaterialAlert {
    kind: AlertKind;
    /** Ključevi koje ova poruka „troši". */
    keys: string[];
    processes: string[];
    /** Šta se pita „je li tu?". */
    rows: GateRow[];
    /** Samo uz start: stvari s dugim rokom iz kasnijih kapija koje niko nije naručio. */
    longLead: GateRow[];
}

/**
 * Ključevi po nalogu:
 *   start          — pitanje pri pokretanju
 *   pre:<proces>   — najava za ono što se naručuje (≤ LOOKAHEAD koraka)
 *   stk:<proces>   — zaliha se pita tek kad je proces na redu (nema roka isporuke)
 *   gate:<proces>  — proces počeo, a nešto fali
 */
export const alertKey = (kind: AlertKind | 'stk', process?: string) => (process ? `${kind}:${key(process)}` : kind);

/**
 * Ključevi koje bi nalog sad mogao „potrošiti" — računa se iz koraka, BEZ
 * materijala, da sat ne čita sastavnice kad je sve već pitano.
 */
export function candidateKeys(started: boolean, graph: ProcessGraph | undefined, items: GateItemInput[], lookahead = LOOKAHEAD): string[] {
    if (!started) return [];
    const keys = new Set<string>(['start']);
    for (const item of items) {
        if (item.Status === 'Završeno') continue;
        for (const s of itemSteps(graph, item)) {
            if (s.status === 'done') continue;
            if (s.status === 'active') keys.add(alertKey('gate', s.name));
            if (s.distance != null && s.distance <= lookahead) keys.add(alertKey('pre', s.name));
            if (s.distance === 0) keys.add(alertKey('stk', s.name));
        }
    }
    return Array.from(keys);
}

/**
 * Šta poslati sad. `seen` = već riješeni ključevi naloga. Vraća i `consumed`:
 * svi ključevi riješeni ovim krugom (i oni bez poruke — kapija bez materijala
 * ili sve već tu), da se ne pitaju ponovo.
 */
export function dueAlerts(started: boolean, gates: Gate[], seen: Set<string>, lookahead = LOOKAHEAD): { alerts: MaterialAlert[]; consumed: string[] } {
    if (!started) return { alerts: [], consumed: [] };
    const consumed = new Set<string>();
    const done = (k: string) => seen.has(k) || consumed.has(k);
    const openRows = (g: Gate, which: 'all' | 'order' | 'stock') => g.rows.filter(r => !rowIsReady(r)
        && (which === 'all' || (which === 'stock' ? r.stock : !r.stock)));

    // Šta bi svaka kapija sad pitala (bez obzira na start).
    const asks: { gate: Gate; rows: GateRow[]; keys: string[] }[] = [];
    for (const g of gates) {
        if (g.status === 'done') continue;
        const gateKey = alertKey('gate', g.process), preKey = alertKey('pre', g.process), stkKey = alertKey('stk', g.process);
        if (g.status === 'active') {
            if (done(gateKey)) continue;
            [gateKey, preKey, stkKey].forEach(k => consumed.add(k));
            asks.push({ gate: g, rows: openRows(g, 'all'), keys: [gateKey] });
            continue;
        }
        const rows: GateRow[] = [];
        const keys: string[] = [];
        if (g.distance != null && g.distance <= lookahead && !done(preKey)) {
            consumed.add(preKey); keys.push(preKey);
            rows.push(...openRows(g, 'order'));
        }
        if (g.distance === 0 && !done(stkKey)) {
            consumed.add(stkKey); keys.push(stkKey);
            rows.push(...openRows(g, 'stock'));
        }
        if (keys.length) asks.push({ gate: g, rows, keys });
    }

    const alerts: MaterialAlert[] = [];
    const gateAsks = asks.filter(a => a.gate.status === 'active');
    let soonAsks = asks.filter(a => a.gate.status !== 'active');

    if (!done('start')) {
        consumed.add('start');
        // Pri pokretanju jedna poruka: prva faza + ono što uskoro treba naručiti + dug rok.
        const asked = new Set(soonAsks.map(a => a.gate.process));
        const longLead = gates.filter(g => g.status !== 'done' && !asked.has(g.process))
            .flatMap(g => g.rows.filter(r => r.longLead && r.state === 'missing'));
        const rows = soonAsks.flatMap(a => a.rows);
        if (rows.length || longLead.length) {
            alerts.push({ kind: 'start', keys: ['start', ...soonAsks.flatMap(a => a.keys)], processes: soonAsks.filter(a => a.rows.length).map(a => a.gate.process), rows, longLead });
        }
        soonAsks = [];
    }

    for (const a of gateAsks) {
        if (a.rows.length) alerts.push({ kind: 'gate', keys: a.keys, processes: [a.gate.process], rows: a.rows, longLead: [] });
    }
    const soon = soonAsks.filter(a => a.rows.length);
    if (soon.length) {
        // Više najava istog naloga u jednoj poruci.
        alerts.push({ kind: 'pre', keys: soon.flatMap(a => a.keys), processes: soon.map(a => a.gate.process), rows: soon.flatMap(a => a.rows), longLead: [] });
    }
    return { alerts, consumed: Array.from(consumed) };
}

// ─── Tekst ────────────────────────────────────────────────────────────

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('bs-BA', { maximumFractionDigits: 2 });

export function shortDay(iso?: string): string {
    if (!iso || iso.length < 10) return '';
    return `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
}

/** „Ručke · 12 kom · naručeno 21.10. (Häfele)" */
export function rowLabel(r: GateRow, opts: { state?: boolean } = {}): string {
    const bits = [r.name];
    if (r.needed > 0) bits.push(`${fmt(r.needed)} ${r.unit}`);
    if (opts.state !== false) {
        const s = stateNote(r);
        if (s) bits.push(s);
    }
    return bits.join(' · ');
}

export function stateNote(r: GateRow): string {
    switch (r.state) {
        case 'stock': return 'zaliha';
        case 'ordered': {
            if (!r.order) return 'naručeno';
            const day = shortDay(r.order.date);
            return `naručeno${day ? ` ${day}` : ''}${r.order.supplier ? ` (${r.order.supplier})` : ''}`;
        }
        case 'partial': return 'dio stigao';
        case 'missing': return r.order?.status === 'Nacrt' ? `u nacrtu ${r.order.number}` : 'nije naručeno';
        default: return 'tu je';
    }
}

export const STATE_ICON: Record<MaterialState, string> = { here: '✔', partial: '◐', ordered: '🚚', stock: '📦', missing: '✖' };
