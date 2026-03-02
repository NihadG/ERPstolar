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
import type { Task, TaskProfile, ChecklistItem } from '../../types';

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
