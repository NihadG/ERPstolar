'use client';

// ════════════════════════════════════════════════════════════════════
// OPTIMISTIČNI RESURS — temelj brzine pogonske aplikacije na telefonu
//
// Do sada je svaki upis išao: `await apiPost()` pa `await load()` — dvije
// uzastopne runde na mobilnoj mreži i pun re-fetch prije ijedne promjene na
// ekranu. Korisnik tapne i čeka. Ovaj hook to okreće:
//
//   1. ODMAH primijeni očekivanu promjenu u lokalno stanje (ekran reaguje na dodir).
//   2. Pošalji upis (JEDNA runda) — on je mjerodavan za uspjeh/grešku (toast tačan).
//   3. Na uspjeh: TIHO povuci svjež presjek u pozadini (bez spinnera) — da serverom
//      izračunata polja (trošak, pravi ID, kaskade) sjednu-dvije sekunde kasnije sjednu.
//   4. Na grešku: vrati na staro stanje i baci grešku.
//
// Trka: `gen` brojač. Svaki `mutate`/`load` ga poveća; rezultat tihog reloada ili
// vraćanje na staro se primijene SAMO ako u međuvremenu nije krenuo noviji upis —
// pa tri brza dodira ne vrate zastario presjek preko svježeg optimizma.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface FieldResource<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    /** Ponovni dohvat sa spinnerom (za dugme „Pokušaj ponovo" i ručno osvježavanje). */
    reload: () => Promise<void>;
    /**
     * Optimistični upis. `optimistic` gradi očekivano stanje iz trenutnog; `commit`
     * je stvarni zahtjev čiji se rezultat vraća pozivaocu (npr. prijedlog naloga).
     */
    mutate: <R>(optimistic: (prev: T) => T, commit: () => Promise<R>) => Promise<R>;
    /** Direktna zakrpa stanja bez mrežnog poziva (npr. lokalno ubacivanje reda). */
    patch: (fn: (prev: T) => T) => void;
}

export function useFieldResource<T>(
    fetcher: (() => Promise<T>) | null,
    deps: DependencyList,
    opts: { errorMessage?: string } = {}
): FieldResource<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState<boolean>(!!fetcher);
    const [error, setError] = useState<string | null>(null);

    const gen = useRef(0);
    const dataRef = useRef<T | null>(null);          // sinhrona sjena `data` za snapshot/rollback
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const errMsg = opts.errorMessage || 'Učitavanje nije uspjelo.';

    /** Postavi i stanje i sjenu odjednom — pozivaoci nikad ne diraju `dataRef` direktno. */
    const commitData = useCallback((next: T | null) => {
        dataRef.current = next;
        setData(next);
    }, []);

    const load = useCallback(async (silent = false): Promise<void> => {
        const f = fetcherRef.current;
        const myGen = ++gen.current;
        if (!f) { commitData(null); setLoading(false); return; }
        if (!silent) { setLoading(true); setError(null); }
        try {
            const res = await f();
            if (gen.current === myGen) commitData(res);   // odbaci zastarjeli odgovor
        } catch (e: any) {
            if (gen.current === myGen && !silent) setError(e?.message || errMsg);
        } finally {
            if (gen.current === myGen && !silent) setLoading(false);
        }
    }, [commitData, errMsg]);

    // Auto-dohvat kad se ključ (deps) promijeni — isti ugovor kao raniji `useEffect(load)`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { void load(); }, deps);

    const mutate = useCallback(async <R,>(
        optimistic: (prev: T) => T,
        commit: () => Promise<R>
    ): Promise<R> => {
        const myGen = ++gen.current;
        const prev = dataRef.current;                 // sinhroni snapshot za rollback
        if (prev != null) commitData(optimistic(prev));
        try {
            const res = await commit();
            void load(true);                          // tihi reconcile u pozadini
            return res;
        } catch (e) {
            if (gen.current === myGen) commitData(prev);   // vrati staro samo ako nije pretečeno
            throw e;
        }
    }, [commitData, load]);

    const patch = useCallback((fn: (prev: T) => T) => {
        const prev = dataRef.current;
        if (prev != null) commitData(fn(prev));
    }, [commitData]);

    return { data, loading, error, reload: () => load(false), mutate, patch };
}
