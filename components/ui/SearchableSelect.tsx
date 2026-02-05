import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

interface Option {
    value: string;
    label: string;
    subLabel?: string;
}

interface SearchableSelectProps {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
}

export function SearchableSelect({ options, value, onChange, placeholder = 'Pretraži...', label }: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [dropdownPosition, setDropdownPosition] = useState<{ top: number, left: number, width: number } | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter options based on intelligent search logic
    const filteredOptions = useMemo(() => {
        if (!searchQuery) return options;

        const terms = searchQuery.toLowerCase().split(' ').filter(Boolean);
        return options.filter(option => {
            const text = `${option.label} ${option.subLabel || ''}`.toLowerCase();
            // All terms must appear in the text (order doesn't matter)
            return terms.every(term => text.includes(term));
        });
    }, [options, searchQuery]);

    const selectedOption = options.find(o => o.value === value);

    // Update dropdown position on open
    useEffect(() => {
        if (isOpen && wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + window.scrollY,
                left: rect.left + window.scrollX,
                width: rect.width
            });
        }
    }, [isOpen]);

    // Click outside handler
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                // Check if click is inside the portal dropdown
                const dropdown = document.getElementById('searchable-select-dropdown');
                if (dropdown && dropdown.contains(event.target as Node)) {
                    return;
                }
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Cleanup on select
    const handleSelect = (option: Option) => {
        onChange(option.value);
        setIsOpen(false);
        setSearchQuery('');
    };

    return (
        <div className="searchable-select-wrapper" ref={wrapperRef}>
            {label && <label className="searchable-select-label">{label}</label>}

            <div
                className={`searchable-select-trigger ${isOpen ? 'active' : ''}`}
                onClick={() => {
                    setIsOpen(!isOpen);
                    if (!isOpen) {
                        setTimeout(() => inputRef.current?.focus(), 50);
                    }
                }}
            >
                <span className={`trigger-text ${!selectedOption ? 'placeholder' : ''}`}>
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <span className="material-icons-round trigger-icon">expand_more</span>
            </div>

            {isOpen && dropdownPosition && createPortal(
                <div
                    id="searchable-select-dropdown"
                    className="searchable-select-dropdown"
                    style={{
                        top: dropdownPosition.top + 4,
                        left: dropdownPosition.left,
                        width: dropdownPosition.width
                    }}
                >
                    <div className="dropdown-search-wrapper">
                        <span className="material-icons-round search-icon">search</span>
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Kucajte za pretragu..."
                            className="dropdown-search-input"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>

                    <div className="dropdown-list">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map(option => (
                                <div
                                    key={option.value}
                                    className={`dropdown-item ${value === option.value ? 'selected' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSelect(option);
                                    }}
                                >
                                    <div className="item-label">{option.label}</div>
                                    {option.subLabel && <div className="item-sublabel">{option.subLabel}</div>}
                                    {value === option.value && <span className="material-icons-round check-icon">check</span>}
                                </div>
                            ))
                        ) : (
                            <div className="dropdown-empty">Nema rezultata</div>
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
                    padding: 12px 16px;
                    border: 1px solid #d1d5db;
                    border-radius: 12px;
                    background: white;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                    user-select: none;
                }

                .searchable-select-trigger:hover {
                    border-color: #9ca3af;
                    background: #fcfcfd;
                }

                .searchable-select-trigger.active {
                    border-color: #0071e3;
                    box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.1);
                }

                .trigger-text {
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
                    color: #6b7280;
                    font-size: 20px;
                }

                :global(.searchable-select-dropdown) {
                    position: absolute;
                    background: white;
                    border: 1px solid rgba(0,0,0,0.1);
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
                    z-index: 9999;
                    overflow: hidden;
                    animation: fadeIn 0.15s ease-out;
                    display: flex;
                    flex-direction: column;
                    max-height: 400px; /* Limit height */
                }

                :global(.dropdown-search-wrapper) {
                    padding: 12px;
                    border-bottom: 1px solid rgba(0,0,0,0.06);
                    background: #f9f9fb;
                    position: sticky;
                    top: 0;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                :global(.search-icon) {
                    color: #9ca3af;
                    font-size: 20px;
                }

                :global(.dropdown-search-input) {
                    flex: 1;
                    border: none;
                    background: transparent;
                    font-size: 14px;
                    outline: none;
                    padding: 4px; /* Reduced since wrapper handles spacing */
                    width: 100%;
                }

                :global(.dropdown-list) {
                    overflow-y: auto;
                    flex: 1;
                    padding: 4px;
                }

                :global(.dropdown-item) {
                    padding: 10px 12px;
                    cursor: pointer;
                    border-radius: 8px;
                    transition: background 0.15s;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                }

                :global(.dropdown-item:hover) {
                    background: #f3f4f6;
                }

                :global(.dropdown-item.selected) {
                    background: #ebf5ff;
                    color: #0071e3;
                }

                :global(.item-label) {
                    font-size: 14px;
                    font-weight: 500;
                }

                :global(.item-sublabel) {
                    font-size: 12px;
                    color: #6b7280;
                    margin-top: 1px;
                }

                :global(.check-icon) {
                    position: absolute;
                    right: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #0071e3;
                    font-size: 18px;
                }

                :global(.dropdown-empty) {
                    padding: 16px;
                    text-align: center;
                    color: #6b7280;
                    font-size: 14px;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                /* Mobile Adaptations */
                @media (max-width: 768px) {
                    :global(.searchable-select-dropdown) {
                        position: fixed !important;
                        top: auto !important;
                        left: 0 !important;
                        bottom: 0 !important;
                        width: 100% !important;
                        border-radius: 20px 20px 0 0 !important;
                        animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
                        max-height: 70vh !important;
                        box-shadow: 0 -4px 30px rgba(0,0,0,0.15) !important;
                    }

                    @keyframes slideUp {
                        from { transform: translateY(100%); }
                        to { transform: translateY(0); }
                    }

                    :global(.dropdown-item) {
                        padding: 16px; /* Larger touch targets */
                        border-bottom: 1px solid rgba(0,0,0,0.04);
                    }
                    
                    :global(.item-label) {
                        font-size: 16px; /* Prevent zoom */
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
