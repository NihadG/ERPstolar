/**
 * @jest-environment node
 */
jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeStore } from '@/lib/testing/fakeFirestore';
import { decryptSecret, encryptSecret, signState, verifyState } from '@/lib/server/emailCrypto';
import {
    accessTokenFor, authUrl, disconnectEmailAccount, exchangeCode, getEmailAccount, GmailError,
    listHistory, oauthClient, saveEmailAccount, sendGmail, GMAIL_SCOPES,
} from '@/lib/server/gmail';

const ENV = { ...process.env };
const fetchMock = jest.fn();

beforeEach(() => {
    fakeStore.clear();
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
    process.env = { ...ENV, GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', EMAIL_TOKEN_KEY: 'test-kljuc-dovoljno-dug' };
});
afterAll(() => { process.env = ENV; });

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

describe('šifrovanje i state', () => {
    it('token se vraća isti, a šifrat se mijenja i ne sadrži token', () => {
        const a = encryptSecret('1//refresh-token');
        const b = encryptSecret('1//refresh-token');
        expect(a).not.toBe(b);
        expect(a).not.toContain('refresh');
        expect(decryptSecret(a)).toBe('1//refresh-token');
    });

    it('izmijenjen šifrat se odbija', () => {
        const parts = encryptSecret('tajna').split('.');
        parts[3] = Buffer.from('drugo').toString('base64url');
        expect(() => decryptSecret(parts.join('.'))).toThrow();
    });

    it('bez ključa nema šifrovanja', () => {
        process.env.EMAIL_TOKEN_KEY = 'kratko';
        expect(() => encryptSecret('x')).toThrow('EMAIL_TOKEN_KEY');
        expect(oauthClient()).toBeNull();
    });

    it('state: važeći prolazi, krivotvoren i istekao ne', () => {
        const s = signState({ uid: 'u1', orgId: 'o1', redirectUri: 'https://app.example/cb' }, 60_000, 1_000);
        expect(verifyState(s, 2_000)).toMatchObject({ uid: 'u1', orgId: 'o1', redirectUri: 'https://app.example/cb' });
        expect(verifyState(s, 70_000)).toBeNull();
        const [body, mac] = s.split('.');
        const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), uid: 'napadac' })).toString('base64url');
        expect(verifyState(`${forged}.${mac}`, 2_000)).toBeNull();
        expect(verifyState('smeće', 2_000)).toBeNull();
    });
});

describe('OAuth', () => {
    it('adresa saglasnosti traži slanje, čitanje i trajni token', () => {
        const url = new URL(authUrl({ redirectUri: 'https://app.example/api/email/google/callback', state: 'S' }));
        expect(url.searchParams.get('client_id')).toBe('cid');
        expect(url.searchParams.get('scope')).toBe(GMAIL_SCOPES.join(' '));
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('prompt')).toBe('consent');
        expect(url.searchParams.get('state')).toBe('S');
    });

    it('bez podešenog servera javlja not-configured', () => {
        delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
        expect(() => authUrl({ redirectUri: 'x', state: 'y' })).toThrow(GmailError);
    });

    it('razmjena koda vraća refresh token i dozvole', async () => {
        fetchMock.mockResolvedValueOnce(json(200, { refresh_token: 'R', access_token: 'A', expires_in: 3599, scope: GMAIL_SCOPES.join(' ') }));
        const t = await exchangeCode('CODE', 'https://app.example/cb');
        expect(t).toMatchObject({ refreshToken: 'R', accessToken: 'A', scopes: GMAIL_SCOPES });
        const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('client_secret')).toBe('secret');
    });
});

describe('nalog i token', () => {
    const connect = () => saveEmailAccount({ uid: 'u1', orgId: 'o1', email: 'ja@moj.example', refreshToken: 'R1', scopes: GMAIL_SCOPES });

    it('u bazi je samo šifrovan token', async () => {
        await connect();
        const raw = fakeStore.get('email_accounts/u1')!;
        expect(JSON.stringify(raw)).not.toContain('"R1"');
        expect(decryptSecret(raw.Refresh_Token_Enc)).toBe('R1');
        expect(raw).toMatchObject({ Email: 'ja@moj.example', Status: 'ok', Organization_ID: 'o1' });
    });

    it('pristupni token se pamti dok ne istekne', async () => {
        await connect();
        fetchMock.mockResolvedValue(json(200, { access_token: 'A1', expires_in: 3600 }));
        const a = await accessTokenFor('u1', 0);
        const b = await accessTokenFor('u1', 1_000);
        expect(a.token).toBe('A1');
        expect(b.token).toBe('A1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('opozvan refresh token → Status reconnect i jasna greška', async () => {
        await connect();
        fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
        await expect(accessTokenFor('u1', 0)).rejects.toMatchObject({ code: 'reconnect' });
        expect((await getEmailAccount('u1'))!.Status).toBe('reconnect');
        await expect(accessTokenFor('u1', 0)).rejects.toMatchObject({ code: 'reconnect' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('nepovezan korisnik → not-connected', async () => {
        await expect(accessTokenFor('nema', 0)).rejects.toMatchObject({ code: 'not-connected' });
    });

    it('odspajanje opoziva token kod Googlea i briše nalog', async () => {
        await connect();
        fetchMock.mockResolvedValueOnce(json(200, {}));
        await disconnectEmailAccount('u1');
        expect(String(fetchMock.mock.calls[0][0])).toContain('/revoke');
        expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('token')).toBe('R1');
        expect(await getEmailAccount('u1')).toBeNull();
    });
});

describe('slanje i čitanje', () => {
    beforeEach(async () => {
        await saveEmailAccount({ uid: 'u2', orgId: 'o1', email: 'ja@moj.example', refreshToken: 'R2', scopes: GMAIL_SCOPES });
    });

    it('šalje MIME kao raw, „Od" je adresa naloga, nit se prenosi', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A2', expires_in: 3600 }))
            .mockResolvedValueOnce(json(200, { id: 'm1', threadId: 't1' }));
        const res = await sendGmail('u2', { to: [{ email: 'emir@ploce-demo.example' }], subject: 'Narudžba', text: 'Pozdrav Emire', threadId: 't1' });
        expect(res).toEqual({ id: 'm1', threadId: 't1' });
        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
        expect(init.headers.Authorization).toBe('Bearer A2');
        const body = JSON.parse(init.body);
        expect(body.threadId).toBe('t1');
        const mime = Buffer.from(body.raw, 'base64url').toString('utf8');
        expect(mime).toContain('From: ja@moj.example');
        expect(mime).toContain('To: emir@ploce-demo.example');
    });

    it('istekao pristupni token: jednom osvježi i ponovi', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'STARI', expires_in: 3600 }))
            .mockResolvedValueOnce(json(401, { error: { message: 'Invalid Credentials' } }))
            .mockResolvedValueOnce(json(200, { access_token: 'NOVI', expires_in: 3600 }))
            .mockResolvedValueOnce(json(200, { id: 'm2', threadId: 't2' }));
        const res = await sendGmail('u2', { to: [{ email: 'a@x.example' }], subject: 's', text: 't' });
        expect(res.id).toBe('m2');
        expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer NOVI');
    });

    it('nalog bez dozvole za slanje traži ponovno povezivanje', async () => {
        await saveEmailAccount({ uid: 'u3', orgId: 'o1', email: 'ja@moj.example', refreshToken: 'R3', scopes: [GMAIL_SCOPES[1]] });
        fetchMock.mockResolvedValueOnce(json(200, { access_token: 'A3', expires_in: 3600 }));
        await expect(sendGmail('u3', { to: [{ email: 'a@x.example' }], subject: 's', text: 't' })).rejects.toMatchObject({ code: 'reconnect' });
    });

    it('istorija skuplja nove poruke kroz sve stranice', async () => {
        fetchMock
            .mockResolvedValueOnce(json(200, { access_token: 'A', expires_in: 3600 }))
            .mockResolvedValueOnce(json(200, { history: [{ messagesAdded: [{ message: { id: 'a' } }, { message: { id: 'b' } }] }], historyId: '10', nextPageToken: 'p2' }))
            .mockResolvedValueOnce(json(200, { history: [{ messagesAdded: [{ message: { id: 'b' } }, { message: { id: 'c' } }] }], historyId: '12' }));
        expect(await listHistory('u2', '5')).toEqual({ messageIds: ['a', 'b', 'c'], historyId: '12' });
        expect(String(fetchMock.mock.calls[2][0])).toContain('pageToken=p2');
    });
});
