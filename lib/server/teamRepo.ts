// ════════════════════════════════════════════════════════════════════
// ČITANJA/PISANJA VEZANA ZA KORISNIKE ORGANIZACIJE (admin SDK)
//
// Izdvojeno iz ruta da bi rute ostale tanke i da bi se ista pravila (npr.
// „radnik smije biti vezan za najviše jedan nalog") primjenjivala i pri
// kreiranju i pri izmjeni.
// ════════════════════════════════════════════════════════════════════

import { adminAuth, adminDb } from './firebaseAdmin';
import { HttpError } from './requireUser';
import { seatLimitFor, checkSeatAvailable, planHasTeamModule, requiresWorkerLink } from '@/lib/team/plan';
import type { Organization, User, UserRole, Worker } from '@/lib/types';

/** Ono što klijent smije vidjeti o korisniku — nikad interni claim ni token. */
export interface TeamMemberDTO {
    uid: string;
    name: string;
    email: string;
    role: UserRole;
    isActive: boolean;
    isOwner: boolean;
    workerId: string | null;
    workerName: string | null;
    phone: string | null;
    mustChangePassword: boolean;
    createdDate: string | null;
    lastLogin: string | null;
}

export function toMemberDTO(u: Partial<User> & { User_ID: string }, workerName?: string | null): TeamMemberDTO {
    return {
        uid: u.User_ID,
        name: u.Name || '',
        email: u.Email || '',
        role: (u.Role as UserRole) || 'worker',
        isActive: u.Is_Active !== false,
        isOwner: u.Role === 'owner',
        workerId: u.Worker_ID || null,
        workerName: workerName ?? null,
        phone: u.Phone || null,
        mustChangePassword: u.Must_Change_Password === true,
        createdDate: u.Created_Date || null,
        lastLogin: u.Last_Login || null,
    };
}

export async function getOrganization(orgId: string): Promise<Organization> {
    const snap = await adminDb().collection('organizations').doc(orgId).get();
    const org = snap.data() as Organization | undefined;
    if (!org) throw new HttpError(404, 'Organizacija nije pronađena.');
    return org;
}

/** Modul „team" je ono što se plaća — bez njega nema dodavanja naloga. */
export function assertTeamModule(org: Organization): void {
    if (!planHasTeamModule(org.Subscription_Plan, org.Modules)) {
        throw new HttpError(403, 'Upravljanje korisnicima nije uključeno u vaš paket. Nadogradite na Enterprise.');
    }
}

export async function listOrgUsers(orgId: string): Promise<(User & { User_ID: string })[]> {
    const snap = await adminDb().collection('users').where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => ({ ...(d.data() as User), User_ID: d.id }));
}

export async function listOrgWorkers(orgId: string): Promise<Worker[]> {
    const snap = await adminDb().collection('workers').where('Organization_ID', '==', orgId).get();
    return snap.docs.map(d => d.data() as Worker);
}

/** Broj mjesta koji se troši = AKTIVNI nalozi. Deaktivirani ne blokiraju firmu. */
export async function assertSeatAvailable(org: Organization, orgId: string): Promise<void> {
    const users = await listOrgUsers(orgId);
    const active = users.filter(u => u.Is_Active !== false).length;
    const check = checkSeatAvailable(active, seatLimitFor(org));
    if (!check.ok) throw new HttpError(409, check.reason || 'Nema slobodnih mjesta u paketu.');
}

/**
 * Radnik smije biti vezan za najviše jedan nalog. Bez ove provjere bi dva
 * korisnika dijelila isti pogonski identitet, pa bi „moje stavke" i knjiženje
 * dnevnica pokazivali isto za obojicu.
 */
export async function resolveWorkerLink(
    orgId: string,
    workerId: string | null | undefined,
    role: UserRole,
    excludeUid?: string
): Promise<Worker | null> {
    if (!workerId) {
        if (requiresWorkerLink(role)) {
            throw new HttpError(400, 'Radnik i kontrolor moraju biti povezani sa zapisom radnika.');
        }
        return null;
    }

    const snap = await adminDb().collection('workers')
        .where('Worker_ID', '==', workerId)
        .where('Organization_ID', '==', orgId)
        .limit(1)
        .get();
    if (snap.empty) throw new HttpError(404, 'Radnik nije pronađen u vašoj organizaciji.');

    const worker = snap.docs[0].data() as Worker;
    if (worker.User_ID && worker.User_ID !== excludeUid) {
        throw new HttpError(409, `Radnik ${worker.Name} već ima nalog za prijavu.`);
    }
    return worker;
}

export async function setUserClaims(uid: string, orgId: string, role: UserRole, workerId?: string | null) {
    const claims: Record<string, unknown> = { orgId, role };
    if (workerId) claims.workerId = workerId;
    await adminAuth().setCustomUserClaims(uid, claims);
}

/** Piše obje strane veze radnik ↔ nalog u jednom batchu (ili je raskida). */
export async function writeWorkerLink(params: {
    orgId: string;
    uid: string;
    email: string;
    newWorkerId: string | null;
    previousWorkerId?: string | null;
}) {
    const { orgId, uid, email, newWorkerId, previousWorkerId } = params;
    if (newWorkerId === (previousWorkerId ?? null)) return;

    const db = adminDb();
    const batch = db.batch();

    const findRef = async (workerId: string) => {
        const s = await db.collection('workers')
            .where('Worker_ID', '==', workerId).where('Organization_ID', '==', orgId).limit(1).get();
        return s.empty ? null : s.docs[0].ref;
    };

    if (previousWorkerId) {
        const ref = await findRef(previousWorkerId);
        // FieldValue.delete() bi tražio import; prazan string je dovoljan jer se
        // svuda provjerava truthiness (`worker.User_ID && ...`).
        if (ref) batch.update(ref, { User_ID: '', Email: '' });
    }
    if (newWorkerId) {
        const ref = await findRef(newWorkerId);
        if (ref) batch.update(ref, { User_ID: uid, Email: email });
    }

    await batch.commit();
}
