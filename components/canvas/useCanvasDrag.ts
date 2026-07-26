'use client';

// ════════════════════════════════════════════════════════════════════
// useCanvasDrag — povlačenje blokova NATIVNIM pointer eventima.
//
// Zašto ne @hello-pangea/dnd (koji je već u projektu): to je biblioteka za LISTE
// i table. Ne zna razvlačiti ivicu, ne zna piksel-precizan pomak po vremenskoj osi,
// i traži Droppable/Draggable omotače. Upravo zato je u starom planeru mrtva —
// DragDropContext postoji, ali nijedan Draggable nikad nije renderovan.
//
// setPointerCapture rješava ono zbog čega ručni drag obično puca: miš izađe iz
// elementa, ili se pusti izvan prozora — događaji i dalje stižu ovom elementu.
//
// PERFORMANSE: tokom povlačenja se NE dispatch-uje u reducer (to bi bio re-render
// cijelog platna na svaki piksel). Mijenja se samo lokalni `preview`, a u reducer
// ide JEDNA akcija na pointerup — što je ujedno i jedan korak undo-a.
// ════════════════════════════════════════════════════════════════════

import { useState, useRef, useCallback } from 'react';
import type { PlanZoom } from '@/lib/types';
import { daysForDelta } from '@/lib/canvas/geometry';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export interface DragPreview {
    blockId: string;
    mode: DragMode;
    /** Pomak u DANIMA (već zaokružen na dan). */
    deltaDays: number;
    /** Red iznad kojeg je pokazivač — za prebacivanje u drugi red. */
    overRowId: string | null;
}

export interface DragCommit {
    blockId: string;
    mode: DragMode;
    deltaDays: number;
    fromRowId: string;
    overRowId: string | null;
}

interface DragSession {
    blockId: string;
    mode: DragMode;
    startX: number;
    fromRowId: string;
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
    // Shift privremeno isključuje lijepljenje na dan (fino pomjeranje nije potrebno,
    // ali korisnici to očekuju pa se bar ne opire).
    const freeMove = useRef(false);

    const finish = useCallback((commit: boolean) => {
        const s = session.current;
        if (!s) return;
        try { s.target.releasePointerCapture(s.pointerId); } catch { /* već pušten */ }
        session.current = null;

        setPreview(prev => {
            if (commit && prev && s.moved && prev.deltaDays !== 0) {
                onCommit({
                    blockId: s.blockId,
                    mode: s.mode,
                    deltaDays: prev.deltaDays,
                    fromRowId: s.fromRowId,
                    overRowId: prev.overRowId,
                });
            } else if (commit && !s.moved) {
                onClick?.(s.blockId);
            }
            return null;
        });
    }, [onCommit, onClick]);

    const onPointerDown = useCallback((
        e: React.PointerEvent<HTMLElement>,
        blockId: string,
        rowId: string,
        mode: DragMode
    ) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        session.current = {
            blockId, mode, startX: e.clientX, fromRowId: rowId,
            pointerId: e.pointerId, target, moved: false,
        };
        freeMove.current = e.shiftKey;
        setPreview({ blockId, mode, deltaDays: 0, overRowId: rowId });
    }, [disabled]);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const s = session.current;
        if (!s) return;
        const dx = e.clientX - s.startX;
        // Prag od 3px: bez njega svaki klik postane mikro-pomak od 0 dana koji
        // ipak proguta `onClick` i selekcija prestane raditi.
        if (!s.moved && Math.abs(dx) < 3) return;
        s.moved = true;

        freeMove.current = e.shiftKey;
        const days = daysForDelta(dx, zoom);

        // Red ispod pokazivača — čita se iz data-atributa, bez mjerenja svih redova.
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const overRowId = el?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId || null;

        setPreview(prev => (prev && prev.deltaDays === days && prev.overRowId === overRowId)
            ? prev                                  // isti dan i red → bez re-rendera
            : { blockId: s.blockId, mode: s.mode, deltaDays: days, overRowId });
    }, [zoom]);

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
