// ════════════════════════════════════════════════════════════════════
// FINANSIJE PROJEKTA — JEDINI izvor istine za prihod / trošak / profit.
// Čista logika (bez Firebase), pokrivena testovima: lib/__tests__/projectFinance.test.ts
//
// MODEL (odluka vlasnika, 04.10.2026):
//
//   profit proizvoda = PRIHOD − MATERIJAL − RAD
//
//   • PRIHOD    = cijena iz PRIHVAĆENE ponude (Selling_Price po komadu — rabat je već
//                 ubačen) × proizvedena količina. Projekat može imati više prihvaćenih
//                 ponuda (faze); ako je isti proizvod u dvije, važi novije prihvaćena.
//                 Transport i popust za montažu (nivo ponude) se raspodijele na stavke
//                 srazmjerno vrijednosti. Izdat ZAVRŠNI RAČUN (ili ručna korekcija cijene,
//                 Profit_Overrides.Selling_Price) ima prednost — to je stvarno fakturisano.
//                 Proizvod BEZ prihvaćene ponude → cijena s naloga (Product_Value), uz
//                 oznaku „bez ponude" (vidljivo u analitici).
//   • MATERIJAL = ŽIVA sastavnica (Σ product_materials.Total_Price, po komadu) × količina
//                 + dodaci iz ponude (Extras — u praksi „materijal" koji nije u sastavnici,
//                 npr. materijal vrata). Izmjena materijala nakon prihvatanja ponude ODMAH
//                 ulazi u trošak — ponuda je procjena, sastavnica je stvarnost.
//   • RAD       = Σ dnevnica (work_logs) SVIH naloga proizvoda: proizvodnja, montaža i
//                 povezani razni poslovi (njihov rad je već upisan na proizvod, lib/laborTarget).
//                 Dnevnice OBRISANIH naloga (Work_Order_Deleted) se ne broje — nulirane su.
//
//   PROFIT PROJEKTA = Σ profita ZAVRŠENIH proizvoda (+ razni nalozi vezani za projekat,
//   kao i do sada). Proizvodi u izradi se prate odvojeno — ugovoreni prihod, trošak do
//   sada i plan rada — i ulaze u profit tek kad su gotovi (prihod i trošak istog proizvoda
//   se uvijek sučeljavaju zajedno).
//
//   ZAVRŠEN proizvod = sve njegove proizvodne stavke (neotkazani nalozi) su 'Završeno' i
//   pokrivaju njegovu količinu. Profit se računa SAMO iz završenih NALOGA: proizvod kome je
//   status ručno postavljen na gotov, a nema nijedan nalog, NIJE u profitu (nema evidentiran
//   rad) — ide na listu „za provjeru" (oznaka doneWithoutWorkOrder).
//
// Razni poslovi (custom stavke) ostaju na staroj formuli (vrijednost − materijal − ostalo − rad).
// ════════════════════════════════════════════════════════════════════

import { aggregateLaborFromLogs } from './laborAggregate';
import { itemProfitBreakdown, profitFromTotals, type ProfitBreakdown } from './profit';

const r2 = (n: number) => Math.round(n * 100) / 100;
const qtyOf = (q?: number) => (q && q > 0 ? q : 1);
const dOnly = (iso?: string | null) => (iso ? iso.split('T')[0] : '');

// ── Uski ulazni tipovi (pravi tipovi ih strukturno zadovoljavaju) ─────────
export interface FinMaterial { Total_Price?: number }
export interface FinProduct {
    Product_ID: string;
    Project_ID: string;
    Name?: string;
    Quantity?: number;
    Status?: string;
    materials?: FinMaterial[];
}
export interface FinOfferExtra { Total?: number }
export interface FinOfferProduct {
    Product_ID?: string;
    Product_Name?: string;
    Included?: boolean;
    Quantity?: number;
    Selling_Price?: number;
    Total_Price?: number;
    Material_Cost?: number;
    Labor_Workers?: number;
    Labor_Days?: number;
    Labor_Daily_Rate?: number;
    extras?: FinOfferExtra[];
}
export interface FinOffer {
    Offer_ID: string;
    Project_ID: string;
    Offer_Number?: string;
    Status?: string;
    Accepted_Date?: string;
    Created_Date?: string;
    Transport_Cost?: number;
    Onsite_Assembly?: boolean;
    Onsite_Discount?: number;
    products?: FinOfferProduct[];
}
export interface FinItem {
    ID: string;
    Work_Order_ID?: string;
    Product_ID?: string;
    Product_Name?: string;
    Project_ID?: string;
    Project_Name?: string;
    Quantity?: number;
    Status?: string;
    Started_At?: string;
    Completed_At?: string;
    Item_Type?: 'product' | 'custom';
    Linked_Item_ID?: string;
    Product_Value?: number;
    Material_Cost?: number;
    Services_Total?: number;
    Transport_Share?: number;
    Other_Costs?: number;
    Planned_Labor_Cost?: number;
    Actual_Labor_Cost?: number;
    Profit_Overrides?: { Selling_Price?: number; Transport_Share?: number; Notes?: string };
}
export interface FinWorkOrder {
    Work_Order_ID: string;
    Work_Order_Number?: string;
    Name?: string;
    Status?: string;
    Work_Order_Type?: string;
    Started_At?: string;
    Completed_At?: string;
    items?: FinItem[];
}
export interface FinLog {
    Work_Order_ID?: string;
    Work_Order_Item_ID?: string;
    Product_ID?: string;
    Daily_Rate?: number;
    Day_Fraction?: number;
    Date?: string;
    Worker_ID?: string;
    Worker_Name?: string;
    Work_Order_Deleted?: boolean;
}

// ── Dnevnice ────────────────────────────────────────────────────────
/**
 * Početak prozora dnevnica koje glavna aplikacija učitava odmah (zadnjih 12 mjeseci,
 * YYYY-MM-DD). Starije dnevnice se dovlače po nalogu kad zatrebaju.
 */
export function workLogsWindowStart(now: Date = new Date()): string {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Dnevnica obrisanog naloga — nulirana, ne ulazi ni u trošak ni u zaradu radnika. */
export function isVoidedLog(log: { Work_Order_Deleted?: boolean } | null | undefined): boolean {
    return log?.Work_Order_Deleted === true;
}

/** Samo žive dnevnice (bez nuliranih s obrisanih naloga). */
export function liveLogs<T extends { Work_Order_Deleted?: boolean }>(logs: T[] | null | undefined): T[] {
    return (logs || []).filter(l => !isVoidedLog(l));
}

/**
 * Izmjena koja NULIRA dnevnicu obrisanog naloga. Idempotentno: ponovljeni poziv čuva
 * prvobitno sačuvani iznos (Voided_*), pa se trag nikad ne prepiše nulom.
 */
export function voidedWorkLogPatch(
    log: { Daily_Rate?: number; Day_Fraction?: number; Voided_Daily_Rate?: number; Voided_Day_Fraction?: number },
    at: string,
): { Work_Order_Deleted: true; Voided_At: string; Voided_Daily_Rate: number; Voided_Day_Fraction: number; Daily_Rate: 0; Day_Fraction: 0 } {
    return {
        Work_Order_Deleted: true,
        Voided_At: at,
        Voided_Daily_Rate: log.Voided_Daily_Rate ?? (log.Daily_Rate || 0),
        Voided_Day_Fraction: log.Voided_Day_Fraction ?? (log.Day_Fraction ?? 1),
        Daily_Rate: 0,
        Day_Fraction: 0,
    };
}

// ════════════════════════════════════════════════════════════════════
// OSNOVA: jedinična ekonomija proizvoda (ponuda + živa sastavnica)
// ════════════════════════════════════════════════════════════════════

export interface OfferLine {
    offerId: string;
    offerNumber: string;
    acceptedDate: string;
    quantity: number;           // količina u ponudi
    total: number;              // vrijednost stavke u ponudi (uklj. udio transporta/popusta)
    unitPrice: number;          // total / quantity
    unitExtras: number;         // dodaci po komadu (Σ extras.Total)
    unitMaterialPlan: number;   // materijal po komadu u trenutku ponude (plan)
    unitLaborPlan: number;      // radnici × dani × dnevnica po komadu (plan)
}

export interface ProductBasis {
    productId: string;
    projectId: string;
    name: string;
    quantity: number;           // količina proizvoda u projektu
    status: string;             // Product.Status
    unitMaterial: number;       // ŽIVA sastavnica po komadu
}

export interface ProjectContract {
    projectId: string;
    total: number;              // Σ prihvaćenih ponuda (bez PDV-a)
    offers: { offerId: string; offerNumber: string; total: number; acceptedDate: string }[];
}

export interface FinanceBasis {
    products: Map<string, ProductBasis>;
    offerLines: Map<string, OfferLine>;     // Product_ID → stavka prihvaćene ponude
    contracts: Map<string, ProjectContract>;
}

function offerLineValue(p: FinOfferProduct): number {
    if (p.Total_Price != null && p.Total_Price > 0) return p.Total_Price;
    return (p.Selling_Price || 0) * qtyOf(p.Quantity);
}

/**
 * Jedinična ekonomija svih proizvoda: cijena iz PRIHVAĆENE ponude + živa sastavnica.
 * `offers` mogu biti sve ponude organizacije — uzimaju se samo 'Prihvaćeno'.
 */
export function buildFinanceBasis(products: FinProduct[], offers: FinOffer[]): FinanceBasis {
    const offerLines = new Map<string, OfferLine>();
    const contracts = new Map<string, ProjectContract>();

    // Novije prihvaćena ponuda ima prednost za proizvod koji je u više njih.
    const accepted = (offers || [])
        .filter(o => o.Status === 'Prihvaćeno')
        .sort((a, b) => (b.Accepted_Date || b.Created_Date || '').localeCompare(a.Accepted_Date || a.Created_Date || ''));

    for (const o of accepted) {
        const included = (o.products || []).filter(p => p.Included && p.Product_ID);
        const sub = included.reduce((s, p) => s + offerLineValue(p), 0);
        const adjustment = (o.Transport_Cost || 0) - (o.Onsite_Assembly ? (o.Onsite_Discount || 0) : 0);
        let offerTotal = 0;
        for (const p of included) {
            const productId = p.Product_ID as string;
            if (offerLines.has(productId)) continue;
            const base = offerLineValue(p);
            const total = r2(base + (sub > 0 ? adjustment * (base / sub) : 0));
            const quantity = qtyOf(p.Quantity);
            offerLines.set(productId, {
                offerId: o.Offer_ID,
                offerNumber: o.Offer_Number || '',
                acceptedDate: o.Accepted_Date || '',
                quantity,
                total,
                unitPrice: total / quantity,
                unitExtras: (p.extras || []).reduce((s, e) => s + (e.Total || 0), 0),
                unitMaterialPlan: p.Material_Cost || 0,
                unitLaborPlan: (p.Labor_Workers || 0) * (p.Labor_Days || 0) * (p.Labor_Daily_Rate || 0),
            });
            offerTotal += total;
        }
        if (offerTotal === 0 && included.length === 0) continue;
        const c = contracts.get(o.Project_ID) || { projectId: o.Project_ID, total: 0, offers: [] };
        c.total = r2(c.total + offerTotal);
        c.offers.push({ offerId: o.Offer_ID, offerNumber: o.Offer_Number || '', total: r2(offerTotal), acceptedDate: o.Accepted_Date || '' });
        contracts.set(o.Project_ID, c);
    }

    const productMap = new Map<string, ProductBasis>();
    for (const p of products || []) {
        productMap.set(p.Product_ID, {
            productId: p.Product_ID,
            projectId: p.Project_ID,
            name: p.Name || 'Proizvod',
            quantity: qtyOf(p.Quantity),
            status: p.Status || 'Na čekanju',
            unitMaterial: (p.materials || []).reduce((s, m) => s + (m.Total_Price || 0), 0),
        });
    }

    return { products: productMap, offerLines, contracts };
}

/** Prazna osnova (npr. preview bez podataka) — sve stavke padaju na vrijednosti s naloga. */
export const EMPTY_FINANCE_BASIS: FinanceBasis = { products: new Map(), offerLines: new Map(), contracts: new Map() };

// ════════════════════════════════════════════════════════════════════
// STAVKA NALOGA
// ════════════════════════════════════════════════════════════════════

export type ItemKind = 'proizvod' | 'montaza' | 'razno';
/** Odakle je prihod: prihvaćena ponuda, izdat završni račun, ručna korekcija ili (bez ponude) nalog. */
export type RevenueSource = 'ponuda' | 'racun' | 'korekcija' | 'nalog';

export const REVENUE_SOURCE_LABEL: Record<RevenueSource, string> = {
    ponuda: 'ponuda',
    racun: 'završni račun',
    korekcija: 'ručna korekcija',
    nalog: 's naloga (nema ponude)',
};

export interface ItemFinance extends ProfitBreakdown {
    kind: ItemKind;
    revenueSource: RevenueSource;
    materialBom: number;        // živa sastavnica × količina
    materialExtras: number;     // dodaci iz ponude × količina
    plannedMaterial: number;    // materijal iz ponude (+ dodaci) × količina
    plannedLabor: number;       // rad iz ponude × količina
}

export function itemKind(item: Pick<FinItem, 'Item_Type'>, wo?: Pick<FinWorkOrder, 'Work_Order_Type'>): ItemKind {
    if (item.Item_Type === 'custom') return 'razno';
    if (wo?.Work_Order_Type === 'Montaža') return 'montaza';
    return 'proizvod';
}

/**
 * Finansije jedne stavke naloga po modelu iznad. `labor` = Σ živih dnevnica stavke.
 * Montaža nosi samo rad; razni posao ostaje na staroj formuli.
 */
export function itemFinance(
    item: FinItem,
    wo: Pick<FinWorkOrder, 'Work_Order_Type'> | undefined,
    basis: FinanceBasis,
    labor: number,
): ItemFinance {
    const kind = itemKind(item, wo);

    if (kind === 'montaza') {
        const b = profitFromTotals({ revenue: 0, material: 0, labor, services: 0, transport: 0 });
        return { ...b, missingPrice: false, missingMaterial: false, kind, revenueSource: 'ponuda', materialBom: 0, materialExtras: 0, plannedMaterial: 0, plannedLabor: 0 };
    }

    if (kind === 'razno') {
        const b = itemProfitBreakdown({
            productValue: item.Product_Value,
            sellingOverride: item.Profit_Overrides?.Selling_Price,
            materialPerUnit: item.Material_Cost,
            quantity: item.Quantity,
            laborTotal: labor,
            servicesTotal: item.Services_Total,
            transportShare: item.Transport_Share,
            transportOverride: item.Profit_Overrides?.Transport_Share,
            otherCosts: item.Other_Costs,
        });
        return { ...b, kind, revenueSource: 'nalog', materialBom: b.material, materialExtras: 0, plannedMaterial: 0, plannedLabor: 0 };
    }

    const qty = qtyOf(item.Quantity);
    const line = item.Product_ID ? basis.offerLines.get(item.Product_ID) : undefined;
    const product = item.Product_ID ? basis.products.get(item.Product_ID) : undefined;

    // Prihod: završni račun / ručna korekcija → prihvaćena ponuda → (bez ponude) nalog.
    let revenue: number;
    let revenueSource: RevenueSource;
    const override = item.Profit_Overrides?.Selling_Price;
    if (override != null && override > 0) {
        revenue = override;
        revenueSource = (item.Profit_Overrides?.Notes || '').startsWith('Završni račun') ? 'racun' : 'korekcija';
    } else if (line) {
        revenue = line.unitPrice * qty;
        revenueSource = 'ponuda';
    } else {
        revenue = item.Product_Value || 0;
        revenueSource = 'nalog';
    }

    // Živa sastavnica; ako proizvod više ne postoji, zadnji poznati trošak sa stavke.
    const unitBom = product ? product.unitMaterial : (item.Material_Cost || 0);
    const materialBom = r2(unitBom * qty);
    const materialExtras = r2(line ? line.unitExtras * qty : (item.Services_Total || 0));

    const b = profitFromTotals({
        revenue,
        material: materialBom + materialExtras,
        labor,
        services: 0,
        transport: 0,
        other: item.Other_Costs || 0,
    });
    const plannedMaterial = line ? r2((line.unitMaterialPlan + line.unitExtras) * qty) : 0;
    const plannedLabor = line
        ? r2(line.unitLaborPlan * qty)
        : r2((item.Planned_Labor_Cost || 0) * qty);
    return { ...b, kind, revenueSource, materialBom, materialExtras, plannedMaterial, plannedLabor };
}

/** Σ komponenti stavki (komponente su već zaokružene po stavci). */
export function sumItemFinance(list: ItemFinance[]): ProfitBreakdown & { materialBom: number; materialExtras: number; plannedMaterial: number; plannedLabor: number } {
    let revenue = 0, material = 0, labor = 0, other = 0, materialBom = 0, materialExtras = 0, plannedMaterial = 0, plannedLabor = 0;
    let missingPrice = false, missingMaterial = false;
    for (const f of list) {
        revenue += f.revenue; material += f.material; labor += f.labor; other += f.other;
        materialBom += f.materialBom; materialExtras += f.materialExtras;
        plannedMaterial += f.plannedMaterial; plannedLabor += f.plannedLabor;
        if (f.kind === 'proizvod' && f.missingPrice) missingPrice = true;
        if (f.kind === 'proizvod' && f.missingMaterial) missingMaterial = true;
    }
    const b = profitFromTotals({ revenue, material, labor, services: 0, transport: 0, other });
    return { ...b, missingPrice, missingMaterial, materialBom: r2(materialBom), materialExtras: r2(materialExtras), plannedMaterial: r2(plannedMaterial), plannedLabor: r2(plannedLabor) };
}

// ════════════════════════════════════════════════════════════════════
// RAD PO STAVCI
// ════════════════════════════════════════════════════════════════════

export interface LaborIndex {
    /** itemId → { cost, days } (samo žive dnevnice) */
    byItem: Map<string, { cost: number; days: number }>;
    /** stavke za koje je trošak uzet iz sačuvanog agregata (logovi van učitanog prozora) */
    storedItems: Set<string>;
}

/**
 * Rad po stavci = Σ živih dnevnica. `storedLaborBefore` (YYYY-MM-DD): glavna aplikacija
 * učitava dnevnice samo za zadnjih 12 mjeseci — stavka započeta PRIJE tog datuma bi bila
 * nepotpuna, pa za nju važi sačuvani agregat (Actual_Labor_Cost, = Σ dnevnica pri preračunu).
 * Analitika učitava sve dnevnice i ne prosljeđuje ovaj parametar.
 */
export function buildLaborIndex(
    logs: FinLog[],
    workOrders: FinWorkOrder[],
    storedLaborBefore?: string,
): LaborIndex {
    const agg = aggregateLaborFromLogs(liveLogs(logs));
    const byItem = new Map<string, { cost: number; days: number }>();
    agg.forEach((v, k) => byItem.set(k, { cost: v.cost, days: v.days }));
    const storedItems = new Set<string>();
    if (storedLaborBefore) {
        for (const wo of workOrders || []) {
            for (const it of wo.items || []) {
                const started = dOnly(it.Started_At) || dOnly(wo.Started_At);
                if (started && started < storedLaborBefore && (it.Actual_Labor_Cost || 0) > 0) {
                    byItem.set(it.ID, { cost: r2(it.Actual_Labor_Cost || 0), days: byItem.get(it.ID)?.days || 0 });
                    storedItems.add(it.ID);
                }
            }
        }
    }
    return { byItem, storedItems };
}

// ════════════════════════════════════════════════════════════════════
// PROJEKAT
// ════════════════════════════════════════════════════════════════════

export type ProductStage = 'zavrseno' | 'u_izradi' | 'nije_zapoceto';

export const STAGE_LABEL: Record<ProductStage, string> = {
    zavrseno: 'Završeno',
    u_izradi: 'U izradi',
    nije_zapoceto: 'Nije započeto',
};

export interface ProductFlags {
    noOffer: boolean;           // nema prihvaćene ponude → prihod s naloga
    noPrice: boolean;           // prihod 0
    noMaterial: boolean;        // materijal 0 (prazna sastavnica i bez dodataka)
    noLabor: boolean;           // završen proizvodni nalog bez ijedne dnevnice
    withoutWorkOrder: boolean;  // status kaže „gotov", a nema nijedan nalog → NIJE u profitu
    qtyMismatch: boolean;       // proizvedena količina ≠ količina u ponudi
    storedLabor: boolean;       // rad iz sačuvanog agregata (stari nalog van prozora dnevnica)
}

export interface ProductFinanceRow {
    productId: string;
    projectId: string;
    name: string;
    quantity: number;           // količina proizvoda u projektu
    producedQty: number;        // Σ količina proizvodnih stavki (neotkazani nalozi)
    offerQty: number;           // količina u ponudi (0 bez ponude)
    stage: ProductStage;
    status: string;             // Product.Status (prikaz)
    completedAt: string;        // YYYY-MM-DD završetka proizvodnje ('' ako nije / bez naloga)
    revenueSource: RevenueSource;
    offerNumber: string;
    /** U prihvaćenoj ponudi (ugovoren). Nezapočet proizvod van ponude je „van ugovora". */
    inContract: boolean;
    contracted: number;         // vrijednost u prihvaćenoj ponudi (0 bez ponude)
    revenue: number;            // prihod za proizvedenu količinu
    materialBom: number;
    materialExtras: number;
    material: number;
    labor: number;
    laborDays: number;          // Σ Day_Fraction (radnik-dani)
    profit: number;
    margin: number;
    plannedMaterial: number;
    plannedLabor: number;
    plannedProfit: number;      // prihod − plan materijala − plan rada
    cancelledLabor: number;     // rad na otkazanim nalozima (uključen u labor)
    workOrders: { id: string; number: string; status: string; type: string }[];
    /** Reprezentativna proizvodna stavka (za drill u timeline). */
    itemId: string;
    workOrderId: string;
    itemStatus: string;
    flags: ProductFlags;
}

export interface StageTotals {
    count: number;
    revenue: number;
    materialBom: number;
    materialExtras: number;
    material: number;
    labor: number;
    profit: number;
    margin: number;
    plannedMaterial: number;
    plannedLabor: number;
    plannedProfit: number;
}

export interface ProjectFinance {
    projectId: string;
    contracted: number;
    contractOffers: ProjectContract['offers'];
    realized: StageTotals;          // završeni proizvodi
    inProgress: StageTotals;        // u izradi — prihod za proizvedenu količinu, trošak do sada
    /** Ugovoreni (u prihvaćenoj ponudi) proizvodi koji još nisu ni u jednom nalogu. */
    notStarted: { count: number; contracted: number; labor: number };
    razni: ProfitBreakdown & { count: number };     // razni nalozi vezani za projekat
    /** NASLOVNI profit projekta = završeni proizvodi + razni nalozi projekta. */
    profit: number;
    margin: number;
    revenue: number;
    material: number;
    labor: number;
    /** Ukupno uloženo do sada (svi proizvodi + razni): materijal + rad. */
    spentMaterial: number;
    spentLabor: number;
    products: ProductFinanceRow[];
    productCount: number;           // svi proizvodi projekta
    /** Proizvodi u obimu posla: u prihvaćenoj ponudi ILI već započeti/završeni (nazivnik za „završeno n/m"). */
    scopeCount: number;
    /** Nezapočeti proizvodi koji nisu ni u jednoj prihvaćenoj ponudi (npr. izbačeni u reviziji). */
    outOfContractCount: number;
    finishedCount: number;
    flagged: number;                // broj proizvoda s bar jednom oznakom za provjeru
}

const ZERO_FLAGS: ProductFlags = { noOffer: false, noPrice: false, noMaterial: false, noLabor: false, withoutWorkOrder: false, qtyMismatch: false, storedLabor: false };

/** Statusi proizvoda koji znače „gotov" (lib/projectProductOrder: Završeno + U montaži). */
const DONE_STATUSES = ['Spremno', 'Instalirano', 'Završeno', 'Transport', 'Montaža', 'Čišćenje', 'Primopredaja', 'U montaži'];

export function emptyStageTotals(): StageTotals {
    return { count: 0, revenue: 0, materialBom: 0, materialExtras: 0, material: 0, labor: 0, profit: 0, margin: 0, plannedMaterial: 0, plannedLabor: 0, plannedProfit: 0 };
}

/** Σ redova proizvoda u StageTotals (marža iz zbira). */
export function sumStage(rows: ProductFinanceRow[]): StageTotals {
    const t = emptyStageTotals();
    for (const p of rows) {
        t.count++;
        t.revenue += p.revenue; t.materialBom += p.materialBom; t.materialExtras += p.materialExtras;
        t.material += p.material; t.labor += p.labor; t.profit += p.profit;
        t.plannedMaterial += p.plannedMaterial; t.plannedLabor += p.plannedLabor; t.plannedProfit += p.plannedProfit;
    }
    t.revenue = r2(t.revenue); t.materialBom = r2(t.materialBom); t.materialExtras = r2(t.materialExtras);
    t.material = r2(t.material); t.labor = r2(t.labor); t.profit = r2(t.profit);
    t.plannedMaterial = r2(t.plannedMaterial); t.plannedLabor = r2(t.plannedLabor); t.plannedProfit = r2(t.plannedProfit);
    t.margin = t.revenue > 0 ? r2((t.profit / t.revenue) * 100) : 0;
    return t;
}

export function hasFlag(f: ProductFlags): boolean {
    return f.noOffer || f.noPrice || f.noMaterial || f.noLabor || f.qtyMismatch || f.withoutWorkOrder;
}

interface ProductAcc {
    productId: string;
    projectId: string;
    name: string;
    production: { item: FinItem; wo: FinWorkOrder; fin: ItemFinance }[];
    productionDays: number;     // Σ Day_Fraction proizvodnih stavki
    otherLabor: number;         // montaža + otkazani nalozi + dnevnice stavki kojih više nema
    otherDays: number;
    cancelledLabor: number;
    storedLabor: boolean;
    workOrders: Map<string, { id: string; number: string; status: string; type: string }>;
}

/**
 * Finansije SVIH projekata odjednom (jedan prolaz kroz naloge/dnevnice).
 * `products` = svi proizvodi organizacije (s materijalima); projekat bez proizvoda i
 * bez stavki ne dobija red.
 */
export function computeProjectsFinance(args: {
    products: FinProduct[];
    basis: FinanceBasis;
    workOrders: FinWorkOrder[];
    labor: LaborIndex;
    logs?: FinLog[];
}): Map<string, ProjectFinance> {
    const { products, basis, workOrders, labor } = args;
    const accByProduct = new Map<string, ProductAcc>();
    const raznoByProject = new Map<string, ItemFinance[]>();
    const knownItems = new Set<string>();

    const getAcc = (productId: string, projectId: string, name: string): ProductAcc => {
        let a = accByProduct.get(productId);
        if (!a) {
            a = { productId, projectId, name, production: [], productionDays: 0, otherLabor: 0, otherDays: 0, cancelledLabor: 0, storedLabor: false, workOrders: new Map() };
            accByProduct.set(productId, a);
        }
        return a;
    };

    for (const wo of workOrders || []) {
        const cancelled = wo.Status === 'Otkazano';
        for (const item of wo.items || []) {
            knownItems.add(item.ID);
            const kind = itemKind(item, wo);
            const lab = labor.byItem.get(item.ID);
            const cost = lab?.cost || 0;
            const days = lab?.days || 0;

            if (kind === 'razno') {
                // Razni posao vezan za projekat (ne za proizvod) — stara formula, kao i do sada.
                if (!cancelled && item.Project_ID && !item.Linked_Item_ID) {
                    const list = raznoByProject.get(item.Project_ID) || [];
                    list.push(itemFinance(item, wo, basis, cost));
                    raznoByProject.set(item.Project_ID, list);
                }
                continue;
            }
            if (!item.Product_ID) continue;
            const pb = basis.products.get(item.Product_ID);
            const projectId = pb?.projectId || item.Project_ID || '';
            if (!projectId) continue;
            const acc = getAcc(item.Product_ID, projectId, pb?.name || item.Product_Name || 'Proizvod');
            if (labor.storedItems.has(item.ID)) acc.storedLabor = true;
            acc.workOrders.set(wo.Work_Order_ID, { id: wo.Work_Order_ID, number: wo.Work_Order_Number || '', status: wo.Status || '', type: wo.Work_Order_Type || 'Proizvodnja' });

            if (cancelled) {
                // Otkazan nalog: prihod/materijal ne važe, ali isplaćeni rad je stvaran trošak proizvoda.
                acc.otherLabor += cost; acc.otherDays += days; acc.cancelledLabor += cost;
                continue;
            }
            if (kind === 'montaza') {
                acc.otherLabor += cost; acc.otherDays += days;
                continue;
            }
            acc.production.push({ item, wo, fin: itemFinance(item, wo, basis, cost) });
            acc.productionDays += days;
        }
    }

    // Žive dnevnice čija stavka više ne postoji (a nalog nije obrisan) → proizvodu po Product_ID.
    for (const l of liveLogs(args.logs || [])) {
        if (!l.Work_Order_Item_ID || knownItems.has(l.Work_Order_Item_ID) || !l.Product_ID) continue;
        const pb = basis.products.get(l.Product_ID);
        if (!pb) continue;
        const acc = getAcc(l.Product_ID, pb.projectId, pb.name);
        acc.otherLabor += l.Daily_Rate || 0;
        acc.otherDays += l.Day_Fraction ?? 1;
    }

    // Proizvodi bez ijedne stavke (nisu u nalogu) — iz osnove.
    basis.products.forEach(pb => { if (!accByProduct.has(pb.productId)) getAcc(pb.productId, pb.projectId, pb.name); });

    const rowsByProject = new Map<string, ProductFinanceRow[]>();
    accByProduct.forEach(acc => {
        const row = productRow(acc, basis);
        const list = rowsByProject.get(acc.projectId) || [];
        list.push(row);
        rowsByProject.set(acc.projectId, list);
    });

    const projectIds = new Set<string>([
        ...Array.from(rowsByProject.keys()),
        ...Array.from(raznoByProject.keys()),
        ...Array.from(basis.contracts.keys()),
    ]);
    const out = new Map<string, ProjectFinance>();
    projectIds.forEach(projectId => {
        out.set(projectId, assembleProject(projectId, rowsByProject.get(projectId) || [], raznoByProject.get(projectId) || [], basis));
    });
    return out;
}

function productRow(acc: ProductAcc, basis: FinanceBasis): ProductFinanceRow {
    const pb = basis.products.get(acc.productId);
    const line = basis.offerLines.get(acc.productId);
    const quantity = pb?.quantity || 1;
    const status = pb?.status || 'Na čekanju';
    const production = acc.production;
    const producedQty = production.reduce((s, p) => s + qtyOf(p.item.Quantity), 0);

    let stage: ProductStage;
    let completedAt = '';
    let withoutWorkOrder = false;
    if (production.length > 0) {
        const allDone = production.every(p => p.item.Status === 'Završeno');
        stage = allDone && producedQty + 1e-9 >= quantity ? 'zavrseno' : 'u_izradi';
        if (stage === 'zavrseno') {
            completedAt = production.reduce((m, p) => {
                const d = dOnly(p.item.Completed_At) || dOnly(p.wo.Completed_At);
                return d > m ? d : m;
            }, '');
        }
    } else {
        // Bez ijednog naloga proizvod nije završen u smislu profita (nema evidentiranog rada),
        // ni kad mu je status ručno postavljen na gotov — to se samo označava za provjeru.
        stage = 'nije_zapoceto';
        withoutWorkOrder = DONE_STATUSES.includes(status);
    }

    // Proizvodne stavke nose prihod/materijal/rad; rad montaže i otkazanih naloga se dodaje.
    const fin = sumItemFinance(production.map(p => p.fin));
    const sources = new Set(production.map(p => p.fin.revenueSource));
    const revenueSource: RevenueSource = production.length > 0
        ? (sources.has('nalog') ? 'nalog' : sources.has('racun') ? 'racun' : sources.has('korekcija') ? 'korekcija' : 'ponuda')
        : (line ? 'ponuda' : 'nalog');

    const laborTotal = r2(fin.labor + acc.otherLabor);
    const profitB = profitFromTotals({ revenue: fin.revenue, material: fin.material, labor: laborTotal, services: 0, transport: 0, other: fin.other });

    const offerQty = line ? line.quantity : 0;
    const plannedProfit = r2(fin.revenue - fin.plannedMaterial - fin.plannedLabor);
    const rep = production.find(p => p.item.Status !== 'Završeno') || production[0];
    const started = stage !== 'nije_zapoceto';
    const madeQty = producedQty;
    const flags: ProductFlags = {
        ...ZERO_FLAGS,
        noOffer: started && !line && revenueSource === 'nalog',
        noPrice: started && fin.revenue <= 0,
        noMaterial: started && fin.material <= 0,
        noLabor: stage === 'zavrseno' && laborTotal <= 0,
        withoutWorkOrder,
        // Količina proizvoda (ili proizvedeno, ako je više) ≠ količina u prihvaćenoj ponudi.
        qtyMismatch: !!line && started && (Math.abs(quantity - line.quantity) > 1e-9 || madeQty - line.quantity > 1e-9),
        storedLabor: acc.storedLabor,
    };

    return {
        productId: acc.productId,
        projectId: acc.projectId,
        name: acc.name,
        quantity,
        producedQty: r2(producedQty),
        offerQty,
        stage,
        status,
        completedAt,
        revenueSource,
        offerNumber: line?.offerNumber || '',
        inContract: !!line,
        contracted: line ? line.total : 0,
        revenue: profitB.revenue,
        materialBom: fin.materialBom,
        materialExtras: fin.materialExtras,
        material: profitB.material,
        labor: profitB.labor,
        laborDays: r2(acc.productionDays + acc.otherDays),
        profit: profitB.profit,
        margin: profitB.margin,
        plannedMaterial: fin.plannedMaterial,
        plannedLabor: fin.plannedLabor,
        plannedProfit,
        cancelledLabor: r2(acc.cancelledLabor),
        workOrders: Array.from(acc.workOrders.values()),
        itemId: rep?.item.ID || '',
        workOrderId: rep?.wo.Work_Order_ID || '',
        itemStatus: rep?.item.Status || '',
        flags,
    };
}

function assembleProject(projectId: string, rows: ProductFinanceRow[], razno: ItemFinance[], basis: FinanceBasis): ProjectFinance {
    const contract = basis.contracts.get(projectId);
    const finished = rows.filter(r => r.stage === 'zavrseno');
    const inProgress = rows.filter(r => r.stage === 'u_izradi');
    const notStartedAll = rows.filter(r => r.stage === 'nije_zapoceto');
    const notStarted = notStartedAll.filter(r => r.inContract);
    const outOfContract = notStartedAll.filter(r => !r.inContract);
    const realized = sumStage(finished);
    const prog = sumStage(inProgress);
    const raz = sumItemFinance(razno);
    const razni = { ...raz, count: razno.length };

    const revenue = r2(realized.revenue + razni.revenue);
    const profit = r2(realized.profit + razni.profit);
    const material = r2(realized.material + razni.material);
    const labor = r2(realized.labor + razni.labor);
    // Rad na nezapočetim (npr. otkazan nalog) je stvaran trošak — broji se u uloženo bez obzira na ugovor.
    const nsLabor = r2(notStartedAll.reduce((s, r) => s + r.labor, 0));

    rows.sort((a, b) => {
        const rank = (s: ProductStage) => (s === 'u_izradi' ? 0 : s === 'zavrseno' ? 1 : 2);
        return rank(a.stage) - rank(b.stage) || b.revenue - a.revenue || a.name.localeCompare(b.name, 'hr');
    });

    return {
        projectId,
        contracted: contract?.total || 0,
        contractOffers: contract?.offers || [],
        realized,
        inProgress: prog,
        notStarted: { count: notStarted.length, contracted: r2(notStarted.reduce((s, r) => s + r.contracted, 0)), labor: nsLabor },
        razni,
        profit,
        margin: revenue > 0 ? r2((profit / revenue) * 100) : 0,
        revenue,
        material,
        labor,
        spentMaterial: r2(realized.material + prog.material + razni.material),
        spentLabor: r2(realized.labor + prog.labor + nsLabor + razni.labor),
        products: rows,
        productCount: rows.length,
        scopeCount: rows.length - outOfContract.length,
        outOfContractCount: outOfContract.length,
        finishedCount: finished.length,
        flagged: rows.filter(r => hasFlag(r.flags)).length,
    };
}

/** Finansije jednog projekta (isti proračun kao za sve — samo izdvojen rezultat). */
export function computeProjectFinance(args: {
    projectId: string;
    products: FinProduct[];
    basis: FinanceBasis;
    workOrders: FinWorkOrder[];
    labor: LaborIndex;
    logs?: FinLog[];
}): ProjectFinance {
    const all = computeProjectsFinance(args);
    return all.get(args.projectId) || assembleProject(args.projectId, [], [], args.basis);
}
