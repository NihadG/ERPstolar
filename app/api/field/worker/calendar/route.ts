// ════════════════════════════════════════════════════════════════════
// RADNIKOV KALENDAR — mjesec rada i prisustva
//
// `?month=YYYY-MM`. Vraća mrežu mjeseca: po danu prisustvo, proizvodi i kolege
// koji su tog dana bili na istoj stavci. Kolege se izvode iz dnevnica cijele
// organizacije za mjesec (indeks work_logs(Organization_ID, Date)).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireFieldUser } from '@/lib/server/requireUser';
import { resolveWorkerSubject } from '@/lib/server/fieldSubject';
import {
    attachItems, getAttendanceInRange, getItemsByIds, getItemsForWorkOrders,
    getOpenWorkOrders, getWorkLogsInRange,
} from '@/lib/server/fieldRepo';
import { buildWorkerCalendar, type WorkerCalendarOrderInput } from '@/lib/field/fieldCalendar';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { isOrderPaused, workOrderDisplayName } from '@/lib/utils';
import type { WorkOrder, WorkOrderItem } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isMonth = (s: string) => /^\d{4}-\d{2}$/.test(s);

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthBounds(month: string): { from: string; to: string } {
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}` };
}

export async function GET(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        const { workerId } = await resolveWorkerSubject(req, caller);

        const month = new URL(req.url).searchParams.get('month') || '';
        if (!isMonth(month)) throw new HttpError(400, 'Neispravan mjesec.');
        const { from, to } = monthBounds(month);

        const [allLogs, attendance, openOrders] = await Promise.all([
            getWorkLogsInRange(caller.orgId, from, to),
            getAttendanceInRange(caller.orgId, from, to),
            getOpenWorkOrders(caller.orgId),
        ]);

        // Nazivi proizvoda: WorkLog ih ne nosi — razriješi ih preko stavki na
        // koje su radnikove dnevnice knjižene (Product_ID → Product_Name).
        const myItemIds = Array.from(new Set(
            allLogs.filter(l => l.Worker_ID === workerId).map(l => l.Work_Order_Item_ID).filter(Boolean)
        ));
        const items: WorkOrderItem[] = myItemIds.length ? await getItemsByIds(caller.orgId, myItemIds) : [];
        const productNameById = new Map<string, string>();
        for (const it of items) {
            if (it.Product_ID) productNameById.set(it.Product_ID, it.Product_Name || 'Proizvod');
        }

        // Radnikovi aktivni nalozi → trake na kalendaru.
        const orderItems = await getItemsForWorkOrders(caller.orgId, openOrders.map(o => o.Work_Order_ID));
        attachItems(openOrders, orderItems);
        const orders: WorkerCalendarOrderInput[] = (openOrders as WorkOrder[])
            .filter(wo => (wo.items || []).some(it =>
                it.Status !== 'Završeno' && isWorkerAssignedToAutoItem(it as any, workerId)))
            .map(wo => ({
                orderId: wo.Work_Order_ID,
                name: workOrderDisplayName(wo),
                status: wo.Status,
                isPaused: isOrderPaused(wo),
                plannedStart: wo.Planned_Start_Date || null,
                plannedEnd: wo.Planned_End_Date || null,
                startedAt: wo.Started_At || null,
                dueDate: wo.Due_Date || null,
            }));

        const calendar = buildWorkerCalendar({
            month,
            workerId,
            today: todayISO(),
            allLogs,
            attendance: attendance.filter(a => a.Worker_ID === workerId),
            productNameById,
            orders,
        });

        return NextResponse.json(calendar, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
