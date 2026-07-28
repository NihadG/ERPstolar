// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA ZA POGONSKI EKRAN — jedino što radnik i kontrolor ikad vide
//
// Zašto projekcija a ne direktan Firestore: pravila umiju zabraniti DOKUMENT,
// ali ne i POLJE. `work_orders` nosi Total_Value, Profit, Material_Cost — da
// radnik čita tu kolekciju, novac bi mu stigao u browser bez obzira što ga UI
// ne crta. Zato pogonske uloge nemaju pristup Firestoreu uopšte (vidi
// firestore.rules), a ovaj modul sastavlja uzak payload bez ijednog iznosa.
//
// Funkcija je ČISTA (bez Firebasea) da se politika vidljivosti može testirati
// i da se, kad se dogovori „šta ko smije vidjeti", mijenja SAMO ovdje.
//
// INVARIJANTA (pokrivena testom): nijedno novčano polje ne smije se pojaviti u
// izlazu. Izlaz se gradi nabrajanjem polja, NIKAD spreadom ulaznog dokumenta —
// spread bi tiho propustio svako novo polje koje neko kasnije doda na nalog.
// ════════════════════════════════════════════════════════════════════

import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { workOrderDisplayName, orderProcessProgress } from '@/lib/utils';
import { daysUntil } from '@/lib/planning';
import type {
    ItemProcessStatus, Task, User, Worker, WorkerAttendance, WorkLog, WorkOrder, WorkOrderItem, UserRole,
} from '@/lib/types';

// ─── Izlazni oblik ────────────────────────────────────────────────────

export interface FieldProcessRef {
    name: string;
    status: string;
}

export interface FieldAssignment {
    itemId: string;
    orderId: string;
    orderName: string;
    orderNumber: string;
    orderType: string;
    projectName: string;
    productName: string;
    quantity: number;
    status: string;
    isPaused: boolean;
    /** Prvi nezavršen proces — ono što radnik danas radi. */
    currentProcess: string | null;
    processes: FieldProcessRef[];
    progressPct: number;
    dueDate: string | null;
    daysUntilDue: number | null;
}

export interface FieldTask {
    taskId: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    orderName: string | null;
    checklistDone: number;
    checklistTotal: number;
}

export interface FieldCheckRow {
    orderId: string;
    orderName: string;
    orderNumber: string;
    projectName: string;
    productName: string;
    itemId: string;
    processName: string;
    completedAt: string | null;
    workerName: string | null;
}

export interface FieldOrderRow {
    orderId: string;
    orderName: string;
    orderNumber: string;
    orderType: string;
    projectName: string;
    status: string;
    progressPct: number;
    itemCount: number;
    dueDate: string | null;
    daysUntilDue: number | null;
}

export interface FieldHomePayload {
    generatedAt: string;
    today: string;
    /** true kad vlasnik gleda tuđi ekran kroz „Pogledaj kao" — sve akcije se gase. */
    preview: boolean;
    user: {
        name: string;
        role: UserRole;
        roleLabel: string;
        workerName: string | null;
        workerRole: string | null;
        mustChangePassword: boolean;
        hasWorkerLink: boolean;
    };
    organization: { name: string };
    attendance: { status: string | null };
    week: { workedDays: number; presentDays: number; from: string; to: string };
    assignments: FieldAssignment[];
    tasks: FieldTask[];
    /** Samo za kontrolora — prazno za radnika. */
    awaitingCheck: FieldCheckRow[];
    activeOrders: FieldOrderRow[];
}

// ─── Ulaz ─────────────────────────────────────────────────────────────

export interface FieldHomeInput {
    today: string;                    // YYYY-MM-DD
    preview?: boolean;
    user: Pick<User, 'Name' | 'Role' | 'Worker_ID' | 'Must_Change_Password'>;
    organizationName: string;
    worker: Worker | null;
    workOrders: WorkOrder[];          // sa `items`
    tasks: Task[];
    attendance: WorkerAttendance[];   // zapisi radnika (bilo koji period; filtriramo ovdje)
    workLogs: WorkLog[];              // zapisi radnika (bilo koji period; filtriramo ovdje)
}

const ROLE_LABEL: Record<UserRole, string> = {
    owner: 'Vlasnik', admin: 'Administrator', manager: 'Menadžer',
    controller: 'Kontrolor', worker: 'Radnik',
};

const dOnly = (iso?: string | null): string => (iso ? iso.split('T')[0] : '');

/** Ponedjeljak…nedjelja sedmice u kojoj je `today`. */
export function weekBounds(today: string): { from: string; to: string } {
    const base = new Date(today + 'T00:00:00');
    const dow = (base.getDay() + 6) % 7;           // 0 = ponedjeljak
    const from = new Date(base); from.setDate(base.getDate() - dow);
    const to = new Date(from); to.setDate(from.getDate() + 6);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: iso(from), to: iso(to) };
}

/** Prvi proces koji nije završen — to je ono na čemu se trenutno radi. */
export function currentProcessName(processes?: ItemProcessStatus[]): string | null {
    if (!processes?.length) return null;
    const open = processes.find(p => p.Status !== 'Završeno');
    return (open?.Process_Name || null);
}

function itemProgressPct(item: WorkOrderItem): number {
    const p = orderProcessProgress([item]);
    return p?.pct ?? (item.Status === 'Završeno' ? 100 : 0);
}

const isOpenOrder = (wo: WorkOrder) => wo.Status === 'U toku' || wo.Status === 'Na čekanju';

/**
 * Sastavi payload pogonske početne stranice.
 *
 * Radnik dobija SVOJE stavke (dodjela preko Assigned_Workers / Processes / SubTasks —
 * ista definicija koju koristi auto-knjiženje, da se „moj posao" ne razilazi između
 * šihtarice i pogonskog ekrana).
 *
 * Kontrolor dodatno dobija pregled aktivnih naloga i procesa nedavno označenih
 * završenim. Sama radnja kontrole (potvrdi/vrati) NIJE implementirana — payload
 * postoji da se ekran može ocijeniti prije nego se modul razvije.
 */
export function buildFieldHome(input: FieldHomeInput): FieldHomePayload {
    const { today, user, worker, workOrders, tasks, attendance, workLogs } = input;
    const role = user.Role;
    const workerId = worker?.Worker_ID || user.Worker_ID || null;
    const week = weekBounds(today);

    // ── Prisustvo danas ──────────────────────────────────────────────
    const todayAttendance = workerId
        ? attendance.find(a => a.Worker_ID === workerId && dOnly(a.Date) === today)
        : undefined;

    // ── Sedmica: radni dani i prisustvo (BEZ zarade) ─────────────────
    const weekLogs = workLogs.filter(l =>
        (!workerId || l.Worker_ID === workerId) && dOnly(l.Date) >= week.from && dOnly(l.Date) <= week.to
    );
    const workedDays = new Set(weekLogs.map(l => dOnly(l.Date))).size;
    const presentDays = attendance.filter(a =>
        (!workerId || a.Worker_ID === workerId)
        && dOnly(a.Date) >= week.from && dOnly(a.Date) <= week.to
        && (a.Status === 'Prisutan' || a.Status === 'Teren')
    ).length;

    // ── Moje stavke ──────────────────────────────────────────────────
    const assignments: FieldAssignment[] = [];
    if (workerId) {
        for (const wo of workOrders) {
            if (!isOpenOrder(wo)) continue;
            const orderName = workOrderDisplayName(wo);
            const dd = daysUntil(wo.Due_Date, today);

            for (const item of wo.items || []) {
                if (item.Status === 'Završeno') continue;
                if (!isWorkerAssignedToAutoItem(item as any, workerId)) continue;

                assignments.push({
                    itemId: item.ID,
                    orderId: wo.Work_Order_ID,
                    orderName,
                    orderNumber: wo.Work_Order_Number || '',
                    orderType: wo.Work_Order_Type || 'Proizvodnja',
                    projectName: item.Project_Name || '',
                    productName: item.Product_Name || '',
                    quantity: item.Quantity || 0,
                    status: item.Status,
                    isPaused: item.Is_Paused === true,
                    currentProcess: currentProcessName(item.Processes),
                    processes: (item.Processes || []).map(p => ({
                        name: p.Process_Name, status: p.Status,
                    })),
                    progressPct: itemProgressPct(item),
                    dueDate: wo.Due_Date || null,
                    daysUntilDue: dd,
                });
            }
        }
        // Najhitniji rok gore; stavke bez roka na kraj.
        assignments.sort((a, b) =>
            (a.daysUntilDue ?? 9999) - (b.daysUntilDue ?? 9999) || a.productName.localeCompare(b.productName, 'bs')
        );
    }

    // ── Moji zadaci ──────────────────────────────────────────────────
    const orderNameById = new Map(workOrders.map(wo => [wo.Work_Order_ID, workOrderDisplayName(wo)]));
    const myTasks: FieldTask[] = (workerId ? tasks.filter(t => t.Assigned_Worker_ID === workerId) : [])
        .filter(t => t.Status !== 'completed' && t.Status !== 'cancelled')
        .map(t => {
            const link = t.Links?.find(l => l.Entity_Type === 'work_order');
            const checklist = t.Checklist || [];
            return {
                taskId: t.Task_ID,
                title: t.Title,
                status: t.Status,
                priority: t.Priority,
                dueDate: t.Due_Date || null,
                orderName: link ? (orderNameById.get(link.Entity_ID) || link.Entity_Name || null) : null,
                checklistDone: checklist.filter(c => c.completed).length,
                checklistTotal: checklist.length,
            };
        })
        .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

    // ── Kontrolor: aktivni nalozi + procesi koji čekaju kontrolu ─────
    const isController = role === 'controller';
    const activeOrders: FieldOrderRow[] = isController
        ? workOrders.filter(wo => wo.Status === 'U toku').map(wo => {
            const items = wo.items || [];
            return {
                orderId: wo.Work_Order_ID,
                orderName: workOrderDisplayName(wo),
                orderNumber: wo.Work_Order_Number || '',
                orderType: wo.Work_Order_Type || 'Proizvodnja',
                projectName: items.find(i => i.Project_Name)?.Project_Name || '',
                status: wo.Status,
                progressPct: orderProcessProgress(items)?.pct ?? 0,
                itemCount: items.length,
                dueDate: wo.Due_Date || null,
                daysUntilDue: daysUntil(wo.Due_Date, today),
            };
        }).sort((a, b) => (a.daysUntilDue ?? 9999) - (b.daysUntilDue ?? 9999))
        : [];

    // Procesi završeni u zadnjih 7 dana — dok modul kontrole ne postoji, ovo je
    // NAJBLIŽA aproksimacija „čeka kontrolu". Kad se uvede pravo stanje procesa,
    // mijenja se samo ovaj blok.
    const awaitingCheck: FieldCheckRow[] = [];
    if (isController) {
        const cutoff = new Date(today + 'T00:00:00');
        cutoff.setDate(cutoff.getDate() - 7);
        const cutoffISO = cutoff.toISOString().split('T')[0];

        for (const wo of workOrders) {
            if (wo.Status !== 'U toku') continue;
            const orderName = workOrderDisplayName(wo);
            for (const item of wo.items || []) {
                for (const p of item.Processes || []) {
                    if (p.Status !== 'Završeno') continue;
                    const done = dOnly(p.Completed_At);
                    if (!done || done < cutoffISO) continue;
                    awaitingCheck.push({
                        orderId: wo.Work_Order_ID,
                        orderName,
                        orderNumber: wo.Work_Order_Number || '',
                        projectName: item.Project_Name || '',
                        productName: item.Product_Name || '',
                        itemId: item.ID,
                        processName: p.Process_Name,
                        completedAt: p.Completed_At || null,
                        workerName: p.Worker_Name || null,
                    });
                }
            }
        }
        awaitingCheck.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    }

    return {
        generatedAt: new Date().toISOString(),
        today,
        preview: input.preview === true,
        user: {
            name: user.Name || '',
            role,
            roleLabel: ROLE_LABEL[role] || role,
            workerName: worker?.Name || null,
            workerRole: worker?.Role || null,
            mustChangePassword: user.Must_Change_Password === true,
            hasWorkerLink: !!workerId,
        },
        organization: { name: input.organizationName },
        attendance: { status: todayAttendance?.Status || null },
        week: { workedDays, presentDays, from: week.from, to: week.to },
        assignments,
        tasks: myTasks,
        awaitingCheck,
        activeOrders,
    };
}
