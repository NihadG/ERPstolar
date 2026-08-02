// ════════════════════════════════════════════════════════════════════
// SERVERSKI UPISI ZA ODOBRENE PRIJEDLOGE (nenovčani)
//
// Ovdje su radnje koje se primjenjuju NA SERVERU kad odobravač potvrdi
// prijedlog: dodavanje/brisanje procesa, pokretanje i pauza naloga, brisanje
// zadatka. Čekiranje procesa i zadaci koriste postojeći fieldWrites.
//
// NOVČANE vrste (zatvaranje proizvoda/naloga, ugradnja materijala, prijedlog
// narudžbe) se OVDJE NE primjenjuju — njih vlasnik izvodi na desktopu kroz gejt
// osnovice profita, pa server nikad ne dira novac.
//
// Grafovske pomoćne funkcije (planToStages, synthesizeOrderGraph…) su čiste, pa
// se dijele s desktopom; samo čitanja/upisi idu kroz Admin SDK.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { adminDb } from './firebaseAdmin';
import {
    getItemDocsForWorkOrder, getWorkOrderRef, getWorkLogsForWorkOrder, processGraphOf,
} from './fieldRepo';
import { getWorkOrderById } from './fieldRepo';
import { updateItemProcesses } from './fieldWrites';
import { planToStages, synthesizeOrderGraph, nodeMatchesProcess } from '@/lib/productProcesses';
import { layoutColumns } from '@/lib/processLayout';
import { dedupeProcessKey } from '@/lib/orderProcessRows';
import type { ProcessGraph, WorkOrderItem } from '@/lib/types';

const procKey = (s: string) => dedupeProcessKey(s || '');

// ─── Dodavanje procesa ────────────────────────────────────────────────

/**
 * Dodaj proces na jednu ili više stavki naloga i uskladi graf.
 * Preslikano s desktop `addProcessToOrderItem`, ali kroz Admin SDK i za više
 * stavki odjednom. Ne dira RUČNE veze grafa — samo proširuje pokrivenost
 * postojećeg čvora ili dodaje novi bez veza.
 */
export async function addProcessToItems(
    orgId: string, workOrderId: string, itemIds: string[], procName: string, stageIndex?: number
): Promise<void> {
    const name = (procName || '').trim();
    if (!name) throw new Error('Naziv procesa je obavezan.');
    const ids = Array.from(new Set(itemIds.filter(Boolean)));
    if (ids.length === 0) throw new Error('Nije odabran nijedan proizvod.');

    // 1) upsert u Processes (status „Na čekanju") — dijeli se s čekiranjem.
    await updateItemProcesses(orgId, ids.map(itemId => ({ itemId, procName: name })), { Status: 'Na čekanju' });

    // 2) dopuni Process_Stages ciljnih stavki.
    const itemDocs = await getItemDocsForWorkOrder(orgId, workOrderId);
    const targetSet = new Set(ids);
    const stagesByItem = new Map<string, string[][]>();

    for (const { ref, data } of itemDocs) {
        const cur = planToStages(
            (data as any).Process_Stages,
            (data.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[]
        );
        if (targetSet.has(data.ID)) {
            const already = cur.some(st => st.some(pn => procKey(pn) === procKey(name)));
            if (!already) {
                if (stageIndex !== undefined && stageIndex >= 0 && stageIndex < cur.length) cur[stageIndex].push(name);
                else cur.push([name]);
            }
            await ref.update({ Process_Stages: cur.map(s => ({ processes: s })) });
        }
        stagesByItem.set(data.ID, cur);
    }

    // 3) uskladi graf naloga.
    const orderRef = await getWorkOrderRef(orgId, workOrderId);
    if (!orderRef) throw new Error('Nalog nije pronađen.');
    const wo = await getWorkOrderById(orgId, workOrderId);
    const prev = processGraphOf(wo);

    if (prev && prev.nodes.length > 0) {
        const existing = prev.nodes.find(n => nodeMatchesProcess(n, name));
        if (existing) {
            if ((existing.itemIds || []).length > 0) {
                for (const id of ids) if (!existing.itemIds.includes(id)) existing.itemIds.push(id);
            }
        } else {
            const maxX = Math.max(0, ...prev.nodes.map(n => n.position?.x || 0));
            prev.nodes.push({ id: `n-${uuidv4()}`, name, itemIds: [...ids], aliases: [name], position: { x: maxX + 260, y: 24 } });
        }
        await orderRef.update({ Process_Graph: prev });
    } else {
        const planItems = itemDocs
            .map(({ data }) => ({ itemId: data.ID, stages: stagesByItem.get(data.ID) || [] }))
            .filter(pi => pi.stages.length > 0);
        const { graph, columns } = synthesizeOrderGraph(planItems, undefined, { includeEdges: true });
        if (graph.nodes.length > 0) {
            const pos = layoutColumns(columns);
            graph.nodes.forEach(n => { n.position = pos[n.id] || { x: 24, y: 24 }; });
            await orderRef.update({ Process_Graph: graph });
        }
    }
}

// ─── Brisanje procesa ─────────────────────────────────────────────────

export interface ProcTarget { itemId: string; procName: string }

/**
 * Ukloni proces sa stavki. ODBIJA ako proces ima proknjižene dnevnice —
 * brisanje bi izgubilo trošak. Graf se čisti minimalno (skida se itemId s
 * čvora; prazan čvor koji je pokrivao samo te stavke se uklanja s vezama).
 */
export async function removeProcessFromItems(
    orgId: string, workOrderId: string, targets: ProcTarget[]
): Promise<void> {
    if (!targets.length) throw new Error('Nije odabran nijedan proces.');

    const logs = await getWorkLogsForWorkOrder(orgId, workOrderId);
    const itemDocs = await getItemDocsForWorkOrder(orgId, workOrderId);
    const byId = new Map(itemDocs.map(d => [d.data.ID, d]));

    for (const t of targets) {
        // Čuvaj trošak: ako postoji dnevnica na tom procesu te stavke — ne briši.
        const booked = logs.some(l =>
            l.Work_Order_Item_ID === t.itemId && procKey(l.Process_Name || '') === procKey(t.procName)
        );
        if (booked) {
            throw new Error(`Proces „${t.procName}" ima proknjižen rad — ne može se obrisati.`);
        }

        const doc = byId.get(t.itemId);
        if (!doc) continue;
        const data = doc.data as WorkOrderItem;

        const processes = (data.Processes || []).filter(p => procKey(p.Process_Name) !== procKey(t.procName));
        const stages = planToStages((data as any).Process_Stages, (data.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[])
            .map(st => st.filter(pn => procKey(pn) !== procKey(t.procName)))
            .filter(st => st.length > 0);

        await doc.ref.update({
            Processes: processes,
            Process_Stages: stages.map(s => ({ processes: s })),
        });
    }

    // Očisti graf: skini itemId s odgovarajućih čvorova; ukloni čvor koji je
    // ostao bez ijedne (specifične) stavke.
    const orderRef = await getWorkOrderRef(orgId, workOrderId);
    const wo = await getWorkOrderById(orgId, workOrderId);
    const graph = processGraphOf(wo);
    if (orderRef && graph && graph.nodes.length > 0) {
        const removedByProc = new Map<string, Set<string>>();
        for (const t of targets) {
            const set = removedByProc.get(procKey(t.procName)) || new Set<string>();
            set.add(t.itemId);
            removedByProc.set(procKey(t.procName), set);
        }
        const removeNodeIds = new Set<string>();
        for (const node of graph.nodes) {
            const removed = removedByProc.get(procKey(node.name));
            if (!removed) continue;
            if ((node.itemIds || []).length > 0) {
                node.itemIds = node.itemIds.filter(id => !removed.has(id));
                if (node.itemIds.length === 0) removeNodeIds.add(node.id);
            }
        }
        if (removeNodeIds.size > 0) {
            graph.nodes = graph.nodes.filter(n => !removeNodeIds.has(n.id));
            graph.edges = graph.edges.filter(e => !removeNodeIds.has(e.source) && !removeNodeIds.has(e.target));
        }
        await orderRef.update({ Process_Graph: graph as ProcessGraph });
    }
}

// ─── Pokretanje / pauza naloga ────────────────────────────────────────

/**
 * Pokreni nalog: status → „U toku", Started_At, i sve stavke „Na čekanju" → „U toku".
 * Kao i kod knjiženja u pogonu, materijali se OVDJE ne provjeravaju — odobravač
 * (vlasnik) svjesno potvrđuje pokretanje.
 */
export async function startOrder(orgId: string, workOrderId: string): Promise<void> {
    const orderRef = await getWorkOrderRef(orgId, workOrderId);
    if (!orderRef) throw new Error('Nalog nije pronađen.');
    const wo = await getWorkOrderById(orgId, workOrderId);
    if (!wo) throw new Error('Nalog nije pronađen.');

    const itemDocs = await getItemDocsForWorkOrder(orgId, workOrderId);
    const batch = adminDb().batch();
    for (const { ref, data } of itemDocs) {
        if (data.Status === 'Na čekanju') batch.update(ref, { Status: 'U toku' });
    }
    batch.update(orderRef, { Status: 'U toku', Started_At: wo.Started_At || new Date().toISOString() });
    await batch.commit();
}

/**
 * Pauziraj/nastavi nalog na nivou svih otvorenih stavki (mirror toggleItemPause,
 * uz Pause_Periods za tačan obračun rada).
 */
export async function pauseOrder(orgId: string, workOrderId: string, paused: boolean): Promise<void> {
    const itemDocs = await getItemDocsForWorkOrder(orgId, workOrderId);
    const now = new Date().toISOString();
    const batch = adminDb().batch();

    for (const { ref, data } of itemDocs) {
        if (data.Status === 'Završeno') continue;
        const periods: { Started_At: string; Ended_At?: string }[] = Array.isArray(data.Pause_Periods) ? [...data.Pause_Periods] : [];
        if (paused) {
            periods.push({ Started_At: now });
        } else if (periods.length > 0 && !periods[periods.length - 1].Ended_At) {
            periods[periods.length - 1].Ended_At = now;
        }
        batch.update(ref, { Is_Paused: paused, Pause_Periods: periods });
    }
    await batch.commit();
}

// ─── Zatvaranje naloga ────────────────────────────────────────────────

/**
 * Zatvori nalog: zatvori sve otvorene stavke (kao completeItem — zamrzne rad)
 * i postavi status naloga na „Završeno". Ne dira materijale, pa ne treba gejt
 * osnovice — isto što kontrolor već radi po stavci.
 */
export async function completeOrder(orgId: string, workOrderId: string, completedAtISO: string): Promise<void> {
    const { completeItem } = await import('./fieldWrites');
    const itemDocs = await getItemDocsForWorkOrder(orgId, workOrderId);
    for (const { data } of itemDocs) {
        if (data.Status !== 'Završeno') {
            await completeItem(orgId, workOrderId, data.ID, completedAtISO);
        }
    }
    const orderRef = await getWorkOrderRef(orgId, workOrderId);
    if (orderRef) await orderRef.update({ Status: 'Završeno', Completed_At: completedAtISO });
}

// ─── Brisanje zadatka ─────────────────────────────────────────────────

export async function deleteTask(orgId: string, taskId: string): Promise<void> {
    const snap = await adminDb().collection('tasks')
        .where('Organization_ID', '==', orgId)
        .where('Task_ID', '==', taskId)
        .limit(1)
        .get();
    if (snap.empty) throw new Error('Zadatak nije pronađen.');
    await snap.docs[0].ref.delete();
}

// ─── Notifikacija (server-side, Admin SDK) ────────────────────────────

export interface FieldNotificationInput {
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    relatedId?: string;
    targetTab?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Upiši notifikaciju za organizaciju (vlasnik je vidi u NotificationCenter).
 * Ista kolekcija i oblik kao client `createNotification`, ali preko Admin SDK-a
 * — radnikove rute nemaju pristup client Firestoreu. Tiho ne ruši radnju ako
 * upis padne: napomena je već kreirana, notifikacija je sekundarna.
 */
export async function createFieldNotification(orgId: string, input: FieldNotificationInput): Promise<void> {
    try {
        await adminDb().collection('notifications').add({
            id: uuidv4(),
            organizationId: orgId,
            title: input.title,
            message: input.message,
            type: input.type || 'info',
            createdAt: new Date().toISOString(),
            read: false,
            ...(input.relatedId ? { relatedId: input.relatedId } : {}),
            ...(input.targetTab ? { targetTab: input.targetTab } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
        });
    } catch (e) {
        console.error('createFieldNotification error:', e);
    }
}
