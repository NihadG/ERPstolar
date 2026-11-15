/**
 * @jest-environment node
 */
// Revizija 14.11.2026 — upis rada iz prve (P-076, P-077, P-079, P-080, P-081), izmišljena imena:
//   1. dan iz poruke („u petak") važi i kad ga model ne pošalje ili ga stavi u red
//   2. „i jučer su isto" ponavlja zadnji upis iz razgovora — ERP, jednom, bez novog naloga
//   3. odbijen poziv ne ostavlja nalog koji je usput napravio
//   4. „razni poslovi" je vrsta naloga, ne naziv
//   5. dio rečenice radnika čita se iz OVE poruke; upitno „sto" nije nalog

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';

const SAT = '2026-11-14';   // subota
const FRI = '2026-11-13';
let turn = 0;
const WORKERS = [
    { alias: 'W1', value: { id: 'amer', name: 'Amer Hodžić' } },
    { alias: 'W2', value: { id: 'edin', name: 'Edin Begić' } },
    { alias: 'W3', value: { id: 'haso', name: 'Haso Mujić' } },
    { alias: 'W4', value: { id: 'tarik', name: 'Tarik Zukić' } },
];
function env(message: string, over: Partial<ToolEnv> = {}, history: string[] = []): ToolEnv {
    return {
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date(`${SAT}T08:00:00Z`),
        turnId: `r${++turn}`, dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        groundText: [...history, message].join('\n'), messageText: message, workerGround: [...history, message].join('\n'),
        ctx: {
            projects: [{ alias: 'P1', value: { id: 'pk', client: 'Kovač', name: 'Hamza Kovač - Kuća' } }],
            suppliers: [], memory: [], tasks: [], names: [], workers: WORKERS,
            orders: [
                { alias: 'R1', value: { id: 'rk', name: 'Kovač - Kuhinja' } },
                { alias: 'R2', value: { id: 'rs', name: 'Sto za Tarika' } },
                { alias: 'R3', value: { id: 'rd', name: 'Drago stolovi' } },
            ],
        },
        ...over,
    } as unknown as ToolEnv;
}
const logsOf = (w: string, day: string) => docs('work_logs').filter(l => l.Worker_ID === w && l.Date === day);
const ordersOf = (w: string, day: string) => Array.from(new Set(logsOf(w, day).map(l => l.Work_Order_ID)));

beforeAll(() => {
    for (const w of WORKERS) store.set(`workers/${w.value.id}`, { Worker_ID: w.value.id, Organization_ID: 'org1', Name: w.value.name, Daily_Rate: 100, Status: 'Aktivan' });
    store.set('projects/pk', { Project_ID: 'pk', Organization_ID: 'org1', Name: 'Hamza Kovač - Kuća', Client_Name: 'Kovač' });
    const wo = (id: string, name: string, item: string) => {
        store.set(`work_orders/${id}`, { Work_Order_ID: id, Organization_ID: 'org1', Name: name, Status: 'U toku', Work_Order_Type: 'Zadaci' });
        store.set(`work_order_items/${item}`, { ID: item, Organization_ID: 'org1', Work_Order_ID: id, Product_ID: `p-${item}`, Product_Name: name, Status: 'U toku' });
    };
    wo('rk', 'Kovač - Kuhinja', 'ik'); wo('rs', 'Sto za Tarika', 'is'); wo('rd', 'Drago stolovi', 'id');
});

describe('dan iz poruke', () => {
    it.each([
        ['model ne pošalje dan', { lines: [{ workers: ['W1', 'W2'], order: 'R3' }] }],
        ['model stavi dan u red', { lines: [{ workers: ['W1', 'W2'], order: 'R3', date: FRI }] }],
        ['model pošalje današnji dan', { date: SAT, lines: [{ workers: ['W1', 'W2'], order: 'R3' }] }],
    ])('„u petak" (rečeno u subotu), %s → upis na petak', async (_, args) => {
        const e = env('Amer i Edin su u petak radili stolove za Dragu');
        expect(await runTool(e, 'log_work', args)).toMatchObject({ ok: true });
        expect(ordersOf('amer', FRI)).toEqual(['rd']);
        expect(ordersOf('edin', FRI)).toEqual(['rd']);
        expect(logsOf('amer', SAT)).toHaveLength(0);
        await undoTurn(e.turnId, 'u1');
    });

    it('poruka bez dana: važi modelov dan iz reda (jedan), a dva dana u redovima se odbijaju', async () => {
        const e = env('Amer je radio stolove za Dragu');
        expect(await runTool(e, 'log_work', { lines: [{ workers: ['W1'], order: 'R3', date: FRI }] })).toMatchObject({ ok: true });
        expect(ordersOf('amer', FRI)).toEqual(['rd']);
        await undoTurn(e.turnId, 'u1');
        const two = await runTool(env('Amer je radio stolove za Dragu'), 'log_work', { lines: [{ workers: ['W1'], order: 'R3', date: FRI }, { workers: ['W1'], order: 'R3', date: SAT }] });
        expect(two).toMatchObject({ ok: false });
        expect(String((two as { error?: string }).error)).toContain('Jedan dan po pozivu');
    });
});

describe('„i jučer su isto"', () => {
    const book = async () => {
        const e = env('Amer i Edin danas rade kuhinju za Hamzu');
        expect(await runTool(e, 'log_work', { lines: [{ workers: ['W1', 'W2'], order: 'R1' }] })).toMatchObject({ ok: true });
        return e;
    };
    const lastWork = { date: SAT, workerIds: ['amer', 'edin'] };

    it.each([
        ['zastavica', { same_as_last: true }],
        ['model ponovo pravi nalog za iste radnike', { date: FRI, lines: [{ workers: ['W1', 'W2'], new_order: { name: 'Razni poslovi' }, work: 'Razni poslovi' }] }],
        ['model šalje iste radnike na krivi nalog', { lines: [{ workers: ['W1', 'W2'], order: 'R2' }] }],
    ])('%s → isti radnici, isti nalog, jučer; bez novog naloga', async (_, args) => {
        const first = await book();
        const e = env('i jučer su isto', { lastWork }, ['Amer i Edin danas rade kuhinju za Hamzu']);
        const res = await runTool(e, 'log_work', args);
        expect(res).toMatchObject({ ok: true, ponovljeno: 2 });
        expect(ordersOf('amer', FRI)).toEqual(['rk']);
        expect(ordersOf('edin', FRI)).toEqual(['rk']);
        expect(docs('work_orders').some(w => w.Name === 'Razni poslovi')).toBe(false);
        expect(e.summaries.join('\n')).toContain('pet 13.11.');
        // Drugi poziv u istoj poruci ne ponavlja još jednom.
        const before = docs('work_logs').length;
        await runTool(e, 'log_work', { same_as_last: true });
        expect(docs('work_logs')).toHaveLength(before);
        await undoTurn(e.turnId, 'u1');
        await undoTurn(first.turnId, 'u1');
    });

    it('ostatak poruke ide svojim danom; radnik već upisan za taj dan se ne dira', async () => {
        const first = await book();
        const pre = env('Edin je u petak radio stolove za Dragu');
        expect(await runTool(pre, 'log_work', { lines: [{ workers: ['W2'], order: 'R3' }] })).toMatchObject({ ok: true });
        const e = env('i jučer su isto.\n\ndalje, Haso danas radi stolove za Dragu', { lastWork }, ['Amer i Edin danas rade kuhinju za Hamzu']);
        expect(await runTool(e, 'log_work', { lines: [{ workers: ['W3'], order: 'R3' }], same_as_last: true })).toMatchObject({ ok: true });
        expect(ordersOf('amer', FRI)).toEqual(['rk']);
        expect(ordersOf('edin', FRI)).toEqual(['rd']);
        expect(ordersOf('haso', SAT)).toEqual(['rd']);
        expect(logsOf('haso', FRI)).toHaveLength(0);
        expect(e.summaries.join('\n')).toContain('Već upisani');
        for (const t of [e, pre, first]) await undoTurn(t.turnId, 'u1');
    });

    it('bez zadnjeg upisa u razgovoru zastavica ne upisuje ništa', async () => {
        const res = await runTool(env('i jučer su isto'), 'log_work', { same_as_last: true });
        expect(res).toMatchObject({ ok: false });
        expect(docs('work_logs')).toHaveLength(0);
    });
});

describe('novi nalog', () => {
    it('odbijen poziv ne ostavlja nalog koji je usput napravio', async () => {
        const e = env('Amer i Edin rade na novom nalogu, utovar kamiona');
        const res = await runTool(e, 'log_work', { lines: [{ workers: ['W1', 'W2'], new_order: { name: 'Utovar kamiona' } }, { workers: ['W4'], order: 'R1' }] });
        expect(res).toMatchObject({ ok: false });
        expect(docs('work_orders').some(w => w.Name === 'Utovar kamiona')).toBe(false);
        expect(docs('work_order_items').some(i => i.Product_Name === 'Utovar kamiona')).toBe(false);
        expect(e.changes).toEqual([]);
        expect(e.summaries).toEqual([]);
        // Isti poziv bez pogrešnog reda pravi nalog jednom.
        expect(await runTool(e, 'log_work', { lines: [{ workers: ['W1', 'W2'], new_order: { name: 'Utovar kamiona' } }] })).toMatchObject({ ok: true });
        expect(docs('work_orders').filter(w => w.Name === 'Utovar kamiona')).toHaveLength(1);
        await undoTurn(e.turnId, 'u1');
    });

    it.each(['Razni poslovi', 'razno', 'Novi nalog'])('„%s" je vrsta naloga, ne naziv', async name => {
        const e = env('Amer i Edin rade na novom nalogu, to je razni poslovi, Amre - Vrata');
        const res = await runTool(e, 'log_work', { lines: [{ workers: ['W1', 'W2'], new_order: { name } }] });
        expect(res).toMatchObject({ ok: false });
        expect(String((res as { error?: string }).error)).toContain('vrsta naloga');
        expect(docs('work_orders').some(w => w.Name === name)).toBe(false);
    });

    it('naziv iza vrste je naziv naloga', async () => {
        const e = env('Amer i Edin rade na novom nalogu, to je razni poslovi, Amre - Vrata');
        expect(await runTool(e, 'log_work', { lines: [{ workers: ['W1', 'W2'], new_order: { name: 'Amre - Vrata' } }] })).toMatchObject({ ok: true });
        const order = docs('work_orders').find(w => w.Name === 'Amre - Vrata')!;
        expect(ordersOf('amer', SAT)).toEqual([order.Work_Order_ID]);
        await undoTurn(e.turnId, 'u1');
    });
});

describe('dio rečenice radnika iz ove poruke', () => {
    it('prethodna poruka (pitanje) i upitno „sto" ne kvare upis', async () => {
        const question = 'Sta su jucer radili haso amer i edin';
        const e = env('Pa sto mi nisu bili ponudjeni gore u upisu\n\nUglavnom, Haso, Amer i Edin su radili na kuhinji za Hamzu', {}, [question]);
        const res = await runTool(e, 'log_work', { date: FRI, lines: [{ workers: ['W3', 'W1', 'W2'], order: 'R1' }] }) as Record<string, unknown>;
        expect(res).toMatchObject({ ok: true });
        expect(res.nije_upisano).toBeUndefined();
        expect(e.erpQuestion).toBeUndefined();
        for (const w of ['haso', 'amer', 'edin']) expect(ordersOf(w, FRI)).toEqual(['rk']);
        expect(e.summaries.join('\n')).not.toContain('Sto za Tarika');
        await undoTurn(e.turnId, 'u1');
    });
});
