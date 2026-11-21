// ════════════════════════════════════════════════════════════════════
// PLATNO · MODEL RASPOREDA — PREOSTALI RAD STVARNIH NALOGA
//
// Stvarni nalog u toku zauzima svoje radnike samo za posao koji MU JOŠ FALI,
// a ne do roka upisanog pri kreiranju (rok zastari, posao se završi ranije ili
// kasnije). Preostalo = planirani radnik-dani − upisano u Knjigu rada, po stavci
// koja nije završena. Taj ostatak se slaže na kalendar radnika naloga od danas
// (prvo stariji nalozi), i to je `fixedLoad` modela: dio dana koji radnik ne
// može dati planu.
//
// Radnici naloga = dodijeljeni na otvorenim stavkama + oni na otvorenom procesu
// (i pomoćnici). Ostatak dijele redom po danu, koliko ko ima slobodnog.
//
// Kad nalog nema plan dana (ponuda bez dana rada), ostatak se NE pogađa: nalog
// ne zauzima nikoga i prijavljuje se kao „bez plana" — rok upisan pri kreiranju
// nije mjera preostalog posla (zbog toga je stari raspored držao 7 ljudi do roka).
// Kad je upisano više od plana, ostatak je 0 i nalog se prijavljuje kao
// „prekoračen" — vlasnik zna da tu još ima posla koji plan ne vidi.
//
// Blokovi Platna povezani sa stvarnim nalogom (linkedWorkOrderId) su već u
// scenariju, pa se ti nalozi preskaču da se rad ne broji dvaput. Isto važi za
// stavke čiji proizvod plan već nosi kao blok (productRefs), i kad blok nije povezan.
//
// Čista funkcija, bez Firebase i Reacta. jest: lib/__tests__/platnoKalendari.test.ts
// ════════════════════════════════════════════════════════════════════

import { itemPlannedDays } from '../../planning';
import type { WorkerCalendar } from './calendar';
import { isoAt } from './instance';

export interface RemainingItem {
    ID?: string;
    Product_ID?: string;
    Status?: string;
    Quantity?: number;
    Planned_Labor_Days?: number;
    Planned_Labor_Workers?: number;
    Actual_Labor_Days?: number;
    Assigned_Workers?: { Worker_ID?: string }[];
    Processes?: { Status?: string; Worker_ID?: string; Helpers?: { Worker_ID?: string }[] }[];
}

export interface RemainingWorkOrder {
    Work_Order_ID: string;
    Work_Order_Number?: string;
    Name?: string;
    Status: string;
    Started_At?: string;
    Created_Date?: string;
    Due_Date?: string;
    items?: RemainingItem[];
}

export interface RemainingLog {
    Work_Order_Item_ID?: string;
    Day_Fraction?: number;
    Work_Order_Deleted?: boolean;
}

export type RemainingSource = 'plan' | 'prekoracen' | 'bez-plana' | 'bez-radnika';

export interface RemainingOrder {
    workOrderId: string;
    label: string;
    workerIds: string[];
    /** Planirani radnik-dani otvorenih stavki. */
    planned: number;
    /** Upisano u Knjigu rada na otvorenim stavkama. */
    booked: number;
    /** Radnik-dana koje model drži zauzetim. */
    remaining: number;
    source: RemainingSource;
    /** Zadnji dan na kojem nalog još drži nekog radnika (ako drži). */
    untilISO?: string;
}

export interface RemainingInput {
    workOrders: RemainingWorkOrder[];
    /** Knjiga rada; bez nje se čita Actual_Labor_Days sa stavki. */
    workLogs?: RemainingLog[];
    calendar: WorkerCalendar;
    startISO: string;
    horizonDays?: number;
    /** Nalozi koje scenarij već nosi kao blok (linkedWorkOrderId). */
    skipWorkOrderIds?: Iterable<string>;
    /**
     * Proizvodi koje scenarij već nosi kao blok (productRefs) — njihove stavke stvarnih naloga
     * se ne broje, inače bi isti posao zauzeo radnike dvaput (blok + stvarni nalog).
     */
    skipProductIds?: Iterable<string>;
}

export interface RemainingResult {
    orders: RemainingOrder[];
    /** Dio dana (0..1) koji radnik daje stvarnim nalozima. */
    fixedLoad(workerId: string, iso: string): number;
}

const CLOSED = new Set(['Završeno', 'Otkazano']);
const OPEN_PROCESS = new Set(['U toku', 'Na čekanju']);
const EPS = 1e-6;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Radnici koji nose otvorene stavke: dodijeljeni + oni na otvorenom procesu. */
function orderWorkers(items: RemainingItem[]): string[] {
    const ids = new Set<string>();
    for (const it of items) {
        (it.Assigned_Workers || []).forEach(w => w.Worker_ID && ids.add(w.Worker_ID));
        (it.Processes || []).filter(p => OPEN_PROCESS.has(p.Status || '')).forEach(p => {
            if (p.Worker_ID) ids.add(p.Worker_ID);
            (p.Helpers || []).forEach(h => h.Worker_ID && ids.add(h.Worker_ID));
        });
    }
    return Array.from(ids).sort();
}

export function remainingWork(input: RemainingInput): RemainingResult {
    const horizon = input.horizonDays ?? 365;
    const skip = new Set(input.skipWorkOrderIds || []);
    const skipProducts = new Set(input.skipProductIds || []);
    const booked = new Map<string, number>();
    for (const l of input.workLogs || []) {
        if (l.Work_Order_Deleted || !l.Work_Order_Item_ID) continue;
        booked.set(l.Work_Order_Item_ID, (booked.get(l.Work_Order_Item_ID) || 0) + (l.Day_Fraction ?? 1));
    }
    const used = new Map<string, Map<string, number>>();
    const usedOf = (w: string, iso: string) => used.get(w)?.get(iso) || 0;
    const take = (w: string, iso: string, x: number) => {
        let m = used.get(w);
        if (!m) { m = new Map(); used.set(w, m); }
        m.set(iso, (m.get(iso) || 0) + x);
    };
    const free = (w: string, iso: string) => Math.max(0, input.calendar.available(w, iso) - usedOf(w, iso));

    const open = input.workOrders
        .filter(wo => !CLOSED.has(wo.Status) && !skip.has(wo.Work_Order_ID))
        .sort((a, b) => ((a.Started_At || a.Created_Date || '').localeCompare(b.Started_At || b.Created_Date || ''))
            || a.Work_Order_ID.localeCompare(b.Work_Order_ID));

    const orders: RemainingOrder[] = [];
    for (const wo of open) {
        const items = (wo.items || []).filter(it => !CLOSED.has(it.Status || '') && !(it.Product_ID && skipProducts.has(it.Product_ID)));
        if (!items.length) continue;
        const workerIds = orderWorkers(items);
        let planned = 0, done = 0, left = 0, withoutPlan = 0;
        for (const it of items) {
            const p = itemPlannedDays(it) * (it.Planned_Labor_Workers || 1);
            const b = input.workLogs ? (it.ID ? booked.get(it.ID) || 0 : 0) : (it.Actual_Labor_Days || 0);
            done += b;
            if (p <= 0) { withoutPlan++; continue; }
            planned += p;
            left += Math.max(0, p - b);
        }
        const label = [wo.Work_Order_Number, wo.Name].filter(Boolean).join(' ') || wo.Work_Order_ID;
        const row: RemainingOrder = { workOrderId: wo.Work_Order_ID, label, workerIds, planned: r2(planned), booked: r2(done), remaining: 0, source: 'plan' };
        orders.push(row);
        if (planned <= 0 && withoutPlan) { row.source = 'bez-plana'; continue; }
        if (!workerIds.length) { row.source = 'bez-radnika'; continue; }
        if (left <= EPS) { row.source = 'prekoracen'; continue; }

        let rest = left;
        for (let i = 0; i < horizon && rest > EPS; i++) {
            const iso = isoAt(input.startISO, i);
            for (const w of workerIds) {
                if (rest <= EPS) break;
                const x = Math.min(free(w, iso), rest);
                if (x > EPS) { take(w, iso, x); rest -= x; row.untilISO = iso; }
            }
        }
        row.remaining = r2(left - rest);
    }

    return { orders, fixedLoad: usedOf };
}

/** Kratak opis za izvještaj ocjene. */
export function remainingLines(orders: RemainingOrder[]): string[] {
    const d = (iso?: string) => iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.` : '';
    return orders.map(o => {
        if (o.source === 'plan') return `${o.label}: ostalo ${r2(o.remaining)} od ${o.planned} rd → zauzima radnike do ${d(o.untilISO)}`;
        if (o.source === 'prekoracen') return `${o.label}: upisano ${o.booked} rd, plan ${o.planned} — prekoračen, ostatak nepoznat (ne zauzima)`;
        if (o.source === 'bez-radnika') return `${o.label}: ostalo ${r2(Math.max(0, o.planned - o.booked))} rd, ali nema dodijeljenih radnika — ne zauzima`;
        return `${o.label}: bez plana dana — ne zauzima radnike (upiši dane rada u nalog da ih plan vidi)`;
    });
}
