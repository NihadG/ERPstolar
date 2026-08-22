// ════════════════════════════════════════════════════════════════════
// OTVARANJE NALOGA S TELEFONA — „Razni poslovi"
//
// Kontrolor (i vlasnik na telefonu) mora moći otvoriti nalog tamo gdje posao
// nastane: isporuka, popravka kod kupca, čišćenje pogona. Bez toga se teren i
// vanredni rad NEMAJU gdje knjižiti — dan prođe, a trošak nestane.
//
// NAMJERNO UŽE od desktop „Razni poslovi" modala: ovdje se otvara samo RADNI
// nalog (naziv, poslovi, radnici, rok). Vrijednost iz ponude, materijal i ostali
// troškovi — dakle sve što ulazi u profit — ostaju vlasniku na desktopu. Pogon
// evidentira rad, ne cijene.
//
// Zašto blizanac `createWorkOrder` iz lib/database.ts a ne ponovna upotreba:
// taj modul radi kroz klijentski Firebase SDK, a pogonske uloge nemaju pristup
// Firestoreu (vidi firestore.rules). Aritmetika i formati se NE dupliraju —
// broj naloga (`generateWorkOrderNumber`) i sinteza grafa (`synthesizeOrderGraph`,
// `mergeProductGraphs`, `layoutColumns`) su čiste funkcije i dijele se s desktopom.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { adminDb } from './firebaseAdmin';
import { getWorkers } from './fieldRepo';
import { generateWorkOrderNumber } from '@/lib/services/shared/idGenerator';
import { mergeProductGraphs, synthesizeOrderGraph } from '@/lib/productProcesses';
import { layoutColumns } from '@/lib/processLayout';
import type { ProcessGraph, Worker } from '@/lib/types';

/** Implicitni proces raznog posla — isti naziv koji piše desktop modal. */
const WORK_PROCESS = 'Rad';

export interface CustomOrderTaskInput {
    /** Naziv posla (npr. „Isporuka kuhinje — Dino"). */
    text: string;
    /** Prvi je glavni, ostali pomoćnici. Svi ulaze u Assigned_Workers (auto-knjiženje). */
    workerIds: string[];
}

export interface CreateCustomOrderInput {
    name: string;
    dueDate?: string;
    notes?: string;
    tasks: CustomOrderTaskInput[];
}

export interface CreatedOrder {
    workOrderId: string;
    workOrderNumber: string;
    name: string;
}

/** Postojeći brojevi naloga — `select` da se ne vuku cijeli dokumenti zbog jednog polja. */
async function existingOrderNumbers(orgId: string): Promise<string[]> {
    const snap = await adminDb().collection('work_orders')
        .where('Organization_ID', '==', orgId)
        .select('Work_Order_Number')
        .get();
    return snap.docs.map(d => (d.data().Work_Order_Number as string) || '').filter(Boolean);
}

/**
 * Otvori nalog tipa „Zadaci" s ad-hoc poslovima.
 *
 * Nalog nastaje u statusu 'Na čekanju' — isto kao s desktopa. Knjiženje dnevnice
 * ga starta (`prepareWorkerOrderTargets`), pa se otvaranje i prvi radni dan
 * odrade u jednom prolazu.
 */
export async function createCustomWorkOrder(
    orgId: string,
    input: CreateCustomOrderInput
): Promise<CreatedOrder> {
    const tasks = input.tasks
        .map(t => ({ text: (t.text || '').trim(), workerIds: (t.workerIds || []).filter(Boolean) }))
        .filter(t => t.text.length > 0);
    if (tasks.length === 0) throw new Error('Nalog nema nijedan posao.');

    const name = (input.name || '').trim() || tasks[0].text;

    const [numbers, workers] = await Promise.all([
        existingOrderNumbers(orgId),
        getWorkers(orgId),
    ]);
    const workerById = new Map<string, Worker>(workers.map(w => [w.Worker_ID, w]));

    const workOrderId = uuidv4();
    const workOrderNumber = generateWorkOrderNumber('Zadaci', numbers);
    const db = adminDb();
    const batch = db.batch();

    const itemGraphs: { itemId: string; graph: ProcessGraph }[] = [];

    for (const task of tasks) {
        const chosen = task.workerIds
            .map(id => workerById.get(id))
            .filter((w): w is Worker => !!w);
        const [main, ...helpers] = chosen;
        const itemId = uuidv4();

        const item: Record<string, unknown> = {
            ID: itemId,
            Organization_ID: orgId,
            Work_Order_ID: workOrderId,
            Product_ID: `custom-${uuidv4()}`,
            Product_Name: task.text,
            Project_ID: '',
            Project_Name: 'Razni poslovi',
            Quantity: 1,
            Status: 'Na čekanju',
            Item_Type: 'custom',
            // Novac ostaje na nuli: pogon otvara RADNI nalog, vrijednost upisuje vlasnik.
            Product_Value: 0,
            Material_Cost: 0,
            Planned_Labor_Cost: 0,
            Planned_Labor_Days: 0,
            Planned_Labor_Workers: 0,
            Planned_Labor_Rate: 0,
            Services_Total: 0,
            Transport_Share: 0,
            Processes: [{
                Process_Name: WORK_PROCESS,
                Status: 'Na čekanju',
                ...(main ? { Worker_ID: main.Worker_ID, Worker_Name: main.Name } : {}),
                ...(helpers.length > 0
                    ? { Helpers: helpers.map(h => ({ Worker_ID: h.Worker_ID, Worker_Name: h.Name })) }
                    : {}),
            }],
            Process_Stages: [{ processes: [WORK_PROCESS] }],
            ...(chosen.length > 0 ? {
                Assigned_Workers: chosen.map(w => ({
                    Worker_ID: w.Worker_ID, Worker_Name: w.Name, Daily_Rate: w.Daily_Rate || 0,
                })),
            } : {}),
        };

        batch.set(db.collection('work_order_items').doc(), item);
        itemGraphs.push({
            itemId,
            graph: synthesizeOrderGraph([{ itemId, stages: [[WORK_PROCESS]] }], undefined, { includeEdges: true }).graph,
        });
    }

    // Graf naloga: svi poslovi dijele isti čvor „Rad" — to je ono što
    // `resolveAutoProcessNode` traži da bi dnevnica dobila Process_Node_ID.
    const workOrder: Record<string, unknown> = {
        Work_Order_ID: workOrderId,
        Organization_ID: orgId,
        Work_Order_Number: workOrderNumber,
        Created_Date: new Date().toISOString(),
        Name: name,
        Due_Date: input.dueDate || '',
        Status: 'Na čekanju',
        Production_Steps: [WORK_PROCESS],
        Notes: (input.notes || '').trim(),
        Work_Order_Type: 'Zadaci',
    };
    try {
        const { graph, columns } = mergeProductGraphs(itemGraphs.filter(g => g.graph.nodes.length > 0));
        if (graph.nodes.length > 0) {
            const pos = layoutColumns(columns);
            graph.nodes.forEach(n => { n.position = pos[n.id] || { x: 24, y: 24 }; });
            workOrder.Process_Graph = JSON.parse(JSON.stringify(graph));
            workOrder.Production_Steps = graph.nodes.map(n => n.name);
        }
    } catch (e) {
        // Nalog bez grafa i dalje radi (dnevnica se knjiži na stavku) — ne ruši kreiranje.
        console.warn('[fieldWorkOrders] sinteza grafa nije uspjela', e);
    }

    batch.set(db.collection('work_orders').doc(), workOrder);
    await batch.commit();

    return { workOrderId, workOrderNumber, name };
}
