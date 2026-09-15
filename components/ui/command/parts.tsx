'use client';

// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — ZAJEDNIČKI DIJELOVI
//
// Boja projekta se NE bira ovdje: dolazi iz lib/canvas/palette, ista koju
// Platno već koristi. Postavlja se kao CSS varijable na nosioca grupe, pa
// je svako dijete (traka, ceduljica, čip) naslijedi — tako isti projekat
// izgleda isto u kalendaru, u listi proizvoda i na zidu zadataka.
// ════════════════════════════════════════════════════════════════════

import type { CSSProperties, ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { projectColors } from '@/lib/canvas/palette';

/** CSS varijable boje projekta — stavi ih na element koji obuhvata grupu. */
export function hue(projectId: string | undefined | null): CSSProperties {
    const colors = projectColors(projectId);
    return { '--kc-ink': colors.ink, '--kc-bar': colors.bar, '--kc-txt': colors.txt } as CSSProperties;
}

export function KcPanel({
    id, eyebrow, title, count, countTone, actions, children, solo, onSolo, wide,
}: {
    id: string;
    eyebrow?: string;
    title: string;
    count?: number;
    countTone?: 'alert';
    actions?: ReactNode;
    children: ReactNode;
    solo?: string | null;
    onSolo?: (id: string | null) => void;
    /** Zid ceduljica u više kolona kad ploča zauzme punu širinu. */
    wide?: boolean;
}) {
    const isSolo = solo === id;
    return (
        <section className="kc-panel" data-panel={id} data-wide={wide ? 'true' : undefined} aria-label={title}>
            <div className="kc-panel-head">
                <div>
                    {eyebrow && <span className="kc-eyebrow">{eyebrow}</span>}
                    <h2>
                        {title}
                        {typeof count === 'number' && <span className={`kc-count${countTone === 'alert' && count > 0 ? ' alert' : ''}`}>{count}</span>}
                    </h2>
                </div>
                <div className="kc-panel-head-actions">
                    {actions}
                    {onSolo && (
                        <button
                            type="button"
                            className="kc-icon-btn"
                            aria-label={isSolo ? 'Vrati raspored' : `Proširi: ${title}`}
                            title={isSolo ? 'Vrati raspored' : 'Proširi na cijelu širinu'}
                            onClick={() => onSolo(isSolo ? null : id)}
                        >
                            {isSolo ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                        </button>
                    )}
                </div>
            </div>
            {children}
        </section>
    );
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
    return (
        <div className="kc-empty">
            {icon}
            <p>{title}</p>
            {hint && <span>{hint}</span>}
            {action}
        </div>
    );
}

/** Kratak, čitljiv datum bez godine kad je tekuća — manje šuma u gustim redovima. */
export function shortDate(iso?: string, today?: string): string {
    if (!iso) return '';
    const [year, month, day] = iso.slice(0, 10).split('-');
    if (!day) return iso;
    const sameYear = today ? today.slice(0, 4) === year : false;
    return sameYear ? `${Number(day)}.${Number(month)}.` : `${Number(day)}.${Number(month)}.${year}.`;
}

export function qty(value: number, unit?: string): string {
    return `${value.toLocaleString('bs-BA', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
}

/**
 * Bosanska množina: 1 stavka · 2 stavke · 5 stavki. Brojevi 11–14 su izuzetak
 * (11 stavki, ne „11 stavka"), zato provjera ide i po ostatku sa 100.
 */
export function plural(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}
