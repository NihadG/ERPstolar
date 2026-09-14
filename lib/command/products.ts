// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — REDOSLIJED I PRETRAŽIVI TEKST POZICIJA
//
// Poredak liste je operativni, ne abecedni:
//   1. ZAVRŠENO NA DNO — gotova pozicija ne traži više nijednu odluku
//   2. IMA LI MATERIJAL — pozicija bez ijednog materijala je nedovršena
//      priprema; ne može se ni naručiti ni raditi, pa ide iza
//   3. NAZIV — prirodno (T2 prije T10)
//
// Pretraživi tekst namjerno uključuje i materijale i dobavljače: „gdje mi je
// iveral" je stvarno pitanje koje se postavlja nad ovom listom.
// ════════════════════════════════════════════════════════════════════

import type { Product } from '../types';
import { PRODUCT_STATUSES } from '../types';
import { naturalCompare } from '../naturalCompare';
import type { CommandMaterialRow } from './materialOrder';

const STATUS_RANK = new Map(PRODUCT_STATUSES.map((status, i) => [status, i]));

/**
 * Od „Spremno" nadalje proizvodnja je gotova — takve pozicije više nisu posao
 * koji treba planirati, pa idu na dno liste bez obzira na sve ostalo.
 */
const DONE_FROM = PRODUCT_STATUSES.indexOf('Spremno');

/** Nepoznat status ide na kraj lanca, ali NE broji se kao završen. */
export function statusRank(status?: string): number {
    const rank = status ? STATUS_RANK.get(status) : undefined;
    return rank === undefined ? PRODUCT_STATUSES.length : rank;
}

export function isProductDone(status?: string): boolean {
    const rank = status ? STATUS_RANK.get(status) : undefined;
    return rank !== undefined && rank >= DONE_FROM;
}

export interface ProductOrderInput {
    product: Product;
    materialCount: number;
}

/**
 * Poredak liste je operativni:
 *   1. ZAVRŠENE pozicije na dno — one više ne traže odluku
 *   2. POZICIJA S MATERIJALOM ima prednost — bez materijala je nedovršena
 *      priprema i ne može se ni naručiti ni raditi
 *   3. ABECEDA (prirodna: T2 prije T10) — sve ostalo je jednako važno
 */
export function compareProducts(a: ProductOrderInput, b: ProductOrderInput): number {
    return Number(isProductDone(a.product.Status)) - Number(isProductDone(b.product.Status))
        || Number(b.materialCount > 0) - Number(a.materialCount > 0)
        || naturalCompare(a.product.Name || '', b.product.Name || '');
}

/** Poredaj pozicije jednog projekta, uz broj materijala po poziciji. */
export function sortProductsForBoard(products: Product[], materialsByProduct: Map<string, CommandMaterialRow[]>): Product[] {
    return [...products]
        .map(product => ({ product, materialCount: (materialsByProduct.get(product.Product_ID) || []).length }))
        .sort(compareProducts)
        .map(entry => entry.product);
}

/**
 * Sve po čemu se pozicija može naći: naziv, status, dimenzije, materijali,
 * dobavljači i naziv projekta. Projekat je uključen namjerno — „corluka obloga"
 * je uobičajen način da se traži jedna pozicija na jednom poslu.
 */
export function productSearchText(product: Product, rows: CommandMaterialRow[], projectName = ''): string {
    const dims = [product.Width, product.Height, product.Depth].filter(Boolean).join(' ');
    const materials = rows.map(r => `${r.Material_Name} ${r.Supplier || ''}`).join(' ');
    return `${product.Name || ''} ${product.Status || ''} ${dims} ${materials} ${projectName}`;
}
