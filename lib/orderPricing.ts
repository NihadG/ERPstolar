// ════════════════════════════════════════════════════════════════════
// PRIKAZNA CIJENA STAVKE NARUDŽBE (nedestruktivna normalizacija)
//
// Invarijant: OrderItem.Expected_Price je UKUPNA cijena stavke (qty × jedinična) —
// tako pišu OrdersTab wizard, createOrdersFromGroups (nakon fixa) i recalculateOrderTotal.
//
// Ali auto-narudžbe kreirane PRIJE tog fixa spremile su Expected_Price kao golu
// JEDINIČNU cijenu (npr. 740 KM/m² umjesto 740 × 1.35 = 999 KM). Te legacy narudžbe
// i dalje žive u bazi, pa bi red stavke prikazivao jediničnu umjesto ukupne cijene.
//
// Ova funkcija po narudžbi DETEKTUJE režim poredeći zbir stavki sa spremljenim
// Total_Amount (koji je uvijek Σ qty×jedinična, i za legacy i za nove): ako stavke
// izgledaju kao jedinične cijene (Σ qty×EP ≈ Total, a Σ EP ≠ Total), prikazna ukupna
// cijena stavke = qty × Expected_Price. Ne mijenja podatke — samo prikaz.
//
// Detekcija je bezbjedna i za količine < 1 (npr. m²): za ISPRAVNU narudžbu s qty<1
// je Σ(qty×EP) < Total, pa se NIKAD ne proglasi jediničnom (vidi test).
// ════════════════════════════════════════════════════════════════════

import type { Order, OrderItem } from './types';

type PricedItem = Pick<OrderItem, 'Quantity' | 'Expected_Price'>;

export interface OrderPricing {
    /** true = stavke su spremljene kao jedinične cijene (legacy narudžba). */
    unitPriced: boolean;
    /** Ukupna cijena stavke — za prikaz velikog iznosa u redu. */
    lineTotal: (item: PricedItem) => number;
    /** Jedinična cijena stavke — za prikaz „…/m²" / „…/kom". */
    unitPrice: (item: PricedItem) => number;
}

export function orderItemPricing(order: Pick<Order, 'Total_Amount' | 'items'>): OrderPricing {
    const items = order.items || [];
    const total = order.Total_Amount || 0;
    const sumExpected = items.reduce((s, i) => s + (i.Expected_Price || 0), 0);
    const sumLine = items.reduce((s, i) => s + (i.Quantity || 0) * (i.Expected_Price || 0), 0);

    // Bez pouzdanog sidra (Total_Amount ≤ 0) vjeruj invarijantu: Expected_Price = ukupno.
    const unitPriced = total > 0 && Math.abs(sumLine - total) < Math.abs(sumExpected - total);

    return {
        unitPriced,
        lineTotal: (item) =>
            unitPriced ? (item.Quantity || 0) * (item.Expected_Price || 0) : (item.Expected_Price || 0),
        unitPrice: (item) => {
            const q = item.Quantity || 0;
            if (unitPriced) return item.Expected_Price || 0;
            return q > 0 ? (item.Expected_Price || 0) / q : (item.Expected_Price || 0);
        },
    };
}
