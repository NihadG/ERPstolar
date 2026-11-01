// ════════════════════════════════════════════════════════════════════
// TABELE ZA BOT — ERP složi tabelu, model samo kaže šta (čisto)
//
// „Napravi tabelu za stanove i ogledala, u kolonama stan, umivaonik/ogledalo,
// dimenzije, količina, napomena": model izabere izvor i filter, a kolone,
// redove, redoslijed, grupe i zbir složi ERP. Model redove nikad ne vidi —
// nema izmišljenih ni preskočenih stavki, ma koliko tabela bila duga.
//
//   • kolone iz riječi: lib/tables/columns (naziv ili vrijednost polja)
//   • motor (filteri, redoslijed, grupe, praznine): lib/tables/engine
//   • izvori i njihova polja: lib/tables/sources
//   • PDF crta lib/server/tablePdf, šalje lib/assistant/tableDocuments
// jest: lib/__tests__/botTables.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from '@/lib/voice/text';
import { formatQty } from '@/lib/orderItemGroups';

export type Align = 'left' | 'right';

export interface ColumnDef<R> {
    key: string;
    label: string;
    /** Tekst ćelije; `picked` = ključevi izabranih kolona (npr. napomena bez stanja kad je stanje svoja kolona). */
    value: (row: R, picked: Set<string>) => string;
    /** Zbir na dnu; null = nepoznato (ne ulazi u zbir). Zbir samo kad je jedinica ista. */
    amount?: (row: R) => { n: number; unit: string } | null;
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

const ASCII = (s: string) => foldText(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export function tableFileName(title: string, day: string): string {
    return `Tabela_${ASCII(title) || 'erp'}_${day}.pdf`;
}

/** Zbir kolone kad svi poznati redovi imaju istu jedinicu („31 kom"); inače prazno. */
function columnTotal<R>(def: ColumnDef<R>, rows: R[]): string {
    if (!def.amount || !rows.length) return '';
    const amounts = rows.map(def.amount).filter((a): a is { n: number; unit: string } => !!a);
    const units = new Set(amounts.map(a => a.unit));
    if (!amounts.length || units.size !== 1) return '';
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
