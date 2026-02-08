'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Product } from '@/lib/types';

interface MobileProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Partial<Product> | null;
    onSave: (product: Partial<Product>) => void;
}

export default function MobileProductModal({ isOpen, onClose, product, onSave }: MobileProductModalProps) {
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [animationClass, setAnimationClass] = useState('');

    // Form state
    const [formData, setFormData] = useState<Partial<Product>>({});

    useEffect(() => {
        if (isOpen && product) {
            setFormData({ ...product });
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
    }, [isOpen, product]);

    if (!shouldRender) return null;

    const handleSave = () => {
        onSave(formData);
    };

    const handleIncrement = (amount: number) => {
        setFormData(prev => ({
            ...prev,
            Quantity: Math.max(1, (prev.Quantity || 1) + amount)
        }));
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
                        <h3>{formData.Product_ID ? 'Uredi Proizvod' : 'Novi Proizvod'}</h3>
                        <p>{formData.Product_ID ? 'Ažurirajte detalje proizvoda' : 'Definišite novi proizvod'}</p>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                {/* Content */}
                <div className="sheet-content">
                    <div className="form-group">
                        <label>Naziv <span className="required">*</span></label>
                        <input
                            type="text"
                            className="mobile-input large"
                            placeholder="npr. Gornji element kuhinje"
                            value={formData.Name || ''}
                            onChange={(e) => setFormData({ ...formData, Name: e.target.value })}
                        />
                    </div>

                    <div className="dims-card">
                        <div className="dims-header">
                            <span className="material-icons-round">straighten</span>
                            Dimenzije (mm)
                        </div>
                        <div className="dims-grid">
                            <div className="dim-input-wrapper">
                                <label>Visina</label>
                                <input
                                    type="number"
                                    placeholder="0"
                                    value={formData.Height || ''}
                                    onChange={(e) => setFormData({ ...formData, Height: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="dim-input-wrapper">
                                <label>Širina</label>
                                <input
                                    type="number"
                                    placeholder="0"
                                    value={formData.Width || ''}
                                    onChange={(e) => setFormData({ ...formData, Width: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="dim-input-wrapper">
                                <label>Dubina</label>
                                <input
                                    type="number"
                                    placeholder="0"
                                    value={formData.Depth || ''}
                                    onChange={(e) => setFormData({ ...formData, Depth: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Količina</label>
                        <div className="quantity-control">
                            <button className="qty-btn" onClick={() => handleIncrement(-1)}>
                                <span className="material-icons-round">remove</span>
                            </button>
                            <span className="qty-value">{formData.Quantity || 1}</span>
                            <button className="qty-btn" onClick={() => handleIncrement(1)}>
                                <span className="material-icons-round">add</span>
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Napomene</label>
                        <textarea
                            className="mobile-textarea"
                            rows={3}
                            placeholder="Dodatne napomene za proizvodnju..."
                            value={formData.Notes || ''}
                            onChange={(e) => setFormData({ ...formData, Notes: e.target.value })}
                        />
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="sheet-footer">
                    <button className="sheet-btn secondary" onClick={onClose}>
                        Otkaži
                    </button>
                    <button className="sheet-btn primary" onClick={handleSave}>
                        {formData.Product_ID ? 'Sačuvaj' : 'Dodaj'}
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

                .form-group {
                    margin-bottom: 24px;
                }

                .form-group:last-child {
                    margin-bottom: 0;
                }

                .form-group label {
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

                .mobile-input {
                    width: 100%;
                    height: 50px;
                    border: 1.5px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 0 16px;
                    font-size: 15px;
                    color: #0f172a;
                    background: #fafafa;
                    outline: none;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    font-weight: 400;
                }

                .mobile-input::placeholder {
                    color: #94a3b8;
                }

                .mobile-input:focus {
                    border-color: #2563eb;
                    background: #ffffff;
                    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.08);
                }

                .mobile-input.large {
                    height: 56px;
                    font-size: 16px;
                    font-weight: 500;
                    padding: 0 18px;
                }
                
                .mobile-textarea {
                    width: 100%;
                    border: 1.5px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 14px 16px;
                    font-size: 15px;
                    color: #0f172a;
                    background: #fafafa;
                    outline: none;
                    resize: none;
                    font-family: inherit;
                    line-height: 1.5;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .mobile-textarea::placeholder {
                    color: #94a3b8;
                }
                
                .mobile-textarea:focus {
                    border-color: #2563eb;
                    background: #ffffff;
                    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.08);
                }

                .dims-card {
                    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                    border: 1.5px solid #e2e8f0;
                    border-radius: 16px;
                    padding: 18px;
                    margin-bottom: 24px;
                }

                .dims-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #475569;
                    margin-bottom: 14px;
                    letter-spacing: -0.005em;
                }

                .dims-header .material-icons-round {
                    font-size: 20px;
                    color: #64748b;
                }

                .dims-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 10px;
                }

                @media (min-width: 500px) {
                    .dims-grid {
                        gap: 12px;
                    }
                }

                .dim-input-wrapper {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .dim-input-wrapper label {
                    font-size: 11px;
                    font-weight: 600;
                    color: #64748b;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                }

                .dim-input-wrapper input {
                    width: 100%;
                    height: 48px;
                    border: 1.5px solid #e2e8f0;
                    border-radius: 10px;
                    text-align: center;
                    font-size: 16px;
                    font-weight: 600;
                    color: #0f172a;
                    background: #ffffff;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                
                .dim-input-wrapper input:focus {
                    border-color: #2563eb;
                    outline: none;
                    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
                }

                .quantity-control {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                    padding: 10px;
                    border-radius: 16px;
                    width: fit-content;
                    border: 1.5px solid #e2e8f0;
                }

                .qty-btn {
                    width: 44px;
                    height: 44px;
                    border-radius: 12px;
                    background: #ffffff;
                    border: 1.5px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #2563eb;
                    cursor: pointer;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.04);
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .qty-btn:active {
                    transform: scale(0.95);
                    background: #eff6ff;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
                }

                .qty-value {
                    font-size: 22px;
                    font-weight: 700;
                    color: #0f172a;
                    min-width: 40px;
                    text-align: center;
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

                .sheet-btn.primary:active {
                    background: #1d4ed8;
                    transform: scale(0.98);
                    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
                }
            `}</style>
        </div>,
        document.body
    );
}
