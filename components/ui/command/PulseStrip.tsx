'use client';

// ════════════════════════════════════════════════════════════════════
// PULS — šest brojki koje su ujedno i filteri
//
// Klik ne vodi nikuda: cijela strana se suzi na to pitanje. Zato je ovo
// dugme s aria-pressed, a ne link — stanje ostaje vidljivo dok traje.
// ════════════════════════════════════════════════════════════════════

import type { LensId, Signal } from '@/lib/command/signals';

export default function PulseStrip({
    signals, lens, onLens,
}: {
    signals: Signal[];
    lens: LensId | null;
    onLens: (lens: LensId | null) => void;
}) {
    return (
        <div className="kc-pulse" role="group" aria-label="Puls projekata — brojke su ujedno i filteri">
            {signals.map(signal => {
                const hot = signal.count > 0;
                return (
                    <button
                        type="button"
                        key={signal.id}
                        className={`kc-pulse-cell ${signal.tone} ${hot ? 'hot' : 'cool'}`}
                        aria-pressed={lens === signal.id}
                        title={`${signal.hint} — klik filtrira cijelu stranu`}
                        onClick={() => onLens(lens === signal.id ? null : signal.id)}
                    >
                        <span>{signal.label}</span>
                        <strong>{signal.count}</strong>
                        <small>{lens === signal.id ? 'Filter uključen · klik gasi' : signal.hint}</small>
                    </button>
                );
            })}
        </div>
    );
}
