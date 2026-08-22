// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA ZADATAKA — kontrolorov „Zadaci" tab
//
// Ekran živi ili pada na poretku: prekoračeni gore, otvoreni prije završenih,
// pa hitniji. Ovdje to zaključavamo, plus da projekcija tačno prevede flagove
// (open/overdue) i checklistu.
// ════════════════════════════════════════════════════════════════════

import { buildFieldTasks, sortFieldTasks, type FieldTaskRow } from '@/lib/field/fieldTasks';
import type { Task } from '@/lib/types';

const TODAY = '2026-07-15';

function makeTask(over: Partial<Task> = {}): Task {
    return {
        Task_ID: 't-x',
        Organization_ID: 'org-1',
        Title: 'Zadatak',
        Description: '',
        Status: 'pending',
        Priority: 'medium',
        Category: 'general',
        Created_Date: '2026-07-01T00:00:00.000Z',
        Links: [],
        ...over,
    };
}

const ids = (rows: FieldTaskRow[]) => rows.map(r => r.taskId);

describe('buildFieldTasks — projekcija', () => {
    test('prevodi polja, flagove i checklistu', () => {
        const task = makeTask({
            Task_ID: 't-1',
            Title: 'Fali okov',
            Description: 'gornji elementi',
            Priority: 'high',
            Category: 'manufacturing',
            Status: 'in_progress',
            Due_Date: '2026-07-10',            // < TODAY, otvoren → prekoračen
            Assigned_Worker_Name: 'Meho Mehić',
            Notes: 'hitno naručiti',
            Checklist: [
                { id: 'c1', text: 'Provjeri lager', completed: true },
                { id: 'c2', text: 'Naruči', completed: false },
            ],
            Links: [
                { Entity_Type: 'work_order', Entity_ID: 'wo-1', Entity_Name: 'Kuhinja Hotel' },
                { Entity_Type: 'project', Entity_ID: 'p-1', Entity_Name: 'Hotel Berlin' },
            ],
        });

        const { tasks } = buildFieldTasks([task], [], TODAY);
        const row = tasks[0];

        expect(row.taskId).toBe('t-1');
        expect(row.title).toBe('Fali okov');
        expect(row.priority).toBe('high');
        expect(row.category).toBe('manufacturing');
        expect(row.status).toBe('in_progress');
        expect(row.open).toBe(true);
        expect(row.overdue).toBe(true);
        expect(row.dueDate).toBe('2026-07-10');
        expect(row.assignedWorkerName).toBe('Meho Mehić');
        expect(row.notes).toBe('hitno naručiti');
        expect(row.checklistDone).toBe(1);
        expect(row.checklistTotal).toBe(2);
        expect(row.links).toEqual([
            { type: 'work_order', name: 'Kuhinja Hotel' },
            { type: 'project', name: 'Hotel Berlin' },
        ]);
    });

    test('završen zadatak nije otvoren ni prekoračen (i sa starim rokom)', () => {
        const done = makeTask({ Task_ID: 't-done', Status: 'completed', Due_Date: '2026-07-01' });
        const { tasks } = buildFieldTasks([done], [], TODAY);
        expect(tasks[0].open).toBe(false);
        expect(tasks[0].overdue).toBe(false);
    });

    test('radnici se prevode u {workerId, name}', () => {
        const { workers } = buildFieldTasks([], [{ Worker_ID: 'w-1', Name: 'Ana' }], TODAY);
        expect(workers).toEqual([{ workerId: 'w-1', name: 'Ana' }]);
    });
});

describe('sortFieldTasks — poredak', () => {
    test('prekoračeni gore, otvoreni prije završenih, pa hitnost, pa rok', () => {
        const rows = buildFieldTasks([
            makeTask({ Task_ID: 'urgent-open', Priority: 'urgent', Status: 'pending' }),
            makeTask({ Task_ID: 'high-overdue', Priority: 'high', Status: 'pending', Due_Date: '2026-07-10' }),
            makeTask({ Task_ID: 'medium-today', Priority: 'medium', Status: 'in_progress', Due_Date: TODAY }),
            makeTask({ Task_ID: 'high-future', Priority: 'high', Status: 'pending', Due_Date: '2026-07-20' }),
            makeTask({ Task_ID: 'low-done', Priority: 'low', Status: 'completed' }),
        ], [], TODAY).tasks;

        expect(ids(rows)).toEqual([
            'high-overdue',   // prekoračen → apsolutni vrh
            'urgent-open',    // pa po hitnosti
            'high-future',
            'medium-today',
            'low-done',       // završeno na dno
        ]);
    });

    test('ista hitnost → raniji rok prvi, bez roka na kraj', () => {
        const rows = sortFieldTasks(buildFieldTasks([
            makeTask({ Task_ID: 'no-due', Priority: 'medium' }),
            makeTask({ Task_ID: 'due-later', Priority: 'medium', Due_Date: '2026-07-25' }),
            makeTask({ Task_ID: 'due-soon', Priority: 'medium', Due_Date: '2026-07-18' }),
        ], [], TODAY).tasks);

        expect(ids(rows)).toEqual(['due-soon', 'due-later', 'no-due']);
    });
});
