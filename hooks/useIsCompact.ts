import { useState, useEffect } from 'react';

/**
 * `true` kada je viewport uži od `breakpoint` (default 1024px) — koristi se da
 * Narudžbe pređu s desktop reda-tabele na kartično-mrežni prikaz za tablet i
 * mobitel. Namjerno odvojeno od useIsMobile (768px) da promjena praga ovdje ne
 * povuče mobilne prikaze ostalih tabova.
 */
export function useIsCompact(breakpoint = 1024) {
    const [isCompact, setIsCompact] = useState(false);

    useEffect(() => {
        const check = () => setIsCompact(window.innerWidth < breakpoint);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, [breakpoint]);

    return isCompact;
}
