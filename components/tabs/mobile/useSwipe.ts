'use client';

// ════════════════════════════════════════════════════════════════════
// SWIPE GESTOVI (telefon) — iOS ponašanje
//
//  • useEdgeSwipeBack — povlačenje s LIJEVE IVICE udesno vraća nazad,
//    kao sistemski „back" na iPhoneu. Ekran prati prst i vraća se ako
//    korisnik odustane (nema skoka).
//  • useSwipeTabs     — vodoravno prevlačenje mijenja tab u donjoj traci.
//  • useSwipeDismiss  — povlačenje nadolje zatvara bottom sheet.
//
// Zajednička pravila (zašto su ovako):
//  – Pointer events, ne touch: rade i s mišem/olovkom i lakše se otkazuju.
//  – Gest se prekida ako je pokret pretežno OKOMIT (korisnik skroluje).
//  – Ignoriše se start unutar vodoravnog skrolera, dugmeta ili polja unosa,
//    inače bi swipe kidao klizanje čipova i unos teksta.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';

/** Gest ne smije oteti pokret ovim elementima. */
const INTERACTIVE = 'input, textarea, select, button, a, [role="slider"], .mui-chiprail, .mui-seg, [data-no-swipe]';

/** Element (ili predak) koji se može klizati vodoravno — tu swipe ne hvatamo. */
function insideHorizontalScroller(target: EventTarget | null): boolean {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 4) {
            const overflowX = getComputedStyle(el).overflowX;
            if (overflowX === 'auto' || overflowX === 'scroll') return true;
        }
        el = el.parentElement;
    }
    return false;
}

function shouldIgnore(e: PointerEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.closest(INTERACTIVE)) return true;
    return insideHorizontalScroller(t);
}

interface EdgeBackOptions {
    /** Isključi kad ekran nije aktivan (npr. otvoren sheet iznad njega). */
    enabled?: boolean;
    /** Širina zone uz lijevu ivicu u kojoj gest počinje (px). */
    edgeWidth?: number;
    /** Koliko treba povući da se smatra „nazad" (px). */
    threshold?: number;
}

/**
 * Povlačenje s lijeve ivice = nazad. Vraća `dragX` (piksela pomaka) da ga
 * ekran može primijeniti kao transform — bez toga gest ne bi imao povratnu
 * informaciju i djelovao bi kao slučajan skok.
 */
export function useEdgeSwipeBack(onBack: () => void, opts: EdgeBackOptions = {}) {
    const { enabled = true, edgeWidth = 28, threshold = 70 } = opts;
    const [dragX, setDragX] = useState(0);
    const start = useRef<{ x: number; y: number; active: boolean } | null>(null);

    useEffect(() => {
        if (!enabled) return;

        const onDown = (e: PointerEvent) => {
            if (e.pointerType === 'mouse') return;          // miš nema ivični gest
            if (e.clientX > edgeWidth) return;
            if (shouldIgnore(e)) return;
            start.current = { x: e.clientX, y: e.clientY, active: true };
        };

        const onMove = (e: PointerEvent) => {
            const s = start.current;
            if (!s?.active) return;
            const dx = e.clientX - s.x;
            const dy = Math.abs(e.clientY - s.y);
            // Okomit pokret = korisnik skroluje, ne vraća se nazad.
            if (dy > Math.abs(dx) && dy > 12) { start.current = null; setDragX(0); return; }
            setDragX(Math.max(0, dx));
        };

        const onUp = () => {
            const s = start.current;
            start.current = null;
            setDragX(prev => {
                if (s?.active && prev >= threshold) onBack();
                return 0;
            });
        };

        window.addEventListener('pointerdown', onDown, { passive: true });
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', onUp, { passive: true });
        window.addEventListener('pointercancel', onUp, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [enabled, edgeWidth, threshold, onBack]);

    return dragX;
}

/**
 * Vodoravno prevlačenje po sadržaju = prethodni/sljedeći tab.
 * Namjerno traži duži pokret (100px) i jasno vodoravni smjer — kraći prag bi
 * mijenjao tab pri svakom nesigurnom skrolu.
 */
export function useSwipeTabs(onPrev: () => void, onNext: () => void, enabled = true) {
    const start = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
        if (!enabled) return;
        const THRESHOLD = 100;

        const onDown = (e: PointerEvent) => {
            if (e.pointerType === 'mouse') return;
            if (shouldIgnore(e)) { start.current = null; return; }
            start.current = { x: e.clientX, y: e.clientY };
        };

        const onUp = (e: PointerEvent) => {
            const s = start.current;
            start.current = null;
            if (!s) return;
            const dx = e.clientX - s.x;
            const dy = Math.abs(e.clientY - s.y);
            if (Math.abs(dx) < THRESHOLD || dy > Math.abs(dx) * 0.6) return;
            if (dx > 0) onPrev(); else onNext();
        };

        window.addEventListener('pointerdown', onDown, { passive: true });
        window.addEventListener('pointerup', onUp, { passive: true });
        window.addEventListener('pointercancel', () => { start.current = null; }, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointerup', onUp);
        };
    }, [enabled, onPrev, onNext]);
}

/**
 * Povlačenje nadolje po sheetu = zatvori. Hvata se samo kad je sheet skrolan
 * na vrh, inače bi gest otimao skrolanje dugačkog sadržaja.
 */
export function useSwipeDismiss(ref: React.RefObject<HTMLElement | null>, onDismiss: () => void, enabled = true) {
    const [dragY, setDragY] = useState(0);
    const start = useRef<{ y: number; x: number } | null>(null);

    useEffect(() => {
        if (!enabled) return;
        const el = ref.current;
        if (!el) return;
        const THRESHOLD = 90;

        const onDown = (e: PointerEvent) => {
            if (e.pointerType === 'mouse') return;
            if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
            if (el.scrollTop > 2) return;              // sadržaj se još skroluje
            start.current = { y: e.clientY, x: e.clientX };
        };

        const onMove = (e: PointerEvent) => {
            const s = start.current;
            if (!s) return;
            const dy = e.clientY - s.y;
            if (dy < 0) { setDragY(0); return; }        // gore = ništa
            if (Math.abs(e.clientX - s.x) > dy && dy < 10) return;
            setDragY(dy);
        };

        const onUp = () => {
            start.current = null;
            setDragY(prev => {
                if (prev >= THRESHOLD) onDismiss();
                return 0;
            });
        };

        el.addEventListener('pointerdown', onDown, { passive: true });
        el.addEventListener('pointermove', onMove, { passive: true });
        el.addEventListener('pointerup', onUp, { passive: true });
        el.addEventListener('pointercancel', onUp, { passive: true });
        return () => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointercancel', onUp);
        };
    }, [ref, enabled, onDismiss]);

    return dragY;
}
