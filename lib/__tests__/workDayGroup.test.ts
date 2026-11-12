/**
 * @jest-environment node
 */
// Revizija 11.11.2026 (P-068, P-069, P-070), izmišljena imena:
//   „Amer je jučer i danas sa Edinom radio na novom proizvodu, to su noćni ormarići za Hamzu"
//     → oba radnika, pravi nalog s proizvodima projekta (ERP je vezao nalog samo za zadnje ime)
//   „Ovi ostali danas rade kao i jučer" → nespomenuti po zadnjem danu (ERP ih je odbijao)
//   rečen proizvod bez naloga → nalog za te proizvode, ne susjedni nalog istog projekta

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';
import { nameOwners, othersLikeLast, workerGroup } from '@/lib/assistant/grounding';
import { messageIntent } from '@/lib/assistant/intent';

const DAY = '2026-10-27';   // utorak
const YDAY = '2026-10-26';
let turn = 0;
const WORKERS = [
    { alias: 'W1', value: { id: 'amer', name: 'Amer Hodžić' } },
    { alias: 'W2', value: { id: 'edin', name: 'Edin Begić' } },
    { alias: 'W3', value: { id: 'haso', name: 'Haso Mujić' } },
    { alias: 'W4', value: { id: 'senadm', name: 'Senad Mehić' } },
    { alias: 'W5', value: { id: 'senadi', name: 'Senad Ibrić' } },
];
const workers = WORKERS.map(w => ({ id: w.value.id, name: w.value.name }));
function env(groundText?: string): ToolEnv {
    return {
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date(`${DAY}T16:00:00Z`),
        turnId: `g${++turn}`, dateText: '', reporter: 'ja', searchHits: [],
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
const log = (id: string, worker: string, date: string, wo: string, item: string, product: string) =>
    store.set(`work_logs/${id}`, {
        WorkLog_ID: id, Organization_ID: 'org1', Date: date, Worker_ID: worker, Worker_Name: worker, Daily_Rate: 100,
        Original_Daily_Rate: 100, Day_Fraction: 1, Presence: 1, Split_Factor: 1, Hours_Worked: 8, Booking_Source: 'manual', Entry_Source: 'telegram',
        Is_From_Attendance: false, Work_Order_ID: wo, Work_Order_Item_ID: item, Product_ID: product,
    });

beforeAll(() => {
    for (const w of WORKERS) store.set(`workers/${w.value.id}`, { Worker_ID: w.value.id, Organization_ID: 'org1', Name: w.value.name, Daily_Rate: 100, Status: 'Aktivan' });
    store.set('projects/pk', { Project_ID: 'pk', Organization_ID: 'org1', Name: 'Hamza Kovač - Kuća', Client_Name: 'Kovač' });
    store.set('projects/pl', { Project_ID: 'pl', Organization_ID: 'org1', Name: 'Lejlin stan', Client_Name: 'Lejla' });
    store.set('products/k1', { Product_ID: 'k1', Organization_ID: 'org1', Project_ID: 'pk', Name: 'Kuhinja', Quantity: 1 });
    store.set('products/n1', { Product_ID: 'n1', Organization_ID: 'org1', Project_ID: 'pk', Name: 'Poz 3 - Noćni ormarići 550', Quantity: 22 });
    store.set('products/n2', { Product_ID: 'n2', Organization_ID: 'org1', Project_ID: 'pk', Name: 'Poz 3.1 - Noćni ormarići 750', Quantity: 3 });
    store.set('work_orders/rk', { Work_Order_ID: 'rk', Organization_ID: 'org1', Name: 'Kovač - Kuhinja', Status: 'U toku', Work_Order_Type: 'Proizvodnja' });
    store.set('work_orders/rl', { Work_Order_ID: 'rl', Organization_ID: 'org1', Name: 'Lejla - Ormar', Status: 'U toku', Work_Order_Type: 'Proizvodnja' });
    store.set('work_order_items/ik', { ID: 'ik', Organization_ID: 'org1', Work_Order_ID: 'rk', Product_ID: 'k1', Product_Name: 'Kuhinja', Project_ID: 'pk', Status: 'U toku' });
    store.set('work_order_items/il', { ID: 'il', Organization_ID: 'org1', Work_Order_ID: 'rl', Product_ID: 'o1', Product_Name: 'Ormar', Project_ID: 'pl', Status: 'U toku' });
    // Jučer: Haso na Lejlinom ormaru, Senad Ibrić na Hamzinoj kuhinji. Senad Mehić nema prethodnog dana.
    log('y1', 'haso', YDAY, 'rl', 'il', 'o1');
    log('y2', 'senadi', YDAY, 'rk', 'ik', 'k1');
});

describe('grupa radnika', () => {
    it.each([
        ['Amer je jučer i danas sa Edinom radio na novom proizvodu, to su noćni ormarići za Hamzu', ['amer', 'edin']],
        ['Edin i Amer su cijeli dan radili noćne ormariće', ['amer', 'edin']],
        ['Haso kuhinju, a Amer sa Edinom noćne ormariće', ['amer', 'edin']],
        ['Haso i Senad Mehić razne popravke. Amer skupa s Edinom noćne ormariće', ['amer', 'edin']],
    ])('„%s" → nalog ide grupi %j', (said, owners) => {
        expect(nameOwners(said, 'noćni ormarići', workers)?.sort()).toEqual(owners);
    });

    it('veznici, vrijeme i „radio" spajaju; „a", tačka i drugi posao dijele', () => {
        const said = 'Amer je jučer i danas sa Edinom radio ormariće, a Haso kuhinju';
        expect(workerGroup(said, workers[0], workers).sort()).toEqual(['amer', 'edin']);
        expect(workerGroup(said, workers[2], workers)).toEqual(['haso']);
        expect(workerGroup('Haso kuhinju, Amer ormariće', workers[2], workers)).toEqual(['haso']);
    });

    it('„sa Edinom … novi proizvod": oba radnika, pravi nalog s proizvodima projekta (ne „razni poslovi")', async () => {
        const said = 'Amer je danas sa Edinom radio na novom proizvodu, to su noćni ormarići za Hamzu';
        const e = env(said);
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1', 'W2'], new_order: { name: 'Noćni ormarići Hamza' } }] });
        expect(res.ok).toBe(true);
        const order = docs('work_orders').find(w => w.Name === 'Noćni ormarići Hamza')!;
        expect(order).toMatchObject({ Work_Order_Type: 'Proizvodnja' });
        expect(docs('work_order_items').filter(i => i.Work_Order_ID === order.Work_Order_ID).map(i => i.Product_Name).sort())
            .toEqual(['Poz 3 - Noćni ormarići 550', 'Poz 3.1 - Noćni ormarići 750']);
        expect(logsOf('amer').length > 0 && logsOf('amer').every(l => l.Work_Order_ID === order.Work_Order_ID)).toBe(true);
        expect(logsOf('edin').length > 0 && logsOf('edin').every(l => l.Work_Order_ID === order.Work_Order_ID)).toBe(true);
        await undoTurn(e.turnId, 'u1');
        expect(docs('work_orders').find(w => w.Name === 'Noćni ormarići Hamza')).toBeUndefined();
    });
});

describe('proizvod bez naloga', () => {
    it('ne upisuje se na drugi nalog istog projekta — ERP nudi nalog za te proizvode', async () => {
        const said = 'Amer i Edin danas noćni ormarići za Hamzu';
        const e = env(said);
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1', 'W2'], orders: ['R1'] }] });
        expect(res).toMatchObject({ ok: true, asked: 'Amer, Edin: Noćni ormarići (Hamza Kovač - Kuća) nemaju nalog. Da ga napravim i upišem rad na njega?' });
        expect(e.erpQuestion!.options.map(o => o.label)).toEqual(['➕ Nalog: Noćni ormarići (2 proizvoda)', 'Ipak na Kovač - Kuhinja', 'Preskoči']);
        expect(logsOf('amer')).toHaveLength(0);

        // Dugme pravi nalog s oba proizvoda i upisuje oba radnika na njega.
        const pick = env(said);
        expect(await runTool(pick, 'log_work', e.erpQuestion!.options[0].args)).toMatchObject({ ok: true });
        const order = docs('work_orders').find(w => w.Name === 'Hamza Kovač - Kuća - Noćni ormarići')!;
        expect(docs('work_order_items').filter(i => i.Work_Order_ID === order.Work_Order_ID)).toHaveLength(2);
        expect(logsOf('edin').length > 0 && logsOf('edin').every(l => l.Work_Order_ID === order.Work_Order_ID)).toBe(true);
        await undoTurn(pick.turnId, 'u1');

        // „Ipak na …" upiše na izabrani nalog, bez ponovnog pitanja.
        const keep = env(said);
        expect(await runTool(keep, 'log_work', e.erpQuestion!.options[1].args)).toMatchObject({ ok: true });
        expect(keep.erpQuestion).toBeUndefined();
        expect(logsOf('amer').length > 0 && logsOf('amer').every(l => l.Work_Order_ID === 'rk')).toBe(true);
        await undoTurn(keep.turnId, 'u1');
    });

    it('nalog koji proizvod ima ne pita ništa', async () => {
        const e = env('Amer je radio kuhinju za Hamzu');
        expect(await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1'], orders: ['R1'] }] })).toMatchObject({ ok: true });
        expect(e.erpQuestion).toBeUndefined();
        await undoTurn(e.turnId, 'u1');
    });
});

describe('ostali kao jučer', () => {
    it.each([
        'Ovi ostali danas rade kao i jučer', 'svi ostali isto', 'ostatak ekipe kao prethodni dan', 'a ostali nastavljaju', 'Ostali na istom',
    ])('„%s" → ostali kao jučer', t => expect(othersLikeLast(t)).toBe(true));

    it.each(['ostali su otišli kući', 'ostalo je još lakiranje', 'jučer je bilo isto kao danas'])('„%s" → nije', t => {
        expect(othersLikeLast(t)).toBe(false);
    });

    it('poruka bez imena je upis dana; pitanje nije', () => {
        expect(messageIntent('Ovi ostali danas rade kao i jučer', workers, { dims: [], widths: [], locations: [] }).kinds).toEqual(['work']);
        expect(messageIntent('Da li ostali rade kao jučer?', workers, { dims: [], widths: [], locations: [] }).kinds).not.toContain('work');
    });

    it('imenovani po rečenom, nespomenuti po zadnjem danu; ERP ne odbija ono što je model nabrojao', async () => {
        const e = env('Amer radi kuhinju za Hamzu, ovi ostali danas rade kao i jučer');
        const res = await runTool(e, 'log_work', { date: DAY, lines: [{ workers: ['W1'], orders: ['R1'] }, { workers: ['W3', 'W5'], orders: ['R2'] }] });
        expect(res.ok).toBe(true);
        expect(logsOf('amer').map(l => l.Work_Order_ID)).toEqual(['rk']);
        expect(logsOf('haso').map(l => l.Work_Order_ID)).toEqual(['rl']);
        expect(logsOf('senadi').map(l => l.Work_Order_ID)).toEqual(['rk']);
        expect(logsOf('senadm')).toHaveLength(0);
        await undoTurn(e.turnId, 'u1');
    });

    it('samo „ostali kao jučer", bez ijednog reda; zastavica bez rečenog ne važi', async () => {
        const e = env('Ovi ostali danas rade kao i jučer');
        expect((await runTool(e, 'log_work', { date: DAY, others_like_last: true })).ok).toBe(true);
        expect(logsOf('haso').map(l => l.Work_Order_ID)).toEqual(['rl']);
        expect(logsOf('senadi').map(l => l.Work_Order_ID)).toEqual(['rk']);
        await undoTurn(e.turnId, 'u1');
        expect(await runTool(env('Haso je radio'), 'log_work', { date: DAY, others_like_last: true })).toMatchObject({ ok: false, error: 'Nema ničega za upis.' });
    });
});
