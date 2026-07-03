import { computeMonthlyPayroll, payrollToCSV } from '../payroll';

// Kalendarsko sidro: juni 2026 — 2026-06-06 i 2026-06-20 su subote, 2026-06-22 ponedjeljak.
const workers = [
    { Worker_ID: 'W1', Name: 'Amir', Status: 'Aktivan' },
    { Worker_ID: 'W2', Name: 'Beno', Status: 'Aktivan' },
    { Worker_ID: 'W3', Name: 'Cazim', Status: 'Obrisan' },
];

describe('computeMonthlyPayroll — osnovni obračun', () => {
    test('dani po statusu, subote, dnevnice iz logova', () => {
        const attendance = [
            { Worker_ID: 'W1', Date: '2026-06-22', Status: 'Prisutan' },
            { Worker_ID: 'W1', Date: '2026-06-23', Status: 'Prisutan' },
            { Worker_ID: 'W1', Date: '2026-06-20', Status: 'Prisutan' },  // subota
            { Worker_ID: 'W1', Date: '2026-06-24', Status: 'Bolovanje' },
            { Worker_ID: 'W1', Date: '2026-06-25', Status: 'Teren' },
            { Worker_ID: 'W1', Date: '2026-07-01', Status: 'Prisutan' },  // drugi mjesec — ne broji se
        ];
        const logs = [
            // 22.06: cijeli dan podijeljen na 2 proizvoda
            { Worker_ID: 'W1', Date: '2026-06-22', Daily_Rate: 32.5, Day_Fraction: 0.5 },
            { Worker_ID: 'W1', Date: '2026-06-22', Daily_Rate: 32.5, Day_Fraction: 0.5 },
            // 23.06: pola dana
            { Worker_ID: 'W1', Date: '2026-06-23', Daily_Rate: 32.5, Day_Fraction: 0.5 },
            // 20.06 (subota): cijeli dan
            { Worker_ID: 'W1', Date: '2026-06-20', Daily_Rate: 65, Day_Fraction: 1 },
            // 25.06 (teren): cijeli dan
            { Worker_ID: 'W1', Date: '2026-06-25', Daily_Rate: 65, Day_Fraction: 1 },
        ];
        const p = computeMonthlyPayroll(2026, 6, attendance, logs, workers);
        const w1 = p.rows.find(r => r.workerId === 'W1')!;
        expect(w1.daysByStatus['Prisutan']).toBe(3);
        expect(w1.daysByStatus['Teren']).toBe(1);
        expect(w1.daysByStatus['Bolovanje']).toBe(1);
        expect(w1.presentDays).toBe(4);        // 3 prisutan + 1 teren (bez julskog)
        expect(w1.saturdaysWorked).toBe(1);    // 20.06
        expect(w1.bookedDays).toBe(3.5);       // 1 + 0.5 + 1 + 1
        expect(w1.totalPay).toBe(227.5);       // 65 + 32.5 + 65 + 65
        expect(w1.unbookedPresentDays).toBe(0);
    });

    test('invarijanta: Σ dnevnica radnika = dnevnica × prisutnost (podjela ne mijenja sumu)', () => {
        // Dan podijeljen na 3 proizvoda (65 KM → 21.67+21.67+21.66)
        const logs = [
            { Worker_ID: 'W1', Date: '2026-06-22', Daily_Rate: 21.67, Day_Fraction: 1 / 3 },
            { Worker_ID: 'W1', Date: '2026-06-22', Daily_Rate: 21.67, Day_Fraction: 1 / 3 },
            { Worker_ID: 'W1', Date: '2026-06-22', Daily_Rate: 21.66, Day_Fraction: 1 / 3 },
        ];
        const p = computeMonthlyPayroll(2026, 6, [], logs, workers);
        expect(p.rows.find(r => r.workerId === 'W1')!.totalPay).toBe(65);
    });
});

describe('computeMonthlyPayroll — promjena dnevnice sred mjeseca (Daily_Rate_History)', () => {
    test('obračun sabira ono što je knjiženo — stara cijena prije, nova poslije', () => {
        // effectiveDailyRate je već primijenjen pri knjiženju: logovi nose tačne iznose.
        const logs = [
            { Worker_ID: 'W1', Date: '2026-06-10', Daily_Rate: 60, Day_Fraction: 1 },  // stara dnevnica
            { Worker_ID: 'W1', Date: '2026-06-25', Daily_Rate: 70, Day_Fraction: 1 },  // nova dnevnica
        ];
        const p = computeMonthlyPayroll(2026, 6, [], logs, workers);
        expect(p.rows.find(r => r.workerId === 'W1')!.totalPay).toBe(130);
    });
});

describe('computeMonthlyPayroll — soft-obrisan radnik', () => {
    test('obrisan radnik s podacima u mjesecu SE prikazuje (istorija plate ne nestaje)', () => {
        const logs = [{ Worker_ID: 'W3', Worker_Name: 'Cazim', Date: '2026-06-10', Daily_Rate: 50, Day_Fraction: 1 }];
        const p = computeMonthlyPayroll(2026, 6, [], logs, workers);
        const w3 = p.rows.find(r => r.workerId === 'W3');
        expect(w3).toBeDefined();
        expect(w3!.deleted).toBe(true);
        expect(w3!.totalPay).toBe(50);
    });
    test('obrisan radnik BEZ podataka u mjesecu se ne prikazuje', () => {
        const p = computeMonthlyPayroll(2026, 6, [], [], workers);
        expect(p.rows.find(r => r.workerId === 'W3')).toBeUndefined();
        // aktivni bez podataka OSTAJU (vidi se da nisu radili)
        expect(p.rows.find(r => r.workerId === 'W1')).toBeDefined();
    });
});

describe('computeMonthlyPayroll — prisutan bez knjiženja', () => {
    test('brojanje dana prisutnosti bez ijedne dnevnice', () => {
        const attendance = [
            { Worker_ID: 'W2', Date: '2026-06-22', Status: 'Prisutan' },
            { Worker_ID: 'W2', Date: '2026-06-23', Status: 'Prisutan' },
        ];
        const logs = [{ Worker_ID: 'W2', Date: '2026-06-22', Daily_Rate: 65, Day_Fraction: 1 }];
        const p = computeMonthlyPayroll(2026, 6, attendance, logs, workers);
        const w2 = p.rows.find(r => r.workerId === 'W2')!;
        expect(w2.unbookedPresentDays).toBe(1); // 23.06 prisutan, ništa knjiženo
    });
});

describe('computeMonthlyPayroll — totali i CSV', () => {
    test('totalPay = Σ svih redova; CSV sadrži UKUPNO', () => {
        const logs = [
            { Worker_ID: 'W1', Date: '2026-06-22', Daily_Rate: 65, Day_Fraction: 1 },
            { Worker_ID: 'W2', Date: '2026-06-22', Daily_Rate: 55, Day_Fraction: 1 },
        ];
        const p = computeMonthlyPayroll(2026, 6, [], logs, workers);
        expect(p.totalPay).toBe(120);
        const csv = payrollToCSV(p);
        expect(csv).toContain('UKUPNO');
        expect(csv).toContain('120,00');
        expect(csv.split('\r\n').length).toBe(1 + p.rows.length + 1); // header + redovi + total
    });

    test('log bez Day_Fraction broji se kao cijeli dan (legacy)', () => {
        const logs = [{ Worker_ID: 'W1', Date: '2026-06-22', Daily_Rate: 65 }];
        const p = computeMonthlyPayroll(2026, 6, [], logs, workers);
        expect(p.rows.find(r => r.workerId === 'W1')!.bookedDays).toBe(1);
    });
});
