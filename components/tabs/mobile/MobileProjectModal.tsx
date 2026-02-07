'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '@/lib/types';
import { PROJECT_STATUSES } from '@/lib/types';

interface MobileProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: Partial<Project> | null;
    onSave: (project: Partial<Project>) => void;
}

export default function MobileProjectModal({ isOpen, onClose, project, onSave }: MobileProjectModalProps) {
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [animationClass, setAnimationClass] = useState('');

    // Form state
    const [formData, setFormData] = useState<Partial<Project>>({});

    useEffect(() => {
        if (isOpen && project) {
            setFormData({ ...project });
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
    }, [isOpen, project]);

    if (!shouldRender) return null;

    const handleSave = () => {
        onSave(formData);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Nacrt': return { bg: '#f3f4f6', color: '#6b7280' };
            case 'Ponuđeno': return { bg: '#fef3c7', color: '#d97706' };
            case 'Odobreno': return { bg: '#dbeafe', color: '#2563eb' };
            case 'U proizvodnji': return { bg: '#ede9fe', color: '#7c3aed' };
            case 'Završeno': return { bg: '#dcfce7', color: '#15803d' };
            case 'Otkazano': return { bg: '#fee2e2', color: '#dc2626' };
            default: return { bg: '#f3f4f6', color: '#6b7280' };
        }
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
                        <h3>{formData.Project_ID ? 'Uredi Projekat' : 'Novi Projekat'}</h3>
                        <p>{formData.Project_ID ? 'Ažurirajte detalje projekta' : 'Unesite osnovne informacije'}</p>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                {/* Content */}
                <div className="sheet-content">
                    <div className="form-group">
                        <label>Klijent / Ime projekta <span className="required">*</span></label>
                        <input
                            type="text"
                            className="mobile-input large"
                            placeholder="npr. Kuhinja - Ivan Horvat"
                            value={formData.Client_Name || ''}
                            onChange={(e) => setFormData({ ...formData, Client_Name: e.target.value })}
                        />
                    </div>

                    <div className="form-group">
                        <label>Adresa</label>
                        <div className="input-with-icon">
                            <span className="material-icons-round icon">place</span>
                            <input
                                type="text"
                                className="mobile-input"
                                placeholder="Adresa lokacije"
                                value={formData.Address || ''}
                                onChange={(e) => setFormData({ ...formData, Address: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Status</label>
                        <div className="status-grid">
                            {PROJECT_STATUSES.map(status => {
                                const isSelected = (formData.Status || 'Nacrt') === status;
                                const colors = getStatusColor(status);
                                return (
                                    <button
                                        key={status}
                                        className={`status-chip ${isSelected ? 'selected' : ''}`}
                                        onClick={() => setFormData({ ...formData, Status: status })}
                                        style={isSelected ? {
                                            backgroundColor: colors.bg,
                                            color: colors.color,
                                            borderColor: colors.bg
                                        } : {}}
                                    >
                                        {isSelected && <span className="material-icons-round check">check</span>}
                                        {status}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="sheet-footer">
                    <button className="sheet-btn secondary" onClick={onClose}>
                        Otkaži
                    </button>
                    <button className="sheet-btn primary" onClick={handleSave}>
                        {formData.Project_ID ? 'Sačuvaj' : 'Kreiraj'}
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

                .input-with-icon {
                    position: relative;
                }

                .input-with-icon .mobile-input {
                    padding-left: 44px;
                }

                .input-with-icon .icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #94a3b8;
                    font-size: 20px;
                }

                .status-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 8px;
                }

                .status-chip {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 12px;
                    border: 1px solid #e2e8f0;
                    background: white;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 500;
                    color: #64748b;
                    transition: all 0.2s;
                }

                .status-chip .check {
                    font-size: 16px;
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
