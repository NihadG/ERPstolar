import {
    selectAutoBookItemIds, isOrderActiveOn, isWorkerAssignedToAutoItem,
    type AutoBookOrder, type AutoBookItem,
} from '../autoBook';

const W = 'W1';
const DAY = '2026-06-23';

const item = (ID: string, opts: Partial<AutoBookItem> = {}): AutoBookItem =>
    ({ ID, Status: 'U toku', Assigned_Workers: [{ Worker_ID: W }], ...opts });

const order = (Work_Order_ID: string, items: AutoBookItem[], opts: Partial<AutoBookOrder> = {}): AutoBookOrder =>
    ({ Work_Order_ID, Status: 'U toku', Started_At: '2026-06-20', items, ...opts });

const select = (
    orders: AutoBookOrder[],
    over: { status?: string; date?: string; logged?: string[]; worker?: string } = {}
) => selectAutoBookItemIds({
    workerId: over.worker ?? W,
    date: over.date ?? DAY,
    status: over.status ?? 'Prisutan',
    orders,
    hasExistingLog: (id) => (over.logged ?? []).includes(id),
});

// ════════════════════════════════════════════════════════════════════════════
describe('selectAutoBookItemIds — osnovno', () => {
    test('prisutan + aktivan nalog + dodijeljen + nepauziran → knjiži se', () => {
        expect(select([order('A', [item('a1')])])).toEqual(['a1']);
    });

    test('odsutan (bilo koji ne-prisutan status) → NIŠTA', () => {
        for (const st of ['Odsutan', 'Bolovanje', 'Odmor', 'Vikend', 'Praznik', '']) {
            expect(select([order('A', [item('a1')])], { status: st })).toEqual([]);
        }
    });

    test('nije dodijeljen → preskoči', () => {
        expect(select([order('A', [item('a1', { Assigned_Workers: [{ Worker_ID: 'OTHER' }] })])])).toEqual([]);
    });

    test('već postoji zapis (manualno) → ne duplira', () => {
        expect(select([order('A', [item('a1')])], { logged: ['a1'] })).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('selectAutoBookItemIds — pauza i status proizvoda', () => {
    test('pauziran proizvod → NIŠTA', () => {
        expect(select([order('A', [item('a1', { Is_Paused: true })])])).toEqual([]);
    });

    test('pauziran jedan, drugi aktivan → samo aktivan', () => {
        expect(select([order('A', [item('a1', { Is_Paused: true }), item('a2')])])).toEqual(['a2']);
    });

    test('proizvod završen PRIJE tog dana → preskoči', () => {
        expect(select([order('A', [item('a1', { Status: 'Završeno', Completed_At: '2026-06-22' })])])).toEqual([]);
    });

    test('proizvod završen NA taj dan → i dalje se knjiži (radio je tog dana)', () => {
        expect(select([order('A', [item('a1', { Status: 'Završeno', Completed_At: '2026-06-23T16:00:00' })])])).toEqual(['a1']);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('selectAutoBookItemIds — status i datumi naloga', () => {
    test('nalog Na čekanju ili Otkazano → NIŠTA', () => {
        expect(select([order('A', [item('a1')], { Status: 'Na čekanju' })])).toEqual([]);
        expect(select([order('A', [item('a1')], { Status: 'Otkazano' })])).toEqual([]);
    });

    test('nalog nije započet (bez Started_At ili počinje kasnije) → NIŠTA', () => {
        expect(select([order('A', [item('a1')], { Started_At: undefined })])).toEqual([]);
        expect(select([order('A', [item('a1')], { Started_At: '2026-06-25' })])).toEqual([]);
    });

    test('nalog Završen koji pokriva taj dan → knjiži; završen prije → NIŠTA', () => {
        expect(select([order('A', [item('a1')], { Status: 'Završeno', Completed_At: '2026-06-24' })])).toEqual(['a1']);
        expect(select([order('A', [item('a1')], { Status: 'Završeno', Completed_At: '2026-06-22' })])).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('selectAutoBookItemIds — Prisutan vs Teren (proizvodnja vs montaža)', () => {
    test('Prisutan knjiži samo proizvodne naloge (ne montažu)', () => {
        const orders = [order('PROD', [item('p1')]), order('MON', [item('m1')], { Work_Order_Type: 'Montaža' })];
        expect(select(orders, { status: 'Prisutan' })).toEqual(['p1']);
    });
    test('Teren knjiži samo montažne naloge (ne proizvodnju)', () => {
        const orders = [order('PROD', [item('p1')]), order('MON', [item('m1')], { Work_Order_Type: 'Montaža' })];
        expect(select(orders, { status: 'Teren' })).toEqual(['m1']);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('selectAutoBookItemIds — dodjela preko procesa/podzadataka i pomoćnika', () => {
    test('dodjela preko Processes (glavni ili pomoćnik) se računa', () => {
        expect(select([order('A', [item('a1', { Assigned_Workers: [], Processes: [{ Worker_ID: W }] })])])).toEqual(['a1']);
        expect(select([order('A', [item('a1', { Assigned_Workers: [], Processes: [{ Worker_ID: 'X', Helpers: [{ Worker_ID: W }] }] })])])).toEqual(['a1']);
    });
    test('dodjela preko SubTasks (glavni ili pomoćnik) se računa', () => {
        expect(select([order('A', [item('a1', { Assigned_Workers: [], SubTasks: [{ Worker_ID: W }] })])])).toEqual(['a1']);
        expect(select([order('A', [item('a1', { Assigned_Workers: [], SubTasks: [{ Worker_ID: 'X', Helpers: [{ Worker_ID: W }] }] })])])).toEqual(['a1']);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('selectAutoBookItemIds — KOMPLEKSNE DINAMIČNE situacije', () => {
    test('radnik na više aktivnih naloga isti dan → po jedan iz svakog', () => {
        const orders = [order('A', [item('a1')]), order('B', [item('b1')]), order('C', [item('c1')])];
        expect(select(orders).sort()).toEqual(['a1', 'b1', 'c1']);
    });

    test('miks: aktivni A (1 ok, 1 pauza, 1 već knjižen) + montaža (Prisutan preskoči) + Na čekanju → samo a1', () => {
        const orders = [
            order('A', [item('a1'), item('a2', { Is_Paused: true }), item('a3')]),
            order('MON', [item('m1')], { Work_Order_Type: 'Montaža' }),
            order('PEND', [item('p1')], { Status: 'Na čekanju' }),
        ];
        expect(select(orders, { logged: ['a3'] })).toEqual(['a1']);
    });

    test('retroaktivno: knjiženje za raniji dan poštuje status naloga TADA (završen kasnije, ali pokriva dan)', () => {
        // nalog završen 2026-06-30, knjižimo 2026-06-23 → aktivan tada
        const orders = [order('A', [item('a1')], { Status: 'Završeno', Completed_At: '2026-06-30', Started_At: '2026-06-20' })];
        expect(select(orders, { date: '2026-06-23' })).toEqual(['a1']);
    });

    test('dva radnika: prisutni dobiju, odsutni ne (poziva se po radniku)', () => {
        const orders = [order('A', [item('a1', { Assigned_Workers: [{ Worker_ID: 'W1' }, { Worker_ID: 'W2' }] })])];
        expect(select(orders, { worker: 'W1', status: 'Prisutan' })).toEqual(['a1']);
        expect(select(orders, { worker: 'W2', status: 'Odsutan' })).toEqual([]);
    });

    test('cijela ekipa prisutna na nalogu s više proizvoda → svi proizvodi (na koje je radnik dodijeljen)', () => {
        const items = [item('a1'), item('a2'), item('a3')];
        const orders = [order('A', items)];
        expect(select(orders).sort()).toEqual(['a1', 'a2', 'a3']);
    });

    test('SVE pauzirano/nedodijeljeno → NIŠTA (ništa se ne knjiži automatski)', () => {
        const orders = [order('A', [item('a1', { Is_Paused: true }), item('a2', { Assigned_Workers: [{ Worker_ID: 'X' }] })])];
        expect(select(orders)).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('isOrderActiveOn / isWorkerAssignedToAutoItem (jedinice)', () => {
    test('isOrderActiveOn pokriva granične slučajeve', () => {
        expect(isOrderActiveOn(order('A', [], { Status: 'U toku', Started_At: '2026-06-23' }), '2026-06-23')).toBe(true);
        expect(isOrderActiveOn(order('A', [], { Status: 'U toku', Started_At: '2026-06-24' }), '2026-06-23')).toBe(false);
        expect(isOrderActiveOn(order('A', [], { Status: 'Na čekanju' }), '2026-06-23')).toBe(false);
    });
    test('isWorkerAssignedToAutoItem true/false', () => {
        expect(isWorkerAssignedToAutoItem(item('a1'), W)).toBe(true);
        expect(isWorkerAssignedToAutoItem(item('a1', { Assigned_Workers: [{ Worker_ID: 'X' }] }), W)).toBe(false);
    });
});
