// ════════════════════════════════════════════════════════════════════
// POKRIVENOST MATERIJALA — koliko još treba naručiti
//
// Jedan izvor za čarobnjak narudžbi, Pregled projekta, Komandni centar,
// plan narudžbi iz naloga i Telegram asistenta.
//
// Računa se iz KOLIČINA, ne iz statusa: kad se naruči 5 od 25, materijal
// dobije status „Naručeno", ali preostalih 20 i dalje treba naručiti.
// Ranije je status sakrivao ostatak sa svih lista za naručivanje.
//
// Stari zapisi (prije praćenja količina) imaju status bez količina —
// „Naručeno" s Ordered_Quantity 0. Takav materijal se smatra pokrivenim,
// isto kao prije. „Na stanju" je uvijek pokriveno: to je ručna potvrda.
// ════════════════════════════════════════════════════════════════════

import type { ProductMaterial } from './types';

const round = (n: number) => Math.round((n || 0) * 1000) / 1000;

export type CoverageInput = Pick<ProductMaterial, 'Quantity' | 'Status' | 'On_Stock' | 'Ordered_Quantity' | 'Received_Quantity'>;

export interface MaterialCoverage {
    /** Ukupno potrebno = količina po komadu × količina proizvoda. */
    needed: number;
    onStock: number;
    ordered: number;
    received: number;
    /** Potrebno minus naručeno i primljeno (zaliha se ne oduzima — čarobnjak je unosi posebno). */
    open: number;
    /** Koliko još treba naručiti: potrebno − na stanju − naručeno − primljeno. */
    toOrder: number;
}

export function materialCoverage(m: CoverageInput, productQty = 1): MaterialCoverage {
    const needed = round((m.Quantity || 0) * (productQty > 0 ? productQty : 1));
    const onStock = m.On_Stock || 0;
    const ordered = m.Ordered_Quantity || 0;
    const received = m.Received_Quantity || 0;
    const legacyCovered = m.Status === 'Na stanju'
        || ((m.Status === 'Naručeno' || m.Status === 'Primljeno') && onStock + ordered + received === 0);
    if (legacyCovered) return { needed, onStock, ordered, received, open: 0, toOrder: 0 };
    return {
        needed, onStock, ordered, received,
        open: Math.max(0, round(needed - ordered - received)),
        toOrder: Math.max(0, round(needed - onStock - ordered - received)),
    };
}

export function isMaterialOrderable(m: CoverageInput, productQty = 1): boolean {
    return materialCoverage(m, productQty).toOrder > 0;
}

/**
 * Status materijala poslije promjene količina. Materijal može biti u više
 * narudžbi (5 + 20 od 25), pa prijem ili vraćanje JEDNE narudžbe ne smije
 * proglasiti cijeli materijal primljenim ni nenaručenim dok je druga još
 * otvorena.
 */
export function settledMaterialStatus(requested: string, ordered: number, received: number): string {
    if (requested === 'Primljeno' && ordered > 0) return 'Naručeno';
    if (requested === 'Nije naručeno') {
        if (ordered > 0) return 'Naručeno';
        if (received > 0) return 'Primljeno';
    }
    return requested;
}
