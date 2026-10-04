import {
    computeAnalytics, computeAnalyticsFinance, aggregateWorkers, razniSummary, weeklyLaborTrend, mondayOf, projectInScope,
    type AnalyticsInput,
} from '../analytics';
import { computeMonthlyPayroll } from '../payroll';

// ── Fiksture: dva projekta, završeni / u izradi / nezapočeti proizvodi ──────────
const input = (): AnalyticsInput => ({
    projects: [
        {
            Project_ID: 'P1', Name: 'Kuća', Client_Name: 'Jerko', Status: 'U proizvodnji',
            products: [
                { Product_ID: 'A', Project_ID: 'P1', Name: 'Ormar A', Quantity: 1, Status: 'Spremno', materials: [{ Total_Price: 300 }] },
                { Product_ID: 'B', Project_ID: 'P1', Name: 'Ormar B', Quantity: 1, Status: 'Spremno', materials: [{ Total_Price: 200 }] },
                { Product_ID: 'C', Project_ID: 'P1', Name: 'Kuhinja', Quantity: 1, Status: 'Sklapanje', materials: [{ Total_Price: 500 }] },
                { Product_ID: 'D', Project_ID: 'P1', Name: 'Vrata', Quantity: 1, Status: 'Na čekanju', materials: [] },
            ],
        },
        {
            Project_ID: 'P2', Name: 'Stan', Client_Name: 'Meliha', Status: 'Završeno',
            products: [{ Product_ID: 'E', Project_ID: 'P2', Name: 'Garderoba', Quantity: 1, Status: 'Instalirano', materials: [{ Total_Price: 100 }] }],
        },
    ],
    offers: [
        {
            Offer_ID: 'O1', Project_ID: 'P1', Offer_Number: 'P-1', Status: 'Prihvaćeno', Accepted_Date: '2026-07-01',
            products: [
                { Product_ID: 'A', Included: true, Quantity: 1, Selling_Price: 1000, Total_Price: 1000, Material_Cost: 280, Labor_Workers: 1, Labor_Days: 2, Labor_Daily_Rate: 100 },
                { Product_ID: 'B', Included: true, Quantity: 1, Selling_Price: 800, Total_Price: 800, Material_Cost: 200, extras: [{ Total: 50 }] },
                { Product_ID: 'C', Included: true, Quantity: 1, Selling_Price: 2000, Total_Price: 2000, Labor_Workers: 2, Labor_Days: 3, Labor_Daily_Rate: 100 },
                { Product_ID: 'D', Included: true, Quantity: 1, Selling_Price: 600, Total_Price: 600 },
            ],
        },
        {
            Offer_ID: 'O2', Project_ID: 'P2', Offer_Number: 'P-2', Status: 'Prihvaćeno', Accepted_Date: '2026-06-01',
            products: [{ Product_ID: 'E', Included: true, Quantity: 1, Selling_Price: 500, Total_Price: 500 }],
        },
    ],
    workOrders: [
        { Work_Order_ID: 'W1', Work_Order_Number: '1', Status: 'Završeno', Work_Order_Type: 'Proizvodnja', items: [
            { ID: 'a', Product_ID: 'A', Project_ID: 'P1', Quantity: 1, Status: 'Završeno', Completed_At: '2026-09-10T08:00:00Z' },
            { ID: 'b', Product_ID: 'B', Project_ID: 'P1', Quantity: 1, Status: 'Završeno', Completed_At: '2026-10-02T08:00:00Z' },
        ] },
        { Work_Order_ID: 'W2', Work_Order_Number: '2', Status: 'U toku', Work_Order_Type: 'Proizvodnja', items: [
            { ID: 'c', Product_ID: 'C', Project_ID: 'P1', Quantity: 1, Status: 'U toku' },
        ] },
        { Work_Order_ID: 'W3', Work_Order_Number: '3', Status: 'Završeno', Work_Order_Type: 'Proizvodnja', items: [
            { ID: 'e', Product_ID: 'E', Project_ID: 'P2', Quantity: 1, Status: 'Završeno', Completed_At: '2026-08-20T08:00:00Z' },
        ] },
        { Work_Order_ID: 'Z', Work_Order_Number: 'Z1', Status: 'U toku', Work_Order_Type: 'Zadaci', items: [
            { ID: 'z', Item_Type: 'custom', Product_ID: 'custom-1', Project_ID: '', Quantity: 1, Product_Value: 0, Other_Costs: 20, Status: 'U toku' },
        ] },
    ],
    logs: [
        { Work_Order_Item_ID: 'a', Product_ID: 'A', Worker_ID: 'W1', Worker_Name: 'Emrah', Daily_Rate: 130, Day_Fraction: 1, Date: '2026-09-08' },
        { Work_Order_Item_ID: 'b', Product_ID: 'B', Worker_ID: 'W1', Worker_Name: 'Emrah', Daily_Rate: 65, Day_Fraction: 0.5, Date: '2026-10-01' },
        { Work_Order_Item_ID: 'c', Product_ID: 'C', Worker_ID: 'W1', Worker_Name: 'Emrah', Daily_Rate: 65, Day_Fraction: 0.5, Date: '2026-10-01' },
        { Work_Order_Item_ID: 'e', Product_ID: 'E', Worker_ID: 'W2', Worker_Name: 'Ahmad', Daily_Rate: 130, Day_Fraction: 1, Date: '2026-08-19' },
        { Work_Order_Item_ID: 'z', Product_ID: 'custom-1', Worker_ID: 'W2', Worker_Name: 'Ahmad', Daily_Rate: 130, Day_Fraction: 1, Date: '2026-10-02' },
        // Obrisan nalog — nulirano, ne broji se nigdje:
        { Work_Order_ID: 'OBRISAN', Work_Order_Item_ID: 'x', Product_ID: 'A', Worker_ID: 'W1', Worker_Name: 'Emrah', Daily_Rate: 130, Day_Fraction: 1, Date: '2026-09-09', Work_Order_Deleted: true },
    ],
    attendance: [
        { Worker_ID: 'W1', Date: '2026-09-08', Status: 'Prisutan' },
        { Worker_ID: 'W1', Date: '2026-09-09', Status: 'Prisutan' },   // samo obrisan nalog → bez dnevnice
        { Worker_ID: 'W1', Date: '2026-10-01', Status: 'Prisutan' },
        { Worker_ID: 'W2', Date: '2026-08-19', Status: 'Teren' },
        { Worker_ID: 'W2', Date: '2026-10-02', Status: 'Prisutan' },
        { Worker_ID: 'W2', Date: '2026-10-03', Status: 'Odsutan' },
    ],
    workers: [{ Worker_ID: 'W1', Name: 'Emrah Gluhić' }, { Worker_ID: 'W2', Name: 'Ahmad Al-Masaud' }],
});

describe('computeAnalytics — profit = završeni proizvodi (ponuda − materijal − rad)', () => {
    const all = computeAnalytics(input(), { scope: 'all' });

    test('KPI: samo završeni proizvodi ulaze u profit', () => {
        // A: 1000 − 300 − 130 = 570 · B: 800 − (200 + 50) − 65 = 485 · E: 500 − 100 − 130 = 270
        expect(all.kpis.realized.count).toBe(3);
        expect(all.kpis.realized.revenue).toBe(2300);
        expect(all.kpis.profit).toBe(570 + 485 + 270);
        expect(all.kpis.inProgress.count).toBe(1);
        expect(all.kpis.inProgress.labor).toBe(65);
        expect(all.kpis.notStartedCount).toBe(1);
        expect(all.kpis.contracted).toBe(4900);
    });

    test('INVARIJANTA: Σ projekata == KPI == isti proračun kao kartica projekta', () => {
        const sum = all.projects.reduce((s, p) => s + p.profit, 0);
        expect(Math.round(sum * 100) / 100).toBe(all.kpis.profit);
        const finance = computeAnalyticsFinance(input());
        for (const p of all.projects) expect(p.profit).toBe(finance.get(p.projectId)!.profit);
    });

    test('materijal = živa sastavnica + dodaci iz ponude', () => {
        const b = all.products.find(p => p.productId === 'B')!;
        expect(b.materialBom).toBe(200);
        expect(b.materialExtras).toBe(50);
        expect(b.material).toBe(250);
    });
});

describe('computeAnalytics — period i opseg', () => {
    test('period: ostvareni profit samo za proizvode završene u periodu', () => {
        const oct = computeAnalytics(input(), { scope: 'all', from: '2026-10-01', to: '2026-10-31' });
        expect(oct.kpis.realized.count).toBe(1);          // samo B (2.10.)
        expect(oct.kpis.profit).toBe(485);
        expect(oct.kpis.inProgress.count).toBe(1);        // stanje sada, ne zavisi od perioda
    });

    test('opseg „Aktivni" izbacuje završene projekte; finansije projekta se ne mijenjaju', () => {
        const active = computeAnalytics(input(), { scope: 'active' });
        const all = computeAnalytics(input(), { scope: 'all' });
        expect(active.projects.map(p => p.projectId)).toEqual(['P1']);
        expect(active.projects[0].profit).toBe(all.projects.find(p => p.projectId === 'P1')!.profit);
        expect(projectInScope('Otkazano', 'all')).toBe(false);
    });
});

describe('aggregateWorkers — zarada = Σ živih dnevnica (kao obračun plata)', () => {
    test('opseg projekata NE utiče na zaradu; obrisani nalozi se ne broje', () => {
        const active = computeAnalytics(input(), { scope: 'active' });
        const emrah = active.workers.find(w => w.workerId === 'W1')!;
        expect(emrah.earnings).toBe(260);          // 130 + 65 + 65 (bez 130 s obrisanog naloga)
        expect(emrah.bookedDays).toBe(2);          // 1 + 0.5 + 0.5
        expect(emrah.avgRate).toBe(130);           // zarada / radnik-dani
        expect(emrah.presentDays).toBe(3);
        expect(emrah.unbookedDays).toBe(1);        // 9.9. — rad samo na obrisanom nalogu
        const ahmad = active.workers.find(w => w.workerId === 'W2')!;
        expect(ahmad.earnings).toBe(260);          // i rad na završenom projektu P2 se broji
        expect(ahmad.razniKM).toBe(130);
        expect(ahmad.productsKM).toBe(130);
    });

    test('PARITET s obračunom plata za mjesec', () => {
        const inp = input();
        const rows = aggregateWorkers({ logs: inp.logs, attendance: inp.attendance, workers: inp.workers, workOrders: inp.workOrders, range: { from: '2026-10-01', to: '2026-10-31' } });
        const payroll = computeMonthlyPayroll(2026, 10,
            inp.attendance!.map(a => ({ Worker_ID: a.Worker_ID, Date: a.Date, Status: a.Status })),
            inp.logs.map(l => ({ Worker_ID: l.Worker_ID!, Date: l.Date!, Daily_Rate: l.Daily_Rate, Day_Fraction: l.Day_Fraction, Work_Order_Deleted: l.Work_Order_Deleted })),
            inp.workers!.map(w => ({ Worker_ID: w.Worker_ID, Name: w.Name || '' })));
        for (const r of rows) {
            const p = payroll.rows.find(x => x.workerId === r.workerId)!;
            expect(r.earnings).toBe(p.totalPay);
            expect(r.bookedDays).toBe(p.bookedDays);
            expect(r.unbookedDays).toBe(p.unbookedPresentDays);
        }
    });
});

describe('razni poslovi i provjere', () => {
    test('razni bez projekta: rad po datumu dnevnice, ostali troškovi posla', () => {
        const inp = input();
        const r = razniSummary(inp.workOrders, inp.logs);
        expect(r.labor).toBe(130);
        expect(r.other).toBe(20);
        expect(r.profit).toBe(-150);
        expect(razniSummary(inp.workOrders, inp.logs, { from: '2026-09-01', to: '2026-09-30' }).labor).toBe(0);
    });

    test('proizvod bez prihvaćene ponude ide na listu za provjeru', () => {
        const inp = input();
        inp.offers[0].products = inp.offers[0].products!.filter(p => p.Product_ID !== 'A');
        const d = computeAnalytics(inp, { scope: 'all' });
        expect(d.issues.some(i => i.productId === 'A' && i.kind === 'noOffer')).toBe(true);
        expect(d.kpis.flaggedProducts).toBe(1);
    });
});

describe('weeklyLaborTrend + mondayOf', () => {
    test('mondayOf', () => {
        expect(mondayOf('2026-10-01')).toBe('2026-09-28');
        expect(mondayOf('2026-09-28')).toBe('2026-09-28');
    });
    test('grupisanje po sedmici, bez obrisanih', () => {
        const t = weeklyLaborTrend(input().logs);
        expect(t.find(w => w.weekStart === '2026-09-07')?.labor).toBe(130);
        expect(t.find(w => w.weekStart === '2026-09-28')?.labor).toBe(260);
    });
});
