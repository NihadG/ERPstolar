// ════════════════════════════════════════════════════════════════════
// GET /api/email/google/callback?code&state — povratak sa Googleove saglasnosti
//
// Nema Bearer tokena (stiže preusmjeravanjem), pa je identitet SAMO iz
// potpisanog `state`-a. Uvijek se vraća na Postavke → Kontakti s ishodom
// u ?gmail= (ok | denied | scopes | error).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { verifyState } from '@/lib/server/emailCrypto';
import { exchangeCode, fetchUserEmail, READ_SCOPE, saveEmailAccount, SEND_SCOPE } from '@/lib/server/gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(req: Request, outcome: string) {
    const url = new URL('/settings', new URL(req.url).origin);
    url.searchParams.set('section', 'kontakti');
    url.searchParams.set('gmail', outcome);
    return NextResponse.redirect(url);
}

export async function GET(req: Request) {
    const params = new URL(req.url).searchParams;
    let state: ReturnType<typeof verifyState> = null;
    try {
        state = verifyState(params.get('state') || '');
    } catch (e) {
        console.error('[gmail] povratak bez ključa za provjeru', e);   // EMAIL_TOKEN_KEY nije postavljen
    }
    if (!state) return back(req, 'error');
    if (params.get('error')) return back(req, 'denied');
    const code = params.get('code');
    if (!code) return back(req, 'error');

    try {
        const token = await exchangeCode(code, state.redirectUri);
        if (!token.refreshToken) return back(req, 'error');
        // Na Googleovom ekranu se dozvole mogu odznačiti — bez slanja i čitanja veza nema smisla.
        if (!token.scopes.includes(SEND_SCOPE) || !token.scopes.includes(READ_SCOPE)) return back(req, 'scopes');
        const email = await fetchUserEmail(token.accessToken);
        await saveEmailAccount({ uid: state.uid, orgId: state.orgId, email, refreshToken: token.refreshToken, scopes: token.scopes });
        return back(req, 'ok');
    } catch (e) {
        console.error('[gmail] povezivanje nije uspjelo', e);
        return back(req, 'error');
    }
}
