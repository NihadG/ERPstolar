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

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
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
    if (unwrapped.includes('-----BEGIN')) return normalizePem(unwrapped);

    try {
        const decoded = Buffer.from(unwrapped, 'base64').toString('utf8');
        if (decoded.includes('-----BEGIN')) return normalizePem(decoded);
    } catch { /* nije base64 — pada na provjeru ispod */ }

    return unwrapped;
}

/**
 * Vrati PEM-u prelome redova.
 *
 * NAJPODMUKLIJI OBLIK KVARA: ako okruženje „pojede" `\n` bez traga, ključ i dalje
 * ima `-----BEGIN-----` i `-----END-----`, pa prođe svaku provjeru oblika — ali
 * mu je base64 tijelo u jednom redu i OpenSSL ga odbija
 * (`DECODER routines::unsupported`).
 *
 * Zašto se to vidi tek duboko: `cert()` ključ ne parsira, pa inicijalizacija
 * prođe. `verifyIdToken` provjerava korisnikov token Googleovim JAVNIM
 * certifikatima i privatni ključ uopšte ne dira, pa i on prođe. Pukne tek prvi
 * poziv kojem treba OAuth token (čitanje Firestorea, setCustomUserClaims) — i to
 * greškom bez `code` polja, dakle bez ijednog traga u odgovoru.
 *
 * Popravka je deterministička: uzmi base64 tijelo, izbaci sav razmak, prelomi na
 * 64 znaka. Za ispravan ključ je ovo identiteta.
 */
function normalizePem(key: string): string {
    const match = key.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
    if (!match) return key;

    const [, label, body] = match;
    const lines = body.replace(/\s+/g, '').match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
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
    // ZAVRŠNA PROVJERA: da li ključ uopšte može biti učitan kao ključ. Provjera
    // oblika (BEGIN/END) nije dovoljna — ključ s ispravnim omotom a pokvarenim
    // sadržajem prolazi nju, a puca tek pri prvom potpisivanju, daleko odavde i
    // bez upotrebljive poruke. Ovdje je to jeftino (bez mreže) i kaže se odmah.
    else {
        try {
            createPrivateKey(privateKey);
        } catch (e) {
            missing.push(
                `FIREBASE_ADMIN_PRIVATE_KEY (PEM se ne može učitati: ${e instanceof Error ? e.message : String(e)})`
            );
        }
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

/**
 * OTISAK kredencijala — ono što se smije reći o tajni a da se tajna ne oda.
 *
 * Postoji zbog kvara koji se drukčije ne da riješiti: kredencijali u deploy
 * okruženju su skriveni (Vercel ih označava Sensitive), a greška Firestorea je
 * gola brojka — gRPC 16 (UNAUTHENTICATED). Ta brojka znači da je ključ ISPRAVAN
 * RSA ključ (inače bi pao ranije, na createPrivateKey), ali ga Google ne priznaje:
 * gotovo uvijek zato što ne pripada nalogu iz `clientEmail`, tj. zalijepljen je
 * ključ nekog drugog servisnog naloga.
 *
 * Otisak je SHA-256 JAVNOG dijela ključa. Iz njega se privatni ključ ne može
 * izvesti, a poređenje s lokalnim otiskom odmah kaže je li u okruženju isti ključ.
 */
export function credentialFingerprint(): {
    projectId?: string;
    clientEmail?: string;
    keyLines?: number;
    keyFingerprint?: string;
    error?: string;
} {
    try {
        const { projectId, clientEmail, privateKey } = readCredentials();
        const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
        return {
            projectId,
            clientEmail,
            keyLines: (privateKey.match(/\n/g) || []).length,
            keyFingerprint: createHash('sha256').update(spki).digest('hex').slice(0, 16),
        };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
