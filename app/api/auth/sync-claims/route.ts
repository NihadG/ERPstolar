// ════════════════════════════════════════════════════════════════════
// MIGRACIJA POSTOJEĆIH NALOGA NA CUSTOM CLAIMS
//
// Vlasnici koji su se registrovali prije uvođenja uloga nemaju orgId/role u
// tokenu — samo u users/{uid}. Ova ruta to izjednači. AuthContext je zove kad
// primijeti da token nema orgId, pa uradi getIdToken(true).
//
// Ruta NIKAD ne dodjeljuje ulogu koju korisnik zatraži — čita je iz Firestorea.
// Jedini izuzetak je bootstrap: nalog bez zapisane uloge dobija 'worker'
// (najmanje ovlaštenje), nikad 'owner'.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';
import { errorResponse, HttpError } from '@/lib/server/requireUser';
import type { UserRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ROLES: UserRole[] = ['owner', 'admin', 'manager', 'controller', 'worker'];

export async function POST(req: Request) {
    try {
        const header = req.headers.get('authorization');
        if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Nedostaje token.');

        // Namjerno BEZ checkRevoked: ova ruta se zove odmah nakon prijave i njen
        // posao je da popravi token, pa ne smije zavisiti od stanja koje popravlja.
        const decoded = await adminAuth().verifyIdToken(header.slice(7).trim()).catch(() => null);
        if (!decoded) throw new HttpError(401, 'Token nije važeći.');

        const snap = await adminDb().collection('users').doc(decoded.uid).get();
        const profile = snap.data();
        if (!profile?.Organization_ID) throw new HttpError(403, 'Korisnički profil nije pronađen.');
        if (profile.Is_Active === false) throw new HttpError(403, 'Nalog je deaktiviran.');

        const role: UserRole = VALID_ROLES.includes(profile.Role) ? profile.Role : 'worker';
        const claims: Record<string, unknown> = { orgId: profile.Organization_ID, role };
        if (profile.Worker_ID) claims.workerId = profile.Worker_ID;
        if (profile.Is_Super_Admin === true) claims.superAdmin = true;

        const alreadyCorrect =
            decoded.orgId === claims.orgId &&
            decoded.role === claims.role &&
            (decoded.workerId ?? undefined) === (claims.workerId ?? undefined);

        if (!alreadyCorrect) {
            await adminAuth().setCustomUserClaims(decoded.uid, claims);
        }

        return NextResponse.json({ ok: true, updated: !alreadyCorrect, role, orgId: profile.Organization_ID });
    } catch (e) {
        return errorResponse(e);
    }
}
