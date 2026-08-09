import { blockStatus, blockStatusMap } from '../canvas/status';
import { newBlock } from '../canvas/model';
import type { PlanBlock, WorkOrder, Order, WorkOrderItem } from '../types';

const ctx = (workOrders: WorkOrder[] = [], orders: Order[] = []) => ({ workOrders, orders });

const wo = (id: string, status: WorkOrder['Status'], items: Partial<WorkOrderItem>[] = []): WorkOrder =>
    ({ Work_Order_ID: id, Work_Order_Number: `RN-${id}`, Status: status, items } as WorkOrder);

const order = (id: string, status: string): Order =>
    ({ Order_ID: id, Order_Number: `NAR-${id}`, Status: status } as Order);

const linkedTo = (workOrderId?: string, orderId?: string): PlanBlock => ({
    ...newBlock('order', '2026-08-03', '2026-08-07', { title: 'Nalog' }),
    ...(workOrderId ? { linkedWorkOrderId: workOrderId } : {}),
    ...(orderId ? { linkedOrderId: orderId } : {}),
});

describe('blockStatus — živi status naloga', () => {
    test('nepretvoren blok je nacrt', () => {
        expect(blockStatus(newBlock('order', '2026-08-03'), ctx()).status).toBe('draft');
    });

    test('Na čekanju → pending', () => {
        const b = linkedTo('1');
        expect(blockStatus(b, ctx([wo('1', 'Na čekanju')])).status).toBe('pending');
    });

    test('U toku → active', () => {
        const b = linkedTo('1');
        const info = blockStatus(b, ctx([wo('1', 'U toku')]));
        expect(info.status).toBe('active');
        expect(info.ref).toBe('RN-1');
    });

    test('U toku sa svim otvorenim stavkama pauziranim → paused', () => {
        const b = linkedTo('1');
        const paused = wo('1', 'U toku', [
            { Status: 'U toku', Is_Paused: true },
            { Status: 'Završeno', Is_Paused: false },   // završene se ne broje
        ]);
        const info = blockStatus(b, ctx([paused]));
        expect(info.status).toBe('paused');
        expect(info.label).toBe('Pauza');
    });

    test('U toku sa nepauziranom stavkom ostaje active', () => {
        const b = linkedTo('1');
        const running = wo('1', 'U toku', [
            { Status: 'U toku', Is_Paused: true },
            { Status: 'U toku', Is_Paused: false },
        ]);
        expect(blockStatus(b, ctx([running])).status).toBe('active');
    });

    test('Završeno → done, Otkazano → cancelled', () => {
        expect(blockStatus(linkedTo('1'), ctx([wo('1', 'Završeno')])).status).toBe('done');
        expect(blockStatus(linkedTo('2'), ctx([wo('2', 'Otkazano')])).status).toBe('cancelled');
    });

    test('pretvoren a nalog nestao → pending (kreirano, status nepoznat)', () => {
        expect(blockStatus(linkedTo('missing'), ctx([])).status).toBe('pending');
    });

    test('narudžba: Nacrt→pending, Poslano→active, Primljeno→done', () => {
        expect(blockStatus(linkedTo(undefined, 'o1'), ctx([], [order('o1', 'Nacrt')])).status).toBe('pending');
        expect(blockStatus(linkedTo(undefined, 'o2'), ctx([], [order('o2', 'Poslano')])).status).toBe('active');
        const rec = blockStatus(linkedTo(undefined, 'o3'), ctx([], [order('o3', 'Primljeno')]));
        expect(rec.status).toBe('done');
        expect(rec.label).toBe('Primljeno');
    });
});

describe('blockStatusMap — samo pretvoreni blokovi u mapi', () => {
    test('nacrti se izostavljaju, pretvoreni ulaze', () => {
        const draft = newBlock('order', '2026-08-03');
        const active = linkedTo('1');
        const map = blockStatusMap([draft, active], ctx([wo('1', 'U toku')]));
        expect(map.has(draft.id)).toBe(false);
        expect(map.get(active.id)?.status).toBe('active');
    });
});
