/**
 * @jest-environment node
 */
// PONAVLJANJE STVARNIH PORUKA — dnevnik poruka botu prođe kroz trenutnog bota:
// pravi model, memorijska baza sa snimkom firme. Ništa ne ide u produkciju:
// Firestore je lažan, Telegram je mock, a mreža je dozvoljena samo prema
// api.anthropic.com (Gmail, Drive i ostalo odbijaju). Košta API pozive, pa se
// pokreće samo izričito, nad lokalnim izvozom (ne ide u repo — stvarne poruke):
//
//   ASSISTANT_REPLAY=<folder sa snapshot.json i entries.json> npx jest lib/__tests__/assistantReplay.real.test.ts
//
// ANTHROPIC_API_KEY se uzima iz okruženja ili .env.local. Izvještaj:
// <folder>/report.md i results.json (lib/assistant/replayReport.ts).

import fs from 'fs';
import path from 'path';

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
jest.mock('@/lib/telegram/api', () => ({
    sendMessage: jest.fn(async () => ({ message_id: 1 })),
    sendDocument: jest.fn(async () => ({ message_id: 1 })),
    editMessageText: jest.fn(async () => undefined),
    answerCallbackQuery: jest.fn(async () => undefined),
}));

import { fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runAssistant } from '@/lib/assistant/brain';
import type { AssistantSession } from '@/lib/assistant/store';
import { READ_TOOLS, WRITE_TOOLS } from '@/lib/assistant/tools';
import { billedTokens } from '@/lib/assistant/usage';
import { replayReport, type ReplayCase } from '@/lib/assistant/replayReport';
import type { AssistantOutcome, AssistantUsage } from '@/lib/types';

const DIR = process.env.ASSISTANT_REPLAY || '';
const run = DIR ? describe : describe.skip;

interface Entry {
    id: string; at: string; text: string; forwardFrom?: string;
    outcome?: AssistantOutcome; reply?: string; tools?: { name: string; ok: boolean }[]; usage?: AssistantUsage;
}

function apiKey(): string {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(/^ANTHROPIC_API_KEY=(.*)$/m);
    return (m?.[1] || '').replace(/^["']|["']$/g, '').trim();
}

run('ponavljanje stvarnih poruka (pravi model, lažna baza)', () => {
    const realFetch = global.fetch;

    beforeAll(() => {
        process.env.ANTHROPIC_API_KEY = apiKey();
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('Nema ANTHROPIC_API_KEY (okruženje ili .env.local) — bez njega bot ne radi i ponavljanje nema smisla.');
        process.env.ASSISTANT_TIMEZONE = 'Europe/Sarajevo';
        // Samo model: Gmail, Drive, Telegram i sve ostalo ovdje ne smije otići van.
        global.fetch = (async (input: any, init?: any) => {
            const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
            if (url.host !== 'api.anthropic.com') throw new Error(`mreža blokirana u ponavljanju: ${url.host}`);
            return realFetch(input, init);
        }) as typeof fetch;
    });
    afterAll(() => { global.fetch = realFetch; });

    it('svaka poruka kroz trenutnog bota → report.md', async () => {
        const snapshot: Record<string, any> = JSON.parse(fs.readFileSync(path.join(DIR, 'snapshot.json'), 'utf8'));
        const entries: Entry[] = JSON.parse(fs.readFileSync(path.join(DIR, 'entries.json'), 'utf8'));
        const only = Number(process.env.ASSISTANT_REPLAY_LIMIT || 0);
        const list = only ? entries.slice(-only) : entries;
        const orgId = Object.values(snapshot).find(d => d?.Organization_ID)?.Organization_ID as string;
        const uid = Object.keys(snapshot).find(k => k.startsWith('users/'))?.split('/')[1] || 'u1';

        const cases: ReplayCase[] = [];
        let session: AssistantSession = { history: [], pending: null };
        for (const e of list) {
            // Svaka poruka kreće od istog snimka; razgovor (istorija, pitanje bota) ide dalje.
            store.clear();
            for (const [k, v] of Object.entries(snapshot)) store.set(k, JSON.parse(JSON.stringify(v)));
            let out;
            try {
                out = await runAssistant({
                    orgId, uid, text: e.text, session, now: new Date(e.at),
                    ...(e.forwardFrom ? { forward: { from: e.forwardFrom, date: e.at } } : {}),
                });
            } catch (err) {
                console.warn('[ponavljanje] pala poruka', e.id, err);
                cases.push({ id: e.id, at: e.at, text: e.text, prod: prodSide(e), next: { outcome: 'degraded', tools: [], reply: String(err) } });
                continue;
            }
            session = out.session;
            cases.push({
                id: e.id, at: e.at, text: e.text,
                prod: prodSide(e),
                next: {
                    outcome: out.outcome, reply: out.reply,
                    tools: (out.toolCalls || []).filter(t => t.ok).map(t => t.name),
                    billed: out.usage ? billedTokens(out.usage) : 0, calls: out.usage?.calls || 0, toolSet: out.usage?.toolSet,
                },
            });
            console.log(`[ponavljanje] ${cases.length}/${list.length} ${out.outcome} · ${out.usage?.toolSet || ''} · ${(out.toolCalls || []).map(t => t.name).join(', ')}`);
        }
        fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(cases, null, 1));
        fs.writeFileSync(path.join(DIR, 'report.md'), replayReport(cases, { read: READ_TOOLS, write: WRITE_TOOLS }));
        expect(cases).toHaveLength(list.length);
    }, 60 * 60_000);
});

function prodSide(e: Entry): ReplayCase['prod'] {
    return {
        outcome: e.outcome, reply: e.reply,
        tools: (e.tools || []).filter(t => t.ok).map(t => t.name),
        ...(e.usage ? { billed: billedTokens(e.usage), calls: e.usage.calls, toolSet: e.usage.toolSet } : {}),
    };
}
