// ════════════════════════════════════════════════════════════════════
// PRIJEM MATERIJALA
//
// Poništavanje je ravnopravna radnja — kontrolor koji greškom čekira mora
// moći odmah ispraviti, bez zvanja vlasnika.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { setItemsReceived } from '@/lib/server/fieldPurchases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireController(req);

        const orderSnap = await adminDb().collection('orders')
            .where('Organization_ID', '==', caller.orgId)
            .where('Order_ID', '==', params.id)
            .limit(1)
            .get();
        if (orderSnap.empty) throw new HttpError(404, 'Narudžba nije pronađena.');

        const body = await req.json().catch(() => ({}));
        const itemIds: string[] = Array.isArray(body.itemIds)
            ? body.itemIds.map((x: unknown) => String(x)).filter(Boolean)
            : [];
        if (itemIds.length === 0) throw new HttpError(400, 'Nije odabrana nijedna stavka.');

        const received = body.received !== false;
        const result = await setItemsReceived(caller.orgId, itemIds, received);

        const message = result.changed === 0
            ? 'Nema promjena.'
            : received
                ? `Primljeno ${result.changed} ${result.changed === 1 ? 'stavka' : 'stavki'}`
                : `Poništen prijem za ${result.changed} ${result.changed === 1 ? 'stavku' : 'stavki'}`;

        return NextResponse.json({ ...result, message });
    } catch (e) {
        return errorResponse(e);
    }
}
