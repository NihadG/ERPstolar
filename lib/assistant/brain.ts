// ════════════════════════════════════════════════════════════════════
// MOZAK ASISTENTA — jedna poruka korisnika → radnje + odgovor.
//
// Gemini s function callingom: model čita kontekst (bilježnica, zadaci,
// radnici, projekti), bira alate iz lib/assistant/tools, i na kraju piše
// kratak odgovor. Najviše MAX_STEPS krugova alata po poruci.
//
// Kad model zatraži pitanje (ask_user), krug staje: korisnik dobije pitanje
// s dugmadima, a sesija pamti razgovor da sljedeća poruka (odgovor) završi
// prvobitni zahtjev.
//
// Bez AI-ja (nema ključa / model pao) poruka NIJE izgubljena — već je u
// assistant_entries; korisnik dobije jasnu poruku da nije razvrstana.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI, type Content, type EnhancedGenerateContentResponse, type Part } from '@google/generative-ai';
import type { ButtonRows } from '@/lib/telegram/api';
import { assistantTimezone, toZoned } from './datetime';
import { loadContext } from './context';
import { buildSystemPrompt } from './prompt';
import { runTool, TOOL_DECLARATIONS, type ToolEnv } from './tools';
import type { AssistantSession, SessionTurn } from './store';

const MAX_STEPS = 6;
const TIMEOUT_MS = 25_000;
// 3.1 flash-lite je brz i već radi u voice-extract-task; 2.5 flash je rezerva.
const FALLBACK_MODEL = 'gemini-2.5-flash';

function primaryModel(): string {
    return process.env.ASSISTANT_MODEL?.trim() || 'gemini-3.1-flash-lite';
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
    degraded?: boolean;
}

/** Telegram šaljemo kao običan tekst — model ponekad ipak ubaci markdown. */
export function plainText(s: string): string {
    return s
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

function toContents(history: SessionTurn[]): Content[] {
    const out: Content[] = history.map(t => ({ role: t.role, parts: [{ text: t.text }] }));
    while (out.length && out[0].role !== 'user') out.shift(); // Gemini traži da istorija počne korisnikom
    return out;
}

function safeText(res: EnhancedGenerateContentResponse): string {
    try { return res.text(); } catch { return ''; }
}

function isModelMissing(e: unknown): boolean {
    const msg = String((e as Error)?.message || e);
    return /\b404\b|not found|is not supported|unknown model/i.test(msg);
}

export async function runAssistant(input: AssistantTurnInput): Promise<AssistantTurnOutput> {
    const now = input.now || new Date();
    const tz = assistantTimezone();
    const turnId = uuidv4();
    const message = userMessage(input, tz);
    const history = input.session.history || [];
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

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
        const reply = '📥 Sačuvao sam poruku u dnevnik, ali AI nije podešen (nedostaje Gemini ključ), pa je nisam razvrstao.';
        return finish(reply, [], null, reply, { degraded: true });
    }

    const ctx = await loadContext(input.orgId, input.uid);
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
    };

    const genAI = new GoogleGenerativeAI(apiKey);
    const system = buildSystemPrompt(ctx, now, tz);
    const startChat = (name: string) => genAI.getGenerativeModel(
        {
            model: name,
            systemInstruction: system,
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
            // 2.5 bez „razmišljanja": odgovor za ~1 s umjesto ~5 s, a alati drže tačnost.
            generationConfig: { temperature: 0.2, ...(name.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } as any,
        },
        { timeout: TIMEOUT_MS },
    ).startChat({ history: toContents(history) });

    let reply = '';
    try {
        let chat = startChat(primaryModel());
        let res: EnhancedGenerateContentResponse;
        try {
            res = (await chat.sendMessage(message)).response;
        } catch (e) {
            if (!isModelMissing(e) || primaryModel() === FALLBACK_MODEL) throw e;
            console.warn(`[assistant] ${primaryModel()} nedostupan, prelazim na ${FALLBACK_MODEL}`);
            chat = startChat(FALLBACK_MODEL);
            res = (await chat.sendMessage(message)).response;
        }

        for (let step = 0; step < MAX_STEPS; step++) {
            const calls = res.functionCalls() || [];
            if (!calls.length) break;
            const parts: Part[] = [];
            // Redom, ne paralelno: drugi alat može zavisiti od prvog (kreiraj → izmijeni).
            for (const call of calls) {
                const out = await runTool(env, call.name, (call.args || {}) as Record<string, unknown>);
                parts.push({ functionResponse: { name: call.name, response: out } });
            }
            if (env.question) break;
            res = (await chat.sendMessage(parts)).response;
        }
        reply = env.question ? '' : plainText(safeText(res));
    } catch (e) {
        console.error('[assistant] model pao:', e);
        if (!env.changes.length && !env.question) {
            const msg = '📥 Sačuvao sam poruku u dnevnik, ali AI se trenutno ne javlja. Pokušaj ponovo za minut.';
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

    if (!reply) reply = env.changes.length ? `✅ Sačuvano: ${env.changes.join(', ')}.` : 'Nisam siguran šta da uradim s ovim. Možeš li reći drugačije?';
    const buttons: ButtonRows = env.changes.length ? [[{ text: '↩️ Poništi', data: `undo:${turnId}` }]] : [];
    return finish(reply, buttons, null, reply, { created: env.created });
}
