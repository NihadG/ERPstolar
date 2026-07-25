// Paritet mobilnog i desktop prikaza: grupisanje i poredak moraju biti
// identični, jer je mobilni ranije imao SVOJA pravila (drugačiji redoslijed
// istih podataka na telefonu i laptopu).

import {
    groupWorkOrders, groupOrders, sortOrders, groupOffers, sortOffers,
    groupProjectsByStatus,
} from '../grouping';
import type { Offer, Order, Project, WorkOrder } from '../types';

const wo = (over: Partial<WorkOrder> & { Work_Order_ID: string }): WorkOrder => ({
    Organization_ID: 'org', Work_Order_Number: over.Work_Order_ID,
    Created_Date: '2026-07-01T00:00:00.000Z', Due_Date: '2026-08-01',
    Status: 'U toku', Production_Steps: [], Notes: '', items: [],
    ...over,
} as WorkOrder);

const order = (over: Partial<Order> & { Order_ID: string }): Order => ({
    Organization_ID: 'org', Order_Number: over.Order_ID, Supplier_Name: 'Blum',
    Order_Date: '2026-07-01', Status: 'Poslano', Total_Amount: 100, items: [],
    ...over,
} as Order);

describe('groupWorkOrders — replika ProductionTab', () => {
    it('grupiše po projektu i koristi Project_Name kao naslov grupe', () => {
        const groups = groupWorkOrders([
            wo({ Work_Order_ID: 'A', items: [{ Project_ID: 'p1', Project_Name: 'Vila' }] as any }),
            wo({ Work_Order_ID: 'B', items: [{ Project_ID: 'p1', Project_Name: 'Vila' }] as any }),
            wo({ Work_Order_ID: 'C', items: [{ Project_ID: 'p2', Project_Name: 'Stan' }] as any }),
        ], 'project');

        expect(groups).toHaveLength(2);
        expect(groups.map(g => g.label).sort()).toEqual(['Stan', 'Vila']);
        expect(groups.find(g => g.label === 'Vila')!.count).toBe(2);
    });

    it('grupe po datumu idu najnovije prvo', () => {
        const groups = groupWorkOrders([
            wo({ Work_Order_ID: 'star', Created_Date: '2026-07-01T00:00:00.000Z' }),
            wo({ Work_Order_ID: 'nov', Created_Date: '2026-07-20T00:00:00.000Z' }),
        ], 'date');
        expect(groups[0].key).toBe('2026-07-20');
    });

    it('kod grupisanja po radniku isti nalog ulazi u VIŠE grupa', () => {
        const groups = groupWorkOrders([
            wo({
                Work_Order_ID: 'A',
                items: [{
                    ID: 'i1', Project_ID: 'p', Project_Name: 'P',
                    Assigned_Workers: [{ Worker_ID: 'w1', Worker_Name: 'Marko', Daily_Rate: 100 }],
                    Processes: [{ Process_Name: 'Krojenje', Status: 'Završeno', Worker_ID: 'w2' }],
                }] as any,
            }),
        ], 'worker', [
            { Worker_ID: 'w1', Name: 'Marko' } as any,
            { Worker_ID: 'w2', Name: 'Ivan' } as any,
        ]);

        expect(groups.map(g => g.label).sort()).toEqual(['Ivan', 'Marko']);
    });

    it('nalog bez ijednog radnika ide u „Nedodijeljeno"', () => {
        const groups = groupWorkOrders([wo({ Work_Order_ID: 'A' })], 'worker', []);
        expect(groups[0].label).toBe('Nedodijeljeno');
    });

    it('„none" ne pravi grupe', () => {
        expect(groupWorkOrders([wo({ Work_Order_ID: 'A' })], 'none')).toEqual([]);
    });
});

describe('groupOrders / sortOrders — replika OrdersTab', () => {
    it('grupiše po dobavljaču i zbraja iznos grupe', () => {
        const groups = groupOrders([
            order({ Order_ID: '1', Supplier_Name: 'Blum', Total_Amount: 100 }),
            order({ Order_ID: '2', Supplier_Name: 'Blum', Total_Amount: 50 }),
            order({ Order_ID: '3', Supplier_Name: 'Egger', Total_Amount: 70 }),
        ], 'supplier');

        const blum = groups.find(g => g.key === 'Blum')!;
        expect(blum.count).toBe(2);
        expect(blum.totalValue).toBe(150);
    });

    it('grupa po datumu je MJESEC, ne dan', () => {
        const groups = groupOrders([
            order({ Order_ID: '1', Order_Date: '2026-07-03' }),
            order({ Order_ID: '2', Order_Date: '2026-07-28' }),
        ], 'date');
        expect(groups).toHaveLength(1);
    });

    it('sortira po iznosu silazno', () => {
        const sorted = sortOrders([
            order({ Order_ID: 'malo', Total_Amount: 10 }),
            order({ Order_ID: 'puno', Total_Amount: 900 }),
        ], 'amount-desc');
        expect(sorted[0].Order_ID).toBe('puno');
    });
});

describe('groupOffers / sortOffers — replika OffersTab', () => {
    const offer = (over: Partial<Offer> & { Offer_ID: string }): Offer => ({
        Organization_ID: 'org', Project_ID: 'p', Offer_Number: over.Offer_ID,
        Created_Date: '2026-07-01', Valid_Until: '2026-08-01', Status: 'Nacrt',
        Transport_Cost: 0, Onsite_Assembly: false, Onsite_Discount: 0,
        Subtotal: 0, Total: 0, Notes: '', Accepted_Date: '', Include_PDV: false, PDV_Rate: 17,
        ...over,
    } as Offer);

    it('grupe po statusu prate poslovni redoslijed (Nacrt → Poslano → Prihvaćeno)', () => {
        const groups = groupOffers([
            offer({ Offer_ID: '1', Status: 'Prihvaćeno' }),
            offer({ Offer_ID: '2', Status: 'Nacrt' }),
            offer({ Offer_ID: '3', Status: 'Poslano' }),
        ], 'status');
        expect(groups.map(g => g.key)).toEqual(['Nacrt', 'Poslano', 'Prihvaćeno']);
    });

    it('sortira po klijentu A–Ž', () => {
        const sorted = sortOffers([
            offer({ Offer_ID: '1', Client_Name: 'Zoran' }),
            offer({ Offer_ID: '2', Client_Name: 'Amar' }),
        ], 'client-asc');
        expect(sorted[0].Client_Name).toBe('Amar');
    });
});

describe('groupProjectsByStatus — replika ProjectsTab', () => {
    const project = (over: Partial<Project> & { Project_ID: string }): Project => ({
        Organization_ID: 'org', Client_Name: 'Klijent', Status: 'Nacrt',
        Created_Date: '2026-07-01', products: [],
        ...over,
    } as Project);

    it('grupe idu redoslijedom U proizvodnji → Odobreno → Ponuđeno', () => {
        const groups = groupProjectsByStatus([
            project({ Project_ID: '1', Status: 'Ponuđeno' }),
            project({ Project_ID: '2', Status: 'U proizvodnji' }),
            project({ Project_ID: '3', Status: 'Odobreno' }),
        ], new Map());
        expect(groups.map(g => g.key)).toEqual(['U proizvodnji', 'Odobreno', 'Ponuđeno']);
    });

    it('unutar grupe projekat s više aktivnih naloga ide prvi', () => {
        const groups = groupProjectsByStatus([
            project({ Project_ID: 'mirni', Client_Name: 'A', Status: 'U proizvodnji' }),
            project({ Project_ID: 'zauzet', Client_Name: 'B', Status: 'U proizvodnji' }),
        ], new Map([['zauzet', 3]]));
        expect(groups[0].items[0].Project_ID).toBe('zauzet');
    });
});
