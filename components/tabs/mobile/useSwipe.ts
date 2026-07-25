'use client';

// ════════════════════════════════════════════════════════════════════
// GESTOVI (telefon) — imperativno, bez React re-rendera tokom vučenja
//
// KLJUČNA GREŠKA prethodnih verzija: transform se držao u React stanju i
// mijenjao `setState`-om na SVAKI touchmove → cijeli (težak) ekran se
// re-renderuje 60×/s i animacija stutera („katastrofalno").
//
// Ovdje se ekran vuče pisanjem `element.style.transform` DIREKTNO u DOM
// (nula React renderova), na GPU sloju (`translate3d` + `will-change`).
// React se uključuje tek na kraju gesta — kad treba demontirati ekran.
//
// Listeneri se vežu na SAM element (ne na document): touch eventi se drže
// mete s touchstart-a kroz cijeli gest, pa je pouzdano i jeftino.
// Uz `touch-action: pan-y` na kontejneru vodoravni pokret je naš i
// `preventDefault` radi (inače preglednik proglasi skrol i pošalje cancel).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { isOverlayOpen } from './overlayGuard';

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** Za TAB-swipe: izbjegava otimanje dodira namijenjenog tapu/dugmetu. */
const INTERACTIVE = 'input, textarea, select, button, a, [role="slider"], [data-no-swipe]';

/**
 * Za EDGE-swipe-nazad: SAMO prava tekst-polja isključuju gest. Redovi liste
 * (MCell) su <button> pune širine koji počinju ~16px od ivice — kad bi ih
 * blokirali kao i INTERACTIVE, edge-swipe bi promašivao skoro svaki put
 * (isti problem kao kod iOS-a da nije riješen: sistemski edge-swipe radi
 * PREKO tabela/dugmadi, ne odustaje zbog njih). Pomak > 6px već dokazuje
 * da je namjera swipe, ne tap, pa se ispod-ležeći klik neće okinuti.
 */
const EDGE_BLOCK = 'input, textarea, select, [role="slider"], [data-no-swipe]';

/** Kratka vibracija kao potvrda gesta (gdje uređaj podržava). */
export function haptic(ms = 8) {
    try { navigator.vibrate?.(ms); } catch { /* nije podržano */ }
}

function matches(target: EventTarget | null, selector: string): boolean {
    const t = target as HTMLElement | null;
    return !!t?.closest(selector);
}

/** Je li ijedan okomiti skroler pod prstom već odskrolan (tad ne hvatamo gest). */
function scrolledDown(target: EventTarget | null, root: HTMLElement | null): boolean {
    let el = target as HTMLElement | null;
    while (el) {
        if (el.scrollHeight > el.clientHeight + 4) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollTop > 2) return true;
        }
        if (el === root) break;
        el = el.parentElement;
    }
    return false;
}

interface BackOptions {
    enabled?: boolean;
    /** Zona uz lijevu ivicu u kojoj gest počinje (px). */
    edgeWidth?: number;
    /** Udaljenost koja sama zatvara (px). */
    threshold?: number;
}

/**
 * Povlačenje s lijeve ivice = nazad. Vrati ref za korijenski element ekrana:
 * hook njime imperativno pomjera ekran, prati brzinu i na otpuštanju ga
 * dovuče van (zatvara) ili vrati natrag — sve preko CSS transformacije,
 * bez ijednog React rendera dok prst vuče.
 */
export function useSwipeBack(onBack: () => void, opts: BackOptions = {}) {
    const { enabled = true, edgeWidth = 30, threshold = 84 } = opts;
    const ref = useRef<HTMLDivElement>(null);
    const cb = useRef(onBack);
    cb.current = onBack;

    useEffect(() => {
        const el = ref.current;
        if (!el || !enabled) return;

        let sx = 0, sy = 0, lastX = 0, lastT = 0;
        let decided = false, active = false, finished = false;
        const W = () => window.innerWidth || 400;

        const setX = (x: number) => { el.style.transform = x > 0 ? `translate3d(${x}px,0,0)` : ''; };
        const clear = () => {
            el.style.transition = ''; el.style.boxShadow = ''; el.style.willChange = ''; setX(0);
        };

        const onStart = (e: TouchEvent) => {
            if (active || e.touches.length !== 1) return;
            const t = e.touches[0];
            if (t.clientX > edgeWidth) return;
            if (matches(e.target, EDGE_BLOCK)) return;
            sx = t.clientX; sy = t.clientY; lastX = sx; lastT = performance.now();
            decided = false; active = true;
            el.style.transition = 'none';
            el.style.willChange = 'transform';
        };

        const onMove = (e: TouchEvent) => {
            if (!active) return;
            const t = e.touches[0];
            const mx = t.clientX - sx, my = t.clientY - sy;
            if (!decided) {
                if (Math.abs(my) > Math.abs(mx)) { active = false; el.style.willChange = ''; return; }
                if (Math.abs(mx) < 6) return;
                decided = true;
                el.style.boxShadow = '-16px 0 44px rgba(0,0,0,0.22)';
            }
            if (e.cancelable) e.preventDefault();
            lastX = t.clientX; lastT = performance.now();
            const dx = Math.max(0, mx);
            const half = W() * 0.5;          // blaga gumica preko pola ekrana
            setX(dx > half ? half + (dx - half) * 0.5 : dx);
        };

        const onEnd = (e: TouchEvent) => {
            if (!active) return;
            active = false;
            if (!decided) { el.style.willChange = ''; return; }
            const t = e.changedTouches[0];
            const dist = Math.max(0, t.clientX - sx);
            const v = (t.clientX - lastX) / Math.max(1, performance.now() - lastT);   // px/ms

            el.style.transition = `transform 0.34s ${EASE}, box-shadow 0.34s ease`;
            if (dist >= threshold || v > 0.3) {
                finished = false;
                el.style.transform = `translate3d(${W()}px,0,0)`;
                haptic();
                const done = () => { if (finished) return; finished = true; el.removeEventListener('transitionend', done); cb.current(); };
                el.addEventListener('transitionend', done);
                window.setTimeout(done, 420);   // sigurnosna mreža ako transitionend izostane
            } else {
                const back = () => { el.removeEventListener('transitionend', back); clear(); };
                el.addEventListener('transitionend', back);
                setX(0);
            }
        };

        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd, { passive: true });
        el.addEventListener('touchcancel', onEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove as EventListener);
            el.removeEventListener('touchend', onEnd as EventListener);
            el.removeEventListener('touchcancel', onEnd as EventListener);
            // Ako je gest već izgurao ekran van, NE resetuj — inače „bljesne"
            // natrag na tren prije nego se demontira.
            if (!finished) clear();
        };
    }, [enabled, edgeWidth, threshold]);

    return ref;
}

/**
 * Povlačenje nadolje zatvara sheet/modal. Vrati dva ref-a: za sam sheet
 * (pomjera se) i za pozadinu (blijedi). Sve imperativno, isto kao back.
 * Ne hvata gest ako je sadržaj već odskrolan (tad se skroluje).
 */
export function useSwipeDismiss(onDismiss: () => void, enabled = true) {
    const sheetRef = useRef<HTMLDivElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    const cb = useRef(onDismiss);
    cb.current = onDismiss;

    useEffect(() => {
        const el = sheetRef.current;
        if (!el || !enabled) return;
        const bg = () => backdropRef.current;

        let sy = 0, sx = 0, lastY = 0, lastT = 0;
        let decided = false, active = false, finished = false;

        const setY = (y: number) => {
            el.style.transform = y > 0 ? `translate3d(0,${y}px,0)` : '';
            const b = bg();
            if (b) b.style.opacity = y > 0 ? String(Math.max(0.15, 1 - y / 340)) : '';
        };
        const clear = () => {
            el.style.transition = ''; el.style.willChange = ''; setY(0);
            const b = bg();
            if (b) { b.style.transition = ''; b.style.opacity = ''; }
        };

        const onStart = (e: TouchEvent) => {
            if (active || e.touches.length !== 1) return;
            if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
            if (el.scrollTop > 2 || scrolledDown(e.target, el)) return;
            const t = e.touches[0];
            sy = t.clientY; sx = t.clientX; lastY = sy; lastT = performance.now();
            decided = false; active = true;
            el.style.transition = 'none';
            el.style.willChange = 'transform';
        };

        const onMove = (e: TouchEvent) => {
            if (!active) return;
            const t = e.touches[0];
            const my = t.clientY - sy, mx = Math.abs(t.clientX - sx);
            if (!decided) {
                if (my < 0 || mx > Math.abs(my)) { active = false; el.style.willChange = ''; return; }
                if (my < 6) return;
                decided = true;
            }
            if (e.cancelable) e.preventDefault();
            lastY = t.clientY; lastT = performance.now();
            setY(Math.max(0, my));
        };

        const onEnd = (e: TouchEvent) => {
            if (!active) return;
            active = false;
            if (!decided) { el.style.willChange = ''; return; }
            const t = e.changedTouches[0];
            const dist = Math.max(0, t.clientY - sy);
            const v = (t.clientY - lastY) / Math.max(1, performance.now() - lastT);
            const H = el.offsetHeight || 600;
            const b = bg();

            el.style.transition = `transform 0.3s ${EASE}`;
            if (b) b.style.transition = 'opacity 0.3s ease';
            if (dist >= 100 || v > 0.4) {
                finished = false;
                el.style.transform = `translate3d(0,${H}px,0)`;
                if (b) b.style.opacity = '0';
                haptic();
                const done = () => { if (finished) return; finished = true; el.removeEventListener('transitionend', done); cb.current(); };
                el.addEventListener('transitionend', done);
                window.setTimeout(done, 380);
            } else {
                const back = () => { el.removeEventListener('transitionend', back); clear(); };
                el.addEventListener('transitionend', back);
                setY(0);
            }
        };

        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd, { passive: true });
        el.addEventListener('touchcancel', onEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove as EventListener);
            el.removeEventListener('touchend', onEnd as EventListener);
            el.removeEventListener('touchcancel', onEnd as EventListener);
            // Ne resetuj ako je gest već zatvorio sheet (spriječi bljesak nazad).
            if (!finished) clear();
        };
    }, [enabled]);

    return { sheetRef, backdropRef };
}

/** Vodoravni swipe = prethodni/sljedeći tab (na listama, ne u detaljima). */
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
            // Bilo koji full-screen detalj/sheet je otvoren (portal u body) →
            // ovaj dodir mu pripada, ne globalnoj promjeni taba ispod njega.
            if (isOverlayOpen()) { gesture.current = null; return; }
            const t = e.touches[0];
            if (t.clientX < 36) { gesture.current = null; return; }   // ivica = „nazad"
            if (matches(e.target, INTERACTIVE)) { gesture.current = null; return; }
            gesture.current = { x: t.clientX, y: t.clientY, t: performance.now() };
        };
        const onEnd = (e: TouchEvent) => {
            const g = gesture.current;
            gesture.current = null;
            if (!g || !e.changedTouches.length) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - g.x;
            const dy = Math.abs(t.clientY - g.y);
            const speed = Math.abs(dx) / Math.max(1, performance.now() - g.t);
            if (dy > Math.abs(dx) / 2) return;
            if (Math.abs(dx) < DIST && speed < 0.5) return;
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
