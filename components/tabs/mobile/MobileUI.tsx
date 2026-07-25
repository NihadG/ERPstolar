'use client';

// ════════════════════════════════════════════════════════════════════
// MOBILNI UI PRIMITIVI (iOS-stil)
//
// Mali, bezlični gradivni blokovi za mobilne prikaze. Postoje da bi svi
// mobilni ekrani imali ISTU tipografiju, razmake i ponašanje — bez toga
// svaki ekran polako odluta u vlastiti izgled.
//
// Stil živi u MobileUI.css (prefiks `mui-`, odvojen od desktop klasa).
// ════════════════════════════════════════════════════════════════════

import { type ReactNode, type CSSProperties, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, X } from 'lucide-react';
import { useSwipeDismiss, usePullToRefresh } from './useSwipe';
import './MobileUI.css';

type Tone = 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'gray';

const toneClass = (t?: Tone) => (t && t !== 'gray' ? ` ${t}` : '');

/** Veliki naslov ekrana (iOS large title) + podnaslovni red. */
export function MLarge({ title, children }: { title: string; children?: ReactNode }) {
    return (
        <div className="mui-large">
            <h1>{title}</h1>
            {children && <p>{children}</p>}
        </div>
    );
}

/** Sekcijski naslov iznad grupirane liste; `action` je desni tekst-dugme. */
export function MSection({ title, right, action, onAction }: {
    title: ReactNode; right?: ReactNode; action?: string; onAction?: () => void;
}) {
    return (
        <div className="mui-shd">
            <span>{title}</span>
            {action ? <button type="button" className="mui-shd-act" onClick={onAction}>{action}</button> : right}
        </div>
    );
}

/** Grupirana lista. `lead` uvlači razdjelnik kad ćelije imaju avatar/ikonu. */
export function MList({ lead, children, style }: { lead?: boolean; children: ReactNode; style?: CSSProperties }) {
    return <div className={`mui-list${lead ? ' mui-lead' : ''}`} style={style}>{children}</div>;
}

/** Jedan red liste; djeca su sadržaj ćelije (i eventualni detalj ispod). */
export function MItem({ children }: { children: ReactNode }) {
    return <div className="mui-item">{children}</div>;
}

/**
 * Ćelija — osnovni red. Sadržaj se slaže lijevo→desno:
 * [ikona/checkbox] [naslov + podnaslov] [vrijednost] [chevron]
 */
export function MCell({ onClick, done, top, chevron, children }: {
    onClick?: () => void; done?: boolean; top?: boolean; chevron?: boolean; children: ReactNode;
}) {
    const cls = `mui-cell${onClick ? ' mui-tap' : ''}${done ? ' mui-done' : ''}${top ? ' mui-top' : ''}`;
    const body = <>{children}{chevron && <ChevronRight className="mui-chev" strokeWidth={2.6} />}</>;
    return onClick
        ? <button type="button" className={cls} onClick={onClick}>{body}</button>
        : <div className={cls}>{body}</div>;
}

/** Naslov + podnaslov ćelije (uvijek u koloni — sprječava preklapanje). */
export function MText({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
    return (
        <span className="mui-ctext">
            <span className="mui-ctitle">{title}</span>
            {sub != null && sub !== false && <span className="mui-csub">{sub}</span>}
        </span>
    );
}

/** Vrijednost na desnoj strani ćelije. */
export function MValue({ strong, num = true, children }: { strong?: boolean; num?: boolean; children: ReactNode }) {
    return <span className={`mui-cval${strong ? ' mui-strong' : ''}${num ? ' mui-num' : ''}`}>{children}</span>;
}

/** Status-pločica. */
export function MPill({ tone, children }: { tone?: Tone; children: ReactNode }) {
    return <span className={`mui-pill${toneClass(tone)}`}>{children}</span>;
}

/** Tačka statusa materijala. */
export function MDot({ kind }: { kind: 'need' | 'ord' | 'rdy' }) {
    return <span className={`mui-dot ${kind}`} />;
}

/** Avatar s inicijalima. */
export function MAvatar({ tone, children }: { tone?: Tone; children: ReactNode }) {
    return <span className={`mui-av${toneClass(tone)}`}>{children}</span>;
}

/** Ikonska pločica (kartice naloga/narudžbi). */
export function MIcon({ tone, children }: { tone?: Tone; children: ReactNode }) {
    return <span className={`mui-ic${toneClass(tone)}`}>{children}</span>;
}

/** Kartica entiteta — koristi se kad red nosi više od jednog podatka
 *  (naslov + status + napredak + akcija), jer se u zbijenoj listi stapaju. */
export function MCard({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
    return <div className="mui-ecard" onClick={onClick}>{children}</div>;
}

export function MCardHead({ children }: { children: ReactNode }) {
    return <div className="mui-ec-head">{children}</div>;
}

export function MCardBody({ name, meta }: { name: ReactNode; meta?: ReactNode }) {
    return (
        <div className="mui-ec-body">
            <span className="mui-ec-name">{name}</span>
            {meta && <span className="mui-ec-meta">{meta}</span>}
        </div>
    );
}

/** Traka napretka s natpisom desno. */
export function MProgress({ pct, tone, label, foot }: {
    pct: number; tone?: 'green' | 'orange'; label?: ReactNode; foot?: boolean;
}) {
    return (
        <div className={foot ? 'mui-ec-foot' : 'mui-ec-prog'}>
            <div className="mui-bar"><i className={tone || ''} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
            {label && <span className="mui-barl">{label}</span>}
        </div>
    );
}

/** Hero s gradijentom — napredak (namjerno NE novac). */
export function MHero({ kicker, value, chip, pct, green }: {
    kicker: string; value: ReactNode; chip?: ReactNode; pct?: number; green?: boolean;
}) {
    return (
        <div className={`mui-hero${green ? ' green' : ''}`}>
            <span className="mui-hero-k">{kicker}</span>
            <div className="mui-hero-row">
                <div className="mui-hero-v mui-num">{value}</div>
                {chip && <span className="mui-hero-chip">{chip}</span>}
            </div>
            {pct != null && <div className="mui-hero-bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>}
        </div>
    );
}

/** Segmentna kontrola. */
export function MSegmented<T extends string>({ value, options, onChange }: {
    value: T; options: { id: T; label: string }[]; onChange: (id: T) => void;
}) {
    return (
        <div className="mui-seg" role="tablist">
            {options.map(o => (
                <button key={o.id} type="button" role="tab" aria-selected={value === o.id}
                    className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/** Okrugli checkbox (procesi, prijem stavki, zadaci). */
export function MCheck({ on, blue, small, disabled, onClick, label }: {
    on: boolean; blue?: boolean; small?: boolean; disabled?: boolean; onClick?: () => void; label?: string;
}) {
    return (
        <button
            type="button"
            className={`mui-cbx${on ? ' on' : ''}${blue ? ' blue' : ''}${small ? ' sm' : ''}`}
            disabled={disabled}
            aria-pressed={on}
            aria-label={label}
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        >
            <Check strokeWidth={3.2} />
        </button>
    );
}

/** Puno dugme. */
export function MButton({ variant = 'tinted', disabled, onClick, children }: {
    variant?: 'filled' | 'tinted' | 'gfilled' | 'danger'; disabled?: boolean; onClick?: () => void; children: ReactNode;
}) {
    return (
        <button type="button" className={`mui-btn ${variant}`} disabled={disabled} onClick={onClick}>
            {children}
        </button>
    );
}

/** Red akcija (Pokreni / Pauziraj / Završi). */
export function MActions({ children }: { children: ReactNode }) {
    return <div className="mui-arow">{children}</div>;
}

export function MAction({ tone = 'tint', disabled, onClick, children }: {
    tone?: 'blue' | 'tint' | 'green' | 'gtint' | 'otint' | 'rtint'; disabled?: boolean; onClick?: () => void; children: ReactNode;
}) {
    return (
        <button type="button" className={`mui-abtn ${tone}`} disabled={disabled} onClick={onClick}>
            {children}
        </button>
    );
}

/** Vodoravni filter-čipovi. */
export function MChips<T extends string>({ value, options, onChange }: {
    value: T; options: { id: T; label: string; count?: number }[]; onChange: (id: T) => void;
}) {
    return (
        <div className="mui-chiprail">
            {options.map(o => (
                <button key={o.id || 'all'} type="button" className={`mui-chip${value === o.id ? ' on' : ''}`} onClick={() => onChange(o.id)}>
                    {o.label}
                    {o.count != null && <span className="mui-chip-n">{o.count}</span>}
                </button>
            ))}
        </div>
    );
}

/** Polje pretrage. */
export function MSearch({ value, onChange, placeholder }: {
    value: string; onChange: (v: string) => void; placeholder?: string;
}) {
    return (
        <div className="mui-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
            </svg>
            <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
            {value && (
                <button type="button" onClick={() => onChange('')} aria-label="Očisti"
                    style={{ border: 'none', background: 'none', padding: 0, display: 'flex', color: 'inherit', cursor: 'pointer' }}>
                    <X size={16} />
                </button>
            )}
        </div>
    );
}

/**
 * Bottom sheet — sve akcije koje traže izbor ili unos (sortiranje, dodavanje,
 * potvrde). Renderuje se u portal jer roditelji imaju `overflow: hidden`.
 */
export function MSheet({ open, title, onClose, children, footer }: {
    open: boolean; title?: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
    const sheetRef = useRef<HTMLDivElement>(null);
    // Povlačenje nadolje zatvara sheet (iOS navika) — hvata se samo na vrhu sadržaja.
    const dismiss = useSwipeDismiss(sheetRef, onClose, open);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [open, onClose]);

    if (!open || typeof document === 'undefined') return null;
    return createPortal(
        <div className="mui mui-sheet-wrap">
            <div className="mui-sheet-bg" onClick={onClose} style={{ opacity: dismiss.backdropOpacity }} />
            <div
                ref={sheetRef}
                className="mui-sheet"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                style={dismiss.style}
            >
                <div className="mui-grab" />
                {title && <h3>{title}</h3>}
                {children}
                {footer}
            </div>
        </div>,
        document.body
    );
}

/** Red izbora u sheetu (kvačica kad je odabran). */
export function MOption({ label, sub, selected, onClick }: {
    label: ReactNode; sub?: ReactNode; selected?: boolean; onClick?: () => void;
}) {
    return (
        <MItem>
            <MCell onClick={onClick}>
                <MText title={label} sub={sub} />
                {selected && <Check size={18} strokeWidth={3} color="var(--mui-blue)" />}
            </MCell>
        </MItem>
    );
}

/**
 * Povlačenje liste nadolje = osvježi. Renderuje indikator koji prati prst,
 * pa je jasno da se nešto dešava prije nego što se pusti.
 */
export function MPullToRefresh({ onRefresh, children }: { onRefresh: () => void | Promise<void>; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const { pull, busy } = usePullToRefresh(ref, onRefresh);
    const active = pull > 0 || busy;

    return (
        <div ref={ref} className="mui-ptr">
            {active && (
                <div className="mui-ptr-ind" style={{ height: busy ? 44 : pull }}>
                    <span
                        className={`mui-ptr-spin${busy ? ' busy' : ''}`}
                        style={busy ? undefined : { transform: `rotate(${pull * 3}deg)`, opacity: Math.min(1, pull / 60) }}
                    />
                </div>
            )}
            <div style={active && !busy ? { transform: `translateY(${pull}px)`, transition: 'none' } : undefined}>
                {children}
            </div>
        </div>
    );
}

/** Prazno stanje. */
export function MEmpty({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
    return (
        <div className="mui-empty">
            <span className="mui-empty-t">{title}</span>
            {sub && <span className="mui-empty-s">{sub}</span>}
            {children}
        </div>
    );
}
