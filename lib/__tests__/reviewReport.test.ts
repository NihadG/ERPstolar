import { metricsRow, reviewMetrics, reviewReport, type ReviewEntry } from '@/lib/assistant/reviewReport';

// Izmišljene poruke; oblik kao .bot-review/<datum>/entries.json.
const usage = { calls: 2, input: 1000, cacheRead: 10000, cacheWrite5m: 0, cacheWrite1h: 0, output: 100, models: ['m'], ms: 3000 };
const entries: ReviewEntry[] = [
    {
        id: 'e1', at: '2026-10-30T10:35:00Z', text: 'Jesu li spremna ogledala iz Stakloreza?', outcome: 'answer',
        reply: 'Ne mogu potvrditi.', signals: ['read_guard', 'nemam', 'corrected', 'feedback'], usage,
        feedback: [{ At: '2026-10-30T10:37:00Z', Kind: 'lose', Text: 'trebao si pogledati mail' }],
        tools: [{ name: 'list_orders', ok: true, args: '{}' }],
    },
    { id: 'e2', at: '2026-10-30T11:00:00Z', text: 'Kemal radio montažu', outcome: 'written', signals: ['undone'], usage },
    { id: 'e3', at: '2026-10-30T11:10:00Z', text: 'Šta imam sutra?', outcome: 'answer', signals: [] },
    { id: 'e4', at: '2026-10-30T11:20:00Z', text: 'U e101 fali ogledalo', outcome: 'failed', tools: [{ name: 'remember', ok: false, error: 'Lokacija nije rečena' }] },
];

describe('trijaža za reviziju', () => {
    it('metrike i red za dnevnik', () => {
        const m = reviewMetrics(entries);
        expect(m).toMatchObject({ total: 4, withSignal: 2, withFeedback: 1, avgBilled: 2500, outcome: { written: 1, answer: 2, failed: 1 } });
        expect(metricsRow('30.10.2026', m)).toBe('| 30.10.2026 | 4 | 1 | 2 | 0 | 1 | 0 | 2 | 1 | 2.500 |');
        expect(metricsRow('x', reviewMetrics([entries[2]]))).toContain('nema mjerenja');
    });

    it('napomene prve, pa grupe od najgoreg; svaka poruka jednom; neuspjeh bez signala na kraju', () => {
        const md = reviewReport(entries, '30.10.2026');
        const order = ['## Tvoje napomene (1)', '## poništeno (1)', '## Nije upisano / AI nije radio, bez signala (1)'].map(h => md.indexOf(h));
        expect(order.every(i => i > 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(md).toContain('  - 📝 Ti (lose): trebao si pogledati mail');
        expect(md).toContain('  - Alati: remember ✗ (Lokacija nije rečena)');
        expect(md.match(/`e1`/g)).toHaveLength(1);
        expect(md).not.toContain('Šta imam sutra');
    });
});
