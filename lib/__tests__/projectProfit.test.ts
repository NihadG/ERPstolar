import { projectProfitBreakdown } from '../projectProfit';
import { itemProfitBreakdown, sumBreakdowns } from '../profit';

describe('projectProfitBreakdown — parity sa WorkOrderExpandedDetail (isti izvor, Σ svih naloga projekta)', () => {
    test('jednostavan proizvodni nalog: profit projekta == profit stavke (jedan item)', () => {
        const r = projectProfitBreakdown({
            projectId: 'P1',
            workOrders: [{
                Work_Order_ID: 'WO1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Project_ID: 'P1', Product_Value: 1200, Material_Cost: 100, Quantity: 3, Services_Total: 0, Transport_Share: 0 }],
            }],
            workLogs: [{ Work_Order_Item_ID: 'I1', Daily_Rate: 180 }],
        });
        // materijal = 100 (po komadu) × 3 = 300; profit = 1200 - 300 - 180 = 720
        expect(r.material).toBe(300);
        expect(r.labor).toBe(180);
        expect(r.profit).toBe(720);
        expect(r.itemCount).toBe(1);
        expect(r.missingPrice).toBe(false);
    });

    test('otkazan nalog se potpuno isključuje iz agregacije', () => {
        const r = projectProfitBreakdown({
            projectId: 'P1',
            workOrders: [{
                Work_Order_ID: 'WOX', Status: 'Otkazano', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'IX', Project_ID: 'P1', Product_Value: 5000, Material_Cost: 10, Quantity: 1 }],
            }],
            workLogs: [],
        });
        expect(r.itemCount).toBe(0);
        expect(r.profit).toBe(0);
    });

    test('stavke drugih projekata se ne broje', () => {
        const r = projectProfitBreakdown({
            projectId: 'P1',
            workOrders: [{
                Work_Order_ID: 'WO1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [
                    { ID: 'I1', Project_ID: 'P1', Product_Value: 100, Material_Cost: 0, Quantity: 1 },
                    { ID: 'I2', Project_ID: 'P2', Product_Value: 999, Material_Cost: 0, Quantity: 1 },
                ],
            }],
            workLogs: [],
        });
        expect(r.itemCount).toBe(1);
        expect(r.revenue).toBe(100);
    });

    test('montaža stavka: samo rad ulazi u trošak, prihod/materijal/usluge/transport su 0 bez obzira na stored vrijednosti', () => {
        const r = projectProfitBreakdown({
            projectId: 'P1',
            workOrders: [{
                Work_Order_ID: 'WOM', Status: 'U toku', Work_Order_Type: 'Montaža',
                items: [{ ID: 'IM', Project_ID: 'P1', Product_Value: 500, Material_Cost: 50, Quantity: 2, Services_Total: 30, Transport_Share: 20 }],
            }],
            workLogs: [{ Work_Order_Item_ID: 'IM', Daily_Rate: 130 }],
        });
        expect(r.revenue).toBe(0);
        expect(r.material).toBe(0);
        expect(r.services).toBe(0);
        expect(r.transport).toBe(0);
        expect(r.labor).toBe(130);
        expect(r.profit).toBe(-130);
    });

    test('0-revenue proizvodna stavka (nedopunjena ponuda) → rad je VIDLJIV gubitak, missingPrice=true (bez skipa)', () => {
        const r = projectProfitBreakdown({
            projectId: 'P1',
            workOrders: [{
                Work_Order_ID: 'WO1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Project_ID: 'P1', Product_Value: 0, Material_Cost: 0, Quantity: 1 }],
            }],
            workLogs: [{ Work_Order_Item_ID: 'I1', Daily_Rate: 260 }],
        });
        expect(r.itemCount).toBe(1);
        expect(r.missingPrice).toBe(true);
        expect(r.profit).toBe(-260);
    });

    test('Profit_Overrides.Selling_Price=0 se IGNORIŠE (nije validan override) — pada na Product_Value', () => {
        const r = projectProfitBreakdown({
            projectId: 'P1',
            workOrders: [{
                Work_Order_ID: 'WO1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Project_ID: 'P1', Product_Value: 800, Material_Cost: 0, Quantity: 1, Profit_Overrides: { Selling_Price: 0 } }],
            }],
            workLogs: [],
        });
        expect(r.revenue).toBe(800);
    });

    test('Profit_Overrides.Selling_Price>0 se PRIMJENJUJE umjesto Product_Value', () => {
        const r = projectProfitBreakdown({
            projectId: 'P1',
            workOrders: [{
                Work_Order_ID: 'WO1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Project_ID: 'P1', Product_Value: 800, Material_Cost: 0, Quantity: 1, Profit_Overrides: { Selling_Price: 950 } }],
            }],
            workLogs: [],
        });
        expect(r.revenue).toBe(950);
    });

    test('materijal je PO KOMADU na stavci — agregat množi količinom TE stavke', () => {
        const r = projectProfitBreakdown({
            projectId: 'P1',
            workOrders: [{
                Work_Order_ID: 'WO1', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Project_ID: 'P1', Product_Value: 0, Material_Cost: 255, Quantity: 15 }],
            }],
            workLogs: [],
        });
        expect(r.material).toBe(3825); // 255 × 15, NE 255
    });

    test('INVARIJANTA: profit projekta == Σ sumBreakdowns svih naloga (multi-WO, proizvodnja + montaža)', () => {
        const woA = {
            Work_Order_ID: 'WOA', Status: 'U toku' as const, Work_Order_Type: 'Proizvodnja' as const,
            items: [
                { ID: 'A1', Project_ID: 'P1', Product_Value: 1200, Material_Cost: 100, Quantity: 3, Services_Total: 20, Transport_Share: 10 },
                { ID: 'A2', Project_ID: 'P1', Product_Value: 0, Material_Cost: 0, Quantity: 1 }, // nedopunjen proizvod
            ],
        };
        const woB = {
            Work_Order_ID: 'WOB', Status: 'U toku' as const, Work_Order_Type: 'Montaža' as const,
            items: [{ ID: 'B1', Project_ID: 'P1', Product_Value: 0, Material_Cost: 0, Quantity: 1 }],
        };
        const workLogs = [
            { Work_Order_Item_ID: 'A1', Daily_Rate: 180 },
            { Work_Order_Item_ID: 'A2', Daily_Rate: 90 },
            { Work_Order_Item_ID: 'B1', Daily_Rate: 130 },
        ];

        const project = projectProfitBreakdown({ projectId: 'P1', workOrders: [woA, woB], workLogs });

        // Ručno izračunaj isti model po nalogu (WorkOrderExpandedDetail pattern) i saberi.
        const perWoFin = [woA, woB].map(wo => {
            const isMontaza = wo.Work_Order_Type === 'Montaža';
            const fins = wo.items.map(item => {
                const labor = workLogs.filter(l => l.Work_Order_Item_ID === item.ID).reduce((s, l) => s + l.Daily_Rate, 0);
                return isMontaza
                    ? itemProfitBreakdown({ laborTotal: labor })
                    : itemProfitBreakdown({
                        productValue: item.Product_Value, materialPerUnit: item.Material_Cost,
                        quantity: item.Quantity, laborTotal: labor,
                        servicesTotal: (item as any).Services_Total, transportShare: (item as any).Transport_Share,
                    });
            });
            return sumBreakdowns(fins);
        });
        const expectedTotal = sumBreakdowns(perWoFin);

        expect(project.profit).toBe(expectedTotal.profit);
        expect(project.revenue).toBe(expectedTotal.revenue);
        expect(project.material).toBe(expectedTotal.material);
        expect(project.labor).toBe(expectedTotal.labor);
        expect(project.missingPrice).toBe(expectedTotal.missingPrice);
    });
});
