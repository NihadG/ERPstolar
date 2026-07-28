// ════════════════════════════════════════════════════════════════════
// JEDAN KORISNIK — izmjena i deaktivacija
//
// PATCH  → ime / telefon / uloga / veza s radnikom / ponovno aktiviranje
// DELETE → DEAKTIVACIJA, nikad brisanje. Nalog je vezan za dnevnice, zadatke i
//          istoriju procesa; brisanjem bi ti zapisi ostali bez autora.
//
// Pri promjeni uloge obavezno ide revokeRefreshTokens: bez toga bi degradirani
// korisnik do sat vremena hodao sa starim, jačim tokenom.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';
import { errorResponse, HttpError, requireOrgAdmin } from '@/lib/server/requireUser';
import {
    assertTeamModule, getOrganization, resolveWorkerLink, setUserClaims, toMemberDTO, writeWorkerLink,
} from '@/lib/server/teamRepo';
import { isAssignableRole } from '@/lib/team/plan';
import type { User, UserRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Učita ciljni profil i potvrdi da pripada ISTOJ organizaciji kao pozivalac. */
async function loadTarget(uid: string, orgId: string): Promise<User> {
    const snap = await adminDb().collection('users').doc(uid).get();
    const target = snap.data() as User | undefined;
    if (!target || target.Organization_ID !== orgId) {
        throw new HttpError(404, 'Korisnik nije pronađen u vašoj organizaciji.');
    }
    return target;
}

export async function PATCH(req: Request, { params }: { params: { uid: string } }) {
    try {
        const caller = await requireOrgAdmin(req);
        const org = await getOrganization(caller.orgId);
        assertTeamModule(org);

        const uid = params.uid;
        const target = await loadTarget(uid, caller.orgId);

        // Vlasnik je jedini nalog bez kojeg firma ostaje bez pristupa svemu.
        if (target.Role === 'owner') {
            throw new HttpError(403, 'Nalog vlasnika se ne može mijenjati odavde.');
        }

        const body = await req.json().catch(() => ({}));
        const updates: Record<string, unknown> = {};

        if (typeof body.name === 'string' && body.name.trim()) updates.Name = body.name.trim();
        if (typeof body.phone === 'string') updates.Phone = body.phone.trim();

        let nextRole: UserRole = target.Role;
        if (typeof body.role === 'string' && body.role !== target.Role) {
            if (!isAssignableRole(body.role)) throw new HttpError(400, 'Uloga nije dozvoljena.');
            nextRole = body.role;
            updates.Role = nextRole;
        }

        // Veza s radnikom: `null` je izričito raskidanje, `undefined` = ne diraj.
        let nextWorkerId: string | null | undefined;
        if ('workerId' in body) {
            nextWorkerId = body.workerId ? String(body.workerId) : null;
        }
        const effectiveWorkerId = nextWorkerId === undefined ? (target.Worker_ID || null) : nextWorkerId;
        const worker = await resolveWorkerLink(caller.orgId, effectiveWorkerId, nextRole, uid);
        if (nextWorkerId !== undefined) updates.Worker_ID = nextWorkerId || '';

        let reactivated = false;
        if (typeof body.isActive === 'boolean' && body.isActive !== (target.Is_Active !== false)) {
            updates.Is_Active = body.isActive;
            updates.Disabled_At = body.isActive ? '' : new Date().toISOString();
            await adminAuth().updateUser(uid, { disabled: !body.isActive });
            reactivated = body.isActive;
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ member: toMemberDTO({ ...target, User_ID: uid }, worker?.Name ?? null) });
        }

        await adminDb().collection('users').doc(uid).update(updates);

        const roleChanged = nextRole !== target.Role;
        const linkChanged = nextWorkerId !== undefined && nextWorkerId !== (target.Worker_ID || null);

        if (roleChanged || linkChanged) {
            await setUserClaims(uid, caller.orgId, nextRole, effectiveWorkerId);
        }
        if (linkChanged) {
            await writeWorkerLink({
                orgId: caller.orgId, uid, email: target.Email,
                newWorkerId: nextWorkerId ?? null, previousWorkerId: target.Worker_ID || null,
            });
        }
        // Stari token nosi staru ulogu do isteka — opozovi ga odmah.
        if (roleChanged || linkChanged || reactivated) {
            await adminAuth().revokeRefreshTokens(uid);
        }

        const merged = { ...target, ...updates, User_ID: uid } as User & { User_ID: string };
        return NextResponse.json({ member: toMemberDTO(merged, worker?.Name ?? null) });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function DELETE(req: Request, { params }: { params: { uid: string } }) {
    try {
        const caller = await requireOrgAdmin(req);
        const uid = params.uid;

        if (uid === caller.uid) throw new HttpError(400, 'Ne možete deaktivirati vlastiti nalog.');

        const target = await loadTarget(uid, caller.orgId);
        if (target.Role === 'owner') throw new HttpError(403, 'Nalog vlasnika se ne može deaktivirati.');

        await adminAuth().updateUser(uid, { disabled: true });
        await adminAuth().revokeRefreshTokens(uid);
        await adminDb().collection('users').doc(uid).update({
            Is_Active: false,
            Disabled_At: new Date().toISOString(),
        });

        // Veza s radnikom se NE raskida: dnevnice i istorija procesa vezane su za
        // Worker_ID i moraju ostati čitljive. Ponovno aktiviranje tako radi bez
        // ponovnog povezivanja.
        return NextResponse.json({ ok: true });
    } catch (e) {
        return errorResponse(e);
    }
}
