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
//   3. Bez razmišljanja (thinkingFor: disabled / between_tools) i effort: low — biranje alata
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
import { assistantTimezone, formatReminder, toZoned } from './datetime';
import { loadContext } from './context';
import { buildPromptParts } from './prompt';
import { factsNote, preparseMessage, uncovered } from './preparse';
import { intentNote, messageIntent, type MessageKind } from './intent';
import { orderMentioned, workerMentioned } from './grounding';
import { loadFlowMaps } from './orderStatus';
import { aliasesOf } from './vocab';
import { foldText, stem, tokens } from '@/lib/voice/text';
import { projectLabel } from '@/lib/voice/extract';
import { claimsWrite, composeReply, sanitizeModelText } from './replyText';
import { fieldHint, DISPLAY_TOOLS, READ_TOOLS, runTool, stripAliases, TOOLS, WRITE_TOOLS, type ErpQuestion, type ToolEnv } from './tools';
import type { AssistantSession, PendingAction, SessionFocus, SessionRefs, SessionTurn } from './store';
import type { AssistantOutcome, AssistantUsage, MemoryItem, TaskChatMessage, ToolCallLog } from '@/lib/types';
import { toolCallLog } from './toolLog';
import type { TableDoc } from '@/lib/tables/table';
import { ABOUT_OWN, mailFirstNote, READ_FIRST_NOTE, shouldCheckMail, shouldReadFirst } from './readGuard';
import { searchFirms } from '@/lib/contacts';
import { getEmailAccount } from '@/lib/server/gmail';
import { addUsage, emptyUsage } from './usage';
import { presenceQuestion } from './presenceAsk';
import { workersWithoutPresence } from '@/lib/server/presence';
import { mentionNote } from './mentions';
import { ALL_TOOLS, QUESTION_EXTRA, TOOL_SET_LABEL, toolSetFor, toolsFor, type ToolSet } from './toolRouting';
import { isComplaint, turnSignals } from './signals';
import { CONTINUATION_MINUTES, continuesPrevious, inheritedAsk, type UnfinishedAsk } from './continuation';

export { claimsWrite } from './replyText';

const MAX_STEPS = 6;
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 25_000;
/** Poruke starije od ovoga ne idu modelu (osim kad čeka odgovor na pitanje). */
const HISTORY_HOURS = 3;
/** Lokacija iz razgovora važi ovoliko („u tom stanu“, poruka bez lokacije odmah poslije). */
const FOCUS_MINUTES = 20;
/** Narudžba iz razgovora važi duže — „pošalji je i Zaimu" stiže i poslije pola sata. */
const ORDER_FOCUS_MINUTES = 60;

/**
 * „Jači" model: teška poruka i ponovni krug poslije greške. Zadano je ISTI
 * Haiku. Ponavljanje 45 stvarnih poruka (01.11.2026): sve na Haiku je koštalo
 * $0,07 umjesto $0,55 (Sonnet je bio ~93% troška, najviše upis keša), a 13
 * težih poruka Haiku je u dva prolaza riješio jednako ili bolje — kartica
 * projekta i čuvari (readGuard/mailGuard) nose posao koji je ranije tražio
 * jači model. Isti model u svakom krugu ne lomi ni keš usred poruke.
 * ASSISTANT_MODEL_STRONG=claude-sonnet-5-5 vraća stari raspored bez izmjene koda.
 */
function strongModel(): string {
    return process.env.ASSISTANT_MODEL_STRONG?.trim() || model();
}

function model(): string {
    return process.env.ASSISTANT_MODEL?.trim() || 'claude-haiku-5-5';
}

// ── Isključeno razmišljanje, po modelu ──────────────────────────────
//
// Modeli različito primaju „bez razmišljanja": Haiku 5.5 traži `between_tools`
// (odbija `disabled`), a drugi model (npr. jači) odbija `between_tools`. Zato
// svaki model ima redoslijed pokušaja: zapamćeno/predloženo → between_tools →
// disabled → bez polja `thinking` (zadano ponašanje modela). Ono što prođe
// pamti se za taj model, pa sljedeće poruke idu iz prve.

type ThinkingOff = 'disabled' | 'between_tools';
type ThinkingChoice = ThinkingOff | 'omit';
const thinkingOff = new Map<string, ThinkingChoice>([['claude-haiku-5-5', 'between_tools']]);

export function thinkingFor(modelId: string): { type: ThinkingOff } | undefined {
    const choice = thinkingOff.get(modelId) || 'disabled';
    return choice === 'omit' ? undefined : { type: choice };
}

/** Greška je o `thinking` polju (400) — vrijedi probati drugu vrijednost. */
function thinkingRejected(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err ?? '');
    return status === 400 && /thinking/i.test(message);
}

/** Iz greške „To turn thinking off on this model, send "thinking": {"type": "between_tools"}" → between_tools. */
export function suggestedThinking(err: unknown): ThinkingOff | null {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (status !== 400 || !/thinking/i.test(message)) return null;
    const m = message.replace(/\\"/g, '"').match(/"thinking"\s*:\s*\{\s*"type"\s*:\s*"(disabled|between_tools)"/);
    return m ? (m[1] as ThinkingOff) : null;
}

// ── Obavezan alat, po modelu ─────────────────────────────────────────
//
// Čuvari (čitaj ERP, pošta prije „ne", tekst nije upis) traže `tool_choice: any`.
// Model koji ne može ugasiti razmišljanje (Haiku 5.5: samo `between_tools`)
// to odbija s 400 — ponavljanje stvarnih poruka (30.10.) pokazalo je da je
// svaki takav krug završavao „AI se ne javlja". Tad isti zahtjev ide bez
// prisile (napomena čuvara i dalje traži alat), i to se pamti za model.

const forcedToolOff = new Set<string>();

function toolChoiceRejected(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err ?? '');
    return status === 400 && /tool_choice/i.test(message);
}

/**
 * messages.create bez razmišljanja. Kad API odbije `thinking`, probaju se
 * ostale vrijednosti (prvo ona iz poruke greške); prva koja prođe se pamti.
 * Kad odbije obavezan alat (`tool_choice`), šalje se bez njega.
 */
export async function createTurn(client: Anthropic, params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'thinking'>): Promise<Anthropic.Message> {
    const forced = () => !!params.tool_choice && params.tool_choice.type !== 'auto' && params.tool_choice.type !== 'none';
    if (forcedToolOff.has(params.model) && forced()) {
        const { tool_choice: _drop, ...rest } = params;
        params = rest;
    }
    const send = (choice: ThinkingChoice) => client.messages.create(
        choice === 'omit' ? { ...params } : { ...params, thinking: { type: choice } });
    const first = thinkingOff.get(params.model) || 'disabled';
    const tried = new Set<ThinkingChoice>();
    let choice: ThinkingChoice = first;
    for (;;) {
        tried.add(choice);
        try {
            const res = await send(choice);
            if (choice !== first) {
                console.warn(`[assistant] ${params.model}: razmišljanje se gasi s „${choice}" — pamtim`);
                thinkingOff.set(params.model, choice);
            }
            return res;
        } catch (e) {
            if (toolChoiceRejected(e) && forced()) {
                console.warn(`[assistant] ${params.model}: obavezan alat nije podržan — šaljem bez tool_choice i pamtim`);
                forcedToolOff.add(params.model);
                const { tool_choice: _drop, ...rest } = params;
                params = rest;
                tried.delete(choice);
                continue;
            }
            if (!thinkingRejected(e)) throw e;
            const suggested = suggestedThinking(e);
            const next = [suggested, 'between_tools', 'disabled', 'omit'].find(c => c && !tried.has(c as ThinkingChoice)) as ThinkingChoice | undefined;
            if (!next) throw e;
            choice = next;
        }
    }
}

export interface AssistantTurnInput {
    orgId: string;
    uid: string;
    text: string;
    forward?: { from: string; date: string };
    /** Poruka na koju korisnik odgovara (reply) — „ova poruka je beskorisna" mora znati koja. */
    quoted?: { text: string; fromBot: boolean };
    /** Napomena o botu iz ove poruke je već u reviziji (signals.metaFeedback) — model je ne upisuje. */
    metaSaved?: boolean;
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
    /** Tabele (make_table) koje idu kao PDF poslije odgovora. */
    tables?: TableDoc[];
    /** Nacrti mailova (Telegram ih prikaže s dugmetom „Pošalji"). */
    emailDrafts?: string[];
    /** Poruke za Viber/WhatsApp „odmah" (kartica s dugmadima ide poslije odgovora). */
    chatCards?: { taskId: string; message: TaskChatMessage }[];
    /** Poruka je nešto upisala (rad, narudžba…) — kapije materijala se provjere odmah. */
    changed?: boolean;
    /** Ishod za dnevnik: upisano / pitanje / odgovor / nije upisano / AI nije radio. */
    outcome?: AssistantOutcome;
    /** Oznake upisa (kao uz ↩️ Poništi). */
    changes?: string[];
    /** Pozivi alata (argumenti i ishod) za dnevnik. */
    toolCalls?: ToolCallLog[];
    /** Potrošnja modela za ovu poruku (svi krugovi). */
    usage?: AssistantUsage;
    /** Šta je ERP morao ispravljati u ovoj poruci (lib/assistant/signals.ts) — za dnevnik i reviziju. */
    signals?: string[];
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

/** Dugme „✔ postavljeno" po otvorenoj stavci (najviše 4); `mem:<id>:p` obrađuje telegramHandler. */
export function memoryButtons(items: MemoryItem[]): ButtonRows {
    const seen = new Set<string>();
    return items
        .filter(m => m.State === 'open' && !seen.has(m.Item_ID) && seen.add(m.Item_ID))
        .slice(0, 4)
        .map(m => {
            const label = `${m.Title}${m.Location ? ` · ${m.Location}` : ''}`;
            return [{ text: `✔ postavljeno: ${label.length > 34 ? `${label.slice(0, 33)}…` : label}`, data: `mem:${m.Item_ID}:p` }];
        });
}

/** Najviše ovoliko oznaka po vrsti ide u sesiju; preko toga razgovor kreće s novim oznakama. */
const MAX_REFS = 80;

/** Legenda oznaka koje je ova poruka dala — samo u istoriji za model. */
function withRefLegend(modelTurn: string, env: ToolEnv | null): string {
    const notes = env?.refNotes || [];
    return notes.length ? `${modelTurn}\n[oznake: ${notes.join('; ')}]` : modelTurn;
}

function sessionRefs(env: ToolEnv, at: string): SessionRefs | null {
    // Poruka koja je upisala završila je svoj tok; oznake se nose samo kad je bot
    // pitao ili tražio (odgovor u sljedećoj poruci ih treba), da ne ostanu stare količine.
    if (env.changes.length) return null;
    const keep = <T>(list?: T[]) => (list?.length && list.length <= MAX_REFS ? list : undefined);
    const refs: SessionRefs = {
        at,
        orderGroups: keep(env.orderGroups), catalogHits: keep(env.catalogHits),
        searchHits: keep(env.searchHits), diaryCandidates: keep(env.diaryCandidates), pendingVocab: keep(env.pendingVocab),
    };
    return refs.orderGroups || refs.catalogHits || refs.searchHits || refs.diaryCandidates || refs.pendingVocab ? refs : null;
}

export function toMessages(history: SessionTurn[]): Anthropic.MessageParam[] {
    const out: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const t of history) {
        const role = t.role === 'model' ? 'assistant' : 'user';
        // Poruke koje je bot poslao sam (podsjetnik pa pregled) dolaze jedna za drugom — spoje se u jedan red.
        const last = out[out.length - 1];
        if (last && last.role === role) last.content = `${last.content}\n\n${t.text}`;
        else out.push({ role, content: t.text });
    }
    // Razgovor mora početi korisnikom; poruka koju je bot sam poslao na početku ostaje kao kontekst.
    if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: '[ranije u razgovoru]' });
    return out;
}

/** Model pita za vrijeme tekstom („Koji datum i sat da te podsjetim…?"). */
export function asksTime(text: string): boolean {
    const t = foldText(text);
    return /\?\s*$/.test(text.trim()) && /\b(kad|kada|koji datum|koji dan|u koliko sati|koje vrijeme|u koje vrijeme|koliko sati)\b/.test(t);
}

/** Dugmad za vrijeme podsjetnika: danas za sat-dva (ako ima dana), pa sutra ujutro i u podne. */
export function timeOptions(now: Date, tz: string): string[] {
    const local = toZoned(now, tz);
    const later = local.hour + 2;
    return [
        ...(later <= 19 ? [`Danas u ${String(later).padStart(2, '0')}:00`] : []),
        'Sutra u 08:00', 'Sutra u 10:00', 'Sutra u 12:00',
    ].slice(0, 4);
}

/** Poruka sama kaže dan („danas", „jučer", „u ponedjeljak", „3.11.") — dan iz razgovora tad ne važi. */
const DAY_SAID = /\b(danas|jucer|juce|prekjucer|sutra|ponedjelj\w*|utor\w*|srijed\w*|cetvrt\w*|petak|petk\w*|subot\w*|nedjelj\w*|\d{1,2}\.\s?\d{1,2}\.?)\b/;

/** Upisi koji prave nešto NOVO — pritužba bez sadržaja ih ne smije pokrenuti. */
const NEW_WRITES = new Set(['create_task', 'remember', 'create_order', 'log_work', 'fill_work_days', 'set_progress', 'material_arrived', 'email_order', 'email_contact', 'reply_mail', 'chat_message']);

/** „↩️ Poništi prethodni upis" uz pritužbu važi ovoliko poslije te poruke. */
const UNDO_PREVIOUS_MINUTES = 30;

/**
 * „Generiši dokument sa svim stavkama … Sarajevo vodilice" → zadatak, ne tabela bilježnice
 * (ponavljanje 04.11.: make_table „E008: nema ničega"). ERP nađe zadatak po riječima naslova
 * ili po rečenim radnicima i kaže modelu koji je.
 */
export function taskDocNote(
    text: string, workerIds: string[], tasks: { alias: string; value: import('@/lib/types').Task }[],
    workerOf: (id: string) => { value: { name: string } } | undefined,
): string[] {
    const t = foldText(text);
    if (!/\b(dokument\w*|isprint\w*|printa\w*|stampa\w*|odstampa\w*|pdf)\b/.test(t)) return [];
    const said = new Set(tokens(t).filter(w => w.length >= 4).map(stem));
    const open = tasks.filter(x => x.value.Status !== 'completed' && x.value.Status !== 'cancelled' && (x.value.Checklist || []).length);
    const byTitle = open.filter(x => {
        const w = tokens(foldText(x.value.Title)).filter(z => z.length >= 4).map(stem);
        return w.length > 0 && w.filter(z => said.has(z)).length / w.length >= 0.5;
    });
    const firsts = workerIds.map(id => workerOf(id)?.value.name).filter((n): n is string => !!n).map(n => foldText(n).split(' ')[0]);
    const byWorkers = firsts.length ? open.filter(x => x.value.Assigned_Worker_ID && workerIds.includes(x.value.Assigned_Worker_ID)
        || firsts.every(f => foldText(`${x.value.Title} ${(x.value.Checklist || []).map(c => c.text).join(' ')}`).includes(f.slice(0, Math.max(3, f.length - 1))))) : [];
    const hit = byTitle.length ? byTitle : byWorkers;
    if (!hit.length || hit.length > 2) return [];
    return [`dokument zadatka → task_pdf ${hit.map(x => `${x.alias} („${x.value.Title}")`).join(' ili ')}, ne make_table`];
}

/** Dopuna („dodaj", „ubaci", „stavi", „još") — ide u postojeći zadatak tih radnika. */
const ADDS = /\b(dodaj\w*|dodati|ubaci\w*|stavi|staviti|jos|i to|u zadatak|u napomenu)\b/;

/**
 * Otvoren zadatak rečenih radnika (dodijeljen ili imenovan u naslovu/listi): „dodaj za Amera
 * i Edina…" ide u njega. 03.11. dvije takve poruke otišle su u bilježnicu, a korisnik je
 * morao reći „stavi to u onaj zadatak". ERP nađe zadatak, model ne pogađa.
 */
export function workerTaskNote(
    text: string, workerIds: string[], tasks: { alias: string; value: import('@/lib/types').Task }[],
    workerOf: (id: string) => { value: { name: string } } | undefined,
): string[] {
    if (!workerIds.length || !ADDS.test(foldText(text))) return [];
    const names = workerIds.map(id => workerOf(id)?.value.name).filter((n): n is string => !!n);
    const firsts = names.map(n => foldText(n).split(' ')[0]).filter(w => w.length >= 3);
    const open = tasks.filter(t => t.value.Status !== 'completed' && t.value.Status !== 'cancelled').filter(t => {
        if (t.value.Assigned_Worker_ID && workerIds.includes(t.value.Assigned_Worker_ID)) return true;
        const body = foldText(`${t.value.Title} ${(t.value.Checklist || []).map(c => c.text).join(' ')}`);
        return firsts.length > 0 && firsts.every(f => body.includes(f.slice(0, Math.max(3, f.length - 1))));
    });
    if (!open.length || open.length > 2) return [];
    return [`otvoren zadatak za ${names.join(', ')}: ${open.map(t => `${t.alias} „${t.value.Title}"`).join(', ')} — dopuna za njih ide u njega (update_task add_checklist), ne u bilježnicu ni novi zadatak`];
}

/** Kad je bio zadnji red razgovora (i poruka koju je bot poslao sam) — za „nastavlja li se". */
function minutesSinceLast(history: SessionTurn[], now: Date): number | null {
    const last = history[history.length - 1];
    return last ? (now.getTime() - Date.parse(last.at)) / 60_000 : null;
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

/** Koliko unazad korisnikove poruke važe kao „rečeno" za upis (nastavak istog razgovora). */
const GROUND_MINUTES = 30;

export async function runAssistant(original: AssistantTurnInput): Promise<AssistantTurnOutput> {
    const now = original.now || new Date();
    const tz = assistantTimezone();
    const turnId = uuidv4();
    const message = userMessage(original, tz);
    // Pritužba („pogrešno totalno") nije odgovor na pitanje ni nastavak zahtjeva: pitanje se gasi,
    // ništa se ne preuzima. 03.11. „Pogrešno totalno" na „u koliko sati?" je upisalo podsjetnik u 08:00.
    const complaint = isComplaint(message);
    const input: AssistantTurnInput = complaint
        ? { ...original, session: { ...original.session, pending: null, unfinished: null } }
        : original;
    const prevTurn = input.session.lastTurn && now.getTime() - Date.parse(input.session.lastTurn.at) <= UNDO_PREVIOUS_MINUTES * 60_000
        ? input.session.lastTurn : null;
    const cutoff = now.getTime() - HISTORY_HOURS * 3_600_000;
    const history = (input.session.history || []).filter(t => input.session.pending || Date.parse(t.at) >= cutoff);
    const at = now.toISOString();

    // Oznake iz prethodnih poruka (O#, K#, S#, R#) — dok traje razgovor.
    const prevRefs = input.session.refs && Date.parse(input.session.refs.at) >= cutoff ? input.session.refs : null;
    let turnEnv: ToolEnv | null = null;
    let nextFocus: SessionFocus | null = null;
    const toolCalls: ToolCallLog[] = [];
    const usage = emptyUsage();

    // Šta je ERP morao ispravljati (čuvari) — postavlja se u petlji, čita u finish.
    const sig = { readGuard: false, mailGuard: false, writeGuard: false, coverage: false };
    // Zahtjev za upis ove poruke — ostaje u sesiji ako se ne upiše (dopuna ga preuzima).
    let ask: UnfinishedAsk | null = null;

    const finish = (reply: string, buttons: ButtonRows, pending: AssistantSession['pending'], modelTurn: string, extra: Partial<AssistantTurnOutput> = {}): AssistantTurnOutput => ({
        reply,
        buttons,
        created: { taskIds: [], memoryIds: [] },
        toolCalls,
        ...(usage.calls ? { usage } : {}),
        signals: turnSignals({
            ...sig, allTools: toolCalls.some(t => t.name === ALL_TOOLS), toolErrors: toolCalls.some(t => !t.ok),
            outcome: extra.outcome, reply, ms: usage.ms,
        }),
        ...extra,
        session: {
            // Model u istoriji vidi i šta znače oznake koje je ova poruka dala (korisnik ih ne vidi).
            history: [...history, { role: 'user', text: message, at }, { role: 'model', text: withRefLegend(modelTurn, turnEnv), at }],
            pending,
            refs: turnEnv ? sessionRefs(turnEnv, at) : prevRefs,
            focus: nextFocus,
            unfinished: ask && extra.outcome !== 'written' ? ask : null,
            lastTurn: { id: turnId, at, wrote: (extra.changes || []).length > 0 },
        },
    });

    // trim: zalijepljen ključ s novim redom ruši zaglavlje zahtjeva.
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
        const reply = '📥 Sačuvao sam poruku u dnevnik, ali AI nije podešen (nedostaje ANTHROPIC_API_KEY), pa je nisam razvrstao.';
        return finish(reply, [], null, reply, { degraded: true, outcome: 'degraded' });
    }

    const ctx = await loadContext(input.orgId, input.uid, now);

    // ── Predobrada: ERP prvo pročita poruku (mjere, lokacije, tipfeleri, „u tom stanu") ──
    const knownLocations = Array.from(new Set(ctx.memory.map(m => m.value.Location).filter((l): l is string => !!l)));
    const subjects = Array.from(new Set(ctx.memory.map(m => m.value.Subject).filter((s): s is string => !!s)));
    const pre = preparseMessage(message, { knownLocations, subjects });
    const focus = input.session.focus;
    const focusLocation = focus?.location && now.getTime() - Date.parse(focus.at) <= FOCUS_MINUTES * 60_000 ? focus.location : undefined;
    // Šta poruka traži (vrsta, radnici, vrijeme) — za napomenu i za provjeru poslije obrade.
    const workerRefs = ctx.workers.map(w => ({ id: w.value.id, name: w.value.name, aliases: aliasesOf(ctx.vocab || [], 'worker', w.value.id) }));
    // Zaglavlje proslijeđene poruke („[Proslijeđeno od Amer…]") nije dio onoga što se traži.
    const ownIntent = messageIntent(pre.text.replace(/^\[Proslijeđeno[^\]]*\]\n/, ''), workerRefs, pre.facts);
    // Nastavlja li se poruka na prethodnu: odgovor na pitanje, reply, „a vrata…", „ma treba mi…".
    // Samo tad projekat, rečeno i nedovršen zahtjev iz prethodne poruke važe i za ovu (continuation.ts).
    // Bot je pitao tekstom („na čemu je radio Senad, Lejlin ili vrata?") → sljedeća poruka je odgovor,
    // kako god počinjala. 04.11. „lejla i vrata za Brdo" nije bila nastavak, pa je
    // „Senad Ibrić nije spomenut" odbilo upis iako ga je korisnik imenovao poruku ranije.
    const lastTurn = history[history.length - 1];
    const gap = minutesSinceLast(history, now);
    const botAsked = !!lastTurn && lastTurn.role === 'model' && gap !== null && gap <= CONTINUATION_MINUTES
        // Pitanje ne mora biti zadnji znak: „Koji nalozi su u pitanju?\nOpcije: …" (ponavljanje 04.11.).
        && /\?/.test(lastTurn.text.replace(/\[oznake:[^\]]*\]/g, '').trim().slice(-400));
    const continues = !!input.session.pending || !!input.quoted || botAsked || continuesPrevious(pre.text, gap);
    const inherited = inheritedAsk({
        unfinished: input.session.unfinished,
        ownWriteKinds: ownIntent.kinds.filter(k => k !== 'question' && k !== 'table'),
        continues,
        answering: !!input.session.pending,
        now,
    });
    // Nedovršen zahtjev („podsjeti me sutra u 8…" na koji je bot samo odgovorio) traži upis i u dopuni.
    const intent = inherited
        ? { ...ownIntent, kinds: Array.from(new Set([...inherited.kinds, ...ownIntent.kinds.filter(k => k !== 'question')])), expectsWrite: true, pureQuestion: false }
        : ownIntent;
    // Čisto pitanje ne upisuje ništa, ni kad model pokuša (11.11.: „na kojim nalozima rade Amer i Edin
    // danas" → pokušaj upisa rada). Odgovor na botovo pitanje i pritužba nisu pitanje u tom smislu.
    const questionOnly = intent.pureQuestion && !input.session.pending && !complaint;
    const writeKinds = intent.kinds.filter(k => k !== 'question' && k !== 'table');
    // „Pogrešno totalno", „ma nešto je pogrešno, nemoj ništa raditi": pritužba bez novog sadržaja ne
    // pravi ništa novo (izmjena postojećeg i dalje smije). Kratka ili s „nemoj / ne radi ništa".
    const noNewWrites = complaint && !writeKinds.length
        && (pre.text.split(/\s+/).length <= 8 || /\b(nemoj|ne radi|ne diraj|stani|cekaj)\b/.test(foldText(pre.text)));
    if (intent.expectsWrite && writeKinds.length) ask = { kinds: writeKinds, text: inherited ? `${inherited.text}\n${message}` : message, at };
    const workerOf = (id: string) => ctx.workers.find(w => w.value.id === id);
    const focusOrder = focus?.order && now.getTime() - Date.parse(focus.order.at) <= ORDER_FOCUS_MINUTES * 60_000 ? focus.order : undefined;
    // Projekti i nalozi koje poruka spominje (imena, klijenti, naučeni nadimci) — ERP ih nađe, model ne pogađa.
    const projectGround = ctx.projects.map(p => ({ id: p.value.id, alias: p.alias, name: projectLabel(p.value), aliases: aliasesOf(ctx.vocab || [], 'project', p.value.id) }));
    const orderGround = (ctx.orders || []).map(o => ({ id: o.value.id, alias: o.alias, name: o.value.name, aliases: aliasesOf(ctx.vocab || [], 'order', o.value.id) }));
    const recentUserText = [
        ...history.filter(t => t.role === 'user').slice(-2).map(t => t.text),
        ...(input.quoted ? [input.quoted.text] : []),
    ].join('\n');
    // Dobavljači iz poruke („iz Ramaglasa“) s adresom — stanje kod njih je često samo u pošti.
    const firmHits = searchFirms((ctx.firms || []).map(f => ({ Name: f.name, Email: f.email })), pre.text).slice(0, 3)
        .map(f => ({ name: f.Name, ...(f.Email ? { email: f.Email } : {}) }));
    const note = factsNote(pre.facts, focusLocation, [
        ...intentNote(intent, id => { const w = workerOf(id); return w ? `${w.value.name} (${w.alias})` : id; }),
        ...mentionNote({ text: pre.text, recent: recentUserText, continues, projects: projectGround, orders: orderGround, question: intent.kinds.includes('question'), firms: firmHits }),
        ...(focusOrder ? [`narudžba iz razgovora: ${focusOrder.number} · ${focusOrder.supplier} („ova/ta/ista narudžba" = ona; ne pitaj koja)`] : []),
        ...workerTaskNote(pre.text, intent.workerIds, ctx.tasks, workerOf),
        ...taskDocNote(pre.text, intent.workerIds, ctx.tasks, workerOf),
    ]);
    // Teška poruka (mnogo stvari odjednom, ili ljudi + posao u više rečenica) ide jačem modelu od prvog kruga.
    const people = intent.workerIds.length + intent.nicknames.length;
    const sentenceCount = pre.text.split(/[.!?\n]+/).filter(s => s.trim().length > 3).length;
    let strong = pre.facts.dims.length + pre.facts.widths.length + pre.facts.locations.length >= 5
        || pre.text.length > 300 || intent.kinds.filter(k => k !== 'question').length >= 3
        || intent.kinds.includes('progress')
        || (people > 0 && (people >= 2 || sentenceCount >= 2) && !intent.kinds.every(k => k === 'question'));
    const context = [
        ...(input.quoted ? [`[Korisnik odgovara na ${input.quoted.fromBot ? 'tvoju poruku' : 'poruku'}: „${input.quoted.text.slice(0, 900)}"]`] : []),
        ...(inherited ? [`[Nastavak zahtjeva koji još nije upisan: „${inherited.text.slice(0, 300)}" — ova poruka ga dopunjuje ili ispravlja; upiši ga sad s onim što je rečeno, ne traži potvrdu iz ERP-a]`] : []),
        ...(complaint ? [`[Korisnik kaže da je prethodno pogrešno. To NIJE izbor opcije ni novi zahtjev. ${noNewWrites
            ? 'Ništa novo ne pravi: u jednoj rečenici reci šta si razumio i pitaj šta treba drugačije.'
            : 'Ako je jasno šta treba, ispravi ili premjesti prethodni upis (update_*, add_checklist) — ne dupliraj; inače kratko pitaj šta je pogrešno.'}]`] : []),
        ...(input.metaSaved ? ['[ERP je napomenu o botu iz ove poruke sačuvao za reviziju — nju ne upisuj (ni u bilježnicu); uradi samo ostatak poruke]'] : []),
        // „Je li obrisana ova pogrešna" — pita za tvoj prethodni upis; odgovor je u istoriji.
        ...(ABOUT_OWN.test(foldText(pre.text)) ? ['[Pitanje o onome što si ti upravo uradio: odgovori iz istorije ([ERP je upisao …] kaže tačno šta je napravljeno, izmijenjeno ili izbačeno) — bez pretrage]'] : []),
    ];
    const modelMessage = [...context, pre.text, ...(note ? [note] : [])].join('\n');
    // Dan iz razgovora („za jučer upiši…" pa dopuna bez dana) — važi 30 min, dok poruka ne kaže drugi dan.
    const focusDay = focus?.workDay && now.getTime() - Date.parse(focus.workDay.at) <= GROUND_MINUTES * 60_000 ? focus.workDay : undefined;
    const talkWorkDay = focusDay && !DAY_SAID.test(foldText(pre.text)) ? focusDay.date : undefined;
    nextFocus = focusLocation || focusOrder || focusDay
        ? { at: focus!.at, ...(focusLocation ? { location: focusLocation } : {}), ...(focusOrder ? { order: focusOrder } : {}), ...(focusDay ? { workDay: focusDay } : {}) }
        : null;

    // Vrijeme se potvrđuje samo prema OVOJ poruci — osim kad je ovo odgovor na
    // pitanje; tad i prema poruci koja je pitanje izazvala („napomeni me sutra…"
    // → „Ameru"). Starije poruke bi podmetnule pogrešan dan.
    const recentUser = input.session.pending
        ? history.filter(t => t.role === 'user').slice(-1).map(t => t.text)
        : inherited ? [inherited.text] : [];
    const env: ToolEnv = {
        orgId: input.orgId,
        uid: input.uid,
        tz,
        now,
        ctx,
        turnId,
        entryId: input.entryId,
        dateText: [...recentUser, message].join('\n'),
        // Utemeljenost upisa: ova poruka + korisnikove poruke iz zadnjih 30 min, ali samo kad se
        // ova na njih naslanja — „pitati Edina za kant traku" ne preuzima Brdo iz poruke prije.
        groundText: [
            ...(continues ? history.filter(t => t.role === 'user' && now.getTime() - Date.parse(t.at) <= GROUND_MINUTES * 60_000).slice(-2).map(t => t.text) : []),
            ...(inherited ? [inherited.text] : []),
            ...(input.session.pending?.options || []),
            message,
            pre.text,
        ].join('\n'),
        messageText: message,
        // Prethodni odgovori (i iz pročitanih mailova) — izvor tabele „iz teksta".
        talkText: history.map(t => t.text).join('\n'),
        ...(intent.kinds.includes('work') ? { workInMessage: true } : {}),
        // Radnici: rečen maloprije = rečen, i kad poruka nije „nastavak" (projekti ostaju strogi).
        ...(talkWorkDay ? { talkWorkDay } : {}),
        workerGround: [
            ...history.filter(t => t.role === 'user' && now.getTime() - Date.parse(t.at) <= GROUND_MINUTES * 60_000).slice(-3).map(t => t.text),
            // „On i Haso…": zamjenica govori o radniku iz botovog zadnjeg odgovora.
            ...(PRONOUN.test(foldText(message)) ? history.filter(t => t.role === 'model').slice(-1).map(t => t.text) : []),
            ...(input.session.pending?.options || []),
            message, pre.text,
        ].join('\n'),
        // Zadatak/podsjetnik nosi stanje u sebi; bilježnica samo kad je rečena (intent.ts).
        ...((intent.kinds.includes('task') || intent.kinds.includes('reminder')) && !intent.kinds.includes('notebook') ? { notebookBlocked: true } : {}),
        // „U tom stanu" / poruka bez lokacije odmah poslije upisa → lokacija iz razgovora.
        ...(focusLocation && (pre.facts.deictic || !pre.facts.locations.length) ? { focusLocation } : {}),
        reporter: input.forward?.from || 'ja',
        ...(focusOrder ? { focusOrder: { id: focusOrder.id, number: focusOrder.number, supplier: focusOrder.supplier } } : {}),
        searchHits: (prevRefs?.searchHits as ToolEnv['searchHits']) || [],
        ...(prevRefs?.orderGroups ? {
            orderGroups: (prevRefs.orderGroups as NonNullable<ToolEnv['orderGroups']>).map(g => ({ ...g, value: { ...g.value, restored: true } })),
        } : {}),
        ...(prevRefs?.catalogHits ? { catalogHits: prevRefs.catalogHits as ToolEnv['catalogHits'] } : {}),
        ...(prevRefs?.diaryCandidates ? { diaryCandidates: prevRefs.diaryCandidates as ToolEnv['diaryCandidates'] } : {}),
        ...(prevRefs?.pendingVocab ? { pendingVocab: prevRefs.pendingVocab as ToolEnv['pendingVocab'] } : {}),
        created: { taskIds: [], memoryIds: [] },
        changes: [],
        summaries: [],
        refNotes: [],
    };
    turnEnv = env;

    // Ključ koji nije vezan za workspace traži workspace u zaglavlju svakog zahtjeva.
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    const client = new Anthropic({
        apiKey, timeout: TIMEOUT_MS, maxRetries: 1,
        ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}),
    });
    // Bilježnica u promptu: stavke o kojima ova (i prethodne dvije) poruke govore.
    const promptFocus = [...history.filter(t => t.role === 'user').slice(-2).map(t => t.text), pre.text].join('\n');
    // Tok naloga o kojima poruka govori: model bira tačne nazive procesa iz karte, ne pogađa riječi.
    const wantsFlow = intent.kinds.length === 0 || intent.kinds.some(k => k === 'work' || k === 'progress' || k === 'question');
    const flowOrders = wantsFlow ? (ctx.orders || []).filter(o => orderMentioned(promptFocus, orderGround.find(g => g.id === o.value.id)!, orderGround)).slice(0, 3) : [];
    const flow = flowOrders.length
        ? await loadFlowMaps(input.orgId, flowOrders.map(o => ({ alias: o.alias, id: o.value.id, name: o.value.name }))).catch(e => { console.warn('[assistant] tok naloga:', e); return ''; })
        : '';
    // Pitanje o podacima u ERP-u (projekat ili nalog spomenut): jači model, a „nemam zapisano" tek poslije čitanja.
    const erpQuestion = intent.kinds.includes('question')
        && (flowOrders.length > 0 || projectGround.some(p => orderMentioned(promptFocus, p, projectGround)));
    if (erpQuestion) strong = true;
    const prompt = buildPromptParts(ctx, now, tz, promptFocus, flow);
    const system: Anthropic.TextBlockParam[] = [
        // Tačka keša na kraju stabilnog dijela: alati + pravila + imena se čitaju iz keša.
        // 1 h: poruke s terena stižu u razmacima 5–60 min, a 5-minutni keš bi se stalno ponovo upisivao.
        { type: 'text', text: prompt.stable, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: prompt.volatile },
    ];
    const messages: Anthropic.MessageParam[] = [...toMessages(history), { role: 'user', content: modelMessage }];

    // Pokrivenost: svaka mjera i lokacija iz poruke mora završiti u upisanoj stavci bilježnice,
    // a rečen radnik i tačno vrijeme u upisu zadatka / rada / prisustva.
    const usedInputs: string[] = [];
    let writeAttempted = false;   // model je pokušao upis (i kad ERP kaže da nema šta) — onda ne tjeramo ponovo
    const missing = (): Missing => {
        const mem = env.touchedMemory?.length
            ? uncovered(pre.facts, env.touchedMemory.map(m => [m.Title, m.Spec, m.Location, m.State_Label].filter(Boolean).join(' · ')))
            : { sizes: [], locations: [] };
        const used = usedInputs.join(' ');
        const peopleKinds = intent.kinds.some(k => k === 'reminder' || k === 'task' || k === 'work' || k === 'presence');
        // Radnik je u upisu kad je njegova oznaka u pozivu ILI je imenovan u tekstu upisa
        // (s padežima: „reći Begi" pokriva Bega) — inače bi nastao drugi zadatak za istu stvar.
        const workers = env.changes.length && peopleKinds && !used.includes('"all":true')
            ? intent.workerIds.map(workerOf).filter((w): w is NonNullable<typeof w> => !!w)
                .filter(w => !used.includes(`"${w.alias}"`) && !workerMentioned(used, { id: w.value.id, name: w.value.name, aliases: aliasesOf(ctx.vocab || [], 'worker', w.value.id) }))
                .map(w => w.value.name)
            : [];
        const exact = intent.times.filter(t => /\d:\d/.test(t));
        const times = env.changes.length && intent.kinds.includes('reminder') && exact.length && !used.includes('reminder_at') ? exact : [];
        return { sizes: mem.sizes, locations: mem.locations, workers, times };
    };
    const hasMissing = (m: Missing) => m.sizes.length + m.locations.length + m.workers.length + m.times.length > 0;
    const missingText = (m: Missing) => [...m.sizes, ...m.locations, ...m.workers.map(w => `radnik ${w}`), ...m.times.map(t => `vrijeme ${t}`)].join(', ');

    // Šta model kaže na kraju (odgovor, objašnjenje šta nije urađeno). Potvrde upisa nisu ovdje — njih piše ERP.
    let modelText = '';
    let guarded = false;        // već jednom vraćeno: „tekst nije upis"
    let coverageAsked = false;  // već jednom vraćeno: „ovo iz poruke nije upisano"
    let forceTool = false;
    let readFirst = false;      // pitanje o ERP-u bez čitanja: sljedeći krug samo alati za čitanje
    let readAsked = false;
    let readUsed = false;       // model je čitao ERP — tekst bez upisa je odgovor iz podataka
    let mailAsked = false;      // već vraćeno: „prvo pogledaj poštu“
    let mailSearched = false;   // search_mail s osobom/firmom/projektom
    const mailConnected = async () => (await getEmailAccount(input.uid).catch(() => null))?.Status === 'ok';
    const isQuestion = intent.kinds.includes('question');
    // Manji skup alata kad ERP zna šta poruka traži (lib/assistant/toolRouting); all_tools ga proširi.
    let toolSet: ToolSet = toolSetFor(intent.kinds, { answeringQuestion: !!input.session.pending });
    usage.toolSet = TOOL_SET_LABEL[toolSet];
    try {
        for (let step = 0; step < MAX_STEPS; step++) {
            const started = Date.now();
            // „Prvo čitaj“ = isti skup kao pitanje → isti keš.
            const set: ToolSet = readFirst ? 'question' : toolSet;
            const res = await createTurn(client, {
                model: strong ? strongModel() : model(),
                max_tokens: MAX_TOKENS,
                system,
                tools: toolsFor(set, TOOLS, READ_TOOLS),
                messages,
                // Automatski keš za rastući rep (razgovor + rezultati alata).
                cache_control: { type: 'ephemeral' },
                output_config: { effort: 'low' },
                ...(forceTool ? { tool_choice: { type: 'any' as const } } : {}),
            });
            forceTool = false;
            readFirst = false;
            const u = res.usage;
            addUsage(usage, u, strong ? strongModel() : model(), Date.now() - started);
            console.log(`[assistant] korak ${step + 1}${strong ? ' (jači model)' : ''}: ${Date.now() - started} ms, ulaz ${u.input_tokens}, keš čitanje ${u.cache_read_input_tokens ?? 0}, keš upis ${u.cache_creation_input_tokens ?? 0}, izlaz ${u.output_tokens}, alati ${TOOL_SET_LABEL[set]}`);

            if (res.stop_reason === 'refusal') {
                modelText = 'Ovu poruku ne mogu obraditi. Probaj je reći drugačije.';
                break;
            }
            const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
            if (!uses.length) {
                const text = plainText(textOf(res));
                // Pitanje o podacima ili „nemam / ne vidim" bez ijednog čitanja ERP-a → prvo čitaj (lib/assistant/readGuard).
                // I poruka bez upisa („ne kontam ovu računicu", „pa uradi to") — inače model „ispravlja" iz glave.
                if (shouldReadFirst({ isQuestion: isQuestion || (!intent.expectsWrite && !asksBack(text)), readUsed, readAsked, changed: env.changes.length > 0, question: pre.text, answer: textOf(res) })) {
                    readAsked = true;
                    sig.readGuard = true;
                    forceTool = true;
                    readFirst = true;
                    messages.push({ role: 'assistant', content: res.content });
                    messages.push({ role: 'user', content: READ_FIRST_NOTE });
                    continue;
                }
                // „Ne / nema u ERP-u“ za stanje kod dobavljača, a pošta nije pogledana → prvo pošta (lib/assistant/readGuard).
                if (shouldCheckMail({ isQuestion, asked: mailAsked, mailSearched, firmMentioned: firmHits.length > 0, question: pre.text, answer: textOf(res) })
                    && await mailConnected()) {
                    mailAsked = true;
                    sig.mailGuard = true;
                    forceTool = true;
                    readFirst = true;
                    messages.push({ role: 'assistant', content: res.content });
                    messages.push({ role: 'user', content: mailFirstNote(firmHits[0]?.name) });
                    continue;
                }
                // Model je „potvrdio" tekstom, a ništa nije upisano → još jednom, uz obavezan alat.
                if (!env.changes.length && !guarded && !isQuestion && claimsWrite(text)) {
                    guarded = true;
                    sig.writeGuard = true;
                    forceTool = true;
                    strong = true;
                    messages.push({ role: 'assistant', content: res.content });
                    messages.push({ role: 'user', content: NOT_WRITTEN_NOTE });
                    continue;
                }
                // Poruka traži upis (podsjetnik, zadatak, bilješka…), a model je samo odgovorio.
                if (!env.changes.length && !guarded && !writeAttempted && intent.expectsWrite && !asksBack(text)) {
                    guarded = true;
                    sig.writeGuard = true;
                    forceTool = true;
                    strong = true;
                    messages.push({ role: 'assistant', content: res.content });
                    messages.push({ role: 'user', content: expectsWriteNote(intent.kinds) });
                    continue;
                }
                const m = missing();
                if (hasMissing(m) && !coverageAsked) {
                    coverageAsked = true;
                    sig.coverage = true;
                    strong = true;
                    messages.push({ role: 'assistant', content: res.content });
                    messages.push({ role: 'user', content: coverageNote(missingText(m)) });
                    continue;
                }
                modelText = text;
                break;
            }

            messages.push({ role: 'assistant', content: res.content });
            const results: Anthropic.ToolResultBlockParam[] = [];
            let allOk = true;
            // Redom, ne paralelno: drugi alat može zavisiti od prvog (kreiraj → izmijeni).
            for (const use of uses) {
                if (use.name === ALL_TOOLS) {
                    toolSet = 'full';
                    usage.toolSet = `${usage.toolSet} → ${TOOL_SET_LABEL.full}`;
                    toolCalls.push(toolCallLog(use.name, use.input, { ok: true }));
                    results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify({ ok: true, note: 'Sad imaš sve alate — pozovi onaj koji treba.' }) });
                    continue;
                }
                const args = (use.input || {}) as Record<string, unknown>;
                // PDF narudžbe („pošalji mi PDF") je prikaz i ostaje dozvoljen na pitanje.
                if (questionOnly && WRITE_TOOLS.has(use.name) && !QUESTION_EXTRA.has(use.name)) {
                    const out = { ok: false, error: QUESTION_NO_WRITE };
                    toolCalls.push(toolCallLog(use.name, use.input, out));
                    allOk = false;
                    results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out), is_error: true });
                    continue;
                }
                if (WRITE_TOOLS.has(use.name)) writeAttempted = true;
                if (READ_TOOLS.has(use.name)) readUsed = true;
                const ran = noNewWrites && NEW_WRITES.has(use.name)
                    ? { ok: false, error: 'Korisnik je rekao da je pogrešno — ne pravi ništa novo. Reci šta si razumio i pitaj šta treba drugačije.' }
                    : await runTool(env, use.name, args);
                const hint = ran.ok === false ? fieldHint(use.name, args) : null;
                const out = hint ? { ...ran, error: `${String(ran.error || 'Greška.')} ${hint}` } : ran;
                const mailArgs = (use.input || {}) as Record<string, unknown>;
                if (use.name === 'search_mail' && out.ok !== false && (mailArgs.who || mailArgs.project)) mailSearched = true;
                toolCalls.push(toolCallLog(use.name, use.input, out));
                if (out.ok === false) allOk = false;
                else usedInputs.push(JSON.stringify(use.input || {}));
                const { __documents: pdfs, ...plain } = out as typeof out & { __documents?: { name: string; data: string }[] };
                results.push({
                    type: 'tool_result', tool_use_id: use.id,
                    content: pdfs?.length
                        ? [{ type: 'text', text: JSON.stringify(plain) }, ...pdfs.map(p => ({ type: 'document' as const, title: p.name, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: p.data } }))]
                        : JSON.stringify(plain),
                    ...(out.ok === false ? { is_error: true } : {}),
                });
            }
            // Pitanje (modelovo ili ERP-ovo s dugmadima) zaustavlja krug do odgovora.
            if (env.question || env.erpQuestion) break;
            // Samo upisi (i spiskovi koje ERP složi), svi uspjeli → odgovor složi sistem, bez
            // drugog poziva modela — osim kad nešto iz poruke nije upisano: tad model još jednom.
            if (allOk && uses.every(x => WRITE_TOOLS.has(x.name) || DISPLAY_TOOLS.has(x.name)) && env.summaries.length) {
                const m = missing();
                if (hasMissing(m) && !coverageAsked) {
                    coverageAsked = true;
                    sig.coverage = true;
                    strong = true;
                    messages.push({ role: 'user', content: [...results, { type: 'text', text: coverageNote(missingText(m)) }] });
                    continue;
                }
                break;
            }
            messages.push({ role: 'user', content: results });
        }
    } catch (e) {
        console.error('[assistant] model pao:', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
        if (!env.changes.length && !env.question && !env.erpQuestion) {
            const msg = `📥 Sačuvao sam poruku u dnevnik, ali AI se trenutno ne javlja.\nRazlog: ${failureReason(e)}.`;
            return finish(msg, retryButtons(input.entryId), null, '[AI nije radio — ništa nije upisano]', { degraded: true, outcome: 'degraded' });
        }
    }

    // Upisan dan (rad ili prisustvo): ko nije spomenut, a nema prisustvo → dugmad po radniku (bez modela).
    if (env.presenceDay && env.changes.length) {
        const people = await workersWithoutPresence(input.orgId, env.presenceDay.date, env.presenceDay.workerIds)
            .catch(e => { console.warn('[assistant] prisustvo nespomenutih:', e); return []; });
        if (people.length) {
            const today = toZoned(now, tz).date;
            const label = env.presenceDay.date === today ? 'danas' : formatReminder(`${env.presenceDay.date}T10:00:00Z`, tz, now).replace(/ u \d\d:\d\d$/, '');
            const q = presenceQuestion(people, env.presenceDay.date, label);
            env.summaries.push(q.text);
            env.followUp = [...(env.followUp || []), ...q.buttons];
        }
    }

    // Fokus razgovora: lokacija zadnje upisane stavke.
    const lastLoc = [...(env.touchedMemory || [])].reverse().find(m => m.Location)?.Location;
    if (lastLoc) nextFocus = { ...(nextFocus || {}), location: lastLoc, at };
    // Narudžba koju je ova poruka dotakla postaje narudžba iz razgovora.
    if (env.touchedOrder) nextFocus = { ...(nextFocus || { at }), order: { ...env.touchedOrder, at } };
    // Upisan dan postaje dan razgovora (dopuna bez dana ide na njega).
    if (env.presenceDay && env.changes.length) nextFocus = { ...(nextFocus || { at }), workDay: { date: env.presenceDay.date, at } };
    // Pritužba na prethodni upis: jedan dodir ga poništi — ispravka premješta, ne ostavlja duplikat
    // (03.11. „U plastika" je ostala u bilježnici i poslije „pogrešno, to treba u zadatak").
    const undoRow: ButtonRows = env.changes.length
        ? [[{ text: '↩️ Poništi', data: `undo:${turnId}` }]]
        : complaint && prevTurn?.wrote ? [[{ text: '↩️ Poništi prethodni upis', data: `undo:${prevTurn.id}` }]] : [];
    if (complaint && prevTurn?.wrote && env.changes.length) undoRow.push([{ text: '↩️ Poništi prethodni upis', data: `undo:${prevTurn.id}` }]);
    const wroteFacts = env.changes.length ? `[ERP je upisao i korisniku poslao potvrdu: ${env.changes.join('; ')}]\n` : '';

    // Pitanje „kad?" tekstom (podsjetnik bez vremena) → dugmad, kao svako pitanje s konačnim izborom.
    if (!env.question && !env.erpQuestion && !env.changes.length && intent.kinds.includes('reminder') && asksTime(modelText)) {
        env.question = { question: modelText, options: timeOptions(now, tz) };
    }

    // ERP treba jedan izbor da završi upis → dugmad; izbor završava upis bez modela (runPendingAction).
    if (env.erpQuestion) {
        const q = env.erpQuestion;
        const reply = composeReply(env.summaries, q.question);
        const buttons: ButtonRows = [...q.options.map((o, i) => [{ text: o.label, data: `act:${i}` }]), ...undoRow];
        const pending = pendingFor(q, env, at, input.entryId);
        return finish(reply, buttons, pending, `${wroteFacts}${q.question}\n(opcije: ${q.options.map(o => o.label).join(' / ')})`, {
            created: env.created, documents: env.documents, tables: env.tables, emailDrafts: env.emailDrafts, chatCards: env.chatCards, changed: env.changes.length > 0,
            outcome: env.changes.length ? 'written' : 'question', changes: env.changes,
        });
    }

    if (env.question) {
        const { question, options } = env.question;
        const buttons: ButtonRows = [...options.map((o, i) => [{ text: o, data: `opt:${i}` }]), ...undoRow];
        const modelTurn = `${wroteFacts}${options.length ? `${question}\n(opcije: ${options.join(' / ')})` : question}`;
        const pending = { question, options, askedAt: at, ...(input.entryId ? { entryId: input.entryId } : {}) };
        return finish(composeReply(env.summaries, question), buttons, pending, modelTurn, {
            created: env.created, documents: env.documents, tables: env.tables, emailDrafts: env.emailDrafts, chatCards: env.chatCards, changed: env.changes.length > 0, outcome: 'question', changes: env.changes,
        });
    }

    // Tekst tvrdi upis, a upisa nema — korisnik to mora vidjeti, ne lažnu potvrdu.
    // … ili poruka traži upis, a ni poslije ponovnog kruga ništa nije upisano.
    // (Na pitanje model smije reći „upisano je 22.10." — to je odgovor iz podataka.)
    if (!env.changes.length && !env.tables?.length && !env.documents?.length && ((claimsWrite(modelText) && !(isQuestion || readUsed && !intent.expectsWrite))
        || (!modelText && !env.summaries.length)
        || (guarded && !writeAttempted && intent.expectsWrite && !asksBack(modelText)))) {
        const msg = '⚠️ Ništa nije upisano — poruka nije razvrstana kako treba.\nPritisni „Pokušaj ponovo" ili je reci drugačije.';
        return finish(msg, retryButtons(input.entryId), null, '[ništa nije upisano]', { created: env.created, outcome: 'failed' });
    }

    // Potvrde upisa piše ERP; od modelovog teksta ostaje ono što nije potvrda ni ponuda.
    const cleaned = sanitizeModelText(modelText, { dropClaims: env.changes.length > 0 }) || (env.changes.length || env.summaries.length ? '' : modelText);
    let reply = composeReply(env.summaries, cleaned) || `✅ Sačuvano: ${env.changes.join(', ')}.`;
    const left: Missing = env.changes.length ? missing() : { sizes: [], locations: [], workers: [], times: [] };
    if (hasMissing(left)) reply += `\n\n⚠️ Iz poruke nije upisano: ${missingText(left)} — reci šta je s tim.`;
    const buttons: ButtonRows = [
        // Otvorene stavke bilježnice iz ove poruke: jedan dodir = postavljeno, bez poziva modela.
        ...memoryButtons(env.touchedMemory || []),
        ...undoRow,
        ...(env.followUp || []),
    ];
    // Istorija za model: činjenica o upisu, ne tekst potvrde — da je ne bi „prepisao" umjesto alata.
    const modelTurn = env.changes.length
        ? `[ERP je upisao i korisniku poslao potvrdu: ${env.changes.join('; ')}${hasMissing(left) ? `; nije upisano: ${missingText(left)}` : ''}]${cleaned ? `\n${cleaned}` : ''}`
        : reply;
    return finish(reply, buttons, null, modelTurn, {
        created: env.created, documents: env.documents, tables: env.tables, emailDrafts: env.emailDrafts, chatCards: env.chatCards, changed: env.changes.length > 0,
        outcome: env.changes.length ? 'written' : 'answer', changes: env.changes,
    });
}

/** Sesija pamti ERP-ovo pitanje: za svako dugme gotov poziv alata, i tekst poruke za utemeljenost. */
function pendingFor(q: ErpQuestion, env: ToolEnv, at: string, entryId?: string): NonNullable<AssistantSession['pending']> {
    const action: PendingAction = { tool: q.tool, args: q.options.map(o => o.args), groundText: env.groundText || '', dateText: env.dateText };
    return { question: q.question, options: q.options.map(o => o.label), askedAt: at, action, ...(entryId ? { entryId } : {}) };
}

/**
 * Dugme ERP-ovog pitanja (`act:<i>`): izabrani poziv alata se izvrši bez modela —
 * „Kemo je radio montažu" → „Montaža Kerrocka" → upis. Odgovor i istorija kao kod
 * običnog upisa (potvrda iz ERP-a, ↩️ Poništi).
 */
export async function runPendingAction(input: {
    orgId: string; uid: string; session: AssistantSession; choice: number; now?: Date;
}): Promise<AssistantTurnOutput> {
    const now = input.now || new Date();
    const at = now.toISOString();
    const pending = input.session.pending;
    const action = pending?.action;
    const args = action?.args[input.choice];
    const label = pending?.options[input.choice];
    const history = input.session.history || [];
    if (!pending || !action || !args || !label) {
        return {
            reply: 'Pitanje je isteklo — napiši odgovor porukom.', buttons: [], created: { taskIds: [], memoryIds: [] },
            session: { ...input.session, pending: null }, outcome: 'answer',
        };
    }
    const tz = assistantTimezone();
    const ctx = await loadContext(input.orgId, input.uid, now);
    const turnId = uuidv4();
    const env: ToolEnv = {
        orgId: input.orgId, uid: input.uid, tz, now, ctx, turnId, entryId: pending.entryId,
        dateText: action.dateText, groundText: `${action.groundText}\n${label}`, reporter: 'ja', searchHits: [],
        created: { taskIds: [], memoryIds: [] }, changes: [], summaries: [], refNotes: [],
    };
    const out = await runTool(env, action.tool, args);
    const undoRow: ButtonRows = env.changes.length ? [[{ text: '↩️ Poništi', data: `undo:${turnId}` }]] : [];
    const toolCalls = [toolCallLog(action.tool, args, out)];
    const facts = env.changes.length ? `[ERP je upisao i korisniku poslao potvrdu: ${env.changes.join('; ')}]` : '[ništa nije upisano]';
    const turns = (modelTurn: string): SessionTurn[] => [...history, { role: 'user', text: `→ ${label}`, at }, { role: 'model', text: modelTurn, at }];
    const extra = { created: env.created, documents: env.documents, tables: env.tables, emailDrafts: env.emailDrafts, chatCards: env.chatCards, changed: env.changes.length > 0, changes: env.changes, toolCalls };

    // Izbor je otvorio novo pitanje (npr. drugi radnik u istoj poruci).
    if (env.erpQuestion) {
        const q = env.erpQuestion;
        return {
            reply: composeReply(env.summaries, q.question),
            buttons: [...q.options.map((o, i) => [{ text: o.label, data: `act:${i}` }]), ...undoRow],
            session: { history: turns(`${env.changes.length ? `${facts}\n` : ''}${q.question}`), pending: pendingFor(q, env, at, pending.entryId), refs: input.session.refs, focus: input.session.focus },
            outcome: env.changes.length ? 'written' : 'question', ...extra,
        };
    }
    const error = out.ok === false ? String(out.error || 'nije uspjelo').split('\n')[0] : '';
    const reply = composeReply(env.summaries, error ? `⚠️ Nije upisano: ${error}` : '') || (env.changes.length ? `✅ Sačuvano: ${env.changes.join(', ')}.` : '⚠️ Ništa nije upisano.');
    return {
        reply, buttons: [...undoRow, ...(env.followUp || [])],
        session: { history: turns(facts), pending: null, refs: input.session.refs, focus: input.session.focus },
        outcome: env.changes.length ? 'written' : out.ok === false ? 'failed' : 'answer', ...extra,
    };
}


/** Zamjenica za osobu: poruka se naslanja na onog o kome je bot upravo govorio. */
const PRONOUN = /\b(on|ona|oni|one|njega|njemu|nju|njoj|njih|njima|obojica|oba)\b/;

/** Model je na čisto pitanje pokušao upis: ERP ga odbije i kaže šta umjesto toga. */
const QUESTION_NO_WRITE = 'Poruka je pitanje — ništa se ne upisuje. Odgovori iz podataka (alati za čitanje). Ako korisnik uz pitanje očito traži i izmjenu, pitaj ga jednim pitanjem (ask_user) da potvrdi šta da upišem.';
const NOT_WRITTEN_NOTE ='ERP: ništa nije upisano — tekst odgovora nije upis. Ako poruka traži upis, pozovi alat (svaka stvar svojim pozivom ili u items). Ako poruka ne traži upis, odgovori bez tvrdnje da je nešto zapisano.';

interface Missing { sizes: string[]; locations: string[]; workers: string[]; times: string[] }

/** Odgovor je pitanje korisniku (model pita tekstom umjesto ask_user) — to nije neuspjeh. */
function asksBack(text: string): boolean {
    return /\?\s*$/.test((text || '').trim());
}

function expectsWriteNote(kinds: MessageKind[]): string {
    return `ERP: poruka traži upis (${kinds.filter(k => k !== 'question').join(', ')}), a ništa nije upisano. Upiši alatom; ako stvarno nedostaje podatak bez kojeg se ne može, pitaj ask_user s opcijama.`;
}

function coverageNote(what: string): string {
    return `ERP: iz poruke nije upisano: ${what}. Svaka mjera i svaka lokacija iz poruke je posebna stvar — upiši i to (remember / update_memory) ili pitaj korisnika šta je s tim. Ne ponavljaj ono što je već upisano.`;
}

function retryButtons(entryId?: string): ButtonRows {
    return entryId ? [[{ text: '🔁 Pokušaj ponovo', data: `retry:${entryId}` }]] : [];
}
