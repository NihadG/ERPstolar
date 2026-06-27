// ════════════════════════════════════════════════════════════════════
// ČISTA LOGIKA ANALITIKE (bez Firebase, pokrivena testovima).
//
// Jedinstvena profit formula (kao profitDashboardService / WorkOrderExpandedDetail):
//   profit = prodajna − materijal − rad − usluge − transport
// Trošak rada proizvoda = Σ WorkLog.Daily_Rate (kumulativno, ne po periodu).
// Statistika radnika i trend rada = filtrirano po periodu (DateRange).
// ════════════════════════════════════════════════════════════════════

export interface DateRange { from?: string; to?: string }   // YYYY-MM-DD, inkluzivno

export interface AItem {
    ID: string;
    Product_ID?: string;
    Product_Name?: string;
    Project_ID?: string;
    Project_Name?: string;
    Work_Order_ID?: string;
    Work_Order_Number?: string;
    Work_Order_Type?: string;          // 'Montaža' …
    Status?: string;
    Product_Value?: number;
    Material_Cost?: number;
    Services_Total?: number;
    Transport_Share?: number;
    Planned_Labor_Cost?: number;
    Profit_Overrides?: { Selling_Price?: number; Transport_Share?: number };
}

export interface ALog {
    Date: string;                      // YYYY-MM-DD
    Worker_ID: string;
    Worker_Name: string;
    Daily_Rate: number;
    Day_Fraction?: number;
    Work_Order_Item_ID?: string;
    Product_ID?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const inRange = (date: string, range?: DateRange) =>
    (!range?.from || date >= range.from) && (!range?.to || date <= range.to);

const sellingOf = (it: AItem) => (it.Profit_Overrides?.Selling_Price ?? it.Product_Value) || 0;
const transportOf = (it: AItem) => it.Profit_Overrides?.Transport_Share ?? it.Transport_Share ?? 0;

/** Σ Daily_Rate po Work_Order_Item_ID (opc. filtrirano po periodu). */
export function laborByItem(logs: ALog[], range?: DateRange): Map<string, number> {
    const m = new Map<string, number>();
    for (const l of logs) {
        if (!inRange(l.Date, range)) continue;
        const id = l.Work_Order_Item_ID;
        if (!id) continue;
        m.set(id, (m.get(id) || 0) + (l.Daily_Rate || 0));
    }
    for (const [k, v] of Array.from(m)) m.set(k, r2(v));
    return m;
}

export interface ProductRow {
    itemId: string; productId: string; productName: string;
    projectId: string; projectName: string;
    woId: string; woNumber: string; woType: string; status: string;
    selling: number; material: number; labor: number; services: number; transport: number;
    profit: number; margin: number; plannedLabor: number;
}

/** Profitabilnost po proizvodu (kumulativni rad). */
export function aggregateProducts(items: AItem[], logs: ALog[]): ProductRow[] {
    const lbi = laborByItem(logs);
    return items.map(it => {
        const labor = lbi.get(it.ID) || 0;
        const selling = sellingOf(it);
        const material = it.Material_Cost || 0;
        const services = it.Services_Total || 0;
        const transport = transportOf(it);
        const profit = r2(selling - material - labor - services - transport);
        return {
            itemId: it.ID, productId: it.Product_ID || '', productName: it.Product_Name || 'Proizvod',
            projectId: it.Project_ID || '', projectName: it.Project_Name || '—',
            woId: it.Work_Order_ID || '', woNumber: it.Work_Order_Number || '', woType: it.Work_Order_Type || '',
            status: it.Status || '',
            selling: r2(selling), material: r2(material), labor: r2(labor), services: r2(services), transport: r2(transport),
            profit, margin: selling > 0 ? r2((profit / selling) * 100) : 0,
            plannedLabor: r2(it.Planned_Labor_Cost || 0),
        };
    });
}

export interface ProjectRow {
    projectId: string; projectName: string;
    revenue: number; material: number; labor: number; services: number; transport: number;
    profit: number; margin: number; plannedLabor: number; productCount: number;
}

/** Profitabilnost po projektu (zbir proizvoda; montažni rad ulazi kao trošak). */
export function aggregateProjects(items: AItem[], logs: ALog[]): ProjectRow[] {
    const products = aggregateProducts(items, logs);
    const m = new Map<string, ProjectRow>();
    for (const p of products) {
        const key = p.projectId || p.projectName || '—';
        let row = m.get(key);
        if (!row) {
            row = { projectId: p.projectId, projectName: p.projectName || '—', revenue: 0, material: 0, labor: 0, services: 0, transport: 0, profit: 0, margin: 0, plannedLabor: 0, productCount: 0 };
            m.set(key, row);
        }
        row.revenue += p.selling; row.material += p.material; row.labor += p.labor;
        row.services += p.services; row.transport += p.transport; row.profit += p.profit;
        row.plannedLabor += p.plannedLabor; row.productCount++;
    }
    return Array.from(m.values())
        .map(r => ({
            ...r,
            revenue: r2(r.revenue), material: r2(r.material), labor: r2(r.labor),
            services: r2(r.services), transport: r2(r.transport), profit: r2(r.profit),
            plannedLabor: r2(r.plannedLabor), margin: r.revenue > 0 ? r2((r.profit / r.revenue) * 100) : 0,
        }))
        .sort((a, b) => b.profit - a.profit);
}

export interface PvARow {
    projectId: string; projectName: string;
    plannedLabor: number; actualLabor: number; variance: number; variancePct: number;
}

/** Planirane dnevnice (ponuda) vs stvarne, ukupno i po projektu. variance = plan − stvarno (>0 = ušteda). */
export function planVsActual(items: AItem[], logs: ALog[]): { total: PvARow; byProject: PvARow[] } {
    const lbi = laborByItem(logs);
    const m = new Map<string, { projectId: string; projectName: string; planned: number; actual: number }>();
    let tp = 0, ta = 0;
    for (const it of items) {
        const key = it.Project_ID || it.Project_Name || '—';
        const planned = it.Planned_Labor_Cost || 0;
        const actual = lbi.get(it.ID) || 0;
        tp += planned; ta += actual;
        let row = m.get(key);
        if (!row) { row = { projectId: it.Project_ID || '', projectName: it.Project_Name || '—', planned: 0, actual: 0 }; m.set(key, row); }
        row.planned += planned; row.actual += actual;
    }
    const mk = (planned: number, actual: number, projectId = '', projectName = ''): PvARow => ({
        projectId, projectName,
        plannedLabor: r2(planned), actualLabor: r2(actual),
        variance: r2(planned - actual),
        variancePct: planned > 0 ? r2(((planned - actual) / planned) * 100) : 0,
    });
    const byProject = Array.from(m.values())
        .map(r => mk(r.planned, r.actual, r.projectId, r.projectName))
        .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
    return { total: mk(tp, ta), byProject };
}

export interface WorkerRow {
    workerId: string; name: string;
    days: number; earnings: number; avgRate: number; products: number;
}

/** Statistika radnika za period: dani = UNIQUE datumi (multi-proizvod dan = 1 dan). */
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
            workerId, name: r.name,
            days: r.dates.size, earnings: r2(r.earnings),
            avgRate: r.dates.size > 0 ? r2(r.earnings / r.dates.size) : 0,
            products: r.items.size,
        }))
        .sort((a, b) => b.earnings - a.earnings);
}

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Ponedjeljak sedmice za dati datum (lokalno, bez UTC pomaka). */
export function mondayOf(iso: string): string {
    const d = new Date(iso + 'T12:00:00');
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return toISO(d);
}

export interface WeekBucket { weekStart: string; labor: number }

/** Trošak rada po sedmici (za jednostavan trend-bar). */
export function weeklyLaborTrend(logs: ALog[], range?: DateRange): WeekBucket[] {
    const m = new Map<string, number>();
    for (const l of logs) {
        if (!inRange(l.Date, range)) continue;
        const ws = mondayOf(l.Date);
        m.set(ws, (m.get(ws) || 0) + (l.Daily_Rate || 0));
    }
    return Array.from(m.entries())
        .map(([weekStart, labor]) => ({ weekStart, labor: r2(labor) }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface Kpis {
    revenue: number; material: number; labor: number; services: number; transport: number;
    profit: number; margin: number; productCount: number;
}

/** Zbirni KPI iz reda proizvoda. */
export function computeKpis(products: ProductRow[]): Kpis {
    const sum = (sel: (p: ProductRow) => number) => products.reduce((s, p) => s + sel(p), 0);
    const revenue = sum(p => p.selling);
    const profit = sum(p => p.profit);
    return {
        revenue: r2(revenue), material: r2(sum(p => p.material)), labor: r2(sum(p => p.labor)),
        services: r2(sum(p => p.services)), transport: r2(sum(p => p.transport)),
        profit: r2(profit), margin: revenue > 0 ? r2((profit / revenue) * 100) : 0,
        productCount: products.length,
    };
}
