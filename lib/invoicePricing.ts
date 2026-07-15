// ════════════════════════════════════════════════════════════════════
// ZAVRŠNI RAČUN — cjenovna logika (čista, bez Firebase)
//
// Rješava sukob: ponuda je prihvaćena po jednoj cijeni, ali dok se proizvod
// pripremao/proizvodio moglo je doći do izmjene materijala (dodano/oduzeto/
// poskupljenje). Umjesto da se to tiho uvuče u prihod (kao stari live-sync bug)
// ili ostane zauvijek zaključano, korisnik pri IZDAVANJU računa bira, PO
// PROIZVODU: cijenu iz ponude, svježe preračunatu cijenu, ili ručnu vrijednost.
// ════════════════════════════════════════════════════════════════════

import type { OfferProduct, Product } from './types';

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

export type InvoicePriceSource = 'offer' | 'recalculated' | 'manual';

export interface InvoiceLineDraft {
    productId: string;
    productName: string;
    quantity: number;
    offerUnitPrice: number;         // snapshot iz ponude (po komadu)
    recalculatedUnitPrice: number;  // trenutni materijal + ista marža/usluge/rad iz ponude (po komadu)
    finalUnitPrice: number;         // izabrana cijena (po komadu) — default = offerUnitPrice
    finalTotal: number;             // finalUnitPrice × quantity
    priceSource: InvoicePriceSource;
}

/**
 * Izgradi redove završnog računa iz UKLJUČENIH proizvoda prihvaćene ponude.
 * Rekalkulacija koristi ISTI recept kao OffersTab calculateProductTotal
 * (materijal + marža + usluge(extras) + rad), samo sa TRENUTNIM materijalom
 * proizvoda umjesto snapshot-a — i BEZ množenja količinom (cijena je po komadu).
 * Default izabrana cijena je ona iz ponude; korisnik je može promijeniti po redu.
 */
export function buildInvoiceLines(offerProducts: OfferProduct[], projectProducts: Product[]): InvoiceLineDraft[] {
    const productById = new Map(projectProducts.map(p => [p.Product_ID, p]));
    return (offerProducts || [])
        .filter(op => op.Included !== false)
        .map(op => {
            const product = productById.get(op.Product_ID);
            const currentMaterialCost = product
                ? (product.materials || []).reduce((s, m) => s + (m.Total_Price || 0), 0)
                : (op.Material_Cost || 0); // proizvod obrisan iz projekta — fallback na snapshot
            const extrasTotal = (op.extras || []).reduce((s, e) => s + (e.Total || 0), 0);
            const laborTotal = (op.Labor_Workers || 0) * (op.Labor_Days || 0) * (op.Labor_Daily_Rate || 0);
            const offerUnitPrice = round2(op.Selling_Price || 0);
            const recalculatedUnitPrice = round2(currentMaterialCost + (op.Margin || 0) + extrasTotal + laborTotal);
            const quantity = op.Quantity || 1;
            return {
                productId: op.Product_ID,
                productName: op.Product_Name,
                quantity,
                offerUnitPrice,
                recalculatedUnitPrice,
                finalUnitPrice: offerUnitPrice,
                finalTotal: round2(offerUnitPrice * quantity),
                priceSource: 'offer',
            };
        });
}

/**
 * Raspodijeli `total` (KM) na `parts` proporcionalno količini, cent-tačno —
 * ostatak (zaokruživanje) ide POSLJEDNJEM dijelu, tako da Σ amount == total
 * do centa (nikad drift). Dio sa qty<=0 tretira se kao 1 (isto kao itemMaterialTotal).
 */
export function distributeAmountByQuantity(
    total: number,
    parts: { id: string; qty: number }[]
): { id: string; amount: number }[] {
    if (parts.length === 0) return [];
    const totalQty = parts.reduce((s, p) => s + (p.qty > 0 ? p.qty : 1), 0);
    if (totalQty <= 0) return [];
    const cents = Math.round((total || 0) * 100);
    let allocated = 0;
    return parts.map((p, i) => {
        const qty = p.qty > 0 ? p.qty : 1;
        const share = i === parts.length - 1 ? (cents - allocated) : Math.round(cents * (qty / totalQty));
        allocated += share;
        return { id: p.id, amount: round2(share / 100) };
    });
}
