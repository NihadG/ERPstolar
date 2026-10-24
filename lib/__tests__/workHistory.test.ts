import { buildDayHistory, buildProcessHistory, historySummary, logSource } from '../workHistory';
import type { ProcessGraph } from '../types';

// Nalog „Begović - Vrata": ulazna (furnir na MDF) i sobna vrata.
const graph: ProcessGraph = {
    nodes: [
        { id: 'kr', name: 'Krojenje MDF-a', itemIds: ['v1', 'v2'] },
        { id: 'fu', name: 'Furniranje', itemIds: ['v1'], aliases: ['Furniranje', 'Presanje furnira'] },
        { id: 'br', name: 'Brušenje', itemIds: ['v1', 'v2'] },
        { id: 'la', name: 'Lakiranje', itemIds: ['v1', 'v2'] },
        { id: 'rad', name: 'Rad', itemIds: [] },
    ],
    edges: [
        { id: 'a', source: 'la', target: 'la-x' }, // ivica na nepostojeći čvor se ignoriše
        { id: 'b', source: 'br', target: 'la' },
        { id: 'c', source: 'fu', target: 'br' },
        { id: 'd', source: 'kr', target: 'fu' },
        { id: 'e', source: 'kr', target: 'br' },
    ],
};
const items = [
    { ID: 'v1', Product_ID: 'p1', Product_Name: 'Vrata ulazna', Processes: [
        { Process_Name: 'Krojenje MDF-a', Status: 'Završeno' as const, Completed_At: '2026-10-23T15:00:00.000Z', Assumed_Done: true },
        { Process_Name: 'Furniranje', Status: 'Završeno' as const, Completed_At: '2026-10-23T15:00:00.000Z', Assumed_Done: true },
        { Process_Name: 'Brušenje', Status: 'U toku' as const, Started_At: '2026-10-23T15:00:00.000Z' },
        { Process_Name: 'Lakiranje', Status: 'Na čekanju' as const },
    ] },
    { ID: 'v2', Product_ID: 'p2', Product_Name: 'Vrata sobna', Processes: [
        { Process_Name: 'Krojenje MDF-a', Status: 'Završeno' as const, Completed_At: '2026-10-22T15:00:00.000Z' },
        { Process_Name: 'Brušenje', Status: 'U toku' as const },
        { Process_Name: 'Lakiranje', Status: 'Na čekanju' as const },
    ] },
];
const log = (date: string, worker: string, item: string, process: string | undefined, extra: Record<string, unknown> = {}) => ({
    Date: date, Worker_ID: worker.toLowerCase(), Worker_Name: worker, Work_Order_Item_ID: item, Process_Name: process,
    Day_Fraction: 0.5, Hours_Worked: 4, Booking_Source: 'manual' as const, Entry_Source: 'telegram' as const, Is_From_Attendance: false, ...extra,
});
const logs = [
    log('2026-10-22', 'Amer', 'v1', 'Krojenje MDF-a'),
    log('2026-10-22', 'Amer', 'v2', 'Krojenje MDF-a'),
    log('2026-10-23', 'Kerim', 'v1', 'Brušenje'),
    log('2026-10-23', 'Kerim', 'v2', 'Brušenje'),
    log('2026-10-20', 'Edin', 'v2', 'Krojenje furnira', { Booking_Source: 'attendance', Entry_Source: undefined, Is_From_Attendance: true, Day_Fraction: 1 }),
    log('2026-10-21', 'Imer', 'v1', undefined, { Entry_Source: undefined, Day_Fraction: 0.25, Process_Tags: [] }),
    log('2026-10-19', 'Senad', 'v1', 'Brušenje', { Work_Order_Deleted: true }),
];

describe('izvor zapisa', () => {
    it('diktirano / ručno / iz prisustva (i stari zapisi bez oznake)', () => {
        expect(logSource({ Entry_Source: 'telegram', Booking_Source: 'manual', Is_From_Attendance: false })).toBe('dictated');
        expect(logSource({ Booking_Source: 'manual', Is_From_Attendance: false })).toBe('manual');
        expect(logSource({ Booking_Source: 'attendance', Is_From_Attendance: true })).toBe('auto');
        expect(logSource({ Is_From_Attendance: true })).toBe('auto');
        expect(logSource({ Is_From_Attendance: false })).toBe('manual');
    });
});

describe('istorija po procesima', () => {
    const rows = buildProcessHistory(items, graph, logs);
    const row = (name: string) => rows.find(r => r.name === name)!;

    it('redom toka iz grafa, pa procesi samo iz dnevnica, pa „bez procesa"; „Rad" ne ulazi', () => {
        expect(rows.map(r => r.name)).toEqual(['Krojenje MDF-a', 'Furniranje', 'Brušenje', 'Lakiranje', 'Krojenje furnira', 'Bez procesa']);
    });

    it('paralelne grane se čitaju jedna pa druga, spoj na kraju', () => {
        const g: ProcessGraph = {
            nodes: [['ki', 'Krojenje Iverala'], ['km', 'Krojenje MDF-a'], ['ka', 'Kantiranje'], ['fu', 'Furniranje'], ['sk', 'Sklapanje']]
                .map(([id, name]) => ({ id, name, itemIds: [] })),
            edges: [['ki', 'ka'], ['km', 'fu'], ['ka', 'sk'], ['fu', 'sk']].map(([source, target]) => ({ id: source + target, source, target })),
        };
        expect(buildProcessHistory(items, g, []).slice(0, 5).map(r => r.name)).toEqual(['Krojenje Iverala', 'Kantiranje', 'Krojenje MDF-a', 'Furniranje', 'Sklapanje']);
    });

    it('rad bez procesa nema stanje proizvoda', () => {
        expect(row('Bez procesa')).toMatchObject({ unassigned: true, totalProducts: 0, workers: [{ name: 'Imer', days: 0.25 }] });
        expect(row('Brušenje').unassigned).toBe(false);
    });

    it('upisan rad: period, radnici i radnik-dana', () => {
        expect(row('Krojenje MDF-a')).toMatchObject({ state: 'done', basis: 'logged', from: '2026-10-22', to: '2026-10-22', days: 1, doneProducts: 2, totalProducts: 2 });
        expect(row('Krojenje MDF-a').workers).toEqual([{ id: 'amer', name: 'Amer', days: 1 }]);
        expect(row('Brušenje')).toMatchObject({ state: 'active', basis: 'logged', from: '2026-10-23', days: 1 });
    });

    it('pretpostavljen korak nema radnika; datum je dan pretpostavke', () => {
        expect(row('Furniranje')).toMatchObject({ state: 'done', basis: 'assumed', workers: [], days: 0, from: '2026-10-23', totalProducts: 1 });
    });

    it('proces koji čeka', () => {
        expect(row('Lakiranje')).toMatchObject({ state: 'waiting', basis: 'none', workers: [], doneProducts: 0, totalProducts: 2 });
    });

    it('samo automatska podjela = procjena, ne upisano', () => {
        expect(row('Krojenje furnira')).toMatchObject({ basis: 'estimated', state: 'active', workers: [{ name: 'Edin', days: 1 }] });
    });

    it('nulirane dnevnice obrisanog naloga se ne broje', () => {
        expect(row('Brušenje').workers.map(w => w.name)).toEqual(['Kerim']);
    });

    it('jedan proizvod: samo njegovi procesi i rad', () => {
        const sobna = buildProcessHistory(items, graph, logs, 'v2');
        expect(sobna.map(r => r.name)).toEqual(['Krojenje MDF-a', 'Brušenje', 'Lakiranje', 'Krojenje furnira']);
        expect(sobna[0]).toMatchObject({ basis: 'logged', days: 0.5, totalProducts: 1 });
    });

    it('nalog bez grafa: redoslijed iz procesa stavke', () => {
        expect(buildProcessHistory(items, undefined, [], 'v1').map(r => r.name)).toEqual(['Krojenje MDF-a', 'Furniranje', 'Brušenje', 'Lakiranje']);
    });

    it('alias čvora spaja različito imenovan zapis u isti red', () => {
        const r = buildProcessHistory(items, graph, [log('2026-10-24', 'Amer', 'v1', 'Presanje furnira')], 'v1');
        expect(r.find(x => x.name === 'Furniranje')).toMatchObject({ basis: 'logged', days: 0.5 });
        expect(r.map(x => x.name)).not.toContain('Presanje furnira');
    });

    it('više procesa u jednom zapisu dijeli udio dana', () => {
        const r = buildProcessHistory(items, graph, [log('2026-10-24', 'Amer', 'v1', 'Brušenje', { Process_Tags: ['Lakiranje'] })], 'v1');
        expect(r.find(x => x.name === 'Brušenje')!.days).toBe(0.25);
        expect(r.find(x => x.name === 'Lakiranje')!.days).toBe(0.25);
    });
});

describe('istorija po danima', () => {
    const days = buildDayHistory(items, logs);

    it('najnoviji dan prvi; nulirani zapisi ne ulaze', () => {
        expect(days.map(d => d.date)).toEqual(['2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20']);
    });

    it('isti posao na dva proizvoda = jedan red s oba proizvoda', () => {
        expect(days[0].work).toEqual([{ workerId: 'kerim', workerName: 'Kerim', processes: ['Brušenje'], products: ['Vrata ulazna', 'Vrata sobna'], share: 1, source: 'dictated' }]);
    });

    it('završeni procesi tog dana, pretpostavljeni odvojeno od čekiranih', () => {
        expect(days[0].completed).toEqual([
            { process: 'Krojenje MDF-a', products: ['Vrata ulazna'], assumed: true },
            { process: 'Furniranje', products: ['Vrata ulazna'], assumed: true },
        ]);
        expect(days[1].completed).toEqual([{ process: 'Krojenje MDF-a', products: ['Vrata sobna'], assumed: false }]);
    });

    it('rad bez procesa i automatska podjela su označeni', () => {
        expect(days[2].work[0]).toMatchObject({ workerName: 'Imer', processes: ['Bez procesa'], source: 'manual', share: 0.25 });
        expect(days[3].work[0]).toMatchObject({ workerName: 'Edin', source: 'auto' });
    });
});

describe('sažetak', () => {
    it('dani, radnici, radnik-dana, period', () => {
        expect(historySummary(items, logs)).toEqual({ days: 4, workers: 4, workerDays: 3.25, from: '2026-10-20', to: '2026-10-23' });
        expect(historySummary(items, logs, 'v2')).toMatchObject({ days: 3, workers: 3, workerDays: 2 });
    });
});
