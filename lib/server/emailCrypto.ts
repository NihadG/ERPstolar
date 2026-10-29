// ════════════════════════════════════════════════════════════════════
// ŠIFROVANJE GMAIL TOKENA I POTPIS OAUTH „STATE"-A
//
// Refresh token daje trajan pristup pošti, pa u Firestoreu stoji samo
// šifrovan (AES-256-GCM). Ključ je EMAIL_TOKEN_KEY s Vercela — bez njega
// se ništa ne čuva ni ne čita.
//
// `state` u OAuth povratku nosi ko se povezuje (uid, org); potpisan je HMAC-om
// i ističe, da tuđi povratak ne može upisati token na tvoj nalog.
// ════════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export class EmailKeyMissingError extends Error {
    constructor() {
        super('EMAIL_TOKEN_KEY nije postavljen.');
        this.name = 'EmailKeyMissingError';
    }
}

function secret(): string {
    const key = process.env.EMAIL_TOKEN_KEY || '';
    if (key.length < 16) throw new EmailKeyMissingError();
    return key;
}

const derive = (purpose: string) => createHash('sha256').update(`${purpose}:${secret()}`).digest();

/** „v1.<iv>.<tag>.<šifrat>" (base64url). */
export function encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', derive('token'), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(sealed: string): string {
    const [v, iv, tag, data] = (sealed || '').split('.');
    if (v !== 'v1' || !iv || !tag || !data) throw new Error('Neispravan šifrovani token.');
    const decipher = createDecipheriv('aes-256-gcm', derive('token'), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export interface OAuthState {
    uid: string;
    orgId: string;
    redirectUri: string;
    /** Rok (ms od epohe). */
    exp: number;
    nonce: string;
}

const sign = (body: string) => createHmac('sha256', derive('state')).update(body).digest('base64url');

export function signState(state: Omit<OAuthState, 'exp' | 'nonce'>, ttlMs = 10 * 60_000, now = Date.now()): string {
    const body = Buffer.from(JSON.stringify({ ...state, exp: now + ttlMs, nonce: randomBytes(8).toString('hex') })).toString('base64url');
    return `${body}.${sign(body)}`;
}

/** null = krivotvoren, oštećen ili istekao. */
export function verifyState(token: string, now = Date.now()): OAuthState | null {
    const [body, mac] = (token || '').split('.');
    if (!body || !mac) return null;
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
        const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
        if (!state.uid || !state.orgId || !state.redirectUri || typeof state.exp !== 'number' || state.exp < now) return null;
        return state;
    } catch {
        return null;
    }
}
