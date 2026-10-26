// ════════════════════════════════════════════════════════════════════
// KAPIJE IZ PODATAKA ERP-a (klijent) — projekti s proizvodima i
// materijalima, katalog i narudžbe → kapije naloga. Isto što server radi u
// lib/assistant/materialAlerts.workOrderGates, samo nad već učitanim stanjem.
// ════════════════════════════════════════════════════════════════════

import { buildGates, rowIsReady, type Gate, type GateMaterialInput, type GateRow, type OrderRef, type StockRules } from './materialGates';
import type { Material, Order, Project, WorkOrder } from './types';

export interface GateSources {
    projects: Project[];
    materials: Material[];
    orders: Order[];
    stock: StockRules;
}

export function orderRefsOf(orders: Order[]): Map<string, OrderRef> {
    return new Map(orders.map(o => [o.Order_ID, { number: o.Order_Number, supplier: o.Supplier_Name, date: o.Order_Date, status: o.Status }]));
}

export function workOrderGatesFrom(wo: WorkOrder, src: GateSources, refs = orderRefsOf(src.orders)): Gate[] {
    const items = (wo.items || []).filter(i => i.Item_Type !== 'custom');
    const wanted = new Set(items.map(i => i.Product_ID));
    const projectIds = new Set(items.map(i => i.Project_ID));
    const products = src.projects.filter(p => projectIds.has(p.Project_ID)).flatMap(p => p.products || []).filter(p => wanted.has(p.Product_ID));
    const catalog = new Map(src.materials.map(m => [m.Material_ID, m]));
    const qty = new Map(products.map(p => [p.Product_ID, p.Quantity || 1]));
    const materials: GateMaterialInput[] = products.flatMap(p => (p.materials || []).map(m => ({ ...m, catalog: catalog.get(m.Material_ID) })));
    return buildGates({
        graph: wo.Process_Graph,
        items: items.map(i => ({ ID: i.ID, Product_ID: i.Product_ID, Product_Name: i.Product_Name, Product_Quantity: qty.get(i.Product_ID), Status: i.Status, Processes: i.Processes })),
        materials, stock: src.stock, orders: refs,
    });
}

export interface SoonRow { workOrder: WorkOrder; gate: Gate; rows: GateRow[] }

/** Nalozi u toku: kapije koje su u toku ili ≤ `lookahead` koraka, a nešto (osim zalihe) nije tu. */
export function upcomingNeeds(workOrders: WorkOrder[], src: GateSources, lookahead = 2): SoonRow[] {
    const refs = orderRefsOf(src.orders);
    const out: SoonRow[] = [];
    for (const wo of workOrders.filter(w => w.Status === 'U toku')) {
        for (const gate of workOrderGatesFrom(wo, src, refs)) {
            if (gate.status === 'done') continue;
            if (gate.status !== 'active' && (gate.distance == null || gate.distance > lookahead)) continue;
            const rows = gate.rows.filter(r => !r.stock && !rowIsReady(r));
            if (rows.length) out.push({ workOrder: wo, gate, rows });
        }
    }
    return out.sort((a, b) => (a.gate.status === 'active' ? -1 : a.gate.distance ?? 9) - (b.gate.status === 'active' ? -1 : b.gate.distance ?? 9));
}
