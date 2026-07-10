import { buildBookingProposal, proposalNeedsConfirm } from '../attendanceBooking';
import type { WorkOrder, WorkOrderItem } from '../types';

const W = 'W1';
const DAY = '2026-06-23';

const item = (ID: string, opts: Partial<WorkOrderItem> = {}): WorkOrderItem => ({
    ID,
    Work_Order_ID: '',                 // postavlja order()
    Product_ID: `prod-${ID}`,
    Product_Name: `Proizvod ${ID}`,
    Status: 'U toku',
    Assigned_Workers: [{ Worker_ID: W, Worker_Name: 'Radnik', Daily_Rate: 100 }],
    ...opts,
} as unknown as WorkOrderItem);

const order = (id: string, items: WorkOrderItem[], opts: Partial<WorkOrder> = {}): WorkOrder => ({
    Work_Order_ID: id,
    Organization_ID: 'org',
    Work_Order_Number: id,
    Name: `Nalog ${id}`,
    Status: 'U toku',
    Started_At: '2026-06-20',
    items: items.map(it => ({ ...it, Work_Order_ID: id })),
    ...opts,
} as unknown as WorkOrder);

const present = (workOrders: WorkOrder[]) =>
    buildBookingProposal([{ workerId: W, workerName: 'Radnik', status: 'Prisutan' }], workOrders, DAY);

// ════════════════════════════════════════════════════════════════════════════
describe('buildBookingProposal — Prisutan (izbor naloga)', () => {
    test('dodijeljen aktivan nalog → red; nalog ponuđen i predčekiran', () => {
        const rows = present([order('A', [item('a1')])]);
        expect(rows).toHaveLength(1);
        const r = rows[0];
        expect(r.kind).toBe('present');
        if (r.kind === 'present') {
            expect(r.orders.map(o => o.workOrderId)).toEqual(['A']);
            expect(r.orders[0].name).toBe('Nalog A');
            expect(r.orders[0].assigned).toBe(true);
            expect(r.orders[0].status).toBe('U toku');
            expect(r.suggestedOrderIds).toEqual(['A']);
        }
    });

    test('REGRESIJA: aktivan nalog na koji radnik NIJE dodijeljen (npr. „Razni poslovi") → ponuđen, ali nije predčekiran', () => {
        const rows = present([order('RP', [item('rp1', { Assigned_Workers: [{ Worker_ID: 'OTHER', Worker_Name: 'Drugi', Daily_Rate: 80 }] })], { Name: 'Razni poslovi' })]);
        expect(rows).toHaveLength(1);
        if (rows[0].kind === 'present') {
            expect(rows[0].orders.map(o => o.name)).toEqual(['Razni poslovi']);
            expect(rows[0].orders[0].assigned).toBe(false);
            expect(rows[0].suggestedOrderIds).toEqual([]);
        }
    });

    test('montažni aktivan nalog (dodijeljen) → ponuđen i predčekiran', () => {
        const rows = present([order('MON', [item('m1')], { Work_Order_Type: 'Montaža' })]);
        expect(rows).toHaveLength(1);
        if (rows[0].kind === 'present') {
            expect(rows[0].orders.map(o => o.workOrderId)).toEqual(['MON']);
            expect(rows[0].suggestedOrderIds).toEqual(['MON']);
        }
    });

    test('pauziran nalog → ponuđen (paused=true), ali NIJE predčekiran', () => {
        const rows = present([order('P', [item('p1', { Is_Paused: true })])]);
        expect(rows).toHaveLength(1);
        if (rows[0].kind === 'present') {
            expect(rows[0].orders[0].paused).toBe(true);
            expect(rows[0].suggestedOrderIds).toEqual([]);
        }
    });

    // ── NEPOKRENUTI ('Na čekanju') nalozi: nude se da bi se novi nalog startao i
    //    proknjižio u JEDNOM prolazu (potvrda ga auto-starta u prepareWorkerOrderTargets) ──
    test('nepokrenut nalog (dodijeljen) → ponuđen s notStarted=true i PREDČEKIRAN', () => {
        const rows = present([order('NEW', [item('n1', { Status: 'Na čekanju' })], { Status: 'Na čekanju', Started_At: undefined })]);
        expect(rows).toHaveLength(1);
        if (rows[0].kind === 'present') {
            expect(rows[0].orders.map(o => o.workOrderId)).toEqual(['NEW']);
            expect(rows[0].orders[0].notStarted).toBe(true);
            expect(rows[0].suggestedOrderIds).toEqual(['NEW']);
        }
    });

    test('nepokrenut nalog (radnik NIJE dodijeljen) → ponuđen, ali NIJE predčekiran (start je nuspojava)', () => {
        const rows = present([order('NEW', [item('n1', {
            Status: 'Na čekanju',
            Assigned_Workers: [{ Worker_ID: 'OTHER', Worker_Name: 'Drugi', Daily_Rate: 80 }],
        })], { Status: 'Na čekanju', Started_At: undefined })]);
        expect(rows).toHaveLength(1);
        if (rows[0].kind === 'present') {
            expect(rows[0].orders[0].notStarted).toBe(true);
            expect(rows[0].suggestedOrderIds).toEqual([]);
        }
    });

    test('aktivan nalog ima notStarted=false; nepokrenuti se sortiraju iza aktivnih', () => {
        const rows = present([
            order('NEW', [item('n1', { Status: 'Na čekanju' })], { Status: 'Na čekanju', Started_At: undefined }),
            order('ACT', [item('a1')]),
        ]);
        if (rows[0].kind === 'present') {
            expect(rows[0].orders.map(o => o.workOrderId)).toEqual(['ACT', 'NEW']);
            expect(rows[0].orders[0].notStarted).toBe(false);
            expect(rows[0].suggestedOrderIds.sort()).toEqual(['ACT', 'NEW']);
        }
    });

    test('nema nijednog aktivnog/pauziranog naloga (sve završeno/otkazano) → nema reda', () => {
        const rows = present([
            order('DONE', [item('d1', { Status: 'Završeno' })], { Status: 'Završeno' }),
            order('CANC', [item('c1')], { Status: 'Otkazano' }),
        ]);
        expect(rows).toHaveLength(0);
        expect(proposalNeedsConfirm(rows)).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('buildBookingProposal — Teren', () => {
    test('teren UVIJEK daje red; predabir = dodijeljeni aktivni Montaža nalog', () => {
        const rows = buildBookingProposal(
            [{ workerId: W, workerName: 'Radnik', status: 'Teren' }],
            [order('PROD', [item('p1')]), order('MON', [item('m1')], { Work_Order_Type: 'Montaža' })],
            DAY
        );
        expect(rows).toHaveLength(1);
        const r = rows[0];
        expect(r.kind).toBe('teren');
        if (r.kind === 'teren') expect(r.suggestedWorkOrderId).toBe('MON');
    });

    test('teren bez dodijeljene montaže → red bez predabira (korisnik bira)', () => {
        const rows = buildBookingProposal(
            [{ workerId: W, workerName: 'Radnik', status: 'Teren' }],
            [order('PROD', [item('p1')])],
            DAY
        );
        expect(rows).toHaveLength(1);
        if (rows[0].kind === 'teren') expect(rows[0].suggestedWorkOrderId).toBeUndefined();
    });

    // ── "KAO JUČER" fallback (P7 iz PDF-a): teren bez auto-Montaže dobije jučerašnji nalog ──
    test('teren bez auto-Montaže → predabir = nalog na koji je radnik JUČER knjižen', () => {
        const yMap = new Map<string, string[]>([[W, ['PROD']]]);
        const rows = buildBookingProposal(
            [{ workerId: W, workerName: 'Radnik', status: 'Teren' }],
            [order('PROD', [item('p1')])],
            DAY,
            undefined,
            yMap,
        );
        expect(rows).toHaveLength(1);
        if (rows[0].kind === 'teren') expect(rows[0].suggestedWorkOrderId).toBe('PROD');
    });

    test('teren: auto-Montaža ima prednost nad jučerašnjim (predabir = Montaža)', () => {
        const yMap = new Map<string, string[]>([[W, ['PROD']]]);
        const rows = buildBookingProposal(
            [{ workerId: W, workerName: 'Radnik', status: 'Teren' }],
            [order('PROD', [item('p1')]), order('MON', [item('m1')], { Work_Order_Type: 'Montaža' })],
            DAY,
            undefined,
            yMap,
        );
        if (rows[0].kind === 'teren') expect(rows[0].suggestedWorkOrderId).toBe('MON');
    });

    test('prisutan bez ijednog predčekiranog naloga → jučerašnji nalog (ako je danas dostupan) predčekiran', () => {
        const yMap = new Map<string, string[]>([[W, ['RP']]]);
        // aktivan nalog na koji radnik NIJE dodijeljen → inače prazan suggested
        const rows = buildBookingProposal(
            [{ workerId: W, workerName: 'Radnik', status: 'Prisutan' }],
            [order('RP', [item('rp1', { Assigned_Workers: [{ Worker_ID: 'OTHER', Worker_Name: 'Drugi', Daily_Rate: 80 }] })], { Name: 'Razni poslovi' })],
            DAY,
            undefined,
            yMap,
        );
        if (rows[0].kind === 'present') expect(rows[0].suggestedOrderIds).toEqual(['RP']);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('buildBookingProposal — bulk miks', () => {
    test('prisutan + teren + odsutan → 2 reda (odsutan se ignoriše)', () => {
        const orders = [
            order('A', [item('a1')]),
            order('MON', [item('m1', { Assigned_Workers: [{ Worker_ID: 'W2', Worker_Name: 'Drugi', Daily_Rate: 90 }] })], { Work_Order_Type: 'Montaža' }),
        ];
        const rows = buildBookingProposal(
            [
                { workerId: W, workerName: 'Radnik', status: 'Prisutan' },
                { workerId: 'W2', workerName: 'Drugi', status: 'Teren' },
                { workerId: 'W3', workerName: 'Treci', status: 'Odsutan' },
            ],
            orders,
            DAY
        );
        expect(rows.map(r => r.kind)).toEqual(['present', 'teren']);
        const teren = rows.find(r => r.kind === 'teren');
        if (teren && teren.kind === 'teren') expect(teren.suggestedWorkOrderId).toBe('MON');
    });
});
