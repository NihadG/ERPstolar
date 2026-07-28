'use client';

// ════════════════════════════════════════════════════════════════════
// UČITAVANJE POGONSKE POČETNE
//
// Namjerno NE koristi DataContext: on povlači kolekcije cijele firme, a
// pogonske uloge na njih nemaju ni pravo (firestore.rules) ni potrebu.
// Jedan zahtjev → jedan uzak payload bez ijednog iznosa.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/apiClient';
import type { FieldHomePayload } from './fieldHome';

interface State {
    data: FieldHomePayload | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

export function useFieldHome(previewUid?: string | null): State {
    const [data, setData] = useState<FieldHomePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    const reload = useCallback(() => setNonce(n => n + 1), []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const path = previewUid ? `/api/field/home?preview=${encodeURIComponent(previewUid)}` : '/api/field/home';

        apiGet<FieldHomePayload>(path)
            .then(payload => { if (!cancelled) setData(payload); })
            .catch((e: any) => { if (!cancelled) setError(e?.message || 'Učitavanje nije uspjelo.'); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [previewUid, nonce]);

    return { data, loading, error, reload };
}
