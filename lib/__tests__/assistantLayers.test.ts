/**
 * @jest-environment node
 */
// TRI SLOJA, na stvarnim razgovorima iz Telegrama (27.10.2026):
//   „Svi proizvodi za Čorluku osim vrata su završeni na zadnji datum kad je rađeno na njima"
//   „Moraš zabilježiti da su svi prisutni"
//   „Bego danas pakuje sve proizvode za Čorluku osim vrata"
// Svaka rečenica upisuje samo svoj sloj; ono što korisnik nije rekao se odbija.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';

const ORG = 'orgL';
const TODAY = '2026-10-27';
let turn = 0;

function env(groundText: string): ToolEnv {
    return {
        orgId: ORG, uid: 'u1', tz: 'Europe/Sarajevo', now: new Date(`${TODAY}T14:00:00Z`),
        turnId: `L${++turn}`, dateText: groundText, groundText, reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ctx: {
            projects: [], suppliers: [], memory: [], tasks: [], names: [], vocab: [],
            workers: ['bego:Bego Saka', 'ahmad:Ahmad Al-Masaud', 'amer:Amer Berisalić', 'kerim:Kerim Alić', 'dido:Dido']
                .map((x, i) => ({ alias: `W${i + 1}`, value: { id: x.split(':')[0], name: x.split(':')[1] } })),
            orders: [['c1', 'Corluka - Kuhinja'], ['c2', 'Corluka - Ostrvo'], ['c3', 'Corluka - Vrata'], ['s1', 'Sto za Igora']]
                .map(([id, name], i) => ({ alias: `R${i + 1}`, value: { id, name } })),
        },
    } as unknown as ToolEnv;
}

const item = (id: string) => docs('work_order_items').find(i => i.Organization_ID === ORG && i.ID === id)!;
const logsToday = () => docs('work_logs').filter(l => l.Organization_ID === ORG && l.Date === TODAY);
const allLogs = () => docs('work_logs').filter(l => l.Organization_ID === ORG).length;

beforeAll(() => {
    ['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija', 'Lakiranje', 'Okivanje', 'Pakovanje']
        .forEach((n, i) => store.set(`process_catalog/L${i}`, { ID: `L${i}`, Organization_ID: ORG, Name: n, Order: i + 1 }));
    for (const [id, name] of [['bego', 'Bego Saka'], ['ahmad', 'Ahmad Al-Masaud'], ['amer', 'Amer Berisalić'], ['kerim', 'Kerim Alić'], ['dido', 'Dido']]) {
        store.set(`workers/${id}`, { Worker_ID: id, Organization_ID: ORG, Name: name, Daily_Rate: 100, Status: 'Aktivan' });
    }
    const chain = (prefix: string, names: string[], itemIds: string[]) => ({
        nodes: names.map((name, i) => ({ id: `${prefix}${i}`, name, itemIds })),
        edges: names.slice(1).map((_, i) => ({ id: `${prefix}e${i}`, source: `${prefix}${i}`, target: `${prefix}${i + 1}` })),
    });
    const wo = (id: string, name: string, graph?: unknown) => store.set(`work_orders/${id}`, {
        Work_Order_ID: id, Organization_ID: ORG, Name: name, Status: 'U toku', Work_Order_Type: 'Proizvodnja', Started_At: '2026-09-01', ...(graph ? { Process_Graph: graph } : {}),
    });
    wo('c1', 'Corluka - Kuhinja', chain('k', ['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija', 'Lakiranje', 'Okivanje'], []));
    wo('c2', 'Corluka - Ostrvo', chain('o', ['Krojenje iverala', 'Lakiranje'], []));
    wo('c3', 'Corluka - Vrata', chain('v', ['Lakiranje', 'Okivanje'], []));
    wo('s1', 'Sto za Igora');
    const it = (id: string, woId: string, product: string) => store.set(`work_order_items/${id}`, {
        ID: id, Organization_ID: ORG, Work_Order_ID: woId, Product_ID: `p-${id}`, Product_Name: product, Project_ID: 'pc', Status: 'U toku',
    });
    it('ck', 'c1', 'Donji elementi'); it('ck2', 'c1', 'Gornji elementi'); it('co', 'c2', 'Ostrvo'); it('cv', 'c3', 'Vrata'); it('si', 's1', 'Sto');
    // Knjiga rada: zadnji rad je različit po proizvodu.
    const log = (id: string, worker: string, date: string, woId: string, itemId: string) => store.set(`work_logs/${id}`, {
        WorkLog_ID: id, Organization_ID: ORG, Date: date, Worker_ID: worker, Worker_Name: worker, Daily_Rate: 100, Original_Daily_Rate: 100,
        Day_Fraction: 1, Presence: 1, Split_Factor: 1, Work_Order_ID: woId, Work_Order_Item_ID: itemId, Product_ID: `p-${itemId}`,
        Booking_Source: 'attendance', Is_From_Attendance: true,
    });
    log('h1', 'amer', '2026-10-20', 'c1', 'ck');
    log('h2', 'kerim', '2026-10-22', 'c1', 'ck2');
    log('h3', 'amer', '2026-09-28', 'c2', 'co');
    log('h4', 'bego', '2026-10-25', 'c3', 'cv');
    log('h5', 'amer', '2026-10-23', 's1', 'si');
    log('h6', 'kerim', '2026-10-23', 's1', 'si');
});

describe('„Svi proizvodi za Čorluku osim vrata su završeni na zadnji datum kad je rađeno na njima"', () => {
    const said = 'Svi proizvodi za corluku osim vrata su zavrseni na zadnji datum kad je radjeno na njima';
    let e: ToolEnv;
    let before: number;

    it('stari pogrešan put je zatvoren: rad za Ahmada koji nije spomenut se odbija', async () => {
        before = allLogs();
        const res = await runTool(env(said), 'log_work', { lines: [{ workers: ['W2'], orders: ['R1', 'R2'], work: 'Čorluka' }] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Ahmad Al-Masaud nije spomenut/) });
        expect(allLogs()).toBe(before);
    });

    it('set_progress: svaki proizvod završen na svoj zadnji dan rada; vrata netaknuta', async () => {
        e = env(said);
        const res = await runTool(e, 'set_progress', { orders: ['R1', 'R2', 'R3'], except: ['vrata'] });
        expect(res).toMatchObject({ ok: true, products: 3 });
        expect(item('ck')).toMatchObject({ Status: 'Završeno', Completed_At: '2026-10-20T15:00:00.000Z' });
        expect(item('ck2')).toMatchObject({ Status: 'Završeno', Completed_At: '2026-10-22T15:00:00.000Z' });
        expect(item('co')).toMatchObject({ Status: 'Završeno', Completed_At: '2026-09-28T15:00:00.000Z' });
        expect(item('ck').Processes.map((p: any) => p.Status)).toEqual(['Završeno', 'Završeno', 'Završeno', 'Završeno', 'Završeno']);
        expect(item('cv').Status).toBe('U toku');
    });

    it('Knjiga rada i prisustvo nisu dirani', () => {
        expect(allLogs()).toBe(before);
        expect(docs('worker_attendance').filter(a => a.Organization_ID === ORG)).toEqual([]);
    });

    it('potvrda po slojevima', () => {
        const s = e.summaries[0];
        expect(s).toMatch(/^⚙️ Procesi — proizvodi završeni \(dan zadnjeg rada iz Knjige rada\):/);
        expect(s).toMatch(/• Corluka - Kuhinja — Donji elementi 20\.10\., Gornji elementi 22\.10\./);
        expect(s).toMatch(/• Corluka - Ostrvo — Ostrvo · 28\.9\./);
        expect(s).toMatch(/Nije dirano: Vrata \(Corluka - Vrata\)/);
        expect(s).toMatch(/📒 Knjiga rada i 🗓 prisustvo — nisu mijenjani\./);
    });

    it('↩️ vraća proizvode', async () => {
        await undoTurn(e.turnId, 'u1');
        expect(item('ck').Status).toBe('U toku');
        expect(item('co').Status).toBe('U toku');
    });
});

describe('„Moraš zabilježiti da su svi prisutni"', () => {
    const said = 'Moras zabiljeziti da su svi prisutni';
    let e: ToolEnv;

    it('stari pogrešan put je zatvoren: svi na „Sto za Igora" se odbija (nalog nije rečen)', async () => {
        const res = await runTool(env(said), 'log_work', { lines: [{ workers: ['W1', 'W2', 'W3', 'W4', 'W5'], orders: ['R4'], work: 'Sto za Igora' }] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Sto za Igora/) });
        expect(logsToday()).toEqual([]);
    });

    it('set_presence: svi prisutni; dnevnice kao šihtarica (zadnji dan rada), bez izmišljenih naloga', async () => {
        e = env(said);
        const res = await runTool(e, 'set_presence', { all: true });
        expect(res).toMatchObject({ ok: true, workers: 5, without_order: ['Ahmad Al-Masaud', 'Dido'] });
        const att = docs('worker_attendance').filter(a => a.Organization_ID === ORG && a.Date === TODAY);
        expect(att.map(a => `${a.Worker_ID}:${a.Status}`).sort()).toEqual(['ahmad:Prisutan', 'amer:Prisutan', 'bego:Prisutan', 'dido:Prisutan', 'kerim:Prisutan']);
        const byWorker = (w: string) => logsToday().filter(l => l.Worker_ID === w).map(l => l.Work_Order_ID);
        expect(byWorker('amer')).toEqual(['s1']);     // zadnji dan: Sto za Igora
        expect(byWorker('kerim')).toEqual(['s1']);
        expect(byWorker('bego')).toEqual(['c3']);     // zadnji dan: vrata
        expect(byWorker('ahmad')).toEqual([]);
        expect(byWorker('dido')).toEqual([]);
        expect(logsToday().every(l => l.Booking_Source === 'attendance')).toBe(true);
    });

    it('procesi nisu dirani; potvrda kaže ko je bez naloga', () => {
        expect(item('si').Processes).toBeUndefined();
        const s = e.summaries[0];
        expect(s).toMatch(/^🗓 Prisustvo, danas: Prisutan — Ahmad Al-Masaud, Amer Berisalić, Bego Saka, Dido, Kerim Alić/);
        expect(s).toMatch(/📒 Knjiga rada — po šihtarici, kao u aplikaciji/);
        expect(s).toMatch(/• Amer Berisalić, Kerim Alić → Sto za Igora/);
        expect(s).toMatch(/• Bez naloga \(nema ranijeg rada\): Ahmad Al-Masaud, Dido — reci na čemu su radili/);
        expect(s).toMatch(/⚙️ Procesi — nisu mijenjani\./);
    });

    it('„svi" mora biti rečeno; inače samo rečeni radnici', async () => {
        expect(await runTool(env('Amer je došao'), 'set_presence', { all: true })).toMatchObject({ ok: false, error: expect.stringMatching(/nije rekao da su svi/) });
        expect(await runTool(env('Amer je došao'), 'set_presence', { workers: ['W4'] })).toMatchObject({ ok: false, error: expect.stringMatching(/Kerim Alić nije spomenut/) });
    });

    it('↩️ vraća prisustvo i dnevnice', async () => {
        await undoTurn(e.turnId, 'u1');
        expect(docs('worker_attendance').filter(a => a.Organization_ID === ORG && a.Date === TODAY)).toEqual([]);
        expect(logsToday()).toEqual([]);
    });
});

describe('„Bego danas pakuje sve proizvode za Čorluku osim vrata"', () => {
    const said = 'Bego danas pakuje sve proizvode za corluku osim vrata';
    let e: ToolEnv;

    beforeAll(async () => {
        e = env(said);
        const res = await runTool(e, 'log_work', { lines: [{ workers: ['W1'], orders: ['R1', 'R2'], work: 'Čorluka', process: 'pakuje' }] });
        expect(res).toMatchObject({ ok: true, finished_products: 0 });
    });

    it('Knjiga rada: samo Bego, danas, na Čorlukine naloge bez vrata', () => {
        const mine = logsToday();
        expect(mine.every(l => l.Worker_ID === 'bego')).toBe(true);
        expect(Array.from(new Set(mine.map(l => l.Work_Order_ID))).sort()).toEqual(['c1', 'c2']);
        expect(mine.reduce((s, l) => s + l.Daily_Rate, 0)).toBe(100);
    });

    it('pakovanje van plana dobije mjesto po katalogu (na kraj); raniji koraci pretpostavljeni s danom zadnjeg rada', () => {
        const graph = docs('work_orders').find(w => w.Work_Order_ID === 'c1')!.Process_Graph;
        const pak = graph.nodes.find((n: any) => n.name === 'Pakovanje');
        expect(graph.edges.some((x: any) => x.target === pak.id && x.source === 'k4')).toBe(true);   // iza okivanja
        const ck = item('ck').Processes;
        expect(ck.find((p: any) => p.Process_Name === 'Pakovanje')).toMatchObject({ Status: 'U toku' });
        expect(ck.find((p: any) => p.Process_Name === 'Okivanje')).toMatchObject({ Status: 'Završeno', Assumed_Done: true, Completed_At: '2026-10-20T15:00:00.000Z' });
        expect(item('ck2').Processes.find((p: any) => p.Process_Name === 'Lakiranje')).toMatchObject({ Completed_At: '2026-10-22T15:00:00.000Z' });
    });

    it('proizvodi nisu završeni („pakuje", ne „zapakovao"); vrata netaknuta', () => {
        expect(item('ck').Status).toBe('U toku');
        expect(item('co').Status).toBe('U toku');
        expect(item('cv').Processes).toBeUndefined();
    });

    it('potvrda po slojevima', () => {
        const s = e.summaries[0];
        expect(s).toMatch(/^📒 Knjiga rada, danas:\n• Bego Saka — ½ dana · Corluka - Kuhinja\n• Bego Saka — ½ dana · Corluka - Ostrvo/);
        expect(s).toMatch(/🗓 Prisutan danas: Bego Saka/);
        expect(s).toMatch(/⚙️ Procesi:\n• Pakovanje u toku · Corluka - Kuhinja · novo u toku naloga/);
        expect(s).toMatch(/☑️ Pretpostavljeno završeno 20\.10\. \(zadnji rad\) · Corluka - Kuhinja \(Donji elementi\): Krojenje iverala, Kantiranje iverala, Sklapanje kutija, Lakiranje, Okivanje/);
    });

    it('sutra: „Bego zapakovao sve za Čorluku" → zadnji korak gotov = proizvodi završeni', async () => {
        const next = env('Bego zapakovao sve za corluku osim vrata');
        const res = await runTool(next, 'log_work', { lines: [{ workers: ['W1'], orders: ['R1', 'R2'], work: 'Čorluka', process: 'pakovanje', done: true }] });
        expect(res).toMatchObject({ ok: true });
        expect(item('ck').Status).toBe('Završeno');
        expect(item('co').Status).toBe('Završeno');
        expect(next.summaries[0]).toMatch(/✔ Proizvod završen · Corluka - Kuhinja/);
    });
});
