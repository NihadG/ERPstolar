import { isWorkingDay, workOrderDueDate, workerWorksSaturday, buildSaturdayChecker } from '../planning';

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
