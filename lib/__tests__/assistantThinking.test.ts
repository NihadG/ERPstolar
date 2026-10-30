/**
 * @jest-environment node
 */
// Haiku 5.5 je prestao primati `thinking: disabled` (400: „To turn thinking off on
// this model, send "thinking": {"type": "between_tools"} instead"). Bot šalje
// ispravan tip po modelu i sam se oporavi kad API predloži drugi.
import { suggestedThinking, thinkingFor } from '../assistant/brain';

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('isključeno razmišljanje po modelu', () => {
    it('Haiku 5.5 gasi razmišljanje s between_tools, ostali s disabled', () => {
        expect(thinkingFor('claude-haiku-5-5')).toEqual({ type: 'between_tools' });
        expect(thinkingFor('neki-drugi-model')).toEqual({ type: 'disabled' });
    });

    it('čita predloženi tip iz stvarne poruke greške', () => {
        const msg = '400 {"type":"error","error":{"type":"invalid_request_error","message":"To turn thinking off on this model, send \\"thinking\\": {\\"type\\": \\"between_tools\\"} instead."}}';
        expect(suggestedThinking(apiError(400, msg))).toBe('between_tools');
        expect(suggestedThinking(apiError(400, 'send "thinking": {"type": "disabled"} instead'))).toBe('disabled');
    });

    it('druge greške ne mijenjaju ništa', () => {
        expect(suggestedThinking(apiError(429, 'send "thinking": {"type": "between_tools"}'))).toBeNull();
        expect(suggestedThinking(apiError(400, 'max_tokens too large'))).toBeNull();
        expect(suggestedThinking(new Error('mreža'))).toBeNull();
    });
});

describe('ponovni pokušaj', () => {
    const fakeClient = (failFirstWith?: Error) => {
        const sent: any[] = [];
        let first = true;
        return {
            sent,
            client: { messages: { create: async (p: any) => {
                sent.push(p);
                if (first && failFirstWith) { first = false; throw failFirstWith; }
                first = false;
                return { content: [], usage: {} };
            } } } as any,
        };
    };
    const params = (model: string) => ({ model, max_tokens: 10, messages: [{ role: 'user' as const, content: 'x' }] });

    it('API predloži drugi tip → jedan ponovni pokušaj, pa zapamti za taj model', async () => {
        const { createTurn } = await import('../assistant/brain');
        const f = fakeClient(apiError(400, 'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead.'));
        await createTurn(f.client, params('model-x'));
        expect(f.sent.map(p => p.thinking.type)).toEqual(['disabled', 'between_tools']);
        const g = fakeClient();
        await createTurn(g.client, params('model-x'));
        expect(g.sent.map(p => p.thinking.type)).toEqual(['between_tools']);
    });

    it('druga greška se ne ponavlja', async () => {
        const { createTurn } = await import('../assistant/brain');
        const f = fakeClient(apiError(500, 'overloaded'));
        await expect(createTurn(f.client, params('model-y'))).rejects.toThrow('overloaded');
        expect(f.sent).toHaveLength(1);
    });
});
