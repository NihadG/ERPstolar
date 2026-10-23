/**
 * @jest-environment node
 */
// Scenariji asistenta od poruke do baze: Claude je zamijenjen skriptom
// (unaprijed zadati pozivi alata), Firestore je mala memorijska baza.
// Provjerava se SVE između: oznake → ID-jevi, vrijeme podsjetnika, bilježnica,
// izvještaj radnika, pitanje s opcijama, poništavanje — i trošak: keš,
// effort i odgovor bez drugog poziva modela.

type Step = { calls?: { name: string; args: Record<string, unknown> }[]; text?: string };
const mockScript: Step[] = [];
/** Svaki zahtjev poslan modelu (parametri messages.create). */
const mockSent: any[] = [];
let mockToolSeq = 0;

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
                    ...(step.calls || []).map(c => ({ type: 'tool_use', id: `tu${++mockToolSeq}`, name: c.name, input: c.args })),
                ];
                return {
                    content,
                    stop_reason: step.calls?.length ? 'tool_use' : 'end_turn',
                    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
                };
            },
        };
    }
    return { __esModule: true, default: Anthropic };
});

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as mockStore } from '@/lib/testing/fakeFirestore';
import { runAssistant } from '@/lib/assistant/brain';
import { undoTurn, type AssistantSession } from '@/lib/assistant/store';

const NOW = new Date('2026-10-23T12:05:00Z'); // petak 14:05 u Sarajevu
const systemText = (params: any) => params.system.map((b: any) => b.text).join('\n');
/** Sadržaj zadnjeg tool_result bloka u zahtjevu (ono što je model dobio od alata). */
const lastToolResult = (params: any) => JSON.parse(params.messages.at(-1).content[0].content);

let session: AssistantSession = { history: [], pending: null };
async function say(text: string, steps: Step[], extra: Partial<Parameters<typeof runAssistant>[0]> = {}) {
    mockScript.push(...steps);
    const out = await runAssistant({ orgId: 'org1', uid: 'u1', text, session, now: NOW, ...extra });
    session = out.session;
    expect(mockScript).toHaveLength(0);
    return out;
}

beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo';
    mockStore.set('workers/a', { Worker_ID: 'w-amer', Name: 'Amer Hodžić', Organization_ID: 'org1', Status: 'Aktivan' });
    mockStore.set('workers/b', { Worker_ID: 'w-edin', Name: 'Edin Begić', Organization_ID: 'org1', Status: 'Aktivan' });
    mockStore.set('workers/x', { Worker_ID: 'w-tudji', Name: 'Tuđi Radnik', Organization_ID: 'org2', Status: 'Aktivan' });
    mockStore.set('projects/p', { Project_ID: 'p-grb', Client_Name: 'Begović', Name: 'Zgrada Grbavica', Address: 'Grbavica', Status: 'U toku', Created_Date: '2026-09-01', Organization_ID: 'org1' });
    mockStore.set('projects/old', { Project_ID: 'p-old', Client_Name: 'Stari Klijent', Status: 'Završeno', Created_Date: '2025-01-10', Organization_ID: 'org1' });
    mockStore.set('tasks/far', { Task_ID: 't-far', Organization_ID: 'org1', Title: 'Servis CNC mašine', Status: 'pending', Due_Date: '2027-03-01', Created_Date: '2026-01-01', Links: [] });
});

describe('asistent od poruke do baze', () => {
    let firstUndo = '';

    it('„u ponedjeljak naručiti 10 baglama" → podsjetnik pon 08:00, jedan poziv modela', async () => {
        mockSent.length = 0;
        const out = await say('U ponedjeljak trebam naručiti 10 baglama', [
            { calls: [{ name: 'create_task', args: { title: 'Naručiti 10 baglama', category: 'ordering', reminder_at: '2026-10-26T08:00' } }] },
        ]);
        const [task] = docs('tasks').filter(t => t.Title === 'Naručiti 10 baglama');
        expect(task).toMatchObject({
            Category: 'ordering', Organization_ID: 'org1',
            Reminder_At: '2026-10-26T07:00:00.000Z', Reminder_Pending: true, Due_Date: '2026-10-26',
            Source: 'telegram', Created_By_UID: 'u1', Status: 'pending',
        });
        expect(mockSent).toHaveLength(1); // potvrdu je složio sistem
        expect(out.reply).toBe('✅ Naručiti 10 baglama — pon 26.10. u 08:00');
        expect(out.created.taskIds).toEqual([task.Task_ID]);
        firstUndo = out.buttons[0][0].data;
        expect(firstUndo).toMatch(/^undo:/);
    });

    it('zahtjev je složen za keš: alati + stabilan dio prvi, vrijeme iza tačke keša, effort low', async () => {
        const p = mockSent[0];
        expect(p.model).toBe('claude-haiku-5-5');
        expect(p.output_config).toEqual({ effort: 'low' });
        expect(p.cache_control).toEqual({ type: 'ephemeral' });
        expect(p.system[0].cache_control).toEqual({ type: 'ephemeral' });
        expect(p.system[0].text).not.toMatch(/SADA:|KALENDAR|2026-10-2/);
        expect(p.system[1].text).toMatch(/^SADA: petak, 23\.10\.2026, 14:05/);
        expect(p.temperature).toBeUndefined();
        expect(p.tools.map((t: any) => t.name)).toEqual(['create_task', 'update_task', 'remember', 'update_memory', 'search_memory', 'find_material', 'ask_user']);

        // Stabilni dio je isti i kasnije u danu → keš se čita.
        mockSent.length = 0;
        mockScript.push({ text: 'ok' });
        await runAssistant({ orgId: 'org1', uid: 'u1', text: 'x', session: { history: [], pending: null }, now: new Date('2026-10-23T15:47:00Z') });
        expect(mockSent[0].system[0].text).toBe(p.system[0].text);
    });

    it('manji kontekst: stari zatvoreni projekti i daleki zadaci nisu u promptu', () => {
        const p = mockSent[0];
        expect(systemText(p)).toContain('Zgrada Grbavica');
        expect(systemText(p)).not.toContain('Stari Klijent');
        expect(systemText(p)).not.toContain('Servis CNC mašine');
    });

    it('daleki zadatak se nađe pretragom i može se odmah izmijeniti', async () => {
        mockSent.length = 0;
        const out = await say('Kad je servis CNC mašine?', [
            { calls: [{ name: 'search_memory', args: { query: 'servis CNC' } }] },
            { text: 'Servis CNC mašine je zakazan za 1.3.2027.' },
        ]);
        const found = lastToolResult(mockSent[1]).tasks;
        expect(found).toEqual([expect.stringMatching(/^T\d+ \| Servis CNC mašine \| rok 2027-03-01/)]);
        expect(out.reply).toContain('1.3.2027');
    });

    it('nepostojeća oznaka radnika se odbija i model dobija grešku', async () => {
        const before = docs('tasks').length;
        mockSent.length = 0;
        await say('kaži Mujagi da dođe', [
            { calls: [{ name: 'create_task', args: { title: 'Reći Mujagi', category: 'general', worker: 'W9' } }] },
            { text: 'Nemam radnika Mujaga u listi.' },
        ]);
        expect(docs('tasks')).toHaveLength(before);
        expect(lastToolResult(mockSent[1])).toMatchObject({ ok: false });
        expect(mockSent[1].messages.at(-1).content[0].is_error).toBe(true);
    });

    it('„napomeni me da kažem radniku…" → pitanje, pa zadatak za izabranog radnika', async () => {
        const ask = await say('Napomeni me da kažem radniku da povuče ogledala u kombiju', [
            { calls: [{ name: 'ask_user', args: { question: 'Kojem radniku i kada?', options: ['Amer Hodžić (W1)', 'Edin Begić (W2)'] } }] },
        ]);
        expect(ask.reply).toBe('Kojem radniku i kada?');
        expect(ask.buttons).toEqual([[{ text: 'Amer Hodžić', data: 'opt:0' }], [{ text: 'Edin Begić', data: 'opt:1' }]]);
        expect(session.pending?.options).toEqual(['Amer Hodžić', 'Edin Begić']);

        const out = await say('Amer Hodžić sutra u 7', [
            { calls: [{ name: 'create_task', args: { title: 'Reći Ameru da povuče ogledala u kombi', category: 'reminder', worker: 'W1', reminder_at: '2026-10-24T07:00' } }] },
        ]);
        const task = docs('tasks').find(t => t.Title.startsWith('Reći Ameru'));
        expect(task).toMatchObject({ Assigned_Worker_ID: 'w-amer', Assigned_Worker_Name: 'Amer Hodžić', Reminder_At: '2026-10-24T05:00:00.000Z' });
        expect(out.reply).toBe('✅ Reći Ameru da povuče ogledala u kombi — sutra u 07:00 · Amer Hodžić');
        expect(session.pending).toBeNull();
    });

    it('jedan posao s više ljudi → jedan zadatak, dopuna ide u check listu', async () => {
        const before = docs('tasks').length;
        const first = await say('Reci Imeru u ponedjeljak ujutro da napravi ploču za Dinu', [
            { calls: [{ name: 'create_task', args: { title: 'Ploča za Dinu', category: 'manufacturing', worker: 'W1', reminder_at: '2026-10-26T08:00', checklist: ['Amer — napraviti ploču'] } }] },
        ]);
        expect(first.reply).toBe('✅ Ploča za Dinu — pon 26.10. u 08:00 · Amer Hodžić\n☐ Amer — napraviti ploču');

        // Oznaka iz liste zadataka u promptu — model je čita isto tako.
        mockSent.length = 0;
        mockScript.push({ text: 'x' });
        await runAssistant({ orgId: 'org1', uid: 'u1', text: '(proba)', session: { history: [], pending: null }, now: NOW });
        const alias = systemText(mockSent[0]).match(/^(T\d+) \| Ploča za Dinu/m)![1];

        const out = await say('a Edinu reci da odradi na CNC', [
            { calls: [{ name: 'update_task', args: { task: alias, add_checklist: ['Edin — CNC'] } }] },
        ]);
        const tasks = docs('tasks').filter(t => t.Title === 'Ploča za Dinu');
        expect(docs('tasks')).toHaveLength(before + 1);
        expect(tasks[0].Checklist.map((c: any) => c.text)).toEqual(['Amer — napraviti ploču', 'Edin — CNC']);
        expect(out.reply).toBe('➕ Ploča za Dinu:\n☐ Edin — CNC');
    });

    it('„u stanu 304 imam 3 ogledala od 1 m" → bilježnica', async () => {
        const out = await say('U stanu 304 imam 3 ogledala od 1 m dužine, nisu montirana', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', title: 'Ogledala', quantity: 3, unit: 'kom', spec: '1 m dužine', location: 'Stan 304', state_label: 'nije montirano' } }] },
        ]);
        const [item] = docs('memory_items');
        expect(item).toMatchObject({
            Subject: 'ogledalo', Quantity: 3, Location: 'Stan 304', State: 'open', State_Label: 'nije montirano',
            Owner_UID: 'u1', Organization_ID: 'org1',
        });
        expect(item.History[0].By).toBe('ja');
        expect(out.reply).toBe('📒 3 kom Ogledala (1 m dužine) · Stan 304 — nije montirano');
    });

    it('isti predmet na istoj lokaciji dopunjuje stavku umjesto nove', async () => {
        await say('U 304 su ustvari 4 ogledala', [
            { calls: [{ name: 'remember', args: { subject: 'Ogledalo', quantity: 4, location: 'stan 304', state_label: 'nije montirano' } }] },
        ]);
        const items = docs('memory_items');
        expect(items).toHaveLength(1);
        expect(items[0].Quantity).toBe(4);
    });

    it('proslijeđeni izvještaj radnika zatvara stavku', async () => {
        const out = await say('Montirali smo ogledala u 304', [
            { calls: [{ name: 'update_memory', args: { item: 'M1', resolved: true, state_label: 'montirano', note: 'Javio da su montirana' } }] },
        ], { forward: { from: 'Amer Hodžić', date: '2026-10-23T11:00:00Z' } });
        const [item] = docs('memory_items');
        expect(item.State).toBe('resolved');
        expect(item.State_Label).toBe('montirano');
        expect(item.History.at(-1)).toMatchObject({ By: 'Amer Hodžić', Text: 'Javio da su montirana' });
        expect(session.history.at(-2)?.text).toMatch(/^\[Proslijeđeno od Amer Hodžić, 23\.10\. 13:00\]/);
        expect(out.reply).toBe('✔ 4 kom Ogledala (1 m dužine) · Stan 304 — montirano');
    });

    it('pitanje o riješenim stavkama ide kroz search_memory', async () => {
        mockSent.length = 0;
        const out = await say('Šta je bilo s ogledalima u 304?', [
            { calls: [{ name: 'search_memory', args: { query: 'ogledala 304' } }] },
            { text: 'Ogledala u stanu 304 su montirana (Amer, 23.10.).' },
        ]);
        expect(lastToolResult(mockSent[1]).items).toEqual([expect.stringMatching(/^S1 \| ogledalo .*Stan 304 \| RIJEŠENO: montirano/)]);
        expect(out.reply).toContain('montirana');
        expect(out.buttons).toEqual([]); // samo čitanje — nema šta poništiti
    });

    it('oznake iz modelovog teksta se ne pokazuju korisniku', async () => {
        const out = await say('ko radi ploču?', [{ text: 'Ploču za Dinu (T7) radi Amer (W1).' }]);
        expect(out.reply).toBe('Ploču za Dinu radi Amer.');
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
        ]);
        const turnId = out.buttons[0][0].data.slice(5);
        expect(await undoTurn(turnId, 'neko-drugi')).toEqual([]);
        expect(docs('memory_items').some(m => m.Subject === 'vodilica')).toBe(true);
    });

    it('bez Anthropic ključa poruka nije izgubljena, korisnik dobija objašnjenje', async () => {
        delete process.env.ANTHROPIC_API_KEY;
        const out = await runAssistant({ orgId: 'org1', uid: 'u1', text: 'nešto', session, now: NOW });
        expect(out.degraded).toBe(true);
        expect(out.reply).toMatch(/ANTHROPIC_API_KEY/);
        process.env.ANTHROPIC_API_KEY = 'test';
    });
});
