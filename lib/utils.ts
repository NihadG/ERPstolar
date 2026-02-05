// ============================================
// UTILITY FUNCTIONS
// Centralizovane pomoćne funkcije za cijelu aplikaciju
// ============================================

/**
 * Formatira broj kao valutu (KM)
 * @param amount - Iznos za formatiranje
 * @param showCurrency - Da li prikazati valutu (default: true)
 * @returns Formatirani string (npr. "1.234,56 KM")
 */
export function formatCurrency(amount: number | undefined | null, showCurrency: boolean = true): string {
    if (amount === undefined || amount === null || isNaN(amount)) {
        return showCurrency ? '0,00 KM' : '0,00';
    }
    const formatted = amount.toLocaleString('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return showCurrency ? `${formatted} KM` : formatted;
}

/**
 * Formatira datum u lokalni format (dd.mm.yyyy)
 * @param dateString - ISO datum string
 * @returns Formatirani datum string
 */
export function formatDate(dateString: string | undefined | null): string {
    if (!dateString) return '-';
    try {
        return new Date(dateString).toLocaleDateString('bs-BA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    } catch {
        return dateString;
    }
}

/**
 * Formatira datum sa vremenom
 * @param dateString - ISO datum string
 * @returns Formatirani datum i vrijeme
 */
export function formatDateTime(dateString: string | undefined | null): string {
    if (!dateString) return '-';
    try {
        return new Date(dateString).toLocaleString('bs-BA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return dateString;
    }
}

/**
 * Vraća relativno vrijeme (npr. "prije 2 sata")
 * @param dateString - ISO datum string
 * @returns Relativno vrijeme
 */
export function formatRelativeTime(dateString: string | undefined | null): string {
    if (!dateString) return '-';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'upravo sada';
    if (diffMins < 60) return `prije ${diffMins} min`;
    if (diffHours < 24) return `prije ${diffHours}h`;
    if (diffDays < 7) return `prije ${diffDays} dana`;

    return formatDate(dateString);
}

/**
 * Vraća CSS klasu za status
 * @param status - Status string
 * @returns CSS klasa za status
 */
export function getStatusClass(status: string): string {
    const statusMap: Record<string, string> = {
        // Project statuses
        'Nacrt': 'status-draft',
        'Ponuđeno': 'status-offered',
        'Odobreno': 'status-approved',
        'U proizvodnji': 'status-in-progress',
        'Završeno': 'status-completed',
        'Otkazano': 'status-cancelled',

        // Offer statuses
        'Draft': 'status-draft',
        'Poslano': 'status-pending',
        'Prihvaćeno': 'status-approved',
        'Odbijeno': 'status-cancelled',

        // Order statuses
        'Na čekanju': 'status-pending',
        'Naručeno': 'status-ordered',
        'Primljeno': 'status-received',
        'Djelomično': 'status-partial',

        // Work order statuses
        'U toku': 'status-in-progress',

        // Material statuses
        'Potrebno': 'status-needed',
        'Na stanju': 'status-in-stock',
    };

    return statusMap[status] || 'status-default';
}

/**
 * Vraća boju za status (hex)
 * @param status - Status string
 * @returns Hex boja
 */
export function getStatusColor(status: string): string {
    const colorMap: Record<string, string> = {
        'Nacrt': '#86868b',
        'Ponuđeno': '#0071e3',
        'Odobreno': '#34c759',
        'U proizvodnji': '#ff9500',
        'Završeno': '#30d158',
        'Otkazano': '#ff3b30',
        'Na čekanju': '#86868b',
        'U toku': '#0071e3',
        'Potrebno': '#ff9500',
        'Naručeno': '#5856d6',
        'Primljeno': '#34c759',
    };

    return colorMap[status] || '#86868b';
}

/**
 * Generira random UUID
 * @returns UUID string
 */
export function generateId(): string {
    return crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
}

/**
 * Debounce funkcija
 * @param fn - Funkcija za debounce
 * @param delay - Delay u ms
 * @returns Debounced funkcija
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Throttle funkcija
 * @param fn - Funkcija za throttle
 * @param limit - Limit u ms
 * @returns Throttled funkcija
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Grupira array po ključu
 * @param array - Array za grupiranje
 * @param key - Ključ za grupiranje
 * @returns Grupirani objekt
 */
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((result, item) => {
        const groupKey = String(item[key] ?? 'Unknown');
        if (!result[groupKey]) {
            result[groupKey] = [];
        }
        result[groupKey].push(item);
        return result;
    }, {} as Record<string, T[]>);
}

/**
 * Sortira array po ključu
 * @param array - Array za sortiranje
 * @param key - Ključ za sortiranje
 * @param direction - Smjer sortiranja
 * @returns Sortirani array
 */
export function sortBy<T>(
    array: T[],
    key: keyof T,
    direction: 'asc' | 'desc' = 'asc'
): T[] {
    return [...array].sort((a, b) => {
        const aVal = a[key];
        const bVal = b[key];

        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const comparison = aVal < bVal ? -1 : 1;
        return direction === 'asc' ? comparison : -comparison;
    });
}

/**
 * Izračunava postotak
 * @param value - Vrijednost
 * @param total - Ukupno
 * @returns Postotak kao string
 */
export function calcPercentage(value: number, total: number): string {
    if (total === 0) return '0%';
    return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * Capitalizira prvi karakter
 * @param str - String
 * @returns Kapitalizirani string
 */
export function capitalize(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Skraćuje tekst sa "..."
 * @param str - String
 * @param maxLength - Max dužina
 * @returns Skraćeni string
 */
export function truncate(str: string, maxLength: number): string {
    if (!str || str.length <= maxLength) return str || '';
    return str.slice(0, maxLength - 3) + '...';
}

/**
 * Provjerava da li je objekt prazan
 * @param obj - Objekt
 * @returns Boolean
 */
export function isEmpty(obj: object | null | undefined): boolean {
    if (!obj) return true;
    return Object.keys(obj).length === 0;
}

/**
 * Deep clone objekta
 * @param obj - Objekt za kloniranje
 * @returns Klonirani objekt
 */
export function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Čeka određeno vrijeme (async)
 * @param ms - Milisekunde
 * @returns Promise
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validira email format
 * @param email - Email string
 * @returns Boolean
 */
export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validira telefonski broj (bosanski format)
 * @param phone - Telefonski broj
 * @returns Boolean
 */
export function isValidPhone(phone: string): boolean {
    const phoneRegex = /^(\+387|0)?[0-9]{8,9}$/;
    return phoneRegex.test(phone.replace(/[\s-]/g, ''));
}

// ============================================
// CSS VARIABLE HELPERS
// ============================================

/**
 * Status boje za inline stilove
 */
export const STATUS_COLORS = {
    draft: { bg: '#f5f5f7', text: '#86868b', border: '#d2d2d7' },
    pending: { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' },
    inProgress: { bg: '#e3f2fd', text: '#1565c0', border: '#90caf9' },
    completed: { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' },
    cancelled: { bg: '#ffebee', text: '#c62828', border: '#ef9a9a' },
    approved: { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' },
    ordered: { bg: '#ede7f6', text: '#4527a0', border: '#b39ddb' },
    received: { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' },
} as const;

export type StatusColorKey = keyof typeof STATUS_COLORS;
