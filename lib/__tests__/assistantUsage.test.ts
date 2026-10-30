import { addUsage, billedTokens, emptyUsage, summarizeUsage } from '../assistant/usage';

describe('potrošnja po poruci', () => {
    it('zbraja krugove; upis keša po trajanju kad ga API razdvoji', () => {
        const u = emptyUsage();
        addUsage(u, { input_tokens: 300, output_tokens: 120, cache_read_input_tokens: 14000, cache_creation_input_tokens: 2000,
            cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1500 } }, 'claude-haiku-5-5', 1200);
        addUsage(u, { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 16000, cache_creation_input_tokens: 400 }, 'claude-haiku-5-5', 900);
        expect(u).toEqual({ calls: 2, input: 500, cacheRead: 30000, cacheWrite5m: 900, cacheWrite1h: 1500, output: 200, models: ['claude-haiku-5-5'], ms: 2100 });
    });

    it('bez usage-a se ništa ne broji', () => {
        expect(addUsage(emptyUsage(), undefined, 'm', 10).calls).toBe(0);
    });

    it('obračunski tokeni: keš ×0,1, upis 5 min ×1,25, 1 h ×2, izlaz ×5', () => {
        expect(billedTokens({ calls: 1, input: 1000, cacheRead: 10000, cacheWrite5m: 400, cacheWrite1h: 100, output: 200, models: [], ms: 0 }))
            .toBe(1000 + 1000 + 500 + 200 + 1000);
    });

    it('sažetak: prosjek po poruci, udio keša i po danima; poruke bez mjerenja se ne broje', () => {
        const u = (calls: number, cacheRead: number, input: number) => ({ calls, input, cacheRead, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, models: [], ms: 0 });
        const s = summarizeUsage([
            { at: '2026-10-30T08:00:00Z', usage: u(1, 9000, 1000) },
            { at: '2026-10-30T09:00:00Z', usage: u(3, 27000, 3000) },
            { at: '2026-10-29T09:00:00Z', usage: u(2, 0, 2000) },
            { at: '2026-10-28T09:00:00Z', usage: null },
        ]);
        expect(s).toMatchObject({ messages: 3, calls: 6, avgCalls: 2, cacheShare: 0.86 });
        expect(s.byDay.map(d => [d.day, d.messages])).toEqual([['2026-10-30', 2], ['2026-10-29', 1]]);
        expect(summarizeUsage([])).toMatchObject({ messages: 0, avgCalls: 0, avgBilled: 0 });
    });
});
