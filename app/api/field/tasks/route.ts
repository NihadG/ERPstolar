// ════════════════════════════════════════════════════════════════════
// ZADACI IZ POGONA
//
// Ovo je kanal kojim kontrolor javlja problem. Zadatak završi u istoj listi
// koju vlasnik vidi u aplikaciji — nema zasebne „pogonske" kutije koju niko
// ne otvara.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { getActiveWorkers } from '@/lib/server/fieldRepo';
import { createTask, setTaskStatus } from '@/lib/server/fieldWrites';
import { TASK_CATEGORIES } from '@/lib/types';
import type { TaskCategory, TaskPriority } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export async function POST(req: Request) {
    try {
        const caller = await requireController(req);
        const body = await req.json().catch(() => ({}));

        // Čekiranje postojećeg zadatka ide kroz istu rutu.
        if (body.taskId) {
            await setTaskStatus(caller.orgId, String(body.taskId), body.done === true);
            return NextResponse.json({ ok: true });
        }

        const title = String(body.title || '').trim();
        if (!title) throw new HttpError(400, 'Zadatak mora imati naslov.');

        const priority: TaskPriority = PRIORITIES.includes(body.priority) ? body.priority : 'medium';
        const category: TaskCategory = (TASK_CATEGORIES as readonly string[]).includes(body.category)
            ? body.category
            : 'general';

        let assignedWorkerId: string | undefined;
        let assignedWorkerName: string | undefined;
        if (body.assignedWorkerId) {
            const worker = (await getActiveWorkers(caller.orgId))
                .find(w => w.Worker_ID === String(body.assignedWorkerId));
            if (worker) {
                assignedWorkerId = worker.Worker_ID;
                assignedWorkerName = worker.Name;
            }
        }

        const taskId = await createTask(caller.orgId, {
            title,
            priority,
            category,
            dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
            notes: typeof body.notes === 'string' ? body.notes : undefined,
            workOrderId: body.workOrderId ? String(body.workOrderId) : undefined,
            productId: body.productId ? String(body.productId) : undefined,
            assignedWorkerId,
            assignedWorkerName,
            checklist: Array.isArray(body.checklist) ? body.checklist.map((x: unknown) => String(x)) : undefined,
        });

        return NextResponse.json({ ok: true, taskId }, { status: 201 });
    } catch (e) {
        return errorResponse(e);
    }
}
