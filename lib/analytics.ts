// ════════════════════════════════════════════════════════════════════
// ANALITIKA — čista agregacija (bez Firebase), pokrivena testovima.
//
// Finansije dolaze ISKLJUČIVO iz lib/projectFinance.ts (isti proračun kao kartica
// projekta, pregled projekta i nalog) — ovdje se samo filtrira po periodu/opsegu,
// grupiše i sabira. Nijedna formula profita ne živi u ovoj datoteci.
//
//   • Ostvareni profit u periodu = proizvodi ZAVRŠENI u periodu (datum završetka
//     proizvodnje). Proizvod gotov bez naloga nema datum → ulazi samo u „Sve".
//   • U izradi = stanje SADA (period se na njega ne odnosi).
//   • Radnici / trend rada = dnevnice po DATUMU u periodu, bez obzira na projekat.
//     Zarada radnika = Σ živih dnevnica — isto što i obračun plata (lib/payroll.ts).
//   • Razni poslovi (bez projekta) ostaju odvojeno, po staroj formuli.
// ════════════════════════════════════════════════════════════════════

import {
    buildFinanceBasis, buildLaborIndex, computeProjectsFinance, liveLogs, sumStage, emptyStageTotals, hasFlag,
    itemFinance, EMPTY_FINANCE_BASIS,
    type FinProduct, type FinOffer, type FinWorkOrder, type FinLog,
    type ProductFinanceRow, type StageTotals, type ProjectFinance,
} from './projectFinance';

export interface DateRange { from?: string; to?: string }   // YYYY-MM-DD, inkluzivno
export type AnalyticsScope = 'active' | 'all';

const r2 = (n: number) => Math.round(n * 100) / 100;
const dOnly = (iso?: string | null) => (iso ? iso.split('T')[0] : '');
export const inRange = (date: string | undefined, range?: DateRange): boolean => {
    if (!range?.from && !range?.to) return true;
    if (!date) return false;
    return (!range.from || date >= range.from) && (!range.to || date <= range.to);
};
const hasRange = (range?: DateRange) => !!(range?.from || range?.to);

// ── Ulazi ───────────────────────────────────────────────────────────
export interface AProject {
    Project_ID: string;
    Name?: string;
    Client_Name?: string;
    Status?: string;
    products?: FinProduct[];
}
export interface AAttendance { Worker_ID: string; Worker_Name?: string; Date: string; Status: string }
export interface AWorker { Worker_ID: string; Name?: string; Status?: string }

export interface AnalyticsInput {
    projects: AProject[];
    offers: FinOffer[];
    workOrders: FinWorkOrder[];
    logs: FinLog[];
    attendance?: AAttendance[];
    workers?: AWorker[];
}

// ── Izlazi ──────────────────────────────────────────────────────────
export interface AnalyticsProject {
    projectId: string;
    client: string;
    name: string;
    status: string;
    contracted: number;
    productCount: number;
    scopeCount: number;             // proizvodi u obimu (u ponudi ili započeti)
    outOfContractCount: number;     // nezapočeti van prihvaćene ponude
    finishedCount: number;          // ukupno završeno (do danas)
    spentMaterial: number;          // uloženo do danas (svi proizvodi + razni projekta)
    spentLabor: number;
    realized: StageTotals;          // završeno U PERIODU
    razniProfit: number;            // razni nalozi vezani za projekat (samo „Sve")
    profit: number;                 // realized.profit + razniProfit
    margin: number;
    inProgress: StageTotals;        // stanje sada
    notStartedCount: number;
    flagged: number;
}

export interface AnalyticsProduct extends ProductFinanceRow {
    projectName: string;
    client: string;
    inPeriod: boolean;              // za završene: završen u periodu
}

export interface WorkerRow {
    workerId: string;
    name: string;
    presentDays: number;            // šihtarica: Prisutan + Teren
    bookedDays: number;             // Σ Day_Fraction dnevnica (radnik-dani)
    unbookedDays: number;           // prisutan, a bez ijedne dnevnice taj dan
    earnings: number;               // Σ Daily_Rate (= obračun plata)
    avgRate: number;                // zarada / radnik-dani (efektivna dnevnica)
    productsKM: number;             // dio zarade na proizvodima (projekti)
    razniKM: number;                // dio zarade na raznim poslovima
    products: number;               // broj različitih proizvoda
}

export interface PvAMetric {
    planned: number;                // Σ plana — SAMO proizvodi koji plan imaju
    actual: number;                 // Σ stvarnog za te iste proizvode
    variance: number;               // plan − stvarno (> 0 = ušteda)
    variancePct: number;
    accuracyPct: number;            // 100 − |odstupanje %|
    unplannedActual: number;        // stvarno na proizvodima bez plana (nije u poređenju)
}
export interface PvARow { projectId: string; projectName: string; count: number; material: PvAMetric; labor: PvAMetric }

export interface WeekBucket { weekStart: string; labor: number }

export type IssueKind = 'noOffer' | 'noPrice' | 'noMaterial' | 'noLabor' | 'qtyMismatch';
export interface AnalyticsIssue {
    kind: IssueKind;
    projectId: string;
    projectName: string;
    productId: string;
    productName: string;
    detail: string;
}

export interface RazniSummary {
    tasks: number;                  // broj raznih poslova s aktivnošću u periodu
    revenue: number;
    material: number;
    other: number;
    labor: number;
    profit: number;
    workerDays: number;
}

export interface AnalyticsKpis {
    contracted: number;             // Σ prihvaćenih ponuda projekata u opsegu
    realized: StageTotals;          // završeno u periodu (svi projekti u opsegu)
    profit: number;                 // realized.profit + razni projekata (samo „Sve")
    margin: number;
    inProgress: StageTotals;
    notStartedCount: number;
    notStartedContracted: number;
    razni: RazniSummary;            // razni poslovi BEZ projekta (period)
    laborInPeriod: number;          // svi živi rad u periodu (projekti + razni)
    workerDaysInPeriod: number;
    unbookedDays: number;           // prisutni dani bez dnevnice (period)
    flaggedProducts: number;
}

export interface AnalyticsData {
    range: DateRange;
    scope: AnalyticsScope;
    kpis: AnalyticsKpis;
    projects: AnalyticsProject[];
    products: AnalyticsProduct[];
    workers: WorkerRow[];
    pva: { total: PvARow; byProject: PvARow[]; inProgressLabor: { planned: number; actual: number } };
    weeklyTrend: WeekBucket[];
    issues: AnalyticsIssue[];
}

// ════════════════════════════════════════════════════════════════════

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function mondayOf(iso: string): string {
    const d = new Date(iso + 'T12:00:00');
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return toISO(d);
}

const fmtKM = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} KM`;

function issuesOf(p: ProductFinanceRow, projectName: string): AnalyticsIssue[] {
    const base = { projectId: p.projectId, projectName, productId: p.productId, productName: p.name };
    const out: AnalyticsIssue[] = [];
    if (p.flags.noOffer) {
        out.push({ ...base, kind: 'noOffer', detail: p.revenue > 0 ? `Nije u prihvaćenoj ponudi — prihod ${fmtKM(p.revenue)} uzet s naloga` : 'Nije u prihvaćenoj ponudi i nema cijenu' });
    } else if (p.flags.noPrice) {
        out.push({ ...base, kind: 'noPrice', detail: 'Cijena u ponudi je 0' });
    }
    if (p.flags.noMaterial) out.push({ ...base, kind: 'noMaterial', detail: 'Sastavnica prazna i nema dodataka — materijal 0' });
    if (p.flags.noLabor) out.push({ ...base, kind: 'noLabor', detail: 'Završen, a nema nijedne dnevnice' });
    if (p.flags.qtyMismatch) out.push({ ...base, kind: 'qtyMismatch', detail: `Količina: proizvod ${p.quantity}, proizvedeno ${p.producedQty}, ponuda ${p.offerQty}` });
    return out;
}

function metric(planned: number, actual: number, unplannedActual: number): PvAMetric {
    const variance = r2(planned - actual);
    const variancePct = planned > 0 ? r2(((planned - actual) / planned) * 100) : 0;
    const accuracyPct = planned > 0 ? r2(Math.max(0, 100 - Math.abs((actual - planned) / planned) * 100)) : (actual === 0 ? 100 : 0);
    return { planned: r2(planned), actual: r2(actual), variance, variancePct, accuracyPct, unplannedActual: r2(unplannedActual) };
}

/**
 * Plan (ponuda) vs stvarno za ZAVRŠENE proizvode. Poređenje je fer samo nad proizvodima
 * koji plan imaju; stvarni trošak proizvoda bez plana ide u `unplannedActual`.
 */
export function planVsActual(products: AnalyticsProduct[]): { total: PvARow; byProject: PvARow[]; inProgressLabor: { planned: number; actual: number } } {
    interface Acc { projectId: string; projectName: string; count: number; pm: number; am: number; um: number; pl: number; al: number; ul: number }
    const mk = (projectId: string, projectName: string): Acc => ({ projectId, projectName, count: 0, pm: 0, am: 0, um: 0, pl: 0, al: 0, ul: 0 });
    const tot = mk('', 'Ukupno');
    const byProject = new Map<string, Acc>();
    const add = (a: Acc, p: AnalyticsProduct) => {
        a.count++;
        if (p.plannedMaterial > 0) { a.pm += p.plannedMaterial; a.am += p.material; } else { a.um += p.material; }
        if (p.plannedLabor > 0) { a.pl += p.plannedLabor; a.al += p.labor; } else { a.ul += p.labor; }
    };
    let ipPlanned = 0, ipActual = 0;
    for (const p of products) {
        if (p.stage === 'u_izradi' && p.plannedLabor > 0) { ipPlanned += p.plannedLabor; ipActual += p.labor; }
        if (p.stage !== 'zavrseno' || !p.inPeriod) continue;
        add(tot, p);
        let a = byProject.get(p.projectId);
        if (!a) { a = mk(p.projectId, p.projectName); byProject.set(p.projectId, a); }
        add(a, p);
    }
    const row = (a: Acc): PvARow => ({ projectId: a.projectId, projectName: a.projectName, count: a.count, material: metric(a.pm, a.am, a.um), labor: metric(a.pl, a.al, a.ul) });
    return {
        total: row(tot),
        byProject: Array.from(byProject.values()).map(row)
            .sort((x, y) => (Math.abs(y.material.variance) + Math.abs(y.labor.variance)) - (Math.abs(x.material.variance) + Math.abs(x.labor.variance))),
        inProgressLabor: { planned: r2(ipPlanned), actual: r2(ipActual) },
    };
}

/**
 * Radnici za period. Zarada = Σ živih dnevnica (kao obračun plata); prosječna dnevnica =
 * zarada / radnik-dani (Σ Day_Fraction), pa pola dana ne „kvari" prosjek.
 */
export function aggregateWorkers(args: {
    logs: FinLog[];
    attendance?: AAttendance[];
    workers?: AWorker[];
    workOrders: FinWorkOrder[];
    range?: DateRange;
}): WorkerRow[] {
    const { range } = args;
    const customItems = new Set<string>();
    for (const wo of args.workOrders || []) for (const it of wo.items || []) if (it.Item_Type === 'custom') customItems.add(it.ID);
    const nameOf = new Map((args.workers || []).map(w => [w.Worker_ID, w.Name || '']));

    interface Acc { name: string; present: Set<string>; logDates: Set<string>; booked: number; earnings: number; productsKM: number; razniKM: number; products: Set<string> }
    const m = new Map<string, Acc>();
    const get = (id: string, name?: string): Acc => {
        let a = m.get(id);
        if (!a) { a = { name: nameOf.get(id) || name || 'Radnik', present: new Set(), logDates: new Set(), booked: 0, earnings: 0, productsKM: 0, razniKM: 0, products: new Set() }; m.set(id, a); }
        return a;
    };

    for (const l of liveLogs(args.logs)) {
        const date = dOnly(l.Date);
        if (!l.Worker_ID || !inRange(date, range)) continue;
        const a = get(l.Worker_ID, l.Worker_Name);
        const rate = l.Daily_Rate || 0;
        a.logDates.add(date);
        a.booked += l.Day_Fraction ?? 1;
        a.earnings += rate;
        if (l.Work_Order_Item_ID && customItems.has(l.Work_Order_Item_ID)) a.razniKM += rate;
        else { a.productsKM += rate; if (l.Product_ID) a.products.add(l.Product_ID); }
    }
    for (const at of args.attendance || []) {
        if (at.Status !== 'Prisutan' && at.Status !== 'Teren') continue;
        if (!inRange(at.Date, range)) continue;
        get(at.Worker_ID, at.Worker_Name).present.add(at.Date);
    }

    return Array.from(m.entries())
        .map(([workerId, a]) => {
            const unbooked = Array.from(a.present).filter(d => !a.logDates.has(d)).length;
            const booked = r2(a.booked);
            return {
                workerId, name: a.name,
                presentDays: a.present.size,
                bookedDays: booked,
                unbookedDays: unbooked,
                earnings: r2(a.earnings),
                avgRate: booked > 0 ? r2(a.earnings / booked) : 0,
                productsKM: r2(a.productsKM),
                razniKM: r2(a.razniKM),
                products: a.products.size,
            };
        })
        .filter(w => w.earnings > 0 || w.presentDays > 0)
        .sort((x, y) => y.earnings - x.earnings || y.presentDays - x.presentDays);
}

export function weeklyLaborTrend(logs: FinLog[], range?: DateRange): WeekBucket[] {
    const m = new Map<string, number>();
    for (const l of liveLogs(logs)) {
        const date = dOnly(l.Date);
        if (!date || !inRange(date, range)) continue;
        const ws = mondayOf(date);
        m.set(ws, (m.get(ws) || 0) + (l.Daily_Rate || 0));
    }
    return Array.from(m.entries()).map(([weekStart, labor]) => ({ weekStart, labor: r2(labor) })).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * Razni poslovi BEZ projekta (i bez veze na proizvod) — stara formula, kao i do sada.
 * Rad po datumu dnevnice; vrijednost / materijal / ostali troškovi posla ulaze u period
 * u kojem je posao završen (nezavršen posao: datum naloga).
 */
export function razniSummary(workOrders: FinWorkOrder[], logs: FinLog[], range?: DateRange): RazniSummary {
    const items = new Map<string, { item: NonNullable<FinWorkOrder['items']>[number]; date: string }>();
    for (const wo of workOrders || []) {
        if (wo.Status === 'Otkazano') continue;
        for (const it of wo.items || []) {
            if (it.Item_Type !== 'custom' || it.Project_ID || it.Linked_Item_ID) continue;
            items.set(it.ID, { item: it, date: dOnly(it.Completed_At) || dOnly(wo.Completed_At) || dOnly(wo.Started_At) || '' });
        }
    }
    let labor = 0, workerDays = 0;
    const active = new Set<string>();
    for (const l of liveLogs(logs)) {
        if (!l.Work_Order_Item_ID || !items.has(l.Work_Order_Item_ID)) continue;
        if (!inRange(dOnly(l.Date), range)) continue;
        labor += l.Daily_Rate || 0;
        workerDays += l.Day_Fraction ?? 1;
        active.add(l.Work_Order_Item_ID);
    }
    let revenue = 0, material = 0, other = 0;
    items.forEach(({ item, date }, id) => {
        if (!hasRange(range) || inRange(date, range)) {
            const f = itemFinance(item, undefined, EMPTY_FINANCE_BASIS, 0);
            revenue += f.revenue; material += f.material; other += f.other;
            if (f.revenue || f.material || f.other) active.add(id);
        }
    });
    return {
        tasks: active.size,
        revenue: r2(revenue), material: r2(material), other: r2(other), labor: r2(labor),
        profit: r2(revenue - material - other - labor),
        workerDays: r2(workerDays),
    };
}

const ACTIVE_EXCLUDED = new Set(['Završeno', 'Otkazano']);

/** Da li projekat ulazi u opseg (Aktivni = nije završen/otkazan; Svi = nije otkazan). */
export function projectInScope(status: string | undefined, scope: AnalyticsScope): boolean {
    if (status === 'Otkazano') return false;
    return scope === 'all' ? true : !ACTIVE_EXCLUDED.has(status || '');
}

/** Finansije svih projekata za analitiku (sve dnevnice su učitane → bez sačuvanog agregata). */
export function computeAnalyticsFinance(input: Pick<AnalyticsInput, 'projects' | 'offers' | 'workOrders' | 'logs'>): Map<string, ProjectFinance> {
    const products: FinProduct[] = [];
    for (const p of input.projects || []) for (const pr of p.products || []) products.push(pr);
    return computeProjectsFinance({
        products,
        basis: buildFinanceBasis(products, input.offers || []),
        workOrders: input.workOrders || [],
        labor: buildLaborIndex(input.logs || [], input.workOrders || []),
        logs: input.logs || [],
    });
}

/**
 * Glavna agregacija. Finansije svih projekata se računaju JEDNOM (projectFinance), pa
 * se opseg/period primjenjuju kao čisti filteri — promjena perioda ne mijenja formulu.
 */
export function computeAnalytics(input: AnalyticsInput, opts: { from?: string; to?: string; scope?: AnalyticsScope; finance?: Map<string, ProjectFinance> } = {}): AnalyticsData {
    const scope: AnalyticsScope = opts.scope || 'active';
    const range: DateRange = { from: opts.from, to: opts.to };
    const periodOn = hasRange(range);

    const finance = opts.finance || computeAnalyticsFinance(input);

    const projectById = new Map((input.projects || []).map(p => [p.Project_ID, p]));
    const projectRows: AnalyticsProject[] = [];
    const productRows: AnalyticsProduct[] = [];
    const issues: AnalyticsIssue[] = [];

    finance.forEach((f, projectId) => {
        const proj = projectById.get(projectId);
        if (!proj || !projectInScope(proj.Status, scope)) return;
        const started = f.products.some(p => p.stage !== 'nije_zapoceto');
        if (f.contracted <= 0 && !started && f.razni.count === 0) return;

        const client = proj.Client_Name || '';
        const label = proj.Name?.trim() || client || '—';
        const rows: AnalyticsProduct[] = f.products.map(p => ({
            ...p,
            projectName: label,
            client,
            inPeriod: p.stage === 'zavrseno' ? (!periodOn || inRange(p.completedAt, range)) : true,
        }));
        productRows.push(...rows);
        for (const p of rows) if (p.stage !== 'nije_zapoceto' && hasFlag(p.flags)) issues.push(...issuesOf(p, label));

        const realized = sumStage(rows.filter(p => p.stage === 'zavrseno' && p.inPeriod));
        const razniProfit = periodOn ? 0 : f.razni.profit;
        const revenue = realized.revenue + (periodOn ? 0 : f.razni.revenue);
        const profit = r2(realized.profit + razniProfit);
        projectRows.push({
            projectId, client, name: label, status: proj.Status || '',
            contracted: f.contracted,
            productCount: f.productCount,
            scopeCount: f.scopeCount,
            outOfContractCount: f.outOfContractCount,
            finishedCount: f.finishedCount,
            spentMaterial: f.spentMaterial,
            spentLabor: f.spentLabor,
            realized,
            razniProfit,
            profit,
            margin: revenue > 0 ? r2((profit / revenue) * 100) : 0,
            inProgress: f.inProgress,
            notStartedCount: f.notStarted.count,
            flagged: f.flagged,
        });
    });

    projectRows.sort((a, b) => b.profit - a.profit || b.contracted - a.contracted);

    const realizedAll = sumStage(productRows.filter(p => p.stage === 'zavrseno' && p.inPeriod));
    const razniProjects = projectRows.reduce((s, p) => s + p.razniProfit, 0);
    const razniProjectsRevenue = periodOn ? 0 : Array.from(finance.entries())
        .filter(([id]) => projectRows.some(p => p.projectId === id))
        .reduce((s, [, f]) => s + f.razni.revenue, 0);
    const inProgressAll = sumStage(productRows.filter(p => p.stage === 'u_izradi'));
    const notStarted = productRows.filter(p => p.stage === 'nije_zapoceto' && p.inContract);
    const profit = r2(realizedAll.profit + razniProjects);
    const revenueAll = realizedAll.revenue + razniProjectsRevenue;

    const workers = aggregateWorkers({ logs: input.logs || [], attendance: input.attendance, workers: input.workers, workOrders: input.workOrders || [], range });
    const live = liveLogs(input.logs || []).filter(l => inRange(dOnly(l.Date), range));

    const kpis: AnalyticsKpis = {
        contracted: r2(projectRows.reduce((s, p) => s + p.contracted, 0)),
        realized: realizedAll,
        profit,
        margin: revenueAll > 0 ? r2((profit / revenueAll) * 100) : 0,
        inProgress: inProgressAll.count ? inProgressAll : emptyStageTotals(),
        notStartedCount: notStarted.length,
        notStartedContracted: r2(notStarted.reduce((s, p) => s + p.contracted, 0)),
        razni: razniSummary(input.workOrders || [], input.logs || [], range),
        laborInPeriod: r2(live.reduce((s, l) => s + (l.Daily_Rate || 0), 0)),
        workerDaysInPeriod: r2(live.reduce((s, l) => s + (l.Day_Fraction ?? 1), 0)),
        unbookedDays: workers.reduce((s, w) => s + w.unbookedDays, 0),
        flaggedProducts: new Set(issues.map(i => i.productId)).size,
    };

    return {
        range,
        scope,
        kpis,
        projects: projectRows,
        products: productRows,
        workers,
        pva: planVsActual(productRows),
        weeklyTrend: weeklyLaborTrend(input.logs || [], range),
        issues,
    };
}
