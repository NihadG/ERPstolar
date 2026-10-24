// ════════════════════════════════════════════════════════════════════
// MOZAK ASISTENTA — jedna poruka korisnika → radnje + odgovor.
//
// Claude Haiku 5.5 s alatima: model čita kontekst (bilježnica, zadaci,
// radnici, projekti), bira alate iz lib/assistant/tools, i po potrebi piše
// odgovor. Najviše MAX_STEPS krugova alata po poruci.
//
// TROŠAK — tri pravila:
//   1. Keš: stabilni dio prompta (pravila, radnici, projekti) ima vlastitu
//      tačku keša; ostatak (vrijeme, liste, razgovor) kešira automatika, pa
//      drugi krug iste poruke plaća ulaz ~10 puta jeftinije.
//   2. Bez drugog poziva: kad je model samo upisivao (zadatak, bilješka,
//      izmjena) i sve je uspjelo, potvrdu složi sistem iz rezultata alata.
//   3. Bez razmišljanja (thinking: disabled) i effort: low — biranje alata
//      i izvlačenje podataka iz poruke ne treba razmišljanje, a ono bi se
//      platilo kao izlaz i čekalo se na njega pri svakom koraku.
//   4. Razgovor stariji od HISTORY_HOURS ne ide modelu — ne pomaže, a plaća se.
//
// Kad model zatraži pitanje (ask_user), krug staje: korisnik dobije pitanje
// s dugmadima, a sesija pamti razgovor da sljedeća poruka završi zahtjev.
//
// Bez AI-ja (nema ključa / model pao) poruka NIJE izgubljena — već je u
// assistant_entries; korisnik dobije jasnu poruku da nije razvrstana.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import type { ButtonRows } from '@/lib/telegram/api';
import { assistantTimezone, toZoned } from './datetime';
import { loadContext } from './context';
import { buildPromptParts } from './prompt';
import { runTool, stripAliases, TOOLS, WRITE_TOOLS, type ToolEnv } from './tools';
import type { AssistantSession, SessionTurn } from './store';

const MAX_STEPS = 6;
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 25_000;
/** Poruke starije od ovoga ne idu modelu (osim kad čeka odgovor na pitanje). */
const HISTORY_HOURS = 3;

function model(): string {
    return process.env.ASSISTANT_MODEL?.trim() || 'claude-haiku-5-5';
}

export interface AssistantTurnInput {
    orgId: string;
    uid: string;
    text: string;
    forward?: { from: string; date: string };
    entryId?: string;
    session: AssistantSession;
    now?: Date;
}

export interface AssistantTurnOutput {
    reply: string;
    buttons: ButtonRows;
    session: AssistantSession;
    created: { taskIds: string[]; memoryIds: string[] };
    /** PDF-ovi narudžbi koji idu poslije odgovora. */
    documents?: { orderId: string; draft: boolean }[];
    degraded?: boolean;
}

/** Telegram šaljemo kao običan tekst — model ponekad ipak ubaci markdown ili oznake. */
export function plainText(s: string): string {
    return stripAliases(s)
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s*[-*]\s+/gm, '• ')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
}

function userMessage(input: AssistantTurnInput, tz: string): string {
    if (!input.forward) return input.text;
    const d = toZoned(input.forward.date, tz);
    return `[Proslijeđeno od ${input.forward.from}, ${Number(d.date.slice(8, 10))}.${Number(d.date.slice(5, 7))}. ${d.time}]\n${input.text}`;
}

function toMessages(history: SessionTurn[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = history.map(t => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text }));
    while (out.length && out[0].role !== 'user') out.shift(); // razgovor mora početi korisnikom
    return out;
}

/** Kratak razlog greške za korisnika — bez logova na Vercelu inače se ne vidi šta je puklo. */
export function failureReason(e: unknown): string {
    if (e instanceof Anthropic.APIError) {
        const msg = String(e.message || '');
        if (e.status === 401) return 'Anthropic ključ nije ispravan (401) — provjeri ANTHROPIC_API_KEY na Vercelu';
        if (e.status === 403) return 'ključ nema pristup (403)';
        if (/not scoped to a workspace/i.test(msg)) return 'ključ nije vezan za workspace — napravi ključ unutar workspacea ili postavi ANTHROPIC_WORKSPACE_ID na Vercelu';
        if (/credit balance/i.test(msg)) return 'nema kredita na Anthropic nalogu (console.anthropic.com → Billing)';
        if (e.status === 404) return `model ${model()} nije dostupan (404)`;
        if (e.status === 429) return 'previše zahtjeva ili dostignut limit potrošnje (429)';
        if (e.status === 529 || (e.status ?? 0) >= 500) return `Anthropic je trenutno preopterećen (${e.status})`;
        if (e.status) return `${e.status}: ${msg.slice(0, 160)}`;
        return 'nema veze s Anthropicom (mreža ili istek vremena)';
    }
    return e instanceof Error ? e.message.slice(0, 160) : 'nepoznata greška';
}

function textOf(res: Anthropic.Message): string {
    return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
}

export async function runAssistant(input: AssistantTurnInput): Promise<AssistantTurnOutput> {
    const now = input.now || new Date();
    const tz = assistantTimezone();
    const turnId = uuidv4();
    const message = userMessage(input, tz);
    const cutoff = now.getTime() - HISTORY_HOURS * 3_600_000;
    const history = (input.session.history || []).filter(t => input.session.pending || Date.parse(t.at) >= cutoff);
    const at = now.toISOString();

    const finish = (reply: string, buttons: ButtonRows, pending: AssistantSession['pending'], modelTurn: string, extra: Partial<AssistantTurnOutput> = {}): AssistantTurnOutput => ({
        reply,
        buttons,
        created: { taskIds: [], memoryIds: [] },
        ...extra,
        session: {
            history: [...history, { role: 'user', text: message, at }, { role: 'model', text: modelTurn, at }],
            pending,
        },
    });

    // trim: zalijepljen ključ s novim redom ruši zaglavlje zahtjeva.
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
        const reply = '📥 Sačuvao sam poruku u dnevnik, ali AI nije podešen (nedostaje ANTHROPIC_API_KEY), pa je nisam razvrstao.';
        return finish(reply, [], null, reply, { degraded: true });
    }

    const ctx = await loadContext(input.orgId, input.uid, now);
    // Vrijeme se potvrđuje samo prema OVOJ poruci — osim kad je ovo odgovor na
    // pitanje; tad i prema poruci koja je pitanje izazvala („napomeni me sutra…"
    // → „Ameru"). Starije poruke bi podmetnule pogrešan dan.
    const recentUser = input.session.pending
        ? history.filter(t => t.role === 'user').slice(-1).map(t => t.text)
        : [];
    const env: ToolEnv = {
        orgId: input.orgId,
        uid: input.uid,
        tz,
        now,
        ctx,
        turnId,
        entryId: input.entryId,
        dateText: [...recentUser, message].join('\n'),
        reporter: input.forward?.from || 'ja',
        searchHits: [],
        created: { taskIds: [], memoryIds: [] },
        changes: [],
        summaries: [],
    };

    // Ključ koji nije vezan za workspace traži workspace u zaglavlju svakog zahtjeva.
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    const client = new Anthropic({
        apiKey, timeout: TIMEOUT_MS, maxRetries: 1,
        ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}),
    });
    const prompt = buildPromptParts(ctx, now, tz);
    const system: Anthropic.TextBlockParam[] = [
        // Tačka keša na kraju stabilnog dijela: alati + pravila + imena se čitaju iz keša.
        { type: 'text', text: prompt.stable, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: prompt.volatile },
    ];
    const messages: Anthropic.MessageParam[] = [...toMessages(history), { role: 'user', content: message }];

    let reply = '';
    try {
        for (let step = 0; step < MAX_STEPS; step++) {
            const started = Date.now();
            const res = await client.messages.create({
                model: model(),
                max_tokens: MAX_TOKENS,
                system,
                tools: TOOLS,
                messages,
                // Automatski keš za rastući rep (razgovor + rezultati alata).
                cache_control: { type: 'ephemeral' },
                thinking: { type: 'disabled' },
                output_config: { effort: 'low' },
            });
            const u = res.usage;
            console.log(`[assistant] korak ${step + 1}: ${Date.now() - started} ms, ulaz ${u.input_tokens}, keš čitanje ${u.cache_read_input_tokens ?? 0}, keš upis ${u.cache_creation_input_tokens ?? 0}, izlaz ${u.output_tokens}`);

            if (res.stop_reason === 'refusal') {
                reply = 'Ovu poruku ne mogu obraditi. Probaj je reći drugačije.';
                break;
            }
            const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
            if (!uses.length) {
                reply = plainText(textOf(res));
                break;
            }

            messages.push({ role: 'assistant', content: res.content });
            const results: Anthropic.ToolResultBlockParam[] = [];
            let allOk = true;
            // Redom, ne paralelno: drugi alat može zavisiti od prvog (kreiraj → izmijeni).
            for (const use of uses) {
                const out = await runTool(env, use.name, (use.input || {}) as Record<string, unknown>);
                if (out.ok === false) allOk = false;
                results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out), ...(out.ok === false ? { is_error: true } : {}) });
            }
            if (env.question) break;
            // Samo upisi, svi uspjeli → potvrdu složi sistem, bez drugog poziva modela.
            if (allOk && uses.every(x => WRITE_TOOLS.has(x.name)) && env.summaries.length) {
                reply = env.summaries.join('\n\n');
                break;
            }
            messages.push({ role: 'user', content: results });
        }
    } catch (e) {
        console.error('[assistant] model pao:', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
        if (!env.changes.length && !env.question) {
            const msg = `📥 Sačuvao sam poruku u dnevnik, ali AI se trenutno ne javlja.\nRazlog: ${failureReason(e)}.`;
            return finish(msg, [], null, msg, { degraded: true });
        }
    }

    if (env.question) {
        const { question, options } = env.question;
        const buttons: ButtonRows = options.map((o, i) => [{ text: o, data: `opt:${i}` }]);
        const modelTurn = options.length ? `${question}\n(opcije: ${options.join(' / ')})` : question;
        const pending = { question, options, askedAt: at, ...(input.entryId ? { entryId: input.entryId } : {}) };
        return finish(question, buttons, pending, modelTurn, { created: env.created });
    }

    if (!reply) {
        reply = env.summaries.length ? env.summaries.join('\n\n')
            : env.changes.length ? `✅ Sačuvano: ${env.changes.join(', ')}.`
                : 'Nisam siguran šta da uradim s ovim. Možeš li reći drugačije?';
    }
    const buttons: ButtonRows = env.changes.length ? [[{ text: '↩️ Poništi', data: `undo:${turnId}` }]] : [];
    return finish(reply, buttons, null, reply, { created: env.created, documents: env.documents });
}
