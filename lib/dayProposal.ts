// ════════════════════════════════════════════════════════════════════
// PRIJEDLOG DANA I RUPE U UPISU — čista logika (bez Firebase)
//
// Večernji prijedlog: za svakog radnika ERP ponovi njegov ZADNJI POTVRĐENI
// dan (diktiran ili ručno upisan), uz tri ispravke:
//   • završen ili otkazan nalog i završeni proizvodi otpadaju,
//   • proces koji je u međuvremenu završen zamijeni sljedeći korak iz grafa,
//   • ko je danas odsutan (šihtarica) ili je već upisan, ne ulazi.
// Korisnik potvrdi jednim klikom; upis ide istim putem kao diktat.
//
// Rupe: radni dan za koji radnik koji se prati nema potvrđen upis, a nije
// bio odsutan. Prati se od radnikovog prvog diktata — prije toga je šihtarica
// bila jedini izvor i tamo rupe nisu greška.
// jest: lib/__tests__/dayProposal.test.ts
// ════════════════════════════════════════════════════════════════════

import { foldText } from './voice/text';
import { nodeMatchesProcess } from './productProcesses';
import { logSource } from './workHistory';
import type { ProcessGraph, WorkLog, WorkOrder, WorkOrderItem } from './types';

export const ABSENT = new Set(['Odsutan', 'Bolovanje', 'Odmor', 'Vikend', 'Praznik']);
const PRESENT = new Set(['Prisutan', 'Teren']);
/** Koliko unazad se traži radnikov zadnji potvrđeni dan. */
export const LOOKBACK_DAYS = 14;

export interface ProposalLine {
    workerIds: string[];
    workerNames: string[];
    workOrderId: string;
    workOrderName: string;
    itemIds: string[];
    /** Prazno = cijeli nalog (svi njegovi otvoreni proizvodi). */
    productNames: string[];
    process?: string;
    /** Proces je sljedeći korak (prethodni je završen), ne ponovljen. */
    next?: boolean;
    fraction?: number;
}

export interface DayProposal {
    date: string;
    lines: ProposalLine[];
    /** Već potvrđeno za taj dan. */
    booked: string[];
    absent: string[];
    /** Prisutni po šihtarici, ali bez ranijeg potvrđenog rada — treba ih izdiktirati. */
    unknown: string[];
}

type WorkerLite = { Worker_ID: string; Name: string };
type AttendanceLite = { Worker_ID: string; Date: string; Status: string };
type LogLite = Pick<WorkLog, 'Date' | 'Worker_ID' | 'Work_Order_ID' | 'Work_Order_Item_ID' | 'Process_Name' | 'Day_Weight'
    | 'Booking_Source' | 'Entry_Source' | 'Is_From_Attendance' | 'Work_Order_Deleted'>;
type OrderLite = Pick<WorkOrder, 'Work_Order_ID' | 'Status'> & Partial<Pick<WorkOrder, 'Name' | 'Work_Order_Number' | 'Process_Graph'>> & {
    items?: Pick<WorkOrderItem, 'ID' | 'Product_Name' | 'Status' | 'Processes'>[];
};

const day = (d: string) => String(d || '').slice(0, 10);
const confirmed = (l: LogLite) => !l.Work_Order_Deleted && logSource(l) !== 'auto';

function statusOf(att: AttendanceLite[], workerId: string, date: string): string | undefined {
    return att.find(a => a.Worker_ID === workerId && day(a.Date) === date)?.Status;
}

/** Sljedeći korak iza `process` za ove proizvode: prvi nasljednik u grafu koji nije završen na svima. */
function nextStep(graph: ProcessGraph | undefined, process: string, items: NonNullable<OrderLite['items']>): string | undefined {
    if (!graph?.nodes?.length) return undefined;
    const ids = new Set(items.map(i => i.ID));
    const covers = (n: ProcessGraph['nodes'][number]) => !(n.itemIds || []).length || n.itemIds.some(id => ids.has(id));
    const from = graph.nodes.find(n => covers(n) && nodeMatchesProcess(n, process));
    if (!from) return undefined;
    const doneOnAll = (name: string) => items.every(i => (i.Processes || []).some(p => foldText(p.Process_Name) === foldText(name) && p.Status === 'Završeno'));
    return graph.edges
        .filter(e => e.source === from.id)
        .map(e => graph.nodes.find(n => n.id === e.target))
        .find(n => n && covers(n) && foldText(n.name) !== 'rad' && !doneOnAll(n.name))?.name;
}

export function buildDayProposal(input: {
    date: string;
    workers: WorkerLite[];
    logs: LogLite[];
    attendance: AttendanceLite[];
    orders: OrderLite[];
}): DayProposal {
    const { date, workers, logs, attendance } = input;
    const orders = new Map(input.orders.map(o => [o.Work_Order_ID, o]));
    const out: DayProposal = { date, lines: [], booked: [], absent: [], unknown: [] };
    const perWorker: { worker: WorkerLite; lines: Omit<ProposalLine, 'workerIds' | 'workerNames'>[] }[] = [];

    for (const w of workers) {
        const status = statusOf(attendance, w.Worker_ID, date);
        if (status && ABSENT.has(status)) { out.absent.push(w.Name); continue; }
        const mine = logs.filter(l => l.Worker_ID === w.Worker_ID && confirmed(l));
        if (mine.some(l => day(l.Date) === date)) { out.booked.push(w.Name); continue; }
        const last = mine.map(l => day(l.Date)).filter(d => d < date).sort().at(-1);
        if (!last) { if (status && PRESENT.has(status)) out.unknown.push(w.Name); continue; }

        // Zadnji dan, po (nalog, proces): koji proizvodi i koliki udio dana.
        const groups = new Map<string, { woId: string; process?: string; itemIds: Set<string>; weight: number; weighted: boolean }>();
        for (const l of mine.filter(x => day(x.Date) === last)) {
            const process = l.Process_Name && foldText(l.Process_Name) !== 'rad' ? l.Process_Name : undefined;
            const key = `${l.Work_Order_ID}|${process || ''}`;
            const g = groups.get(key) || { woId: l.Work_Order_ID, process, itemIds: new Set<string>(), weight: 0, weighted: false };
            g.itemIds.add(l.Work_Order_Item_ID);
            if (typeof l.Day_Weight === 'number') { g.weight += l.Day_Weight; g.weighted = true; }
            groups.set(key, g);
        }

        const lines: (Omit<ProposalLine, 'workerIds' | 'workerNames'> & { weight?: number })[] = [];
        for (const g of Array.from(groups.values())) {
            const wo = orders.get(g.woId);
            if (!wo || wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
            const all = wo.items || [];
            const open = all.filter(i => g.itemIds.has(i.ID) && i.Status !== 'Završeno');
            if (!open.length) continue;
            let process = g.process;
            let next = false;
            if (process && open.every(i => (i.Processes || []).some(p => foldText(p.Process_Name) === foldText(process!) && p.Status === 'Završeno'))) {
                process = nextStep(wo.Process_Graph, process, open);
                next = !!process;
            }
            lines.push({
                workOrderId: wo.Work_Order_ID,
                workOrderName: wo.Name || wo.Work_Order_Number || 'Nalog',
                itemIds: open.map(i => i.ID).sort(),
                productNames: open.length < all.filter(i => i.Status !== 'Završeno').length ? open.map(i => i.Product_Name) : [],
                ...(process ? { process } : {}),
                ...(next ? { next } : {}),
                ...(g.weighted ? { weight: g.weight } : {}),
            });
        }
        if (!lines.length) { if (status && PRESENT.has(status)) out.unknown.push(w.Name); continue; }

        // Udio dana samo kad ostanu bar dva posla s udjelom — inače ravnomjerno (pun dan).
        const weighted = lines.filter(l => l.weight !== undefined);
        const total = weighted.reduce((s, l) => s + (l.weight || 0), 0);
        const keep = lines.length > 1 && weighted.length === lines.length && total > 0;
        perWorker.push({
            worker: w,
            lines: lines.map(({ weight, ...l }) => (keep ? { ...l, fraction: Math.round((weight! / total) * 100) / 100 } : l)),
        });
    }

    // Isti posao više radnika = jedan red.
    for (const { worker, lines } of perWorker) {
        for (const l of lines) {
            const key = (x: Omit<ProposalLine, 'workerIds' | 'workerNames'>) => [x.workOrderId, x.itemIds.join(','), x.process || '', x.next ? 1 : 0, x.fraction ?? ''].join('|');
            const same = out.lines.find(x => key(x) === key(l));
            if (same) { same.workerIds.push(worker.Worker_ID); same.workerNames.push(worker.Name); }
            else out.lines.push({ workerIds: [worker.Worker_ID], workerNames: [worker.Name], ...l });
        }
    }
    return out;
}

// ─── Rupe ─────────────────────────────────────────────────────────────

export interface DayGap { date: string; workers: string[] }

/** Radni dan: pon–pet; subota i nedjelja samo ako je neko po šihtarici radio. */
export function isWorkingDay(date: string, attendance: AttendanceLite[]): boolean {
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return true;
    return attendance.some(a => day(a.Date) === date && PRESENT.has(a.Status));
}

/**
 * Dani bez potvrđenog upisa u zadnjih `days` dana prije `today` (najnoviji prvi).
 * Radnik se prati od svog prvog diktata; odsutan dan nije rupa, a vikend je
 * rupa samo za radnika koji je tog dana u šihtarici prisutan.
 */
export function findGaps(input: {
    today: string;
    days: number;
    workers: WorkerLite[];
    logs: LogLite[];
    attendance: AttendanceLite[];
}): DayGap[] {
    const { today, workers, logs, attendance } = input;
    const since = new Map<string, string>();
    logs.filter(l => l.Entry_Source === 'telegram' && !l.Work_Order_Deleted).forEach(l => {
        const d = day(l.Date);
        const s = since.get(l.Worker_ID);
        if (!s || d < s) since.set(l.Worker_ID, d);
    });
    const gaps: DayGap[] = [];
    for (let i = 1; i <= input.days; i++) {
        const date = new Date(Date.parse(`${today}T12:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
        if (!isWorkingDay(date, attendance)) continue;
        const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
        const missing = workers.filter(w => {
            const start = since.get(w.Worker_ID);
            if (!start || date < start) return false;
            const status = statusOf(attendance, w.Worker_ID, date);
            if (status && ABSENT.has(status)) return false;
            // Vikendom radi samo ko je u šihtarici prisutan; ostali nisu rupa.
            if (weekend && !(status && PRESENT.has(status))) return false;
            return !logs.some(l => l.Worker_ID === w.Worker_ID && day(l.Date) === date && confirmed(l));
        });
        if (missing.length) gaps.push({ date, workers: missing.map(w => w.Name) });
    }
    return gaps;
}
