import { mentionsEveryone, orderMentioned, ungroundedOrders, ungroundedWorkers, workSaid } from '../assistant/grounding';
import { ensureGraphNode, lastWorkDays, matchProcess } from '../workDiary';

const workers = [
    { id: 'bego', name: 'Bego Saka' }, { id: 'ahmad', name: 'Ahmad Al-Masaud' },
    { id: 'ibro', name: 'Ibrahim Kovač', aliases: ['Braco'] },
];
const orders = [
    { id: 'c1', name: 'Corluka - Kuhinja' }, { id: 'c3', name: 'Corluka - Vrata' },
    { id: 's1', name: 'Sto za Igora' }, { id: 'k2', name: 'Begović - Kuhinja' }, { id: 'o1', name: 'Ormar hodnik', aliases: ['ormar kod Jerka'] },
];

describe('utemeljenost: upisuje se samo rečeno', () => {
    it('„svi" su ljudi, „svi proizvodi" nisu', () => {
        expect(mentionsEveryone('Moraš zabilježiti da su svi prisutni')).toBe(true);
        expect(mentionsEveryone('cijela ekipa danas na Čorluki')).toBe(true);
        expect(mentionsEveryone('Svi proizvodi za Čorluku su završeni')).toBe(false);
        expect(mentionsEveryone('svi nalozi su gotovi')).toBe(false);
    });

    it('radnik: ime, prezime ili nadimak, s padežima', () => {
        expect(ungroundedWorkers('Bego danas pakuje', workers, ['bego'])).toEqual([]);
        expect(ungroundedWorkers('bili kod Sake', workers, ['bego'])).toEqual([]);
        expect(ungroundedWorkers('Braco kantao', workers, ['ibro'])).toEqual([]);
        expect(ungroundedWorkers('Svi proizvodi za Čorluku su završeni', workers, ['ahmad'])).toEqual(['Ahmad Al-Masaud']);
        expect(ungroundedWorkers('svi su prisutni', workers, ['ahmad', 'bego'])).toEqual([]);
    });

    it('nalog: klijent ili nadimak; sama vrsta proizvoda samo kad je jednoznačna', () => {
        expect(ungroundedOrders('sve za Čorluku osim vrata', orders, ['c1', 'c3'])).toEqual([]);
        expect(ungroundedOrders('Moraš zabilježiti da su svi prisutni', orders, ['s1'])).toEqual(['Sto za Igora']);
        expect(orderMentioned('radio kuhinju', orders[0], orders)).toBe(false);   // dvije kuhinje
        expect(orderMentioned('radio ormar', orders[4], orders)).toBe(true);      // jedan ormar
        expect(orderMentioned('ormar kod Jerka', orders[4], orders)).toBe(true);
        expect(ungroundedOrders('na svim nalozima', orders, ['s1', 'c1'])).toEqual([]);
    });

    it('posao mora biti iz poruke', () => {
        expect(workSaid('Bego pakuje sve za Čorluku', 'Čorluka')).toBe(true);
        expect(workSaid('Moraš zabilježiti da su svi prisutni', 'Sto za Igora')).toBe(false);
    });
});

describe('procesi: glagoli, mjesto po katalogu, dan zadnjeg rada', () => {
    const vocab = ['Pakovanje', 'Lakiranje', 'Brušenje', 'Krojenje iverala', 'Sklapanje kutija', 'Okivanje'];

    it('glagol kako se kaže → proces', () => {
        expect(matchProcess('pakuje', vocab)).toBe('Pakovanje');
        expect(matchProcess('zapakovao', vocab)).toBe('Pakovanje');
        expect(matchProcess('izbrusio', vocab)).toBe('Brušenje');
        expect(matchProcess('sklapa kutije', vocab)).toBe('Sklapanje kutija');
        expect(matchProcess('montaža', vocab)).toBeNull();
    });

    it('proces van plana stane po katalogu, ne na kraj', () => {
        const order = new Map([['krojenje iverala', 1], ['brusenje', 2], ['lakiranje', 3], ['pakovanje', 4]]);
        const graph = {
            nodes: [{ id: 'k', name: 'Krojenje iverala', itemIds: ['i1'] }, { id: 'l', name: 'Lakiranje', itemIds: ['i1'] }],
            edges: [{ id: 'e', source: 'k', target: 'l' }],
        };
        let n = 0;
        const r = ensureGraphNode(graph, 'i1', 'Brušenje', () => `x${++n}`, name => order.get(name.toLowerCase().replace('š', 's')));
        expect(r).toMatchObject({ added: true, covered: true });
        const edges = r.graph.edges.map(e => `${e.source}>${e.target}`);
        expect(edges).toEqual(expect.arrayContaining([`k>${r.nodeId}`, `${r.nodeId}>l`]));
        expect(edges).not.toContain('k>l');   // suvišna direktna veza uklonjena
        // Proces van kataloga ide na kraj i ne pretpostavlja ranije korake.
        expect(ensureGraphNode(graph, 'i1', 'Montaža', () => 'm', () => undefined)).toMatchObject({ covered: false });
    });

    it('zadnji dan rada po proizvodu; „prije" za pretpostavljene korake', () => {
        const logs = [
            { Date: '2026-10-20', Work_Order_ID: 'w', Work_Order_Item_ID: 'a' },
            { Date: '2026-10-22', Work_Order_ID: 'w', Work_Order_Item_ID: 'b' },
            { Date: '2026-10-27', Work_Order_ID: 'w', Work_Order_Item_ID: 'a' },
            { Date: '2026-10-25', Work_Order_ID: 'w', Work_Order_Item_ID: 'a', Work_Order_Deleted: true },
        ];
        const items = [{ ID: 'a', Work_Order_ID: 'w' }, { ID: 'b', Work_Order_ID: 'w' }, { ID: 'c', Work_Order_ID: 'w' }];
        expect(Object.fromEntries(lastWorkDays(items, logs))).toEqual({ a: '2026-10-27', b: '2026-10-22', c: '2026-10-27' });
        expect(lastWorkDays(items, logs, '2026-10-27').get('a')).toBe('2026-10-20');
    });
});
