// ════════════════════════════════════════════════════════════════════
// POST /api/email/google/connect → { url }
//
// Preglednik ne može poslati Bearer token kroz Googleov redirect, pa ruta
// vrati adresu saglasnosti s potpisanim `state` (uid + org + redirect URI);
// klijent na nju preusmjeri prozor. Povratak stiže na /callback.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireStaff } from '@/lib/server/requireUser';
import { signState } from '@/lib/server/emailCrypto';
import { authUrl, GmailError, gmailErrorJson } from '@/lib/server/gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const caller = await requireStaff(req);
        const redirectUri = `${new URL(req.url).origin}/api/email/google/callback`;
        const state = signState({ uid: caller.uid, orgId: caller.orgId, redirectUri });
        return NextResponse.json({ url: authUrl({ redirectUri, state, loginHint: caller.email || undefined }) });
    } catch (e) {
        if (e instanceof GmailError) { const r = gmailErrorJson(e); return NextResponse.json(r.body, { status: r.status }); }
        return errorResponse(e);
    }
}
