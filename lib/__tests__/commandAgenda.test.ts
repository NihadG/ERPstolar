import { buildAgenda, bucketFor, itemEvents, type AgendaBucketId } from '../command/agenda';
import { buildScope } from '../command/scope';
import { buildTimeline, dueMarker, type TimelineItem } from '../command/timeline';
import type { Order, Project, Task, WorkOrder } from '../types';

// Subota. Sedmica je pon 07.09. – ned 13.09., pa je „sutra" ujedno i kraj sedmice.
const TODAY = '2026-09-12';

const projects = [
    { Project_ID: 'p1', Name: 'Aamanns', Client_Name: 'Igor', Deadline: '2026-10-30', products: [{ Product_ID: 'prod1', Name: 'Klupa', Quantity: 3, materials: [] }] },
] as unknown as Project[];

const workOrders = [
    // Traje preko današnjeg dana; rok se poklapa s planiranim krajem.
    { Work_Order_ID: 'wo1', Work_Order_Number: '124', Name: 'Korpus', Status: 'U toku', Due_Date: '2026-09-20', Planned_Start_Date: '2026-09-08', Planned_End_Date: '2026-09-20', items: [{ Product_ID: 'prod1', Project_ID: 'p1', Status: 'Završeno' }, { Product_ID: 'prod1', Project_ID: 'p1', Status: 'U toku' }] },
    // Plan je probijen, ali rok još nije — ovo NE smije u „Kasni".
    { Work_Order_ID: 'wo2', Work_Order_Number: '125', Name: 'Tapaciranje', Status: 'U toku', Due_Date: '2026-09-25', Planned_Start_Date: '2026-09-01', Planned_End_Date: '2026-09-10', items: [{ Product_ID: 'prod1', Project_ID: 'p1', Status: 'U toku' }] },
] as unknown as WorkOrder[];

const orders = [
    { Order_ID: 'o1', Order_Number: '9', Status: 'Poslano', Order_Date: '2026-09-01', Expected_Delivery: '2026-09-09', Supplier_Name: 'Alfa', items: [{ Project_ID: 'p1', Product_ID: 'prod1' }] },
] as unknown as Order[];

const tasks = [
    { Task_ID: 't1', Title: 'Mjerenje', Status: 'pending', Priority: 'high', Due_Date: '2026-09-12', Links: [{ Entity_Type: 'project', Entity_ID: 'p1' }] },
    { Task_ID: 't2', Title: 'Bez roka', Status: 'pending', Priority: 'low', Links: [{ Entity_Type: 'project', Entity_ID: 'p1' }] },
] as unknown as Task[];

const scope = buildScope(projects, workOrders, orders, tasks);
const agenda = () => buildAgenda(buildTimeline({ scope, today: TODAY }), TODAY);
const bucket = (id: AgendaBucketId) => agenda().find(b => b.id === id);
const titlesIn = (id: AgendaBucketId) => (bucket(id)?.days || []).flatMap(d => d.entries.map(e => e.item.title));

const span = (over: Partial<TimelineItem> = {}): TimelineItem => ({
    id: 'x', kind: 'order', state: 'running', projectId: 'p1', title: 'Nalog',
    startISO: '2026-09-08', endISO: '2026-09-20', isPoint: false, late: false, shared: false, refId: 'x',
    ...over,
});

test('dan se svrstava u kantu prema današnjem danu', () => {
    expect(bucketFor('2026-09-10', TODAY)).toBe('late');
    expect(bucketFor(TODAY, TODAY)).toBe('today');
    expect(bucketFor('2026-09-13', TODAY)).toBe('tomorrow');
    expect(bucketFor('2026-09-18', TODAY)).toBe('next');
    expect(bucketFor('2026-10-05', TODAY)).toBe('later');
    expect(bucketFor('', TODAY)).toBe('undated');
});

test('traka se razlaže na događaje — jedna stavka nije jedan dan', () => {
    const events = itemEvents(span({ dueISO: '2026-09-20' }), TODAY);
    // Početak je prošao, pa se ne ponavlja kao obaveza; umjesto njega stoji „u toku".
    expect(events).toEqual([
        { marker: 'due', dateISO: '2026-09-20' },
        { marker: 'ongoing', dateISO: TODAY },
    ]);
});

test('budući početak je vlastiti događaj', () => {
    const events = itemEvents(span({ startISO: '2026-09-14', endISO: '2026-09-18', state: 'waiting' }), TODAY);
    expect(events.map(e => e.marker)).toEqual(['start', 'end']);
});

test('nalog koji je probio plan, a još je u roku, stoji pod „Danas" — ne pod „Kasni"', () => {
    expect(titlesIn('today')).toContain('Tapaciranje');
    expect(titlesIn('late')).not.toContain('Tapaciranje');
    // Rok mu je i dalje najavljen unaprijed (25.09. je preko sljedeće sedmice).
    expect(titlesIn('later')).toContain('Tapaciranje');
});

test('nalog u toku se vidi danas, a njegov rok unaprijed', () => {
    expect(titlesIn('today')).toContain('Korpus');
    expect(titlesIn('next')).toContain('Korpus');
    const ongoing = bucket('today')!.days[0].entries.find(e => e.item.title === 'Korpus')!;
    expect(ongoing.marker).toBe('ongoing');
});

test('prošli rok otvorene stavke ide u „Kasni", zatvorene nigdje', () => {
    expect(titlesIn('late')).toEqual(expect.arrayContaining(['Alfa']));
    const done = buildAgenda(
        buildTimeline({ scope, today: TODAY, showDone: true }),
        TODAY,
    ).find(b => b.id === 'late')!;
    expect(done.days.every(d => d.entries.every(e => e.item.state !== 'done'))).toBe(true);
});

test('zadatak s današnjim rokom i stavka bez roka imaju svoje mjesto', () => {
    expect(titlesIn('today')).toContain('Mjerenje');
    expect(titlesIn('undated')).toContain('Bez roka');
});

test('unutar dana rokovi idu prvo, ono što samo traje ide zadnje', () => {
    expect(bucket('today')!.days[0].entries.map(e => e.marker)).toEqual(['point', 'ongoing', 'ongoing']);
    // Kašnjenje pretiče sve ostalo bez obzira na vrstu markera.
    const late = bucket('late')!.days[0].entries;
    expect(late[0].item.late).toBe(true);
});

test('nalog se ne ponovi zbog trake pozicije, ali zadatak na poziciji ostaje', () => {
    const withProductTask = buildScope(projects, workOrders, orders, [
        ...tasks,
        { Task_ID: 't3', Title: 'Brušenje klupe', Status: 'pending', Priority: 'high', Due_Date: '2026-09-13', Links: [{ Entity_Type: 'product', Entity_ID: 'prod1' }] },
    ] as unknown as Task[]);
    const all = buildAgenda(buildTimeline({ scope: withProductTask, today: TODAY }), TODAY)
        .flatMap(b => b.days.flatMap(d => d.entries));

    // Nalog postoji i kao traka projekta i kao traka pozicije — u spisku jednom.
    expect(all.filter(e => e.item.refId === 'wo1' && e.marker === 'due')).toHaveLength(1);
    // Zadatak postoji SAMO kao traka pozicije; gruba provjera bi ga izbrisala.
    expect(all.some(e => e.item.title === 'Brušenje klupe')).toBe(true);
});

test('rok van trake daje zastavicu; rok jednak kraju je nema', () => {
    expect(dueMarker(span({ dueISO: '2026-09-20' }))).toBeNull();
    expect(dueMarker(span({ dueISO: '2026-09-25' }))).toEqual({ dateISO: '2026-09-25', overrun: false });
    // Plan koji ide preko roka — jedini slučaj koji smije biti crven.
    expect(dueMarker(span({ dueISO: '2026-09-15' }))).toEqual({ dateISO: '2026-09-15', overrun: true });
});

test('nalog nosi udio završenih stavki, da se plan razlikuje od stvarnog rada', () => {
    const item = buildTimeline({ scope, today: TODAY }).items.find(i => i.refId === 'wo1' && !i.productId)!;
    expect(item.progress).toBe(0.5);
    expect(item.dueISO).toBe('2026-09-20');
});
