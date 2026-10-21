// Kontekst za diktat iz podataka aplikacije — isti za desktop i mobilni.

import type { Project, Worker, Order } from '@/lib/types';
import type { VoiceContext } from './extract';

const CLOSED = /zavr|otkaz|arhiv|cancel|complete|closed/i;

export function buildVoiceContext(projects: Project[], workers: Worker[], orders: Order[] = []): VoiceContext {
    // Aktivni i noviji projekti prvi: prompt transkripcije je ograničen, pa
    // imena s početka liste najviše pomažu prepoznavanju.
    const sorted = [...projects].sort((a, b) => {
        const ca = CLOSED.test(a.Status || '') ? 1 : 0;
        const cb = CLOSED.test(b.Status || '') ? 1 : 0;
        if (ca !== cb) return ca - cb;
        return String(b.Created_Date || '').localeCompare(String(a.Created_Date || ''));
    });
    return {
        projects: sorted
            .filter(p => p.Project_ID && (p.Client_Name || p.Name))
            .map(p => ({
                id: p.Project_ID,
                client: p.Client_Name || p.Name || '',
                name: p.Name && p.Name !== p.Client_Name ? p.Name : undefined,
                address: p.Address || undefined,
            })),
        workers: workers
            .filter(w => w.Worker_ID && w.Name && !/obrisan|neaktiv|inactive/i.test(w.Status || ''))
            .map(w => ({ id: w.Worker_ID, name: w.Name })),
        suppliers: Array.from(new Set(orders.map(o => o.Supplier_Name).filter(Boolean))),
    };
}
