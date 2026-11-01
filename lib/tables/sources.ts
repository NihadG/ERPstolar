// ════════════════════════════════════════════════════════════════════
// IZVORI TABELA — polja svakog izvora i kako se čitaju (čisto)
//
// Izvor opisuje SVA polja (lib/tables/engine FieldDef); kolone, filteri,
// redoslijed, grupe i zbir rade isto za sve izvore. Podaci se ovdje jednom
// svedu na isti oblik:
//   • bilježnica: stan ZA KOJI je stvar (Hodnik C5 „za E501" → E501, lamela E),
//     mjere iz naslova ili opisa (i „š 800"), nepoznata količina ostaje prazna;
//   • materijali: količine iz lib/materialCoverage (isto kao Pregled materijala
//     i „Za naručiti"), isti materijal sabran preko proizvoda kad proizvod nije kolona.
// Novi izvor = polja + učitavanje (alat make_table), bez novih pravila.
// jest: lib/__tests__/botTables.test.ts
// ════════════════════════════════════════════════════════════════════

import type { MemoryItem } from '@/lib/types';
import {
    MEMORY_STATES, filterNotebook, locationKey, parseDimensions, targetOf, type MemoryStateKey, type NotebookFilter,
} from '@/lib/assistant/memoryRules';
import { formatQty, roundQty } from '@/lib/orderItemGroups';
import { materialTypeFromName } from '@/lib/productProcesses';
import { matchScore } from '@/lib/voice/match';
import { foldText } from '@/lib/voice/text';
import { runTable, type EngineResult, type FieldDef, type TableFilter } from './engine';

export const TABLE_SOURCES = ['biljeska', 'materijali'] as const;
export type TableSource = (typeof TABLE_SOURCES)[number];

/** Šta je korisnik tražio, osim izvora i njegovog stanja. */
export interface TableAsk {
    textColumns: string[];
    modelColumns: string[];
    filters: TableFilter[];
    groupBy?: string;
    sort?: string;
    said: (value: string) => boolean;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const byText = (a: string, b: string) => a.localeCompare(b, 'bs', { numeric: true, sensitivity: 'base' });

function unsaid(values: string[], said: (v: string) => boolean): string | null {
    const bad = values.filter(v => !said(v));
    return bad.length ? `${bad.map(v => `„${v}"`).join(', ')} korisnik nije rekao — ne dodaji to u tabelu. Ako za traženo nema izvora, reci to.` : null;
}

// ─── Bilježnica ───────────────────────────────────────────────────────

export interface NotebookTableFilter {
    /** Predmeti u osnovnom obliku: ["ogledalo", "umivaonik"]; prazno = sve stvari. */
    subjects: string[];
    locations: string[];
    state: string;
}

/** Mjere iz naslova (ERP ih tu upisuje, i „š 800"), za starije stavke iz opisa. */
export function dimsOf(m: MemoryItem): string {
    const width = /(?:^|\s)š\s?(\d{2,4})(?!\d)/i.exec(m.Title || '');
    return parseDimensions(m.Title).dims || (width ? `š ${width[1]}` : '') || parseDimensions(m.Spec).dims || '';
}

const FOR_FLAT = /\s*\bza\s+[A-Za-z]?\s?-?\d{2,4}\b/;

/** Sva stanja bilježnice i kako se kažu — kolona stanja se prepozna i kad tog stanja još nema u podacima. */
const STATE_WORDS = [...Object.values(MEMORY_STATES).map(s => s.label), 'montirano ugrađeno ima nema stoji hodnik'].join(' ');

function notebookFields(since: (iso: string) => string, subjects: string[]): FieldDef<MemoryItem>[] {
    const stanOf = (m: MemoryItem) => targetOf(m);
    return [
        {
            key: 'stan', label: 'Stan', words: ['stan', 'broj stan', 'sifra stan', 'lokacij', 'gdje', 'mjest', 'prostorij', 'pozicij', 'adres', 'soba'], gap: 'bez stana',
            value: m => {
                const t = stanOf(m);
                return t.elsewhere ? `${t.stan} (${m.Location})` : t.stan;
            },
            sortKey: m => `${stanOf(m).letter || 'zzz'}|${stanOf(m).stan}`,
            match: (m, v) => {
                const w = v.trim();
                if (/^[a-z]$/i.test(w)) return stanOf(m).letter === w.toUpperCase();
                return locationKey(stanOf(m).stan) === locationKey(w) || locationKey(m.Location) === locationKey(w) || foldText(m.Location || '').includes(foldText(w));
            },
        },
        {
            key: 'lamela', label: 'Lamela', words: ['lamel', 'zgrad', 'ulaz', 'blok'],
            value: m => stanOf(m).letter,
            groupLabel: m => (stanOf(m).letter ? `${stanOf(m).letter} lamela` : 'Bez lamele'),
            sortKey: m => stanOf(m).letter || 'zzz',
            match: (m, v) => stanOf(m).letter === v.trim().toUpperCase(),
        },
        { key: 'gdje', label: 'Gdje stoji', words: ['gdje stoji', 'gdje se nalazi', 'stoji', 'nalazi'], value: m => m.Location || '' },
        {
            key: 'predmet', label: 'Predmet', words: ['predmet', 'stvar', 'artik', 'element', 'vrsta', 'naziv'], fixedVocab: subjects.join(' '),
            vocab: m => m.Subject,
            // Mjere i stan imaju svoje kolone → ne ponavljaju se u nazivu.
            value: (m, picked) => {
                let t = m.Title || cap(m.Subject);
                const dims = picked.has('mjere') ? dimsOf(m) : '';
                if (dims) t = t.replace(dims, ' ');
                if (picked.has('stan')) t = t.replace(FOR_FLAT, '');
                return t.replace(/\s+/g, ' ').trim();
            },
        },
        { key: 'mjere', label: 'Mjere', words: ['dimenz', 'mjer', 'velicin', 'format', 'sirin', 'visin'], gap: 'bez dimenzija', value: m => dimsOf(m) },
        {
            key: 'kolicina', label: 'Količina', words: ['kolic', 'kom', 'komad', 'broj', 'kol', 'koliko'], align: 'right', gap: 'bez količine',
            value: m => (m.Quantity == null ? '' : `${formatQty(m.Quantity)} ${m.Unit || 'kom'}`),
            amount: m => (m.Quantity == null ? null : { n: m.Quantity, unit: m.Unit || 'kom' }),
            sortKey: m => m.Quantity ?? 0,
        },
        {
            key: 'stanje', label: 'Stanje', words: ['stanj', 'status', 'postavlj', 'montir'], fixedVocab: STATE_WORDS,
            vocab: m => `${m.State_Label} ${MEMORY_STATES[m.State_Key as MemoryStateKey]?.label || ''}`,
            value: m => m.State_Label,
        },
        {
            key: 'napomena', label: 'Napomena', words: ['napom', 'biljes', 'komentar', 'opis', 'detalj', 'primjedb'],
            value: (m, picked) => {
                const spec = picked.has('mjere') ? parseDimensions(m.Spec).rest : (m.Spec || '');
                return [spec, picked.has('stanje') ? '' : m.State_Label].filter(Boolean).join(' · ');
            },
        },
        { key: 'upisano', label: 'Upisano', words: ['datum', 'upisan', 'od kad', 'kad'], value: m => since(m.Created_At), sortKey: m => m.Created_At },
        { key: 'oznake', label: 'Oznake', words: ['oznak', 'tag'], value: m => (m.Tags || []).join(', '), vocab: m => (m.Tags || []).join(' ') },
    ];
}

const STATE_HEAD: Record<string, string> = { otvoreno: 'nije postavljeno', postavljeno: 'postavljeno', sve: 'sve stavke' };

export function notebookTable(items: MemoryItem[], filter: NotebookTableFilter, ask: TableAsk, opts: { since: (iso: string) => string; day: string; notes?: string[] }): EngineResult {
    const bad = unsaid([...filter.subjects, ...filter.locations], ask.said);
    if (bad) return { ok: false, error: bad };
    const base: NotebookFilter = { locations: filter.locations, state: filter.state };
    const chosen = filter.subjects.length
        ? items.filter(m => filter.subjects.some(subject => filterNotebook([m], { ...base, subject }).length))
        : filterNotebook(items, base);
    const fields = notebookFields(opts.since, filter.subjects);
    const stan = fields[0];

    const state = STATE_HEAD[filter.state] || MEMORY_STATES[filter.state as MemoryStateKey]?.label || filter.state;
    const where = filter.locations.length
        ? `${filter.locations.every(l => /^[a-z]$/i.test(l)) ? (filter.locations.length > 1 ? 'lamele ' : 'lamela ') : ''}${filter.locations.map(l => l.toUpperCase()).join(', ')}`
        : '';
    return runTable({
        fields,
        defaults: ['stan', 'predmet', 'mjere', 'kolicina', 'napomena'],
        defaultSort: (a, b) => byText(String(stan.sortKey!(a)), String(stan.sortKey!(b))) || byText(a.Title, b.Title),
        autoGroup: 'lamela',
        vocabRows: items,
    }, chosen, ask, {
        title: filter.subjects.length ? `Bilježnica — ${filter.subjects.join(', ')}` : 'Bilježnica',
        subtitle: [state, where],
        notes: opts.notes,
        day: opts.day,
    });
}

// ─── Materijali ───────────────────────────────────────────────────────

/** Jedan materijal jednog proizvoda (lib/server/orderWrites loadProjectMaterials + naziv projekta). */
export interface TableMaterialRow {
    name: string;
    unit: string;
    supplier: string;
    unitPrice: number;
    productName: string;
    projectId: string;
    projectName: string;
    needed: number;
    onStock: number;
    ordered: number;
    received: number;
    inDrafts: number;
    toOrder: number;
    status: string;
}

export const MATERIAL_STATUSES = ['za_naruciti', 'naruceno', 'stiglo', 'sve'] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

/** Količina koju tabela pokazuje: ono što je traženo (još za naručiti / čeka se / stiglo / ukupno). */
const QTY: Record<MaterialStatus, (r: TableMaterialRow) => number> = {
    za_naruciti: r => r.toOrder,
    naruceno: r => r.ordered,
    stiglo: r => r.received,
    sve: r => r.needed,
};

const MATERIAL_TITLE: Record<MaterialStatus, string> = {
    za_naruciti: 'Nenaručeni materijali',
    naruceno: 'Naručeni materijali (čeka se)',
    stiglo: 'Stigli materijali',
    sve: 'Materijali',
};

const QTY_MEANING: Record<MaterialStatus, string> = {
    za_naruciti: 'količina = još za naručiti',
    naruceno: 'količina = naručeno, nije stiglo',
    stiglo: 'količina = primljeno',
    sve: 'količina = potrebno po sastavnici',
};

export interface MaterialTableFilter {
    status: MaterialStatus;
    supplier?: string;
    /** Dio naziva ili vrsta („iveral", „šarke"). */
    material?: string;
    /** Za podnaslov: projekat ili „projekti na kojima se radi". */
    scope: string;
}

/** Red tabele: materijal s količinom koju tabela pokazuje i proizvodima koji ga imaju. */
interface MaterialLine extends TableMaterialRow {
    qty: number;
    products: string[];
}

function materialFields(): FieldDef<MaterialLine>[] {
    const n = (get: (r: MaterialLine) => number, words: string[], key: string, label: string): FieldDef<MaterialLine> => ({
        key, label, words, align: 'right',
        value: (r, picked) => `${formatQty(get(r))}${picked.has('jedinica') ? '' : ` ${r.unit}`}`,
        amount: r => ({ n: get(r), unit: r.unit }),
        sortKey: get,
    });
    return [
        { key: 'materijal', label: 'Materijal', words: ['materijal', 'naziv', 'artik', 'stavk', 'opis'], value: r => r.name },
        n(r => r.qty, ['kolic', 'kol', 'koliko', 'za narucit', 'nenaruc', 'fali', 'treba'], 'kolicina', 'Količina'),
        { key: 'jedinica', label: 'Jedinica', words: ['jedinic', 'jm', 'j.m'], value: r => r.unit },
        { key: 'dobavljac', label: 'Dobavljač', words: ['dobavlj', 'firma', 'od koga', 'kod koga', 'prodavac'], gap: 'bez dobavljača', value: r => r.supplier, vocab: r => r.supplier },
        { key: 'projekat', label: 'Projekat', words: ['projek', 'objekat', 'klijent', 'kupac', 'investitor'], value: r => r.projectName, vocab: r => r.projectName },
        { key: 'proizvod', label: 'Proizvod', words: ['proizvod', 'element', 'pozicij', 'za sta', 'za koji'], value: r => r.products.join(', '), vocab: r => r.productName },
        n(r => r.needed, ['potreb', 'ukupno', 'sastavnic'], 'potrebno', 'Potrebno'),
        n(r => r.ordered, ['naruceno', 'naruc', 'ceka'], 'naruceno', 'Naručeno'),
        n(r => r.received, ['stigl', 'primlj', 'doslo'], 'primljeno', 'Primljeno'),
        n(r => r.onStock, ['na stanju', 'stanj', 'zalih'], 'stanje', 'Na stanju'),
        n(r => r.inDrafts, ['nacrt'], 'nacrt', 'U nacrtu'),
        { key: 'cijena', label: 'Cijena', words: ['cijen', 'jedinicn'], align: 'right', value: r => `${r.unitPrice.toFixed(2)} KM`, sortKey: r => r.unitPrice },
        {
            key: 'iznos', label: 'Iznos', words: ['iznos', 'vrijednost', 'ukupna cijena', 'total', 'para', 'kostanj'], align: 'right',
            value: r => `${(r.qty * r.unitPrice).toFixed(2)} KM`,
            amount: r => ({ n: Math.round(r.qty * r.unitPrice * 100) / 100, unit: 'KM' }),
            sortKey: r => r.qty * r.unitPrice,
        },
        { key: 'status', label: 'Status', words: ['status'], value: r => r.status, vocab: r => r.status },
    ];
}

function materialWanted(material: string | undefined): (name: string) => boolean {
    if (!material?.trim()) return () => true;
    // „iveral" = vrsta (kao product_materials); inače dio naziva.
    const type = materialTypeFromName(material);
    return name => (type ? materialTypeFromName(name) === type : matchScore(material, [name]) >= 0.7);
}

/** Isti materijal (naziv, jedinica, dobavljač) jednog projekta sabran preko proizvoda. */
function aggregate(lines: MaterialLine[], picked: Set<string>): MaterialLine[] {
    if (picked.has('proizvod')) return lines;
    const out = new Map<string, MaterialLine>();
    for (const r of lines) {
        const key = [r.projectId, foldText(r.name), foldText(r.unit), foldText(r.supplier)].join('|');
        const line = out.get(key);
        if (!line) {
            out.set(key, { ...r, products: [...r.products] });
            continue;
        }
        line.qty = roundQty(line.qty + r.qty);
        line.needed = roundQty(line.needed + r.needed);
        line.ordered = roundQty(line.ordered + r.ordered);
        line.received = roundQty(line.received + r.received);
        line.onStock = roundQty(line.onStock + r.onStock);
        line.inDrafts = roundQty(line.inDrafts + r.inDrafts);
        for (const p of r.products) if (!line.products.includes(p)) line.products.push(p);
        if (!line.status.split('/').includes(r.status)) line.status = `${line.status}/${r.status}`;
    }
    return Array.from(out.values());
}

export function materialsTable(rows: TableMaterialRow[], filter: MaterialTableFilter, ask: TableAsk, opts: { day: string; notes?: string[] }): EngineResult {
    const bad = unsaid([filter.supplier, filter.material].filter((x): x is string => !!x?.trim()), ask.said);
    if (bad) return { ok: false, error: bad };
    const qtyOf = QTY[filter.status];
    const wanted = materialWanted(filter.material);
    const supplier = filter.supplier?.trim();
    const lines: MaterialLine[] = rows
        .filter(r => wanted(r.name) && (!supplier || matchScore(supplier, [r.supplier]) >= 0.7))
        .map(r => ({ ...r, qty: qtyOf(r), products: [r.productName] }))
        .filter(r => filter.status === 'sve' || r.qty > 0);

    const drafted = filter.status === 'za_naruciti' ? lines.filter(r => r.inDrafts > 0).length : 0;
    const res = runTable({
        fields: materialFields(),
        defaults: ['materijal', 'kolicina', 'dobavljac'],
        // Po projektu, pa dobavljaču (lakše naručivanje), pa nazivu.
        defaultSort: (a, b) => byText(a.projectName, b.projectName) || (Number(!a.supplier) - Number(!b.supplier)) || byText(a.supplier, b.supplier) || byText(a.name, b.name),
        autoGroup: 'projekat',
        prepare: aggregate,
    }, lines, ask, {
        title: MATERIAL_TITLE[filter.status],
        subtitle: [filter.scope, supplier ? cap(supplier) : '', filter.material?.trim() || '', QTY_MEANING[filter.status]],
        notes: [...(opts.notes || []), ...(drafted ? [`Dio je već u nacrtu narudžbe (nije poslano): ${drafted} ${drafted === 1 ? 'stavka' : 'stavki'}.`] : [])],
        day: opts.day,
    });
    // Podnaslov: broj redova ide prije značenja količine.
    if (res.ok) res.table.subtitle = res.table.subtitle.replace(/ · (količina = [^·]+) · (\d+ red\w*)$/, ' · $2 · $1');
    return res;
}
