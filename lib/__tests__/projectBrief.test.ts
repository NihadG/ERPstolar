/**
 * @jest-environment node
 */
jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import { fakeStore as store } from '@/lib/testing/fakeFirestore';
import { buildProjectBrief, groupMaterials, productMatches, type BriefInput } from '@/lib/assistant/projectBrief';
import { runTool, type ToolEnv } from '@/lib/assistant/tools';

const row = (name: string, productName: string, needed: number, extra: Partial<BriefInput['materials'][number]> = {}) => ({
    name, unit: 'ploča', supplier: 'Ploče Demo', productName, needed, ordered: 0, received: 0, onStock: 0, ...extra,
});

describe('kartica projekta — sastav', () => {
    const input: BriefInput = {
        label: 'Adnan Kovač · Kuća faza 2',
        status: 'U proizvodnji',
        products: [
            { name: 'ST2.A Ormar spavaća', quantity: 1, status: 'U izradi' },
            { name: 'ST2.B Ormar hodnik', quantity: 1, status: 'Na čekanju' },
            { name: 'Kuhinja', quantity: 1, status: 'Završeno' },
        ],
        materials: [
            row('Iveral F416 Textil Bež 18mm', 'ST2.A Ormar spavaća', 3, { received: 3 }),
            row('Iveral F416 Textil Bež 18mm', 'ST2.B Ormar hodnik', 2, { ordered: 2 }),
            row('Iveral U702 Kašmir 18mm', 'Kuhinja', 4, { received: 4 }),
            row('Kant F416 2mm', 'ST2.A Ormar spavaća', 25, { unit: 'm' }),
        ],
        orders: [
            { number: 'N2026-10/24', supplier: 'Ploče Demo', status: 'Poslano', date: '2026-10-20T08:00:00Z', items: 2, materials: ['Iveral F416 Textil Bež 18mm'], emailedAt: '2026-10-20T08:00:00Z', supplierDoc: '330421', readyAt: '2026-10-28T08:00:00Z' },
            { number: 'N2026-09/03', supplier: 'Ploče Demo', status: 'Primljeno', date: '2026-09-10T08:00:00Z', items: 1, materials: ['Iveral U702 Kašmir 18mm'] },
        ],
        history: { span: { first: '2026-09-15', last: '2026-10-28', workDays: 20, personDays: 31, workers: ['Kemal', 'Bego'] }, orders: [] },
        notebook: [{ title: 'Ladica u kupatilu', location: 'Sprat', state: 'popraviti' }],
        tasks: [{ title: 'Razvrstati pozicije za utovar', due: '2026-11-03', worker: 'Bego' }],
        people: [{ name: 'Adnan Kovač', role: 'Kupac', email: 'adnan@kuca-demo.example' }],
    };

    it('isti materijal na više proizvoda je jedan red sa zbirom i stanjem', () => {
        const g = groupMaterials(input.materials);
        expect(g[0]).toMatchObject({ name: 'Iveral F416 Textil Bež 18mm', needed: 5, received: 3, ordered: 2, products: ['ST2.A Ormar spavaća', 'ST2.B Ormar hodnik'] });
    });

    it('cijela kartica: projekat, proizvodi, materijali, narudžbe s tragom pošte, rad, bilježnica, zadaci, ljudi', () => {
        const t = buildProjectBrief(input);
        expect(t.split('\n')[0]).toBe('PROJEKAT: Adnan Kovač · Kuća faza 2 · U proizvodnji');
        expect(t).toContain('• Iveral F416 Textil Bež 18mm (Ploče Demo) — 5 ploča · primljeno 3, naručeno 2 · ST2.A Ormar spavaća, ST2.B Ormar hodnik');
        expect(t).toContain('• Iveral U702 Kašmir 18mm (Ploče Demo) — 4 ploča · sve tu · Kuhinja');
        expect(t).toContain('• Kant F416 2mm (Ploče Demo) — 25 m · nije naručeno 25 · ST2.A Ormar spavaća');
        expect(t).toContain('• N2026-10/24 · Ploče Demo · Poslano · 20.10. · 2 stavki (mailom 20.10., predračun/ponuda 330421, spremno 28.10.)');
        expect(t).toContain('Projekat: PRVI dan rada 15.9.2026, ZADNJI 28.10.2026');
        expect(t).toContain('• Ladica u kupatilu · Sprat — popraviti');
        expect(t).toContain('• Razvrstati pozicije za utovar · rok 3.11. · Bego');
        expect(t).toContain('• Adnan Kovač — Kupac <adnan@kuca-demo.example>');
    });

    it('„Jerkini ormari": samo ormari, njihovi materijali i narudžbe', () => {
        expect(productMatches('ST2.A Ormar spavaća', 'ormari')).toBe(true);
        expect(productMatches('Kuhinja', 'ormari')).toBe(false);
        const t = buildProjectBrief(input, { product: 'ormari' });
        expect(t).toContain('(samo proizvodi koji odgovaraju „ormari": 2 od 3)');
        expect(t).toContain('Iveral F416 Textil Bež 18mm');
        expect(t).not.toContain('Iveral U702');
        expect(t).toContain('N2026-10/24');
        expect(t).not.toContain('N2026-09/03');
    });

    it('prazan projekat', () => {
        const t = buildProjectBrief({ label: 'Novi', products: [], materials: [], orders: [], history: null, notebook: [], tasks: [], people: [] });
        expect(t).toContain('— u sastavnici nema materijala');
        expect(t).toContain('— nema narudžbi');
        expect(t).toContain('u Knjizi rada nema upisanog rada');
    });
});

describe('alat project_brief', () => {
    const env = (): ToolEnv => ({
        orgId: 'org1', uid: 'u1', tz: 'Europe/Sarajevo', now: new Date('2026-10-30T10:00:00Z'), turnId: 't1', dateText: '', reporter: 'ja',
        searchHits: [], created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [],
        ctx: { workers: [], suppliers: [], memory: [], tasks: [], names: [], projects: [{ alias: 'P1', value: { id: 'p1', client: 'Adnan Kovač', name: 'Kuća faza 2' } }] },
    } as unknown as ToolEnv);

    beforeEach(() => {
        store.clear();
        store.set('projects/p1', { Project_ID: 'p1', Organization_ID: 'org1', Client_Name: 'Adnan Kovač', Name: 'Kuća faza 2', Status: 'U proizvodnji' });
        store.set('products/a', { Product_ID: 'pa', Organization_ID: 'org1', Project_ID: 'p1', Name: 'Ormar spavaća', Quantity: 1, Status: 'U izradi' });
        store.set('product_materials/m1', { ID: 'm1', Organization_ID: 'org1', Product_ID: 'pa', Material_Name: 'Iveral F416 Textil Bež 18mm', Quantity: 3, Unit: 'ploča', Status: 'Primljeno', Supplier: 'Ploče Demo', Order_ID: '', Received_Quantity: 3, Ordered_Quantity: 3 });
        store.set('contacts/c1', { Contact_ID: 'c1', Organization_ID: 'org1', First_Name: 'Selma', Last_Name: 'Ribić', Email: 'selma@projekt-demo.example', Kind: 'site', Project_Roles: [{ Project_ID: 'p1', Role: 'nadzor' }], Created_At: '' });
    });

    it('vraća karticu iz baze; dekor je u njoj', async () => {
        const res = await runTool(env(), 'project_brief', { project: 'P1' });
        expect(res.ok).toBe(true);
        expect(String(res.brief)).toContain('Iveral F416 Textil Bež 18mm');
        expect(String(res.brief)).toContain('• Selma Ribić — Nadzor <selma@projekt-demo.example>');
    });

    it('nepoznat projekat je greška', async () => {
        expect((await runTool(env(), 'project_brief', { project: 'P9' })).ok).toBe(false);
        expect((await runTool(env(), 'project_brief', {})).ok).toBe(false);
    });
});
