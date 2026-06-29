import {
    aggregateProductRows, aggregateProjects, planVsActual, aggregateWorkers,
    weeklyLaborTrend, computeKpis, mondayOf,
    type ProductInput, type ALog,
} from '../analytics';

// Po proizvodu: stvarno (živi materijal + stvarni rad) i planirano (iz ponude).
const inputs: ProductInput[] = [
    { itemId: 'IA', productId: 'PA', productName: 'Ormar', projectId: 'P1', projectName: 'Kuhinja', woId: 'WO1', woNumber: '1', woType: '', status: 'U toku',
        selling: 1000, liveMaterial: 350, plannedMaterial: 300, actualLabor: 195, plannedLabor: 200, services: 70, transport: 40 },
    { itemId: 'IB', productId: 'PB', productName: 'Pult', projectId: 'P1', projectName: 'Kuhinja', woId: 'WO1', woNumber: '1', woType: '', status: 'Završeno',
        selling: 600, liveMaterial: 180, plannedMaterial: 150, actualLabor: 100, plannedLabor: 100, services: 0, transport: 0 },
    { itemId: 'IC', productId: 'PC', productName: 'Vrata', projectId: 'P2', projectName: 'Hotel', woId: 'WO2', woNumber: '2', woType: '', status: 'U toku',
        selling: 800, liveMaterial: 200, plannedMaterial: 200, actualLabor: 65, plannedLabor: 300, services: 0, transport: 0 },
];

describe('aggregateProductRows — STVARNI profit (živi mat + stvarni rad) + PLANIRANI (ponuda)', () => {
    test('po proizvodu tačno', () => {
        const r = aggregateProductRows(inputs);
        const a = r.find(x => x.productId === 'PA')!;
        expect(a.material).toBe(350);
        expect(a.labor).toBe(195);
        expect(a.profit).toBe(1000 - 350 - 195 - 70 - 40);        // 345 (stvarno)
        expect(a.plannedProfit).toBe(1000 - 300 - 200 - 70 - 40);  // 390 (plan)
        const c = r.find(x => x.productId === 'PC')!;
        expect(c.profit).toBe(800 - 200 - 65);                     // 535 (malo rada → visok stvarni)
        expect(c.plannedProfit).toBe(800 - 200 - 300);             // 300 (plan računa puni rad)
    });
});

describe('aggregateProjects + INVARIJANTA (Σ proizvod == projekt == KPI)', () => {
    test('profit projekta = zbir proizvoda', () => {
        const rows = aggregateProductRows(inputs);
        const projects = aggregateProjects(rows);
        const p1 = projects.find(x => x.projectId === 'P1')!;
        expect(p1.revenue).toBe(1600);
        expect(p1.profit).toBe(665);            // 345 + 320
        expect(p1.plannedProfit).toBe(740);     // 390 + 350
        expect(p1.margin).toBe(41.56);
    });
    test('Σ profit == 1200 (stvarno); Σ planirani == 1040', () => {
        const rows = aggregateProductRows(inputs);
        const k = computeKpis(rows);
        expect(k.profit).toBe(1200);
        expect(k.plannedProfit).toBe(1040);
        const projects = aggregateProjects(rows);
        expect(Math.round(projects.reduce((s, p) => s + p.profit, 0) * 100) / 100).toBe(1200);
    });
});

describe('montaža/teren = ne-prihodovni (#7): samo trošak rada, ne kvari prihod', () => {
    const withMontaza: ProductInput[] = [
        ...inputs,
        { itemId: 'IM', productId: 'PM', productName: 'Teren Begić', projectId: '', projectName: '—', woId: 'WO3', woNumber: '3', woType: 'Montaža', status: 'U toku',
            selling: 0, liveMaterial: 0, plannedMaterial: 0, actualLabor: 100, plannedLabor: 0, services: 0, transport: 0 },
    ];
    test('montaža red: nonRevenue=true, profit = −rad, margin 0', () => {
        const r = aggregateProductRows(withMontaza);
        const m = r.find(x => x.productId === 'PM')!;
        expect(m.nonRevenue).toBe(true);
        expect(m.profit).toBe(-100);
        expect(m.margin).toBe(0);
        const a = r.find(x => x.productId === 'PA')!;
        expect(a.nonRevenue).toBe(false);
    });
    test('KPI: prihod nepromijenjen, montažaLabor izdvojen, profit uključuje trošak', () => {
        const k = computeKpis(aggregateProductRows(withMontaza));
        expect(k.revenue).toBe(2400);          // 1000+600+800 (montaža 0 ne diže prihod)
        expect(k.montazaLabor).toBe(100);
        expect(k.profit).toBe(1100);           // 1200 − 100 (trošak montaže ispravno smanjuje profit)
    });
});

describe('planVsActual — MATERIJAL i RAD, plan (ponuda) vs stvarno', () => {
    const rows = aggregateProductRows(inputs);
    test('ukupno: materijal poskupio, rad ispod plana', () => {
        const { total } = planVsActual(rows);
        // materijal: plan 650, stvarno 730 → prekoračenje 80
        expect(total.material.planned).toBe(650);
        expect(total.material.actual).toBe(730);
        expect(total.material.variance).toBe(-80);
        // rad: plan 600, stvarno 360 → ušteda 240
        expect(total.labor.planned).toBe(600);
        expect(total.labor.actual).toBe(360);
        expect(total.labor.variance).toBe(240);
    });
    test('accuracy ("koliko potrefio") = 100 − |odstupanje%|', () => {
        const { total } = planVsActual(rows);
        expect(total.material.accuracyPct).toBe(87.69);   // 100 − 12.31
        expect(total.labor.accuracyPct).toBe(60);          // 100 − 40
    });
    test('po projektu', () => {
        const { byProject } = planVsActual(rows);
        const p1 = byProject.find(r => r.projectId === 'P1')!;
        expect(p1.material.variance).toBe(-80);            // plan 450 − stvarno 530
        expect(p1.labor.variance).toBe(5);                 // plan 300 − stvarno 295
        const p2 = byProject.find(r => r.projectId === 'P2')!;
        expect(p2.material.variance).toBe(0);
        expect(p2.labor.variance).toBe(235);
    });
});

// ── Radnici / trend (nepromijenjeno) ─────────────────────────────────────────
const logs: ALog[] = [
    { Date: '2026-06-22', Worker_ID: 'M', Worker_Name: 'Marko', Daily_Rate: 65, Work_Order_Item_ID: 'A1' },
    { Date: '2026-06-22', Worker_ID: 'M', Worker_Name: 'Marko', Daily_Rate: 65, Work_Order_Item_ID: 'B1' },
    { Date: '2026-06-23', Worker_ID: 'M', Worker_Name: 'Marko', Daily_Rate: 130, Work_Order_Item_ID: 'A1' },
    { Date: '2026-06-22', Worker_ID: 'I', Worker_Name: 'Ivan', Daily_Rate: 100, Work_Order_Item_ID: 'A2' },
];

describe('aggregateWorkers — UNIQUE dani + period', () => {
    test('multi-proizvod dan = 1 dan; zarada = Σ', () => {
        const w = aggregateWorkers(logs);
        const marko = w.find(x => x.workerId === 'M')!;
        expect(marko.days).toBe(2);
        expect(marko.earnings).toBe(260);
        expect(marko.avgRate).toBe(130);
        expect(marko.products).toBe(2);
    });
    test('filter po periodu (samo 23.)', () => {
        const w = aggregateWorkers(logs, { from: '2026-06-23' });
        expect(w).toHaveLength(1);
        expect(w[0].earnings).toBe(130);
    });
});

describe('weeklyLaborTrend + mondayOf', () => {
    test('mondayOf', () => {
        expect(mondayOf('2026-06-23')).toBe('2026-06-22');
        expect(mondayOf('2026-06-21')).toBe('2026-06-15');
    });
    test('grupisanje po sedmici', () => {
        const t = weeklyLaborTrend(logs);
        expect(t).toHaveLength(1);
        expect(t[0].labor).toBe(360);
    });
});
