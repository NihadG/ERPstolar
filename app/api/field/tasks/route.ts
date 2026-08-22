// ════════════════════════════════════════════════════════════════════
// ZADACI IZ POGONA
//
// Ovo je kanal kojim kontrolor javlja problem, ali i njegov „Zadaci" tab —
// GET vraća CIJELU listu zadataka organizacije (projekcija bez viška), a POST
// ih kreira i vodi kroz status. Sve završi u istoj listi koju vlasnik vidi u
// aplikaciji — nema zasebne „pogonske" kutije koju niko ne otvara.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { getActiveWorkers, getAllTasks } from '@/lib/server/fieldRepo';
import {
    createTask, setTaskStatus, setTaskState, toggleTaskChecklistItem,
} from '@/lib/server/fieldWrites';
import { buildFieldTasks } from '@/lib/field/fieldTasks';
import { TASK_CATEGORIES, TASK_STATUSES } from '@/lib/types';
import type { Task, TaskCategory, TaskPriority } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: Request) {
    try {
        const caller = await requireController(req);
        const [tasks, workers] = await Promise.all([
            getAllTasks(caller.orgId),
            getActiveWorkers(caller.orgId),
        ]);
        return NextResponse.json(
            buildFieldTasks(tasks, workers, todayISO()),
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (e) {
        return errorResponse(e);
    }
}

export async function POST(req: Request) {
    try {
        const caller = await requireController(req);
        const body = await req.json().catch(() => ({}));

        // Radnje nad postojećim zadatkom idu kroz istu rutu.
        if (body.taskId) {
            const taskId = String(body.taskId);

            // Prebacivanje jedne stavke checkliste.
            if (body.checklistItemId) {
                await toggleTaskChecklistItem(caller.orgId, taskId, String(body.checklistItemId));
                return NextResponse.json({ ok: true });
            }

            // Tačan status (uklj. „u toku") kad ga tab pošalje; inače binarno čekiranje.
            if (typeof body.status === 'string') {
                if (!(TASK_STATUSES as readonly string[]).includes(body.status)) {
                    throw new HttpError(400, 'Nepoznat status zadatka.');
                }
                await setTaskState(caller.orgId, taskId, body.status as Task['Status']);
                return NextResponse.json({ ok: true });
            }

            await setTaskStatus(caller.orgId, taskId, body.done === true);
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
