import { act, renderHook } from '@testing-library/react';
import { useWorkOrderWizard, CREW_KEY, type WorkOrderWizardParams } from '../useWorkOrderWizard';
import type { Project, WorkOrder, Worker } from '@/lib/types';

// Servisni sloj vuče Firebase — hook ga koristi samo za upis i šihtaricu (auto-rok).
const createWorkOrder = jest.fn().mockResolvedValue({ success: true, data: { Work_Order_ID: 'wo-new', Work_Order_Number: '130' }, message: 'ok' });
jest.mock('@/lib/services', () => ({
    createWorkOrder: (...args: unknown[]) => createWorkOrder(...args),
    getAllAttendanceByMonth: jest.fn().mockResolvedValue([]),
}));

const workers = [
    { Worker_ID: 'w1', Name: 'Adnan Halilović', Worker_Type: 'Glavni', Daily_Rate: 90 },
    { Worker_ID: 'w2', Name: 'Mirza Delić', Worker_Type: 'Pomoćnik', Daily_Rate: 60 },
] as unknown as Worker[];

const projects = [{
    Project_ID: 'pr1', Name: 'Kuća Dino', Client_Name: 'Dino', Status: 'U proizvodnji',
    products: [
        { Product_ID: 'a', Name: 'Kuhinja', Quantity: 3, Status: 'Na čekanju', materials: [] },
        { Product_ID: 'b', Name: 'Ormar', Quantity: 1, Status: 'Na čekanju', materials: [] },
        { Product_ID: 'c', Name: 'Vrata', Quantity: 2, Status: 'Spremno', materials: [] },
    ],
    offers: [{ Status: 'Prihvaćeno', products: [
        { Product_ID: 'a', Selling_Price: 1000, Labor_Days: 2, Labor_Workers: 1, Labor_Daily_Rate: 90, extras: [] },
        { Product_ID: 'b', Selling_Price: 500, Labor_Days: 1, Labor_Workers: 1, Labor_Daily_Rate: 90, extras: [] },
    ] }],
}] as unknown as Project[];

// Vrata su već bila u proizvodnom nalogu — montaža mora zapamtiti taj izvorni nalog.
const workOrders = [{
    Work_Order_ID: 'wo-src', Work_Order_Number: '120', Work_Order_Type: 'Proizvodnja', Status: 'Završeno',
    items: [{ ID: 'i1', Product_ID: 'c', Quantity: 2, Status: 'Završeno' }],
}] as unknown as WorkOrder[];

const params = (over: Partial<WorkOrderWizardParams> = {}): WorkOrderWizardParams => ({
    isOpen: true, mode: 'production', workOrders, projects, workers, organizationId: 'org',
    onClose: jest.fn(), onRefresh: jest.fn(), showToast: jest.fn(), ...over,
});

beforeEach(() => createWorkOrder.mockClear());

describe('useWorkOrderWizard — zajednička logika desktop + telefon', () => {
    test('dva brza dodira ne gaze jedan drugog (funkcionalno ažuriranje)', () => {
        const { result } = renderHook(() => useWorkOrderWizard(params()));
        const [a, b] = result.current.eligibleProducts;
        act(() => {
            result.current.toggleProduct(a);
            result.current.toggleProduct(b);
        });
        expect(result.current.selectedProducts.map(p => p.Product_ID)).toEqual(['a', 'b']);
        // Proizvodnja: jedna ekipa za sve procese (ključ dodjele, ne proces).
        expect(Object.keys(result.current.selectedProducts[0].assignments)).toEqual([CREW_KEY]);
    });

    test('cijeli projekat odjednom, pa količina ostaje u granicama', () => {
        const { result } = renderHook(() => useWorkOrderWizard(params()));
        act(() => result.current.selectProducts(result.current.eligibleProducts, true));
        expect(result.current.selectedProducts).toHaveLength(2);   // Vrata su iskorištena u nalogu 120

        act(() => result.current.setProductQuantity('a', 9, 3));
        expect(result.current.selectedProducts.find(p => p.Product_ID === 'a')?.Work_Order_Quantity).toBe(3);
        act(() => result.current.setProductQuantity('a', 0, 3));
        expect(result.current.selectedProducts.find(p => p.Product_ID === 'a')?.Work_Order_Quantity).toBe(1);

        act(() => result.current.selectProducts(result.current.eligibleProducts, false));
        expect(result.current.selectedProducts).toHaveLength(0);
    });

    test('kreiranje s telefona šalje isti proizvodni nalog kao desktop', async () => {
        const onClose = jest.fn();
        const { result } = renderHook(() => useWorkOrderWizard(params({ onClose })));
        act(() => result.current.selectProducts(result.current.eligibleProducts, true));
        act(() => result.current.assignWorkerToAllProcesses('w1'));
        act(() => result.current.assignHelpersToAllProcesses(['w2']));
        act(() => result.current.setWorkOrderName('Kuhinja i ormar'));
        await act(async () => { await result.current.handleCreateWorkOrder(); });

        expect(createWorkOrder).toHaveBeenCalledTimes(1);
        const [payload, org] = createWorkOrder.mock.calls[0];
        expect(org).toBe('org');
        expect(payload.Work_Order_Type).toBe('Proizvodnja');
        expect(payload.Name).toBe('Kuhinja i ormar');
        expect(payload.Total_Value).toBe(1000 * 3 + 500);
        const kuhinja = payload.items.find((i: any) => i.Product_ID === 'a');
        expect(kuhinja.Assigned_Workers.map((w: any) => w.Worker_ID).sort()).toEqual(['w1', 'w2']);
        expect(onClose).toHaveBeenCalled();
    });

    test('montaža: spremni proizvod nosi izvorni nalog, pomoćnici po koraku na svim proizvodima', async () => {
        const { result } = renderHook(() => useWorkOrderWizard(params({ mode: 'montaza' })));
        const ready = result.current.eligibleMontazaProducts;
        expect(ready.map((p: any) => p.Product_ID)).toEqual(['c']);

        act(() => result.current.selectMontazaProducts(ready, true));
        expect(result.current.selectedProducts[0].Source_Work_Order_ID).toBe('wo-src');

        act(() => result.current.assignWorkerToAll('Montaža', 'w1'));
        act(() => result.current.assignHelpersToAllForProcess('Montaža', ['w2']));
        expect(result.current.selectedProducts[0].helperAssignments['Montaža']).toEqual(['w2']);

        await act(async () => { await result.current.handleCreateWorkOrder(); });
        const [payload] = createWorkOrder.mock.calls[0];
        expect(payload.Work_Order_Type).toBe('Montaža');
        expect(payload.items[0].Source_Work_Order_ID).toBe('wo-src');
        const montaza = payload.items[0].Processes.find((p: any) => p.Process_Name === 'Montaža');
        expect(montaza.Worker_ID).toBe('w1');
        expect(montaza.Helpers.map((h: any) => h.Worker_ID)).toEqual(['w2']);
    });
});
