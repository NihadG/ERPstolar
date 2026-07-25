'use client';

// ════════════════════════════════════════════════════════════════════
// SORTIRANJE I GRUPISANJE — dijeljeno za sve mobilne tabove
//
// Jedan hook umjesto da svaki tab izmišlja svoje: isti nazivi kriterija,
// isto ponašanje i izbor koji preživi zatvaranje aplikacije (localStorage).
//
// `apply` sortira, `group` po potrebi lomi listu na sekcije. Oboje rade nad
// bilo kojim tipom — pozivalac daje funkcije koje vade vrijednost iz reda.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { naturalCompare } from '@/lib/naturalCompare';

export type SortKey = 'zadano' | 'naziv' | 'datum' | 'vrijednost' | 'rok' | 'status';
export type GroupKey = 'status' | 'klijent' | 'projekat' | 'dobavljac';

const SORT_LABELS: Record<SortKey, string> = {
    zadano: 'Zadano (aktivni prvi)',
    naziv: 'Naziv (A–Ž)',
    datum: 'Datum · najnovije',
    vrijednost: 'Vrijednost',
    rok: 'Rok',
    status: 'Status',
};

const GROUP_LABELS: Record<GroupKey, string> = {
    status: 'Status',
    klijent: 'Klijent',
    projekat: 'Projekat',
    dobavljac: 'Dobavljač',
};

/** Natpis za dugme/izbor. Bez argumenata vraća „Sortiraj". */
export function sortLabel(sort?: SortKey, group?: GroupKey | null): string {
    if (group) return GROUP_LABELS[group];
    return sort ? SORT_LABELS[sort] : 'Sortiraj';
}

/** Vrijednost po kojoj se sortira — broj (rastuće) ili tekst. */
type Selector<T> = (row: T) => string | number;

/**
 * Pravila po kriteriju. Uz selektore se može dati i `zadano` — pun komparator
 * koji preslikava desktop poredak (npr. compareWorkOrdersDefault), jer se
 * „aktivni prvi, pa projekat, pa datum" ne može izraziti jednom vrijednošću.
 */
type SortRules<R> = Partial<Record<Exclude<SortKey, 'zadano'>, Selector<R>>> & {
    zadano?: (a: R, b: R) => number;
};

export interface MobileSort<T = any> {
    sortKey: SortKey;
    groupKey: GroupKey | null;
    setSortKey: (k: SortKey) => void;
    setGroupKey: (k: GroupKey | null) => void;
    isOpen: boolean;
    open: () => void;
    close: () => void;
    apply: <R>(rows: R[], rules: SortRules<R>) => R[];
    group: <R>(rows: R[], selectors: Partial<Record<GroupKey, Selector<R>>>) => { key: string; rows: R[] }[] | null;
}

/**
 * @param scope   ključ taba (npr. 'nalozi') — izbor se pamti po tabu
 * @param initial početni kriterij sortiranja
 */
export function useMobileSort<T = any>(scope: string, initial: SortKey = 'datum'): MobileSort<T> {
    const storeKey = `mui-sort-${scope}`;
    const [sortKey, setSortKeyState] = useState<SortKey>(initial);
    const [groupKey, setGroupKeyState] = useState<GroupKey | null>(null);
    const [isOpen, setOpen] = useState(false);

    // Učitavanje zapamćenog izbora tek nakon montiranja (server render nema localStorage).
    useEffect(() => {
        try {
            const raw = localStorage.getItem(storeKey);
            if (!raw) return;
            const saved = JSON.parse(raw) as { sort?: SortKey; group?: GroupKey | null };
            if (saved.sort) setSortKeyState(saved.sort);
            if (saved.group !== undefined) setGroupKeyState(saved.group);
        } catch { /* pokvaren zapis — ostaju početne vrijednosti */ }
    }, [storeKey]);

    const persist = useCallback((sort: SortKey, group: GroupKey | null) => {
        try { localStorage.setItem(storeKey, JSON.stringify({ sort, group })); } catch { /* private mode */ }
    }, [storeKey]);

    const setSortKey = useCallback((k: SortKey) => {
        setSortKeyState(k);
        setGroupKeyState(g => { persist(k, g); return g; });
    }, [persist]);

    const setGroupKey = useCallback((k: GroupKey | null) => {
        setGroupKeyState(k);
        setSortKeyState(s => { persist(s, k); return s; });
    }, [persist]);

    const apply = useCallback(<R,>(rows: R[], rules: SortRules<R>): R[] => {
        // Zadani poredak = isti komparator kao desktop (ako ga tab dostavi).
        if (sortKey === 'zadano') {
            return rules.zadano ? [...rows].sort(rules.zadano) : rows;
        }
        const sel = rules[sortKey] as Selector<R> | undefined;
        if (!sel) return rows;
        // Kopija — ulazni niz može biti memoiziran drugdje.
        return [...rows].sort((a, b) => {
            const va = sel(a), vb = sel(b);
            if (typeof va === 'number' && typeof vb === 'number') return va - vb;
            // naturalCompare: „Poz 10" ide IZA „Poz 2", a ne ispred kao kod
            // običnog poređenja stringova (isti kolator koji koristi desktop).
            return naturalCompare(String(va), String(vb));
        });
    }, [sortKey]);

    const group = useCallback(<R,>(rows: R[], selectors: Partial<Record<GroupKey, Selector<R>>>) => {
        if (!groupKey) return null;
        const sel = selectors[groupKey];
        if (!sel) return null;
        const map = new Map<string, R[]>();
        for (const row of rows) {
            const key = String(sel(row) || '—');
            const arr = map.get(key);
            if (arr) arr.push(row); else map.set(key, [row]);
        }
        return Array.from(map.entries()).map(([key, groupRows]) => ({ key, rows: groupRows }));
    }, [groupKey]);

    return useMemo(() => ({
        sortKey, groupKey, setSortKey, setGroupKey,
        isOpen, open: () => setOpen(true), close: () => setOpen(false),
        apply, group,
    }), [sortKey, groupKey, setSortKey, setGroupKey, isOpen, apply, group]);
}
