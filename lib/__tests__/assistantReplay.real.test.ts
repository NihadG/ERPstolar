/**
 * @jest-environment node
 */
// PONAVLJANJE STVARNIH PORUKA — dnevnik poruka botu prođe kroz trenutnog bota:
// pravi model, memorijska baza sa snimkom firme. Ništa ne ide u produkciju:
// Firestore je lažan, Telegram je mock, a mreža je dozvoljena samo prema
// api.anthropic.com (Gmail, Drive i ostalo odbijaju). Košta API pozive, pa se
// pokreće samo izričito, nad lokalnim izvozom (ne ide u repo — stvarne poruke):
//
//   npm run bot:replay        (zadnji izvoz: scripts/bot-review/export.cjs → .bot-review/latest.txt)
//   npm run bot:replay:skup   (stalni skup .bot-review/stalni-skup/<grupa>/ — provjere moraju proći)
//   ASSISTANT_REPLAY=<folder sa snapshot.json i entries.json> npx jest lib/__tests__/assistantReplay.real.test.ts
//
// Folder s expect.json je grupa stalnog skupa (lib/assistant/replaySet.ts): poslije
// svake poruke s provjerom ERP pogleda odgovor, alate i Knjigu rada; prekršaj obori test.
// ANTHROPIC_API_KEY se uzima iz okruženja ili .env.local. Izvještaj:
// <folder>/report.md i results.json (lib/assistant/replayReport.ts), za skup i skup.md.

import fs from 'fs';
import path from 'path';

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);
jest.mock('@/lib/telegram/api', () => ({
    sendMessage: jest.fn(async () => ({ message_id: 1 })),
    sendDocument: jest.fn(async () => ({ message_id: 1 })),
    editMessageText: jest.fn(async () => undefined),
    answerCallbackQuery: jest.fn(async () => undefined),
}));

import { fakeDocs, fakeStore as store } from '@/lib/testing/fakeFirestore';
import { runAssistant } from '@/lib/assistant/brain';
import type { AssistantSession } from '@/lib/assistant/store';
import { READ_TOOLS, WRITE_TOOLS } from '@/lib/assistant/tools';
import { billedTokens } from '@/lib/assistant/usage';
import { replayReport, type ReplayCase } from '@/lib/assistant/replayReport';
import { checkReplay, skupReport, type ReplayDbView, type ReplayGroupExpect } from '@/lib/assistant/replaySet';
import type { AssistantOutcome, AssistantUsage } from '@/lib/types';
import { reviewDir } from '@/lib/testing/reviewDir';

const DIR = reviewDir(process.env.ASSISTANT_REPLAY);
const run = DIR ? describe : describe.skip;

interface Entry {
    id: string; at: string; text: string; forwardFrom?: string;
    outcome?: AssistantOutcome; reply?: string; tools?: { name: string; ok: boolean }[]; usage?: AssistantUsage;
}

interface CheckResult { group: string; id: string; text: string; why: string; failures: string[] }

function apiKey(): string {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(/^ANTHROPIC_API_KEY=(.*)$/m);
    return (m?.[1] || '').replace(/^["']|["']$/g, '').trim();
}

/** Izvoz (snapshot.json + entries.json) ili stalni skup: podfolderi s istim fajlovima. */
function groupsOf(dir: string): string[] {
    if (fs.existsSync(path.join(dir, 'snapshot.json'))) return [dir];
    return fs.readdirSync(dir).map(d => path.join(dir, d)).filter(d => fs.existsSync(path.join(d, 'snapshot.json'))).sort();
}

/** Knjiga rada iz lažne baze, s nazivom naloga — ono što provjere skupa gledaju. */
function dbView(): ReplayDbView {
    const orders = new Map(fakeDocs('work_orders').map(o => [String(o.Work_Order_ID), String(o.Name || o.Work_Order_Number || '')]));
    return {
        logs: fakeDocs('work_logs').map(l => ({
            worker: String(l.Worker_Name || l.Worker_ID || ''),
            order: orders.get(String(l.Work_Order_ID)) || '',
            date: String(l.Date || ''),
        })),
    };
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

    it('svaka poruka kroz trenutnog bota → report.md (skup: provjere moraju proći)', async () => {
        const groups = groupsOf(DIR);
        if (!groups.length) throw new Error(`${DIR}: nema snapshot.json ni grupa stalnog skupa.`);
        const checked: CheckResult[] = [];
        let total = 0;

        for (const dir of groups) {
            const snapshot: Record<string, any> = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
            const entries: Entry[] = JSON.parse(fs.readFileSync(path.join(dir, 'entries.json'), 'utf8'));
            const expectFile = path.join(dir, 'expect.json');
            const expects: ReplayGroupExpect | null = fs.existsSync(expectFile) ? JSON.parse(fs.readFileSync(expectFile, 'utf8')) : null;
            const only = Number(process.env.ASSISTANT_REPLAY_LIMIT || 0);
            const list = only ? entries.slice(-only) : entries;
            const orgId = Object.values(snapshot).find(d => d?.Organization_ID)?.Organization_ID as string;
            const uid = Object.keys(snapshot).find(k => k.startsWith('users/'))?.split('/')[1] || 'u1';

            const cases: ReplayCase[] = [];
            let session: AssistantSession = { history: [], pending: null };
            // Baza ide dalje kroz razgovor (zadatak iz prve poruke vidi i „izbaci stavku" u sljedećoj):
            // ASSISTANT_REPLAY_CARRY=1 ili „carry" u expect.json. Bez toga svaka poruka kreće od istog snimka.
            const carry = process.env.ASSISTANT_REPLAY_CARRY === '1' || !!expects?.carry;
            const load = () => { store.clear(); for (const [k, v] of Object.entries(snapshot)) store.set(k, JSON.parse(JSON.stringify(v))); };
            if (carry) load();
            for (const e of list) {
                // Razgovor (istorija, pitanje bota) uvijek ide dalje; baza samo s CARRY.
                if (!carry) load();
                const exp = expects?.checks[e.id];
                let out;
                try {
                    out = await runAssistant({
                        orgId, uid, text: e.text, session, now: new Date(e.at),
                        ...(e.forwardFrom ? { forward: { from: e.forwardFrom, date: e.at } } : {}),
                    });
                } catch (err) {
                    console.warn('[ponavljanje] pala poruka', e.id, err);
                    cases.push({ id: e.id, at: e.at, text: e.text, prod: prodSide(e), next: { outcome: 'degraded', tools: [], reply: String(err) } });
                    if (exp) checked.push({ group: path.basename(dir), id: e.id, text: e.text, why: exp.why, failures: [`pala: ${String(err).slice(0, 120)}`] });
                    continue;
                }
                session = out.session;
                const next = {
                    // Kartica Viber/WhatsApp ide posebnom porukom — u izvještaju se vidi i njen tekst.
                    outcome: out.outcome, reply: [out.reply, ...(out.chatCards || []).map(c => `[kartica → ${c.message.To_Name}] ${c.message.Text}`)].join('\n'),
                    tools: (out.toolCalls || []).filter(t => t.ok).map(t => t.name),
                    // Za uzrok: argumenti i greške svakog poziva (results.json, ne report.md).
                    toolLog: (out.toolCalls || []).map(t => ({ name: t.name, ok: t.ok, args: t.args, ...(t.error ? { error: t.error } : {}) })),
                    billed: out.usage ? billedTokens(out.usage) : 0, calls: out.usage?.calls || 0, toolSet: out.usage?.toolSet,
                };
                cases.push({ id: e.id, at: e.at, text: e.text, prod: prodSide(e), next });
                if (exp) {
                    const failures = checkReplay({ ...next, buttons: (out.buttons || []).flat().map(b => b.text) }, exp, dbView(), WRITE_TOOLS);
                    checked.push({ group: path.basename(dir), id: e.id, text: e.text, why: exp.why, failures });
                }
                console.log(`[ponavljanje] ${path.basename(dir)} ${cases.length}/${list.length} ${out.outcome} · ${out.usage?.toolSet || ''} · ${(out.toolCalls || []).map(t => t.name).join(', ')}`);
            }
            fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(cases, null, 1));
            fs.writeFileSync(path.join(dir, 'report.md'), replayReport(cases, { read: READ_TOOLS, write: WRITE_TOOLS }));
            expect(cases).toHaveLength(list.length);
            total += cases.length;
        }

        if (checked.length) {
            fs.writeFileSync(path.join(DIR, 'skup.md'), skupReport(checked));
            console.log(`[ponavljanje] stalni skup: ${checked.filter(c => !c.failures.length).length}/${checked.length} prolazi → ${path.join(DIR, 'skup.md')}`);
        }
        expect(total).toBeGreaterThan(0);
        // Stalni skup: svaka provjera mora proći (izvještaj iznad kaže koja nije i zašto).
        expect(checked.filter(c => c.failures.length).map(c => `${c.id.slice(0, 8)}: ${c.failures.join('; ')}`)).toEqual([]);
    }, 60 * 60_000);
});

function prodSide(e: Entry): ReplayCase['prod'] {
    return {
        outcome: e.outcome, reply: e.reply,
        tools: (e.tools || []).filter(t => t.ok).map(t => t.name),
        ...(e.usage ? { billed: billedTokens(e.usage), calls: e.usage.calls, toolSet: e.usage.toolSet } : {}),
    };
}
