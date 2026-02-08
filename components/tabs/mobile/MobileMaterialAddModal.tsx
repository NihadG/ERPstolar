'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Material, ProductMaterial } from '@/lib/types';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

interface MobileMaterialAddModalProps {
    isOpen: boolean;
    onClose: () => void;
    materials: Material[];
    onAdd: (data: { materialId: string, quantity: number, price: number }) => void;
}

export default function MobileMaterialAddModal({ isOpen, onClose, materials, onAdd }: MobileMaterialAddModalProps) {
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [animationClass, setAnimationClass] = useState('');

    // Form state
    const [selectedMaterialId, setSelectedMaterialId] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [price, setPrice] = useState(0);

    const selectedMaterial = materials.find(m => m.Material_ID === selectedMaterialId);

    useEffect(() => {
        if (isOpen) {
            // Reset state on open
            setSelectedMaterialId('');
            setQuantity(1);
            setPrice(0);

            setShouldRender(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setAnimationClass('active');
                });
            });
            document.body.style.overflow = 'hidden';
        } else {
            setAnimationClass('');
            const timer = setTimeout(() => {
                setShouldRender(false);
            }, 300);
            document.body.style.overflow = '';
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Update price when material changes
    useEffect(() => {
        if (selectedMaterial) {
            setPrice(selectedMaterial.Default_Unit_Price || 0);
        }
    }, [selectedMaterial]);

    if (!shouldRender) return null;

    const handleAdd = () => {
        if (!selectedMaterialId) return;
        onAdd({
            materialId: selectedMaterialId,
            quantity,
            price
        });
    };

    const handleIncrement = (amount: number) => {
        setQuantity(prev => parseFloat((Math.max(0, prev + amount)).toFixed(2)));
    };

    const formatCurrency = (val: number) => {
        return val.toFixed(2) + ' KM';
    };

    return createPortal(
        <div className="mobile-sheet-overlay">
            <div className={`mobile-backdrop ${animationClass}`} onClick={onClose} />
            <div className={`mobile-sheet ${animationClass}`}>
                {/* Drag Handle */}
                <div className="sheet-handle-bar">
                    <div className="sheet-handle" />
                </div>

                {/* Header */}
                <div className="sheet-header">
                    <div className="header-text">
                        <h3>Dodaj Materijal</h3>
                        <p>Odaberite materijal za dodavanje</p>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                {/* Content */}
                <div className="sheet-content">
                    <div className="form-group">
                        <label>Odaberi materijal <span className="required">*</span></label>
                        <SearchableSelect
                            value={selectedMaterialId}
                            onChange={setSelectedMaterialId}
                            options={materials.map(m => ({
                                value: m.Material_ID,
                                label: m.Name,
                                subLabel: `${m.Category} • ${m.Unit}`
                            }))}
                            placeholder="Pretraži..."
                        />
                    </div>

                    {selectedMaterial && (
                        <>
                            <div className="control-section">
                                <label className="section-label">Količina ({selectedMaterial.Unit})</label>
                                <div className="quantity-control-large">
                                    <button
                                        className="qty-btn"
                                        onClick={() => handleIncrement(-1)}
                                        disabled={quantity <= 0}
                                    >
                                        <span className="material-icons-round">remove</span>
                                    </button>
                                    <div className="qty-input-wrapper">
                                        <input
                                            type="number"
                                            value={quantity}
                                            onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                                            className="qty-input"
                                        />
                                    </div>
                                    <button
                                        className="qty-btn"
                                        onClick={() => handleIncrement(1)}
                                    >
                                        <span className="material-icons-round">add</span>
                                    </button>
                                </div>
                                <div className="quick-add-pills">
                                    <button onClick={() => handleIncrement(0.1)}>+0.1</button>
                                    <button onClick={() => handleIncrement(0.5)}>+0.5</button>
                                    <button onClick={() => handleIncrement(1)}>+1</button>
                                    <button onClick={() => handleIncrement(5)}>+5</button>
                                </div>
                            </div>

                            <div className="control-section">
                                <label className="section-label">Cijena po jedinici</label>
                                <div className="price-input-group">
                                    <span className="currency-prefix">KM</span>
                                    <input
                                        type="number"
                                        value={price}
                                        onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                                        className="price-input"
                                        step="0.01"
                                    />
                                </div>
                            </div>

                            {/* Summary Card */}
                            <div className="summary-card">
                                <div className="summary-row">
                                    <span>Ukupno:</span>
                                    <span className="summary-total">{formatCurrency(quantity * price)}</span>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="sheet-footer">
                    <button className="sheet-btn secondary" onClick={onClose}>
                        Otkaži
                    </button>
                    <button
                        className="sheet-btn primary"
                        onClick={handleAdd}
                        disabled={!selectedMaterialId}
                    >
                        Dodaj
                    </button>
                </div>
            </div>

            <style jsx>{`
                .mobile-sheet-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 9999;
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                    pointer-events: none;
                }

                .mobile-backdrop {
                    position: absolute;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.45);
                    backdrop-filter: blur(6px);
                    opacity: 0;
                    transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    pointer-events: auto;
                }

                .mobile-backdrop.active {
                    opacity: 1;
                }

                .mobile-sheet {
                    position: relative;
                    width: 100%;
                    max-width: 600px;
                    background: #ffffff;
                    border-radius: 24px 24px 0 0;
                    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.12);
                    transform: translateY(100%);
                    transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1);
                    pointer-events: auto;
                    display: flex;
                    flex-direction: column;
                    max-height: 90vh;
                    padding-bottom: env(safe-area-inset-bottom);
                }

                .mobile-sheet.active {
                    transform: translateY(0);
                }

                .sheet-handle-bar {
                    width: 100%;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }

                .sheet-handle {
                    width: 36px;
                    height: 4px;
                    background: #cbd5e1;
                    border-radius: 2px;
                }

                .sheet-header {
                    padding: 4px 20px 20px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid #f1f5f9;
                }

                .header-text h3 {
                    margin: 0;
                    font-size: 22px;
                    font-weight: 700;
                    color: #0f172a;
                    letter-spacing: -0.01em;
                }

                .header-text p {
                    margin: 6px 0 0;
                    font-size: 13px;
                    font-weight: 500;
                    color: #64748b;
                    letter-spacing: -0.005em;
                }

                .close-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: #f8fafc;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #64748b;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .close-btn:active {
                    background: #e2e8f0;
                    transform: scale(0.95);
                }

                .sheet-content {
                    padding: 20px;
                    overflow-y: auto;
                    flex: 1;
                }

                @media (min-width: 400px) {
                    .sheet-content {
                        padding: 24px;
                    }
                }

                .control-section {
                    margin-bottom: 24px;
                }

                .control-section:last-child {
                    margin-bottom: 0;
                }

                .form-group {
                    margin-bottom: 24px;
                }

                .form-group:last-child {
                    margin-bottom: 0;
                }

                .form-group label, .section-label {
                    display: block;
                    font-size: 13px;
                    font-weight: 600;
                    color: #475569;
                    margin-bottom: 10px;
                    letter-spacing: -0.005em;
                }

                .required {
                    color: #ef4444;
                    font-weight: 700;
                }

                .quantity-control-large {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                    padding: 10px;
                    border-radius: 16px;
                    border: 1.5px solid #e2e8f0;
                }

                .qty-btn {
                    width: 52px;
                    height: 52px;
                    border-radius: 14px;
                    background: #ffffff;
                    border: 1.5px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #2563eb;
                    font-size: 24px;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.05);
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    cursor: pointer;
                }

                .qty-btn:active {
                    background: #eff6ff;
                    transform: scale(0.95);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                }

                .qty-btn:disabled {
                    opacity: 0.4;
                    color: #cbd5e1;
                    cursor: not-allowed;
                }

                .qty-input-wrapper {
                    flex: 1;
                    height: 52px;
                }

                .qty-input {
                    width: 100%;
                    height: 100%;
                    text-align: center;
                    font-size: 26px;
                    font-weight: 700;
                    color: #0f172a;
                    background: transparent;
                    border: none;
                    outline: none;
                }

                .quick-add-pills {
                    display: flex;
                    gap: 8px;
                    margin-top: 12px;
                    overflow-x: auto;
                    padding-bottom: 4px;
                }

                .quick-add-pills button {
                    padding: 8px 18px;
                    border-radius: 20px;
                    background: #ffffff;
                    color: #2563eb;
                    font-size: 14px;
                    font-weight: 600;
                    border: 1.5px solid #e2e8f0;
                    white-space: nowrap;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                }

                .quick-add-pills button:active {
                    background: #eff6ff;
                    border-color: #bfdbfe;
                    transform: scale(0.96);
                }

                .price-input-group {
                    position: relative;
                    height: 60px;
                    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                    border-radius: 16px;
                    border: 1.5px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    padding: 0 18px;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .price-input-group:focus-within {
                    border-color: #2563eb;
                    background: #ffffff;
                    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.08);
                }

                .currency-prefix {
                    font-size: 17px;
                    font-weight: 700;
                    color: #64748b;
                    margin-right: 12px;
                }

                .price-input {
                    flex: 1;
                    height: 100%;
                    border: none;
                    background: transparent;
                    font-size: 22px;
                    font-weight: 600;
                    color: #0f172a;
                    outline: none;
                }

                .summary-card {
                    margin-top: 24px;
                    padding: 20px;
                    background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
                    border-radius: 16px;
                    border: 1.5px solid #93c5fd;
                }

                .summary-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 15px;
                    font-weight: 600;
                    color: #1e40af;
                }

                .summary-total {
                    font-size: 24px;
                    font-weight: 700;
                    color: #1e40af;
                    letter-spacing: -0.01em;
                }

                .sheet-footer {
                    padding: 16px 20px;
                    display: flex;
                    gap: 12px;
                    border-top: 1px solid #f1f5f9;
                    background: #fafafa;
                    flex-shrink: 0;
                }

                @media (min-width: 400px) {
                    .sheet-footer {
                        padding: 18px 24px;
                    }
                }

                .sheet-btn {
                    flex: 1;
                    min-height: 54px;
                    border-radius: 14px;
                    font-size: 16px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    letter-spacing: -0.01em;
                }

                .sheet-btn.secondary {
                    background: #f1f5f9;
                    color: #64748b;
                }

                .sheet-btn.secondary:active {
                    background: #e2e8f0;
                    transform: scale(0.98);
                }

                .sheet-btn.primary {
                    background: #2563eb;
                    color: white;
                    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
                }
                
                .sheet-btn.primary:disabled {
                    background: #cbd5e1;
                    box-shadow: none;
                    cursor: not-allowed;
                }

                .sheet-btn.primary:active:not(:disabled) {
                    background: #1d4ed8;
                    transform: scale(0.98);
                    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
                }
            `}</style>
        </div>,
        document.body
    );
}
