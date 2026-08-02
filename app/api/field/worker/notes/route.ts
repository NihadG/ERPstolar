// ════════════════════════════════════════════════════════════════════
// RADNIKOVE NAPOMENE — spisak (GET) + direktno pisanje (POST/PATCH/DELETE)
//
// Napomene SU zadaci (isti `tasks` dokument, ista Task.Links veza kao desktop
// tab Zadaci) — samo filtrirani i preimenovani za radnika. Za razliku od ostalih
// radnikovih radnji, napomene NE traže odobrenje: radnik ih kreira/čekira/briše
// direktno, a poslodavac dobije NOTIFIKACIJU da je radnik napravio napomenu.
//
// Čitanje (GET) sluša „Pogledaj kao" (subject može biti tuđi). Pisanje ide samo
// stvarnom prijavljenom radniku (caller.workerId) — vlasnik u pregledu nema
// workerId pa ne može pisati u tuđe ime. Bez novca (Task ga nema).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireFieldUser } from '@/lib/server/requireUser';
import { resolveWorkerSubject } from '@/lib/server/fieldSubject';
import {
    attachItems, getItemsForWorkOrders, getOpenWorkOrders, getTaskById,
    getWorkerById, getWorkOrderById,
} from '@/lib/server/fieldRepo';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { createTask, setTaskStatus } from '@/lib/server/fieldWrites';
import { createFieldNotification, deleteTask } from '@/lib/server/fieldWriteExtras';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { myProductIds } from '@/lib/field/fieldWorker';
import { buildWorkerNotes, canWorkerTouchTask } from '@/lib/field/fieldNotes';
import { workOrderDisplayName } from '@/lib/utils';
import type { Task, TaskPriority, WorkOrder } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nalozi/proizvodi na kojima radnik ima stavku (za vidljivost i autorizaciju). */
async function workerScope(orgId: string, workerId: string) {
    const orders = await getOpenWorkOrders(orgId);
    const items = await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID));
    attachItems(orders as WorkOrder[], items);
    const myOrderIds = new Set<string>();
    for (const wo of orders as WorkOrder[]) {
        if ((wo.items || []).some(it => isWorkerAssignedToAutoItem(it as any, workerId))) {
            myOrderIds.add(wo.Work_Order_ID);
        }
    }
    return { orders: orders as WorkOrder[], items, myOrderIds, productIds: myProductIds(orders as WorkOrder[], workerId) };
}

// ─── Spisak ───────────────────────────────────────────────────────────

export async function GET(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        const { workerId } = await resolveWorkerSubject(req, caller);
        const orgId = caller.orgId;

        const [scope, taskSnap] = await Promise.all([
            workerScope(orgId, workerId),
            adminDb().collection('tasks').where('Organization_ID', '==', orgId).get(),
        ]);

        const orderNameById = new Map(scope.orders.map(wo => [wo.Work_Order_ID, workOrderDisplayName(wo)]));
        const productNameById = new Map<string, string>();
        for (const it of scope.items) {
            if (it.Product_ID) productNameById.set(it.Product_ID, it.Product_Name || 'Proizvod');
        }

        const tasks = taskSnap.docs.map(d => d.data() as Task);
        const notes = buildWorkerNotes({
            tasks,
            workerId,
            myOrderIds: scope.myOrderIds,
            myProductIds: scope.productIds,
            orderNameById,
            productNameById,
        });

        return NextResponse.json({ notes }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}

// ─── Kreiranje (direktno, uz notifikaciju) ────────────────────────────

export async function POST(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        if (!caller.workerId) throw new HttpError(400, 'Vaš nalog nije povezan sa zapisom radnika.');
        const workerId = caller.workerId;

        const body = await req.json().catch(() => ({}));
        const title = String(body.title || '').trim();
        const workOrderId = body.workOrderId ? String(body.workOrderId) : '';
        const productId = body.productId ? String(body.productId) : undefined;
        const priority = (body.priority ? String(body.priority) : 'medium') as TaskPriority;

        if (!title) throw new HttpError(400, 'Napomena mora imati tekst.');
        if (!workOrderId) throw new HttpError(400, 'Napomena mora biti vezana za nalog.');

        // Radnik smije vezati napomenu samo za nalog na kojem ima stavku.
        const order = await getWorkOrderById(caller.orgId, workOrderId);
        if (!order) throw new HttpError(404, 'Nalog nije pronađen.');
        const orderItems = await getItemsForWorkOrders(caller.orgId, [workOrderId]);
        attachItems([order], orderItems);
        if (!orderItems.some(it => isWorkerAssignedToAutoItem(it as any, workerId))) {
            throw new HttpError(403, 'Nemate stavku na ovom nalogu.');
        }

        const worker = await getWorkerById(caller.orgId, workerId);
        const workerName = worker?.Name || caller.email || 'Radnik';
        const orderName = workOrderDisplayName(order);
        const productName = productId
            ? orderItems.find(i => i.Product_ID === productId)?.Product_Name
            : undefined;

        const taskId = await createTask(caller.orgId, {
            title,
            priority,
            workOrderId,
            productId,
            assignedWorkerId: workerId,
            assignedWorkerName: workerName,
        });

        await createFieldNotification(caller.orgId, {
            title: 'Nova napomena radnika',
            message: `${workerName} je dodao napomenu „${title}" — ${productName ? `${productName} · ` : ''}${orderName}.`,
            type: 'info',
            targetTab: 'tasks',
            relatedId: taskId,
            metadata: { workOrderId, ...(productId ? { productId } : {}), workerId },
        });

        return NextResponse.json({ ok: true, taskId }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}

// ─── Čekiranje (gotovo / vrati) ───────────────────────────────────────

export async function PATCH(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        if (!caller.workerId) throw new HttpError(400, 'Vaš nalog nije povezan sa zapisom radnika.');

        const body = await req.json().catch(() => ({}));
        const taskId = String(body.taskId || '');
        const done = body.done !== false;
        if (!taskId) throw new HttpError(400, 'Napomena nije određena.');

        const task = await getTaskById(caller.orgId, taskId);
        if (!task) throw new HttpError(404, 'Napomena nije pronađena.');
        const scope = await workerScope(caller.orgId, caller.workerId);
        if (!canWorkerTouchTask(task, caller.workerId, scope.myOrderIds, scope.productIds)) {
            throw new HttpError(403, 'Nemate pristup ovoj napomeni.');
        }

        await setTaskStatus(caller.orgId, taskId, done);
        return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}

// ─── Brisanje ─────────────────────────────────────────────────────────

export async function DELETE(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        if (!caller.workerId) throw new HttpError(400, 'Vaš nalog nije povezan sa zapisom radnika.');

        const taskId = new URL(req.url).searchParams.get('taskId') || '';
        if (!taskId) throw new HttpError(400, 'Napomena nije određena.');

        const task = await getTaskById(caller.orgId, taskId);
        if (!task) throw new HttpError(404, 'Napomena nije pronađena.');
        const scope = await workerScope(caller.orgId, caller.workerId);
        if (!canWorkerTouchTask(task, caller.workerId, scope.myOrderIds, scope.productIds)) {
            throw new HttpError(403, 'Nemate pristup ovoj napomeni.');
        }

        await deleteTask(caller.orgId, taskId);
        return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
