// ════════════════════════════════════════════════════════════════════
// IZDAVANJE NOVE LOZINKE
//
// Vlasnik zada novu lozinku kad je radnik izgubi. Lozinka putuje jednom
// (HTTPS → ova ruta → Firebase Auth), ne upisuje se u Firestore i ne loguje se.
//
// Nakon reseta se diže Must_Change_Password i opozivaju refresh tokeni: stara
// sesija na radnikovom telefonu prestaje da važi, a nova prijava traži da
// radnik odmah postavi svoju lozinku — pa vlasnikovo poznavanje te lozinke
// vrijedi samo do prve prijave.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';
import { errorResponse, HttpError, requireOrgAdmin } from '@/lib/server/requireUser';
import { checkPassword } from '@/lib/team/plan';
import type { User } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { uid: string } }) {
    try {
        const caller = await requireOrgAdmin(req);
        const uid = params.uid;

        const snap = await adminDb().collection('users').doc(uid).get();
        const target = snap.data() as User | undefined;
        if (!target || target.Organization_ID !== caller.orgId) {
            throw new HttpError(404, 'Korisnik nije pronađen u vašoj organizaciji.');
        }
        if (target.Role === 'owner' && uid !== caller.uid) {
            throw new HttpError(403, 'Lozinku vlasnika mijenja samo vlasnik.');
        }

        const body = await req.json().catch(() => ({}));
        const password = String(body.password || '');
        const check = checkPassword(password);
        if (!check.ok) throw new HttpError(400, check.reason!);

        await adminAuth().updateUser(uid, { password });
        await adminAuth().revokeRefreshTokens(uid);
        await adminDb().collection('users').doc(uid).update({ Must_Change_Password: true });

        return NextResponse.json({ ok: true });
    } catch (e) {
        return errorResponse(e);
    }
}
