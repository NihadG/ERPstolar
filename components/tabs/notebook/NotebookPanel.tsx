'use client';

// ════════════════════════════════════════════════════════════════════
// BILJEŽNICA — prikaz stavki koje je zapamtio Telegram asistent.
//
// Čist prikaz (podaci kroz props) da ga /notebook-preview može renderovati
// bez baze i prijave. Podatke i upise drži NotebookLens.
//
// Pitanje na koje ekran odgovara: „šta gdje stoji i u kakvom je stanju?"
// Zato je zadano grupisanje PO LOKACIJI, a otvoreno je prvo.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, MapPin, RotateCcw, Search, Send, Tag, Trash2, X } from 'lucide-react';
import type { MemoryItem } from '@/lib/types';
import { foldText, stem, tokens } from '@/lib/voice/text';
import './NotebookPanel.css';

type StateFilter = 'open' | 'resolved' | 'all';
type GroupMode = 'location' | 'subject';

export interface NotebookPanelProps {
    items: MemoryItem[];
    loading?: boolean;
    onToggleResolved?: (item: MemoryItem, resolved: boolean) => void;
    onDelete?: (item: MemoryItem) => void;
}

/**
 * Riječ upita se poredi po korijenu, ne doslovno: „ogledala" mora naći
 * „ogledalo", „Amera" mora naći „Amer".
 */
function matchesAll(query: string, hay: string): boolean {
    const words = tokens(foldText(query)).map(stem);
    if (!words.length) return true;
    const hayWords = tokens(hay);
    return words.every(w => hayWords.some(h => h.startsWith(w) || stem(h) === w));
}

function dayLabel(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function timeLabel(iso: string): string {
    const d = new Date(iso);
    return `${dayLabel(iso)} ${d.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })}`;
}

function quantityLabel(m: MemoryItem): string | null {
    if (m.Quantity == null) return null;
    return `${m.Quantity} ${m.Unit || 'kom'}`;
}

function haystack(m: MemoryItem): string {
    return foldText([m.Title, m.Subject, m.Spec, m.Location, m.State_Label, ...(m.Tags || []), ...(m.History || []).map(h => `${h.Text} ${h.By || ''}`)].join(' '));
}

export default function NotebookPanel({ items, loading, onToggleResolved, onDelete }: NotebookPanelProps) {
    const [filter, setFilter] = useState<StateFilter>('open');
    const [group, setGroup] = useState<GroupMode>('location');
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    const counts = useMemo(() => ({
        open: items.filter(m => m.State === 'open').length,
        resolved: items.filter(m => m.State === 'resolved').length,
    }), [items]);

    const groups = useMemo(() => {
        const visible = items
            .filter(m => filter === 'all' || m.State === filter)
            .filter(m => matchesAll(search, haystack(m)));

        const map = new Map<string, MemoryItem[]>();
        for (const m of visible) {
            const key = group === 'location' ? (m.Location || 'Bez lokacije') : (m.Subject || 'Ostalo');
            map.set(key, [...(map.get(key) || []), m]);
        }
        return Array.from(map.entries())
            .map(([key, list]) => ({
                key,
                list: list.sort((a, b) => (a.State === b.State ? b.Updated_At.localeCompare(a.Updated_At) : a.State === 'open' ? -1 : 1)),
            }))
            .sort((a, b) => b.list.filter(m => m.State === 'open').length - a.list.filter(m => m.State === 'open').length || a.key.localeCompare(b.key, 'bs'));
    }, [items, filter, group, search]);

    return (
        <div className="nb">
            <div className="nb-toolbar">
                <div className="nb-search">
                    <Search size={15} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Pretraži: ogledala, 304, Amer…"
                        aria-label="Pretraži bilježnicu"
                    />
                    {search && (
                        <button type="button" className="nb-icon-btn" onClick={() => setSearch('')} aria-label="Očisti pretragu">
                            <X size={13} />
                        </button>
                    )}
                </div>

                <div className="nb-seg" role="tablist" aria-label="Stanje">
                    {([['open', `Otvoreno`, counts.open], ['resolved', 'Riješeno', counts.resolved], ['all', 'Sve', items.length]] as const).map(([key, label, n]) => (
                        <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
                            {label}<span className="nb-seg-n">{n}</span>
                        </button>
                    ))}
                </div>

                <div className="nb-seg" role="tablist" aria-label="Grupisanje">
                    <button type="button" role="tab" aria-selected={group === 'location'} className={group === 'location' ? 'on' : ''} onClick={() => setGroup('location')}>
                        <MapPin size={13} /> Lokacija
                    </button>
                    <button type="button" role="tab" aria-selected={group === 'subject'} className={group === 'subject' ? 'on' : ''} onClick={() => setGroup('subject')}>
                        <Tag size={13} /> Predmet
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="nb-empty">Učitavam bilježnicu…</div>
            ) : !items.length ? (
                <div className="nb-empty">
                    <BookOpen size={36} strokeWidth={1.5} />
                    <h3>Bilježnica je prazna</h3>
                    <p>Puni je Telegram asistent. Pošalji mu npr. <q>U stanu 304 imam 3 ogledala od 1 m, nisu montirana</q> ili proslijedi izvještaj radnika.</p>
                </div>
            ) : !groups.length ? (
                <div className="nb-empty">
                    <p>Ništa ne odgovara {search ? `pretrazi „${search}"` : 'ovom filteru'}.</p>
                </div>
            ) : (
                <div className="nb-groups">
                    {groups.map(g => (
                        <section key={g.key} className="nb-group">
                            <header className="nb-group-head">
                                {group === 'location' ? <MapPin size={15} /> : <Tag size={15} />}
                                <h3>{g.key}</h3>
                                <span className="nb-group-n">{g.list.length}</span>
                            </header>
                            <ul className="nb-list">
                                {g.list.map(m => {
                                    const open = expanded === m.Item_ID;
                                    const last = m.History?.[m.History.length - 1];
                                    const qty = quantityLabel(m);
                                    return (
                                        <li key={m.Item_ID} className={`nb-item ${m.State}`}>
                                            <div className="nb-row">
                                                <button
                                                    type="button"
                                                    className={`nb-check ${m.State === 'resolved' ? 'done' : ''}`}
                                                    onClick={() => onToggleResolved?.(m, m.State !== 'resolved')}
                                                    title={m.State === 'resolved' ? 'Vrati u otvoreno' : 'Označi kao riješeno'}
                                                    aria-label={m.State === 'resolved' ? 'Vrati u otvoreno' : 'Označi kao riješeno'}
                                                >
                                                    {m.State === 'resolved' && <Check size={13} strokeWidth={3} />}
                                                </button>

                                                <button type="button" className="nb-main" onClick={() => setExpanded(open ? null : m.Item_ID)} aria-expanded={open}>
                                                    <span className="nb-title">
                                                        {qty && <span className="nb-qty">{qty}</span>}
                                                        {m.Title}
                                                        {m.Spec && <span className="nb-spec">· {m.Spec}</span>}
                                                    </span>
                                                    <span className="nb-meta">
                                                        <span className={`nb-state ${m.State}`}>{m.State_Label}</span>
                                                        {group === 'subject' && m.Location && <span><MapPin size={11} /> {m.Location}</span>}
                                                        <span>{last?.By && last.By !== 'ja' ? `${last.By} · ` : ''}{dayLabel(m.Updated_At)}</span>
                                                    </span>
                                                </button>

                                                <ChevronDown size={16} className={`nb-chev ${open ? 'open' : ''}`} aria-hidden />
                                            </div>

                                            {open && (
                                                <div className="nb-detail">
                                                    <ol className="nb-history">
                                                        {[...(m.History || [])].reverse().map((h, i) => (
                                                            <li key={i}>
                                                                <span className="nb-h-when">{timeLabel(h.At)}</span>
                                                                <span className="nb-h-who">{h.By && h.By !== 'ja' ? <><Send size={11} /> {h.By}</> : 'ja'}</span>
                                                                <span className="nb-h-text">{h.Text}</span>
                                                            </li>
                                                        ))}
                                                    </ol>
                                                    <div className="nb-actions">
                                                        {m.Links?.map(l => (
                                                            <span key={`${l.Entity_Type}-${l.Entity_ID}`} className="nb-link">{l.Entity_Name}</span>
                                                        ))}
                                                        <span className="nb-spacer" />
                                                        <button type="button" className="nb-btn" onClick={() => onToggleResolved?.(m, m.State !== 'resolved')}>
                                                            {m.State === 'resolved' ? <><RotateCcw size={13} /> Vrati u otvoreno</> : <><Check size={13} /> Riješeno</>}
                                                        </button>
                                                        {onDelete && (
                                                            <button type="button" className="nb-btn danger" onClick={() => onDelete(m)}>
                                                                <Trash2 size={13} /> Obriši
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}
