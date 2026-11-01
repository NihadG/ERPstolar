/**
 * @jest-environment node
 */
// Tabele za bota: model kaže izvor i filter, ERP složi kolone, redove, grupe
// i zbir i pošalje PDF. Primjeri su korisnikovi zahtjevi od 01.11.2026.

type Step = { calls?: { name: string; args: Record<string, unknown> }[]; text?: string };
const mockScript: Step[] = [];
const mockSent: any[] = [];
let mockToolSeq = 0;

jest.mock('@anthropic-ai/sdk', () => {
    class APIError extends Error { status = 500; }
    class Anthropic {
        static APIError = APIError;
        messages = {
            create: async (params: any) => {
                mockSent.push(JSON.parse(JSON.stringify(params)));
                const step = mockScript.shift();
                if (!step) throw new Error('skripta je prazna');
                const content = [
                    ...(step.text ? [{ type: 'text', text: step.text }] : []),
                    ...(step.calls || []).map(c => ({ type: 'tool_use', id: `tu${++mockToolSeq}`, name: c.name, input: c.args })),
                ];
                return {
                    content,
                    stop_reason: step.calls?.length ? 'tool_use' : 'end_turn',
                    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
                };
            },
        };
    }
    return { __esModule: true, default: Anthropic };
});

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeStore as mockStore } from '@/lib/testing/fakeFirestore';
import { runAssistant } from '@/lib/assistant/brain';
import { messageIntent } from '@/lib/assistant/intent';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';
import { toolSetFor } from '@/lib/assistant/toolRouting';
import { buildTablePdf, fitWidths } from '@/lib/server/tablePdf';
import { materialsTable, notebookTable, type TableMaterialRow } from '@/lib/tables/sources';
import { requestedColumns, resolveColumns, rowsLabel, type TableDoc } from '@/lib/tables/table';
import type { MemoryItem } from '@/lib/types';

const NOW = new Date('2026-11-01T10:00:00Z');
const DAY = '2026-11-01';
const since = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

const mem = (id: string, o: Partial<MemoryItem>): MemoryItem => ({
    Item_ID: id, Organization_ID: 'org1', Owner_UID: 'u1', Title: '', Subject: '', Links: [],
    State: 'open', State_Label: 'u stanu, nije postavljeno', State_Key: 'nije_postavljeno',
    Tags: [], History: [], Source_Entry_IDs: [], Created_At: '2026-10-20T08:00:00Z', Updated_At: '2026-10-20T08:00:00Z', ...o,
});

const NOTEBOOK: MemoryItem[] = [
    mem('m1', { Title: 'Ogledalo 1000x1350', Subject: 'ogledalo', Quantity: 2, Unit: 'kom', Location: 'E104' }),
    mem('m2', { Title: 'Umivaonik 600x450', Subject: 'umivaonik', Quantity: 1, Unit: 'kom', Location: 'E20', Spec: 'bijeli' }),
    mem('m3', { Title: 'Ogledalo 900x700', Subject: 'ogledalo', Quantity: 1, Unit: 'kom', Location: 'C305', State_Key: 'pogresno', State_Label: 'pogrešno postavljeno, treba 1100x1000' }),
    mem('m4', { Title: 'Lajsna š 80', Subject: 'lajsna', Quantity: 6, Unit: 'kom', Location: 'C305' }),
    mem('m5', { Title: 'Ogledalo 1000x1350', Subject: 'ogledalo', Quantity: 1, Unit: 'kom', Location: 'E108', State: 'resolved', State_Key: 'postavljeno', State_Label: 'postavljeno' }),
];

const STANOVI = 'Napravi tabelu za stanove i ogledala, u kolonama stan, umivaonik/ogledalo, dimenzije, količina, napomena';
const NENARUCENO = 'Tabelu nenaručenih materijala u tabeli materijal, kolicina, dobavljac ili sta god drugo';

describe('kolone iz poruke', () => {
    it('korisnikovi primjeri → kolone istim redom', () => {
        expect(requestedColumns(STANOVI)).toEqual(['stan', 'umivaonik/ogledalo', 'dimenzije', 'količina', 'napomena']);
        expect(requestedColumns(NENARUCENO)).toEqual(['materijal', 'kolicina', 'dobavljac']);
        expect(requestedColumns('daj mi u tabeli spisak ogledala: stan, mjere i stanje')).toEqual(['stan', 'mjere', 'stanje']);
    });

    it('bez nabrajanja nema kolona — tad važe modelove ili podrazumijevane', () => {
        expect(requestedColumns('napravi tabelu nenaručenih materijala')).toEqual([]);
        expect(requestedColumns('u kolonama stan')).toEqual([]);
    });

    it('najduža riječ pobjeđuje: „za naručiti" je količina, „naručeno" je svoja kolona', () => {
        const t = materialsTable([], { status: 'za_naruciti', scope: 'x' }, ['materijal', 'za naručiti', 'naručeno', 'nenaručeno'], { day: DAY });
        expect(t.columns.map(c => c.key)).toEqual(['materijal', 'kolicina', 'naruceno']);
    });

    it('nepoznata kolona se javi, ne pogađa se', () => {
        const t = materialsTable([], { status: 'za_naruciti', scope: 'x' }, ['materijal', 'boja'], { day: DAY });
        expect(t.columns.map(c => c.key)).toEqual(['materijal']);
        expect(t.notes[0]).toMatch(/^Kolonu „boja" ne znam — mogu: materijal, količina/);
    });

    it('zaglavlje: korisnikove riječi, a kvačice iz ERP-a kad je ista riječ', () => {
        const { picked } = resolveColumns(['kolicina', 'dobavljac', 'od koga'], [
            { key: 'kolicina', label: 'Količina', words: ['kolic'], value: () => '' },
            { key: 'dobavljac', label: 'Dobavljač', words: ['dobavlj', 'od koga'], value: () => '' },
        ]);
        expect(picked.map(p => p.label)).toEqual(['Količina', 'Dobavljač']);
    });

    it('broj redova po padežu', () => {
        expect([1, 3, 5, 11, 21, 22, 112].map(rowsLabel)).toEqual(['1 red', '3 reda', '5 redova', '11 redova', '21 red', '22 reda', '112 redova']);
    });
});

describe('bilježnica u tabeli', () => {
    const table = notebookTable(NOTEBOOK, { subjects: ['ogledalo', 'umivaonik'], locations: [], state: 'otvoreno' }, requestedColumns(STANOVI), { since, day: DAY });

    it('kolone po korisniku, „umivaonik/ogledalo" je predmet', () => {
        expect(table.columns).toEqual([
            { key: 'lokacija', label: 'Stan', align: 'left' },
            { key: 'predmet', label: 'Umivaonik/ogledalo', align: 'left' },
            { key: 'mjere', label: 'Dimenzije', align: 'left' },
            { key: 'kolicina', label: 'Količina', align: 'right' },
            { key: 'napomena', label: 'Napomena', align: 'left' },
        ]);
    });

    it('samo otvorena ogledala i umivaonici, po lameli pa stanu (E20 prije E104), mjere u svojoj koloni', () => {
        expect(table.groups).toEqual([
            { label: 'C lamela', rows: [['C305', 'Ogledalo', '900x700', '1 kom', 'pogrešno postavljeno, treba 1100x1000']] },
            {
                label: 'E lamela', rows: [
                    ['E20', 'Umivaonik', '600x450', '1 kom', 'bijeli · u stanu, nije postavljeno'],
                    ['E104', 'Ogledalo', '1000x1350', '2 kom', 'u stanu, nije postavljeno'],
                ],
            },
        ]);
        expect(table.total).toEqual(['', '', '', '4 kom', '']);
        expect(table.rowCount).toBe(3);
    });

    it('podnaslov kaže šta je ERP razumio; ime fajla bez kvačica', () => {
        expect(table.title).toBe('Bilježnica — ogledalo, umivaonik');
        expect(table.subtitle).toBe('nije postavljeno · 3 reda');
        expect(table.fileName).toBe('Tabela_biljeznica_ogledalo_umivaonik_2026-11-01.pdf');
    });

    it('bez kolona → podrazumijevane; stanje kao kolona skida ga iz napomene', () => {
        const plain = notebookTable(NOTEBOOK, { subjects: ['ogledalo'], locations: ['E'], state: 'otvoreno' }, [], { since, day: DAY });
        expect(plain.columns.map(c => c.key)).toEqual(['lokacija', 'predmet', 'mjere', 'kolicina', 'napomena']);
        expect(plain.subtitle).toBe('nije postavljeno · lamela E · 1 red');
        const withState = notebookTable(NOTEBOOK, { subjects: ['umivaonik'], locations: [], state: 'otvoreno' }, ['stan', 'napomena', 'stanje'], { since, day: DAY });
        expect(withState.groups[0].rows).toEqual([['E20', 'bijeli', 'u stanu, nije postavljeno']]);
    });
});

const mat = (o: Partial<TableMaterialRow>): TableMaterialRow => ({
    name: 'Iveral U960 ST9', unit: 'm²', supplier: 'Iverpan', unitPrice: 20, productName: 'Kuhinja', projectId: 'p1', projectName: 'Grbavica',
    needed: 10, onStock: 0, ordered: 0, received: 0, inDrafts: 0, toOrder: 10, status: 'Nije naručeno', ...o,
});

describe('materijali u tabeli', () => {
    const rows = [
        mat({}),
        mat({ productName: 'Ormar', needed: 6, toOrder: 6 }),                                          // isti iveral, drugi proizvod → sabere se
        mat({ name: 'Šarke Blum CLIP top', unit: 'kom', supplier: 'Blum', unitPrice: 6.4, needed: 24, toOrder: 0, ordered: 24, status: 'Naručeno' }),
        mat({ name: 'Ručke 128 mm', unit: 'kom', supplier: 'Häfele', unitPrice: 3, projectId: 'p2', projectName: 'Budnja', needed: 12, toOrder: 12, inDrafts: 12 }),
    ];

    it('nenaručeno: sabrano po materijalu, grupe po projektu, sortirano po dobavljaču', () => {
        const t = materialsTable(rows, { status: 'za_naruciti', scope: 'projekti na kojima se radi (2)' }, requestedColumns(NENARUCENO), { day: DAY });
        expect(t.title).toBe('Nenaručeni materijali');
        expect(t.columns.map(c => c.label)).toEqual(['Materijal', 'Količina', 'Dobavljač']);
        expect(t.groups).toEqual([
            { label: 'Budnja', rows: [['Ručke 128 mm', '12 kom', 'Häfele']] },
            { label: 'Grbavica', rows: [['Iveral U960 ST9', '16 m²', 'Iverpan']] },
        ]);
        expect(t.total).toBeNull();   // m² i kom se ne sabiraju
        expect(t.subtitle).toBe('projekti na kojima se radi (2) · 2 reda · količina = još za naručiti');
        expect(t.notes).toEqual(['U nacrtu narudžbe (nije poslano): 1 od 2.']);
    });

    it('čeka se, filter dobavljača, iznos sa zbirom; kolona projekta ukida grupe', () => {
        const t = materialsTable(rows, { status: 'naruceno', supplier: 'blum', scope: 'Grbavica' }, ['materijal', 'koliko', 'projekat', 'iznos'], { day: DAY });
        expect(t.groups).toEqual([{ label: '', rows: [['Šarke Blum CLIP top', '24 kom', 'Grbavica', '153.60 KM']] }]);
        expect(t.total).toEqual(['', '24 kom', '', '153.60 KM']);
    });

    it('kolona proizvoda: red po proizvodu, ne sabira se', () => {
        const t = materialsTable(rows, { status: 'za_naruciti', material: 'iveral', scope: 'Grbavica' }, ['materijal', 'proizvod', 'kolicina'], { day: DAY });
        expect(t.groups[0].rows).toEqual([['Iveral U960 ST9', 'Kuhinja', '10 m²'], ['Iveral U960 ST9', 'Ormar', '6 m²']]);
        expect(t.total).toEqual(['', '', '16 m²']);
    });
});

describe('PDF tabele', () => {
    const doc = (columns: number, rows: number): TableDoc => ({
        title: 'Bilježnica — ogledalo', subtitle: 'nije postavljeno · č ć đ š ž',
        columns: Array.from({ length: columns }, (_, i) => ({ key: `k${i}`, label: `Kolona ${i}`, align: i === 1 ? 'right' : 'left' })),
        groups: [{ label: 'E lamela', rows: Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => `Ćelija ${r}/${c} ${c === 0 ? 'dugačak tekst koji se mora prelomiti u više redova jer je preširok za kolonu' : ''}`)) }],
        total: null, notes: ['Napomena ispod tabele.'], rowCount: rows, fileName: 'x.pdf',
    });

    it('pravi PDF s našim slovima, više strana kad je dugo, položeno kad je široko', () => {
        const pdf = buildTablePdf(doc(5, 120), { name: 'Firma d.o.o.' }, '01.11.2026.');
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        const text = pdf.toString('latin1');
        expect((text.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(2);
        expect(text).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
        expect(buildTablePdf(doc(7, 3), {}, '01.11.2026.').toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/);
    });

    it('širine: uske kolone ostaju, široke dijele ostatak; višak ide tekstualnim', () => {
        expect(fitWidths([10, 100, 100], 110, [false, true, true])).toEqual([10, 50, 50]);
        expect(fitWidths([10, 20, 30], 100, [false, true, false])).toEqual([10, 60, 30]);
    });
});

describe('tabela kroz bota', () => {
    const intent = (text: string) => messageIntent(text, [], { dims: [], widths: [], locations: [] });

    it('„tabela" je čitanje: nije narudžba ni bilježnica, alati za pitanje', () => {
        expect(intent(NENARUCENO)).toMatchObject({ kinds: ['table'], expectsWrite: false });
        expect(intent('napravi tabelu u stanu E104 ogledala')).toMatchObject({ kinds: ['table'], expectsWrite: false });
        expect(toolSetFor(['table'])).toBe('question');
        expect(intent('pošalji Amri tabelu mailom').kinds).toEqual(['email']);
    });

    beforeAll(() => {
        process.env.ANTHROPIC_API_KEY = 'test';
        process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo';
        NOTEBOOK.forEach(m => mockStore.set(`memory_items/${m.Item_ID}`, m));
        mockStore.set('projects/p1', { Project_ID: 'p1', Name: 'Grbavica', Status: 'U proizvodnji', Organization_ID: 'org1' });
        mockStore.set('projects/p2', { Project_ID: 'p2', Name: 'Budnja', Status: 'Nacrt', Organization_ID: 'org1' });       // nalog prije ponude
        mockStore.set('projects/p3', { Project_ID: 'p3', Name: 'Ponuda Ilidža', Status: 'Ponuđeno', Organization_ID: 'org1' });
        mockStore.set('projects/p4', { Project_ID: 'p4', Name: 'Stari', Status: 'Završeno', Organization_ID: 'org1' });
        mockStore.set('work_orders/w2', { Work_Order_ID: 'w2', Status: 'U toku', Organization_ID: 'org1' });
        mockStore.set('work_order_items/wi2', { Work_Order_ID: 'w2', Project_ID: 'p2', Product_ID: 'pr2', Organization_ID: 'org1' });
        mockStore.set('products/pr1', { Product_ID: 'pr1', Project_ID: 'p1', Name: 'Kuhinja', Quantity: 2, Organization_ID: 'org1' });
        mockStore.set('products/pr2', { Product_ID: 'pr2', Project_ID: 'p2', Name: 'Vrata', Quantity: 1, Organization_ID: 'org1' });
        mockStore.set('products/pr3', { Product_ID: 'pr3', Project_ID: 'p3', Name: 'Ormar', Quantity: 1, Organization_ID: 'org1' });
        // Sastavnica je PO KOMADU: 5 m² × 2 kuhinje = 10 m²
        mockStore.set('product_materials/a', { ID: 'a', Product_ID: 'pr1', Material_Name: 'Iveral U960 ST9', Quantity: 5, Unit: 'm²', Supplier: 'Iverpan', Unit_Price: 20, Status: 'Nije naručeno', Organization_ID: 'org1' });
        mockStore.set('product_materials/b', { ID: 'b', Product_ID: 'pr1', Material_Name: 'Šarke Blum', Quantity: 12, Unit: 'kom', Supplier: 'Blum', Status: 'Naručeno', Ordered_Quantity: 24, Organization_ID: 'org1' });
        mockStore.set('product_materials/c', { ID: 'c', Product_ID: 'pr2', Material_Name: 'Brava', Quantity: 1, Unit: 'kom', Supplier: 'Häfele', Status: 'Nije naručeno', Organization_ID: 'org1' });
        mockStore.set('product_materials/d', { ID: 'd', Product_ID: 'pr3', Material_Name: 'Klizači', Quantity: 4, Unit: 'kom', Status: 'Nije naručeno', Organization_ID: 'org1' });
    });

    it('stanovi i ogledala: jedan poziv modela, tabela ide kao PDF, odgovor složi ERP', async () => {
        mockSent.length = 0;
        mockScript.push({ calls: [{ name: 'make_table', args: { source: 'biljeska', subjects: ['ogledalo', 'umivaonik'], columns: ['lokacija'] } }] });
        const out = await runAssistant({ orgId: 'org1', uid: 'u1', text: STANOVI, session: { history: [], pending: null }, now: NOW });
        expect(mockScript).toHaveLength(0);
        expect(mockSent).toHaveLength(1);
        expect(mockSent[0].tools.map((t: any) => t.name)).toContain('make_table');
        expect(mockSent[0].tools.map((t: any) => t.name)).not.toContain('create_order');
        // Kolone iz poruke, ne modelove „lokacija".
        expect(out.tables?.[0].columns.map(c => c.label)).toEqual(['Stan', 'Umivaonik/ogledalo', 'Dimenzije', 'Količina', 'Napomena']);
        expect(out.reply).toBe('📄 Bilježnica — ogledalo, umivaonik — nije postavljeno · 3 reda. PDF stiže ispod.');
        expect(out.changed).toBe(false);
    });

    const env = (messageText: string) => ({
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: NOW, turnId: 't', dateText: '', reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [], messageText,
        ctx: { workers: [], projects: [{ alias: 'P1', value: { id: 'p1', client: '', name: 'Grbavica' } }], suppliers: [], memory: [], tasks: [], names: [] },
    }) as unknown as ToolEnv;

    it('nenaručeni materijali: projekti u radu i s otvorenim nalogom, količina × komada proizvoda', async () => {
        const e = env(NENARUCENO);
        expect(await runTool(e, 'make_table', { source: 'materijali' })).toEqual({ ok: true, count: 2 });
        const t = e.tables![0];
        expect(t.groups).toEqual([
            { label: 'Budnja', rows: [['Brava', '1 kom', 'Häfele']] },
            { label: 'Grbavica', rows: [['Iveral U960 ST9', '10 m²', 'Iverpan']] },
        ]);
        expect(t.subtitle).toBe('projekti na kojima se radi (2) · 2 reda · količina = još za naručiti');
    });

    it('prazno → poruka bez PDF-a; nepoznat projekat → greška modelu', async () => {
        const e = env('napravi tabelu');
        expect(await runTool(e, 'make_table', { source: 'materijali', project: 'P1', supplier: 'Nepostojeći' })).toEqual({ ok: true, count: 0 });
        expect(e.tables).toBeUndefined();
        expect(e.summaries[0]).toBe('📋 Nenaručeni materijali — Grbavica · Nepostojeći · količina = još za naručiti: nema ničega.');
        expect(await runTool(env(''), 'make_table', { source: 'materijali', project: 'P9' })).toMatchObject({ ok: false });
    });
});
