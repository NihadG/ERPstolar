import { buildProjectOverview, buildMiscOverview } from '../projectOverview';
import { buildFinanceBasis, buildLaborIndex, computeProjectsFinance } from '../projectFinance';

// Minimalne fiksture — uski ulazni tipovi (samo čitana polja).
function baseProject(products: any[] = []) {
    return { Project_ID: 'P1', products };
}

// Prihvaćena ponuda projekta P1 (cijene po komadu).
const offer = (lines: { pid: string; sell: number; qty?: number; mat?: number; labor?: [number, number, number] }[]) => [{
    Offer_ID: 'O1', Project_ID: 'P1', Offer_Number: 'P-1', Status: 'Prihvaćeno', Accepted_Date: '2026-07-01', Total: 0,
    products: lines.map(l => ({
        Product_ID: l.pid, Included: true, Quantity: l.qty ?? 1, Selling_Price: l.sell, Total_Price: l.sell * (l.qty ?? 1),
        Material_Cost: l.mat ?? 0, Labor_Workers: l.labor?.[0] ?? 0, Labor_Days: l.labor?.[1] ?? 0, Labor_Daily_Rate: l.labor?.[2] ?? 0,
    })),
}];

describe('buildProjectOverview — finansije (prihvaćena ponuda − živi materijal − rad, završeni proizvodi)', () => {
    const products = [
        { Product_ID: 'PR1', Name: 'Ormar', Quantity: 3, Status: 'Spremno', materials: [{ Material_ID: 'M1', Material_Name: 'Iveral', Quantity: 2, Total_Price: 100 }] },
        { Product_ID: 'PR2', Name: 'Komoda', Quantity: 1, Status: 'Na čekanju', materials: [{ Material_ID: 'M2', Material_Name: 'MDF', Quantity: 1, Total_Price: 40 }] },
    ];
    const offers = offer([{ pid: 'PR1', sell: 400, qty: 3, mat: 90, labor: [1, 1, 150] }, { pid: 'PR2', sell: 300 }]);
    const workOrders = [
        {
            Work_Order_ID: 'WOA', Work_Order_Number: 'RN-A', Status: 'Završeno', Work_Order_Type: 'Proizvodnja',
            items: [{ ID: 'A1', Product_ID: 'PR1', Product_Name: 'Ormar', Project_ID: 'P1', Product_Value: 1, Material_Cost: 999, Quantity: 3, Status: 'Završeno', Completed_At: '2026-07-05T10:00:00Z' }],
        },
        {
            Work_Order_ID: 'WOB', Work_Order_Number: 'RN-B', Status: 'U toku', Work_Order_Type: 'Montaža',
            items: [{ ID: 'B1', Product_ID: 'PR1', Product_Name: 'Ormar', Project_ID: 'P1', Product_Value: 999, Material_Cost: 50, Quantity: 3, Status: 'U toku' }],
        },
        {
            Work_Order_ID: 'WOC', Work_Order_Number: 'RN-C', Status: 'U toku', Work_Order_Type: 'Proizvodnja',
            items: [{ ID: 'C1', Product_ID: 'PR2', Product_Name: 'Komoda', Project_ID: 'P1', Quantity: 1, Status: 'U toku' }],
        },
    ];
    const workLogs = [
        { Work_Order_Item_ID: 'A1', Product_ID: 'PR1', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 180, Day_Fraction: 1, Date: '2026-07-01' },
        { Work_Order_Item_ID: 'B1', Product_ID: 'PR1', Worker_ID: 'W2', Worker_Name: 'Marko', Daily_Rate: 130, Day_Fraction: 1, Date: '2026-07-06' },
        { Work_Order_Item_ID: 'C1', Product_ID: 'PR2', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 90, Day_Fraction: 0.5, Date: '2026-07-07' },
        { Work_Order_Item_ID: 'A1', Product_ID: 'PR1', Worker_ID: 'W3', Worker_Name: 'Obrisan', Daily_Rate: 500, Day_Fraction: 1, Date: '2026-07-02', Work_Order_Deleted: true },
    ];
    const ov = buildProjectOverview({ project: baseProject(products), workOrders, workLogs, offers });

    test('naslovni profit = završeni proizvod: ponuda (1200) − sastavnica (300) − rad proizvodnje + montaže (310)', () => {
        expect(ov.financial.revenue).toBe(1200);
        expect(ov.financial.material).toBe(300);
        expect(ov.financial.labor).toBe(310);
        expect(ov.financial.profit).toBe(590);
        expect(ov.counts.productsFinished).toBe(1);
    });

    test('proizvod u izradi NIJE u profitu, ali je u finance.inProgress', () => {
        expect(ov.finance.inProgress.count).toBe(1);
        expect(ov.finance.inProgress.revenue).toBe(300);
        expect(ov.finance.inProgress.labor).toBe(90);
        expect(ov.products.find(p => p.productId === 'PR2')?.stage).toBe('u_izradi');
    });

    test('ugovoreno = Σ prihvaćenih ponuda; obrisane dnevnice se ne broje nigdje', () => {
        expect(ov.finance.contracted).toBe(1500);
        expect(ov.spentLabor).toBe(400);   // 180 + 130 + 90 (bez 500 s obrisanog naloga)
        expect(ov.workers.find(w => w.workerId === 'W3')).toBeUndefined();
    });

    test('plan vs stvarno za završene proizvode (iz ponude)', () => {
        expect(ov.hasPlan).toBe(true);
        expect(ov.plannedMaterial).toBe(270);   // 90 × 3
        expect(ov.plannedLabor).toBe(450);      // 1 × 1 × 150 × 3
    });

    test('INVARIJANTA: pregled projekta == proračun kartice/analitike (isti broj)', () => {
        const prods = products.map(p => ({ ...p, Project_ID: 'P1' }));
        const basis = buildFinanceBasis(prods, offers);
        const all = computeProjectsFinance({ products: prods, basis, workOrders, labor: buildLaborIndex(workLogs, workOrders), logs: workLogs });
        expect(all.get('P1')?.profit).toBe(ov.financial.profit);
        expect(all.get('P1')?.revenue).toBe(ov.financial.revenue);
    });

    test('nalozi: montaža nosi samo rad; završeni nalog nosi prihod iz ponude i živu sastavnicu', () => {
        const mont = ov.workOrders.find(w => w.workOrderId === 'WOB')!;
        expect(mont.revenue).toBe(0);
        expect(mont.profit).toBe(-130);
        const a = ov.workOrders.find(w => w.workOrderId === 'WOA')!;
        expect(a.revenue).toBe(1200);
        expect(a.material).toBe(300);
    });

    test('otkazan nalog i stavke drugih projekata se ne prikazuju u nalozima', () => {
        const ov2 = buildProjectOverview({
            project: baseProject(),
            workOrders: [
                { Work_Order_ID: 'WOX', Work_Order_Number: 'X', Status: 'Otkazano', Work_Order_Type: 'Proizvodnja', items: [{ ID: 'IX', Product_ID: 'PRX', Project_ID: 'P1', Product_Value: 5000, Material_Cost: 10, Quantity: 1 }] },
                { Work_Order_ID: 'WO1', Work_Order_Number: 'RN1', Status: 'Završeno', Work_Order_Type: 'Proizvodnja', items: [
                    { ID: 'I1', Product_ID: 'PR1', Project_ID: 'P1', Product_Value: 100, Material_Cost: 0, Quantity: 1, Status: 'Završeno' },
                    { ID: 'I2', Product_ID: 'PR2', Project_ID: 'P2', Product_Value: 999, Material_Cost: 0, Quantity: 1, Status: 'Završeno' },
                ] },
            ],
            workLogs: [],
        });
        expect(ov2.financial.revenue).toBe(100);   // bez ponude: cijena s naloga
        expect(ov2.workOrders.length).toBe(1);
        expect(ov2.workOrders[0].workOrderId).toBe('WO1');
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
    test('proizvod bez naloga se prikazuje (notInProduction), ali NE ulazi u profit', () => {
        const ov = buildProjectOverview({
            project: baseProject([
                { Product_ID: 'PR1', Name: 'Ormar', Quantity: 2, materials: [{ Material_ID: 'M1', Material_Name: 'Iveral', Quantity: 4, Total_Price: 100 }] },
                { Product_ID: 'PR2', Name: 'Komoda (nije u nalogu)', Quantity: 3, materials: [{ Material_ID: 'M2', Material_Name: 'MDF', Quantity: 2, Total_Price: 50 }] },
            ]),
            workOrders: [{
                Work_Order_ID: 'WO1', Work_Order_Number: 'RN1', Status: 'Završeno', Work_Order_Type: 'Proizvodnja',
                items: [{ ID: 'I1', Product_ID: 'PR1', Product_Name: 'Ormar', Project_ID: 'P1', Product_Value: 1000, Material_Cost: 0, Quantity: 2, Status: 'Završeno' }],
            }],
            workLogs: [],
            offers: offer([{ pid: 'PR1', sell: 500, qty: 2 }, { pid: 'PR2', sell: 200, qty: 3 }]),
        });
        expect(ov.products.length).toBe(2);
        const pr2 = ov.products.find(p => p.productId === 'PR2')!;
        expect(pr2.notInProduction).toBe(true);
        expect(pr2.contracted).toBe(600);
        // Profit = samo završeni PR1: 1000 (ponuda) − 200 (sastavnica 100 × 2)
        expect(ov.financial.revenue).toBe(1000);
        expect(ov.financial.profit).toBe(800);
        expect(ov.counts.productsFinished).toBe(1);
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

describe('buildProjectOverview — razni nalozi (custom)', () => {
    // Razni nalog vezan za projekat: vrijednost 500, materijal 120, ostalo 30, rad 180.
    const razniWO = (over: any = {}) => ({
        Work_Order_ID: 'WOZ', Work_Order_Number: 'Z1', Status: 'U toku', Work_Order_Type: 'Zadaci',
        items: [{
            ID: 'Z-I1', Product_ID: 'custom-1', Product_Name: 'Izrada paleta', Project_ID: 'P1',
            Item_Type: 'custom', Quantity: 1, Product_Value: 500, Material_Cost: 120, Other_Costs: 30, Status: 'U toku',
        }],
        ...over,
    });
    const razniLog = { Work_Order_Item_ID: 'Z-I1', Worker_ID: 'W1', Worker_Name: 'Ivan', Daily_Rate: 180, Day_Fraction: 1, Date: '2026-07-01' };

    test('red „Razni nalozi": vrijednost − materijal − ostalo − rad', () => {
        const ov = buildProjectOverview({ project: baseProject(), workOrders: [razniWO()], workLogs: [razniLog] });
        const razni = ov.products.find(p => p.isCustom)!;
        expect(razni.productName).toBe('Razni nalozi');
        expect(razni.revenue).toBe(500);
        expect(razni.material).toBe(120);
        expect(razni.other).toBe(30);
        expect(razni.labor).toBe(180);
        expect(razni.profit).toBe(500 - 120 - 30 - 180);   // 170
    });

    test('više raznih naloga se KONSOLIDUJE u JEDAN red', () => {
        const wo2 = razniWO({
            Work_Order_ID: 'WOZ2', Work_Order_Number: 'Z2',
            items: [{ ID: 'Z-I2', Product_ID: 'custom-2', Product_Name: 'Čišćenje', Project_ID: 'P1', Item_Type: 'custom', Quantity: 1, Product_Value: 200, Material_Cost: 0, Other_Costs: 0, Status: 'U toku' }],
        });
        const ov = buildProjectOverview({ project: baseProject(), workOrders: [razniWO(), wo2], workLogs: [razniLog] });
        const customRows = ov.products.filter(p => p.isCustom);
        expect(customRows.length).toBe(1);                 // jedan konsolidovan red
        expect(customRows[0].revenue).toBe(700);           // 500 + 200
        expect(customRows[0].quantity).toBe(2);            // broj poslova
    });

    test('projekat bez raznih naloga nema taj red', () => {
        const ov = buildProjectOverview({
            project: baseProject(),
            workOrders: [{ Work_Order_ID: 'WO1', Work_Order_Number: 'RN1', Status: 'U toku', Work_Order_Type: 'Proizvodnja', items: [{ ID: 'I1', Product_ID: 'PR1', Product_Name: 'Ormar', Project_ID: 'P1', Product_Value: 1000, Material_Cost: 0, Quantity: 1, Status: 'U toku' }] }],
            workLogs: [],
        });
        expect(ov.products.some(p => p.isCustom)).toBe(false);
    });

    test('financial projekta uključuje razni nalog (== Σ redova)', () => {
        const ov = buildProjectOverview({ project: baseProject(), workOrders: [razniWO()], workLogs: [razniLog] });
        expect(ov.financial.profit).toBe(500 - 120 - 30 - 180);
        expect(ov.financial.other).toBe(30);
    });
});

describe('buildMiscOverview — razni bez projekta', () => {
    test('sabira Zadaci bez projekta; formula ista', () => {
        const misc = buildMiscOverview({
            workOrders: [{
                Work_Order_ID: 'WOZ', Work_Order_Number: 'Z1', Status: 'U toku', Work_Order_Type: 'Zadaci',
                items: [{ ID: 'M1', Product_ID: 'custom-x', Product_Name: 'Popravka', Project_ID: '', Item_Type: 'custom', Quantity: 1, Product_Value: 300, Material_Cost: 50, Other_Costs: 20, Status: 'U toku' }],
            }],
            workLogs: [{ Work_Order_Item_ID: 'M1', Worker_ID: 'W1', Daily_Rate: 100, Day_Fraction: 1, Date: '2026-07-01' }],
        });
        expect(misc.orderCount).toBe(1);
        expect(misc.taskCount).toBe(1);
        expect(misc.financial.profit).toBe(300 - 50 - 20 - 100);   // 130
        expect(misc.workerDays).toBe(1);
    });

    test('razni SA projektom se NE broji u globalne', () => {
        const misc = buildMiscOverview({
            workOrders: [{
                Work_Order_ID: 'WOZ', Work_Order_Number: 'Z1', Status: 'U toku', Work_Order_Type: 'Zadaci',
                items: [{ ID: 'M1', Product_ID: 'custom-x', Project_ID: 'P1', Item_Type: 'custom', Quantity: 1, Product_Value: 300, Status: 'U toku' }],
            }],
            workLogs: [],
        });
        expect(misc.orderCount).toBe(0);
    });

    test('vezani custom zadatak (Linked_Item_ID) se isključuje', () => {
        const misc = buildMiscOverview({
            workOrders: [{
                Work_Order_ID: 'WOZ', Work_Order_Number: 'Z1', Status: 'U toku', Work_Order_Type: 'Zadaci',
                items: [{ ID: 'M1', Product_ID: 'custom-x', Project_ID: '', Item_Type: 'custom', Linked_Item_ID: 'PROD-1', Quantity: 1, Product_Value: 0, Status: 'U toku' }],
            }],
            workLogs: [],
        });
        expect(misc.orderCount).toBe(0);
    });
});
