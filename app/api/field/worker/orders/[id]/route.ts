// ════════════════════════════════════════════════════════════════════
// RADNIKOV NALOG — detalj s tokom
//
// Isti tok (buildFieldOrderDetail) koji vidi kontrolor i desktop, ali radnik
// smije otvoriti SAMO nalog na kojem ima stavku — inače bi kroz URL mogao
// pročitati tuđi nalog.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireFieldUser } from '@/lib/server/requireUser';
import { resolveWorkerSubject } from '@/lib/server/fieldSubject';
import {
    getActiveWorkers, getItemsForWorkOrders, getWorkOrderById, processGraphOf,
} from '@/lib/server/fieldRepo';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { buildFieldOrderDetail } from '@/lib/field/fieldOrders';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import type { Task } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireFieldUser(req);
        const { workerId } = await resolveWorkerSubject(req, caller);

        const order = await getWorkOrderById(caller.orgId, params.id);
        if (!order) throw new HttpError(404, 'Nalog nije pronađen.');

        const [items, workers, taskSnap] = await Promise.all([
            getItemsForWorkOrders(caller.orgId, [order.Work_Order_ID]),
            getActiveWorkers(caller.orgId),
            adminDb().collection('tasks').where('Organization_ID', '==', caller.orgId).get(),
        ]);
        order.items = items;

        // Radnik smije vidjeti nalog samo ako je na bar jednoj njegovoj stavci.
        const isMine = items.some(it => isWorkerAssignedToAutoItem(it as any, workerId));
        if (!isMine) throw new HttpError(403, 'Nemate stavku na ovom nalogu.');

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
