// ════════════════════════════════════════════════════════════════════
// /api/email/google — Gmail veza prijavljenog korisnika
//
//   GET     { configured, connected, email, sendAs, status, connectedAt }
//   PATCH   { sendAs }   adresa u polju „Od" (potvrđeni alias u Gmailu)
//   DELETE  opozovi token kod Googlea i obriši vezu
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireStaff } from '@/lib/server/requireUser';
import { disconnectEmailAccount, getEmailAccount, oauthClient, updateEmailAccount } from '@/lib/server/gmail';
import { isValidEmail, normalizeEmail } from '@/lib/contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const caller = await requireStaff(req);
        const account = await getEmailAccount(caller.uid);
        const mine = account && account.Organization_ID === caller.orgId ? account : null;
        return NextResponse.json({
            configured: !!oauthClient(),
            connected: !!mine,
            email: mine?.Email || null,
            sendAs: mine?.Send_As || mine?.Email || null,
            status: mine?.Status || null,
            connectedAt: mine?.Connected_At || null,
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function PATCH(req: Request) {
    try {
        const caller = await requireStaff(req);
        const body = await req.json().catch(() => ({})) as { sendAs?: unknown };
        const sendAs = normalizeEmail(typeof body.sendAs === 'string' ? body.sendAs : '');
        if (!isValidEmail(sendAs)) throw new HttpError(400, 'Unesite ispravnu adresu.');
        const account = await getEmailAccount(caller.uid);
        if (!account || account.Organization_ID !== caller.orgId) throw new HttpError(409, 'Gmail nije povezan.');
        await updateEmailAccount(caller.uid, { Send_As: sendAs === account.Email ? '' : sendAs });
        return NextResponse.json({ sendAs });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function DELETE(req: Request) {
    try {
        const caller = await requireStaff(req);
        await disconnectEmailAccount(caller.uid);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return errorResponse(e);
    }
}
