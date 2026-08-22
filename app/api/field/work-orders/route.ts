// ════════════════════════════════════════════════════════════════════
// NALOZI — lista za pogon (GET) i otvaranje „Raznih poslova" (POST)
//
// Poredak nije po datumu nego po tome šta kontrolora danas zanima:
// prvo nalozi na kojima je danas već proknjižen rad, pa ostali u toku,
// pa pauzirani, pa oni koji čekaju.
//
// POST otvara SAMO nalog tipa „Zadaci" (razni poslovi). Proizvodni i montažni
// nalozi nastaju iz projekta/ponude i ostaju vlasnikov posao na desktopu —
// telefon ne bi imao odakle uzeti proizvode ni vrijednosti.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import {
    attachItems, getItemsForWorkOrders, getOpenWorkOrders, getWorkLogsInRange,
} from '@/lib/server/fieldRepo';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { createCustomWorkOrder, type CustomOrderTaskInput } from '@/lib/server/fieldWorkOrders';
import { buildFieldOrdersList } from '@/lib/field/fieldOrders';
import type { Task } from '@/lib/types';

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

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

export async function POST(req: Request) {
    try {
        const caller = await requireController(req);
        const body = await req.json().catch(() => ({}));

        const rawTasks = Array.isArray(body.tasks) ? body.tasks : [];
        const tasks: CustomOrderTaskInput[] = rawTasks
            .map((t: any) => ({
                text: String(t?.text || '').trim().slice(0, 200),
                workerIds: Array.isArray(t?.workerIds)
                    ? t.workerIds.map((x: unknown) => String(x)).filter(Boolean).slice(0, 20)
                    : [],
            }))
            .filter((t: CustomOrderTaskInput) => t.text.length > 0);

        if (tasks.length === 0) throw new HttpError(400, 'Dodaj barem jedan posao.');
        if (tasks.length > 20) throw new HttpError(400, 'Previše poslova u jednom nalogu (najviše 20).');

        const dueDate = String(body.dueDate || '');
        if (dueDate && !isISODate(dueDate)) throw new HttpError(400, 'Neispravan rok.');

        const created = await createCustomWorkOrder(caller.orgId, {
            name: String(body.name || '').trim().slice(0, 200),
            dueDate: dueDate || undefined,
            notes: String(body.notes || '').trim().slice(0, 500),
            tasks,
        });

        return NextResponse.json(created);
    } catch (e) {
        return errorResponse(e);
    }
}
