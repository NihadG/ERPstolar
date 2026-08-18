// Provjere start-gatea naloga (lib/workOrderStart.checkWorkOrderStart).
// Fokus: nalog čija dodjela radnika živi u Assigned_Workers (ekipa) mora se moći
// pokrenuti — ranije se gledalo SAMO Processes[].Worker_ID, pa je proizvod bez
// plana procesa (Processes = []) padao na "Dodijelite barem jednog radnika" iako
// je radnik izabran u wizardu.

// canWorkerStartProcess u stvarnosti UVIJEK dozvoljava (prisustvo je informativno),
// pa ga ovdje mockamo kao takvog i izbjegavamo Firebase u @/lib/services.
jest.mock('@/lib/services', () => ({
    canWorkerStartProcess: jest.fn(async () => ({ allowed: true, status: 'Nije evidentiran' })),
    getWorkerAttendance: jest.fn(async () => null),
    bookWorkerDayItems: jest.fn(async () => ({ created: 0 })),
    recalculateWorkOrder: jest.fn(async () => undefined),
}));

import { checkWorkOrderStart } from '@/lib/workOrderStart';
import type { WorkOrder, Project } from '@/lib/types';

const NO_PROJECTS: Project[] = [];

const wo = (items: any[]): WorkOrder =>
    ({ Work_Order_ID: 'wo1', Work_Order_Type: 'Proizvodnja', items } as unknown as WorkOrder);

describe('checkWorkOrderStart — dodjela radnika', () => {
    test('radnik SAMO u Assigned_Workers (proizvod bez plana procesa) → dozvoljeno', async () => {
        const res = await checkWorkOrderStart(
            wo([{
                ID: 'i1', Project_ID: 'p', Product_ID: 'pr', Product_Name: 'Ormar',
                Assigned_Workers: [{ Worker_ID: 'w1', Worker_Name: 'Mujo', Daily_Rate: 100 }],
                Processes: [],
            }]),
            NO_PROJECTS,
        );
        expect(res).toEqual({ ok: true });
    });

    test('nijedan radnik nigdje → blokada s porukom o dodjeli', async () => {
        const res = await checkWorkOrderStart(
            wo([{ ID: 'i1', Project_ID: 'p', Product_ID: 'pr', Product_Name: 'Ormar', Processes: [] }]),
            NO_PROJECTS,
        );
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.message).toBe('Dodijelite barem jednog radnika prije pokretanja naloga');
    });

    test('radnik u Processes[].Worker_ID (regresija — s planom) → dozvoljeno', async () => {
        const res = await checkWorkOrderStart(
            wo([{
                ID: 'i1', Project_ID: 'p', Product_ID: 'pr', Product_Name: 'Ormar',
                Processes: [{ Process_Name: 'Sklapanje', Status: 'Na čekanju', Worker_ID: 'w1', Worker_Name: 'Mujo' }],
            }]),
            NO_PROJECTS,
        );
        expect(res).toEqual({ ok: true });
    });

    test('radnik samo kao pomoćnik na procesu → dozvoljeno', async () => {
        const res = await checkWorkOrderStart(
            wo([{
                ID: 'i1', Project_ID: 'p', Product_ID: 'pr', Product_Name: 'Ormar',
                Processes: [{ Process_Name: 'Sklapanje', Status: 'Na čekanju', Helpers: [{ Worker_ID: 'w2', Worker_Name: 'Haso' }] }],
            }]),
            NO_PROJECTS,
        );
        expect(res).toEqual({ ok: true });
    });
});
