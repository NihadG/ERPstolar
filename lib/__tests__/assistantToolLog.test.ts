import { capToolCalls, toolCallLog } from '@/lib/assistant/toolLog';

describe('dnevnik poziva alata', () => {
    it('ime, argumenti i ishod; greška samo prva linija', () => {
        expect(toolCallLog('set_progress', { orders: ['R1'] }, { ok: true })).toEqual({ name: 'set_progress', args: '{"orders":["R1"]}', ok: true });
        expect(toolCallLog('set_progress', {}, { ok: false, error: 'Prva linija\nDruga linija' })).toEqual({ name: 'set_progress', args: '{}', ok: false, error: 'Prva linija' });
    });

    it('dugi argumenti se skrate, a poziva je najviše 12', () => {
        const long = toolCallLog('log_work', { text: 'x'.repeat(2000) }, { ok: true });
        expect(long.args.length).toBeLessThan(700);
        expect(long.args.endsWith('…')).toBe(true);
        expect(capToolCalls(Array.from({ length: 20 }, () => long))).toHaveLength(12);
        expect(capToolCalls(undefined)).toEqual([]);
    });
});
