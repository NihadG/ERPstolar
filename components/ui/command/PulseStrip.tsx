'use client';

// ════════════════════════════════════════════════════════════════════
// PULS — šest brojki koje su ujedno i filteri
//
// Klik ne vodi nikuda: cijela strana se suzi na to pitanje (i otvori se
// tab na kojem je odgovor). Zato je ovo dugme s aria-pressed, a ne link —
// stanje ostaje vidljivo dok traje.
//
// Kartica nosi samo naziv, broj i ikonu; objašnjenje je u opisu (title).
// Dugi opisi ispod svake brojke su bili dio „nabacanog" utiska.
// ════════════════════════════════════════════════════════════════════

import { Activity, AlarmClock, Ban, ListTodo, MessageCircleQuestion, ShoppingCart, X, type LucideIcon } from 'lucide-react';
import type { LensId, Signal } from '@/lib/command/signals';

const ICON: Record<LensId, LucideIcon> = {
    late: AlarmClock,
    blocked: Ban,
    toOrder: ShoppingCart,
    running: Activity,
    tasks: ListTodo,
    awaiting: MessageCircleQuestion,
};

export default function PulseStrip({
    signals, lens, onLens,
}: {
    signals: Signal[];
    lens: LensId | null;
    onLens: (lens: LensId | null) => void;
}) {
    return (
        <div className={`kc-kpis${lens ? ' filtering' : ''}`} role="group" aria-label="Puls projekata — brojke su ujedno i filteri">
            {signals.map(signal => {
                const hot = signal.count > 0;
                const on = lens === signal.id;
                const Icon = ICON[signal.id];
                return (
                    <button
                        type="button"
                        key={signal.id}
                        className={`kc-kpi ${signal.tone} ${hot ? 'hot' : 'cool'}`}
                        aria-pressed={on}
                        title={`${signal.hint} — ${on ? 'klik gasi filter' : 'klik filtrira cijelu stranu'}`}
                        onClick={() => onLens(on ? null : signal.id)}
                    >
                        <span className="kc-kpi-label">{signal.label}</span>
                        <strong className="kc-kpi-num">{signal.count}</strong>
                        <span className="kc-kpi-icon" aria-hidden><Icon size={16} strokeWidth={2.2} /></span>
                        {on && <span className="kc-kpi-on"><X size={11} strokeWidth={2.6} aria-hidden /> Filter</span>}
                    </button>
                );
            })}
        </div>
    );
}
