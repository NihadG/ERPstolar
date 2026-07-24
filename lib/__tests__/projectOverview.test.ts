import { buildProjectOverview } from '../projectOverview';
import { projectProfitBreakdown } from '../projectProfit';

// Minimalne fiksture — uski ulazni tipovi (samo čitana polja).
function baseProject(products: any[] = []) {
    return { Project_ID: 'P1', products };
}

describe('buildProjectOverview — finansije', () => {
    test('jednostavan proizvodni nalog: financial == itemProfitBreakdown', () => {
        const ov = buildProjectOverview({
            project: baseProject(),
            workOrders: [{
                Work_Order_ID: 'WO1', Work_Order_Number: 'RN1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Product_ID: 'PR1', Product_Name: 'Ormar', Project_ID: 'P1', Product_Value: 1200, Material_Cost: 100, Quantity: 3, Services_Total: 0, Transport_Share: 0, Status: 'U toku' }],
            }],
            workLogs: [{ Work_Order_Item_ID: 'I1', Product_ID: 'PR1', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 180, Day_Fraction: 1, Date: '2026-07-01' }],
        });
        // materijal = 100 × 3 = 300; profit = 1200 − 300 − 180 = 720
        expect(ov.financial.material).toBe(300);
        expect(ov.financial.labor).toBe(180);
        expect(ov.financial.profit).toBe(720);
        expect(ov.financial.revenue).toBe(1200);
        expect(ov.counts.products).toBe(1);
    });

    test('INVARIJANTA: financial.profit == projectProfitBreakdown().profit (multi-WO, proizvodnja + montaža)', () => {
        const workOrders = [
            {
                Work_Order_ID: 'WOA', Work_Order_Number: 'RN-A', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [
                    { ID: 'A1', Product_ID: 'PR1', Product_Name: 'Kuhinja', Project_ID: 'P1', Product_Value: 1200, Material_Cost: 100, Quantity: 3, Services_Total: 20, Transport_Share: 10, Status: 'U toku' },
                    { ID: 'A2', Product_ID: 'PR2', Product_Name: 'Nedopunjen', Project_ID: 'P1', Product_Value: 0, Material_Cost: 0, Quantity: 1, Status: 'Na čekanju' },
                ],
            },
            {
                Work_Order_ID: 'WOB', Work_Order_Number: 'RN-B', Status: 'U toku', Work_Order_Type: 'Montaža',
                items: [{ ID: 'B1', Product_ID: 'PR1', Product_Name: 'Kuhinja', Project_ID: 'P1', Product_Value: 999, Material_Cost: 50, Quantity: 1, Status: 'U toku' }],
            },
        ];
        const workLogs = [
            { Work_Order_Item_ID: 'A1', Product_ID: 'PR1', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 180, Day_Fraction: 1, Date: '2026-07-01' },
            { Work_Order_Item_ID: 'A2', Product_ID: 'PR2', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 90, Day_Fraction: 0.5, Date: '2026-07-02' },
            { Work_Order_Item_ID: 'B1', Product_ID: 'PR1', Worker_ID: 'W2', Worker_Name: 'Marko', Daily_Rate: 130, Day_Fraction: 1, Date: '2026-07-03' },
        ];

        const ov = buildProjectOverview({ project: baseProject(), workOrders, workLogs });
        const ref = projectProfitBreakdown({ projectId: 'P1', workOrders: workOrders as any, workLogs });

        expect(ov.financial.profit).toBe(ref.profit);
        expect(ov.financial.revenue).toBe(ref.revenue);
        expect(ov.financial.material).toBe(ref.material);
        expect(ov.financial.labor).toBe(ref.labor);
        expect(ov.financial.services).toBe(ref.services);
        expect(ov.financial.transport).toBe(ref.transport);
        expect(ov.financial.missingPrice).toBe(ref.missingPrice);
    });

    test('otkazan nalog i stavke drugih projekata se isključuju', () => {
        const ov = buildProjectOverview({
            project: baseProject(),
            workOrders: [
                { Work_Order_ID: 'WOX', Work_Order_Number: 'X', Status: 'Otkazano', Work_Order_Type: 'Proizvodnja', items: [{ ID: 'IX', Product_ID: 'PRX', Project_ID: 'P1', Product_Value: 5000, Material_Cost: 10, Quantity: 1 }] },
                { Work_Order_ID: 'WO1', Work_Order_Number: 'RN1', Status: 'U toku', Work_Order_Type: 'Proizvodnja', items: [
                    { ID: 'I1', Product_ID: 'PR1', Project_ID: 'P1', Product_Value: 100, Material_Cost: 0, Quantity: 1 },
                    { ID: 'I2', Product_ID: 'PR2', Project_ID: 'P2', Product_Value: 999, Material_Cost: 0, Quantity: 1 },
                ] },
            ],
            workLogs: [],
        });
        expect(ov.financial.revenue).toBe(100);
        expect(ov.workOrders.length).toBe(1);
        expect(ov.workOrders[0].workOrderId).toBe('WO1');
    });
});

describe('buildProjectOverview — radnici', () => {
    test('radnik: dani = Σ Day_Fraction (dio projekta), cost = Σ Daily_Rate, enrich iz kataloga', () => {
        const ov = buildProjectOverview({
            project: baseProject(),
            workOrders: [{
                Work_Order_ID: 'WO1', Work_Order_Number: 'RN1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Product_ID: 'PR1', Product_Name: 'Ormar', Project_ID: 'P1', Product_Value: 1000, Material_Cost: 0, Quantity: 1, Status: 'U toku' }],
            }],
            workLogs: [
                { Work_Order_Item_ID: 'I1', Product_ID: 'PR1', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 100, Day_Fraction: 0.5, Date: '2026-07-01' },
                { Work_Order_Item_ID: 'I1', Product_ID: 'PR1', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 100, Day_Fraction: 0.5, Date: '2026-07-02' },
                { Work_Order_Item_ID: 'OTHER', Product_ID: 'PRZ', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 999, Day_Fraction: 1, Date: '2026-07-03' }, // druga stavka, van projekta
            ],
            workers: [{ Worker_ID: 'W1', Name: 'Ivan Ivić', Role: 'Rezač', Worker_Type: 'Glavni' }],
        });
        expect(ov.workers.length).toBe(1);
        expect(ov.workers[0].days).toBe(1);       // 0.5 + 0.5, log van projekta ignorisan
        expect(ov.workers[0].cost).toBe(200);     // 100 + 100
        expect(ov.workers[0].role).toBe('Rezač');
        expect(ov.workers[0].type).toBe('Glavni');
        expect(ov.counts.totalWorkerDays).toBe(1);
    });
});

describe('buildProjectOverview — svi proizvodi (uklj. one van proizvodnje)', () => {
    test('proizvod bez naloga se prikazuje (notInProduction), ali NE ulazi u financial', () => {
        const ov = buildProjectOverview({
            project: baseProject([
                { Product_ID: 'PR1', Name: 'Ormar', Quantity: 2, materials: [{ Material_ID: 'M1', Material_Name: 'Iveral', Quantity: 4, Total_Price: 100 }] },
                { Product_ID: 'PR2', Name: 'Komoda (nije u nalogu)', Quantity: 3, materials: [{ Material_ID: 'M2', Material_Name: 'MDF', Quantity: 2, Total_Price: 50 }] },
            ]),
            workOrders: [{
                Work_Order_ID: 'WO1', Work_Order_Number: 'RN1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Product_ID: 'PR1', Product_Name: 'Ormar', Project_ID: 'P1', Product_Value: 1000, Material_Cost: 0, Quantity: 2, Status: 'U toku' }],
            }],
            workLogs: [],
        });
        // PR1 u proizvodnji, PR2 nije
        expect(ov.products.length).toBe(2);
        const pr2 = ov.products.find(p => p.productId === 'PR2')!;
        expect(pr2.notInProduction).toBe(true);
        expect(pr2.material).toBe(150); // 50 (po komadu) × 3 kom
        // Financial gleda SAMO proizvodnju (PR1): prihod 1000, PR2 ne obara profit
        expect(ov.financial.revenue).toBe(1000);
        expect(ov.financial.profit).toBe(1000);
        expect(ov.counts.productsInProduction).toBe(1);
        expect(ov.counts.productsNotStarted).toBe(1);
        expect(ov.counts.products).toBe(2);
    });
});

describe('buildProjectOverview — dnevni rad', () => {
    test('laborByDay grupiše po danu (labor + broj radnika)', () => {
        const ov = buildProjectOverview({
            project: baseProject(),
            workOrders: [{
                Work_Order_ID: 'WO1', Work_Order_Number: 'RN1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Product_ID: 'PR1', Product_Name: 'Ormar', Project_ID: 'P1', Product_Value: 2000, Material_Cost: 0, Quantity: 1, Status: 'U toku' }],
            }],
            workLogs: [
                { Work_Order_Item_ID: 'I1', Product_ID: 'PR1', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 100, Day_Fraction: 1, Date: '2026-07-01' },
                { Work_Order_Item_ID: 'I1', Product_ID: 'PR1', Worker_ID: 'W2', Worker_Name: 'Marko', Daily_Rate: 90, Day_Fraction: 1, Date: '2026-07-01' },
                { Work_Order_Item_ID: 'I1', Product_ID: 'PR1', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 100, Day_Fraction: 1, Date: '2026-07-02' },
            ],
        });
        expect(ov.laborByDay.length).toBe(2);
        const d1 = ov.laborByDay.find(d => d.date === '2026-07-01')!;
        expect(d1.labor).toBe(190);   // 100 + 90
        expect(d1.workers).toBe(2);
        const d2 = ov.laborByDay.find(d => d.date === '2026-07-02')!;
        expect(d2.labor).toBe(100);
        expect(d2.workers).toBe(1);
    });
});

describe('buildProjectOverview — materijali', () => {
    test('agregira BOM po materijalu, najgori status, preostalo', () => {
        const ov = buildProjectOverview({
            project: baseProject([
                { Product_ID: 'PR1', Name: 'Ormar', Quantity: 1, materials: [
                    { Material_ID: 'M1', Material_Name: 'Iveral bijeli', Unit: 'm²', Quantity: 5, Total_Price: 250, Status: 'Naručeno', On_Stock: 0, Ordered_Quantity: 5, Received_Quantity: 0 },
                ] },
                { Product_ID: 'PR2', Name: 'Komoda', Quantity: 1, materials: [
                    { Material_ID: 'M1', Material_Name: 'Iveral bijeli', Unit: 'm²', Quantity: 3, Total_Price: 150, Status: 'Nije naručeno', On_Stock: 0, Ordered_Quantity: 0, Received_Quantity: 0 },
                    { Material_ID: 'M2', Material_Name: 'Kant traka', Unit: 'm', Quantity: 10, Total_Price: 20, Status: 'Primljeno', On_Stock: 0, Ordered_Quantity: 10, Received_Quantity: 10 },
                ] },
            ]),
            workOrders: [],
            workLogs: [],
        });
        expect(ov.materials.length).toBe(2);
        const iveral = ov.materials.find(m => m.materialId === 'M1')!;
        expect(iveral.needed).toBe(8);            // 5 + 3
        expect(iveral.status).toBe('Nije naručeno'); // najgori od Naručeno + Nije naručeno
        expect(iveral.products.length).toBe(2);
        expect(iveral.remaining).toBe(8);          // needed − stock − received
        expect(ov.materialCatalogCost).toBe(420);  // 250 + 150 + 20
    });
});
