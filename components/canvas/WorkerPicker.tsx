'use client';

// ════════════════════════════════════════════════════════════════════
// WorkerPicker — izbor radnika KUCANJEM, ne skrolanjem.
//
// Lista aktivnih radnika ide preko ekrana, pa je traženje jednog imena
// bilo skrolanje naslijepo. Tok je sada: kucaj par slova → prvi pogodak
// je označen → Enter ga čekira i polje se samo isprazni, pa odmah kucaš
// sljedeće ime. Ruka ne mora na miša između dva radnika.
//
// Strelice pomjeraju oznaku kad ima više pogodaka; Esc prvo čisti upit,
// pa tek onda zatvara (inače bi jedan Esc zatvorio cijeli izbor).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Search, X, CornerDownLeft } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { Worker } from '@/lib/types';
import { highlightRanges, searchScore, searchTokens } from '@/lib/searchMatch';

interface WorkerPickerProps {
    isOpen: boolean;
    workers: Worker[];
    /** Da li je radnik već dodijeljen (roditelj drži stanje). */
    isSelected: (workerId: string) => boolean;
    onToggle: (workerId: string) => void;
    onClose: () => void;
    title: ReactNode;
}

/** Ime sa podebljanim dijelom koji se poklopio s upitom. */
function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
    const ranges = useMemo(() => highlightRanges(text, tokens), [text, tokens]);
    if (ranges.length === 0) return <>{text}</>;

    const parts: ReactNode[] = [];
    let cursor = 0;
    ranges.forEach(([s, e], i) => {
        if (s > cursor) parts.push(text.slice(cursor, s));
        parts.push(<mark key={i} className="wp-hl">{text.slice(s, e)}</mark>);
        cursor = e;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return <>{parts}</>;
}

export default function WorkerPicker({
    isOpen, workers, isSelected, onToggle, onClose, title,
}: WorkerPickerProps) {
    const [query, setQuery] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) { setQuery(''); setActiveIdx(0); }
    }, [isOpen]);

    const tokens = useMemo(() => searchTokens(query), [query]);

    const results = useMemo(() => {
        if (tokens.length === 0) return workers;
        return workers
            .map(w => ({ w, score: searchScore(tokens, w.Name, w.Role) }))
            .filter(e => e.score > 0)
            .sort((a, b) => b.score - a.score || (a.w.Name || '').localeCompare(b.w.Name || '', 'hr'))
            .map(e => e.w);
    }, [workers, tokens]);

    // Nova pretraga uvijek cilja prvi (najbolje rangiran) pogodak.
    useEffect(() => { setActiveIdx(0); }, [query]);

    // Drži označeni red u vidnom polju kad se kreće strelicama.
    // `scrollIntoView` je samo udobnost, pa se provjerava postojanje — u jsdom-u
    // (testovi) ga nema, a bacanje bi srušilo cijeli izbor zbog pomicanja liste.
    useEffect(() => {
        if (!isOpen) return;
        const active = listRef.current?.querySelector('.btt-pick-item.active');
        if (active && typeof active.scrollIntoView === 'function') {
            active.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIdx, isOpen, results.length]);

    const selectedCount = workers.filter(w => isSelected(w.Worker_ID)).length;

    /** Čekiraj i odmah oslobodi polje za sljedeće ime. */
    function pick(worker: Worker) {
        onToggle(worker.Worker_ID);
        setQuery('');
        inputRef.current?.focus();
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(i => (results.length === 0 ? 0 : (i + 1) % results.length));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(i => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const target = results[activeIdx];
            if (target) pick(target);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (query) setQuery('');
            else onClose();
        }
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            size="default"
            zIndex={1200}
            footer={<div className="btt-pick-foot">
                <span className="wp-foot-hint">
                    <CornerDownLeft size={12} /> Enter dodaje označenog · ↑↓ bira
                </span>
                <button className="btn btn-primary" onClick={onClose}>Gotovo</button>
            </div>}
        >
            <div className="btt-pick wp">
                <div className="btt-pick-search">
                    <Search size={14} />
                    <input
                        ref={inputRef}
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Kucaj ime radnika…"
                        autoComplete="off"
                    />
                    {query && (
                        <button className="wp-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} title="Očisti">
                            <X size={13} />
                        </button>
                    )}
                </div>

                <div className="wp-status">
                    <span>{selectedCount} dodijeljeno</span>
                    {tokens.length > 0 && <span>{results.length} od {workers.length} radnika</span>}
                </div>

                <div className="btt-pick-list" ref={listRef}>
                    {results.length === 0 && (
                        <p className="btt-pick-empty">
                            {workers.length === 0 ? 'Nema aktivnih radnika.' : `Nema radnika za „${query}".`}
                        </p>
                    )}
                    {results.map((w, i) => {
                        const on = isSelected(w.Worker_ID);
                        return (
                            <button
                                key={w.Worker_ID}
                                className={`btt-pick-item${on ? ' on' : ''}${i === activeIdx ? ' active' : ''}`}
                                onMouseEnter={() => setActiveIdx(i)}
                                onClick={() => pick(w)}
                            >
                                <span className={`btt-box${on ? ' on' : ''}`} />
                                <span className="btt-pick-name">
                                    <Highlighted text={w.Name || ''} tokens={tokens} />
                                </span>
                                <span className="btt-pick-meta">{w.Role || ''}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </Modal>
    );
}
