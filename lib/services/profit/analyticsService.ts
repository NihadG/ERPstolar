/**
 * analyticsService.ts — Jedinstvena analitika (Profiti → full-screen).
 *
 * MODEL = STVARNO (isti izvor kao WorkOrderExpandedDetail / lib/projectProfit.ts):
 * agregacija PO PROIZVODU, ali finansije se sabiraju preko SVIH stavki proizvoda
 * (snapshot Material_Cost/Services_Total/Transport_Share po stavci, override važi
 * kao u lib/profit.ts) — BEZ "reprezentativne stavke" i BEZ žive ponude kao izvora
 * STVARNOG prihoda/materijala/usluga (živi materijal/usluge se garantuju write-time
 * u lib/attendance.ts recalculateWorkOrder, ne ovdje). PLAN kolone (iz ponude) su
 * odvojene i i dalje koriste najbolju dostupnu procjenu (offerProductByProduct fallback).
 *
 * Efikasnost: dohvat (getAnalyticsRaw) se radi JEDNOM (otvaranje / Osvježi);
 * promjena perioda/opsega je čista IN-MEMORY agregacija (computeAnalytics) — bez novog upita.
 * Period (vremenski raspon) filtrira KOJI nalozi/proizvodi ulaze (nalog aktivan u prozoru);
 * profit je kumulativan; radnici/trend su filtrirani po periodu.
 */

import { COLLECTIONS } from '../shared/collections';
import { queryByOrg, where } from '../shared/firestoreClient';
import { itemMaterialTotal } from '../../materialCost';
import type { WorkOrderItem, WorkLog, WorkOrder, Offer, OfferProduct } from '../../types';
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
    actualLaborByProduct: Map<string, number>;
    offerProductByProduct: Map<string, OfferProduct>;
}

const dOnly = (iso?: string | null) => (iso ? iso.split('T')[0] : '');

export async function getAnalyticsRaw(organizationId: string): Promise<AnalyticsRaw> {
    if (!organizationId) {
        return { workOrders: [], items: [], logs: [], actualLaborByProduct: new Map(), offerProductByProduct: new Map() };
    }
    // PERF: analitika ranije zvala generički getOffers() — taj dohvaća SVE 4 kolekcije cijele
    // organizacije (offers, offer_products, offer_extras, PA I projects radi enrichment-a klijenta)
    // za BAŠ SVAKU ponudu ikad napravljenu (nacrti/odbijene/istekle), iako je analitici trebala
    // samo Product_ID → uslovi PRIHVAĆENE ponude. Ovdje: direktan upit filtriran na Status='Prihvaćeno'
    // (server-side, manji rezultat) + BEZ projects fetcha (nepotreban — analitika ne prikazuje klijenta).
    // BEZ product_materials/offer_extras upita: STVARNI materijal/usluge sada dolaze iz snapshot-a
    // na stavci (Material_Cost/Services_Total), ne iz žive ponude/kataloga (parity sa karticom projekta).
    const [workOrders, items, logs, acceptedOffers, offerProducts] = await Promise.all([
        queryByOrg<WorkOrder>(COLLECTIONS.WORK_ORDERS, organizationId),
        queryByOrg<WorkOrderItem>(COLLECTIONS.WORK_ORDER_ITEMS, organizationId),
        queryByOrg<WorkLog>(COLLECTIONS.WORK_LOGS, organizationId),
        queryByOrg<Offer>(COLLECTIONS.OFFERS, organizationId, where('Status', '==', 'Prihvaćeno')),
        queryByOrg<OfferProduct>(COLLECTIONS.OFFER_PRODUCTS, organizationId),
    ]);

    const actualLaborByProduct = new Map<string, number>();
    for (const l of logs) {
        if (!l.Product_ID) continue;
        actualLaborByProduct.set(l.Product_ID, (actualLaborByProduct.get(l.Product_ID) || 0) + (l.Daily_Rate || 0));
    }

    const acceptedOfferIds = new Set(acceptedOffers.map(o => o.Offer_ID));
    const offerProductByProduct = new Map<string, OfferProduct>();
    for (const op of offerProducts) {
        if (!op.Product_ID || !acceptedOfferIds.has(op.Offer_ID) || offerProductByProduct.has(op.Product_ID)) continue;
        offerProductByProduct.set(op.Product_ID, op);
    }
    return { workOrders, items, logs, actualLaborByProduct, offerProductByProduct };
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
    const notCancelled = (woId: string): boolean => {
        const st = woById.get(woId)?.Status;
        return !!st && st !== 'Otkazano';
    };
    const isMontazaWo = (woId: string): boolean => woById.get(woId)?.Work_Order_Type === 'Montaža';

    // Grupiši SVE ne-otkazane stavke po Product_ID. Opseg (Aktivni/Svi) i period odlučuju
    // samo KOJI proizvodi ulaze u izvještaj (bar jedna stavka u opsegu i periodu) —
    // finansije proizvoda se UVIJEK računaju iz KOMPLETNE slike svih njegovih naloga.
    // (Ranije: pod "Aktivni" bi završeni PROIZVODNI nalog ispao, pa je aktivna MONTAŽNA
    // stavka — s nuliranim finansijama — predstavljala proizvod: cijena/materijal/plan = 0.)
    const itemsByProduct = new Map<string, WorkOrderItem[]>();
    const includedProducts = new Set<string>();
    for (const it of raw.items) {
        if (!it.Product_ID) continue;
        if (!notCancelled(it.Work_Order_ID)) continue;
        const arr = itemsByProduct.get(it.Product_ID) || [];
        arr.push(it);
        itemsByProduct.set(it.Product_ID, arr);
        if (woAllowed(it.Work_Order_ID) && orderInPeriod(woById.get(it.Work_Order_ID), range.from, range.to)) {
            includedProducts.add(it.Product_ID);
        }
    }

    const inputs: ProductInput[] = [];
    for (const [productId, items] of Array.from(itemsByProduct.entries())) {
        if (!includedProducts.has(productId)) continue;
        // Reprezentativna stavka: SAMO za META polja (naziv/projekat/nalog za drill-in) —
        // finansije NIKAD ne dolaze samo iz ove jedne stavke (vidi STVARNO ispod). Preferiraj
        // proizvodnu (montaža nema svoj naziv/nalog kontekst za prikaz) i nezavršenu.
        const production = items.filter(i => !isMontazaWo(i.Work_Order_ID));
        const pool = production.length ? production : items;
        const rep = pool.find(i => i.Status !== 'Završeno') || pool[0];
        const wo = woById.get(rep.Work_Order_ID);
        const op = raw.offerProductByProduct.get(productId);

        // STVARNO (snapshot, parity sa WorkOrderExpandedDetail/lib/projectProfit.ts): Σ preko
        // SVIH ne-otkazanih stavki proizvoda — BEZ reprezentativne stavke, BEZ žive ponude kao
        // izvora (Product_Value=0 dok se ponuda ne backfilluje ostaje 0, ne "pada" na ponudu —
        // isto kao kartica projekta/nalog). Montaža stavke ne nose prihod/materijal/usluge/transport.
        let selling = 0, liveMaterial = 0, services = 0, transport = 0;
        for (const it of items) {
            if (isMontazaWo(it.Work_Order_ID)) continue;
            const ov = (it as { Profit_Overrides?: { Selling_Price?: number; Transport_Share?: number } }).Profit_Overrides;
            selling += (ov?.Selling_Price != null && ov.Selling_Price > 0) ? ov.Selling_Price : (it.Product_Value || 0);
            liveMaterial += itemMaterialTotal(it.Material_Cost, it.Quantity);
            // Services_Total nema poseban override sloj (za razliku od Selling_Price/Transport_Share):
            // saveProfitOverrides mirroruje Extras_Total DIREKTNO u Services_Total pri snimanju, pa se
            // snapshot uvijek čita kao ovdje — isto kao lib/profit.ts (bez servicesOverride parametra).
            services += it.Services_Total || 0;
            transport += (ov?.Transport_Share != null ? ov.Transport_Share : (it.Transport_Share || 0));
        }

        // PLAN (iz ponude) — nezavisna kolona, i dalje najbolja dostupna procjena bez obzira
        // da li je WO item još backfillovan; fallback ostaje netaknut.
        const plannedMaterial = op ? (op.Material_Cost || 0) * (op.Quantity || 1) : itemMaterialTotal(rep.Material_Cost, rep.Quantity);
        // Planirani rad: snapshot sa stavki (Planned_Labor_Cost je PO KOMADU, kao u ponudi:
        // radnici × dani × dnevnica) preko SVIH naloga proizvoda; ako stavke snapshot nemaju
        // (stariji nalozi / montaža), fallback na živu prihvaćenu ponudu.
        let plannedLabor = items.reduce((s, it) => s + (it.Planned_Labor_Cost || 0) * (it.Quantity || 1), 0);
        if (plannedLabor === 0 && op) {
            plannedLabor = (op.Labor_Workers || 0) * (op.Labor_Days || 0) * (op.Labor_Daily_Rate || 0) * (op.Quantity || 1);
        }

        inputs.push({
            itemId: rep.ID,
            productId, productName: rep.Product_Name || 'Proizvod',
            projectId: rep.Project_ID || '', projectName: rep.Project_Name || '—',
            woId: rep.Work_Order_ID || '', woNumber: wo?.Work_Order_Number || '', woType: wo?.Work_Order_Type || '',
            status: rep.Status || '',
            selling,
            liveMaterial,
            plannedMaterial,
            actualLabor: raw.actualLaborByProduct.get(productId) || 0,
            plannedLabor,
            transport,
            services,
        });
    }

    const products = aggregateProductRows(inputs);
    const projects = aggregateProjects(products);
    const kpis = computeKpis(products);
    const pva = planVsActual(products);

    // Radnici / trend — filtrirani po periodu (i samo logovi proizvoda u opsegu/periodu).
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
