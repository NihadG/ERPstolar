/**
 * @jest-environment node
 */

// ════════════════════════════════════════════════════════════════════
// SERVER SLOJ BEZ KREDENCIJALA MORA REĆI ZAŠTO NE RADI.
//
// Povod: /api/auth/sync-claims je u produkciji vraćao goli HTTP 500
// („došlo je do greške na serveru"), dok su FIREBASE_ADMIN_* varijable
// jednostavno nedostajale u deploy okruženju. 500 i 503 nisu isto:
//   • 503 + admin-not-configured → okruženje nije podešeno, popravlja se
//     dodavanjem varijabli,
//   • 500 → stvarni kvar u kodu, traži se drugdje.
// Bez ove razlike se sat vremena traži greška na pogrešnom mjestu.
//
// Test namjerno ide kroz PRAVI handler rute, ne kroz errorResponse izolovano
// — greška mora preživjeti cijeli put od adminAuth() do odgovora.
// ════════════════════════════════════════════════════════════════════

// firebase-admin se NAMJERNO ne mokuje. Ruta je u produkciji vraćala 500 zato što
// je cijeli modul pucao pri učitavanju (ERR_REQUIRE_ESM: jwks-rsa je CJS i radi
// require('jose'), a jose@6 je samo ESM). Mock bi tu grešku sakrio, a upravo nju
// treba čuvati — zato test učitava pravi lanac. Nema mrežnog poziva: readCredentials()
// pukne prije nego što adminAuth() stigne bilo šta poslati Googleu.
const ADMIN_VARS = [
    'FIREBASE_ADMIN_PROJECT_ID',
    'FIREBASE_ADMIN_CLIENT_EMAIL',
    'FIREBASE_ADMIN_PRIVATE_KEY',
] as const;

// next/jest učitava .env.local u testove, pa varijable STVARNO postoje ovdje.
// Moraju se ukloniti prije importa rute, i vratiti poslije.
const saved: Record<string, string | undefined> = {};

function postTo(handlerModule: string, headers: Record<string, string>) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { POST } = require(handlerModule);
    return POST(new Request('http://localhost/api/auth/sync-claims', { method: 'POST', headers }));
}

describe('lanac zavisnosti se učitava CJS require-om', () => {
    // Regresija na stvarni produkcijski kvar: ERR_REQUIRE_ESM na Vercelu, dok je
    // lokalno radilo jer Node 22.12+ podržava require(esm). Test hvata razliku
    // koju razvojna mašina sakrije. Ako ovo padne, provjeri `overrides.jose`.
    test('jose koji vidi jwks-rsa ima CJS izlaz', () => {
        const resolved = require.resolve('jose', { paths: [require.resolve('jwks-rsa')] });
        expect(resolved).toContain('cjs');
    });

    test('firebase-admin/auth se učitava bez ERR_REQUIRE_ESM', () => {
        expect(() => require('firebase-admin/auth')).not.toThrow();
    });
});

describe('sync-claims bez FIREBASE_ADMIN_* varijabli', () => {
    beforeEach(() => {
        jest.resetModules();
        ADMIN_VARS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
    });

    afterEach(() => {
        ADMIN_VARS.forEach(k => {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        });
    });

    test('vraća 503 i kod `admin-not-configured`, a NE goli 500', async () => {
        const res = await postTo('@/app/api/auth/sync-claims/route', { Authorization: 'Bearer bilo-sta' });
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe('admin-not-configured');
    });

    test('nedostatak tokena je i dalje 401 — ne guta se u konfiguraciju', async () => {
        const res = await postTo('@/app/api/auth/sync-claims/route', {});
        expect(res.status).toBe(401);
    });
});

describe('oblik privatnog ključa', () => {
    beforeEach(() => {
        jest.resetModules();
        ADMIN_VARS.forEach(k => { saved[k] = process.env[k]; });
        process.env.FIREBASE_ADMIN_PROJECT_ID = 'p';
        process.env.FIREBASE_ADMIN_CLIENT_EMAIL = 'a@b.c';
    });

    afterEach(() => {
        ADMIN_VARS.forEach(k => {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        });
    });

    test('IZLOMLJEN ključ (bez PEM zaglavlja) je konfiguracijska greška, ne 500', async () => {
        // Tačno ono što deploy okruženja urade kad progutaju nove redove.
        process.env.FIREBASE_ADMIN_PRIVATE_KEY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC';
        const res = await postTo('@/app/api/auth/sync-claims/route', { Authorization: 'Bearer bilo-sta' });
        expect(res.status).toBe(503);
    });

    test('base64 cijelog PEM-a se prihvata — izlaz za okruženja bez višereda', () => {
        const pem = '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n';
        process.env.FIREBASE_ADMIN_PRIVATE_KEY = Buffer.from(pem).toString('base64');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { isAdminConfigured } = require('@/lib/server/firebaseAdmin');
        expect(isAdminConfigured()).toBe(true);
    });

    test('doslovni \\n iz .env-a se pretvara u prave nove redove', () => {
        process.env.FIREBASE_ADMIN_PRIVATE_KEY =
            '"-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----\\n"';
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { isAdminConfigured } = require('@/lib/server/firebaseAdmin');
        expect(isAdminConfigured()).toBe(true);
    });
});
