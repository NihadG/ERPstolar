/**
 * @jest-environment node
 */
// Dnevni upis rada preko asistenta, od alata do baze: prisustvo, dnevnice s
// udjelom dana, zamjena automatske podjele, graf naloga, čekiranje, katalog,
// pitanja kad posao/proces nije jasan, odsustvo, pregled i ↩️ Poništi.

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { undoTurn } from '@/lib/assistant/store';
import { renormalizeWorkerDay } from '@/lib/server/fieldAttendance';

const DAY = '2026-10-24';
let turn = 0;
function env(): ToolEnv {
    return {
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date(`${DAY}T15:00:00Z`),
        turnId: `t${++turn}`, dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ctx: {
            projects: [], suppliers: [], memory: [], tasks: [], names: [],
            workers: [
                { alias: 'W1', value: { id: 'amer', name: 'Amer' } },
                { alias: 'W2', value: { id: 'kerim', name: 'Kerim' } },
                { alias: 'W3', value: { id: 'edin', name: 'Edin' } },
                { alias: 'W4', value: { id: 'imer', name: 'Imer' } },
            ],
        },
    } as unknown as ToolEnv;
}
const logsOf = (worker: string) => docs('work_logs').filter(l => l.Worker_ID === worker && l.Date === DAY);
const wo = (id: string) => docs('work_orders').find(w => w.Work_Order_ID === id)!;
const item = (id: string) => docs('work_order_items').find(i => i.ID === id)!;
const att = (worker: string) => docs('worker_attendance').filter(a => a.Worker_ID === worker && a.Date === DAY);

beforeAll(() => {
    const w = (id: string, name: string, rate: number) => store.set(`workers/${id}`, { Worker_ID: id, Organization_ID: 'org1', Name: name, Daily_Rate: rate, Status: 'Aktivan' });
    w('amer', 'Amer', 100); w('kerim', 'Kerim', 80); w('edin', 'Edin', 90); w('imer', 'Imer', 100);
    store.set('projects/c', { Project_ID: 'pc', Organization_ID: 'org1', Name: 'Jerko Čorluka - Kuća', Client_Name: 'Čorluka' });
    store.set('projects/m', { Project_ID: 'pm', Organization_ID: 'org1', Name: 'Melihin stan', Client_Name: 'Meliha' });
    store.set('work_orders/r7', { Work_Order_ID: 'r7', Organization_ID: 'org1', Name: 'Corluka - Kuhinja', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
        Process_Graph: { nodes: [{ id: 'kr', name: 'Krojenje Iverala', itemIds: [] }], edges: [] } });
    store.set('work_orders/r5', { Work_Order_ID: 'r5', Organization_ID: 'org1', Name: 'Corluka - Gardaroberi u djecijoj sobi', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
        Process_Graph: { nodes: [{ id: 'k5', name: 'Krojenje Iverala', itemIds: [] }, { id: 'ka', name: 'Kantiranje', itemIds: [] }], edges: [{ id: 'e', source: 'k5', target: 'ka' }] } });
    store.set('work_orders/r3', { Work_Order_ID: 'r3', Organization_ID: 'org1', Name: 'Meliha A501 - Vrata', Status: 'Na čekanju', Work_Order_Type: 'Proizvodnja' });
    store.set('work_orders/z21', { Work_Order_ID: 'z21', Organization_ID: 'org1', Name: 'Montaža vrata E5', Status: 'U toku', Work_Order_Type: 'Zadaci',
        Process_Graph: { nodes: [{ id: 'rad', name: 'Rad', itemIds: [] }], edges: [] } });
    const it = (id: string, woId: string, product: string, project: string, extra: Record<string, unknown> = {}) =>
        store.set(`work_order_items/${id}`, { ID: id, Organization_ID: 'org1', Work_Order_ID: woId, Product_ID: `p-${id}`, Product_Name: product, Project_ID: project, Status: 'U toku', ...extra });
    it('k1', 'r7', 'Donji elementi', 'pc'); it('k2', 'r7', 'Gornji elementi', 'pc');
    it('g1', 'r5', 'Gardarober', 'pc', { Processes: [{ Process_Name: 'Krojenje Iverala', Status: 'Završeno' }, { Process_Name: 'Kantiranje', Status: 'Na čekanju' }] });
    it('m1', 'r3', 'Vrata sobna', 'pm', { Status: 'Na čekanju' });
    it('e1', 'z21', 'Montaža vrata E5', '', { Item_Type: 'custom' });
    ['Krojenje Iverala', 'Kantiranje', 'Farbanje i lakiranje'].forEach((n, i) =>
        store.set(`process_catalog/c${i}`, { ID: `c${i}`, Organization_ID: 'org1', Name: n, Order: i + 1 }));
    // Automatska podjela iz šihtarice za Amera tog dana (pogođen proces) — diktat je mijenja.
    store.set('work_logs/auto1', { WorkLog_ID: 'auto1', Organization_ID: 'org1', Date: DAY, Worker_ID: 'amer', Worker_Name: 'Amer',
        Daily_Rate: 100, Original_Daily_Rate: 100, Day_Fraction: 1, Presence: 1, Split_Factor: 1, Hours_Worked: 8,
        Booking_Source: 'attendance', Is_From_Attendance: true, Work_Order_ID: 'r5', Work_Order_Item_ID: 'g1', Product_ID: 'p-g1', Process_Name: 'Kantiranje' });
});

describe('pitanja prije upisa — ništa se ne upisuje dok nije jasno', () => {
    it('„Čorluka" bez posla → kandidati R#, nijedan zapis', async () => {
        const e = env();
        const res = await runTool(e, 'log_work', { lines: [{ workers: ['W1'], work: 'Čorluka', process: 'krojenje iverala' }] });
        expect(res.ok).toBe(false);
        // Bez liste NALOZI u kontekstu kandidati dobiju privremene oznake RK#.
        expect(res.error).toMatch(/pogađa više naloga.*RK1 .*RK2 /s);
        expect(logsOf('amer').map(l => l.WorkLog_ID)).toEqual(['auto1']);
        // Ponovo s izabranim nalogom.
        const kuhinja = e.diaryCandidates!.find(c => c.value === 'r7')!.alias;
        const ok = await runTool(e, 'log_work', { lines: [{ workers: ['W1'], work: 'Čorluka', order: kuhinja, process: 'krojenje iverala' }] });
        expect(ok.ok).toBe(true);
        await undoTurn(e.turnId, 'u1');
        expect(logsOf('amer').map(l => l.WorkLog_ID)).toEqual(['auto1']);
    });

    it('nepoznat proces → pitanje; ništa upisano', async () => {
        const res = await runTool(env(), 'log_work', { lines: [{ workers: ['W4'], work: 'montaža vrata E5', process: 'montaža' }] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/„montaža" nije u katalogu/) });
        expect(logsOf('imer')).toHaveLength(0);
    });

    it('rad unaprijed, nepoznat radnik i loš udio su greške', async () => {
        expect((await runTool(env(), 'log_work', { date: '2026-10-25', lines: [{ workers: ['W1'], work: 'kuhinja Čorluka' }] })).ok).toBe(false);
        expect((await runTool(env(), 'log_work', { lines: [{ workers: ['W9'], work: 'kuhinja Čorluka' }] })).ok).toBe(false);
        expect((await runTool(env(), 'log_work', { lines: [{ workers: ['W1'], work: 'kuhinja Čorluka', fraction: 2 }] })).ok).toBe(false);
    });
});

describe('dnevni upis: cijela poruka u jednom pozivu', () => {
    let day: ToolEnv;

    beforeAll(async () => {
        day = env();
        const res = await runTool(day, 'log_work', { lines: [
            { workers: ['W1', 'W2'], work: 'kuhinja Čorluka', process: 'krojili iveral' },
            { workers: ['W3'], work: 'gardaroberi Čorluka', process: 'kantirao', done: true },
            { workers: ['W4'], work: 'vrata Meliha', process: 'lakiranje', fraction: 0.5 },
            { workers: ['W4'], work: 'montaža vrata E5', process: 'montaža', fraction: 0.5, new_process: true },
        ] });
        expect(res).toMatchObject({ ok: true, rows: 5 }); // prva stavka ima dva radnika
    });

    it('automatska podjela je zamijenjena diktiranom, dnevnica tačna', () => {
        const amer = logsOf('amer');
        expect(amer.map(l => l.WorkLog_ID)).not.toContain('auto1');
        expect(amer).toHaveLength(2); // cijeli nalog kuhinje = obje stavke
        expect(amer.every(l => l.Booking_Source === 'manual' && l.Entry_Source === 'telegram' && l.Process_Name === 'Krojenje Iverala' && l.Process_Node_ID === 'kr')).toBe(true);
        expect(amer.map(l => l.Daily_Rate)).toEqual([50, 50]);
        expect(logsOf('kerim').reduce((s, l) => s + l.Daily_Rate, 0)).toBe(80);
    });

    it('pola-pola: udio dana se čuva kao Day_Weight', () => {
        const imer = logsOf('imer');
        expect(imer.map(l => [l.Work_Order_ID, l.Day_Weight, l.Day_Fraction, l.Daily_Rate]).sort()).toEqual([['r3', 0.5, 0.5, 50], ['z21', 0.5, 0.5, 50]]);
    });

    it('prisustvo upisano za sve', () => {
        ['amer', 'kerim', 'edin', 'imer'].forEach(w => expect(att(w)).toEqual([expect.objectContaining({ Status: 'Prisutan' })]));
    });

    it('čekiranje: kantiranje završeno na gardaroberu', () => {
        expect(item('g1').Processes).toEqual([
            { Process_Name: 'Krojenje Iverala', Status: 'Završeno' },
            expect.objectContaining({ Process_Name: 'Kantiranje', Status: 'Završeno', Completed_At: `${DAY}T15:00:00.000Z` }),
        ]);
        expect(logsOf('edin')[0]).toMatchObject({ Process_Name: 'Kantiranje', Process_Node_ID: 'ka' });
    });

    it('graf: nov proces na nalogu bez grafa, nalog krenuo; „Montaža" u katalogu i grafu Zadataka', () => {
        expect(wo('r3')).toMatchObject({ Status: 'U toku', Process_Graph: { nodes: [{ name: 'Farbanje i lakiranje', itemIds: ['m1'] }] } });
        expect(item('m1')).toMatchObject({ Status: 'U toku', Processes: [{ Process_Name: 'Farbanje i lakiranje', Status: 'U toku' }] });
        expect(docs('process_catalog').map(c => c.Name)).toContain('Montaža');
        expect(wo('z21').Process_Graph.nodes.map((n: any) => n.name)).toEqual(['Rad', 'Montaža']);
        expect(wo('z21').Process_Graph.edges).toEqual([]);
    });

    it('trošak rada naloga osvježen', () => {
        expect(wo('r7').Actual_Labor_Cost).toBe(180); // Amer 100 + Kerim 80
        expect(wo('r5').Actual_Labor_Cost).toBe(90);  // Edin; Amerova automatska dnevnica skinuta
    });

    it('rezime za korisnika', () => {
        const s = day.summaries[0];
        expect(s).toMatch(/^🗓 Rad danas:/);
        expect(s).toMatch(/• Amer — 1 dan · Krojenje Iverala · Corluka - Kuhinja\n/);
        expect(s).toMatch(/• Edin — 1 dan · Kantiranje ✔ · Corluka - Gardaroberi u djecijoj sobi/);
        expect(s).toMatch(/• Imer — ½ dana · Farbanje i lakiranje · Meliha A501 - Vrata · novo u grafu/);
        expect(s).toMatch(/➕ U katalog procesa: Montaža/);
    });

    it('renormalizacija iz šihtarice ne gazi udio dana; ručni dodatak dijeli dan', async () => {
        await renormalizeWorkerDay('org1', 'imer', DAY);
        expect(logsOf('imer').map(l => l.Daily_Rate)).toEqual([50, 50]);
        store.set('work_logs/manualX', { WorkLog_ID: 'mx', Organization_ID: 'org1', Date: DAY, Worker_ID: 'imer', Worker_Name: 'Imer', Daily_Rate: 0,
            Original_Daily_Rate: 100, Presence: 1, Booking_Source: 'manual', Work_Order_ID: 'r7', Work_Order_Item_ID: 'k1' });
        await renormalizeWorkerDay('org1', 'imer', DAY);
        expect(logsOf('imer').reduce((s, l) => s + l.Daily_Rate, 0)).toBeCloseTo(100, 6);
        expect(logsOf('imer').find(l => l.WorkLog_ID === 'mx')!.Daily_Rate).toBeCloseTo(33.33, 2);
        store.delete('work_logs/manualX');
        await renormalizeWorkerDay('org1', 'imer', DAY);
    });

    it('ponovni diktat istog dana zamjenjuje prethodni (bez duplikata)', async () => {
        const e = env();
        await runTool(e, 'log_work', { lines: [{ workers: ['W1'], work: 'gardaroberi Čorluka', process: 'kantiranje' }] });
        expect(logsOf('amer').map(l => l.Work_Order_ID)).toEqual(['r5']);
        await undoTurn(e.turnId, 'u1');
        expect(logsOf('amer').map(l => l.Work_Order_ID)).toEqual(['r7', 'r7']);
    });

    it('odsustvo: bolovanje skida diktirani rad tog dana', async () => {
        const e = env();
        const res = await runTool(e, 'log_work', { absent: [{ worker: 'W2', status: 'Bolovanje' }] });
        expect(res.ok).toBe(true);
        expect(logsOf('kerim')).toHaveLength(0);
        expect(att('kerim')[0].Status).toBe('Bolovanje');
        expect(e.summaries[0]).toMatch(/• Kerim — Bolovanje/);
        await undoTurn(e.turnId, 'u1');
        expect(logsOf('kerim')).toHaveLength(2);
        expect(att('kerim')[0].Status).toBe('Prisutan');
    });

    it('pregled rada: ko je danas na čemu', async () => {
        const res = await runTool(env(), 'work_report', {});
        expect(res.ok).toBe(true);
        expect(res.lines).toEqual(expect.arrayContaining([
            expect.stringMatching(/Edin \| 1 dan \| Kantiranje \| Corluka - Gardaroberi u djecijoj sobi \/ Gardarober \| upisano/),
        ]));
        const kuhinja = await runTool(env(), 'work_report', { work: 'kuhinja Čorluka' });
        expect((kuhinja.lines as string[]).every(l => /Kuhinja/.test(l))).toBe(true);
    });

    it('↩️ Poništi cijelog dana vraća stanje prije diktata', async () => {
        await undoTurn(day.turnId, 'u1');
        expect(logsOf('amer').map(l => l.WorkLog_ID)).toEqual(['auto1']);
        expect(logsOf('imer')).toHaveLength(0);
        expect(att('edin')).toHaveLength(0);
        expect(item('g1').Processes[1].Status).toBe('Na čekanju');
        expect(wo('r3').Status).toBe('Na čekanju');
        expect(wo('r3').Process_Graph).toBeUndefined();
        expect(docs('process_catalog').map(c => c.Name)).not.toContain('Montaža');
        expect(wo('z21').Process_Graph.nodes).toHaveLength(1);
    });
});

describe('plan iz pravila materijala + podrazumijevano završeni raniji koraci', () => {
    const statuses = (id: string) => Object.fromEntries(item(id).Processes.map((p: any) => [p.Process_Name, `${p.Status}${p.Assumed_Done ? '*' : ''}`]));
    let day1: ToolEnv;
    let day2: ToolEnv;

    beforeAll(async () => {
        store.set('process_material_rules/r1', { ID: 'r1', Organization_ID: 'org1', Match_Kind: 'material_type_combo', Match_Value: '', Match_Types: ['furnir', 'mdf'],
            Processes: ['Krojenje MDF-a', 'Priprema furnira', 'Furniranje', 'Srezivanje', 'Brušenje', 'Lakiranje'] });
        store.set('projects/b', { Project_ID: 'pb', Organization_ID: 'org1', Name: 'Begović kuća', Client_Name: 'Begović' });
        store.set('work_orders/r9', { Work_Order_ID: 'r9', Organization_ID: 'org1', Name: 'Begović - Vrata', Status: 'Na čekanju', Work_Order_Type: 'Proizvodnja' });
        const it = (id: string, product: string) => store.set(`work_order_items/${id}`, { ID: id, Organization_ID: 'org1', Work_Order_ID: 'r9', Product_ID: `p-${id}`, Product_Name: product, Project_ID: 'pb', Status: 'Na čekanju' });
        it('v1', 'Vrata ulazna'); it('v2', 'Vrata sobna');
        // v1: plan iz pravila (MDF + furnir u materijalima); v2: plan s kartice proizvoda.
        store.set('product_materials/m1', { ID: 'm1', Organization_ID: 'org1', Product_ID: 'p-v1', Material_Name: 'MDF 18mm' });
        store.set('product_materials/m2', { ID: 'm2', Organization_ID: 'org1', Product_ID: 'p-v1', Material_Name: 'Furnir hrast' });
        store.set('products/v2', { Product_ID: 'p-v2', Organization_ID: 'org1', Name: 'Vrata sobna',
            Process_Stages: [{ processes: ['Krojenje MDF-a'] }, { processes: ['Brušenje'] }, { processes: ['Lakiranje'] }] });

        day1 = env();
        const res = await runTool(day1, 'log_work', { date: '2026-10-22', lines: [{ workers: ['W1'], work: 'vrata Begović', process: 'krojili MDF' }] });
        expect(res).toMatchObject({ ok: true });
    });

    it('proizvod bez procesa dobije plan; upisani proces u toku, ostali čekaju', () => {
        expect(statuses('v1')).toEqual({
            'Krojenje MDF-a': 'U toku', 'Priprema furnira': 'Na čekanju', Furniranje: 'Na čekanju', Srezivanje: 'Na čekanju', Brušenje: 'Na čekanju', Lakiranje: 'Na čekanju',
        });
        expect(statuses('v2')).toEqual({ 'Krojenje MDF-a': 'U toku', Brušenje: 'Na čekanju', Lakiranje: 'Na čekanju' });
        const g = wo('r9').Process_Graph;
        expect(g.nodes.filter((n: any) => n.name === 'Krojenje MDF-a')).toEqual([expect.objectContaining({ itemIds: ['v1', 'v2'] })]);
        expect(wo('r9').Status).toBe('U toku');
    });

    it('sutra „brušenje" → raniji koraci završeni pretpostavkom, dnevnica samo na brušenje', async () => {
        day2 = env();
        expect(await runTool(day2, 'log_work', { date: '2026-10-23', lines: [{ workers: ['W2'], work: 'vrata Begović', process: 'brusili' }] })).toMatchObject({ ok: true });
        expect(statuses('v1')).toEqual({
            'Krojenje MDF-a': 'Završeno*', 'Priprema furnira': 'Završeno*', Furniranje: 'Završeno*', Srezivanje: 'Završeno*', Brušenje: 'U toku', Lakiranje: 'Na čekanju',
        });
        expect(statuses('v2')).toEqual({ 'Krojenje MDF-a': 'Završeno*', Brušenje: 'U toku', Lakiranje: 'Na čekanju' });
        const logs = docs('work_logs').filter(l => l.Worker_ID === 'kerim' && l.Date === '2026-10-23');
        expect(logs.map(l => l.Process_Name)).toEqual(['Brušenje', 'Brušenje']);
    });

    it('rezime kaže odakle je plan i šta se podrazumijeva', () => {
        const s = day2.summaries[0];
        expect(day1.summaries[0]).toMatch(/📋 Plan iz pravila materijala · Begović - Vrata \(Vrata ulazna\): Krojenje MDF-a → Priprema furnira → Furniranje → Srezivanje → Brušenje → Lakiranje/);
        expect(day1.summaries[0]).toMatch(/📋 Plan s kartice proizvoda · Begović - Vrata \(Vrata sobna\): Krojenje MDF-a → Brušenje → Lakiranje/);
        expect(s).toMatch(/☑️ Podrazumijeva se završeno · Begović - Vrata \(Vrata ulazna\): Krojenje MDF-a, Priprema furnira, Furniranje, Srezivanje/);
        expect(s).toMatch(/☑️ Podrazumijeva se završeno · Begović - Vrata \(Vrata sobna\): Krojenje MDF-a/);
    });

    it('nov proces (nije bio u planu) ne završava ostatak plana', async () => {
        const e = env();
        expect(await runTool(e, 'log_work', { date: '2026-10-23', lines: [{ workers: ['W3'], work: 'vrata Begović', process: 'pakovanje', new_process: true }] })).toMatchObject({ ok: true });
        expect(statuses('v1')).toMatchObject({ Brušenje: 'U toku', Lakiranje: 'Na čekanju', Pakovanje: 'U toku' });
        expect(e.summaries[0]).not.toMatch(/Podrazumijeva/);
    });

    it('↩️ Poništi vraća korake na stanje prije', async () => {
        await undoTurn(day2.turnId, 'u1');
        expect(statuses('v1')).toMatchObject({ 'Krojenje MDF-a': 'U toku', Srezivanje: 'Na čekanju', Brušenje: 'Na čekanju' });
    });
});

describe('dva kantiranja: „kantirao" po planu proizvoda (iverala ili furnira)', () => {
    const ORG = 'org2';
    const env2 = (): ToolEnv => {
        const e = env();
        return { ...e, orgId: ORG, ctx: { ...e.ctx, workers: [{ alias: 'W1', value: { id: 'sead', name: 'Sead' } }, { alias: 'W2', value: { id: 'haris', name: 'Haris' } }] } } as ToolEnv;
    };
    const procs = (id: string) => Object.fromEntries(item(id).Processes.map((p: any) => [p.Process_Name, p.Status]));

    beforeAll(async () => {
        const w = (id: string, name: string) => store.set(`workers/${id}`, { Worker_ID: id, Organization_ID: ORG, Name: name, Daily_Rate: 100, Status: 'Aktivan' });
        w('sead', 'Sead'); w('haris', 'Haris');
        store.set('projects/h', { Project_ID: 'ph', Organization_ID: ORG, Name: 'Hadžić stan', Client_Name: 'Hadžić' });
        ['Krojenje iverala', 'Krojenje MDF-a', 'Priprema furnira', 'Furniranje', 'Srezivanje na tačnu mjeru', 'Kantiranje iverala', 'Kantiranje furnira', 'Sklapanje kutija']
            .forEach((n, i) => store.set(`process_catalog/h${i}`, { ID: `h${i}`, Organization_ID: ORG, Name: n, Order: i + 1 }));
        store.set('process_material_rules/h1', { ID: 'h1', Organization_ID: ORG, Match_Kind: 'material_type_combo', Match_Value: '', Match_Types: ['furnir', 'mdf'],
            Processes: ['Krojenje MDF-a', 'Furniranje', 'Srezivanje na tačnu mjeru', 'Kantiranje furnira'] });
        store.set('process_material_rules/h2', { ID: 'h2', Organization_ID: ORG, Match_Kind: 'material_type', Match_Value: 'iveral',
            Processes: ['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija'] });
        store.set('work_orders/x1', { Work_Order_ID: 'x1', Organization_ID: ORG, Name: 'Hadžić - Komoda', Status: 'U toku', Work_Order_Type: 'Proizvodnja' });
        store.set('work_orders/x2', { Work_Order_ID: 'x2', Organization_ID: ORG, Name: 'Hadžić - Ormar', Status: 'U toku', Work_Order_Type: 'Proizvodnja' });
        store.set('work_order_items/f1', { ID: 'f1', Organization_ID: ORG, Work_Order_ID: 'x1', Product_ID: 'p-f1', Product_Name: 'Komoda', Project_ID: 'ph', Status: 'U toku' });
        store.set('work_order_items/i1', { ID: 'i1', Organization_ID: ORG, Work_Order_ID: 'x2', Product_ID: 'p-i1', Product_Name: 'Ormar', Project_ID: 'ph', Status: 'U toku' });
        store.set('product_materials/h1', { ID: 'h1', Organization_ID: ORG, Product_ID: 'p-f1', Material_Name: 'MDF 18' });
        store.set('product_materials/h2', { ID: 'h2', Organization_ID: ORG, Product_ID: 'p-f1', Material_Name: 'Furnir / Orah' });
        store.set('product_materials/h3', { ID: 'h3', Organization_ID: ORG, Product_ID: 'p-i1', Material_Name: 'Iveral / Bijeli' });

        const res = await runTool(env2(), 'log_work', { lines: [
            { workers: ['W1'], work: 'komoda Hadžić', process: 'kantirao' },
            { workers: ['W2'], work: 'ormar Hadžić', process: 'kantirao' },
        ] });
        expect(res).toMatchObject({ ok: true });
    });

    it('furnirana komoda → kantiranje furnira; ormar od iverala → kantiranje iverala', () => {
        expect(docs('work_logs').filter(l => l.Worker_ID === 'sead').map(l => l.Process_Name)).toEqual(['Kantiranje furnira']);
        expect(docs('work_logs').filter(l => l.Worker_ID === 'haris').map(l => l.Process_Name)).toEqual(['Kantiranje iverala']);
        expect(procs('f1')).toMatchObject({ 'Kantiranje furnira': 'U toku', Furniranje: 'Završeno' });
        expect(procs('f1')['Kantiranje iverala']).toBeUndefined();
        expect(procs('i1')).toMatchObject({ 'Krojenje iverala': 'Završeno', 'Kantiranje iverala': 'U toku', 'Sklapanje kutija': 'Na čekanju' });
    });
});

describe('„Mia isto kao jučer" — zadnji potvrđeni dan, sa sljedećim korakom', () => {
    const ORG = 'org4';
    const env4 = (): ToolEnv => {
        const e = env();
        return { ...e, orgId: ORG, ctx: { ...e.ctx, workers: [{ alias: 'W1', value: { id: 'mia', name: 'Mia' } }, { alias: 'W2', value: { id: 'ivo', name: 'Ivo' } }] } } as ToolEnv;
    };

    beforeAll(() => {
        store.set('workers/mia', { Worker_ID: 'mia', Organization_ID: ORG, Name: 'Mia', Daily_Rate: 100, Status: 'Aktivan' });
        store.set('workers/ivo', { Worker_ID: 'ivo', Organization_ID: ORG, Name: 'Ivo', Daily_Rate: 100, Status: 'Aktivan' });
        store.set('work_orders/d1', { Work_Order_ID: 'd1', Organization_ID: ORG, Name: 'Hasić - Ormar', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
            Process_Graph: { nodes: [{ id: 'k', name: 'Krojenje iverala', itemIds: [] }, { id: 'ka', name: 'Kantiranje iverala', itemIds: [] }], edges: [{ id: 'e', source: 'k', target: 'ka' }] } });
        store.set('work_order_items/d1i', { ID: 'd1i', Organization_ID: ORG, Work_Order_ID: 'd1', Product_ID: 'p-d1', Product_Name: 'Ormar', Status: 'U toku',
            Processes: [{ Process_Name: 'Krojenje iverala', Status: 'Završeno' }, { Process_Name: 'Kantiranje iverala', Status: 'Na čekanju' }] });
        store.set('work_logs/mia22', { WorkLog_ID: 'mia22', Organization_ID: ORG, Date: '2026-10-22', Worker_ID: 'mia', Worker_Name: 'Mia', Daily_Rate: 100, Day_Fraction: 1,
            Booking_Source: 'manual', Entry_Source: 'telegram', Work_Order_ID: 'd1', Work_Order_Item_ID: 'd1i', Product_ID: 'p-d1', Process_Name: 'Krojenje iverala' });
    });

    it('krojenje je završeno → upiše se kantiranje istog ormara', async () => {
        const res = await runTool(env4(), 'log_work', { date: '2026-10-23', lines: [{ workers: ['W1'], like_last: true }] });
        expect(res).toMatchObject({ ok: true });
        const log = docs('work_logs').find(l => l.Organization_ID === ORG && l.Worker_ID === 'mia' && l.Date === '2026-10-23')!;
        expect(log).toMatchObject({ Work_Order_ID: 'd1', Work_Order_Item_ID: 'd1i', Process_Name: 'Kantiranje iverala', Entry_Source: 'telegram' });
    });

    it('radnik bez potvrđenog dana → pitanje, ništa upisano', async () => {
        const res = await runTool(env4(), 'log_work', { date: '2026-10-23', lines: [{ workers: ['W2'], like_last: true }] });
        expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Ivo: nema zadnjeg potvrđenog dana/) });
    });
});

describe('„Bego i Braco radili na svim Čorlukinim osim vrata, u petak sve zapakovali"', () => {
    const ORG = 'org3';
    const env3 = (): ToolEnv => {
        const e = env();
        return {
            ...e, orgId: ORG,
            ctx: {
                ...e.ctx,
                workers: [{ alias: 'W1', value: { id: 'bego', name: 'Bego' } }, { alias: 'W2', value: { id: 'braco', name: 'Braco' } }],
                orders: [
                    { alias: 'R1', value: { id: 'c1', name: 'Corluka - Kuhinja' } },
                    { alias: 'R2', value: { id: 'c2', name: 'Corluka - Ostrvo' } },
                    { alias: 'R3', value: { id: 'c3', name: 'Corluka - Vrata' } },
                ],
            },
        } as ToolEnv;
    };
    const logs = (w: string) => docs('work_logs').filter(l => l.Organization_ID === ORG && l.Worker_ID === w);
    let fill: ToolEnv;

    beforeAll(async () => {
        const w = (id: string, name: string) => store.set(`workers/${id}`, { Worker_ID: id, Organization_ID: ORG, Name: name, Daily_Rate: 100, Status: 'Aktivan' });
        w('bego', 'Bego'); w('braco', 'Braco');
        store.set('projects/cc', { Project_ID: 'pcc', Organization_ID: ORG, Name: 'Čorluka kuća', Client_Name: 'Čorluka' });
        const o = (id: string, name: string, extra: Record<string, unknown> = {}) =>
            store.set(`work_orders/${id}`, { Work_Order_ID: id, Organization_ID: ORG, Name: name, Status: 'U toku', Work_Order_Type: 'Proizvodnja', ...extra });
        o('c1', 'Corluka - Kuhinja', { Process_Graph: { nodes: [{ id: 'n1', name: 'Krojenje iverala', itemIds: ['ck'] }, { id: 'n2', name: 'Kantiranje iverala', itemIds: ['ck'] }], edges: [{ id: 'e', source: 'n1', target: 'n2' }] } });
        o('c2', 'Corluka - Ostrvo', { Process_Graph: { nodes: [{ id: 'm1', name: 'Krojenje MDF-a', itemIds: ['co'] }, { id: 'm2', name: 'Lakiranje', itemIds: ['co'] }], edges: [{ id: 'e', source: 'm1', target: 'm2' }] } });
        o('c3', 'Corluka - Vrata');
        const it = (id: string, woId: string, product: string, extra: Record<string, unknown> = {}) =>
            store.set(`work_order_items/${id}`, { ID: id, Organization_ID: ORG, Work_Order_ID: woId, Product_ID: `p-${id}`, Product_Name: product, Project_ID: 'pcc', Status: 'U toku', ...extra });
        it('ck', 'c1', 'Kuhinja', { Processes: [{ Process_Name: 'Krojenje iverala', Status: 'Završeno' }, { Process_Name: 'Kantiranje iverala', Status: 'Na čekanju' }] });
        it('co', 'c2', 'Ostrvo');
        it('cv', 'c3', 'Vrata', { Processes: [{ Process_Name: 'Okivanje', Status: 'Na čekanju' }] });
        const log = (id: string, worker: string, date: string, extra: Record<string, unknown>) =>
            store.set(`work_logs/${id}`, { WorkLog_ID: id, Organization_ID: ORG, Date: date, Worker_ID: worker, Worker_Name: worker, Daily_Rate: 100, Day_Fraction: 1,
                Work_Order_ID: 'c3', Work_Order_Item_ID: 'cv', Product_ID: 'p-cv', ...extra });
        log('a19', 'bego', '2026-10-19', { Booking_Source: 'attendance', Is_From_Attendance: true });
        log('a20', 'bego', '2026-10-20', { Booking_Source: 'attendance', Is_From_Attendance: true });
        log('m21', 'braco', '2026-10-21', { Booking_Source: 'manual', Process_Name: 'Okivanje' });
        store.set('worker_attendance/b22', { Attendance_ID: 'b22', Organization_ID: ORG, Worker_ID: 'braco', Worker_Name: 'Braco', Date: '2026-10-22', Status: 'Bolovanje' });

        fill = env3();
        const res = await runTool(fill, 'fill_work_days', { workers: ['W1', 'W2'], orders: ['R1', 'R2'], finish_all: true });
        expect(res).toMatchObject({ ok: true, finished_products: 2 });
    });

    it('prazni dani ove sedmice dobiju oba naloga; potvrđen dan i bolovanje ostaju', () => {
        const days = (w: string) => Array.from(new Set(logs(w).map(l => l.Date))).sort();
        expect(days('bego')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
        expect(logs('bego').map(l => l.WorkLog_ID)).not.toContain('a19'); // auto iz prisustva zamijenjen
        expect(days('braco')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23']);
        expect(logs('braco').find(l => l.Date === '2026-10-21')!.WorkLog_ID).toBe('m21');
        const d23 = logs('bego').filter(l => l.Date === '2026-10-23');
        expect(d23.map(l => l.Work_Order_ID).sort()).toEqual(['c1', 'c2']);
        expect(d23.reduce((s, l) => s + l.Daily_Rate, 0)).toBe(100);
        expect(logs('bego').some(l => l.Work_Order_ID === 'c3')).toBe(false);
    });

    it('svi procesi Čorlukinih proizvoda završeni; vrata netaknuta', () => {
        expect(item('ck')).toMatchObject({ Status: 'Završeno', Labor_Cost_Frozen: true });
        expect(item('ck').Processes.every((p: any) => p.Status === 'Završeno' && !p.Assumed_Done)).toBe(true);
        expect(item('co').Processes.map((p: any) => `${p.Process_Name}:${p.Status}`)).toEqual(['Krojenje MDF-a:Završeno', 'Lakiranje:Završeno']);
        expect(item('cv').Status).toBe('U toku');
    });

    it('potvrda kaže dane po radnicima i završene proizvode', () => {
        expect(fill.summaries[0]).toMatch(/Popunjeni prazni dani · Corluka - Kuhinja, Corluka - Ostrvo/);
        expect(fill.summaries[0]).toMatch(/• Bego, Braco: 19\.10\., 20\.10\., 23\.10\./);
        expect(fill.summaries[0]).toMatch(/• Bego: 21\.10\., 22\.10\./);
        expect(fill.summaries[0]).toMatch(/Završeni svi procesi: 2 proizvoda/);
    });

    it('drugi put: nema praznih dana', async () => {
        const res = await runTool(env3(), 'fill_work_days', { workers: ['W1'], orders: ['R1'] });
        expect(res).toMatchObject({ ok: true, days: 0 });
    });

    it('↩️ Poništi vraća sve: auto dani, procesi, stavke', async () => {
        await undoTurn(fill.turnId, 'u1');
        expect(logs('bego').map(l => l.WorkLog_ID).sort()).toEqual(['a19', 'a20']);
        expect(item('ck').Status).toBe('U toku');
        expect(item('co').Processes).toBeUndefined();
    });

    it('log_work s više naloga i finish_all na jednoj stavci', async () => {
        const e = env3();
        const res = await runTool(e, 'log_work', { date: '2026-10-23', lines: [{ workers: ['W2'], work: 'Čorluka', orders: ['R1', 'R2'], finish_all: true }] });
        expect(res).toMatchObject({ ok: true, finished_products: 2 });
        expect(logs('braco').filter(l => l.Date === '2026-10-23').map(l => l.Work_Order_ID).sort()).toEqual(['c1', 'c2']);
        expect(item('co').Status).toBe('Završeno');
        expect(await runTool(e, 'log_work', { lines: [{ workers: ['W2'], work: 'x', orders: ['R9'] }] })).toMatchObject({ ok: false, error: expect.stringMatching(/R9 nije u listi/) });
    });
});
