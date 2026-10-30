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

describe('model odbija i predloženi tip (greška 30.10.)', () => {
    const scripted = (rejects: Record<string, string>) => {
        const sent: any[] = [];
        return {
            sent,
            client: { messages: { create: async (p: any) => {
                sent.push(p);
                const key = p.thinking ? p.thinking.type : 'omit';
                if (rejects[key]) throw apiError(400, rejects[key]);
                return { content: [], usage: {} };
            } } } as any,
        };
    };
    const params = (model: string) => ({ model, max_tokens: 10, messages: [{ role: 'user' as const, content: 'x' }] });

    it('disabled odbijen s prijedlogom between_tools, a i to „nije podržano" → bez polja thinking, pa zapamti', async () => {
        const { createTurn } = await import('../assistant/brain');
        const rejects = {
            disabled: 'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead.',
            between_tools: '"thinking.type.between_tools" is not supported for this model.',
        };
        const f = scripted(rejects);
        await createTurn(f.client, params('model-z'));
        expect(f.sent.map(p => p.thinking?.type ?? 'omit')).toEqual(['disabled', 'between_tools', 'omit']);
        const g = scripted(rejects);
        await createTurn(g.client, params('model-z'));
        expect(g.sent.map(p => p.thinking?.type ?? 'omit')).toEqual(['omit']);
    });

    it('Haiku koji ipak odbije between_tools prelazi na disabled', async () => {
        const { createTurn } = await import('../assistant/brain');
        const f = scripted({ between_tools: '"thinking.type.between_tools" is not supported for this model.' });
        await createTurn(f.client, params('claude-haiku-5-5'));
        expect(f.sent.map(p => p.thinking?.type ?? 'omit')).toEqual(['between_tools', 'disabled']);
    });

    it('sve odbijeno → prava greška ide dalje', async () => {
        const { createTurn } = await import('../assistant/brain');
        const f = scripted({ disabled: 'thinking x', between_tools: 'thinking y', omit: 'thinking z' });
        await expect(createTurn(f.client, params('model-w'))).rejects.toThrow('thinking z');
        expect(f.sent).toHaveLength(3);
    });
});

// Ponavljanje stvarnih poruka (30.10.): čuvar traži tool_choice: any, a Haiku 5.5
// (razmišljanje se ne gasi) to odbija → „AI se ne javlja". Sad: bez prisile, zapamćeno.
describe('obavezan alat po modelu', () => {
    const forcedParams = (model: string) => ({ model, max_tokens: 10, messages: [{ role: 'user' as const, content: 'x' }], tool_choice: { type: 'any' as const } });

    it('tool_choice odbijen → isti zahtjev bez prisile; sljedeći put odmah bez nje', async () => {
        const { createTurn } = await import('../assistant/brain');
        const sent: any[] = [];
        let fail = true;
        const client = { messages: { create: async (p: any) => {
            sent.push(p);
            if (fail && p.tool_choice) { fail = false; throw apiError(400, 'tool_choice: type "tool" and "any" are not supported for this model.'); }
            return { content: [], stop_reason: 'end_turn', usage: {} };
        } } } as any;
        await createTurn(client, forcedParams('model-t'));
        expect(sent.map(p => p.tool_choice?.type ?? 'bez')).toEqual(['any', 'bez']);
        expect(sent[1].thinking).toEqual(sent[0].thinking);   // razmišljanje se ne mijenja zbog ove greške
        sent.length = 0;
        await createTurn(client, forcedParams('model-t'));
        expect(sent.map(p => p.tool_choice?.type ?? 'bez')).toEqual(['bez']);
        sent.length = 0;
        await createTurn(client, forcedParams('drugi-model'));
        expect(sent.map(p => p.tool_choice?.type ?? 'bez')).toEqual(['any']);   // drugi model i dalje prisiljen
    });
});
