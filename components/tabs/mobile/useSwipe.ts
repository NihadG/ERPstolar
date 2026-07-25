'use client';

// ════════════════════════════════════════════════════════════════════
// SWIPE GESTOVI (telefon)
//
// ZAŠTO TOUCH, A NE POINTER: prva verzija je koristila pointer evente na
// `window` bez `touch-action`, pa je preglednik gest tumačio kao skrolanje i
// slao `pointercancel` — gest je „radio" samo ponekad. Sada:
//   • touchstart/touchmove/touchend na SAM element (ne window),
//   • touchmove je NE-passive da se može pozvati preventDefault kad gest
//     stvarno počne (bez toga se ekran istovremeno skroluje),
//   • odluka „ovo je swipe" pada tek nakon što vodoravni pomak nadmaši
//     okomiti — dotad se ne dira ponašanje stranice.
//
// Gestovi:
//   useEdgeSwipeBack — povlačenje s lijeve ivice = nazad
//   useSwipeTabs     — vodoravni swipe = prethodni/sljedeći tab
//   useSwipeDismiss  — povlačenje nadolje = zatvori sheet
// ════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';

/** Kontrole koje same troše dodir — gest ih ne smije oteti. */
const INTERACTIVE = 'input, textarea, select, button, a, [role="slider"], [data-no-swipe]';

/** Vodoravni skroler (čipovi, tabele) — tu swipe ne hvatamo. */
function insideHorizontalScroller(target: EventTarget | null, root: HTMLElement | null): boolean {
    let el = target as HTMLElement | null;
    while (el && el !== root && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 4) {
            const ox = getComputedStyle(el).overflowX;
            if (ox === 'auto' || ox === 'scroll') return true;
        }
        el = el.parentElement;
    }
    return false;
}

function blocked(target: EventTarget | null, root: HTMLElement | null): boolean {
    const t = target as HTMLElement | null;
    if (!t) return false;
    if (t.closest(INTERACTIVE)) return true;
    return insideHorizontalScroller(t, root);
}

interface EdgeBackOptions {
    enabled?: boolean;
    /** Širina zone uz lijevu ivicu u kojoj gest počinje (px). */
    edgeWidth?: number;
    /** Koliko treba povući da se okine „nazad" (px). */
    threshold?: number;
}

/**
 * Povlačenje s lijeve ivice = nazad. Vraća `dragX` da ekran može pratiti prst
 * (bez povratne informacije gest djeluje kao slučajan skok).
 *
 * Sluša na `document` jer su ekrani portali van React stabla, ali gest počinje
 * samo u ivičnoj zoni — pa ne smeta ostatku stranice.
 */
export function useEdgeSwipeBack(onBack: () => void, opts: EdgeBackOptions = {}) {
    const { enabled = true, edgeWidth = 32, threshold = 80 } = opts;
    const [dragX, setDragX] = useState(0);
    const state = useRef<{ x: number; y: number; live: boolean; decided: boolean } | null>(null);
    // onBack u ref-u: gest se veže jednom, a callback se mijenja svakim renderom.
    const backRef = useRef(onBack);
    backRef.current = onBack;

    useEffect(() => {
        if (!enabled) { setDragX(0); return; }

        const onStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            if (t.clientX > edgeWidth) return;
            if (blocked(e.target, null)) return;
            state.current = { x: t.clientX, y: t.clientY, live: true, decided: false };
        };

        const onMove = (e: TouchEvent) => {
            const s = state.current;
            if (!s?.live) return;
            const t = e.touches[0];
            const dx = t.clientX - s.x;
            const dy = t.clientY - s.y;

            if (!s.decided) {
                // Okomit pokret = skrolanje; gest se tiho povlači.
                if (Math.abs(dy) > Math.abs(dx)) { state.current = null; setDragX(0); return; }
                if (Math.abs(dx) < 10) return;      // premalo da se odluči
                s.decided = true;
            }
            // Od trenutka odluke gest je naš — spriječi paralelno skrolanje.
            if (e.cancelable) e.preventDefault();
            setDragX(Math.max(0, dx));
        };

        const onEnd = () => {
            const s = state.current;
            state.current = null;
            setDragX(prev => {
                if (s?.decided && prev >= threshold) backRef.current();
                return 0;
            });
        };

        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd, { passive: true });
        document.addEventListener('touchcancel', onEnd, { passive: true });
        return () => {
            document.removeEventListener('touchstart', onStart);
            document.removeEventListener('touchmove', onMove as EventListener);
            document.removeEventListener('touchend', onEnd);
            document.removeEventListener('touchcancel', onEnd);
        };
    }, [enabled, edgeWidth, threshold]);

    return dragX;
}

/**
 * Vodoravni swipe = prethodni/sljedeći tab. Traži jasan vodoravni pokret
 * (≥90px i dvostruko veći od okomitog) da se tab ne mijenja pri skrolanju.
 */
export function useSwipeTabs(onPrev: () => void, onNext: () => void, enabled = true) {
    const state = useRef<{ x: number; y: number } | null>(null);
    const prevRef = useRef(onPrev);
    const nextRef = useRef(onNext);
    prevRef.current = onPrev;
    nextRef.current = onNext;

    useEffect(() => {
        if (!enabled) return;
        const THRESHOLD = 90;

        const onStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) { state.current = null; return; }
            // Ne hvataj gest koji je krenuo s ivice — to je „nazad".
            if (e.touches[0].clientX < 36) { state.current = null; return; }
            if (blocked(e.target, null)) { state.current = null; return; }
            state.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        };

        const onEnd = (e: TouchEvent) => {
            const s = state.current;
            state.current = null;
            if (!s || !e.changedTouches.length) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - s.x;
            const dy = Math.abs(t.clientY - s.y);
            if (Math.abs(dx) < THRESHOLD || dy > Math.abs(dx) / 2) return;
            if (dx > 0) prevRef.current(); else nextRef.current();
        };

        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchend', onEnd, { passive: true });
        document.addEventListener('touchcancel', () => { state.current = null; }, { passive: true });
        return () => {
            document.removeEventListener('touchstart', onStart);
            document.removeEventListener('touchend', onEnd);
        };
    }, [enabled]);
}

/**
 * Povlačenje nadolje zatvara sheet. Hvata se samo kad je sadržaj skrolan na
 * vrh — inače bi gest otimao skrolanje dugačkog sheeta.
 */
export function useSwipeDismiss(
    ref: React.RefObject<HTMLElement | null>,
    onDismiss: () => void,
    enabled = true
) {
    const [dragY, setDragY] = useState(0);
    const state = useRef<{ y: number; x: number; decided: boolean } | null>(null);
    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;

    useEffect(() => {
        if (!enabled) { setDragY(0); return; }
        const el = ref.current;
        if (!el) return;
        const THRESHOLD = 100;

        const onStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
            if (el.scrollTop > 2) return;                 // sadržaj se još skroluje
            state.current = { y: e.touches[0].clientY, x: e.touches[0].clientX, decided: false };
        };

        const onMove = (e: TouchEvent) => {
            const s = state.current;
            if (!s) return;
            const t = e.touches[0];
            const dy = t.clientY - s.y;
            const dx = Math.abs(t.clientX - s.x);

            if (!s.decided) {
                if (dy < 0 || dx > Math.abs(dy)) { state.current = null; setDragY(0); return; }
                if (dy < 10) return;
                s.decided = true;
            }
            if (e.cancelable) e.preventDefault();
            setDragY(Math.max(0, dy));
        };

        const onEnd = () => {
            const s = state.current;
            state.current = null;
            setDragY(prev => {
                if (s?.decided && prev >= THRESHOLD) dismissRef.current();
                return 0;
            });
        };

        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd, { passive: true });
        el.addEventListener('touchcancel', onEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove as EventListener);
            el.removeEventListener('touchend', onEnd);
            el.removeEventListener('touchcancel', onEnd);
        };
    }, [ref, enabled]);

    return dragY;
}
