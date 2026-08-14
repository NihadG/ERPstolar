import { scheduleBatch, type BatchScheduleRow } from '../canvas/batchSchedule';

// 2026-08-10 je PONEDJELJAK. Subota se u testovima NE radi (isSat → false),
// pa niz Pon–Pet ostaje čist i predvidljiv.
const noSat = () => false;
const MON = '2026-08-10';

const row = (id: string, durationDays: number, workerIds: string[] = [], startISO?: string): BatchScheduleRow =>
    ({ id, durationDays, workerIds, startISO });

const byId = (placed: { id: string; startISO: string; endISO: string }[]) =>
    new Map(placed.map(p => [p.id, p]));

describe('scheduleBatch — sequential', () => {
    test('isti radnik: nalozi se nadovezuju bez preklapanja', () => {
        const rows = [row('a', 3, ['w1']), row('b', 2, ['w1'])];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        // a: Pon–Sri (10.–12.)
        expect(p.get('a')).toMatchObject({ startISO: '2026-08-10', endISO: '2026-08-12' });
        // b kreće dan poslije a (Čet 13.), traje 2 dana → Čet–Pet (13.–14.)
        expect(p.get('b')).toMatchObject({ startISO: '2026-08-13', endISO: '2026-08-14' });
    });

    test('različiti radnici teku paralelno', () => {
        const rows = [row('a', 3, ['w1']), row('b', 3, ['w2'])];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')!.startISO).toBe('2026-08-10');
        expect(p.get('b')!.startISO).toBe('2026-08-10');
    });

    test('poštuje već preuzet posao radnika (busyUntil)', () => {
        const busy = new Map([['w1', '2026-08-11']]);   // w1 zauzet do utorka
        const rows = [row('a', 2, ['w1'])];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat, busyUntilByWorker: busy }));
        // kreće u srijedu 12., traje 2 dana → Sri–Čet (12.–13.)
        expect(p.get('a')).toMatchObject({ startISO: '2026-08-12', endISO: '2026-08-13' });
    });

    test('busyUntil prije starta se ignoriše (ne vraća unazad)', () => {
        const busy = new Map([['w1', '2026-08-05']]);   // prije MON
        const p = byId(scheduleBatch([row('a', 1, ['w1'])], 'sequential', { startISO: MON, isSaturdayWorking: noSat, busyUntilByWorker: busy }));
        expect(p.get('a')!.startISO).toBe('2026-08-10');
    });

    test('nedodijeljeni redovi dijele jednu traku (nadovezano)', () => {
        const rows = [row('a', 2, []), row('b', 2, [])];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')!.startISO).toBe('2026-08-10');   // a: Pon–Uto (10.–11.)
        expect(p.get('b')!.startISO).toBe('2026-08-12');   // b kreće Sri (12.)
    });
});

describe('scheduleBatch — parallel', () => {
    test('svi kreću od zadanog datuma', () => {
        const rows = [row('a', 2, ['w1']), row('b', 5, ['w2'])];
        const p = byId(scheduleBatch(rows, 'parallel', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')!.startISO).toBe('2026-08-10');
        expect(p.get('b')!.startISO).toBe('2026-08-10');
        expect(p.get('b')!.endISO).toBe('2026-08-14');     // 5 radnih dana Pon–Pet
    });
});

describe('scheduleBatch — manual', () => {
    test('koristi upisani datum reda; nedjelja se pomjeri na radni dan', () => {
        const rows = [row('a', 1, ['w1'], '2026-08-16')];  // 16.8. je NEDJELJA
        const p = byId(scheduleBatch(rows, 'manual', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')!.startISO).toBe('2026-08-17');   // pomjereno na ponedjeljak
    });

    test('bez upisanog datuma pada na globalni start', () => {
        const p = byId(scheduleBatch([row('a', 1, ['w1'])], 'manual', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')!.startISO).toBe('2026-08-10');
    });
});

// ── Prikovan početak po redu ─────────────────────────────────────────
// Prije ovoga se datum pojedinog naloga mogao mijenjati samo prebacivanjem
// CIJELE tabele u „Ručno". Prikivanje radi u svakom načinu, red po red.

const pinned = (id: string, durationDays: number, workerIds: string[], pinnedISO: string): BatchScheduleRow =>
    ({ id, durationDays, workerIds, pinnedISO });

describe('scheduleBatch — prikovan početak', () => {
    test('sequential: prikovan red ide na svoj datum, ostali se i dalje slažu sami', () => {
        const rows = [
            row('a', 2, ['w1']),                          // auto: Pon–Uto
            pinned('b', 2, ['w1'], '2026-08-20'),         // prikovan na Čet 20.
        ];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')).toMatchObject({ startISO: '2026-08-10', endISO: '2026-08-11' });
        expect(p.get('b')).toMatchObject({ startISO: '2026-08-20', endISO: '2026-08-21' });
    });

    test('sequential: ono što dolazi IZA prikovanog se ne preklapa s njim', () => {
        const rows = [
            pinned('a', 3, ['w1'], '2026-08-17'),         // Pon 17.–Sri 19.
            row('b', 2, ['w1']),                          // mora poslije, ne od 10.
        ];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')).toMatchObject({ startISO: '2026-08-17', endISO: '2026-08-19' });
        expect(p.get('b')!.startISO).toBe('2026-08-20');
        expect(p.get('b')!.startISO > p.get('a')!.endISO).toBe(true);
    });

    test('sequential: prikovan RANIJE ne vraća kursor unazad', () => {
        const rows = [
            row('a', 5, ['w1']),                          // Pon 10.–Pet 14.
            pinned('b', 1, ['w1'], '2026-08-11'),         // prikovan usred a
            row('c', 1, ['w1']),                          // mora poslije a, ne poslije b
        ];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('b')!.startISO).toBe('2026-08-11');
        expect(p.get('c')!.startISO).toBe('2026-08-17');   // poslije kraja a (Pet 14.), Pon 17.
    });

    test('prikivanje jednog reda ne dira drugog radnika', () => {
        const rows = [pinned('a', 2, ['w1'], '2026-08-20'), row('b', 2, ['w2'])];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('b')!.startISO).toBe('2026-08-10');
    });

    test('parallel: prikovan red ne kreće od zajedničkog datuma', () => {
        const rows = [row('a', 2, ['w1']), pinned('b', 2, ['w2'], '2026-08-19')];
        const p = byId(scheduleBatch(rows, 'parallel', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')!.startISO).toBe('2026-08-10');
        expect(p.get('b')!.startISO).toBe('2026-08-19');
    });

    test('manual: prikovan nadjačava startISO reda', () => {
        const rows: BatchScheduleRow[] = [
            { id: 'a', durationDays: 1, workerIds: [], startISO: '2026-08-12', pinnedISO: '2026-08-19' },
        ];
        const p = byId(scheduleBatch(rows, 'manual', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')!.startISO).toBe('2026-08-19');
    });

    test('prikovan na nedjelju pada na prvi radni dan', () => {
        // 2026-08-16 je nedjelja
        const rows = [pinned('a', 1, ['w1'], '2026-08-16')];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')!.startISO).toBe('2026-08-17');
    });

    test('bez prikivanja ponašanje je nepromijenjeno', () => {
        const rows = [row('a', 3, ['w1']), row('b', 2, ['w1'])];
        const p = byId(scheduleBatch(rows, 'sequential', { startISO: MON, isSaturdayWorking: noSat }));
        expect(p.get('a')).toMatchObject({ startISO: '2026-08-10', endISO: '2026-08-12' });
        expect(p.get('b')).toMatchObject({ startISO: '2026-08-13', endISO: '2026-08-14' });
    });
});
