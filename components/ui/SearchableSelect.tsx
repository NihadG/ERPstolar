import { useState, useRef, useEffect, useMemo, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { searchTokens, matchesSearch, highlightRanges } from '@/lib/searchMatch';

// ════════════════════════════════════════════════════════════════════
// PRETRAŽIVI IZBORNIK
//
// Okidač zadržava stare klase (.searchable-select-trigger / .trigger-text),
// jer ih ekrani prilagođavaju svojim stilom. Padajuća lista je, međutim,
// imala GENERIČKE globalne klase (.dropdown-item, .check-icon, .item-badge)
// koje postoje i u DropdownMenu.css, OrdersTab.css i TasksTab.css — pa su se
// stilovi sudarali u oba smjera: opcije su bile centrirane s rupom od 10px
// između naziva i podnaslova, a kvačice u tabu Zadaci su „letjele" dok je
// bilo koji izbornik bio otvoren. Sve unutar liste sada nosi prefiks ssel-.
// ════════════════════════════════════════════════════════════════════

interface Option {
    value: string;
    label: string;
    subLabel?: string;
    badge?: { text: string; tone?: 'active' | 'neutral' };  // small status pill next to the label in the dropdown list
}

interface SearchableSelectProps {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
}

/** Lista nikad uža od ovoga — uski okidač ne smije zgnječiti nazive opcija. */
const MENU_MIN_WIDTH = 320;
const MENU_MAX_HEIGHT = 340;
const EDGE = 8;

function Highlight({ text, tokens }: { text: string; tokens: string[] }): ReactNode {
    const ranges = highlightRanges(text, tokens);
    if (ranges.length === 0) return text;
    const out: ReactNode[] = [];
    let at = 0;
    ranges.forEach(([s, e], i) => {
        if (s > at) out.push(text.slice(at, s));
        out.push(<mark key={i} className="ssel-hit">{text.slice(s, e)}</mark>);
        at = e;
    });
    if (at < text.length) out.push(text.slice(at));
    return <>{out}</>;
}

export function SearchableSelect({ options, value, onChange, placeholder = 'Pretraži...', label }: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [active, setActive] = useState(0);
    // Otvorena prema gore lista se sidri DONJOM ivicom (bottom), da s malo opcija
    // ne visi s razmakom iznad okidača.
    const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const tokens = useMemo(() => searchTokens(searchQuery), [searchQuery]);

    // Svi termini moraju postojati (redoslijed nebitan), bez obzira na kvačice.
    const filteredOptions = useMemo(
        () => (tokens.length === 0 ? options : options.filter(o => matchesSearch(tokens, o.label, o.subLabel))),
        [options, tokens]
    );

    const selectedOption = options.find(o => o.value === value);

    // Pozicija liste — računa se pri otvaranju i prati skrol/resize (modal ispod
    // se skrola, a fiksna lista bi inače ostala da visi na starom mjestu).
    useEffect(() => {
        if (!isOpen) return;
        const place = () => {
            const el = wrapperRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const width = Math.min(Math.max(rect.width, MENU_MIN_WIDTH), window.innerWidth - EDGE * 2);
            const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - EDGE - width));
            const below = window.innerHeight - rect.bottom - EDGE * 2;
            const above = rect.top - EDGE * 2;
            if (below < 220 && above > below) {
                setPos({ bottom: window.innerHeight - rect.top + 4, left, width, maxHeight: Math.min(MENU_MAX_HEIGHT, above) });
            } else {
                setPos({ top: rect.bottom + 4, left, width, maxHeight: Math.min(MENU_MAX_HEIGHT, below) });
            }
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
            // Sljedeće otvaranje ne smije bljesnuti na staroj poziciji.
            setPos(null);
        };
    }, [isOpen]);

    // Klik van okidača i van liste zatvara.
    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setIsOpen(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Nova pretraga → prvi rezultat je aktivan (Enter je predvidiv).
    useEffect(() => { setActive(0); }, [searchQuery, isOpen]);

    // Aktivna opcija uvijek u vidnom polju (tastatura).
    useEffect(() => {
        if (!isOpen) return;
        const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [active, isOpen]);

    const open = () => setIsOpen(true);

    // Fokus u pretragu čim lista stvarno postoji (pozicija se računa u efektu,
    // pa fiksni setTimeout zna promašiti na sporijem uređaju).
    const menuReady = isOpen && pos !== null;
    useEffect(() => {
        if (menuReady) inputRef.current?.focus({ preventScroll: true });
    }, [menuReady]);

    const handleSelect = (option: Option) => {
        onChange(option.value);
        setIsOpen(false);
        setSearchQuery('');
    };

    const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(i => Math.min(i + 1, Math.max(0, filteredOptions.length - 1)));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const option = filteredOptions[active];
            if (option) handleSelect(option);
        } else if (e.key === 'Escape') {
            // Zatvori samo listu — ne i modal ispod nje.
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(false);
            setSearchQuery('');
        }
    };

    return (
        <div className="searchable-select-wrapper" ref={wrapperRef}>
            {label && <label className="searchable-select-label">{label}</label>}

            <div
                className={`searchable-select-trigger ${isOpen ? 'active' : ''}`}
                role="combobox"
                aria-expanded={isOpen}
                tabIndex={0}
                onClick={() => (isOpen ? setIsOpen(false) : open())}
                onKeyDown={e => {
                    if (!isOpen && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
                        e.preventDefault();
                        open();
                    }
                }}
            >
                <span className={`trigger-text ${!selectedOption ? 'placeholder' : ''}`}>
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <span className="material-icons-round trigger-icon">expand_more</span>
            </div>

            {isOpen && pos && typeof document !== 'undefined' && createPortal(
                <div
                    ref={menuRef}
                    className="ssel-menu"
                    role="listbox"
                    style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
                >
                    <div className="ssel-search">
                        <span className="material-icons-round ssel-search-icon">search</span>
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder="Kucajte za pretragu…"
                            className="ssel-search-input"
                            onClick={(e) => e.stopPropagation()}
                        />
                        {filteredOptions.length > 0 && (
                            <span className="ssel-count">{filteredOptions.length}</span>
                        )}
                    </div>

                    <div className="ssel-list" ref={listRef}>
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option, index) => {
                                const selected = value === option.value;
                                return (
                                    <div
                                        key={option.value}
                                        data-index={index}
                                        role="option"
                                        aria-selected={selected}
                                        className={`ssel-item${selected ? ' is-selected' : ''}${index === active ? ' is-active' : ''}`}
                                        onMouseEnter={() => setActive(index)}
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSelect(option);
                                        }}
                                    >
                                        <div className="ssel-item-text">
                                            <span className="ssel-item-label"><Highlight text={option.label} tokens={tokens} /></span>
                                            {option.subLabel && (
                                                <span className="ssel-item-sub"><Highlight text={option.subLabel} tokens={tokens} /></span>
                                            )}
                                        </div>
                                        {option.badge && (
                                            <span className={`ssel-badge ssel-badge--${option.badge.tone || 'neutral'}`}>{option.badge.text}</span>
                                        )}
                                        <span className="material-icons-round ssel-check" aria-hidden>{selected ? 'check' : ''}</span>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="ssel-empty">Nema rezultata za „{searchQuery.trim()}"</div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            <style jsx>{`
                .searchable-select-wrapper {
                    position: relative;
                    width: 100%;
                }

                .searchable-select-trigger {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 12px 16px;
                    border: 1px solid #d1d5db;
                    border-radius: 12px;
                    background: white;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                    user-select: none;
                    outline: none;
                }

                .searchable-select-trigger:hover {
                    border-color: #9ca3af;
                    background: #fcfcfd;
                }

                .searchable-select-trigger:focus-visible,
                .searchable-select-trigger.active {
                    border-color: #0071e3;
                    box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.1);
                }

                .trigger-text {
                    min-width: 0;
                    font-size: 15px;
                    color: #1d1d1f;
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .trigger-text.placeholder {
                    color: #9ca3af;
                    font-weight: 400;
                }

                .trigger-icon {
                    flex-shrink: 0;
                    color: #6b7280;
                    font-size: 20px;
                }

                /* ── Padajuća lista (portal u body) ─────────────────────── */
                :global(.ssel-menu) {
                    position: fixed;
                    z-index: 9999;
                    display: flex;
                    flex-direction: column;
                    background: #fff;
                    border: 1px solid rgba(0, 0, 0, 0.1);
                    border-radius: 12px;
                    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.06);
                    overflow: hidden;
                    animation: ssel-in 0.14s ease-out;
                    text-align: left;
                    font-family: inherit;
                }

                :global(.ssel-search) {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 12px;
                    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
                    background: #f9f9fb;
                    flex-shrink: 0;
                }
                :global(.ssel-search-icon) { color: #9ca3af; font-size: 19px; flex-shrink: 0; }
                :global(.ssel-search-input) {
                    flex: 1;
                    min-width: 0;
                    border: none;
                    background: transparent;
                    font-size: 14px;
                    outline: none;
                    padding: 4px 0;
                    color: #1d1d1f;
                    font-family: inherit;
                }
                :global(.ssel-count) {
                    flex-shrink: 0;
                    font-size: 11px;
                    font-weight: 600;
                    color: #86868b;
                    font-variant-numeric: tabular-nums;
                }

                :global(.ssel-list) {
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    padding: 4px;
                    overscroll-behavior: contain;
                }

                /* Red: [naziv + podnaslov] [bedž] [kvačica] — sve lijevo poravnato. */
                :global(.ssel-item) {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto 18px;
                    align-items: center;
                    column-gap: 10px;
                    padding: 8px 10px;
                    border-radius: 8px;
                    cursor: pointer;
                    color: #1d1d1f;
                    text-align: left;
                }
                :global(.ssel-item.is-active) { background: #f2f3f5; }
                :global(.ssel-item.is-selected) { background: #ebf5ff; }
                :global(.ssel-item.is-selected.is-active) { background: #e0efff; }

                :global(.ssel-item-text) { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
                :global(.ssel-item-label) {
                    font-size: 14px;
                    font-weight: 500;
                    line-height: 1.35;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                :global(.ssel-item.is-selected .ssel-item-label) { color: #0071e3; font-weight: 600; }
                :global(.ssel-item-sub) {
                    font-size: 12px;
                    line-height: 1.35;
                    color: #6b7280;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                :global(.ssel-hit) { background: rgba(255, 204, 0, 0.35); color: inherit; border-radius: 2px; padding: 0; }

                :global(.ssel-badge) {
                    font-size: 10.5px;
                    font-weight: 600;
                    line-height: 1.4;
                    padding: 2px 8px;
                    border-radius: 999px;
                    white-space: nowrap;
                }
                :global(.ssel-badge--active) { background: #e5f2ff; color: #0071e3; }
                :global(.ssel-badge--neutral) { background: #f3f4f6; color: #6b7280; }

                :global(.ssel-check) { font-size: 18px; color: #0071e3; justify-self: end; }

                :global(.ssel-empty) {
                    padding: 18px 16px;
                    text-align: center;
                    color: #6b7280;
                    font-size: 13.5px;
                }

                @keyframes ssel-in {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                /* Telefon: lista kao donji list (bez obzira na izračunatu poziciju) */
                @media (max-width: 768px) {
                    :global(.ssel-menu) {
                        top: auto !important;
                        left: 0 !important;
                        bottom: 0 !important;
                        width: 100% !important;
                        max-height: 70vh !important;
                        border-radius: 20px 20px 0 0 !important;
                        animation: ssel-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
                        box-shadow: 0 -4px 30px rgba(0, 0, 0, 0.15) !important;
                        padding-bottom: env(safe-area-inset-bottom, 0px);
                    }
                    :global(.ssel-search-input) { font-size: 16px; }
                    :global(.ssel-item) { padding: 13px 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.04); border-radius: 0; }
                    :global(.ssel-item-label) { font-size: 16px; white-space: normal; }
                    @keyframes ssel-up {
                        from { transform: translateY(100%); }
                        to { transform: translateY(0); }
                    }
                }
            `}</style>
        </div>
    );
}

// Add global styles for the portal content just in case
export const SearchableSelectStyles = () => (
    <style jsx global>{`
        /* Any global styles needed */
    `}</style>
);
