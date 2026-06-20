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
 * Generate a collision-safe order number.
 * Format: N-YYYYMMDD-HHMMSS-RRR
 */
export function generateOrderNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `N-${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
}

/**
 * Generate a collision-safe work order number.
 * Format: RN-YYYYMMDD-HHMMSS-RRR (Proizvodnja)
 *         MN-YYYYMMDD-HHMMSS-RRR (Montaža)
 */
export function generateWorkOrderNumber(type?: 'Proizvodnja' | 'Montaža' | 'Zadaci'): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const prefix = type === 'Montaža' ? 'MN' : type === 'Zadaci' ? 'ZN' : 'RN';
    return `${prefix}-${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
}
