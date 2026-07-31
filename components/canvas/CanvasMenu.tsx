'use client';

// ════════════════════════════════════════════════════════════════════
// CanvasMenu — mali stilizovani popover meni.
//
// Zamjenjuje nativni <select> (čiji se popup NE može stilizovati, pa izgleda
// tuđe) i služi kao „⋯ još" overflow meni. Zatvara se na klik izvan, Escape i
// na izbor stavke. Pozicionira se ispod okidača, poravnat lijevo ili desno.
// ════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface MenuItem {
    key: string;
    label: string;
    icon?: ReactNode;
    onClick?: () => void;
    active?: boolean;      // radio-stil: kvačica na izabranom
    danger?: boolean;
    divider?: boolean;     // razdjelnik PRIJE ove stavke
    disabled?: boolean;
    badge?: number;
}

interface CanvasMenuProps {
    /** Render okidača; prima trenutno stanje (otvoren?). */
    trigger: (open: boolean) => ReactNode;
    items: MenuItem[];
    align?: 'left' | 'right';
    title?: string;
}

export default function CanvasMenu({ trigger, items, align = 'left', title }: CanvasMenuProps) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div className="cv-menu-wrap" ref={wrapRef}>
            <div onClick={() => setOpen(o => !o)}>{trigger(open)}</div>
            {open && (
                <div className={`cv-menu ${align === 'right' ? 'right' : 'left'}`} role="menu">
                    {title && <div className="cv-menu-title">{title}</div>}
                    {items.map(it => (
                        <div key={it.key}>
                            {it.divider && <div className="cv-menu-divider" />}
                            <button
                                className={`cv-menu-item${it.active ? ' active' : ''}${it.danger ? ' danger' : ''}`}
                                disabled={it.disabled}
                                onClick={() => { if (it.disabled) return; it.onClick?.(); setOpen(false); }}
                                role="menuitem">
                                <span className="cv-menu-ico">{it.icon}</span>
                                <span className="cv-menu-lbl">{it.label}</span>
                                {it.badge !== undefined && it.badge > 0 && (
                                    <span className="cv-menu-badge">{it.badge}</span>
                                )}
                                {it.active && <Check size={14} className="cv-menu-check" />}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
