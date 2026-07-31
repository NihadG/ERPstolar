'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIKOVI PRIJEDLOZI — slanje i praćenje statusa
//
// Svaka radnikova radnja je PRIJEDLOG (POST /api/field/requests), ne direktna
// izmjena. Hook drži spisak radnikovih prijedloga (da UI zna šta „čeka potvrdu")
// i nudi `propose`. U pregledu („Pogledaj kao") je sve ugašeno — vlasnik gleda,
// ne šalje prijedloge u tuđe ime.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { ChangeRequest, ChangeRequestKind } from '@/lib/types';

export interface ProposeInput {
    kind: ChangeRequestKind;
    payload: unknown;
    workOrderId?: string;
    productId?: string;
}

export function useWorkerRequests(readOnly: boolean) {
    const [requests, setRequests] = useState<ChangeRequest[]>([]);
    const [loading, setLoading] = useState(!readOnly);

    const load = useCallback(async () => {
        if (readOnly) { setRequests([]); return; }
        setLoading(true);
        try {
            const res = await apiGet<{ requests: ChangeRequest[] }>('/api/field/requests');
            setRequests(res.requests);
        } catch {
            // Tiho — spisak prijedloga je pomoćni, ne smije srušiti ekran.
        } finally {
            setLoading(false);
        }
    }, [readOnly]);

    useEffect(() => { load(); }, [load]);

    /** Pošalji prijedlog. Vraća poruku za toast (ili baca grešku s porukom). */
    const propose = useCallback(async (input: ProposeInput): Promise<void> => {
        await apiPost('/api/field/requests', input);
        await load();
    }, [load]);

    const pending = requests.filter(r => r.Status === 'pending');

    return { requests, pending, loading, reload: load, propose };
}
