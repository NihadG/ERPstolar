'use client';

// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — ZAJEDNIČKI DIJELOVI
//
// Boja projekta se NE bira ovdje: dolazi iz lib/canvas/palette, ista koju
// Platno već koristi. Postavlja se kao CSS varijable na nosioca grupe, pa
// je svako dijete (traka, ceduljica, čip) naslijedi — tako isti projekat
// izgleda isto u kalendaru, u listi proizvoda i na zidu zadataka.
// ════════════════════════════════════════════════════════════════════

import {
    createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
    type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { projectColors } from '@/lib/canvas/palette';
import type { PanelId } from '@/lib/command/layout';

/** CSS varijable boje projekta — stavi ih na element koji obuhvata grupu. */
export function hue(projectId: string | undefined | null): CSSProperties {
    const colors = projectColors(projectId);
    return { '--kc-ink': colors.ink, '--kc-bar': colors.bar, '--kc-txt': colors.txt } as CSSProperties;
}

// ── Kartica s tabovima ──────────────────────────────────────────────
// Pet ploča jedna ispod druge, svaka sa svojim zaglavljem, pretragom i
// dugmadima, bilo je „nabacano": oko nije znalo gdje da stane. Sada su
// ploče složene u DVIJE kartice — lijevo ono što se pravi (proizvodi,
// nalozi), desno ono što se prati (narudžbe, zadaci, napomene) — i u
// svakoj se vidi jedna ploča. Broj na tabu kaže gdje ima posla, pa se ne
// mora otvarati svaki tab da bi se to saznalo.
//
// Brojeve računa SAMA ploča (ista leća, isti filteri kao lista), a ne
// kartica — inače bi broj na tabu i dužina liste znali da se ne slože.
// Ploča ih javlja kroz kontekst; neaktivna ploča i dalje računa, samo se
// ne crta.

interface PaneMeta { count?: number; tone?: 'alert' }

interface TabHost {
    active: PanelId;
    report: (id: PanelId, meta: PaneMeta) => void;
    /** Desni kraj trake s tabovima — tu aktivna ploča stavlja „+ Novo". */
    slot: HTMLElement | null;
}

const TabHostContext = createContext<TabHost | null>(null);

export interface KcTab { id: PanelId; label: string }

export function KcTabCard({
    label, tabs, active, onSelect, children,
}: {
    /** Ime grupe za čitače ekrana, npr. „Proizvodnja". */
    label: string;
    tabs: KcTab[];
    active: PanelId;
    onSelect: (id: PanelId) => void;
    children: ReactNode;
}) {
    const [meta, setMeta] = useState<Partial<Record<PanelId, PaneMeta>>>({});
    const report = useCallback((id: PanelId, next: PaneMeta) => setMeta(prev => {
        const old = prev[id];
        if (old && old.count === next.count && old.tone === next.tone) return prev;
        return { ...prev, [id]: next };
    }), []);
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    const host = useMemo(() => ({ active, report, slot }), [active, report, slot]);

    // Strelice lijevo/desno idu kroz tabove, kao u svakom tablistu.
    const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const index = tabs.findIndex(t => t.id === active);
        const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        onSelect(next.id);
        document.getElementById(`kc-tab-${next.id}`)?.focus();
    };

    return (
        <div className="kc-card kc-tabcard" data-card={tabs.map(t => t.id).join(' ')}>
            <div className="kc-tabbar">
                <div className="kc-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
                    {tabs.map(tab => {
                        const info = meta[tab.id];
                        const selected = tab.id === active;
                        return (
                            <button
                                type="button"
                                key={tab.id}
                                id={`kc-tab-${tab.id}`}
                                role="tab"
                                className="kc-tab"
                                aria-selected={selected}
                                aria-controls={`kc-pane-${tab.id}`}
                                tabIndex={selected ? 0 : -1}
                                onClick={() => onSelect(tab.id)}
                            >
                                {tab.label}
                                {typeof info?.count === 'number' && (
                                    <span className={`kc-tab-count${info.tone === 'alert' ? ' alert' : ''}`}>{info.count}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
                <div className="kc-tabs-end" ref={setSlot} />
            </div>
            <TabHostContext.Provider value={host}>{children}</TabHostContext.Provider>
        </div>
    );
}

/**
 * Ploča table. Stoji ili sama (kalendar — kartica sa zaglavljem koje se
 * može sklopiti, i tada pokazuje SAŽETAK, npr. „1 kasni · 2 danas"), ili
 * kao tab u kartici (KcTabCard) — tada nema svoje zaglavlje: kreiranje ide
 * u desni kraj trake s tabovima, a pretraga i prekidači u red ispod nje.
 */
export function KcPanel({
    id, title, count, countTone, actions, create, summary, children,
    collapsed, onCollapse, pinned, onPin,
}: {
    id: PanelId;
    /** Zastarjelo — nadnaslovi su uklonjeni; prop ostaje da pozivi ne pucaju. */
    eyebrow?: string;
    title: string;
    count?: number;
    countTone?: 'alert';
    /** Kontrole prikaza (pretraga, prekidači) — samo kad je ploča otvorena. */
    actions?: ReactNode;
    /** Kreiranje — vidljivo i kad je ploča sklopljena. */
    create?: ReactNode;
    /** Jedan red stanja za sklopljenu ploču. */
    summary?: ReactNode;
    children: ReactNode;
    collapsed?: boolean;
    onCollapse?: () => void;
    pinned?: boolean;
    onPin?: () => void;
}) {
    const host = useContext(TabHostContext);
    const tone = countTone === 'alert' && (count ?? 0) > 0 ? 'alert' as const : undefined;
    useLayoutEffect(() => {
        host?.report(id, { count, tone });
    }, [host, id, count, tone]);

    if (host) {
        if (host.active !== id) return null;
        // Sažetak ide samo uz alate (pretraga, prekidači). Ploča bez alata
        // ionako grupiše po stanju („Kasni 1", „Poslano 2"), pa bi sažetak
        // u posebnom redu samo ponovio ono što piše ispod njega.
        return (
            <section className="kc-pane" id={`kc-pane-${id}`} role="tabpanel" aria-label={title} data-panel={id}>
                {create && host.slot && createPortal(<div className="kc-pane-create">{create}</div>, host.slot)}
                {actions && (
                    <div className="kc-pane-tools">
                        {actions}
                        {summary && <div className="kc-pane-summary">{summary}</div>}
                    </div>
                )}
                <div className="kc-panel-content">{children}</div>
            </section>
        );
    }

    const bodyId = `kc-panel-${id}`;
    return (
        <section
            className="kc-panel kc-card"
            data-panel={id}
            data-collapsed={collapsed ? 'true' : undefined}
            data-pinned={pinned ? 'true' : undefined}
            aria-label={title}
        >
            <div className="kc-panel-head">
                <div className="kc-panel-titles">
                    <h2>
                        {onCollapse ? (
                            <button
                                type="button"
                                className="kc-panel-toggle"
                                aria-expanded={!collapsed}
                                aria-controls={collapsed ? undefined : bodyId}
                                title={collapsed ? 'Otvori ploču' : 'Sklopi ploču'}
                                onClick={onCollapse}
                            >
                                <ChevronDown size={15} className="kc-panel-chev" aria-hidden />
                                {title}
                            </button>
                        ) : title}
                        {typeof count === 'number' && <span className={`kc-count${countTone === 'alert' && count > 0 ? ' alert' : ''}`}>{count}</span>}
                    </h2>
                </div>
                {collapsed && summary && <div className="kc-panel-summary">{summary}</div>}
                <div className="kc-panel-head-actions">
                    {!collapsed && actions}
                    {create}
                    {onPin && !collapsed && (
                        <button
                            type="button"
                            className="kc-icon-btn kc-pin"
                            aria-pressed={!!pinned}
                            aria-label={pinned ? `Vrati širinu: ${title}` : `Raširi: ${title}`}
                            title={pinned ? 'Vrati uobičajenu širinu' : 'Raširi — ova kolona dobija više mjesta'}
                            onClick={onPin}
                        >
                            {pinned ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                        </button>
                    )}
                </div>
            </div>
            {!collapsed && <div className="kc-panel-content" id={bodyId}>{children}</div>}
        </section>
    );
}

/** Tihi sažetak u zaglavlju sklopljene ploče — crveno samo za ono što kasni. */
export function SummaryBits({ bits }: { bits: { label: string; tone?: 'alert' | 'warn' }[] }) {
    const shown = bits.filter(b => b.label);
    if (shown.length === 0) return null;
    return (
        <>
            {shown.map(bit => (
                <span key={bit.label} className={`kc-sum${bit.tone ? ` ${bit.tone}` : ''}`}>{bit.label}</span>
            ))}
        </>
    );
}

// ── Meni za kreiranje ───────────────────────────────────────────────

export interface CreateMenuItem {
    id: string;
    label: string;
    /** Boja projekta za tačku ispred naziva. */
    projectId?: string;
    /** Kratko stanje s desne strane, npr. „12 fali". */
    hint?: string;
    disabled?: boolean;
    /** Stavka odvojena crtom na dnu (npr. „Sve što fali na tabli"). */
    footer?: boolean;
}

/**
 * Dugme koje pravi nešto ZA PROJEKAT. Kad je na tabli samo jedan projekat,
 * nema pitanja — radi odmah. Kad ih je više, otvara spisak projekata sa
 * stanjem koje pomaže izboru („2 bez naloga", „12 fali").
 *
 * Spisak ide kroz portal: ploče režu sadržaj po zaobljenim ivicama, pa bi
 * meni otvoren unutar ploče bio odsječen.
 */
export function CreateMenu({
    label, icon, items, onPick, variant = 'default', heading, ariaLabel, title,
}: {
    label: ReactNode;
    icon?: ReactNode;
    items: CreateMenuItem[];
    onPick: (id: string) => void;
    variant?: 'primary' | 'default' | 'dock';
    heading?: string;
    ariaLabel?: string;
    title?: string;
}) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number; minWidth: number; up: boolean } | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const enabled = items.filter(i => !i.disabled);
    const direct = items.length === 1;

    useLayoutEffect(() => {
        if (!open || !buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const width = Math.max(rect.width, 260);
        const below = rect.bottom + 6;
        // Dugme u donjoj traci otvara meni PREMA GORE.
        const up = variant === 'dock' || below + 320 > window.innerHeight;
        setPos({
            top: up ? rect.top - 6 : below,
            left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
            minWidth: width,
            up,
        });
    }, [open, variant]);

    useEffect(() => {
        if (!open) return;
        menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        const close = (e: Event) => {
            const target = e.target as Node;
            if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
                next?.focus();
            }
        };
        // Meni stoji na fiksnoj poziciji — kad se strana pomjeri, zatvara se
        // umjesto da ostane lebdjeti pored dugmeta koje je otišlo.
        const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false); };
        const onResize = () => setOpen(false);
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [open]);

    const pick = (id: string) => { setOpen(false); onPick(id); };

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                className={`kc-create ${variant}`}
                aria-haspopup={direct ? undefined : 'menu'}
                aria-expanded={direct ? undefined : open}
                aria-label={ariaLabel}
                title={title}
                disabled={enabled.length === 0}
                onClick={() => (direct ? pick(items[0].id) : setOpen(v => !v))}
            >
                {icon}
                <span>{label}</span>
                {!direct && <ChevronDown size={13} className="kc-create-caret" aria-hidden />}
            </button>
            {open && pos && typeof document !== 'undefined' && createPortal(
                <div
                    ref={menuRef}
                    className={`kc-menu${pos.up ? ' up' : ''}`}
                    role="menu"
                    aria-label={heading || (typeof label === 'string' ? label : undefined)}
                    style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
                >
                    {heading && <div className="kc-menu-head">{heading}</div>}
                    {items.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            className={`kc-menu-item${item.footer ? ' footer' : ''}`}
                            style={item.projectId ? hue(item.projectId) : undefined}
                            disabled={item.disabled}
                            onClick={() => pick(item.id)}
                        >
                            {item.projectId && <span className="kc-group-dot" aria-hidden />}
                            <span className="kc-menu-label">{item.label}</span>
                            {item.hint && <span className="kc-menu-hint">{item.hint}</span>}
                        </button>
                    ))}
                </div>,
                document.body,
            )}
        </>
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
