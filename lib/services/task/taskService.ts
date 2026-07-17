/**
 * taskService.ts — Task management CRUD + subscriptions
 * 
 * Extracted from database.ts (functions: getTasks, getTask, saveTask, deleteTask,
 * updateTaskStatus, toggleTaskChecklistItem, batch operations, subscriptions, queries)
 */

import { COLLECTIONS } from '../shared/collections';
import {
    queryByOrg,
    findByIdAndOrg,
    findRef,
    createDoc,
    updateDocByRef,
    getDb,
    query,
    collection,
    where,
    getDocs,
    writeBatch,
    onSnapshot,
} from '../shared/firestoreClient';
import { v4 as uuidv4 } from 'uuid';
import {
    withWorkOrderLink,
    withoutWorkOrderLink,
    withProductLinkInOrder,
    type TaskAttachSelection,
} from '../../workOrderTasks';
import type { Task, TaskProfile, ChecklistItem, TaskLink, WorkOrderItem } from '../../types';

// ============================================
// TASK CRUD
// ============================================

export async function getTasks(organizationId: string): Promise<Task[]> {
    return queryByOrg<Task>(COLLECTIONS.TASKS, organizationId);
}

export async function getTask(taskId: string, organizationId: string): Promise<Task | null> {
    const result = await findByIdAndOrg<Task>(COLLECTIONS.TASKS, 'Task_ID', taskId, organizationId);
    return result.data;
}

export async function saveTask(
    data: Partial<Task>,
    organizationId: string
): Promise<{ success: boolean; data?: { Task_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Task_ID;

        if (isNew) {
            data.Task_ID = uuidv4();
            data.Organization_ID = organizationId;
            data.Created_Date = new Date().toISOString();
            data.Status = data.Status || 'pending';
            await createDoc(COLLECTIONS.TASKS, data as Record<string, unknown>);
        } else {
            const ref = await findRef(COLLECTIONS.TASKS, 'Task_ID', data.Task_ID!, organizationId);
            if (ref) {
                const { Organization_ID, ...updateData } = data;
                await updateDocByRef(ref, updateData as Record<string, unknown>);
            }
        }

        return {
            success: true,
            data: { Task_ID: data.Task_ID! },
            message: isNew ? 'Zadatak kreiran' : 'Zadatak ažuriran',
        };
    } catch (error) {
        console.error('saveTask error:', error);
        return { success: false, message: 'Greška pri spremanju zadatka' };
    }
}

export async function deleteTask(
    taskId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const ref = await findRef(COLLECTIONS.TASKS, 'Task_ID', taskId, organizationId);
        if (ref) {
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(ref);
        }
        return { success: true, message: 'Zadatak obrisan' };
    } catch (error) {
        console.error('deleteTask error:', error);
        return { success: false, message: 'Greška pri brisanju zadatka' };
    }
}

export async function updateTaskStatus(
    taskId: string,
    status: Task['Status'],
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const updates: Record<string, unknown> = { Status: status };
        if (status === 'completed') {
            updates.Completed_Date = new Date().toISOString();
        }

        const ref = await findRef(COLLECTIONS.TASKS, 'Task_ID', taskId, organizationId);
        if (ref) {
            await updateDocByRef(ref, updates);
        }

        return { success: true, message: 'Status zadatka ažuriran' };
    } catch (error) {
        console.error('updateTaskStatus error:', error);
        return { success: false, message: 'Greška pri ažuriranju statusa zadatka' };
    }
}

// ============================================
// CHECKLIST
// ============================================

export async function toggleTaskChecklistItem(
    taskId: string,
    checklistItemId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const result = await findByIdAndOrg<Task>(COLLECTIONS.TASKS, 'Task_ID', taskId, organizationId);
        if (!result.data || !result.ref) {
            return { success: false, message: 'Zadatak nije pronađen' };
        }

        const checklist = result.data.Checklist || [];
        const updatedChecklist = checklist.map((item: ChecklistItem) =>
            item.id === checklistItemId ? { ...item, completed: !item.completed } : item
        );

        await updateDocByRef(result.ref, { Checklist: updatedChecklist });
        return { success: true, message: 'Checklist ažuriran' };
    } catch (error) {
        console.error('toggleTaskChecklistItem error:', error);
        return { success: false, message: 'Greška pri ažuriranju checkliste' };
    }
}

export async function addChecklistItem(
    taskId: string,
    itemText: string,
    organizationId: string
): Promise<{ success: boolean; itemId?: string; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const result = await findByIdAndOrg<Task>(COLLECTIONS.TASKS, 'Task_ID', taskId, organizationId);
        if (!result.data || !result.ref) {
            return { success: false, message: 'Zadatak nije pronađen' };
        }

        const newItem: ChecklistItem = {
            id: uuidv4(),
            text: itemText,
            completed: false,
        };

        const checklist = [...(result.data.Checklist || []), newItem];
        await updateDocByRef(result.ref, { Checklist: checklist });

        return { success: true, itemId: newItem.id, message: 'Stavka dodana' };
    } catch (error) {
        console.error('addChecklistItem error:', error);
        return { success: false, message: 'Greška pri dodavanju stavke' };
    }
}

export async function removeChecklistItem(
    taskId: string,
    itemId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const result = await findByIdAndOrg<Task>(COLLECTIONS.TASKS, 'Task_ID', taskId, organizationId);
        if (!result.data || !result.ref) {
            return { success: false, message: 'Zadatak nije pronađen' };
        }

        const checklist = (result.data.Checklist || []).filter((item: ChecklistItem) => item.id !== itemId);
        await updateDocByRef(result.ref, { Checklist: checklist });

        return { success: true, message: 'Stavka uklonjena' };
    } catch (error) {
        console.error('removeChecklistItem error:', error);
        return { success: false, message: 'Greška pri uklanjanju stavke' };
    }
}

// ════════════════════════════════════════════════════════════════════
// VEZA SA RADNIM NALOGOM
//
// Piše se ISKLJUČIVO u Task.Links — nalog ne drži svoju kopiju zadataka.
// Zato su tab Zadaci i kartica naloga automatski u sinhronu (oba čitaju
// isti dokument), i nema stanja koje bi se moglo razići. Vidi lib/workOrderTasks.ts.
// ════════════════════════════════════════════════════════════════════

/** Veži jedan ili više postojećih zadataka na nalog (idempotentno). */
export async function linkTasksToWorkOrder(
    taskIds: string[],
    workOrder: { Work_Order_ID: string; displayName: string },
    organizationId: string
): Promise<{ success: boolean; linkedCount: number; message: string }> {
    if (!organizationId) return { success: false, linkedCount: 0, message: 'Organization ID is required' };
    if (taskIds.length === 0) return { success: true, linkedCount: 0, message: 'Ništa za vezati' };

    try {
        const db = getDb();
        let linkedCount = 0;
        const chunkSize = 30;   // Firestore 'in' limit

        for (let i = 0; i < taskIds.length; i += chunkSize) {
            const chunk = taskIds.slice(i, i + chunkSize);
            const snap = await getDocs(query(
                collection(db, COLLECTIONS.TASKS),
                where('Task_ID', 'in', chunk),
                where('Organization_ID', '==', organizationId)
            ));
            if (snap.empty) continue;

            const batch = writeBatch(db);
            snap.docs.forEach(d => {
                const task = d.data() as Task;
                batch.update(d.ref, { Links: withWorkOrderLink(task.Links, workOrder) });
                linkedCount++;
            });
            await batch.commit();
        }

        return {
            success: true,
            linkedCount,
            message: linkedCount === 1 ? 'Zadatak dodan na nalog' : `${linkedCount} zadataka dodano na nalog`,
        };
    } catch (error) {
        console.error('linkTasksToWorkOrder error:', error);
        return { success: false, linkedCount: 0, message: 'Greška pri vezivanju zadataka' };
    }
}

/**
 * Skini zadatak s naloga. Zadatak OSTAJE u tabu Zadaci — skida se samo veza.
 * Eventualna veza na proizvod se NE dira: zadatak se i dalje tiče tog proizvoda.
 */
export async function unlinkTaskFromWorkOrder(
    taskId: string,
    workOrderId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };

    try {
        const result = await findByIdAndOrg<Task>(COLLECTIONS.TASKS, 'Task_ID', taskId, organizationId);
        if (!result.data || !result.ref) return { success: false, message: 'Zadatak nije pronađen' };

        await updateDocByRef(result.ref, { Links: withoutWorkOrderLink(result.data.Links, workOrderId) });
        return { success: true, message: 'Zadatak skinut s naloga' };
    } catch (error) {
        console.error('unlinkTaskFromWorkOrder error:', error);
        return { success: false, message: 'Greška pri skidanju zadatka s naloga' };
    }
}

/**
 * Veži izbor zadataka (postojeći + novi nacrti) na nalog — jedan poziv za
 * oba puta kojima zadaci dolaze na nalog: wizard (nalog tek nastao) i
 * kartica (nalog odavno postoji). Zato oba mjesta daju isti rezultat.
 */
export async function attachTasksToWorkOrder(
    selection: TaskAttachSelection,
    workOrder: { Work_Order_ID: string; displayName: string },
    orderItems: Pick<WorkOrderItem, 'Product_ID' | 'Product_Name'>[],
    organizationId: string
): Promise<{ success: boolean; created: number; linked: number; message: string }> {
    if (!organizationId) return { success: false, created: 0, linked: 0, message: 'Organization ID is required' };

    const drafts = selection.newTasks.filter(d => d.Title.trim());
    let created = 0;

    try {
        for (const draft of drafts) {
            // Veza na nalog je obavezna; veza na proizvod ide samo ako je izabran
            // i ako taj proizvod stvarno postoji u nalogu (withProductLinkInOrder to čuva).
            let links: TaskLink[] = withWorkOrderLink([], workOrder);
            if (draft.productId) links = withProductLinkInOrder(links, orderItems, draft.productId);

            // Prazni koraci se odbacuju ovdje (a ne u UI-u): nacrt smije imati
            // poluupisan red, zadatak u bazi ne smije.
            const steps = (draft.checklist || []).map(t => t.trim()).filter(Boolean);

            const res = await saveTask({
                Title: draft.Title.trim(),
                Description: draft.Description?.trim() || '',
                Priority: draft.Priority,
                Category: draft.Category,
                Status: 'pending',
                ...(draft.Due_Date ? { Due_Date: draft.Due_Date } : {}),
                ...(draft.Assigned_Worker_ID ? { Assigned_Worker_ID: draft.Assigned_Worker_ID } : {}),
                ...(steps.length > 0 ? {
                    Checklist: steps.map(text => ({ id: uuidv4(), text, completed: false })),
                } : {}),
                Links: links,
            }, organizationId);
            if (res.success) created++;
        }

        const linkRes = await linkTasksToWorkOrder(selection.existingTaskIds, workOrder, organizationId);
        const linked = linkRes.linkedCount;
        const total = created + linked;

        return {
            success: true,
            created,
            linked,
            message: total === 0
                ? 'Nema zadataka za dodati'
                : total === 1 ? '1 zadatak dodan na nalog' : `${total} zadataka dodano na nalog`,
        };
    } catch (error) {
        console.error('attachTasksToWorkOrder error:', error);
        return { success: false, created, linked: 0, message: 'Greška pri dodavanju zadataka na nalog' };
    }
}

/**
 * Osvježi zapamćeni naziv naloga u svim vezanim zadacima (poslije preimenovanja).
 *
 * TaskLink.Entity_Name je snimljen naziv iz trenutka vezivanja. Kartica naloga
 * ga ne koristi (ona zna svoj nalog), ali tab Zadaci prikazuje baš njega — bez
 * ovoga bi tamo zauvijek stajao stari naziv.
 *
 * Tiho (bez poruke): preimenovanje ne smije pasti zbog zadataka.
 */
export async function syncWorkOrderNameOnTasks(
    workOrderId: string,
    displayName: string,
    organizationId: string
): Promise<{ success: boolean; updatedCount: number }> {
    if (!organizationId || !workOrderId) return { success: false, updatedCount: 0 };

    try {
        const db = getDb();
        // Firestore ne može upitati unutar niza objekata (Links) → dovuci zadatke
        // organizacije i filtriraj lokalno. Zadataka je malo; radi se samo pri preimenovanju.
        const snap = await getDocs(query(
            collection(db, COLLECTIONS.TASKS),
            where('Organization_ID', '==', organizationId)
        ));

        const stale = snap.docs.filter(d => {
            const links = (d.data() as Task).Links || [];
            return links.some(l =>
                l.Entity_Type === 'work_order' &&
                l.Entity_ID === workOrderId &&
                l.Entity_Name !== displayName
            );
        });
        if (stale.length === 0) return { success: true, updatedCount: 0 };

        const batch = writeBatch(db);
        stale.forEach(d => {
            const links = ((d.data() as Task).Links || []).map(l =>
                l.Entity_Type === 'work_order' && l.Entity_ID === workOrderId
                    ? { ...l, Entity_Name: displayName }
                    : l
            );
            batch.update(d.ref, { Links: links });
        });
        await batch.commit();

        return { success: true, updatedCount: stale.length };
    } catch (error) {
        console.error('syncWorkOrderNameOnTasks error:', error);
        return { success: false, updatedCount: 0 };
    }
}

/** Postavi (ili skini, productId=null) proizvod zadatka unutar naloga. */
export async function setTaskProductInOrder(
    taskId: string,
    orderItems: Pick<WorkOrderItem, 'Product_ID' | 'Product_Name'>[],
    productId: string | null,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };

    try {
        const result = await findByIdAndOrg<Task>(COLLECTIONS.TASKS, 'Task_ID', taskId, organizationId);
        if (!result.data || !result.ref) return { success: false, message: 'Zadatak nije pronađen' };

        await updateDocByRef(result.ref, { Links: withProductLinkInOrder(result.data.Links, orderItems, productId) });
        return { success: true, message: productId ? 'Proizvod povezan' : 'Veza s proizvodom uklonjena' };
    } catch (error) {
        console.error('setTaskProductInOrder error:', error);
        return { success: false, message: 'Greška pri povezivanju proizvoda' };
    }
}

// ============================================
// BATCH OPERATIONS
// ============================================

export async function batchUpdateTasks(
    taskIds: string[],
    updates: Partial<Task>,
    organizationId: string
): Promise<{ success: boolean; updatedCount: number; message: string }> {
    if (!organizationId || taskIds.length === 0) {
        return { success: true, updatedCount: 0, message: 'Ništa za ažurirati' };
    }

    try {
        const db = getDb();
        let updatedCount = 0;
        const batchSize = 30;

        for (let i = 0; i < taskIds.length; i += batchSize) {
            const chunk = taskIds.slice(i, i + batchSize);
            const q = query(
                collection(db, COLLECTIONS.TASKS),
                where('Task_ID', 'in', chunk),
                where('Organization_ID', '==', organizationId)
            );
            const snap = await getDocs(q);

            if (!snap.empty) {
                const batch = writeBatch(db);
                snap.docs.forEach(d => {
                    batch.update(d.ref, updates as Record<string, unknown>);
                });
                await batch.commit();
                updatedCount += snap.size;
            }
        }

        return { success: true, updatedCount, message: `${updatedCount} zadataka ažurirano` };
    } catch (error) {
        console.error('batchUpdateTasks error:', error);
        return { success: false, updatedCount: 0, message: 'Greška pri batch ažuriranju' };
    }
}

export async function batchDeleteTasks(
    taskIds: string[],
    organizationId: string
): Promise<{ success: boolean; deletedCount: number; message: string }> {
    if (!organizationId || taskIds.length === 0) {
        return { success: true, deletedCount: 0, message: 'Ništa za brisanje' };
    }

    try {
        const db = getDb();
        let deletedCount = 0;
        const batchSize = 30;

        for (let i = 0; i < taskIds.length; i += batchSize) {
            const chunk = taskIds.slice(i, i + batchSize);
            const q = query(
                collection(db, COLLECTIONS.TASKS),
                where('Task_ID', 'in', chunk),
                where('Organization_ID', '==', organizationId)
            );
            const snap = await getDocs(q);

            if (!snap.empty) {
                const batch = writeBatch(db);
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                deletedCount += snap.size;
            }
        }

        return { success: true, deletedCount, message: `${deletedCount} zadataka obrisano` };
    } catch (error) {
        console.error('batchDeleteTasks error:', error);
        return { success: false, deletedCount: 0, message: 'Greška pri batch brisanju' };
    }
}

// ============================================
// REAL-TIME SUBSCRIPTION
// ============================================

export function subscribeToTasks(
    organizationId: string,
    callback: (tasks: Task[]) => void
): () => void {
    if (!organizationId) return () => { };

    try {
        const db = getDb();
        const q = query(
            collection(db, COLLECTIONS.TASKS),
            where('Organization_ID', '==', organizationId)
        );

        return onSnapshot(q, (snapshot) => {
            const tasks = snapshot.docs.map(doc => ({ ...doc.data() } as Task));
            callback(tasks);
        }, (error) => {
            console.error('subscribeToTasks error:', error);
        });
    } catch (error) {
        console.error('subscribeToTasks setup error:', error);
        return () => { };
    }
}

// ============================================
// OPTIMIZED QUERIES
// ============================================

export async function getTodaysTasks(organizationId: string): Promise<Task[]> {
    const today = new Date().toISOString().split('T')[0];
    const db = getDb();
    const q = query(
        collection(db, COLLECTIONS.TASKS),
        where('Organization_ID', '==', organizationId),
        where('Due_Date', '==', today)
    );
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ ...doc.data() } as Task));
}

export async function getOverdueTasks(organizationId: string): Promise<Task[]> {
    const today = new Date().toISOString().split('T')[0];
    const tasks = await getTasks(organizationId);
    return tasks.filter(t =>
        t.Due_Date && t.Due_Date < today &&
        t.Status !== 'completed' && t.Status !== 'cancelled'
    );
}

// ============================================
// TASK PROFILES
// ============================================

export async function getTaskProfiles(organizationId: string): Promise<TaskProfile[]> {
    return queryByOrg<TaskProfile>(COLLECTIONS.TASK_PROFILES, organizationId);
}

export async function saveTaskProfile(
    data: Partial<TaskProfile>,
    organizationId: string
): Promise<{ success: boolean; data?: { Profile_ID: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Profile_ID;

        if (isNew) {
            data.Profile_ID = uuidv4();
            data.Organization_ID = organizationId;
            data.Created_Date = new Date().toISOString();
            await createDoc(COLLECTIONS.TASK_PROFILES, data as Record<string, unknown>);
        } else {
            const ref = await findRef(COLLECTIONS.TASK_PROFILES, 'Profile_ID', data.Profile_ID!, organizationId);
            if (ref) {
                const { Organization_ID, ...updateData } = data;
                await updateDocByRef(ref, updateData as Record<string, unknown>);
            }
        }

        return {
            success: true,
            data: { Profile_ID: data.Profile_ID! },
            message: isNew ? 'Profil kreiran' : 'Profil ažuriran',
        };
    } catch (error) {
        console.error('saveTaskProfile error:', error);
        return { success: false, message: 'Greška pri spremanju profila' };
    }
}

export async function deleteTaskProfile(
    profileId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        // Unlink tasks from this profile first
        const db = getDb();
        const tasksQ = query(
            collection(db, COLLECTIONS.TASKS),
            where('Profile_ID', '==', profileId),
            where('Organization_ID', '==', organizationId)
        );
        const tasksSnap = await getDocs(tasksQ);
        if (!tasksSnap.empty) {
            const batch = writeBatch(db);
            tasksSnap.docs.forEach(d => {
                batch.update(d.ref, { Profile_ID: '' });
            });
            await batch.commit();
        }

        const ref = await findRef(COLLECTIONS.TASK_PROFILES, 'Profile_ID', profileId, organizationId);
        if (ref) {
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(ref);
        }

        return { success: true, message: 'Profil obrisan' };
    } catch (error) {
        console.error('deleteTaskProfile error:', error);
        return { success: false, message: 'Greška pri brisanju profila' };
    }
}
