// ════════════════════════════════════════════════════════════════════
// ZASTARJELOST CIJENA PONUDE
// Ponuda čuva SNAPSHOT cijene materijala po proizvodu (OfferProduct.Material_Cost).
// Kad se u međuvremenu promijeni cijena materijala u Resursima ILI se proizvodu
// doda/ukloni materijal (oboje mijenja Product.Material_Cost), snapshot ponude
// više ne odgovara trenutnom stanju → ponuda je "zastarjela".
//
// Poređenje je namjerno na nivou Product.Material_Cost (ukupno po proizvodu), pa
// isti mehanizam pokriva i promjenu cijene postojećeg materijala i dodavanje novog.
// ════════════════════════════════════════════════════════════════════

import type { Offer, Product } from './types';

const toCents = (n: number | undefined): number => Math.round((n || 0) * 100) / 100;

export interface OfferPriceChange {
    productId: string;
    name: string;
    snapshot: number;   // cijena materijala zabilježena u ponudi
    current: number;    // trenutna cijena materijala proizvoda
    delta: number;      // current - snapshot (pozitivno = poskupljenje)
}

/**
 * Vrati listu proizvoda u ponudi čija se cijena materijala razlikuje od trenutne
 * cijene proizvoda. Prazna lista = ponuda je usklađena.
 * Gledaju se SAMO uključeni proizvodi (Included !== false) koji još postoje u projektu.
 */
export function offerPriceChanges(offer: Offer, products: Product[]): OfferPriceChange[] {
    const byId = new Map(products.map(p => [p.Product_ID, p]));
    const out: OfferPriceChange[] = [];
    for (const op of offer.products || []) {
        if (op.Included === false) continue;
        const prod = byId.get(op.Product_ID);
        if (!prod) continue; // proizvod obrisan iz projekta — ne tretiramo kao promjenu cijene
        const snapshot = toCents(op.Material_Cost);
        const current = toCents(prod.Material_Cost);
        if (snapshot !== current) {
            out.push({ productId: op.Product_ID, name: op.Product_Name, snapshot, current, delta: toCents(current - snapshot) });
        }
    }
    return out;
}

/** Da li se cijena materijala bilo kojeg uključenog proizvoda u ponudi promijenila. */
export function isOfferStale(offer: Offer, products: Product[]): boolean {
    return offerPriceChanges(offer, products).length > 0;
}

/** Sve proizvode iz liste projekata u jednu ravnu mapu (za lakše poređenje). */
export function flattenProjectProducts(projects: { products?: Product[] }[]): Product[] {
    const out: Product[] = [];
    for (const pr of projects) {
        for (const p of pr.products || []) out.push(p);
    }
    return out;
}
