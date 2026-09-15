// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — REDOSLIJED I PRETRAŽIVI TEKST POZICIJA
//
// Poredak liste je operativni, ne abecedni:
//   1. U TOKU NA VRH — pozicija u nalogu koji se upravo radi je ono o čemu
//      se danas odlučuje; ranije je bila zakopana pri dnu liste
//   2. IMA MATERIJAL — pozicija bez ijednog materijala je nedovršena
//      priprema; ne može se ni naručiti ni raditi, pa ide iza
//   3. ZAVRŠENO NA DNO — gotova pozicija ne traži više nijednu odluku
//   4. NAZIV — prirodno (T2 prije T10), unutar svake od grupa
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
    /** Pozicija je u radnom nalogu sa statusom „U toku". */
    inProgress?: boolean;
}

/**
 * Grupa kojoj pozicija pripada. Poredak je grupa-pa-abeceda, a NE lanac
 * uslova — unutar jedne grupe ništa osim naziva ne smije mijenjati mjesta.
 * Da se materijal poredio i unutar „u toku" grupe, dvije aktivne pozicije
 * istog naloga bi se razdvojile samo zato što jednoj materijal nije unesen.
 */
function productTier(entry: ProductOrderInput): number {
    if (entry.inProgress) return 0;                        // radi se upravo sad
    if (isProductDone(entry.product.Status)) return 3;     // gotovo — ne traži odluku
    return entry.materialCount > 0 ? 1 : 2;                // ima li šta za naručiti
}

/**
 * Poredak liste je operativni:
 *   1. U TOKU na vrh — to je posao koji se upravo radi
 *   2. S MATERIJALOM (bar 1) — ima se šta naručiti i raditi
 *   3. BEZ MATERIJALA — nedovršena priprema
 *   4. ZAVRŠENO na dno — više ne traži odluku
 * Unutar svake grupe: abeceda, prirodna (T2 prije T10).
 */
export function compareProducts(a: ProductOrderInput, b: ProductOrderInput): number {
    return productTier(a) - productTier(b)
        || naturalCompare(a.product.Name || '', b.product.Name || '');
}

/**
 * Poredaj pozicije jednog projekta, uz broj materijala po poziciji.
 * `inProgressProducts` su ID-evi pozicija iz naloga koji su „U toku" — bez tog
 * skupa poredak ne zna šta je aktivno, jer status naloga ne stoji na poziciji.
 */
export function sortProductsForBoard(
    products: Product[],
    materialsByProduct: Map<string, CommandMaterialRow[]>,
    inProgressProducts?: Set<string>,
): Product[] {
    return [...products]
        .map(product => ({
            product,
            materialCount: (materialsByProduct.get(product.Product_ID) || []).length,
            inProgress: !!inProgressProducts?.has(product.Product_ID),
        }))
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
