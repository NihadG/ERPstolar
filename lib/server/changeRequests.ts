// ════════════════════════════════════════════════════════════════════
// PRIJEDLOZI IZMJENA — server (kreiranje, spisak, odobravanje)
//
// Srce sigurnosti odobravanja:
//   • Touches_Money se računa iz Kind (nikad iz klijenta),
//   • odobravanje CLAIM-uje prijedlog u transakciji (pending → approved/…),
//     pa dvoklik ili dva odobravača ne mogu primijeniti izmjenu dvaput,
//   • ako primjena padne, status ide u „failed" s greškom — prijedlog se ne
//     gubi i vidi se zašto,
//   • NOVČANE vrste server NIKAD ne primjenjuje: vlasnik ih izvede na desktopu
//     kroz gejt osnovice, pa zove „resolve" da zatvori prijedlog.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { adminDb } from './firebaseAdmin';
import { HttpError } from './requireUser';
import { getActiveWorkers } from './fieldRepo';
import { updateItemProcesses, createTask, setTaskStatus, completeItem } from './fieldWrites';
import { addProcessToItems, removeProcessFromItems, startOrder, pauseOrder, deleteTask, completeOrder } from './fieldWriteExtras';
import {
    isMoneyKind, needsDesktopApply, canApprove, validateRequestPayload, summarizeRequest, type SummaryContext,
    type ProcessCheckPayload, type ProcessAddPayload, type ProcessRemovePayload,
    type OrderPausePayload, type ItemCompletePayload, type TaskCreatePayload, type TaskStatusPayload, type TaskDeletePayload,
} from '@/lib/changeRequests';
import type { ChangeRequest, ChangeRequestKind, ChangeRequestStatus, UserRole } from '@/lib/types';

const COLL = 'change_requests';

// ─── Kreiranje ────────────────────────────────────────────────────────

export interface CreateRequestInput {
    kind: ChangeRequestKind;
    rawPayload: unknown;
    actor: { uid: string; name: string; workerId: string };
    meta?: {
        workOrderId?: string; workOrderName?: string;
        itemId?: string; productId?: string; productName?: string; projectName?: string;
    };
    summaryCtx?: SummaryContext;
}

export async function createRequest(orgId: string, input: CreateRequestInput): Promise<ChangeRequest> {
    const val = validateRequestPayload(input.kind, input.rawPayload);
    if (!val.ok) throw new HttpError(400, val.error);

    const requestId = uuidv4();
    const doc: ChangeRequest = {
        Request_ID: requestId,
        Organization_ID: orgId,
        Kind: input.kind,
        Status: 'pending',
        Touches_Money: isMoneyKind(input.kind),   // iz Kind, ne iz klijenta
        Created_At: new Date().toISOString(),
        Created_By_UID: input.actor.uid,
        Created_By_Name: input.actor.name,
        Worker_ID: input.actor.workerId,
        Summary: summarizeRequest(input.kind, input.summaryCtx || {}),
        Payload: val.payload,
        ...(input.meta?.workOrderId ? { Work_Order_ID: input.meta.workOrderId } : {}),
        ...(input.meta?.workOrderName ? { Work_Order_Name: input.meta.workOrderName } : {}),
        ...(input.meta?.itemId ? { Item_ID: input.meta.itemId } : {}),
        ...(input.meta?.productId ? { Product_ID: input.meta.productId } : {}),
        ...(input.meta?.productName ? { Product_Name: input.meta.productName } : {}),
        ...(input.meta?.projectName ? { Project_Name: input.meta.projectName } : {}),
    };

    await adminDb().collection(COLL).add(stripUndefined(doc as unknown as Record<string, unknown>));
    return doc;
}

// ─── Čitanje ──────────────────────────────────────────────────────────

async function findRef(orgId: string, requestId: string) {
    const snap = await adminDb().collection(COLL)
        .where('Organization_ID', '==', orgId)
        .where('Request_ID', '==', requestId)
        .limit(1)
        .get();
    return snap.empty ? null : snap.docs[0].ref;
}

export async function getRequest(orgId: string, requestId: string): Promise<ChangeRequest | null> {
    const ref = await findRef(orgId, requestId);
    if (!ref) return null;
    return (await ref.get()).data() as ChangeRequest;
}

export interface ListOpts { status?: ChangeRequestStatus; approvableBy?: UserRole }

/** Spisak prijedloga organizacije; opcionalno filtriran po statusu i po tome šta uloga smije odobriti. */
export async function listRequests(orgId: string, opts: ListOpts = {}): Promise<ChangeRequest[]> {
    let q = adminDb().collection(COLL).where('Organization_ID', '==', orgId);
    if (opts.status) q = q.where('Status', '==', opts.status);
    const snap = await q.get();
    let rows = snap.docs.map(d => d.data() as ChangeRequest);
    if (opts.approvableBy) rows = rows.filter(r => canApprove(opts.approvableBy!, r.Kind));
    return rows.sort((a, b) => (b.Created_At || '').localeCompare(a.Created_At || ''));
}

/** Radnikovi vlastiti prijedlozi. */
export async function listRequestsForWorker(orgId: string, workerId: string): Promise<ChangeRequest[]> {
    const snap = await adminDb().collection(COLL)
        .where('Organization_ID', '==', orgId)
        .where('Worker_ID', '==', workerId)
        .get();
    return snap.docs.map(d => d.data() as ChangeRequest)
        .sort((a, b) => (b.Created_At || '').localeCompare(a.Created_At || ''));
}

// ─── Primjena (samo nenovčane vrste) ──────────────────────────────────

async function applyRequest(orgId: string, req: ChangeRequest): Promise<void> {
    const p = req.Payload as any;

    switch (req.Kind) {
        case 'process_check': {
            const payload = p as ProcessCheckPayload;
            if (payload.action === 'complete') {
                const workers = await getActiveWorkers(orgId);
                const byId = new Map(workers.map(w => [w.Worker_ID, w]));
                const chosen = (payload.workerIds || []).map(id => byId.get(id)).filter(Boolean) as typeof workers;
                if (chosen.length === 0) throw new Error('Odabrani radnici nisu pronađeni.');
                const [main, ...helpers] = chosen;
                await updateItemProcesses(orgId, payload.targets, {
                    Status: 'Završeno',
                    Completed_At: new Date((payload.date || '') + 'T12:00:00').toISOString(),
                    Worker_ID: main.Worker_ID,
                    Worker_Name: main.Name,
                    Helpers: helpers.map(h => ({ Worker_ID: h.Worker_ID, Worker_Name: h.Name })),
                    ...(payload.notes ? { Notes: payload.notes } : {}),
                });
            } else if (payload.action === 'start') {
                await updateItemProcesses(orgId, payload.targets, { Status: 'U toku', Started_At: new Date().toISOString() });
            } else {
                await updateItemProcesses(orgId, payload.targets, { Status: 'Na čekanju', Completed_At: '' });
            }
            return;
        }
        case 'process_add': {
            const payload = p as ProcessAddPayload;
            if (!req.Work_Order_ID) throw new Error('Nalog nije određen.');
            await addProcessToItems(orgId, req.Work_Order_ID, payload.itemIds, payload.procName, payload.stageIndex);
            return;
        }
        case 'process_remove': {
            const payload = p as ProcessRemovePayload;
            if (!req.Work_Order_ID) throw new Error('Nalog nije određen.');
            await removeProcessFromItems(orgId, req.Work_Order_ID, payload.targets);
            return;
        }
        case 'order_start': {
            if (!req.Work_Order_ID) throw new Error('Nalog nije određen.');
            await startOrder(orgId, req.Work_Order_ID);
            return;
        }
        case 'order_pause': {
            const payload = p as OrderPausePayload;
            if (!req.Work_Order_ID) throw new Error('Nalog nije određen.');
            await pauseOrder(orgId, req.Work_Order_ID, payload.paused);
            return;
        }
        case 'task_create': {
            const payload = p as TaskCreatePayload;
            await createTask(orgId, {
                title: payload.title,
                priority: payload.priority as any,
                workOrderId: req.Work_Order_ID,
                productId: payload.productId,
            });
            return;
        }
        case 'task_status': {
            const payload = p as TaskStatusPayload;
            await setTaskStatus(orgId, payload.taskId, payload.done);
            return;
        }
        case 'task_delete': {
            const payload = p as TaskDeletePayload;
            await deleteTask(orgId, payload.taskId);
            return;
        }
        case 'item_complete': {
            const payload = p as ItemCompletePayload;
            if (!req.Work_Order_ID) throw new Error('Nalog nije određen.');
            await completeItem(orgId, req.Work_Order_ID, payload.itemId, new Date((payload.date || '') + 'T12:00:00').toISOString());
            return;
        }
        case 'order_complete': {
            if (!req.Work_Order_ID) throw new Error('Nalog nije određen.');
            await completeOrder(orgId, req.Work_Order_ID, new Date().toISOString());
            return;
        }
        default:
            // Materijalne vrste (material_usage, material_order) mijenjaju osnovicu,
            // pa se primjenjuju na desktopu (resolve), ne na serveru.
            throw new Error('Ova vrsta se ne primjenjuje na serveru.');
    }
}

// ─── Odobravanje / odbijanje / zatvaranje ─────────────────────────────

export interface Actor { uid: string; name: string; role: UserRole; isSuperAdmin: boolean }

export type ResolveDecision =
    | { action: 'approve' }
    | { action: 'reject'; reason?: string }
    | { action: 'resolve'; appliedPayload?: unknown };   // desktop je već primijenio (novčano)

/**
 * Obradi prijedlog. Vraća ažuriran ChangeRequest.
 *
 * Transakcija garantuje da se pending obradi TAČNO JEDNOM — drugi poziv (dvoklik,
 * drugi odobravač) dobija 409. Primjena (za nenovčane) ide nakon claim-a; ako
 * padne, status je „failed" + poruka, a greška se propagira ruti.
 */
export async function resolveRequest(
    orgId: string, requestId: string, decision: ResolveDecision, actor: Actor
): Promise<ChangeRequest> {
    const ref = await findRef(orgId, requestId);
    if (!ref) throw new HttpError(404, 'Prijedlog nije pronađen.');

    const current = (await ref.get()).data() as ChangeRequest;
    if (current.Status !== 'pending') throw new HttpError(409, 'Prijedlog je već obrađen.');

    // Dozvola po ulozi × vrsti (ruta je već provjerila, ovo je odbrana u dubini).
    const mayApprove = canApprove(actor.role, current.Kind) || actor.isSuperAdmin;
    if (!mayApprove) throw new HttpError(403, 'Nemate dozvolu za ovaj prijedlog.');

    // „approve" primjenjuje server; materijalne vrste idu kroz „resolve" nakon
    // što ih vlasnik primijeni na desktopu (kroz gejt osnovice).
    if (decision.action === 'approve' && needsDesktopApply(current.Kind)) {
        throw new HttpError(400, 'Ovaj prijedlog se potvrđuje na desktopu (mijenja materijale i kalkulaciju).');
    }
    if (decision.action === 'resolve' && !needsDesktopApply(current.Kind)) {
        throw new HttpError(400, 'Ovaj prijedlog se potvrđuje kroz „approve".');
    }

    const now = new Date().toISOString();
    const resolvedFields = { Resolved_At: now, Resolved_By_UID: actor.uid, Resolved_By_Name: actor.name };

    // CLAIM u transakciji — samo iz pending.
    await adminDb().runTransaction(async tx => {
        const fresh = (await tx.get(ref)).data() as ChangeRequest;
        if (fresh.Status !== 'pending') throw new HttpError(409, 'Prijedlog je već obrađen.');

        if (decision.action === 'reject') {
            tx.update(ref, { Status: 'rejected', Reject_Reason: decision.reason || '', ...resolvedFields });
        } else {
            // approve (nenovčano) i resolve (novčano) → optimistički „approved".
            tx.update(ref, {
                Status: 'approved',
                ...resolvedFields,
                ...(decision.action === 'resolve' && decision.appliedPayload !== undefined ? { Applied_Payload: decision.appliedPayload } : {}),
            });
        }
    });

    if (decision.action === 'reject') {
        return { ...current, Status: 'rejected', Reject_Reason: decision.reason || '', ...resolvedFields };
    }
    if (decision.action === 'resolve') {
        // Desktop je već primijenio — server ništa ne dira.
        return { ...current, Status: 'approved', ...resolvedFields, Applied_Payload: decision.appliedPayload };
    }

    // approve (nenovčano) → primijeni sada; na grešku „failed".
    try {
        await applyRequest(orgId, current);
        return { ...current, Status: 'approved', ...resolvedFields };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Primjena nije uspjela.';
        await ref.update({ Status: 'failed', Error: msg });
        throw new HttpError(500, msg);
    }
}

// ─── Pomoć ────────────────────────────────────────────────────────────

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
    return out;
}
