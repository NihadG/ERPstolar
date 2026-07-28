// ════════════════════════════════════════════════════════════════════
// ZATVARANJE PROIZVODA
//
// Za razliku od čekiranja procesa, ovo DIRA NOVAC: zamrzava trošak rada na
// stavci i osvježava nalog. Zato odgovor ne nosi nijedan iznos, a radnja se
// traži uz potvrdu na ekranu.
//
// Zatvaranje CIJELOG NALOGA nije ovdje i neće biti — ono okida obračun profita
// i production snapshot, što je vlasnikova odluka.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { getWorkOrderById } from '@/lib/server/fieldRepo';
import { completeItem, reopenItem } from '@/lib/server/fieldWrites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireController(req);

        const order = await getWorkOrderById(caller.orgId, params.id);
        if (!order) throw new HttpError(404, 'Nalog nije pronađen.');

        const body = await req.json().catch(() => ({}));
        const itemId = String(body.itemId || '');
        if (!itemId) throw new HttpError(400, 'Proizvod nije naveden.');

        if (body.action === 'reopen') {
            await reopenItem(caller.orgId, order.Work_Order_ID, itemId);
            return NextResponse.json({ ok: true, status: 'U toku' });
        }

        const date = String(body.date || '');
        if (!isISODate(date)) throw new HttpError(400, 'Neispravan datum.');
        if (date > new Date().toISOString().split('T')[0]) {
            throw new HttpError(400, 'Datum ne može biti u budućnosti.');
        }

        await completeItem(caller.orgId, order.Work_Order_ID, itemId, new Date(date + 'T12:00:00').toISOString());
        return NextResponse.json({ ok: true, status: 'Završeno' });
    } catch (e) {
        return errorResponse(e);
    }
}
