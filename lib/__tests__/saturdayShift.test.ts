// Subotnja smjena (Worker.Saturday_Anchor): radnik radi zadatu subotu i svaku drugu od nje —
// smjena ima prednost nad procjenom iz šihtarice. Izmišljena imena.
import { buildSaturdayChecker, shiftWorksSaturday, workOrderDueDate } from '@/lib/planning';

describe('subotnja smjena', () => {
    it.each([
        ['2026-11-21', '2026-11-21', true],
        ['2026-11-21', '2026-11-28', false],
        ['2026-11-21', '2026-12-05', true],
        ['2026-11-21', '2026-11-14', false],
        ['2026-11-28', '2026-12-12', true],
        ['2026-11-28', '2026-12-19', false],
    ])('od %s: subota %s → radi %s', (anchor, sat, want) => {
        expect(shiftWorksSaturday(anchor, sat)).toBe(want);
    });

    it('bez smjene ili za dan koji nije subota → nema odluke', () => {
        expect(shiftWorksSaturday(undefined, '2026-11-21')).toBeNull();
        expect(shiftWorksSaturday('2026-11-21', '2026-11-23')).toBeNull();
    });

    it('smjena ima prednost nad šihtaricom (unaprijed upisan „Vikend")', () => {
        const att = [{ Worker_ID: 'amer', Date: '2026-12-05', Status: 'Vikend' }, { Worker_ID: 'amer', Date: '2026-11-28', Status: 'Vikend' }];
        const check = buildSaturdayChecker(['amer'], att, [{ Worker_ID: 'amer', Saturday_Anchor: '2026-11-21' }]);
        expect(check(new Date('2026-12-05T12:00:00'))).toBe(true);
        expect(check(new Date('2026-12-12T12:00:00'))).toBe(false);
    });

    it('rok naloga: 6 radnih dana od pon 30.11. — radna subota 5.12. ulazi, neradna ne', () => {
        const works = buildSaturdayChecker(['amer'], [], [{ Worker_ID: 'amer', Saturday_Anchor: '2026-12-05' }]);
        const off = buildSaturdayChecker(['edin'], [], [{ Worker_ID: 'edin', Saturday_Anchor: '2026-11-28' }]);
        expect(workOrderDueDate('2026-11-30', 6, works)).toBe('2026-12-05');
        expect(workOrderDueDate('2026-11-30', 6, off)).toBe('2026-12-07');
    });
});

describe('grupisanje po smjeni', () => {
    it('smjena s najbližom radnom subotom prva, bez smjene zadnji; redoslijed u grupi ostaje', () => {
        const ws = [
            { n: 'Amer', a: '2026-11-28' }, { n: 'Edin', a: '2026-11-21' }, { n: 'Haso', a: undefined }, { n: 'Tarik', a: '2026-11-21' },
        ];
        const g = (await_ => await_)(require('@/lib/planning').groupByShift(ws, (w: { a?: string }) => w.a, '2026-11-20'));
        expect(g.map((x: { label: string }) => x.label)).toEqual(['Smjena · subote 21.11., 5.12.…', 'Smjena · subote 28.11., 12.12.…', 'Bez subotnje smjene']);
        expect(g[0].items.map((w: { n: string }) => w.n)).toEqual(['Edin', 'Tarik']);
    });
});
