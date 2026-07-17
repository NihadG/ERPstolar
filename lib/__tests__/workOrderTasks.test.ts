/**
 * Zadaci na nalogu — veza Task ⇄ WorkOrder ⇄ Product (Task.Links je izvor istine).
 */

import {
    isTaskLinkedToWorkOrder,
    taskProductIds,
    taskProductInOrder,
    withWorkOrderLink,
    withoutWorkOrderLink,
    withProductLinkInOrder,
    isTaskOpen,
    isTaskOverdue,
    tasksForWorkOrder,
    suggestedTasksForWorkOrder,
    taskProgress,
    firstBookingDate,
    firstBookingByOrder,
    emptyTaskSelection,
    taskSelectionCount,
    type TaskDraft,
} from '../workOrderTasks';
import type { Task, TaskLink } from '../types';

const TODAY = '2026-07-16';

const task = (over: Partial<Task> & { Task_ID: string }): Task => ({
    Organization_ID: 'org1',
    Title: `Zadatak ${over.Task_ID}`,
    Description: '',
    Status: 'pending',
    Priority: 'medium',
    Category: 'general',
    Created_Date: '2026-07-01T00:00:00.000Z',
    Links: [],
    ...over,
});

const woLink = (id: string, name = 'Nalog'): TaskLink => ({ Entity_Type: 'work_order', Entity_ID: id, Entity_Name: name });
const prodLink = (id: string, name = 'Proizvod'): TaskLink => ({ Entity_Type: 'product', Entity_ID: id, Entity_Name: name });

describe('isTaskLinkedToWorkOrder', () => {
    test('prepoznaje vezu', () => {
        expect(isTaskLinkedToWorkOrder({ Links: [woLink('wo1')] }, 'wo1')).toBe(true);
        expect(isTaskLinkedToWorkOrder({ Links: [woLink('wo2')] }, 'wo1')).toBe(false);
    });

    test('ne brka tipove entiteta s istim ID-em', () => {
        expect(isTaskLinkedToWorkOrder({ Links: [prodLink('x1')] }, 'x1')).toBe(false);
    });

    test('podnosi zadatak bez linkova', () => {
        expect(isTaskLinkedToWorkOrder({ Links: undefined }, 'wo1')).toBe(false);
        expect(isTaskLinkedToWorkOrder({ Links: [] }, 'wo1')).toBe(false);
    });
});

describe('withWorkOrderLink', () => {
    const wo = { Work_Order_ID: 'wo1', displayName: 'Kuhinja Begović' };

    test('dodaje vezu', () => {
        expect(withWorkOrderLink([], wo)).toEqual([
            { Entity_Type: 'work_order', Entity_ID: 'wo1', Entity_Name: 'Kuhinja Begović' },
        ]);
    });

    test('IDEMPOTENTNO — dupli klik ne pravi duplikat', () => {
        const once = withWorkOrderLink([], wo);
        expect(withWorkOrderLink(once, wo)).toHaveLength(1);
    });

    test('osvježava zastarjeli naziv pri ponovnom vezivanju', () => {
        const stale = [woLink('wo1', 'Stari naziv')];
        expect(withWorkOrderLink(stale, wo)[0].Entity_Name).toBe('Kuhinja Begović');
    });

    test('čuva veze na druge entitete', () => {
        const links = [prodLink('p1'), woLink('wo2')];
        const out = withWorkOrderLink(links, wo);
        expect(out).toHaveLength(3);
        expect(out).toEqual(expect.arrayContaining([prodLink('p1'), woLink('wo2')]));
    });
});

describe('withoutWorkOrderLink', () => {
    test('skida samo traženi nalog', () => {
        const links = [woLink('wo1'), woLink('wo2'), prodLink('p1')];
        expect(withoutWorkOrderLink(links, 'wo1')).toEqual([woLink('wo2'), prodLink('p1')]);
    });

    test('podnosi nepostojeću vezu i prazno', () => {
        expect(withoutWorkOrderLink([woLink('wo2')], 'wo1')).toEqual([woLink('wo2')]);
        expect(withoutWorkOrderLink(undefined, 'wo1')).toEqual([]);
    });
});

describe('withProductLinkInOrder', () => {
    const items = [
        { Product_ID: 'p1', Product_Name: 'Ogledalo C1' },
        { Product_ID: 'p2', Product_Name: 'Ormar D0' },
    ];

    test('postavlja proizvod', () => {
        expect(withProductLinkInOrder([], items, 'p1')).toEqual([
            { Entity_Type: 'product', Entity_ID: 'p1', Entity_Name: 'Ogledalo C1' },
        ]);
    });

    test('mijenja izbor (jedan proizvod po nalogu)', () => {
        const links = withProductLinkInOrder([], items, 'p1');
        const out = withProductLinkInOrder(links, items, 'p2');
        expect(out).toHaveLength(1);
        expect(out[0].Entity_ID).toBe('p2');
    });

    test('null skida proizvod', () => {
        const links = withProductLinkInOrder([], items, 'p1');
        expect(withProductLinkInOrder(links, items, null)).toEqual([]);
    });

    test('ČUVA vezu na proizvod DRUGOG naloga', () => {
        const links = [prodLink('vanjski', 'Proizvod iz drugog naloga')];
        const out = withProductLinkInOrder(links, items, 'p1');
        expect(out).toHaveLength(2);
        expect(out).toEqual(expect.arrayContaining([prodLink('vanjski', 'Proizvod iz drugog naloga')]));
    });

    test('proizvod van naloga se ignoriše', () => {
        expect(withProductLinkInOrder([], items, 'nepostojeci')).toEqual([]);
    });

    test('čuva veze na nalog', () => {
        const out = withProductLinkInOrder([woLink('wo1')], items, 'p1');
        expect(out).toEqual(expect.arrayContaining([woLink('wo1')]));
    });
});

describe('taskProductIds / taskProductInOrder', () => {
    test('vraća samo proizvode', () => {
        expect(taskProductIds({ Links: [woLink('wo1'), prodLink('p1'), prodLink('p2')] })).toEqual(['p1', 'p2']);
    });

    test('bira proizvod koji pripada nalogu', () => {
        const t = { Links: [prodLink('vanjski'), prodLink('p2')] };
        expect(taskProductInOrder(t, [{ Product_ID: 'p1' }, { Product_ID: 'p2' }])).toBe('p2');
    });

    test('bez poklapanja → undefined', () => {
        expect(taskProductInOrder({ Links: [prodLink('vanjski')] }, [{ Product_ID: 'p1' }])).toBeUndefined();
    });
});

describe('isTaskOpen / isTaskOverdue', () => {
    test('otvoreni su pending i in_progress', () => {
        expect(isTaskOpen({ Status: 'pending' })).toBe(true);
        expect(isTaskOpen({ Status: 'in_progress' })).toBe(true);
        expect(isTaskOpen({ Status: 'completed' })).toBe(false);
        expect(isTaskOpen({ Status: 'cancelled' })).toBe(false);
    });

    test('kasni samo otvoren zadatak s prošlim rokom', () => {
        expect(isTaskOverdue({ Status: 'pending', Due_Date: '2026-07-15' }, TODAY)).toBe(true);
        expect(isTaskOverdue({ Status: 'pending', Due_Date: TODAY }, TODAY)).toBe(false);
        expect(isTaskOverdue({ Status: 'pending', Due_Date: '2026-07-17' }, TODAY)).toBe(false);
    });

    test('završen/otkazan zadatak NE kasni', () => {
        expect(isTaskOverdue({ Status: 'completed', Due_Date: '2026-07-01' }, TODAY)).toBe(false);
        expect(isTaskOverdue({ Status: 'cancelled', Due_Date: '2026-07-01' }, TODAY)).toBe(false);
    });

    test('bez roka ne kasni', () => {
        expect(isTaskOverdue({ Status: 'pending' }, TODAY)).toBe(false);
    });

    test('podnosi rok s vremenskom oznakom', () => {
        expect(isTaskOverdue({ Status: 'pending', Due_Date: '2026-07-15T10:00:00.000Z' }, TODAY)).toBe(true);
    });
});

describe('tasksForWorkOrder', () => {
    test('uzima samo zadatke ovog naloga', () => {
        const tasks = [
            task({ Task_ID: 'a', Links: [woLink('wo1')] }),
            task({ Task_ID: 'b', Links: [woLink('wo2')] }),
            task({ Task_ID: 'c', Links: [] }),
        ];
        expect(tasksForWorkOrder(tasks, 'wo1').map(t => t.Task_ID)).toEqual(['a']);
    });

    test('otvoreni prije završenih', () => {
        const tasks = [
            task({ Task_ID: 'done', Status: 'completed', Priority: 'urgent', Links: [woLink('wo1')] }),
            task({ Task_ID: 'open', Status: 'pending', Priority: 'low', Links: [woLink('wo1')] }),
        ];
        expect(tasksForWorkOrder(tasks, 'wo1').map(t => t.Task_ID)).toEqual(['open', 'done']);
    });

    test('pa po prioritetu', () => {
        const tasks = [
            task({ Task_ID: 'low', Priority: 'low', Links: [woLink('wo1')] }),
            task({ Task_ID: 'urgent', Priority: 'urgent', Links: [woLink('wo1')] }),
            task({ Task_ID: 'medium', Priority: 'medium', Links: [woLink('wo1')] }),
            task({ Task_ID: 'high', Priority: 'high', Links: [woLink('wo1')] }),
        ];
        expect(tasksForWorkOrder(tasks, 'wo1').map(t => t.Task_ID)).toEqual(['urgent', 'high', 'medium', 'low']);
    });

    test('pa po roku — bez roka na kraj', () => {
        const tasks = [
            task({ Task_ID: 'bez', Links: [woLink('wo1')] }),
            task({ Task_ID: 'kasni', Due_Date: '2026-07-10', Links: [woLink('wo1')] }),
            task({ Task_ID: 'sutra', Due_Date: '2026-07-17', Links: [woLink('wo1')] }),
        ];
        expect(tasksForWorkOrder(tasks, 'wo1').map(t => t.Task_ID)).toEqual(['kasni', 'sutra', 'bez']);
    });

    test('ne mijenja ulazni niz', () => {
        const tasks = [
            task({ Task_ID: 'b', Priority: 'low', Links: [woLink('wo1')] }),
            task({ Task_ID: 'a', Priority: 'urgent', Links: [woLink('wo1')] }),
        ];
        tasksForWorkOrder(tasks, 'wo1');
        expect(tasks.map(t => t.Task_ID)).toEqual(['b', 'a']);
    });
});

describe('suggestedTasksForWorkOrder', () => {
    const items = [{ Product_ID: 'p1' }, { Product_ID: 'p2' }];

    test('nudi zadatak vezan na proizvod iz naloga, a ne na sam nalog', () => {
        const tasks = [task({ Task_ID: 'a', Links: [prodLink('p1')] })];
        expect(suggestedTasksForWorkOrder(tasks, 'wo1', items).map(t => t.Task_ID)).toEqual(['a']);
    });

    test('NE nudi ono što je već na nalogu', () => {
        const tasks = [task({ Task_ID: 'a', Links: [prodLink('p1'), woLink('wo1')] })];
        expect(suggestedTasksForWorkOrder(tasks, 'wo1', items)).toEqual([]);
    });

    test('NE nudi završene/otkazane', () => {
        const tasks = [
            task({ Task_ID: 'done', Status: 'completed', Links: [prodLink('p1')] }),
            task({ Task_ID: 'cancelled', Status: 'cancelled', Links: [prodLink('p1')] }),
        ];
        expect(suggestedTasksForWorkOrder(tasks, 'wo1', items)).toEqual([]);
    });

    test('NE nudi zadatke tuđih proizvoda', () => {
        const tasks = [task({ Task_ID: 'a', Links: [prodLink('vanjski')] })];
        expect(suggestedTasksForWorkOrder(tasks, 'wo1', items)).toEqual([]);
    });

    test('nalog bez proizvoda nema prijedloga', () => {
        const tasks = [task({ Task_ID: 'a', Links: [prodLink('p1')] })];
        expect(suggestedTasksForWorkOrder(tasks, 'wo1', [])).toEqual([]);
    });
});

describe('taskProgress', () => {
    test('broji urađeno, otvoreno i zakašnjelo', () => {
        const tasks = [
            task({ Task_ID: 'a', Status: 'completed' }),
            task({ Task_ID: 'b', Status: 'pending', Due_Date: '2026-07-10' }),
            task({ Task_ID: 'c', Status: 'in_progress' }),
            task({ Task_ID: 'd', Status: 'completed' }),
        ];
        expect(taskProgress(tasks, TODAY)).toEqual({ total: 4, done: 2, open: 2, overdue: 1, pct: 50 });
    });

    test('otkazani se vide u total-u ali ne dižu postotak', () => {
        const tasks = [
            task({ Task_ID: 'a', Status: 'completed' }),
            task({ Task_ID: 'b', Status: 'cancelled' }),
        ];
        expect(taskProgress(tasks, TODAY)).toEqual({ total: 2, done: 1, open: 0, overdue: 0, pct: 50 });
    });

    test('prazno → nula bez dijeljenja s nulom', () => {
        expect(taskProgress([], TODAY)).toEqual({ total: 0, done: 0, open: 0, overdue: 0, pct: 0 });
    });

    test('sve urađeno → 100%', () => {
        const tasks = [task({ Task_ID: 'a', Status: 'completed' })];
        expect(taskProgress(tasks, TODAY).pct).toBe(100);
    });
});

describe('firstBookingDate', () => {
    test('najraniji datum knjiženja', () => {
        expect(firstBookingDate([
            { Date: '2026-07-10' },
            { Date: '2026-07-03' },
            { Date: '2026-07-20' },
        ])).toBe('2026-07-03');
    });

    test('bez knjiženja → undefined', () => {
        expect(firstBookingDate([])).toBeUndefined();
    });

    test('siječe vremensku oznaku', () => {
        expect(firstBookingDate([{ Date: '2026-07-03T08:00:00.000Z' }])).toBe('2026-07-03');
    });

    test('preskače prazne datume', () => {
        expect(firstBookingDate([{ Date: '' }, { Date: '2026-07-05' }])).toBe('2026-07-05');
    });

    test('poredi kalendarski, ne leksikografski po slučaju', () => {
        // Prelazak godine: 2025-12-31 mora biti prije 2026-01-01.
        expect(firstBookingDate([{ Date: '2026-01-01' }, { Date: '2025-12-31' }])).toBe('2025-12-31');
    });
});

describe('emptyTaskSelection / taskSelectionCount', () => {
    const draft = (over: Partial<TaskDraft> & { id: string }): TaskDraft => ({
        Title: 'Novi zadatak',
        Priority: 'medium',
        Category: 'general',
        ...over,
    });

    test('prazan izbor je 0 i nema dijeljenog stanja među pozivima', () => {
        const a = emptyTaskSelection();
        const b = emptyTaskSelection();
        a.existingTaskIds.push('x');
        expect(taskSelectionCount(b)).toBe(0);
        expect(b.existingTaskIds).toEqual([]);
    });

    test('broji postojeće + nove', () => {
        expect(taskSelectionCount({
            existingTaskIds: ['t1', 't2'],
            newTasks: [draft({ id: 'd1' })],
        })).toBe(3);
    });

    test('nacrt bez naslova se NE broji (poluupisan red)', () => {
        expect(taskSelectionCount({
            existingTaskIds: [],
            newTasks: [draft({ id: 'd1', Title: '' }), draft({ id: 'd2', Title: '   ' }), draft({ id: 'd3' })],
        })).toBe(1);
    });

    test('nacrt nosi korake i proizvod', () => {
        const d = draft({ id: 'd1', checklist: ['Izmjeriti zid', 'Naručiti nosače'], productId: 'p1' });
        expect(d.checklist).toHaveLength(2);
        expect(taskSelectionCount({ existingTaskIds: [], newTasks: [d] })).toBe(1);
    });
});

describe('firstBookingByOrder', () => {
    test('najraniji datum po nalogu', () => {
        const map = firstBookingByOrder([
            { Date: '2026-07-10', Work_Order_ID: 'wo1' },
            { Date: '2026-07-03', Work_Order_ID: 'wo1' },
            { Date: '2026-07-20', Work_Order_ID: 'wo2' },
        ]);
        expect(map.get('wo1')).toBe('2026-07-03');
        expect(map.get('wo2')).toBe('2026-07-20');
    });

    test('PREUSMJEREN rad se broji za OBA naloga', () => {
        // „Razni posao" vezan za proizvod: trošak ide nalogu proizvoda (wo-proizvod),
        // ali je i zadaci-nalog (wo-zadaci) tog dana stvarno radio.
        const map = firstBookingByOrder([
            { Date: '2026-07-05', Work_Order_ID: 'wo-proizvod', Source_Work_Order_ID: 'wo-zadaci' },
        ]);
        expect(map.get('wo-proizvod')).toBe('2026-07-05');
        expect(map.get('wo-zadaci')).toBe('2026-07-05');
    });

    test('nalog bez knjiženja nije u mapi', () => {
        const map = firstBookingByOrder([{ Date: '2026-07-05', Work_Order_ID: 'wo1' }]);
        expect(map.has('wo2')).toBe(false);
        expect(map.get('wo2')).toBeUndefined();
    });

    test('siječe vremensku oznaku i preskače prazne', () => {
        const map = firstBookingByOrder([
            { Date: '', Work_Order_ID: 'wo1' },
            { Date: '2026-07-05T08:00:00.000Z', Work_Order_ID: 'wo1' },
        ]);
        expect(map.get('wo1')).toBe('2026-07-05');
    });

    test('prazan ulaz → prazna mapa', () => {
        expect(firstBookingByOrder([]).size).toBe(0);
    });
});
