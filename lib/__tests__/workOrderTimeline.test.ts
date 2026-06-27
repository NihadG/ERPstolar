import { buildWorkTimeline, summarizeWorkTimeline, type TimelineLog } from '../workOrderTimeline';

// Sidro: 2026-06-22 = pon, 20/27 = sub, 21 = ned.
const log = (Date: string, Worker_ID: string, Daily_Rate: number, Product_ID = 'P1'): TimelineLog =>
    ({ Date, Worker_ID, Worker_Name: Worker_ID, Daily_Rate, Product_ID });

const dayMap = (days: ReturnType<typeof buildWorkTimeline>) =>
    Object.fromEntries(days.map(d => [d.date, d.dayType]));

describe('buildWorkTimeline — tipovi dana', () => {
    test('prazan nalog: svi dani no_work do danas (bez budućih)', () => {
        const days = buildWorkTimeline({
            logs: [], startedAt: '2026-06-22', today: new Date('2026-06-24T00:00:00'),
        });
        expect(days.map(d => d.date)).toEqual(['2026-06-22', '2026-06-23', '2026-06-24']);
        days.forEach(d => expect(d.dayType).toBe('no_work'));
    });

    test('dan sa zapisom = working (agregat svih proizvoda)', () => {
        const days = buildWorkTimeline({
            logs: [log('2026-06-23', 'M', 80, 'P1'), log('2026-06-23', 'I', 100, 'P2')],
            startedAt: '2026-06-22', today: new Date('2026-06-24T00:00:00'),
        });
        const m = dayMap(days);
        expect(m['2026-06-23']).toBe('working');
        expect(m['2026-06-22']).toBe('no_work');
        const d23 = days.find(d => d.date === '2026-06-23')!;
        expect(d23.dailyLaborCost).toBe(180);
        expect(d23.logs).toHaveLength(2);
    });

    test('rad UNUTAR pauze je i dalje working; pauzirani dani bez rada su paused', () => {
        const days = buildWorkTimeline({
            logs: [log('2026-06-23', 'M', 80)],
            startedAt: '2026-06-22',
            pausePeriods: [{ Started_At: '2026-06-22T00:00:00', Ended_At: '2026-06-25T00:00:00' }],
            today: new Date('2026-06-25T00:00:00'),
        });
        const m = dayMap(days);
        expect(m['2026-06-23']).toBe('working');   // rad pobjeđuje pauzu
        expect(m['2026-06-22']).toBe('paused');
        expect(m['2026-06-24']).toBe('paused');
        expect(m['2026-06-25']).toBe('paused');
    });

    test('praznik i vikend', () => {
        const days = buildWorkTimeline({
            logs: [],
            startedAt: '2026-06-19',           // pet
            holidays: new Set(['2026-06-19']),
            today: new Date('2026-06-22T00:00:00'),
        });
        const m = dayMap(days);
        expect(m['2026-06-19']).toBe('holiday');
        expect(m['2026-06-20']).toBe('weekend');  // sub
        expect(m['2026-06-21']).toBe('weekend');  // ned
        expect(m['2026-06-22']).toBe('no_work');  // pon
    });

    test('budući dani su future (preko extraDates)', () => {
        const days = buildWorkTimeline({
            logs: [], startedAt: '2026-06-22',
            extraDates: new Set(['2026-06-25']),
            today: new Date('2026-06-23T00:00:00'),
        });
        const m = dayMap(days);
        expect(m['2026-06-24']).toBe('future');
        expect(m['2026-06-25']).toBe('future');
        expect(m['2026-06-23']).toBe('no_work');
    });

    test('extraDates proširuje raspon unazad (zaboravljeni raniji dan)', () => {
        const days = buildWorkTimeline({
            logs: [log('2026-06-23', 'M', 80)],
            startedAt: '2026-06-23',
            extraDates: new Set(['2026-06-20']),
            today: new Date('2026-06-24T00:00:00'),
        });
        expect(days[0].date).toBe('2026-06-20');   // počinje od ručno dodanog dana
    });
});

describe('buildWorkTimeline — kumulativni trošak + sažetak', () => {
    test('kumulativa raste po danima', () => {
        const days = buildWorkTimeline({
            logs: [log('2026-06-22', 'M', 80), log('2026-06-24', 'I', 100)],
            startedAt: '2026-06-22', today: new Date('2026-06-24T00:00:00'),
        });
        expect(days.find(d => d.date === '2026-06-22')!.cumulativeLaborCost).toBe(80);
        expect(days.find(d => d.date === '2026-06-23')!.cumulativeLaborCost).toBe(80);
        expect(days.find(d => d.date === '2026-06-24')!.cumulativeLaborCost).toBe(180);
    });

    test('summarizeWorkTimeline broji radne/pauzirane/ukupne dane i trošak', () => {
        const days = buildWorkTimeline({
            logs: [log('2026-06-23', 'M', 80)],
            startedAt: '2026-06-22',
            pausePeriods: [{ Started_At: '2026-06-24', Ended_At: '2026-06-24' }],
            today: new Date('2026-06-24T00:00:00'),
        });
        const s = summarizeWorkTimeline(days);
        expect(s.workingDays).toBe(1);
        expect(s.pausedDays).toBe(1);     // 24.
        expect(s.totalDays).toBe(3);      // 22,23,24 (nijedan future)
        expect(s.totalLaborCost).toBe(80);
    });
});
