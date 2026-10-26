'use client';

// Pravila zalihe firme (org_settings.materialStock) — šta se kupuje na veliko.
// Čita se jednom po firmi; spremanje osvježi sve komponente koje ih koriste.

import { useCallback, useEffect, useState } from 'react';
import { getOrgSettings, saveOrgSettings } from '@/lib/services';
import { DEFAULT_STOCK_RULES, type StockRules } from '@/lib/materialGates';

const cache = new Map<string, StockRules>();
const listeners = new Set<() => void>();

export function useStockRules(organizationId: string | null | undefined) {
    const [rules, setRules] = useState<StockRules>(() => (organizationId && cache.get(organizationId)) || DEFAULT_STOCK_RULES);

    useEffect(() => {
        if (!organizationId) return;
        let alive = true;
        const sync = () => { const r = cache.get(organizationId); if (r && alive) setRules(r); };
        listeners.add(sync);
        if (!cache.has(organizationId)) {
            getOrgSettings(organizationId)
                .then(s => { cache.set(organizationId, s?.materialStock || DEFAULT_STOCK_RULES); listeners.forEach(l => l()); })
                .catch(() => undefined);
        } else sync();
        return () => { alive = false; listeners.delete(sync); };
    }, [organizationId]);

    const save = useCallback(async (next: StockRules) => {
        if (!organizationId) return false;
        const res = await saveOrgSettings(organizationId, { materialStock: next });
        if (res.success) {
            cache.set(organizationId, next);
            listeners.forEach(l => l());
        }
        return res.success;
    }, [organizationId]);

    return { rules, save };
}
