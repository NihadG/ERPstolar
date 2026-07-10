// ════════════════════════════════════════════════════════════════════
// ČISTA LOGIKA ANALITIKE (bez Firebase, pokrivena testovima).
//
// MODEL = STVARNO (kao kartica projekta): agregacija PO PROIZVODU (Product_ID),
//   profit = prodaja − ŽIVI materijal − STVARNI rad − transport − usluge.
//   • živi materijal = Σ product_materials × KOLIČINA (trenutno stanje, uklj. naknadno dodano / poskupljenja)
//   • stvarni rad    = Σ WorkLog.Daily_Rate po Product_ID (kroz sve naloge)
// Uz to čuvamo PLANIRANO (iz ponude) za poređenje "koliko sam potrefio":
//   • planirani materijal = OfferProduct.Material_Cost × količina
//   • planirani rad        = Σ Planned_Labor_Cost × količina
//
// Servis (analyticsService) radi spajanje (Firestore) i puni ProductInput[];
// ovdje je samo aritmetika + grupisanje (lako testirati).
// ════════════════════════════════════════════════════════════════════

export interface DateRange { from?: string; to?: string }   // YYYY-MM-DD, inkluzivno

/** Normalizovani ulaz PO PROIZVODU (svi iznosi su UKUPNI — količina uračunata). */
export interface ProductInput {
    itemId: string;             // reprezentativna WorkOrderItem.ID (za drill u timeline)
    productId: string; productName: string;
    projectId: string; projectName: string;
    woId: string; woNumber: string; woType: string; status: string;
    selling: number;            // prodajna (override ?? Product_Value ?? ponuda)
    liveMaterial: number;       // STVARNI materijal (Σ product_materials × količina)
    plannedMaterial: number;    // PLANIRANI materijal (iz ponude)
    actualLabor: number;        // STVARNI rad (Σ logova po Product_ID)
    plannedLabor: number;       // PLANIRANI rad (Σ Planned_Labor_Cost × kol.)
    transport: number; services: number;
}

export interface ALog {
    Date: string; Worker_ID: string; Worker_Name: string;
    Daily_Rate: number; Day_Fraction?: number;
    Work_Order_Item_ID?: string; Product_ID?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const inRange = (date: string, range?: DateRange) =>
    (!range?.from || date >= range.from) && (!range?.to || date <= range.to);

export interface ProductRow {
    itemId: string;
    productId: string; productName: string;
    projectId: string; projectName: string;
    woId: string; woNumber: string; woType: string; status: string;
    selling: number; material: number; labor: number; services: number; transport: number;
    profit: number; margin: number;                       // STVARNO
    plannedMaterial: number; plannedLabor: number;
    plannedProfit: number; plannedMargin: number;         // PLANIRANO (iz ponude)
    nonRevenue: boolean;                                  // montaža/teren (bez prihoda) → samo trošak rada
}

/** Po proizvodu: stvarni profit (živi materijal + stvarni rad) + planirani profit (ponuda). */
export function aggregateProductRows(inputs: ProductInput[]): ProductRow[] {
    return inputs.map(i => {
        const material = r2(i.liveMaterial);
        const labor = r2(i.actualLabor);
        const services = r2(i.services);
        const transport = r2(i.transport);
        const profit = r2(i.selling - material - labor - services - transport);
        const plannedProfit = r2(i.selling - i.plannedMaterial - i.plannedLabor - services - transport);
        return {
            itemId: i.itemId,
            productId: i.productId, productName: i.productName,
            projectId: i.projectId, projectName: i.projectName,
            woId: i.woId, woNumber: i.woNumber, woType: i.woType, status: i.status,
            selling: r2(i.selling), material, labor, services, transport,
            profit, margin: i.selling > 0 ? r2((profit / i.selling) * 100) : 0,
            plannedMaterial: r2(i.plannedMaterial), plannedLabor: r2(i.plannedLabor),
            plannedProfit, plannedMargin: i.selling > 0 ? r2((plannedProfit / i.selling) * 100) : 0,
            // Montaža/teren nalozi nemaju prihod (prihod je na proizvodnom nalogu) → samo trošak rada.
            nonRevenue: i.woType === 'Montaža' || (i.selling === 0 && i.liveMaterial === 0 && i.actualLabor > 0),
        };
    });
}

export interface ProjectRow {
    projectId: string; projectName: string;
    revenue: number; material: number; labor: number; services: number; transport: number;
    profit: number; margin: number;
    plannedMaterial: number; plannedLabor: number; plannedProfit: number;
    productCount: number;
}

export function aggregateProjects(rows: ProductRow[]): ProjectRow[] {
    const m = new Map<string, ProjectRow>();
    for (const p of rows) {
        const key = p.projectId || p.projectName || '—';
        let row = m.get(key);
        if (!row) {
            row = {
                projectId: p.projectId, projectName: p.projectName || '—',
                revenue: 0, material: 0, labor: 0, services: 0, transport: 0, profit: 0, margin: 0,
                plannedMaterial: 0, plannedLabor: 0, plannedProfit: 0, productCount: 0,
            };
            m.set(key, row);
        }
        row.revenue += p.selling; row.material += p.material; row.labor += p.labor;
        row.services += p.services; row.transport += p.transport; row.profit += p.profit;
        row.plannedMaterial += p.plannedMaterial; row.plannedLabor += p.plannedLabor; row.plannedProfit += p.plannedProfit;
        row.productCount++;
    }
    return Array.from(m.values())
        .map(r => ({
            ...r,
            revenue: r2(r.revenue), material: r2(r.material), labor: r2(r.labor), services: r2(r.services),
            transport: r2(r.transport), profit: r2(r.profit), margin: r.revenue > 0 ? r2((r.profit / r.revenue) * 100) : 0,
            plannedMaterial: r2(r.plannedMaterial), plannedLabor: r2(r.plannedLabor), plannedProfit: r2(r.plannedProfit),
        }))
        .sort((a, b) => b.profit - a.profit);
}

export interface PvAMetric {
    planned: number;            // Σ plana — SAMO proizvodi koji plan imaju (planned > 0)
    actual: number;             // Σ stvarnog za TE ISTE (planirane) proizvode
    variance: number; variancePct: number; accuracyPct: number;
    unplannedActual: number;    // stvarni trošak proizvoda BEZ plana (ne ulazi u poređenje — nema s čim)
}
export interface PvARow { projectId: string; projectName: string; material: PvAMetric; labor: PvAMetric }

/** variance = plan − stvarno (>0 = ušteda / ispod plana). accuracy = 100 − |odstupanje%|. */
function metric(planned: number, actual: number, unplannedActual: number): PvAMetric {
    const variance = r2(planned - actual);
    const variancePct = planned > 0 ? r2(((planned - actual) / planned) * 100) : 0;
    const accuracyPct = planned > 0 ? r2(Math.max(0, 100 - Math.abs((actual - planned) / planned) * 100)) : (actual === 0 ? 100 : 0);
    return { planned: r2(planned), actual: r2(actual), variance, variancePct, accuracyPct, unplannedActual: r2(unplannedActual) };
}

/**
 * Plan (ponuda) vs Stvarno za MATERIJAL i RAD — ukupno i po projektu.
 * Poređenje "koliko sam potrefio" je fer SAMO nad proizvodima koji plan IMAJU:
 * proizvod bez plana (nema prihvaćene ponude / plan = 0) ne može "prekoračiti plan" —
 * njegov stvarni trošak ide odvojeno u `unplannedActual` (prikaz "van plana"),
 * umjesto da napuhava prekoračenje (npr. plan 520 vs stvarno 12.957 → "2392%").
 */
export function planVsActual(rows: ProductRow[]): { total: PvARow; byProject: PvARow[] } {
    interface Acc { projectId: string; projectName: string; pm: number; am: number; um: number; pl: number; al: number; ul: number }
    const m = new Map<string, Acc>();
    const tot: Acc = { projectId: '', projectName: 'Ukupno', pm: 0, am: 0, um: 0, pl: 0, al: 0, ul: 0 };
    const add = (a: Acc, p: ProductRow) => {
        if (p.plannedMaterial > 0) { a.pm += p.plannedMaterial; a.am += p.material; } else { a.um += p.material; }
        if (p.plannedLabor > 0) { a.pl += p.plannedLabor; a.al += p.labor; } else { a.ul += p.labor; }
    };
    for (const p of rows) {
        add(tot, p);
        const key = p.projectId || p.projectName || '—';
        let row = m.get(key);
        if (!row) { row = { projectId: p.projectId, projectName: p.projectName || '—', pm: 0, am: 0, um: 0, pl: 0, al: 0, ul: 0 }; m.set(key, row); }
        add(row, p);
    }
    const mk = (r: Acc): PvARow =>
        ({ projectId: r.projectId, projectName: r.projectName, material: metric(r.pm, r.am, r.um), labor: metric(r.pl, r.al, r.ul) });
    const byProject = Array.from(m.values())
        .map(mk)
        .sort((a, b) => (Math.abs(b.material.variance) + Math.abs(b.labor.variance)) - (Math.abs(a.material.variance) + Math.abs(a.labor.variance)));
    return { total: mk(tot), byProject };
}

export interface WorkerRow { workerId: string; name: string; days: number; earnings: number; avgRate: number; products: number }

/** Statistika radnika za period: dani = UNIQUE datumi. */
export function aggregateWorkers(logs: ALog[], range?: DateRange): WorkerRow[] {
    const m = new Map<string, { name: string; dates: Set<string>; earnings: number; items: Set<string> }>();
    for (const l of logs) {
        if (!inRange(l.Date, range)) continue;
        let row = m.get(l.Worker_ID);
        if (!row) { row = { name: l.Worker_Name, dates: new Set(), earnings: 0, items: new Set() }; m.set(l.Worker_ID, row); }
        row.dates.add(l.Date);
        row.earnings += l.Daily_Rate || 0;
        if (l.Work_Order_Item_ID) row.items.add(l.Work_Order_Item_ID);
    }
    return Array.from(m.entries())
        .map(([workerId, r]) => ({
            workerId, name: r.name, days: r.dates.size, earnings: r2(r.earnings),
            avgRate: r.dates.size > 0 ? r2(r.earnings / r.dates.size) : 0, products: r.items.size,
        }))
        .sort((a, b) => b.earnings - a.earnings);
}

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function mondayOf(iso: string): string {
    const d = new Date(iso + 'T12:00:00');
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return toISO(d);
}

export interface WeekBucket { weekStart: string; labor: number }
export function weeklyLaborTrend(logs: ALog[], range?: DateRange): WeekBucket[] {
    const m = new Map<string, number>();
    for (const l of logs) {
        if (!inRange(l.Date, range)) continue;
        const ws = mondayOf(l.Date);
        m.set(ws, (m.get(ws) || 0) + (l.Daily_Rate || 0));
    }
    return Array.from(m.entries()).map(([weekStart, labor]) => ({ weekStart, labor: r2(labor) })).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface Kpis {
    revenue: number; material: number; labor: number; services: number; transport: number;
    profit: number; margin: number; productCount: number;
    plannedMaterial: number; plannedLabor: number; plannedProfit: number;
    montazaLabor: number;        // od ukupnog rada: koliko je montaža/teren (bez prihoda) — za info
}

export function computeKpis(rows: ProductRow[]): Kpis {
    const sum = (sel: (p: ProductRow) => number) => rows.reduce((s, p) => s + sel(p), 0);
    const revenue = sum(p => p.selling);
    const profit = sum(p => p.profit);
    return {
        revenue: r2(revenue), material: r2(sum(p => p.material)), labor: r2(sum(p => p.labor)),
        services: r2(sum(p => p.services)), transport: r2(sum(p => p.transport)),
        profit: r2(profit), margin: revenue > 0 ? r2((profit / revenue) * 100) : 0, productCount: rows.length,
        plannedMaterial: r2(sum(p => p.plannedMaterial)), plannedLabor: r2(sum(p => p.plannedLabor)), plannedProfit: r2(sum(p => p.plannedProfit)),
        montazaLabor: r2(sum(p => p.nonRevenue ? p.labor : 0)),
    };
}
