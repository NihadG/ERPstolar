// ════════════════════════════════════════════════════════════════════
// FIREBASE ADMIN — jedini server-side identitet u aplikaciji
//
// Postoji zbog jedne stvari koju klijent ne može: upisati ULOGU u sam token
// (custom claims). Dok uloga živi samo u users/{uid}, korisnik je može sam
// promijeniti — Firestore pravila dozvoljavaju pisanje vlastitog dokumenta.
// Claim je potpisan Googleovim ključem i korisnik ga ne dodiruje.
//
// Usput: pravila više ne moraju raditi get() na users/{uid} pri svakoj
// evaluaciji (naplaćeno čitanje), nego čitaju request.auth.token.orgId.
//
// INICIJALIZACIJA JE LIJENA. `next build` se izvršava bez tajni na CI-u i
// deploy okruženjima; da se init radio na importu, build bi pucao. Ovako
// ruta padne tek kad je stvarno pozvana bez konfiguracije.
// ════════════════════════════════════════════════════════════════════

import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const APP_NAME = 'erp-admin';

export class AdminNotConfiguredError extends Error {
    constructor(missing: string[]) {
        super(`Firebase Admin nije konfigurisan — nedostaju env varijable: ${missing.join(', ')}`);
        this.name = 'AdminNotConfiguredError';
    }
}

/**
 * Privatni ključ iz env varijable u pravi PEM.
 *
 * Ovo je najčešća tačka pucanja pri deployu i zaslužuje vlastitu funkciju:
 * ključ je višered, a env varijable nisu. Podržana su tri oblika u koja
 * okruženja umiju da ga izobliče:
 *   1. jedan red s doslovnim `\n` (standard za .env),
 *   2. obmotan navodnicima (Vercel to zna dodati pri lijepljenju),
 *   3. base64 cijelog PEM-a (izlaz za okruženja koja višered uopšte ne podnose).
 */
function decodePrivateKey(raw: string): string {
    const unwrapped = raw.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
    if (unwrapped.includes('-----BEGIN')) return unwrapped;

    try {
        const decoded = Buffer.from(unwrapped, 'base64').toString('utf8');
        if (decoded.includes('-----BEGIN')) return decoded;
    } catch { /* nije base64 — pada na provjeru ispod */ }

    return unwrapped;
}

function readCredentials() {
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
    const privateKey = rawKey ? decodePrivateKey(rawKey) : undefined;

    const missing: string[] = [];
    if (!projectId) missing.push('FIREBASE_ADMIN_PROJECT_ID');
    if (!clientEmail) missing.push('FIREBASE_ADMIN_CLIENT_EMAIL');
    if (!privateKey) missing.push('FIREBASE_ADMIN_PRIVATE_KEY');
    // OBLIK KLJUČA SE PROVJERAVA ZAJEDNO S POSTOJANJEM. Bez ovoga izlomljen ključ
    // prođe dovde, pa pukne u `cert()` kao obična greška — a to daje HTTP 500
    // („došlo je do greške na serveru") umjesto 503 s tačnim uzrokom. Upravo tako
    // je izgledao kvar sinhronizacije uloga u produkciji: env varijabla postoji,
    // ali joj nedostaju novi redovi.
    else if (!privateKey.includes('-----BEGIN') || !privateKey.includes('-----END')) {
        missing.push('FIREBASE_ADMIN_PRIVATE_KEY (postoji, ali nije važeći PEM — provjeri nove redove / \\n)');
    }
    if (missing.length) throw new AdminNotConfiguredError(missing);

    return { projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! };
}

function adminApp(): App {
    const existing = getApps().find(a => a.name === APP_NAME);
    if (existing) return getApp(APP_NAME);

    const { projectId, clientEmail, privateKey } = readCredentials();
    try {
        return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, APP_NAME);
    } catch (e) {
        // `cert()` odbija ključ i nakon oblikovne provjere (npr. skraćen sadržaj).
        // Prevodi se u istu grešku da ruta odgovori 503 s uzrokom, a ne golim 500.
        throw new AdminNotConfiguredError([
            `FIREBASE_ADMIN_PRIVATE_KEY / FIREBASE_ADMIN_CLIENT_EMAIL (Firebase odbio kredencijale: ${e instanceof Error ? e.message : String(e)})`,
        ]);
    }
}

export function adminAuth(): Auth {
    return getAuth(adminApp());
}

export function adminDb(): Firestore {
    return getFirestore(adminApp());
}

/** Za dijagnostiku u UI-u — je li server sloj uopšte podešen. */
export function isAdminConfigured(): boolean {
    try {
        readCredentials();
        return true;
    } catch {
        return false;
    }
}
