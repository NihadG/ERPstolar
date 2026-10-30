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
import Anthropic from '@anthropic-ai/sdk';
import { failureReason, runAssistant } from '@/lib/assistant/brain';
import { undoTurn, type AssistantSession } from '@/lib/assistant/store';
import { memoryButtonState, runTool, stripAliases } from '@/lib/assistant/tools';

/** Minimalno okruženje za direktan poziv alata (bez modela). */
const envFor = () => ({ orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date('2026-10-23T12:05:00Z'), turnId: 't', dateText: '', reporter: 'ja', searchHits: [], created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [] });
import { getOrderWithItems, loadProjectMaterials, sendOrder } from '@/lib/server/orderWrites';
import { buildOrderPdf } from '@/lib/server/orderPdf';

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
        expect(out.usage).toMatchObject({ calls: 1, input: 100, output: 20, models: ['claude-haiku-5-5'] });   // potrošnja ide u dnevnik
        expect(out.reply).toBe('✅ Naručiti 10 baglama — pon 26.10. u 08:00');
        expect(out.created.taskIds).toEqual([task.Task_ID]);
        firstUndo = out.buttons[0][0].data;
        expect(firstUndo).toMatch(/^undo:/);
    });

    it('zahtjev je složen za keš: alati + stabilan dio prvi, vrijeme iza tačke keša, effort low', async () => {
        const p = mockSent[0];
        expect(p.model).toBe('claude-haiku-5-5');
        expect(p.output_config).toEqual({ effort: 'low' });
        expect(p.thinking).toEqual({ type: 'between_tools' });   // Haiku 5.5 više ne prima „disabled"
        expect(p.cache_control).toEqual({ type: 'ephemeral' });
        expect(p.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' }); // poruke s terena stižu u razmacima 5–60 min
        expect(p.system[0].text).not.toMatch(/SADA:|KALENDAR|2026-10-2/);
        expect(p.system[1].text).toMatch(/^SADA: petak, 23\.10\.2026, 14:05/);
        expect(p.temperature).toBeUndefined();
        expect(p.tools.map((t: any) => t.name)).toEqual(['create_task', 'update_task', 'remember', 'update_memory', 'search_memory', 'find_material', 'create_order', 'product_materials', 'list_orders', 'manage_order', 'log_work', 'fill_work_days', 'work_report', 'set_presence', 'set_progress', 'order_status', 'project_brief', 'project_history', 'list_notebook', 'order_pdf', 'email_order', 'email_contact', 'find_contact', 'save_contact', 'material_status', 'material_arrived', 'learn_name', 'ask_user']);
        expect(p.system[0].text).toContain('NALOZI U RADU (oznaka | naziv):');

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
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', quantity: 3, unit: 'kom', spec: '1 m dužine', location: 'stan 304', state: 'nije_postavljeno' } }] },
        ]);
        const [item] = docs('memory_items');
        expect(item).toMatchObject({
            Subject: 'ogledalo', Title: 'Ogledalo', Quantity: 3, Location: 'Stan 304', State: 'open', State_Label: 'u stanu, nije postavljeno', State_Key: 'nije_postavljeno',
            Owner_UID: 'u1', Organization_ID: 'org1',
        });
        expect(item.History[0].By).toBe('ja');
        expect(out.reply).toBe('📒 3 kom Ogledalo (1 m dužine) · Stan 304 — u stanu, nije postavljeno');
        expect(out.buttons[0]).toEqual([{ text: '✔ postavljeno: Ogledalo · Stan 304', data: `mem:${item.Item_ID}:p` }]);
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
            { calls: [{ name: 'update_memory', args: { item: 'M1', state: 'postavljeno', note: 'Javio da su montirana' } }] },
        ], { forward: { from: 'Amer Hodžić', date: '2026-10-23T11:00:00Z' } });
        const [item] = docs('memory_items');
        expect(item.State).toBe('resolved');
        expect(item.State_Label).toBe('postavljeno');
        expect(item.History.at(-1)).toMatchObject({ By: 'Amer Hodžić', Text: 'Javio da su montirana' });
        expect(session.history.at(-2)?.text).toMatch(/^\[Proslijeđeno od Amer Hodžić, 23\.10\. 13:00\]/);
        expect(out.reply).toBe('✔ 4 kom Ogledalo (1 m dužine) · Stan 304 — postavljeno');
    });

    it('današnji obilazak: lokacija, mjere i naslov složi ERP; dvosmislena lokacija → pitanje; dugme bez modela', async () => {
        const mem = () => docs('memory_items').filter(m => m.Subject === 'ogledalo' && m.Location !== 'Stan 304');
        await say('Stan e302 ima ogledalo 1000x1600 nije postavljeno', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', quantity: 1, spec: '1000x1600', location: 'stan e302', state: 'nije_postavljeno' } }] },
        ]);
        // „308" bez slova: jedina zgrada s 3xx stanovima je E.
        const r308 = await say('U stanu 308 jedno ogledalo 1000 puta 1100', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', quantity: 1, spec: '1000 puta 1100', location: 'stan 308', state: 'nije_postavljeno' } }] },
        ]);
        expect(r308.reply).toBe('📒 1 kom Ogledalo 1000x1100 · E308 — u stanu, nije postavljeno');
        // C604: dvije stavke, naslov uvijek prati svoju mjeru.
        await say('U c604 imam ogledalo 1720x1000, a fali 1000x1350', [
            { calls: [
                { name: 'remember', args: { subject: 'ogledalo', quantity: 1, spec: '1720x1000', location: 'c604', state: 'nije_postavljeno' } },
                { name: 'remember', args: { subject: 'ogledalo', quantity: 1, spec: '1000x1350', location: 'c604', state: 'fali' } },
            ] },
        ]);
        expect(mem().filter(m => m.Location === 'C604').map(m => `${m.Title}:${m.State_Label}`).sort())
            .toEqual(['Ogledalo 1000x1350:fali', 'Ogledalo 1720x1000:u stanu, nije postavljeno']);

        mockStore.set('memory_items/c301', { Item_ID: 'c301', Organization_ID: 'org1', Owner_UID: 'u1', Title: 'Lajsna', Subject: 'lajsna', Location: 'C301', Links: [], State: 'open', State_Label: 'fali', Tags: [], History: [], Source_Entry_IDs: [], Created_At: '2026-10-26', Updated_At: '2026-10-26' });
        // „305" — postoje 3xx stanovi i u E i u C → ERP traži pitanje s opcijama.
        mockSent.length = 0;
        await say('U 305 fali ogledalo', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', location: '305', state: 'fali' } }] },
            { calls: [{ name: 'ask_user', args: { question: 'Koji stan?', options: ['E305', 'C305'] } }] },
        ]);
        expect(JSON.parse(mockSent[1].messages.at(-1).content[0].content).error).toMatch(/E305, C305/);

        // Dugme „✔ postavljeno" ispod potvrde — bez poziva modela.
        const e308 = mem().find(m => m.Location === 'E308')!;
        const res = await memoryButtonState('org1', 'u1', e308.Item_ID, 'postavljeno', NOW);
        expect(res).toEqual({ ok: true, line: '✔ 1 kom Ogledalo 1000x1100 · E308 — postavljeno' });
        expect(docs('memory_items').find(m => m.Item_ID === e308.Item_ID)).toMatchObject({ State: 'resolved', State_Key: 'postavljeno' });
        expect(await memoryButtonState('org1', 'neko-drugi', e308.Item_ID, 'fali', NOW)).toMatchObject({ ok: false });

        // „Sve su to C604 hodnik" — više stavki jednim pozivom.
        mockSent.length = 0;
        await say('Koja ogledala su na C604?', [{ text: 'Dva.' }]);
        const aliases = Array.from(String(systemText(mockSent[0])).matchAll(/(M\d+) \| ogledalo \| Ogledalo (?:1720x1000|1000x1350)/g)).map((m: RegExpMatchArray) => m[1]);
        expect(aliases).toHaveLength(2);
        const moved = await say('Ta dva su ustvari na hodniku C6', [
            { calls: [{ name: 'update_memory', args: { items: aliases, location: 'hodnik c6', note: 'Premješteno' } }] },
        ]);
        expect(moved.reply).toMatch(/^📒 2 stavke → Hodnik C6/);
        expect(mem().filter(m => m.Location === 'Hodnik C6')).toHaveLength(2);
    });

    it('izbor ponuđene lokacije se zapamti: drugi put „306" je odmah E306', async () => {
        await say('U 306 fali ogledalo', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', location: '306', state: 'fali' } }] },
            { calls: [{ name: 'ask_user', args: { question: 'Koji stan?', options: ['E306', 'C306'] } }] },
        ]);
        await say('E306', [
            { calls: [{ name: 'remember', args: { subject: 'ogledalo', location: 'E306', state: 'fali' } }] },
        ]);
        expect(docs('assistant_vocab').find(v => v.Phrase === '306')).toMatchObject({ Kind: 'location', Target_ID: 'E306', Source: 'confirmed' });
        const out = await say('U 306 fali i lajsna', [
            { calls: [{ name: 'remember', args: { subject: 'lajsna', location: '306', state: 'fali' } }] },
        ]);
        expect(out.reply).toBe('📒 Lajsna · E306 — fali');
    });

    it('pitanje o riješenim stavkama ide kroz search_memory', async () => {
        mockSent.length = 0;
        const out = await say('Šta je bilo s ogledalima u 304?', [
            { calls: [{ name: 'search_memory', args: { query: 'ogledala 304' } }] },
            { text: 'Ogledala u stanu 304 su montirana (Amer, 23.10.).' },
        ]);
        expect(lastToolResult(mockSent[1]).items).toEqual(expect.arrayContaining([expect.stringMatching(/^S\d+ \| ogledalo .*Stan 304 \| RIJEŠENO: postavljeno/)]));
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
        const turnId = out.buttons.flat().find(b => b.data.startsWith('undo:'))!.data.slice(5);
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

    it('razgovor stariji od 3 sata ne ide modelu', async () => {
        mockSent.length = 0;
        mockScript.push({ text: 'ok' });
        const old = new Date(NOW.getTime() - 5 * 3_600_000).toISOString();
        const recent = new Date(NOW.getTime() - 20 * 60_000).toISOString();
        await runAssistant({
            orgId: 'org1', uid: 'u1', text: 'a sad?', now: NOW,
            session: { history: [
                { role: 'user', text: 'staro jutros', at: old }, { role: 'model', text: 'ok', at: old },
                { role: 'user', text: 'malo prije', at: recent }, { role: 'model', text: 'ok', at: recent },
            ], pending: null },
        });
        const texts = mockSent[0].messages.map((m: any) => m.content);
        expect(texts).toEqual(['malo prije', 'ok', 'a sad?']);
    });

    it('kad model padne, korisnik vidi razlog', async () => {
        const out = await say('nešto', []); // prazna skripta → mock baca grešku
        expect(out.degraded).toBe(true);
        expect(out.reply).toMatch(/Razlog: skripta je prazna/);
    });
});

describe('narudžbe preko asistenta', () => {
    const grb = () => (systemText(mockSent[0]).match(/(P\d+) \| Begović/) || [])[1];
    const orderItems = (orderId: string) => docs('order_items').filter(i => i.Order_ID === orderId);
    let firstOrderId = '';
    let firstTurn = '';

    beforeAll(() => {
        session = { history: [], pending: null };
        mockStore.set('products/k', { Product_ID: 'pr-kuh', Organization_ID: 'org1', Project_ID: 'p-grb', Name: 'Kuhinja', Quantity: 1, Status: 'Na čekanju' });
        mockStore.set('products/h', { Product_ID: 'pr-hod', Organization_ID: 'org1', Project_ID: 'p-grb', Name: 'Hodnik', Quantity: 1, Status: 'Na čekanju' });
        mockStore.set('product_materials/a', { ID: 'pm-a', Organization_ID: 'org1', Product_ID: 'pr-kuh', Material_ID: 'mat-b', Material_Name: 'Baglama ravna', Quantity: 15, Unit: 'kom', Unit_Price: 2, Total_Price: 30, Status: 'Nije naručeno', Supplier: 'Häfele', Order_ID: '' });
        mockStore.set('product_materials/b', { ID: 'pm-b', Organization_ID: 'org1', Product_ID: 'pr-hod', Material_ID: 'mat-b', Material_Name: 'Baglama ravna', Quantity: 10, Unit: 'kom', Unit_Price: 2, Total_Price: 20, Status: 'Nije naručeno', Supplier: 'Häfele', Order_ID: '' });
        mockStore.set('materials/b', { Material_ID: 'mat-b', Organization_ID: 'org1', Name: 'Baglama ravna', Unit: 'kom', Default_Supplier: 'Häfele', Default_Unit_Price: 2 });
        mockStore.set('suppliers/h', { Supplier_ID: 'sup-h', Organization_ID: 'org1', Name: 'Häfele', Phone: '033 111 222' });
    });

    it('„naruči 5 baglama za Grbavicu" → nacrt s 5 od 25, ostatak ostaje', async () => {
        mockSent.length = 0;
        mockScript.push({ text: 'ok' });
        await runAssistant({ orgId: 'org1', uid: 'u1', text: 'x', session, now: NOW });
        const P = grb();
        mockSent.length = 0;

        const out = await say('Naruči 5 baglama za Grbavicu', [
            { calls: [{ name: 'find_material', args: { query: 'baglama', project: P } }] },
            { calls: [{ name: 'create_order', args: { lines: [{ ref: 'O1', quantity: 5 }] } }] },
        ]);
        // find_material je vratio stanje modelu: 25 potrebno, sve za naručiti.
        expect(lastToolResult(mockSent[1]).project_materials[0]).toMatch(/treba 25 .*OSTALO ZA NARUČITI 25 \| dobavljač: Häfele \| pozicije: Kuhinja, Hodnik/);
        expect(mockSent).toHaveLength(2); // potvrdu složio sistem

        const order = docs('orders').find(o => o.Status === 'Nacrt')!;
        expect(order).toMatchObject({ Supplier_ID: 'sup-h', Supplier_Name: 'Häfele', Name: 'Begović · Zgrada Grbavica · Grbavica', Total_Amount: 10 });
        const [item] = orderItems(order.Order_ID);
        expect(item).toMatchObject({ Quantity: 5, Unit: 'kom', Status: 'Na čekanju', Project_ID: 'p-grb', Expected_Price: 10 });
        expect(Object.values(item.Product_Material_Quantities).reduce((s: number, n: any) => s + n, 0)).toBe(5);
        expect(out.reply).toMatch(/🧾 Narudžba N2026-10\/\w+ · Häfele \(nacrt\)\n• 5 kom Baglama ravna — .* \(ostaje još 20 kom\)/);
        expect(out.documents).toEqual([{ orderId: order.Order_ID, draft: true }]);
        // Materijali se pri nacrtu ne diraju (kao u ERP-u).
        expect(docs('product_materials').every(m => !m.Ordered_Quantity)).toBe(true);
        firstOrderId = order.Order_ID;
        firstTurn = out.buttons[0][0].data.slice(5);
    });

    it('nacrt se računa; višak ide u sastavnicu i trošak: 30 → 20 + 10 na kuhinju', async () => {
        const P = grb();
        const out = await say('Naruči još 30 baglama za Grbavicu', [
            { calls: [{ name: 'find_material', args: { query: 'baglama', project: P } }] },
            { calls: [{ name: 'create_order', args: { lines: [{ ref: 'O1', quantity: 30 }] } }] },
        ]);
        expect(lastToolResult(mockSent.at(-1)).project_materials[0]).toMatch(/u nacrtu 5 \| OSTALO ZA NARUČITI 20/);
        const order = docs('orders').find(o => o.Status === 'Nacrt' && o.Order_ID !== firstOrderId)!;
        const [item] = orderItems(order.Order_ID);
        expect(item.Quantity).toBe(30);
        // Cijela količina je na materijalima projekta — ništa „za zalihu".
        expect(Object.values(item.Product_Material_Quantities).reduce((s: number, n: any) => s + n, 0)).toBe(30);
        expect(order.Notes).not.toMatch(/zalih/);
        expect(out.reply).toMatch(/20 po sastavnici \+ 10 dodano u sastavnicu \(Kuhinja\) — ulazi u trošak/);
        // Sastavnica (→ profit): kuhinja 15 → 25 kom, trošak 30 → 50.
        expect(docs('product_materials').find(m => m.ID === 'pm-a')).toMatchObject({ Quantity: 25, Total_Price: 50 });
        expect(docs('products').find(p => p.Product_ID === 'pr-kuh')!.Material_Cost).toBe(50);
    });

    it('„Poslano" pomjera materijale i status; ostatak ostaje za naručivanje', async () => {
        const result = await sendOrder('org1', firstOrderId);
        expect(result).toEqual({ ok: true, orderNumber: expect.stringMatching(/^N2026-10\//), materials: 2 });
        const mats = docs('product_materials').filter(m => m.Product_ID === 'pr-kuh' || m.Product_ID === 'pr-hod');
        expect(mats.reduce((s, m) => s + (m.Ordered_Quantity || 0), 0)).toBe(5);
        expect(mats.every(m => m.Status === 'Naručeno' && m.Order_ID === firstOrderId)).toBe(true);
        expect(docs('products').find(p => p.Product_ID === 'pr-kuh')!.Status).toBe('Materijali naručeni');
        expect(docs('projects').find(p => p.Project_ID === 'p-grb')!.Status).toBe('U toku'); // samo „Odobreno" ide u proizvodnju

        const rows = await loadProjectMaterials('org1', ['p-grb']);
        expect(rows.reduce((s, r) => s + r.ordered, 0)).toBe(5);
        expect(rows.reduce((s, r) => s + r.available, 0)).toBe(0); // 20 je još u drugom nacrtu
        expect(await sendOrder('org1', firstOrderId)).toEqual({ ok: false, error: expect.stringMatching(/već „Poslano"/) });
    });

    it('poslana narudžba se ne briše na ↩️ Poništi', async () => {
        const labels = await undoTurn(firstTurn, 'u1');
        expect(labels).toEqual([expect.stringMatching(/^ništa — narudžba N2026-10\/\w+ je već poslana/)]);
        expect(docs('orders').some(o => o.Order_ID === firstOrderId)).toBe(true);
        expect(orderItems(firstOrderId)).toHaveLength(1);
    });

    it('katalog bez projekta traži količinu i ide za zalihu', async () => {
        const out = await say('Naruči 12 baglama za zalihu', [
            { calls: [{ name: 'find_material', args: { query: 'baglama' } }] },
            { calls: [{ name: 'create_order', args: { lines: [{ ref: 'K1', quantity: 12 }] } }] },
        ]);
        expect(out.reply).toMatch(/• 12 kom Baglama ravna — za zalihu/);
        const order = docs('orders').find(o => o.Name === 'Zaliha')!;
        expect(orderItems(order.Order_ID)[0]).toMatchObject({ Quantity: 12, Product_Material_ID: '', Project_ID: '' });
        expect(orderItems(order.Order_ID)[0].Product_Material_Quantities).toBeUndefined();
    });

    it('narudžba nazivom: jedan poziv modela, bez find_material', async () => {
        const P = grb();
        mockSent.length = 0;
        const out = await say('Naruči 4 baglame za Grbavicu', [
            { calls: [{ name: 'create_order', args: { lines: [{ material: 'baglama', project: P, quantity: 4 }] } }] },
        ]);
        expect(mockSent).toHaveLength(1);
        // Sve što projekat treba je već naručeno ili u nacrtu → 4 povećava potrebu kuhinje.
        expect(out.reply).toMatch(/• 4 kom Baglama ravna — .*\(0 po sastavnici \+ 4 dodano u sastavnicu \(Kuhinja\)/);
        expect(docs('product_materials').find(m => m.ID === 'pm-a')!.Quantity).toBe(29);

        // ↩️ Poništi vraća i narudžbu i sastavnicu (trošak).
        const orders = docs('orders').length;
        const labels = await undoTurn(out.buttons[0][0].data.slice(5), 'u1');
        expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/^sastavnica „Kuhinja"/), expect.stringMatching(/^narudžba /)]));
        expect(docs('product_materials').find(m => m.ID === 'pm-a')).toMatchObject({ Quantity: 25, Total_Price: 50 });
        expect(docs('products').find(p => p.Product_ID === 'pr-kuh')!.Material_Cost).toBe(50);
        expect(docs('orders').length).toBe(orders - 1);
    });

    it('materijal kojeg nema u sastavnici → pita kojem proizvodu, pa ga doda s količinom', async () => {
        const P = grb();
        mockSent.length = 0;
        const out = await say('Naruči 3 ogledala za Grbavicu', [
            { calls: [{ name: 'create_order', args: { lines: [{ material: 'ogledalo', project: P, quantity: 3 }] } }] },
            { calls: [{ name: 'create_order', args: { lines: [{ material: 'ogledalo', project: P, product: 'Hodnik', quantity: 3 }] } }] },
        ]);
        const asked = JSON.parse(mockSent[1].messages.at(-1).content[0].content).error as string;
        expect(asked).toMatch(/Kojem proizvodu/);
        expect(asked).toMatch(/Kuhinja/);
        expect(asked).toMatch(/Hodnik/);

        const added = docs('product_materials').find(m => m.Material_Name === 'ogledalo')!;
        expect(added).toMatchObject({ Product_ID: 'pr-hod', Quantity: 3, Unit: 'kom', Status: 'Nije naručeno', Unit_Price: 0 });
        const order = docs('orders').filter(o => o.Status === 'Nacrt').find(o => orderItems(o.Order_ID).some(i => i.Material_Name === 'ogledalo'))!;
        expect(orderItems(order.Order_ID)[0]).toMatchObject({ Product_Material_ID: added.ID, Product_Material_Quantities: { [added.ID]: 3 }, Project_ID: 'p-grb' });
        expect(out.reply).toMatch(/• 3 kom ogledalo — .*\(novo u sastavnici: Hodnik, cijena nepoznata/);
    });

    it('novi materijal iz kataloga nosi cijenu u trošak proizvoda', async () => {
        mockStore.set('materials/v', { Material_ID: 'mat-v', Organization_ID: 'org1', Name: 'Vijak 4x40', Unit: 'kom', Default_Supplier: 'Häfele', Default_Unit_Price: 0.1 });
        const P = grb();
        await say('Naruči 100 vijaka 4x40 za kuhinju na Grbavici', [
            { calls: [{ name: 'create_order', args: { lines: [{ material: 'vijak 4x40', project: P, product: 'Kuhinja', quantity: 100 }] } }] },
        ]);
        const vijak = docs('product_materials').find(m => m.Material_ID === 'mat-v')!;
        expect(vijak).toMatchObject({ Product_ID: 'pr-kuh', Quantity: 100, Unit_Price: 0.1, Total_Price: 10, Supplier: 'Häfele' });
        const kuhinja = docs('product_materials').filter(m => m.Product_ID === 'pr-kuh');
        expect(docs('products').find(p => p.Product_ID === 'pr-kuh')!.Material_Cost).toBe(kuhinja.reduce((s, m) => s + m.Total_Price, 0));
    });

    it('„koje materijale ima kuhinja" → product_materials čita sastavnicu', async () => {
        const P = grb();
        mockSent.length = 0;
        await say('Koje materijale ima kuhinja na Grbavici?', [
            { calls: [{ name: 'product_materials', args: { project: P, product: 'kuhinja' } }] },
            { text: 'Kuhinja ima baglame i vijke.' },
        ]);
        const result = lastToolResult(mockSent[1]);
        expect(result.products).toHaveLength(1);
        expect(result.products[0]).toMatch(/^Kuhinja ×1 \| materijal 60 ukupno/);
        expect(result.products[0]).toMatch(/• Baglama ravna \| 25 kom \| cijena 2 \| Naručeno \| naručeno \d+, primljeno 0, za naručiti \d+ \| Häfele/);
        expect(result.products[0]).toMatch(/• Vijak 4x40 \| 100 kom \| cijena 0\.1 \| Nije naručeno/);
    });

    it('naziv koji pokriva dva materijala → kandidati, model bira', async () => {
        mockStore.set('product_materials/c', { ID: 'pm-c', Organization_ID: 'org1', Product_ID: 'pr-hod', Material_ID: 'mat-k', Material_Name: 'Baglama kutna', Quantity: 6, Unit: 'kom', Unit_Price: 3, Total_Price: 18, Status: 'Nije naručeno', Supplier: 'Häfele', Order_ID: '' });
        const P = grb();
        const before = docs('orders').length;
        mockSent.length = 0;
        await say('Naruči 2 baglame za Grbavicu', [
            { calls: [{ name: 'create_order', args: { lines: [{ material: 'baglama', project: P, quantity: 2 }] } }] },
            { calls: [{ name: 'create_order', args: { lines: [{ ref: 'O1', quantity: 2 }] } }] },
        ]);
        const candidates = JSON.parse(mockSent[1].messages.at(-1).content[0].content).error as string;
        expect(candidates).toMatch(/nije jednoznačno/);
        expect(candidates).toMatch(/Baglama kutna/);
        expect(candidates).toMatch(/Baglama ravna/);
        expect(docs('orders').length).toBe(before + 1);
    });

    it('„naruči sve što fali za Grbavicu kod Bluma" → jedna narudžba, bez nabrajanja; interno se ne naručuje', async () => {
        mockStore.set('product_materials/v5', { ID: 'pm-v5', Organization_ID: 'org1', Product_ID: 'pr-hod', Material_ID: 'mat-v5', Material_Name: 'Vodilice Blum 500', Quantity: 4, Unit: 'kom', Unit_Price: 30, Total_Price: 120, Status: 'Nije naručeno', Supplier: 'Blum', Order_ID: '' });
        mockStore.set('product_materials/lk', { ID: 'pm-lk', Organization_ID: 'org1', Product_ID: 'pr-hod', Material_ID: 'mat-lk', Material_Name: 'Lakiranje', Quantity: 10, Unit: 'm2', Unit_Price: 15, Total_Price: 150, Status: 'Nije naručeno', Supplier: 'Interni', Order_ID: '' });
        const P = grb();
        mockSent.length = 0;
        const out = await say('Naruči sve što fali za Grbavicu kod Bluma', [
            { calls: [{ name: 'create_order', args: { all_missing: true, project: P, supplier: 'Blum' } }] },
        ]);
        expect(mockSent).toHaveLength(1);
        expect(out.reply).toMatch(/Narudžba .* · Blum \(nacrt\)\n• 4 kom Vodilice Blum 500/);
        expect(out.reply).not.toMatch(/Baglama|Lakiranje/);

        const again = await say('Naruči sve što fali za Grbavicu kod Bluma', [
            { calls: [{ name: 'create_order', args: { all_missing: true, project: P, supplier: 'Blum' } }] },
            { text: 'Sve je već naručeno.' },
        ]);
        expect(again.reply).toBe('Sve je već naručeno.');
        expect(lastToolResult(mockSent.at(-1)).note).toMatch(/ništa ne fali/);

        const all = await say('Naruči sve što fali za Grbavicu', [
            { calls: [{ name: 'create_order', args: { all_missing: true, project: P } }] },
        ]);
        expect(all.reply).not.toMatch(/Lakiranje/);
    });

    it('pitanje pa odgovor u novoj poruci: oznaka iz pitanja i dalje važi', async () => {
        const P = grb();
        await say('Naruči baglame za Grbavicu', [
            { calls: [{ name: 'create_order', args: { lines: [{ material: 'baglama', project: P }] } }] },
            { calls: [{ name: 'ask_user', args: { question: 'Koje baglame?', options: ['Ravne', 'Kutne'] } }] },
        ]);
        // Model u istoriji vidi legendu; korisnik nikad ne vidi oznake.
        const legend = session.history.at(-1)!.text;
        expect(legend).toMatch(/\[oznake: .*Baglama kutna · Begović/);
        const kutna = legend.match(/(O\d+) Baglama kutna/)![1];
        expect(session.refs?.orderGroups?.length).toBeGreaterThan(0);

        mockSent.length = 0;
        const before = docs('orders').length;
        const out = await say('Kutne, jednu', [
            { calls: [{ name: 'create_order', args: { lines: [{ ref: kutna, quantity: 1 }] } }] },
        ]);
        expect(mockSent[0].messages.some((m: any) => typeof m.content === 'string' && m.content.includes(`${kutna} Baglama kutna`))).toBe(true);
        expect(docs('orders').length).toBe(before + 1);
        expect(out.reply).toMatch(/• 1 kom Baglama kutna/);
        expect(session.refs).toBeNull(); // upis je završio tok — oznake se ne nose dalje
    });

    it('„koje narudžbe imam za Grbavicu" → list_orders vidi i nacrte', async () => {
        const P = grb();
        mockSent.length = 0;
        const out = await say('Koje narudžbe imam za Grbavicu?', [
            { calls: [{ name: 'list_orders', args: { project: P } }] },
            { text: 'Imaš nacrte i jednu poslanu.' },
        ]);
        const result = lastToolResult(mockSent[1]);
        expect(result.ok).toBe(true);
        expect(result.orders.some((l: string) => /\| Häfele \| Nacrt \| .*stavke: 30 kom Baglama ravna/.test(l))).toBe(true);
        expect(result.orders.some((l: string) => /\| Poslano \|.*5 kom Baglama ravna/.test(l))).toBe(true);
        // Narudžba „Zaliha" nema stavki za ovaj projekat.
        expect(result.orders.some((l: string) => /Zaliha/.test(l))).toBe(false);

        const open = await runTool({ ...envFor(), ctx: { projects: [] } } as any, 'list_orders', { status: 'otvorene' });
        expect((open.orders as string[]).every(l => /\| (Nacrt|Poslano) \|/.test(l))).toBe(true);
        expect(out.reply).toBe('Imaš nacrte i jednu poslanu.');
    });

    it('PDF narudžbe: pravi PDF s našim slovima', async () => {
        const order = await getOrderWithItems('org1', firstOrderId);
        const pdf = buildOrderPdf({
            order: { ...order!, Notes: 'Isporuka u četvrtak, ćošak — đak' },
            supplier: { Phone: '033 111 222' } as any,
            specs: [],
            company: { name: 'Lux-co d.o.o.', address: 'Sarajevo' },
        });
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.length).toBeGreaterThan(10_000); // ugrađen font
    });

    it('oznake se brišu, ali broj narudžbe ostaje', () => {
        expect(stripAliases('Narudžba N2026-10/T7 je spremna (O1)')).toBe('Narudžba N2026-10/T7 je spremna');
        expect(stripAliases('Imer W9 i M8 vijci')).toBe('Imer i M8 vijci');
    });
});

describe('failureReason', () => {
    const apiError = (status: number, message: string) => Object.assign(Object.create(Anthropic.APIError.prototype), { status, message });

    it('prevodi česte greške Anthropica', () => {
        expect(failureReason(apiError(401, 'invalid x-api-key'))).toMatch(/ključ nije ispravan/);
        expect(failureReason(apiError(400, 'Your credit balance is too low to access the Anthropic API.'))).toMatch(/nema kredita/);
        expect(failureReason(apiError(400, 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header'))).toMatch(/ANTHROPIC_WORKSPACE_ID/);
        expect(failureReason(apiError(404, 'model not found'))).toMatch(/claude-haiku-5-5 nije dostupan/);
        expect(failureReason(apiError(529, 'Overloaded'))).toMatch(/preopterećen/);
        expect(failureReason(apiError(400, 'tools.0: bad schema'))).toBe('400: tools.0: bad schema');
    });
});

describe('nema odgovora bez čitanja (30.10.)', () => {
    it('„nemam zapisan dekor" bez čitanja → ERP traži krug samo s alatima za čitanje, odgovor ide iz alata', async () => {
        session = { history: [], pending: null };
        mockSent.length = 0;
        const out = await say('Koji iveral smo koristili (koji dekor)', [
            { text: 'Nemam zapisan dekor iverala za taj projekat.' },
            { calls: [{ name: 'list_orders', args: {} }] },
            { text: 'Korišten je iveral U702.' },
        ]);
        expect(mockSent).toHaveLength(3);
        expect(mockSent[1].tool_choice).toEqual({ type: 'any' });
        const readOnly = mockSent[1].tools.map((t: any) => t.name);
        expect(readOnly).toContain('product_materials');
        expect(readOnly).not.toContain('create_order');
        expect(mockSent[1].messages.at(-1).content).toContain('nisi ništa pročitao');
        expect(out.reply).toBe('Korišten je iveral U702.');
    });

    it('pitanje o zadacima iz prompta se ne tjera na čitanje', async () => {
        session = { history: [], pending: null };
        mockSent.length = 0;
        await say('Šta imam sutra?', [{ text: 'Sutra nemaš zadataka.' }]);
        expect(mockSent).toHaveLength(1);
    });
});
