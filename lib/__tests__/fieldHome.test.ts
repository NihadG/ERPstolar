// ════════════════════════════════════════════════════════════════════
// PROJEKCIJA POGONSKE POČETNE
//
// Najvažniji test u fajlu je „ne propušta novac". Radnik i kontrolor nemaju
// pristup Firestoreu, pa je ova funkcija JEDINA granica između njih i podataka
// firme. Test namjerno pretražuje CIJELI izlaz rekurzivno — da bi pao i onda
// kad neko za godinu dana doda `...wo` spread ili novo polje na payload.
// ════════════════════════════════════════════════════════════════════

import { buildFieldHome, currentProcessName, weekBounds, type FieldHomeInput } from '@/lib/field/fieldHome';
import type { Task, WorkOrder, WorkOrderItem, WorkerAttendance, WorkLog, Worker } from '@/lib/types';

const TODAY = '2026-07-15';   // srijeda

// Iznosi koji NIKAD ne smiju izaći iz projekcije.
const FORBIDDEN_KEYS = [
    'Total_Value', 'Profit', 'Profit_Margin', 'Material_Cost', 'Planned_Labor_Cost',
    'Actual_Labor_Cost', 'Labor_Cost', 'Labor_Cost_Variance', 'Daily_Rate',
    'Original_Daily_Rate', 'Product_Value', 'Services_Total', 'Transport_Share',
    'Planned_Labor_Rate', 'Profit_Overrides',
];

/** Skupi sve ključeve i sve brojčane vrijednosti iz stabla. */
function walk(value: unknown, keys: string[] = [], numbers: number[] = []): { keys: string[]; numbers: number[] } {
    if (Array.isArray(value)) {
        value.forEach(v => walk(v, keys, numbers));
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            keys.push(k);
            walk(v, keys, numbers);
        }
    } else if (typeof value === 'number') {
        numbers.push(value);
    }
    return { keys, numbers };
}

function makeItem(over: Partial<WorkOrderItem> = {}): WorkOrderItem {
    return {
        ID: 'item-1',
        Work_Order_ID: 'wo-1',
        Product_ID: 'p-1',
        Product_Name: 'Kuhinja Gornji element',
        Project_ID: 'proj-1',
        Project_Name: 'Stan Hrasno',
        Quantity: 3,
        Status: 'U toku',
        Assigned_Workers: [{ Worker_ID: 'w-1', Worker_Name: 'Mujo', Daily_Rate: 90 }],
        Processes: [
            { Process_Name: 'Rezanje', Status: 'Završeno', Completed_At: `${TODAY}T10:00:00.000Z`, Worker_Name: 'Mujo' },
            { Process_Name: 'Kantiranje', Status: 'U toku' },
        ],
        // Novčana polja NAMJERNO postavljena — test dokazuje da ne izlaze.
        Product_Value: 4200,
        Material_Cost: 1800,
        Planned_Labor_Cost: 700,
        Actual_Labor_Cost: 540,
        ...over,
    } as WorkOrderItem;
}

function makeOrder(over: Partial<WorkOrder> = {}): WorkOrder {
    return {
        Work_Order_ID: 'wo-1',
        Organization_ID: 'org-1',
        Name: 'Stan Hrasno — kuhinja',
        Work_Order_Number: '2026-07/R1',
        Created_Date: '2026-07-01T08:00:00.000Z',
        Due_Date: '2026-07-20',
        Status: 'U toku',
        Production_Steps: [],
        Notes: '',
        Started_At: '2026-07-05T07:00:00.000Z',
        Total_Value: 12000,
        Material_Cost: 5400,
        Actual_Labor_Cost: 2100,
        Profit: 4500,
        Profit_Margin: 37.5,
        items: [makeItem()],
        ...over,
    } as WorkOrder;
}

const WORKER: Worker = {
    Worker_ID: 'w-1', Organization_ID: 'org-1', Name: 'Mujo Mujić',
    Role: 'Montaža', Worker_Type: 'Glavni', Phone: '', Status: 'Aktivan',
    Daily_Rate: 90, Daily_Rate_History: [{ Effective_From: '2026-01-01', Rate: 90 }],
};

function makeInput(over: Partial<FieldHomeInput> = {}): FieldHomeInput {
    return {
        today: TODAY,
        user: { Name: 'Mujo Mujić', Role: 'worker', Worker_ID: 'w-1', Must_Change_Password: false },
        organizationName: 'Lux Co',
        worker: WORKER,
        workOrders: [makeOrder()],
        tasks: [],
        attendance: [],
        workLogs: [],
        ...over,
    };
}

describe('weekBounds', () => {
    it('vraća ponedjeljak–nedjelju za dan usred sedmice', () => {
        expect(weekBounds('2026-07-15')).toEqual({ from: '2026-07-13', to: '2026-07-19' });
    });

    it('nedjelja pripada sedmici koja je počela u ponedjeljak prije nje', () => {
        expect(weekBounds('2026-07-19')).toEqual({ from: '2026-07-13', to: '2026-07-19' });
    });

    it('ponedjeljak je prvi dan svoje sedmice', () => {
        expect(weekBounds('2026-07-13')).toEqual({ from: '2026-07-13', to: '2026-07-19' });
    });
});

describe('currentProcessName', () => {
    it('vraća prvi nezavršen proces', () => {
        expect(currentProcessName([
            { Process_Name: 'Rezanje', Status: 'Završeno' },
            { Process_Name: 'Kantiranje', Status: 'Na čekanju' },
            { Process_Name: 'Montaža', Status: 'Na čekanju' },
        ])).toBe('Kantiranje');
    });

    it('null kad su svi procesi završeni', () => {
        expect(currentProcessName([{ Process_Name: 'Rezanje', Status: 'Završeno' }])).toBeNull();
    });

    it('null kad procesa nema', () => {
        expect(currentProcessName([])).toBeNull();
        expect(currentProcessName(undefined)).toBeNull();
    });
});

describe('buildFieldHome — novac ne izlazi', () => {
    it('nijedno novčano polje se ne pojavljuje u izlazu (radnik)', () => {
        const payload = buildFieldHome(makeInput());
        const { keys } = walk(payload);
        for (const forbidden of FORBIDDEN_KEYS) {
            expect(keys).not.toContain(forbidden);
        }
    });

    it('nijedno novčano polje se ne pojavljuje u izlazu (kontrolor)', () => {
        const payload = buildFieldHome(makeInput({
            user: { Name: 'Fata', Role: 'controller', Worker_ID: 'w-1', Must_Change_Password: false },
        }));
        const { keys } = walk(payload);
        for (const forbidden of FORBIDDEN_KEYS) {
            expect(keys).not.toContain(forbidden);
        }
    });

    it('nijedan iznos iz ulaza ne procuri kao broj', () => {
        // Vrijednosti su birane da se ne mogu slučajno poklopiti s brojem
        // proizvoda, postotkom napretka ili brojem dana.
        const payload = buildFieldHome(makeInput({
            workOrders: [makeOrder({
                Total_Value: 98765, Material_Cost: 54321, Profit: 43210, Profit_Margin: 87654,
                items: [makeItem({ Product_Value: 76543, Material_Cost: 65432, Actual_Labor_Cost: 32109 })],
            })],
        }));
        const { numbers } = walk(payload);
        for (const amount of [98765, 54321, 43210, 87654, 76543, 65432, 32109]) {
            expect(numbers).not.toContain(amount);
        }
    });
});

describe('buildFieldHome — stavke radnika', () => {
    it('uzima samo naloge na kojima je radnik dodijeljen', () => {
        const mine = makeOrder();
        const foreign = makeOrder({
            Work_Order_ID: 'wo-2',
            items: [makeItem({
                ID: 'item-2', Work_Order_ID: 'wo-2', Product_Name: 'Tuđi ormar',
                Assigned_Workers: [{ Worker_ID: 'w-9', Worker_Name: 'Haso', Daily_Rate: 80 }],
                Processes: [],
            })],
        });

        const payload = buildFieldHome(makeInput({ workOrders: [mine, foreign] }));

        expect(payload.assignments).toHaveLength(1);
        expect(payload.assignments[0].productName).toBe('Kuhinja Gornji element');
    });

    it('prepoznaje dodjelu preko procesa i pomoćnika, ne samo Assigned_Workers', () => {
        const viaHelper = makeOrder({
            items: [makeItem({
                Assigned_Workers: [],
                Processes: [{
                    Process_Name: 'Montaža', Status: 'U toku',
                    Worker_ID: 'w-9', Helpers: [{ Worker_ID: 'w-1', Worker_Name: 'Mujo' }],
                }],
            })],
        });
        expect(buildFieldHome(makeInput({ workOrders: [viaHelper] })).assignments).toHaveLength(1);
    });

    it('preskače završene stavke i zatvorene naloge', () => {
        const done = makeOrder({ items: [makeItem({ Status: 'Završeno' })] });
        expect(buildFieldHome(makeInput({ workOrders: [done] })).assignments).toHaveLength(0);

        const cancelled = makeOrder({ Status: 'Otkazano' });
        expect(buildFieldHome(makeInput({ workOrders: [cancelled] })).assignments).toHaveLength(0);
    });

    it('prikazuje trenutni proces i napredak stavke', () => {
        const a = buildFieldHome(makeInput()).assignments[0];
        expect(a.currentProcess).toBe('Kantiranje');
        expect(a.progressPct).toBe(50);          // 1 od 2 procesa završen
        expect(a.daysUntilDue).toBe(5);          // 15. → 20. juli
    });

    it('sortira po roku — najhitnije prvo', () => {
        const late = makeOrder({
            Work_Order_ID: 'wo-late', Due_Date: '2026-07-10',
            items: [makeItem({ ID: 'item-late', Work_Order_ID: 'wo-late', Product_Name: 'Kasni ormar' })],
        });
        const payload = buildFieldHome(makeInput({ workOrders: [makeOrder(), late] }));
        expect(payload.assignments.map(a => a.productName)).toEqual(['Kasni ormar', 'Kuhinja Gornji element']);
    });

    it('bez veze na radnika nema stavki, a UI dobija zastavicu', () => {
        const payload = buildFieldHome(makeInput({
            user: { Name: 'Niko', Role: 'worker', Worker_ID: undefined, Must_Change_Password: false },
            worker: null,
        }));
        expect(payload.assignments).toEqual([]);
        expect(payload.user.hasWorkerLink).toBe(false);
    });
});

describe('buildFieldHome — zadaci i sedmica', () => {
    const task = (over: Partial<Task> = {}): Task => ({
        Task_ID: 't-1', Organization_ID: 'org-1', Title: 'Naručiti okov',
        Description: '', Status: 'pending', Priority: 'high', Category: 'general',
        Created_Date: '2026-07-10T08:00:00.000Z', Links: [],
        Assigned_Worker_ID: 'w-1',
        ...over,
    } as Task);

    it('uzima samo nezavršene zadatke dodijeljene radniku', () => {
        const payload = buildFieldHome(makeInput({
            tasks: [
                task(),
                task({ Task_ID: 't-2', Status: 'completed' }),
                task({ Task_ID: 't-3', Assigned_Worker_ID: 'w-9' }),
            ],
        }));
        expect(payload.tasks.map(t => t.taskId)).toEqual(['t-1']);
    });

    it('broji radne dane po jedinstvenim datumima, ne po zapisima', () => {
        const log = (date: string, itemId: string): WorkLog => ({
            WorkLog_ID: `l-${date}-${itemId}`, Organization_ID: 'org-1', Date: date,
            Worker_ID: 'w-1', Worker_Name: 'Mujo', Daily_Rate: 45, Hours_Worked: 8,
            Work_Order_ID: 'wo-1', Work_Order_Item_ID: itemId, Product_ID: 'p-1',
            Is_From_Attendance: true, Created_At: '',
        } as WorkLog);

        const payload = buildFieldHome(makeInput({
            // Isti dan, dva proizvoda → jedan radni dan.
            workLogs: [log('2026-07-13', 'a'), log('2026-07-13', 'b'), log('2026-07-14', 'a')],
        }));
        expect(payload.week.workedDays).toBe(2);
    });

    it('prisustvo broji samo Prisutan i Teren, i samo unutar sedmice', () => {
        const att = (date: string, status: WorkerAttendance['Status']): WorkerAttendance => ({
            Attendance_ID: `a-${date}`, Organization_ID: 'org-1', Worker_ID: 'w-1',
            Worker_Name: 'Mujo', Date: date, Status: status, Created_Date: '',
        });

        const payload = buildFieldHome(makeInput({
            attendance: [
                att('2026-07-13', 'Prisutan'),
                att('2026-07-14', 'Teren'),
                att('2026-07-15', 'Bolovanje'),
                att('2026-07-06', 'Prisutan'),   // prošla sedmica
            ],
        }));
        expect(payload.week.presentDays).toBe(2);
        expect(payload.attendance.status).toBe('Bolovanje');   // status ZA DANAS
    });
});

describe('buildFieldHome — kontrolor', () => {
    it('radnik ne dobija kontrolorske liste', () => {
        const payload = buildFieldHome(makeInput());
        expect(payload.awaitingCheck).toEqual([]);
        expect(payload.activeOrders).toEqual([]);
    });

    it('kontrolor dobija aktivne naloge i nedavno završene procese', () => {
        const payload = buildFieldHome(makeInput({
            user: { Name: 'Fata', Role: 'controller', Worker_ID: 'w-1', Must_Change_Password: false },
        }));

        expect(payload.activeOrders).toHaveLength(1);
        expect(payload.activeOrders[0].progressPct).toBe(50);

        expect(payload.awaitingCheck).toHaveLength(1);
        expect(payload.awaitingCheck[0].processName).toBe('Rezanje');
        expect(payload.awaitingCheck[0].workerName).toBe('Mujo');
    });

    it('procesi završeni prije više od 7 dana se ne prikazuju', () => {
        const old = makeOrder({
            items: [makeItem({
                Processes: [{ Process_Name: 'Rezanje', Status: 'Završeno', Completed_At: '2026-06-01T10:00:00.000Z' }],
            })],
        });
        const payload = buildFieldHome(makeInput({
            user: { Name: 'Fata', Role: 'controller', Worker_ID: 'w-1', Must_Change_Password: false },
            workOrders: [old],
        }));
        expect(payload.awaitingCheck).toEqual([]);
    });
});
