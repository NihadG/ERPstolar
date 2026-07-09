/**
 * analyticsService.ts — Jedinstvena analitika (Profiti → full-screen).
 *
 * MODEL = STVARNO (kao kartica projekta), agregacija PO PROIZVODU.
 *
 * Efikasnost: dohvat (getAnalyticsRaw) se radi JEDNOM (otvaranje / Osvježi);
 * promjena perioda/opsega je čista IN-MEMORY agregacija (computeAnalytics) — bez novog upita.
 * Period (vremenski raspon) filtrira KOJI nalozi/proizvodi ulaze (nalog aktivan u prozoru);
 * profit je kumulativan; radnici/trend su filtrirani po periodu.
 */

import { COLLECTIONS } from '../shared/collections';
import { queryByOrg } from '../shared/firestoreClient';
import { itemMaterialTotal } from '../../materialCost';
import type { WorkOrderItem, WorkLog, WorkOrder, ProductMaterial, Offer, OfferProduct } from '../../types';
import {
    aggregateProductRows, aggregateProjects, planVsActual, aggregateWorkers,
    weeklyLaborTrend, computeKpis,
    type ProductInput, type ALog, type DateRange,
    type ProductRow, type ProjectRow, type WorkerRow, type PvARow, type WeekBucket, type Kpis,
} from '../../analytics';

export type AnalyticsScope = 'active' | 'all';
export interface AnalyticsOptions { from?: string; to?: string; scope?: AnalyticsScope }

export interface AnalyticsData {
    kpis: Kpis;
    products: ProductRow[];
    projects: ProjectRow[];
    workers: WorkerRow[];
    planVsActual: { total: PvARow; byProject: PvARow[] };
    weeklyTrend: WeekBucket[];
    range: DateRange;
    scope: AnalyticsScope;
}

/** Sirovi podaci — dohvaćeni JEDNOM, pa se filtriraju/agregiraju u memoriji. */
export interface AnalyticsRaw {
    workOrders: WorkOrder[];
    items: WorkOrderItem[];
    logs: WorkLog[];
    liveMaterialByProduct: Map<string, number>;
    actualLaborByProduct: Map<string, number>;
    offerProductByProduct: Map<string, OfferProduct>;
}

const dOnly = (iso?: string | null) => (iso ? iso.split('T')[0] : '');

export async function getAnalyticsRaw(organizationId: string): Promise<AnalyticsRaw> {
    if (!organizationId) {
        return { workOrders: [], items: [], logs: [], liveMaterialByProduct: new Map(), actualLaborByProduct: new Map(), offerProductByProduct: new Map() };
    }
    const { getOffers } = await import('../offer/offerService');
    const [workOrders, items, logs, productMaterials, offers] = await Promise.all([
        queryByOrg<WorkOrder>(COLLECTIONS.WORK_ORDERS, organizationId),
        queryByOrg<WorkOrderItem>(COLLECTIONS.WORK_ORDER_ITEMS, organizationId),
        queryByOrg<WorkLog>(COLLECTIONS.WORK_LOGS, organizationId),
        queryByOrg<ProductMaterial>(COLLECTIONS.PRODUCT_MATERIALS, organizationId),
        getOffers(organizationId),
    ]);

    const liveMaterialByProduct = new Map<string, number>();
    for (const m of productMaterials) {
        if (!m.Product_ID) continue;
        liveMaterialByProduct.set(m.Product_ID, (liveMaterialByProduct.get(m.Product_ID) || 0) + (m.Total_Price || 0));
    }
    const actualLaborByProduct = new Map<string, number>();
    for (const l of logs) {
        if (!l.Product_ID) continue;
        actualLaborByProduct.set(l.Product_ID, (actualLaborByProduct.get(l.Product_ID) || 0) + (l.Daily_Rate || 0));
    }
    const offerProductByProduct = new Map<string, OfferProduct>();
    for (const offer of offers.filter(o => o.Status === 'Prihvaćeno')) {
        for (const op of ((offer as Offer & { products?: OfferProduct[] }).products || [])) {
            if (op.Product_ID && !offerProductByProduct.has(op.Product_ID)) offerProductByProduct.set(op.Product_ID, op);
        }
    }
    return { workOrders, items, logs, liveMaterialByProduct, actualLaborByProduct, offerProductByProduct };
}

/** Da li je nalog AKTIVAN u vremenskom prozoru [from,to] (preklapanje intervala). */
function orderInPeriod(wo: WorkOrder | undefined, from?: string, to?: string): boolean {
    if (!from && !to) return true;
    if (!wo) return false;
    const start = dOnly(wo.Started_At) || dOnly(wo.Created_Date);
    const end = dOnly(wo.Completed_At) || '9999-12-31';
    if (to && start && start > to) return false;     // počeo nakon prozora
    if (from && end < from) return false;            // završio prije prozora
    return true;
}

/** Čista (in-memory) agregacija iz sirovih podataka — primjenjuje opseg + period. */
export function computeAnalytics(raw: AnalyticsRaw, opts: AnalyticsOptions = {}): AnalyticsData {
    const scope: AnalyticsScope = opts.scope || 'active';
    const range: DateRange = { from: opts.from, to: opts.to };

    const woById = new Map(raw.workOrders.map(w => [w.Work_Order_ID, w]));
    const woAllowed = (woId: string): boolean => {
        const st = woById.get(woId)?.Status;
        if (!st || st === 'Otkazano') return false;
        return scope === 'active' ? (st === 'U toku' || st === 'Na čekanju') : true;
    };

    // Grupiši stavke po Product_ID — samo u opsegu I u periodu (nalog aktivan u prozoru).
    const itemsByProduct = new Map<string, WorkOrderItem[]>();
    for (const it of raw.items) {
        if (!it.Product_ID) continue;
        if (!woAllowed(it.Work_Order_ID)) continue;
        if (!orderInPeriod(woById.get(it.Work_Order_ID), range.from, range.to)) continue;
        const arr = itemsByProduct.get(it.Product_ID) || [];
        arr.push(it);
        itemsByProduct.set(it.Product_ID, arr);
    }

    const inputs: ProductInput[] = [];
    for (const [productId, items] of Array.from(itemsByProduct.entries())) {
        const rep = items.find(i => i.Status !== 'Završeno') || items[0];
        const wo = woById.get(rep.Work_Order_ID);
        const op = raw.offerProductByProduct.get(productId);
        const overrides = (rep as { Profit_Overrides?: { Selling_Price?: number; Transport_Share?: number; Extras_Total?: number } }).Profit_Overrides;
        const selling = (overrides?.Selling_Price ?? rep.Product_Value) || (op ? (op.Selling_Price || op.Total_Price || 0) : 0);
        const transport = overrides?.Transport_Share ?? rep.Transport_Share ?? (op?.Transport_Share || 0);
        // USLUGE: item.Services_Total je SNAPSHOT upisan pri kreiranju naloga (uvijek definisan broj,
        // i 0 ako ponuda tada nije imala usluga — vidi ProductionTab.tsx) → `?? ` fallback na živu
        // ponudu ovdje NIKAD nije okidao (0 nije null/undefined), pa su usluge dodane u ponudu NAKON
        // kreiranja naloga ostajale nevidljive u analitici. STVARNO (živo) = trenutni extras ponude,
        // isto kao liveMaterial; eksplicitni ručni override (Profit_Overrides.Extras_Total) ima prednost;
        // stavke bez vezane ponude (ad-hoc/custom) koriste pohranjenu vrijednost.
        const liveOfferServices = op ? (op.extras || []).reduce((s, e) => s + (e.Total || 0), 0) : undefined;
        const services = overrides?.Extras_Total ?? liveOfferServices ?? (rep.Services_Total || 0);
        const plannedMaterial = op ? (op.Material_Cost || 0) * (op.Quantity || 1) : itemMaterialTotal(rep.Material_Cost, rep.Quantity);
        const plannedLabor = items.reduce((s, it) => s + (it.Planned_Labor_Cost || 0) * (it.Quantity || 1), 0);

        inputs.push({
            itemId: rep.ID,
            productId, productName: rep.Product_Name || 'Proizvod',
            projectId: rep.Project_ID || '', projectName: rep.Project_Name || '—',
            woId: rep.Work_Order_ID || '', woNumber: wo?.Work_Order_Number || '', woType: wo?.Work_Order_Type || '',
            status: rep.Status || '',
            selling: selling || 0,
            // MATERIJAL × KOLIČINA: liveMaterialByProduct je PO KOMADU (Σ product_materials),
            // a `selling` (rep.Product_Value) je UKUPAN → množi količinom reprezentativne stavke.
            // Simetrično s `plannedMaterial` (op.Material_Cost × op.Quantity).
            liveMaterial: itemMaterialTotal(raw.liveMaterialByProduct.get(productId) || 0, rep.Quantity),
            plannedMaterial,
            actualLabor: raw.actualLaborByProduct.get(productId) || 0,
            plannedLabor,
            transport: transport || 0,
            services: services || 0,
        });
    }

    const products = aggregateProductRows(inputs);
    const projects = aggregateProjects(products);
    const kpis = computeKpis(products);
    const pva = planVsActual(products);

    // Radnici / trend — filtrirani po periodu (i samo logovi proizvoda u opsegu/periodu).
    const includedProducts = new Set(inputs.map(i => i.productId));
    const logs: ALog[] = raw.logs
        .filter(l => !l.Product_ID || includedProducts.has(l.Product_ID))
        .map(l => ({
            Date: l.Date, Worker_ID: l.Worker_ID, Worker_Name: l.Worker_Name,
            Daily_Rate: l.Daily_Rate || 0, Day_Fraction: l.Day_Fraction,
            Work_Order_Item_ID: l.Work_Order_Item_ID, Product_ID: l.Product_ID,
        }));
    const workers = aggregateWorkers(logs, range);
    const weeklyTrend = weeklyLaborTrend(logs, range);

    return { kpis, products, projects, workers, planVsActual: pva, weeklyTrend, range, scope };
}

/** Pogodnost: dohvat + agregacija u jednom (npr. za skripte). UI koristi getAnalyticsRaw + computeAnalytics. */
export async function getAnalytics(organizationId: string, opts: AnalyticsOptions = {}): Promise<AnalyticsData> {
    return computeAnalytics(await getAnalyticsRaw(organizationId), opts);
}
