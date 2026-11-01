// ════════════════════════════════════════════════════════════════════
// TABELE ZA BOT — ERP složi tabelu, model samo kaže šta (čisto)
//
// „Napravi tabelu za stanove i ogledala, u kolonama stan, umivaonik/ogledalo,
// dimenzije, količina, napomena": model izabere izvor i filter, a kolone,
// redove, redoslijed, grupe i zbir složi ERP. Model redove nikad ne vidi —
// nema izmišljenih ni preskočenih stavki, ma koliko tabela bila duga.
//
//   • kolone: ERP ih sam pročita iz poruke („u kolonama …", „u tabeli …"),
//     riječ korisnika → kolona izvora po rječniku; zaglavlje ostaje
//     korisnikovim riječima. Nepoznata riječ se javi, ne pogađa se.
//   • izvori (lib/tables/sources): bilježnica, materijali projekata.
//   • PDF crta lib/server/tablePdf, šalje lib/assistant/tableDocuments.
// jest: lib/__tests__/botTables.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText, stem } from '@/lib/voice/text';
import { formatQty } from '@/lib/orderItemGroups';

export type Align = 'left' | 'right';

export interface ColumnDef<R> {
    key: string;
    label: string;
    /** Riječi korisnika za kolonu, bez kvačica, kao početak riječi („dimenz", „za narucit"). */
    words: string[];
    /** Tekst ćelije; `picked` = ključevi izabranih kolona (napomena bez stanja kad je stanje svoja kolona). */
    value: (row: R, picked: Set<string>) => string;
    /** Zbir na dnu — samo kad je jedinica ista u svim redovima. */
    amount?: (row: R) => { n: number; unit: string };
    align?: Align;
}

export interface PickedColumn<R> {
    def: ColumnDef<R>;
    label: string;
}

export interface TableColumn {
    key: string;
    label: string;
    align: Align;
}

export interface TableGroup {
    /** Zaglavlje grupe („E lamela", projekat); prazno = bez zaglavlja. */
    label: string;
    rows: string[][];
}

export interface TableDoc {
    title: string;
    /** Šta je ERP razumio: filter, broj redova — korisnik odmah vidi pogrešan filter. */
    subtitle: string;
    columns: TableColumn[];
    groups: TableGroup[];
    /** Red zbira poravnat s kolonama; null kad nema šta sabrati. */
    total: string[] | null;
    notes: string[];
    rowCount: number;
    fileName: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Kolone iz poruke ─────────────────────────────────────────────────

const CLAUSE = /(?:kolon\w*|u tabel\w*|tabel\w*\s+(?:sa|s)\s|polj\w*)\s*(?:su\s|:|-)?\s*([^.?!\n]+)/i;
const TAIL = /\s+(?:ili\s+(?:sta|šta)\s+god|i\s+tako|itd|i\s+slicno|i\s+slično)\b.*$/i;

/**
 * Kolone kako ih je korisnik nabrojao: „u kolonama stan, umivaonik/ogledalo, dimenzije"
 * → ["stan", "umivaonik/ogledalo", "dimenzije"]. Bez zareza nije nabrajanje → [].
 */
export function requestedColumns(text: string): string[] {
    const m = CLAUSE.exec(text || '');
    if (!m) return [];
    let list = m[1];
    if (list.includes(':')) list = list.slice(list.lastIndexOf(':') + 1);
    list = list.replace(TAIL, '');
    if (!list.includes(',')) return [];
    return list
        .split(/[,;]|\s+i\s+|\s+te\s+/)
        .map(s => s.trim().replace(/^(i|a|pa)\s+/i, '').replace(/\s+/g, ' '))
        .filter(s => s.length > 0 && s.length <= 30);
}

function startsWord(part: string, syn: string): boolean {
    return ` ${part}`.includes(` ${syn}`);
}

/**
 * Riječi korisnika → kolone izvora. Najduža pogođena riječ pobjeđuje („za naručiti"
 * je količina, ne „naručeno"). `extra` dodaje riječi koloni (predmeti iz filtera:
 * „umivaonik/ogledalo" je kolona predmeta). Ista kolona dvaput → jednom.
 */
export function resolveColumns<R>(asked: string[], catalog: ColumnDef<R>[], extra: Record<string, string[]> = {}): { picked: PickedColumn<R>[]; unknown: string[] } {
    const picked: PickedColumn<R>[] = [];
    const unknown: string[] = [];
    for (const said of asked) {
        const parts = said.split('/').map(p => foldText(p).replace(/\s+/g, ' ').trim()).filter(Boolean);
        let best: ColumnDef<R> | null = null;
        let bestLen = 0;
        for (const def of catalog) {
            for (const syn of [...def.words, ...(extra[def.key] || [])]) {
                if (syn.length > bestLen && parts.some(p => startsWord(p, syn))) {
                    best = def;
                    bestLen = syn.length;
                }
            }
        }
        if (!best) {
            unknown.push(said);
            continue;
        }
        if (picked.some(p => p.def.key === best!.key)) continue;
        const own = foldText(said).trim() === foldText(best.label).trim();
        picked.push({ def: best, label: own ? best.label : cap(said.trim()) });
    }
    return { picked, unknown };
}

/** Predmeti iz filtera kao riječi kolone („ogledala" → „ogledal"). */
export function subjectWords(subjects: string[]): string[] {
    return subjects.map(s => stem(foldText(s).trim().split(' ')[0] || '')).filter(w => w.length >= 3);
}

/** Kolone izvora po ključu (podrazumijevane kad korisnik nije rekao kolone). */
export function columnsByKey<R>(catalog: ColumnDef<R>[], keys: string[]): PickedColumn<R>[] {
    return keys.map(k => catalog.find(c => c.key === k)).filter((d): d is ColumnDef<R> => !!d).map(def => ({ def, label: def.label }));
}

// ─── Slaganje ─────────────────────────────────────────────────────────

const ASCII = (s: string) => foldText(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export function tableFileName(title: string, day: string): string {
    return `Tabela_${ASCII(title) || 'erp'}_${day}.pdf`;
}

/** Zbir kolone kad svi redovi imaju istu jedinicu („31 kom"); inače prazno. */
function columnTotal<R>(def: ColumnDef<R>, rows: R[]): string {
    if (!def.amount || !rows.length) return '';
    const amounts = rows.map(def.amount);
    const units = new Set(amounts.map(a => a.unit));
    if (units.size !== 1) return '';
    const unit = amounts[0].unit;
    const sum = amounts.reduce((s, a) => s + a.n, 0);
    return `${unit === 'KM' ? sum.toFixed(2) : formatQty(sum)}${unit ? ` ${unit}` : ''}`;
}

export function buildTable<R>(input: {
    title: string;
    subtitle: string;
    columns: PickedColumn<R>[];
    /** Redovi već sortirani; grupe idu redom prvog pojavljivanja. */
    rows: R[];
    groupOf?: (row: R) => string;
    notes?: string[];
    day: string;
}): TableDoc {
    const keys = new Set(input.columns.map(c => c.def.key));
    const groups: TableGroup[] = [];
    for (const row of input.rows) {
        const label = input.groupOf ? input.groupOf(row) : '';
        let g = groups.find(x => x.label === label);
        if (!g) {
            g = { label, rows: [] };
            groups.push(g);
        }
        g.rows.push(input.columns.map(c => c.def.value(row, keys)));
    }
    const totals = input.columns.map(c => columnTotal(c.def, input.rows));
    return {
        title: input.title,
        subtitle: input.subtitle,
        columns: input.columns.map(c => ({ key: c.def.key, label: c.label, align: c.def.align || 'left' })),
        groups,
        total: totals.some(Boolean) ? totals : null,
        notes: input.notes || [],
        rowCount: input.rows.length,
        fileName: tableFileName(input.title, input.day),
    };
}

/** „1 red", „3 reda", „12 redova". */
export function rowsLabel(n: number): string {
    const last = n % 10;
    const lastTwo = n % 100;
    if (last === 1 && lastTwo !== 11) return `${n} red`;
    if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${n} reda`;
    return `${n} redova`;
}
