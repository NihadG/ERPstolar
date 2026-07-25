'use client';

// ════════════════════════════════════════════════════════════════════
// PAMĆENJE IZBORA GRUPISANJA/SORTIRANJA (po tabu)
//
// Namjerno tanko: sama LOGIKA grupisanja živi u lib/grouping.ts i dijeli se
// s desktopom. Ovdje se čuva samo korisnikov izbor, da se ne resetuje pri
// svakom otvaranju taba.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';

/**
 * @param scope   ključ taba (npr. 'nalozi' ili 'narudzbe-sort')
 * @param initial zadana vrijednost — mora pratiti desktop default
 */
export function useMobileGrouping<T extends string>(scope: string, initial: T): [T, (v: T) => void] {
    const storeKey = `mui-group-${scope}`;
    const [value, setValue] = useState<T>(initial);

    // Čita se tek nakon montiranja — server render nema localStorage.
    useEffect(() => {
        try {
            const saved = localStorage.getItem(storeKey);
            if (saved) setValue(saved as T);
        } catch { /* private mode — ostaje zadana vrijednost */ }
    }, [storeKey]);

    const update = useCallback((v: T) => {
        setValue(v);
        try { localStorage.setItem(storeKey, v); } catch { /* private mode */ }
    }, [storeKey]);

    return [value, update];
}
