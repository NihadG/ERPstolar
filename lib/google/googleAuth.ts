// ============================================
// GOOGLE AUTH — GIS token klijent (klijentski, bez servera)
// ============================================
// Access token se drži u memoriji sesije. Trajno „povezano" stanje živi u
// org_settings.googleIntegration (connectedEmail/rootFolderID); ovdje se samo
// dobavlja/osvježava token prije svake Google akcije.

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, loadGis, isGoogleConfigured } from './config';

let tokenClient: any = null;
let accessToken: string | null = null;
let tokenExpiry = 0; // epoch ms (već umanjeno za sigurnosnu marginu)

async function getTokenClient(): Promise<any> {
    if (!isGoogleConfigured()) {
        throw new Error('Google OAuth Client ID nije konfigurisan (NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID).');
    }
    await loadGis();
    if (!tokenClient) {
        tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: GOOGLE_SCOPES,
            callback: () => { /* postavlja se po-zahtjevu u requestToken */ },
        });
    }
    return tokenClient;
}

function requestToken(prompt: '' | 'consent'): Promise<string> {
    return getTokenClient().then((client) => new Promise<string>((resolve, reject) => {
        client.callback = (resp: any) => {
            if (resp.error) {
                reject(new Error(resp.error_description || resp.error));
                return;
            }
            accessToken = resp.access_token;
            const ttlMs = (resp.expires_in ? Number(resp.expires_in) : 3600) * 1000;
            tokenExpiry = Date.now() + ttlMs - 60_000; // 1 min margine
            resolve(accessToken!);
        };
        try {
            client.requestAccessToken({ prompt });
        } catch (e) {
            reject(e);
        }
    }));
}

/** Interaktivni consent — poziva se iz „Poveži Google" dugmeta. */
export async function connect(): Promise<string> {
    return requestToken('consent');
}

/** Vrati važeći access token (tiho osvježi ako je istekao). Zvati prije svake Google akcije. */
export async function ensureAccessToken(): Promise<string> {
    if (accessToken && Date.now() < tokenExpiry) return accessToken;
    return requestToken('');
}

/** Dobavi email povezanog Google računa (za prikaz u Settings). */
export async function fetchConnectedEmail(): Promise<string | undefined> {
    try {
        const token = await ensureAccessToken();
        const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return undefined;
        const j = await r.json();
        return j.email as string | undefined;
    } catch {
        return undefined;
    }
}

/** Opozovi token i očisti sesijsko stanje. */
export function disconnect(): void {
    try {
        const oauth2 = (window as any).google?.accounts?.oauth2;
        if (accessToken && oauth2?.revoke) {
            oauth2.revoke(accessToken, () => { /* ignore */ });
        }
    } catch {
        /* ignore */
    }
    accessToken = null;
    tokenExpiry = 0;
}

/** Da li imamo token u ovoj sesiji (ne znači trajnu vezu — vidi org_settings). */
export function hasSessionToken(): boolean {
    return !!accessToken && Date.now() < tokenExpiry;
}
