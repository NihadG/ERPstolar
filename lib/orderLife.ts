// ════════════════════════════════════════════════════════════════════
// ŽIVOTNI TOK NALOGA — šta nalog mora imati da u ERP-u „živi" (čisto)
//
// ERP nalog vodi ovim redom: ekipa (Assigned_Workers) → Pokreni (U toku,
// Started_At, plan u Planeru) → rad i procesi → svi proizvodi završeni =
// nalog završen. Bot je pisao dnevnice mimo toga (16.11.: „kada ti dodaš
// naloge, ne dodijeliš im radnike i sad se u ERP-u ne mogu pokrenuti"):
// nalog je imao rad u Knjizi rada, a u ERP-u je stajao „Na čekanju", bez
// ekipe i van Planera.
//
// Pravilo: ko je radio na nalogu, taj je u njegovoj ekipi; nalog na kojem
// se radi je pokrenut tim danom — ista polja koja upiše ERP-ovo „Pokreni"
// (lib/database.ts startWorkOrder). Ekipu koju je dodao bot bot i skida
// kad radnik pređe na drugi posao; ekipu dodijeljenu u ERP-u ne dira.
// jest: lib/__tests__/orderLife.test.ts
// ════════════════════════════════════════════════════════════════════

import { isWorkerAssignedToAutoItem, type AutoBookItem } from './autoBook';
import { itemPlannedDays, workOrderDueDate } from './planning';

export interface CrewMember {
    Worker_ID: string;
    Worker_Name: string;
    Daily_Rate: number;
    /** Dodijelio ga je bot iz upisa rada — bot ga smije i skinuti. */
    Source?: 'telegram';
}

type CrewItem = Omit<AutoBookItem, 'Assigned_Workers'> & { Assigned_Workers?: CrewMember[] };

/** Ekipa stavke nakon upisa rada: ko je radio a nije dodijeljen (ni na procesu) ulazi u ekipu. `null` = bez izmjene. */
export function crewAfterWork(item: CrewItem, worked: Omit<CrewMember, 'Source'>[]): CrewMember[] | null {
    const add = worked.filter((w, i) => w.Worker_ID
        && worked.findIndex(x => x.Worker_ID === w.Worker_ID) === i
        && !isWorkerAssignedToAutoItem(item, w.Worker_ID));
    if (!add.length) return null;
    return [...(item.Assigned_Workers || []), ...add.map(w => ({ ...w, Source: 'telegram' as const }))];
}

/** Radnik je prešao na drugi posao: skida se samo dodjela koju je napravio bot. `null` = bez izmjene. */
export function crewWithout(item: CrewItem, workerId: string): CrewMember[] | null {
    const crew = item.Assigned_Workers || [];
    const kept = crew.filter(w => !(w.Worker_ID === workerId && w.Source === 'telegram'));
    return kept.length === crew.length ? null : kept;
}

const dayOf = (iso?: string | null) => String(iso || '').slice(0, 10);

/**
 * Polja pokretanja naloga na kojem se radilo `day` — isto što upiše „Pokreni" u ERP-u:
 * U toku, Started_At, i plan u Planeru (početak → rok ili projekcija iz planiranih dana, inače +7).
 * Rad prije upisanog početka pomjera početak unazad (auto-knjiženje iz šihtarice traži Started_At ≤ dan).
 * Završen ili otkazan nalog se ne pokreće ponovo. `null` = nalog već živi kako treba.
 */
export function startFields(
    wo: { Status?: string; Started_At?: string | null; Is_Scheduled?: boolean; Due_Date?: string; Planned_Start_Date?: string; Planned_End_Date?: string },
    items: { Planned_Labor_Days?: number; Quantity?: number }[],
    day: string,
    nowIso: string,
): Record<string, unknown> | null {
    if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') return null;
    const out: Record<string, unknown> = {};
    if (wo.Status !== 'U toku') out.Status = 'U toku';
    const started = dayOf(wo.Started_At);
    if (!started || started > day) out.Started_At = `${day}T07:00:00.000Z`;
    const start = started && started <= day ? started : day;
    if (!wo.Is_Scheduled) {
        const planned = items.reduce((sum, i) => sum + itemPlannedDays(i), 0);
        const end = dayOf(wo.Due_Date) || (planned > 0 ? workOrderDueDate(start, planned) : dayOf(new Date(Date.parse(`${start}T12:00:00Z`) + 7 * 86_400_000).toISOString()));
        Object.assign(out, { Is_Scheduled: true, Planned_Start_Date: start, Planned_End_Date: end < start ? start : end, Scheduled_At: nowIso });
    } else if (dayOf(wo.Planned_Start_Date) > day) {
        // Zakazan za kasnije, a već se radi: plan počinje danom rada.
        out.Planned_Start_Date = day;
    }
    return Object.keys(out).length ? out : null;
}

/** Svi proizvodi završeni → nalog završen danom zadnjeg završenog (isto pravilo kao ERP-ov preračun naloga). */
export function closeFields(
    wo: { Status?: string },
    items: { Status?: string; Completed_At?: string | null }[],
): { Status: 'Završeno'; Completed_At: string } | null {
    if (wo.Status === 'Završeno' || wo.Status === 'Otkazano' || !items.length) return null;
    if (!items.every(i => i.Status === 'Završeno')) return null;
    const last = items.map(i => String(i.Completed_At || '')).filter(Boolean).sort().at(-1);
    return last ? { Status: 'Završeno', Completed_At: last } : null;
}

// ─── Status proizvoda na projektu ─────────────────────────────────────

const PRODUCT_RANK = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni', 'Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje', 'Spremno',
    'Transport', 'Montaža', 'Čišćenje', 'Primopredaja', 'Instalirano'];
/** Proces van te liste (vlastiti korak proizvodnje) je „usred proizvodnje". */
const rank = (status: string) => { const i = PRODUCT_RANK.indexOf(status); return i >= 0 ? i : 5; };
const FINAL_STATUS: Record<string, string> = { Sklapanje: 'Spremno', Primopredaja: 'Instalirano', 'Čišćenje': 'Instalirano', 'Montaža': 'Instalirano' };

type StatusItem = { Status?: string; Processes?: { Process_Name?: string; Status?: string }[] };

/**
 * Status proizvoda na projektu iz stavke naloga — isto pravilo kao ERP-ov preračun naloga
 * (lib/attendance.ts syncProductStatuses): proces u toku, inače zadnji završen; završena stavka =
 * „Spremno" (ili „Instalirano" kad je zadnji korak montaža). Bot je upisivao procese, a projekat je
 * pokazivao stari korak (16.11.: stolovi na lijepljenju, na projektu „Krojenje iverala").
 */
export function productStatusFor(item: StatusItem): string {
    const processes = (item.Processes || []).filter(p => p.Process_Name && p.Process_Name.trim().toLowerCase() !== 'rad');
    if (item.Status === 'Završeno') return FINAL_STATUS[processes.at(-1)?.Process_Name || ''] || 'Spremno';
    if (item.Status !== 'U toku') return 'Na čekanju';
    const active = processes.find(p => p.Status === 'U toku');
    return active?.Process_Name || processes.slice().reverse().find(p => p.Status === 'Završeno')?.Process_Name || 'Sklapanje';
}

/** Novi status proizvoda, ili `null` kad ostaje: naprijed uvijek; nazad samo dok proizvod nije „Spremno". */
export function productStatusChange(current: string | undefined, item: StatusItem): string | null {
    const next = productStatusFor(item);
    if (next === (current || '')) return null;
    const now = rank(current || ''), then = rank(next);
    const move = then > now
        || (item.Status !== 'U toku' && item.Status !== 'Završeno')
        || (item.Status === 'U toku' && then <= now && now < rank('Spremno'));
    return move ? next : null;
}

// ─── Provjera pravila nad svim nalozima ───────────────────────────────

export interface OrderProblem { order: string; rule: 'ceka' | 'ekipa' | 'planer' | 'otvoren' | 'pocetak' | 'plan' | 'proizvod'; detail: string }

/**
 * Gdje nalog odstupa od onoga što ERP sam traži. Mjeri SISTEM, ne pojedine poruke: svaka revizija
 * izbroji odstupanja nad svim otvorenim nalozima (npm run bot:nalozi).
 *   ceka     — rad je upisan, a nalog je „Na čekanju"
 *   ekipa    — ko je radio zadnjih `recentDays` dana nije dodijeljen (ni u ekipi ni na procesu)
 *   planer   — nalog je „U toku", a nije u Planeru
 *   pocetak  — početak naloga je poslije prvog upisanog rada (ili ga nema)
 *   otvoren  — svi proizvodi završeni, nalog otvoren
 *   plan     — proizvodni nalog bez plana procesa
 *   proizvod — status proizvoda na projektu ne prati stavku naloga
 */
export function orderProblems(input: {
    orders: { Work_Order_ID: string; Work_Order_Number?: string; Name?: string; Status?: string; Work_Order_Type?: string; Started_At?: string | null; Is_Scheduled?: boolean; Process_Graph?: { nodes?: unknown[] } }[];
    items: (CrewItem & StatusItem & { Work_Order_ID: string; Product_ID?: string; Product_Name?: string; Item_Type?: string })[];
    logs: { Work_Order_ID?: string; Worker_ID?: string; Worker_Name?: string; Date?: string; Work_Order_Deleted?: boolean }[];
    products: { Product_ID: string; Status?: string }[];
    today: string;
    recentDays?: number;
}): OrderProblem[] {
    const out: OrderProblem[] = [];
    const since = dayOf(new Date(Date.parse(`${input.today}T12:00:00Z`) - (input.recentDays ?? 7) * 86_400_000).toISOString());
    const productStatus = new Map(input.products.map(p => [p.Product_ID, p.Status || '']));
    for (const wo of input.orders) {
        if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
        const order = wo.Name || wo.Work_Order_Number || wo.Work_Order_ID;
        const add = (rule: OrderProblem['rule'], detail: string) => out.push({ order, rule, detail });
        const items = input.items.filter(i => i.Work_Order_ID === wo.Work_Order_ID);
        const logs = input.logs.filter(l => l.Work_Order_ID === wo.Work_Order_ID && !l.Work_Order_Deleted);
        const first = logs.map(l => dayOf(l.Date)).filter(Boolean).sort()[0];
        if (logs.length && wo.Status !== 'U toku') add('ceka', `${logs.length} dnevnica, status ${wo.Status || '—'}`);
        const recent = new Map(logs.filter(l => dayOf(l.Date) >= since && l.Worker_ID).map(l => [l.Worker_ID!, l.Worker_Name || l.Worker_ID!]));
        const loose = Array.from(recent.entries()).filter(([id]) => !items.some(i => isWorkerAssignedToAutoItem(i, id))).map(([, name]) => name);
        if (loose.length) add('ekipa', loose.sort().join(', '));
        if (wo.Status === 'U toku' && !wo.Is_Scheduled) add('planer', 'nije zakazan');
        if (logs.length && wo.Status === 'U toku' && (!wo.Started_At || dayOf(wo.Started_At) > first)) add('pocetak', `prvi rad ${first}, početak ${dayOf(wo.Started_At) || '—'}`);
        if (items.length && items.every(i => i.Status === 'Završeno')) add('otvoren', 'svi proizvodi završeni');
        const products = items.filter(i => i.Item_Type !== 'custom');
        if (wo.Work_Order_Type === 'Proizvodnja' && logs.length && products.length && !(wo.Process_Graph?.nodes || []).length && !products.some(i => (i.Processes || []).length)) add('plan', 'bez procesa');
        for (const i of products) {
            if (!i.Product_ID || !productStatus.has(i.Product_ID) || !(i.Processes || []).length) continue;
            const next = productStatusChange(productStatus.get(i.Product_ID), i);
            if (next) add('proizvod', `${i.Product_Name || i.Product_ID}: na projektu „${productStatus.get(i.Product_ID)}", u nalogu „${next}"`);
        }
    }
    return out;
}
