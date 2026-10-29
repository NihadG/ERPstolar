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

    // PDF 29.10.: Budnja (podkonstrukcije od jele i OSB-a, iveral na podkonstrukciji) i Švicarska (umivaonici).
    const names = ['Priprema masive', 'Izrada podkonstrukcije od jele/smreke', 'Krojenje OSB-a', 'Izrada podkonstrukcije od OSB-a', 'Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija', 'Okivanje'];
    const covers: Record<string, string[]> = { 'Priprema masive': ['b1', 'b2'], 'Izrada podkonstrukcije od jele/smreke': ['b1', 'b2'], 'Krojenje OSB-a': ['b1', 'b2'], 'Izrada podkonstrukcije od OSB-a': ['b1', 'b2'] };
    const node = (n: string) => ({ id: `b-${n}`, name: n, itemIds: covers[n] || ['b1', 'b2', 'b3'] });
    const edge = (a: string, b: string) => ({ id: `${a}>${b}`, source: `b-${a}`, target: `b-${b}` });
    names.forEach((n, i) => store.set(`process_catalog/B${i}`, { ID: `B${i}`, Organization_ID: ORG, Name: n, Order: 20 + i }));
    store.set('projects/pb', { Project_ID: 'pb', Organization_ID: ORG, Client_Name: 'Budnjo', Name: 'Hoteli Budnjo', Status: 'U proizvodnji', Created_Date: '2026-09-01' });
    store.set('work_orders/wb', {
        Work_Order_ID: 'wb', Organization_ID: ORG, Name: 'Budnjo Svedski stolovi', Status: 'U toku', Work_Order_Type: 'Proizvodnja', Started_At: '2026-10-01', Created_Date: '2026-10-01',
        Process_Graph: {
            nodes: names.map(node),
            edges: [edge('Priprema masive', 'Izrada podkonstrukcije od jele/smreke'), edge('Izrada podkonstrukcije od jele/smreke', 'Sklapanje kutija'),
                edge('Krojenje OSB-a', 'Izrada podkonstrukcije od OSB-a'), edge('Izrada podkonstrukcije od OSB-a', 'Sklapanje kutija'),
                edge('Krojenje iverala', 'Kantiranje iverala'), edge('Kantiranje iverala', 'Sklapanje kutija'), edge('Sklapanje kutija', 'Okivanje')],
        },
    });
    for (const id of ['b1', 'b2', 'b3']) {
        store.set(`work_order_items/${id}`, {
            ID: id, Organization_ID: ORG, Work_Order_ID: 'wb', Product_ID: `p-${id}`, Product_Name: `Poz ${id.slice(1)} - Svedski sto`, Project_ID: 'pb', Status: 'U toku',
            Processes: names.filter(n => node(n).itemIds.includes(id)).map(n => ({ Process_Name: n, Status: 'Na čekanju' })),
        });
    }
    store.set('projects/psv', { Project_ID: 'psv', Organization_ID: ORG, Client_Name: 'Švicarska', Name: 'Švicarska', Status: 'U proizvodnji', Created_Date: '2026-09-01' });
    store.set('work_orders/wu', { Work_Order_ID: 'wu', Organization_ID: ORG, Name: 'Umivaonici, 1. faza', Status: 'U toku', Work_Order_Type: 'Proizvodnja', Started_At: '2026-10-01', Created_Date: '2026-10-01' });
    store.set('work_order_items/u1', { ID: 'u1', Organization_ID: ORG, Work_Order_ID: 'wu', Product_ID: 'p-u1', Product_Name: 'WHG 0.1 Waschtisch Bad', Project_ID: 'psv', Status: 'U toku' });
    store.set('products/p-u1', { Product_ID: 'p-u1', Organization_ID: ORG, Project_ID: 'psv', Name: 'WHG 0.1 Waschtisch Bad', Quantity: 1 });
    store.set('product_materials/um1', { ID: 'um1', Organization_ID: ORG, Product_ID: 'p-u1', Material_Name: 'Iveral / U960 ST9 Onyx siva', Quantity: 0.4, Unit: 'Kom', Unit_Price: 0, Total_Price: 0, Status: 'Na stanju', Supplier: 'Elgrad' });
    store.set('product_materials/um2', { ID: 'um2', Organization_ID: ORG, Product_ID: 'p-u1', Material_Name: 'KT / U960 ST9 23/2', Quantity: 24.5, Unit: 'm', Unit_Price: 0, Total_Price: 0, Status: 'Nije naručeno', Supplier: 'Elgrad' });
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

    it('PDF 29.10. Budnja: podkonstrukcije gotove, iveral skrojen, u toku montaža iverala → procesi kroz graf', async () => {
        const { calls, out } = await say('Za budnju su napravljene sve podkonstrukcije od jele smreke, i sve podkonstrukcije od osb, skrojen sav iveral i u toku je montaza iverala na podkonstrukcije');
        expect(calls.map(c => c.name)).toContain('set_progress');
        const st = (id: string, p: string) => item(id).Processes?.find((x: any) => x.Process_Name === p)?.Status;
        expect(st('b1', 'Izrada podkonstrukcije od jele/smreke')).toBe('Završeno');
        expect(st('b1', 'Izrada podkonstrukcije od OSB-a')).toBe('Završeno');
        expect(st('b1', 'Krojenje iverala')).toBe('Završeno');
        expect(st('b3', 'Kantiranje iverala')).toBe('Završeno');
        expect(st('b1', 'Sklapanje kutija')).toBe('U toku');
        expect(item('b3').Processes.map((p: any) => p.Process_Name)).not.toContain('Izrada podkonstrukcije od OSB-a');
        expect(logsToday()).toEqual([]);
        expect(out.reply).not.toMatch(/nije u katalogu|Ako želiš/i);
    });

    it('PDF 29.10. Švicarska: „Koji iveral smo koristili (koji dekor)" → dekor iz sastavnice, ne „nemam zapisano"', async () => {
        const { all, out } = await say('Koji iveral smo koristili za švicarsku umivaonike (koji dekor)');
        expect(all.map(c => c.name)).toContain('product_materials');
        expect(out.reply).toMatch(/U960/);
        expect(out.reply).not.toMatch(/nemam zapisan/i);
    });

    it('„Amer i Kerim krojili iveral za kuhinju Čorluka" → Knjiga rada za oba', async () => {
        await say('Amer i Kerim krojili iveral za kuhinju Čorluka');
        expect(logsToday().map(l => l.Worker_ID).sort()).toEqual(['amer', 'kerim']);
        expect(logsToday().every(l => l.Work_Order_ID === 'c1')).toBe(true);
    });
});

run('bilježnica: stvarne poruke od 26.10. (pravi model)', () => {
    jest.setTimeout(120_000);
    beforeAll(() => { process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo'; });
    beforeEach(seed);
    const mem = () => docs('memory_items').filter(m => m.Organization_ID === ORG);
    const sayIn = async (text: string, session: any) => {
        const out = await runAssistant({ orgId: ORG, uid: 'u1', text, session, now: NOW });
        return out;
    };

    it('„U e108 pogresno postavljeno ogledalo, treba 1100x1000. I ima u tom stanu ogledalo 1000x800" → dvije stavke u E108', async () => {
        const out = await sayIn('U e108 pogresno postavljeno ogledalo, treba 1100x1000.\n\nI ima u tom stanu ogledalo 1000x800', { history: [], pending: null });
        expect(out.outcome).toBe('written');
        expect(mem().map(m => `${m.Title}|${m.Location}`).sort()).toEqual(['Ogledalo 1000x800|E108', 'Ogledalo 1100x1000|E108']);
    });

    it('E308 glasom: četiri mjere + širina → pet stavki, ništa izgubljeno', async () => {
        const out = await sayIn('U stanu E308 imam jedno ogledalo široko 800 milimetara, a nisam postavio jedno ogledalo 1000 puta 1100, jedno ogledalo 800 puta 900 i jedno ogledalo 800 puta 900 i jedan gornji 1100 širine.', { history: [], pending: null });
        expect(out.outcome).toBe('written');
        expect(out.reply).not.toMatch(/nije upisano/);
        const qty = mem().filter(m => m.Location === 'E308').reduce((s, m) => s + (m.Quantity || 1), 0);
        expect(qty).toBe(5);
    });

    it('C604: „imam 1720x1000, a fali 1000x1350" → dvije stavke', async () => {
        await sayIn('U c604 imam ogledalo 1720x1000, a fali 1000x1350', { history: [], pending: null });
        expect(mem().filter(m => m.Location === 'C604').map(m => m.Title).sort()).toEqual(['Ogledalo 1000x1350', 'Ogledalo 1720x1000']);
    });

    it('nastavak: „I još jedno ogledalo na istom hodniku (1000x1350)" → hodnik iz prethodne poruke', async () => {
        const first = await sayIn('I na hodniku e4 imam dva ogledala 1000x1350', { history: [], pending: null });
        await sayIn('I jos jedno pgledalo na istom hodniku (1000x1350)', first.session);
        const onHall = mem().filter(m => /E4/.test(m.Location || ''));
        expect(onHall.reduce((s, m) => s + (m.Quantity || 1), 0)).toBe(3);
    });
});

it('provjera sa stvarnim modelom se pokreće samo izričito', () => {
    expect(typeof live).toBe('boolean');
});
