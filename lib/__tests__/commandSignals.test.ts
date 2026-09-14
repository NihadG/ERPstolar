import { buildScope, taskProduct, taskProject } from '../command/scope';
import { buildSignals, lensAllowsWorkOrder, visibleProjects } from '../command/signals';
import { commandMaterialRows } from '../command/materialOrder';
import type { Order, Project, Task, WorkOrder } from '../types';

const TODAY = '2026-09-12';

const projects: Project[] = [
    {
        Project_ID: 'p1', Name: 'Aamanns', Client_Name: 'Igor', Deadline: '2026-09-30',
        products: [
            {
                Product_ID: 'prod1', Name: 'Klupa', Quantity: 1,
                Questions: [
                    { id: 'q1', Text: 'Koja boja?', Audience: 'client', Resolved: false, Created_At: '' },
                    { id: 'q2', Text: 'Sokl?', Audience: 'client', Answer: '65mm', Resolved: false, Created_At: '' },
                ],
                materials: [
                    { ID: 'm1', Material_Name: 'Iveral', Quantity: 2, Unit: 'm2', Unit_Price: 5, Status: 'Nije naručeno', Supplier: 'Alfa', Order_ID: '', Is_Essential: true },
                    { ID: 'm2', Material_Name: 'Lak', Quantity: 1, Unit: 'l', Unit_Price: 9, Status: 'Primljeno', Supplier: 'Alfa', Order_ID: '' },
                ],
            },
        ],
    },
    { Project_ID: 'p2', Name: 'Melihin stan', Client_Name: 'Meliha', products: [{ Product_ID: 'prod2', Name: 'Vrata', Quantity: 1, materials: [] }] },
] as unknown as Project[];

const workOrders: WorkOrder[] = [
    {
        Work_Order_ID: 'wo1', Work_Order_Number: '124', Status: 'U toku', Due_Date: '2026-09-01',
        items: [
            { Product_ID: 'prod1', Project_ID: 'p1', Status: 'U toku', Is_Paused: false },
            { Product_ID: 'prod2', Project_ID: 'p2', Status: 'U toku', Is_Paused: false },
        ],
    },
    {
        Work_Order_ID: 'wo2', Work_Order_Number: '125', Status: 'U toku', Due_Date: '2026-12-01',
        items: [{ Product_ID: 'prod1', Project_ID: 'p1', Status: 'U toku', Is_Paused: true }],
    },
    { Work_Order_ID: 'wo3', Work_Order_Number: '126', Status: 'U toku', Due_Date: '2026-01-01', items: [{ Product_ID: 'x', Project_ID: 'vani' }] },
] as unknown as WorkOrder[];

const orders: Order[] = [
    { Order_ID: 'o1', Order_Number: '9', Status: 'Poslano', Expected_Delivery: '2026-09-05', items: [{ Project_ID: 'p1', Product_ID: 'prod1' }] },
    { Order_ID: 'o2', Order_Number: '10', Status: 'Primljeno', Expected_Delivery: '2026-09-05', items: [{ Project_ID: 'p1' }] },
] as unknown as Order[];

const tasks: Task[] = [
    { Task_ID: 't1', Title: 'Zvati klijenta', Status: 'pending', Priority: 'urgent', Due_Date: '2026-09-10', Links: [{ Entity_Type: 'product', Entity_ID: 'prod1', Entity_Name: 'Klupa' }] },
    { Task_ID: 't2', Title: 'Gotovo', Status: 'completed', Priority: 'low', Links: [{ Entity_Type: 'project', Entity_ID: 'p1', Entity_Name: 'Aamanns' }] },
    { Task_ID: 't3', Title: 'Tuđi', Status: 'pending', Priority: 'low', Links: [{ Entity_Type: 'project', Entity_ID: 'vani', Entity_Name: 'X' }] },
] as unknown as Task[];

const scope = buildScope(projects, workOrders, orders, tasks);

test('na tablu ulazi samo ono što dodiruje njene projekte', () => {
    expect(scope.workOrders.map(w => w.Work_Order_ID)).toEqual(['wo1', 'wo2']);
    expect(scope.orders.map(o => o.Order_ID)).toEqual(['o1', 'o2']);
    expect(scope.tasks.map(t => t.Task_ID)).toEqual(['t1', 't2']);
});

test('nalog preko dva projekta se vodi kod oba, redoslijedom table', () => {
    expect(scope.workOrderProjects.get('wo1')).toEqual(['p1', 'p2']);
});

test('zadatak vezan na proizvod pripada projektu tog proizvoda', () => {
    expect(taskProject(tasks[0], scope)).toBe('p1');
    expect(taskProduct(tasks[0], scope)).toBe('prod1');
});

test('puls broji kašnjenje po nalozima, zadacima i isporukama', () => {
    const { signals } = buildSignals(scope, commandMaterialRows(projects), TODAY);
    const count = (id: string) => signals.find(s => s.id === id)!.count;
    expect(count('late')).toBe(3);        // wo1 + zadatak t1 + narudžba o1 (o2 je primljena)
    expect(count('blocked')).toBe(1);     // prod1 — ključni Iveral nije spreman
    expect(count('toOrder')).toBe(1);     // samo Iveral
    expect(count('running')).toBe(1);     // wo2 je pauziran
    expect(count('tasks')).toBe(1);
    expect(count('awaiting')).toBe(1);    // q2 ima odgovor
});

test('leća bira konkretne stavke, a bez leće propušta sve', () => {
    const { selection } = buildSignals(scope, commandMaterialRows(projects), TODAY);
    expect(lensAllowsWorkOrder(selection.late, 'wo1')).toBe(true);
    expect(lensAllowsWorkOrder(selection.late, 'wo2')).toBe(false);
    expect(lensAllowsWorkOrder(null, 'wo2')).toBe(true);
    expect(visibleProjects(projects, selection.blocked).map(p => p.Project_ID)).toEqual(['p1']);
    expect(visibleProjects(projects, null)).toHaveLength(2);
});

test('blokirano je samo ono što koči stvarni rad — proizvod bez naloga nije blokiran', () => {
    // prod2 ima ključni materijal koji fali, ali NIJE ni u jednom nalogu.
    const projectsWithIdle = [projects[0], {
        ...projects[1],
        products: [{
            Product_ID: 'prod9', Name: 'Neraspoređen', Quantity: 1,
            materials: [{ ID: 'm9', Material_Name: 'Ploča', Quantity: 1, Unit: 'm2', Unit_Price: 1, Status: 'Nije naručeno', Supplier: 'A', Order_ID: '', Is_Essential: true }],
        }],
    }] as unknown as Project[];
    const idleScope = buildScope(projectsWithIdle, workOrders, orders, tasks);
    const { signals } = buildSignals(idleScope, commandMaterialRows(projectsWithIdle), TODAY);
    expect(signals.find(s => s.id === 'blocked')!.count).toBe(1);   // samo prod1, ne i prod9
    expect(signals.find(s => s.id === 'toOrder')!.count).toBe(2);   // prod9 je „za naručiti"
});
