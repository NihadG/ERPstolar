// ════════════════════════════════════════════════════════════════════
// RADNIKOVA PROJEKCIJA — nalozi, projekti i efikasnost jednog radnika
//
// Nadogradnja nad postojećim projekcijama (fieldOrders, fieldProjects): iste
// funkcije, ali suženo na ONO ŠTO SE RADNIKA TIČE — naloge na kojima ima
// stavku i projekte u kojima ima proizvod. Ostali proizvodi projekta se ne
// prikazuju (dogovor: radnik vidi samo svoje).
//
// „Moj posao" = ista definicija kao auto-knjiženje (isWorkerAssignedToAutoItem),
// da se pogon i šihtarica nikad ne raziđu.
//
// EFIKASNOST je namjerno SUPTILNA: brojke stoje jedna pored druge, bez ijedne
// ocjene, poređenja s drugima ili rečenice u drugom licu. Zaključak izvodi
// radnik. Zato „Tempo" prikazuje planirano/utrošeno/moj-udio ODVOJENO — dijeljenje
// bi lažno pripisalo timski trošak jednom čovjeku.
//
// INVARIJANTA (test): nijedan iznos ne izlazi. Izlaz se gradi nabrajanjem polja.
// ════════════════════════════════════════════════════════════════════

import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { plannedVsActualDays } from '@/lib/planning';
import { buildFieldOrdersList, type FieldOrderRow, type FieldOrdersListInput } from './fieldOrders';
import { buildFieldProjectDetail, isMaterialReady, type FieldProductDetail, type FieldProjectDetail } from './fieldProjects';
import { weekBounds } from './fieldHome';
import type { Project, Task, WorkerAttendance, WorkLog, WorkOrder, WorkOrderItem } from '@/lib/types';

const dOnly = (iso?: string | null): string => (iso ? iso.split('T')[0] : '');

// ─── Skup „mojih" stavki / proizvoda ──────────────────────────────────

/** Stavke naloga na kojima je radnik dodijeljen (bilo koji status). */
export function myAssignedItems(orders: WorkOrder[], workerId: string): WorkOrderItem[] {
    const out: WorkOrderItem[] = [];
    for (const wo of orders) {
        for (const item of wo.items || []) {
            if (isWorkerAssignedToAutoItem(item as any, workerId)) out.push(item);
        }
    }
    return out;
}

/** Proizvodi (Product_ID) na kojima radnik ima stavku — za filter projekata. */
export function myProductIds(orders: WorkOrder[], workerId: string): Set<string> {
    const ids = new Set<string>();
    for (const item of myAssignedItems(orders, workerId)) {
        if (item.Product_ID) ids.add(item.Product_ID);
    }
    return ids;
}

// ─── Nalozi ───────────────────────────────────────────────────────────

export interface WorkerOrdersInput {
    today: string;
    workerId: string;
    orders: WorkOrder[];              // sa `items`
    tasks: Task[];
    workedTodayOrderIds: Set<string>;
}

/**
 * Nalozi na kojima radnik ima BAR JEDNU nezavršenu stavku. Cijeli nalog je
 * vidljiv (radnik prati tok, ne samo svoj komad), ali lista se sužava na
 * njegove — da mu se pogon ne pretrpa tuđim nalozima.
 */
export function buildWorkerOrders(input: WorkerOrdersInput): FieldOrderRow[] {
    const mine = input.orders.filter(wo =>
        (wo.items || []).some(it =>
            it.Status !== 'Završeno' && isWorkerAssignedToAutoItem(it as any, input.workerId)
        )
    );
    const listInput: FieldOrdersListInput = {
        today: input.today,
        orders: mine,
        tasks: input.tasks,
        workedTodayOrderIds: input.workedTodayOrderIds,
    };
    return buildFieldOrdersList(listInput);
}

// ─── Projekti ─────────────────────────────────────────────────────────

/** Proizvod je spreman kad su SVI materijali spremni (i ima ih). */
function productReady(prod: FieldProductDetail): boolean {
    return prod.materialsTotal > 0 && prod.materialsReady === prod.materialsTotal;
}

export interface WorkerProjectsInput {
    workerId: string;
    projects: Project[];             // sa `products`, svaki proizvod sa `materials`
    productIds: Set<string>;         // proizvodi na kojima radnik ima stavku
}

/**
 * Projekti u kojima radnik ima proizvod, i unutar njih SAMO ti proizvodi.
 * Brojači projekta se preračunavaju na suženi skup (inače bi „3/8 spremno"
 * lagalo o radnikovom dijelu posla).
 */
export function buildWorkerProjects(input: WorkerProjectsInput): FieldProjectDetail[] {
    return input.projects
        .filter(p => !p.Hidden)
        .map(p => {
            const full = buildFieldProjectDetail(p);
            const products = full.products.filter(prod => input.productIds.has(prod.productId));
            return {
                ...full,
                products,
                productCount: products.length,
                productsReady: products.filter(productReady).length,
            };
        })
        .filter(pd => pd.products.length > 0)
        .sort((a, b) =>
            (a.deadline || '9999').localeCompare(b.deadline || '9999')
            || a.name.localeCompare(b.name, 'bs')
        );
}

// ─── Efikasnost ───────────────────────────────────────────────────────

export interface WorkerTempoRow {
    productName: string;
    projectName: string;
    /** Planirano radnik-dana za proizvod (dani × radnici) — TIMSKA veličina. */
    plannedDays: number;
    /** Stvarno utrošeno radnik-dana (Σ svih radnika) — TIMSKA veličina. */
    actualDays: number;
    /** Koliko od toga je radnikovih dana (Σ njegov Day_Fraction). */
    myDays: number;
}

export interface WorkerRhythmWeek {
    from: string;
    label: string;                   // npr. „12.–18.7."
    bookedDays: number;              // Σ Day_Fraction radnika te sedmice
    presentDays: number;             // dani Prisutan/Teren te sedmice
    isCurrent: boolean;
}

export interface WorkerEfficiency {
    month: string;                   // YYYY-MM
    workedDays: number;              // jedinstveni datumi s dnevnicom (mjesec)
    presentDays: number;            // Prisutan + Teren (mjesec)
    productsWorked: number;          // jedinstveni Product_ID (mjesec)
    tempo: WorkerTempoRow[];         // proizvodi na kojima je radio ovaj mjesec
    rhythm: WorkerRhythmWeek[];      // zadnjih 8 sedmica, uklj. tekuću
}

export interface WorkerEfficiencyInput {
    today: string;
    workerId: string;
    monthFrom: string;               // prvi dan tekućeg mjeseca (YYYY-MM-DD)
    monthTo: string;                 // zadnji dan tekućeg mjeseca
    /** Radnikove dnevnice kroz cijeli prozor (8 sedmica ⊇ mjesec). */
    workLogs: WorkLog[];
    /** Dnevnice SVIH radnika za stavke kojih se radnik dotakao ovaj mjesec. */
    itemLogs: WorkLog[];
    /** Radnikovo prisustvo kroz cijeli prozor. */
    attendance: WorkerAttendance[];
    /** Stavke kojih se radnik dotakao — za planirane dane i nazive. */
    items: WorkOrderItem[];
}

const shortDay = (iso: string): string => {
    const d = new Date(iso + 'T12:00:00');
    return `${d.getDate()}.${d.getMonth() + 1}.`;
};

export function buildWorkerEfficiency(input: WorkerEfficiencyInput): WorkerEfficiency {
    const { workerId, monthFrom, monthTo, today } = input;
    const inMonth = (iso?: string | null) => {
        const d = dOnly(iso);
        return d >= monthFrom && d <= monthTo;
    };

    const myMonthLogs = input.workLogs.filter(l => l.Worker_ID === workerId && inMonth(l.Date));
    const workedDays = new Set(myMonthLogs.map(l => dOnly(l.Date))).size;
    const productsWorked = new Set(myMonthLogs.map(l => l.Product_ID).filter(Boolean)).size;
    const presentDays = input.attendance.filter(a =>
        a.Worker_ID === workerId && inMonth(a.Date) && (a.Status === 'Prisutan' || a.Status === 'Teren')
    ).length;

    // ── Tempo po stavci ──────────────────────────────────────────────
    // Stavke kojih se radnik dotakao ovaj mjesec (preko svojih dnevnica).
    const myItemIds = new Set(myMonthLogs.map(l => l.Work_Order_Item_ID).filter(Boolean));
    const itemById = new Map(input.items.map(it => [it.ID, it]));

    const tempo: WorkerTempoRow[] = [];
    for (const itemId of myItemIds) {
        const item = itemById.get(itemId);
        if (!item) continue;

        const planned = plannedVsActualDays([item as any]).planned;
        const actualDays = input.itemLogs
            .filter(l => l.Work_Order_Item_ID === itemId)
            .reduce((s, l) => s + (l.Day_Fraction ?? 1), 0);
        const myDays = myMonthLogs
            .filter(l => l.Work_Order_Item_ID === itemId)
            .reduce((s, l) => s + (l.Day_Fraction ?? 1), 0);

        tempo.push({
            productName: item.Product_Name || 'Proizvod',
            projectName: item.Project_Name || '',
            plannedDays: round1(planned),
            actualDays: round1(actualDays),
            myDays: round1(myDays),
        });
    }
    // Najviše mog rada gore.
    tempo.sort((a, b) => b.myDays - a.myDays);

    // ── Ritam: zadnjih 8 sedmica ─────────────────────────────────────
    const rhythm: WorkerRhythmWeek[] = [];
    const thisWeek = weekBounds(today);
    for (let i = 7; i >= 0; i--) {
        const anchor = new Date(thisWeek.from + 'T00:00:00');
        anchor.setDate(anchor.getDate() - i * 7);
        const wb = weekBounds(toISO(anchor));
        const weekLogs = input.workLogs.filter(l =>
            l.Worker_ID === workerId && dOnly(l.Date) >= wb.from && dOnly(l.Date) <= wb.to
        );
        const bookedDays = weekLogs.reduce((s, l) => s + (l.Day_Fraction ?? 1), 0);
        const presentInWeek = input.attendance.filter(a =>
            a.Worker_ID === workerId && dOnly(a.Date) >= wb.from && dOnly(a.Date) <= wb.to
            && (a.Status === 'Prisutan' || a.Status === 'Teren')
        ).length;

        rhythm.push({
            from: wb.from,
            label: `${shortDay(wb.from)}–${shortDay(wb.to)}`,
            bookedDays: round1(bookedDays),
            presentDays: presentInWeek,
            isCurrent: wb.from === thisWeek.from,
        });
    }

    return {
        month: monthFrom.slice(0, 7),
        workedDays,
        presentDays,
        productsWorked,
        tempo,
        rhythm,
    };
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

function toISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
