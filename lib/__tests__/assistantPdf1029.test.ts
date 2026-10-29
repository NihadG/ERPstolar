/**
 * @jest-environment node
 */
// ISPRAVKE IZ PDF-a „Ispravke za app ERP" (29.10.2026) — svaka poruka iz PDF-a je slučaj:
//   1. „Za Budnju su napravljene sve podkonstrukcije od jele smreke i od OSB-a, skrojen sav iveral
//      i u toku je montaža iverala na podkonstrukcije" → procesi kroz graf naloga, ne „nije u katalogu"
//   2. Graf naloga: bot vidi tok (karta) kao tabla „Tok"
//   3. „Koji iveral smo koristili (koji dekor)" za Švicarsku/umivaonike → iz sastavnice, ne „nemam zapisano"

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeDocs as docs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { messageIntent } from '@/lib/assistant/intent';
import { flowMapText } from '@/lib/assistant/flowMap';
import { loadFlowMaps } from '@/lib/assistant/orderStatus';
import { matchProcess, processFullySaid } from '@/lib/workDiary';
import { standardAliases } from '@/lib/processVocabulary';
import { sanitizeModelText } from '@/lib/assistant/replyText';
import type { WorkOrderItem } from '@/lib/types';

const ORG = 'orgQ';
const TODAY = '2026-10-29';
const TZ = 'Europe/Sarajevo';
const noFacts = { dims: [], widths: [], locations: [] };

const NAMES = [
    'Priprema masive', 'Krojenje iverala', 'Krojenje OSB-a', 'Kantiranje iverala', 'Izrada podkonstrukcije od OSB-a',
    'Izrada podkonstrukcije od jele/smreke', 'Sklapanje kutija', 'Brušenje', 'Okivanje',
];
const nodeIds = Object.fromEntries(NAMES.map((n, i) => [n, `n${i}`]));
const node = (name: string, itemIds: string[]) => ({ id: nodeIds[name], name, itemIds });

let turn = 0;
function env(groundText: string): ToolEnv {
    return {
        orgId: ORG, uid: 'u1', tz: TZ, now: new Date(`${TODAY}T08:00:00Z`), turnId: `Q${++turn}`, dateText: groundText, groundText,
        reporter: 'ja', searchHits: [], created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ctx: {
            projects: [
                { alias: 'P1', value: { id: 'pb', name: 'Hoteli Budnjo', client: 'Budnjo' } },
                { alias: 'P2', value: { id: 'ps', name: 'Švicarska', client: 'Švicarska' } },
            ],
            suppliers: [], memory: [], tasks: [], names: [], vocab: [], workers: [],
            orders: [
                { alias: 'R1', value: { id: 'wb', name: 'Budnjo Svedski stolovi' } },
                { alias: 'R2', value: { id: 'wu', name: 'Umivaonici, 1. faza' } },
            ],
        },
    } as unknown as ToolEnv;
}

const item = (id: string) => docs('work_order_items').find(i => i.Organization_ID === ORG && i.ID === id)!;
const status = (id: string, p: string) => item(id).Processes?.find((x: any) => x.Process_Name === p)?.Status;
const assumed = (id: string, p: string) => !!item(id).Processes?.find((x: any) => x.Process_Name === p)?.Assumed_Done;

function seed() {
    store.clear();
    NAMES.forEach((n, i) => store.set(`process_catalog/c${i}`, { ID: `c${i}`, Organization_ID: ORG, Name: n, Order: i + 1 }));
    store.set('projects/pb', { Project_ID: 'pb', Organization_ID: ORG, Name: 'Hoteli Budnjo', Client_Name: 'Budnjo' });
    store.set('projects/ps', { Project_ID: 'ps', Organization_ID: ORG, Name: 'Švicarska', Client_Name: 'Švicarska' });
    // Budnja: s1, s2 imaju podkonstrukcije (jela + OSB); s3 je samo iveral.
    const both = ['s1', 's2'];
    const all = ['s1', 's2', 's3'];
    const nodes = [
        node('Priprema masive', both), node('Izrada podkonstrukcije od jele/smreke', both),
        node('Krojenje OSB-a', both), node('Izrada podkonstrukcije od OSB-a', both),
        node('Krojenje iverala', all), node('Kantiranje iverala', all), node('Sklapanje kutija', all), node('Okivanje', all),
    ];
    const link = (a: string, b: string) => ({ id: `${a}>${b}`, source: nodeIds[a], target: nodeIds[b] });
    store.set('work_orders/wb', {
        Work_Order_ID: 'wb', Organization_ID: ORG, Name: 'Budnjo Svedski stolovi', Status: 'U toku',
        Process_Graph: {
            nodes,
            edges: [
                link('Priprema masive', 'Izrada podkonstrukcije od jele/smreke'), link('Izrada podkonstrukcije od jele/smreke', 'Sklapanje kutija'),
                link('Krojenje OSB-a', 'Izrada podkonstrukcije od OSB-a'), link('Izrada podkonstrukcije od OSB-a', 'Sklapanje kutija'),
                link('Krojenje iverala', 'Kantiranje iverala'), link('Kantiranje iverala', 'Sklapanje kutija'), link('Sklapanje kutija', 'Okivanje'),
            ],
        },
    });
    const planOf = (id: string) => nodes.filter(n => n.itemIds.includes(id)).map(n => ({ Process_Name: n.name, Status: 'Na čekanju' }));
    for (const id of all) {
        store.set(`work_order_items/${id}`, {
            ID: id, Organization_ID: ORG, Work_Order_ID: 'wb', Product_ID: `p-${id}`, Product_Name: `Poz ${id.slice(1)} - Svedski stol`, Project_ID: 'pb',
            Status: 'U toku', Processes: planOf(id),
        });
    }
    // Švicarska: umivaonik s iveralom, kantom i furnirom.
    store.set('work_orders/wu', { Work_Order_ID: 'wu', Organization_ID: ORG, Name: 'Umivaonici, 1. faza', Status: 'U toku' });
    store.set('work_order_items/u1', {
        ID: 'u1', Organization_ID: ORG, Work_Order_ID: 'wu', Product_ID: 'p-u1', Product_Name: 'WHG 0.1 Waschtisch Bad', Project_ID: 'ps', Status: 'U toku',
    });
    store.set('products/p-u1', { Product_ID: 'p-u1', Organization_ID: ORG, Project_ID: 'ps', Name: 'WHG 0.1 Waschtisch Bad', Quantity: 1 });
    const mat = (id: string, name: string, unit: string, qty: number, st: string, supplier?: string) => store.set(`product_materials/${id}`, {
        ID: id, Organization_ID: ORG, Product_ID: 'p-u1', Material_Name: name, Quantity: qty, Unit: unit, Unit_Price: 0, Total_Price: 0, Status: st, ...(supplier ? { Supplier: supplier } : {}),
    });
    mat('m1', 'Furnir / Hrast', 'm2', 1.5, 'Nije naručeno');
    mat('m2', 'Iveral / U960 ST9 Onyx siva', 'Kom', 0.4, 'Na stanju', 'Elgrad');
    mat('m3', 'KT / U960 ST9 23/2', 'm', 24.5, 'Nije naručeno', 'Elgrad');
    mat('m4', 'Lakiranje', 'm2', 3, 'Nije naručeno');
}

beforeEach(seed);

const BUDNJA = 'Za budnju su napravljene sve podkonstrukcije od jele smreke, i sve podkonstrukcije od osb, skrojen sav iveral i u toku je montaza iverala na podkonstrukcije';

describe('1. Budnja: stanje kroz graf naloga', () => {
    const steps = [
        { process: 'Izrada podkonstrukcije od jele/smreke', state: 'done' },
        { process: 'Izrada podkonstrukcije od OSB-a', state: 'done' },
        { process: 'Krojenje iverala', state: 'done' },
        { process: 'Sklapanje kutija', state: 'started' },
    ];

    it('poruka je „stanje" (jači model), ne rad i ne pitanje', () => {
        expect(messageIntent(BUDNJA, [], noFacts).kinds).toEqual(['progress']);
        expect(messageIntent('Koji iveral smo koristili (koji dekor)', [], noFacts).kinds).toEqual(['question']);
    });

    it('sve odjednom: podkonstrukcije gotove, iveral skrojen, sklapanje u toku — prethodnici sami', async () => {
        const e = env(BUDNJA);
        const res = await runTool(e, 'set_progress', { orders: ['R1'], steps });
        expect(res).toMatchObject({ ok: true });
        for (const id of ['s1', 's2']) {
            expect(status(id, 'Izrada podkonstrukcije od jele/smreke')).toBe('Završeno');
            expect(status(id, 'Izrada podkonstrukcije od OSB-a')).toBe('Završeno');
            expect(status(id, 'Priprema masive')).toBe('Završeno');          // ERP zaključio
            expect(assumed(id, 'Priprema masive')).toBe(true);
            expect(status(id, 'Krojenje OSB-a')).toBe('Završeno');
            expect(status(id, 'Krojenje iverala')).toBe('Završeno');
            expect(status(id, 'Kantiranje iverala')).toBe('Završeno');        // prije Sklapanja kutija
            expect(assumed(id, 'Kantiranje iverala')).toBe(true);
            expect(status(id, 'Sklapanje kutija')).toBe('U toku');
            expect(status(id, 'Okivanje')).toBe('Na čekanju');
        }
        // s3 nema podkonstrukcije — procesi mu se ne dodaju
        expect(item('s3').Processes.map((p: any) => p.Process_Name)).toEqual(['Krojenje iverala', 'Kantiranje iverala', 'Sklapanje kutija', 'Okivanje']);
        expect(status('s3', 'Sklapanje kutija')).toBe('U toku');
        // Knjiga rada i prisustvo nisu dirani
        expect(docs('work_logs').filter(l => l.Organization_ID === ORG)).toEqual([]);
        expect(e.summaries).toHaveLength(1);
        expect(e.summaries[0]).toMatch(/Izrada podkonstrukcije od jele\/smreke ✓ završeno/);
        expect(e.summaries[0]).toMatch(/Sklapanje kutija ▶ u toku/);
        expect(e.summaries[0]).toMatch(/pretpostavljeno završeno ranije: .*Kantiranje iverala/);
        expect(e.summaries[0]).toMatch(/Knjiga rada i 🗓 prisustvo — nisu mijenjani/);
    });

    it('proces koji nalog ima samo na nekim proizvodima piše se samo na njima', async () => {
        const e = env(BUDNJA);
        await runTool(e, 'set_progress', { orders: ['R1'], steps: [{ process: 'Izrada podkonstrukcije od OSB-a', state: 'done' }] });
        expect(status('s1', 'Izrada podkonstrukcije od OSB-a')).toBe('Završeno');
        expect(item('s3').Processes.map((p: any) => p.Process_Name)).not.toContain('Izrada podkonstrukcije od OSB-a');
        expect(e.summaries[0]).toMatch(/Poz 3 - Svedski stol \(nema taj proces\)/);
    });

    it('tako kako ga korisnik zove: „montaža iverala na podkonstrukcije" = Sklapanje kutija', async () => {
        const vocab = NAMES;
        expect(matchProcess('montaža iverala na podkonstrukcije', vocab)).toBe('Sklapanje kutija');
        expect(processFullySaid('montaža iverala na podkonstrukcije', 'Sklapanje kutija', standardAliases())).toBe(true);
        expect(matchProcess('podkonstrukcije od jele smreke', vocab)).toBe('Izrada podkonstrukcije od jele/smreke');
        expect(matchProcess('podkonstrukcije od osb', vocab)).toBe('Izrada podkonstrukcije od OSB-a');
        // „montaža" sama i dalje nije Sklapanje kutija
        expect(matchProcess('montaža iverala', vocab)).toBe('Sklapanje kutija');
        const e = env(BUDNJA);
        const res = await runTool(e, 'set_progress', { orders: ['R1'], steps: [{ process: 'montaža iverala na podkonstrukcije', state: 'started' }] });
        expect(res).toMatchObject({ ok: true });
        expect(status('s1', 'Sklapanje kutija')).toBe('U toku');
        expect(status('s1', 'Kantiranje iverala')).toBe('Završeno');
        expect(e.erpQuestion).toBeUndefined();
    });

    it('nepoznat izraz → dugmad s procesima plana, ne „nije u katalogu"; izbor nastavlja preostale korake', async () => {
        const e = env(BUDNJA);
        const res = await runTool(e, 'set_progress', { orders: ['R1'], steps: [
            { process: 'zavarivanje', state: 'done' },
            { process: 'Krojenje iverala', state: 'done' },
        ] });
        expect(res).toMatchObject({ ok: true });
        const q = e.erpQuestion!;
        expect(q.question).toMatch(/„zavarivanje" — koji je to proces\?/);
        expect(q.options.map(o => o.label)).toEqual(expect.arrayContaining(['➕ Nov proces: Zavarivanje', 'Preskoči']));
        expect(q.options[0].label).not.toMatch(/nije u katalogu/);
        // Izbor „Krojenje iverala" završi i preostali korak (Krojenje iverala) — jedan upis, bez modela.
        const pick = q.options.find(o => o.label === 'Krojenje iverala')!;
        const e2 = env(BUDNJA);
        await runTool(e2, 'set_progress', pick.args);
        expect(status('s1', 'Krojenje iverala')).toBe('Završeno');
        // Izbor dugmetom se pamti: sljedeći put „zavarivanje" prolazi bez pitanja.
        expect(e2.summaries.join('\n')).toMatch(/📌 Zapamtio: „zavarivanje" = Krojenje iverala/);
        expect(docs('assistant_vocab').find(v => v.Phrase === 'zavarivanje')).toMatchObject({ Kind: 'process', Target_Label: 'Krojenje iverala', Source: 'confirmed' });
        const e3 = env(BUDNJA);
        e3.ctx.vocab = docs('assistant_vocab').filter(v => v.Organization_ID === ORG) as any;
        await runTool(e3, 'set_progress', { orders: ['R1'], steps: [{ process: 'zavarivanje', state: 'done' }] });
        expect(e3.erpQuestion).toBeUndefined();
    });
});

describe('2. Tok naloga za bota', () => {
    it('karta kao tabla „Tok": proces, gotovo/ukupno, na redu, na šta čeka, samo koji proizvodi', async () => {
        const items = docs('work_order_items').filter(i => i.Work_Order_ID === 'wb') as WorkOrderItem[];
        const graph = docs('work_orders').find(o => o.Work_Order_ID === 'wb')!.Process_Graph;
        const txt = flowMapText({ alias: 'R1', name: 'Budnjo Svedski stolovi', graph, items });
        expect(txt).toMatch(/^R1 Budnjo Svedski stolovi — 3 proizvoda/);
        expect(txt).toMatch(/• Krojenje iverala — na redu \(0\/3\)/);
        expect(txt).toMatch(/• Sklapanje kutija — čeka .*(Kantiranje iverala).* \(0\/3\)/);
        expect(txt).toMatch(/• Izrada podkonstrukcije od OSB-a — čeka Krojenje OSB-a \(0\/2\) — samo 2 od 3|• Izrada podkonstrukcije od OSB-a — čeka Krojenje OSB-a \(0\/2\) — samo Poz 1/);
    });

    it('karta za prompt se učitava iz baze po nalogu i oznaci', async () => {
        const txt = await loadFlowMaps(ORG, [{ alias: 'R1', id: 'wb', name: 'Budnjo Svedski stolovi' }]);
        expect(txt).toMatch(/^R1 Budnjo Svedski stolovi/);
        expect(txt).toMatch(/Okivanje/);
    });

    it('order_status uz proizvode daje i cijeli tok procesa', async () => {
        const res: any = await runTool(env('stanje za budnju'), 'order_status', { orders: ['R1'] });
        expect(res.ok).toBe(true);
        expect(res.lines.join('\n')).toMatch(/TOK PROCESA:/);
        expect(res.lines.join('\n')).toMatch(/Izrada podkonstrukcije od jele\/smreke/);
    });
});

describe('3. Koji iveral je išao za Švicarsku / umivaonike', () => {
    it('po nalogu (R#) i vrsti materijala: dekor iverala, bez kanta', async () => {
        const res: any = await runTool(env('Koji iveral smo koristili za umivaonike'), 'product_materials', { orders: ['R2'], material: 'iveral' });
        expect(res.ok).toBe(true);
        expect(res.materials).toHaveLength(1);
        expect(res.materials[0]).toMatch(/^Iveral \/ U960 ST9 Onyx siva — 0.4 Kom · Na stanju · Elgrad · proizvodi: WHG 0.1 Waschtisch Bad/);
    });

    it('kant je zasebna vrsta, a pogrešan proizvod nudi popis proizvoda', async () => {
        const kant: any = await runTool(env('koji kant'), 'product_materials', { project: 'P2', material: 'kant' });
        expect(kant.materials[0]).toMatch(/^KT \/ U960 ST9 23\/2/);
        const wrong: any = await runTool(env('x'), 'product_materials', { project: 'P2', product: 'umivaonik' });
        expect(wrong).toMatchObject({ ok: false });
        expect(wrong.error).toMatch(/Proizvodi: WHG 0.1 Waschtisch Bad/);
    });

    it('ponuda „Ako mi kažeš…, mogu upisati" se briše iz odgovora', () => {
        const text = 'Nemam zapisan dekor iverala. Ako mi kažeš koji dekor je bio, mogu to upisati uz proizvod.';
        expect(sanitizeModelText(text, { dropClaims: false })).toBe('Nemam zapisan dekor iverala.');
    });
});
