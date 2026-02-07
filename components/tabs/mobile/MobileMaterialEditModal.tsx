'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ProductMaterial } from '@/lib/types';

interface MobileMaterialEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    material: ProductMaterial | null;
    onSave: (id: string, updates: { Quantity: number; Unit_Price: number; Total_Price: number; Is_Essential: boolean }) => void;
}

export default function MobileMaterialEditModal({ isOpen, onClose, material, onSave }: MobileMaterialEditModalProps) {
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [animationClass, setAnimationClass] = useState('');

    // Form state
    const [quantity, setQuantity] = useState(0);
    const [price, setPrice] = useState(0);
    const [isEssential, setIsEssential] = useState(false);

    useEffect(() => {
        if (isOpen && material) {
            setQuantity(material.Quantity || 0);
            setPrice(material.Unit_Price || 0);
            setIsEssential(material.Is_Essential || false);

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
    }, [isOpen, material]);

    if (!shouldRender || !material) return null;

    const handleSave = () => {
        onSave(material.ID, {
            Quantity: quantity,
            Unit_Price: price,
            Total_Price: quantity * price,
            Is_Essential: isEssential
        });
    };

    const handleIncrement = (amount: number) => {
        setQuantity(prev => parseFloat((prev + amount).toFixed(2)));
    };

    const formatCurrency = (val: number) => {
        return val.toFixed(2) + ' KM';
    };

    return createPortal(
        <div className="mobile-edit-overlay">
            <div className={`mobile-backdrop ${animationClass}`} onClick={onClose} />
            <div className={`mobile-sheet ${animationClass}`}>
                {/* Drag Handle */}
                <div className="sheet-handle-bar">
                    <div className="sheet-handle" />
                </div>

                {/* Header */}
                <div className="sheet-header">
                    <div className="header-icon">
                        <span className="material-icons-round">edit</span>
                    </div>
                    <div className="header-text">
                        <h3>Uredi Materijal</h3>
                        <p>{material.Material_Name}</p>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                {/* Content */}
                <div className="sheet-content">
                    {/* Quantity Section */}
                    <div className="control-section">
                        <label className="section-label">Količina ({material.Unit})</label>
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

                    <div className="divider" />

                    {/* Price Section */}
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

                    <div className="divider" />

                    {/* Essential Toggle */}
                    <div
                        className={`essential-toggle-card ${isEssential ? 'active' : ''}`}
                        onClick={() => setIsEssential(!isEssential)}
                    >
                        <div className="toggle-info">
                            <div className="toggle-title">
                                <span className={`material-icons-round alert-icon`}>
                                    warning
                                </span>
                                Esencijalni materijal
                            </div>
                            <div className="toggle-desc">
                                Onemogućava proizvodnju dok materijal nije na stanju
                            </div>
                        </div>
                        <div className={`switch ${isEssential ? 'on' : 'off'}`}>
                            <div className="knob" />
                        </div>
                    </div>

                    {/* Summary Card */}
                    <div className="summary-card">
                        <div className="summary-row">
                            <span>Ukupno:</span>
                            <span className="summary-total">{formatCurrency(quantity * price)}</span>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="sheet-footer">
                    <button className="sheet-btn secondary" onClick={onClose}>
                        Otkaži
                    </button>
                    <button className="sheet-btn primary" onClick={handleSave}>
                        Sačuvaj Promjene
                    </button>
                </div>
            </div>

            <style jsx>{`
                .mobile-edit-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 9999;
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                    pointer-events: none; /* Let clicks pass when not active */
                }

                .mobile-backdrop {
                    position: absolute;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.4);
                    backdrop-filter: blur(4px);
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    pointer-events: auto;
                }

                .mobile-backdrop.active {
                    opacity: 1;
                }

                .mobile-sheet {
                    position: relative;
                    width: 100%;
                    max-width: 600px; /* Tablet constraint */
                    background: #ffffff;
                    border-radius: 20px 20px 0 0;
                    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
                    transform: translateY(100%);
                    transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1);
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
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }

                .sheet-handle {
                    width: 40px;
                    height: 4px;
                    background: #e2e8f0;
                    border-radius: 2px;
                }

                .sheet-header {
                    padding: 0 24px 16px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    border-bottom: 1px solid #f1f5f9;
                }

                .header-icon {
                    width: 48px;
                    height: 48px;
                    background: #eff6ff;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #2563eb;
                }

                .header-text {
                    flex: 1;
                }

                .header-text h3 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 600;
                    color: #1e293b;
                }

                .header-text p {
                    margin: 2px 0 0;
                    font-size: 14px;
                    color: #64748b;
                }

                .close-btn {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background: #f8fafc;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #64748b;
                    cursor: pointer;
                }

                .sheet-content {
                    padding: 24px;
                    overflow-y: auto;
                    flex: 1;
                }

                .control-section {
                    margin-bottom: 24px;
                }

                .section-label {
                    display: block;
                    font-size: 14px;
                    font-weight: 600;
                    color: #64748b;
                    margin-bottom: 12px;
                }

                .quantity-control-large {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: #f8fafc;
                    padding: 8px;
                    border-radius: 16px;
                }

                .qty-btn {
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #2563eb;
                    font-size: 24px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }

                .qty-btn:active {
                    background: #eff6ff;
                    transform: scale(0.95);
                }

                .qty-btn:disabled {
                    opacity: 0.5;
                    color: #cbd5e1;
                }

                .qty-input-wrapper {
                    flex: 1;
                    height: 48px;
                }

                .qty-input {
                    width: 100%;
                    height: 100%;
                    text-align: center;
                    font-size: 24px;
                    font-weight: 700;
                    color: #1e293b;
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
                    padding: 6px 16px;
                    border-radius: 20px;
                    background: #f1f5f9;
                    color: #64748b;
                    font-size: 14px;
                    font-weight: 600;
                    border: none;
                    white-space: nowrap;
                }

                .quick-add-pills button:active {
                    background: #e2e8f0;
                    color: #334155;
                }

                .price-input-group {
                    position: relative;
                    height: 56px;
                    background: #f8fafc;
                    border-radius: 16px;
                    border: 1px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                }

                .price-input-group:focus-within {
                    border-color: #2563eb;
                    background: #fff;
                    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.1);
                }

                .currency-prefix {
                    font-size: 16px;
                    font-weight: 600;
                    color: #64748b;
                    margin-right: 12px;
                }

                .price-input {
                    flex: 1;
                    height: 100%;
                    border: none;
                    background: transparent;
                    font-size: 20px;
                    font-weight: 600;
                    color: #1e293b;
                    outline: none;
                }

                .divider {
                    height: 1px;
                    background: #f1f5f9;
                    margin: 24px 0;
                }

                .essential-toggle-card {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px;
                    border-radius: 16px;
                    border: 2px solid #e2e8f0;
                    transition: all 0.2s;
                    cursor: pointer;
                }

                .essential-toggle-card.active {
                    border-color: #f59e0b;
                    background: #fffbeb;
                }

                .toggle-info {
                    flex: 1;
                }

                .toggle-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    color: #1e293b;
                    margin-bottom: 4px;
                }

                .alert-icon {
                    color: #cbd5e1;
                }
                
                .essential-toggle-card.active .alert-icon {
                    color: #f59e0b;
                }

                .toggle-desc {
                    font-size: 12px;
                    color: #64748b;
                }

                .switch {
                    width: 52px;
                    height: 32px;
                    background: #cbd5e1;
                    border-radius: 16px;
                    padding: 2px;
                    transition: all 0.2s;
                    position: relative;
                }

                .switch.on {
                    background: #f59e0b;
                }

                .knob {
                    width: 28px;
                    height: 28px;
                    background: white;
                    border-radius: 50%;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    transition: transform 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
                }

                .switch.on .knob {
                    transform: translateX(20px);
                }

                .summary-card {
                    margin-top: 24px;
                    padding: 16px;
                    background: #f8fafc;
                    border-radius: 12px;
                }

                .summary-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 16px;
                    font-weight: 600;
                    color: #1e293b;
                }

                .summary-total {
                    font-size: 20px;
                    color: #2563eb;
                }

                .sheet-footer {
                    padding: 16px 24px;
                    display: flex;
                    gap: 12px;
                    border-top: 1px solid #f1f5f9;
                    background: white;
                }

                .sheet-btn {
                    flex: 1;
                    height: 52px;
                    border-radius: 14px;
                    font-size: 16px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .sheet-btn.secondary {
                    background: #f1f5f9;
                    color: #64748b;
                }

                .sheet-btn.secondary:active {
                    background: #e2e8f0;
                }

                .sheet-btn.primary {
                    background: #2563eb;
                    color: white;
                    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
                }

                .sheet-btn.primary:active {
                    background: #1d4ed8;
                    transform: scale(0.98);
                }
            `}</style>
        </div>,
        document.body
    );
}
