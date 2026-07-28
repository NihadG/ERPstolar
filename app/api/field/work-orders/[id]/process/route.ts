// ════════════════════════════════════════════════════════════════════
// ČEKIRANJE PROCESA
//
// Najjeftiniji upis u sistemu: mijenja samo `Processes` na stavci, bez
// kaskade i bez novca. Zato se poništava jednim dodirom i nema dijaloga
// za potvrdu — potvrda se traži samo za nepovratno.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { getActiveWorkers, getWorkOrderById } from '@/lib/server/fieldRepo';
import { updateItemProcesses, type ProcessUpdateTarget } from '@/lib/server/fieldWrites';
import type { ItemProcessStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireController(req);

        const order = await getWorkOrderById(caller.orgId, params.id);
        if (!order) throw new HttpError(404, 'Nalog nije pronađen.');

        const body = await req.json().catch(() => ({}));
        const action = String(body.action || 'complete');

        const targets: ProcessUpdateTarget[] = Array.isArray(body.targets)
            ? body.targets
                .map((t: any) => ({ itemId: String(t?.itemId || ''), procName: String(t?.procName || '') }))
                .filter((t: ProcessUpdateTarget) => t.itemId && t.procName)
            : [];
        if (targets.length === 0) throw new HttpError(400, 'Nije odabran nijedan proizvod.');

        let updates: Partial<ItemProcessStatus>;

        if (action === 'complete') {
            const date = String(body.date || '');
            if (!isISODate(date)) throw new HttpError(400, 'Neispravan datum.');
            if (date > new Date().toISOString().split('T')[0]) {
                throw new HttpError(400, 'Datum ne može biti u budućnosti.');
            }

            // Radnici se razrješavaju IZ BAZE — prvi je glavni, ostali pomoćnici.
            const workerIds: string[] = Array.isArray(body.workerIds)
                ? body.workerIds.map((x: unknown) => String(x)).filter(Boolean)
                : [];
            if (workerIds.length === 0) throw new HttpError(400, 'Odaberi bar jednog radnika.');

            const workers = await getActiveWorkers(caller.orgId);
            const byId = new Map(workers.map(w => [w.Worker_ID, w]));
            const chosen = workerIds.map(id => byId.get(id)).filter(Boolean) as typeof workers;
            if (chosen.length === 0) throw new HttpError(400, 'Odabrani radnici nisu pronađeni.');

            const [main, ...helpers] = chosen;
            updates = {
                Status: 'Završeno',
                // Podne, ne ponoć — datum ostaje isti u svakoj vremenskoj zoni.
                Completed_At: new Date(date + 'T12:00:00').toISOString(),
                Worker_ID: main.Worker_ID,
                Worker_Name: main.Name,
                Helpers: helpers.map(h => ({ Worker_ID: h.Worker_ID, Worker_Name: h.Name })),
                Notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined,
            };
        } else if (action === 'start') {
            updates = { Status: 'U toku', Started_At: new Date().toISOString() };
        } else if (action === 'defer') {
            updates = { Status: 'Odloženo' };
        } else if (action === 'reset') {
            updates = { Status: 'Na čekanju', Completed_At: '' };
        } else {
            throw new HttpError(400, 'Nepoznata radnja.');
        }

        const changed = await updateItemProcesses(caller.orgId, targets, updates);
        return NextResponse.json({ ok: true, changed });
    } catch (e) {
        return errorResponse(e);
    }
}
