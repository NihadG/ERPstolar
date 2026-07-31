'use client';

// ════════════════════════════════════════════════════════════════════
// ODOBRAVANJE PRIJEDLOGA — desktop (vlasnik/staff)
//
// Dovlači prijedloge koje pozivalac smije odobriti i nudi radnje. Nenovčane i
// zatvaranja server primjenjuje sam (approve); materijalne vrste vlasnik
// primijeni na desktopu pa zatvori (resolve).
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { ChangeRequest } from '@/lib/types';

export function useApproverRequests(enabled: boolean) {
    const [requests, setRequests] = useState<ChangeRequest[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        if (!enabled) { setRequests([]); return; }
        setLoading(true);
        try {
            const res = await apiGet<{ requests: ChangeRequest[] }>('/api/requests?status=pending');
            setRequests(res.requests);
        } catch {
            // Tiho — brojač prijedloga ne smije rušiti zvono.
        } finally {
            setLoading(false);
        }
    }, [enabled]);

    useEffect(() => { load(); }, [load]);

    const approve = useCallback(async (id: string) => {
        await apiPost(`/api/requests/${id}`, { action: 'approve' });
        await load();
    }, [load]);

    const reject = useCallback(async (id: string, reason?: string) => {
        await apiPost(`/api/requests/${id}`, { action: 'reject', reason });
        await load();
    }, [load]);

    const resolve = useCallback(async (id: string, appliedPayload?: unknown) => {
        await apiPost(`/api/requests/${id}`, { action: 'resolve', appliedPayload });
        await load();
    }, [load]);

    return { requests, loading, reload: load, approve, reject, resolve };
}
