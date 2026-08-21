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
