/**
 * @jest-environment node
 */
// NALOG KROZ BOTA ŽIVI KAO NALOG IZ ERP-a (razgovori 16.11.2026, izmišljena imena):
//   „kada ti dodaš naloge, ne dodijeliš im radnike i sad se u ERP-u ne mogu pokrenuti"
//   „novi razni poslovi nalog: …" → napravljen proizvodni nalog s proizvodom iz ponude
//   „lijepe kerrock za Brdo" → „nema naloga", a nalog postoji
//   „završi sve naloge za Hamzu, svi su kompletirani" → dva od pet, nalozi ostali otvoreni
// Princip: ko radi je u ekipi, nalog s radom je pokrenut, svi proizvodi gotovi = nalog gotov.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';

const ORG = 'orgN';
let turn = 0;

const ORDERS = [['h1', 'Hamza - Kuhinja'], ['h2', 'Hamza - Vrata 2. faza'], ['h3', 'Hamza - Garderoberi u dječijoj sobi'], ['h4', 'Hamza - Amra i Edo Garderoberi'],
    ['b1', 'Brdo Švedski stolovi'], ['z1', 'Selidba arhive']];

function env(said: string, today = '2026-11-16'): ToolEnv {
    return {
        orgId: ORG, uid: 'u1', tz: 'Europe/Sarajevo', now: new Date(`${today}T08:00:00Z`),
        turnId: `N${++turn}`, dateText: said, groundText: said, messageText: said, reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ctx: {
            suppliers: [], memory: [], tasks: [], names: [], vocab: [],
            projects: [{ alias: 'P1', value: { id: 'pb', name: 'Hotel Brdo' } }, { alias: 'P2', value: { id: 'ph', name: 'Tarik Hamza - Kuća' } }],
            workers: ['amer:Amer Hodžić', 'edin:Edin Kovač', 'selma:Selma Begić']
                .map((x, i) => ({ alias: `W${i + 1}`, value: { id: x.split(':')[0], name: x.split(':')[1] } })),
            orders: ORDERS.map(([id, name], i) => ({ alias: `R${i + 1}`, value: { id, name } })),
        },
    } as unknown as ToolEnv;
}

const order = (id: string) => docs('work_orders').find(w => w.Organization_ID === ORG && w.Work_Order_ID === id)!;
const orderNamed = (name: string) => docs('work_orders').find(w => w.Organization_ID === ORG && w.Name === name);
const itemsOf = (woId: string) => docs('work_order_items').filter(i => i.Organization_ID === ORG && i.Work_Order_ID === woId);
const crewOf = (woId: string) => itemsOf(woId).flatMap(i => (i.Assigned_Workers || []).map((w: any) => w.Worker_ID)).sort();
const product = (id: string) => docs('products').find(p => p.Organization_ID === ORG && p.Product_ID === id)!;
const logsOn = (woId: string, date: string) => docs('work_logs').filter(l => l.Organization_ID === ORG && l.Work_Order_ID === woId && l.Date === date);

beforeAll(() => {
    ['Krojenje iverala', 'Lijepljenje Kerrocka', 'Okivanje'].forEach((n, i) => store.set(`process_catalog/N${i}`, { ID: `N${i}`, Organization_ID: ORG, Name: n, Order: i + 1 }));
    for (const [id, name] of [['amer', 'Amer Hodžić'], ['edin', 'Edin Kovač'], ['selma', 'Selma Begić']]) {
        store.set(`workers/${ORG}-${id}`, { Worker_ID: id, Organization_ID: ORG, Name: name, Daily_Rate: 100, Status: 'Aktivan' });
    }
    store.set(`projects/${ORG}-pb`, { Project_ID: 'pb', Organization_ID: ORG, Name: 'Hotel Brdo' });
    store.set(`projects/${ORG}-ph`, { Project_ID: 'ph', Organization_ID: ORG, Name: 'Tarik Hamza - Kuća' });
    store.set(`products/${ORG}-pb1a`, { Product_ID: 'p-b1a', Organization_ID: ORG, Project_ID: 'pb', Name: 'Švedski sto 1', Status: 'Materijali spremni' });
    store.set(`products/${ORG}-ph2a`, { Product_ID: 'p-h2a', Organization_ID: ORG, Project_ID: 'ph', Name: 'Vrata U1', Status: 'Lakiranje' });
    store.set(`products/${ORG}-v9`, { Product_ID: 'v9', Organization_ID: ORG, Project_ID: 'pb', Name: 'Poz 9 - Vrata Šoping', Quantity: 3 });
    const wo = (id: string, name: string, extra: Record<string, unknown> = {}) => store.set(`work_orders/${ORG}-${id}`, {
        Work_Order_ID: id, Organization_ID: ORG, Work_Order_Number: `2026-11/${id}`, Name: name, Status: 'U toku', Work_Order_Type: 'Proizvodnja',
        Started_At: '2026-10-01T07:00:00.000Z', Is_Scheduled: true, Planned_Start_Date: '2026-10-01', Planned_End_Date: '2026-11-30', ...extra,
    });
    const it = (id: string, woId: string, product: string, projectId: string, extra: Record<string, unknown> = {}) => store.set(`work_order_items/${ORG}-${id}`, {
        ID: id, Organization_ID: ORG, Work_Order_ID: woId, Product_ID: `p-${id}`, Product_Name: product, Project_ID: projectId, Status: 'U toku', Item_Type: 'product', ...extra,
    });
    wo('h1', 'Hamza - Kuhinja'); it('h1a', 'h1', 'Kuhinja donji', 'ph'); it('h1b', 'h1', 'Kuhinja gornji', 'ph');
    wo('h2', 'Hamza - Vrata 2. faza'); it('h2a', 'h2', 'Vrata U1', 'ph');
    wo('h3', 'Hamza - Garderoberi u dječijoj sobi'); it('h3a', 'h3', 'Ormar dječija soba', 'ph');
    wo('h4', 'Hamza - Amra i Edo Garderoberi'); it('h4a', 'h4', 'Ormari u garderobi', 'ph');
    // Nalog napravljen ranije bez ekipe i nepokrenut — kakve je bot ostavljao.
    wo('b1', 'Brdo Švedski stolovi', { Status: 'Na čekanju', Started_At: null, Is_Scheduled: false, Planned_Start_Date: undefined, Planned_End_Date: undefined,
        Process_Graph: { nodes: [{ id: 'bk', name: 'Krojenje iverala', itemIds: [] }, { id: 'bl', name: 'Lijepljenje Kerrocka', itemIds: [] }], edges: [{ id: 'be', source: 'bk', target: 'bl' }] } });
    it('b1a', 'b1', 'Švedski sto 1', 'pb', { Status: 'Na čekanju' });
    // Posao bez proizvoda; Selmu je u ekipu stavio vlasnik u ERP-u.
    wo('z1', 'Selidba arhive', { Work_Order_Type: 'Zadaci' });
    it('z1a', 'z1', 'Selidba arhive', '', { Item_Type: 'custom', Product_ID: 'custom-z1', Processes: [{ Process_Name: 'Rad', Status: 'Na čekanju' }],
        Assigned_Workers: [{ Worker_ID: 'selma', Worker_Name: 'Selma Begić', Daily_Rate: 100 }] });
});

describe('rad na nalogu koji čeka: ekipa i pokretanje kao u ERP-u', () => {
    let e: ToolEnv;

    it('posao rečen s procesom („lijepe kerrock za Brdo") nađe postojeći nalog', async () => {
        e = env('amer i edin lijepe kerrock za brdo');
        const res = await runTool(e, 'log_work', { lines: [{ who: 'amer i edin', work: 'lijepljenje Kerrocka za Brdo', process: 'Lijepljenje Kerrocka' }] });
        expect(res).toMatchObject({ ok: true });
        expect(e.erpQuestion).toBeUndefined();
        expect(logsOn('b1', '2026-11-16').map(l => l.Worker_ID).sort()).toEqual(['amer', 'edin']);
    });

    it('ko je radio je u ekipi stavke; nalog je U toku od tog dana i u Planeru', () => {
        // Amer vodi proces (to je u ERP-u već dodjela); Edin ulazi u ekipu stavke.
        expect(itemsOf('b1')[0].Processes.find((p: any) => p.Process_Name === 'Lijepljenje Kerrocka')).toMatchObject({ Worker_ID: 'amer', Status: 'U toku' });
        expect(itemsOf('b1')[0]).toMatchObject({ Status: 'U toku', Assigned_Workers: [{ Worker_ID: 'edin', Worker_Name: 'Edin Kovač', Daily_Rate: 100, Source: 'telegram' }] });
        expect(order('b1')).toMatchObject({ Status: 'U toku', Started_At: '2026-11-16T07:00:00.000Z', Is_Scheduled: true, Planned_Start_Date: '2026-11-16', Planned_End_Date: '2026-11-23' });
    });

    it('status proizvoda na projektu ide za procesom', () => {
        expect(product('p-b1a').Status).toBe('Lijepljenje Kerrocka');
    });

    it('↩️ vraća i ekipu i pokretanje', async () => {
        await undoTurn(e.turnId, 'u1');
        expect(product('p-b1a').Status).toBe('Materijali spremni');
        expect(order('b1')).toMatchObject({ Status: 'Na čekanju', Is_Scheduled: false });
        expect(crewOf('b1')).toEqual([]);
        expect(logsOn('b1', '2026-11-16')).toEqual([]);
    });

    it('i bez rečenog procesa: nalog s radom ne ostaje „Na čekanju" bez ekipe', async () => {
        const res = await runTool(env('amer i selma rade na svedskim stolovima za brdo'), 'log_work', { lines: [{ who: 'amer i selma', work: 'švedski stolovi za Brdo' }] });
        expect(res).toMatchObject({ ok: true });
        expect(order('b1')).toMatchObject({ Status: 'U toku', Is_Scheduled: true });
        expect(crewOf('b1')).toEqual(['amer', 'selma']);
    });

    it('radnik pređe na drugi posao: botova dodjela se skida, dodjela iz ERP-a ostaje', async () => {
        const res = await runTool(env('amer danas radi kuhinju za hamzu, selma seli arhivu', '2026-11-17'), 'log_work', {
            lines: [{ who: 'amer', work: 'kuhinja za Hamzu' }, { who: 'selma', work: 'selidba arhive' }],
        });
        expect(res).toMatchObject({ ok: true });
        expect(crewOf('h1')).toEqual(['amer', 'amer']);       // oba proizvoda kuhinje
        expect(crewOf('b1')).toEqual([]);                      // Amer i Selma više nisu na stolovima (dodao ih je bot)
        expect(crewOf('z1')).toEqual(['selma']);               // ERP-ova dodjela netaknuta, bez duplikata
        expect(itemsOf('z1')[0].Assigned_Workers[0].Source).toBeUndefined();
    });

    it('raniji dan se upisuje naknadno → ekipa zadnjeg dana ostaje kakva jeste', async () => {
        const res = await runTool(env('edin je u petak radio svedske stolove za brdo', '2026-11-17'), 'log_work', { date: '2026-11-13', lines: [{ who: 'edin', work: 'švedski stolovi za Brdo' }] });
        expect(res).toMatchObject({ ok: true });
        expect(crewOf('b1')).toEqual(['edin']);
        expect(crewOf('h1')).toEqual(['amer', 'amer']);
        // Rad prije upisanog početka pomjera početak naloga unazad.
        expect(order('b1')).toMatchObject({ Started_At: '2026-11-13T07:00:00.000Z', Planned_Start_Date: '2026-11-13' });
    });
});

describe('novi nalog iz poruke', () => {
    const said = 'amer i edin montiraju vrata na brdu (novi razni poslovi nalog: Brdo preostala vrata E501 i klizna)';
    const call = { lines: [{ who: 'amer i edin', work: 'novi razni poslovi nalog: Brdo preostala vrata E501 i klizna', new_order: { name: 'Brdo preostala vrata E501 i klizna', project: 'P1' } }] };

    it('„razni poslovi" = posao bez proizvoda (…/Z), i kad naziv liči na proizvod iz ponude', async () => {
        const e = env(said, '2026-11-18');
        expect(await runTool(e, 'log_work', call)).toMatchObject({ ok: true });
        const wo = orderNamed('Brdo preostala vrata E501 i klizna')!;
        expect(wo).toMatchObject({ Work_Order_Type: 'Zadaci', Status: 'U toku', Started_At: '2026-11-18T07:00:00.000Z', Is_Scheduled: true });
        expect(wo.Work_Order_Number).toMatch(/\/Z\d+$/);
        const items = itemsOf(wo.Work_Order_ID);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ Item_Type: 'custom', Project_ID: 'pb', Status: 'U toku' });
        // Nov nalog odmah ima ekipu → u ERP-u se vidi ko radi i ne traži „Dodijelite barem jednog radnika".
        expect(crewOf(wo.Work_Order_ID)).toEqual(['amer', 'edin']);
        await undoTurn(e.turnId, 'u1');
        expect(orderNamed('Brdo preostala vrata E501 i klizna')).toBeUndefined();
    });

    it('bez „razni poslovi": isti naziv pravi proizvodni nalog s proizvodom projekta (kontrola)', async () => {
        const e = env('amer i edin montiraju vrata na brdu, napravi nalog Brdo preostala vrata', '2026-11-18');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'amer i edin', work: 'vrata na Brdu', new_order: { name: 'Brdo preostala vrata', project: 'P1' } }] })).toMatchObject({ ok: true });
        const wo = orderNamed('Brdo preostala vrata')!;
        expect(wo).toMatchObject({ Work_Order_Type: 'Proizvodnja', Status: 'U toku' });
        expect(itemsOf(wo.Work_Order_ID).map(i => i.Product_Name)).toEqual(['Poz 9 - Vrata Šoping']);
        expect(crewOf(wo.Work_Order_ID)).toEqual(['amer', 'edin']);
        await undoTurn(e.turnId, 'u1');
    });

    it('„napravi nalog X i popuni mu prazne dane": prazni dani idu na nalog napravljen tom porukom, i kad ga model ne navede', async () => {
        const e = env('za selmu kreni novi nalog koji se zove Prevoz robe, i popuni joj prazne dane', '2026-11-18');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'selma', work: 'Prevoz robe', new_order: { name: 'Prevoz robe' } }] })).toMatchObject({ ok: true });
        const res = await runTool(e, 'fill_work_days', { workers: ['W3'], orders: [] });
        expect(JSON.stringify(res)).not.toMatch(/Navedi naloge/);
        expect(res).toMatchObject({ ok: true });
        await undoTurn(e.turnId, 'u1');
    });
});

describe('„gotovo je" riječima: ERP nađe naloge i završi ih', () => {
    it('lista („vrata za Hamzu, garderoberi, dječiji garderoberi"): rečeno ide ispred oznaka koje je model izabrao', async () => {
        const e = env('vrata za hamzu su gotova, garderoberi, djeciji garderoberi', '2026-11-19');
        const res = await runTool(e, 'set_progress', { what: 'vrata za Hamzu, garderoberi, dječiji garderoberi', orders: ['R1'], state: 'done' });
        expect(res).toMatchObject({ ok: true, products: 3 });
        for (const id of ['h2', 'h3', 'h4']) expect(order(id)).toMatchObject({ Status: 'Završeno', Completed_At: expect.stringMatching(/T15:00:00\.000Z$/) });
        expect(order('h1').Status).toBe('U toku');
        expect(product('p-h2a').Status).toBe('Spremno');     // završen proizvod je na projektu „Spremno"
        expect(e.summaries[0]).toMatch(/✅ Nalozi završeni: .*Hamza - Vrata 2\. faza/);
    });

    it('↩️ otvara naloge nazad', async () => {
        const e = env('zavrsi nalog vrata za hamzu', '2026-11-19');
        store.set(`work_orders/${ORG}-h2`, { ...order('h2'), Status: 'U toku', Completed_At: null });
        store.set(`work_order_items/${ORG}-h2a`, { ...itemsOf('h2')[0], Status: 'U toku' });
        expect(await runTool(e, 'set_progress', { what: 'vrata za Hamzu', state: 'done' })).toMatchObject({ ok: true, products: 1 });
        expect(order('h2').Status).toBe('Završeno');
        await undoTurn(e.turnId, 'u1');
        expect(order('h2').Status).toBe('U toku');
        expect(itemsOf('h2')[0].Status).toBe('U toku');
    });

    it('„završi sve naloge za Hamzu": svi njegovi otvoreni nalozi, ne dva koja je model naveo', async () => {
        const e = env('zavrsi sve naloge za hamzu, svi su kompletirani', '2026-11-19');
        const res = await runTool(e, 'set_progress', { what: 'sve naloge za Hamzu', orders: ['R3', 'R4'], state: 'done' });
        expect(res).toMatchObject({ ok: true, products: 3 });      // kuhinja (2) + vrata vraćena maloprije (1)
        for (const id of ['h1', 'h2', 'h3', 'h4']) expect(order(id).Status).toBe('Završeno');
        expect(order('b1').Status).toBe('U toku');
    });

    it('posao bez proizvoda („razni poslovi") se završava kao cjelina', async () => {
        const e = env('selidba arhive je gotova', '2026-11-19');
        expect(await runTool(e, 'set_progress', { what: 'selidba arhive', state: 'done' })).toMatchObject({ ok: true, products: 1 });
        expect(itemsOf('z1')[0].Status).toBe('Završeno');
        expect(order('z1').Status).toBe('Završeno');
    });

    it('dok jedan proizvod nije gotov, nalog ostaje otvoren', async () => {
        store.set(`work_order_items/${ORG}-b1b`, { ID: 'b1b', Organization_ID: ORG, Work_Order_ID: 'b1', Product_ID: 'p-b1b', Product_Name: 'Švedski sto veliki', Project_ID: 'pb', Status: 'U toku', Item_Type: 'product' });
        const e = env('veliki svedski sto za brdo je gotov', '2026-11-19');
        expect(await runTool(e, 'set_progress', { what: 'švedski stolovi za Brdo', only: ['veliki'], state: 'done' })).toMatchObject({ ok: true, products: 1 });
        expect(order('b1').Status).toBe('U toku');
        expect(e.summaries[0]).not.toMatch(/Nalog završen/);
    });

    it('ništa otvoreno ne odgovara rečenom → jasna greška, bez upisa', async () => {
        const res = await runTool(env('kuhinja za hamzu je gotova', '2026-11-19'), 'set_progress', { what: 'kuhinja za Hamzu', state: 'done' });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Nijedan otvoren nalog ne odgovara/) });
    });
});
