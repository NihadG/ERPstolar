/**
 * @jest-environment node
 */
// Upis rada iznova (15.11.2026) — „model prepisuje, ERP nalazi", izmišljena imena.
// Mjerenje 199 poruka: upis rada 22 pala poziva od 34 (ostali alati skoro bez pada); u 12 od 16
// odbijanja „radnik nije spomenut" model je bio u pravu, a ostala su bile zamijenjene oznake W#/R#.
// Principi:
//   1. model prepiše imena (who) i posao (work) riječima; radnike i naloge nalazi ERP
//   2. radnik iz razgovora („on i Edin", „mislio sam na Senada Ibrića") nije „nespomenut"
//   3. posao na više naloga čita ERP: „sve naloge od Hamze osim vrata", „Lejla i vrata za Hamzu"
//   4. jedan pogrešan dio (nepoznato ime, clear koji nije rečen) ne obara ostatak upisa
//   5. oznake iz liste (W#, R#) i dalje rade za ERP-ova dugmad

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';
import { nameOwners, whoWorkers } from '@/lib/assistant/grounding';
import { matchTargets, type DiaryTarget } from '@/lib/workDiary';

const DAY = '2026-11-04';   // srijeda
let turn = 0;
const WORKERS = [
    { alias: 'W1', value: { id: 'amer', name: 'Amer Hodžić' } },
    { alias: 'W2', value: { id: 'edin', name: 'Edin Begić' } },
    { alias: 'W3', value: { id: 'haso', name: 'Haso Mujić' } },
    { alias: 'W4', value: { id: 'senadm', name: 'Senad Mehić' } },
    { alias: 'W5', value: { id: 'senadi', name: 'Senad Ibrić' } },
    { alias: 'W6', value: { id: 'tarik', name: 'Tarik Hodžić' } },
    { alias: 'W7', value: { id: 'kemal', name: 'Kemal Zukić' } },
];
const refs = WORKERS.map(w => ({ id: w.value.id, name: w.value.name }));
const ORDERS = [
    { alias: 'R1', value: { id: 'rk', name: 'Kovač - Kuhinja' } },
    { alias: 'R2', value: { id: 'rv', name: 'Kovač - Vrata 2. faza' } },
    { alias: 'R3', value: { id: 'rg', name: 'Kovač - Garderoberi' } },
    { alias: 'R4', value: { id: 'rl', name: 'Lejla A501 - Vrata' } },
    { alias: 'R5', value: { id: 'ru', name: 'Umivaonici Brdo 1. faza' } },
    { alias: 'R6', value: { id: 'rb', name: 'Vrata Brdo 1. faza' } },
];
function env(message: string, history: string[] = [], over: Partial<ToolEnv> = {}): ToolEnv {
    return {
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date(`${DAY}T16:00:00Z`),
        turnId: `w${++turn}`, dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        groundText: message, messageText: message, workerGround: message, talkText: history.join('\n'),
        ctx: { projects: [{ alias: 'P1', value: { id: 'pk', client: 'Kovač', name: 'Hamza Kovač - Kuća' } }], suppliers: [], memory: [], tasks: [], names: [], workers: WORKERS, orders: ORDERS },
        ...over,
    } as unknown as ToolEnv;
}
const ordersOf = (w: string, day = DAY) => Array.from(new Set(docs('work_logs').filter(l => l.Worker_ID === w && l.Date === day).map(l => l.Work_Order_ID))).sort();

beforeAll(() => {
    for (const w of WORKERS) store.set(`workers/${w.value.id}`, { Worker_ID: w.value.id, Organization_ID: 'org1', Name: w.value.name, Daily_Rate: 100, Status: 'Aktivan' });
    store.set('projects/pk', { Project_ID: 'pk', Organization_ID: 'org1', Name: 'Hamza Kovač - Kuća', Client_Name: 'Kovač' });
    for (const o of ORDERS) {
        store.set(`work_orders/${o.value.id}`, { Work_Order_ID: o.value.id, Organization_ID: 'org1', Name: o.value.name, Status: 'U toku', Work_Order_Type: 'Proizvodnja' });
        store.set(`work_order_items/i-${o.value.id}`, { ID: `i-${o.value.id}`, Organization_ID: 'org1', Work_Order_ID: o.value.id, Product_ID: `p-${o.value.id}`, Product_Name: o.value.name.split(' - ').pop(), Status: 'U toku', ...(o.value.name.startsWith('Kovač') ? { Project_ID: 'pk' } : {}) });
    }
});

describe('imena kako su rečena → radnici', () => {
    it.each([
        ['amer, edin i haso', ['amer', 'edin', 'haso']],
        ['Amera i Edina', ['amer', 'edin']],
        ['kemo sa hasom', ['haso', 'kemal']],
        ['Mujić i Begić', ['edin', 'haso']],
        ['Amer Hodžić', ['amer']],
        ['Senad Ibrić i Tarik', ['senadi', 'tarik']],
        ['Senad', ['senadi', 'senadm']],
        ['Hodžić', ['amer', 'tarik']],
    ])('„%s" → %j', (who, ids) => expect(whoWorkers(who, refs).ids.sort()).toEqual(ids));

    it.each([
        ['Amer i Lejla', ['lejla']],
        ['Amra - Vrata', ['amra', 'vrata']],
        ['amer i edin zajedno, kao i haso', []],
        ['ostali radnici', []],
    ])('riječi koje nisu ničije ime: „%s" → %j', (who, unknown) => expect(whoWorkers(who, refs).unknown).toEqual(unknown));
});

describe('posao kako je rečen → nalozi', () => {
    const targets: DiaryTarget[] = ORDERS.map(o => ({
        workOrderId: o.value.id, workOrderName: o.value.name, itemId: `i-${o.value.id}`, productId: '', productName: o.value.name.split(' - ').pop()!,
        projectName: o.value.name.startsWith('Kovač') ? 'Hamza Kovač - Kuća' : '', finished: false,
    }));
    const ids = (q: string) => { const m = matchTargets(q, targets); return m.kind === 'ok' ? m.orders.map(o => o.workOrderId).sort() : m.kind; };

    it.each([
        ['sve naloge od Hamze, osim za vrata', ['rg', 'rk']],
        ['na svim nalozima za Kovača', ['rg', 'rk', 'rv']],
        ['sve od Hamze bez garderobera', ['rk', 'rv']],
        ['Lejla i vrata za Brdo', ['rb', 'rl']],
        ['umivaonici za brdo', ['ru']],
        ['kuhinja Hamza', ['rk']],
    ])('„%s" → %j', (q, out) => expect(ids(q)).toEqual(out));

    it.each([
        ['Brdo', 'ambiguous'],
        ['utovar kamiona', 'none'],
        ['sve naloge od Zlatana', 'none'],
    ])('„%s" → %s (ERP pita ili nudi nov nalog)', (q, out) => expect(ids(q)).toBe(out));
});

describe('upis: model prepisuje, ERP nalazi', () => {
    it('dan po grupama, jednim pozivom: imena i poslovi riječima', async () => {
        const said = 'amer, edin i haso su utovarali kamion za Hamzu, dakle sve ih stavi na sve naloge od Hamze, osim za vrata. Kemo je radio umivaonike za brdo, Tarik na Lejli i vratima za brdo';
        const e = env(said);
        const res = await runTool(e, 'log_work', {
            lines: [
                { who: 'amer, edin i haso', work: 'sve naloge od Hamze, osim za vrata' },
                { who: 'Kemo', work: 'umivaonike za brdo' },
                { who: 'Tarik', work: 'Lejli i vratima za brdo' },
            ],
        }) as Record<string, unknown>;
        expect(res).toMatchObject({ ok: true });
        expect(res.nije_upisano).toBeUndefined();
        for (const w of ['amer', 'edin', 'haso']) expect(ordersOf(w)).toEqual(['rg', 'rk']);
        expect(ordersOf('kemal')).toEqual(['ru']);
        expect(ordersOf('tarik')).toEqual(['rb', 'rl']);
        await undoTurn(e.turnId, 'u1');
    });

    it('model pošalje i oznaku naloga iz liste (pogrešnu): važi rečeni posao, ne oznaka', async () => {
        const e = env('Kemo je radio umivaonike za brdo');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Kemo', work: 'umivaonike za brdo', order: 'R6' }] })).toMatchObject({ ok: true });
        expect(ordersOf('kemal')).toEqual(['ru']);
        await undoTurn(e.turnId, 'u1');
    });

    it('radnik iz razgovora („on i Edin"): model napiše ime, ERP ga ne odbija', async () => {
        const history = ['Šta je s Amerom, nije upisan?', 'Amer nema upisa za 4.11.'];
        const e = env('Pa bio je oba dana na terenu. On i Edin su radili kuhinju za Hamzu', history);
        const res = await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', work: 'kuhinju za Hamzu' }] });
        expect(res).toMatchObject({ ok: true });
        expect(ordersOf('amer')).toEqual(['rk']);
        expect(ordersOf('edin')).toEqual(['rk']);
        await undoTurn(e.turnId, 'u1');
    });

    it('ime koje model zna iz izvještaja ili ranijeg razgovora, a nema ga u zadnjim porukama, se upiše', async () => {
        // 06.11.: „On i Edin…" — model je iz izvještaja znao ko je „on" i napisao ime; ERP ga je odbijao.
        const e = env('Pa ima za oba dana, bio je na terenu, radili su kuhinju za Hamzu');
        const res = await runTool(e, 'log_work', { lines: [{ who: 'Amer Hodžić i Tarik', work: 'kuhinju za Hamzu' }] }) as Record<string, unknown>;
        expect(res).toMatchObject({ ok: true });
        expect(res.nije_upisano).toBeUndefined();
        expect(ordersOf('amer')).toEqual(['rk']);
        expect(ordersOf('tarik')).toEqual(['rk']);
        await undoTurn(e.turnId, 'u1');
    });

    it('riječ koja nije ime radnika (naziv naloga) ispada uz uputu; red bez ijednog radnika se ne upisuje', async () => {
        const e = env('Haso i Edin rade na novom nalogu, to je razni poslovi, Amra - Vrata');
        const res = await runTool(e, 'log_work', { lines: [{ who: 'Amra', work: 'vrata za Lejlu' }] });
        expect(res).toMatchObject({ ok: false });
        expect(String((res as { error?: string }).error)).toContain('nije ime nijednog radnika');
        expect(docs('work_logs')).toHaveLength(0);
    });

    it('isto ime dvojice bez prezimena → ERP pita dugmadima, ostali se upišu; prezime iz razgovora rješava', async () => {
        const e = env('Senad i Haso su radili kuhinju za Hamzu');
        const res = await runTool(e, 'log_work', { lines: [{ who: 'Senad i Haso', work: 'kuhinju za Hamzu' }] });
        expect(res).toMatchObject({ ok: true });
        expect(e.erpQuestion!.options.map(o => o.label)).toEqual(['Senad Mehić', 'Senad Ibrić', 'Preskoči']);
        expect(ordersOf('haso')).toEqual(['rk']);
        // Dugme nosi oznake i završava upis bez modela.
        const pick = env('Senad i Haso su radili kuhinju za Hamzu');
        expect(await runTool(pick, 'log_work', e.erpQuestion!.options[1].args)).toMatchObject({ ok: true });
        expect(ordersOf('senadi')).toEqual(['rk']);
        expect(ordersOf('senadm')).toEqual([]);
        await undoTurn(pick.turnId, 'u1');
        await undoTurn(e.turnId, 'u1');

        const clear = env('kuhinja za Hamzu, kao i Haso', ['mislio sam na Senada Ibrića'], { workerGround: 'mislio sam na Senada Ibrića\nkuhinja za Hamzu, kao i Haso' });
        expect(await runTool(clear, 'log_work', { lines: [{ who: 'Senad Ibrić i Haso', work: 'kuhinja za Hamzu' }] })).toMatchObject({ ok: true });
        expect(clear.erpQuestion).toBeUndefined();
        expect(ordersOf('senadi')).toEqual(['rk']);
        await undoTurn(clear.turnId, 'u1');
    });

    it('posao koji pogađa više naloga podjednako → pitanje dugmadima; posao bez naloga → ponuda novog', async () => {
        const e = env('Amer je radio za Brdo');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer', work: 'Brdo' }] })).toMatchObject({ ok: true });
        expect(e.erpQuestion!.options.map(o => o.label)).toEqual(expect.arrayContaining(['Umivaonici Brdo 1. faza', 'Vrata Brdo 1. faza']));
        const none = env('Amer je utovarao kamion');
        expect(await runTool(none, 'log_work', { lines: [{ who: 'Amer', work: 'utovar kamiona' }] })).toMatchObject({ ok: true });
        expect(none.erpQuestion!.options.some(o => o.label.includes('Utovar kamiona'))).toBe(true);
        expect(docs('work_logs')).toHaveLength(0);
    });

    it('red poslan bez lines (ko i šta u samom pozivu) je jedan red', async () => {
        const e = env('Amer i Edin su radili kuhinju za Hamzu');
        expect(await runTool(e, 'log_work', { who: 'Amer i Edin', work: 'kuhinju za Hamzu' })).toMatchObject({ ok: true });
        expect(ordersOf('edin')).toEqual(['rk']);
        await undoTurn(e.turnId, 'u1');
    });
});

describe('jedan pogrešan dio ne obara upis', () => {
    it('clear koji nije rečen ispada uz napomenu; rad i odsustvo (imena riječima) se upišu', async () => {
        const e = env('Amer radi kuhinju za Hamzu, Edin i Haso danas ne rade jer je vikend');
        const res = await runTool(e, 'log_work', {
            lines: [{ who: 'Amer', work: 'kuhinju za Hamzu' }],
            clear: ['Edin', 'Haso'],
            absent: [{ who: 'Edin i Haso', status: 'Vikend' }],
        }) as Record<string, unknown>;
        expect(res).toMatchObject({ ok: true, absences: 2 });
        expect(String(res.nije_upisano)).toContain('nije rečeno da Edin, Haso ne treba');
        expect(ordersOf('amer')).toEqual(['rk']);
        const att = (w: string) => docs('worker_attendance').find(a => a.Worker_ID === w && String(a.Date).startsWith(DAY))?.Status;
        expect([att('edin'), att('haso')]).toEqual(['Vikend', 'Vikend']);
        await undoTurn(e.turnId, 'u1');
    });

    it('„X ne treba nikako" imenom skida dan', async () => {
        const first = env('Amer i Edin su radili kuhinju za Hamzu');
        await runTool(first, 'log_work', { lines: [{ who: 'Amer i Edin', work: 'kuhinju za Hamzu' }] });
        const e = env('Edin ne treba nikako');
        expect(await runTool(e, 'log_work', { clear: ['Edin'] })).toMatchObject({ ok: true });
        expect(ordersOf('edin')).toEqual([]);
        expect(ordersOf('amer')).toEqual(['rk']);
        await undoTurn(e.turnId, 'u1');
        await undoTurn(first.turnId, 'u1');
    });
});

describe('novi nalog: „on i Edin" je ista grupa', () => {
    it.each([
        ['A za Amera napravi novi nalog koji se zove Drago stolovi i u tom nalogu treba da on i Edin danas rade stolove', ['amer', 'edin']],
        ['Za Amera otvori nalog Drago stolovi, Edin radi s njim', ['amer', 'edin']],
        ['Za Amera otvori nalog Drago stolovi. Edin i on su jučer bili na kuhinji', ['amer']],
        ['Haso je radio kuhinju, a Amer i Edin su bili na terenu (novi nalog korekcije na Brdu)', ['amer', 'edin']],
    ])('„%s" → %j', (said, owners) => {
        const name = said.includes('korekcije') ? 'korekcije na Brdu' : 'Drago stolovi';
        expect(nameOwners(said, name, refs)?.sort()).toEqual(owners);
    });

    it('nalog se napravi i oba radnika idu na njega', async () => {
        const said = 'A za Amera napravi novi nalog koji se zove Drago stolovi i u tom nalogu treba da on i Edin danas rade stolove';
        const e = env(said);
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', new_order: { name: 'Drago stolovi' } }] })).toMatchObject({ ok: true });
        const order = docs('work_orders').find(w => w.Name === 'Drago stolovi')!;
        expect(ordersOf('amer')).toEqual([order.Work_Order_ID]);
        expect(ordersOf('edin')).toEqual([order.Work_Order_ID]);
        await undoTurn(e.turnId, 'u1');
    });
});

describe('prisustvo: imena riječima', () => {
    const att = (w: string) => docs('worker_attendance').find(a => a.Worker_ID === w && String(a.Date).startsWith(DAY))?.Status;

    it('radnik iz razgovora + rečeni → oba dobiju status', async () => {
        const e = env('Pa bio je na terenu, on i Edin', ['Šta je s Amerom?']);
        expect(await runTool(e, 'set_presence', { who: 'Amer i Edin', status: 'Teren' })).toMatchObject({ ok: true });
        expect([att('amer'), att('edin')]).toEqual(['Teren', 'Teren']);
        await undoTurn(e.turnId, 'u1');
    });

    it.each([
        ['Amra', 'nije ime nijednog radnika'],
        ['ostali', 'nema imena radnika'],
        ['Senad', 'prezime nije rečeno'],
    ])('„%s" → ne upisuje se (%s)', async (who, why) => {
        const res = await runTool(env('Senad i Amra su danas na terenu'), 'set_presence', { who, status: 'Teren' });
        expect(res).toMatchObject({ ok: false });
        expect(String((res as { error?: string }).error)).toContain(why);
    });
});

// Prvo mjerenje novog upisa (15.11.) je palo na tri mjesta u ERP-ovom čitanju posla.
describe('čitanje posla i zamjenice (nalazi prvog mjerenja)', () => {
    const t = (id: string, name: string, project = '', finished = false): DiaryTarget =>
        ({ workOrderId: id, workOrderName: name, itemId: `i-${id}`, productId: '', productName: name, projectName: project, finished });
    const targets = [
        t('new', 'Hamza stolovi'), t('old', 'Stolovi za Hamzu', '', true),
        t('rk', 'Kovač - Kuhinja', 'Zlatan Kovač - Kuća'), t('rv', 'Kovač - Vrata 2. faza', 'Zlatan Kovač - Kuća'), t('rg', 'Kovač - Garderoberi', 'Zlatan Kovač - Kuća'),
        t('rl', 'Lejla A501 - Vrata', 'Lejlin stan'),
    ];
    const ids = (q: string) => { const m = matchTargets(q, targets); return m.kind === 'ok' ? m.orders.map(o => o.workOrderId).sort() : m.kind; };

    it.each([
        ['stolovi za Hamzu', ['new'], 'otvoren nalog ispred starog završenog istog naziva'],
        ['utovar kamiona za Zlatana, sve naloge od Zlatana osim vrata', ['rg', 'rk'], 'čiji nalozi: riječi iza „sve naloge od"'],
        ['nalozi za Lejlu i Zlatan vrata', ['rl', 'rv'], '„nalozi za" nije dio naziva; dva posla'],
        ['radili na kuhinji kod Zlatana', ['rk'], 'prijedlozi i „radili" ne kvare poklapanje'],
    ])('„%s" → %j (%s)', (q, out) => expect(ids(q)).toEqual(out));

    it('„on i Edin": on je zadnji radnik imenovan u razgovoru, i u istoj poruci', async () => {
        const { pronounWorker } = require('@/lib/assistant/grounding');
        expect(pronounWorker('on i Edin', 'Kako Amer nije upisan?\nPa bio je na terenu. On i Edin su radili', refs, ['edin'])).toBe('amer');
        expect(pronounWorker('Edin s njim', 'Haso je bio na Lejli', refs, ['edin'])).toBe('haso');
        expect(pronounWorker('Amer i Edin', 'Haso je bio na Lejli', refs, [])).toBeNull();
        expect(pronounWorker('on i Edin', 'Senad je bio na terenu', refs, ['edin'])).toBeNull();   // dva Senada: ne zna se

        const e = env('Pa bio je oba dana na terenu. On i Edin su radili kuhinju za Hamzu', ['Kako Amer nije upisan za 4.11.?']);
        expect(await runTool(e, 'log_work', { lines: [{ who: 'On i Edin', work: 'kuhinju za Hamzu' }] })).toMatchObject({ ok: true });
        expect(ordersOf('amer')).toEqual(['rk']);
        expect(ordersOf('edin')).toEqual(['rk']);
        await undoTurn(e.turnId, 'u1');
    });
});

// Drugo mjerenje (15.11.): četiri mjesta gdje je ERP odbio ili pogrešno pitao.
describe('ERP ispravlja umjesto da odbije (nalazi drugog mjerenja)', () => {
    it('„sve naloge od Hamze, osim za vrata": „vrata" je izuzetak, ne proizvod bez naloga', async () => {
        store.set('products/pv', { Product_ID: 'pv', Organization_ID: 'org1', Project_ID: 'pk', Name: 'Vrata podrum', Quantity: 1 });
        const said = 'amer i edin su utovarali kamion za Hamzu, dakle stavi ih na sve naloge od Hamze, osim za vrata';
        const e = env(said);
        expect(await runTool(e, 'log_work', { lines: [{ who: 'amer i edin', work: 'utovar kamiona za Hamzu, sve naloge od Hamze osim vrata' }] })).toMatchObject({ ok: true });
        expect(e.erpQuestion).toBeUndefined();
        expect(ordersOf('amer')).toEqual(['rg', 'rk']);
        await undoTurn(e.turnId, 'u1');
        store.delete('products/pv');
    });

    it('„stavio si ih na vrata za Brdo, a ne na umivaonike": rečeni posao druge vrste nije pogrešan nalog', async () => {
        const said = 'Pa stavio si da Amer i Edin rade na vratima za Brdo, a ne na umivaonicima';
        const e = env(said);
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', work: 'umivaonici za Brdo', replace: true }] })).toMatchObject({ ok: true });
        expect(ordersOf('amer')).toEqual(['ru']);
        await undoTurn(e.turnId, 'u1');
        // Isti prigovor, a model opet šalje vrata: odbija se.
        const bad = await runTool(env(said), 'log_work', { lines: [{ who: 'Amer i Edin', work: 'vrata za Brdo', replace: true }] });
        expect(bad).toMatchObject({ ok: false });
        expect(String((bad as { error?: string }).error)).toContain('POGREŠNO upisano');
    });

    it('„novi" nalog s nazivom postojećeg je taj nalog; nalog koji nije rečen ide kao posao tekstom', async () => {
        const e = env('Amer i Edin su bili na terenu, ima nalog za Lejlina vrata vezan za to');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', new_order: { name: 'Lejla A501 - Vrata' } }] })).toMatchObject({ ok: true });
        expect(ordersOf('amer')).toEqual(['rl']);
        expect(docs('work_orders').filter(w => w.Name === 'Lejla A501 - Vrata')).toHaveLength(1);
        await undoTurn(e.turnId, 'u1');

        const soft = env('Amer i Edin su radili kuhinju za Hamzu');
        expect(await runTool(soft, 'log_work', { lines: [{ who: 'Amer i Edin', work: 'kuhinju za Hamzu', new_order: { name: 'Kuhinja Hamza nova' } }] })).toMatchObject({ ok: true });
        expect(ordersOf('edin')).toEqual(['rk']);
        expect(docs('work_orders').some(w => w.Name === 'Kuhinja Hamza nova')).toBe(false);
        await undoTurn(soft.turnId, 'u1');
    });
});

// Treće mjerenje (15.11.): dva pravila koja su obarala tačan upis.
describe('odsustvo i novi nalog ne obaraju rečeno', () => {
    it('„bili na terenu" poslano kao absent ne briše rad iz istog poziva; ko ima red rada nije odsutan', async () => {
        const e = env('Haso je radio kuhinju za Hamzu, a Amer i Edin su bili na terenu, na Lejlinim vratima');
        const res = await runTool(e, 'log_work', {
            lines: [{ who: 'Haso', work: 'kuhinju za Hamzu' }, { who: 'Amer i Edin', work: 'Lejlinim vratima' }],
            absent: [{ who: 'Amer i Edin', status: 'Teren' }, { who: 'Haso', status: 'Odsutan' }],
        });
        expect(res).toMatchObject({ ok: true, absences: 0 });
        expect(ordersOf('amer')).toEqual(['rl']);
        expect(ordersOf('haso')).toEqual(['rk']);
        await undoTurn(e.turnId, 'u1');
    });

    it('„napravi novi nalog Ormari samostan" s proizvodom kojeg nema: nalog se pravi bez proizvoda', async () => {
        const e = env('Amer i Edin danas, napravi za njih novi nalog, napiši ormari samostan. Prave dva ormara za taj samostan');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', work: 'ormari samostan', new_order: { name: 'Ormari samostan', products: ['ormar'] } }] })).toMatchObject({ ok: true });
        const order = docs('work_orders').find(w => w.Name === 'Ormari samostan')!;
        expect(ordersOf('amer')).toEqual([order.Work_Order_ID]);
        expect(e.erpQuestion).toBeUndefined();
        await undoTurn(e.turnId, 'u1');
    });
});
