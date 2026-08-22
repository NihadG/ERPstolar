// ════════════════════════════════════════════════════════════════════
// KNJIGA RADA NALOGA — čitanje i ispravke s telefona
//
// GET  → dani naloga s radnicima (iznosi samo za staff)
// POST → `add`    : upiši ekipu na dan (ručni unos, šihtarica ga ne briše)
//        `remove` : skini radnika s dana
//
// ŠTA OVDJE NAMJERNO NE POSTOJI: desktopov „spremi cijeli dan" (`saveWorkOrderDayBooking`),
// koji dan briše do nule pa ga ispiše iznova. Ta radnja nosi pravila koja se s
// telefona ne mogu vidjeti ni provjeriti (preusmjeren trošak „raznih poslova"
// koji fizički živi na tuđem nalogu, istorija atribucije procesa). Dodavanje i
// skidanje po radniku daju isti ishod u svim slučajevima koje pogon ima pred
// sobom, a oslanjaju se na već provjerene `bookWorkerDayItems` /
// `renormalizeWorkerDay` umjesto na drugi prepis najosjetljivije funkcije.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import {
    getActiveWorkers, getItemsForWorkOrders, getWorkLogsForWorkOrder, getWorkOrderById,
} from '@/lib/server/fieldRepo';
import {
    bookWorkerDayItems, recalcOrderLabor, removeWorkerDayFromOrder, type BookTarget,
} from '@/lib/server/fieldAttendance';
import { buildFieldWorkLog } from '@/lib/field/fieldWorkLog';
import { isStaffRole, type Worker } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const namesOf = (workers: Worker[]) => new Map(workers.map(w => [w.Worker_ID, w.Name || '']));

async function load(orgId: string, workOrderId: string) {
    const order = await getWorkOrderById(orgId, workOrderId);
    if (!order) throw new HttpError(404, 'Nalog nije pronađen.');
    const [items, logs, workers] = await Promise.all([
        getItemsForWorkOrders(orgId, [workOrderId]),
        getWorkLogsForWorkOrder(orgId, workOrderId),
        getActiveWorkers(orgId),
    ]);
    return { order, items, logs, workers };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireController(req);
        const { order, items, logs, workers } = await load(caller.orgId, params.id);

        return NextResponse.json(
            buildFieldWorkLog({
                today: todayISO(),
                order, items, logs,
                workerNames: namesOf(workers),
                // Kontrolor raspoređuje ljude, vlasnik gleda i trošak.
                includeCost: isStaffRole(caller.role) || caller.isSuperAdmin,
            }),
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (e) {
        return errorResponse(e);
    }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireController(req);
        const body = await req.json().catch(() => ({}));

        const action = String(body.action || '');
        const date = String(body.date || '');
        if (!isISODate(date)) throw new HttpError(400, 'Neispravan datum.');
        if (date > todayISO()) throw new HttpError(400, 'Ne može se knjižiti unaprijed.');

        const { order, items, workers } = await load(caller.orgId, params.id);
        const byId = new Map(workers.map(w => [w.Worker_ID, w]));

        if (action === 'remove') {
            const workerId = String(body.workerId || '');
            if (!byId.has(workerId)) throw new HttpError(404, 'Radnik nije pronađen.');

            const res = await removeWorkerDayFromOrder(caller.orgId, order.Work_Order_ID, workerId, date);
            await Promise.all(res.affectedWorkOrderIds.map(id =>
                recalcOrderLabor(caller.orgId, id).catch(e => console.warn('[worklog] recalc', id, e))
            ));
            return NextResponse.json({
                removed: res.removed,
                message: res.removed > 0
                    ? `${byId.get(workerId)!.Name} skinut s tog dana`
                    : 'Taj radnik nije bio knjižen na ovaj nalog tog dana.',
            });
        }

        if (action !== 'add') throw new HttpError(400, 'Nepoznata radnja.');

        const workerIds: string[] = Array.isArray(body.workerIds)
            ? body.workerIds.map((x: unknown) => String(x)).filter((id: string) => byId.has(id))
            : [];
        if (workerIds.length === 0) throw new HttpError(400, 'Nijedan radnik nije izabran.');

        // Prazan izbor stavki = cijeli nalog. Nalog s jednim proizvodom tako ne
        // traži izbor koji ima samo jedan mogući odgovor.
        const wanted: string[] = Array.isArray(body.itemIds)
            ? body.itemIds.map((x: unknown) => String(x))
            : [];
        const chosen = wanted.length > 0 ? items.filter(it => wanted.includes(it.ID)) : items;
        if (chosen.length === 0) throw new HttpError(400, 'Nalog nema stavku na koju bi se dan knjižio.');

        const presence: 0.5 | 1 = body.presence === 0.5 ? 0.5 : 1;
        const targets: BookTarget[] = chosen.map(it => ({
            workOrderId: order.Work_Order_ID, itemId: it.ID, productId: it.Product_ID,
        }));

        const affected = new Set<string>([order.Work_Order_ID]);
        let created = 0;
        const failed: string[] = [];

        for (const workerId of workerIds) {
            const worker = byId.get(workerId)!;
            try {
                const res = await bookWorkerDayItems(
                    caller.orgId, workerId, worker.Name, date, targets, presence, 'manual'
                );
                res.affectedWorkOrderIds.forEach(id => affected.add(id));
                created += res.created;
            } catch (e) {
                console.error('[worklog] knjiženje nije uspjelo', workerId, e);
                failed.push(worker.Name);
            }
        }

        await Promise.all(Array.from(affected).map(id =>
            recalcOrderLabor(caller.orgId, id).catch(e => console.warn('[worklog] recalc', id, e))
        ));

        const message = failed.length > 0
            ? `Greška za: ${failed.join(', ')}${created > 0 ? ' — ostalo upisano' : ''}`
            : created > 0
                ? `Upisano ${created} ${created === 1 ? 'zapis' : 'zapisa'}`
                : 'Taj dan je već upisan za izabrane radnike.';

        return NextResponse.json({ created, failedWorkers: failed, message });
    } catch (e) {
        return errorResponse(e);
    }
}
