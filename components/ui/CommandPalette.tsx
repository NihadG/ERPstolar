'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import './CommandPalette.css';

export interface CommandPaletteItem {
    id: string;
    type: 'project' | 'material' | 'order' | 'action';
    title: string;
    subtitle?: string;
    shortcut?: string;
    action?: () => void;
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    items: CommandPaletteItem[];
    onSelect: (item: CommandPaletteItem) => void;
}

export default function CommandPalette({ isOpen, onClose, items, onSelect }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Focus input when opening
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setActiveIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Fuzzy search
    const filteredItems = useMemo(() => {
        if (!query.trim()) return items;

        const lowerQuery = query.toLowerCase();
        return items.filter(item =>
            item.title.toLowerCase().includes(lowerQuery) ||
            item.subtitle?.toLowerCase().includes(lowerQuery)
        ).sort((a, b) => {
            // Prioritize title matches
            const aTitle = a.title.toLowerCase().indexOf(lowerQuery);
            const bTitle = b.title.toLowerCase().indexOf(lowerQuery);
            if (aTitle !== -1 && bTitle === -1) return -1;
            if (bTitle !== -1 && aTitle === -1) return 1;
            return aTitle - bTitle;
        });
    }, [items, query]);

    // Group items by type
    const groupedItems = useMemo(() => {
        const groups: Record<string, CommandPaletteItem[]> = {};
        filteredItems.forEach(item => {
            const group = item.type;
            if (!groups[group]) groups[group] = [];
            groups[group].push(item);
        });
        return groups;
    }, [filteredItems]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        function handleKeyDown(e: KeyboardEvent) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setActiveIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setActiveIndex(prev => Math.max(prev - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (filteredItems[activeIndex]) {
                        handleSelect(filteredItems[activeIndex]);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, activeIndex, filteredItems, onClose]);

    // Scroll active item into view
    useEffect(() => {
        if (listRef.current) {
            const activeElement = listRef.current.querySelector('.command-palette-item.active');
            activeElement?.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex]);

    function handleSelect(item: CommandPaletteItem) {
        if (item.action) {
            item.action();
        } else {
            onSelect(item);
        }
        onClose();
    }

    function getGroupLabel(type: string): string {
        switch (type) {
            case 'project': return 'Projekti';
            case 'material': return 'Materijali';
            case 'order': return 'Narudžbe';
            case 'action': return 'Akcije';
            default: return type;
        }
    }

    function getItemIcon(type: string): string {
        switch (type) {
            case 'project': return 'folder';
            case 'material': return 'inventory_2';
            case 'order': return 'local_shipping';
            case 'action': return 'bolt';
            default: return 'circle';
        }
    }

    if (!isOpen) return null;

    let flatIndex = 0;

    return (
        <div className="command-palette-overlay" onClick={onClose}>
            <div className="command-palette" onClick={e => e.stopPropagation()}>
                {/* Search Input */}
                <div className="command-palette-input-wrapper">
                    <span className="material-icons-round">search</span>
                    <input
                        ref={inputRef}
                        type="text"
                        className="command-palette-input"
                        placeholder="Pretraži projekte, materijale, narudžbe..."
                        value={query}
                        onChange={e => {
                            setQuery(e.target.value);
                            setActiveIndex(0);
                        }}
                    />
                    <kbd>ESC</kbd>
                </div>

                {/* Results */}
                <div className="command-palette-results" ref={listRef}>
                    {filteredItems.length === 0 ? (
                        <div className="command-palette-empty">
                            <span className="material-icons-round">search_off</span>
                            <p>Nema rezultata za "{query}"</p>
                        </div>
                    ) : (
                        Object.entries(groupedItems).map(([type, groupItems]) => (
                            <div key={type}>
                                <div className="command-palette-section">{getGroupLabel(type)}</div>
                                {groupItems.map(item => {
                                    const currentIndex = flatIndex++;
                                    return (
                                        <div
                                            key={item.id}
                                            className={`command-palette-item ${currentIndex === activeIndex ? 'active' : ''}`}
                                            onClick={() => handleSelect(item)}
                                            onMouseEnter={() => setActiveIndex(currentIndex)}
                                        >
                                            <div className={`command-palette-item-icon ${item.type}`}>
                                                <span className="material-icons-round">{getItemIcon(item.type)}</span>
                                            </div>
                                            <div className="command-palette-item-content">
                                                <div className="command-palette-item-title">{item.title}</div>
                                                {item.subtitle && (
                                                    <div className="command-palette-item-subtitle">{item.subtitle}</div>
                                                )}
                                            </div>
                                            {item.shortcut && (
                                                <div className="command-palette-item-shortcut">
                                                    <kbd>{item.shortcut}</kbd>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="command-palette-footer">
                    <div className="command-palette-footer-keys">
                        <span><kbd>↑</kbd><kbd>↓</kbd> za navigaciju</span>
                        <span><kbd>↵</kbd> za odabir</span>
                    </div>
                    <span>Ctrl+K za pretragu</span>
                </div>
            </div>
        </div>
    );
}
