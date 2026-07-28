// ════════════════════════════════════════════════════════════════════
// NALOG — detalj s tokom procesa
//
// Tok dolazi iz `buildOrderFlowRows`, iste funkcije koju crta desktop
// OrderProcessBoard. `ProcRow` ne nosi nijedan iznos, pa se šalje kakav jeste.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import {
    getActiveWorkers, getItemsForWorkOrders, getWorkOrderById, processGraphOf,
} from '@/lib/server/fieldRepo';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { buildFieldOrderDetail } from '@/lib/field/fieldOrders';
import type { Task } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireController(req);

        const order = await getWorkOrderById(caller.orgId, params.id);
        if (!order) throw new HttpError(404, 'Nalog nije pronađen.');

        const [items, workers, taskSnap] = await Promise.all([
            getItemsForWorkOrders(caller.orgId, [order.Work_Order_ID]),
            getActiveWorkers(caller.orgId),
            adminDb().collection('tasks').where('Organization_ID', '==', caller.orgId).get(),
        ]);
        order.items = items;

        const detail = buildFieldOrderDetail({
            today: todayISO(),
            order,
            graph: processGraphOf(order),
            tasks: taskSnap.docs.map(d => d.data() as Task),
            workers: workers.map(w => ({ Worker_ID: w.Worker_ID, Name: w.Name })),
        });

        return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
