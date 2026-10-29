/**
 * @jest-environment node
 */
// ISPRAVKE IZ PDF-a „Ispravke ERP Bot" (28.10.2026) — svaka poruka iz PDF-a je slučaj:
//   1. „Kad smo počeli Čorluku" → prvi dan rada kroz SVE naloge (18.09.), ne zadnji
//   2. „Kemo je počeo montažu na stolovima za Budnju. Bego završio izradu podkonstrukcije."
//   3. „da Kemal" → „zapisano", a ništa nije upisano (lažna potvrda)
//   4. „Došao kerrock za Budnju, kao i iveral Cleaf" → ERP sam nađe i završi narudžbu
//   5. Glasovna: „…okuje vrata večeras u osam, a mene to napomeni danas u dva i petnaest"
//   6. „Spisak svih ogledala koja nisu montirana na E i C lameli"

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { resolveReminderAt } from '@/lib/assistant/datetime';
import { workerMentioned, workerNicknames } from '@/lib/assistant/grounding';
import { messageIntent } from '@/lib/assistant/intent';
import { claimsWrite, sanitizeModelText } from '@/lib/assistant/replyText';
import { filterNotebook, notebookListText } from '@/lib/assistant/memoryRules';
import { arrivalDay } from '@/lib/assistant/materialAlerts';
import { buildProjectHistory, projectHistoryLines } from '@/lib/projectHistory';
import type { MemoryItem } from '@/lib/types';

const ORG = 'orgP';
const TODAY = '2026-10-27';
const TZ = 'Europe/Sarajevo';
const WORKERS = [
    { id: 'kemal', name: 'Kemal Alispahić' }, { id: 'mevludin', name: 'Mevludin Alispahić' },
    { id: 'mansa', name: 'Mirnes Manso' }, { id: 'bego', name: 'Bego Saka' },
];
const noFacts = { dims: [], widths: [], locations: [] };

describe('5. glasovna: dva vremena, jedan podsjetnik', () => {
    const voice = 'Reci Mansi da kaže Begi da mu okuje vrata večeras u osam, a mene to napomeni danas u dva i petnaest.';
    const now = new Date('2026-10-28T08:10:00Z'); // 09:10 u Sarajevu

    it('vrijeme podsjetnika je ono uz „napomeni me" (14:15), ne „večeras" (19:00)', () => {
        expect(resolveReminderAt({ text: voice, now, tz: TZ })?.time).toBe('14:15');
        // Tačan izbor modela se više ne pregazi …
        expect(resolveReminderAt({ text: voice, now, tz: TZ, modelLocal: '2026-10-28T14:15' })?.time).toBe('14:15');
        // … a pogrešan (vrijeme posla) ERP ispravi na vrijeme uz „napomeni me".
        expect(resolveReminderAt({ text: voice, now, tz: TZ, modelLocal: '2026-10-28T19:00' })?.time).toBe('14:15');
    });

    it('sati riječima i „večeras u osam" = 20:00', () => {
        expect(resolveReminderAt({ text: 'podsjeti me večeras u osam', now, tz: TZ })?.time).toBe('20:00');
        expect(resolveReminderAt({ text: 'napomeni me u pola tri', now, tz: TZ })?.time).toBe('14:30');
        expect(resolveReminderAt({ text: 'napomeni me u 2 kombija', now, tz: TZ, modelLocal: '2026-10-28T10:00' })?.time).toBe('10:00');
    });

    it('„reći Begi" u naslovu pokriva Bega (nema drugog zadatka za njega)', () => {
        expect(workerMentioned('{"title":"Reći Mansi da kaže Begi da okuje vrata večeras u 20:00"}', { id: 'bego', name: 'Bego Saka' })).toBe(true);
    });
});

describe('2. nadimci i vrsta poruke', () => {
    const msg = 'Kemo je poceo da radi radi montazu na stolovima za budnju. Bego zavrsio izradu podkonstrukcije.';

    it('„Kemo" = Kemal (jedini Kem…), pa upis nije odbijen', () => {
        expect(workerNicknames(msg, WORKERS)).toEqual([{ token: 'kemo', ids: ['kemal'] }]);
        expect(workerMentioned(msg, WORKERS[0], WORKERS)).toBe(true);
        expect(workerMentioned(msg, WORKERS[0])).toBe(false);      // bez liste radnika nadimak ne važi
    });

    it('dva Kemala → nadimak nije jednoznačan', () => {
        const two = [...WORKERS, { id: 'kemal2', name: 'Kemal Hodžić' }];
        expect(workerNicknames(msg, two)).toEqual([{ token: 'kemo', ids: ['kemal', 'kemal2'] }]);
        expect(workerMentioned(msg, two[0], two)).toBe(false);
    });

    it('„ime", „sami", „jasno" nisu nadimci', () => {
        expect(workerNicknames('kako mu je ime, radili su sami, nije jasno', [{ id: 'i', name: 'Imer' }, { id: 's', name: 'Samir' }, { id: 'j', name: 'Jasmin' }])).toEqual([]);
    });

    it('poruka je prepoznata kao rad (ide jačem modelu), „stigao" kao prijem materijala', () => {
        expect(messageIntent(msg, WORKERS, noFacts).kinds).toContain('work');
        expect(messageIntent('danas nam je dosao kerrock za budnju, kao i iveral Cleaf', WORKERS, noFacts).kinds).toEqual(['arrival']);
    });
});

describe('3. potvrdu piše ERP, ne model', () => {
    it('„zapisano", „upisan" su potvrde; „nije upisano" nije', () => {
        expect(claimsWrite('Kemal, zapisano: Kemal je počeo raditi na montaži stolova za Budnju.')).toBe(true);
        expect(claimsWrite('Zapisano: danas je stigao Kerrock za Budnjo i iveral Cleaf.')).toBe(true);
        expect(claimsWrite('Bego je upisan kao završio izradu podkonstrukcije.')).toBe(true);
        expect(claimsWrite('Podsjetnik za izradu završne ploče je postavljen za četvrtak.')).toBe(true);
        expect(claimsWrite('Upis rada za montažu nije prošao jer nisam siguran ko je radio.')).toBe(false);
        expect(claimsWrite('Montaža nije upisana — treba reći proces.')).toBe(false);
    });

    it('uz upis: rečenice-potvrde i ponude se brišu, objašnjenje ostaje', () => {
        const text = 'Bego je upisan kao završio izradu podkonstrukcije. Montaža za Kemala nije upisana jer proces nije jasan.\n\nČeka li Kemal još nešto da mu zadam ili da upišem u Knjigu rada?';
        expect(sanitizeModelText(text, { dropClaims: true })).toBe('Montaža za Kemala nije upisana jer proces nije jasan.');
    });

    it('ponude na kraju odgovora se brišu i bez upisa', () => {
        const page6 = 'Hodnik E4: 2 kom ogledala 1000x1350.\n\nAko želiš da vidim i druge oznake (B, D, hotel, kuća), reci pa provjerim.';
        expect(sanitizeModelText(page6, { dropClaims: false })).toBe('Hodnik E4: 2 kom ogledala 1000x1350.');
        expect(sanitizeModelText('Najraniji rad je 18.9. Ako želiš tačan datum, mogu pogledati izvještaj.', { dropClaims: false })).toBe('Najraniji rad je 18.9.');
    });
});

describe('6. spisak ogledala na E i C lameli koja nisu montirana', () => {
    const m = (id: string, loc: string, title: string, key: string, qty = 1): MemoryItem => ({
        Item_ID: id, Organization_ID: ORG, Owner_UID: 'u1', Title: title, Subject: title.startsWith('Ogledalo') ? 'ogledalo' : 'lajsna', Quantity: qty,
        Location: loc, Links: [], State: key === 'postavljeno' ? 'resolved' : 'open', State_Key: key, State_Label: key.replace('_', ' '),
        Tags: [], History: [], Source_Entry_IDs: [], Created_At: '2026-10-23T10:00:00Z', Updated_At: '2026-10-23T10:00:00Z',
    });
    const items = [
        m('1', 'Hodnik C5', 'Ogledalo za C502', 'ceka'), m('2', 'Hodnik E4', 'Ogledalo 1000x1350', 'ceka', 2),
        m('3', 'E104', 'Ogledalo 1000x1350', 'nije_postavljeno'), m('4', 'E108', 'Ogledalo 1100x1000', 'postavljeno'),
        m('5', 'B201', 'Ogledalo 1000x1350', 'fali'), m('6', 'C604', 'Lajsna', 'fali'),
    ];

    it('ERP filtrira: lamele E i C, otvoreno, samo ogledala', () => {
        const f = { subject: 'ogledala', locations: ['E', 'C'] };
        expect(filterNotebook(items, f).map(x => x.Item_ID).sort()).toEqual(['1', '2', '3']);
        const text = notebookListText(filterNotebook(items, f), f, () => '23.10.');
        expect(text.split('\n')[0]).toBe('📋 Ogledala — nije postavljeno · lamele E, C: 4 kom na 3 lokacija');
        expect(text).toMatch(/C lamela:\n• Hodnik C5 — 1 kom Ogledalo za C502/);
        expect(text).toMatch(/E lamela:\n• E104 — 1 kom Ogledalo 1000x1350[^\n]*\n• Hodnik E4 — 2 kom/);
        expect(claimsWrite(text)).toBe(false);
    });
});

describe('1. kad smo počeli Čorluku — prvi dan kroz sve naloge, i završene', () => {
    it('prvi dan je 18.09. sa završenog naloga; zadnji 27.10.', () => {
        const h = buildProjectHistory(
            [{ id: 'k', name: 'Corluka - Kuhinja', status: 'U toku' }, { id: 'v1', name: 'Corluka - Vrata 1. faza', status: 'Završeno' }, { id: 'v2', name: 'Corluka - Vrata 2. faza', status: 'U toku' }],
            [{ id: 'ik', workOrderId: 'k', product: 'Kuhinja' }, { id: 'iv1', workOrderId: 'v1', product: 'Vrata' }, { id: 'iv2', workOrderId: 'v2', product: 'Vrata' }],
            [
                { date: '2026-09-18', workerName: 'Amer', workOrderId: 'v1', itemId: 'iv1', dayFraction: 1 },
                { date: '2026-10-22', workerName: 'Kerim', workOrderId: 'k', itemId: 'ik', dayFraction: 0.5 },
                { date: '2026-10-27', workerName: 'Amer', workOrderId: 'v2', itemId: 'iv2', dayFraction: 1 },
            ],
        );
        expect(h.span).toMatchObject({ first: '2026-09-18', last: '2026-10-27', workDays: 3 });
        const lines = projectHistoryLines(h, 'Čorluka');
        expect(lines[0]).toMatch(/^Čorluka: PRVI dan rada 18\.9\.2026, ZADNJI 27\.10\.2026/);
        expect(lines[1]).toMatch(/Corluka - Vrata 1\. faza \(Završeno\): 18\.9\./);
    });
});

// ─── Upisi kroz alate (lažna baza) ────────────────────────────────────

let turn = 0;
function env(groundText: string): ToolEnv {
    return {
        orgId: ORG, uid: 'u1', tz: TZ, now: new Date(`${TODAY}T20:30:00Z`), turnId: `P${++turn}`, dateText: groundText, groundText,
        reporter: 'ja', searchHits: [], created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ctx: {
            projects: [{ alias: 'P1', value: { id: 'pb', name: 'Hoteli Budnjo', client: 'Budnjo' } }, { alias: 'P2', value: { id: 'pc', name: 'Čorluka', client: 'Čorluka' } }],
            suppliers: [], memory: [], tasks: [], names: [], vocab: [],
            workers: WORKERS.map((w, i) => ({ alias: `W${i + 1}`, value: w })),
            orders: [{ alias: 'R1', value: { id: 'wb', name: 'Budnjo Svedski stolovi' } }, { alias: 'R2', value: { id: 'wc', name: 'Corluka - Kuhinja' } }],
        },
    } as unknown as ToolEnv;
}

const item = (id: string) => docs('work_order_items').find(i => i.Organization_ID === ORG && i.ID === id)!;
const status = (id: string, p: string) => item(id).Processes?.find((x: any) => x.Process_Name === p)?.Status;
const logs = (w: string) => docs('work_logs').filter(l => l.Organization_ID === ORG && l.Worker_ID === w && l.Date === TODAY);

beforeAll(() => {
    WORKERS.forEach(w => store.set(`workers/${w.id}`, { Worker_ID: w.id, Organization_ID: ORG, Name: w.name, Daily_Rate: 100, Status: 'Aktivan' }));
    store.set('projects/pb', { Project_ID: 'pb', Organization_ID: ORG, Name: 'Hoteli Budnjo', Client_Name: 'Budnjo' });
    store.set('projects/pc', { Project_ID: 'pc', Organization_ID: ORG, Name: 'Čorluka', Client_Name: 'Čorluka' });
    const plan = ['Krojenje OSB-a', 'Izrada podkonstrukcije', 'Krojenje Kerrocka', 'Lijepljenje Kerrocka', 'Brušenje Kerrocka', 'Montaža Kerrocka'];
    plan.forEach((n, i) => store.set(`process_catalog/p${i}`, { ID: `p${i}`, Organization_ID: ORG, Name: n, Order: i + 1 }));
    store.set('process_catalog/p9', { ID: 'p9', Organization_ID: ORG, Name: 'Probna montaža', Order: 9 });
    // Budnja: OSB → podkonstrukcija; Kerrock traka zasebno, montaža Kerrocka na kraju obje.
    store.set('work_orders/wb', {
        Work_Order_ID: 'wb', Organization_ID: ORG, Name: 'Budnjo Svedski stolovi', Status: 'U toku',
        Process_Graph: {
            nodes: plan.map((name, i) => ({ id: `n${i}`, name, itemIds: [] })),
            edges: [['n0', 'n1'], ['n2', 'n3'], ['n3', 'n4'], ['n1', 'n5'], ['n4', 'n5']].map(([s, t], i) => ({ id: `e${i}`, source: s, target: t })),
        },
    });
    store.set('work_orders/wc', { Work_Order_ID: 'wc', Organization_ID: ORG, Name: 'Corluka - Kuhinja', Status: 'U toku' });
    for (const id of ['s1', 's2']) {
        store.set(`work_order_items/${id}`, {
            ID: id, Organization_ID: ORG, Work_Order_ID: 'wb', Product_ID: `p-${id}`, Product_Name: 'Švedski sto', Project_ID: 'pb', Status: 'U toku',
            Processes: plan.map(n => ({ Process_Name: n, Status: 'Na čekanju' })),
        });
    }
    store.set('work_order_items/k1', { ID: 'k1', Organization_ID: ORG, Work_Order_ID: 'wc', Product_ID: 'p-k1', Product_Name: 'Kuhinja', Project_ID: 'pc', Status: 'U toku' });
    // Knjiga rada je za danas već ručno knjižena (šihtarica + knjiženje).
    for (const w of ['bego', 'kemal']) {
        store.set(`work_logs/m-${w}`, {
            WorkLog_ID: `m-${w}`, Organization_ID: ORG, Date: TODAY, Worker_ID: w, Worker_Name: w, Daily_Rate: 100, Original_Daily_Rate: 100,
            Day_Fraction: 1, Presence: 1, Split_Factor: 1, Booking_Source: 'manual', Work_Order_ID: 'wb', Work_Order_Item_ID: 's1', Product_ID: 'p-s1',
        });
    }
});

describe('2. „Kemo počeo montažu na stolovima za Budnju. Bego završio izradu podkonstrukcije."', () => {
    const said = 'Kemo je poceo da radi radi montazu na stolovima za budnju. Bego zavrsio izradu podkonstrukcije.';
    let e: ToolEnv;

    beforeAll(async () => {
        e = env(said);
        const res = await runTool(e, 'log_work', { lines: [
            { workers: ['W1'], work: 'stolovi za Budnju', process: 'montaža' },
            { workers: ['W4'], process: 'izrada podkonstrukcije', done: true },
        ] });
        expect(res).toMatchObject({ ok: true });
    });

    it('Bego: nalog iz podataka (Budnja), podkonstrukcija završena + raniji korak pretpostavljen', () => {
        expect(status('s1', 'Izrada podkonstrukcije')).toBe('Završeno');
        expect(status('s2', 'Izrada podkonstrukcije')).toBe('Završeno');
        expect(status('s1', 'Krojenje OSB-a')).toBe('Završeno');
        expect(item('s1').Processes.find((p: any) => p.Process_Name === 'Izrada podkonstrukcije')).toMatchObject({ Worker_Name: 'Bego Saka' });
        expect(status('s1', 'Krojenje Kerrocka')).toBe('Na čekanju');      // Kerrock traka nije dirana
    });

    it('Knjiga rada je već ručno knjižena → nije dirana', () => {
        expect(logs('bego').map(l => l.WorkLog_ID)).toEqual(['m-bego']);
        expect(docs('worker_attendance').filter(a => a.Organization_ID === ORG)).toEqual([]);
        expect(e.summaries[0]).toMatch(/📒 Knjiga rada — danas već knjiženo, nije dirano: Bego Saka/);
        expect(e.summaries[0]).toMatch(/• Izrada podkonstrukcije završeno · Budnjo Svedski stolovi — Bego Saka/);
    });

    it('Kemo: „montaža" ≠ sigurno Montaža Kerrocka (Kerrock nije ni krojen) → ERP pita dugmadima', () => {
        expect(status('s1', 'Montaža Kerrocka')).toBe('Na čekanju');
        const q = e.erpQuestion!;
        expect(q.question).toMatch(/^Kemal — „montaža" na Budnjo Svedski stolovi: koji je to proces\?/);
        expect(q.options.map(o => o.label)).toEqual(['Montaža Kerrocka', 'Probna montaža', '➕ Nov proces: Montaža', 'Preskoči']);
    });

    it('dugme „Probna montaža" završava upis bez modela; raniji koraci Kerrocka ostaju', async () => {
        const next = env(`${said}\nProbna montaža`);
        const res = await runTool(next, 'log_work', e.erpQuestion!.options[1].args);
        expect(res).toMatchObject({ ok: true });
        expect(status('s1', 'Probna montaža')).toBe('U toku');
        expect(logs('kemal').map(l => l.WorkLog_ID)).toEqual(['m-kemal']);
    });
});

describe('4. „Danas nam je došao Kerrock za Budnju, kao i iveral Cleaf"', () => {
    beforeAll(() => {
        store.set('products/p-s1', { Product_ID: 'p-s1', Organization_ID: ORG, Project_ID: 'pb', Name: 'Švedski sto', Quantity: 1 });
        store.set('product_materials/kr', { ID: 'kr', Organization_ID: ORG, Product_ID: 'p-s1', Material_Name: 'Kerrock 12mm bijeli', Quantity: 2, Unit: 'm2', Unit_Price: 100, Status: 'Nije naručeno', Supplier: 'Kerrock d.o.o.' });
        store.set('product_materials/cl', { ID: 'cl', Organization_ID: ORG, Product_ID: 'p-s1', Material_Name: 'Iveral Cleaf 18', Quantity: 3, Unit: 'm2', Unit_Price: 50, Status: 'Nije naručeno', Supplier: 'Frischeis' });
        // Kerrock je samo u nacrtu; za Cleaf narudžbe uopšte nema.
        store.set('orders/o1', { Order_ID: 'o1', Organization_ID: ORG, Order_Number: 'N-2026-10/K7', Supplier_Name: 'Kerrock d.o.o.', Status: 'Nacrt', Order_Date: '2026-10-20T08:00:00Z' });
        store.set('order_items/oi1', { ID: 'oi1', Organization_ID: ORG, Order_ID: 'o1', Product_Material_ID: 'kr', Product_Material_Quantities: { kr: 2 }, Material_Name: 'Kerrock 12mm bijeli', Quantity: 2, Unit: 'm2', Status: 'Na čekanju', Received_Quantity: 0, Project_ID: 'pb', Product_ID: 'p-s1' });
    });

    it('nacrt → poslano i primljeno; bez narudžbe → napravljena i primljena; bez pitanja', async () => {
        const e = env('danas nam je dosao kerrock za budnju, kao i iveral Cleaf');
        const res = await runTool(e, 'material_arrived', { items: [{ material: 'kerrock' }, { material: 'iveral Cleaf' }], project: 'P1' });
        expect(res).toMatchObject({ ok: true });
        expect(e.erpQuestion).toBeUndefined();
        expect(docs('orders').find(o => o.Order_ID === 'o1')).toMatchObject({ Status: 'Primljeno', Sent_At: '2026-10-20T08:00:00Z', Sent_At_Assumed: true });
        const cleaf = docs('orders').find(o => o.Organization_ID === ORG && o.Order_ID !== 'o1')!;
        expect(cleaf).toMatchObject({ Status: 'Primljeno', Supplier_Name: 'Frischeis', Sent_At_Assumed: true });
        expect(docs('product_materials').filter(m => m.Organization_ID === ORG).map(m => `${m.ID}:${m.Status}`).sort()).toEqual(['cl:Primljeno', 'kr:Primljeno']);
        expect(e.summaries[0]).toMatch(/📦 Stiglo: Kerrock 12mm bijeli — nacrt N-2026-10\/K7 \(Kerrock d\.o\.o\.\) → poslano i primljeno/);
        expect(e.summaries[0]).toMatch(/📦 Stiglo: Iveral Cleaf 18 — narudžbe nije bilo — napravljena .* \(Frischeis\) i primljena/);
        // „Kad je naručeno?" — dugmad koja ne čekaju odgovor; „danas" je rečeno, pa nema „kad je stiglo?".
        expect(e.followUp![0][0]).toEqual({ text: 'K7: danas', data: 'ordd:o1:0' });
        expect(e.followUp!.flat().some(b => b.data.startsWith('rcvd:'))).toBe(false);
    });

    it('dan prijema iz poruke; kad nije rečen → upis danas + dugme „kad je stiglo?"', async () => {
        expect(arrivalDay('jučer su stigle šarke', TODAY)).toBe('2026-10-26');
        expect(arrivalDay('prekjučer je došao kant', TODAY)).toBe('2026-10-25');
        expect(arrivalDay('danas nam je dosao kerrock', TODAY)).toBe(TODAY);
        expect(arrivalDay('stigle su šarke za Budnju', TODAY)).toBeNull();

        store.set('product_materials/sa', { ID: 'sa', Organization_ID: ORG, Product_ID: 'p-s1', Material_Name: 'Šarke Blum', Quantity: 8, Unit: 'kom', Unit_Price: 2, Status: 'Naručeno', Ordered_Quantity: 8, Supplier: 'Blum' });
        store.set('product_materials/ru', { ID: 'ru', Organization_ID: ORG, Product_ID: 'p-s1', Material_Name: 'Ručke inox', Quantity: 8, Unit: 'kom', Unit_Price: 3, Status: 'Naručeno', Ordered_Quantity: 8, Supplier: 'Blum' });
        store.set('orders/o3', { Order_ID: 'o3', Organization_ID: ORG, Order_Number: 'N-2026-10/K9', Supplier_Name: 'Blum', Status: 'Poslano', Order_Date: '2026-10-21T08:00:00Z', Sent_At: '2026-10-21T08:00:00Z' });
        store.set('order_items/oi3', { ID: 'oi3', Organization_ID: ORG, Order_ID: 'o3', Product_Material_ID: 'sa', Product_Material_Quantities: { sa: 8 }, Material_Name: 'Šarke Blum', Quantity: 8, Unit: 'kom', Status: 'Naručeno', Received_Quantity: 0, Project_ID: 'pb', Product_ID: 'p-s1' });
        store.set('order_items/oi4', { ID: 'oi4', Organization_ID: ORG, Order_ID: 'o3', Product_Material_ID: 'ru', Product_Material_Quantities: { ru: 8 }, Material_Name: 'Ručke inox', Quantity: 8, Unit: 'kom', Status: 'Naručeno', Received_Quantity: 0, Project_ID: 'pb', Product_ID: 'p-s1' });

        const yesterday = env('jucer su stigle sarke za budnju');
        expect(await runTool(yesterday, 'material_arrived', { items: [{ material: 'šarke' }], project: 'P1' })).toMatchObject({ ok: true });
        expect(docs('order_items').find(i => i.ID === 'oi3')).toMatchObject({ Status: 'Primljeno', Received_Date: '2026-10-26T09:00:00.000Z' });
        expect(yesterday.followUp).toBeUndefined();

        const unsaid = env('stigle rucke za budnju');
        expect(await runTool(unsaid, 'material_arrived', { items: [{ material: 'ručke' }], project: 'P1' })).toMatchObject({ ok: true });
        expect(unsaid.summaries[0]).toMatch(/📅 Kad je stiglo K9\? Upisano je danas/);
        expect(unsaid.followUp![0][0]).toEqual({ text: 'K9 stiglo: jučer', data: 'rcvd:o3:1' });
    });
});

describe('zadatak se ne veže za projekat koji nije rečen', () => {
    it('„završna ploča od Kerrocka" uz Budnju → ne Čorluka', async () => {
        const e = env('Ubrzo cemo trebati poceti sa izradom zavrsne ploce od kerrocka za stolove za budnju');
        const res = await runTool(e, 'create_task', { title: 'Početi izradu završne ploče od Kerrocka', category: 'manufacturing', project: 'P2' });
        expect(res).toMatchObject({ ok: true, note: expect.stringMatching(/nije rečen/) });
        expect(docs('tasks').find(t => t.Organization_ID === ORG)!.Links).toEqual([]);
    });
});
