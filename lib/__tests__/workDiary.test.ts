import { splitDnevnicaByOrder, splitWorkerDay } from '../laborSplit';
import { coverage, ensureGraphNode, markItemProcess, matchProcess, matchTarget, planWorkerDay, type DiaryTarget } from '../workDiary';

describe('splitWorkerDay — podjela dana s izričitim udjelom', () => {
    it('bez težina je identično dvonivovskoj podjeli', () => {
        const logs = [{ Work_Order_ID: 'a' }, { Work_Order_ID: 'b' }, { Work_Order_ID: 'b' }];
        const shares = splitWorkerDay(100.01, 1, logs);
        const { amounts, dayFractions } = splitDnevnicaByOrder(100.01, 1, [1, 2]);
        expect(shares.map(s => s.amount)).toEqual([amounts[0][0], amounts[1][0], amounts[1][1]]);
        expect(shares.map(s => s.dayFraction)).toEqual([dayFractions[0][0], dayFractions[1][0], dayFractions[1][1]]);
        expect(shares.map(s => s.splitFactor)).toEqual([2, 4, 4]);
    });

    it('pola dana na jednom poslu, ostatak na dva druga naloga: 0.5 / 0.25 / 0.25', () => {
        const shares = splitWorkerDay(100, 1, [{ Work_Order_ID: 'a', Day_Weight: 0.5 }, { Work_Order_ID: 'b' }, { Work_Order_ID: 'c' }]);
        expect(shares.map(s => s.amount)).toEqual([50, 25, 25]);
        expect(shares.map(s => s.dayFraction)).toEqual([0.5, 0.25, 0.25]);
    });

    it('težine uz pola dana prisutnosti i tačan zbir centi', () => {
        const shares = splitWorkerDay(85, 0.5, [{ Day_Weight: 2 / 3 }, { Day_Weight: 1 / 3 }]);
        expect(shares.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(42.5, 6);
        expect(shares.map(s => s.dayFraction)).toEqual([0.333333, 0.166667]);
    });

    it('kasnije dodan zapis bez težine uz pun dan s težinama dobije 1/N', () => {
        const shares = splitWorkerDay(90, 1, [{ Day_Weight: 0.5 }, { Day_Weight: 0.5 }, {}]);
        expect(shares.map(s => s.amount)).toEqual([30, 30, 30]);
        expect(shares.reduce((s, x) => s + x.dayFraction, 0)).toBeCloseTo(1, 5);
    });
});

const T = (wo: string, woName: string, item: string, product: string, project = 'Jerko Čorluka - Kuća', finished = false): DiaryTarget =>
    ({ workOrderId: wo, workOrderName: woName, itemId: item, productId: `p-${item}`, productName: product, projectName: project, finished });
const targets = [
    T('r7', 'Corluka - Kuhinja', 'k1', 'Donji elementi'),
    T('r7', 'Corluka - Kuhinja', 'k2', 'Gornji elementi'),
    T('r5', 'Corluka - Gardaroberi u djecijoj sobi', 'g1', 'Gardarober'),
    T('r3', 'Meliha A501 - Vrata', 'm1', 'Vrata sobna', 'Melihin stan'),
    T('z21', 'Montaža vrata E5', 'e1', 'Montaža vrata E5', ''),
];

describe('matchTarget — koji nalog/proizvod', () => {
    it('„kuhinja Čorluka" → cijeli nalog (sve stavke)', () => {
        const m = matchTarget('kuhinja Čorluka', targets);
        expect(m).toMatchObject({ kind: 'ok', workOrderId: 'r7' });
        expect(m.kind === 'ok' && m.items.map(i => i.itemId)).toEqual(['k1', 'k2']);
    });

    it('jasno imenovan proizvod unutar naloga → samo ta stavka', () => {
        const m = matchTarget('gornji elementi kuhinja', targets);
        expect(m.kind === 'ok' && m.items.map(i => i.itemId)).toEqual(['k2']);
    });

    it('„Čorluka" sama → dva naloga, pitanje', () => {
        const m = matchTarget('Čorluka', targets);
        expect(m.kind).toBe('ambiguous');
        expect(m.kind === 'ambiguous' && m.candidates.map(c => c.workOrderId).sort()).toEqual(['r5', 'r7']);
    });

    it('padeži i dijakritika: „vratima kod Melihe"', () => {
        expect(matchTarget('vrata Meliha', targets)).toMatchObject({ kind: 'ok', workOrderId: 'r3' });
    });

    it('nepoznat posao → none', () => {
        expect(matchTarget('hotel Kladanj', targets).kind).toBe('none');
    });

    it('otvoren nalog ima prednost pred završenim istog imena', () => {
        const list = [T('old', 'Corluka - Kuhinja', 'o1', 'Kuhinja', 'Jerko Čorluka - Kuća', true), ...targets];
        expect(matchTarget('kuhinja Čorluka', list)).toMatchObject({ kind: 'ok', workOrderId: 'r7' });
    });
});

describe('matchProcess — proces iz kataloga', () => {
    const vocab = ['Krojenje Iverala', 'Krojenje MDF-a', 'Kantiranje', 'Sklapanje kutija', 'Farbanje i lakiranje', 'Postavljanje leđa'];
    it.each([
        ['krojili iveral', 'Krojenje Iverala'],
        ['krojenje mdf', 'Krojenje MDF-a'],
        ['kantirao', 'Kantiranje'],
        ['sklapali kutije', 'Sklapanje kutija'],
        ['postavljali leđa', 'Postavljanje leđa'],
        ['KANTIRANJE', 'Kantiranje'],
    ])('„%s" → %s', (said, expected) => {
        expect(matchProcess(said, vocab)).toBe(expected);
    });

    it('nepoznat proces → null (bot pita)', () => {
        expect(matchProcess('frezanje utora', vocab)).toBeNull();
        expect(matchProcess('montaža', vocab)).toBeNull();
    });

    it('coverage toleriše padeže', () => {
        expect(coverage('kuhinji Čorluke', 'Corluka - Kuhinja')).toBe(1);
    });
});

describe('planWorkerDay — udio dana', () => {
    it('ništa rečeno → ravnomjerno, bez težina', () => {
        expect(planWorkerDay([undefined, undefined])).toEqual({ presence: 1, weights: [undefined, undefined] });
    });
    it('„pola dana" kao jedini posao → prisutnost 0.5', () => {
        expect(planWorkerDay([0.5])).toEqual({ presence: 0.5, weights: [1] });
    });
    it('pola + pola → pun dan 0.5/0.5', () => {
        expect(planWorkerDay([0.5, 0.5])).toEqual({ presence: 1, weights: [0.5, 0.5] });
    });
    it('pola na jednom, ostatak na dva neimenovana → 0.5/0.25/0.25', () => {
        expect(planWorkerDay([0.5, undefined, undefined])).toEqual({ presence: 1, weights: [0.5, 0.25, 0.25] });
    });
    it('rečeno više od dana → srazmjerno', () => {
        const p = planWorkerDay([1, 1]);
        expect(p).toEqual({ presence: 1, weights: [0.5, 0.5] });
    });
});

describe('graf naloga i čekiranje', () => {
    let n = 0;
    const id = () => `n${++n}`;
    const graph = {
        nodes: [{ id: 'a', name: 'Krojenje Iverala', itemIds: [] }, { id: 'b', name: 'Kantiranje', itemIds: ['k1'] }],
        edges: [{ id: 'e', source: 'a', target: 'b' }],
    };

    it('postojeći čvor za stavku se koristi', () => {
        expect(ensureGraphNode(graph, 'k2', 'Krojenje Iverala', id)).toMatchObject({ nodeId: 'a', added: false });
    });

    it('čvor istog naziva za drugi proizvod se proširi na stavku', () => {
        const r = ensureGraphNode(graph, 'k2', 'Kantiranje', id);
        expect(r).toMatchObject({ nodeId: 'b', added: false });
        expect(r.graph.nodes.find(x => x.id === 'b')!.itemIds).toEqual(['k1', 'k2']);
        expect(graph.nodes[1].itemIds).toEqual(['k1']); // ulaz se ne mijenja
    });

    it('nov proces ide iza zadnjeg procesa stavke', () => {
        const r = ensureGraphNode(graph, 'k1', 'Sklapanje kutija', id);
        expect(r.added).toBe(true);
        expect(r.graph.edges.at(-1)).toMatchObject({ source: 'b', target: r.nodeId });
    });

    it('generički „Rad" nije prethodnik', () => {
        const r = ensureGraphNode({ nodes: [{ id: 'rad', name: 'Rad', itemIds: [] }], edges: [] }, 'e1', 'Montaža', id);
        expect(r.added).toBe(true);
        expect(r.graph.edges).toHaveLength(0);
    });

    it('čekiranje: na čekanju → u toku → završeno; nov proces se doda', () => {
        const w = { id: 'w1', name: 'Edin' };
        const start = markItemProcess([{ Process_Name: 'Kantiranje', Status: 'Na čekanju' }], 'kantiranje', false, w, 't1');
        expect(start).toMatchObject({ change: 'started', processes: [{ Status: 'U toku', Started_At: 't1', Worker_Name: 'Edin' }] });
        const done = markItemProcess(start.processes, 'Kantiranje', true, w, 't2');
        expect(done).toMatchObject({ change: 'completed', processes: [{ Status: 'Završeno', Completed_At: 't2', Started_At: 't1' }] });
        expect(markItemProcess(done.processes, 'Kantiranje', false, w, 't3').change).toBe('none');
        expect(markItemProcess([], 'Lakiranje', true, w, 't4')).toMatchObject({ change: 'added', processes: [{ Status: 'Završeno' }] });
    });
});
