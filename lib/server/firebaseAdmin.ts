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

function readCredentials() {
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    // Privatni ključ u .env-u je jedan red s doslovnim "\n" — vraćamo prave nove redove.
    // Neka okruženja (Vercel) ga još i obmotaju navodnicima, pa ih skidamo.
    const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
    const privateKey = rawKey?.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

    const missing: string[] = [];
    if (!projectId) missing.push('FIREBASE_ADMIN_PROJECT_ID');
    if (!clientEmail) missing.push('FIREBASE_ADMIN_CLIENT_EMAIL');
    if (!privateKey) missing.push('FIREBASE_ADMIN_PRIVATE_KEY');
    if (missing.length) throw new AdminNotConfiguredError(missing);

    return { projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! };
}

function adminApp(): App {
    const existing = getApps().find(a => a.name === APP_NAME);
    if (existing) return getApp(APP_NAME);

    const { projectId, clientEmail, privateKey } = readCredentials();
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, APP_NAME);
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
