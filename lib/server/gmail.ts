// ════════════════════════════════════════════════════════════════════
// GMAIL NA SERVERU — veza, slanje i čitanje preko REST-a (bez biblioteke)
//
//   email_accounts/{uid}   šifrovan refresh token, adresa, „šalje kao",
//                          History_ID za čitanje novih poruka (PR 5)
//
// Jedna saglasnost daje gmail.send (slanje nacrta na tvoj klik) i
// gmail.readonly (uvoz kontakata, kasnije ulazna pošta). ERP u Gmailu ništa
// ne briše, ne označava i ne mijenja.
//
// Kad Google odbije refresh token (lozinka promijenjena, veza opozvana,
// aplikacija u „Testing" režimu gasi token za 7 dana), nalog dobija
// Status 'reconnect' i Postavke traže ponovno povezivanje.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import { decryptSecret, encryptSecret } from './emailCrypto';
import { buildMime, toBase64Url, type MailMessage } from '@/lib/email/mime';
import { COLLECTIONS } from '@/lib/services/shared/collections';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GMAIL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
];
export const SEND_SCOPE = GMAIL_SCOPES[0];
export const READ_SCOPE = GMAIL_SCOPES[1];

export type GmailErrorCode = 'not-configured' | 'not-connected' | 'reconnect' | 'api';

export class GmailError extends Error {
    constructor(public code: GmailErrorCode, message: string, public status?: number) {
        super(message);
        this.name = 'GmailError';
    }
}

export interface EmailAccount {
    UID: string;
    Organization_ID: string;
    Email: string;
    /** Adresa u polju „Od" (potvrđeni alias u Gmailu, npr. nihad@firma.ba); prazno = Email. */
    Send_As?: string;
    /** Potpis koji ERP dodaje na kraj svakog maila; prazno = „Srdačno, ime". */
    Signature?: string;
    Refresh_Token_Enc: string;
    Scopes: string[];
    Status: 'ok' | 'reconnect';
    Connected_At: string;
    Updated_At: string;
    History_ID?: string;
    Last_Error?: string;
}

// ── Podešenost ───────────────────────────────────────────────────────

export function oauthClient(): { clientId: string; clientSecret: string } | null {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
    if (!clientId || !clientSecret || (process.env.EMAIL_TOKEN_KEY || '').length < 16) return null;
    return { clientId, clientSecret };
}

function requireClient() {
    const c = oauthClient();
    if (!c) throw new GmailError('not-configured', 'Gmail veza nije podešena na serveru (GOOGLE_OAUTH_CLIENT_SECRET, EMAIL_TOKEN_KEY).');
    return c;
}

export function authUrl(opts: { redirectUri: string; state: string; loginHint?: string }): string {
    const { clientId } = requireClient();
    const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: opts.redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',             // uvijek vrati refresh token
        include_granted_scopes: 'true',
        state: opts.state,
    });
    if (opts.loginHint) q.set('login_hint', opts.loginHint);
    return `${AUTH_URL}?${q.toString()}`;
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, any>> {
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new GmailError(body?.error === 'invalid_grant' ? 'reconnect' : 'api', `Google token: ${body?.error || res.status}`, res.status);
        throw err;
    }
    return body;
}

export async function exchangeCode(code: string, redirectUri: string) {
    const { clientId, clientSecret } = requireClient();
    const body = await tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    return {
        refreshToken: String(body.refresh_token || ''),
        accessToken: String(body.access_token || ''),
        expiresIn: Number(body.expires_in) || 3600,
        scopes: String(body.scope || '').split(/\s+/).filter(Boolean),
    };
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.email) throw new GmailError('api', 'Google nije vratio adresu naloga.', res.status);
    return String(body.email).toLowerCase();
}

// ── Nalog ────────────────────────────────────────────────────────────

const accounts = () => adminDb().collection(COLLECTIONS.EMAIL_ACCOUNTS);

export async function getEmailAccount(uid: string): Promise<EmailAccount | null> {
    const snap = await accounts().doc(uid).get();
    return snap.exists ? (snap.data() as EmailAccount) : null;
}

export async function saveEmailAccount(input: {
    uid: string; orgId: string; email: string; refreshToken: string; scopes: string[]; now?: Date;
}): Promise<EmailAccount> {
    const now = (input.now || new Date()).toISOString();
    const prev = await getEmailAccount(input.uid);
    const account: EmailAccount = {
        UID: input.uid,
        Organization_ID: input.orgId,
        Email: input.email,
        // Isti Google nalog zadržava izabrani „šalje kao"; novi nalog kreće od svoje adrese.
        ...(prev?.Send_As && prev.Email === input.email ? { Send_As: prev.Send_As } : {}),
        ...(prev?.Signature ? { Signature: prev.Signature } : {}),
        Refresh_Token_Enc: encryptSecret(input.refreshToken),
        Scopes: input.scopes,
        Status: 'ok',
        Connected_At: now,
        Updated_At: now,
        ...(prev?.History_ID && prev.Email === input.email ? { History_ID: prev.History_ID } : {}),
    };
    await accounts().doc(input.uid).set(account);
    tokenCache.delete(input.uid);
    return account;
}

export async function updateEmailAccount(uid: string, patch: Partial<Pick<EmailAccount, 'Send_As' | 'Signature' | 'History_ID' | 'Status' | 'Last_Error'>>) {
    await accounts().doc(uid).set({ ...patch, Updated_At: new Date().toISOString() }, { merge: true });
}

/** Opozove token kod Googlea (ako uspije) i obriše nalog. */
export async function disconnectEmailAccount(uid: string): Promise<void> {
    const account = await getEmailAccount(uid);
    tokenCache.delete(uid);
    if (!account) return;
    try {
        const token = decryptSecret(account.Refresh_Token_Enc);
        await fetch(REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
        });
    } catch (e) {
        console.warn('[gmail] opoziv tokena nije uspio, nalog se ipak briše', e);
    }
    await accounts().doc(uid).delete();
}

// ── Pristupni token ──────────────────────────────────────────────────

const tokenCache = new Map<string, { token: string; exp: number }>();

export async function accessTokenFor(uid: string, now = Date.now()): Promise<{ token: string; account: EmailAccount }> {
    const account = await getEmailAccount(uid);
    if (!account) throw new GmailError('not-connected', 'Gmail nije povezan.');
    if (account.Status === 'reconnect') throw new GmailError('reconnect', 'Gmail veza je istekla — poveži ponovo u Postavkama.');
    const cached = tokenCache.get(uid);
    if (cached && cached.exp > now + 60_000) return { token: cached.token, account };

    const { clientId, clientSecret } = requireClient();
    try {
        const body = await tokenRequest({
            client_id: clientId, client_secret: clientSecret,
            refresh_token: decryptSecret(account.Refresh_Token_Enc), grant_type: 'refresh_token',
        });
        const token = String(body.access_token);
        tokenCache.set(uid, { token, exp: now + (Number(body.expires_in) || 3600) * 1000 });
        return { token, account };
    } catch (e) {
        if (e instanceof GmailError && e.code === 'reconnect') {
            await updateEmailAccount(uid, { Status: 'reconnect', Last_Error: e.message });
        }
        throw e;
    }
}

/** Poziv Gmail API-ja; na 401 jednom osvježi token i ponovi. */
async function gmailApi<T>(uid: string, path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const { token } = await accessTokenFor(uid);
    const res = await fetch(`${GMAIL_URL}${path}`, {
        ...init,
        headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && !retried) {
        tokenCache.delete(uid);
        return gmailApi<T>(uid, path, init, true);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const reason = body?.error?.message || body?.error || res.status;
        throw new GmailError(res.status === 403 ? 'reconnect' : 'api', `Gmail: ${reason}`, res.status);
    }
    return body as T;
}

// ── Slanje ───────────────────────────────────────────────────────────

/** Šalje gotovu poruku; `threadId` je drži u istoj niti. „Od" = Send_As ili adresa naloga. */
export async function sendGmail(uid: string, msg: MailMessage & { threadId?: string }): Promise<{ id: string; threadId: string }> {
    const { account } = await accessTokenFor(uid);
    if (!account.Scopes.includes(SEND_SCOPE)) throw new GmailError('reconnect', 'Gmail veza nema dozvolu za slanje — poveži ponovo.');
    const raw = toBase64Url(buildMime({ ...msg, from: msg.from || { email: account.Send_As || account.Email } }));
    return gmailApi(uid, '/messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(msg.threadId ? { threadId: msg.threadId } : {}) }) });
}

// ── Čitanje ──────────────────────────────────────────────────────────

export interface GmailMessageMeta {
    id: string;
    threadId: string;
    snippet: string;
    internalDate: string;
    labelIds: string[];
    headers: Record<string, string>;
}

export async function getProfile(uid: string): Promise<{ emailAddress: string; historyId: string }> {
    return gmailApi(uid, '/profile');
}

/** ID-jevi poruka za Gmail upit („in:sent newer_than:180d"), najviše `max`. */
export async function listMessageIds(uid: string, q: string, max = 200): Promise<string[]> {
    const ids: string[] = [];
    let pageToken = '';
    do {
        const params = new URLSearchParams({ q, maxResults: String(Math.min(500, max - ids.length)) });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await gmailApi<{ messages?: { id: string }[]; nextPageToken?: string }>(uid, `/messages?${params}`);
        (page.messages || []).forEach(m => ids.push(m.id));
        pageToken = page.nextPageToken || '';
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
}

export async function getMessageMeta(uid: string, id: string, headers: string[]): Promise<GmailMessageMeta> {
    const params = new URLSearchParams({ format: 'metadata' });
    headers.forEach(h => params.append('metadataHeaders', h));
    const m = await gmailApi<any>(uid, `/messages/${encodeURIComponent(id)}?${params}`);
    const out: Record<string, string> = {};
    (m.payload?.headers || []).forEach((h: { name: string; value: string }) => { out[h.name.toLowerCase()] = h.value; });
    return { id: m.id, threadId: m.threadId, snippet: m.snippet || '', internalDate: String(m.internalDate || ''), labelIds: m.labelIds || [], headers: out };
}

/** Puna poruka (dijelovi i prilozi) — za ulaznu poštu. */
export async function getMessageFull(uid: string, id: string): Promise<any> {
    return gmailApi(uid, `/messages/${encodeURIComponent(id)}?format=full`);
}

export async function getAttachment(uid: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
    const a = await gmailApi<{ data: string }>(uid, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    return new Uint8Array(Buffer.from(a.data || '', 'base64url'));
}

/** Promjene od `startHistoryId` (nove poruke); 404 = predug razmak, kreni od profila. */
export async function listHistory(uid: string, startHistoryId: string): Promise<{ messageIds: string[]; historyId: string }> {
    const ids = new Set<string>();
    let pageToken = '';
    let historyId = startHistoryId;
    do {
        const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded' });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await gmailApi<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; historyId?: string; nextPageToken?: string }>(uid, `/history?${params}`);
        (page.history || []).forEach(h => (h.messagesAdded || []).forEach(a => ids.add(a.message.id)));
        if (page.historyId) historyId = page.historyId;
        pageToken = page.nextPageToken || '';
    } while (pageToken);
    return { messageIds: Array.from(ids), historyId };
}

/** Pokreće `fn` nad listom s ograničenim brojem istovremenih poziva. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return out;
}

// ── Greške za API rute ───────────────────────────────────────────────

const HTTP_STATUS: Record<GmailErrorCode, number> = { 'not-configured': 503, 'not-connected': 409, reconnect: 409, api: 502 };

/** GmailError → odgovor s porukom i stabilnim `code` (Postavke po njemu nude ponovno povezivanje). */
export function gmailErrorJson(e: GmailError): { body: { error: string; code: GmailErrorCode }; status: number } {
    return { body: { error: e.message, code: e.code }, status: HTTP_STATUS[e.code] };
}

/** Pošiljaoci poruka u niti (zaglavlje From) — za provjeru vraćenog maila. */
export async function getThreadSenders(uid: string, threadId: string): Promise<string[]> {
    const t = await gmailApi<{ messages?: { payload?: { headers?: { name: string; value: string }[] } }[] }>(
        uid, `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From`);
    return (t.messages || []).map(m => (m.payload?.headers || []).find(h => h.name.toLowerCase() === 'from')?.value || '');
}
