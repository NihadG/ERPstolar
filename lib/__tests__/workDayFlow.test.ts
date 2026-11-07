/**
 * @jest-environment node
 */
// Upis dana preko bota (revizija 04.11.2026, izmišljena imena):
//   • radnik ide na nalog iz SVOG dijela rečenice; isto ime dvojice → pitanje
//   • nema naloga → ERP nudi da ga napravi (od proizvoda projekta ili s tim poslom)
//   • ispravka dana: „X ne treba", „Y nije dobro dodijeljen" zamjenjuje, ne dodaje
//   • prisustvo u poruci s radom ne knjiži naloge po šihtarici
//   • ko nije spomenut, a nema prisustvo → dugmad

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';
import { ordersForWorker, sharedFirstNames } from '@/lib/assistant/grounding';
import { parsePresenceButton, presenceQuestion } from '@/lib/assistant/presenceAsk';
import { workersWithoutPresence } from '@/lib/server/presence';

const DAY = '2026-10-27';   // utorak
let turn = 0;
const WORKERS = [
    { alias: 'W1', value: { id: 'amer', name: 'Amer Hodžić' } },
    { alias: 'W2', value: { id: 'edin', name: 'Edin Begić' } },
    { alias: 'W3', value: { id: 'haso', name: 'Haso Mujić' } },
    { alias: 'W4', value: { id: 'senadm', name: 'Senad Mehić' } },
    { alias: 'W5', value: { id: 'senadi', name: 'Senad Ibrić' } },
];
function env(groundText?: string): ToolEnv {
    return {
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date(`${DAY}T16:00:00Z`),
        turnId: `t${++turn}`, dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ...(groundText !== undefined ? { groundText, messageText: groundText } : {}),
        ctx: {
            projects: [{ alias: 'P1', value: { id: 'pk', client: 'Kovač', name: 'Hamza Kovač - Kuća' } }, { alias: 'P2', value: { id: 'pl', client: 'Lejla', name: 'Lejlin stan' } }],
            suppliers: [], memory: [], tasks: [], names: [], workers: WORKERS,
            orders: [{ alias: 'R1', value: { id: 'rk', name: 'Kovač - Kuhinja' } }, { alias: 'R2', value: { id: 'rl', name: 'Lejla - Ormar' } }],
        },
    } as unknown as ToolEnv;
}
const logsOf = (w: string) => docs('work_logs').filter(l => l.Worker_ID === w && l.Date === DAY);
const att = (w: string) => docs('worker_attendance').filter(a => a.Worker_ID === w && a.Date === DAY);

beforeAll(() => {
    for (const w of WORKERS) store.set(`workers/${w.value.id}`, { Worker_ID: w.value.id, Organization_ID: 'org1', Name: w.value.name, Daily_Rate: 100, Status: 'Aktivan' });
    store.set('projects/pk', { Project_ID: 'pk', Organization_ID: 'org1', Name: 'Hamza Kovač - Kuća', Client_Name: 'Kovač' });
    store.set('projects/pl', { Project_ID: 'pl', Organization_ID: 'org1', Name: 'Lejlin stan', Client_Name: 'Lejla' });
    store.set('products/v1', { Product_ID: 'v1', Organization_ID: 'org1', Project_ID: 'pk', Name: 'Vrata ulazna', Quantity: 1 });
    store.set('products/v2', { Product_ID: 'v2', Organization_ID: 'org1', Project_ID: 'pk', Name: 'Vrata sobna', Quantity: 3 });
    store.set('products/k1', { Product_ID: 'k1', Organization_ID: 'org1', Project_ID: 'pk', Name: 'Kuhinja', Quantity: 1 });
    store.set('work_orders/rk', { Work_Order_ID: 'rk', Organization_ID: 'org1', Name: 'Kovač - Kuhinja', Status: 'U toku', Work_Order_Type: 'Proizvodnja' });
    store.set('work_orders/rl', { Work_Order_ID: 'rl', Organization_ID: 'org1', Name: 'Lejla - Ormar', Status: 'U toku', Work_Order_Type: 'Proizvodnja' });
    store.set('work_order_items/ik', { ID: 'ik', Organization_ID: 'org1', Work_Order_ID: 'rk', Product_ID: 'k1', Product_Name: 'Kuhinja', Project_ID: 'pk', Status: 'U toku' });
    store.set('work_order_items/il', { ID: 'il', Organization_ID: 'org1', Work_Order_ID: 'rl', Product_ID: 'o1', Product_Name: 'Ormar', Project_ID: 'pl', Status: 'U toku' });
});

describe('ko je radio na čemu — dio rečenice radnika', () => {
    const workers = WORKERS.map(w => ({ id: w.value.id, name: w.value.name }));
    const orders = [{ id: 'rk', name: 'Kovač - Kuhinja', aliases: ['Hamza'] }, { id: 'rl', name: 'Lejla - Ormar' }, { id: 'rv', name: 'Kovač - Vrata', aliases: ['Hamza'] }];
    const said = 'Amer i Edin su utovarali kamion za Hamzu, stavi ih na sve naloge od Hamze osim za vrata. Haso je radio na Lejli i na vratima za Hamzu.';

    it('svaki radnik dobija naloge iz svog dijela; „osim za vrata" isključuje, „vratima" sužava', () => {
        expect(ordersForWorker(said, workers[0], workers, orders)).toEqual(['rk']);
        expect(ordersForWorker(said, workers[2], workers, orders)).toEqual(['rl', 'rv']);
    });

    it('upis Hase na Hamzinu kuhinju se odbija — on je rečen uz Lejlu i vrata', async () => {
        // Ne na Hamzinu kuhinju — ERP ga upiše po njegovom dijelu rečenice (Lejla), uz razlog.
        const e = env(said);
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W3'], orders: ['R1'] }] });
        // Njegov dio („na Lejli i na vratima za Hamzu") traži vrata, a nalog za vrata ne postoji → ERP nudi da ga napravi.
        expect(res).toMatchObject({ ok: true, asked: expect.stringMatching(/^Haso: za „.*vratima.*" nema naloga\. Da ga napravim\?/) });
        expect(e.summaries[0]).toMatch(/⚠️ Nije upisano: Haso Mujić je u poruci rečen uz „Lejla - Ormar", ne uz „Kovač - Kuhinja"/);
        expect(logsOf('haso')).toHaveLength(0);
        await undoTurn(e.turnId, 'u1');
    });

    it('„Senad" bez prezimena, a ima ih dvojica → pitanje, ne izbor', async () => {
        expect(sharedFirstNames('Senad je radio na Lejli', ['senadm', 'senadi'], workers)).toEqual([{ token: 'senad', ids: ['senadm', 'senadi'] }]);
        expect(sharedFirstNames('Senad Ibrić je radio na Lejli', ['senadi'], workers)).toEqual([]);
        // Ostalo iz poruke se upiše, za Senada ERP pita dugmadima; izbor upiše taj red.
        const e = env('Amer je radio kuhinju za Hamzu, a Senad na Lejli');
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1'], orders: ['R1'] }, { workers: ['W4', 'W5'], orders: ['R2'] }] });
        expect(res).toMatchObject({ ok: true, asked: '„Senad" — koji?' });
        expect(logsOf('amer').length).toBeGreaterThan(0);
        expect(logsOf('senadm').length + logsOf('senadi').length).toBe(0);
        const options = e.erpQuestion!.options;
        expect(options.map(o => o.label)).toEqual(['Senad Mehić', 'Senad Ibrić', 'Preskoči']);
        const pick = env('Amer je radio kuhinju za Hamzu, a Senad na Lejli');
        expect(await runTool(pick, 'log_work', options[1].args)).toMatchObject({ ok: true });
        expect(logsOf('senadi').every(l => l.Work_Order_ID === 'rl')).toBe(true);
        expect(logsOf('senadm')).toHaveLength(0);
        await undoTurn(pick.turnId, 'u1');
        await undoTurn(e.turnId, 'u1');
    });
});

describe('nema naloga → ERP nudi da ga napravi', () => {
    it('posao bez naloga: dugmad „nalog od proizvoda projekta", „nalog s tim poslom", „preskoči"', async () => {
        const e = env('Edin je radio vrata za Hamzu');
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W2'], work: 'vrata Hamza' }] });
        expect(res).toMatchObject({ ok: true, asked: 'Edin: za „vrata Hamza" nema naloga. Da ga napravim? (Kovač · Hamza Kovač - Kuća: Vrata ulazna, Vrata sobna) Drugi naziv — napiši ga.' });
        expect(e.erpQuestion!.options.map(o => o.label)).toEqual(['➕ Nalog: Vrata (2 proizvoda)', '➕ Nalog „Vrata Hamza"', 'Preskoči']);
        expect(logsOf('edin')).toHaveLength(0);
    });

    it('izbor (ili „napravi nalog") pravi nalog s tim proizvodima i upisuje rad na njega; Poništi briše i nalog', async () => {
        const e = env('Edin je radio vrata za Hamzu, napravi nalog');
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W2'], work: 'vrata Hamza', new_order: { name: 'Vrata — Hamza Kovač', project: 'P1', products: ['vrata'] } }] });
        expect(res.ok).toBe(true);
        const order = docs('work_orders').find(w => w.Name === 'Vrata — Hamza Kovač')!;
        expect(order).toMatchObject({ Work_Order_Type: 'Proizvodnja', Status: expect.any(String) });
        expect(docs('work_order_items').filter(i => i.Work_Order_ID === order.Work_Order_ID).map(i => i.Product_Name).sort()).toEqual(['Vrata sobna', 'Vrata ulazna']);
        expect(logsOf('edin').every(l => l.Work_Order_ID === order.Work_Order_ID)).toBe(true);
        expect(logsOf('edin').length).toBeGreaterThan(0);
        expect(e.summaries[0]).toMatch(/^🆕 Nalog .* „Vrata — Hamza Kovač" · .* — 2 proizvoda: Vrata ulazna, Vrata sobna/);
        await undoTurn(e.turnId, 'u1');
        expect(docs('work_orders').find(w => w.Name === 'Vrata — Hamza Kovač')).toBeUndefined();
        expect(logsOf('edin')).toHaveLength(0);
    });

    it('naziv koji korisnik nije rekao se odbija', async () => {
        const res = await runTool(env('Edin je radio vrata za Hamzu, napravi nalog'), 'log_work', { date: DAY, lines: [{ workers: ['W2'], new_order: { name: 'Stolarija kompletna faza 2' } }] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/nije iz poruke korisnika/) });
    });

    // Ponavljanje 04.11.: „stavi ih na sve naloge od Hamze" → model napravio „Utovar kamiona za Hamzu".
    it('nalog se ne pravi dok to korisnik ne kaže (ili ne izabere dugme)', async () => {
        const res = await runTool(env('Amer i Edin su utovarali kamion za Hamzu, stavi ih na sve naloge od Hamze'), 'log_work',
            { date: DAY, lines: [{ workers: ['W1', 'W2'], new_order: { name: 'Utovar kamiona za Hamzu', project: 'P1' } }] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Nalog se ne pravi dok korisnik to ne kaže/) });
        expect(docs('work_orders').find(w => w.Name === 'Utovar kamiona za Hamzu')).toBeUndefined();
    });
});

describe('ispravka dana', () => {
    it('„Senad Ibrić ne treba nikako" briše njegov dan; „Amer nije dobro dodijeljen" zamjenjuje, ne dodaje', async () => {
        const first = env('Amer i Senad Ibrić su radili kuhinju za Hamzu');
        await runTool(first, 'log_work', { date: DAY, lines: [{ workers: ['W1', 'W5'], orders: ['R1'] }] });
        expect(logsOf('senadi').length).toBeGreaterThan(0);
        expect(logsOf('amer').every(l => l.Work_Order_ID === 'rk')).toBe(true);

        const fix = env('Senad Ibrić ne treba nikako, a Amer nije dobro dodijeljen, bio je na Lejli');
        const res = await runTool(fix, 'log_work', { date: DAY, clear: ['W5'], lines: [{ workers: ['W1'], orders: ['R2'], replace: true }] });
        expect(res.ok).toBe(true);
        expect(logsOf('senadi')).toHaveLength(0);
        expect(att('senadi')).toHaveLength(0);
        expect(logsOf('amer').map(l => l.Work_Order_ID)).toEqual(['rl']);
        expect(fix.summaries[0]).toBe('🧹 Uklonjeno iz dana (danas): Senad Ibrić');

        await undoTurn(fix.turnId, 'u1');
        expect(logsOf('senadi').length).toBeGreaterThan(0);
        expect(logsOf('amer').every(l => l.Work_Order_ID === 'rk')).toBe(true);
        await undoTurn(first.turnId, 'u1');
    });
});

describe('prisustvo i ko nije spomenut', () => {
    it('prisustvo u poruci s radom ne knjiži naloge po šihtarici', async () => {
        const e = { ...env('Haso je radio na Lejli'), workInMessage: true } as ToolEnv;
        const res = await runTool(e, 'set_presence', { date: DAY, workers: ['W3'], status: 'Prisutan' });
        expect(res.ok).toBe(true);
        expect(att('haso')[0].Status).toBe('Prisutan');
        expect(logsOf('haso')).toHaveLength(0);
        expect(e.presenceDay).toEqual({ date: DAY, workerIds: ['haso'] });
        await undoTurn(e.turnId, 'u1');
    });

    it('aktivni bez prisustva koje poruka nije spomenula → pitanje s dugmadima po radniku', async () => {
        store.set('worker_attendance/a1', { Attendance_ID: 'a1', Organization_ID: 'org1', Worker_ID: 'amer', Date: DAY, Status: 'Prisutan' });
        const missing = await workersWithoutPresence('org1', DAY, ['edin']);
        expect(missing.map(m => m.name).sort()).toEqual(['Haso Mujić', 'Senad Ibrić', 'Senad Mehić']);
        expect(await workersWithoutPresence('org1', '2026-10-25', [])).toEqual([]);   // nedjelja bez ikakvog rada
        const q = presenceQuestion(missing, DAY, 'uto 27.10.');
        expect(q.text).toMatch(/^👥 Bez prisustva za uto 27\.10\., a nisu spomenuti: Haso Mujić, Senad (Mehić|Ibrić), Senad (Mehić|Ibrić) — šta je s njima\?/);
        expect(q.buttons[0]).toEqual([
            { text: 'Haso: radio', data: `pres:haso:${DAY}:p` }, { text: 'odsutan', data: `pres:haso:${DAY}:o` },
            { text: 'bolovanje', data: `pres:haso:${DAY}:b` }, { text: 'godišnji', data: `pres:haso:${DAY}:g` },
        ]);
        expect(parsePresenceButton(`pres:haso:${DAY}:b`)).toEqual({ workerId: 'haso', date: DAY, status: 'Bolovanje' });
        expect(parsePresenceButton('pres:haso:juce:b')).toBeNull();
        store.delete('worker_attendance/a1');
    });
});

// Ponavljanje 04.11.: jedan pogrešan red je oborio cijeli dan; dopuna bez dana je otišla na danas.
describe('upis dana: pogrešan red ne ruši ostale, dan iz razgovora', () => {
    it('red radnika rečenog uz drugi nalog se preskoči, ostali se upišu', async () => {
        const e = env('Amer je radio kuhinju za Hamzu. Haso je radio na Lejli.');
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1'], orders: ['R1'] }, { workers: ['W3'], orders: ['R1'] }] });
        expect(res).toMatchObject({ ok: true, nije_upisano: [expect.stringMatching(/Haso Mujić je u poruci rečen uz „Lejla - Ormar"/)] });
        expect(logsOf('amer').length).toBeGreaterThan(0);
        // Haso ne ide na kuhinju — ERP ga upiše po njegovom dijelu rečenice, na Lejlin nalog.
        expect(logsOf('haso').map(l => l.Work_Order_ID)).toEqual(['rl']);
        expect(e.summaries.join('\n')).toMatch(/⚠️ Nije upisano: Haso Mujić je u poruci rečen uz „Lejla - Ormar", ne uz „Kovač - Kuhinja"\./);
        await undoTurn(e.turnId, 'u1');
    });

    it('bez rečenog dana: dan iz razgovora ima prednost i pred današnjim datumom koji model pošalje', async () => {
        const e = { ...env('a Haso na Lejli'), talkWorkDay: '2026-10-26' } as ToolEnv;
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W3'], orders: ['R2'] }] });
        expect(res.ok).toBe(true);
        expect(docs('work_logs').filter(l => l.Worker_ID === 'haso').map(l => l.Date)).toEqual(expect.arrayContaining(['2026-10-26']));
        expect(logsOf('haso')).toHaveLength(0);
        await undoTurn(e.turnId, 'u1');
    });
});

// Ponavljanje 04.11. na stvarnom razgovoru (ovdje prepričano): prezime koje dijele dva radnika i
// „osim za vrata" koje model zanemari.
describe('isto ime i „osim za vrata"', () => {
    const all = [{ id: 'sk', name: 'Senad Kalić' }, { id: 'sp', name: 'Senad Pašić' }, { id: 'ap', name: 'Amer Pašić' }];

    it('ime i prezime rečeni zajedno su jasni i kad svaku riječ dijeli neko drugi; razdvojeni nisu', () => {
        expect(sharedFirstNames('senad kalic ne treba nikako, mislio sam na senada pasica', ['sp', 'sk'], all)).toEqual([]);
        expect(sharedFirstNames('Amer Pašić i Senad su radili', ['sp'], all)).toEqual([{ token: 'senad', ids: ['sp', 'sk'] }]);
    });

    it('nalog vrste iz „osim za…" se ne upisuje tom radniku', async () => {
        store.set('work_orders/rv', { Work_Order_ID: 'rv', Organization_ID: 'org1', Name: 'Kovač - Vrata', Status: 'U toku', Work_Order_Type: 'Proizvodnja' });
        store.set('work_order_items/iv', { ID: 'iv', Organization_ID: 'org1', Work_Order_ID: 'rv', Product_ID: 'v1', Product_Name: 'Vrata ulazna', Project_ID: 'pk', Status: 'U toku' });
        const e = env('Amer je utovarao kamion za Hamzu, stavi ga na sve naloge od Hamze osim za vrata');
        e.ctx.orders = [...(e.ctx.orders || []), { alias: 'R3', value: { id: 'rv', name: 'Kovač - Vrata' } }] as any;
        // Ispada nalog za vrata, rad na ostalim rečenim nalozima se upiše.
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1'], orders: ['R1', 'R3'] }] });
        expect(res).toMatchObject({ ok: true, nije_upisano: [expect.stringMatching(/„Kovač - Vrata" nije rečen uz Amer — upisano bez toga/)] });
        expect(logsOf('amer').map(l => l.Work_Order_ID)).toEqual(['rk']);
        await undoTurn(e.turnId, 'u1');
        store.delete('work_orders/rv'); store.delete('work_order_items/iv');
    });
});

describe('pogrešan radnik u grupi', () => {
    it('iz reda ispada samo on; ostali iz grupe se upišu', async () => {
        const e = env('Amer i Edin su radili kuhinju za Hamzu. Haso je radio na Lejli i na vratima.');
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1', 'W2', 'W3'], orders: ['R1'] }] });
        expect(res).toMatchObject({ ok: true, nije_upisano: [expect.stringMatching(/^Upis odbijen: Haso Mujić/)] });
        expect(logsOf('amer').length).toBeGreaterThan(0);
        expect(logsOf('edin').length).toBeGreaterThan(0);
        expect(logsOf('haso')).toHaveLength(0);
        await undoTurn(e.turnId, 'u1');
    });
});

describe('skidanje s dana samo kad je rečeno', () => {
    it('„Senad Ibrić ne treba nikako" — da; radnik koji je samo spomenut — ne', async () => {
        const { removalSaid } = await import('@/lib/assistant/grounding');
        const senad = { id: 'senadi', name: 'Senad Ibrić' };
        const haso = { id: 'haso', name: 'Haso Mujić' };
        const said = 'haso nije dobro dodijeljen, onda senad ibric ne treba nikako, i izbaci amera';
        expect(removalSaid(said, senad)).toBe(true);
        expect(removalSaid(said, { id: 'amer', name: 'Amer Hodžić' })).toBe(true);
        expect(removalSaid(said, haso)).toBe(false);
        const res = await runTool(env(said), 'log_work', { date: DAY, clear: ['W3'] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Nije rečeno da Haso Mujić ne treba/) });
    });
});

// Revizija 04.11. večer (izmišljena imena): „Senad uzglavlja za Lejlu" — model ga stavio na tuđi
// nalog, red je ispao; „Amer i Edin bili na terenu (novi nalog, nazovi ga korekcije na Brdu)" —
// novi nalog je dobio Senad, a teren je knjižen na naloge od zadnjeg dana.
describe('teren i novi nalog iz iste poruke', () => {
    const { nameOwners } = require('@/lib/assistant/grounding');

    it('ispali radnik se upiše po svom dijelu rečenice — i na završen nalog', async () => {
        store.set('work_orders/ru', { Work_Order_ID: 'ru', Organization_ID: 'org1', Name: 'Lejla - Uzglavlja', Status: 'Završeno', Work_Order_Type: 'Proizvodnja' });
        store.set('work_order_items/iu', { ID: 'iu', Organization_ID: 'org1', Work_Order_ID: 'ru', Product_ID: 'u1', Product_Name: 'Uzglavlje kreveta', Project_ID: 'pl', Status: 'Završeno' });
        const e = env('Amer je radio kuhinju za Hamzu, Senad Mehić uzglavlja za Lejlu');
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1', 'W4'], orders: ['R1'] }] });
        expect(res.ok).toBe(true);
        expect(logsOf('amer').map(l => l.Work_Order_ID)).toEqual(['rk']);
        expect(logsOf('senadm').map(l => l.Work_Order_ID)).toEqual(['ru']);
        await undoTurn(e.turnId, 'u1');
        store.delete('work_orders/ru'); store.delete('work_order_items/iu');
    });

    it('novi nalog ide radnicima uz koje je naziv rečen', async () => {
        const said = 'Senad Mehić je radio na Lejli, a Amer i Edin su bili na terenu (možeš staviti novi razni poslovi nalog, nazovi ga korekcije na Brdu)';
        const workers = WORKERS.map(w => ({ id: w.value.id, name: w.value.name }));
        expect(nameOwners(said, 'korekcije na Brdu', workers)?.sort()).toEqual(['amer', 'edin']);
        const res = await runTool(env(said), 'log_work', { date: DAY, lines: [{ workers: ['W4'], new_order: { name: 'korekcije na Brdu' } }] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/je rečen uz (Amer Hodžić, Edin Begić|Edin Begić, Amer Hodžić), ne uz Senad Mehić/) });
        expect(docs('work_orders').find(w => w.Name === 'korekcije na Brdu')).toBeUndefined();
    });

    it('prisustvo ne pogađa naloge kad poruka govori o radu ili nalogu', async () => {
        const e = env('Amer i Edin su bili na terenu, staviti novi nalog');
        await runTool(e, 'set_presence', { date: DAY, workers: ['W1', 'W2'], status: 'Teren' });
        expect(att('amer')[0].Status).toBe('Teren');
        expect(logsOf('amer')).toHaveLength(0);
        await undoTurn(e.turnId, 'u1');
    });
});

describe('dio rečenice i puno ime (04.11. večer)', () => {
    const workers = WORKERS.map(w => ({ id: w.value.id, name: w.value.name }));
    const orders = [{ id: 'rkor', name: 'korekcije na Brdu' }];

    it('dio radnika završava kad počne sljedeći radnik poslije njegovog posla', async () => {
        const { workerSegment } = await import('@/lib/assistant/grounding');
        const said = 'Haso je radio uzglavlja za Lejlu, a Amer i Edin su bili na terenu, nazovi ga korekcije na Brdu';
        expect(workerSegment(said, workers[2], workers, orders)).toBe('haso radio uzglavlja lejlu');
        expect(workerSegment(said, workers[0], workers, orders)).toMatch(/^amer edin bili terenu .*korekcije brdu$/);
    });

    it('drugi istog imena rečen punim imenom → golo ime je on, ovaj ispada', async () => {
        const { shadowedNames } = await import('@/lib/assistant/grounding');
        expect(shadowedNames('senad je radio, mislio sam na senada ibrica', ['senadm', 'senadi'], workers)).toEqual(['senadm']);
        expect(shadowedNames('senad je radio na Lejli', ['senadm', 'senadi'], workers)).toEqual([]);
        const e = env('Senad Ibrić i Amer su radili na Lejli');
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1', 'W4', 'W5'], orders: ['R2'] }] });
        expect(res).toMatchObject({ ok: true, nije_upisano: [expect.stringMatching(/Senad Mehić nije rečen/)] });
        expect(logsOf('senadi').length).toBeGreaterThan(0);
        expect(logsOf('senadm')).toHaveLength(0);
        await undoTurn(e.turnId, 'u1');
    });
});
