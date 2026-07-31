// ════════════════════════════════════════════════════════════════════
// JEDINSTVENA PROFIT FORMULA — čista logika (bez Firebase), jedini izvor istine.
//
//   profit = prihod − materijal − rad − usluge − transport − ostalo
//
// Do sada su ovu formulu nezavisno implementirali WorkOrderExpandedDetail (itemFin),
// lib/productivity.ts i lib/analytics.ts — svaka izmjena se morala ponoviti na 3
// mjesta i jednom je već puklo (usluge; materijal × količina). Svi potrošači sada
// zovu OVE funkcije; formula se mijenja samo ovdje.
//
// KONVENCIJE (invarijante baze, vidi lib/materialCost.ts):
//   • prihod (Product_Value / override) je UKUPAN iznos stavke
//   • materijal se ČUVA PO KOMADU → ovdje se množi količinom (itemMaterialTotal)
//   • rad = Σ WorkLog.Daily_Rate stavke (jedini izvor istine za trošak rada)
//   • Profit_Overrides: Selling_Price važi samo ako je > 0 (kao recalculateWorkOrder);
//     Transport_Share važi čim postoji (i 0 je legitiman override)
// ════════════════════════════════════════════════════════════════════

import { itemMaterialTotal } from './materialCost';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ProfitTotals {
    revenue: number;    // UKUPAN prihod stavke
    material: number;   // UKUPAN trošak materijala (već × količina)
    labor: number;
    services: number;
    transport: number;
    /** Ostali troškovi (razni nalozi). Opcion, default 0 — proizvodi ga nemaju. */
    other?: number;
}

export interface ProfitBreakdown extends ProfitTotals {
    /** Uvijek prisutan u izlazu (default 0), za razliku od opcionog ulaza. */
    other: number;
    profit: number;
    margin: number;             // % od prihoda (0 kad prihoda nema)
    missingPrice: boolean;      // prihod ≤ 0 → profit nepotpun (nema prihvaćene ponude?)
    missingMaterial: boolean;   // materijal ≤ 0 → profit nepotpun (materijali bez cijene?)
}

/** Jezgro formule nad UKUPNIM iznosima. Sve komponente se zaokružuju na cent. */
export function profitFromTotals(t: ProfitTotals): ProfitBreakdown {
    const revenue = r2(t.revenue || 0);
    const material = r2(t.material || 0);
    const labor = r2(t.labor || 0);
    const services = r2(t.services || 0);
    const transport = r2(t.transport || 0);
    const other = r2(t.other || 0);
    const profit = r2(revenue - material - labor - services - transport - other);
    return {
        revenue, material, labor, services, transport, other, profit,
        margin: revenue > 0 ? r2((profit / revenue) * 100) : 0,
        missingPrice: revenue <= 0,
        missingMaterial: material <= 0,
    };
}

/** Ulaz u obliku WorkOrderItem polja — overrides i materijal × količina se rješavaju ovdje. */
export interface ItemProfitInput {
    productValue?: number;              // Product_Value (UKUPAN)
    sellingOverride?: number | null;    // Profit_Overrides.Selling_Price (važi ako > 0)
    materialPerUnit?: number;           // Material_Cost (PO KOMADU)
    quantity?: number;                  // default 1
    laborTotal?: number;                // Σ Daily_Rate logova stavke
    servicesTotal?: number;             // Services_Total
    transportShare?: number;            // Transport_Share
    transportOverride?: number | null;  // Profit_Overrides.Transport_Share (važi čim != null)
    otherCosts?: number;                // Other_Costs (razni nalozi) — UKUPAN iznos, ne po komadu
}

export function itemProfitBreakdown(i: ItemProfitInput): ProfitBreakdown {
    const revenue = i.sellingOverride != null && i.sellingOverride > 0
        ? i.sellingOverride
        : (i.productValue || 0);
    const transport = i.transportOverride != null
        ? i.transportOverride
        : (i.transportShare || 0);
    return profitFromTotals({
        revenue,
        material: itemMaterialTotal(i.materialPerUnit, i.quantity),
        labor: i.laborTotal || 0,
        services: i.servicesTotal || 0,
        transport,
        other: i.otherCosts || 0,
    });
}

/**
 * Agregat naloga = Σ komponenti stavki (invarijanta: Σ profit stavki == profit naloga,
 * do centa — komponente su već zaokružene per-stavka). Missing flagovi se OR-uju.
 */
export function sumBreakdowns(items: ProfitBreakdown[]): ProfitBreakdown {
    const acc: ProfitTotals = { revenue: 0, material: 0, labor: 0, services: 0, transport: 0, other: 0 };
    let missingPrice = false;
    let missingMaterial = false;
    for (const b of items) {
        acc.revenue += b.revenue;
        acc.material += b.material;
        acc.labor += b.labor;
        acc.services += b.services;
        acc.transport += b.transport;
        acc.other! += b.other || 0;
        if (b.missingPrice) missingPrice = true;
        if (b.missingMaterial) missingMaterial = true;
    }
    const total = profitFromTotals(acc);
    return { ...total, missingPrice, missingMaterial };
}
