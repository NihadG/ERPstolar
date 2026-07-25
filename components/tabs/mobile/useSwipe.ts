'use client';

// ════════════════════════════════════════════════════════════════════
// GESTOVI (telefon) — iOS osjećaj
//
// Prethodna verzija je „radila svaki drugi put" i djelovala mrtvo. Tri uzroka
// i njihova rješenja, jer se lako ponove:
//   1. pointer eventi bez `touch-action` → preglednik proglasi pokret
//      skrolanjem i pošalje cancel. Sada: touch eventi + `touch-action: pan-y`
//      + `preventDefault` čim gest postane naš.
//   2. nije bilo ANIMACIJE — ekran je nestajao/skakao. Sada: prst vuče 1:1,
//      a na otpuštanju ekran ili doklizi van (zatvara se) ili se vrati natrag,
//      oboje s krivuljom.
//   3. prag je bio samo udaljenost, pa je brz kratak flick propadao. Sada se
//      gleda i BRZINA (kao iOS): brz pokret zatvara i na pola puta.
//
// Gestovi: useSwipeBack (nazad), useSwipeDismiss (zatvori sheet nadolje),
// useSwipeTabs (promjena taba), plus haptika i „dupli tap = vrh".
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';

/** Kontrole koje same troše dodir — gest ih ne smije oteti. */
const INTERACTIVE = 'input, textarea, select, button, a, [role="slider"], [data-no-swipe]';

/** Kratka vibracija kao potvrda gesta (gdje uređaj podržava). */
export function haptic(ms = 8) {
    try { navigator.vibrate?.(ms); } catch { /* nije podržano */ }
}

function insideHorizontalScroller(target: EventTarget | null): boolean {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 4) {
            const ox = getComputedStyle(el).overflowX;
            if (ox === 'auto' || ox === 'scroll') return true;
        }
        el = el.parentElement;
    }
    return false;
}

function blocked(target: EventTarget | null): boolean {
    const t = target as HTMLElement | null;
    if (!t) return false;
    if (t.closest(INTERACTIVE)) return true;
    return insideHorizontalScroller(t);
}

/**
 * Je li bilo koji okomiti skroler ISPOD prsta već odskrolan?
 * Sheet je često samo okvir, a skrol je na unutrašnjem sadržaju — bez ove
 * provjere bi povlačenje nadolje zatvaralo sheet usred čitanja liste.
 */
function scrolledVertically(target: EventTarget | null, root: HTMLElement | null): boolean {
    let el = target as HTMLElement | null;
    while (el) {
        if (el.scrollHeight > el.clientHeight + 4) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollTop > 2) return true;
        }
        if (el === root || el === document.body) break;
        el = el.parentElement;
    }
    return false;
}

/** Krivulja izlaska/povratka — ista koju koristi iOS za guranje ekrana. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

export interface SwipeBackState {
    /** Stil za korijenski element ekrana (transform + transition). */
    style: React.CSSProperties | undefined;
    /** Koliko je gest odmakao, 0–1 — za zatamnjenje pozadine iza ekrana. */
    progress: number;
    /** true dok prst vuče (za isključivanje hover/animacija u sadržaju). */
    dragging: boolean;
}

interface BackOptions {
    enabled?: boolean;
    /** Zona uz lijevu ivicu u kojoj gest počinje (px). */
    edgeWidth?: number;
    /** Udaljenost koja sama po sebi zatvara (px). */
    threshold?: number;
}

/**
 * Povlačenje s lijeve ivice = nazad, s pravim iOS ponašanjem:
 * prst vuče ekran 1:1, brz flick zatvara i ranije, a na otpuštanju ekran
 * doklizi van ili se vrati — nikad ne „nestane" bez prijelaza.
 */
export function useSwipeBack(onBack: () => void, opts: BackOptions = {}): SwipeBackState {
    const { enabled = true, edgeWidth = 30, threshold = 90 } = opts;

    const [dx, setDx] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [closing, setClosing] = useState(false);

    const gesture = useRef<{ x0: number; y0: number; t0: number; lastX: number; lastT: number; decided: boolean } | null>(null);
    const width = useRef(0);
    const backRef = useRef(onBack);
    backRef.current = onBack;

    useEffect(() => {
        if (!enabled) { setDx(0); setDragging(false); setClosing(false); return; }

        const finish = () => {
            // Ekran doklizi van, pa se tek onda demontira — inače „trepne".
            setClosing(true);
            setDragging(false);
            haptic();
            window.setTimeout(() => backRef.current(), 260);
        };

        const onStart = (e: TouchEvent) => {
            if (closing || e.touches.length !== 1) return;
            const t = e.touches[0];
            if (t.clientX > edgeWidth) return;
            if (blocked(e.target)) return;
            width.current = window.innerWidth || 400;
            gesture.current = { x0: t.clientX, y0: t.clientY, t0: performance.now(), lastX: t.clientX, lastT: performance.now(), decided: false };
        };

        const onMove = (e: TouchEvent) => {
            const g = gesture.current;
            if (!g || closing) return;
            const t = e.touches[0];
            const moveX = t.clientX - g.x0;
            const moveY = t.clientY - g.y0;

            if (!g.decided) {
                if (Math.abs(moveY) > Math.abs(moveX)) { gesture.current = null; setDx(0); setDragging(false); return; }
                if (Math.abs(moveX) < 8) return;
                g.decided = true;
                setDragging(true);
            }
            if (e.cancelable) e.preventDefault();
            g.lastX = t.clientX;
            g.lastT = performance.now();
            // Blago usporenje preko pola ekrana — spriječi da ekran „odleti".
            const raw = Math.max(0, moveX);
            setDx(raw > width.current * 0.5 ? width.current * 0.5 + (raw - width.current * 0.5) * 0.55 : raw);
        };

        const onEnd = (e: TouchEvent) => {
            const g = gesture.current;
            gesture.current = null;
            if (!g?.decided) { setDragging(false); return; }

            const t = e.changedTouches[0];
            const dist = Math.max(0, t.clientX - g.x0);
            const dt = Math.max(1, performance.now() - g.lastT);
            const velocity = (t.clientX - g.lastX) / dt;   // px/ms udesno

            // Brz flick zatvara i na pola puta — inače gest djeluje „tvrdo".
            if (dist >= threshold || velocity > 0.45) finish();
            else { setDragging(false); setDx(0); }
        };

        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd, { passive: true });
        document.addEventListener('touchcancel', onEnd as EventListener, { passive: true });
        return () => {
            document.removeEventListener('touchstart', onStart);
            document.removeEventListener('touchmove', onMove as EventListener);
            document.removeEventListener('touchend', onEnd as EventListener);
            document.removeEventListener('touchcancel', onEnd as EventListener);
        };
    }, [enabled, edgeWidth, threshold, closing]);

    const w = width.current || 1;
    const style: React.CSSProperties | undefined = closing
        ? { transform: `translateX(100%)`, transition: `transform 260ms ${EASE}`, boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' }
        : dragging
            ? { transform: `translateX(${dx}px)`, transition: 'none', boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' }
            : dx === 0
                ? undefined
                : { transform: 'translateX(0px)', transition: `transform 280ms ${EASE}` };

    return { style, progress: closing ? 1 : Math.min(1, dx / w), dragging };
}

/**
 * Povlačenje nadolje zatvara sheet (modali materijala, proizvoda, MSheet).
 * Hvata se samo kad je sadržaj na vrhu, da ne otima skrolanje.
 */
export function useSwipeDismiss(
    ref: React.RefObject<HTMLElement | null>,
    onDismiss: () => void,
    enabled = true
) {
    const [dy, setDy] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [closing, setClosing] = useState(false);
    const gesture = useRef<{ y0: number; x0: number; lastY: number; lastT: number; decided: boolean } | null>(null);
    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;

    useEffect(() => {
        if (!enabled) { setDy(0); setDragging(false); setClosing(false); return; }
        const el = ref.current;
        if (!el) return;
        const THRESHOLD = 110;

        const finish = () => {
            setClosing(true);
            setDragging(false);
            haptic();
            window.setTimeout(() => dismissRef.current(), 240);
        };

        const onStart = (e: TouchEvent) => {
            if (closing || e.touches.length !== 1) return;
            if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
            // Ni sam okvir ni bilo koji skroler pod prstom ne smiju biti odskrolani.
            if (el.scrollTop > 2 || scrolledVertically(e.target, el)) return;
            const t = e.touches[0];
            gesture.current = { y0: t.clientY, x0: t.clientX, lastY: t.clientY, lastT: performance.now(), decided: false };
        };

        const onMove = (e: TouchEvent) => {
            const g = gesture.current;
            if (!g || closing) return;
            const t = e.touches[0];
            const moveY = t.clientY - g.y0;
            const moveX = Math.abs(t.clientX - g.x0);

            if (!g.decided) {
                if (moveY < 0 || moveX > Math.abs(moveY)) { gesture.current = null; setDy(0); setDragging(false); return; }
                if (moveY < 8) return;
                g.decided = true;
                setDragging(true);
            }
            if (e.cancelable) e.preventDefault();
            g.lastY = t.clientY;
            g.lastT = performance.now();
            setDy(Math.max(0, moveY));
        };

        const onEnd = (e: TouchEvent) => {
            const g = gesture.current;
            gesture.current = null;
            if (!g?.decided) { setDragging(false); return; }
            const t = e.changedTouches[0];
            const dist = Math.max(0, t.clientY - g.y0);
            const dt = Math.max(1, performance.now() - g.lastT);
            const velocity = (t.clientY - g.lastY) / dt;
            if (dist >= THRESHOLD || velocity > 0.5) finish();
            else { setDragging(false); setDy(0); }
        };

        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd, { passive: true });
        el.addEventListener('touchcancel', onEnd as EventListener, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove as EventListener);
            el.removeEventListener('touchend', onEnd as EventListener);
            el.removeEventListener('touchcancel', onEnd as EventListener);
        };
    }, [ref, enabled, closing]);

    const style: React.CSSProperties | undefined = closing
        ? { transform: 'translateY(100%)', transition: `transform 240ms ${EASE}` }
        : dragging
            ? { transform: `translateY(${dy}px)`, transition: 'none' }
            : dy === 0
                ? undefined
                : { transform: 'translateY(0px)', transition: `transform 260ms ${EASE}` };

    return { style, dragY: dy, closing, backdropOpacity: closing ? 0 : Math.max(0.2, 1 - dy / 320) };
}

/** Vodoravni swipe = prethodni/sljedeći tab (samo na listama, ne u detaljima). */
export function useSwipeTabs(onPrev: () => void, onNext: () => void, enabled = true) {
    const gesture = useRef<{ x: number; y: number; t: number } | null>(null);
    const prevRef = useRef(onPrev);
    const nextRef = useRef(onNext);
    prevRef.current = onPrev;
    nextRef.current = onNext;

    useEffect(() => {
        if (!enabled) return;
        const DIST = 80;

        const onStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) { gesture.current = null; return; }
            const t = e.touches[0];
            if (t.clientX < 36) { gesture.current = null; return; }   // ivica = „nazad"
            if (blocked(e.target)) { gesture.current = null; return; }
            gesture.current = { x: t.clientX, y: t.clientY, t: performance.now() };
        };

        const onEnd = (e: TouchEvent) => {
            const g = gesture.current;
            gesture.current = null;
            if (!g || !e.changedTouches.length) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - g.x;
            const dy = Math.abs(t.clientY - g.y);
            const dt = Math.max(1, performance.now() - g.t);
            const speed = Math.abs(dx) / dt;
            if (dy > Math.abs(dx) / 2) return;                  // previše okomito
            if (Math.abs(dx) < DIST && speed < 0.5) return;     // ni daleko ni brzo
            haptic(6);
            if (dx > 0) prevRef.current(); else nextRef.current();
        };

        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchend', onEnd, { passive: true });
        document.addEventListener('touchcancel', () => { gesture.current = null; }, { passive: true });
        return () => {
            document.removeEventListener('touchstart', onStart);
            document.removeEventListener('touchend', onEnd as EventListener);
        };
    }, [enabled]);
}

/**
 * Povlačenje liste nadolje s vrha = osvježi (kao u nativnim aplikacijama).
 * Vraća pomak za indikator; poziva `onRefresh` kad se pređe prag.
 */
export function usePullToRefresh(
    ref: React.RefObject<HTMLElement | null>,
    onRefresh: () => void | Promise<void>,
    enabled = true
) {
    const [pull, setPull] = useState(0);
    const [busy, setBusy] = useState(false);
    const gesture = useRef<{ y0: number; decided: boolean } | null>(null);
    const refreshRef = useRef(onRefresh);
    refreshRef.current = onRefresh;

    useEffect(() => {
        if (!enabled) return;
        const el = ref.current || document.scrollingElement as HTMLElement | null;
        if (!el) return;
        const THRESHOLD = 70;
        const target: HTMLElement | Document = ref.current || document;

        const scrollTopOf = () => (ref.current ? ref.current.scrollTop : window.scrollY);

        const onStart = (e: TouchEvent) => {
            if (busy || e.touches.length !== 1 || scrollTopOf() > 2) return;
            gesture.current = { y0: e.touches[0].clientY, decided: false };
        };

        const onMove = (e: TouchEvent) => {
            const g = gesture.current;
            if (!g || busy) return;
            const dy = e.touches[0].clientY - g.y0;
            if (dy <= 0) { setPull(0); return; }
            if (!g.decided) {
                if (dy < 10) return;
                g.decided = true;
            }
            if (e.cancelable) e.preventDefault();
            setPull(Math.min(110, dy * 0.55));   // otpor, kao gumica
        };

        const onEnd = async () => {
            const g = gesture.current;
            gesture.current = null;
            if (!g?.decided) return;
            if (pull >= THRESHOLD) {
                setBusy(true);
                haptic(10);
                try { await refreshRef.current(); } finally { setBusy(false); setPull(0); }
            } else setPull(0);
        };

        target.addEventListener('touchstart', onStart as EventListener, { passive: true });
        target.addEventListener('touchmove', onMove as EventListener, { passive: false });
        target.addEventListener('touchend', onEnd as EventListener, { passive: true });
        return () => {
            target.removeEventListener('touchstart', onStart as EventListener);
            target.removeEventListener('touchmove', onMove as EventListener);
            target.removeEventListener('touchend', onEnd as EventListener);
        };
    }, [ref, enabled, pull, busy]);

    return { pull, busy };
}
