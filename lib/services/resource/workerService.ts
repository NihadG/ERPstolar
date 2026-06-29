/**
 * workerService.ts — Worker CRUD
 * 
 * Extracted from database.ts (functions: getWorkers, saveWorker, deleteWorker)
 */

import { COLLECTIONS } from '../shared/collections';
import {
    queryByOrg,
    findRef,
    createDoc,
    updateDocByRef,
    getDb,
    query,
    collection,
    where,
    getDocs,
    writeBatch,
} from '../shared/firestoreClient';
import { v4 as uuidv4 } from 'uuid';
import { splitDnevnicaByOrder } from '../../laborSplit';
import type { Worker } from '../../types';

// ============================================
// READ
// ============================================

export async function getWorkers(organizationId: string): Promise<Worker[]> {
    return queryByOrg<Worker>(COLLECTIONS.WORKERS, organizationId);
}

// ============================================
// WRITE
// ============================================

export async function saveWorker(
    data: Partial<Worker>,
    organizationId: string
): Promise<{
    success: boolean;
    data?: { Worker_ID: string };
    message: string;
    rateChanged?: boolean;
    oldRate?: number;
    newRate?: number;
}> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const isNew = !data.Worker_ID;
        let rateChanged = false;
        let oldRate = 0;
        let newRate = 0;

        if (isNew) {
            data.Worker_ID = uuidv4();
            data.Organization_ID = organizationId;
            data.Status = data.Status || 'Aktivan';
            await createDoc(COLLECTIONS.WORKERS, data as Record<string, unknown>);
        } else {
            const ref = await findRef(COLLECTIONS.WORKERS, 'Worker_ID', data.Worker_ID!, organizationId);
            if (ref) {
                // Detect rate changes for work log recalculation
                const db = getDb();
                const q = query(
                    collection(db, COLLECTIONS.WORKERS),
                    where('Worker_ID', '==', data.Worker_ID),
                    where('Organization_ID', '==', organizationId)
                );
                const snapshot = await getDocs(q);
                if (!snapshot.empty) {
                    const existing = snapshot.docs[0].data() as Worker;
                    if (data.Daily_Rate !== undefined && existing.Daily_Rate !== data.Daily_Rate) {
                        rateChanged = true;
                        oldRate = existing.Daily_Rate || 0;
                        newRate = data.Daily_Rate;

                        // Efektivno-datirana istorija: stare dnevnice (prošli dani) ostaju po staroj
                        // cijeni; nova vrijedi od danas. Sprječava da retroaktivni unos koristi novu
                        // cijenu za prošle datume (rizik #2).
                        const today = new Date().toISOString().split('T')[0];
                        const prevHist = Array.isArray(existing.Daily_Rate_History)
                            ? existing.Daily_Rate_History.slice() : [];
                        if (prevHist.length === 0 && oldRate > 0) {
                            prevHist.push({ Effective_From: '1970-01-01', Rate: oldRate });
                        }
                        const cleaned = prevHist.filter(h => (h?.Effective_From || '').split('T')[0] !== today);
                        cleaned.push({ Effective_From: today, Rate: newRate });
                        cleaned.sort((a, b) => (a.Effective_From || '').localeCompare(b.Effective_From || ''));
                        data.Daily_Rate_History = cleaned;
                    }
                }

                const { Organization_ID, ...updateData } = data;
                await updateDocByRef(ref, updateData as Record<string, unknown>);

                // If rate changed, update today's work logs for this worker
                if (rateChanged && newRate > 0) {
                    try {
                        const today = new Date().toISOString().split('T')[0];
                        const workLogsQ = query(
                            collection(db, COLLECTIONS.WORK_LOGS),
                            where('Worker_ID', '==', data.Worker_ID),
                            where('Date', '==', today),
                            where('Organization_ID', '==', organizationId)
                        );
                        const workLogsSnap = await getDocs(workLogsQ);

                        if (!workLogsSnap.empty) {
                            const docs = workLogsSnap.docs;
                            // presence iz zapisa (per radnik-dan); poštuje pola dana
                            let presence = 1;
                            for (const d of docs) { const p = d.data().Presence; if (p === 0.5 || p === 1) { presence = p; break; } }
                            // DVONIVOVSKA PODJELA: po nalogu pa po proizvodu — isto kao saveDailyWorkBooking.
                            const orderIds: string[] = [];
                            const byOrder = new Map<string, typeof docs>();
                            docs.forEach(d => {
                                const woId = (d.data().Work_Order_ID as string) || '__none__';
                                if (!byOrder.has(woId)) { byOrder.set(woId, [] as unknown as typeof docs); orderIds.push(woId); }
                                (byOrder.get(woId) as typeof docs).push(d);
                            });
                            const { amounts, dayFractions } = splitDnevnicaByOrder(newRate, presence, orderIds.map(id => byOrder.get(id)!.length));
                            const batch = writeBatch(db);
                            orderIds.forEach((woId, oi) => {
                                const group = byOrder.get(woId)!;
                                const splitFactor = orderIds.length * group.length;
                                group.forEach((logDoc, j) => {
                                    batch.update(logDoc.ref, {
                                        Daily_Rate: amounts[oi][j],
                                        Original_Daily_Rate: newRate,
                                        Day_Fraction: dayFractions[oi][j],
                                        Split_Factor: splitFactor,
                                        Modified_At: new Date().toISOString(),
                                    });
                                });
                            });
                            await batch.commit();
                        }
                    } catch (err) {
                        console.warn('saveWorker: work log rate update failed (non-critical):', err);
                    }
                }
            }
        }

        return {
            success: true,
            data: { Worker_ID: data.Worker_ID! },
            message: isNew ? 'Radnik kreiran' : 'Radnik ažuriran',
            rateChanged,
            oldRate,
            newRate,
        };
    } catch (error) {
        console.error('saveWorker error:', error);
        return { success: false, message: 'Greška pri spremanju radnika' };
    }
}

export async function deleteWorker(
    workerId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const db = getDb();

        // Check if worker is assigned to active work orders
        const woItemsQ = query(
            collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
            where('Organization_ID', '==', organizationId)
        );
        const woItemsSnap = await getDocs(woItemsQ);

        const assignedItems = woItemsSnap.docs.filter(d => {
            const item = d.data();
            if (item.Status === 'Završeno') return false;

            // Check Assigned_Workers
            if (item.Assigned_Workers?.some((w: any) => w.Worker_ID === workerId)) return true;

            // Check Processes
            if (item.Processes?.some((p: any) =>
                p.Worker_ID === workerId ||
                p.Helpers?.some((h: any) => h.Worker_ID === workerId)
            )) return true;

            return false;
        });

        if (assignedItems.length > 0) {
            return {
                success: false,
                message: `Radnik je dodijeljen na ${assignedItems.length} aktivni(h) radni(h) nalog(a). Uklonite ga sa naloga prije brisanja.`
            };
        }

        const ref = await findRef(COLLECTIONS.WORKERS, 'Worker_ID', workerId, organizationId);
        if (!ref) return { success: true, message: 'Radnik obrisan' };

        // Ima li radnik ikakvu istoriju (dnevnice / prisustvo)? Ako DA → SOFT-DELETE (Status='Obrisan'),
        // da se ne izgubi/ne nulira istorijski trošak (rizik #1). Hard-delete samo ako nema istorije.
        const [logsSnap, attSnap] = await Promise.all([
            getDocs(query(collection(db, COLLECTIONS.WORK_LOGS),
                where('Worker_ID', '==', workerId), where('Organization_ID', '==', organizationId))),
            getDocs(query(collection(db, COLLECTIONS.WORKER_ATTENDANCE),
                where('Worker_ID', '==', workerId), where('Organization_ID', '==', organizationId))),
        ]);

        if (!logsSnap.empty || !attSnap.empty) {
            await updateDocByRef(ref, { Status: 'Obrisan', Deleted_At: new Date().toISOString() });
            return {
                success: true,
                message: 'Radnik arhiviran — ima istoriju rada, pa dnevnice i prisustvo ostaju netaknuti.'
            };
        }

        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(ref);
        return { success: true, message: 'Radnik obrisan' };
    } catch (error) {
        console.error('deleteWorker error:', error);
        return { success: false, message: 'Greška pri brisanju radnika' };
    }
}
