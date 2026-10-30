import { caseFlags, replayReport, type ReplayCase } from '@/lib/assistant/replayReport';

const tools = { read: new Set(['project_brief', 'list_orders']), write: new Set(['log_work', 'create_task']) };
const c = (text: string, prod: Partial<ReplayCase['prod']>, next: Partial<ReplayCase['next']>): ReplayCase => ({
    id: text, at: '2026-10-29T08:00:00Z', text,
    prod: { tools: [], ...prod }, next: { tools: [], billed: 1000, ...next },
});

describe('poređenje produkcije i novog bota', () => {
    it('„nemam" bez čitanja, popravljeno, pogoršano, drugi upis, all_tools', () => {
        expect(caseFlags(c('koji iveral', { outcome: 'answer' }, { outcome: 'answer', reply: 'Nemam zapisan dekor.' }), tools)).toEqual(['nemam bez čitanja']);
        expect(caseFlags(c('koji iveral', { outcome: 'answer' }, { outcome: 'answer', reply: 'Nemam zapisan dekor.', tools: ['project_brief'] }), tools)).toEqual([]);
        expect(caseFlags(c('Kemal radio', { outcome: 'failed' }, { outcome: 'written', tools: ['log_work'] }), tools)).toEqual(['popravljeno', 'drugi upis']);
        expect(caseFlags(c('Kemal radio', { outcome: 'written', tools: ['log_work'] }, { outcome: 'failed' }), tools)).toEqual(['neuspjeh', 'pogoršano', 'drugi upis']);
        expect(caseFlags(c('šta s Budnjom', { outcome: 'answer' }, { outcome: 'answer', tools: ['all_tools', 'list_orders'] }), tools)).toEqual(['all_tools']);
        // Stari unos bez ishoda se ne poredi.
        expect(caseFlags(c('Kemal radio', {}, { outcome: 'written', tools: ['log_work'] }), tools)).toEqual([]);
    });

    it('izvještaj: zbir ishoda, skupova, oznaka i tokena, pa redovi i „za pogledati"', () => {
        const md = replayReport([
            c('Koji iveral za Budnju?', { outcome: 'answer', billed: 9000 }, { outcome: 'answer', tools: ['project_brief'], billed: 4000, toolSet: 'pitanje', reply: 'U702.' }),
            c('Kemal radio | montažu', { outcome: 'failed', billed: 15000 }, { outcome: 'written', tools: ['log_work'], billed: 12000, toolSet: 'svi', reply: '✅' }),
        ], tools);
        expect(md).toContain('# Ponavljanje 2 stvarnih poruka');
        expect(md).toContain('- Ishod tada: answer 1 · failed 1');
        expect(md).toContain('- Skup alata sad: pitanje 1 · svi 1');
        expect(md).toContain('- Oznake: popravljeno 1 · drugi upis 1');
        expect(md).toContain('- Poruke s mjerenjem i tada (2): tada 12.000, sad 8.000 po poruci');
        expect(md).toContain('| 2 | Kemal radio / montažu | failed | written · log_work | svi | 12.000 | popravljeno, drugi upis |');
        expect(md).toContain('## Za pogledati');
    });
});
