// ════════════════════════════════════════════════════════════════════
// IZVORI TABELA — šta se može tražiti u tabeli i kako se čita (čisto)
//
// Svaki izvor: filter (isti kao u ostatku ERP-a), rječnik kolona,
// podrazumijevane kolone, redoslijed i grupe. Podaci dolaze spolja
// (alat make_table ih učita), ovdje se samo slaže — zato je sve testirano.
//
//   • biljeska   — stvari po stanovima (filterNotebook, kao list_notebook)
//   • materijali — sastavnice projekata; količine iz lib/materialCoverage,
//                  iste kao Pregled materijala i „Za naručiti" u Komandnom centru
// jest: lib/__tests__/botTables.test.ts
// ════════════════════════════════════════════════════════════════════

import type { MemoryItem } from '@/lib/types';
import { MEMORY_STATES, filterNotebook, letterOf, parseDimensions, type MemoryStateKey, type NotebookFilter } from '@/lib/assistant/memoryRules';
import { formatQty, roundQty } from '@/lib/orderItemGroups';
import { materialTypeFromName } from '@/lib/productProcesses';
import { matchScore } from '@/lib/voice/match';
import { foldText } from '@/lib/voice/text';
import { buildTable, columnsByKey, resolveColumns, rowsLabel, subjectWords, type ColumnDef, type PickedColumn, type TableDoc } from './table';

export const TABLE_SOURCES = ['biljeska', 'materijali'] as const;
export type TableSource = (typeof TABLE_SOURCES)[number];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const byText = (a: string, b: string) => a.localeCompare(b, 'bs', { numeric: true, sensitivity: 'base' });

function unknownNote(unknown: string[], catalog: { label: string }[]): string[] {
    if (!unknown.length) return [];
    return [`Kolonu ${unknown.map(u => `„${u}"`).join(', ')} ne znam — mogu: ${catalog.map(c => c.label.toLowerCase()).join(', ')}.`];
}

function pickColumns<R>(asked: string[], catalog: ColumnDef<R>[], defaults: string[], extra: Record<string, string[]> = {}): { columns: PickedColumn<R>[]; unknown: string[] } {
    if (!asked.length) return { columns: columnsByKey(catalog, defaults), unknown: [] };
    const { picked, unknown } = resolveColumns(asked, catalog, extra);
    return { columns: picked.length ? picked : columnsByKey(catalog, defaults), unknown };
}

// ─── Bilježnica ───────────────────────────────────────────────────────

export interface NotebookTableFilter {
    /** Predmeti u osnovnom obliku: ["ogledalo", "umivaonik"]; prazno = sve stvari. */
    subjects: string[];
    locations: string[];
    state: string;
}

/** Mjere iz naslova (ERP ih tu upisuje), za starije stavke iz opisa. */
function dimsOf(m: MemoryItem): string {
    return parseDimensions(m.Title).dims || parseDimensions(m.Spec).dims || '';
}

function notebookColumns(since: (iso: string) => string): ColumnDef<MemoryItem>[] {
    return [
        { key: 'lokacija', label: 'Lokacija', words: ['stan', 'lokacij', 'gdje', 'mjesto', 'prostorij', 'pozicij'], value: m => m.Location || '—' },
        { key: 'lamela', label: 'Lamela', words: ['lamel', 'zgrad', 'ulaz'], value: m => letterOf(m) || '—' },
        {
            key: 'predmet', label: 'Predmet', words: ['predmet', 'stvar', 'artik', 'naziv', 'element'],
            // Mjere su u naslovu („Ogledalo 1000x1350 za C502"); kad imaju svoju kolonu, ne ponavljaju se.
            value: (m, picked) => {
                const dims = picked.has('mjere') ? dimsOf(m) : '';
                return (dims ? m.Title.replace(dims, ' ') : m.Title).replace(/\s+/g, ' ').trim();
            },
        },
        { key: 'mjere', label: 'Mjere', words: ['dimenz', 'mjer', 'velicin', 'format', 'sirin'], value: m => dimsOf(m) },
        {
            key: 'kolicina', label: 'Količina', words: ['kolic', 'kom', 'komad', 'broj', 'kol'], align: 'right',
            value: m => `${formatQty(m.Quantity ?? 1)} ${m.Unit || 'kom'}`,
            amount: m => ({ n: m.Quantity ?? 1, unit: m.Unit || 'kom' }),
        },
        { key: 'stanje', label: 'Stanje', words: ['stanj', 'status', 'postavlj', 'montir'], value: m => m.State_Label },
        {
            key: 'napomena', label: 'Napomena', words: ['napom', 'biljes', 'komentar', 'opis', 'detalj'],
            value: (m, picked) => {
                const spec = picked.has('mjere') ? parseDimensions(m.Spec).rest : (m.Spec || '');
                return [spec, picked.has('stanje') ? '' : m.State_Label].filter(Boolean).join(' · ');
            },
        },
        { key: 'datum', label: 'Upisano', words: ['datum', 'upisan', 'od kad', 'kad'], value: m => since(m.Created_At) },
    ];
}

const NOTEBOOK_DEFAULT = ['lokacija', 'predmet', 'mjere', 'kolicina', 'napomena'];

const STATE_HEAD: Record<string, string> = { otvoreno: 'nije postavljeno', postavljeno: 'postavljeno', sve: 'sve stavke' };

export function notebookTable(items: MemoryItem[], filter: NotebookTableFilter, asked: string[], opts: { since: (iso: string) => string; day: string }): TableDoc {
    const base: NotebookFilter = { locations: filter.locations, state: filter.state };
    const chosen = filter.subjects.length
        ? items.filter(m => filter.subjects.some(subject => filterNotebook([m], { ...base, subject }).length))
        : filterNotebook(items, base);
    const sorted = [...chosen].sort((a, b) => letterOf(a).localeCompare(letterOf(b))
        || byText(a.Location || '', b.Location || '') || byText(a.Title, b.Title));

    const catalog = notebookColumns(opts.since);
    const { columns, unknown } = pickColumns(asked, catalog, NOTEBOOK_DEFAULT, { predmet: subjectWords(filter.subjects) });
    const keys = new Set(columns.map(c => c.def.key));
    const byLetter = !keys.has('lamela') && new Set(sorted.map(letterOf)).size > 1;

    const state = STATE_HEAD[filter.state] || MEMORY_STATES[filter.state as MemoryStateKey]?.label || filter.state;
    const where = filter.locations.length
        ? `${filter.locations.every(l => /^[a-z]$/i.test(l)) ? (filter.locations.length > 1 ? 'lamele ' : 'lamela ') : ''}${filter.locations.map(l => l.toUpperCase()).join(', ')}`
        : '';
    return buildTable({
        title: filter.subjects.length ? `Bilježnica — ${filter.subjects.join(', ')}` : 'Bilježnica',
        subtitle: [state, where, rowsLabel(sorted.length)].filter(Boolean).join(' · '),
        columns,
        rows: sorted,
        groupOf: byLetter ? m => (letterOf(m) ? `${letterOf(m)} lamela` : 'Bez lamele') : undefined,
        notes: unknownNote(unknown, catalog),
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
    /** Za podnaslov: projekat ili „aktivni projekti". */
    scope: string;
}

/** Red tabele: isti materijal (naziv, jedinica, dobavljač) jednog projekta sabran preko proizvoda. */
interface MaterialLine extends TableMaterialRow {
    qty: number;
    products: string[];
}

function materialColumns(): ColumnDef<MaterialLine>[] {
    const n = (get: (r: MaterialLine) => number, words: string[], key: string, label: string): ColumnDef<MaterialLine> => ({
        key, label, words, align: 'right',
        value: (r, picked) => `${formatQty(get(r))}${picked.has('jedinica') ? '' : ` ${r.unit}`}`,
        amount: r => ({ n: get(r), unit: r.unit }),
    });
    return [
        { key: 'materijal', label: 'Materijal', words: ['materijal', 'naziv', 'artik', 'stavk', 'opis'], value: r => r.name },
        n(r => r.qty, ['kolic', 'kol', 'koliko', 'za narucit', 'nenaruc', 'fali'], 'kolicina', 'Količina'),
        { key: 'jedinica', label: 'Jedinica', words: ['jedinic', 'jm', 'j.m'], value: r => r.unit },
        { key: 'dobavljac', label: 'Dobavljač', words: ['dobavlj', 'firma', 'od koga', 'kod koga', 'prodavac'], value: r => r.supplier || '—' },
        { key: 'projekat', label: 'Projekat', words: ['projek', 'objekat', 'klijent', 'kupac', 'investitor'], value: r => r.projectName },
        { key: 'proizvod', label: 'Proizvod', words: ['proizvod', 'element', 'pozicij', 'za sta', 'za koji'], value: r => r.products.join(', ') },
        n(r => r.needed, ['potreb', 'ukupno', 'sastavnic'], 'potrebno', 'Potrebno'),
        n(r => r.ordered, ['naruceno', 'naruc', 'ceka'], 'naruceno', 'Naručeno'),
        n(r => r.received, ['stigl', 'primlj', 'doslo'], 'primljeno', 'Primljeno'),
        n(r => r.onStock, ['na stanju', 'stanj', 'zalih'], 'stanje', 'Na stanju'),
        n(r => r.inDrafts, ['nacrt'], 'nacrt', 'U nacrtu'),
        { key: 'cijena', label: 'Cijena', words: ['cijen', 'jedinicn'], align: 'right', value: r => `${r.unitPrice.toFixed(2)} KM` },
        {
            key: 'iznos', label: 'Iznos', words: ['iznos', 'vrijednost', 'ukupna cijena', 'total', 'para', 'kostanj'], align: 'right',
            value: r => `${(r.qty * r.unitPrice).toFixed(2)} KM`,
            amount: r => ({ n: Math.round(r.qty * r.unitPrice * 100) / 100, unit: 'KM' }),
        },
        { key: 'status', label: 'Status', words: ['status'], value: r => r.status },
    ];
}

const MATERIAL_DEFAULT = ['materijal', 'kolicina', 'dobavljac'];

function materialWanted(material: string | undefined): (name: string) => boolean {
    if (!material?.trim()) return () => true;
    // „iveral" = vrsta (kao product_materials); inače dio naziva.
    const type = materialTypeFromName(material);
    return name => (type ? materialTypeFromName(name) === type : matchScore(material, [name]) >= 0.7);
}

export function materialsTable(rows: TableMaterialRow[], filter: MaterialTableFilter, asked: string[], opts: { day: string }): TableDoc {
    const catalog = materialColumns();
    const { columns, unknown } = pickColumns(asked, catalog, MATERIAL_DEFAULT);
    const keys = new Set(columns.map(c => c.def.key));
    const qtyOf = QTY[filter.status];
    const wanted = materialWanted(filter.material);
    const supplier = filter.supplier?.trim();

    const lines = new Map<string, MaterialLine>();
    for (const r of rows) {
        if (!wanted(r.name)) continue;
        if (supplier && matchScore(supplier, [r.supplier]) < 0.7) continue;
        const qty = qtyOf(r);
        if (filter.status !== 'sve' && qty <= 0) continue;
        const key = [r.projectId, foldText(r.name), foldText(r.unit), foldText(r.supplier), keys.has('proizvod') ? r.productName : ''].join('|');
        const line = lines.get(key);
        if (!line) {
            lines.set(key, { ...r, qty, products: [r.productName] });
            continue;
        }
        line.qty = roundQty(line.qty + qty);
        line.needed = roundQty(line.needed + r.needed);
        line.ordered = roundQty(line.ordered + r.ordered);
        line.received = roundQty(line.received + r.received);
        line.onStock = roundQty(line.onStock + r.onStock);
        line.inDrafts = roundQty(line.inDrafts + r.inDrafts);
        if (!line.products.includes(r.productName)) line.products.push(r.productName);
        if (line.status !== r.status) line.status = `${line.status}/${r.status}`;
    }

    // Po projektu, pa dobavljaču (lakše naručivanje), pa nazivu.
    const sorted = Array.from(lines.values()).sort((a, b) => byText(a.projectName, b.projectName)
        || byText(a.supplier || '~', b.supplier || '~') || byText(a.name, b.name));
    const projects = new Set(sorted.map(r => r.projectId)).size;
    const drafted = filter.status === 'za_naruciti' && !keys.has('nacrt') ? sorted.filter(r => r.inDrafts > 0).length : 0;

    return buildTable({
        title: MATERIAL_TITLE[filter.status],
        subtitle: [
            filter.scope, supplier ? cap(supplier) : '', filter.material?.trim() || '', rowsLabel(sorted.length), QTY_MEANING[filter.status],
        ].filter(Boolean).join(' · '),
        columns,
        rows: sorted,
        groupOf: !keys.has('projekat') && projects > 1 ? r => r.projectName : undefined,
        notes: [
            ...unknownNote(unknown, catalog),
            ...(drafted ? [`U nacrtu narudžbe (nije poslano): ${drafted} od ${sorted.length}.`] : []),
        ],
        day: opts.day,
    });
}
