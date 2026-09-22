// ════════════════════════════════════════════════════════════════════
// POREDAK PROIZVODA U PROJEKTU (Projekti tab — desktop i telefon)
//
//   1. STATUS    u proizvodnji → u montaži → na čekanju → završeno
//   2. MATERIJAL proizvod s bar jednim dodanim materijalom ide ispred onog
//                bez ijednog (taj još nije ni razrađen, pa ne treba prvi)
//   3. NAZIV     abecedno, prirodno za brojeve (Poz 2 < Poz 10)
//
// Isti proizvod mora stajati na istom mjestu na laptopu i na telefonu, pa
// obje strane zovu ovu funkciju umjesto vlastitog sortiranja.
// ════════════════════════════════════════════════════════════════════

import type { Product, WorkOrder } from './types';
import { naturalCompare } from './naturalCompare';

/** Četiri stanja koja Projekti tab prikazuje umjesto sirovog Product.Status. */
export type ProductStage = 'U proizvodnji' | 'U montaži' | 'Na čekanju' | 'Završeno';

const WAITING = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni'];
const IN_MONTAZA = ['Transport', 'Montaža', 'Čišćenje', 'Primopredaja', 'U montaži'];
const DONE = ['Spremno', 'Instalirano', 'Završeno'];

/**
 * Status proizvoda za prikaz. Kad nalog krene, u Product.Status se upisuje
 * IME PROCESA (često iz prilagođenog kataloga), pa se ne može nabrojati
 * unaprijed: nepoznat string znači „u radu" SAMO ako ga potvrdi stavka
 * aktivnog naloga koja je 'U toku' — inače je proizvod na čekanju.
 */
export function productStage(product: Pick<Product, 'Product_ID' | 'Status'>, workOrders: WorkOrder[]): ProductStage {
    const status = product.Status || 'Na čekanju';
    if (WAITING.includes(status)) return 'Na čekanju';
    if (DONE.includes(status)) return 'Završeno';
    if (IN_MONTAZA.includes(status)) return 'U montaži';

    const runningIn = (wo: WorkOrder) => wo.Status !== 'Otkazano'
        && (wo.items || []).some(it => it.Product_ID === product.Product_ID && it.Status === 'U toku');
    if (!workOrders.some(runningIn)) return 'Na čekanju';
    if (workOrders.some(wo => wo.Work_Order_Type === 'Montaža' && runningIn(wo))) return 'U montaži';
    return 'U proizvodnji';
}

const STAGE_RANK: Record<ProductStage, number> = {
    'U proizvodnji': 0,
    'U montaži': 1,
    'Na čekanju': 2,
    'Završeno': 3,
};

type Sortable = Pick<Product, 'Product_ID' | 'Name' | 'Status' | 'materials'>;

/** Status → ima li materijal → naziv. `stageOf` daje prikazni status proizvoda. */
export function compareProjectProducts<T extends Sortable>(a: T, b: T, stageOf: (p: T) => ProductStage): number {
    const byStage = STAGE_RANK[stageOf(a)] - STAGE_RANK[stageOf(b)];
    if (byStage !== 0) return byStage;
    const hasA = (a.materials?.length || 0) > 0;
    const hasB = (b.materials?.length || 0) > 0;
    if (hasA !== hasB) return hasA ? -1 : 1;
    return naturalCompare(a.Name, b.Name);
}

/** Nova, sortirana kopija liste proizvoda projekta. */
export function sortProjectProducts<T extends Sortable>(products: T[] | undefined, workOrders: WorkOrder[]): T[] {
    const stages = new Map<string, ProductStage>();
    const stageOf = (p: T) => {
        let s = stages.get(p.Product_ID);
        if (!s) { s = productStage(p, workOrders); stages.set(p.Product_ID, s); }
        return s;
    };
    return [...(products || [])].sort((a, b) => compareProjectProducts(a, b, stageOf));
}
