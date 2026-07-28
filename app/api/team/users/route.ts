// ════════════════════════════════════════════════════════════════════
// KORISNICI ORGANIZACIJE — lista i kreiranje
//
// GET  → svi nalozi firme (za sekciju „Korisnici" u Postavkama)
// POST → kreira Auth korisnika + users/{uid} + claims + veže radnika
//
// Organizacija se UVIJEK uzima iz tokena pozivaoca. Da se prihvata iz body-ja,
// admin jedne firme bi kreirao naloge u tuđoj.
//
// Lozinka se ne upisuje nigdje — ide samo Firebase Authu. U odgovoru se NE
// vraća; vlasnik je već ima (sam ju je zadao ili ju je klijent generisao).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';
import { errorResponse, HttpError, requireOrgAdmin } from '@/lib/server/requireUser';
import {
    assertSeatAvailable, assertTeamModule, createWorkerForUser, getOrganization,
    listOrgUsers, listOrgWorkers, resolveWorkerLink, setUserClaims, toMemberDTO, writeWorkerLink,
} from '@/lib/server/teamRepo';
import { seatLimitFor } from '@/lib/team/plan';
import { checkPassword, isAssignableRole, isValidEmail, normalizeEmail } from '@/lib/team/plan';
import type { User, Worker } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const caller = await requireOrgAdmin(req);
        const [org, users, workers] = await Promise.all([
            getOrganization(caller.orgId),
            listOrgUsers(caller.orgId),
            listOrgWorkers(caller.orgId),
        ]);

        const workerNameById = new Map(workers.map(w => [w.Worker_ID, w.Name]));
        const members = users
            .map(u => toMemberDTO(u, u.Worker_ID ? workerNameById.get(u.Worker_ID) ?? null : null))
            .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name, 'bs'));

        return NextResponse.json({
            members,
            seats: { used: members.filter(m => m.isActive).length, limit: seatLimitFor(org) },
            // Radnici bez naloga — ponuda u padajućem izborniku pri dodavanju.
            availableWorkers: workers
                .filter(w => !w.User_ID && w.Status !== 'Obrisan')
                .map(w => ({ workerId: w.Worker_ID, name: w.Name, role: w.Role }))
                .sort((a, b) => a.name.localeCompare(b.name, 'bs')),
        });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function POST(req: Request) {
    try {
        const caller = await requireOrgAdmin(req);
        const org = await getOrganization(caller.orgId);
        assertTeamModule(org);
        await assertSeatAvailable(org, caller.orgId);

        const body = await req.json().catch(() => ({}));
        const name = String(body.name || '').trim();
        const email = normalizeEmail(String(body.email || ''));
        const password = String(body.password || '');
        const role = String(body.role || '');
        const phone = String(body.phone || '').trim();
        const workerId = body.workerId ? String(body.workerId) : null;

        if (!name) throw new HttpError(400, 'Ime je obavezno.');
        if (!isValidEmail(email)) throw new HttpError(400, 'Email adresa nije ispravna.');
        if (!isAssignableRole(role)) throw new HttpError(400, 'Uloga nije dozvoljena.');

        const pw = checkPassword(password);
        if (!pw.ok) throw new HttpError(400, pw.reason!);

        // „Kreiraj novog radnika" iz modala — pravi zapis pa ga odmah veže.
        // Bez ovoga firma bez slobodnog radnika ne bi mogla napraviti nalog.
        let linkWorkerId = workerId;
        let createdWorker: Worker | null = null;
        if (!linkWorkerId && typeof body.newWorkerName === 'string' && body.newWorkerName.trim()) {
            createdWorker = await createWorkerForUser(caller.orgId, {
                name: body.newWorkerName,
                role: typeof body.newWorkerRole === 'string' ? body.newWorkerRole : undefined,
            });
            linkWorkerId = createdWorker.Worker_ID;
        }

        const worker = createdWorker || await resolveWorkerLink(caller.orgId, linkWorkerId, role);

        // ── Auth korisnik ────────────────────────────────────────────
        let uid: string;
        try {
            const created = await adminAuth().createUser({
                email, password, displayName: name, emailVerified: false,
            });
            uid = created.uid;
        } catch (e: any) {
            if (e?.code === 'auth/email-already-exists') {
                throw new HttpError(409, 'Nalog s ovom email adresom već postoji.');
            }
            if (e?.code === 'auth/invalid-password') throw new HttpError(400, 'Lozinka nije prihvaćena.');
            throw e;
        }

        // ── Profil + claims ──────────────────────────────────────────
        // Redoslijed je bitan: profil prvo, pa claims. Ako claims padnu, korisnik
        // se prijavi bez njih i AuthContext ga pošalje na /api/auth/sync-claims,
        // koji ih popravi iz profila. Obrnuto se ne bi samo popravilo.
        const profile: User = {
            User_ID: uid,
            Email: email,
            Name: name,
            Role: role,
            Organization_ID: caller.orgId,
            Created_Date: new Date().toISOString(),
            Last_Login: '',
            Is_Active: true,
            Must_Change_Password: true,   // vlasnik zna lozinku dok je radnik ne zamijeni
            Created_By: caller.uid,
            ...(linkWorkerId ? { Worker_ID: linkWorkerId } : {}),
            ...(phone ? { Phone: phone } : {}),
        };
        await adminDb().collection('users').doc(uid).set(profile);
        await setUserClaims(uid, caller.orgId, role, linkWorkerId);
        await writeWorkerLink({ orgId: caller.orgId, uid, email, newWorkerId: linkWorkerId });

        return NextResponse.json({ member: toMemberDTO(profile, worker?.Name ?? null) }, { status: 201 });
    } catch (e) {
        return errorResponse(e);
    }
}
