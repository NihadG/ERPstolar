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
                    max-width: 600px;
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
                    justify-content: space-between;
                    border-bottom: 1px solid #f1f5f9;
                }

                .header-text h3 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 700;
                    color: #1e293b;
                }

                .header-text p {
                    margin: 4px 0 0;
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

                .form-group {
                    margin-bottom: 24px;
                }

                .form-group label {
                    display: block;
                    font-size: 14px;
                    font-weight: 600;
                    color: #64748b;
                    margin-bottom: 8px;
                }

                .required {
                    color: #ef4444;
                }

                .mobile-input {
                    width: 100%;
                    height: 48px;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 0 16px;
                    font-size: 16px;
                    color: #1e293b;
                    background: #fcfcfd;
                    outline: none;
                    transition: all 0.2s;
                }

                .mobile-input:focus {
                    border-color: #2563eb;
                    background: white;
                    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.1);
                }

                .mobile-input.large {
                    height: 56px;
                    font-size: 18px;
                    font-weight: 500;
                }
                
                .mobile-textarea {
                    width: 100%;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 12px 16px;
                    font-size: 16px;
                    color: #1e293b;
                    background: #fcfcfd;
                    outline: none;
                    resize: none;
                    font-family: inherit;
                }
                
                .mobile-textarea:focus {
                    border-color: #2563eb;
                    background: white;
                }

                .dims-card {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 16px;
                    padding: 16px;
                    margin-bottom: 24px;
                }

                .dims-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    color: #475569;
                    margin-bottom: 12px;
                }

                .dims-header .material-icons-round {
                    font-size: 18px;
                    color: #94a3b8;
                }

                .dims-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                }

                .dim-input-wrapper {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .dim-input-wrapper label {
                    font-size: 12px;
                    color: #64748b;
                }

                .dim-input-wrapper input {
                    width: 100%;
                    height: 44px;
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    text-align: center;
                    font-size: 16px;
                    font-weight: 600;
                    color: #1e293b;
                    background: white;
                }
                
                .dim-input-wrapper input:focus {
                    border-color: #2563eb;
                    outline: none;
                }

                .quantity-control {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    background: #f8fafc;
                    padding: 8px;
                    border-radius: 16px;
                    width: fit-content;
                }

                .qty-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    background: white;
                    border: 1px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #2563eb;
                    cursor: pointer;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }

                .qty-btn:active {
                    transform: scale(0.95);
                    background: #eff6ff;
                }

                .qty-value {
                    font-size: 20px;
                    font-weight: 700;
                    color: #1e293b;
                    min-width: 32px;
                    text-align: center;
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
                }

                .sheet-btn.secondary {
                    background: #f1f5f9;
                    color: #64748b;
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
