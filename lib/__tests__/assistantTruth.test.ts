/**
 * @jest-environment node
 */
// ISTINA I RAZUMIJEVANJE na stvarnim porukama iz bilježnice (26.10.2026):
//   • bot je „potvrdio" tekstom, a ništa nije upisao → ERP to više ne pušta
//   • C604: dvije mjere, jedna stavka → ERP vrati modelu šta fali (pokrivenost)
//   • „I ima u tom stanu…" → lokacija iz razgovora, bez pitanja
//   • istorija za model su činjenice o upisu, ne tekst potvrde
// Claude je zamijenjen skriptom; sve između je pravi kod.

type Step = { calls?: { name: string; args: Record<string, unknown> }[]; text?: string };
const mockScript: Step[] = [];
const mockSent: any[] = [];
let mockSeq = 0;

jest.mock('@anthropic-ai/sdk', () => {
    class APIError extends Error { status = 500; }
    class Anthropic {
        static APIError = APIError;
        messages = {
            create: async (params: any) => {
                mockSent.push(JSON.parse(JSON.stringify(params)));
                const step = mockScript.shift();
                if (!step) throw new Error('skripta je prazna');
                const content = [
                    ...(step.text ? [{ type: 'text', text: step.text }] : []),
                    ...(step.calls || []).map(c => ({ type: 'tool_use', id: `tu${++mockSeq}`, name: c.name, input: c.args })),
                ];
                return { content, stop_reason: step.calls?.length ? 'tool_use' : 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
            },
        };
    }
    return { __esModule: true, default: Anthropic };
});
jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { claimsWrite, runAssistant } from '@/lib/assistant/brain';
import type { AssistantSession } from '@/lib/assistant/store';

const ORG = 'orgT';
const NOW = new Date('2026-10-26T09:56:00Z');
let session: AssistantSession = { history: [], pending: null };
const items = () => docs('memory_items').filter(m => m.Organization_ID === ORG);

async function say(text: string, steps: Step[], entryId = 'e1') {
    mockScript.push(...steps);
    mockSent.length = 0;
    const out = await runAssistant({ orgId: ORG, uid: 'u1', text, session, now: NOW, entryId });
    session = out.session;
    expect(mockScript).toHaveLength(0);
    return out;
}

beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo';
    store.set('workers/w', { Worker_ID: 'w1', Name: 'Amer', Organization_ID: ORG, Status: 'Aktivan' });
});

describe('potvrda bez upisa', () => {
    it('prepoznaje tekst koji tvrdi upis', () => {
        expect(claimsWrite('📒 1 kom Ogledalo 1100x1000 za E108 · E108 — pogrešno postavljeno')).toBe(true);
        expect(claimsWrite('Zapisao sam dvije stavke za E108:')).toBe(true);
        expect(claimsWrite('Zapisujem stavke za stan 308:')).toBe(true);
        expect(claimsWrite('U E108 imaš dvije otvorene stavke: ogledalo 1100x1000 (pogrešno).')).toBe(false);
    });

    it('model „potvrdi" tekstom → ERP vrati uz obavezan alat → upis', async () => {
        const out = await say('U e108 pogresno postavljeno ogledalo, treba 1100x1000.', [
            { text: 'Zapisao sam za E108:\n📒 1 kom Ogledalo 1100x1000 · E108 — pogrešno postavljeno' },
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', spec: '1100x1000', location: 'E108', state: 'pogresno', quantity: 1 } }] },
        ]);
        expect(mockSent[1].tool_choice).toEqual({ type: 'any' });
        expect(mockSent[1].messages.at(-1).content).toMatch(/ERP: ništa nije upisano/);
        expect(items().map(m => `${m.Title}|${m.Location}`)).toEqual(['Ogledalo 1100x1000|E108']);
        expect(out.outcome).toBe('written');
        expect(out.reply).toMatch(/^📒/);
    });

    it('istorija za model je činjenica o upisu, ne tekst potvrde', () => {
        const last = session.history.at(-1)!;
        expect(last.role).toBe('model');
        expect(last.text).toMatch(/^\[ERP je upisao i korisniku poslao potvrdu: bilješka „Ogledalo 1100x1000"/);
        expect(last.text).not.toMatch(/📒/);
    });

    it('i drugi put samo tekst → „⚠️ Ništa nije upisano" i dugme Pokušaj ponovo', async () => {
        const before = items().length;
        const out = await say('U e101 fali ogledalo 1350x1000', [
            { text: '📒 1 kom Ogledalo 1350x1000 · E101 — fali' },
            { text: 'Zapisao sam.' },
        ], 'e9');
        expect(items()).toHaveLength(before);
        expect(out.outcome).toBe('failed');
        expect(out.reply).toMatch(/^⚠️ Ništa nije upisano/);
        expect(out.buttons).toEqual([[{ text: '🔁 Pokušaj ponovo', data: 'retry:e9' }]]);
        expect(session.history.at(-1)!.text).toBe('[ništa nije upisano]');
    });
});

describe('razumijevanje: predobrada, fokus, pokrivenost', () => {
    it('model dobije normalizovanu poruku i spisak onoga što je ERP našao', async () => {
        await say('Stan e302 ima pgledalo 1000 puta 1600 nije postavljeno', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', spec: '1000x1600', location: 'E302', state: 'nije_postavljeno' } }] },
        ]);
        const msg = mockSent[0].messages.at(-1).content;
        expect(msg).toMatch(/^Stan E302 ima ogledalo 1000x1600 nije postavljeno\n\[ERP u poruci: lokacije E302; mjere 1000x1600/);
    });

    it('„I ima u tom stanu ogledalo 1000x800" → E302 iz razgovora, bez lokacije u pozivu', async () => {
        const out = await say('I ima u tom stanu ogledalo 1000x800', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', spec: '1000x800', state: 'nije_postavljeno' } }] },
        ]);
        expect(mockSent[0].messages.at(-1).content).toMatch(/lokacija iz razgovora: E302/);
        expect(items().find(m => m.Title === 'Ogledalo 1000x800')).toMatchObject({ Location: 'E302' });
        expect(out.outcome).toBe('written');
    });

    it('C604: jedna stavka za dvije mjere → ERP vrati modelu 1720x1000 → dvije stavke', async () => {
        const out = await say('U c604 imam ogledalo 1720x1000, a fali 1000x1350', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', spec: '1000x1350', location: 'C604', state: 'fali' } }] },
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', spec: '1720x1000', location: 'C604', state: 'nije_postavljeno' } }] },
        ]);
        expect(JSON.stringify(mockSent[1].messages.at(-1).content)).toMatch(/ERP: iz poruke nije upisano: 1720x1000/);
        expect(items().filter(m => m.Location === 'C604').map(m => m.Title).sort()).toEqual(['Ogledalo 1000x1350', 'Ogledalo 1720x1000']);
        expect(out.reply).not.toMatch(/nije upisano/);
    });

    it('ako model ni tad ne upiše sve, korisnik vidi šta je ostalo', async () => {
        const out = await say('E007 fali 1000x1350 i 1800x1000', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', spec: '1000x1350', location: 'E007', state: 'fali' } }] },
            { text: 'Gotovo.' },
        ]);
        expect(out.outcome).toBe('written');
        expect(out.reply).toMatch(/⚠️ Iz poruke nije upisano: 1800x1000 — reci šta je s tim\./);
    });

    it('pitanje bez upisa ostaje običan odgovor', async () => {
        const out = await say('Šta fali u E302?', [{ text: 'U E302: ogledalo 1000x1600 i 1000x800, oba nisu postavljena.' }]);
        expect(out.outcome).toBe('answer');
        expect(mockSent).toHaveLength(1);
    });
});

describe('faza C: podsjetnici i zadaci (stvarne poruke 23.10.)', () => {
    const tasks = () => docs('tasks').filter(t => t.Organization_ID === ORG);
    beforeAll(() => {
        store.set('workers/i', { Worker_ID: 'w-imer', Name: 'Imer Plećan', Organization_ID: ORG, Status: 'Aktivan' });
        session = { history: [], pending: null };
    });

    it('„Neka imer napravi Dini dasku" — model samo odgovori → ERP traži upis (jači model) → zadatak za Imera', async () => {
        const out = await say('Neka imer napravi Dini dasku', [
            { text: 'U redu, prenijeću.' },
            { calls: [{ name: 'create_task', args: { title: 'Napraviti dasku za Dinu', category: 'manufacturing', worker: 'W2' } }] },
        ]);
        expect(mockSent[0].messages.at(-1).content).toMatch(/vrsta: zadatak za radnika .*; radnici: Imer Plećan \(W2\)/);
        expect(mockSent[1]).toMatchObject({ model: 'claude-sonnet-5-5', tool_choice: { type: 'any' } });
        expect(mockSent[1].messages.at(-1).content).toMatch(/ERP: poruka traži upis \(task\)/);
        expect(tasks().map(t => `${t.Title}|${t.Assigned_Worker_Name}`)).toEqual(['Napraviti dasku za Dinu|Imer Plećan']);
        expect(out.outcome).toBe('written');
    });

    it('naslov iz ranijeg razgovora („na CNC-u") se odbija; zadatak bez rečenog radnika → ERP vrati „radnik Imer"', async () => {
        const out = await say('Neka imer napravi Dini dasku', [
            { calls: [{ name: 'create_task', args: { title: 'Odraditi ploču za Dinu na CNC-u', category: 'manufacturing' } }] },
            { calls: [{ name: 'create_task', args: { title: 'Napraviti dasku za Dinu', category: 'manufacturing' } }] },
            { calls: [{ name: 'update_task', args: { task: 'T2', note: 'Imer' } }] },
        ]);
        expect(JSON.parse(mockSent[1].messages.at(-1).content[0].content)).toMatchObject({ ok: false, error: expect.stringMatching(/nije iz poruke korisnika/) });
        expect(JSON.stringify(mockSent[2].messages.at(-1).content)).toMatch(/nije upisano: radnik Imer Plećan/);
        expect(out.outcome).toBe('written');
    });

    it('„Napisi mi u 00:01 poruku za laku noc" bez vremena u upisu → ERP vrati „vrijeme 00:01"', async () => {
        await say('Napisi mi u 00:01 poruku za laku noc', [
            { calls: [{ name: 'create_task', args: { title: 'Poruka za laku noć', category: 'reminder' } }] },
            { calls: [{ name: 'update_task', args: { task: 'T3', reminder_at: '2026-10-27T00:01' } }] },
        ]);
        expect(JSON.stringify(mockSent[1].messages.at(-1).content)).toMatch(/nije upisano: vrijeme 00:01/);
    });

    it('pitanje se ne tjera u upis', async () => {
        const out = await say('Sta imam za ponedjeljak', [{ text: 'Za ponedjeljak nemaš ništa.' }]);
        expect(mockSent).toHaveLength(1);
        expect(mockSent[0].model).toBe('claude-haiku-5-5');
        expect(out.outcome).toBe('answer');
    });

    it('model pita tekstom („Kome?") — to je pitanje, ne neuspjeh', async () => {
        const out = await say('Reci da se napravi ploča', [{ text: 'Kome da kažem?' }]);
        expect(mockSent).toHaveLength(1);
        expect(out.outcome).toBe('answer');
    });
});
