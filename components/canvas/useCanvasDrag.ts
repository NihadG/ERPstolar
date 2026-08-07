'use client';

// ════════════════════════════════════════════════════════════════════
// useCanvasDrag — povlačenje blokova NATIVNIM pointer eventima.
//
// KLJUČNA POUKA (bug koji je dugo izmицао): `onCommit` (koji dispatch-uje pomjeranje)
// NIKAD ne smije biti unutar `setPreview(prev => …)` updatera. React StrictMode (koji
// Next.js dev uključuje) DVAPUT poziva svaki state-updater da otkrije nečistoće — pa
// se dispatch okidao dvaput i blok se pomjerao 2× (otud „padne nekoliko dana dalje").
// Updater mora biti ČIST; sve nuspojave (onCommit/onClick) idu IZVAN njega, jednom.
//
// Piksela-po-danu se MJERI iz DOM-a reda (getBoundingClientRect ÷ offsetWidth), pa su
// pomak miša (ekranski px) i širina dana u istom sistemu — otporno na CSS skalu/zum.
//
// setPointerCapture drži događaje na bloku i kad miš izađe iz njega ili se pusti izvan
// prozora. Tokom povlačenja se NE dispatch-uje (samo lokalni preview); u reducer ide
// JEDNA akcija na pointerup = jedan korak undo-a.
// ════════════════════════════════════════════════════════════════════

import { useState, useRef, useCallback } from 'react';
import type { PlanZoom } from '@/lib/types';
import { dayWidth } from '@/lib/canvas/geometry';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export interface DragPreview {
    blockId: string;
    mode: DragMode;
    /** Pomak u DANIMA (zaokružen). Preview i commit koriste ISTU vrijednost. */
    deltaDays: number;
}

export interface DragCommit {
    blockId: string;
    mode: DragMode;
    deltaDays: number;
}

interface DragSession {
    blockId: string;
    mode: DragMode;
    startX: number;
    /** Ekranskih piksela po danu — izmjereno iz DOM-a (otporno na CSS skalu). */
    pxPerDay: number;
    lastDx: number;
    lastDays: number;
    pointerId: number;
    target: HTMLElement;
    moved: boolean;
}

export interface UseCanvasDragOptions {
    zoom: PlanZoom;
    onCommit: (commit: DragCommit) => void;
    /** Klik bez pomjeranja = selekcija, ne pomak. */
    onClick?: (blockId: string) => void;
    disabled?: boolean;
}

export function useCanvasDrag({ zoom, onCommit, onClick, disabled }: UseCanvasDragOptions) {
    const [preview, setPreview] = useState<DragPreview | null>(null);
    const session = useRef<DragSession | null>(null);

    const finish = useCallback((commit: boolean) => {
        const s = session.current;
        if (!s) return;
        try { s.target.releasePointerCapture(s.pointerId); } catch { /* već pušten */ }
        session.current = null;
        setPreview(null);                       // čist state-update, bez nuspojava

        // Nuspojave IZVAN updatera → tačno jednom (StrictMode ne udvaja ovo).
        if (!commit) return;
        if (s.moved && s.lastDays !== 0) {
            onCommit({ blockId: s.blockId, mode: s.mode, deltaDays: s.lastDays });
        } else if (!s.moved) {
            onClick?.(s.blockId);
        }
    }, [onCommit, onClick]);

    const onPointerDown = useCallback((
        e: React.PointerEvent<HTMLElement>,
        blockId: string,
        rowId: string,
        mode: DragMode
    ) => {
        void rowId;   // red se više ne mijenja povlačenjem (radi se u detaljima)
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);

        // Izmjeri ekranskih piksela po danu iz stvarne trake reda.
        let pxPerDay = dayWidth(zoom);
        const lane = target.closest<HTMLElement>('.cv-row-lane');
        if (lane) {
            const rect = lane.getBoundingClientRect();
            const cssW = lane.offsetWidth || rect.width;
            if (cssW > 0) pxPerDay = dayWidth(zoom) * (rect.width / cssW);
        }
        if (!(pxPerDay > 0)) pxPerDay = dayWidth(zoom);

        session.current = {
            blockId, mode, startX: e.clientX, pxPerDay, lastDx: 0, lastDays: 0,
            pointerId: e.pointerId, target, moved: false,
        };
        setPreview({ blockId, mode, deltaDays: 0 });
    }, [disabled, zoom]);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const s = session.current;
        if (!s) return;
        const dx = e.clientX - s.startX;
        s.lastDx = dx;
        // Prag od 3px: bez njega svaki klik postane mikro-pomak od 0 dana koji
        // ipak proguta `onClick` i selekcija prestane raditi.
        if (!s.moved && Math.abs(dx) < 3) return;
        s.moved = true;

        const days = Math.round(dx / s.pxPerDay);
        s.lastDays = days;
        setPreview(prev => (prev && prev.deltaDays === days)
            ? prev                                  // isti dan → bez re-rendera
            : { blockId: s.blockId, mode: s.mode, deltaDays: days });
    }, []);

    const onPointerUp = useCallback(() => finish(true), [finish]);

    /** Esc otkazuje povlačenje u toku — vraća blok bez ijedne izmjene. */
    const cancel = useCallback(() => finish(false), [finish]);

    return {
        preview,
        isDragging: preview !== null,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: cancel,
        cancel,
    };
}
