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
export function workOrderDisplayName(wo: {
    Name?: string;
    Work_Order_Number?: string;
    items?: { Project_Name?: string }[];
}): string {
    const name = wo?.Name?.trim();
    if (name) return name;
    const proj = wo?.items?.find(i => i.Project_Name?.trim())?.Project_Name?.trim();
    if (proj) return proj;
    return wo?.Work_Order_Number ? `#${wo.Work_Order_Number}` : 'Nalog';
}

/**
 * Napredak naloga iz procesa: završeni / ukupni procesi po stavkama.
 * Stavka bez procesa se broji kao 1 "proces" (njen vlastiti status).
 * Vraća null kad nema ničega za brojanje.
 */
export function orderProcessProgress(items: {
    Status?: string;
    Processes?: { Status?: string }[];
}[]): { done: number; total: number; pct: number } | null {
    let done = 0, total = 0;
    for (const it of items || []) {
        const procs = it.Processes || [];
        if (procs.length > 0) {
            total += procs.length;
            done += procs.filter(p => p.Status === 'Završeno').length;
        } else {
            total += 1;
            if (it.Status === 'Završeno') done += 1;
        }
    }
    if (total === 0) return null;
    return { done, total, pct: Math.round((done / total) * 100) };
}

/**
 * Nalog je PAUZIRAN kad su sve otvorene (ne-završene/otkazane) stavke pauzirane —
 * wo.Status i dalje piše 'U toku' (status se ne mijenja pauzom), pa ovo precizira
 * prikaz i sortiranje. Dijele ga ProductionTab (sort) i WorkOrderCard (prikaz).
 */
export function isOrderPaused(wo: {
    Status?: string;
    items?: { Status?: string; Is_Paused?: boolean }[];
}): boolean {
    const openItems = (wo.items || []).filter(i => i.Status !== 'Završeno' && i.Status !== 'Otkazano');
    return wo.Status === 'U toku' && openItems.length > 0 && openItems.every(i => i.Is_Paused);
}

/** Boja/ikona/pozadina statusa naloga — jedan izvor za karticu, mobile view i sl. */
export function workOrderStatusDetails(status: string): { color: string; icon: string; bg: string } {
    switch (status) {
        case 'Završeno': return { color: '#10b981', icon: 'check_circle', bg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.2))' };
        case 'U toku': return { color: '#3b82f6', icon: 'trending_up', bg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.2))' };
        case 'Na čekanju': return { color: '#f59e0b', icon: 'schedule', bg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(245, 158, 11, 0.2))' };
        case 'Otkazano': return { color: '#ef4444', icon: 'cancel', bg: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.2))' };
        case 'Dodijeljeno': return { color: '#8b5cf6', icon: 'assignment_ind', bg: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.2))' };
        case 'Pauzirano': return { color: '#eab308', icon: 'pause_circle', bg: 'linear-gradient(135deg, rgba(234, 179, 8, 0.1), rgba(234, 179, 8, 0.2))' };
        default: return { color: '#9ca3af', icon: 'help_outline', bg: 'linear-gradient(135deg, rgba(156, 163, 175, 0.1), rgba(156, 163, 175, 0.2))' };
    }
}

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
 * Redoslijed prikaza projekata: prvo ono na čemu se STVARNO radi, pa potvrđeno,
 * pa ponuđeno, a nacrti i završeni/otkazani na kraju. Nije isto što i
 * PROJECT_STATUSES (to je redoslijed toka rada, koristi se za filter padajuću listu).
 */
export const PROJECT_STATUS_DISPLAY_ORDER = [
    'U proizvodnji',
    'Odobreno',
    'Ponuđeno',
    'Nacrt',
    'Završeno',
    'Otkazano',
];

/**
 * Rang statusa projekta za sortiranje. Nepoznat/prazan status ide na kraj
 * (a NE ispada iz prikaza) — statuse asinhrono upisuje syncProjectStatus,
 * pa se ne smije pretpostaviti da je vrijednost uvijek jedna od poznatih.
 */
export function projectStatusRank(status: string | null | undefined): number {
    const index = PROJECT_STATUS_DISPLAY_ORDER.indexOf(status || '');
    return index === -1 ? PROJECT_STATUS_DISPLAY_ORDER.length : index;
}

/**
 * Broj naloga koji se STVARNO rade po projektu — Status je 'U toku' KAO PODNI
 * status (floor) čak i kad su svi otvoreni items pauzirani, pa se mora
 * isključiti preko isOrderPaused (isti izvor kao "Pauzirano" bedž na kartici).
 * Nalog nema Project_ID — veza ide preko stavki, pa se po nalogu broje
 * RAZLIČITI projekti (nalog koji pokriva više projekata svakom doda 1, ne po stavci).
 */
export function countActiveWorkOrdersByProject(
    workOrders: { Status?: string; items?: { Project_ID?: string; Status?: string; Is_Paused?: boolean }[] }[]
): Map<string, number> {
    const counts = new Map<string, number>();
    workOrders.forEach(wo => {
        if (wo.Status !== 'U toku') return;
        if (isOrderPaused(wo)) return;
        const projectIds = new Set<string>();
        (wo.items || []).forEach(item => {
            if (item.Project_ID) projectIds.add(item.Project_ID);
        });
        projectIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    });
    return counts;
}

/**
 * Poredak projekata UNUTAR iste grupe statusa: prvo oni na kojima se stvarno
 * radi (više aktivnih naloga = više gore), pa abecedno po klijentu.
 */
export function compareProjectsByActivity(
    a: { Project_ID: string; Client_Name?: string },
    b: { Project_ID: string; Client_Name?: string },
    activeCounts: Map<string, number>
): number {
    const diff = (activeCounts.get(b.Project_ID) || 0) - (activeCounts.get(a.Project_ID) || 0);
    if (diff !== 0) return diff;
    return (a.Client_Name || '').localeCompare(b.Client_Name || '', 'hr');
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

/**
 * Bosanska množina uz broj: 1 → jednina, 2-4 → mala množina, ostalo → velika.
 * Izuzetak su 11-14, koji idu na veliku ("11 narudžbi", ne "11 narudžbe").
 *
 * plural(1, 'stavka', 'stavke', 'stavki') → 'stavka'
 * plural(3, 'stavka', 'stavke', 'stavki') → 'stavke'
 * plural(8, 'stavka', 'stavke', 'stavki') → 'stavki'
 */
export function plural(count: number, one: string, few: string, many: string): string {
    const n = Math.abs(Math.trunc(count)) % 100;
    if (n >= 11 && n <= 14) return many;
    const last = n % 10;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
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
