// ════════════════════════════════════════════════════════════════════
// ALATI ASISTENTA — jedine radnje koje model smije izvesti.
//
// Model bira alat i šalje argumente; ovdje se SVE provjerava prije upisa:
// oznake (W#/P#/M#/T#/S#) se prevode u stvarne ID-jeve ili odbijaju,
// vrijeme podsjetnika potvrđuje lib/assistant/datetime prema tekstu
// korisnika, a svaka izmjena bilježi „prije" snimak za ↩️ Poništi.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { SchemaType, type FunctionDeclaration } from '@google/generative-ai';
import { createTask, taskRef } from '@/lib/server/fieldWrites';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { isIsoDate } from '@/lib/voice/dates';
import { foldText, tokens, stem } from '@/lib/voice/text';
import { matchScore, tokenSimilarity } from '@/lib/voice/match';
import { formatReminder, resolveReminderAt, toZoned } from './datetime';
import { projectLabel, resolveAlias, type Aliased, type AssistantContext } from './context';
import { memoryLine } from './prompt';
import { listEntriesSince, listMemory, memoryRef, recordOp } from './store';
import type { Material, MemoryItem, Task, TaskCategory, TaskLink, TaskPriority } from '@/lib/types';

const CATEGORIES = ['general', 'manufacturing', 'ordering', 'installation', 'design', 'meeting', 'reminder'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

const str = { type: SchemaType.STRING } as const;
const num = { type: SchemaType.NUMBER } as const;
const bool = { type: SchemaType.BOOLEAN } as const;
const strList = { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } } as const;
const enumOf = (values: string[]) => ({ type: SchemaType.STRING, format: 'enum', enum: values }) as const;

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
    {
        name: 'create_task',
        description: 'Novi zadatak ili podsjetnik u ERP Zadacima. Za podsjetnik obavezno reminder_at.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                title: { ...str, description: 'Kratak naslov u infinitivu, npr. „Naručiti 10 baglama", „Reći Ameru da povuče ogledala u kombi".' },
                description: { ...str, description: 'Dodatni detalji iz poruke (neobavezno).' },
                category: { ...enumOf(CATEGORIES), description: 'ordering = narudžba materijala, installation = montaža, reminder = čisti podsjetnik.' },
                priority: enumOf(PRIORITIES),
                reminder_at: { ...str, description: 'Lokalno vrijeme podsjetnika YYYY-MM-DDTHH:MM (iz kalendara). Samo dan → T08:00.' },
                due_date: { ...str, description: 'Rok YYYY-MM-DD ako je drukčiji od dana podsjetnika.' },
                worker: { ...str, description: 'Oznaka radnika W#.' },
                project: { ...str, description: 'Oznaka projekta P#.' },
                checklist: strList,
            },
            required: ['title', 'category'],
        },
    },
    {
        name: 'update_task',
        description: 'Izmjena postojećeg zadatka: završen/otkazan, novo vrijeme podsjetnika, novi naslov ili bilješka.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                task: { ...str, description: 'Oznaka T#.' },
                status: enumOf(STATUSES),
                reminder_at: { ...str, description: 'Novo lokalno vrijeme YYYY-MM-DDTHH:MM.' },
                title: str,
                note: { ...str, description: 'Bilješka koja se dopisuje (npr. ko je javio šta).' },
                add_checklist: { ...strList, description: 'Nove stavke check liste u ISTOM zadatku („Kerim — CNC").' },
            },
            required: ['task'],
        },
    },
    {
        name: 'remember',
        description: 'Nova stavka bilježnice: stvar, gdje stoji i u kakvom je stanju.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                subject: { ...str, description: 'Predmet u osnovnom obliku jednine: „ogledalo".' },
                title: { ...str, description: 'Kratak opis za prikaz: „Ogledala 1 m za kupatila".' },
                quantity: num,
                unit: { ...str, description: 'kom, m, m2, pak…' },
                spec: { ...str, description: 'Mjere/opis: „1 m dužine".' },
                location: { ...str, description: 'Gdje stoji: „Stan 304", „Kombi", „Radionica".' },
                state_label: { ...str, description: 'Kratko stanje: „nije montirano".' },
                project: { ...str, description: 'Oznaka P# ako se lokacija poklapa s projektom.' },
                worker: { ...str, description: 'Oznaka W# ako je stvar vezana za radnika.' },
                tags: strList,
                note: { ...str, description: 'Rečenica za istoriju (šta je rečeno).' },
            },
            required: ['subject', 'state_label'],
        },
    },
    {
        name: 'update_memory',
        description: 'Promjena stavke bilježnice (M# ili S#): riješeno, novo stanje, količina, lokacija.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                item: { ...str, description: 'Oznaka M# ili S#.' },
                resolved: { ...bool, description: 'true = gotovo (npr. montirano), false = ponovo otvoreno.' },
                state_label: str,
                quantity: num,
                spec: str,
                location: str,
                note: { ...str, description: 'Šta se desilo, za istoriju: „Amer javio da su montirana".' },
            },
            required: ['item', 'note'],
        },
    },
    {
        name: 'search_memory',
        description: 'Pretraga cijele bilježnice (i riješenih stavki) i starih poruka/izvještaja. Za istoriju i stvari kojih nema u otvorenoj listi.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: { ...str, description: 'Ključne riječi: „ogledala 304".' },
                include_resolved: bool,
            },
            required: ['query'],
        },
    },
    {
        name: 'find_material',
        description: 'Traži materijal u katalogu ERP-a (tačan naziv, jedinica). Za narudžbe kad nije jasno koji artikal.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: { query: str },
            required: ['query'],
        },
    },
    {
        name: 'ask_user',
        description: 'Postavi korisniku JEDNO kratko pitanje s 2–4 opcije. Poslije ovoga ne radi ništa dok ne odgovori.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                question: str,
                options: { ...strList, description: '2–4 kratke opcije (do 30 znakova).' },
            },
            required: ['question', 'options'],
        },
    },
];

// ─── Izvršavanje ──────────────────────────────────────────────────────

export interface ToolEnv {
    orgId: string;
    uid: string;
    tz: string;
    now: Date;
    ctx: AssistantContext;
    turnId: string;
    entryId?: string;
    /** Tekst za potvrdu vremena: zadnje poruke korisnika + ova. */
    dateText: string;
    /** „ja" ili ime iz proslijeđene poruke — ide u istoriju bilježnice. */
    reporter: string;
    searchHits: Aliased<MemoryItem>[];
    created: { taskIds: string[]; memoryIds: string[] };
    changes: string[];
    question?: { question: string; options: string[] };
}

type Args = Record<string, unknown>;
type ToolResult = Record<string, unknown>;

const text = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const number = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const oneOf = <T extends string>(v: unknown, values: string[], fallback: T): T => (typeof v === 'string' && values.includes(v) ? v as T : fallback);

function clean<T extends Record<string, unknown>>(o: T): T {
    Object.keys(o).forEach(k => { if (o[k] === undefined) delete o[k]; });
    return o;
}

function projectLink(p: { id: string } & Parameters<typeof projectLabel>[0]): TaskLink {
    return { Entity_Type: 'project', Entity_ID: p.id, Entity_Name: projectLabel(p) };
}

function shortDay(iso: string, tz: string): string {
    const d = toZoned(iso, tz).date;
    return `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`;
}

async function createTaskTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const title = text(a.title, 120);
    if (!title) return { ok: false, error: 'Nedostaje naslov.' };
    const category = oneOf<TaskCategory>(a.category, CATEGORIES, 'general');
    const worker = resolveAlias(env.ctx.workers, a.worker);
    const project = resolveAlias(env.ctx.projects, a.project);
    if (a.worker && !worker) return { ok: false, error: `Radnik ${String(a.worker)} ne postoji u listi.` };
    if (a.project && !project) return { ok: false, error: `Projekat ${String(a.project)} ne postoji u listi.` };

    const wantsReminder = !!text(a.reminder_at) || category === 'reminder';
    const reminder = wantsReminder
        ? resolveReminderAt({ text: env.dateText, now: env.now, tz: env.tz, modelLocal: text(a.reminder_at) || null })
        : null;
    if (wantsReminder && !reminder) {
        return { ok: false, error: 'Vrijeme podsjetnika je nejasno ili u prošlosti. Pitaj korisnika kada (ask_user).' };
    }
    const dueDate = isIsoDate(a.due_date) ? a.due_date : reminder?.date;

    const taskId = await createTask(env.orgId, {
        title,
        description: text(a.description, 1000),
        category,
        priority: oneOf<TaskPriority>(a.priority, PRIORITIES, 'medium'),
        dueDate,
        assignedWorkerId: worker?.id,
        assignedWorkerName: worker?.name,
        checklist: Array.isArray(a.checklist) ? a.checklist.map(c => text(c, 120)).filter(Boolean).slice(0, 12) : undefined,
        links: project ? [projectLink(project)] : [],
        reminderAt: reminder?.iso,
        source: 'telegram',
        sourceEntryId: env.entryId,
        createdByUid: env.uid,
    });

    const ref = await taskRef(env.orgId, taskId);
    await recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path: ref.path, before: null, label: `zadatak „${title}"` });
    const created = (await ref.get()).data() as Task;
    const alias = `T${env.ctx.tasks.length + 1}`;
    env.ctx.tasks.push({ alias, value: created });
    env.created.taskIds.push(taskId);
    env.changes.push(`zadatak „${title}"`);

    return clean({
        ok: true,
        task: alias,
        title,
        reminder_label: reminder ? formatReminder(reminder.iso, env.tz, env.now) : undefined,
        worker: worker?.name,
        project: project ? projectLabel(project) : undefined,
    });
}

async function updateTaskTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const task = resolveAlias(env.ctx.tasks, a.task);
    if (!task) return { ok: false, error: `Zadatak ${String(a.task)} ne postoji u listi.` };
    const ref = await taskRef(env.orgId, task.Task_ID);
    const before = (await ref.get()).data() as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let reminderLabel: string | undefined;

    if (typeof a.status === 'string' && STATUSES.includes(a.status)) {
        patch.Status = a.status;
        patch.Completed_Date = a.status === 'completed' ? new Date().toISOString() : '';
        if (a.status === 'completed' || a.status === 'cancelled') patch.Reminder_Pending = false;
    }
    if (text(a.reminder_at)) {
        const r = resolveReminderAt({ text: env.dateText, now: env.now, tz: env.tz, modelLocal: text(a.reminder_at) });
        if (!r) return { ok: false, error: 'Novo vrijeme je nejasno ili u prošlosti. Pitaj korisnika (ask_user).' };
        // Rok koji je bio isti dan kao stari podsjetnik ide zajedno s njim.
        if (task.Reminder_At && task.Due_Date === toZoned(task.Reminder_At, env.tz).date) patch.Due_Date = r.date;
        Object.assign(patch, { Reminder_At: r.iso, Reminder_Pending: true, Reminder_Sent_At: '' });
        reminderLabel = formatReminder(r.iso, env.tz, env.now);
    }
    if (text(a.title)) patch.Title = text(a.title, 120);
    const added = Array.isArray(a.add_checklist) ? a.add_checklist.map(c => text(c, 120)).filter(Boolean).slice(0, 12) : [];
    if (added.length) {
        patch.Checklist = [...(task.Checklist || []), ...added.map(t => ({ id: uuidv4(), text: t, completed: false }))];
    }
    if (text(a.note)) {
        const line = `[${shortDay(env.now.toISOString(), env.tz)}] ${text(a.note, 500)}${env.reporter !== 'ja' ? ` (${env.reporter})` : ''}`;
        patch.Notes = task.Notes ? `${task.Notes}\n${line}` : line;
    }
    if (!Object.keys(patch).length) return { ok: false, error: 'Nema izmjena.' };

    await ref.update(patch);
    await recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path: ref.path, before, label: `zadatak „${task.Title}"` });
    Object.assign(task, patch);
    env.changes.push(`zadatak „${task.Title}"`);
    return clean({ ok: true, task: String(a.task), title: task.Title, status: patch.Status as string | undefined, reminder_label: reminderLabel });
}

function sameText(a?: string, b?: string): boolean {
    return foldText(a || '') === foldText(b || '');
}

async function rememberTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const subject = text(a.subject, 60).toLowerCase();
    const stateLabel = text(a.state_label, 80);
    if (!subject || !stateLabel) return { ok: false, error: 'Nedostaje predmet ili stanje.' };
    const location = text(a.location, 80);

    // Ista stvar na istoj lokaciji već postoji → dopuni nju.
    const existing = env.ctx.memory.find(m => sameText(m.value.Subject, subject) && sameText(m.value.Location, location));
    if (existing) {
        return updateMemoryTool(env, {
            item: existing.alias,
            state_label: stateLabel,
            quantity: a.quantity,
            spec: a.spec,
            note: text(a.note) || text(a.title) || stateLabel,
        });
    }

    const worker = resolveAlias(env.ctx.workers, a.worker);
    const project = resolveAlias(env.ctx.projects, a.project);
    const links: TaskLink[] = [];
    if (project) links.push(projectLink(project));
    if (worker) links.push({ Entity_Type: 'worker', Entity_ID: worker.id, Entity_Name: worker.name });

    const nowIso = env.now.toISOString();
    const item: MemoryItem = clean({
        Item_ID: uuidv4(),
        Organization_ID: env.orgId,
        Owner_UID: env.uid,
        Title: text(a.title, 120) || subject,
        Subject: subject,
        Quantity: number(a.quantity),
        Unit: text(a.unit, 12) || undefined,
        Spec: text(a.spec, 120) || undefined,
        Location: location || undefined,
        Links: links,
        State: 'open' as const,
        State_Label: stateLabel,
        Tags: Array.isArray(a.tags) ? a.tags.map(t => text(t, 30).toLowerCase()).filter(Boolean).slice(0, 8) : [],
        History: [clean({ At: nowIso, Text: text(a.note, 500) || text(a.title, 120) || stateLabel, By: env.reporter, Entry_ID: env.entryId })],
        Source_Entry_IDs: env.entryId ? [env.entryId] : [],
        Created_At: nowIso,
        Updated_At: nowIso,
    });

    const ref = memoryRef(item.Item_ID);
    await ref.set(item);
    await recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path: ref.path, before: null, label: `bilješka „${item.Title}"` });
    const alias = `M${env.ctx.memory.length + 1}`;
    env.ctx.memory.push({ alias, value: item });
    env.created.memoryIds.push(item.Item_ID);
    env.changes.push(`bilješka „${item.Title}"`);
    return { ok: true, item: alias, saved: memoryLine(alias, item, env.tz) };
}

async function updateMemoryTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const item = resolveAlias(env.ctx.memory, a.item) || resolveAlias(env.searchHits, a.item);
    if (!item) return { ok: false, error: `Stavka ${String(a.item)} ne postoji.` };
    const note = text(a.note, 500);
    if (!note) return { ok: false, error: 'Nedostaje bilješka (šta se desilo).' };

    const ref = memoryRef(item.Item_ID);
    const before = (await ref.get()).data() as Record<string, unknown> | undefined;
    if (!before) return { ok: false, error: 'Stavka je obrisana.' };

    const nowIso = env.now.toISOString();
    const next: MemoryItem = { ...item };
    if (a.resolved === true) { next.State = 'resolved'; next.Resolved_At = nowIso; }
    if (a.resolved === false) { next.State = 'open'; delete next.Resolved_At; }
    if (text(a.state_label)) next.State_Label = text(a.state_label, 80);
    if (number(a.quantity) !== undefined) next.Quantity = number(a.quantity);
    if (text(a.spec)) next.Spec = text(a.spec, 120);
    if (text(a.location)) next.Location = text(a.location, 80);
    next.History = [...(item.History || []), clean({ At: nowIso, Text: note, By: env.reporter, Entry_ID: env.entryId })];
    if (env.entryId && !item.Source_Entry_IDs?.includes(env.entryId)) next.Source_Entry_IDs = [...(item.Source_Entry_IDs || []), env.entryId];
    next.Updated_At = nowIso;

    await ref.set(clean(next as unknown as Record<string, unknown>));
    await recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path: ref.path, before, label: `bilješka „${item.Title}"` });
    Object.assign(item, next);
    if (!next.Resolved_At) delete item.Resolved_At;
    env.created.memoryIds.push(item.Item_ID);
    env.changes.push(`bilješka „${item.Title}"`);
    return { ok: true, item: String(a.item), now: memoryLine(String(a.item), next, env.tz) };
}

// ─── Pretraga ─────────────────────────────────────────────────────────

/** Koliko riječi upita se nađe u tekstu (0..1), s tolerancijom na padeže i tipfelere. */
export function textScore(query: string, haystack: string): number {
    const q = tokens(foldText(query)).filter(w => w.length > 1);
    if (!q.length) return 0;
    const h = tokens(foldText(haystack));
    let hit = 0;
    for (const w of q) {
        const sw = stem(w);
        if (h.some(x => x === w || stem(x) === sw || tokenSimilarity(w, x) >= 0.82)) hit++;
    }
    return hit / q.length;
}

function memoryHaystack(m: MemoryItem): string {
    return [m.Subject, m.Title, m.Spec, m.Location, m.State_Label, ...(m.Tags || []), ...(m.History || []).map(h => `${h.Text} ${h.By || ''}`)].join(' ');
}

async function searchMemoryTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const query = text(a.query, 120);
    if (!query) return { ok: false, error: 'Prazan upit.' };
    const since = new Date(env.now.getTime() - 180 * 86_400_000).toISOString();
    const [items, entries] = await Promise.all([
        listMemory(env.orgId, env.uid, a.include_resolved !== false),
        listEntriesSince(env.orgId, env.uid, since),
    ]);

    const itemHits = items
        .map(m => ({ m, s: textScore(query, memoryHaystack(m)) }))
        .filter(x => x.s >= 0.5)
        .sort((x, y) => y.s - x.s || y.m.Updated_At.localeCompare(x.m.Updated_At))
        .slice(0, 12);
    env.searchHits = itemHits.map((x, i) => ({ alias: `S${i + 1}`, value: x.m }));

    const entryHits = entries
        .map(e => ({ e, s: textScore(query, `${e.Raw_Text} ${e.Forward_From || ''}`) }))
        .filter(x => x.s >= 0.5)
        .sort((x, y) => y.s - x.s || y.e.Created_At.localeCompare(x.e.Created_At))
        .slice(0, 8);

    return {
        ok: true,
        items: env.searchHits.map(h => memoryLine(h.alias, h.value, env.tz)),
        messages: entryHits.map(({ e }) => `${shortDay(e.Forward_Date || e.Created_At, env.tz)} ${e.Forward_From ? `od ${e.Forward_From}` : 'ja'}: ${e.Raw_Text.slice(0, 300)}`),
    };
}

async function findMaterialTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const query = text(a.query, 80);
    if (!query) return { ok: false, error: 'Prazan upit.' };
    const snap = await adminDb().collection('materials').where('Organization_ID', '==', env.orgId).get();
    const hits = snap.docs
        .map(d => d.data() as Material)
        .map(m => ({ m, s: matchScore(query, [m.Name, `${m.Name} ${m.Category || ''}`]) }))
        .filter(x => x.s >= 0.7)
        .sort((x, y) => y.s - x.s)
        .slice(0, 6);
    return { ok: true, materials: hits.map(({ m }) => `${m.Name} (${m.Unit || 'kom'}${m.Category ? `, ${m.Category}` : ''})`) };
}

/** Oznake (W9, T6…) su interne — „Imer (W9)" → „Imer". Model ih ponekad ipak napiše. */
export function stripAliases(s: string): string {
    return s
        .replace(/\s*\((?:[WPMTS]\d+(?:\s*,\s*[WPMTS]\d+)*)\)/g, '')
        // Golo „W9" se briše, ali ne „M8" — to su vijci, ne oznaka.
        .replace(/\s*\b[WPTS]\d+\b(?=[\s,.:;)]|$)/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function askUserTool(env: ToolEnv, a: Args): ToolResult {
    const question = stripAliases(text(a.question, 300));
    const options = Array.isArray(a.options) ? a.options.map(o => stripAliases(text(o, 40))).filter(Boolean).slice(0, 4) : [];
    if (!question) return { ok: false, error: 'Prazno pitanje.' };
    env.question = { question, options };
    return { ok: true, note: 'Pitanje je poslano. Ne radi ništa više dok korisnik ne odgovori.' };
}

export async function runTool(env: ToolEnv, name: string, args: Args): Promise<ToolResult> {
    try {
        switch (name) {
            case 'create_task': return await createTaskTool(env, args);
            case 'update_task': return await updateTaskTool(env, args);
            case 'remember': return await rememberTool(env, args);
            case 'update_memory': return await updateMemoryTool(env, args);
            case 'search_memory': return await searchMemoryTool(env, args);
            case 'find_material': return await findMaterialTool(env, args);
            case 'ask_user': return askUserTool(env, args);
            default: return { ok: false, error: `Nepoznat alat ${name}.` };
        }
    } catch (e) {
        console.error(`[assistant] alat ${name} pao:`, e);
        return { ok: false, error: 'Upis nije uspio (greška na serveru).' };
    }
}
