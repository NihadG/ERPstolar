// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA NALOGA — lista i detalj bez novca
//
// `WorkOrder` nosi Total_Value, Profit, Material_Cost i Actual_Labor_Cost;
// `WorkOrderItem` još i Product_Value i Profit_Overrides. Ništa od toga ne
// izlazi — izlaz se gradi NABRAJANJEM polja, nikad spreadom.
//
// Tok procesa dolazi iz `buildOrderFlowRows` (dijeli ga desktop), pa vlasnik
// i kontrolor gledaju identičan tok. `ProcRow` je već bez iznosa.
// ════════════════════════════════════════════════════════════════════

import { buildOrderFlowRows, type ProcRow } from '@/lib/orderProcessRows';
import { orderBoardRank } from '@/lib/processBoard';
import { daysUntil } from '@/lib/planning';
import { isOrderPaused, orderProcessProgress, workOrderDisplayName } from '@/lib/utils';
import type { ProcessGraph, Task, WorkOrder, WorkOrderItem } from '@/lib/types';
import { isTaskOpen, tasksForWorkOrder } from '@/lib/workOrderTasks';

// ─── Lista ────────────────────────────────────────────────────────────

export interface FieldOrderRow {
    orderId: string;
    name: string;
    number: string;
    type: string;
    status: string;
    projectId: string;
    projectName: string;
    itemCount: number;
    progressPct: number;
    dueDate: string | null;
    daysUntilDue: number | null;
    isPaused: boolean;
    /** Poredak za pogon: 0 = radi se danas … 3 = čeka. */
    rank: number;
    openTasks: number;
}

export interface FieldOrdersListInput {
    today: string;
    orders: WorkOrder[];              // sa `items`
    tasks: Task[];
    /** Nalozi na kojima je danas nešto proknjiženo — diže ih na vrh. */
    workedTodayOrderIds: Set<string>;
}

// Pauziranost = dijeljena definicija iz lib/utils (nalog je pauziran kad su
// SVE otvorene stavke pauzirane, a status naloga i dalje piše „U toku").

export function buildFieldOrdersList(input: FieldOrdersListInput): FieldOrderRow[] {
    const rows: FieldOrderRow[] = input.orders.map(wo => {
        const items = wo.items || [];
        const openTasks = tasksForWorkOrder(input.tasks, wo.Work_Order_ID).filter(isTaskOpen).length;

        return {
            orderId: wo.Work_Order_ID,
            name: workOrderDisplayName(wo),
            number: wo.Work_Order_Number || '',
            type: wo.Work_Order_Type || 'Proizvodnja',
            status: wo.Status,
            projectId: items.find(i => i.Project_ID)?.Project_ID || '',
            projectName: items.find(i => i.Project_Name)?.Project_Name || '',
            itemCount: items.length,
            progressPct: orderProcessProgress(items)?.pct ?? 0,
            dueDate: wo.Due_Date || null,
            daysUntilDue: daysUntil(wo.Due_Date, input.today),
            isPaused: isOrderPaused(wo),
            rank: orderBoardRank(
                { workOrder: wo, items: items.map(i => ({ Status: i.Status, Is_Paused: i.Is_Paused })) },
                input.workedTodayOrderIds
            ),
            openTasks,
        };
    });

    // Poredak za pogon: šta se radi danas → šta je u toku → pauzirano → čeka.
    // Unutar iste grupe najhitniji rok prvi.
    return rows.sort((a, b) =>
        a.rank - b.rank
        || (a.daysUntilDue ?? 9999) - (b.daysUntilDue ?? 9999)
        || a.name.localeCompare(b.name, 'bs')
    );
}

// ─── Detalj ───────────────────────────────────────────────────────────

export interface FieldOrderItemRow {
    itemId: string;
    productId: string;
    productName: string;
    projectName: string;
    quantity: number;
    status: string;
    isPaused: boolean;
    progressPct: number;
    /** Svi procesi stavke su završeni → može se zatvoriti proizvod. */
    canComplete: boolean;
}

export interface FieldOrderTask {
    taskId: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    assignedWorkerName: string | null;
    checklistDone: number;
    checklistTotal: number;
}

export interface FieldOrderDetail {
    orderId: string;
    name: string;
    number: string;
    type: string;
    status: string;
    projectName: string;
    notes: string;
    progressPct: number;
    dueDate: string | null;
    daysUntilDue: number | null;
    isPaused: boolean;
    /** Redovi toka — isti koje crta desktop. */
    flow: ProcRow[];
    items: FieldOrderItemRow[];
    tasks: FieldOrderTask[];
    /** Za izbor izvođača pri čekiranju procesa. */
    crew: { workerId: string; name: string }[];
}

export interface FieldOrderDetailInput {
    today: string;
    order: WorkOrder;                 // sa `items`
    graph?: ProcessGraph | null;
    tasks: Task[];
    workers: { Worker_ID: string; Name: string }[];
}

/** Ekipa naloga: dodijeljeni + oni koji su već radili neki proces. */
function crewOf(items: WorkOrderItem[]): Set<string> {
    const ids = new Set<string>();
    for (const it of items) {
        (it.Assigned_Workers || []).forEach(w => w.Worker_ID && ids.add(w.Worker_ID));
        (it.Processes || []).forEach(p => {
            if (p.Worker_ID) ids.add(p.Worker_ID);
            (p.Helpers || []).forEach(h => h.Worker_ID && ids.add(h.Worker_ID));
        });
    }
    return ids;
}

export function buildFieldOrderDetail(input: FieldOrderDetailInput): FieldOrderDetail {
    const wo = input.order;
    const items = wo.items || [];

    const flow = buildOrderFlowRows(items, input.graph);

    const itemRows: FieldOrderItemRow[] = items.map(it => {
        const procs = it.Processes || [];
        const done = procs.filter(p => p.Status === 'Završeno').length;
        return {
            itemId: it.ID,
            productId: it.Product_ID || '',
            productName: it.Product_Name || 'Proizvod',
            projectName: it.Project_Name || '',
            quantity: it.Quantity || 0,
            status: it.Status,
            isPaused: it.Is_Paused === true,
            progressPct: orderProcessProgress([it])?.pct ?? (it.Status === 'Završeno' ? 100 : 0),
            canComplete: it.Status !== 'Završeno' && procs.length > 0 && done === procs.length,
        };
    });

    const tasks: FieldOrderTask[] = tasksForWorkOrder(input.tasks, wo.Work_Order_ID).map(t => {
        const checklist = t.Checklist || [];
        return {
            taskId: t.Task_ID,
            title: t.Title,
            status: t.Status,
            priority: t.Priority,
            dueDate: t.Due_Date || null,
            assignedWorkerName: t.Assigned_Worker_Name || null,
            checklistDone: checklist.filter(c => c.completed).length,
            checklistTotal: checklist.length,
        };
    });

    // Ekipa prvo, pa ostali — kontrolor najčešće bira nekog ko je već na nalogu.
    const crewIds = crewOf(items);
    const crew = [...input.workers]
        .sort((a, b) => {
            const ca = crewIds.has(a.Worker_ID) ? 0 : 1;
            const cb = crewIds.has(b.Worker_ID) ? 0 : 1;
            return ca - cb || a.Name.localeCompare(b.Name, 'bs');
        })
        .map(w => ({ workerId: w.Worker_ID, name: w.Name }));

    return {
        orderId: wo.Work_Order_ID,
        name: workOrderDisplayName(wo),
        number: wo.Work_Order_Number || '',
        type: wo.Work_Order_Type || 'Proizvodnja',
        status: wo.Status,
        projectName: items.find(i => i.Project_Name)?.Project_Name || '',
        notes: wo.Notes || '',
        progressPct: orderProcessProgress(items)?.pct ?? 0,
        dueDate: wo.Due_Date || null,
        daysUntilDue: daysUntil(wo.Due_Date, input.today),
        isPaused: isOrderPaused(wo),
        flow,
        items: itemRows,
        tasks,
        crew,
    };
}
