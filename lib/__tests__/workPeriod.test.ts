/**
 * @jest-environment node
 */
// Revizija 20.11.2026 (P-091, P-092), izmišljena imena:
//   1. period rada rečen riječima → dani (ERP čita, model samo prepiše)
//   2. log_work s periodom: svaka grupa svoje dane, kraći period ima prednost, rečeno zamjenjuje
//      botov raniji upis; „kao ranije" za period = nalog prije perioda; „popuni prazne dane"
//   3. novi nalog čiji naziv liči na proizvode iz ponude → pitanje dugmadima, ne tihi proizvodni nalog

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';
import { workPeriod } from '@/lib/assistant/workDay';

const FRI = '2026-11-20';
const MON = '2026-11-16', TUE = '2026-11-17', WED = '2026-11-18', THU = '2026-11-19';
const WEEK = [MON, TUE, WED, THU, FRI];

describe('period iz riječi', () => {
    it.each([
        ['cijelu sedmicu', WEEK],
        ['ove sedmice (a i danas)', WEEK],
        ['cijela sedmica', WEEK],
        ['ovu sedmicu', WEEK],
        ['od srijede', [WED, THU, FRI]],
        ['od ponedjeljka do srijede', [MON, TUE, WED]],
        ['ponedjeljak do srijede', [MON, TUE, WED]],
        ['srijedu, četvrtak i danas', [WED, THU, FRI]],
        ['srijedu cetvrtak i danas', [WED, THU, FRI]],
        ['u ponedjeljak', [MON]],
        ['jučer i danas', [THU, FRI]],
        ['danas', [FRI]],
        ['18.11. i 19.11.', [WED, THU]],
        ['prošle sedmice', ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']],
    ])('„%s"', (said, want) => {
        expect(workPeriod(said, FRI)).toEqual(want);
    });

    it.each(['umivaonici za švicarsku', 'kao i ranije', 'do petka', ''])('„%s" nije period', said => {
        expect(workPeriod(said, FRI)).toBeNull();
    });

    it('raspon ne ide preko danas i preskače vikend; subota rečena imenom ostaje', () => {
        expect(workPeriod('cijelu sedmicu', '2026-11-18')).toEqual([MON, TUE, '2026-11-18']);
        expect(workPeriod('cijelu sedmicu', '2026-11-21')).toEqual(WEEK);
        expect(workPeriod('od petka', '2026-11-23')).toEqual(['2026-11-20', '2026-11-23']);
        expect(workPeriod('u subotu', '2026-11-23')).toEqual(['2026-11-21']);
    });
});

let turn = 0;
const WORKERS = [
    { alias: 'W1', value: { id: 'amer', name: 'Amer Hodžić' } },
    { alias: 'W2', value: { id: 'edin', name: 'Edin Begić' } },
    { alias: 'W3', value: { id: 'haso', name: 'Haso Mujić' } },
    { alias: 'W4', value: { id: 'tarik', name: 'Tarik Zukić' } },
    { alias: 'W5', value: { id: 'zlatan', name: 'Zlatan Kurt' } },
];
const ORDERS = [
    { alias: 'R1', value: { id: 'ru', name: 'Umivaonici Alpe 1. faza' } },
    { alias: 'R2', value: { id: 'rs', name: 'Brdo švedski stolovi' } },
    { alias: 'R3', value: { id: 'rv', name: 'Lejla - vrata' } },
];
function env(message: string, over: Partial<ToolEnv> = {}, history: string[] = []): ToolEnv {
    return {
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date(`${FRI}T08:00:00Z`),
        turnId: `p${++turn}`, dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        groundText: [...history, message].join('\n'), messageText: message, workerGround: [...history, message].join('\n'),
        talkText: history.join('\n'),
        ctx: {
            projects: [{ alias: 'P1', value: { id: 'pb', client: 'Brdo', name: 'Brdo - Recepcija' } }],
            suppliers: [], memory: [], tasks: [], names: [], workers: WORKERS, orders: ORDERS,
        },
        ...over,
    } as unknown as ToolEnv;
}
const logsOf = (w: string, day: string) => docs('work_logs').filter(l => l.Worker_ID === w && String(l.Date).slice(0, 10) === day && !l.Work_Order_Deleted);
const ordersOf = (w: string, day: string) => Array.from(new Set(logsOf(w, day).map(l => l.Work_Order_ID))).sort();
const week = (w: string) => WEEK.map(d => ordersOf(w, d).join('+') || '-');

beforeAll(() => {
    for (const w of WORKERS) store.set(`workers/${w.value.id}`, { Worker_ID: w.value.id, Organization_ID: 'org1', Name: w.value.name, Daily_Rate: 100, Status: 'Aktivan' });
    store.set('projects/pb', { Project_ID: 'pb', Organization_ID: 'org1', Name: 'Brdo - Recepcija', Client_Name: 'Brdo' });
    for (const [id, name] of [['p-ob1', 'Poz 4 - Obloge stubova'], ['p-ob2', 'Poz 8 - Obloga lifta']]) {
        store.set(`products/${id}`, { Product_ID: id, Organization_ID: 'org1', Project_ID: 'pb', Name: name, Quantity: 1, Status: 'Na čekanju' });
    }
    for (const o of ORDERS) {
        store.set(`work_orders/${o.value.id}`, { Work_Order_ID: o.value.id, Organization_ID: 'org1', Name: o.value.name, Status: 'U toku', Work_Order_Type: 'Zadaci' });
        store.set(`work_order_items/i-${o.value.id}`, { ID: `i-${o.value.id}`, Organization_ID: 'org1', Work_Order_ID: o.value.id, Product_ID: `p-${o.value.id}`, Product_Name: o.value.name, Status: 'U toku' });
    }
});

describe('log_work s periodom', () => {
    it('„cijelu sedmicu umivaonici, a danas Haso stolove" → svaki dan; kraći period ima prednost; jedna potvrda', async () => {
        const e = env('Amer, Edin i Haso su cijelu sedmicu radili umivaonike za Alpe, Haso je danas jedino radio švedske stolove za Brdo');
        const res = await runTool(e, 'log_work', { lines: [
            { who: 'Amer, Edin i Haso', work: 'umivaonici za Alpe', days: 'cijelu sedmicu' },
            { who: 'Haso', work: 'švedski stolovi za Brdo', days: 'danas' },
        ] });
        expect(res).toMatchObject({ ok: true });
        expect(week('amer')).toEqual(['ru', 'ru', 'ru', 'ru', 'ru']);
        expect(week('haso')).toEqual(['ru', 'ru', 'ru', 'ru', 'rs']);
        const text = e.summaries.join('\n');
        expect(text).toContain('📒 Knjiga rada, pon–pet 16.–20.11.');
        expect(text).toContain('Haso — pon–čet 16.–19.11. · Umivaonici Alpe 1. faza; pet 20.11. · Brdo švedski stolovi');
        expect(text.match(/📒/g)).toHaveLength(1);
        await undoTurn(e.turnId, 'u1');
        expect(docs('work_logs').filter(l => !l.Work_Order_Deleted)).toHaveLength(0);
    });

    it('ispravka perioda zamjenjuje botov raniji upis („nisu oni bili na tom nalogu")', async () => {
        const wrong = env('Amer i Edin su od srijede radili vrata za Lejlu');
        await runTool(wrong, 'log_work', { lines: [{ who: 'Amer i Edin', work: 'vrata za Lejlu', days: 'od srijede' }] });
        expect(week('amer')).toEqual(['-', '-', 'rv', 'rv', 'rv']);
        const fix = env('nisu oni radili na tom nalogu, Amer i Edin su od srijede radili umivaonike za Alpe');
        expect(await runTool(fix, 'log_work', { lines: [{ who: 'Amer i Edin', work: 'umivaonici za Alpe', days: 'od srijede' }] })).toMatchObject({ ok: true });
        expect(week('amer')).toEqual(['-', '-', 'ru', 'ru', 'ru']);
        expect(week('edin')).toEqual(['-', '-', 'ru', 'ru', 'ru']);
        await undoTurn(fix.turnId, 'u1');
        await undoTurn(wrong.turnId, 'u1');
    });

    it('„na istom nalogu kao ranije, popuni prazne dane ove sedmice" → nalog zadnjeg dana prije praznih; upisani se ne diraju', async () => {
        const mon = env('Tarik i Zlatan su u ponedjeljak i utorak radili umivaonike za Alpe');
        await runTool(mon, 'log_work', { lines: [{ who: 'Tarik i Zlatan', work: 'umivaonici za Alpe', days: 'u ponedjeljak i utorak' }] });
        const e = env('Tarik i Zlatan rade na istom nalogu kao i ranije, popuni sve dane ove sedmice koji nisu popunjeni');
        const res = await runTool(e, 'log_work', { only_empty: true, lines: [{ who: 'Tarik i Zlatan', like_last: true, days: 'ove sedmice' }] });
        expect(res).toMatchObject({ ok: true });
        expect(week('tarik')).toEqual(['ru', 'ru', 'ru', 'ru', 'ru']);
        expect(week('zlatan')).toEqual(['ru', 'ru', 'ru', 'ru', 'ru']);
        await undoTurn(e.turnId, 'u1');
        await undoTurn(mon.turnId, 'u1');
    });

    it('period koji poruka ne kaže se ne upisuje (model ga je dodao)', async () => {
        const e = env('Amer je danas radio umivaonike za Alpe');
        const res = await runTool(e, 'log_work', { lines: [{ who: 'Amer', work: 'umivaonici za Alpe', days: 'cijelu sedmicu' }] });
        expect(res).toMatchObject({ ok: true });
        expect(week('amer')).toEqual(['-', '-', '-', '-', 'ru']);
        await undoTurn(e.turnId, 'u1');
    });

    it('red bez days ide na dan iz poruke, kao i prije', async () => {
        const e = env('Amer danas radi umivaonike za Alpe');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer', work: 'umivaonici za Alpe' }] })).toMatchObject({ ok: true });
        expect(week('amer')).toEqual(['-', '-', '-', '-', 'ru']);
        expect(e.summaries.join('\n')).toContain('📒 Knjiga rada, danas');
        await undoTurn(e.turnId, 'u1');
    });
});

describe('novi nalog čiji naziv liči na proizvode iz ponude', () => {
    it.each([
        ['napravi nalog Brdo - Korekcije i ugradnja obloga', 'Brdo - Korekcije i ugradnja obloga'],
        ['za njih napravi novi nalog Brdo preostale obloge', 'Brdo preostale obloge'],
        ['napravi nalog Popravke obloga Brdo', 'Popravke obloga Brdo'],
    ])('„%s" → pitanje dugmadima, nalog se ne pravi tiho', async (said, name) => {
        const e = env(`Amer i Edin su danas bili na Brdu, ${said}`);
        const res = await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', new_order: { name, project: 'P1' }, work: name }] });
        expect(res).toMatchObject({ ok: true });
        expect(docs('work_orders').some(w => w.Name === name)).toBe(false);
        const q = (e as unknown as { erpQuestion?: { question: string; options: { label: string; args: Record<string, unknown> }[] } }).erpQuestion!;
        expect(q.options.map(o => o.label)).toEqual([expect.stringContaining('Razni poslovi'), expect.stringContaining('Proizvodni'), 'Preskoči']);
        // Dugme „Razni poslovi" → posao bez proizvoda (…/Z), proizvodi ponude ostaju „Na čekanju".
        const tap = env('', { messageText: undefined, groundText: undefined, workerGround: undefined });
        expect(await runTool(tap, 'log_work', q.options[0].args)).toMatchObject({ ok: true });
        const wo = docs('work_orders').find(w => w.Name === name)!;
        expect(wo.Work_Order_Type).toBe('Zadaci');
        expect(docs('products').every(p => p.Status === 'Na čekanju')).toBe(true);
        expect(ordersOf('amer', FRI)).toEqual([wo.Work_Order_ID]);
        await undoTurn(tap.turnId, 'u1');
    });

    it('naziv bez riječi rada na terenu („napravi nalog Obloge Brdo") → proizvodni s proizvodima, kao i prije', async () => {
        const e = env('Amer i Edin rade obloge, napravi nalog Obloge Brdo');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', new_order: { name: 'Obloge Brdo', project: 'P1' }, work: 'Obloge Brdo' }] })).toMatchObject({ ok: true });
        expect(docs('work_orders').find(w => w.Name === 'Obloge Brdo')?.Work_Order_Type).toBe('Proizvodnja');
        await undoTurn(e.turnId, 'u1');
    });

    it('odgovor tekstom („brdo korekcije su razni poslovi nalog") → posao bez proizvoda, bez ponovnog pitanja', async () => {
        const e = env('o čemu pričaš, brdo korekcije su razni poslovi nalog', {}, ['Amer i Edin su danas na Brdu, napravi nalog Brdo - Korekcije i ugradnja obloga']);
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', new_order: { name: 'Brdo - Korekcije i ugradnja obloga', project: 'P1' }, work: 'Brdo - Korekcije i ugradnja obloga' }] })).toMatchObject({ ok: true });
        expect((e as unknown as { erpQuestion?: unknown }).erpQuestion).toBeUndefined();
        expect(docs('work_orders').find(w => w.Name === 'Brdo - Korekcije i ugradnja obloga')?.Work_Order_Type).toBe('Zadaci');
        await undoTurn(e.turnId, 'u1');
    });

    it('„razni poslovi" rečeno uz naziv → odmah posao bez proizvoda, bez pitanja', async () => {
        const e = env('Amer i Edin su danas na novom nalogu, razni poslovi „Obloge Brdo popravke"');
        expect(await runTool(e, 'log_work', { lines: [{ who: 'Amer i Edin', new_order: { name: 'Obloge Brdo popravke', project: 'P1' }, work: 'Obloge Brdo popravke' }] })).toMatchObject({ ok: true });
        expect(docs('work_orders').find(w => w.Name === 'Obloge Brdo popravke')?.Work_Order_Type).toBe('Zadaci');
        await undoTurn(e.turnId, 'u1');
    });
});
