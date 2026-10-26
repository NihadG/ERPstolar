// ════════════════════════════════════════════════════════════════════
// ALATI ASISTENTA — jedine radnje koje model smije izvesti.
//
// Model bira alat i šalje argumente; ovdje se SVE provjerava prije upisa:
// oznake (W#/P#/M#/T#/S#) se prevode u stvarne ID-jeve ili odbijaju,
// vrijeme podsjetnika potvrđuje lib/assistant/datetime prema tekstu
// korisnika, a svaka izmjena bilježi „prije" snimak za ↩️ Poništi.
// ════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import type Anthropic from '@anthropic-ai/sdk';
import { createTask, taskRef } from '@/lib/server/fieldWrites';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { isIsoDate } from '@/lib/voice/dates';
import { foldText, tokens, stem } from '@/lib/voice/text';
import { matchScore, tokenSimilarity } from '@/lib/voice/match';
import { formatReminder, resolveReminderAt, toZoned } from './datetime';
import { projectLabel, resolveAlias, type Aliased, type AssistantContext } from './context';
import { memoryLine, taskLine } from './prompt';
import { getAllTasks, getItemsForWorkOrders } from '@/lib/server/fieldRepo';
import { listEntriesSince, listMemory, memoryRef, recordOp } from './store';
import { formatQty, materialGroupKey, roundQty } from '@/lib/orderItemGroups';
import { planMaterialGroupOrder } from '@/lib/orderMaterialAllocation';
import { materialCoverage } from '@/lib/materialCoverage';
import {
    addMaterialToProduct, createDraftOrder, deleteOrderWithItems, getOrderWithItems, increaseMaterialNeed, listOrders,
    listOrdersWithItems, receiveOrderItems, revertOrderToDraft, sendOrder,
    loadProductMaterials, loadProjectMaterials, loadProjectProducts, type DraftLine, type OrderableRow, type WriteOp,
} from '@/lib/server/orderWrites';
import { loadDayProposal } from './dayProposals';
import type { DayProposal } from '@/lib/dayProposal';
import { bookEmptyDays, bookWorkDiary, finishItems, workLogReport, type DiaryAbsenceInput, type DiaryIssue, type DiaryLineInput } from '@/lib/server/workDiary';
import { dayLabel, diarySummary } from './diaryText';
import { coverage } from '@/lib/workDiary';
import {
    MEMORY_STATE_KEYS, MEMORY_STATES, isStateKey, locationKey, memoryTitle, normalizeLocation, parseDimensions, stateLabel, type MemoryStateKey,
} from './memoryRules';
import type { Material, MemoryItem, Product, Supplier, Task, TaskCategory, TaskLink, TaskPriority } from '@/lib/types';

const CATEGORIES = ['general', 'manufacturing', 'ordering', 'installation', 'design', 'meeting', 'reminder'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const bool = { type: 'boolean' } as const;
const strList = { type: 'array', items: { type: 'string' } } as const;
const enumOf = (values: string[]) => ({ type: 'string', enum: values }) as const;

/** Alati u Anthropic formatu (JSON Schema). Redoslijed je fiksan — dio keširanog prefiksa. */
export const TOOLS: Anthropic.Tool[] = [
    {
        name: 'create_task',
        description: 'Novi zadatak ili podsjetnik u ERP Zadacima. Za podsjetnik obavezno reminder_at.',
        input_schema: {
            type: 'object',
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
        input_schema: {
            type: 'object',
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
        description: 'Nova stavka bilježnice: stvar, gdje stoji i u kakvom je stanju. Naslov i oblik lokacije složi ERP. Mjere nisu obavezne — ne pitaj za njih.',
        input_schema: {
            type: 'object',
            properties: {
                subject: { ...str, description: 'Predmet u osnovnom obliku jednine: „ogledalo", „lajsna", „umivaonik".' },
                quantity: num,
                unit: { ...str, description: 'kom, m, m2, pak…' },
                spec: { ...str, description: 'Mjere i opis kako su rečeni: „1000x1350", „800 mm širine", „sva", „gornje".' },
                location: { ...str, description: 'Gdje stoji, kako je rečeno: „e004", „stan 308", „hodnik C5", „kombi".' },
                for_location: { ...str, description: 'Za koji stan je stvar ako stoji drugdje: „ogledalo za C502" na hodniku C5.' },
                state: { ...enumOf(MEMORY_STATE_KEYS), description: 'fali | nije_postavljeno (u stanu, nije postavljeno) | pogresno (pogrešno postavljeno) | ceka (stoji na hodniku/u kombiju) | naruceno | stiglo | postavljeno | info (mjera ili zabilješka, npr. „prolaz kliznih vrata 590").' },
                state_note: { ...str, description: 'Kratka dopuna stanja ako je rečena: „treba 1100x1000". Za info: sama zabilješka.' },
                project: { ...str, description: 'Oznaka P# ako se lokacija poklapa s projektom.' },
                worker: { ...str, description: 'Oznaka W# ako je stvar vezana za radnika.' },
                tags: strList,
                note: { ...str, description: 'Rečenica za istoriju (šta je rečeno).' },
            },
            required: ['subject', 'state'],
        },
    },
    {
        name: 'update_memory',
        description: 'Promjena stavke ili više stavki bilježnice (M# / S#): stanje, količina, mjere, lokacija. „Sve četiri su E308" = jedan poziv s items.',
        input_schema: {
            type: 'object',
            properties: {
                item: { ...str, description: 'Oznaka M# ili S#.' },
                items: { ...strList, description: 'Više stavki odjednom (ista izmjena na svima).' },
                state: { ...enumOf(MEMORY_STATE_KEYS), description: 'Novo stanje; postavljeno = gotovo.' },
                state_note: str,
                quantity: num,
                spec: { ...str, description: 'Nove mjere/opis kako su rečeni.' },
                location: { ...str, description: 'Nova lokacija kako je rečena.' },
                reopen: { ...bool, description: 'true = ponovo otvori riješenu stavku.' },
                note: { ...str, description: 'Šta se desilo, za istoriju: „Amer javio da su montirana".' },
            },
            required: ['note'],
        },
    },
    {
        name: 'search_memory',
        description: 'Pretraga cijele bilježnice (i riješenih stavki), SVIH zadataka (i dalekih i završenih) i starih poruka/izvještaja. Za sve čega nema u listama na kraju uputa.',
        input_schema: {
            type: 'object',
            properties: {
                query: { ...str, description: 'Ključne riječi: „ogledala 304".' },
                include_resolved: bool,
            },
            required: ['query'],
        },
    },
    {
        name: 'find_material',
        description: 'Stanje materijala: šta projekti još trebaju naručiti (O#: potrebno, naručeno, u nacrtu, ostalo) i artikli kataloga (K#). Za pitanja o stanju; za samu narudžbu nije potreban.',
        input_schema: {
            type: 'object',
            properties: {
                query: { ...str, description: 'Naziv materijala: „baglama", „iveral bijeli 18".' },
                project: { ...str, description: 'Oznaka P# ako je rečen projekat.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'create_order',
        description: 'Narudžba materijala (nacrt u ERP Narudžbama) + PDF korisniku. Stavku zadaj nazivom (material + project) — find_material nije potreban; ako naziv nije jednoznačan, alat vrati kandidate s oznakama. Jedan dobavljač = jedna narudžba; više dobavljača se samo razdvoji.',
        input_schema: {
            type: 'object',
            properties: {
                lines: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            material: { ...str, description: 'Naziv materijala iz poruke: „baglama".' },
                            project: { ...str, description: 'Oznaka P#; bez projekta = zaliha iz kataloga.' },
                            product: { ...str, description: 'Naziv proizvoda ako je rečen (ili odgovor na pitanje kojem proizvodu) — tu ide novi materijal ili višak.' },
                            unit: { ...str, description: 'Jedinica za materijal kojeg nema ni u katalogu (kom, m, m2…).' },
                            ref: { ...str, description: 'Umjesto naziva: O# ili K# iz find_material / kandidata.' },
                            quantity: { ...num, description: 'Tačno rečena količina. Izostavi za materijal projekta kad treba sav ostatak.' },
                        },
                    },
                },
                supplier: { ...str, description: 'Dobavljač ako ga je korisnik rekao (inače onaj s materijala). Uz all_missing: samo materijali tog dobavljača.' },
                expected_delivery: { ...str, description: 'Očekivana isporuka YYYY-MM-DD ako je rečena.' },
                note: { ...str, description: 'Napomena za dobavljača ako je rečena.' },
                all_missing: { ...bool, description: '„Naruči sve što fali za…": svi materijali projekta s ostatkom za naručiti, bez lines. Traži project.' },
                project: { ...str, description: 'Uz all_missing: oznaka P#.' },
                product: { ...str, description: 'Uz all_missing: samo materijali tog proizvoda („za kuhinju").' },
            },
        },
    },
    {
        name: 'product_materials',
        description: 'Sastavnica iz Projekti → proizvod → Materijali: materijali proizvoda s količinom, cijenom, statusom i naručeno/primljeno. Za „koje materijale ima kuhinja…", „šta je definisano za…".',
        input_schema: {
            type: 'object',
            properties: {
                project: { ...str, description: 'Oznaka P#.' },
                product: { ...str, description: 'Naziv proizvoda (neobavezno — bez njega svi proizvodi projekta).' },
                material: { ...str, description: 'Samo materijali ovog naziva (neobavezno).' },
            },
            required: ['project'],
        },
    },
    {
        name: 'list_orders',
        description: 'Postojeće narudžbe iz ERP-a (nacrti, poslane, primljene) sa stavkama. Za pitanja „koje narudžbe imam za…", „šta je naručeno kod…", „šta čeka slanje".',
        input_schema: {
            type: 'object',
            properties: {
                project: { ...str, description: 'Oznaka P#.' },
                supplier: str,
                status: { ...enumOf(['Nacrt', 'Poslano', 'Primljeno', 'otvorene']), description: 'otvorene = nacrt ili poslano (još nije stiglo).' },
            },
        },
    },
    {
        name: 'manage_order',
        description: 'Radnja nad postojećom narudžbom (i onom napravljenom u ERP-u): send = poslano dobavljaču, receive = stiglo (sve ili samo neki materijali), draft = vrati u nacrt, delete = obriši. Broj iz list_orders.',
        input_schema: {
            type: 'object',
            properties: {
                number: { ...str, description: 'Broj narudžbe ili njegov dio („K7").' },
                action: enumOf(['send', 'receive', 'draft', 'delete']),
                materials: { ...strList, description: 'receive: samo ovi materijali (djelimičan prijem). Bez toga = sve stavke.' },
                confirmed: { ...bool, description: 'delete: true tek kad je korisnik potvrdio brisanje.' },
            },
            required: ['number', 'action'],
        },
    },
    {
        name: 'log_work',
        description: 'Dnevni upis rada: ko je na čemu radio, koji proces, koliki dio dana, šta je završeno; i ko je bio odsutan. ERP sam nađe nalog, proces iz kataloga, raspodijeli dnevnicu, dopuni graf naloga i čekira procese.',
        input_schema: {
            type: 'object',
            properties: {
                date: { ...str, description: 'Dan rada YYYY-MM-DD iz kalendara (bez toga = danas; „jučer" = jučerašnji datum).' },
                lines: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            workers: { ...strList, description: 'Oznake radnika W#.' },
                            work: { ...str, description: 'Posao kako je rečen: „kuhinja Čorluka", „vrata Meliha", „Budnjo stolovi".' },
                            order: { ...str, description: 'R# naloga (iz liste NALOZI ili kandidata) kad je nalog jasan.' },
                            orders: { ...strList, description: 'Više naloga odjednom (R#): „sve za Čorluku osim vrata". Dan se dijeli ravnomjerno na naloge.' },
                            finish_all: { ...bool, description: 'true kad je rečeno da su proizvodi gotovi („sve zapakovali", „završi sve procese") — svi procesi tih proizvoda završeni.' },
                            like_last: { ...bool, description: '„Isto kao jučer" / „nastavio isto": radnik radi što i zadnji potvrđeni dan (ERP zna posao i sljedeći korak). Bez work.' },
                            process: { ...str, description: 'Proces kako je rečen, s riječju koja ga razlikuje ako je rečena: „krojenje iverala", „kantiranje", „kantiranje fronti", „brušenje Kerrocka". ERP bira proces iz plana proizvoda.' },
                            also: { ...strList, description: 'Dodatni procesi na istom poslu taj dan.' },
                            fraction: { ...num, description: 'Dio dana ako je rečen: pola dana = 0.5, dva sata = 0.25.' },
                            done: { ...bool, description: 'true kad je rečeno da je proces završen („završio", „gotovo").' },
                            new_process: { ...bool, description: 'true tek kad je korisnik potvrdio da je proces nov.' },
                        },
                        required: ['workers'],
                    },
                },
                absent: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: { worker: str, status: enumOf(['Bolovanje', 'Odmor', 'Odsutan']) },
                        required: ['worker', 'status'],
                    },
                },
            },
        },
    },
    {
        name: 'fill_work_days',
        description: 'Popuni radnicima dane BEZ potvrđenog upisa u periodu (bez perioda = ova sedmica do danas) radom na navedenim nalozima. ERP sam nađe prazne dane, zamijeni automatsku podjelu iz prisustva, preskoči odsutne i vikende, podijeli dan na naloge. Za „popuni im prazne dane", „i ranije dane koji nisu popunjeni".',
        input_schema: {
            type: 'object',
            properties: {
                workers: { ...strList, description: 'Oznake radnika W#.' },
                orders: { ...strList, description: 'Nalozi R# iz liste NALOZI.' },
                from: { ...str, description: 'Od YYYY-MM-DD (bez toga = ponedjeljak ove sedmice).' },
                to: { ...str, description: 'Do YYYY-MM-DD (bez toga = danas).' },
                finish_all: { ...bool, description: 'true kad su proizvodi tih naloga gotovi — svi procesi završeni.' },
            },
            required: ['workers', 'orders'],
        },
    },
    {
        name: 'work_report',
        description: 'Pregled upisanog rada: ko je radio na čemu i koji proces, za dan ili period, po radniku ili poslu. Za „ko je danas na čemu", „šta je rađeno na kuhinji Čorluka", „šta je Amer radio ove sedmice".',
        input_schema: {
            type: 'object',
            properties: {
                from: { ...str, description: 'Od YYYY-MM-DD (bez toga = danas).' },
                to: { ...str, description: 'Do YYYY-MM-DD (bez toga = isto kao from).' },
                worker: { ...str, description: 'Oznaka W#.' },
                work: { ...str, description: 'Posao/nalog/proizvod: „kuhinja Čorluka".' },
            },
        },
    },
    {
        name: 'order_pdf',
        description: 'Pošalji PDF postojeće narudžbe. Bez broja → zadnja narudžba (za projekat/dobavljača ako su rečeni).',
        input_schema: {
            type: 'object',
            properties: {
                number: { ...str, description: 'Broj narudžbe ili njegov dio („K7").' },
                project: { ...str, description: 'Oznaka P#.' },
                supplier: str,
            },
        },
    },
    {
        name: 'ask_user',
        description: 'Postavi korisniku JEDNO kratko pitanje s 2–4 opcije. Poslije ovoga ne radi ništa dok ne odgovori.',
        input_schema: {
            type: 'object',
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
    /** Potvrde za korisnika, po jedna po upisu — od njih se složi odgovor bez drugog poziva modela. */
    summaries: string[];
    question?: { question: string; options: string[] };
    /** Rezultati find_material: materijali projekata (O#) i katalog (K#). */
    orderGroups?: Aliased<OrderGroup>[];
    catalogHits?: Aliased<Material>[];
    /** Narudžbe čiji PDF ide korisniku poslije odgovora (`draft` = dugme „Poslano"). */
    documents?: { orderId: string; draft: boolean }[];
    /** Kandidati naloga (R#) kad dnevni upis nije znao koji nalog. */
    diaryCandidates?: Aliased<string>[];
    /** „O3 Baglama ravna · Kuhinja Grbavica" — legenda oznaka ove poruke za istoriju modela. */
    refNotes?: string[];
    /** Stavke bilježnice upisane ovom porukom — dobijaju dugmad stanja ispod potvrde. */
    touchedMemory?: MemoryItem[];
    /** Učitano iz baze tokom ove poruke (materijali projekata, katalog). */
    cache?: { rows?: { key: string; value: OrderableRow[] }; catalog?: Material[] };
}

/** Isti materijal na više pozicija jednog projekta = jedan red za naručivanje. */
export interface OrderGroup {
    projectId: string;
    projectName: string;
    name: string;
    unit: string;
    rows: OrderableRow[];
    /** Vraćena iz sesije (ranija poruka) — redovi se osvježe prije upotrebe. */
    restored?: boolean;
}

/**
 * Alati čiji rezultat korisniku pokazuje sam sistem. Kad je model pozvao
 * samo njih i svi su uspjeli, odgovor se složi iz `summaries` — drugi
 * poziv modela bi samo prepričao isto, uz trošak i sekundu-dvije čekanja.
 */
export const WRITE_TOOLS = new Set(['create_task', 'update_task', 'remember', 'update_memory', 'create_order', 'manage_order', 'order_pdf', 'log_work', 'fill_work_days']);

function qtyLabel(m: MemoryItem): string {
    return m.Quantity != null ? `${m.Quantity} ${m.Unit || 'kom'} ` : '';
}

function memorySummary(m: MemoryItem): string {
    const where = m.Location ? ` · ${m.Location}` : '';
    const spec = m.Spec ? ` (${m.Spec})` : '';
    return `${m.State === 'resolved' ? '✔' : '📒'} ${qtyLabel(m)}${m.Title}${spec}${where} — ${m.State_Label}`;
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
    const reminderLabel = reminder ? formatReminder(reminder.iso, env.tz, env.now) : undefined;
    env.summaries.push([
        `✅ ${title}${reminderLabel ? ` — ${reminderLabel}` : dueDate ? ` — rok ${dueDate}` : ''}${worker ? ` · ${worker.name}` : ''}`,
        ...(project ? [`📁 ${projectLabel(project)}`] : []),
        ...(created.Checklist || []).map(c => `☐ ${c.text}`),
    ].join('\n'));

    return clean({
        ok: true,
        task: alias,
        title,
        reminder_label: reminderLabel,
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
    const lines: string[] = [];
    if (patch.Status === 'completed') lines.push(`✅ Urađeno: ${task.Title}`);
    else if (patch.Status === 'cancelled') lines.push(`✖ Otkazano: ${task.Title}`);
    else if (patch.Status) lines.push(`↺ ${task.Title} — ${patch.Status === 'in_progress' ? 'u toku' : 'ponovo otvoreno'}`);
    if (reminderLabel) lines.push(`⏰ ${task.Title} → ${reminderLabel}`);
    if (added.length) lines.push(`➕ ${task.Title}:`, ...added.map(t => `☐ ${t}`));
    if (!lines.length) lines.push(`✏️ ${task.Title}${text(a.note) ? `: ${text(a.note, 200)}` : ''}`);
    env.summaries.push(lines.join('\n'));
    return clean({ ok: true, task: String(a.task), title: task.Title, status: patch.Status as string | undefined, reminder_label: reminderLabel });
}

function sameText(a?: string, b?: string): boolean {
    return foldText(a || '') === foldText(b || '');
}

/** Poznate lokacije bilježnice — po njima ERP ispravlja „308" u E308. */
const knownLocations = (env: ToolEnv) => [...env.ctx.memory, ...env.searchHits].map(m => m.value.Location || '').filter(Boolean);

/** Lokacija kako je rečena → oblik iz bilježnice; nejasno → poruka za pitanje korisniku. */
function resolveLocation(env: ToolEnv, raw: unknown): { location: string } | { error: string } {
    const r = normalizeLocation(text(raw, 80), knownLocations(env));
    if ('ambiguous' in r) return { error: `Lokacija „${text(raw, 80)}" nije jednoznačna. Pitaj korisnika (ask_user) s opcijama: ${r.ambiguous.join(', ')}; pa ponovi s tačnom lokacijom.` };
    return r;
}

/** Stanje iz poziva: fiksni ključ (+ dopuna); stari state_label ostaje kao rezerva. */
function stateOf(a: Args): { key?: MemoryStateKey; label: string } | null {
    if (isStateKey(a.state)) return { key: a.state, label: stateLabel(a.state, text(a.state_note, 80)) };
    const legacy = text(a.state_label, 80);
    return legacy ? { label: legacy } : null;
}

async function rememberTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const subject = text(a.subject, 60).toLowerCase();
    const state = stateOf(a);
    if (!subject || !state) return { ok: false, error: 'Nedostaje predmet ili stanje.' };
    const loc = resolveLocation(env, a.location);
    if ('error' in loc) return { ok: false, error: loc.error };
    const forLoc = text(a.for_location) ? resolveLocation(env, a.for_location) : { location: '' };
    if ('error' in forLoc) return { ok: false, error: forLoc.error };
    const location = loc.location;
    const { dims, rest } = parseDimensions(text(a.spec, 120));
    const title = memoryTitle(subject, dims, forLoc.location || undefined);

    // Ista stvar (predmet + mjere) na istoj lokaciji već postoji → dopuni nju.
    const existing = env.ctx.memory.find(m => sameText(m.value.Subject, subject) && sameText(m.value.Title, title)
        && locationKey(m.value.Location) === locationKey(location));
    if (existing) {
        return updateMemoryTool(env, {
            item: existing.alias,
            ...(state.key ? { state: state.key, state_note: a.state_note } : { state_label: state.label }),
            quantity: a.quantity,
            ...(rest ? { spec: rest } : {}),
            note: text(a.note) || state.label,
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
        Title: title,
        Subject: subject,
        Quantity: number(a.quantity),
        Unit: text(a.unit, 12) || undefined,
        Spec: rest || undefined,
        Location: location || undefined,
        Links: links,
        State: state.key && MEMORY_STATES[state.key].resolved ? 'resolved' as const : 'open' as const,
        State_Label: state.label,
        ...(state.key ? { State_Key: state.key } : {}),
        ...(state.key && MEMORY_STATES[state.key].resolved ? { Resolved_At: env.now.toISOString() } : {}),
        Tags: Array.isArray(a.tags) ? a.tags.map(t => text(t, 30).toLowerCase()).filter(Boolean).slice(0, 8) : [],
        History: [clean({ At: nowIso, Text: text(a.note, 500) || state.label, By: env.reporter, Entry_ID: env.entryId })],
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
    env.summaries.push(memorySummary(item));
    env.touchedMemory = [...(env.touchedMemory || []), item];
    return { ok: true, item: alias, saved: memoryLine(alias, item, env.tz) };
}

/**
 * Promjena stanja stavke — ista pravila za alat i za dugme ispod potvrde
 * (dugme ne zove model): fiksno stanje, „postavljeno" zatvara, ostala otvaraju.
 */
export function applyMemoryState(item: MemoryItem, key: MemoryStateKey, note: string | undefined, nowIso: string): MemoryItem {
    const next: MemoryItem = { ...item, State_Key: key, State_Label: stateLabel(key, note) };
    if (MEMORY_STATES[key].resolved) { next.State = 'resolved'; next.Resolved_At = nowIso; }
    else { next.State = 'open'; delete next.Resolved_At; }
    return next;
}

/**
 * Dugme ispod potvrde (`mem:<id>:p`): stanje stavke bez poziva modela. Samo vlasnik;
 * ide u ↩️ istoriju kao i svaki upis (turnId `mem-<id>-<vrijeme>`).
 */
export async function memoryButtonState(orgId: string, uid: string, itemId: string, key: MemoryStateKey, now = new Date()): Promise<{ ok: true; line: string } | { ok: false; error: string }> {
    const ref = memoryRef(itemId);
    const before = (await ref.get()).data() as MemoryItem | undefined;
    if (!before || before.Organization_ID !== orgId || before.Owner_UID !== uid) return { ok: false, error: 'Stavka više ne postoji.' };
    const nowIso = now.toISOString();
    const next = applyMemoryState(before, key, undefined, nowIso);
    next.History = [...(before.History || []), { At: nowIso, Text: `Označeno dugmetom: ${next.State_Label}`, By: 'ja' }];
    next.Updated_At = nowIso;
    await ref.set(clean(next as unknown as Record<string, unknown>));
    await recordOp({ turnId: `mem-${itemId}-${nowIso}`, uid, orgId, path: ref.path, before: before as unknown as Record<string, unknown>, label: `bilješka „${before.Title}"` });
    return { ok: true, line: memorySummary(next) };
}

async function updateMemoryTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const aliases = [...(text(a.item, 8) ? [a.item] : []), ...(Array.isArray(a.items) ? a.items : [])].slice(0, 40);
    if (!aliases.length) return { ok: false, error: 'Navedi stavku (M# ili S#).' };
    const found = aliases.map(x => resolveAlias(env.ctx.memory, x) || resolveAlias(env.searchHits, x));
    const missing = aliases.find((_, i) => !found[i]);
    if (missing !== undefined) return { ok: false, error: `Stavka ${String(missing)} ne postoji.` };
    const note = text(a.note, 500);
    if (!note) return { ok: false, error: 'Nedostaje bilješka (šta se desilo).' };
    const loc = text(a.location) ? resolveLocation(env, a.location) : null;
    if (loc && 'error' in loc) return { ok: false, error: loc.error };

    const nowIso = env.now.toISOString();
    const saved: string[] = [];
    for (const [i, item] of (found as MemoryItem[]).entries()) {
        const ref = memoryRef(item.Item_ID);
        const before = (await ref.get()).data() as Record<string, unknown> | undefined;
        if (!before) return { ok: false, error: `Stavka ${String(aliases[i])} je obrisana.` };

        let next: MemoryItem = { ...item };
        if (isStateKey(a.state)) next = applyMemoryState(next, a.state, text(a.state_note, 80), nowIso);
        else if (text(a.state_label)) next.State_Label = text(a.state_label, 80);   // stariji poziv
        if (a.resolved === true) { next.State = 'resolved'; next.Resolved_At = nowIso; }
        if (a.resolved === false || a.reopen === true) { next.State = 'open'; delete next.Resolved_At; }
        if (number(a.quantity) !== undefined) next.Quantity = number(a.quantity);
        if (text(a.spec)) {
            const { dims, rest } = parseDimensions(text(a.spec, 120));
            if (dims) next.Title = memoryTitle(item.Subject, dims);
            next.Spec = rest || undefined;
        }
        if (loc) next.Location = loc.location;
        next.History = [...(item.History || []), clean({ At: nowIso, Text: note, By: env.reporter, Entry_ID: env.entryId })];
        if (env.entryId && !item.Source_Entry_IDs?.includes(env.entryId)) next.Source_Entry_IDs = [...(item.Source_Entry_IDs || []), env.entryId];
        next.Updated_At = nowIso;

        await ref.set(clean(next as unknown as Record<string, unknown>));
        await recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path: ref.path, before, label: `bilješka „${item.Title}"` });
        Object.keys(item).forEach(k => { if (!(k in next)) delete (item as unknown as Record<string, unknown>)[k]; });
        Object.assign(item, next);
        env.created.memoryIds.push(item.Item_ID);
        env.changes.push(`bilješka „${item.Title}"`);
        env.touchedMemory = [...(env.touchedMemory || []), item];
        saved.push(memoryLine(String(aliases[i]), next, env.tz));
    }
    const done = found as MemoryItem[];
    env.summaries.push(done.length > 1 && loc && !a.state
        ? [`📒 ${done.length} stavke → ${loc.location}`, ...done.map(m => `• ${memorySummary(m).replace(/^\S+ /, '')}`)].join('\n')
        : done.map(memorySummary).join('\n'));
    return { ok: true, items: saved };
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
    const [items, entries, allTasks] = await Promise.all([
        listMemory(env.orgId, env.uid, a.include_resolved !== false),
        listEntriesSince(env.orgId, env.uid, since),
        getAllTasks(env.orgId),
    ]);

    // Zadaci kojih nema u skraćenoj listi (daleki, stariji, završeni) dobiju
    // novu T-oznaku, da ih model odmah može i izmijeniti.
    const known = new Set(env.ctx.tasks.map(t => t.value.Task_ID));
    const taskHits = allTasks
        .filter(t => !known.has(t.Task_ID))
        .map(t => ({ t, s: textScore(query, [t.Title, t.Description, t.Notes, t.Assigned_Worker_Name, ...(t.Checklist || []).map(c => c.text), ...(t.Links || []).map(l => l.Entity_Name)].join(' ')) }))
        .filter(x => x.s >= 0.5)
        .sort((x, y) => y.s - x.s || String(y.t.Created_Date).localeCompare(String(x.t.Created_Date)))
        .slice(0, 8);
    const taskLines = taskHits.map(({ t }) => {
        const alias = `T${env.ctx.tasks.length + 1}`;
        env.ctx.tasks.push({ alias, value: t });
        const state = t.Status === 'completed' ? 'ZAVRŠEN' : t.Status === 'cancelled' ? 'OTKAZAN' : t.Status === 'in_progress' ? 'u toku' : 'otvoren';
        return `${taskLine(alias, t, env.tz, env.now)} | ${state}`;
    });

    const itemHits = items
        .map(m => ({ m, s: textScore(query, memoryHaystack(m)) }))
        .filter(x => x.s >= 0.5)
        .sort((x, y) => y.s - x.s || y.m.Updated_At.localeCompare(x.m.Updated_At))
        .slice(0, 12);
    // Numeracija se nastavlja: S# iz ranije poruke i dalje znači isto.
    const sbase = env.searchHits.length;
    const fresh = itemHits.map((x, i) => ({ alias: `S${sbase + i + 1}`, value: x.m }));
    env.searchHits = [...env.searchHits, ...fresh];
    noteRefs(env, fresh.map(h => `${h.alias} ${h.value.Title}${h.value.Location ? ` · ${h.value.Location}` : ''}`));

    const entryHits = entries
        .map(e => ({ e, s: textScore(query, `${e.Raw_Text} ${e.Forward_From || ''}`) }))
        .filter(x => x.s >= 0.5)
        .sort((x, y) => y.s - x.s || y.e.Created_At.localeCompare(x.e.Created_At))
        .slice(0, 8);

    return {
        ok: true,
        items: fresh.map(h => memoryLine(h.alias, h.value, env.tz)),
        tasks: taskLines,
        messages: entryHits.map(({ e }) => `${shortDay(e.Forward_Date || e.Created_At, env.tz)} ${e.Forward_From ? `od ${e.Forward_From}` : 'ja'}: ${e.Raw_Text.slice(0, 300)}`),
    };
}

// ─── Narudžbe ─────────────────────────────────────────────────────────

const q = (n: number) => formatQty(n);

function groupLine(alias: string, g: OrderGroup): string {
    const sum = (k: 'needed' | 'onStock' | 'ordered' | 'received' | 'inDrafts' | 'available') => g.rows.reduce((s, r) => s + r[k], 0);
    const suppliers = Array.from(new Set(g.rows.map(r => r.supplier).filter(Boolean)));
    const products = Array.from(new Set(g.rows.map(r => r.productName)));
    return [
        alias, `${g.name} (${g.unit})`, `projekat: ${g.projectName}`,
        `treba ${q(sum('needed'))}`,
        ...(sum('onStock') ? [`na stanju ${q(sum('onStock'))}`] : []),
        `naručeno ${q(sum('ordered'))}`, `primljeno ${q(sum('received'))}`,
        ...(sum('inDrafts') ? [`u nacrtu ${q(sum('inDrafts'))}`] : []),
        `OSTALO ZA NARUČITI ${q(sum('available'))}`,
        `dobavljač: ${suppliers.join(', ') || '—'}`,
        `pozicije: ${products.slice(0, 4).join(', ')}${products.length > 4 ? '…' : ''}`,
    ].join(' | ');
}

type ProjectRef = AssistantContext['projects'][number]['value'];

/**
 * Materijali projekata (O#) i katalog (K#) koji odgovaraju upitu, s novim
 * oznakama. Učitano se pamti za ovu poruku — druga stavka iste narudžbe
 * ne čita bazu ponovo.
 */
async function searchOrderables(env: ToolEnv, query: string, project: ProjectRef | null): Promise<{ groups: Aliased<OrderGroup>[]; catalog: Aliased<Material>[] }> {
    const projects = project ? [project] : env.ctx.projects.map(p => p.value);
    const nameOf = new Map(projects.map(p => [p.id, projectLabel(p)]));
    const key = projects.map(p => p.id).join(',');
    env.cache = env.cache || {};
    const cache = env.cache;

    const [rows, catalogAll] = await Promise.all([
        cache.rows?.key === key ? cache.rows.value : loadProjectMaterials(env.orgId, projects.map(p => p.id)),
        cache.catalog || adminDb().collection('materials').where('Organization_ID', '==', env.orgId).get()
            .then(s => s.docs.map(d => d.data() as Material)),
    ]);
    cache.rows = { key, value: rows };
    cache.catalog = catalogAll;

    const groups = new Map<string, OrderGroup>();
    for (const r of rows) {
        if (matchScore(query, [r.name]) < 0.7) continue;
        const key = `${r.projectId}::${materialGroupKey(r.name, r.unit)}`;
        const g = groups.get(key) || { projectId: r.projectId, projectName: nameOf.get(r.projectId) || 'Projekat', name: r.name, unit: r.unit, rows: [] };
        g.rows.push(r);
        groups.set(key, g);
    }
    // Prvo ono što još treba naručiti, pa ostalo (da model vidi i „već naručeno").
    const ranked = Array.from(groups.values())
        .sort((x, y) => Number(y.rows.some(r => r.available > 0)) - Number(x.rows.some(r => r.available > 0)) || x.projectName.localeCompare(y.projectName, 'bs'))
        .slice(0, 10);
    const base = env.orderGroups?.length || 0;
    const aliased = ranked.map((g, i) => ({ alias: `O${base + i + 1}`, value: g }));
    env.orderGroups = [...(env.orderGroups || []), ...aliased];

    const catalog = catalogAll
        .map(m => ({ m, s: matchScore(query, [m.Name, `${m.Name} ${m.Category || ''}`]) }))
        .filter(x => x.s >= 0.7)
        .sort((x, y) => y.s - x.s)
        .slice(0, 6);
    const cbase = env.catalogHits?.length || 0;
    const catAliased = catalog.map(({ m }, i) => ({ alias: `K${cbase + i + 1}`, value: m }));
    env.catalogHits = [...(env.catalogHits || []), ...catAliased];
    noteRefs(env, [
        ...aliased.map(g => `${g.alias} ${g.value.name} · ${g.value.projectName}`),
        ...catAliased.map(c => `${c.alias} ${c.value.Name} (katalog)`),
    ]);
    return { groups: aliased, catalog: catAliased };
}

/**
 * Grupa iz ranije poruke (oznaka sačuvana preko pitanja) nosi količine od tada —
 * prije naručivanja se redovi čitaju ponovo iz baze.
 */
async function freshGroup(env: ToolEnv, group: OrderGroup | null): Promise<OrderGroup | null> {
    if (!group || !group.restored) return group;
    const rows = (await loadProjectMaterials(env.orgId, [group.projectId]))
        .filter(r => materialGroupKey(r.name, r.unit) === materialGroupKey(group.name, group.unit));
    return rows.length ? { ...group, rows, restored: false } : null;
}

/** Legenda oznaka za istoriju modela (bez duplikata). */
function noteRefs(env: ToolEnv, notes: string[]): void {
    env.refNotes = Array.from(new Set([...(env.refNotes || []), ...notes]));
}

function catalogLine(alias: string, m: Material): string {
    return `${alias} | ${m.Name} (${m.Unit || 'kom'}) | dobavljač: ${m.Default_Supplier || '—'}`;
}

async function findMaterialTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const query = text(a.query, 80);
    if (!query) return { ok: false, error: 'Prazan upit.' };
    const project = a.project ? resolveAlias(env.ctx.projects, a.project) : null;
    if (a.project && !project) return { ok: false, error: `Projekat ${String(a.project)} ne postoji u listi.` };
    const { groups: aliased, catalog: catAliased } = await searchOrderables(env, query, project);
    return {
        ok: true,
        project_materials: aliased.map(g => groupLine(g.alias, g.value)),
        catalog: catAliased.map(({ alias, value }) => catalogLine(alias, value)),
        ...(aliased.length || catAliased.length ? {} : { note: 'Nema ni na projektima ni u katalogu. Pitaj korisnika tačan naziv.' }),
    };
}

/** Izmjena sastavnice koju narudžba nosi — upisuje se tek kad su sve stavke ispravne. */
type BomChange =
    | { kind: 'increase'; materialId: string; extra: number; productName: string }
    | { kind: 'add'; product: Product; catalogId: string; name: string; unit: string; unitPrice: number; supplier: string; quantity: number; projectId: string };

interface PlannedLine extends DraftLine {
    supplier: string;
    projectIds: string[];
    label: string;
    bom?: BomChange;
}

function pickProduct(products: Product[], name: string): Product | undefined {
    if (!name) return products.length === 1 ? products[0] : undefined;
    return products
        .map(p => ({ p, s: matchScore(name, [p.Name || '']) }))
        .filter(x => x.s >= 0.7)
        .sort((x, y) => y.s - x.s)[0]?.p;
}

function mostCommon(values: string[]): string {
    const counts = new Map<string, number>();
    values.filter(Boolean).forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    return Array.from(counts.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
}

/**
 * Stavka zadata nazivom („baglama" + projekat) umjesto oznakom: kad je
 * jednoznačna, narudžba nastaje bez prethodnog find_material — jedan poziv
 * modela manje. Inače se vraćaju kandidati s oznakama, pa model bira ili pita.
 */
async function resolveByName(env: ToolEnv, line: Args): Promise<{ group?: OrderGroup; item?: Material; fresh?: { project: ProjectRef; name: string } } | string> {
    const material = text(line.material, 80);
    const project = line.project ? resolveAlias(env.ctx.projects, line.project) : null;
    if (line.project && !project) return `Projekat ${String(line.project)} ne postoji u listi.`;
    const { groups, catalog } = await searchOrderables(env, material, project);
    // Dva različita materijala („baglama ravna" / „kutna") = pitanje, ne pogađanje.
    // Isti materijal na više projekata: bira se jedini koji još nešto treba.
    const distinct = new Set(groups.map(g => materialGroupKey(g.value.name, g.value.unit)));
    const open = groups.filter(g => g.value.rows.some(r => r.available > 0));
    const group = distinct.size !== 1 ? undefined : groups.length === 1 ? groups[0] : open.length === 1 ? open[0] : undefined;
    if (group) return { group: group.value };
    // Projekat je rečen, a materijala nema u sastavnici → dodaje se proizvodu.
    if (project && !groups.length) {
        const exact = catalog.find(c => foldText(c.value.Name) === foldText(material));
        if (exact || catalog.length === 1) return { item: (exact || catalog[0]).value, fresh: { project, name: material } };
        if (!catalog.length) return { fresh: { project, name: material } };
    }
    if (!project && !groups.length && catalog.length === 1) return { item: catalog[0].value };
    if (!groups.length && !catalog.length) return `„${material}" nema ni na projektima ni u katalogu. Reci projekat (dodaće se u sastavnicu) ili pitaj tačan naziv.`;
    return [
        `„${material}" nije jednoznačno — ponovi create_order s ref ili pitaj korisnika (ask_user):`,
        ...groups.map(g => groupLine(g.alias, g.value)),
        ...catalog.map(c => catalogLine(c.alias, c.value)),
    ].join('\n');
}

/**
 * Jedna stavka zahtjeva → raspodjela na materijale projekta. Količina preko
 * potrebe povećava potrebu materijala (sastavnica → trošak → profit), isto
 * kao „povećaj potrebu" u čarobnjaku; samo narudžba bez projekta ide za zalihu.
 */
async function planLine(env: ToolEnv, line: Args, supplierOverride: string): Promise<PlannedLine | string> {
    const ref = text(line.ref, 8).toUpperCase();
    // Rečena količina mora biti pozitivna — „-5" ili 0 nije „sav ostatak".
    if (line.quantity != null && !(typeof line.quantity === 'number' && line.quantity > 0)) {
        return `Količina „${String(line.quantity)}" nije ispravna. Pitaj korisnika koliko.`;
    }
    const wanted = number(line.quantity);
    let group = ref ? await freshGroup(env, resolveAlias(env.orderGroups || [], ref)) : null;
    let byName: Material | undefined;
    let fresh: { project: ProjectRef; name: string } | undefined;
    if (!ref && text(line.material)) {
        const found = await resolveByName(env, line);
        if (typeof found === 'string') return found;
        group = found.group || null;
        byName = found.item;
        fresh = found.fresh;
    }
    // K# uz projekat = novi materijal u sastavnici tog projekta.
    if (ref && !group && line.project) {
        const project = resolveAlias(env.ctx.projects, line.project);
        if (!project) return `Projekat ${String(line.project)} ne postoji u listi.`;
        byName = resolveAlias(env.catalogHits || [], ref) || undefined;
        if (byName) fresh = { project, name: byName.Name };
    }
    if (group) return planGroup(group, wanted, text(line.product, 80), supplierOverride);
    return planOther(env, line, wanted, ref, byName, fresh, supplierOverride);
}

/** Materijal projekta (grupa istih materijala na više pozicija) → stavka narudžbe. */
function planGroup(group: OrderGroup, wanted: number | undefined, named: string, supplierOverride: string): PlannedLine | string {
    const available = roundQty(group.rows.reduce((s, r) => s + r.available, 0));
    const quantity = wanted ?? available;
    if (!(quantity > 0)) return `${group.name} za ${group.projectName}: ništa ne ostaje za naručiti (već naručeno ili u nacrtu). Reci količinu ako treba više — dodaće se u sastavnicu.`;
    const candidates = group.rows.filter(r => r.available > 0);
    // Višak ide materijalu rečenog proizvoda, inače onom s najvećom potrebom.
    const assigned = (named && group.rows.find(r => matchScore(named, [r.productName]) >= 0.7))
        || [...(candidates.length ? candidates : group.rows)].sort((x, y) => y.needed - x.needed)[0];
    const planRows = candidates.some(r => r.materialId === assigned.materialId) ? candidates : [...candidates, assigned];
    const { allocations, needIncrease } = planMaterialGroupOrder(quantity,
        planRows.map(r => ({ id: r.materialId, needed: r === assigned && !candidates.includes(r) ? 0 : r.available })),
        assigned.materialId, group.unit === 'kom');
    const extra = needIncrease[assigned.materialId] || 0;
    const members = planRows.map(r => ({
        materialId: r.materialId, productId: r.productId, productName: r.productName, projectId: r.projectId,
        allocation: allocations[r.materialId] || 0,
    }));
    const forBom = roundQty(quantity - extra);
    const rest = roundQty(available - forBom);
    const detail = extra > 0
        ? `${q(forBom)} po sastavnici + ${q(extra)} dodano u sastavnicu (${assigned.productName}) — ulazi u trošak`
        : rest > 0 ? `ostaje još ${q(rest)} ${group.unit}` : 'sve što projekat treba';
    return {
        materialName: group.name,
        unit: group.unit,
        quantity,
        unitPrice: group.rows[0].unitPrice,
        members,
        supplier: supplierOverride || mostCommon(group.rows.map(r => r.supplier)),
        projectIds: [group.projectId],
        label: `• ${q(quantity)} ${group.unit} ${group.name} — ${group.projectName} (${detail})`,
        ...(extra > 0 ? { bom: { kind: 'increase' as const, materialId: assigned.materialId, extra, productName: assigned.productName } } : {}),
    };
}

/** Novi materijal u sastavnici ili artikal iz kataloga (za zalihu). */
async function planOther(
    env: ToolEnv, line: Args, wanted: number | undefined, ref: string,
    byName: Material | undefined, fresh: { project: ProjectRef; name: string } | undefined, supplierOverride: string,
): Promise<PlannedLine | string> {
    if (fresh) {
        if (!(wanted && wanted > 0)) return `Koliko „${fresh.name}" da naručim za ${projectLabel(fresh.project)}?`;
        const products = await loadProjectProducts(env.orgId, fresh.project.id);
        const product = pickProduct(products, text(line.product, 80));
        if (!product) {
            return `„${fresh.name}" nije u sastavnici projekta ${projectLabel(fresh.project)}. Kojem proizvodu da ga dodam? Pitaj korisnika (ask_user), pa ponovi s product. Proizvodi: ${products.map(p => p.Name).join(', ') || '— (projekat nema proizvoda)'}`;
        }
        const unit = byName?.Unit || text(line.unit, 12) || 'kom';
        const unitPrice = byName?.Default_Unit_Price || 0;
        const supplier = supplierOverride || byName?.Default_Supplier || '';
        return {
            materialName: byName?.Name || fresh.name,
            unit,
            quantity: wanted,
            unitPrice,
            members: [],
            supplier,
            projectIds: [fresh.project.id],
            label: `• ${q(wanted)} ${unit} ${byName?.Name || fresh.name} — ${projectLabel(fresh.project)} (novo u sastavnici: ${product.Name}${unitPrice ? '' : ', cijena nepoznata — dopuni u ERP-u'})`,
            bom: { kind: 'add', product, catalogId: byName?.Material_ID || '', name: byName?.Name || fresh.name, unit, unitPrice, supplier, quantity: wanted, projectId: fresh.project.id },
        };
    }
    const item = byName || (ref ? resolveAlias(env.catalogHits || [], ref) : null);
    if (item) {
        if (!(wanted && wanted > 0)) return `Za ${item.Name} iz kataloga treba količina.`;
        return {
            materialName: item.Name,
            unit: item.Unit || 'kom',
            quantity: wanted,
            unitPrice: item.Default_Unit_Price || 0,
            members: [],
            supplier: supplierOverride || item.Default_Supplier || '',
            projectIds: [],
            label: `• ${q(wanted)} ${item.Unit || 'kom'} ${item.Name} — za zalihu`,
        };
    }
    return `Stavka ${ref || '?'} ne postoji — navedi material (naziv) ili ref iz find_material.`;
}

function orderName(projectNames: string[]): string {
    if (!projectNames.length) return 'Zaliha';
    if (projectNames.length <= 2) return projectNames.join(' + ');
    return `${projectNames[0]} + još ${projectNames.length - 1}`;
}

/** Interni dobavljač = usluga u sastavnici (lakiranje), ne naručuje se. */
const INTERNAL = /^(interni|interno|vlastito|in-house)$/i;

/**
 * „Naruči sve što fali za kuhinju Čorluka (kod Frischeisa)": svi materijali projekta
 * s ostatkom za naručiti, po izboru samo jednog dobavljača i/ili proizvoda.
 */
async function missingGroups(env: ToolEnv, project: ProjectRef, supplier: string, product: string): Promise<OrderGroup[]> {
    const rows = (await loadProjectMaterials(env.orgId, [project.id]))
        .filter(r => r.available > 0 && !INTERNAL.test((r.supplier || '').trim()))
        .filter(r => !supplier || matchScore(supplier, [r.supplier || '']) >= 0.85)
        .filter(r => !product || matchScore(product, [r.productName]) >= 0.7);
    const groups = new Map<string, OrderGroup>();
    for (const r of rows) {
        const key = materialGroupKey(r.name, r.unit);
        const g = groups.get(key) || { projectId: project.id, projectName: projectLabel(project), name: r.name, unit: r.unit, rows: [] };
        g.rows.push(r);
        groups.set(key, g);
    }
    return Array.from(groups.values()).sort((x, y) => x.name.localeCompare(y.name, 'bs'));
}

async function createOrderTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const lines = Array.isArray(a.lines) ? (a.lines as Args[]).slice(0, 30) : [];
    const supplierText = text(a.supplier, 80);
    const planned: PlannedLine[] = [];
    if (a.all_missing === true) {
        const project = resolveAlias(env.ctx.projects, a.project);
        if (!project) return { ok: false, error: 'Za „sve što fali" treba projekat (P#).' };
        const groups = await missingGroups(env, project, supplierText, text(a.product, 80));
        if (!groups.length) {
            return { ok: true, orders: [], note: `Za ${projectLabel(project)}${supplierText ? ` kod ${supplierText}` : ''} ništa ne fali — sve je naručeno ili u nacrtu. Reci korisniku.` };
        }
        // Dobavljač služi kao filter; svaka stavka ide svom dobavljaču (narudžba po dobavljaču).
        for (const g of groups) {
            const p = planGroup(g, undefined, '', '');
            if (typeof p !== 'string') planned.push(p);
        }
    } else {
        if (!lines.length) return { ok: false, error: 'Nema stavki.' };
        for (const line of lines) {
            const p = await planLine(env, line, supplierText);
            if (typeof p === 'string') return { ok: false, error: p };
            planned.push(p);
        }
    }
    const delivery = isIsoDate(a.expected_delivery) ? a.expected_delivery : undefined;

    // Sastavnica prije narudžbe: novi materijal dobije ID koji stavka narudžbe nosi.
    for (const p of planned) {
        if (!p.bom) continue;
        let ops: WriteOp[];
        let label: string;
        if (p.bom.kind === 'add') {
            const added = await addMaterialToProduct(env.orgId, {
                product: p.bom.product, catalogId: p.bom.catalogId, name: p.bom.name, unit: p.bom.unit,
                unitPrice: p.bom.unitPrice, supplier: p.bom.supplier, totalQuantity: p.bom.quantity,
            });
            p.members = [{ materialId: added.material.ID, productId: p.bom.product.Product_ID, productName: p.bom.product.Name, projectId: p.bom.projectId, allocation: p.quantity }];
            p.bomChange = { Material_ID: added.material.ID, Extra: p.quantity, Added: true };
            ops = added.ops;
            label = `sastavnica „${p.bom.product.Name}"`;
        } else {
            ops = await increaseMaterialNeed(env.orgId, p.bom.materialId, p.bom.extra);
            p.bomChange = { Material_ID: p.bom.materialId, Extra: p.bom.extra };
            label = `sastavnica „${p.bom.productName}"`;
        }
        await Promise.all(ops.map(op => recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path: op.path, before: op.before, label })));
        env.changes.push(label);
        if (env.cache) delete env.cache.rows;   // sastavnica se promijenila
    }

    const supplierSnap = await adminDb().collection('suppliers').where('Organization_ID', '==', env.orgId).get();
    const suppliers = supplierSnap.docs.map(d => d.data() as Supplier);
    const resolveSupplier = (name: string) => {
        const hit = name ? suppliers.find(s => foldText(s.Name) === foldText(name))
            || suppliers.map(s => ({ s, score: matchScore(name, [s.Name]) })).filter(x => x.score >= 0.85).sort((x, y) => y.score - x.score)[0]?.s : undefined;
        return { id: hit?.Supplier_ID || '', name: hit?.Name || name || 'Neodređen' };
    };

    // Kao čarobnjak „odvojeno": jedna narudžba po dobavljaču.
    const bySupplier = new Map<string, PlannedLine[]>();
    for (const p of planned) {
        const key = resolveSupplier(p.supplier).name;
        bySupplier.set(key, [...(bySupplier.get(key) || []), p]);
    }

    const projectName = new Map(env.ctx.projects.map(p => [p.value.id, projectLabel(p.value)]));
    const created: string[] = [];
    for (const [, group] of Array.from(bySupplier.entries())) {
        const supplier = resolveSupplier(group[0].supplier);
        const names = Array.from(new Set(group.flatMap(p => p.projectIds))).map(id => projectName.get(id) || 'Projekat');
        const extras = group.filter(p => p.members.length && p.quantity > p.members.reduce((s, m) => s + m.allocation, 0));
        const notes = [
            text(a.note, 300),
            ...extras.map(p => `Višak za zalihu: ${q(roundQty(p.quantity - p.members.reduce((s, m) => s + m.allocation, 0)))} ${p.unit} ${p.materialName}.`),
            'Kreirano preko Telegram asistenta.',
        ].filter(Boolean).join(' ');

        const draft = await createDraftOrder(env.orgId, {
            supplierId: supplier.id,
            supplierName: supplier.name,
            name: orderName(names),
            notes,
            expectedDelivery: delivery,
            lines: group,
        });
        const label = `narudžba ${draft.orderNumber}`;
        await Promise.all(draft.paths.map(path => recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path, before: null, label })));
        env.changes.push(label);
        env.documents = [...(env.documents || []), { orderId: draft.orderId, draft: true }];
        env.summaries.push([`🧾 Narudžba ${draft.orderNumber} · ${supplier.name} (nacrt)`, ...group.map(p => p.label)].join('\n'));
        created.push(`${draft.orderNumber} (${supplier.name})`);
    }
    return { ok: true, orders: created, note: 'PDF i dugme „Poslano" sistem šalje korisniku.' };
}

async function productMaterialsTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const project = resolveAlias(env.ctx.projects, a.project);
    if (!project) return { ok: false, error: `Projekat ${String(a.project)} ne postoji u listi.` };
    const productName = text(a.product, 80);
    const materialName = text(a.material, 80);

    let products = await loadProjectProducts(env.orgId, project.id);
    if (productName) products = products.filter(p => matchScore(productName, [p.Name || '']) >= 0.7);
    if (!products.length) return { ok: false, error: productName ? `Projekat nema proizvod „${productName}".` : 'Projekat nema proizvoda.' };
    const materials = await loadProductMaterials(env.orgId, products.map(p => p.Product_ID));

    const lines = products
        .sort((x, y) => (x.Name || '').localeCompare(y.Name || '', 'bs'))
        .slice(0, 15)
        .map(p => {
            const count = p.Quantity > 0 ? p.Quantity : 1;
            const own = materials.filter(m => m.Product_ID === p.Product_ID);
            const shown = materialName ? own.filter(m => matchScore(materialName, [m.Material_Name]) >= 0.7) : own;
            const unitCost = own.reduce((s, m) => s + (m.Total_Price || 0), 0);
            const rows = shown.slice(0, 30).map(m => {
                const c = materialCoverage(m, count);
                return [
                    `  • ${m.Material_Name}`, `${q(c.needed)} ${m.Unit || 'kom'}${count > 1 ? ` (${q(m.Quantity)}/kom)` : ''}`,
                    `cijena ${q(m.Unit_Price || 0)}`, m.Status || 'Nije naručeno',
                    `naručeno ${q(c.ordered)}, primljeno ${q(c.received)}${c.onStock ? `, na stanju ${q(c.onStock)}` : ''}, za naručiti ${q(c.toOrder)}`,
                    m.Supplier || '—',
                ].join(' | ');
            });
            return [`${p.Name} ×${count} | materijal ${q(unitCost * count)} ukupno (${q(unitCost)}/kom) | ${own.length} stavki`, ...rows,
                ...(shown.length > 30 ? [`  … još ${shown.length - 30}`] : [])].join('\n');
        });
    return { ok: true, project: projectLabel(project), products: lines, ...(products.length > 15 ? { note: `Prikazano 15 od ${products.length} proizvoda — suzi s product.` } : {}) };
}

async function listOrdersTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const project = a.project ? resolveAlias(env.ctx.projects, a.project) : null;
    if (a.project && !project) return { ok: false, error: `Projekat ${String(a.project)} ne postoji u listi.` };
    const supplier = text(a.supplier, 80);
    const status = text(a.status, 12);

    let orders = (await listOrdersWithItems(env.orgId)).sort((x, y) => String(y.Order_Date).localeCompare(String(x.Order_Date)));
    if (project) orders = orders.filter(o => o.items?.some(i => i.Project_ID === project.id));
    if (supplier) orders = orders.filter(o => matchScore(supplier, [o.Supplier_Name]) >= 0.7);
    if (status === 'otvorene') orders = orders.filter(o => o.Status === 'Nacrt' || o.Status === 'Poslano');
    else if (status) orders = orders.filter(o => o.Status === status);

    const lines = orders.slice(0, 15).map(o => {
        const items = (project ? o.items!.filter(i => i.Project_ID === project.id) : o.items || [])
            .map(i => `${q(i.Quantity)} ${i.Unit} ${i.Material_Name}${i.Status === 'Primljeno' ? ' (stiglo)' : ''}`);
        return [
            o.Order_Number, o.Supplier_Name || '—', o.Status, shortDay(o.Order_Date, env.tz),
            ...(o.Name ? [o.Name] : []),
            `stavke: ${items.slice(0, 8).join('; ')}${items.length > 8 ? `; … još ${items.length - 8}` : ''}`,
        ].join(' | ');
    });
    return { ok: true, total: orders.length, orders: lines, ...(orders.length > 15 ? { note: `Prikazano 15 najnovijih od ${orders.length}.` } : {}) };
}

const ORDER_ACTIONS = {
    send: { run: sendOrder, done: (n: string) => `📤 Narudžba ${n} poslana — materijali se vode kao naručeni` },
    receive: { run: null, done: (n: string) => `📦 Narudžba ${n}` },
    draft: { run: revertOrderToDraft, done: (n: string) => `↩ Narudžba ${n} vraćena u nacrt — naručeno skinuto s materijala` },
    delete: { run: deleteOrderWithItems, done: (n: string) => `🗑 Narudžba ${n} obrisana` },
} as const;

async function manageOrderTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const wantedNo = foldText(text(a.number, 40)).replace(/\s+/g, '');
    const action = oneOf<keyof typeof ORDER_ACTIONS>(a.action, Object.keys(ORDER_ACTIONS), 'send');
    if (!wantedNo || !Object.keys(ORDER_ACTIONS).includes(String(a.action))) return { ok: false, error: 'Treba broj narudžbe i radnja.' };

    const orders = (await listOrdersWithItems(env.orgId)).filter(o => foldText(o.Order_Number).replace(/\s+/g, '').includes(wantedNo));
    // Tačan broj ima prednost pred djelimičnim („K7" ne smije pogoditi i „K71").
    const exact = orders.filter(o => foldText(o.Order_Number).replace(/\s+/g, '').endsWith(wantedNo));
    const pool = exact.length === 1 ? exact : orders;
    if (!pool.length) return { ok: false, error: `Nema narudžbe s brojem „${text(a.number, 40)}". Pogledaj list_orders.` };
    if (pool.length > 1) return { ok: false, error: `Više narudžbi odgovara — pitaj koju: ${pool.slice(0, 6).map(o => `${o.Order_Number} (${o.Supplier_Name}, ${o.Status})`).join('; ')}` };
    const order = pool[0];

    if (action === 'delete' && a.confirmed !== true) {
        const items = (order.items || []).length;
        return { ok: false, error: `Brisanje traži potvrdu: pitaj korisnika (ask_user „Obrisati narudžbu ${order.Order_Number} (${order.Supplier_Name}, ${order.Status}, ${items} stavki)?" Da/Ne), pa ponovi s confirmed=true.` };
    }

    const befores = new Map<string, Record<string, unknown>>();
    const before = (path: string, data: Record<string, unknown>) => { if (!befores.has(path)) befores.set(path, data); };
    let result;
    if (action === 'receive') {
        const names = Array.isArray(a.materials) ? a.materials.map(m => text(m, 80)).filter(Boolean) : [];
        let ids: string[] | 'all' = 'all';
        if (names.length) {
            ids = (order.items || []).filter(i => names.some(n => matchScore(n, [i.Material_Name]) >= 0.7)).map(i => i.ID);
            if (!ids.length) return { ok: false, error: `U narudžbi ${order.Order_Number} nema tih materijala. Stavke: ${(order.items || []).map(i => i.Material_Name).join(', ')}` };
        }
        result = await receiveOrderItems(env.orgId, order.Order_ID, ids, before);
    } else {
        result = await ORDER_ACTIONS[action].run(env.orgId, order.Order_ID, before);
    }
    if (!result.ok) return { ok: false, error: result.error };

    const label = `narudžba ${order.Order_Number}`;
    await Promise.all(Array.from(befores.entries()).map(([path, data]) =>
        recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path, before: data, label })));
    env.changes.push(label);
    env.summaries.push(`${ORDER_ACTIONS[action].done(order.Order_Number)}${result.detail ? `: ${result.detail}` : ''}${result.materials ? ` (${result.materials} materijala ažurirano)` : ''}.`);
    if (env.cache) delete env.cache.rows;
    return { ok: true, order: order.Order_Number, action, ...(result.detail ? { detail: result.detail } : {}) };
}

// ─── Dnevni rad ───────────────────────────────────────────────────────

const ABSENCE = ['Bolovanje', 'Odmor', 'Odsutan'];


async function logWorkTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const today = toZoned(env.now, env.tz).date;
    const date = isIsoDate(a.date) ? a.date : today;
    if (date > today) return { ok: false, error: 'Rad se ne upisuje unaprijed.' };
    if (Date.parse(today) - Date.parse(date) > 60 * 86_400_000) return { ok: false, error: 'Dan je stariji od 60 dana — upiši ga u ERP-u.' };

    const rawLines = Array.isArray(a.lines) ? (a.lines as Args[]).slice(0, 40) : [];
    const rawAbsent = Array.isArray(a.absent) ? (a.absent as Args[]).slice(0, 40) : [];
    if (!rawLines.length && !rawAbsent.length) return { ok: false, error: 'Nema ničega za upis.' };

    const workerId = (alias: unknown) => resolveAlias(env.ctx.workers, alias)?.id;
    const lines: DiaryLineInput[] = [];
    const finishLines: number[] = [];
    let proposal: DayProposal | null = null;
    for (const l of rawLines) {
        const ids = (Array.isArray(l.workers) ? l.workers : []).map(workerId);
        if (!ids.length || ids.some(id => !id)) return { ok: false, error: `Radnik ${JSON.stringify(l.workers)} ne postoji u listi.` };
        // „Isto kao jučer": radnikov zadnji potvrđeni dan, sa sljedećim korakom gdje je proces završen.
        if (l.like_last === true) {
            proposal = proposal || await loadDayProposal(env.orgId, date);
            for (const id of ids as string[]) {
                const mine = proposal.lines.filter(p => p.workerIds.includes(id));
                const name = env.ctx.workers.find(w => w.value.id === id)?.value.name || id;
                if (!mine.length) {
                    return { ok: false, error: `${name}: nema zadnjeg potvrđenog dana za ponoviti (ili je taj dan već upisan / odsutan). Pitaj na čemu je radio.` };
                }
                lines.push(...mine.map(p => ({
                    workerIds: [id], target: p.workOrderName, workOrderId: p.workOrderId, itemIds: p.itemIds,
                    ...(p.process ? { process: p.process } : {}), ...(p.fraction ? { fraction: p.fraction } : {}),
                    alsoProcesses: [],
                })));
            }
            continue;
        }
        const aliases = [...(text(l.order, 8) ? [l.order] : []), ...(Array.isArray(l.orders) ? l.orders : [])];
        const orders = aliases.map(x => orderOf(env, x));
        const bad = aliases.find((_, i) => !orders[i]);
        if (bad !== undefined) return { ok: false, error: `Nalog ${String(bad)} nije u listi NALOZI.` };
        if (l.fraction != null && !(typeof l.fraction === 'number' && l.fraction > 0 && l.fraction <= 1)) {
            return { ok: false, error: `Dio dana „${String(l.fraction)}" nije ispravan (0–1).` };
        }
        const base: DiaryLineInput = {
            workerIds: ids as string[],
            target: text(l.work, 120),
            process: text(l.process, 80) || undefined,
            alsoProcesses: Array.isArray(l.also) ? l.also.map(p => text(p, 80)).filter(Boolean) : [],
            fraction: number(l.fraction),
            done: l.done === true,
            newProcess: l.new_process === true,
        };
        // Više naloga = stavka po nalogu; rečeni udio dana se dijeli na njih.
        const split = Array.from(new Set(orders as string[]));
        const expanded = split.length
            ? split.map(id => ({ ...base, workOrderId: id, ...(base.fraction ? { fraction: base.fraction / split.length } : {}) }))
            : [base];
        if (l.finish_all === true) expanded.forEach((_, i) => finishLines.push(lines.length + i));
        lines.push(...expanded);
    }
    const absences: DiaryAbsenceInput[] = [];
    for (const x of rawAbsent) {
        const id = workerId(x.worker);
        if (!id) return { ok: false, error: `Radnik ${String(x.worker)} ne postoji u listi.` };
        absences.push({ workerId: id, status: oneOf(x.status, ABSENCE, 'Odsutan') as DiaryAbsenceInput['status'] });
    }

    const befores = new Map<string, Record<string, unknown> | null>();
    const track = (path: string, data: Record<string, unknown> | null) => { if (!befores.has(path)) befores.set(path, data); };
    const result = await bookWorkDiary(env.orgId, date, lines, absences, track);
    if (!result.ok) return { ok: false, error: `Ništa nije upisano.\n${diaryIssueText(env, result.issues)}` };

    const finished = finishLines.length
        ? await finishItems(env.orgId, finishLines.flatMap(i => result.lineItemIds[i] || []), `${date}T15:00:00.000Z`, track)
        : null;
    const label = `rad ${shortDay(`${date}T12:00:00Z`, env.tz)}`;
    await Promise.all(Array.from(befores.entries()).map(([path, before]) =>
        recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path, before, label })));
    env.changes.push(label);
    const dayName = date === today ? 'danas' : formatReminder(`${date}T10:00:00Z`, env.tz, env.now).replace(/ u \d\d:\d\d$/, '');
    env.summaries.push([diarySummary(result, dayName), finished ? finishedLine(finished.items) : ''].filter(Boolean).join('\n'));
    return { ok: true, rows: result.rows.length, absences: result.absences.length, ...(finished ? { finished_products: finished.items } : {}) };
}

/** R# iz liste otvorenih naloga (stalne oznake), pa kandidati iz pitanja ove poruke. */
function orderOf(env: ToolEnv, alias: unknown): string | null {
    return resolveAlias(env.ctx.orders || [], alias)?.id ?? resolveAlias(env.diaryCandidates || [], alias);
}

const finishedLine = (items: number) => `✔ Završeni svi procesi: ${items} ${items === 1 ? 'proizvod' : 'proizvoda'} (nalog zatvori u ERP-u kad je predat).`;

/** Pitanja ERP-a modelu; kandidati naloga nose oznake iz liste NALOZI kad ih ima. */
function diaryIssueText(env: ToolEnv, issues: DiaryIssue[]): string {
    const parts: string[] = [];
    for (const issue of issues) {
        if (issue.kind === 'target') {
            if (!issue.candidates.length) {
                parts.push(`Posao „${issue.text}" (stavka ${issue.line + 1}) ne odgovara nijednom nalogu — izaberi iz liste NALOZI ili pitaj korisnika.`);
                continue;
            }
            const base = env.diaryCandidates?.length || 0;
            const aliased = issue.candidates.map((c, i) => ({
                alias: (env.ctx.orders || []).find(o => o.value.id === c.workOrderId)?.alias || `RK${base + i + 1}`,
                value: c.workOrderId, label: `${c.workOrderName}${c.projectName ? ` (${c.projectName})` : ''}`,
            }));
            env.diaryCandidates = [...(env.diaryCandidates || []), ...aliased.map(({ alias, value }) => ({ alias, value }))];
            noteRefs(env, aliased.map(c => `${c.alias} ${c.label}`));
            parts.push(`Posao „${issue.text}" (stavka ${issue.line + 1}) pogađa više naloga: ${aliased.map(c => `${c.alias} ${c.label}`).join('; ')}. Ako poruka kaže koje (ili „sve"), ponovi s orders bez pitanja; inače pitaj korisnika (ask_user).`);
        } else if (issue.kind === 'process') {
            parts.push(`Proces „${issue.name}" nije u katalogu — pitaj korisnika je li nov (Da → new_process=true) ili mislio na postojeći.`);
        } else {
            parts.push(`Radnik ${issue.workerId} nije pronađen.`);
        }
    }
    return parts.join('\n');
}

async function fillWorkDaysTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const today = toZoned(env.now, env.tz).date;
    const monday = (() => {
        const t = Date.parse(`${today}T12:00:00Z`);
        const wd = (new Date(t).getUTCDay() + 6) % 7;
        return new Date(t - wd * 86_400_000).toISOString().slice(0, 10);
    })();
    const from = isIsoDate(a.from) ? a.from : monday;
    const to = isIsoDate(a.to) && a.to < today ? a.to : today;
    if (from > to) return { ok: false, error: 'Period nije ispravan (od je poslije do).' };
    if (Date.parse(today) - Date.parse(from) > 60 * 86_400_000) return { ok: false, error: 'Period stariji od 60 dana — upiši ga u ERP-u.' };
    if (Date.parse(to) - Date.parse(from) > 31 * 86_400_000) return { ok: false, error: 'Najviše mjesec dana odjednom.' };

    const workerIds = (Array.isArray(a.workers) ? a.workers : []).map(x => resolveAlias(env.ctx.workers, x)?.id);
    if (!workerIds.length || workerIds.some(id => !id)) return { ok: false, error: `Radnik ${JSON.stringify(a.workers)} ne postoji u listi.` };
    const aliases = Array.isArray(a.orders) ? a.orders : [];
    const orderIds = aliases.map(x => orderOf(env, x));
    if (!orderIds.length) return { ok: false, error: 'Navedi naloge (R# iz liste NALOZI).' };
    const bad = aliases.find((_, i) => !orderIds[i]);
    if (bad !== undefined) return { ok: false, error: `Nalog ${String(bad)} nije u listi NALOZI.` };

    const befores = new Map<string, Record<string, unknown> | null>();
    const track = (path: string, data: Record<string, unknown> | null) => { if (!befores.has(path)) befores.set(path, data); };
    const res = await bookEmptyDays(env.orgId, {
        workerIds: workerIds as string[], workOrderIds: Array.from(new Set(orderIds as string[])), from, to, today,
    }, track);
    if (!res.ok) {
        // Dani prije greške su upisani — idu pod ↩️ Poništi ove poruke.
        if (befores.size) {
            await Promise.all(Array.from(befores.entries()).map(([path, before]) =>
                recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path, before, label: 'prazni dani' })));
            env.changes.push('prazni dani (djelimično)');
        }
        const done = res.days.map(d => shortDay(`${d.date}T12:00:00Z`, env.tz)).join(', ');
        return { ok: false, error: `${done ? `Upisano samo: ${done}.` : 'Ništa nije upisano.'}\n${diaryIssueText(env, res.issues)}` };
    }
    const lastDay = res.days.at(-1)?.date || to;
    const finished = a.finish_all === true
        ? await finishItems(env.orgId, res.itemIds.length ? res.itemIds : await openItemIds(env.orgId, orderIds as string[]), `${lastDay}T15:00:00.000Z`, track)
        : null;
    if (!res.days.length && !finished) {
        return { ok: true, days: 0, note: `Nema praznih dana od ${shortDay(`${from}T12:00:00Z`, env.tz)} do ${shortDay(`${to}T12:00:00Z`, env.tz)} — sve je već upisano. Reci korisniku.` };
    }
    const label = 'prazni dani';
    await Promise.all(Array.from(befores.entries()).map(([path, before]) =>
        recordOp({ turnId: env.turnId, uid: env.uid, orgId: env.orgId, path, before, label })));
    env.changes.push(label);
    const byWorkers = new Map<string, string[]>();
    res.days.forEach(d => {
        const k = d.workers.join(', ');
        byWorkers.set(k, [...(byWorkers.get(k) || []), shortDay(`${d.date}T12:00:00Z`, env.tz)]);
    });
    env.summaries.push([
        res.days.length ? `🗓 Popunjeni prazni dani · ${res.workOrderNames.join(', ')}` : `🗓 Nema praznih dana — sve je već upisano.`,
        ...Array.from(byWorkers.entries()).map(([w, days]) => `• ${w}: ${days.join(', ')}`),
        finished ? finishedLine(finished.items) : '',
    ].filter(Boolean).join('\n'));
    return { ok: true, days: res.days.length, ...(finished ? { finished_products: finished.items } : {}) };
}

async function openItemIds(orgId: string, workOrderIds: string[]): Promise<string[]> {
    return (await getItemsForWorkOrders(orgId, workOrderIds)).filter(i => i.Status !== 'Završeno').map(i => i.ID);
}

async function workReportTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const today = toZoned(env.now, env.tz).date;
    const work = text(a.work, 120);
    const from = isIsoDate(a.from) ? a.from : work ? new Date(env.now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10) : today;
    const to = isIsoDate(a.to) ? a.to : isIsoDate(a.from) ? a.from : today;
    const worker = a.worker ? resolveAlias(env.ctx.workers, a.worker) : null;
    if (a.worker && !worker) return { ok: false, error: `Radnik ${String(a.worker)} ne postoji u listi.` };

    const report = await workLogReport(env.orgId, from, to);
    let rows = report.rows;
    if (worker) rows = rows.filter(r => r.workerId === worker.id);
    // Sve riječi posla moraju se naći („kuhinja Čorluka" ne smije uhvatiti gardarobere Čorluke).
    if (work) rows = rows.filter(r => coverage(work, `${r.workOrderName} ${r.productName} ${r.projectName}`) >= 0.75);
    const lines = rows.slice(0, 80).map(r => [
        shortDay(`${r.date}T12:00:00Z`, env.tz), r.worker, dayLabel(r.dayFraction), r.process || 'bez procesa',
        `${r.workOrderName}${r.productName && r.productName !== r.workOrderName ? ` / ${r.productName}` : ''}`,
        r.confirmed ? 'upisano' : 'auto iz prisustva',
    ].join(' | '));
    return {
        ok: true, from, to, total: rows.length, lines,
        ...(rows.length > 80 ? { note: `Prikazano 80 od ${rows.length}. Suzi period ili posao.` } : {}),
        legend: '„auto iz prisustva" = dan podijeljen automatski, proces nije potvrđen.',
    };
}

async function orderPdfTool(env: ToolEnv, a: Args): Promise<ToolResult> {
    const wantedNo = foldText(text(a.number, 40)).replace(/\s+/g, '');
    const project = a.project ? resolveAlias(env.ctx.projects, a.project) : null;
    if (a.project && !project) return { ok: false, error: `Projekat ${String(a.project)} ne postoji u listi.` };
    const supplier = text(a.supplier, 80);

    let orders = (await listOrders(env.orgId)).sort((x, y) => String(y.Order_Date).localeCompare(String(x.Order_Date)));
    if (wantedNo) orders = orders.filter(o => foldText(o.Order_Number).replace(/\s+/g, '').includes(wantedNo));
    if (supplier) orders = orders.filter(o => matchScore(supplier, [o.Supplier_Name]) >= 0.7);
    if (project) {
        const withProject: typeof orders = [];
        for (const o of orders.slice(0, 40)) {
            const full = await getOrderWithItems(env.orgId, o.Order_ID);
            if (full?.items?.some(i => i.Project_ID === project.id)) withProject.push(o);
            if (withProject.length) break;
        }
        orders = withProject;
    }
    const order = orders[0];
    if (!order) return { ok: false, error: 'Nema takve narudžbe.' };
    env.documents = [...(env.documents || []), { orderId: order.Order_ID, draft: order.Status === 'Nacrt' }];
    env.summaries.push(`📄 Narudžba ${order.Order_Number} · ${order.Supplier_Name} (${order.Status})`);
    return { ok: true, order: order.Order_Number, status: order.Status };
}

/** Oznake (W9, T6…) su interne — „Imer (W9)" → „Imer". Model ih ponekad ipak napiše. */
export function stripAliases(s: string): string {
    return s
        .replace(/\s*\((?:[WPMTSOK]\d+(?:\s*,\s*[WPMTSOK]\d+)*)\)/g, '')
        // Golo „W9" se briše, ali ne „M8" (vijci) ni „K7" (dio broja narudžbe „N2026-10/K7").
        .replace(/(^|\s)[WPTSO]\d+\b(?=[\s,.:;)]|$)/g, '$1')
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
            case 'create_order': return await createOrderTool(env, args);
            case 'product_materials': return await productMaterialsTool(env, args);
            case 'list_orders': return await listOrdersTool(env, args);
            case 'manage_order': return await manageOrderTool(env, args);
            case 'log_work': return await logWorkTool(env, args);
            case 'fill_work_days': return await fillWorkDaysTool(env, args);
            case 'work_report': return await workReportTool(env, args);
            case 'order_pdf': return await orderPdfTool(env, args);
            case 'ask_user': return askUserTool(env, args);
            default: return { ok: false, error: `Nepoznat alat ${name}.` };
        }
    } catch (e) {
        console.error(`[assistant] alat ${name} pao:`, e);
        return { ok: false, error: 'Upis nije uspio (greška na serveru).' };
    }
}
