import { buildProcessTrace, type TraceLogLite, type TraceGraphLite } from '../snapshot/processTrace';

const log = (Date_: string, node: string, worker = 'w1', frac?: number): TraceLogLite => ({
    Date: Date_, Process_Node_ID: node, Worker_ID: worker, Worker_Name: worker.toUpperCase(),
    ...(frac !== undefined ? { Day_Fraction: frac } : {}),
});

const graph = (nodes: [string, string][], edges: [string, string][]): TraceGraphLite => ({
    nodes: nodes.map(([id, name]) => ({ id, name })),
    edges: edges.map(([source, target]) => ({ source, target })),
});

const G = graph(
    [['n1', 'Krojenje'], ['n2', 'Kantiranje'], ['n3', 'Lakiranje']],
    [['n1', 'n2'], ['n2', 'n3']]
);

describe('buildProcessTrace — osnovno', () => {
    test('prazni logovi → prazan trace, bez dijeljenja nulom', () => {
        const t = buildProcessTrace({ logs: [], graph: G });
        expect(t.Process_Runs).toEqual([]);
        expect(t.Transitions).toEqual([]);
        expect(t.Flow_Efficiency).toBeNull();
        expect(t.Lead_Days).toBe(0);
    });

    test('run nosi prvi/zadnji dan, radnik-dane i kalendarski raspon', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1'), log('2026-07-03', 'n1')],
            graph: G,
        });
        const r = t.Process_Runs[0];
        expect(r.Process_Name).toBe('Krojenje');
        expect(r.First_Day).toBe('2026-07-01');
        expect(r.Last_Day).toBe('2026-07-03');
        expect(r.Worker_Days).toBe(2);     // dva loga po cijeli dan
        expect(r.Active_Days).toBe(2);     // dva različita datuma
        expect(r.Span_Days).toBe(3);       // 01→03 uključivo — dan pauze je unutra
    });

    test('Day_Fraction se poštuje; log bez njega je cijeli dan (legacy)', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1', 'w1', 0.5), log('2026-07-01', 'n1', 'w2')],
            graph: G,
        });
        expect(t.Process_Runs[0].Worker_Days).toBe(1.5);
        expect(t.Touch_Days).toBe(1.5);
        expect(t.Process_Runs[0].Active_Days).toBe(1);
    });

    test('radnici se agregiraju i sortiraju po udjelu', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1', 'w1', 0.5), log('2026-07-02', 'n1', 'w2'), log('2026-07-03', 'n1', 'w2')],
            graph: G,
        });
        expect(t.Process_Runs[0].Workers).toEqual([
            { Worker_ID: 'w2', Worker_Name: 'W2', Worker_Days: 2 },
            { Worker_ID: 'w1', Worker_Name: 'W1', Worker_Days: 0.5 },
        ]);
    });
});

describe('buildProcessTrace — čekanje između procesa', () => {
    test('čekanje 0 kad drugi proces počinje istog dana kad prvi završi', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1'), log('2026-07-01', 'n2')],
            graph: G,
        });
        const tr = t.Transitions.find(x => x.From_Node_ID === 'n1' && x.To_Node_ID === 'n2')!;
        expect(tr.Wait_Days).toBe(0);
        expect(tr.Source).toBe('graph');
    });

    test('čekanje se mjeri od KRAJA prvog do POČETKA drugog', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1'), log('2026-07-02', 'n1'), log('2026-07-08', 'n2')],
            graph: G,
        });
        const tr = t.Transitions.find(x => x.From_Node_ID === 'n1' && x.To_Node_ID === 'n2')!;
        expect(tr.Wait_Days).toBe(6);          // 02 → 08
        expect(tr.End_To_End_Days).toBe(6);    // kraj n1 (02) → kraj n2 (08)
    });

    test('preklapanje procesa → čekanje 0 uz zastavicu, NIKAD negativan broj', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n2'), log('2026-07-05', 'n1')],
            graph: G,
        });
        const tr = t.Transitions.find(x => x.From_Node_ID === 'n1' && x.To_Node_ID === 'n2')!;
        expect(tr.Wait_Days).toBe(0);
        expect(tr.Overlapped).toBe(true);
    });

    test('End_To_End_Days ZADRŽAVA znak kad se radi obrnuto od grafa', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n2'), log('2026-07-05', 'n1')],
            graph: G,
        });
        const tr = t.Transitions.find(x => x.From_Node_ID === 'n1' && x.To_Node_ID === 'n2')!;
        expect(tr.End_To_End_Days).toBe(-4);   // n2 je završio 4 dana PRIJE n1
    });
});

describe('buildProcessTrace — graf vs stvarnost', () => {
    test('prelaz koji graf NEMA se bilježi kao observed', () => {
        const noEdges = graph([['n1', 'Krojenje'], ['n9', 'Farbanje']], []);
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1'), log('2026-07-04', 'n9')],
            graph: noEdges,
        });
        const tr = t.Transitions.find(x => x.From_Node_ID === 'n1' && x.To_Node_ID === 'n9')!;
        expect(tr.Source).toBe('observed');
        expect(tr.Wait_Days).toBe(3);
    });

    test('graf ima prednost — isti par se ne duplira kao observed', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1'), log('2026-07-02', 'n2')],
            graph: G,
        });
        const pairs = t.Transitions.filter(x => x.From_Node_ID === 'n1' && x.To_Node_ID === 'n2');
        expect(pairs).toHaveLength(1);
        expect(pairs[0].Source).toBe('graph');
    });

    test('veza iz grafa bez stvarnog rada se ne izmišlja', () => {
        const t = buildProcessTrace({ logs: [log('2026-07-01', 'n1')], graph: G });
        expect(t.Transitions).toEqual([]);   // n2/n3 nemaju logove
    });

    test('bez grafa se i dalje dobije stvarni tok', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1'), log('2026-07-03', 'n2')],
            graph: null,
        });
        expect(t.Transitions).toHaveLength(1);
        expect(t.Transitions[0].Source).toBe('observed');
    });
});

describe('buildProcessTrace — logovi bez čvora', () => {
    test('log sa samo Process_Name se ne gubi, ali je označen kao slabiji', () => {
        const t = buildProcessTrace({
            logs: [{ Date: '2026-07-01', Process_Name: 'Lakiranje', Worker_ID: 'w1' }],
            graph: G,
        });
        expect(t.Process_Runs[0].Resolved_By).toBe('name');
        expect(t.Process_Runs[0].Process_Name).toBe('Lakiranje');
    });

    test('isti naziv s nevidljivim znakom je ISTI proces (ne dva reda)', () => {
        const t = buildProcessTrace({
            logs: [
                { Date: '2026-07-01', Process_Name: 'Lakiranje', Worker_ID: 'w1' },
                { Date: '2026-07-02', Process_Name: 'Lakiranje​', Worker_ID: 'w1' },
            ],
            graph: null,
        });
        expect(t.Process_Runs).toHaveLength(1);
        expect(t.Process_Runs[0].Worker_Days).toBe(2);
    });

    test('rad BEZ procesa i dalje ulazi u Touch/Lead naloga', () => {
        const t = buildProcessTrace({
            logs: [{ Date: '2026-07-01', Worker_ID: 'w1' }, { Date: '2026-07-04', Worker_ID: 'w1' }],
            graph: G,
        });
        expect(t.Process_Runs).toEqual([]);
        expect(t.Touch_Days).toBe(2);
        expect(t.Lead_Days).toBe(4);
    });
});

describe('buildProcessTrace — agregati naloga', () => {
    test('Flow_Efficiency = radni dani / protekli dani, uvijek ≤ 1', () => {
        // Radilo se 2 dana (01, 08), proteklo 8 → 0.25
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1'), log('2026-07-08', 'n2')],
            graph: G,
        });
        expect(t.Lead_Days).toBe(8);
        expect(t.Active_Days).toBe(2);
        expect(t.Flow_Efficiency).toBe(0.25);
    });

    test('više radnika istog dana NE diže Flow_Efficiency preko 1', () => {
        const t = buildProcessTrace({
            logs: [log('2026-07-01', 'n1', 'w1'), log('2026-07-01', 'n1', 'w2'), log('2026-07-01', 'n1', 'w3')],
            graph: G,
        });
        expect(t.Touch_Days).toBe(3);            // 3 radnik-dana
        expect(t.Flow_Efficiency).toBe(1);       // ali jedan kalendarski dan
    });

    test('deterministično — isti ulaz daje identičan izlaz', () => {
        const logs = [log('2026-07-03', 'n2'), log('2026-07-01', 'n1'), log('2026-07-09', 'n3')];
        expect(buildProcessTrace({ logs, graph: G })).toEqual(buildProcessTrace({ logs, graph: G }));
    });
});
