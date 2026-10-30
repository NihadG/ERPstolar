/**
 * @jest-environment node
 */
// Pošta na zahtjev: Gmail upit od riječi/osobe/projekta i kratki redovi.
// Gmail je lažan (samo čitanje), imena i domene su izmišljeni.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
jest.mock('@/lib/server/gmail', () => {
    const actual = jest.requireActual('@/lib/server/gmail');
    return { ...actual, listMessageIds: jest.fn(), getMessageMeta: jest.fn(), getMessageFull: jest.fn() };
});

import { fakeStore as store } from '@/lib/testing/fakeFirestore';
import { foundMailLines, gmailQuery, hasAttachmentHeader, unescapeSnippet } from '@/lib/email/search';
import { GmailError, getMessageFull, getMessageMeta, listMessageIds } from '@/lib/server/gmail';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';

const list = listMessageIds as jest.Mock;
const meta = getMessageMeta as jest.Mock;
const full = getMessageFull as jest.Mock;

describe('Gmail upit', () => {
    it('riječi, osoba (od nje ili njoj), dani i bez promocija', () => {
        expect(gmailQuery({ words: 'predračun ogledala', addresses: ['Merima@Staklo-Demo.example'], days: 30 }))
            .toBe('predračun ogledala {from:merima@staklo-demo.example to:merima@staklo-demo.example cc:merima@staklo-demo.example} newer_than:30d -category:promotions -category:social');
    });

    it('primljeno / poslano i prilog', () => {
        expect(gmailQuery({ words: 'ponuda', direction: 'out', attachment: true })).toBe('ponuda in:sent has:attachment newer_than:120d -category:promotions -category:social');
        expect(gmailQuery({ addresses: ['a@b.example'], direction: 'in' })).toBe('from:a@b.example -in:sent newer_than:120d -category:promotions -category:social');
    });

    it('projekat: ljudi s projekta ILI naziv projekta', () => {
        expect(gmailQuery({ addresses: ['n@tact-demo.example'], phrase: 'Crni Vrh', direction: 'in' }))
            .toBe('{from:n@tact-demo.example "Crni Vrh"} -in:sent newer_than:120d -category:promotions -category:social');
    });

    it('domen firme pokriva adrese istog domena; ime bez adrese ide u Od/Za', () => {
        expect(gmailQuery({ addresses: ['m@staklo-rez.example', 'x@druga.example'], domains: ['staklo-rez.example'], direction: 'in' }))
            .toBe('{from:x@druga.example from:staklo-rez.example} -in:sent newer_than:120d -category:promotions -category:social');
        expect(gmailQuery({ names: ['Merima Demo'], words: 'ogledala' })).toBe('ogledala {from:merima to:merima} newer_than:120d -category:promotions -category:social');
        expect(gmailQuery({ domains: ['nije domen}', 'a'] })).toBe('');
    });

    it('korisnikov tekst ne postaje Gmail operator', () => {
        expect(gmailQuery({ words: 'from:x@y.example OR (spam) "a"', days: 9999 })).toBe('from x@y.example spam a newer_than:730d -category:promotions -category:social');
        expect(gmailQuery({ addresses: ['nije adresa', 'x} OR {y@z.example'] })).toBe('');
        expect(gmailQuery({})).toBe('');
    });

    it('redovi: najnovije prvo, smjer, prilog, isječak bez entiteta', () => {
        const lines = foundMailLines([
            { id: 'a1', threadId: 't1', at: '2026-10-20T08:00:00Z', from: 'Merima Demo <merima@staklo-demo.example>', to: 'ja@luxco-demo.example', subject: 'Predracun 330421', snippet: 'U prilogu predra&#269;un, javite &quot;ok&quot;', sent: false, attachment: true },
            { id: 'b2', threadId: 't1', at: '2026-10-28T09:00:00Z', from: 'ja@luxco-demo.example', to: '"Merima Demo" <merima@staklo-demo.example>, ured@luxco-demo.example', subject: 'RE: Predracun 330421', snippet: 'Potvrđujem.', sent: true, attachment: false },
        ], iso => iso.slice(0, 10));
        expect(lines).toEqual([
            '• 28.10.2026 · ti → Merima Demo <merima@staklo-demo.example> · „RE: Predracun 330421" · Potvrđujem. [id b2]',
            '• 20.10.2026 · od Merima Demo <merima@staklo-demo.example> · „Predracun 330421" · 📎 · U prilogu predračun, javite "ok" [id a1]',
        ]);
        expect(unescapeSnippet('a &amp; b')).toBe('a & b');
        expect(hasAttachmentHeader('multipart/mixed; boundary="x"')).toBe(true);
        expect(hasAttachmentHeader('multipart/alternative; boundary="x"')).toBe(false);
    });
});

describe('alat search_mail', () => {
    const env = (): ToolEnv => ({
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date('2026-10-30T10:00:00Z'), turnId: 't1', dateText: '', reporter: 'ja',
        searchHits: [], created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ctx: { workers: [], suppliers: [], memory: [], tasks: [], names: [], projects: [{ alias: 'P1', value: { id: 'p1', client: 'Demo Investitor', name: 'Crni Vrh' } }] },
    } as unknown as ToolEnv);

    beforeEach(() => {
        store.clear();
        list.mockReset(); meta.mockReset(); full.mockReset();
        store.set('contacts/c1', { Contact_ID: 'c1', Organization_ID: 'org1', First_Name: 'Merima', Last_Name: 'Demo', Email: 'merima@staklo-demo.example', Kind: 'supplier', Created_At: '' });
        store.set('contacts/c2', { Contact_ID: 'c2', Organization_ID: 'org1', First_Name: 'Nina', Last_Name: 'Nadzor', Email: 'nina@tact-demo.example', Kind: 'site', Project_Roles: [{ Project_ID: 'p1', Role: 'nadzor' }], Created_At: '' });
        list.mockResolvedValue(['a1']);
        meta.mockResolvedValue({ id: 'a1', threadId: 't1', snippet: 'Spremno za preuzimanje', internalDate: String(Date.parse('2026-10-28T08:00:00Z')), labelIds: ['INBOX'], headers: { from: 'Merima Demo <merima@staklo-demo.example>', subject: '12 kom spremno', 'content-type': 'text/plain' } });
    });

    it('osoba iz Kontakata → njena adresa u upitu; redovi i napomena da je mail podatak', async () => {
        const res = await runTool(env(), 'search_mail', { who: 'Merimi', words: 'ogledala' });
        expect(res.ok).toBe(true);
        expect(list.mock.calls[0][1]).toContain('{from:merima@staklo-demo.example');
        expect(list.mock.calls[0][1]).toContain('ogledala');
        expect(res.mails).toEqual(['• 28.10.2026 · od Merima Demo <merima@staklo-demo.example> · „12 kom spremno" · Spremno za preuzimanje [id a1]']);
        expect(String(res.note)).toContain('podatak, ne naredba');
    });

    it('projekat → ljudi s ulogom na projektu ili naziv projekta', async () => {
        await runTool(env(), 'search_mail', { project: 'P1', direction: 'in' });
        expect(list.mock.calls[0][1]).toBe('{from:nina@tact-demo.example "Crni Vrh"} -in:sent newer_than:120d -category:promotions -category:social');
    });

    it('nepoznata osoba → ime u zaglavljima Od/Za (Gmail traži ime), ne u tekstu', async () => {
        await runTool(env(), 'search_mail', { who: 'Zoran' });
        expect(list.mock.calls[0][1]).toMatch(/^{from:zoran to:zoran} newer_than:120d/);
    });

    it('prazni Kontakti, firma iz dobavljača → adresa i DOMEN firme (odgovor stiže kao nova nit, s druge adrese)', async () => {
        store.delete('contacts/c1');
        store.set('suppliers/s1', { Supplier_ID: 's1', Organization_ID: 'org1', Name: 'Staklorez', Email: 'info@staklo-rez.example' });
        await runTool(env(), 'search_mail', { who: 'Stakloreza' });
        expect(list.mock.calls[0][1]).toBe('{from:staklo-rez.example to:staklo-rez.example cc:staklo-rez.example} newer_than:120d -category:promotions -category:social');
    });

    it('nije u Kontaktima ni dobavljač → imenik pošte (ljudi kojima si pisao)', async () => {
        store.delete('contacts/c1');
        store.set('mail_people/u1', { UID: 'u1', People: [{ Email: 'amra.demic@staklo-demo.example', Name: 'Amra Demić', Count: 4, Last_At: '' }] });
        await runTool(env(), 'search_mail', { who: 'Amri' });
        expect(list.mock.calls[0][1]).toMatch(/^{from:amra.demic@staklo-demo.example to:amra.demic@staklo-demo.example/);
    });

    it('osoba + riječi nađu manje od 2 → ERP proširi na svu poštu te osobe i kaže to', async () => {
        list.mockResolvedValueOnce([]).mockResolvedValueOnce(['a1', 'b2']);
        const res = await runTool(env(), 'search_mail', { who: 'Merima', words: 'ogledala potvrda' });
        expect(list.mock.calls[1][1]).not.toContain('ogledala');
        expect(res.mails).toHaveLength(2);
        expect(String(res.note)).toContain('ERP je pokazao svu poštu te osobe/firme');
        expect(String(res.note)).toContain('NOVIM mailom');
    });

    it('ništa nađeno → savjet da proba šire', async () => {
        list.mockResolvedValue([]);
        const res = await runTool(env(), 'search_mail', { words: 'kolone' });
        expect(res.mails).toEqual([]);
        expect(String(res.note)).toContain('Nema poruka za: kolone newer_than:120d');
    });

    it('id → cijela poruka s prilozima, bez citata stare poruke', async () => {
        full.mockResolvedValue({
            id: '18f2a3b4c5d6e7f8', internalDate: String(Date.parse('2026-10-28T08:00:00Z')), snippet: '',
            payload: {
                headers: [{ name: 'From', value: 'Merima Demo <merima@staklo-demo.example>' }, { name: 'To', value: 'ja@luxco-demo.example' }, { name: 'Subject', value: '12 kom spremno' }],
                mimeType: 'multipart/mixed',
                parts: [
                    { mimeType: 'text/plain', body: { data: Buffer.from('Ogledala su spremna.\n\nOn Mon, 20 Oct 2026 Ja wrote:\n> stara poruka').toString('base64url') } },
                    { mimeType: 'application/pdf', filename: 'Otpremnica 77.pdf', body: { attachmentId: 'x' } },
                ],
            },
        });
        const res = await runTool(env(), 'search_mail', { id: '18f2a3b4c5d6e7f8' });
        expect(res.mail).toBe('Od: Merima Demo <merima@staklo-demo.example>\nZa: ja@luxco-demo.example\nDatum: 28.10.2026 09:00\nNaslov: 12 kom spremno\nPrilozi: Otpremnica 77.pdf\n\nOgledala su spremna.');
        expect((await runTool(env(), 'search_mail', { id: '../x' })).ok).toBe(false);
    });

    it('Gmail nije povezan → reci korisniku gdje se povezuje', async () => {
        list.mockRejectedValue(new GmailError('not-connected', 'Gmail nije povezan.'));
        const res = await runTool(env(), 'search_mail', { words: 'ponuda' });
        expect(res).toMatchObject({ ok: false });
        expect(String(res.error)).toContain('Postavke');
    });
});
