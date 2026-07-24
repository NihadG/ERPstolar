import { orderItemPricing } from '../orderPricing';
import type { Order, OrderItem } from '../types';

function item(opts: Partial<OrderItem> & { Quantity: number; Expected_Price: number }): OrderItem {
    return {
        ID: 'oi-' + Math.random().toString(36).slice(2), Order_ID: 'O1', Material_Name: 'Kamen ploča',
        Unit: 'm²', Status: 'Naručeno', ...opts,
    } as OrderItem;
}

function order(items: OrderItem[], totalAmount: number): Order {
    return { Order_ID: 'O1', Total_Amount: totalAmount, items } as Order;
}

describe('orderItemPricing — prikaz ukupne cijene stavke (qty × jedinična)', () => {
    // Legacy auto-narudžba: Expected_Price je spremljen kao gola JEDINIČNA cijena (740/m²),
    // a Total_Amount = Σ qty×jedinična (ispravan). Prikaz mora dati ukupnu = qty × 740.
    test('legacy (Expected_Price = jedinična) → lineTotal = qty × Expected_Price', () => {
        const items = [
            item({ Quantity: 0.43, Expected_Price: 740 }),
            item({ Quantity: 1.35, Expected_Price: 740 }),
            item({ Quantity: 0.85, Expected_Price: 740 }),
        ];
        const p = orderItemPricing(order(items, 1946.2));
        expect(p.unitPriced).toBe(true);
        expect(p.lineTotal(items[1])).toBeCloseTo(999, 1);   // 740 × 1.35
        expect(p.unitPrice(items[1])).toBeCloseTo(740, 1);
        // Zbir prikazanih ukupnih = spremljeni Total_Amount (konzistentno sa zaglavljem).
        expect(items.reduce((s, i) => s + p.lineTotal(i), 0)).toBeCloseTo(1946.2, 1);
    });

    // Nova narudžba: Expected_Price je već UKUPNA cijena stavke. Bitno: količine < 1 (m²)
    // NE smiju natjerati detekciju da red proglasi „jediničnim".
    test('ispravna narudžba s količinama < 1 → NE detektuje kao jediničnu', () => {
        const items = [
            item({ Quantity: 0.43, Expected_Price: 318.2 }),
            item({ Quantity: 1.35, Expected_Price: 999 }),
            item({ Quantity: 0.85, Expected_Price: 629 }),
        ];
        const p = orderItemPricing(order(items, 1946.2));
        expect(p.unitPriced).toBe(false);
        expect(p.lineTotal(items[1])).toBeCloseTo(999, 1);
        expect(p.unitPrice(items[1])).toBeCloseTo(740, 1);   // 999 / 1.35
    });

    test('sve količine = 1 → jedinična = ukupna, bez lažne detekcije', () => {
        const items = [item({ Quantity: 1, Expected_Price: 120 }), item({ Quantity: 1, Expected_Price: 80 })];
        const p = orderItemPricing(order(items, 200));
        expect(p.unitPriced).toBe(false);
        expect(p.lineTotal(items[0])).toBe(120);
    });

    test('bez sidra (Total_Amount ≤ 0) → vjeruj invarijantu (Expected_Price = ukupno)', () => {
        const items = [item({ Quantity: 2, Expected_Price: 50 })];
        const p = orderItemPricing(order(items, 0));
        expect(p.unitPriced).toBe(false);
        expect(p.lineTotal(items[0])).toBe(50);
    });
});
