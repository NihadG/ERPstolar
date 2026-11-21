// ════════════════════════════════════════════════════════════════════
// Mjerenje teksta za natpise platna (canvas measureText, keširano).
//
// Natpis trake se skraćuje na granici riječi (lib/canvas/label.ts), pa mora
// znati koliko je riječ široka U FONTU APLIKACIJE. CSS `text-overflow` siječe
// usred riječi — to je bio „Ogledalo (iste sob".
// ════════════════════════════════════════════════════════════════════

import type { MeasureText } from '@/lib/canvas/label';

let ctx: CanvasRenderingContext2D | null = null;
let family = '';
const cache = new Map<string, number>();

/** Isprazni keš (nakon što se učita pravi font). */
export function resetTextMeasure(): void {
    cache.clear();
    family = '';
}

export const measureText: MeasureText = (text, weight, px) => {
    // Na serveru nema canvasa — gruba procjena (zamijeni je prvi render u pregledniku).
    if (typeof document === 'undefined') return text.length * px * 0.56;
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return text.length * px * 0.56;
    if (!family) family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    const key = `${weight}|${px}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    ctx.font = `${weight} ${px}px ${family}`;
    const w = ctx.measureText(text).width;
    cache.set(key, w);
    return w;
};
