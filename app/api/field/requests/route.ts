// ════════════════════════════════════════════════════════════════════
// RADNIKOVI PRIJEDLOZI — kreiranje i vlastiti spisak
//
// POST: radnik šalje prijedlog izmjene. Server PROVJERAVA da radnik smije dirati
// taj nalog/proizvod (dodijeljen mu je) — inače bi kroz body mogao predložiti
// izmjenu tuđeg naloga. Nazivi i „dira li novac" se razrješavaju ovdje, ne
// vjeruje se klijentu.
//
// GET: radnik vidi SVOJE prijedloge i njihov status (čeka / odobreno / odbijeno).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireFieldUser } from '@/lib/server/requireUser';
import {
    attachItems, getItemsForWorkOrders, getOpenWorkOrders, getWorkOrderById,
} from '@/lib/server/fieldRepo';
import { createRequest, listRequestsForWorker } from '@/lib/server/changeRequests';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { myProductIds } from '@/lib/field/fieldWorker';
import { workOrderDisplayName } from '@/lib/utils';
import type { SummaryContext } from '@/lib/changeRequests';
import type { ChangeRequestKind, WorkOrder, WorkOrderItem } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORDER_KINDS = new Set<ChangeRequestKind>([
    'process_check', 'process_add', 'process_remove',
    'order_start', 'order_pause', 'order_complete', 'item_complete', 'task_create',
]);
const PRODUCT_KINDS = new Set<ChangeRequestKind>(['material_usage', 'material_order']);

export async function GET(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        if (!caller.workerId) throw new HttpError(400, 'Vaš nalog nije povezan sa zapisom radnika.');
        const requests = await listRequestsForWorker(caller.orgId, caller.workerId);
        return NextResponse.json({ requests }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function POST(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        if (!caller.workerId) throw new HttpError(400, 'Vaš nalog nije povezan sa zapisom radnika.');

        const body = await req.json().catch(() => ({}));
        const kind = String(body.kind || '') as ChangeRequestKind;
        const payload = body.payload ?? {};
        const workOrderId = body.workOrderId ? String(body.workOrderId) : undefined;
        const productId = body.productId ? String(body.productId) : undefined;

        const meta: {
            workOrderId?: string; workOrderName?: string;
            itemId?: string; productId?: string; productName?: string; projectName?: string;
        } = {};
        const summaryCtx: SummaryContext = {};

        // ── Radnje vezane za nalog ───────────────────────────────────
        if (ORDER_KINDS.has(kind)) {
            if (!workOrderId) throw new HttpError(400, 'Nalog nije određen.');
            const order = await getWorkOrderById(caller.orgId, workOrderId);
            if (!order) throw new HttpError(404, 'Nalog nije pronađen.');
            const items = await getItemsForWorkOrders(caller.orgId, [workOrderId]);
            attachItems([order], items);

            // Radnik smije dirati nalog samo ako je na bar jednoj njegovoj stavci.
            if (!items.some(it => isWorkerAssignedToAutoItem(it as any, caller.workerId!))) {
                throw new HttpError(403, 'Nemate stavku na ovom nalogu.');
            }

            // „Označi gotovim" s telefona ne nosi radnike — radnik ne zna svoj
            // Worker_ID. Podrazumijevano knjiži SEBE; vlasnik može prilagoditi ekipu.
            if (kind === 'process_check' && payload?.action === 'complete'
                && (!Array.isArray(payload.workerIds) || payload.workerIds.length === 0)) {
                payload.workerIds = [caller.workerId];
            }

            meta.workOrderId = workOrderId;
            meta.workOrderName = workOrderDisplayName(order);
            fillOrderSummary(kind, payload, items, meta, summaryCtx);
        }

        // ── Radnje vezane za proizvod (materijal) ────────────────────
        else if (PRODUCT_KINDS.has(kind)) {
            if (!productId) throw new HttpError(400, 'Proizvod nije određen.');
            const openOrders = await getOpenWorkOrders(caller.orgId);
            const items = await getItemsForWorkOrders(caller.orgId, openOrders.map(o => o.Work_Order_ID));
            attachItems(openOrders, items);

            const mine = myProductIds(openOrders as WorkOrder[], caller.workerId);
            if (!mine.has(productId)) throw new HttpError(403, 'Nemate taj proizvod ni na jednom nalogu.');

            const item = items.find(i => i.Product_ID === productId);
            meta.productId = productId;
            meta.productName = item?.Product_Name;
            meta.projectName = item?.Project_Name;
            summaryCtx.productName = item?.Product_Name;
            summaryCtx.lineCount = Array.isArray(payload?.lines) ? payload.lines.length : 0;
        } else {
            throw new HttpError(400, 'Nepoznata vrsta prijedloga.');
        }

        const request = await createRequest(caller.orgId, {
            kind,
            rawPayload: payload,
            actor: { uid: caller.uid, name: caller.email || 'Radnik', workerId: caller.workerId },
            meta,
            summaryCtx,
        });

        return NextResponse.json({ ok: true, request }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}

function fillOrderSummary(
    kind: ChangeRequestKind,
    payload: any,
    items: WorkOrderItem[],
    meta: { itemId?: string; productName?: string; projectName?: string },
    ctx: SummaryContext,
) {
    if (kind === 'process_check') {
        ctx.action = payload?.action;
        ctx.procName = payload?.targets?.[0]?.procName;
        ctx.itemCount = Array.isArray(payload?.targets) ? payload.targets.length : 0;
    } else if (kind === 'process_add') {
        ctx.procName = payload?.procName;
        ctx.itemCount = Array.isArray(payload?.itemIds) ? payload.itemIds.length : 0;
    } else if (kind === 'process_remove') {
        ctx.procName = payload?.targets?.[0]?.procName;
        ctx.itemCount = Array.isArray(payload?.targets) ? payload.targets.length : 0;
    } else if (kind === 'item_complete') {
        const it = items.find(i => i.ID === payload?.itemId);
        if (it) { meta.itemId = it.ID; meta.productName = it.Product_Name; meta.projectName = it.Project_Name; ctx.productName = it.Product_Name; }
    } else if (kind === 'order_pause') {
        ctx.action = payload?.paused === false ? 'resume' : 'pause';
    } else if (kind === 'task_status') {
        ctx.action = payload?.done === false ? 'undone' : 'done';
    }
}
