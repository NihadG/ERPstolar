// ════════════════════════════════════════════════════════════════════
// PREGLED PROJEKTA — jedinstvena agregacija za full-screen pregled projekta.
//
// Sve što „Pregled projekta" prikazuje računa se OVDJE, iz podataka koji su VEĆ
// u memoriji (projekti+proizvodi+materijali, nalozi+stavke, dnevnik rada, ponude) —
// bez ijednog novog Firestore upita, pa je otvaranje TRENUTNO (kao WorkOrderFullScreen).
//
// FINANSIJE dolaze iz lib/projectFinance.ts — ISTI proračun kao kartica projekta,
// nalog (WorkOrderExpandedDetail) i analitika: prihod iz prihvaćene ponude, materijal =
// živa sastavnica + dodaci iz ponude, rad = Σ dnevnica; profit za ZAVRŠENE proizvode.
// Pregled se zato ne može razići od ostatka aplikacije.
//
// Ulazni tipovi su NAMJERNO uski (samo polja koja se čitaju) — pravi tipovi
// (WorkOrder, WorkOrderItem, …) ih strukturno zadovoljavaju, pa komponenta
// prosljeđuje pune objekte, a testovi grade minimalne fiksture bez kastova.
// ════════════════════════════════════════════════════════════════════

import { itemProfitBreakdown, profitFromTotals, type ProfitBreakdown } from './profit';
import { mondayOf } from './analytics';
import {
    buildFinanceBasis, buildLaborIndex, computeProjectFinance, itemFinance, sumItemFinance, liveLogs,
    type FinOffer, type FinProduct, type ProjectFinance, type ProductStage, type ProductFlags, type RevenueSource,
} from './projectFinance';

const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Uski ulazni tipovi ──────────────────────────────────────────────
export interface OverviewMaterialInput {
    Material_ID: string;
    Material_Name: string;
    Unit?: string;
    Category?: string;
    Quantity?: number;
    Total_Price?: number;
    Status?: string;
    On_Stock?: number;
    Ordered_Quantity?: number;
    Received_Quantity?: number;
}
export interface OverviewProductInput {
    Product_ID: string;
    Name?: string;
    Quantity?: number;
    Status?: string;
    materials?: OverviewMaterialInput[];
}
export interface OverviewProjectInput {
    Project_ID: string;
    products?: OverviewProductInput[];
}
export interface OverviewItemInput {
    ID: string;
    Product_ID?: string;
    Product_Name?: string;
    Project_ID?: string;
    Quantity?: number;
    Item_Type?: 'product' | 'custom';
    Linked_Item_ID?: string;        // custom zadatak vezan na proizvod → rad ide proizvodu, ne u „razni"
    Status?: string;
    Started_At?: string;
    Completed_At?: string;
    Product_Value?: number;
    Material_Cost?: number;
    Other_Costs?: number;
    Services_Total?: number;
    Transport_Share?: number;
    Planned_Labor_Cost?: number;
    Actual_Labor_Cost?: number;
    Profit_Overrides?: { Selling_Price?: number; Transport_Share?: number };
}
export interface OverviewWorkOrderInput {
    Work_Order_ID: string;
    Work_Order_Number?: string;
    Name?: string;
    Status?: string;
    Work_Order_Type?: string;
    Created_Date?: string;
    Due_Date?: string;
    Started_At?: string;
    Completed_At?: string;
    items?: OverviewItemInput[];
}
export interface OverviewLogInput {
    Work_Order_ID?: string;
    Work_Order_Item_ID?: string;
    Work_Order_Deleted?: boolean;
    Product_ID?: string;
    Worker_ID?: string;
    Worker_Name?: string;
    Daily_Rate?: number;
    Day_Fraction?: number;
    Date?: string;
    Process_Name?: string;
}
export interface OverviewOfferProductInput {
    Product_ID?: string;
    Product_Name?: string;
    Included?: boolean;
    Material_Cost?: number;
    Quantity?: number;
    Selling_Price?: number;
    Total_Price?: number;
    Labor_Workers?: number;
    Labor_Days?: number;
    Labor_Daily_Rate?: number;
    extras?: { Total?: number }[];
}
export interface OverviewOfferInput {
    Offer_ID?: string;
    Project_ID?: string;
    Offer_Number?: string;
    Status?: string;
    Total?: number;
    Subtotal?: number;
    Include_PDV?: boolean;
    PDV_Rate?: number;
    Transport_Cost?: number;
    Onsite_Assembly?: boolean;
    Onsite_Discount?: number;
    Accepted_Date?: string;
    Created_Date?: string;
    products?: OverviewOfferProductInput[];
}
export interface OverviewWorkerInput {
    Worker_ID: string;
    Name?: string;
    Role?: string;
    Worker_Type?: string;
}

// ── Izlazni redovi ──────────────────────────────────────────────────
export interface ProductOverviewRow {
    productId: string;
    productName: string;
    quantity: number;
    status: string;                 // 'Završeno' | 'U toku' | 'Na čekanju' (iz faze proizvoda)
    stage: ProductStage;            // faza iz lib/projectFinance (završeno / u izradi / nije započeto)
    contracted: number;             // vrijednost u prihvaćenoj ponudi (0 bez ponude)
    revenueSource: RevenueSource;   // 'ponuda' | 'nalog' (nema prihvaćene ponude)
    materialExtras: number;         // dio materijala iz dodataka ponude
    flags?: ProductFlags;
    revenue: number;
    material: number;
    labor: number;
    services: number;
    transport: number;
    other: number;                  // ostali troškovi (razni nalozi); 0 za proizvode
    profit: number;
    margin: number;
    missingPrice: boolean;
    plannedLabor: number;
    plannedMaterial: number;
    workerDays: number;             // Σ Day_Fraction logova proizvoda (dio projekta)
    workerCount: number;
    workOrderNumbers: string[];
    isCustom: boolean;              // ad-hoc zadatak (Razni poslovi), ne pravi proizvod
    notInProduction: boolean;       // proizvod projekta koji JOŠ nije ni u jednom nalogu
}

export interface WorkOrderOverviewRow {
    workOrderId: string;
    number: string;
    name: string;
    type: string;
    status: string;
    createdDate?: string;
    startedAt?: string;
    completedAt?: string;
    dueDate?: string;
    itemCount: number;
    revenue: number;
    material: number;
    labor: number;
    services: number;
    transport: number;
    profit: number;
    margin: number;
}

export interface WorkerOverviewRow {
    workerId: string;
    name: string;
    role?: string;
    type?: string;
    days: number;                   // Σ Day_Fraction (dio projekta) — fer podjela dana među projektima
    cost: number;                   // Σ Daily_Rate
    avgRate: number;                // cost / days
    productCount: number;
    productNames: string[];
    firstDate?: string;
    lastDate?: string;
}

export interface MaterialOverviewRow {
    materialId: string;
    name: string;
    unit: string;
    category?: string;
    needed: number;
    onStock: number;
    ordered: number;
    received: number;
    remaining: number;
    status: string;                 // najgori status u grupi
    lineCost: number;               // Σ Total_Price (katalog, po komadu) — referentna vrijednost
    products: string[];
}

export interface WeekLaborBucket {
    weekStart: string;              // ISO ponedjeljak
    labor: number;
}

export interface DayLaborBucket {
    date: string;                   // ISO datum (YYYY-MM-DD)
    labor: number;
    workers: number;                // broj različitih radnika taj dan
}

export interface ProjectOverview {
    projectId: string;
    /** Pun proračun projekta (lib/projectFinance): ugovoreno, završeno, u izradi, nije započeto. */
    finance: ProjectFinance;
    // NASLOVNE finansije = ZAVRŠENI proizvodi (+ razni nalozi projekta) — isti broj kao
    // kartica projekta i analitika. Proizvodi u izradi su u finance.inProgress.
    financial: ProfitBreakdown;
    /** Sav rad uložen u projekat do sada (završeno + u izradi + razni), za tab Radnici. */
    spentLabor: number;
    // PLAN (iz prihvaćene ponude / snapshot stavki) za poređenje „koliko sam potrefio"
    hasPlan: boolean;
    plannedMaterial: number;
    plannedLabor: number;
    plannedProfit: number;
    plannedMargin: number;
    // Detaljni redovi
    products: ProductOverviewRow[];
    workOrders: WorkOrderOverviewRow[];
    workers: WorkerOverviewRow[];
    materials: MaterialOverviewRow[];
    materialCatalogCost: number;    // Σ live BOM (Total_Price, katalog) — referentno naspram financial.material
    laborByWeek: WeekLaborBucket[];
    laborByDay: DayLaborBucket[];
    counts: {
        products: number;           // svi proizvodi projekta (uklj. one koji nisu u nalogu)
        productsFinished: number;   // završeni (ulaze u profit)
        productsInProduction: number;   // u izradi
        productsNotStarted: number; // proizvodi bez ijednog naloga
        workOrders: number;
        workers: number;
        totalWorkerDays: number;    // Σ Day_Fraction preko projekta
        materials: number;
    };
    acceptedOffer?: {
        offerNumber?: string;
        total: number;
        subtotal: number;
        includePDV: boolean;
        pdvRate: number;
        transportCost: number;
    };
    /** Sve prihvaćene ponude projekta (faze) — ugovoreno = Σ. */
    acceptedOffers: { offerNumber: string; total: number; acceptedDate: string }[];
}

// Najgori (najmanje spreman) status materijala određuje status grupe.
const MATERIAL_STATUS_PRIORITY: Record<string, number> = {
    'Nije naručeno': 0,
    'Naručeno': 1,
    'Na stanju': 2,
    'Primljeno': 3,
};
function worstMaterialStatus(a: string, b: string): string {
    return (MATERIAL_STATUS_PRIORITY[a] ?? 0) <= (MATERIAL_STATUS_PRIORITY[b] ?? 0) ? a : b;
}

// Status proizvoda izveden iz njegovih stavki (pouzdaniji od Product.Status stringa —
// vidi getProductStatus u ProjectsTab): bilo koja aktivna stavka → U toku; sve završene → Završeno.
function deriveProductStatus(statuses: string[], fallback?: string): string {
    if (statuses.length === 0) return fallback || 'Na čekanju';
    if (statuses.some(s => s === 'U toku')) return 'U toku';
    if (statuses.every(s => s === 'Završeno')) return 'Završeno';
    return 'Na čekanju';
}

/**
 * Glavna agregacija: sve što „Pregled projekta" treba, iz podataka u memoriji.
 * Finansije = lib/projectFinance (ponuda − živi materijal − rad, profit za završene
 * proizvode) — isti proračun kao kartica projekta i analitika. Otkazani nalozi se ne
 * prikazuju u listi naloga; njihov isplaćeni rad ostaje trošak proizvoda.
 *
 * `storedLaborBefore` (YYYY-MM-DD): početak prozora dnevnica u memoriji — stavke
 * započete prije njega uzimaju sačuvani agregat rada (vidi buildLaborIndex).
 */
export function buildProjectOverview(args: {
    project: OverviewProjectInput;
    workOrders: OverviewWorkOrderInput[];
    workLogs: OverviewLogInput[];
    offers?: OverviewOfferInput[];
    workers?: OverviewWorkerInput[];
    storedLaborBefore?: string;
}): ProjectOverview {
    const { project, workOrders, workLogs, offers = [], workers = [], storedLaborBefore } = args;
    const projectId = project.Project_ID;
    const live = liveLogs(workLogs);

    // ── Finansije (jedan proračun za cijelu aplikaciju) ──────────────
    const projectOffers: FinOffer[] = offers
        .filter(o => o.Offer_ID && o.Project_ID === projectId)
        .map(o => ({ ...o, Offer_ID: o.Offer_ID as string, Project_ID: projectId }));
    const finProducts: FinProduct[] = (project.products || []).map(p => ({ ...p, Project_ID: projectId }));
    const basis = buildFinanceBasis(finProducts, projectOffers);
    const labor = buildLaborIndex(workLogs, workOrders, storedLaborBefore);
    const finance = computeProjectFinance({ projectId, products: finProducts, basis, workOrders, labor, logs: workLogs });
    const laborOf = (itemId: string) => labor.byItem.get(itemId)?.cost || 0;

    // ── Nalozi projekta (bez otkazanih) + razni nalozi projekta ──────
    const projectItemIds = new Set<string>();       // SVE stavke projekta (i otkazanih naloga — njihov rad je trošak)
    const woRows: WorkOrderOverviewRow[] = [];
    const razni = {
        quantity: 0, statuses: [] as string[], woNumbers: new Set<string>(),
        fins: [] as ReturnType<typeof itemFinance>[],
    };

    for (const wo of workOrders) {
        const items = (wo.items || []).filter(it => it.Project_ID === projectId);
        if (items.length === 0) continue;
        for (const item of items) projectItemIds.add(item.ID);
        if (wo.Status === 'Otkazano') continue;

        const fins = items.map(item => itemFinance(item, wo, basis, laborOf(item.ID)));
        items.forEach((item, i) => {
            if (fins[i].kind !== 'razno' || item.Linked_Item_ID) return;
            razni.quantity += item.Quantity || 1;
            razni.statuses.push(item.Status || 'Na čekanju');
            if (wo.Work_Order_Number) razni.woNumbers.add(wo.Work_Order_Number);
            razni.fins.push(fins[i]);
        });

        const woTot = sumItemFinance(fins);
        woRows.push({
            workOrderId: wo.Work_Order_ID,
            number: wo.Work_Order_Number || '',
            name: wo.Name || '',
            type: wo.Work_Order_Type || 'Proizvodnja',
            status: wo.Status || 'Na čekanju',
            createdDate: wo.Created_Date,
            startedAt: wo.Started_At,
            completedAt: wo.Completed_At,
            dueDate: wo.Due_Date,
            itemCount: items.length,
            revenue: woTot.revenue,
            material: woTot.material,
            labor: woTot.labor,
            services: 0,
            transport: 0,
            profit: woTot.profit,
            margin: woTot.margin,
        });
    }

    // ── Radnici / trend rada (žive dnevnice stavki ovog projekta) ────
    const workerById = new Map(workers.map(w => [w.Worker_ID, w]));
    const workerAcc = new Map<string, {
        name: string; days: number; cost: number;
        products: Set<string>; dates: Set<string>;
    }>();
    const weekAcc = new Map<string, number>();
    const dayAcc = new Map<string, { labor: number; workers: Set<string> }>();
    const workersByProductId = new Map<string, Set<string>>();

    for (const wl of live) {
        if (!wl.Work_Order_Item_ID || !projectItemIds.has(wl.Work_Order_Item_ID)) continue;
        const frac = wl.Day_Fraction ?? 1;
        const rate = wl.Daily_Rate || 0;
        const wid = wl.Worker_ID || 'unknown';
        let wa = workerAcc.get(wid);
        if (!wa) {
            wa = { name: wl.Worker_Name || workerById.get(wid)?.Name || 'Radnik', days: 0, cost: 0, products: new Set(), dates: new Set() };
            workerAcc.set(wid, wa);
        }
        wa.days += frac;
        wa.cost += rate;
        if (wl.Product_ID) wa.products.add(wl.Product_ID);
        if (wl.Date) wa.dates.add(wl.Date);
        if (wl.Date) {
            weekAcc.set(mondayOf(wl.Date), (weekAcc.get(mondayOf(wl.Date)) || 0) + rate);
            let da = dayAcc.get(wl.Date);
            if (!da) { da = { labor: 0, workers: new Set() }; dayAcc.set(wl.Date, da); }
            da.labor += rate;
            da.workers.add(wid);
        }
        if (wl.Product_ID) {
            let wset = workersByProductId.get(wl.Product_ID);
            if (!wset) { wset = new Set(); workersByProductId.set(wl.Product_ID, wset); }
            wset.add(wid);
        }
    }

    // ── Redovi proizvoda (iz proračuna) + jedan red „Razni nalozi" ───
    const STATUS_OF: Record<ProductStage, string> = { zavrseno: 'Završeno', u_izradi: 'U toku', nije_zapoceto: 'Na čekanju' };
    const productRows: ProductOverviewRow[] = finance.products.map(p => ({
        productId: p.productId,
        productName: p.name,
        quantity: p.quantity,
        status: STATUS_OF[p.stage],
        stage: p.stage,
        contracted: p.contracted,
        revenueSource: p.revenueSource,
        materialExtras: p.materialExtras,
        flags: p.flags,
        revenue: p.stage === 'nije_zapoceto' ? 0 : p.revenue,
        material: p.material,
        labor: p.labor,
        services: 0,
        transport: 0,
        other: 0,
        profit: p.stage === 'nije_zapoceto' ? 0 : p.profit,
        margin: p.stage === 'nije_zapoceto' ? 0 : p.margin,
        missingPrice: p.flags.noPrice,
        plannedLabor: p.plannedLabor,
        plannedMaterial: p.plannedMaterial,
        workerDays: p.laborDays,
        workerCount: workersByProductId.get(p.productId)?.size || 0,
        workOrderNumbers: p.workOrders.filter(w => w.status !== 'Otkazano').map(w => w.number).filter(Boolean),
        isCustom: false,
        notInProduction: p.stage === 'nije_zapoceto',
    }));
    if (razni.fins.length > 0) {
        const t = sumItemFinance(razni.fins);
        productRows.push({
            productId: '__razni__',
            productName: 'Razni nalozi',
            quantity: razni.quantity,
            status: deriveProductStatus(razni.statuses),
            stage: razni.statuses.every(st => st === 'Završeno') ? 'zavrseno' : 'u_izradi',
            contracted: 0,
            revenueSource: 'nalog',
            materialExtras: 0,
            revenue: t.revenue,
            material: t.material,
            labor: t.labor,
            services: 0,
            transport: 0,
            other: t.other,
            profit: t.profit,
            margin: t.margin,
            missingPrice: false,
            plannedLabor: 0,
            plannedMaterial: 0,
            workerDays: 0,
            workerCount: 0,
            workOrderNumbers: Array.from(razni.woNumbers),
            isCustom: true,
            notInProduction: false,
        });
    }
    productRows.sort((a, b) => {
        const rank = (r: ProductOverviewRow) => (r.isCustom ? 3 : r.stage === 'u_izradi' ? 0 : r.stage === 'zavrseno' ? 1 : 2);
        return rank(a) - rank(b) || (b.revenue || b.contracted) - (a.revenue || a.contracted) || a.productName.localeCompare(b.productName, 'hr');
    });

    // Mapa Product_ID → naziv (za listu proizvoda radnika)
    const productNameById = new Map(finance.products.map(p => [p.productId, p.name]));

    const workerRows: WorkerOverviewRow[] = Array.from(workerAcc.entries())
        .map(([workerId, w]) => {
            const cat = workerById.get(workerId);
            const dates = Array.from(w.dates).sort();
            return {
                workerId,
                name: w.name,
                role: cat?.Role,
                type: cat?.Worker_Type,
                days: r2(w.days),
                cost: r2(w.cost),
                avgRate: w.days > 0 ? r2(w.cost / w.days) : 0,
                productCount: w.products.size,
                productNames: Array.from(w.products).map(pid => productNameById.get(pid) || '—'),
                firstDate: dates[0],
                lastDate: dates[dates.length - 1],
            };
        })
        .sort((a, b) => b.cost - a.cost);

    // ── Materijali (BOM projekta, kao ProjectMaterialsModal) ─────────
    const matMap = new Map<string, MaterialOverviewRow>();
    for (const product of project.products || []) {
        for (const mat of product.materials || []) {
            const key = mat.Material_ID || mat.Material_Name;
            const productName = product.Name || 'Proizvod';
            const ex = matMap.get(key);
            if (ex) {
                ex.needed += mat.Quantity || 0;
                ex.onStock += mat.On_Stock || 0;
                ex.ordered += mat.Ordered_Quantity || 0;
                ex.received += mat.Received_Quantity || 0;
                ex.lineCost += mat.Total_Price || 0;
                ex.status = worstMaterialStatus(ex.status, mat.Status || 'Nije naručeno');
                if (!ex.products.includes(productName)) ex.products.push(productName);
            } else {
                matMap.set(key, {
                    materialId: mat.Material_ID || '',
                    name: mat.Material_Name,
                    unit: mat.Unit || 'kom',
                    category: mat.Category,
                    needed: mat.Quantity || 0,
                    onStock: mat.On_Stock || 0,
                    ordered: mat.Ordered_Quantity || 0,
                    received: mat.Received_Quantity || 0,
                    remaining: 0,
                    status: mat.Status || 'Nije naručeno',
                    lineCost: mat.Total_Price || 0,
                    products: [productName],
                });
            }
        }
    }
    const materials = Array.from(matMap.values());
    for (const m of materials) {
        m.needed = r2(m.needed);
        m.onStock = r2(m.onStock);
        m.ordered = r2(m.ordered);
        m.received = r2(m.received);
        m.lineCost = r2(m.lineCost);
        m.remaining = r2(Math.max(0, m.needed - m.onStock - m.received));
    }
    materials.sort((a, b) => a.name.localeCompare(b.name, 'hr'));
    const materialCatalogCost = r2(materials.reduce((s, m) => s + m.lineCost, 0));

    // ── Naslovne finansije = ZAVRŠENI proizvodi + razni nalozi projekta ─────────
    const started = finance.products.filter(p => p.stage !== 'nije_zapoceto');
    const financial: ProfitBreakdown = {
        revenue: finance.revenue,
        material: finance.material,
        labor: finance.labor,
        services: 0,
        transport: 0,
        other: r2(finance.razni.other),
        profit: finance.profit,
        margin: finance.margin,
        missingPrice: started.some(p => p.flags.noPrice || p.flags.noOffer),
        missingMaterial: started.some(p => p.flags.noMaterial),
    };

    // PLAN (ponuda) vs stvarno — za iste (završene) proizvode koji nose profit.
    const plannedMaterial = finance.realized.plannedMaterial;
    const plannedLabor = finance.realized.plannedLabor;
    const plannedProfit = r2(finance.realized.plannedProfit + finance.razni.profit);
    const hasPlan = plannedMaterial > 0 || plannedLabor > 0;
    const plannedMargin = finance.revenue > 0 ? r2((plannedProfit / finance.revenue) * 100) : 0;

    const totalWorkerDays = r2(workerRows.reduce((s, w) => s + w.days, 0));

    const laborByWeek = Array.from(weekAcc.entries())
        .map(([weekStart, labor]) => ({ weekStart, labor: r2(labor) }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    const laborByDay = Array.from(dayAcc.entries())
        .map(([date, v]) => ({ date, labor: r2(v.labor), workers: v.workers.size }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // Poredaj naloge: aktivni prije završenih, pa po datumu.
    woRows.sort((a, b) => {
        const rank = (s: string) => (s === 'U toku' ? 0 : s === 'Na čekanju' ? 1 : 2);
        const d = rank(a.status) - rank(b.status);
        if (d !== 0) return d;
        return (b.createdDate || '').localeCompare(a.createdDate || '');
    });

    // Prihvaćene ponude (faze) — najnovija za oznaku, sve za „ugovoreno".
    const accepted = offers
        .filter(o => o.Project_ID === projectId && o.Status === 'Prihvaćeno')
        .sort((a, b) => (b.Accepted_Date || b.Created_Date || '').localeCompare(a.Accepted_Date || a.Created_Date || ''));
    const acceptedOffer = accepted[0];

    return {
        projectId,
        finance,
        financial,
        spentLabor: finance.spentLabor,
        hasPlan,
        plannedMaterial,
        plannedLabor,
        plannedProfit,
        plannedMargin,
        products: productRows,
        workOrders: woRows,
        workers: workerRows,
        materials,
        materialCatalogCost,
        laborByWeek,
        laborByDay,
        counts: {
            products: productRows.filter(p => !p.isCustom).length,
            productsFinished: finance.finishedCount,
            productsInProduction: finance.inProgress.count,
            productsNotStarted: finance.notStarted.count,
            workOrders: woRows.length,
            workers: workerRows.length,
            totalWorkerDays,
            materials: materials.length,
        },
        acceptedOffer: acceptedOffer ? {
            offerNumber: acceptedOffer.Offer_Number,
            total: r2(finance.contracted || acceptedOffer.Total || 0),
            subtotal: r2(acceptedOffer.Subtotal || 0),
            includePDV: !!acceptedOffer.Include_PDV,
            pdvRate: acceptedOffer.PDV_Rate || 0,
            transportCost: r2(acceptedOffer.Transport_Cost || 0),
        } : undefined,
        acceptedOffers: finance.contractOffers.map(o => ({ offerNumber: o.offerNumber, total: o.total, acceptedDate: o.acceptedDate })),
    };
}

// ════════════════════════════════════════════════════════════════════
// RAZNI NALOZI BEZ PROJEKTA — globalni sažetak.
//
// Razni nalog kome nije dodijeljen projekat ne pripada nijednom pregledu projekta.
// Ovdje se svi takvi (Zadaci / custom stavke bez Project_ID i bez veze na proizvod)
// sabiraju u jednu stavku, istom formulom (vrijednost − materijal − rad − ostalo).
// Vezani custom zadaci se ISKLJUČUJU: njihov rad već ide troškovima proizvoda.
// ════════════════════════════════════════════════════════════════════
export interface MiscOverview {
    financial: ProfitBreakdown;
    orderCount: number;         // broj Zadaci naloga koji doprinose
    taskCount: number;          // broj pojedinačnih poslova (custom stavki)
    workerDays: number;         // Σ Day_Fraction
}

export function buildMiscOverview(args: {
    workOrders: OverviewWorkOrderInput[];
    workLogs: OverviewLogInput[];
}): MiscOverview {
    const { workOrders, workLogs } = args;

    const laborByItem = new Map<string, number>();
    for (const wl of liveLogs(workLogs)) {
        if (!wl.Work_Order_Item_ID) continue;
        laborByItem.set(wl.Work_Order_Item_ID, (laborByItem.get(wl.Work_Order_Item_ID) || 0) + (wl.Daily_Rate || 0));
    }

    const breakdowns: ProfitBreakdown[] = [];
    const itemIds = new Set<string>();
    let orderCount = 0;
    let taskCount = 0;

    for (const wo of workOrders) {
        if (wo.Status === 'Otkazano') continue;
        const custom = (wo.items || []).filter(it =>
            it.Item_Type === 'custom' && !it.Project_ID && !it.Linked_Item_ID);
        if (custom.length === 0) continue;
        orderCount++;
        for (const item of custom) {
            taskCount++;
            itemIds.add(item.ID);
            breakdowns.push(itemProfitBreakdown({
                productValue: item.Product_Value,
                sellingOverride: item.Profit_Overrides?.Selling_Price,
                materialPerUnit: item.Material_Cost,
                quantity: item.Quantity,
                laborTotal: laborByItem.get(item.ID) || 0,
                servicesTotal: item.Services_Total,
                transportShare: item.Transport_Share,
                transportOverride: item.Profit_Overrides?.Transport_Share,
                otherCosts: item.Other_Costs,
            }));
        }
    }

    let workerDays = 0;
    for (const wl of liveLogs(workLogs)) {
        if (wl.Work_Order_Item_ID && itemIds.has(wl.Work_Order_Item_ID)) workerDays += wl.Day_Fraction ?? 1;
    }

    return { financial: sumBreakdownsLocal(breakdowns), orderCount, taskCount, workerDays: r2(workerDays) };
}

/**
 * Lokalni sumBreakdowns (kao lib/profit.ts) — sabira komponente i OR-uje missing flagove.
 * Ne uvozi se iz profit.ts jer tamošnji radi nad ProfitBreakdown[]; ovdje ista semantika,
 * ali s eksplicitnim poljima da se izbjegne međuzavisnost pri refaktoru.
 */
function sumBreakdownsLocal(items: ProfitBreakdown[]): ProfitBreakdown {
    const acc = { revenue: 0, material: 0, labor: 0, services: 0, transport: 0, other: 0 };
    let missingPrice = false;
    let missingMaterial = false;
    for (const b of items) {
        acc.revenue += b.revenue;
        acc.material += b.material;
        acc.labor += b.labor;
        acc.services += b.services;
        acc.transport += b.transport;
        acc.other += b.other || 0;
        if (b.missingPrice) missingPrice = true;
        if (b.missingMaterial) missingMaterial = true;
    }
    const total = profitFromTotals(acc);
    return { ...total, missingPrice, missingMaterial };
}
