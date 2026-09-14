import { buildScope } from '../command/scope';
import { barColumns, buildTimeline, buildTimelineRows, filterTimeline, monthDays, packLanes, timelineDays, type TimelineItem } from '../command/timeline';
import type { Order, PlanBlock, Project, Task, WorkOrder } from '../types';

const TODAY = '2026-09-12';

const projects = [
    { Project_ID: 'p1', Name: 'Aamanns', Client_Name: 'Igor', Deadline: '2026-09-30', products: [{ Product_ID: 'prod1', Name: 'Klupa', Quantity: 3, materials: [] }] },
] as unknown as Project[];

const workOrders = [
    { Work_Order_ID: 'wo1', Work_Order_Number: '124', Status: 'U toku', Due_Date: '2026-09-18', Planned_Start_Date: '2026-09-14', items: [{ Product_ID: 'prod1', Project_ID: 'p1', Status: 'U toku' }] },
    { Work_Order_ID: 'wo2', Work_Order_Number: '125', Status: 'Završeno', Due_Date: '2026-09-01', items: [{ Product_ID: 'prod1', Project_ID: 'p1', Status: 'Završeno' }] },
    { Work_Order_ID: 'wo3', Work_Order_Number: '126', Status: 'Na čekanju', Due_Date: '', items: [{ Product_ID: 'prod1', Project_ID: 'p1' }] },
] as unknown as WorkOrder[];

const orders = [
    { Order_ID: 'o1', Order_Number: '9', Status: 'Poslano', Order_Date: '2026-09-10', Expected_Delivery: '2026-09-15', Supplier_Name: 'Alfa', items: [{ Project_ID: 'p1', Product_ID: 'prod1' }] },
    { Order_ID: 'o2', Order_Number: '10', Status: 'Nacrt', Order_Date: '2026-09-16', Expected_Delivery: '', Supplier_Name: 'Beta', items: [{ Project_ID: 'p1' }] },
] as unknown as Order[];

const tasks = [
    { Task_ID: 't1', Title: 'Mjerenje', Status: 'pending', Priority: 'high', Due_Date: '2026-09-16', Links: [{ Entity_Type: 'product', Entity_ID: 'prod1', Entity_Name: 'Klupa' }] },
    { Task_ID: 't2', Title: 'Bez roka', Status: 'pending', Priority: 'low', Links: [{ Entity_Type: 'project', Entity_ID: 'p1', Entity_Name: 'Aamanns' }] },
] as unknown as Task[];

const scope = buildScope(projects, workOrders, orders, tasks);
const build = (over: Partial<Parameters<typeof buildTimeline>[0]> = {}) =>
    buildTimeline({ scope, today: TODAY, ...over });

test('nalog se pojavi i kao zbirna traka projekta i kao traka proizvoda', () => {
    const ids = build().items.filter(i => i.refId === 'wo1').map(i => i.id);
    expect(ids).toEqual(['wo:wo1:p1', 'wo:wo1:p1:prod1']);
});

test('završeno se ne crta dok se ne uključi prikaz završenog', () => {
    expect(build().items.some(i => i.refId === 'wo2')).toBe(false);
    expect(build({ showDone: true }).items.some(i => i.refId === 'wo2')).toBe(true);
});

test('stavka bez ijednog datuma ne nestane nego ide u „bez roka"', () => {
    const { items, undated } = build();
    expect(items.some(i => i.refId === 'wo3')).toBe(false);
    expect(undated.map(i => i.refId)).toEqual(expect.arrayContaining(['wo3', 't2']));
});

test('narudžba bez očekivane isporuke je tačka, s isporukom je traka', () => {
    const items = build().items;
    expect(items.find(i => i.refId === 'o2')!.isPoint).toBe(true);
    const withDelivery = items.find(i => i.refId === 'o1')!;
    expect(withDelivery.isPoint).toBe(false);
    expect([withDelivery.startISO, withDelivery.endISO]).toEqual(['2026-09-10', '2026-09-15']);
});

test('rok projekta i zadatak su tačke, s oznakom kašnjenja', () => {
    const items = build().items;
    expect(items.find(i => i.kind === 'deadline')).toMatchObject({ isPoint: true, startISO: '2026-09-30', late: false });
    expect(items.find(i => i.refId === 't1')).toMatchObject({ kind: 'task', isPoint: true, productId: 'prod1' });
});

test('plan-blok s Platna se veže preko proizvoda i nosi vrstu u podnaslovu', () => {
    const block = { id: 'b1', title: 'Lakiranje', kind: 'order', startISO: '2026-09-14', endISO: '2026-09-16', productRefs: [{ id: 'prod1', name: 'Klupa', qty: 1 }] } as PlanBlock;
    const planItems = build({ planBlocks: [block] }).items.filter(i => i.kind === 'plan');
    expect(planItems.map(i => i.id)).toEqual(['plan:b1:p1', 'plan:b1:p1:prod1']);
    expect(planItems[0].subtitle).toBe('Proizvodnja');
});

test('obrnuti datumi se isprave umjesto da daju traku negativne širine', () => {
    const reversed = [{ ...workOrders[0], Planned_Start_Date: '2026-09-20', Due_Date: '2026-09-14' }] as unknown as WorkOrder[];
    const item = buildTimeline({ scope: buildScope(projects, reversed, [], []), today: TODAY }).items[0];
    expect(item.startISO < item.endISO).toBe(true);
});

test('sažeto: red projekta SAM nosi trake, bez ponovljenih redova po vrsti', () => {
    const { items } = build();
    const range = { from: '2026-09-07', to: '2026-10-04' };

    const rows = buildTimelineRows(items, scope, { expanded: new Set(), ...range });
    expect(rows.map(r => r.level)).toEqual(['project']);
    expect(rows[0].label).toBe('Aamanns');
    // Sve vrste su u istom redu — razlikuju se oblikom i ikonom, ne redom.
    expect(new Set(rows[0].placed.map(p => p.item.kind)).size).toBeGreaterThan(1);
});

test('po vrsti: svaka vrsta dobija svoj red, naslovni red ostaje prazan', () => {
    const { items } = build();
    const range = { from: '2026-09-07', to: '2026-10-04' };

    const closed = buildTimelineRows(items, scope, { expanded: new Set(), grouping: 'kind', ...range });
    expect(closed.map(r => r.level)).toEqual(['project', 'kind', 'kind', 'kind']);
    expect(closed.map(r => r.label)).toEqual(['Aamanns', 'Nalozi', 'Nabavka', 'Rokovi i zadaci']);
    expect(closed[0].placed).toEqual([]);   // naslovni red nema traka
    // Nalozi red drži samo naloge — zato se vrste više ne slažu jedna preko druge.
    expect(new Set(closed[1].placed.map(p => p.item.kind))).toEqual(new Set(['order']));
    expect(new Set(closed[2].placed.map(p => p.item.kind))).toEqual(new Set(['purchase']));
});

test('razlaganje po poziciji zadržava rok projekta u redu projekta', () => {
    const { items } = build();
    const range = { from: '2026-09-07', to: '2026-10-04' };

    const open = buildTimelineRows(items, scope, { expanded: new Set(['p1']), ...range });
    expect(open.map(r => r.key)).toEqual(['p:p1', 'pr:prod1']);
    expect(open[1].placed.every(p => p.item.productId === 'prod1')).toBe(true);
    // Rok projekta nema svoj red po pozicijama — ranije je nestajao pri razlaganju.
    expect(open[0].placed.map(p => p.item.kind)).toContain('deadline');
});

test('preklapajuće trake se slažu jedna ispod druge, a razdvojene dijele istu', () => {
    const bar = (id: string, startISO: string, endISO: string): TimelineItem => ({
        id, kind: 'order', state: 'waiting', projectId: 'p1', title: id,
        startISO, endISO, isPoint: false, late: false, shared: false, refId: id,
    });
    const placed = packLanes([
        bar('a', '2026-09-01', '2026-09-05'),
        bar('b', '2026-09-03', '2026-09-08'),
        bar('c', '2026-09-09', '2026-09-10'),
    ]);
    expect(placed.map(p => [p.item.id, p.lane])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
});

test('kolone trake su isječene na vidljivi raspon i nikad prazne', () => {
    const days = timelineDays('2026-09-12', 2);
    expect([days[0], days.length]).toEqual(['2026-09-07', 14]);
    const item = { startISO: '2026-09-01', endISO: '2026-09-09' } as TimelineItem;
    expect(barColumns(item, days)).toEqual({ start: 1, end: 4 });
    expect(barColumns({ startISO: '2026-10-01', endISO: '2026-10-02' } as TimelineItem, days)).toBeNull();
    expect(barColumns({ startISO: '2026-09-08', endISO: '2026-09-08' } as TimelineItem, days)).toEqual({ start: 2, end: 3 });
});

test('mjesečni prikaz pokriva pune sedmice oko mjeseca', () => {
    const days = monthDays('2026-09-12');
    expect(days[0]).toBe('2026-08-31');
    expect(days[days.length - 1]).toBe('2026-10-04');
    expect(days.length % 7).toBe(0);
});

test('leća sužava kalendar tačno na ono što puls broji', () => {
    const { items } = build();
    const sel = {
        projectIds: new Set(['p1']), productIds: new Set<string>(), workOrderIds: new Set(['wo1']),
        orderIds: new Set<string>(), taskIds: new Set<string>(), noteKeys: new Set<string>(), materialIds: new Set<string>(),
    };
    const filtered = filterTimeline({ items, undated: [] }, sel);
    expect(new Set(filtered.items.map(i => i.kind))).toEqual(new Set(['order', 'deadline']));
    expect(filtered.items.filter(i => i.kind === 'order').every(i => i.refId === 'wo1')).toBe(true);
    expect(filtered.items.some(i => i.kind === 'purchase')).toBe(false);
    expect(filterTimeline({ items, undated: [] }, null).items).toHaveLength(items.length);
});

test('tačke koje su blizu idu u odvojene trake da im se nazivi ne preklope', () => {
    const point = (id: string, dayISO: string): TimelineItem => ({
        id, kind: 'task' as const, state: 'waiting' as const, projectId: 'p1', title: id,
        startISO: dayISO, endISO: dayISO, isPoint: true, late: false, shared: false, refId: id,
    });
    const near = [point('a', '2026-09-16'), point('b', '2026-09-17')];

    // Bez rezerve za naziv obje stanu u istu traku i nazivi se ispišu jedan preko drugog.
    expect(packLanes(near).map(x => x.lane)).toEqual([0, 0]);
    expect(packLanes(near, { labelDays: 10, shortDays: 5 }).map(x => x.lane)).toEqual([0, 1]);

    // Razmaknute tačke i dalje dijele traku — rezerva ne troši visinu bez potrebe.
    const apart = [point('a', '2026-09-01'), point('b', '2026-09-30')];
    expect(packLanes(apart, { labelDays: 10, shortDays: 5 }).map(x => x.lane)).toEqual([0, 0]);
});
