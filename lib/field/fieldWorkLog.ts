// ════════════════════════════════════════════════════════════════════
// KNJIGA RADA — projekcija za telefon
//
// Desktop `WorkOrderWorkLog` crta istu stvar iz sirovih `work_logs` dokumenata,
// koji nose `Daily_Rate` i `Original_Daily_Rate`. Pogonu to ne smije doći, a
// vlasniku smije — pa je novac ovdje OPCIONO polje koje ruta puni samo kad je
// pozivalac staff (`includeCost`). Bez tog prekidača bi ista projekcija ili
// procurila cijene kontroloru ili osakatila vlasnika.
//
// Dan je uređen isto kao na desktopu (`buildWorkTimeline`) — ista funkcija, isti
// tipovi dana. Ovdje se samo zapisi grupišu PO RADNIKU, jer telefon pokazuje
// „ko je radio", a ne red po red po proizvodu.
// ════════════════════════════════════════════════════════════════════

import { buildWorkTimeline, type PausePeriodLite, type TimelineLog, type WorkDayType } from '@/lib/workOrderTimeline';
import type { WorkLog, WorkOrder, WorkOrderItem } from '@/lib/types';
import { workOrderDisplayName } from '@/lib/utils';

export interface FieldWorkLogWorker {
    workerId: string;
    name: string;
    /** ½ ili cijeli dan — ista vrijednost koju nosi svaki zapis tog radnika za taj dan. */
    presence: number;
    /** Stavke naloga na koje je taj dan knjižen. */
    itemIds: string[];
    /** Trošak rada tog radnika na ovom nalogu tog dana — samo za staff. */
    cost?: number;
}

export interface FieldWorkLogDay {
    date: string;
    dayType: WorkDayType;
    workers: FieldWorkLogWorker[];
    cost?: number;
}

export interface FieldWorkLogItem {
    itemId: string;
    productName: string;
    done: boolean;
}

export interface FieldWorkLogPayload {
    orderId: string;
    name: string;
    number: string;
    status: string;
    today: string;
    /** Pogon vidi ko je radio, vlasnik i koliko je to koštalo. */
    canSeeMoney: boolean;
    items: FieldWorkLogItem[];
    /** Prijedlog ekipe: dodijeljeni radnici naloga, pa zadnja proknjižena ekipa. */
    crew: { workerId: string; name: string }[];
    days: FieldWorkLogDay[];
    workingDays: number;
    totalCost?: number;
}

export interface BuildFieldWorkLogInput {
    today: string;
    order: WorkOrder;
    items: WorkOrderItem[];
    logs: WorkLog[];
    /** Imena radnika iz evidencije — denormalizovano ime na zapisu može biti staro. */
    workerNames: Map<string, string>;
    includeCost: boolean;
}

const dOnly = (iso?: string | null): string => (iso ? iso.split('T')[0] : '');
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pauze naloga — iz stavki i njihovih podzadataka, isto kao desktop. */
function pausePeriodsOf(items: WorkOrderItem[]): PausePeriodLite[] {
    const out: PausePeriodLite[] = [];
    for (const it of items) {
        (it.Pause_Periods || []).forEach(p => out.push(p));
        (it.SubTasks || []).forEach(st => (st.Pause_Periods || []).forEach(p => out.push(p)));
    }
    return out;
}

/**
 * Zadana ekipa: radnici dodijeljeni stavkama naloga; ako ih nema, ekipa
 * zadnjeg proknjiženog dana. Isti fallback kao desktop `assignedWorkerIds`.
 */
function crewOf(items: WorkOrderItem[], logs: WorkLog[], names: Map<string, string>): { workerId: string; name: string }[] {
    const ids: string[] = [];
    const add = (id?: string) => { if (id && !ids.includes(id)) ids.push(id); };

    for (const it of items) {
        (it.Assigned_Workers || []).forEach(w => add(w.Worker_ID));
        (it.Processes || []).forEach(p => add((p as { Worker_ID?: string }).Worker_ID));
    }
    if (ids.length === 0 && logs.length > 0) {
        const lastDate = logs.map(l => dOnly(l.Date)).sort().slice(-1)[0];
        logs.filter(l => dOnly(l.Date) === lastDate).forEach(l => add(l.Worker_ID));
    }

    return ids.map(id => ({ workerId: id, name: names.get(id) || '' })).filter(w => w.name);
}

export function buildFieldWorkLog(input: BuildFieldWorkLogInput): FieldWorkLogPayload {
    const { order, items, logs, workerNames, includeCost, today } = input;

    const timelineLogs: TimelineLog[] = logs.map(l => ({
        Date: dOnly(l.Date),
        Worker_ID: l.Worker_ID,
        Worker_Name: l.Worker_Name || workerNames.get(l.Worker_ID) || '',
        Daily_Rate: l.Daily_Rate || 0,
        Product_ID: l.Product_ID,
        Work_Order_Item_ID: l.Work_Order_Item_ID,
    }));

    const timeline = buildWorkTimeline({
        logs: timelineLogs,
        startedAt: order.Started_At,
        completedAt: order.Completed_At,
        createdDate: order.Created_Date,
        pausePeriods: pausePeriodsOf(items),
        today: new Date(today + 'T12:00:00'),
    });

    // Prisutnost i stavke po (dan, radnik) — čitaju se iz sirovih zapisa, jer
    // `TimelineLog` namjerno nosi samo ono što desktop timeline treba.
    const presenceByKey = new Map<string, number>();
    const itemsByKey = new Map<string, string[]>();
    for (const l of logs) {
        const key = `${dOnly(l.Date)}|${l.Worker_ID}`;
        const p = l.Presence === 0.5 ? 0.5 : 1;
        presenceByKey.set(key, p);
        if (l.Work_Order_Item_ID) {
            const arr = itemsByKey.get(key) || [];
            if (!arr.includes(l.Work_Order_Item_ID)) arr.push(l.Work_Order_Item_ID);
            itemsByKey.set(key, arr);
        }
    }

    const days: FieldWorkLogDay[] = timeline.map(day => {
        const byWorker = new Map<string, FieldWorkLogWorker>();
        for (const l of day.logs) {
            const key = `${day.date}|${l.Worker_ID}`;
            const cur = byWorker.get(l.Worker_ID) || {
                workerId: l.Worker_ID,
                name: workerNames.get(l.Worker_ID) || l.Worker_Name || 'Radnik',
                presence: presenceByKey.get(key) ?? 1,
                itemIds: itemsByKey.get(key) || [],
                ...(includeCost ? { cost: 0 } : {}),
            };
            if (includeCost) cur.cost = round2((cur.cost || 0) + (l.Daily_Rate || 0));
            byWorker.set(l.Worker_ID, cur);
        }
        return {
            date: day.date,
            dayType: day.dayType,
            workers: Array.from(byWorker.values()).sort((a, b) => a.name.localeCompare(b.name, 'bs')),
            ...(includeCost ? { cost: round2(day.dailyLaborCost) } : {}),
        };
    });

    // Najnoviji dan prvi — na telefonu se popravlja današnji ili jučerašnji unos,
    // a ne onaj od prije mjesec dana.
    days.reverse();

    return {
        orderId: order.Work_Order_ID,
        name: workOrderDisplayName(order),
        number: order.Work_Order_Number || '',
        status: order.Status,
        today,
        canSeeMoney: includeCost,
        items: items.map(it => ({
            itemId: it.ID,
            productName: it.Product_Name || 'Stavka',
            done: it.Status === 'Završeno',
        })),
        crew: crewOf(items, logs, workerNames),
        days,
        workingDays: days.filter(d => d.dayType === 'working').length,
        ...(includeCost
            ? { totalCost: round2(logs.reduce((s, l) => s + (l.Daily_Rate || 0), 0)) }
            : {}),
    };
}
