// ════════════════════════════════════════════════════════════════════
// KONTROLOROVI UPISI — procesi, proizvodi, zadaci
//
// Tri upisa, jako različita po težini:
//
//   updateItemProcess  — piše SAMO `Processes` na stavci. Bez kaskade, bez
//                        novca. Procesi su čist napredak; rad i profit dolaze
//                        isključivo iz work logova. Najjeftiniji i najsigurniji
//                        upis u sistemu.
//
//   completeItem       — zamrzava trošak rada na stavci i osvježava nalog.
//                        DIRA NOVAC, pa iznos nikad ne izlazi u odgovoru.
//
//   createTask         — nova stavka u `tasks`, bez novca.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { adminDb } from './firebaseAdmin';
import { getItemRef, getItemsByIds, getWorkOrderById } from './fieldRepo';
import { recalcOrderLabor } from './fieldAttendance';
import { aggregateLaborFromLogs, laborCostOf } from '@/lib/laborAggregate';
import { getWorkLogsForWorkOrder } from './fieldRepo';
import { withProductLinkInOrder, withWorkOrderLink } from '@/lib/workOrderTasks';
import { workOrderDisplayName } from '@/lib/utils';
import type { ItemProcessStatus, Task, TaskCategory, TaskPriority } from '@/lib/types';

// ─── Procesi ──────────────────────────────────────────────────────────

export interface ProcessUpdateTarget {
    itemId: string;
    /** TAČNO ime procesa kako stoji na stavci (ProcPerItem.procName). */
    procName: string;
}

/**
 * Upiši status procesa na više stavki odjednom.
 *
 * Upsert po TAČNOM nazivu procesa — zato pozivalac šalje `procName` po stavci,
 * a ne jedno ime za sve. Različite stavke mogu nositi različit zapis istog
 * procesa (alias), i spajanje po prikaznom imenu bi napravilo duplikat.
 *
 * Namjerno NEMA kaskade na status stavke ni naloga: procesi su čist napredak.
 */
export async function updateItemProcesses(
    orgId: string,
    targets: ProcessUpdateTarget[],
    updates: Partial<ItemProcessStatus>
): Promise<number> {
    let changed = 0;

    for (const t of targets) {
        const ref = await getItemRef(orgId, t.itemId);
        if (!ref) continue;

        const snap = await ref.get();
        const data = snap.data();
        if (!data) continue;

        const processes: ItemProcessStatus[] = Array.isArray(data.Processes) ? [...data.Processes] : [];
        const idx = processes.findIndex(p => p.Process_Name === t.procName);

        if (idx >= 0) {
            const merged = { ...processes[idx], ...updates } as ItemProcessStatus;

            // Trajanje se računa samo kad proces ima početak i sada se zatvara.
            if (updates.Status === 'Završeno' && processes[idx].Started_At) {
                const start = new Date(processes[idx].Started_At!).getTime();
                const end = updates.Completed_At ? new Date(updates.Completed_At).getTime() : Date.now();
                merged.Duration_Minutes = Math.round((end - start) / 60000);
            }

            Object.keys(merged).forEach(k => {
                if ((merged as any)[k] === undefined) delete (merged as any)[k];
            });
            processes[idx] = merged;
        } else {
            const created = { Process_Name: t.procName, Status: 'Na čekanju', ...updates } as ItemProcessStatus;
            Object.keys(created).forEach(k => {
                if ((created as any)[k] === undefined) delete (created as any)[k];
            });
            processes.push(created);
        }

        await ref.update({ Processes: processes });
        changed++;
    }

    return changed;
}

// ─── Zatvaranje proizvoda ─────────────────────────────────────────────

/**
 * Zatvori proizvod: zamrzni trošak rada i osvježi nalog.
 *
 * `Labor_Cost_Frozen` znači da se trošak više ne preračunava iz logova — to je
 * konačna cifra za taj proizvod. Zato se zamrzava TEK ovdje, a ne pri čekiranju
 * procesa.
 *
 * Odgovor ne nosi iznos — kontrolor vidi da je proizvod zatvoren, ne koliko košta.
 */
export async function completeItem(
    orgId: string,
    workOrderId: string,
    itemId: string,
    completedAtISO: string
): Promise<void> {
    const ref = await getItemRef(orgId, itemId);
    if (!ref) throw new Error('Proizvod nije pronađen.');

    // Trošak rada = Σ Daily_Rate iz logova te stavke — ista definicija kao svuda.
    const logs = await getWorkLogsForWorkOrder(orgId, workOrderId);
    const actualLaborCost = laborCostOf(aggregateLaborFromLogs(logs), itemId);

    await ref.update({
        Status: 'Završeno',
        Completed_At: completedAtISO,
        Actual_Labor_Cost: actualLaborCost,
        Labor_Cost_Frozen: true,
    });

    await recalcOrderLabor(orgId, workOrderId);
}

/** Vrati proizvod u rad — greška pri zatvaranju mora biti popravljiva. */
export async function reopenItem(orgId: string, workOrderId: string, itemId: string): Promise<void> {
    const ref = await getItemRef(orgId, itemId);
    if (!ref) throw new Error('Proizvod nije pronađen.');

    await ref.update({
        Status: 'U toku',
        Completed_At: '',
        Labor_Cost_Frozen: false,
    });

    await recalcOrderLabor(orgId, workOrderId);
}

// ─── Zadaci ───────────────────────────────────────────────────────────

export interface CreateTaskInput {
    title: string;
    priority?: TaskPriority;
    category?: TaskCategory;
    dueDate?: string;
    notes?: string;
    workOrderId?: string;
    productId?: string;
    assignedWorkerId?: string;
    assignedWorkerName?: string;
    checklist?: string[];
}

/**
 * Kreiraj zadatak. Kad je vezan za nalog, veza ide kroz `Task.Links` — to je
 * jedini izvor istine o pripadnosti (nalog ne drži kopiju spiska zadataka).
 */
export async function createTask(orgId: string, input: CreateTaskInput): Promise<string> {
    const title = input.title.trim();
    if (!title) throw new Error('Zadatak mora imati naslov.');

    let links: Task['Links'] = [];
    if (input.workOrderId) {
        const wo = await getWorkOrderById(orgId, input.workOrderId);
        if (wo) {
            links = withWorkOrderLink([], {
                Work_Order_ID: wo.Work_Order_ID,
                displayName: workOrderDisplayName(wo),
            });

            if (input.productId) {
                const items = wo.items?.length
                    ? wo.items
                    : await getItemsByIds(orgId, [input.productId]);
                links = withProductLinkInOrder(
                    links,
                    (items || []).map(i => ({ Product_ID: i.Product_ID, Product_Name: i.Product_Name })),
                    input.productId
                );
            }
        }
    }

    const taskId = uuidv4();
    const task: Record<string, unknown> = {
        Task_ID: taskId,
        Organization_ID: orgId,
        Title: title,
        Description: '',
        Status: 'pending',
        Priority: input.priority || 'medium',
        Category: input.category || 'general',
        Created_Date: new Date().toISOString(),
        Links: links,
        ...(input.dueDate ? { Due_Date: input.dueDate } : {}),
        ...(input.notes ? { Notes: input.notes } : {}),
        ...(input.assignedWorkerId ? {
            Assigned_Worker_ID: input.assignedWorkerId,
            Assigned_Worker_Name: input.assignedWorkerName || '',
        } : {}),
        ...(input.checklist?.length ? {
            Checklist: input.checklist
                .map(t => t.trim())
                .filter(Boolean)
                .map(text => ({ id: uuidv4(), text, completed: false })),
        } : {}),
    };

    await adminDb().collection('tasks').add(task);
    return taskId;
}

async function taskRef(orgId: string, taskId: string) {
    const snap = await adminDb().collection('tasks')
        .where('Organization_ID', '==', orgId)
        .where('Task_ID', '==', taskId)
        .limit(1)
        .get();
    if (snap.empty) throw new Error('Zadatak nije pronađen.');
    return snap.docs[0].ref;
}

/** Čekiranje zadatka — isti dokument koji vlasnik vidi u Zadacima. */
export async function setTaskStatus(orgId: string, taskId: string, done: boolean): Promise<void> {
    await (await taskRef(orgId, taskId)).update({
        Status: done ? 'completed' : 'pending',
        Completed_Date: done ? new Date().toISOString() : '',
    });
}

/**
 * Postavi tačan status zadatka (uključujući „u toku"). Kontrolorov Zadaci tab
 * vodi zadatak kroz cijeli tok, ne samo završeno/nezavršeno. `Completed_Date`
 * se drži u skladu sa statusom da izvještaji ostanu tačni.
 */
export async function setTaskState(orgId: string, taskId: string, status: Task['Status']): Promise<void> {
    await (await taskRef(orgId, taskId)).update({
        Status: status,
        Completed_Date: status === 'completed' ? new Date().toISOString() : '',
    });
}

/** Prebaci jednu stavku checkliste — isti dokument koji vlasnik vidi u Zadacima. */
export async function toggleTaskChecklistItem(orgId: string, taskId: string, itemId: string): Promise<void> {
    const ref = await taskRef(orgId, taskId);
    const snap = await ref.get();
    const checklist: { id: string; text: string; completed: boolean }[] =
        Array.isArray(snap.data()?.Checklist) ? [...snap.data()!.Checklist] : [];

    const idx = checklist.findIndex(c => c.id === itemId);
    if (idx < 0) throw new Error('Stavka nije pronađena.');

    checklist[idx] = { ...checklist[idx], completed: !checklist[idx].completed };
    await ref.update({ Checklist: checklist });
}
