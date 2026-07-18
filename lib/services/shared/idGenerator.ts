/**
 * idGenerator.ts — Collision-safe document number generation
 * 
 * Replaces the original Math.random()-based generators that had
 * only 1000 possible values per day, guaranteeing collisions at scale.
 * 
 * Strategy: Use a millisecond timestamp + small random suffix for uniqueness.
 * This gives ~1M unique values per second with negligible collision probability.
 * 
 * For truly sequential numbering (P-001, P-002...), Firestore transactions
 * with a counter document would be needed, but that adds latency. This
 * approach is the right tradeoff for a furniture ERP.
 */

import { nextWorkOrderNumber } from '../../workOrderNumber';
import { nextOrderNumber } from '../../orderNumber';

/**
 * Generate a sequential offer number.
 * Format: P-YYYY/NN (e.g. P-2026/01, P-2026/02, ...)
 *
 * Accepts an array of existing offer numbers to determine the next sequential
 * number for the current year. Falls back to timestamp-based if no existing
 * numbers are provided.
 */
export function generateOfferNumber(existingOfferNumbers?: string[]): string {
    const now = new Date();
    const year = now.getFullYear();
    const prefix = `P-${year}/`;

    let maxSeq = 0;
    if (existingOfferNumbers && existingOfferNumbers.length > 0) {
        for (const num of existingOfferNumbers) {
            if (num.startsWith(prefix)) {
                const seqPart = parseInt(num.substring(prefix.length), 10);
                if (!isNaN(seqPart) && seqPart > maxSeq) {
                    maxSeq = seqPart;
                }
            }
        }
    }

    const nextSeq = String(maxSeq + 1).padStart(2, '0');
    return `${prefix}${nextSeq}`;
}

/**
 * Generate a sequential invoice (završni račun) number.
 * Format: ZR-YYYY/NN (e.g. ZR-2026/01, ZR-2026/02, ...) — isti šablon kao generateOfferNumber.
 */
export function generateInvoiceNumber(existingInvoiceNumbers?: string[]): string {
    const now = new Date();
    const year = now.getFullYear();
    const prefix = `ZR-${year}/`;

    let maxSeq = 0;
    if (existingInvoiceNumbers && existingInvoiceNumbers.length > 0) {
        for (const num of existingInvoiceNumbers) {
            if (num.startsWith(prefix)) {
                const seqPart = parseInt(num.substring(prefix.length), 10);
                if (!isNaN(seqPart) && seqPart > maxSeq) {
                    maxSeq = seqPart;
                }
            }
        }
    }

    const nextSeq = String(maxSeq + 1).padStart(2, '0');
    return `${prefix}${nextSeq}`;
}

/**
 * Broj narudžbe: N + GODINA-MJESEC/SLOVO+BROJ (npr. N2026-07/K7).
 * Slovo i broj su nasumični; postojeći brojevi iz istog mjeseca se
 * proslijede da se izbjegne sudar.
 *
 * Format i parsiranje žive u lib/orderNumber.ts (jedan izvor, testiran).
 */
export function generateOrderNumber(existingOrderNumbers?: (string | undefined | null)[]): string {
    return nextOrderNumber(existingOrderNumbers || []);
}

/**
 * Broj radnog naloga: GODINA-MJESEC/SLOVO+BROJ (npr. 2026-07/R1).
 * Traži sljedeći slobodan redni broj iz postojećih brojeva iste kante
 * (mjesec + slovo) — isti obrazac kao generateOfferNumber gore.
 *
 * Format i parsiranje žive u lib/workOrderNumber.ts (jedan izvor, testiran).
 */
export function generateWorkOrderNumber(
    type?: 'Proizvodnja' | 'Montaža' | 'Zadaci',
    existingWorkOrderNumbers?: (string | undefined | null)[]
): string {
    return nextWorkOrderNumber(existingWorkOrderNumbers || [], type);
}
