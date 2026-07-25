// ════════════════════════════════════════════════════════════════════
// GRUPISANJE I SORTIRANJE LISTA — jedan izvor za desktop i mobitel
//
// Logika je izvučena iz desktop tabova (ProductionTab, OrdersTab, ProjectsTab)
// da mobilni prikaz ne bi imao SVOJA pravila. Ranije je mobilni izmišljao
// vlastite kriterije, pa je isti podatak bio drugačije poredan na telefonu
// nego na laptopu.
//
// Namjerno se čuvaju i sitna desktop pravila (npr. nalog s više radnika ulazi
// u više grupa, grupe po datumu idu najnovije prvo) — bez njih „isti princip"
// ne bi bio isti.
// ════════════════════════════════════════════════════════════════════

import type { Offer, Order, Project, WorkOrder, Worker } from './types';
import { WORK_ORDER_STATUSES } from './types';
import {
    workOrderSortRank, compareWorkOrdersDefault, projectStatusRank,
    compareProjectsByActivity, formatDate,
} from './utils';

export interface Group<T> {
    key: string;
    label: string;
    items: T[];
    count: number;
    /** Zbir vrijednosti grupe (nalozi: Total_Value, narudžbe: Total_Amount). */
    totalValue: number;
}

// ── NALOZI ──────────────────────────────────────────────────────────

export type WorkOrderGroupBy = 'none' | 'status' | 'project' | 'date' | 'worker';

export const WORK_ORDER_GROUPING_OPTIONS: { value: WorkOrderGroupBy; label: string }[] = [
    { value: 'project', label: 'Po projektu' },
    { value: 'status', label: 'Po statusu' },
    { value: 'date', label: 'Po datumu' },
    { value: 'worker', label: 'Po radniku' },
    { value: 'none', label: 'Bez grupisanja' },
];

/**
 * Grupisanje naloga — replika ProductionTab.
 * Kod `worker` jedan nalog može biti u VIŠE grupa (radi ga više ljudi).
 */
export function groupWorkOrders(
    workOrders: WorkOrder[],
    groupBy: WorkOrderGroupBy,
    workers: Worker[] = []
): Group<WorkOrder>[] {
    if (groupBy === 'none') return [];

    const groups: Record<string, Group<WorkOrder>> = {};
    const push = (key: string, label: string, wo: WorkOrder) => {
        if (!groups[key]) groups[key] = { key, label, items: [], count: 0, totalValue: 0 };
        if (groups[key].items.some(i => i.Work_Order_ID === wo.Work_Order_ID)) return;
        groups[key].items.push(wo);
        groups[key].count++;
        groups[key].totalValue += wo.Total_Value || 0;
    };

    for (const wo of workOrders) {
        if (groupBy === 'worker') {
            // Dodjela = Assigned_Workers + radnici upisani na procesima (i pomoćnici).
            const workerIds = new Set<string>();
            wo.items?.forEach(item => {
                (item.Assigned_Workers || []).forEach(w => { if (w.Worker_ID) workerIds.add(w.Worker_ID); });
                item.Processes?.forEach(p => {
                    if (p.Worker_ID) workerIds.add(p.Worker_ID);
                    p.Helpers?.forEach(h => { if (h.Worker_ID) workerIds.add(h.Worker_ID); });
                });
            });
            if (workerIds.size === 0) push('unassigned', 'Nedodijeljeno', wo);
            else workerIds.forEach(id => push(id, workers.find(w => w.Worker_ID === id)?.Name || 'Nepoznat', wo));
            continue;
        }

        if (groupBy === 'status') {
            const key = wo.Status || 'Ostalo';
            push(key, key, wo);
        } else if (groupBy === 'project') {
            push(wo.items?.[0]?.Project_ID || 'unknown', wo.items?.[0]?.Project_Name || 'Nepoznat projekat', wo);
        } else if (groupBy === 'date') {
            const key = wo.Created_Date ? wo.Created_Date.split('T')[0] : 'unknown';
            push(key, wo.Created_Date ? formatDate(wo.Created_Date) : 'Nepoznat datum', wo);
        }
    }

    // Redoslijed GRUPA — svaka vrsta ima svoje pravilo (kao desktop).
    const ordered = Object.values(groups).sort((a, b) => {
        if (groupBy === 'date') return b.key.localeCompare(a.key);                 // najnovije prvo
        if (groupBy === 'status') return WORK_ORDER_STATUSES.indexOf(a.key as any) - WORK_ORDER_STATUSES.indexOf(b.key as any);
        if (groupBy === 'worker') return b.totalValue - a.totalValue;              // najproduktivniji prvo
        if (groupBy === 'project') {
            // Projekat s bar jednim aktivnim nalogom ide ispred onog s pauziranim/montažnim.
            const bestRank = (items: WorkOrder[]) => Math.min(...items.map(workOrderSortRank));
            const rankDiff = bestRank(a.items) - bestRank(b.items);
            if (rankDiff !== 0) return rankDiff;
            const firstOrderDate = (items: WorkOrder[]) => Math.min(...items.map(i => new Date(i.Created_Date).getTime()));
            return firstOrderDate(b.items) - firstOrderDate(a.items);
        }
        return a.label.localeCompare(b.label, 'hr');
    });

    // Redoslijed UNUTAR grupe = zadani poredak naloga (aktivni prvi).
    return ordered.map(g => ({ ...g, items: [...g.items].sort(compareWorkOrdersDefault) }));
}

// ── NARUDŽBE ────────────────────────────────────────────────────────

export type OrderGroupBy = 'none' | 'supplier' | 'status' | 'date' | 'project';
export type OrderSortBy = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'supplier';

export const ORDER_GROUPING_OPTIONS: { value: OrderGroupBy; label: string }[] = [
    { value: 'supplier', label: 'Po dobavljaču' },
    { value: 'status', label: 'Po statusu' },
    { value: 'project', label: 'Po projektu' },
    { value: 'date', label: 'Po datumu' },
    { value: 'none', label: 'Bez grupisanja' },
];

export const ORDER_SORT_OPTIONS: { value: OrderSortBy; label: string }[] = [
    { value: 'date-desc', label: 'Datum — najnovije' },
    { value: 'date-asc', label: 'Datum — najstarije' },
    { value: 'amount-desc', label: 'Iznos — veći prvo' },
    { value: 'amount-asc', label: 'Iznos — manji prvo' },
    { value: 'supplier', label: 'Dobavljač (A–Ž)' },
];

/** Sortiranje narudžbi — replika OrdersTab. */
export function sortOrders(orders: Order[], sortBy: OrderSortBy): Order[] {
    const sorted = [...orders];
    switch (sortBy) {
        case 'date-desc': sorted.sort((a, b) => new Date(b.Order_Date).getTime() - new Date(a.Order_Date).getTime()); break;
        case 'date-asc': sorted.sort((a, b) => new Date(a.Order_Date).getTime() - new Date(b.Order_Date).getTime()); break;
        case 'amount-desc': sorted.sort((a, b) => (b.Total_Amount || 0) - (a.Total_Amount || 0)); break;
        case 'amount-asc': sorted.sort((a, b) => (a.Total_Amount || 0) - (b.Total_Amount || 0)); break;
        case 'supplier': sorted.sort((a, b) => (a.Supplier_Name || '').localeCompare(b.Supplier_Name || '')); break;
    }
    return sorted;
}

/** Grupisanje narudžbi — replika OrdersTab (grupe po datumu su MJESEC, ne dan). */
export function groupOrders(orders: Order[], groupBy: OrderGroupBy, projects: Project[] = []): Group<Order>[] {
    const groups = new Map<string, Order[]>();

    for (const order of orders) {
        let key: string;
        switch (groupBy) {
            case 'supplier':
                key = order.Supplier_Name || 'Nepoznat dobavljač';
                break;
            case 'status':
                key = order.Status || 'Nepoznat status';
                break;
            case 'project': {
                const pid = order.items?.[0]?.Project_ID;
                key = projects.find(p => p.Project_ID === pid)?.Client_Name || 'Bez projekta';
                break;
            }
            case 'date': {
                if (order.Order_Date) {
                    const m = new Date(order.Order_Date).toLocaleDateString('hr-HR', { month: 'long', year: 'numeric' });
                    key = m.charAt(0).toUpperCase() + m.slice(1);
                } else key = 'Bez datuma';
                break;
            }
            default:
                key = 'Sve narudžbe';
        }
        const arr = groups.get(key);
        if (arr) arr.push(order); else groups.set(key, [order]);
    }

    return Array.from(groups.entries()).map(([key, items]) => ({
        key, label: key, items, count: items.length,
        totalValue: items.reduce((s, o) => s + (o.Total_Amount || 0), 0),
    }));
}

// ── PONUDE ──────────────────────────────────────────────────────────

export type OfferGroupBy = 'none' | 'status' | 'project';
export type OfferSortBy = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'client-asc' | 'client-desc';

export const OFFER_GROUPING_OPTIONS: { value: OfferGroupBy; label: string }[] = [
    { value: 'none', label: 'Bez grupisanja' },
    { value: 'status', label: 'Po statusu' },
    { value: 'project', label: 'Po klijentu' },
];

export const OFFER_SORT_OPTIONS: { value: OfferSortBy; label: string }[] = [
    { value: 'date-desc', label: 'Najnovije prvo' },
    { value: 'date-asc', label: 'Najstarije prvo' },
    { value: 'amount-desc', label: 'Najveći iznos' },
    { value: 'amount-asc', label: 'Najmanji iznos' },
    { value: 'client-asc', label: 'Klijent A–Ž' },
    { value: 'client-desc', label: 'Klijent Ž–A' },
];

/** Sortiranje ponuda — replika OffersTab. */
export function sortOffers(offers: Offer[], sortBy: OfferSortBy): Offer[] {
    return [...offers].sort((a, b) => {
        switch (sortBy) {
            case 'date-desc': return new Date(b.Created_Date || 0).getTime() - new Date(a.Created_Date || 0).getTime();
            case 'date-asc': return new Date(a.Created_Date || 0).getTime() - new Date(b.Created_Date || 0).getTime();
            case 'amount-desc': return (b.Total || 0) - (a.Total || 0);
            case 'amount-asc': return (a.Total || 0) - (b.Total || 0);
            case 'client-asc': return (a.Client_Name || '').localeCompare(b.Client_Name || '', 'hr');
            case 'client-desc': return (b.Client_Name || '').localeCompare(a.Client_Name || '', 'hr');
            default: return 0;
        }
    });
}

const OFFER_STATUS_ORDER = ['Nacrt', 'Poslano', 'Prihvaćeno', 'Odbijeno', 'Isteklo'];

/** Grupisanje ponuda — replika OffersTab (grupa „project" je zapravo KLIJENT). */
export function groupOffers(offers: Offer[], groupBy: OfferGroupBy): Group<Offer>[] {
    if (groupBy === 'none') return [];

    const groups = new Map<string, Offer[]>();
    for (const offer of offers) {
        const key = groupBy === 'status'
            ? (offer.Status || 'Nacrt')
            : (offer.Client_Name || 'Nepoznat klijent');
        const arr = groups.get(key);
        if (arr) arr.push(offer); else groups.set(key, [offer]);
    }

    return Array.from(groups.keys())
        .sort((a, b) => {
            if (groupBy === 'status') {
                const ia = OFFER_STATUS_ORDER.indexOf(a), ib = OFFER_STATUS_ORDER.indexOf(b);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            }
            return a.localeCompare(b, 'hr');
        })
        .map(key => {
            const items = groups.get(key)!;
            return {
                key, label: key, items, count: items.length,
                totalValue: items.reduce((s, o) => s + (o.Total || 0), 0),
            };
        });
}

// ── PROJEKTI ────────────────────────────────────────────────────────

/**
 * Projekti su na desktopu UVIJEK grupisani po statusu (nema izbora):
 * redoslijed grupa po projectStatusRank, unutar grupe po broju aktivnih naloga.
 */
export function groupProjectsByStatus(
    projects: Project[],
    activeOrderCounts: Map<string, number>
): Group<Project>[] {
    const groups = new Map<string, Project[]>();
    for (const project of projects) {
        const key = project.Status || 'Bez statusa';
        const arr = groups.get(key);
        if (arr) arr.push(project); else groups.set(key, [project]);
    }

    return Array.from(groups.entries())
        .sort(([a], [b]) => projectStatusRank(a) - projectStatusRank(b) || a.localeCompare(b, 'hr'))
        .map(([status, items]) => ({
            key: status,
            label: status,
            items: [...items].sort((a, b) => compareProjectsByActivity(a, b, activeOrderCounts)),
            count: items.length,
            totalValue: 0,
        }));
}
