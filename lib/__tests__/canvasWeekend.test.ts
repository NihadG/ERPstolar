import { weekendMarksInSpan } from '../canvas/weekend';

// Sidro: 2026-06-19 pet, 06-20 sub, 06-21 ned, 06-22 pon.
describe('weekendMarksInSpan', () => {
    test('izdvaja subotu i nedjelju iz raspona, ostale dane ne', () => {
        const marks = weekendMarksInSpan('2026-06-19', '2026-06-22');
        expect(marks.map(m => [m.iso, m.kind])).toEqual([
            ['2026-06-20', 'sat'],
            ['2026-06-21', 'sun'],
        ]);
    });

    test('bez checkera subota je radna, nedjelja uvijek neradna', () => {
        const marks = weekendMarksInSpan('2026-06-20', '2026-06-21');
        expect(marks.find(m => m.kind === 'sat')!.working).toBe(true);
        expect(marks.find(m => m.kind === 'sun')!.working).toBe(false);
    });

    test('checker određuje status subote; nedjelja ostaje neradna', () => {
        const noSat = () => false;
        const marks = weekendMarksInSpan('2026-06-20', '2026-06-21', noSat);
        expect(marks.find(m => m.kind === 'sat')!.working).toBe(false);
        expect(marks.find(m => m.kind === 'sun')!.working).toBe(false);
    });

    test('checker se poziva samo za subotu (dobija Date te subote)', () => {
        const seen: number[] = [];
        weekendMarksInSpan('2026-06-19', '2026-06-22', (d) => { seen.push(d.getDay()); return true; });
        expect(seen).toEqual([6]); // samo subota
    });

    test('raspon bez vikenda (pon–pet) → prazno', () => {
        expect(weekendMarksInSpan('2026-06-22', '2026-06-26')).toEqual([]);
    });

    test('više vikenda u dužem rasponu', () => {
        const marks = weekendMarksInSpan('2026-06-20', '2026-07-05');
        expect(marks.filter(m => m.kind === 'sat').map(m => m.iso)).toEqual(['2026-06-20', '2026-06-27', '2026-07-04']);
        expect(marks.filter(m => m.kind === 'sun').map(m => m.iso)).toEqual(['2026-06-21', '2026-06-28', '2026-07-05']);
    });

    test('endISO prije startISO → prazno', () => {
        expect(weekendMarksInSpan('2026-06-22', '2026-06-20')).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════
import { workRuns } from '../canvas/weekend';

// 2026-12-03 čet … 2026-12-08 uto (5.12. sub, 6.12. ned)
describe('workRuns — traka u radnim komadima', () => {
    test('vikend bez rada dijeli traku na dva radna komada s pauzom između', () => {
        expect(workRuns('2026-12-03', '2026-12-08', () => false)).toEqual([
            { fromISO: '2026-12-03', toISO: '2026-12-04', working: true },
            { fromISO: '2026-12-05', toISO: '2026-12-06', working: false },
            { fromISO: '2026-12-07', toISO: '2026-12-08', working: true },
        ]);
    });

    test('radna subota ostaje u radnom komadu, pauza je samo nedjelja', () => {
        expect(workRuns('2026-12-03', '2026-12-08', () => true).map(r => [r.fromISO, r.working])).toEqual([
            ['2026-12-03', true], ['2026-12-06', false], ['2026-12-07', true],
        ]);
    });

    test('blok samo na neradnom danu ostaje vidljiv kao radni', () => {
        expect(workRuns('2026-12-06', '2026-12-06')).toEqual([{ fromISO: '2026-12-06', toISO: '2026-12-06', working: true }]);
    });
});
