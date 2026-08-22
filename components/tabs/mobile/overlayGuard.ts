'use client';

// ════════════════════════════════════════════════════════════════════
// STRAŽA PREKLAPAJUĆIH GESTOVA
//
// BUG koji je ovo popravilo: useSwipeTabs (promjena taba) sluša na
// `document` i ostaje aktivan cijelo vrijeme dok je korisnik na mobitelu —
// bez ikakve svijesti o tome je li trenutno otvoren full-screen detalj
// (nalog, narudžba, ponuda, proizvod, pregled projekta), koji se renderuje
// kroz createPortal u document.body. Dodir na tom portalu I DALJE probubla
// do document-level listenera, pa se svajp-nazad na nalogu ISTOVREMENO
// tumačio i kao pokušaj promjene taba ispod — dva gesta su se otimala
// za isti dodir.
//
// Rješenje: svaki full-screen overlay/sheet prijavi da je otvoren (na
// mount) i odjavi se (na unmount). useSwipeTabs provjerava ovo PRIJE nego
// prihvati dodir. Čisto imperativno (modul-level brojač), bez React
// state-a — dosljedno s ostatkom gest-koda koji namjerno izbjegava
// re-rendere tokom dodira.
// ════════════════════════════════════════════════════════════════════

import { useEffect } from 'react';

let depth = 0;

/**
 * Klasa na <body> dok je bilo koji overlay otvoren.
 *
 * Postoji zbog DONJE TAB-TRAKE. Cjeloekranski slojevi (`.fbk` dodjela naloga,
 * `.fod` detalj naloga, sheetovi) crtaju vlastito dugme na dnu, fiksirano na
 * `bottom: 0` — tačno tamo gdje stoji i `.mtb`. Papirnato to rješava z-index
 * (900/1200 iznad 800), ali u praksi se na telefonu traka provlačila preko
 * dugmeta i sjekla ga po pola — dovoljno da se „Potvrdi i proknjiži" ne može
 * pouzdano pogoditi. Umjesto natezanja slojeva, traka se za to vrijeme skloni:
 * ispod cjeloekranskog sloja je ionako niko ne vidi, a iOS je i sam sakriva
 * kad se gurne novi ekran.
 */
const BODY_CLASS = 'm-overlay';

function syncBody(): void {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle(BODY_CLASS, depth > 0);
}

export function pushOverlay(): void {
    depth++;
    syncBody();
}

export function popOverlay(): void {
    depth = Math.max(0, depth - 1);
    syncBody();
}

export function isOverlayOpen(): boolean {
    return depth > 0;
}

/** Prijavi „ja sam otvoren" dok je `active` true — poziva se iz svakog full-screen overlaya/sheeta. */
export function useOverlayGuard(active: boolean): void {
    useEffect(() => {
        if (!active) return;
        pushOverlay();
        return () => popOverlay();
    }, [active]);
}
