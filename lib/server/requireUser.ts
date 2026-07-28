// ════════════════════════════════════════════════════════════════════
// AUTENTIKACIJA API RUTA
//
// Svaka ruta koja dira tuđe podatke mora proći kroz `requireUser`. Pravilo
// bez izuzetka: **organizacija se uzima iz tokena, nikad iz tijela zahtjeva**.
// Da se orgId prihvata iz body-ja, svaki prijavljeni korisnik bi mogao čitati
// i pisati bilo kojoj firmi — tenancy bi bio ukras.
//
// Uloga se čita iz claim-a. Fallback na users/{uid} postoji SAMO za prelazni
// period (postojeći vlasnici nemaju claims dok ne prođu kroz /api/auth/sync-claims),
// i namjerno je označen `fromClaims: false` da rute mogu biti strože gdje treba.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminAuth, adminDb, AdminNotConfiguredError } from './firebaseAdmin';
import { isStaffRole, type UserRole } from '@/lib/types';

export interface AuthedUser {
    uid: string;
    email: string | null;
    orgId: string;
    role: UserRole;
    workerId?: string;
    isSuperAdmin: boolean;
    /** false = uloga je pročitana iz Firestorea jer token još nema claims */
    fromClaims: boolean;
}

export class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'HttpError';
    }
}

function bearerToken(req: Request): string {
    const header = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Nedostaje token.');
    const token = header.slice(7).trim();
    if (!token) throw new HttpError(401, 'Nedostaje token.');
    return token;
}

/**
 * Verifikuje ID token i vrati identitet pozivaoca.
 * `checkRevoked` je uključen namjerno: deaktiviran nalog mora izgubiti pristup
 * odmah, a ne tek kad mu istekne sat vremena star token.
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
    const token = bearerToken(req);

    let decoded;
    try {
        decoded = await adminAuth().verifyIdToken(token, true);
    } catch (e: any) {
        if (e instanceof AdminNotConfiguredError) throw e;
        if (e?.code === 'auth/id-token-revoked' || e?.code === 'auth/user-disabled') {
            throw new HttpError(401, 'Pristup je opozvan. Prijavite se ponovo.');
        }
        throw new HttpError(401, 'Token nije važeći.');
    }

    const claimOrg = typeof decoded.orgId === 'string' ? decoded.orgId : null;
    const claimRole = typeof decoded.role === 'string' ? (decoded.role as UserRole) : null;

    if (claimOrg && claimRole) {
        return {
            uid: decoded.uid,
            email: decoded.email ?? null,
            orgId: claimOrg,
            role: claimRole,
            workerId: typeof decoded.workerId === 'string' ? decoded.workerId : undefined,
            isSuperAdmin: decoded.superAdmin === true,
            fromClaims: true,
        };
    }

    // Prelazni period: profil postoji, claims još ne.
    const snap = await adminDb().collection('users').doc(decoded.uid).get();
    const profile = snap.data();
    if (!profile?.Organization_ID) throw new HttpError(403, 'Korisnički profil nije pronađen.');
    if (profile.Is_Active === false) throw new HttpError(403, 'Nalog je deaktiviran.');

    return {
        uid: decoded.uid,
        email: decoded.email ?? profile.Email ?? null,
        orgId: profile.Organization_ID,
        role: (profile.Role as UserRole) || 'worker',
        workerId: profile.Worker_ID || undefined,
        isSuperAdmin: profile.Is_Super_Admin === true,
        fromClaims: false,
    };
}

/** Puna aplikacija: owner / admin / manager. */
export async function requireStaff(req: Request): Promise<AuthedUser> {
    const user = await requireUser(req);
    if (!isStaffRole(user.role) && !user.isSuperAdmin) {
        throw new HttpError(403, 'Nemate dozvolu za ovu radnju.');
    }
    return user;
}

/**
 * Kontrolor + sve jače uloge.
 *
 * Kontrolor je jedina pogonska uloga koja SMIJE pisati (prisustvo, knjiženje,
 * čekiranje procesa, zadaci). Radnik za sada samo čita — kad dobije svoje
 * radnje, dobiće vlastiti guard, ne proširenje ovoga.
 *
 * Staff prolazi jer vlasnik mora moći isprobati kontrolorov ekran
 * („Pogledaj kao") i jer je svaka kontrolorova radnja podskup njegovih.
 */
export async function requireController(req: Request): Promise<AuthedUser> {
    const user = await requireUser(req);
    if (user.role !== 'controller' && !isStaffRole(user.role) && !user.isSuperAdmin) {
        throw new HttpError(403, 'Nemate dozvolu za ovu radnju.');
    }
    return user;
}

/** Upravljanje korisnicima smiju samo vlasnik i administrator — ne i menadžer. */
export async function requireOrgAdmin(req: Request): Promise<AuthedUser> {
    const user = await requireUser(req);
    if (user.role !== 'owner' && user.role !== 'admin' && !user.isSuperAdmin) {
        throw new HttpError(403, 'Samo vlasnik ili administrator mogu upravljati korisnicima.');
    }
    return user;
}

/** Jedinstveno pretvaranje greške u odgovor — da nijedna ruta ne procuri stack. */
export function errorResponse(e: unknown): NextResponse {
    if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof AdminNotConfiguredError) {
        // Detalj (koja varijabla fali i zašto) ostaje u serverskom logu — klijent
        // dobija samo stabilan `code`, dovoljan da se u konzoli razlikuje
        // „server nije podešen" od stvarnog kvara.
        console.error('[api]', e.message);
        return NextResponse.json(
            { error: 'Server nije podešen za upravljanje korisnicima. Kontaktirajte podršku.', code: 'admin-not-configured' },
            { status: 503 }
        );
    }
    console.error('[api] neočekivana greška:', e);
    // ŠIFRA greške ide i klijentu, poruka i stack ne. Firebase i Google biblioteke
    // nose kratke, bezopasne oznake tipa `auth/insufficient-permission` — one same
    // po sebi kažu gdje tražiti, a bez njih se za svaki 500 mora u serverske logove.
    //
    // Pokrivena su OBA oblika: Auth greške nose string (`auth/...`), a Firestore
    // brojčani gRPC status (7 = PERMISSION_DENIED, 16 = UNAUTHENTICATED). Prvi
    // pokušaj je hvatao samo string, pa je 500 iz Firestorea stizao bez ijednog
    // traga. Ako ni koda nema, šalje se ime klase greške — i to suzi pretragu.
    const err = e as { code?: unknown; name?: unknown };
    const cause =
        typeof err?.code === 'string' && err.code.length <= 60 ? err.code
            : typeof err?.code === 'number' ? `grpc-${err.code}`
                : typeof err?.name === 'string' && err.name.length <= 60 ? err.name
                    : undefined;
    return NextResponse.json(
        { error: 'Došlo je do greške na serveru.', code: 'server-error', ...(cause ? { cause } : {}) },
        { status: 500 }
    );
}
