import { isCorrection, mergeSignals, parseFeedback, turnSignals } from '@/lib/assistant/signals';

const quiet = { readGuard: false, mailGuard: false, writeGuard: false, coverage: false, allTools: false, toolErrors: false, reply: 'Evo.', ms: 1000 };

describe('signali obrade', () => {
    it('čuvari, „nemam", greške alata, ishod i sporost', () => {
        expect(turnSignals(quiet)).toEqual([]);
        expect(turnSignals({ ...quiet, readGuard: true, mailGuard: true, allTools: true, outcome: 'answer', reply: 'Nemam zapisano.', ms: 25_000 }))
            .toEqual(['read_guard', 'mail_guard', 'all_tools', 'nemam', 'slow']);
        expect(turnSignals({ ...quiet, writeGuard: true, coverage: true, toolErrors: true, outcome: 'failed' })).toEqual(['write_guard', 'coverage', 'tool_error', 'failed']);
        expect(turnSignals({ ...quiet, outcome: 'degraded' })).toEqual(['degraded']);
    });

    it('ponovna obrada: signali obrade se zamijene, naknadni (Poništi, napomena…) ostaju', () => {
        expect(mergeSignals(['nemam', 'undone', 'feedback'], ['read_guard'])).toEqual(['undone', 'feedback', 'read_guard']);
        expect(mergeSignals(undefined, [])).toEqual([]);
    });
});

describe('ispravka u sljedećoj poruci', () => {
    const prev = 'Jesu li spremna ogledala iz Stakloreza, ova za Kuću?';
    it.each([
        'Ne, nije tako',
        'zašto nisi pogledao mail',
        'Kako ne možeš naći mail od Mie',
        'opet nisi odgovorio',
        'ima u mailu, pogledaj',
        'jesu li ogledala iz stakloreza spremna za kuću',
    ])('„%s" → ispravka', text => expect(isCorrection(text, prev)).toBe(true));

    it.each([
        'Kemal je radio montažu u Budnji',
        'hvala',
        'a kad smo počeli Grbavicu?',
    ])('„%s" → nova poruka', text => expect(isCorrection(text, prev)).toBe(false));
});

describe('napomena za reviziju', () => {
    it('„loše: …", „dobro: …", „napomena …", „📝 …"', () => {
        expect(parseFeedback('loše: trebao si pogledati mail')).toEqual({ kind: 'lose', text: 'trebao si pogledati mail' });
        expect(parseFeedback('Lose: krivo')).toEqual({ kind: 'lose', text: 'krivo' });
        expect(parseFeedback('dobro: tačno tako')).toEqual({ kind: 'dobro', text: 'tačno tako' });
        expect(parseFeedback('napomena uvijek gledaj poštu za Staklorez')).toEqual({ kind: 'napomena', text: 'uvijek gledaj poštu za Staklorez' });
        expect(parseFeedback('📝 odgovor je bio predug')).toEqual({ kind: 'napomena', text: 'odgovor je bio predug' });
    });

    it('obična poruka nije napomena („dobro, može", „loše je vrijeme")', () => {
        expect(parseFeedback('dobro, može')).toBeNull();
        expect(parseFeedback('Dobro')).toBeNull();
        expect(parseFeedback('loše je vrijeme za montažu')).toBeNull();
        expect(parseFeedback('Kemal radio')).toBeNull();
    });
});
