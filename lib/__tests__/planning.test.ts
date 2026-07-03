import { isWorkingDay, workOrderDueDate, workerWorksSaturday, buildSaturdayChecker, plannedVsActualDays, weeklyCapacity } from '../planning';

// Kalendarski sidro (potvrđeno iz aplikacije): 2026-06-22 = ponedjeljak, 21 = nedjelja, 20 = subota.
describe('isWorkingDay', () => {
    test('nedjelja nije radni dan; subota jeste', () => {
        expect(isWorkingDay(new Date('2026-06-21T00:00:00'))).toBe(false); // ned
        expect(isWorkingDay(new Date('2026-06-20T00:00:00'))).toBe(true);  // sub
        expect(isWorkingDay(new Date('2026-06-22T00:00:00'))).toBe(true);  // pon
    });
});

describe('workOrderDueDate — primjer korisnika (2 proizvoda × 2 dana = 4)', () => {
    test('pon + 4 radna dana → čet (pon,uto,sri,čet)', () => {
        expect(workOrderDueDate('2026-06-22', 4)).toBe('2026-06-25');
    });
    test('pet + 4 radna dana → uto (pet,sub,[ned],pon,uto)', () => {
        expect(workOrderDueDate('2026-06-26', 4)).toBe('2026-06-30');
    });
});

describe('workOrderDueDate — rubni slučajevi', () => {
    test('1 dan = isti dan ako je radni', () => {
        expect(workOrderDueDate('2026-06-22', 1)).toBe('2026-06-22'); // pon
        expect(workOrderDueDate('2026-06-20', 1)).toBe('2026-06-20'); // sub (radni)
    });
    test('start na nedjelju → pomakne na ponedjeljak', () => {
        expect(workOrderDueDate('2026-06-21', 1)).toBe('2026-06-22'); // ned → pon
    });
    test('0 ili negativno trajanje → prvi radni dan od starta', () => {
        expect(workOrderDueDate('2026-06-22', 0)).toBe('2026-06-22');
        expect(workOrderDueDate('2026-06-21', 0)).toBe('2026-06-22'); // ned → pon
    });
    test('preskače sve nedjelje u rasponu', () => {
        // pon + 7 radnih dana: pon,uto,sri,čet,pet,sub,[ned preskoči],pon → sljedeći pon
        expect(workOrderDueDate('2026-06-22', 7)).toBe('2026-06-29');
    });
});

// Subote u junu/julu 2026: 06-20, 06-27, 07-04, 07-11
describe('workerWorksSaturday — alternacija iz šihtarice', () => {
    test('radio prošlu subotu → narednu NE radi, pa opet radi (alternira)', () => {
        const att = [{ Worker_ID: 'W1', Date: '2026-06-20', Status: 'Prisutan' }];
        expect(workerWorksSaturday('W1', '2026-06-27', att)).toBe(false); // +1 sedmica
        expect(workerWorksSaturday('W1', '2026-07-04', att)).toBe(true);  // +2 sedmice
        expect(workerWorksSaturday('W1', '2026-07-11', att)).toBe(false); // +3 sedmice
    });
    test('bio slobodan (Vikend) prošlu subotu → narednu RADI', () => {
        const att = [{ Worker_ID: 'W1', Date: '2026-06-20', Status: 'Vikend' }];
        expect(workerWorksSaturday('W1', '2026-06-27', att)).toBe(true);
    });
    test('nema istorije → pretpostavi da radi', () => {
        expect(workerWorksSaturday('W2', '2026-06-27', [])).toBe(true);
    });
});

describe('buildSaturdayChecker + rok (multi-worker: subota radna ako bar jedan radi)', () => {
    test('jedan radnik koji je radio 20. → subota 27. nije radna za njega', () => {
        const att = [{ Worker_ID: 'W1', Date: '2026-06-20', Status: 'Prisutan' }];
        const checker = buildSaturdayChecker(['W1'], att);
        expect(checker(new Date('2026-06-27T00:00:00'))).toBe(false);
        expect(checker(new Date('2026-07-04T00:00:00'))).toBe(true);
    });
    test('dva radnika u kontrafazi → subota je radna (bar jedan radi)', () => {
        const att = [
            { Worker_ID: 'W1', Date: '2026-06-20', Status: 'Prisutan' }, // 27. ne radi
            { Worker_ID: 'W2', Date: '2026-06-20', Status: 'Vikend' },   // 27. radi
        ];
        const checker = buildSaturdayChecker(['W1', 'W2'], att);
        expect(checker(new Date('2026-06-27T00:00:00'))).toBe(true);
    });
    test('rok preskače subotu koju radnik ne radi', () => {
        const att = [{ Worker_ID: 'W1', Date: '2026-06-20', Status: 'Prisutan' }]; // 27. ne radi
        const checker = buildSaturdayChecker(['W1'], att);
        // pet 26 + 4 dana: pet(1),[sub 27 ne radi],[ned],pon 29(2),uto 30(3),sri 07-01(4)
        expect(workOrderDueDate('2026-06-26', 4, checker)).toBe('2026-07-01');
    });
    test('bez dodijeljenih radnika → subota radna (shop-level)', () => {
        const checker = buildSaturdayChecker([], []);
        expect(workOrderDueDate('2026-06-26', 4, checker)).toBe('2026-06-30');
    });
});

describe('plannedVsActualDays — planirani vs potrošeni radnik-dani', () => {
    test('planirano = dani × radnici po stavci (default 1 radnik)', () => {
        const items = [
            { ID: 'i1', Planned_Labor_Days: 2, Planned_Labor_Workers: 2 }, // 4 radnik-dana
            { ID: 'i2', Planned_Labor_Days: 3 },                           // 3 radnik-dana
        ];
        expect(plannedVsActualDays(items).planned).toBe(7);
    });
    test('potrošeno iz logova = Σ Day_Fraction samo za stavke naloga', () => {
        const items = [{ ID: 'i1', Planned_Labor_Days: 2 }];
        const logs = [
            { Work_Order_Item_ID: 'i1', Day_Fraction: 0.5 },
            { Work_Order_Item_ID: 'i1', Day_Fraction: 1 },
            { Work_Order_Item_ID: 'tudji', Day_Fraction: 1 }, // druga stavka — ne broji se
        ];
        const r = plannedVsActualDays(items, logs);
        expect(r.actual).toBe(1.5);
        expect(r.ratio).toBe(0.75);
    });
    test('bez logova koristi sync-ovani Actual_Labor_Days sa stavki', () => {
        const items = [
            { ID: 'i1', Planned_Labor_Days: 4, Actual_Labor_Days: 3 },
            { ID: 'i2', Actual_Labor_Days: 1.5 },
        ];
        const r = plannedVsActualDays(items);
        expect(r.planned).toBe(4);
        expect(r.actual).toBe(4.5);
        expect(r.ratio).toBe(1.13); // 4.5/4 zaokruženo na 2 decimale
    });
    test('bez plana → ratio je null (nema lažnog prekoračenja)', () => {
        const r = plannedVsActualDays([{ ID: 'i1', Actual_Labor_Days: 2 }]);
        expect(r.planned).toBe(0);
        expect(r.ratio).toBeNull();
    });
    test('log bez Day_Fraction broji se kao cijeli dan (legacy zapisi)', () => {
        const r = plannedVsActualDays([{ ID: 'i1', Planned_Labor_Days: 1 }], [{ Work_Order_Item_ID: 'i1' }]);
        expect(r.actual).toBe(1);
    });
});

describe('weeklyCapacity — raspoloživo vs planirano po sedmici', () => {
    // Sidro: 2026-06-22 = ponedjeljak; subote 06-20 i 06-27.
    test('raspoloživo: 2 radnika × (pon–pet + subota po defaultu) = 12', () => {
        const [wk] = weeklyCapacity('2026-06-22', 1, ['W1', 'W2'], [], []);
        expect(wk.weekStartISO).toBe('2026-06-22');
        expect(wk.available).toBe(12); // 6 radnih dana × 2
        expect(wk.planned).toBe(0);
    });
    test('subotnja rotacija smanjuje raspoloživo', () => {
        // W1 radio subotu 20.06 → 27.06 NE radi
        const att = [{ Worker_ID: 'W1', Date: '2026-06-20', Status: 'Prisutan' }];
        const [wk] = weeklyCapacity('2026-06-22', 1, ['W1'], att, []);
        expect(wk.available).toBe(5); // pon–pet, bez subote
    });
    test('budući unos u šihtarici ima prednost (Odmor oduzima dan)', () => {
        const att = [{ Worker_ID: 'W1', Date: '2026-06-24', Status: 'Odmor' }];
        const [wk] = weeklyCapacity('2026-06-22', 1, ['W1'], att, []);
        expect(wk.available).toBe(5); // 6 − 1 (srijeda odmor)
    });
    test('planirano: preostali dani naloga ravnomjerno po rasponu', () => {
        // Nalog: 6 preostalih radnik-dana, raspon pon 22.06 – sub 27.06 (6 radnih dana) → 1/dan
        const orders = [{ id: 'o1', startISO: '2026-06-22', endISO: '2026-06-27', remainingWorkerDays: 6 }];
        const [wk1, wk2] = weeklyCapacity('2026-06-22', 2, ['W1'], [], orders);
        expect(wk1.planned).toBe(6);
        expect(wk2.planned).toBe(0);
    });
    test('nalog s prekoračenim rokom pada u tekuću sedmicu (od danas)', () => {
        const orders = [{ id: 'o1', startISO: '2026-06-01', endISO: '2026-06-10', remainingWorkerDays: 4 }];
        const [wk] = weeklyCapacity('2026-06-22', 1, ['W1'], [], orders);
        expect(wk.planned).toBe(4); // sabijeno na start (= fromISO jer je rok prošao)
    });
    test('ratio = planned/available; prebukirana sedmica > 1', () => {
        const orders = [{ id: 'o1', startISO: '2026-06-22', endISO: '2026-06-27', remainingWorkerDays: 9 }];
        const [wk] = weeklyCapacity('2026-06-22', 1, ['W1'], [], orders);
        expect(wk.available).toBe(6);
        expect(wk.planned).toBe(9);
        expect(wk.ratio).toBe(1.5);
    });
});
