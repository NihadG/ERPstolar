'use client';

// ════════════════════════════════════════════════════════════════════
// CanvasTimeSlider — suptilni horizontalni klizač kroz vrijeme.
//
// Platno je virtuelno (nema pravog horizontalnog scrolla — pomjeranje je promjena
// „anchor" datuma na lijevoj ivici). Ovaj klizač daje brzo skrolanje po cijelom
// rasponu plana bez strelica: pozicija ručke = anchorISO, raspon = granice plana.
// ════════════════════════════════════════════════════════════════════

import { addDays, diffDays } from '@/lib/canvas/model';

interface CanvasTimeSliderProps {
    /** Najraniji datum do kojeg klizač seže (lijevo). */
    fromISO: string;
    /** Najkasniji datum (desno). */
    toISO: string;
    /** Trenutna lijeva ivica prikaza. */
    anchorISO: string;
    onScrub: (iso: string) => void;
}

export default function CanvasTimeSlider({ fromISO, toISO, anchorISO, onScrub }: CanvasTimeSliderProps) {
    const total = Math.max(1, diffDays(fromISO, toISO));
    const value = Math.min(total, Math.max(0, diffDays(fromISO, anchorISO)));

    return (
        <div className="cv-timeslider" role="group" aria-label="Pomjeranje kroz vrijeme">
            <input
                type="range"
                min={0}
                max={total}
                step={1}
                value={value}
                aria-label="Klizač vremena"
                onChange={e => onScrub(addDays(fromISO, Number(e.target.value)))}
            />
        </div>
    );
}
