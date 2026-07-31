// ════════════════════════════════════════════════════════════════════
// ČIJI RADNIKOV EKRAN GRADIMO
//
// Radnikove rute grade LIČNI pregled, pa moraju znati o kom je radniku riječ.
// Dva slučaja:
//   • radnik gleda sebe          → subject = caller, workerId iz njegovog naloga,
//   • vlasnik/staff „Pogledaj kao" → subject = uid iz ?preview, ali SAMO unutar
//     iste organizacije (ista provjera kao /api/field/home).
//
// Bez `workerId`-ja nema šta prikazati — jasna greška umjesto tihe prazne liste.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import { HttpError, type AuthedUser } from './requireUser';
import { isStaffRole, type User } from '@/lib/types';

export interface WorkerSubject {
    workerId: string;
    subjectUid: string;
    preview: boolean;
}

export async function resolveWorkerSubject(req: Request, caller: AuthedUser): Promise<WorkerSubject> {
    const previewUid = new URL(req.url).searchParams.get('preview');

    // Vlastiti ekran — workerId iz claim-a/profila, bez dodatnog čitanja.
    if (!previewUid || previewUid === caller.uid) {
        if (!caller.workerId) {
            throw new HttpError(400, 'Vaš nalog nije povezan sa zapisom radnika.');
        }
        return { workerId: caller.workerId, subjectUid: caller.uid, preview: false };
    }

    // „Pogledaj kao" — samo staff/superAdmin, samo unutar svoje organizacije.
    if (!isStaffRole(caller.role) && !caller.isSuperAdmin) {
        throw new HttpError(403, 'Pregled tuđeg ekrana nije dozvoljen.');
    }
    const snap = await adminDb().collection('users').doc(previewUid).get();
    const subject = snap.data() as User | undefined;
    if (!subject) throw new HttpError(404, 'Korisnik nije pronađen.');
    if (subject.Organization_ID !== caller.orgId) {
        throw new HttpError(403, 'Korisnik ne pripada vašoj organizaciji.');
    }
    if (!subject.Worker_ID) {
        throw new HttpError(400, 'Korisnik nije povezan sa zapisom radnika.');
    }
    return { workerId: subject.Worker_ID, subjectUid: previewUid, preview: true };
}
