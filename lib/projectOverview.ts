// ════════════════════════════════════════════════════════════════════
// PREGLED PROJEKTA — jedinstvena agregacija za full-screen pregled projekta.
//
// Sve što „Pregled projekta" prikazuje računa se OVDJE, iz podataka koji su VEĆ
// u memoriji (projekti+proizvodi+materijali, nalozi+stavke, dnevnik rada, ponude) —
// bez ijednog novog Firestore upita, pa je otvaranje TRENUTNO (kao WorkOrderFullScreen).
//
// FINANSIJE koriste ISTI izvor kao kartica projekta (lib/projectProfit.ts),
// nalog (WorkOrderExpandedDetail) i analitika (lib/analytics.ts): itemProfitBreakdown
// po stavci, montaža = samo rad. Time je profit projekta == Σ profita naloga do centa,
// i pregled se ne može razići od ostatka aplikacije.
//
// Ulazni tipovi su NAMJERNO uski (samo polja koja se čitaju) — pravi tipovi
// (WorkOrder, WorkOrderItem, …) ih strukturno zadovoljavaju, pa komponenta
// prosljeđuje pune objekte, a testovi grade minimalne fiksture bez kastova.
// ════════════════════════════════════════════════════════════════════

import { itemProfitBreakdown, profitFromTotals, type ProfitBreakdown } from './profit';
import { itemMaterialTotal } from './materialCost';
import { mondayOf } from './analytics';

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
    Work_Order_Item_ID?: string;
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
    Material_Cost?: number;
    Quantity?: number;
}
export interface OverviewOfferInput {
    Project_ID?: string;
    Offer_Number?: string;
    Status?: string;
    Total?: number;
    Subtotal?: number;
    Include_PDV?: boolean;
    PDV_Rate?: number;
    Transport_Cost?: number;
    Accepted_Date?: string;
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
    status: string;                 // izveden iz stavki (pouzdaniji od Product.Status)
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
    // Finansije (profit-konzistentno — isti izvor kao kartica/nalog/analitika)
    financial: ProfitBreakdown;
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
        productsInProduction: number;
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
 * Otkazani nalozi se potpuno isključuju; montaža nosi SAMO trošak rada.
 */
export function buildProjectOverview(args: {
    project: OverviewProjectInput;
    workOrders: OverviewWorkOrderInput[];
    workLogs: OverviewLogInput[];
    offers?: OverviewOfferInput[];
    workers?: OverviewWorkerInput[];
}): ProjectOverview {
    const { project, workOrders, workLogs, offers = [], workers = [] } = args;
    const projectId = project.Project_ID;

    // ── Rad po stavci (Σ Daily_Rate) ─────────────────────────────────
    const laborByItem = new Map<string, number>();
    for (const wl of workLogs) {
        if (!wl.Work_Order_Item_ID) continue;
        laborByItem.set(wl.Work_Order_Item_ID, (laborByItem.get(wl.Work_Order_Item_ID) || 0) + (wl.Daily_Rate || 0));
    }

    // ── Prihvaćena ponuda projekta (za PLAN materijala) ──────────────
    const acceptedOffer = offers.find(o => o.Project_ID === projectId && o.Status === 'Prihvaćeno');
    const offerMaterialByProduct = new Map<string, number>();
    if (acceptedOffer) {
        for (const op of acceptedOffer.products || []) {
            if (!op.Product_ID) continue;
            offerMaterialByProduct.set(op.Product_ID, (op.Material_Cost || 0) * (op.Quantity || 1));
        }
    }

    // ── Prolaz kroz naloge/stavke projekta ───────────────────────────
    const projectItemIds = new Set<string>();
    const productAcc = new Map<string, {
        productName: string; quantity: number; isCustom: boolean;
        statuses: string[]; woNumbers: Set<string>;
        rev: number; mat: number; lab: number; ser: number; tra: number; oth: number;
        plannedLabor: number; plannedMaterial: number; missingPrice: boolean;
    }>();
    const woRows: WorkOrderOverviewRow[] = [];

    for (const wo of workOrders) {
        if (wo.Status === 'Otkazano') continue;
        const isMontaza = wo.Work_Order_Type === 'Montaža';
        const items = (wo.items || []).filter(it => it.Project_ID === projectId);
        if (items.length === 0) continue;

        const woAcc: ProfitBreakdown[] = [];
        for (const item of items) {
            projectItemIds.add(item.ID);
            const labor = laborByItem.get(item.ID) || 0;
            const isCustom = item.Item_Type === 'custom';
            const breakdown = isMontaza
                ? itemProfitBreakdown({ laborTotal: labor })
                : itemProfitBreakdown({
                    productValue: item.Product_Value,
                    sellingOverride: item.Profit_Overrides?.Selling_Price,
                    materialPerUnit: item.Material_Cost,
                    quantity: item.Quantity,
                    laborTotal: labor,
                    servicesTotal: item.Services_Total,
                    transportShare: item.Transport_Share,
                    transportOverride: item.Profit_Overrides?.Transport_Share,
                    otherCosts: item.Other_Costs,   // ostali troškovi raznih naloga
                });
            woAcc.push(breakdown);

            // Per-proizvod agregacija. SVE custom stavke (razni poslovi) padaju u JEDAN
            // red „Razni nalozi" — korisnik ih tako i posmatra (jedna stalna stavka).
            const pid = isCustom ? '__razni__' : (item.Product_ID || `custom:${item.ID}`);
            let pa = productAcc.get(pid);
            if (!pa) {
                pa = {
                    productName: isCustom ? 'Razni nalozi' : (item.Product_Name || 'Proizvod'),
                    quantity: 0, isCustom,
                    statuses: [], woNumbers: new Set(),
                    rev: 0, mat: 0, lab: 0, ser: 0, tra: 0, oth: 0,
                    plannedLabor: 0, plannedMaterial: 0, missingPrice: false,
                };
                productAcc.set(pid, pa);
            }
            // Količina: proizvod → najveća viđena (montaža/ponovni nalozi ne duplaju);
            // razni → BROJ poslova (svaka custom stavka je jedan posao).
            pa.quantity = isCustom ? pa.quantity + (item.Quantity || 1) : Math.max(pa.quantity, item.Quantity || 0);
            pa.statuses.push(item.Status || 'Na čekanju');
            if (wo.Work_Order_Number) pa.woNumbers.add(wo.Work_Order_Number);
            pa.rev += breakdown.revenue;
            pa.mat += breakdown.material;
            pa.lab += breakdown.labor;
            pa.ser += breakdown.services;
            pa.tra += breakdown.transport;
            pa.oth += breakdown.other;
            if (breakdown.missingPrice && !isMontaza && !isCustom) pa.missingPrice = true;
            // PLAN: rad iz snapshot-a stavke (po komadu × kol.); materijal iz ponude (fallback: stavka).
            if (!isMontaza) {
                pa.plannedLabor += (item.Planned_Labor_Cost || 0) * (item.Quantity && item.Quantity > 0 ? item.Quantity : 1);
                pa.plannedMaterial += offerMaterialByProduct.get(pid) ?? itemMaterialTotal(item.Material_Cost, item.Quantity);
            }
        }

        const woTot = sumBreakdownsLocal(woAcc);
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
            services: woTot.services,
            transport: woTot.transport,
            profit: woTot.profit,
            margin: woTot.margin,
        });
    }

    // ── Radnici / trend rada (samo logovi stavki ovog projekta) ──────
    const workerById = new Map(workers.map(w => [w.Worker_ID, w]));
    const workerAcc = new Map<string, {
        name: string; days: number; cost: number;
        products: Set<string>; dates: Set<string>;
    }>();
    const weekAcc = new Map<string, number>();
    const dayAcc = new Map<string, { labor: number; workers: Set<string> }>();
    const daysByProductId = new Map<string, number>();
    const workersByProductId = new Map<string, Set<string>>();

    for (const wl of workLogs) {
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
            daysByProductId.set(wl.Product_ID, (daysByProductId.get(wl.Product_ID) || 0) + frac);
            let wset = workersByProductId.get(wl.Product_ID);
            if (!wset) { wset = new Set(); workersByProductId.set(wl.Product_ID, wset); }
            wset.add(wid);
        }
    }

    // Mapa Product_ID → naziv (za listu proizvoda radnika)
    const productNameById = new Map<string, string>();
    for (const [pid, pa] of Array.from(productAcc.entries())) productNameById.set(pid, pa.productName);

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

    // ── Redovi proizvoda ─────────────────────────────────────────────
    // U proizvodnji (bar jedan nalog) — nose finansije.
    const inProductionRows: ProductOverviewRow[] = Array.from(productAcc.entries())
        .map(([pid, pa]) => {
            const fin = profitFromTotals({ revenue: pa.rev, material: pa.mat, labor: pa.lab, services: pa.ser, transport: pa.tra, other: pa.oth });
            return {
                productId: pid,
                productName: pa.productName,
                quantity: pa.quantity,
                status: deriveProductStatus(pa.statuses),
                revenue: fin.revenue,
                material: fin.material,
                labor: fin.labor,
                services: fin.services,
                transport: fin.transport,
                other: fin.other,
                profit: fin.profit,
                margin: fin.margin,
                missingPrice: pa.missingPrice,
                plannedLabor: r2(pa.plannedLabor),
                plannedMaterial: r2(pa.plannedMaterial),
                workerDays: r2(daysByProductId.get(pid) || 0),
                workerCount: workersByProductId.get(pid)?.size || 0,
                workOrderNumbers: Array.from(pa.woNumbers),
                isCustom: pa.isCustom,
                notInProduction: false,
            };
        });

    // Proizvodi projekta koji JOŠ nisu ni u jednom nalogu → informativni redovi.
    // NE ulaze u `financial` (nema prihoda ni uloženog rada) da profit projekta ostane
    // == Σ profita naloga (invarijanta iz lib/projectProfit.ts). Materijal = katalog (× kol.).
    const inProdIds = new Set(inProductionRows.map(r => r.productId));
    const notStartedRows: ProductOverviewRow[] = (project.products || [])
        .filter(p => !inProdIds.has(p.Product_ID))
        .map(p => {
            const qty = p.Quantity && p.Quantity > 0 ? p.Quantity : 1;
            const material = r2((p.materials || []).reduce((s, m) => s + (m.Total_Price || 0), 0) * qty);
            return {
                productId: p.Product_ID,
                productName: p.Name || 'Proizvod',
                quantity: p.Quantity || 0,
                status: 'Na čekanju',
                revenue: 0, material, labor: 0, services: 0, transport: 0, other: 0,
                profit: 0, margin: 0, missingPrice: false,
                plannedLabor: 0, plannedMaterial: material,
                workerDays: 0, workerCount: 0,
                workOrderNumbers: [],
                isCustom: false,
                notInProduction: true,
            };
        });

    const productRows: ProductOverviewRow[] = [...inProductionRows, ...notStartedRows]
        .sort((a, b) => {
            if (a.notInProduction !== b.notInProduction) return a.notInProduction ? 1 : -1;
            return b.revenue - a.revenue || b.profit - a.profit || a.productName.localeCompare(b.productName, 'hr');
        });

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

    // ── Finansije projekta (Σ proizvoda U PROIZVODNJI == Σ svih naloga) ───────
    const financial = sumBreakdownsLocal(inProductionRows.map(p => ({
        revenue: p.revenue, material: p.material, labor: p.labor, services: p.services, transport: p.transport,
        other: p.other, profit: p.profit, margin: p.margin, missingPrice: p.missingPrice, missingMaterial: p.material <= 0,
    })));

    const plannedMaterial = r2(inProductionRows.reduce((s, p) => s + p.plannedMaterial, 0));
    const plannedLabor = r2(inProductionRows.reduce((s, p) => s + p.plannedLabor, 0));
    const plannedTot = profitFromTotals({
        revenue: financial.revenue, material: plannedMaterial, labor: plannedLabor,
        services: financial.services, transport: financial.transport,
    });
    const hasPlan = !!acceptedOffer || plannedLabor > 0 || plannedMaterial > 0;

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

    return {
        projectId,
        financial,
        hasPlan,
        plannedMaterial,
        plannedLabor,
        plannedProfit: plannedTot.profit,
        plannedMargin: plannedTot.margin,
        products: productRows,
        workOrders: woRows,
        workers: workerRows,
        materials,
        materialCatalogCost,
        laborByWeek,
        laborByDay,
        counts: {
            products: productRows.filter(p => !p.isCustom).length,
            productsInProduction: inProductionRows.filter(p => !p.isCustom).length,
            productsNotStarted: notStartedRows.length,
            workOrders: woRows.length,
            workers: workerRows.length,
            totalWorkerDays,
            materials: materials.length,
        },
        acceptedOffer: acceptedOffer ? {
            offerNumber: acceptedOffer.Offer_Number,
            total: r2(acceptedOffer.Total || 0),
            subtotal: r2(acceptedOffer.Subtotal || 0),
            includePDV: !!acceptedOffer.Include_PDV,
            pdvRate: acceptedOffer.PDV_Rate || 0,
            transportCost: r2(acceptedOffer.Transport_Cost || 0),
        } : undefined,
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
    for (const wl of workLogs) {
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
    for (const wl of workLogs) {
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
