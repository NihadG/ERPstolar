'use client';

import React, { useState, useEffect } from 'react';
import type { Material, ProductMaterial } from '@/lib/types';
import Modal from './Modal';

interface GlassModalProps {
    isOpen: boolean;
    onClose: () => void;
    productId: string;
    material: Material | null;
    existingMaterial?: ProductMaterial | null;
    onSave: (data: GlassModalData) => Promise<void>;
}

export interface GlassModalData {
    productId: string;
    productMaterialId?: string;
    materialId: string;
    materialName: string;
    supplier: string;
    unitPrice: number;
    items: GlassItemInput[];
    isEditMode: boolean;
}

export interface GlassItemInput {
    Qty: number;
    Width: number;
    Height: number;
    Thickness: number;
    Edge_Processing: boolean;
    Note: string;
}

const DEFAULT_ITEM: GlassItemInput = {
    Qty: 1,
    Width: 0,
    Height: 0,
    Thickness: 0,
    Edge_Processing: true,
    Note: '',
};

export default function GlassModal({
    isOpen,
    onClose,
    productId,
    material,
    existingMaterial,
    onSave,
}: GlassModalProps) {
    const [items, setItems] = useState<GlassItemInput[]>([{ ...DEFAULT_ITEM }]);
    const [pricePerM2, setPricePerM2] = useState(0);
    const [saving, setSaving] = useState(false);
    const [noteIndex, setNoteIndex] = useState<number | null>(null);

    useEffect(() => {
        if (isOpen) {
            if (existingMaterial?.glassItems?.length) {
                setItems(existingMaterial.glassItems.map(gi => ({
                    Qty: gi.Qty || 1,
                    Width: gi.Width || 0,
                    Height: gi.Height || 0,
                    Thickness: gi.Thickness || 0,
                    Edge_Processing: gi.Edge_Processing === true,
                    Note: gi.Note || '',
                })));
                setPricePerM2(existingMaterial.Unit_Price || material?.Default_Unit_Price || 0);
            } else {
                setItems([{ ...DEFAULT_ITEM }]);
                setPricePerM2(material?.Default_Unit_Price || 0);
            }
            setNoteIndex(null);
        }
    }, [isOpen, existingMaterial, material]);

    function addItem() {
        setItems([...items, { ...DEFAULT_ITEM }]);
    }

    function removeItem(index: number) {
        if (items.length > 1) {
            setItems(items.filter((_, i) => i !== index));
            if (noteIndex === index) setNoteIndex(null);
            else if (noteIndex !== null && noteIndex > index) setNoteIndex(noteIndex - 1);
        }
    }

    function updateItem(index: number, field: keyof GlassItemInput, value: number | boolean | string) {
        const updated = [...items];
        (updated[index] as any)[field] = value;
        setItems(updated);
    }

    function calculateItemArea(item: GlassItemInput): number {
        return ((item.Width || 0) * (item.Height || 0) / 1000000) * (item.Qty || 1);
    }

    function calculateItemPrice(item: GlassItemInput): number {
        return calculateItemArea(item) * pricePerM2 * (item.Edge_Processing ? 1.10 : 1);
    }

    function getTotalCount(): number {
        return items.reduce((sum, item) => sum + (item.Qty || 1), 0);
    }

    function getTotalArea(): number {
        return items.reduce((sum, item) => sum + calculateItemArea(item), 0);
    }

    function getTotalPrice(): number {
        return items.reduce((sum, item) => sum + calculateItemPrice(item), 0);
    }

    async function handleSave() {
        const validItems = items.filter(item => (item.Width || 0) > 0 && (item.Height || 0) > 0);

        if (validItems.length === 0) {
            alert('Unesite bar jedan komad stakla sa dimenzijama');
            return;
        }

        setSaving(true);
        try {
            await onSave({
                productId,
                productMaterialId: existingMaterial?.ID,
                materialId: material?.Material_ID || existingMaterial?.Material_ID || '',
                materialName: material?.Name || existingMaterial?.Material_Name || '',
                supplier: material?.Default_Supplier || existingMaterial?.Supplier || '',
                unitPrice: pricePerM2,
                items: validItems,
                isEditMode: !!existingMaterial,
            });
            onClose();
        } catch (error) {
            console.error('Save glass error:', error);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={existingMaterial ? 'Uredi Staklo' : 'Novo Staklo'}
            size="xl"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        Otkaži
                    </button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? 'Spremanje...' : 'Sačuvaj'}
                    </button>
                </>
            }
        >
            <div className="gm">
                {/* Header card */}
                <div className="gm-header">
                    <div className="gm-header-left">
                        <div className="gm-mat-icon">
                            <span className="material-icons-round">layers</span>
                        </div>
                        <div className="gm-header-info">
                            <span className="gm-name">{material?.Name || existingMaterial?.Material_Name}</span>
                            <span className="gm-supplier">{material?.Default_Supplier || existingMaterial?.Supplier || ''}</span>
                        </div>
                    </div>
                    <div className="gm-price-input">
                        <span className="gm-price-label">Cijena</span>
                        <div className="gm-price-field">
                            <input
                                type="number"
                                value={pricePerM2 || ''}
                                onChange={(e) => setPricePerM2(parseFloat(e.target.value) || 0)}
                                step="0.01"
                                min="0"
                                placeholder="0"
                            />
                            <span className="gm-price-unit">KM/m²</span>
                        </div>
                    </div>
                </div>

                {/* Items list */}
                <div className="gm-items">
                    {items.map((item, index) => {
                        const area = calculateItemArea(item);
                        const price = calculateItemPrice(item);
                        const isNoteOpen = noteIndex === index;
                        return (
                            <div key={index} className={`gm-card ${isNoteOpen ? 'gm-card-active' : ''}`}>
                                <div className="gm-card-header">
                                    <span className="gm-card-num">{index + 1}</span>
                                    <div className="gm-card-actions">
                                        <button
                                            type="button"
                                            className={`gm-act-btn ${item.Note ? 'has-note' : ''}`}
                                            onClick={() => setNoteIndex(isNoteOpen ? null : index)}
                                            title="Napomena"
                                        >
                                            <span className="material-icons-round">
                                                {item.Note ? 'sticky_note_2' : 'note_add'}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="gm-act-btn gm-act-del"
                                            onClick={() => removeItem(index)}
                                            disabled={items.length <= 1}
                                            title="Obriši"
                                        >
                                            <span className="material-icons-round">delete_outline</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="gm-card-body">
                                    <div className="gm-field gm-field-qty">
                                        <label>Kom</label>
                                        <input
                                            type="number"
                                            value={item.Qty || ''}
                                            onChange={(e) => updateItem(index, 'Qty', parseInt(e.target.value) || 1)}
                                            min="1"
                                        />
                                    </div>
                                    <div className="gm-field">
                                        <label>Širina</label>
                                        <div className="gm-input-unit">
                                            <input
                                                type="number"
                                                value={item.Width || ''}
                                                onChange={(e) => updateItem(index, 'Width', parseFloat(e.target.value) || 0)}
                                                min="0"
                                                placeholder="0"
                                            />
                                            <span>mm</span>
                                        </div>
                                    </div>
                                    <div className="gm-field">
                                        <label>Visina</label>
                                        <div className="gm-input-unit">
                                            <input
                                                type="number"
                                                value={item.Height || ''}
                                                onChange={(e) => updateItem(index, 'Height', parseFloat(e.target.value) || 0)}
                                                min="0"
                                                placeholder="0"
                                            />
                                            <span>mm</span>
                                        </div>
                                    </div>
                                    <div className="gm-field gm-field-thick">
                                        <label>Debljina</label>
                                        <div className="gm-input-unit">
                                            <input
                                                type="number"
                                                value={item.Thickness || ''}
                                                onChange={(e) => updateItem(index, 'Thickness', parseFloat(e.target.value) || 0)}
                                                min="0"
                                                placeholder="0"
                                            />
                                            <span>mm</span>
                                        </div>
                                    </div>
                                    <div className="gm-field gm-field-edge">
                                        <label>Obrada</label>
                                        <button
                                            type="button"
                                            className={`gm-edge-toggle ${item.Edge_Processing ? 'on' : 'off'}`}
                                            onClick={() => updateItem(index, 'Edge_Processing', !item.Edge_Processing)}
                                            title={item.Edge_Processing ? 'Obrada rubova uključena (+10%)' : 'Bez obrade rubova'}
                                        >
                                            <span className="gm-edge-dot" />
                                            <span className="gm-edge-label">{item.Edge_Processing ? '+10%' : 'Ne'}</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="gm-card-footer">
                                    <div className="gm-card-stat">
                                        <span className="gm-card-stat-label">Površina</span>
                                        <span className="gm-card-stat-value">{area > 0 ? `${area.toFixed(3)} m²` : '—'}</span>
                                    </div>
                                    <div className="gm-card-stat gm-card-stat-price">
                                        <span className="gm-card-stat-label">Cijena</span>
                                        <span className="gm-card-stat-value">{price > 0 ? `${price.toFixed(2)} KM` : '—'}</span>
                                    </div>
                                </div>

                                {isNoteOpen && (
                                    <div className="gm-note-row">
                                        <input
                                            type="text"
                                            className="gm-note-input"
                                            value={item.Note}
                                            onChange={(e) => updateItem(index, 'Note', e.target.value)}
                                            placeholder="Napomena za ovaj komad..."
                                            autoFocus
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Add button */}
                <button type="button" className="gm-add" onClick={addItem}>
                    <span className="material-icons-round">add_circle_outline</span>
                    Dodaj komad
                </button>

                {/* Summary */}
                <div className="gm-summary">
                    <div className="gm-summary-stats">
                        <div className="gm-summary-chip">
                            <span className="gm-summary-chip-val">{getTotalCount()}</span>
                            <span className="gm-summary-chip-label">komada</span>
                        </div>
                        <div className="gm-summary-chip">
                            <span className="gm-summary-chip-val">{getTotalArea().toFixed(2)}</span>
                            <span className="gm-summary-chip-label">m²</span>
                        </div>
                    </div>
                    <div className="gm-summary-total">
                        <span className="gm-summary-total-label">Ukupno</span>
                        <span className="gm-summary-total-val">{getTotalPrice().toFixed(2)} KM</span>
                    </div>
                </div>
            </div>

            <style jsx global>{`
                .gm {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    max-width: 680px;
                    margin: 0 auto;
                    width: 100%;
                }

                /* Header */
                .gm-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 16px;
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #f8fafc 0%, #f0f4f8 100%);
                    border: 1px solid #e2e8f0;
                    border-radius: 14px;
                    flex-wrap: wrap;
                }
                .gm-header-left {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    min-width: 0;
                    flex: 1;
                }
                .gm-mat-icon {
                    width: 42px; height: 42px;
                    border-radius: 12px;
                    background: linear-gradient(135deg, #3b82f6, #2563eb);
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                }
                .gm-mat-icon .material-icons-round { font-size: 20px; color: white; }
                .gm-header-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
                .gm-name {
                    font-size: 16px; font-weight: 700; color: #0f172a;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .gm-supplier { font-size: 13px; color: #64748b; font-weight: 500; }
                .gm-price-input {
                    display: flex; flex-direction: column;
                    align-items: flex-end; gap: 4px; flex-shrink: 0;
                }
                .gm-price-label {
                    font-size: 11px; font-weight: 600; color: #94a3b8;
                    text-transform: uppercase; letter-spacing: 0.04em;
                }
                .gm-price-field {
                    display: flex; align-items: center;
                    background: white; border: 1px solid #d1d5db;
                    border-radius: 10px; overflow: hidden; transition: all 0.2s;
                }
                .gm-price-field:focus-within {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
                }
                .gm-price-field input {
                    width: 72px; padding: 8px 10px; border: none;
                    font-size: 15px; font-weight: 700; text-align: right;
                    background: transparent; color: #0f172a; outline: none;
                }
                .gm-price-unit {
                    padding: 8px 10px 8px 2px; font-size: 12px;
                    font-weight: 600; color: #94a3b8; white-space: nowrap;
                }

                /* Item Cards */
                .gm-items { display: flex; flex-direction: column; gap: 10px; }
                .gm-card {
                    background: white; border: 1px solid #e5e7eb;
                    border-radius: 14px; overflow: hidden;
                    transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
                }
                .gm-card:hover { border-color: #cbd5e1; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                .gm-card.gm-card-active {
                    border-color: #93c5fd;
                    box-shadow: 0 0 0 2px rgba(59,130,246,0.08);
                }
                .gm-card-header {
                    display: flex; align-items: center;
                    justify-content: space-between; padding: 10px 14px 0;
                }
                .gm-card-num {
                    width: 24px; height: 24px; border-radius: 8px;
                    background: #f1f5f9; color: #475569;
                    font-size: 12px; font-weight: 700;
                    display: flex; align-items: center; justify-content: center;
                }
                .gm-card-actions { display: flex; gap: 4px; }
                .gm-act-btn {
                    display: flex; align-items: center; justify-content: center;
                    width: 30px; height: 30px; border: none; border-radius: 8px;
                    background: transparent; color: #94a3b8; cursor: pointer;
                    transition: all 0.15s; padding: 0;
                }
                .gm-act-btn .material-icons-round { font-size: 18px; }
                .gm-act-btn:hover:not(:disabled) { background: #f1f5f9; color: #475569; }
                .gm-act-btn.has-note { color: #3b82f6; }
                .gm-act-del:hover:not(:disabled) { background: #fef2f2; color: #ef4444; }
                .gm-act-btn:disabled { opacity: 0.25; cursor: not-allowed; }

                /* Card body fields */
                .gm-card-body {
                    display: grid;
                    grid-template-columns: 60px 1fr 1fr 1fr auto;
                    gap: 8px; padding: 10px 14px; align-items: end;
                }
                .gm-field { display: flex; flex-direction: column; gap: 4px; }
                .gm-field > label {
                    font-size: 10px; font-weight: 700; color: #94a3b8;
                    text-transform: uppercase; letter-spacing: 0.05em; padding-left: 2px;
                }
                .gm-field input[type="number"] {
                    width: 100%; padding: 8px 10px;
                    border: 1px solid #d1d5db; border-radius: 8px;
                    font-size: 14px; font-weight: 600; color: #0f172a;
                    background: #f9fafb; outline: none; transition: all 0.15s;
                    box-sizing: border-box;
                }
                .gm-field input:hover { background: #f1f5f9; }
                .gm-field input:focus {
                    background: white; border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
                }
                .gm-field-qty input { text-align: center; }
                .gm-input-unit {
                    display: flex; align-items: center;
                    border: 1px solid #d1d5db; border-radius: 8px;
                    background: #f9fafb; overflow: hidden; transition: all 0.15s;
                }
                .gm-input-unit:hover { background: #f1f5f9; }
                .gm-input-unit:focus-within {
                    background: white; border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
                }
                .gm-input-unit input {
                    flex: 1; padding: 8px 10px; border: none;
                    background: transparent; font-size: 14px; font-weight: 600;
                    color: #0f172a; outline: none; min-width: 0;
                }
                .gm-input-unit span {
                    padding: 8px 8px 8px 0; font-size: 11px;
                    font-weight: 600; color: #94a3b8; flex-shrink: 0;
                }

                /* Edge toggle */
                .gm-field-edge { min-width: 72px; }
                .gm-edge-toggle {
                    display: inline-flex; align-items: center; gap: 6px;
                    padding: 7px 12px; border: 1px solid transparent;
                    border-radius: 20px; cursor: pointer;
                    transition: all 0.2s; white-space: nowrap;
                    font-size: 12px; font-weight: 700;
                }
                .gm-edge-toggle.on { background: #dbeafe; color: #1d4ed8; border-color: #bfdbfe; }
                .gm-edge-toggle.off { background: #f3f4f6; color: #94a3b8; border-color: #e5e7eb; }
                .gm-edge-dot {
                    width: 8px; height: 8px; border-radius: 50%; transition: background 0.2s;
                }
                .gm-edge-toggle.on .gm-edge-dot { background: #3b82f6; }
                .gm-edge-toggle.off .gm-edge-dot { background: #cbd5e1; }
                .gm-edge-toggle:hover { filter: brightness(0.95); transform: translateY(-1px); }
                .gm-edge-toggle:active { transform: translateY(0); }

                /* Card footer */
                .gm-card-footer {
                    display: flex; align-items: center;
                    justify-content: flex-end; gap: 16px;
                    padding: 8px 14px 10px; border-top: 1px solid #f1f5f9;
                }
                .gm-card-stat { display: flex; align-items: center; gap: 6px; }
                .gm-card-stat-label { font-size: 11px; font-weight: 500; color: #94a3b8; }
                .gm-card-stat-value {
                    font-size: 13px; font-weight: 700; color: #475569;
                    font-variant-numeric: tabular-nums;
                }
                .gm-card-stat-price .gm-card-stat-value { color: #0f172a; font-size: 14px; }

                /* Note */
                .gm-note-row { padding: 0 14px 12px; }
                .gm-note-input {
                    width: 100%; padding: 10px 14px;
                    border: 1px solid #93c5fd; border-radius: 10px;
                    font-size: 13px; font-weight: 500; color: #0f172a;
                    background: #eff6ff; outline: none; transition: all 0.15s;
                    box-sizing: border-box;
                }
                .gm-note-input:focus {
                    background: white; border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
                }

                /* Add button */
                .gm-add {
                    display: flex; align-items: center; justify-content: center;
                    gap: 8px; padding: 12px; background: transparent;
                    border: 2px dashed #d1d5db; border-radius: 12px;
                    font-size: 14px; font-weight: 600; color: #6b7280;
                    cursor: pointer; transition: all 0.2s;
                }
                .gm-add .material-icons-round { font-size: 20px; }
                .gm-add:hover { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; }
                .gm-add:active { transform: scale(0.99); }

                /* Summary */
                .gm-summary {
                    display: flex; align-items: center;
                    justify-content: space-between; padding: 14px 18px;
                    background: #f8fafc; border: 1px solid #e2e8f0;
                    border-radius: 14px; gap: 16px; flex-wrap: wrap;
                }
                .gm-summary-stats { display: flex; gap: 20px; }
                .gm-summary-chip { display: flex; align-items: baseline; gap: 4px; }
                .gm-summary-chip-val { font-size: 18px; font-weight: 800; color: #0f172a; }
                .gm-summary-chip-label { font-size: 13px; font-weight: 500; color: #64748b; }
                .gm-summary-total {
                    display: flex; align-items: center; gap: 10px;
                    padding: 8px 16px; background: #2563eb;
                    border-radius: 10px;
                    box-shadow: 0 4px 6px -1px rgba(37,99,235,0.2);
                }
                .gm-summary-total-label { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.7); }
                .gm-summary-total-val { font-size: 17px; font-weight: 800; color: white; }

                /* Mobile */
                @media (max-width: 640px) {
                    .gm { gap: 12px; }
                    .gm-header { flex-direction: column; align-items: stretch; gap: 12px; }
                    .gm-price-input { flex-direction: row; align-items: center; justify-content: space-between; }
                    .gm-card-body { grid-template-columns: 1fr 1fr; gap: 10px; }
                    .gm-field-qty, .gm-field-thick, .gm-field-edge { grid-column: 1 / -1; }
                    .gm-field-edge { flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; }
                    .gm-card-footer { justify-content: space-between; }
                    .gm-summary { flex-direction: column; align-items: stretch; gap: 12px; }
                    .gm-summary-stats { justify-content: space-around; }
                    .gm-summary-total { justify-content: center; }
                }
            `}</style>
        </Modal>
    );
}
