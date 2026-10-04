/**
 * analyticsService.ts — dohvat podataka za Analitiku (Profiti → full-screen).
 *
 * Formula NE živi ovdje: finansije računa lib/projectFinance.ts (isti proračun kao kartica
 * projekta, pregled projekta i nalog), a lib/analytics.ts samo filtrira i sabira.
 *
 * Dohvat se radi JEDNOM (otvaranje / Osvježi); promjena perioda/opsega je čista
 * in-memory agregacija (computeAnalytics) — bez novog upita.
 *
 * Proizvodi + živa sastavnica dolaze iz glavnog store-a (projects[].products[].materials) —
 * isti objekti koje vidi kartica projekta. Ovdje se vuku: nalozi sa stavkama, SVE dnevnice
 * (kartica radi s prozorom od 12 mjeseci + sačuvani agregat za starije stavke), prihvaćene
 * ponude sa stavkama i dodacima, i šihtarica (prisutni dani bez dnevnice).
 */

import { COLLECTIONS } from '../shared/collections';
import { queryByOrg, where } from '../shared/firestoreClient';
import type { WorkOrderItem, WorkLog, WorkOrder, Offer, OfferProduct, OfferExtra, WorkerAttendance } from '../../types';
import {
    computeAnalytics as computeAnalyticsPure,
    type AnalyticsData, type AnalyticsScope, type AnalyticsInput, type AProject, type AWorker,
} from '../../analytics';

export type { AnalyticsData, AnalyticsScope } from '../../analytics';
export interface AnalyticsOptions { from?: string; to?: string; scope?: AnalyticsScope }

/** Sirovi podaci — dohvaćeni JEDNOM, pa se filtriraju/agregiraju u memoriji. */
export interface AnalyticsRaw {
    workOrders: WorkOrder[];        // sa .items
    items: WorkOrderItem[];
    logs: WorkLog[];
    offers: Offer[];                // samo prihvaćene, sa .products[].extras
    attendance: WorkerAttendance[];
}

export async function getAnalyticsRaw(organizationId: string): Promise<AnalyticsRaw> {
    if (!organizationId) return { workOrders: [], items: [], logs: [], offers: [], attendance: [] };

    const [workOrders, items, logs, acceptedOffers, offerProducts, offerExtras, attendance] = await Promise.all([
        queryByOrg<WorkOrder>(COLLECTIONS.WORK_ORDERS, organizationId),
        queryByOrg<WorkOrderItem>(COLLECTIONS.WORK_ORDER_ITEMS, organizationId),
        queryByOrg<WorkLog>(COLLECTIONS.WORK_LOGS, organizationId),
        queryByOrg<Offer>(COLLECTIONS.OFFERS, organizationId, where('Status', '==', 'Prihvaćeno')),
        queryByOrg<OfferProduct>(COLLECTIONS.OFFER_PRODUCTS, organizationId),
        queryByOrg<OfferExtra>(COLLECTIONS.OFFER_EXTRAS, organizationId),
        queryByOrg<WorkerAttendance>(COLLECTIONS.WORKER_ATTENDANCE, organizationId),
    ]);

    // Stavke → nalozi
    const itemsByWo = new Map<string, WorkOrderItem[]>();
    for (const it of items) {
        const arr = itemsByWo.get(it.Work_Order_ID) || [];
        arr.push(it);
        itemsByWo.set(it.Work_Order_ID, arr);
    }
    for (const wo of workOrders) wo.items = itemsByWo.get(wo.Work_Order_ID) || [];

    // Prihvaćene ponude → stavke (uključene i ne) → dodaci
    const acceptedIds = new Set(acceptedOffers.map(o => o.Offer_ID));
    const extrasByOp = new Map<string, OfferExtra[]>();
    for (const e of offerExtras) {
        const arr = extrasByOp.get(e.Offer_Product_ID) || [];
        arr.push(e);
        extrasByOp.set(e.Offer_Product_ID, arr);
    }
    const productsByOffer = new Map<string, OfferProduct[]>();
    for (const op of offerProducts) {
        if (!acceptedIds.has(op.Offer_ID)) continue;
        op.extras = extrasByOp.get(op.ID) || [];
        const arr = productsByOffer.get(op.Offer_ID) || [];
        arr.push(op);
        productsByOffer.set(op.Offer_ID, arr);
    }
    for (const o of acceptedOffers) o.products = productsByOffer.get(o.Offer_ID) || [];

    return { workOrders, items, logs, offers: acceptedOffers, attendance };
}

/** Ulaz za čistu agregaciju: sirovi podaci + projekti iz store-a (proizvodi sa živom sastavnicom). */
export function analyticsInput(raw: AnalyticsRaw, projects: AProject[], workers: AWorker[]): AnalyticsInput {
    return {
        projects,
        offers: raw.offers,
        workOrders: raw.workOrders,
        logs: raw.logs,
        attendance: raw.attendance,
        workers,
    };
}

/** Pogodnost (testovi/skripte): ulaz + agregacija u jednom koraku. */
export function computeAnalytics(
    raw: AnalyticsRaw,
    projects: AProject[],
    workers: AWorker[],
    opts: AnalyticsOptions = {},
): AnalyticsData {
    return computeAnalyticsPure(analyticsInput(raw, projects, workers), opts);
}
