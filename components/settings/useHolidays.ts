'use client';

// Praznici radionice (org_settings.holidays, lib/holidays.ts). Čita se jednom po firmi;
// spremanje osvježi sve komponente koje ih koriste (Platno, rok naloga, Postavke).
// Dok vlasnik ne sačuva listu, važe zadani bh. praznici.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getOrgSettings, saveOrgSettings } from '@/lib/services';
import { effectiveHolidays, holidayDates, type Holiday } from '@/lib/holidays';
import { todayISO } from '@/lib/planning';

const cache = new Map<string, Holiday[] | null>();
const listeners = new Set<() => void>();

export function useHolidays(organizationId: string | null | undefined) {
    const [saved, setSaved] = useState<Holiday[] | null>(() => (organizationId && cache.get(organizationId)) || null);
    const [loaded, setLoaded] = useState(() => !!organizationId && cache.has(organizationId));

    useEffect(() => {
        if (!organizationId) return;
        let alive = true;
        const sync = () => { if (alive && cache.has(organizationId)) { setSaved(cache.get(organizationId) || null); setLoaded(true); } };
        listeners.add(sync);
        if (!cache.has(organizationId)) {
            // Greška pri čitanju → zadani praznici (effectiveHolidays), bez rušenja ekrana.
            Promise.resolve()
                .then(() => getOrgSettings(organizationId))
                .then(s => { cache.set(organizationId, s?.holidays || null); listeners.forEach(l => l()); })
                .catch(() => undefined);
        } else sync();
        return () => { alive = false; listeners.delete(sync); };
    }, [organizationId]);

    const list = useMemo(() => effectiveHolidays(saved, todayISO()), [saved]);
    const dates = useMemo(() => holidayDates(list), [list]);

    const save = useCallback(async (next: Holiday[]) => {
        if (!organizationId) return false;
        const res = await saveOrgSettings(organizationId, { holidays: next });
        if (res.success) {
            cache.set(organizationId, next);
            listeners.forEach(l => l());
        }
        return res.success;
    }, [organizationId]);

    return { list, dates, isDefault: !saved || !saved.length, loaded, save };
}
