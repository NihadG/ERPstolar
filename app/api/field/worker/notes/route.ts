// ════════════════════════════════════════════════════════════════════
// RADNIKOVE NAPOMENE — spisak (GET)
//
// Napomene (Task) koje se tiču radnika: dodijeljene njemu ILI vezane za
// nalog/proizvod na kojem ima stavku. Isti izvor veze (Task.Links) kao
// desktop. Bez novca (projekcija nabraja polja).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireFieldUser } from '@/lib/server/requireUser';
import { resolveWorkerSubject } from '@/lib/server/fieldSubject';
import {
    attachItems, getItemsForWorkOrders, getOpenWorkOrders,
} from '@/lib/server/fieldRepo';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { myProductIds } from '@/lib/field/fieldWorker';
import { buildWorkerNotes } from '@/lib/field/fieldNotes';
import { workOrderDisplayName } from '@/lib/utils';
import type { Task, WorkOrder } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        const { workerId } = await resolveWorkerSubject(req, caller);
        const orgId = caller.orgId;

        const [orders, taskSnap] = await Promise.all([
            getOpenWorkOrders(orgId),
            adminDb().collection('tasks').where('Organization_ID', '==', orgId).get(),
        ]);
        const items = await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID));
        attachItems(orders as WorkOrder[], items);

        // Radnikovi nalozi (ima bar jednu stavku) i proizvodi.
        const myOrderIds = new Set<string>();
        for (const wo of orders as WorkOrder[]) {
            if ((wo.items || []).some(it => isWorkerAssignedToAutoItem(it as any, workerId))) {
                myOrderIds.add(wo.Work_Order_ID);
            }
        }
        const productIds = myProductIds(orders as WorkOrder[], workerId);

        const orderNameById = new Map((orders as WorkOrder[]).map(wo => [wo.Work_Order_ID, workOrderDisplayName(wo)]));
        const productNameById = new Map<string, string>();
        for (const it of items) {
            if (it.Product_ID) productNameById.set(it.Product_ID, it.Product_Name || 'Proizvod');
        }

        const tasks = taskSnap.docs.map(d => d.data() as Task);
        const notes = buildWorkerNotes({
            tasks,
            workerId,
            myOrderIds,
            myProductIds: productIds,
            orderNameById,
            productNameById,
        });

        return NextResponse.json({ notes }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
