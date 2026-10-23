/**
 * @jest-environment node
 */
// Scenariji asistenta od poruke do baze: Gemini je zamijenjen skriptom
// (unaprijed zadati pozivi alata), Firestore je mala memorijska baza.
// Provjerava se SVE između: oznake → ID-jevi, vrijeme podsjetnika, bilježnica,
// izvještaj radnika, pitanje s opcijama i poništavanje.

type Step = { calls?: { name: string; args: Record<string, unknown> }[]; text?: string };
const mockScript: Step[] = [];
/** Sve što je poslano modelu (poruke i odgovori alata). */
const mockSent: any[] = [];

jest.mock('@google/generative-ai', () => {
    const actual = jest.requireActual('@google/generative-ai');
    return {
        ...actual,
        GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
            getGenerativeModel: () => ({
                startChat: () => ({
                    sendMessage: async (msg: any) => {
                        mockSent.push(msg);
                        const step = mockScript.shift();
                        if (!step) throw new Error('skripta je prazna');
                        return { response: { functionCalls: () => step.calls, text: () => step.text || '' } };
                    },
                }),
            }),
        })),
    };
});

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as mockStore } from '@/lib/testing/fakeFirestore';
import { runAssistant } from '@/lib/assistant/brain';
import { undoTurn, type AssistantSession } from '@/lib/assistant/store';

const NOW = new Date('2026-10-23T12:05:00Z'); // petak 14:05 u Sarajevu

let session: AssistantSession = { history: [], pending: null };
async function say(text: string, steps: Step[], extra: Partial<Parameters<typeof runAssistant>[0]> = {}) {
    mockScript.push(...steps);
    const out = await runAssistant({ orgId: 'org1', uid: 'u1', text, session, now: NOW, ...extra });
    session = out.session;
    expect(mockScript).toHaveLength(0);
    return out;
}

beforeAll(() => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test';
    process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo';
    mockStore.set('workers/a', { Worker_ID: 'w-amer', Name: 'Amer Hodžić', Organization_ID: 'org1', Status: 'Aktivan' });
    mockStore.set('workers/b', { Worker_ID: 'w-edin', Name: 'Edin Begić', Organization_ID: 'org1', Status: 'Aktivan' });
    mockStore.set('workers/x', { Worker_ID: 'w-tudji', Name: 'Tuđi Radnik', Organization_ID: 'org2', Status: 'Aktivan' });
    mockStore.set('projects/p', { Project_ID: 'p-grb', Client_Name: 'Begović', Name: 'Zgrada Grbavica', Address: 'Grbavica', Status: 'U toku', Created_Date: '2026-09-01', Organization_ID: 'org1' });
});

describe('asistent od poruke do baze', () => {
    let firstUndo = '';

    it('„u ponedjeljak naručiti 10 baglama" → podsjetnik pon 08:00', async () => {
        const out = await say('U ponedjeljak trebam naručiti 10 baglama', [
            { calls: [{ name: 'create_task', args: { title: 'Naručiti 10 baglama', category: 'ordering', reminder_at: '2026-10-26T08:00' } }] },
            { text: '✅ Podsjetnik pon 26.10. u 08:00 — Naručiti 10 baglama' },
        ]);
        const [task] = docs('tasks');
        expect(task).toMatchObject({
            Title: 'Naručiti 10 baglama', Category: 'ordering', Organization_ID: 'org1',
            Reminder_At: '2026-10-26T07:00:00.000Z', Reminder_Pending: true, Due_Date: '2026-10-26',
            Source: 'telegram', Created_By_UID: 'u1', Status: 'pending',
        });
        expect(out.created.taskIds).toEqual([task.Task_ID]);
        firstUndo = out.buttons[0][0].data;
        expect(firstUndo).toMatch(/^undo:/);
    });

    it('nepostojeća oznaka radnika se odbija', async () => {
        const before = docs('tasks').length;
        await say('kaži Mujagi da dođe', [
            { calls: [{ name: 'create_task', args: { title: 'Reći Mujagi', category: 'general', worker: 'W9' } }] },
            { text: 'Nemam radnika Mujaga u listi.' },
        ]);
        expect(docs('tasks')).toHaveLength(before);
    });

    it('„napomeni me da kažem radniku…" → pitanje, pa zadatak za izabranog radnika', async () => {
        const ask = await say('Napomeni me da kažem radniku da povuče ogledala u kombiju', [
            { calls: [{ name: 'ask_user', args: { question: 'Kojem radniku i kada?', options: ['Amer Hodžić', 'Edin Begić'] } }] },
        ]);
        expect(ask.reply).toBe('Kojem radniku i kada?');
        expect(ask.buttons).toEqual([[{ text: 'Amer Hodžić', data: 'opt:0' }], [{ text: 'Edin Begić', data: 'opt:1' }]]);
        expect(session.pending?.options).toEqual(['Amer Hodžić', 'Edin Begić']);

        await say('Amer Hodžić sutra u 7', [
            { calls: [{ name: 'create_task', args: { title: 'Reći Ameru da povuče ogledala u kombi', category: 'reminder', worker: 'W1', reminder_at: '2026-10-24T07:00' } }] },
            { text: '✅ Podsjetnik sutra u 07:00' },
        ]);
        const task = docs('tasks').find(t => t.Title.startsWith('Reći Ameru'));
        expect(task).toMatchObject({ Assigned_Worker_ID: 'w-amer', Assigned_Worker_Name: 'Amer Hodžić', Reminder_At: '2026-10-24T05:00:00.000Z' });
        expect(session.pending).toBeNull();
    });

    it('„u stanu 304 imam 3 ogledala od 1 m" → bilježnica', async () => {
        await say('U stanu 304 imam 3 ogledala od 1 m dužine, nisu montirana', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', title: 'Ogledala 1 m', quantity: 3, unit: 'kom', spec: '1 m dužine', location: 'Stan 304', state_label: 'nije montirano' } }] },
            { text: '📒 Zapisano.' },
        ]);
        const [item] = docs('memory_items');
        expect(item).toMatchObject({
            Subject: 'ogledalo', Quantity: 3, Location: 'Stan 304', State: 'open', State_Label: 'nije montirano',
            Owner_UID: 'u1', Organization_ID: 'org1',
        });
        expect(item.History[0].By).toBe('ja');
    });

    it('isti predmet na istoj lokaciji dopunjuje stavku umjesto nove', async () => {
        await say('U 304 su ustvari 4 ogledala', [
            { calls: [{ name: 'remember', args: { subject: 'Ogledalo', quantity: 4, location: 'stan 304', state_label: 'nije montirano' } }] },
            { text: 'Ispravljeno na 4.' },
        ]);
        const items = docs('memory_items');
        expect(items).toHaveLength(1);
        expect(items[0].Quantity).toBe(4);
    });

    it('proslijeđeni izvještaj radnika zatvara stavku', async () => {
        await say('Montirali smo ogledala u 304', [
            { calls: [{ name: 'update_memory', args: { item: 'M1', resolved: true, state_label: 'montirano', note: 'Javio da su montirana' } }] },
            { text: '✔ Zatvoreno: ogledala u stanu 304 — montirano.' },
        ], { forward: { from: 'Amer Hodžić', date: '2026-10-23T11:00:00Z' } });
        const [item] = docs('memory_items');
        expect(item.State).toBe('resolved');
        expect(item.State_Label).toBe('montirano');
        expect(item.History.at(-1)).toMatchObject({ By: 'Amer Hodžić', Text: 'Javio da su montirana' });
        expect(session.history.at(-2)?.text).toMatch(/^\[Proslijeđeno od Amer Hodžić, 23\.10\. 13:00\]/);
    });

    it('pitanje o riješenim stavkama ide kroz search_memory', async () => {
        mockSent.length = 0;
        const out = await say('Šta je bilo s ogledalima u 304?', [
            { calls: [{ name: 'search_memory', args: { query: 'ogledala 304' } }] },
            { text: 'Ogledala u stanu 304 su montirana (Amer, 23.10.).' },
        ]);
        const toolReply = mockSent[1][0].functionResponse.response;
        expect(toolReply.items).toEqual([expect.stringMatching(/^S1 | ogledalo .*Stan 304 | RIJEŠENO: montirano/)]);
        expect(toolReply.messages.some((m: string) => m.includes('od Amer Hodžić'))).toBe(false); // dnevnik se puni u webhooku, ne u mozgu
        expect(out.reply).toContain('montirana');
        expect(out.buttons).toEqual([]); // samo čitanje — nema šta poništiti
    });

    it('↩️ Poništi briše zadatak iz prve poruke', async () => {
        const turnId = firstUndo.slice('undo:'.length);
        const undone = await undoTurn(turnId, 'u1');
        expect(undone).toEqual(['zadatak „Naručiti 10 baglama"']);
        expect(docs('tasks').some(t => t.Title === 'Naručiti 10 baglama')).toBe(false);
        expect(await undoTurn(turnId, 'u1')).toEqual([]);
    });

    it('tuđi korisnik ne može poništiti', async () => {
        const out = await say('U kombiju je 5 vodilica', [
            { calls: [{ name: 'remember', args: { subject: 'vodilica', quantity: 5, location: 'Kombi', state_label: 'u kombiju' } }] },
            { text: 'Zapisano.' },
        ]);
        const turnId = out.buttons[0][0].data.slice(5);
        expect(await undoTurn(turnId, 'neko-drugi')).toEqual([]);
        expect(docs('memory_items').some(m => m.Subject === 'vodilica')).toBe(true);
    });

    it('bez Gemini ključa poruka nije izgubljena, korisnik dobija objašnjenje', async () => {
        delete process.env.GOOGLE_GEMINI_API_KEY;
        const out = await runAssistant({ orgId: 'org1', uid: 'u1', text: 'nešto', session, now: NOW });
        expect(out.degraded).toBe(true);
        expect(out.reply).toMatch(/nije podešen/);
        process.env.GOOGLE_GEMINI_API_KEY = 'test';
    });
});
