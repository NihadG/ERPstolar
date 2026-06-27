import {
    aggregateProducts, aggregateProjects, planVsActual, aggregateWorkers,
    weeklyLaborTrend, computeKpis, mondayOf, laborByItem,
    type AItem, type ALog,
} from '../analytics';

const items: AItem[] = [
    { ID: 'A1', Product_Name: 'Ormar', Project_ID: 'P1', Project_Name: 'Kuhinja', Product_Value: 1000, Material_Cost: 300, Services_Total: 70, Transport_Share: 40, Planned_Labor_Cost: 200, Work_Order_ID: 'WO1', Status: 'U toku' },
    { ID: 'A2', Product_Name: 'Pult', Project_ID: 'P1', Project_Name: 'Kuhinja', Product_Value: 600, Material_Cost: 150, Planned_Labor_Cost: 100, Work_Order_ID: 'WO1', Status: 'Završeno' },
    { ID: 'B1', Product_Name: 'Vrata', Project_ID: 'P2', Project_Name: 'Hotel', Product_Value: 800, Material_Cost: 200, Planned_Labor_Cost: 300, Work_Order_ID: 'WO2', Status: 'U toku' },
];

const logs: ALog[] = [
    { Date: '2026-06-22', Worker_ID: 'M', Worker_Name: 'Marko', Daily_Rate: 65, Work_Order_Item_ID: 'A1' },
    { Date: '2026-06-22', Worker_ID: 'M', Worker_Name: 'Marko', Daily_Rate: 65, Work_Order_Item_ID: 'B1' },
    { Date: '2026-06-23', Worker_ID: 'M', Worker_Name: 'Marko', Daily_Rate: 130, Work_Order_Item_ID: 'A1' },
    { Date: '2026-06-22', Worker_ID: 'I', Worker_Name: 'Ivan', Daily_Rate: 100, Work_Order_Item_ID: 'A2' },
];

describe('laborByItem', () => {
    test('Σ Daily_Rate po proizvodu (kumulativno)', () => {
        const m = laborByItem(logs);
        expect(m.get('A1')).toBe(195);
        expect(m.get('B1')).toBe(65);
        expect(m.get('A2')).toBe(100);
    });
});

describe('aggregateProducts — profit = prodaja − materijal − rad − usluge − transport', () => {
    test('po proizvodu tačno', () => {
        const p = aggregateProducts(items, logs);
        const a1 = p.find(x => x.itemId === 'A1')!;
        expect(a1.labor).toBe(195);
        expect(a1.profit).toBe(1000 - 300 - 195 - 70 - 40); // 395
        expect(a1.margin).toBe(39.5);
        const b1 = p.find(x => x.itemId === 'B1')!;
        expect(b1.profit).toBe(800 - 200 - 65); // 535
    });
});

describe('aggregateProjects + INVARIJANTA (Σ proizvod == projekt == KPI)', () => {
    test('profit projekta = zbir proizvoda projekta', () => {
        const projects = aggregateProjects(items, logs);
        const p1 = projects.find(x => x.projectId === 'P1')!;
        expect(p1.revenue).toBe(1600);
        expect(p1.profit).toBe(745);            // 395 + 350
        expect(p1.margin).toBe(46.56);
        expect(p1.productCount).toBe(2);
    });

    test('Σ profit projekata == Σ profit proizvoda == KPI profit (1280)', () => {
        const products = aggregateProducts(items, logs);
        const projects = aggregateProjects(items, logs);
        const kpis = computeKpis(products);
        const sumProducts = Math.round(products.reduce((s, p) => s + p.profit, 0) * 100) / 100;
        const sumProjects = Math.round(projects.reduce((s, p) => s + p.profit, 0) * 100) / 100;
        expect(sumProducts).toBe(1280);
        expect(sumProjects).toBe(1280);
        expect(kpis.profit).toBe(1280);
        expect(kpis.revenue).toBe(2400);
    });
});

describe('planVsActual — plan (ponuda) vs stvarno', () => {
    test('ukupno: variance = Σplan − Σstvarno', () => {
        const { total } = planVsActual(items, logs);
        expect(total.plannedLabor).toBe(600);   // 200+100+300
        expect(total.actualLabor).toBe(360);     // 195+100+65
        expect(total.variance).toBe(240);        // ušteda
    });
    test('po projektu', () => {
        const { byProject } = planVsActual(items, logs);
        const p1 = byProject.find(r => r.projectId === 'P1')!;
        expect(p1.plannedLabor).toBe(300);
        expect(p1.actualLabor).toBe(295);
        expect(p1.variance).toBe(5);
        const p2 = byProject.find(r => r.projectId === 'P2')!;
        expect(p2.variance).toBe(235);           // plan 300 − stvarno 65
    });
});

describe('aggregateWorkers — UNIQUE dani + period', () => {
    test('multi-proizvod dan = 1 dan; zarada = Σ; prosj. dnevnica', () => {
        const w = aggregateWorkers(logs);
        const marko = w.find(x => x.workerId === 'M')!;
        expect(marko.days).toBe(2);              // 22 (2 loga) + 23 → 2 dana, ne 3
        expect(marko.earnings).toBe(260);        // 65+65+130
        expect(marko.avgRate).toBe(130);         // 260/2
        expect(marko.products).toBe(2);          // A1, B1
        const ivan = w.find(x => x.workerId === 'I')!;
        expect(ivan.days).toBe(1);
        expect(ivan.earnings).toBe(100);
    });
    test('filter po periodu (samo 23.)', () => {
        const w = aggregateWorkers(logs, { from: '2026-06-23' });
        expect(w).toHaveLength(1);
        expect(w[0].workerId).toBe('M');
        expect(w[0].earnings).toBe(130);
        expect(w[0].days).toBe(1);
    });
});

describe('weeklyLaborTrend + mondayOf', () => {
    test('mondayOf vraća ponedjeljak sedmice', () => {
        expect(mondayOf('2026-06-22')).toBe('2026-06-22'); // pon
        expect(mondayOf('2026-06-23')).toBe('2026-06-22'); // uto → pon
        expect(mondayOf('2026-06-21')).toBe('2026-06-15'); // ned → prošli pon
    });
    test('grupisanje po sedmici (Σ rada)', () => {
        const t = weeklyLaborTrend(logs);
        expect(t).toHaveLength(1);
        expect(t[0].weekStart).toBe('2026-06-22');
        expect(t[0].labor).toBe(360);            // 65+65+130+100
    });
});
