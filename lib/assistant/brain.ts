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
import { factsNote, preparseMessage, uncovered } from './preparse';
import { intentNote, messageIntent, type MessageKind } from './intent';
import { aliasesOf } from './vocab';
import { foldText } from '@/lib/voice/text';
import { runTool, stripAliases, TOOLS, WRITE_TOOLS, type ToolEnv } from './tools';
import type { AssistantSession, SessionFocus, SessionRefs, SessionTurn } from './store';
import type { AssistantOutcome, MemoryItem } from '@/lib/types';

const MAX_STEPS = 6;
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 25_000;
/** Poruke starije od ovoga ne idu modelu (osim kad čeka odgovor na pitanje). */
const HISTORY_HOURS = 3;
/** Lokacija iz razgovora važi ovoliko („u tom stanu“, poruka bez lokacije odmah poslije). */
const FOCUS_MINUTES = 20;

/** Jači model: teška poruka i ponovni krug poslije greške (samo taj poziv). */
function strongModel(): string {
    return process.env.ASSISTANT_MODEL_STRONG?.trim() || 'claude-sonnet-5-5';
}

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
    /** Poruka je nešto upisala (rad, narudžba…) — kapije materijala se provjere odmah. */
    changed?: boolean;
    /** Ishod za dnevnik: upisano / pitanje / odgovor / nije upisano / AI nije radio. */
    outcome?: AssistantOutcome;
    /** Oznake upisa (kao uz ↩️ Poništi). */
    changes?: string[];
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

/** Koliko unazad korisnikove poruke važe kao „rečeno" za upis (nastavak istog razgovora). */
const GROUND_MINUTES = 30;

export async function runAssistant(input: AssistantTurnInput): Promise<AssistantTurnOutput> {
    const now = input.now || new Date();
    const tz = assistantTimezone();
    const turnId = uuidv4();
    const message = userMessage(input, tz);
    const cutoff = now.getTime() - HISTORY_HOURS * 3_600_000;
    const history = (input.session.history || []).filter(t => input.session.pending || Date.parse(t.at) >= cutoff);
    const at = now.toISOString();

    // Oznake iz prethodnih poruka (O#, K#, S#, R#) — dok traje razgovor.
    const prevRefs = input.session.refs && Date.parse(input.session.refs.at) >= cutoff ? input.session.refs : null;
    let turnEnv: ToolEnv | null = null;
    let nextFocus: SessionFocus | null = null;

    const finish = (reply: string, buttons: ButtonRows, pending: AssistantSession['pending'], modelTurn: string, extra: Partial<AssistantTurnOutput> = {}): AssistantTurnOutput => ({
        reply,
        buttons,
        created: { taskIds: [], memoryIds: [] },
        ...extra,
        session: {
            // Model u istoriji vidi i šta znače oznake koje je ova poruka dala (korisnik ih ne vidi).
            history: [...history, { role: 'user', text: message, at }, { role: 'model', text: withRefLegend(modelTurn, turnEnv), at }],
            pending,
            refs: turnEnv ? sessionRefs(turnEnv, at) : prevRefs,
            focus: nextFocus,
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
    const intent = messageIntent(pre.text.replace(/^\[Proslijeđeno[^\]]*\]\n/, ''), workerRefs, pre.facts);
    const workerOf = (id: string) => ctx.workers.find(w => w.value.id === id);
    const note = factsNote(pre.facts, focusLocation, intentNote(intent, id => { const w = workerOf(id); return w ? `${w.value.name} (${w.alias})` : id; }));
    // Teška poruka (mnogo stvari odjednom) ide jačem modelu od prvog kruga.
    let strong = pre.facts.dims.length + pre.facts.widths.length + pre.facts.locations.length >= 5
        || pre.text.length > 300 || intent.kinds.filter(k => k !== 'question').length >= 3;
    const modelMessage = note ? `${pre.text}\n${note}` : pre.text;
    nextFocus = focusLocation ? focus! : null;

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
        // Utemeljenost upisa: ova poruka + korisnikove poruke iz zadnjih 30 min (nastavak razgovora).
        groundText: [
            ...history.filter(t => t.role === 'user' && now.getTime() - Date.parse(t.at) <= GROUND_MINUTES * 60_000).slice(-2).map(t => t.text),
            ...(input.session.pending?.options || []),
            message,
            pre.text,
        ].join('\n'),
        // „U tom stanu" / poruka bez lokacije odmah poslije upisa → lokacija iz razgovora.
        ...(focusLocation && (pre.facts.deictic || !pre.facts.locations.length) ? { focusLocation } : {}),
        reporter: input.forward?.from || 'ja',
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
    const prompt = buildPromptParts(ctx, now, tz, promptFocus);
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
        const foldedUsed = foldText(used);
        const peopleKinds = intent.kinds.some(k => k === 'reminder' || k === 'task' || k === 'work' || k === 'presence');
        const workers = env.changes.length && peopleKinds && !used.includes('"all":true')
            ? intent.workerIds.map(workerOf).filter((w): w is NonNullable<typeof w> => !!w)
                .filter(w => !used.includes(`"${w.alias}"`) && !foldedUsed.includes(foldText(w.value.name.split(' ')[0])))
                .map(w => w.value.name)
            : [];
        const exact = intent.times.filter(t => /\d:\d/.test(t));
        const times = env.changes.length && intent.kinds.includes('reminder') && exact.length && !used.includes('reminder_at') ? exact : [];
        return { sizes: mem.sizes, locations: mem.locations, workers, times };
    };
    const hasMissing = (m: Missing) => m.sizes.length + m.locations.length + m.workers.length + m.times.length > 0;
    const missingText = (m: Missing) => [...m.sizes, ...m.locations, ...m.workers.map(w => `radnik ${w}`), ...m.times.map(t => `vrijeme ${t}`)].join(', ');

    let reply = '';
    let guarded = false;        // već jednom vraćeno: „tekst nije upis"
    let coverageAsked = false;  // već jednom vraćeno: „ovo iz poruke nije upisano"
    let forceTool = false;
    try {
        for (let step = 0; step < MAX_STEPS; step++) {
            const started = Date.now();
            const res = await client.messages.create({
                model: strong ? strongModel() : model(),
                max_tokens: MAX_TOKENS,
                system,
                tools: TOOLS,
                messages,
                // Automatski keš za rastući rep (razgovor + rezultati alata).
                cache_control: { type: 'ephemeral' },
                thinking: { type: 'disabled' },
                output_config: { effort: 'low' },
                ...(forceTool ? { tool_choice: { type: 'any' as const } } : {}),
            });
            forceTool = false;
            const u = res.usage;
            console.log(`[assistant] korak ${step + 1}${strong ? ' (jači model)' : ''}: ${Date.now() - started} ms, ulaz ${u.input_tokens}, keš čitanje ${u.cache_read_input_tokens ?? 0}, keš upis ${u.cache_creation_input_tokens ?? 0}, izlaz ${u.output_tokens}`);

            if (res.stop_reason === 'refusal') {
                reply = 'Ovu poruku ne mogu obraditi. Probaj je reći drugačije.';
                break;
            }
            const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
            if (!uses.length) {
                const text = plainText(textOf(res));
                // Model je „potvrdio" tekstom, a ništa nije upisano → još jednom, uz obavezan alat.
                if (!env.changes.length && !guarded && claimsWrite(text)) {
                    guarded = true;
                    forceTool = true;
                    strong = true;
                    messages.push({ role: 'assistant', content: res.content });
                    messages.push({ role: 'user', content: NOT_WRITTEN_NOTE });
                    continue;
                }
                // Poruka traži upis (podsjetnik, zadatak, bilješka…), a model je samo odgovorio.
                if (!env.changes.length && !guarded && !writeAttempted && intent.expectsWrite && !asksBack(text)) {
                    guarded = true;
                    forceTool = true;
                    strong = true;
                    messages.push({ role: 'assistant', content: res.content });
                    messages.push({ role: 'user', content: expectsWriteNote(intent.kinds) });
                    continue;
                }
                const m = missing();
                if (hasMissing(m) && !coverageAsked) {
                    coverageAsked = true;
                    strong = true;
                    messages.push({ role: 'assistant', content: res.content });
                    messages.push({ role: 'user', content: coverageNote(missingText(m)) });
                    continue;
                }
                reply = text;
                break;
            }

            messages.push({ role: 'assistant', content: res.content });
            const results: Anthropic.ToolResultBlockParam[] = [];
            let allOk = true;
            // Redom, ne paralelno: drugi alat može zavisiti od prvog (kreiraj → izmijeni).
            for (const use of uses) {
                if (WRITE_TOOLS.has(use.name)) writeAttempted = true;
                const out = await runTool(env, use.name, (use.input || {}) as Record<string, unknown>);
                if (out.ok === false) allOk = false;
                else usedInputs.push(JSON.stringify(use.input || {}));
                results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out), ...(out.ok === false ? { is_error: true } : {}) });
            }
            if (env.question) break;
            // Samo upisi, svi uspjeli → potvrdu složi sistem, bez drugog poziva modela —
            // osim kad nešto iz poruke nije upisano: tad model još jednom, s tačnim spiskom.
            if (allOk && uses.every(x => WRITE_TOOLS.has(x.name)) && env.summaries.length) {
                const m = missing();
                if (hasMissing(m) && !coverageAsked) {
                    coverageAsked = true;
                    strong = true;
                    messages.push({ role: 'user', content: [...results, { type: 'text', text: coverageNote(missingText(m)) }] });
                    continue;
                }
                reply = env.summaries.join('\n\n');
                break;
            }
            messages.push({ role: 'user', content: results });
        }
    } catch (e) {
        console.error('[assistant] model pao:', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
        if (!env.changes.length && !env.question) {
            const msg = `📥 Sačuvao sam poruku u dnevnik, ali AI se trenutno ne javlja.\nRazlog: ${failureReason(e)}.`;
            return finish(msg, retryButtons(input.entryId), null, '[AI nije radio — ništa nije upisano]', { degraded: true, outcome: 'degraded' });
        }
    }

    // Fokus razgovora: lokacija zadnje upisane stavke.
    const lastLoc = [...(env.touchedMemory || [])].reverse().find(m => m.Location)?.Location;
    if (lastLoc) nextFocus = { location: lastLoc, at };

    if (env.question) {
        const { question, options } = env.question;
        const buttons: ButtonRows = options.map((o, i) => [{ text: o, data: `opt:${i}` }]);
        const modelTurn = options.length ? `${question}\n(opcije: ${options.join(' / ')})` : question;
        const pending = { question, options, askedAt: at, ...(input.entryId ? { entryId: input.entryId } : {}) };
        return finish(question, buttons, pending, modelTurn, { created: env.created, outcome: 'question', changes: env.changes });
    }

    // Tekst tvrdi upis, a upisa nema — korisnik to mora vidjeti, ne lažnu potvrdu.
    // … ili poruka traži upis, a ni poslije ponovnog kruga ništa nije upisano.
    if (!env.changes.length && (claimsWrite(reply) || !reply || (guarded && !writeAttempted && intent.expectsWrite && !asksBack(reply)))) {
        const msg = '⚠️ Ništa nije upisano — poruka nije razvrstana kako treba.\nPritisni „Pokušaj ponovo" ili je reci drugačije.';
        return finish(msg, retryButtons(input.entryId), null, '[ništa nije upisano]', { created: env.created, outcome: 'failed' });
    }

    if (!reply) reply = env.summaries.length ? env.summaries.join('\n\n') : `✅ Sačuvano: ${env.changes.join(', ')}.`;
    const left: Missing = env.changes.length ? missing() : { sizes: [], locations: [], workers: [], times: [] };
    if (hasMissing(left)) reply += `\n\n⚠️ Iz poruke nije upisano: ${missingText(left)} — reci šta je s tim.`;
    const buttons: ButtonRows = [
        // Otvorene stavke bilježnice iz ove poruke: jedan dodir = postavljeno, bez poziva modela.
        ...memoryButtons(env.touchedMemory || []),
        ...(env.changes.length ? [[{ text: '↩️ Poništi', data: `undo:${turnId}` }]] : []),
    ];
    // Istorija za model: činjenica o upisu, ne tekst potvrde — da je ne bi „prepisao" umjesto alata.
    const modelTurn = env.changes.length
        ? `[ERP je upisao i korisniku poslao potvrdu: ${env.changes.join('; ')}${hasMissing(left) ? `; nije upisano: ${missingText(left)}` : ''}]`
        : reply;
    return finish(reply, buttons, null, modelTurn, {
        created: env.created, documents: env.documents, changed: env.changes.length > 0,
        outcome: env.changes.length ? 'written' : 'answer', changes: env.changes,
    });
}

/** Odgovor koji tvrdi da je nešto upisano (potvrda bez alata). */
export function claimsWrite(text: string): boolean {
    const t = (text || '').trim();
    if (!t) return false;
    if (/^(📒|✅|🧾|📝|🗓|⚙️|📦|✔|☑|➕)/u.test(t)) return true;
    return /\b(zapisa[ol]|zapisujem|zapisala|upisa[ol]|upisujem|sa[čc]uva[ol]|zabilje[žz]i[oh]|zabilje[žz]eno|evidentira[ol]|dodao sam|dodala sam|napravio sam (zadatak|podsjetnik|narud))/i.test(t);
}

const NOT_WRITTEN_NOTE = 'ERP: ništa nije upisano — tekst odgovora nije upis. Ako poruka traži upis, pozovi alat (svaka stvar svojim pozivom ili u items). Ako poruka ne traži upis, odgovori bez tvrdnje da je nešto zapisano.';

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
