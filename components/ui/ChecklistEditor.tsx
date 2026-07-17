'use client';

// ════════════════════════════════════════════════════════════════════
// KORACI ZADATKA (checklist) — jedan editor za oba slučaja:
//
//  • NACRT (wizard): zadatak još ne postoji → koraci su samo tekstovi u
//    memoriji, štikliranje nema smisla (onToggle izostavljen).
//  • ŽIVI zadatak (kartica naloga): svaki potez odmah piše u bazu.
//
// Pozivalac drži podatke i radnje; ovdje je samo prikaz + unos, da liste
// koraka u wizardu i na kartici izgledaju i rade isto.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Check, ListChecks, Plus, X } from 'lucide-react';
import './ChecklistEditor.css';

export interface ChecklistEditorItem {
    id: string;
    text: string;
    completed: boolean;
}

interface ChecklistEditorProps {
    items: ChecklistEditorItem[];
    /**
     * Smije vratiti Promise (upis u bazu) — polje se ne prazni dok upis ne
     * prođe, pa brzo kucanje „korak ↵ korak ↵" ne može izgubiti korak.
     */
    onAdd: (text: string) => void | Promise<void>;
    onRemove: (id: string) => void;
    /** Izostavljeno = koraci se ne mogu štiklirati (nacrt u wizardu). */
    onToggle?: (id: string) => void;
    disabled?: boolean;
    /** Zaglavlje „KORACI n/m" — isključi kad ga pozivalac već crta. */
    showHeader?: boolean;
    addLabel?: string;
    placeholder?: string;
    emptyHint?: string;
}

export default function ChecklistEditor({
    items, onAdd, onRemove, onToggle, disabled, showHeader = true,
    addLabel = 'Dodaj korak', placeholder = 'Novi korak…',
    emptyHint = 'Bez koraka — razloži zadatak na jasne korake.',
}: ChecklistEditorProps) {
    const [adding, setAdding] = useState(false);
    const [text, setText] = useState('');
    const [pending, setPending] = useState(false);

    const done = items.filter(i => i.completed).length;
    const checkable = !!onToggle;

    const commit = async (keepOpen: boolean) => {
        if (pending) return;
        const v = text.trim();
        if (!v) { setText(''); if (!keepOpen) setAdding(false); return; }
        // Tekst se briše TEK kad upis prođe: dok traje, polje je zaključano.
        // Bez toga bi drugi ↵ stigao dok prvi još piše, a upis koraka je
        // pročitaj-dopiši-vrati (dva paralelna bi se pregazila).
        setPending(true);
        try {
            await onAdd(v);
            setText('');
            // Enter ostavlja polje otvoreno (unos više koraka zaredom bez miša);
            // blur/Escape ga zatvara.
            if (!keepOpen) setAdding(false);
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="cle">
            {showHeader && (
                <div className="cle-head">
                    <span className="cle-head-label"><ListChecks size={13} /> Koraci</span>
                    {items.length > 0 && checkable && (
                        <span className="cle-head-bar">
                            <span
                                className={`cle-head-fill${done === items.length ? ' full' : ''}`}
                                style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
                            />
                        </span>
                    )}
                    {items.length > 0 && (
                        <span className="cle-head-count">{checkable ? `${done}/${items.length}` : items.length}</span>
                    )}
                </div>
            )}

            {items.length === 0 && !adding && (
                <p className="cle-empty">{emptyHint}</p>
            )}

            {items.length > 0 && (
                <div className="cle-items">
                    {items.map(item => (
                        <div key={item.id} className={`cle-item${item.completed ? ' done' : ''}`}>
                            {checkable ? (
                                <button
                                    type="button"
                                    className={`cle-box${item.completed ? ' on' : ''}`}
                                    disabled={disabled}
                                    onClick={() => onToggle!(item.id)}
                                    aria-label={item.completed ? 'Poništi korak' : 'Označi korak'}
                                >
                                    {item.completed && <Check size={11} strokeWidth={3} />}
                                </button>
                            ) : (
                                <span className="cle-box static" aria-hidden="true" />
                            )}
                            <span className="cle-text">{item.text}</span>
                            <button
                                type="button"
                                className="cle-remove"
                                disabled={disabled}
                                onClick={() => onRemove(item.id)}
                                aria-label="Ukloni korak"
                            >
                                <X size={13} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {adding ? (
                <div className="cle-add-row">
                    <span className="cle-box static" aria-hidden="true" />
                    <input
                        autoFocus
                        className="cle-input"
                        placeholder={placeholder}
                        value={text}
                        disabled={disabled || pending}
                        onChange={e => setText(e.target.value)}
                        onBlur={() => commit(false)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commit(true); }
                            if (e.key === 'Escape') { setText(''); setAdding(false); }
                        }}
                    />
                </div>
            ) : (
                <button type="button" className="cle-add" disabled={disabled} onClick={() => setAdding(true)}>
                    <Plus size={13} /> {addLabel}
                </button>
            )}
        </div>
    );
}
