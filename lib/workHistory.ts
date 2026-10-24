// ════════════════════════════════════════════════════════════════════
// ISTORIJA RADA — čista logika (bez Firebase)
//
// Iz dnevnica (work_logs), statusa procesa na stavkama i grafa naloga složi
// dva pogleda za nalog ili jedan proizvod:
//   • po procesima — redom toka: kad se radilo, ko, koliko radnik-dana i
//     na čemu se zasniva (upisano / procjena iz prisustva / pretpostavljeno /
//     samo čekirano)
//   • po danima — hronologija: ko je šta radio, plus završeni procesi tog dana
//
// Zapisi iz prisustva (automatska podjela) nose POGOĐEN proces, pa se nikad
// ne miješaju s upisanim: red koji ima samo njih je „procjena".
// jest: lib/__tests__/workHistory.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from './voice/text';
import type { ItemProcessStatus, ProcessGraph, WorkLog, WorkOrderItem } from './types';

export type LogSource = 'dictated' | 'manual' | 'auto';
export type ProcessState = 'done' | 'active' | 'waiting';
/** Na čemu se zasniva red: upisan rad › procjena iz prisustva › pretpostavka › samo čekirano. */
export type ProcessBasis = 'logged' | 'estimated' | 'assumed' | 'checked' | 'none';

export interface HistoryWorker { id: string; name: string; days: number }

export interface ProcessHistoryRow {
    name: string;
    /** Rad upisan bez procesa — nema stanje ni proizvode, samo radnike i dane. */
    unassigned: boolean;
    state: ProcessState;
    basis: ProcessBasis;
    from?: string;
    to?: string;
    workers: HistoryWorker[];
    /** Radnik-dana (zbir udjela dana). */
    days: number;
    doneProducts: number;
    totalProducts: number;
}

export interface DayWorkEntry {
    workerId: string;
    workerName: string;
    processes: string[];
    products: string[];
    share: number;
    source: LogSource;
}

export interface DayMilestone {
    process: string;
    products: string[];
    assumed: boolean;
}

export interface HistoryDay {
    date: string;
    work: DayWorkEntry[];
    completed: DayMilestone[];
}

export interface HistorySummary {
    days: number;
    workers: number;
    workerDays: number;
    from?: string;
    to?: string;
}

type ItemLite = Pick<WorkOrderItem, 'ID' | 'Product_ID' | 'Product_Name' | 'Processes'>;
type LogLite = Pick<WorkLog, 'Date' | 'Worker_ID' | 'Worker_Name' | 'Work_Order_Item_ID' | 'Process_Name' | 'Process_Tags'
    | 'Day_Fraction' | 'Hours_Worked' | 'Booking_Source' | 'Entry_Source' | 'Is_From_Attendance' | 'Work_Order_Deleted'>;

const NO_PROCESS = 'Bez procesa';
const key = (s: string) => foldText(s || '');

export function logSource(l: Pick<WorkLog, 'Entry_Source' | 'Booking_Source' | 'Is_From_Attendance'>): LogSource {
    if (l.Entry_Source === 'telegram') return 'dictated';
    if (l.Booking_Source === 'attendance' || (l.Booking_Source !== 'manual' && l.Is_From_Attendance)) return 'auto';
    return 'manual';
}

/** Udio dana zapisa; stari zapisi bez udjela → iz sati. */
function share(l: LogLite): number {
    if (typeof l.Day_Fraction === 'number' && l.Day_Fraction > 0) return l.Day_Fraction;
    return l.Hours_Worked > 0 ? l.Hours_Worked / 8 : 1;
}

function logProcesses(l: LogLite): string[] {
    const names = [l.Process_Name, ...(l.Process_Tags || [])].map(n => (n || '').trim()).filter(Boolean);
    return names.length ? Array.from(new Set(names)) : [NO_PROCESS];
}

function scope<T extends ItemLite>(items: T[], logs: LogLite[], itemId?: string) {
    const its = itemId ? items.filter(i => i.ID === itemId) : items;
    const ids = new Set(its.map(i => i.ID));
    return { items: its, logs: logs.filter(l => !l.Work_Order_Deleted && ids.has(l.Work_Order_Item_ID)) };
}

/**
 * Procesi grafa redom toka; grana se čita do kraja prije sljedeće (iveral pa
 * furnir, ne naizmjenično). Čvor „Rad" je generički i ne ulazi.
 */
function graphOrder(graph: ProcessGraph | undefined, itemIds: Set<string>): { name: string; aliases: string[]; itemIds: string[] }[] {
    const nodes = (graph?.nodes || []).filter(n => key(n.name) !== 'rad' && (!(n.itemIds || []).length || n.itemIds.some(id => itemIds.has(id))));
    const ids = new Set(nodes.map(n => n.id));
    const indeg = new Map(nodes.map(n => [n.id, 0]));
    (graph?.edges || []).forEach(e => { if (ids.has(e.source) && ids.has(e.target)) indeg.set(e.target, (indeg.get(e.target) || 0) + 1); });
    const out: typeof nodes = [];
    const queue = nodes.filter(n => !indeg.get(n.id));
    while (queue.length) {
        const n = queue.shift()!;
        out.push(n);
        const ready: typeof nodes = [];
        (graph?.edges || []).filter(e => e.source === n.id && ids.has(e.target)).forEach(e => {
            indeg.set(e.target, (indeg.get(e.target) || 0) - 1);
            if (!indeg.get(e.target)) ready.push(nodes.find(x => x.id === e.target)!);
        });
        queue.unshift(...ready);
    }
    return (out.length === nodes.length ? out : nodes).map(n => ({
        name: n.name, aliases: n.aliases?.length ? n.aliases : [n.name], itemIds: (n.itemIds || []).length ? n.itemIds : Array.from(itemIds),
    }));
}

const minDate = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);
const maxDate = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);
const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);

export function buildProcessHistory(
    items: ItemLite[],
    graph: ProcessGraph | undefined,
    workLogs: LogLite[],
    itemId?: string,
): ProcessHistoryRow[] {
    const s = scope(items, workLogs, itemId);
    const itemIds = new Set(s.items.map(i => i.ID));

    // Redovi: graf → procesi stavki → procesi iz dnevnica (po prvom datumu) → bez procesa.
    const rows: { name: string; keys: Set<string>; items: Set<string> }[] = [];
    const rowOf = new Map<string, (typeof rows)[number]>();
    const add = (name: string, aliases: string[], ids: string[]) => {
        let row = aliases.map(key).map(k => rowOf.get(k)).find(Boolean);
        if (!row) { row = { name, keys: new Set(), items: new Set() }; rows.push(row); }
        aliases.forEach(a => { row!.keys.add(key(a)); rowOf.set(key(a), row!); });
        ids.filter(id => itemIds.has(id)).forEach(id => row!.items.add(id));
    };
    graphOrder(graph, itemIds).forEach(n => add(n.name, n.aliases, n.itemIds));
    s.items.forEach(i => (i.Processes || []).forEach(p => add(p.Process_Name, [p.Process_Name], [i.ID])));
    [...s.logs].sort((a, b) => a.Date.localeCompare(b.Date)).forEach(l => {
        logProcesses(l).filter(n => n !== NO_PROCESS).forEach(n => add(n, [n], [l.Work_Order_Item_ID]));
    });
    if (s.logs.some(l => logProcesses(l)[0] === NO_PROCESS)) add(NO_PROCESS, [NO_PROCESS], []);

    const statusOf = (item: ItemLite, row: (typeof rows)[number]): ItemProcessStatus | undefined =>
        (item.Processes || []).find(p => row.keys.has(key(p.Process_Name)));

    return rows.map(row => {
        const mine = s.logs.filter(l => logProcesses(l).some(n => row.keys.has(key(n))));
        mine.forEach(l => row.items.add(l.Work_Order_Item_ID));
        const unassigned = row.name === NO_PROCESS;
        const covering = unassigned ? [] : s.items.filter(i => row.items.has(i.ID));
        const statuses = covering.map(i => statusOf(i, row));
        const doneProducts = statuses.filter(p => p?.Status === 'Završeno').length;
        const confirmed = mine.filter(l => logSource(l) !== 'auto');

        const workers = new Map<string, HistoryWorker>();
        let days = 0;
        let from: string | undefined, to: string | undefined;
        for (const l of mine) {
            const part = share(l) / logProcesses(l).length;
            days += part;
            const w = workers.get(l.Worker_ID) || { id: l.Worker_ID, name: l.Worker_Name, days: 0 };
            w.days += part;
            workers.set(l.Worker_ID, w);
            from = minDate(from, l.Date);
            to = maxDate(to, l.Date);
        }
        if (!mine.length) {
            statuses.forEach(p => { from = minDate(from, day(p?.Started_At || p?.Completed_At)); to = maxDate(to, day(p?.Completed_At || p?.Started_At)); });
        }

        const state: ProcessState = covering.length && doneProducts === covering.length ? 'done'
            : mine.length || statuses.some(p => p?.Status === 'U toku' || p?.Status === 'Završeno') ? 'active' : 'waiting';
        const done = statuses.filter(p => p?.Status === 'Završeno');
        const basis: ProcessBasis = confirmed.length ? 'logged'
            : mine.length ? 'estimated'
                : done.length && done.every(p => p?.Assumed_Done) ? 'assumed'
                    : done.length ? 'checked' : 'none';

        return {
            name: row.name, unassigned, state, basis, from, to,
            workers: Array.from(workers.values()).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'bs')),
            days, doneProducts, totalProducts: covering.length,
        };
    });
}

export function buildDayHistory(items: ItemLite[], workLogs: LogLite[], itemId?: string): HistoryDay[] {
    const s = scope(items, workLogs, itemId);
    const nameOf = new Map(s.items.map(i => [i.ID, i.Product_Name]));
    const days = new Map<string, HistoryDay>();
    const dayOf = (date: string) => {
        let d = days.get(date);
        if (!d) { d = { date, work: [], completed: [] }; days.set(date, d); }
        return d;
    };

    // Jedan red po (radnik, procesi, izvor): isti posao na više proizvoda se spaja.
    for (const l of s.logs) {
        const d = dayOf(l.Date);
        const processes = logProcesses(l);
        const source = logSource(l);
        const product = nameOf.get(l.Work_Order_Item_ID) || '';
        const entry = d.work.find(w => w.workerId === l.Worker_ID && w.source === source && w.processes.join('|') === processes.join('|'));
        if (entry) {
            entry.share += share(l);
            if (product && !entry.products.includes(product)) entry.products.push(product);
        } else {
            d.work.push({ workerId: l.Worker_ID, workerName: l.Worker_Name, processes, products: product ? [product] : [], share: share(l), source });
        }
    }

    for (const item of s.items) {
        for (const p of item.Processes || []) {
            if (p.Status !== 'Završeno' || !p.Completed_At) continue;
            const d = dayOf(p.Completed_At.slice(0, 10));
            const assumed = !!p.Assumed_Done;
            const m = d.completed.find(x => key(x.process) === key(p.Process_Name) && x.assumed === assumed);
            if (m) m.products.push(item.Product_Name);
            else d.completed.push({ process: p.Process_Name, products: [item.Product_Name], assumed });
        }
    }

    return Array.from(days.values())
        .map(d => ({ ...d, work: d.work.sort((a, b) => a.workerName.localeCompare(b.workerName, 'bs')) }))
        .sort((a, b) => b.date.localeCompare(a.date));
}

export function historySummary(items: ItemLite[], workLogs: LogLite[], itemId?: string): HistorySummary {
    const { logs } = scope(items, workLogs, itemId);
    return {
        days: new Set(logs.map(l => l.Date)).size,
        workers: new Set(logs.map(l => l.Worker_ID)).size,
        workerDays: logs.reduce((sum, l) => sum + share(l), 0),
        from: logs.reduce<string | undefined>((m, l) => minDate(m, l.Date), undefined),
        to: logs.reduce<string | undefined>((m, l) => maxDate(m, l.Date), undefined),
    };
}
