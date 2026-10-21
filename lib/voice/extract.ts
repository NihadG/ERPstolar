// ════════════════════════════════════════════════════════════════════
// Diktat → polja zadatka.
//
// Model (app/api/voice-extract-task) dobije tekst, kalendar i listu
// projekata/radnika S ID-jevima, i vrati JSON. Sve što stigne od modela
// prolazi kroz finalizeExtraction(): rok se provjerava determinističkim
// parserom (lib/voice/dates), radnik/projekat se potvrđuju po ID-ju ili
// fuzzy poređenjem imena (lib/voice/match), a ostalo se sanira.
// ════════════════════════════════════════════════════════════════════

import { resolveDueDate, calendarHint, type IsoDate } from './dates';
import { bestMatch, type MatchCandidate } from './match';

export const VOICE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const VOICE_CATEGORIES = ['general', 'manufacturing', 'ordering', 'installation', 'design', 'meeting', 'reminder'] as const;

export interface ExtractedTaskData {
    title: string;
    description: string;
    priority: typeof VOICE_PRIORITIES[number];
    category: typeof VOICE_CATEGORIES[number];
    checklist: string[];
    suggestedDueDate: string | null;
    /** Izgovoreno ime radnika (i kad nije prepoznato — da UI može reći „nije pronađen"). */
    suggestedWorker: string | null;
    suggestedWorkerId: string | null;
    suggestedProject: string | null;
    suggestedProjectId: string | null;
}

export interface VoiceProjectRef {
    id: string;
    client: string;
    name?: string;
    address?: string;
}

export interface VoiceWorkerRef {
    id: string;
    name: string;
}

export interface VoiceContext {
    projects?: VoiceProjectRef[];
    workers?: VoiceWorkerRef[];
    suppliers?: string[];
}

export const MAX_TITLE = 80;
export const MAX_CHECKLIST = 12;

export function projectLabel(p: VoiceProjectRef): string {
    const parts = [p.client];
    if (p.name && p.name !== p.client) parts.push(p.name);
    if (p.address) parts.push(p.address);
    return parts.filter(Boolean).join(' · ');
}

/** Imena za transkripciju: radnici, klijenti, nazivi projekata, dobavljači. */
export function contextNames(ctx: VoiceContext | undefined): string[] {
    if (!ctx) return [];
    return [
        ...(ctx.workers || []).map(w => w.name),
        ...(ctx.projects || []).flatMap(p => [p.client, p.name || '']),
        ...(ctx.suppliers || []),
    ].filter(Boolean);
}

export function buildContextBlock(ctx: VoiceContext | undefined): string {
    const parts: string[] = [];
    if (ctx?.projects?.length) {
        parts.push('PROJEKTI (id | klijent · naziv · mjesto):\n' + ctx.projects.map(p => `${p.id} | ${projectLabel(p)}`).join('\n'));
    }
    if (ctx?.workers?.length) {
        parts.push('RADNICI (id | ime):\n' + ctx.workers.map(w => `${w.id} | ${w.name}`).join('\n'));
    }
    if (ctx?.suppliers?.length) {
        parts.push('DOBAVLJAČI: ' + ctx.suppliers.join(', '));
    }
    return parts.length ? parts.join('\n\n') : 'Nema dostupnog konteksta.';
}

export function buildExtractionPrompt(text: string, today: IsoDate, ctx: VoiceContext | undefined): string {
    return `Ti si asistent u ERP-u stolarske radionice (namještaj po mjeri: kuhinje, ormari, komode, vitrine, radne ploče; materijali iveral/iverica, MDF, furnir, hrast, bukva, ABS trake, okovi, šarke, vodilice). Iz diktata na bosanskom/hrvatskom/srpskom izvuci podatke za JEDAN zadatak.

DIKTAT (transkript govora — moguće su sitne greške u imenima):
"""
${text}
"""

KALENDAR (koristi ga, ne računaj datume sam):
${calendarHint(today)}

${buildContextBlock(ctx)}

PRAVILA
1. title — kratko i jasno (do 60 znakova), počni glagolom u infinitivu ili imenicom, velikim slovom ("Naručiti iveral H3395 hrast", "Montaža kuhinje – Ibrahimović"). Ne stavljaj rok, hitnost ni ime radnika u naslov. Nikad sirovi transkript. Ako se nabraja više stvari, zbirni naslov.
2. description — samo dodatni kontekst koji nije u naslovu ni u checklisti (mjere, šifre, napomene). Bez ponavljanja roka/hitnosti/radnika. Inače "".
3. checklist — kad se nabraja više radnji/stavki ("A, B i C", "prvo…, pa…"), SVAKA nabrojana stavka ide posebno (nijedna ne smije završiti u opisu), kratko, velikim slovom. Jedan zadatak bez nabrajanja → []. Zadrži brojeve, šifre i mjere tačno kako su izgovorene.
4. suggestedProjectId — id iz liste PROJEKTI ako se spominje klijent, naziv ili mjesto (padeži i greške u slovima su normalni: "kod Hodžića" = Hodžić). Ako nijedan ne odgovara ili ih više podjednako odgovara → null. suggestedProject — ime kako je izgovoreno (ili null).
5. suggestedWorkerId — id iz liste RADNICI ako je zadatak nekome dodijeljen ("Emir neka…", "reci Mirzi", "za Senada"). Ime klijenta NIJE radnik. Nejasno → null. suggestedWorker — ime kako je izgovoreno (ili null).
6. suggestedDueDate — YYYY-MM-DD iz kalendara samo ako je rok izgovoren (danas, sutra, u petak, za 3 dana, do 15.11., sljedeće sedmice…). "Hitno" nije datum. Nema roka → null.
7. priority — "urgent": hitno, odmah, što prije, mora danas; "high": važno, bitno, obavezno, prioritet; "low": nije hitno, kad stigneš, kad bude vremena; inače "medium".
8. category — ordering (naručiti, kupiti, nabavka, dobavljač, cijena), manufacturing (izrada, rezanje, kantovanje, bušenje, brušenje, lakiranje, sklapanje), installation (montaža, ugradnja, postavljanje, spajanje), design (mjerenje, crtanje, nacrt, projektovanje), meeting (sastanak, nazvati, poziv, dogovor), reminder (podsjetnik, ne zaboravi), inače general.

PRIMJERI (danas je prvi dan iz kalendara)
"Treba naručiti iveral H3395 hrast za Hodžića" → title "Naručiti iveral H3395 hrast", checklist [], category "ordering", projekat Hodžić.
"Hitno za sutra pripremiti materijal za montažu kod Begovića, ABS trake, šarke i vodilice" → title "Pripremiti materijal za montažu", checklist ["ABS trake", "Šarke", "Vodilice"], priority "urgent", rok = sutra, projekat Begović.
"Emir neka izmjeri kuhinju kod Petrovića u Zenici u četvrtak" → title "Izmjeriti kuhinju", category "design", radnik Emir, projekat Petrović, rok = prvi četvrtak iz kalendara.
"Kad stigneš nazovi dobavljača za okove i pitaj za cijenu vodilica" → title "Nazvati dobavljača za okove", checklist [], description "Pitati za cijenu vodilica", priority "low", category "meeting".

Vrati SAMO JSON objekt s ključevima: title, description, priority, category, checklist, suggestedDueDate, suggestedWorker, suggestedWorkerId, suggestedProject, suggestedProjectId.`;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const nullable = (v: unknown) => {
    const s = str(v);
    return s && s.toLowerCase() !== 'null' ? s : null;
};

function clipTitle(t: string): string {
    if (t.length <= MAX_TITLE) return t;
    const cut = t.slice(0, MAX_TITLE - 1);
    const sp = cut.lastIndexOf(' ');
    return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** Kad model zakaže: prva rečenica (ili početak) kao naslov, ostatak u opis. */
export function fallbackExtraction(text: string): ExtractedTaskData {
    const clean = text.trim().replace(/\s+/g, ' ');
    const dot = clean.search(/[.!?](\s|$)/);
    const end = dot > 0 && dot < MAX_TITLE ? dot + 1 : Math.min(clean.length, MAX_TITLE);
    const title = clean.slice(0, end).replace(/[.!?]$/, '').trim();
    return {
        title: clipTitle(cap(title)),
        description: clean.length > end ? clean.slice(end).trim() : '',
        priority: 'medium',
        category: 'general',
        checklist: [],
        suggestedDueDate: null,
        suggestedWorker: null, suggestedWorkerId: null,
        suggestedProject: null, suggestedProjectId: null,
    };
}

/** Izvuče JSON objekt iz odgovora modela (i kad ga umota u ``` ili doda tekst). */
export function parseModelJson(raw: string): Record<string, unknown> | null {
    const s = (raw || '').replace(/```(?:json)?/gi, '').trim();
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const v = JSON.parse(s.slice(start, end + 1));
        return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

export function workerCandidates(ctx: VoiceContext | undefined): MatchCandidate[] {
    return (ctx?.workers || []).map(w => ({ id: w.id, names: [w.name] }));
}

export function projectCandidates(ctx: VoiceContext | undefined): MatchCandidate[] {
    return (ctx?.projects || []).map(p => ({ id: p.id, names: [p.client, p.name || '', p.address || '', `${p.client} ${p.address || ''}`] }));
}

/**
 * Sanira i potvrđuje odgovor modela. `raw` = parsirani JSON ili null (model
 * pao / nevaljao odgovor) — tada se tekst koristi kao naslov i opis.
 */
export function finalizeExtraction(
    raw: Record<string, unknown> | null,
    text: string,
    today: IsoDate,
    ctx: VoiceContext | undefined,
): ExtractedTaskData {
    const base = raw ? null : fallbackExtraction(text);

    const title = base ? base.title : clipTitle(cap(str(raw!.title))) || fallbackExtraction(text).title;
    let description = base ? base.description : str(raw!.description);
    if (description && description.toLowerCase() === title.toLowerCase()) description = '';

    const priority = (VOICE_PRIORITIES as readonly string[]).includes(str(raw?.priority))
        ? str(raw!.priority) as ExtractedTaskData['priority'] : 'medium';
    const category = (VOICE_CATEGORIES as readonly string[]).includes(str(raw?.category))
        ? str(raw!.category) as ExtractedTaskData['category'] : 'general';

    const seen = new Set<string>();
    const checklist = (Array.isArray(raw?.checklist) ? raw!.checklist as unknown[] : [])
        .map(i => cap(str(i).replace(/[.;,]+$/, '')))
        .filter(i => {
            const k = i.toLowerCase();
            if (!i || seen.has(k) || k === title.toLowerCase()) return false;
            seen.add(k);
            return true;
        })
        .slice(0, MAX_CHECKLIST);

    // Radnik: ID iz liste ima prednost; inače fuzzy po izgovorenom imenu.
    const workers = workerCandidates(ctx);
    const spokenWorker = nullable(raw?.suggestedWorker);
    const rawWorkerId = nullable(raw?.suggestedWorkerId);
    let workerId = rawWorkerId && workers.some(w => w.id === rawWorkerId) ? rawWorkerId : null;
    if (workerId && spokenWorker) {
        // Model zna promašiti ID u listi — ako izgovoreno ime jasno pokazuje drugog, vjeruj imenu.
        const byName = bestMatch(spokenWorker, workers);
        if (byName && byName.id !== workerId && byName.score >= 0.9) workerId = byName.id;
    }
    if (!workerId) workerId = bestMatch(spokenWorker, workers)?.id ?? null;

    const projects = projectCandidates(ctx);
    const spokenProject = nullable(raw?.suggestedProject);
    const rawProjectId = nullable(raw?.suggestedProjectId);
    let projectId = rawProjectId && projects.some(p => p.id === rawProjectId) ? rawProjectId : null;
    if (!projectId) projectId = bestMatch(spokenProject, projects)?.id ?? null;

    return {
        title,
        description,
        priority,
        category,
        checklist,
        suggestedDueDate: resolveDueDate(text, today, nullable(raw?.suggestedDueDate)),
        suggestedWorker: spokenWorker,
        suggestedWorkerId: workerId,
        suggestedProject: spokenProject,
        suggestedProjectId: projectId,
    };
}
