// ════════════════════════════════════════════════════════════════════
// OSNOVICA PROFITA — delta-model za gejtovane izmjene materijala (čista logika).
//
// PROBLEM: danas svaka promjena cijene/količine materijala TIHO prepiše
// `WorkOrderItem.Material_Cost` (osnovicu) na svim aktivnim nalozima, pa profit
// prihvaćenih/proizvodnih projekata neprimjetno „pluta".
//
// MODEL: osnovica materijala stavke je ZAMRZNUTA (snapshot). Mijenja se samo:
//   • prijemom materijala / završetkom stavke (postojeći freeze), ILI
//   • ODOBRENOM deltom kroz pregled „utiče li ovo na profit?".
//
// KLJUČNO za „odbijeno ostaje odbijeno": primjenjuje se delta BAŠ TE izmjene
// (`perUnitDelta`), a NIKAD „živo − osnovica". Zato ranije odbijena promjena ne
// može ući ni kad se kasnija odobri — svaka izmjena nosi samo svoj efekat.
//
// Ova datoteka je ČISTA (bez Firebase): interceptor izračuna `perUnitDelta` po
// stavci i preda ovamo; ovdje se filtrira (gateable) i grupiše po projektu.
// ════════════════════════════════════════════════════════════════════

import { isItemMaterialFrozen } from './materialCost';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Efekat JEDNE izmjene materijala na osnovicu jedne stavke naloga. */
export interface ItemMaterialChange {
    itemId: string;
    workOrderId: string;
    workOrderStatus?: string;
    isMontaza?: boolean;
    projectId: string;
    /** Prikazna oznaka projekta (klijent / naziv projekta). */
    projectName: string;
    productName?: string;
    quantity: number;
    /** Trenutna osnovica materijala PO KOMADU (`item.Material_Cost`). */
    basisPerUnit: number;
    /** Δ osnovice PO KOMADU koju donosi OVA izmjena (Δ Σ Total_Price materijala proizvoda). */
    perUnitDelta: number;
    // Polja za freeze provjeru (isItemMaterialFrozen):
    Status?: string;
    Completed_At?: string;
    Material_Cost_Source?: string;
}

/** Jedna stavka spremna za primjenu odobrene delte. */
export interface BasisReviewItem {
    itemId: string;
    workOrderId: string;
    /** Nova osnovica PO KOMADU nakon primjene = basisPerUnit + perUnitDelta. */
    newBasisPerUnit: number;
    /** Efekat na materijal (ukupno za stavku) = perUnitDelta × količina. */
    lineDelta: number;
}

/** Pregled po projektu — jedan red u dijalogu „utiče li ovo na profit?". */
export interface ProjectBasisReview {
    projectId: string;
    projectName: string;
    productNames: string[];
    /** Ukupna promjena troška materijala projekta (+ = skuplje). */
    materialDelta: number;
    /** Efekat na profit = −materialDelta (skuplji materijal → manji profit). */
    profitDelta: number;
    items: BasisReviewItem[];
}

/**
 * Da li izmjena uopšte ide u pregled: montaža (nema materijal), otkazan nalog i
 * zamrznuta stavka (završeno / ručna cijena) se NIKAD ne nude — njihov trošak je
 * stvaran/zaključan. Primljeni materijali se izostavljaju ranije (interceptor ih
 * preskoči), pa ovdje ne ulaze u `perUnitDelta`.
 */
export function isChangeGateable(c: ItemMaterialChange): boolean {
    if (c.isMontaza) return false;
    if (c.workOrderStatus === 'Otkazano') return false;
    if (isItemMaterialFrozen(c)) return false;
    return true;
}

/**
 * Grupiši gateable izmjene po projektu s Δ (materijal i profit) i listom stavki
 * za primjenu. Izmjene bez efekta (perUnitDelta = 0) se izostavljaju.
 */
export function groupBasisReviewByProject(changes: ItemMaterialChange[]): ProjectBasisReview[] {
    const byProject = new Map<string, ProjectBasisReview>();

    for (const c of changes) {
        if (!isChangeGateable(c)) continue;
        if (!c.perUnitDelta) continue;

        const key = c.projectId || c.projectName || '—';
        let row = byProject.get(key);
        if (!row) {
            row = { projectId: c.projectId, projectName: c.projectName, productNames: [], materialDelta: 0, profitDelta: 0, items: [] };
            byProject.set(key, row);
        }

        const qty = c.quantity && c.quantity > 0 ? c.quantity : 1;
        const lineDelta = r2(c.perUnitDelta * qty);
        row.items.push({
            itemId: c.itemId,
            workOrderId: c.workOrderId,
            newBasisPerUnit: r2(c.basisPerUnit + c.perUnitDelta),
            lineDelta,
        });
        row.materialDelta = r2(row.materialDelta + lineDelta);
        if (c.productName && !row.productNames.includes(c.productName)) row.productNames.push(c.productName);
    }

    const rows = Array.from(byProject.values()).filter(r => r.items.length > 0);
    for (const row of rows) row.profitDelta = r2(-row.materialDelta);
    return rows;
}

/** Stavka za pregled ZAOSTAJANJA osnovice (badge „profit zastario"): živi trošak vs osnovica. */
export interface ItemDriftInput {
    itemId: string;
    workOrderId: string;
    workOrderStatus?: string;
    isMontaza?: boolean;
    projectId: string;
    projectName: string;
    productName?: string;
    quantity: number;
    /** Osnovica materijala PO KOMADU (item.Material_Cost). */
    basisPerUnit: number;
    /** Trenutni ŽIVI trošak PO KOMADU (product.Material_Cost). */
    livePerUnit: number;
    Status?: string;
    Completed_At?: string;
    Material_Cost_Source?: string;
}

/**
 * Pregled ZAOSTAJANJA osnovice za trenutnim (živim) troškom — za badge „profit zastario".
 * perUnitDelta = živo − osnovica; primjena ga sinhronizuje (osnovica → živo). Za razliku od
 * per-izmjene gejta, ovo je EKSPLICITNA „sinhronizuj na trenutno" akcija (hvata i ne-gejtovane
 * puteve: staklo/alu, ranije isključene izmjene). Filtrira montaža/otkazano/zamrznuto.
 */
export function basisDriftReview(items: ItemDriftInput[]): ProjectBasisReview[] {
    return groupBasisReviewByProject(items.map(it => ({
        itemId: it.itemId,
        workOrderId: it.workOrderId,
        workOrderStatus: it.workOrderStatus,
        isMontaza: it.isMontaza,
        projectId: it.projectId,
        projectName: it.projectName,
        productName: it.productName,
        quantity: it.quantity,
        basisPerUnit: it.basisPerUnit,
        perUnitDelta: r2(it.livePerUnit - it.basisPerUnit),
        Status: it.Status,
        Completed_At: it.Completed_At,
        Material_Cost_Source: it.Material_Cost_Source,
    })));
}

/** Zbir svih Work_Order_ID-eva iz pregleda (za ciljani recalc nakon primjene). */
export function affectedWorkOrderIds(reviews: ProjectBasisReview[]): string[] {
    const s = new Set<string>();
    for (const r of reviews) for (const it of r.items) s.add(it.workOrderId);
    return Array.from(s);
}
