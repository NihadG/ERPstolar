// ════════════════════════════════════════════════════════════════════
// POST /api/email/drafts { purpose: 'order', orderId } → nacrt za pregled
//
// Ništa se ne šalje: vraća primaoca iz Kontakata, naslov, tekst i prilog,
// plus kontakte za izbor. Slanje je zaseban klik (/[id]/send).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { HttpError, requireStaff } from '@/lib/server/requireUser';
import { createOrderDraft } from '@/lib/server/emailDrafts';
import { emailErrorResponse } from '@/lib/server/emailHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const caller = await requireStaff(req);
        const body = await req.json().catch(() => ({})) as { purpose?: unknown; orderId?: unknown };
        if (body.purpose !== 'order' || typeof body.orderId !== 'string' || !body.orderId) {
            throw new HttpError(400, 'Za sada se mailom šalje narudžba (purpose: order, orderId).');
        }
        const view = await createOrderDraft({ orgId: caller.orgId, uid: caller.uid, orderId: body.orderId, source: 'app' });
        return NextResponse.json(view);
    } catch (e) {
        return emailErrorResponse(e);
    }
}
