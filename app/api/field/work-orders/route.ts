// ════════════════════════════════════════════════════════════════════
// NALOZI — lista za pogon
//
// Poredak nije po datumu nego po tome šta kontrolora danas zanima:
// prvo nalozi na kojima je danas već proknjižen rad, pa ostali u toku,
// pa pauzirani, pa oni koji čekaju.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireController } from '@/lib/server/requireUser';
import {
    attachItems, getItemsForWorkOrders, getOpenWorkOrders, getWorkLogsInRange,
} from '@/lib/server/fieldRepo';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { buildFieldOrdersList } from '@/lib/field/fieldOrders';
import type { Task } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: Request) {
    try {
        const caller = await requireController(req);
        const today = todayISO();

        const [orders, todayLogs, taskSnap] = await Promise.all([
            getOpenWorkOrders(caller.orgId),
            getWorkLogsInRange(caller.orgId, today, today),
            adminDb().collection('tasks').where('Organization_ID', '==', caller.orgId).get(),
        ]);

        const items = await getItemsForWorkOrders(caller.orgId, orders.map(o => o.Work_Order_ID));
        attachItems(orders, items);

        const rows = buildFieldOrdersList({
            today,
            orders,
            tasks: taskSnap.docs.map(d => d.data() as Task),
            workedTodayOrderIds: new Set(todayLogs.map(l => l.Work_Order_ID).filter(Boolean)),
        });

        return NextResponse.json({ today, orders: rows }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
