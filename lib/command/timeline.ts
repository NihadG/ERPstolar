// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — JEDINSTVENA VREMENSKA OSA
//
// Pet izvora (nalozi, narudžbe, zadaci, rokovi projekata, planirano s
// Platna) se svode na JEDAN tip — TimelineItem. Tek tako se mogu složiti
// u isti red i uporediti; dok svaki izvor crta sebe, ne vidi se da nalog
// počinje prije nego što materijal stigne.
//
// Vizuelni jezik koji ovaj model nosi:
//   • boja  = koji projekat   (projectId → lib/canvas/palette)
//   • oblik = šta je          (kind)
//   • ispuna = u kojem stanju (state; kind 'plan' se crta kao obris)
//
// Stavka bez ijednog datuma se NE gubi — ide u `undated`, da se ne desi da
// nalog bez roka nestane s ekrana umjesto da vikne da mu rok fali.
// ════════════════════════════════════════════════════════════════════

import type { Order, PlanBlock, Project, Task, WorkOrder } from '../types';
import { isOrderPaused } from '../utils';
import { shiftDate, weekStart } from '../projectCommand';
import { isTaskOpen, type BoardScope } from './scope';
import { isPurchaseLate, isTaskLate, isWorkOrderLate, type LensSelection } from './signals';

export type TimelineKind = 'order' | 'purchase' | 'task' | 'deadline' | 'plan';
export type TimelineState = 'waiting' | 'running' | 'paused' | 'done' | 'cancelled';

export interface TimelineItem {
    /** Jedinstven u cijelom nizu (ista stavka se ponavlja po redovima). */
    id: string;
    kind: TimelineKind;
    state: TimelineState;
    projectId: string;
    /** Bez proizvoda = stavka na nivou projekta (ili zbirna traka grupe). */
    productId?: string;
    title: string;
    subtitle?: string;
    startISO: string;
    endISO: string;
    /** Tačka u vremenu (rok, zadatak, narudžba bez očekivane isporuke). */
    isPoint: boolean;
    /**
     * Rok stavke, kad je to DRUGI datum od kraja trake. Nalog se crta po
     * planu (Planned_Start → Planned_End), a sudi mu se po Due_Date; dok su
     * ta dva datuma bila stopljena, nalog planiran preko roka izgledao je
     * uredno. Sad se rok vidi kao zastavica, a prekoračenje kao crveni rep.
     */
    dueISO?: string;
    /** Udio završenih stavki naloga (0–1) — razlika između plana i stvarnog rada. */
    progress?: number;
    late: boolean;
    /** Stavka pripada i drugim projektima (nalog preko više projekata). */
    shared: boolean;
    /** Work_Order_ID | Order_ID | Task_ID | Project_ID | PlanBlock.id */
    refId: string;
}

export interface TimelineData {
    items: TimelineItem[];
    undated: TimelineItem[];
}

export interface TimelineInput {
    scope: BoardScope;
    today: string;
    planBlocks?: PlanBlock[];
    /** Prikaži i završeno/otkazano/primljeno. */
    showDone?: boolean;
}

const PLAN_KIND_LABELS: Record<PlanBlock['kind'], string> = {
    order: 'Proizvodnja', purchase: 'Nabavka', transport: 'Transport',
    montaza: 'Montaža', milestone: 'Rok', note: 'Napomena',
};

function workOrderState(wo: WorkOrder): TimelineState {
    if (wo.Status === 'Otkazano') return 'cancelled';
    if (wo.Status === 'Završeno') return 'done';
    if (wo.Status === 'U toku') return isOrderPaused(wo) ? 'paused' : 'running';
    return 'waiting';
}

function purchaseState(order: Order): TimelineState {
    if (order.Status === 'Primljeno') return 'done';
    if (order.Status === 'Poslano') return 'running';
    return 'waiting';
}

function taskState(task: Task): TimelineState {
    if (task.Status === 'cancelled') return 'cancelled';
    if (task.Status === 'completed') return 'done';
    if (task.Status === 'in_progress') return 'running';
    return 'waiting';
}

const day = (value?: string) => (value ? value.slice(0, 10) : '');

/** Kraj nikad prije početka — inače traka ima negativnu širinu i nestane. */
function span(start: string, end: string): { startISO: string; endISO: string } {
    return end && end < start ? { startISO: end, endISO: start } : { startISO: start, endISO: end || start };
}

export function buildTimeline({ scope, today, planBlocks = [], showDone = false }: TimelineInput): TimelineData {
    const items: TimelineItem[] = [];
    const undated: TimelineItem[] = [];
    const push = (item: TimelineItem) => (item.startISO ? items : undated).push(item);

    // ── Radni nalozi ─────────────────────────────────────────────────
    for (const wo of scope.workOrders) {
        const state = workOrderState(wo);
        if (!showDone && (state === 'done' || state === 'cancelled')) continue;
        const projectIds = scope.workOrderProjects.get(wo.Work_Order_ID) || [];
        const shared = projectIds.length > 1;
        // Rok je posljednja rezerva za početak: nalog koji ima SAMO rok se crta
        // kao tačka na tom danu, a ne ispada iz kalendara kao „bez roka".
        const end = day(wo.Planned_End_Date) || day(wo.Due_Date);
        // Datum kreiranja je kad je zapis nastao, a ne kad je posao zakazan.
        // Nalog bez ijednog planiranog datuma i bez roka zato ide u „bez roka",
        // umjesto da ga datum kreiranja odvuče u prošlost i prijavi kao kašnjenje.
        const start = day(wo.Planned_Start_Date) || day(wo.Started_At) || (end ? day(wo.Created_Date) : '') || end;
        const late = isWorkOrderLate(wo, today);
        const title = wo.Name || `Nalog ${wo.Work_Order_Number}`;
        const woItems = wo.items || [];
        const doneItems = woItems.filter(i => i.Status === 'Završeno').length;
        const due = day(wo.Due_Date);
        const bar = span(start, end || start);
        const base = {
            kind: 'order' as const, state, late, shared, refId: wo.Work_Order_ID, title,
            isPoint: !!start && (end || start) === start, ...bar,
            dueISO: due || undefined,
            progress: woItems.length ? doneItems / woItems.length : undefined,
        };

        for (const projectId of projectIds) {
            const productIds = Array.from(new Set((wo.items || [])
                .filter(i => i.Project_ID === projectId && i.Product_ID)
                .map(i => i.Product_ID)));
            push({ ...base, id: `wo:${wo.Work_Order_ID}:${projectId}`, projectId, subtitle: `#${wo.Work_Order_Number}` });
            for (const productId of productIds) {
                push({ ...base, id: `wo:${wo.Work_Order_ID}:${projectId}:${productId}`, projectId, productId, subtitle: `#${wo.Work_Order_Number}` });
            }
        }
    }

    // ── Narudžbe ─────────────────────────────────────────────────────
    for (const order of scope.orders) {
        const state = purchaseState(order);
        if (!showDone && state === 'done') continue;
        const start = day(order.Order_Date);
        const end = day(order.Expected_Delivery) || start;
        const late = isPurchaseLate(order, today);
        const title = order.Supplier_Name || order.Name || `Narudžba ${order.Order_Number}`;
        const base = {
            kind: 'purchase' as const, state, late, refId: order.Order_ID, title,
            isPoint: !order.Expected_Delivery || end === start, subtitle: `#${order.Order_Number}`,
            ...span(start, end),
        };
        const pairs = new Set<string>();
        for (const item of order.items || []) {
            if (!item.Project_ID || !scope.projectIds.has(item.Project_ID)) continue;
            pairs.add(`${item.Project_ID}|`);
            if (item.Product_ID) pairs.add(`${item.Project_ID}|${item.Product_ID}`);
        }
        const shared = new Set(Array.from(pairs).map(k => k.split('|')[0])).size > 1;
        for (const key of pairs) {
            const [projectId, productId] = key.split('|');
            push({ ...base, shared, id: `po:${order.Order_ID}:${key}`, projectId, productId: productId || undefined });
        }
    }

    // ── Zadaci ───────────────────────────────────────────────────────
    for (const task of scope.tasks) {
        const state = taskState(task);
        if (!showDone && !isTaskOpen(task)) continue;
        const projectId = scope.projects.find(p => taskTouches(task, p.Project_ID, scope))?.Project_ID;
        if (!projectId) continue;
        const productId = (task.Links || []).find(l => l.Entity_Type === 'product' && scope.productProject.has(l.Entity_ID))?.Entity_ID;
        const due = day(task.Due_Date);
        push({
            id: `task:${task.Task_ID}`, kind: 'task', state, projectId, productId,
            title: task.Title, subtitle: task.Assigned_Worker_Name,
            startISO: due, endISO: due, isPoint: true, late: isTaskLate(task, today),
            shared: false, refId: task.Task_ID,
        });
    }

    // ── Rokovi projekata ─────────────────────────────────────────────
    for (const project of scope.projects) {
        const deadline = day(project.Deadline);
        if (!deadline) continue;
        push({
            id: `deadline:${project.Project_ID}`, kind: 'deadline', state: 'waiting',
            projectId: project.Project_ID, title: 'Rok projekta',
            subtitle: project.Name || project.Client_Name,
            startISO: deadline, endISO: deadline, isPoint: true,
            late: deadline < today, shared: false, refId: project.Project_ID,
        });
    }

    // ── Planirano (Platno) ───────────────────────────────────────────
    for (const block of planBlocks) {
        const projectIds = planBlockProjects(block, scope);
        for (const projectId of projectIds) {
            const productIds = (block.productRefs || [])
                .map(ref => ref.id)
                .filter((id): id is string => !!id && scope.productProject.get(id) === projectId);
            const base = {
                kind: 'plan' as const, state: 'waiting' as const, late: false,
                shared: projectIds.length > 1, refId: block.id, title: block.title,
                subtitle: PLAN_KIND_LABELS[block.kind], isPoint: false,
                ...span(day(block.startISO), day(block.endISO)),
            };
            push({ ...base, id: `plan:${block.id}:${projectId}`, projectId });
            for (const productId of productIds) {
                push({ ...base, id: `plan:${block.id}:${projectId}:${productId}`, projectId, productId });
            }
        }
    }

    return { items, undated };
}

function taskTouches(task: Task, projectId: string, scope: BoardScope): boolean {
    return (task.Links || []).some(link =>
        (link.Entity_Type === 'project' && link.Entity_ID === projectId)
        || (link.Entity_Type === 'product' && scope.productProject.get(link.Entity_ID) === projectId)
        || (link.Entity_Type === 'work_order' && (scope.workOrderProjects.get(link.Entity_ID) || []).includes(projectId))
    );
}

/** Projekti s table kojih se plan-blok tiče (preko projekta, proizvoda ili naloga). */
export function planBlockProjects(block: PlanBlock, scope: BoardScope): string[] {
    const ids = new Set<string>();
    if (block.projectRef?.id && scope.projectIds.has(block.projectRef.id)) ids.add(block.projectRef.id);
    for (const ref of block.productRefs || []) {
        const projectId = ref.id ? scope.productProject.get(ref.id) : undefined;
        if (projectId) ids.add(projectId);
    }
    if (block.linkedWorkOrderId) {
        for (const projectId of scope.workOrderProjects.get(block.linkedWorkOrderId) || []) ids.add(projectId);
    }
    return Array.from(ids);
}

// ── Redovi i slaganje traka ─────────────────────────────────────────

export interface TimelineRow {
    key: string;
    /** 'project' je samo naslov grupe; trake žive u 'kind' ili 'product' redovima. */
    level: 'project' | 'kind' | 'product';
    projectId: string;
    productId?: string;
    label: string;
    sublabel?: string;
    /** Stavke reda s dodijeljenom trakom (lane) — bez preklapanja. */
    placed: { item: TimelineItem; lane: number }[];
    lanes: number;
}

export type RowGrouping = 'compact' | 'kind' | 'product';

export interface RowOptions {
    /**
     * Koliko sitno se projekat razlaže:
     *   compact — red projekta SAM nosi trake (najgušće, zadano)
     *   kind    — ispod projekta red po vrsti (Nalozi, Nabavka, …)
     *   product — ispod projekta red po poziciji
     */
    grouping?: RowGrouping;
    /** Projekti ručno razloženi po pozicijama, bez obzira na `grouping`. */
    expanded: Set<string>;
    from: string;
    to: string;
    /**
     * Koliko dana stavka rezerviše DESNO za svoj naziv. Tačka je široka
     * svega nekoliko piksela, a njen naziv stoji pored nje — bez ove rezerve
     * dvije tačke u razmaku od jednog dana završe u istoj traci i nazivi se
     * ispišu jedan preko drugog.
     */
    labelDays?: number;
    /** Traka kraća od ovoliko dana nosi naziv pored sebe, pa i ona rezerviše. */
    shortDays?: number;
}

/**
 * Trake se dijele PO VRSTI, svaka u svoj red. Dok su nalog, narudžba, plan i
 * rok dijelili isti red, slagali su se jedno preko drugog i nijedna traka nije
 * imala mjesta za naziv — gledalo se u niz šarenih mrlja. Ovako svaki red ima
 * jedno značenje, a lijeva kolona je ujedno i legenda.
 *
 * Razlaganje projekta prebacuje na red po POZICIJI (tamo je po vrsti nepotrebno
 * — jedna pozicija rijetko ima više od par stavki).
 */
const KIND_ROWS: { id: string; label: string; kinds: TimelineKind[] }[] = [
    { id: 'work', label: 'Nalozi', kinds: ['order'] },
    { id: 'supply', label: 'Nabavka', kinds: ['purchase'] },
    { id: 'plan', label: 'Planirano', kinds: ['plan'] },
    { id: 'dates', label: 'Rokovi i zadaci', kinds: ['deadline', 'task'] },
];

export function buildTimelineRows(items: TimelineItem[], scope: BoardScope, opts: RowOptions): TimelineRow[] {
    const inRange = items.filter(i => i.startISO <= opts.to && i.endISO >= opts.from);
    const rows: TimelineRow[] = [];
    const grouping = opts.grouping ?? 'compact';

    for (const project of scope.projects) {
        const mine = inRange.filter(i => i.projectId === project.Project_ID);
        const byProduct = opts.expanded.has(project.Project_ID) || grouping === 'product';
        const summary = mine.filter(i => !i.productId);
        const head = {
            key: `p:${project.Project_ID}`, level: 'project' as const, projectId: project.Project_ID,
            label: project.Name || project.Client_Name || 'Projekat',
            sublabel: project.Name ? project.Client_Name : undefined,
        };

        if (grouping === 'compact' && !byProduct) {
            // Red projekta sam nosi trake. Četiri reda po projektu (Nalozi,
            // Nabavka, Planirano, Rokovi) trošila su visinu na naslove koji
            // se ponavljaju kod svakog projekta, a trake su ionako razlikovane
            // oblikom i ikonom.
            rows.push(makeRow(opts, { ...head, items: summary }));
            continue;
        }

        if (byProduct) {
            // Rok projekta i nalozi bez pozicije nemaju svoj red po pozicijama —
            // bez ovoga bi nestali čim se projekat razloži.
            const orphans = summary.filter(i => !mine.some(m => m.productId && m.refId === i.refId));
            rows.push(makeRow(opts, { ...head, items: orphans }));
            for (const product of project.products || []) {
                const productItems = mine.filter(i => i.productId === product.Product_ID);
                if (productItems.length === 0) continue;
                rows.push(makeRow(opts, {
                    key: `pr:${product.Product_ID}`, level: 'product', projectId: project.Project_ID,
                    productId: product.Product_ID, label: product.Name || 'Proizvod',
                    sublabel: product.Quantity > 1 ? `×${product.Quantity}` : undefined,
                    items: productItems,
                }));
            }
            continue;
        }

        rows.push({ ...head, placed: [], lanes: 1 });
        for (const kindRow of KIND_ROWS) {
            const ofKind = summary.filter(i => kindRow.kinds.includes(i.kind));
            if (ofKind.length === 0) continue;
            rows.push(makeRow(opts, {
                key: `k:${project.Project_ID}:${kindRow.id}`, level: 'kind',
                projectId: project.Project_ID, label: kindRow.label, items: ofKind,
            }));
        }
    }
    return rows;
}

/** Rok koji pada izvan trake — zastavica se crta zasebno od nje. */
export function dueMarker(item: TimelineItem): { dateISO: string; overrun: boolean } | null {
    if (!item.dueISO || item.dueISO === item.endISO || item.isPoint) return null;
    return { dateISO: item.dueISO, overrun: item.dueISO < item.endISO };
}

function makeRow(opts: RowOptions, input: Omit<TimelineRow, 'placed' | 'lanes'> & { items: TimelineItem[] }): TimelineRow {
    const placed = packLanes(input.items, opts);
    const { items, ...rest } = input;
    return { ...rest, placed, lanes: placed.reduce((max, p) => Math.max(max, p.lane + 1), 0) };
}

/**
 * Pohlepno slaganje: stavka ide u prvu traku čija se zadnja stavka završila
 * prije nje. Tačke (rokovi, zadaci) zauzimaju jedan dan, pa se i one uredno
 * raspoređuju umjesto da sjede jedna na drugoj.
 */
export function packLanes(
    items: TimelineItem[],
    opts: { labelDays?: number; shortDays?: number; from?: string } = {},
): { item: TimelineItem; lane: number }[] {
    const labelDays = opts.labelDays ?? 0;
    const shortDays = opts.shortDays ?? 0;

    /**
     * Kraj koji stavka STVARNO zauzima — traka plus mjesto za naziv pored nje.
     *
     * Mjeri se VIDLJIVA širina: stavka koja je počela prije prikazanog raspona
     * na ekranu je kratka, pa i ona nosi naziv pored sebe. Dok se mjerio puni
     * raspon, takva traka nije rezervisala ništa i njen se naziv ispisivao
     * preko susjedne trake.
     */
    const occupiedEnd = (item: TimelineItem) => {
        if (labelDays <= 0) return item.endISO;
        const start = opts.from && item.startISO < opts.from ? opts.from : item.startISO;
        const span = Math.round((Date.parse(`${item.endISO}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
        return item.isPoint || span <= shortDays ? shiftDate(item.endISO, labelDays) : item.endISO;
    };

    const sorted = [...items].sort((a, b) =>
        a.startISO.localeCompare(b.startISO)
        || b.endISO.localeCompare(a.endISO)
        || a.title.localeCompare(b.title, 'bs'));
    const laneEnds: string[] = [];
    return sorted.map(item => {
        const end = occupiedEnd(item);
        let lane = laneEnds.findIndex(taken => taken < item.startISO);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(end); }
        else laneEnds[lane] = end;
        return { item, lane };
    });
}

// ── Raspon prikaza ──────────────────────────────────────────────────

/** Niz dana od ponedjeljka sidra, `weeks` sedmica unaprijed. */
export function timelineDays(anchorISO: string, weeks: number): string[] {
    const start = weekStart(anchorISO);
    return Array.from({ length: weeks * 7 }, (_, i) => shiftDate(start, i));
}

/** Dani mjeseca u kojem je `anchorISO`, poravnati na pune sedmice (pon–ned). */
export function monthDays(anchorISO: string): string[] {
    const first = `${anchorISO.slice(0, 7)}-01`;
    const start = weekStart(first);
    const nextMonth = new Date(`${first}T12:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const last = shiftDate(nextMonth.toISOString().slice(0, 10), -1);
    const end = shiftDate(weekStart(last), 6);
    const days: string[] = [];
    for (let cursor = start; cursor <= end; cursor = shiftDate(cursor, 1)) days.push(cursor);
    return days;
}

/** Indeks prve i zadnje kolone koju traka zauzima (1-bazirano, za CSS grid). */
export function barColumns(item: TimelineItem, days: string[]): { start: number; end: number } | null {
    if (!days.length || item.endISO < days[0] || item.startISO > days[days.length - 1]) return null;
    const from = Math.max(0, days.findIndex(d => d >= item.startISO));
    const toIndex = days.findIndex(d => d > item.endISO);
    const to = toIndex === -1 ? days.length : toIndex;
    return { start: from + 1, end: Math.max(from + 2, to + 1) };
}

/**
 * Suženje na aktivnu leću (puls). Svaka vrsta se provjerava protiv svog skupa
 * — nalog po nalogu, narudžba po narudžbi — da kalendar pokazuje tačno ono što
 * brojka u pulsu tvrdi. Rok projekta i planirano se vežu preko projekta, jer
 * nemaju vlastiti identitet u signalima.
 */
export function filterTimeline(data: TimelineData, sel: LensSelection | null): TimelineData {
    if (!sel) return data;
    const keep = (item: TimelineItem) => {
        switch (item.kind) {
            case 'order': return sel.workOrderIds.has(item.refId);
            case 'purchase': return sel.orderIds.has(item.refId);
            case 'task': return sel.taskIds.has(item.refId);
            default: return sel.projectIds.has(item.projectId);
        }
    };
    return { items: data.items.filter(keep), undated: data.undated.filter(keep) };
}
