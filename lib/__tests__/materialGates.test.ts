import {
    DEFAULT_STOCK_RULES, buildGates, candidateKeys, dueAlerts, gateReady, isStockMaterial, itemSteps, materialRole, materialState,
    rowLabel, supplierLeadDays, type GateItemInput, type GateMaterialInput,
} from '../materialGates';
import type { ItemProcessStatus, ProcessGraph } from '../types';

// Kuhinja: kutije od iverala + furnirane MDF fronte, lak, okovi, staklo.
const NAMES: Record<string, string> = {
    a: 'Krojenje iverala', b: 'Kantiranje iverala', c: 'Sklapanje kutija', d: 'Priprema furnira', e: 'Krojenje MDF-a',
    f: 'Furniranje', g: 'Srezivanje na tačnu mjeru', h: 'Kantiranje furnira', i: 'Probna montaža', j: 'Brušenje',
    k: 'Lakiranje', l: 'Završno sklapanje', m: 'Okivanje',
};
const EDGES = ['a>b', 'b>c', 'c>i', 'e>f', 'd>f', 'f>g', 'g>h', 'h>i', 'i>j', 'j>k', 'k>l', 'l>m'];
const graph: ProcessGraph = {
    nodes: Object.entries(NAMES).map(([id, name]) => ({ id, name, itemIds: [] })),
    edges: EDGES.map(e => ({ id: e, source: e[0], target: e[2] })),
};

const item = (done: string[] = [], active: string[] = []): GateItemInput => ({
    ID: 'it1', Product_ID: 'p1', Product_Name: 'Kuhinja', Product_Quantity: 1,
    Processes: [
        ...done.map(k => ({ Process_Name: NAMES[k], Status: 'Završeno' as const })),
        ...active.map(k => ({ Process_Name: NAMES[k], Status: 'U toku' as const })),
    ] as ItemProcessStatus[],
});

const mat = (id: string, name: string, extra: Partial<GateMaterialInput> = {}): GateMaterialInput => ({
    ID: id, Product_ID: 'p1', Material_Name: name, Unit: 'kom', Quantity: 2, Status: 'Nije naručeno', ...extra,
});
const materials: GateMaterialInput[] = [
    mat('m1', 'Iveral U702 18mm', { Status: 'Naručeno', Ordered_Quantity: 2, Order_ID: 'o1', Unit: 'ploča' }),
    mat('m2', 'MDF 18mm', { Unit: 'ploča' }),
    mat('m3', 'Furnir hrast 0,6', { Unit: 'm2', Quantity: 22 }),
    mat('m4', 'ABS kant traka 2mm', { Unit: 'm', Quantity: 40 }),
    mat('m5', 'Lak vodeni mat', { Unit: 'l' }),
    mat('m6', 'Šarke Blum CLIP top', { Quantity: 24, catalog: { Category: 'Okovi' } }),
    mat('m7', 'Ručke Häfele 160', { Quantity: 12, Status: 'Naručeno', Ordered_Quantity: 12 }),
    mat('m8', 'Staklo float 4mm', { catalog: { Is_Glass: true } }),
    mat('m9', 'Ljepilo D3'),
];
const orders = new Map([['o1', { number: 'N-12', supplier: 'Frischeis', date: '2026-10-21T08:00:00Z', status: 'Poslano' }]]);

describe('kapije materijala: kod kojeg procesa treba', () => {
    it('vrsta materijala → proces; dug rok za staklo i ogledalo', () => {
        expect(materialRole('Šarke Blum').candidates[0]).toBe('Okivanje');
        expect(materialRole('Ogledalo 4mm').type).toBe('ogledalo');
        expect(materialRole('Ogledalo 4mm').longLead).toBe(true);
        expect(materialRole('KT / Furnir hrast 24/1').candidates[0]).toBe('Kantiranje furnira');
        expect(materialRole('Boja za MDF').candidates[0]).toBe('Farbanje');
        expect(materialRole('Ljepilo D3').candidates).toEqual([]);
        expect(materialRole('Nešto', { Category: 'Okovi' }).candidates[0]).toBe('Okivanje');
        expect(materialRole('Iveral', { Need_By_Process: 'Probna montaža' }).candidates[0]).toBe('Probna montaža');
    });

    it('zaliha: tip ili riječ naziva; oznaka u katalogu ima prednost', () => {
        expect(isStockMaterial('MDF 18mm', undefined, DEFAULT_STOCK_RULES)).toBe(true);
        expect(isStockMaterial('Furnir hrast 0,6', undefined, DEFAULT_STOCK_RULES)).toBe(true);
        expect(isStockMaterial('Furnir orah', undefined, DEFAULT_STOCK_RULES)).toBe(false);
        expect(isStockMaterial('MDF 18mm', { Is_Stock: false }, DEFAULT_STOCK_RULES)).toBe(false);
        expect(isStockMaterial('Iveral U702', { Is_Stock: true }, DEFAULT_STOCK_RULES)).toBe(true);
    });

    it('stanje iz statusa i količina', () => {
        expect(materialState(mat('x', 'X', { Status: 'Na stanju' }), 1, false)).toBe('here');
        expect(materialState(mat('x', 'X', { Status: 'Naručeno', Ordered_Quantity: 2 }), 1, false)).toBe('ordered');
        expect(materialState(mat('x', 'X', { Status: 'Naručeno', Ordered_Quantity: 1, Received_Quantity: 1 }), 1, false)).toBe('partial');
        expect(materialState(mat('x', 'X', { Received_Quantity: 4 }), 2, false)).toBe('here');
        expect(materialState(mat('x', 'MDF'), 1, true)).toBe('stock');
        expect(materialState(mat('x', 'X'), 1, false)).toBe('missing');
    });

    it('koraci stavke: koliko je koji proces daleko', () => {
        const steps = new Map(itemSteps(graph, item()).map(s => [s.name, s.distance]));
        expect(steps.get('Krojenje iverala')).toBe(0);
        expect(steps.get('Priprema furnira')).toBe(0);
        expect(steps.get('Furniranje')).toBe(1);
        expect(steps.get('Probna montaža')).toBe(3);
        expect(steps.get('Okivanje')).toBe(7);
        // bez grafa: lista procesa kao lanac
        const chain = itemSteps(undefined, { ...item(), Processes: [
            { Process_Name: 'Krojenje iverala', Status: 'Završeno' }, { Process_Name: 'Sklapanje kutija', Status: 'U toku' },
            { Process_Name: 'Okivanje', Status: 'Na čekanju' },
        ] });
        expect(chain.map(s => s.distance)).toEqual([null, 0, 1]);
    });
});

describe('kapije naloga i poruke', () => {
    it('pri pokretanju: prva faza + staklo s dugim rokom; ljepilo bez kapije', () => {
        const gates = buildGates({ graph, items: [item()], materials, stock: DEFAULT_STOCK_RULES, orders });
        const first = gates.filter(g => g.distance === 0).map(g => g.process);
        expect(first).toEqual(expect.arrayContaining(['Krojenje iverala', 'Krojenje MDF-a', 'Priprema furnira']));
        expect(gates.flatMap(g => g.rows).some(r => r.name === 'Ljepilo D3')).toBe(false);
        const okivanje = gates.find(g => g.process === 'Okivanje')!;
        expect(okivanje.rows.map(r => r.name)).toEqual(['Staklo float 4mm', 'Šarke Blum CLIP top', 'Ručke Häfele 160']);

        const { alerts, consumed } = dueAlerts(true, gates, new Set());
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe('start');
        expect(alerts[0].rows.map(r => r.name)).toEqual(['Iveral U702 18mm', 'MDF 18mm', 'Furnir hrast 0,6']);
        expect(alerts[0].longLead.map(r => r.name)).toEqual(['Staklo float 4mm']);
        expect(consumed).toEqual(expect.arrayContaining(['start', 'pre:krojenje iverala']));
        expect(rowLabel(alerts[0].rows[0])).toBe('Iveral U702 18mm · 2 ploča · naručeno 21.10. (Frischeis)');

        // Drugi put ništa (sve je potrošeno).
        expect(dueAlerts(true, gates, new Set(consumed)).alerts).toEqual([]);
        expect(dueAlerts(false, gates, new Set()).alerts).toEqual([]);
    });

    it('zaliha se pita tek kad je proces na redu (kant traka poslije krojenja)', () => {
        const start = buildGates({ graph, items: [item()], materials, stock: DEFAULT_STOCK_RULES, orders });
        const first = dueAlerts(true, start, new Set());
        expect(first.alerts[0].rows.some(r => r.name.includes('kant'))).toBe(false);
        const later = buildGates({ graph, items: [item(['a'])], materials, stock: DEFAULT_STOCK_RULES, orders });
        const { alerts } = dueAlerts(true, later, new Set(first.consumed));
        expect(alerts.map(a => a.kind)).toEqual(['pre']);
        expect(alerts[0].rows.map(r => r.name)).toEqual(['ABS kant traka 2mm']);
    });

    it('najava 2 koraka prije okivanja, spojena s lakiranjem u jednu poruku', () => {
        const done = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
        const gates = buildGates({ graph, items: [item(done)], materials, stock: DEFAULT_STOCK_RULES, orders });
        const { alerts } = dueAlerts(true, gates, new Set(['start']));
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe('pre');
        expect(alerts[0].processes).toEqual(['Lakiranje', 'Okivanje']);
        expect(alerts[0].rows.map(r => r.state)).toEqual(['stock', 'missing', 'missing', 'ordered']);
    });

    it('kapija: okivanje počelo, a ručke nisu stigle', () => {
        const done = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
        const here = materials.map(m => m.ID === 'm7' ? m : { ...m, Status: 'Na stanju' });
        const gates = buildGates({ graph, items: [item(done, ['m'])], materials: here, stock: DEFAULT_STOCK_RULES, orders });
        const { alerts } = dueAlerts(true, gates, new Set(['start', 'pre:okivanje']));
        expect(alerts.map(a => a.kind)).toEqual(['gate']);
        expect(alerts[0].rows.map(r => r.name)).toEqual(['Ručke Häfele 160']);
        expect(gateReady(gates.find(g => g.process === 'Lakiranje')!)).toBe(true);
    });

    it('ključevi bez materijala: sat ne čita sastavnice kad je sve pitano', () => {
        expect(candidateKeys(false, graph, [item()])).toEqual([]);
        expect(candidateKeys(true, graph, [item()])).toEqual(expect.arrayContaining(['start', 'pre:krojenje iverala', 'pre:furniranje', 'pre:sklapanje kutija']));
        expect(candidateKeys(true, graph, [item()])).not.toContain('pre:okivanje');
        expect(candidateKeys(true, graph, [item(['a'], ['b'])])).toContain('gate:kantiranje iverala');
    });

    it('rok isporuke se uči po dobavljaču; spor dobavljač se naručuje pri pokretanju', () => {
        const lead = supplierLeadDays([
            { supplier: 'Häfele', orderedAt: '2026-10-01', receivedAt: '2026-10-08' },
            { supplier: 'Häfele', orderedAt: '2026-10-10', receivedAt: '2026-10-16' },
            { supplier: 'Häfele', orderedAt: '2026-10-12', receivedAt: '2026-10-21' },
            { supplier: 'Frischeis', orderedAt: '2026-10-01', receivedAt: '2026-10-02' },
            { supplier: 'Blum', orderedAt: '2026-10-01', receivedAt: '2026-10-20' },   // jedan uzorak — ne vrijedi
        ]);
        expect(lead.get('hafele')).toBe(7);
        expect(lead.has('frischeis')).toBe(false);
        expect(lead.has('blum')).toBe(false);

        const mats = [mat('r1', 'Ručke 160', { Supplier: 'Häfele' }), mat('s1', 'Šarke Blum', { Supplier: 'Blum' })];
        const gates = buildGates({ graph, items: [item()], materials: mats, stock: DEFAULT_STOCK_RULES, leadDays: lead });
        const { alerts } = dueAlerts(true, gates, new Set());
        expect(alerts[0].longLead.map(r => r.name)).toEqual(['Ručke 160']);
    });

    it('isti materijal iz dva proizvoda je jedan red', () => {
        const two: GateItemInput[] = [item(), { ...item(), ID: 'it2', Product_ID: 'p2', Product_Name: 'Ormar' }];
        const mats = [mat('x1', 'Šarke Blum', { Quantity: 4 }), { ...mat('x2', 'Šarke Blum', { Quantity: 6 }), Product_ID: 'p2' }];
        const gates = buildGates({ graph, items: two, materials: mats, stock: DEFAULT_STOCK_RULES });
        expect(gates).toHaveLength(1);
        expect(gates[0].rows).toHaveLength(1);
        expect(gates[0].rows[0].needed).toBe(10);
        expect(gates[0].rows[0].productNames).toEqual(['Kuhinja', 'Ormar']);
    });
});
