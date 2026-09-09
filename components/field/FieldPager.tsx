'use client';

// ════════════════════════════════════════════════════════════════════
// POGON — VODORAVNI PAGER TABOVA
//
// Zamjenjuje tvrdi rez (setState) između tabova pravim, prstom vođenim
// prelistavanjem. Isti princip kao useSwipe: transform se piše DIREKTNO u
// DOM (nula React rendera dok prst vuče), na GPU sloju (`translate3d` +
// `will-change`). React se uključuje TEK na kraju gesta — kad je novi tab
// potvrđen. Tako je i najteži tab (kalendar) gladak pri prelistavanju.
//
// Montira se samo tekući tab i njegova dva susjeda (offscreenLimit = 1),
// keep-alive: jednom montiran pane ostaje, pa se skrol i podstanje čuvaju
// kad se korisnik vrati. Dodir na otvorenom full-screen detalju/sheetu
// (overlayGuard) NE mijenja tab — taj dodir pripada njemu.
// ════════════════════════════════════════════════════════════════════

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { isOverlayOpen } from '@/components/tabs/mobile/overlayGuard';
import { haptic } from '@/components/tabs/mobile/useSwipe';

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const DUR = 0.34;   // s — jednako svugdje (back/dismiss/pager), da app „diše" isto

/** Dodir na ovim metama pripada njima (skrol/unos/vodoravna traka), ne prelistavanju. */
const NO_SWIPE = 'input, textarea, select, [role="slider"], [data-no-swipe], .mui-chiprail, .mui-seg';

interface Props {
    /** Indeks aktivnog taba (kontrolisan spolja — tab-traka). */
    index: number;
    count: number;
    onIndexChange: (i: number) => void;
    /** Iscrtava pane i (poziva se samo za montirane tabove). */
    renderPane: (i: number) => ReactNode;
}

export default function FieldPager({ index, count, onIndexChange, renderPane }: Props) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const paneRefs = useRef<(HTMLDivElement | null)[]>([]);
    const rendered = useRef(index);          // koji je pane STVARNO prikazan
    const gen = useRef(0);                    // generacija animacije (gasi zastarjele)
    const onChange = useRef(onIndexChange);
    onChange.current = onIndexChange;

    // ── Keep-alive skup montiranih: tekući + oba susjeda, nikad se ne ruši ──
    // (držimo i trenutno prikazani, da izlazni pane preživi skok na daleki tab).
    const mountedRef = useRef<Set<number>>(new Set());
    for (let d = -1; d <= 1; d++) {
        const i = index + d;
        if (i >= 0 && i < count) mountedRef.current.add(i);
    }
    mountedRef.current.add(rendered.current);
    const panes = [...mountedRef.current].sort((a, b) => a - b);

    const getPane = (i: number): HTMLDivElement | null => paneRefs.current[i] || null;

    /** Parkiraj jedan pane van ekrana (na svoju stranu prikazanog). */
    const park = (i: number) => {
        const el = getPane(i);
        if (!el) return;
        el.style.transition = 'none';
        el.style.willChange = '';
        el.style.transform = `translate3d(${i < rendered.current ? '-100%' : '100%'},0,0)`;
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
        el.classList.remove('is-active');
    };

    /** Mirno stanje: prikazani na 0, svi ostali (montirani) parkirani.
     *  Ide po SVIM indeksima (ne po `panes` iz rendera) — inače bi gest, koji
     *  drži zatvarač iz prvog rendera, promašio kasnije montirane tabove. */
    const settle = (shown: number) => {
        rendered.current = shown;
        for (let i = 0; i < count; i++) {
            const el = getPane(i);
            if (!el) continue;
            if (i === shown) {
                el.style.transition = '';
                el.style.willChange = '';
                el.style.transform = '';
                el.style.visibility = '';
                el.style.pointerEvents = '';
                el.classList.add('is-active');
            } else {
                park(i);
            }
        }
    };

    // ── Programska promjena taba (tap na traci): čist prelaz zamjene ──
    useLayoutEffect(() => {
        const from = rendered.current;
        if (index === from) { settle(index); return; }

        const to = index;
        const dir = to > from ? 1 : -1;              // +1: novi dolazi zdesna
        const fromEl = getPane(from);
        const toEl = getPane(to);
        rendered.current = to;
        if (!fromEl || !toEl) { settle(to); return; }

        const myGen = ++gen.current;

        // Ostale panove skloni bez animacije (da ne bljesnu ispod).
        for (let i = 0; i < count; i++) {
            if (i === from || i === to) continue;
            const el = getPane(i);
            if (!el) continue;
            el.style.transition = 'none';
            el.style.willChange = '';
            el.style.transform = `translate3d(${i < to ? '-100%' : '100%'},0,0)`;
            el.style.visibility = 'hidden';
            el.style.pointerEvents = 'none';
            el.classList.remove('is-active');
        }

        // Dolazni na ulaznu stranu, odlazni na 0 — pa u sljedećem kadru animiraj.
        toEl.style.transition = 'none';
        toEl.style.transform = `translate3d(${dir * 100}%,0,0)`;
        toEl.style.visibility = '';
        toEl.style.pointerEvents = '';
        fromEl.style.transition = 'none';
        fromEl.style.transform = 'translate3d(0,0,0)';
        void viewportRef.current?.offsetWidth;        // reflow

        toEl.style.willChange = 'transform';
        fromEl.style.willChange = 'transform';
        toEl.style.transition = `transform ${DUR}s ${EASE}`;
        fromEl.style.transition = `transform ${DUR}s ${EASE}`;
        toEl.style.transform = 'translate3d(0,0,0)';
        fromEl.style.transform = `translate3d(${-dir * 100}%,0,0)`;
        toEl.classList.add('is-active');
        fromEl.classList.remove('is-active');

        const done = () => {
            toEl.removeEventListener('transitionend', done);
            if (myGen === gen.current) settle(to);
        };
        toEl.addEventListener('transitionend', done);
        window.setTimeout(done, DUR * 1000 + 90);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index]);

    // ── Gest: prstom vođeno prelistavanje ──
    useLayoutEffect(() => {
        const vp = viewportRef.current;
        if (!vp) return;
        const W = () => vp.clientWidth || window.innerWidth || 400;

        let sx = 0, sy = 0, lastX = 0, lastT = 0;
        let decided = false, active = false, horiz = false;
        let cur = -1, nbr = -1;

        const onStart = (e: TouchEvent) => {
            if (active || e.touches.length !== 1) return;
            if (isOverlayOpen()) return;                 // detalj/sheet otvoren — nije naš dodir
            const t = e.touches[0];
            if (t.clientX < 16) return;                  // krajnja lijeva ivica = sistemski „nazad"
            if ((e.target as HTMLElement)?.closest(NO_SWIPE)) return;
            sx = t.clientX; sy = t.clientY; lastX = sx; lastT = performance.now();
            decided = false; horiz = false; active = true;
            cur = rendered.current; nbr = -1;
        };

        const onMove = (e: TouchEvent) => {
            if (!active) return;
            const t = e.touches[0];
            const dx = t.clientX - sx, dy = t.clientY - sy;

            if (!decided) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                decided = true;
                horiz = Math.abs(dx) > Math.abs(dy);
                if (!horiz) { active = false; return; }  // okomito = skrol lista, pusti
                gen.current++;                            // preuzmi od bilo koje animacije u tijeku
                const curEl = getPane(cur);
                if (curEl) { curEl.style.transition = 'none'; curEl.style.willChange = 'transform'; }
            }
            if (!horiz) return;
            if (e.cancelable) e.preventDefault();
            lastX = t.clientX; lastT = performance.now();

            const want = dx > 0 ? cur - 1 : cur + 1;      // dx>0 → prethodni; dx<0 → sljedeći
            const has = want >= 0 && want < count;

            // Susjed se promijenio (npr. prst prešao preko starta u drugu stranu).
            if (want !== nbr) {
                if (nbr >= 0) park(nbr);
                nbr = has ? want : -1;
                if (nbr >= 0) {
                    const nEl = getPane(nbr);
                    if (nEl) {
                        nEl.style.transition = 'none';
                        nEl.style.willChange = 'transform';
                        nEl.style.visibility = '';
                        nEl.style.pointerEvents = 'none';
                    }
                }
            }

            const move = has ? dx : dx * 0.28;            // gumica na krajevima
            const curEl = getPane(cur);
            if (curEl) curEl.style.transform = `translate3d(${move}px,0,0)`;
            if (nbr >= 0) {
                const nEl = getPane(nbr);
                if (nEl) nEl.style.transform = `translate3d(${(nbr < cur ? -W() : W()) + move}px,0,0)`;
            }
        };

        const onEnd = (e: TouchEvent) => {
            if (!active) return;
            active = false;
            if (!decided || !horiz) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - sx;
            const vx = (t.clientX - lastX) / Math.max(1, performance.now() - lastT);
            const curEl = getPane(cur);
            const commit = nbr >= 0 && (Math.abs(dx) > W() * 0.3 || Math.abs(vx) > 0.4);
            const myGen = ++gen.current;

            if (commit) {
                const nEl = getPane(nbr);
                const dir = nbr < cur ? -1 : 1;           // kamo klizi tekući
                const target = nbr;
                haptic(6);
                if (curEl) {
                    curEl.style.transition = `transform ${DUR}s ${EASE}`;
                    curEl.style.transform = `translate3d(${-dir * W()}px,0,0)`;
                }
                if (nEl) {
                    nEl.style.transition = `transform ${DUR}s ${EASE}`;
                    nEl.style.transform = 'translate3d(0,0,0)';
                }
                rendered.current = target;
                const done = () => {
                    nEl?.removeEventListener('transitionend', done);
                    if (myGen !== gen.current) return;
                    settle(target);
                    onChange.current(target);
                };
                if (nEl) { nEl.addEventListener('transitionend', done); window.setTimeout(done, DUR * 1000 + 90); }
                else { settle(target); onChange.current(target); }
            } else {
                // Ispod praga — vrati na mjesto.
                if (curEl) {
                    curEl.style.transition = `transform ${DUR}s ${EASE}`;
                    curEl.style.transform = 'translate3d(0,0,0)';
                }
                const back = nbr;
                if (back >= 0) {
                    const nEl = getPane(back);
                    if (nEl) {
                        nEl.style.transition = `transform ${DUR}s ${EASE}`;
                        nEl.style.transform = `translate3d(${back < cur ? '-100%' : '100%'},0,0)`;
                    }
                }
                const done = () => {
                    curEl?.removeEventListener('transitionend', done);
                    if (myGen !== gen.current) return;
                    settle(cur);
                };
                if (curEl) { curEl.addEventListener('transitionend', done); window.setTimeout(done, DUR * 1000 + 90); }
                else settle(cur);
            }
        };

        vp.addEventListener('touchstart', onStart, { passive: true });
        vp.addEventListener('touchmove', onMove, { passive: false });
        vp.addEventListener('touchend', onEnd, { passive: true });
        vp.addEventListener('touchcancel', onEnd, { passive: true });
        return () => {
            vp.removeEventListener('touchstart', onStart);
            vp.removeEventListener('touchmove', onMove as EventListener);
            vp.removeEventListener('touchend', onEnd as EventListener);
            vp.removeEventListener('touchcancel', onEnd as EventListener);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count]);

    return (
        <div className="fld-pager" ref={viewportRef}>
            {panes.map(i => (
                <div
                    key={i}
                    className={`fld-pane${i === rendered.current ? ' is-active' : ''}`}
                    ref={el => { paneRefs.current[i] = el; }}
                    aria-hidden={i !== rendered.current}
                >
                    {renderPane(i)}
                </div>
            ))}
        </div>
    );
}
