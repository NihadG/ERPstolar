/**
 * @jest-environment node
 */
// PROVJERA SA STVARNIM MODELOM — stvarne rečenice iz Telegrama, pravi Haiku,
// memorijska baza. Za svaku rečenicu: koji sloj je upisan i šta NIJE dirano.
// Košta nekoliko centi po prolazu, pa se pokreće samo izričito:
//
//   ASSISTANT_EVAL=1 ANTHROPIC_API_KEY=… npx jest lib/__tests__/assistantEval.real.test.ts
//
// Svaka izmjena bota (upute, alati) treba proći ovaj skup prije nego ide korisniku.
// Nova rečenica koja je zbunila bota → novi slučaj ovdje.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

const mockCalls: { name: string; args: Record<string, any>; ok: boolean }[] = [];
jest.mock('@/lib/assistant/tools', () => {
    const actual = jest.requireActual('@/lib/assistant/tools');
    return {
        ...actual,
        runTool: async (env: any, name: string, args: any) => {
            const out = await actual.runTool(env, name, args);
            mockCalls.push({ name, args, ok: out.ok !== false });
            return out;
        },
    };
});

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runAssistant } from '@/lib/assistant/brain';

const ORG = 'orgE';
const NOW = new Date('2026-10-27T13:00:00Z');   // utorak 14:00 u Sarajevu
const TODAY = '2026-10-27';
const live = process.env.ASSISTANT_EVAL === '1' && !!process.env.ANTHROPIC_API_KEY;
const run = live ? describe : describe.skip;

function seed() {
    store.clear();
    ['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija', 'Lakiranje', 'Okivanje', 'Pakovanje']
        .forEach((n, i) => store.set(`process_catalog/E${i}`, { ID: `E${i}`, Organization_ID: ORG, Name: n, Order: i + 1 }));
    for (const [id, name] of [['bego', 'Bego Saka'], ['ahmad', 'Ahmad Al-Masaud'], ['amer', 'Amer Berisalić'], ['kerim', 'Kerim Alić'], ['dido', 'Dido']]) {
        store.set(`workers/${id}`, { Worker_ID: id, Organization_ID: ORG, Name: name, Daily_Rate: 100, Status: 'Aktivan' });
    }
    store.set('projects/pc', { Project_ID: 'pc', Organization_ID: ORG, Client_Name: 'Jerko Čorluka', Name: 'Čorluka kuća', Status: 'U proizvodnji', Created_Date: '2026-08-01' });
    store.set('projects/pi', { Project_ID: 'pi', Organization_ID: ORG, Client_Name: 'Igor', Name: 'Sto za Igora', Status: 'U proizvodnji', Created_Date: '2026-09-01' });
    const chain = (p: string, names: string[]) => ({
        nodes: names.map((name, i) => ({ id: `${p}${i}`, name, itemIds: [] })),
        edges: names.slice(1).map((_, i) => ({ id: `${p}e${i}`, source: `${p}${i}`, target: `${p}${i + 1}` })),
    });
    const wo = (id: string, name: string, graph?: unknown) => store.set(`work_orders/${id}`, {
        Work_Order_ID: id, Organization_ID: ORG, Name: name, Status: 'U toku', Work_Order_Type: 'Proizvodnja', Started_At: '2026-09-01', Created_Date: '2026-09-01', ...(graph ? { Process_Graph: graph } : {}),
    });
    wo('c1', 'Corluka - Kuhinja', chain('k', ['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija', 'Lakiranje', 'Okivanje']));
    wo('c2', 'Corluka - Ostrvo', chain('o', ['Krojenje iverala', 'Lakiranje']));
    wo('c3', 'Corluka - Vrata', chain('v', ['Lakiranje', 'Okivanje']));
    wo('s1', 'Sto za Igora');
    const it = (id: string, woId: string, product: string, project: string) => store.set(`work_order_items/${id}`, {
        ID: id, Organization_ID: ORG, Work_Order_ID: woId, Product_ID: `p-${id}`, Product_Name: product, Project_ID: project, Status: 'U toku',
    });
    it('ck', 'c1', 'Donji elementi', 'pc'); it('co', 'c2', 'Ostrvo', 'pc'); it('cv', 'c3', 'Vrata', 'pc'); it('si', 's1', 'Sto', 'pi');
    const log = (id: string, worker: string, date: string, woId: string, itemId: string) => store.set(`work_logs/${id}`, {
        WorkLog_ID: id, Organization_ID: ORG, Date: date, Worker_ID: worker, Worker_Name: worker, Daily_Rate: 100, Original_Daily_Rate: 100,
        Day_Fraction: 1, Presence: 1, Split_Factor: 1, Work_Order_ID: woId, Work_Order_Item_ID: itemId, Product_ID: `p-${itemId}`,
        Booking_Source: 'attendance', Is_From_Attendance: true,
    });
    log('h1', 'amer', '2026-10-22', 'c1', 'ck'); log('h2', 'amer', '2026-09-28', 'c2', 'co');
    log('h3', 'bego', '2026-10-25', 'c3', 'cv'); log('h4', 'kerim', '2026-10-23', 's1', 'si');
}

async function say(text: string) {
    mockCalls.length = 0;
    const out = await runAssistant({ orgId: ORG, uid: 'u1', text, session: { history: [], pending: null }, now: NOW });
    return { out, calls: mockCalls.filter(c => c.ok), all: [...mockCalls] };
}
const logsToday = () => docs('work_logs').filter(l => l.Organization_ID === ORG && l.Date === TODAY);
const item = (id: string) => docs('work_order_items').find(i => i.Organization_ID === ORG && i.ID === id)!;

run('stvarne rečenice → pravi sloj (pravi model)', () => {
    jest.setTimeout(120_000);
    beforeAll(() => { process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo'; });
    beforeEach(seed);

    it('„Svi proizvodi za Čorluku osim vrata su završeni na zadnji datum…" → Procesi, bez Knjige rada', async () => {
        const { calls } = await say('Svi proizvodi za corluku osim vrata su zavrseni na zadnji datum kad je radjeno na njima');
        expect(calls.map(c => c.name)).toContain('set_progress');
        expect(logsToday()).toEqual([]);
        expect(item('ck')).toMatchObject({ Status: 'Završeno', Completed_At: '2026-10-22T15:00:00.000Z' });
        expect(item('co')).toMatchObject({ Status: 'Završeno', Completed_At: '2026-09-28T15:00:00.000Z' });
        expect(item('cv').Status).toBe('U toku');
    });

    it('„Moraš zabilježiti da su svi prisutni" → Prisustvo; nijedan izmišljen nalog', async () => {
        const { calls } = await say('Moraš zabilježiti da su svi prisutni');
        expect(calls.map(c => c.name)).toEqual(['set_presence']);
        expect(docs('worker_attendance').filter(a => a.Date === TODAY)).toHaveLength(5);
        expect(logsToday().filter(l => l.Booking_Source !== 'attendance')).toEqual([]);
    });

    it('„Bego danas pakuje sve proizvode za Čorluku osim vrata" → Knjiga rada za Begu + pakovanje u toku', async () => {
        const { calls } = await say('Bego danas pakuje sve proizvode za Čorluku osim vrata');
        expect(calls.map(c => c.name)).toContain('log_work');
        expect(Array.from(new Set(logsToday().map(l => l.Worker_ID)))).toEqual(['bego']);
        expect(logsToday().some(l => l.Work_Order_ID === 'c3')).toBe(false);
        expect(item('ck').Processes.find((p: any) => p.Process_Name === 'Pakovanje')).toMatchObject({ Status: 'U toku' });
        expect(item('ck').Status).toBe('U toku');
    });

    it('„Bego zapakovao sve za Čorluku osim vrata" → proizvodi završeni', async () => {
        await say('Bego zapakovao sve za Čorluku osim vrata');
        expect(item('ck').Status).toBe('Završeno');
        expect(item('cv').Status).toBe('U toku');
    });

    it('„Kerim bolovanje" → samo prisustvo', async () => {
        await say('Kerim bolovanje');
        expect(docs('worker_attendance').find(a => a.Worker_ID === 'kerim' && a.Date === TODAY)).toMatchObject({ Status: 'Bolovanje' });
        expect(logsToday()).toEqual([]);
    });

    it('„Kuhinja Čorluka je ušla u lakiranje" → Procesi (u toku), bez rada', async () => {
        const { calls } = await say('Kuhinja Čorluka je ušla u lakiranje');
        expect(calls.map(c => c.name)).toContain('set_progress');
        expect(logsToday()).toEqual([]);
        expect(item('ck').Processes.find((p: any) => p.Process_Name === 'Lakiranje')).toMatchObject({ Status: 'U toku' });
    });

    it('„Kad se zadnji put radilo na Čorluki?" → čitanje stanja, ništa upisano', async () => {
        const { all, out } = await say('Kad se zadnji put radilo na Čorluki?');
        expect(all.map(c => c.name)).toContain('order_status');
        expect(all.every(c => !['log_work', 'set_progress', 'set_presence', 'fill_work_days'].includes(c.name))).toBe(true);
        expect(out.reply).toMatch(/25\.10\.|22\.10\./);
    });

    it('„Amer i Kerim krojili iveral za kuhinju Čorluka" → Knjiga rada za oba', async () => {
        await say('Amer i Kerim krojili iveral za kuhinju Čorluka');
        expect(logsToday().map(l => l.Worker_ID).sort()).toEqual(['amer', 'kerim']);
        expect(logsToday().every(l => l.Work_Order_ID === 'c1')).toBe(true);
    });
});

it('provjera sa stvarnim modelom se pokreće samo izričito', () => {
    expect(typeof live).toBe('boolean');
});
