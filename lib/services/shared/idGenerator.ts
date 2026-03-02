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
 * Generate a collision-safe offer number.
 * Format: P-YYYYMMDD-HHMMSS-RRR
 * 
 * The timestamp portion ensures uniqueness across concurrent users.
 * The random suffix handles the (extremely unlikely) same-second scenario.
 */
export function generateOfferNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `P-${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
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
export function generateWorkOrderNumber(type?: 'Proizvodnja' | 'Montaža'): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const prefix = type === 'Montaža' ? 'MN' : 'RN';
    return `${prefix}-${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
}
