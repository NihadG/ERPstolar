import { buildOrderProcessRows, buildOrderFlowRows, mergeDuplicateNameRows, dedupeProcessKey, type ProcRow } from '../orderProcessRows';
import type { WorkOrderItem, ProcessNode, ProcessEdge } from '../types';

// Nevidljivi znakovi kroz eksplicitne \u escape-ove (ne literali u izvoru).
const ZWSP = String.fromCharCode(0x200B);   // zero-width space
const BOM = String.fromCharCode(0xFEFF);    // BOM / zero-width no-break space

function item(id: string, name: string, processes: { Process_Name: string; Status?: string }[] = []): WorkOrderItem {
    return { ID: id, Product_Name: name, Processes: processes } as unknown as WorkOrderItem;
}
function node(id: string, name: string, itemIds: string[], x = 0, y = 0): ProcessNode {
    return { id, name, itemIds, position: { x, y } };
}
function edge(source: string, target: string): ProcessEdge {
    return { id: `${source}-${target}`, source, target };
}
const row = (rows: ProcRow[], name: string) => rows.filter(r => dedupeProcessKey(r.name) === dedupeProcessKey(name));

describe('dedupeProcessKey — robustan ključ', () => {
    it('izjednačava velika/mala slova i rubne razmake', () => {
        expect(dedupeProcessKey('  Lakiranje ')).toBe(dedupeProcessKey('lakiranje'));
    });
    it('izjednačava dijakritike (NFKD)', () => {
        expect(dedupeProcessKey('Bušenje')).toBe(dedupeProcessKey('Busenje'));
    });
    it('ignoriše NEVIDLJIVE (zero-width) znakove — glavni uzrok duplih redova', () => {
        expect(dedupeProcessKey('Lakiranje' + ZWSP)).toBe(dedupeProcessKey('Lakiranje'));
        expect(dedupeProcessKey('La' + BOM + 'kiranje')).toBe(dedupeProcessKey('Lakiranje'));
    });
    it('ignoriše i ostale format-znakove (soft hyphen, word joiner, smjer-markeri)', () => {
        const SHY = String.fromCharCode(0x00AD), WJ = String.fromCharCode(0x2060), LRM = String.fromCharCode(0x200E);
        expect(dedupeProcessKey('Lak' + SHY + 'iranje')).toBe(dedupeProcessKey('Lakiranje'));
        expect(dedupeProcessKey(WJ + 'Lakiranje')).toBe(dedupeProcessKey('Lakiranje'));
        expect(dedupeProcessKey('Lakiranje' + LRM)).toBe(dedupeProcessKey('Lakiranje'));
    });
    it('presložuje ćirilične homoglife na latinicu (miješan raspored tastature)', () => {
        // „Priprema": ćirilično р (U+0440) izgleda kao latinično p, а (U+0430) kao a.
        const cyr = 'Pri' + String.fromCharCode(0x0440) + 'rem' + String.fromCharCode(0x0430);
        expect(dedupeProcessKey(cyr)).toBe(dedupeProcessKey('Priprema'));
    });
    it('sažima višestruke unutrašnje razmake', () => {
        expect(dedupeProcessKey('Obrada   fronti')).toBe(dedupeProcessKey('Obrada fronti'));
    });
});

describe('buildOrderProcessRows — „isti proces = jedan red"', () => {
    const items = [item('A', 'Poz 1'), item('B', 'Poz 2'), item('C', 'Poz 3')];

    it('spaja DVA čvora istog naziva u jedan red (unija proizvoda)', () => {
        const nodes = [node('n1', 'Lakiranje', ['A'], 0, 0), node('n2', 'Lakiranje', ['B'], 0, 1)];
        const rows = buildOrderProcessRows(nodes, [], items);
        const lak = row(rows, 'Lakiranje');
        expect(lak).toHaveLength(1);
        expect(lak[0].total).toBe(2);
        expect(lak[0].perItem.map(p => p.itemId).sort()).toEqual(['A', 'B']);
    });

    it('spaja čvorove koji se razlikuju SAMO po nevidljivom znaku (reprodukcija buga)', () => {
        const nodes = [
            node('n1', 'Lakiranje', ['A'], 0, 0),
            node('n2', 'Lakiranje' + ZWSP, ['B'], 0, 1),
            node('n3', 'Lakiranje ', ['C'], 0, 2),
        ];
        const rows = buildOrderProcessRows(nodes, [], items);
        expect(row(rows, 'Lakiranje')).toHaveLength(1);
        expect(row(rows, 'Lakiranje')[0].total).toBe(3);
    });

    it('ne spaja RAZLIČITE procese (Lakiranje vs Farbanje i lakiranje)', () => {
        const nodes = [node('n1', 'Lakiranje', ['A'], 0, 0), node('n2', 'Farbanje i lakiranje', ['A'], 0, 1)];
        const rows = buildOrderProcessRows(nodes, [], items);
        expect(rows).toHaveLength(2);
    });

    it('spojeni red je „done" samo ako su SVI duplikati završeni; done broji uniju', () => {
        const done = [{ Process_Name: 'Priprema masive', Status: 'Završeno' }];
        const nodes = [
            node('n1', 'Priprema masive', ['A'], 0, 0),
            node('n2', 'Priprema masive', ['B'], 0, 1),
        ];
        const rows = buildOrderProcessRows(nodes, [], [
            item('A', 'Poz 1', done), item('B', 'Poz 2', done),
        ]);
        const pm = row(rows, 'Priprema masive');
        expect(pm).toHaveLength(1);
        expect(pm[0].state).toBe('done');
        expect(pm[0].done).toBe(2);
        expect(pm[0].total).toBe(2);
    });

    it('gating preživljava dedup: sljedbenik čeka dok prethodnik nije gotov', () => {
        const items2 = [item('A', 'Poz 1', [{ Process_Name: 'Priprema', Status: 'Na čekanju' }])];
        const nodes = [node('p', 'Priprema', ['A'], 0, 0), node('b', 'Bušenje', ['A'], 1, 0)];
        const rows = buildOrderProcessRows(nodes, [edge('p', 'b')], items2);
        expect(row(rows, 'Priprema')[0].state).toBe('active');
        expect(row(rows, 'Bušenje')[0].state).toBe('blocked');
    });
});

describe('mergeDuplicateNameRows — direktno', () => {
    it('grupu s dva reda spaja u jedan, stanje = najbolje (active > blocked)', () => {
        const base: ProcRow[] = [
            { id: '1', key: 'x', name: 'Lakiranje', perItem: [{ itemId: 'A', itemName: 'Poz 1', procName: 'Lakiranje', status: 'Na čekanju', helpers: [] }], done: 0, total: 1, workers: [], predIds: [], state: 'blocked' },
            { id: '2', key: 'x', name: 'Lakiranje', perItem: [{ itemId: 'B', itemName: 'Poz 2', procName: 'Lakiranje', status: 'Na čekanju', helpers: [] }], done: 0, total: 1, workers: [], predIds: [], state: 'active' },
        ];
        const out = mergeDuplicateNameRows(base);
        expect(out).toHaveLength(1);
        expect(out[0].total).toBe(2);
        expect(out[0].state).toBe('active');
    });
});

describe('jedinstven id reda', () => {
    // Regresija: id čvora je `n-<seq>-<slug>` — `seq` je brojač lokalan za jednu sintezu,
    // a slug briše ne-alfanumeričke znakove. Snimljeni graf i svježa dopuna dolaze iz
    // dva nezavisna brojača, pa se isti id znao pojaviti dvaput. Pogađalo je i podatke:
    // OrderDetail red za čekiranje procesa traži po id-u i dobijao bi pogrešan.
    it('dopuna iz sinteze ne preuzima id iz snimljenog grafa', () => {
        const items = [item('A', 'Ormar', [{ Process_Name: 'Farbanje-1', Status: 'Na čekanju' }])];
        const saved = {
            nodes: [{ id: 'n-1-farbanje-1', name: 'Farbanje 1', itemIds: ['A'], aliases: ['Farbanje 1'] }],
            edges: [],
        } as unknown as Parameters<typeof buildOrderFlowRows>[1];

        const rows = buildOrderFlowRows(items, saved);
        const ids = rows.map(r => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        // Oba procesa ostaju vidljiva — dopuna se ne smije progutati.
        expect(rows).toHaveLength(2);
    });

    it('mergeDuplicateNameRows razrješava sudar id-a i kad ulaz nosi duplikat', () => {
        const mk = (id: string, name: string): ProcRow => ({
            id, key: dedupeProcessKey(name), name, perItem: [], done: 0, total: 0,
            workers: [], predIds: [], state: 'blocked',
        });
        const out = mergeDuplicateNameRows([mk('dup', 'Rezanje'), mk('dup', 'Brušenje')]);
        expect(out).toHaveLength(2);
        expect(new Set(out.map(r => r.id)).size).toBe(2);
    });
});
