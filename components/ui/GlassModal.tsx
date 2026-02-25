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
    Edge_Processing: boolean;
    Note: string;
}

const DEFAULT_ITEM: GlassItemInput = {
    Qty: 1,
    Width: 0,
    Height: 0,
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
                {/* Compact top bar: material name + price/m² */}
                <div className="gm-topbar">
                    <div className="gm-info">
                        <span className="gm-name">{material?.Name || existingMaterial?.Material_Name}</span>
                        <span className="gm-supplier">{material?.Default_Supplier || existingMaterial?.Supplier || ''}</span>
                    </div>
                    <div className="gm-price">
                        <label>KM/m²</label>
                        <input
                            type="number"
                            value={pricePerM2 || ''}
                            onChange={(e) => setPricePerM2(parseFloat(e.target.value) || 0)}
                            step="0.01"
                            min="0"
                            placeholder="0"
                        />
                    </div>
                </div>

                {/* Table */}
                <div className="gm-table-wrap">
                    <table className="gm-table">
                        <thead>
                            <tr>
                                <th className="th-num">#</th>
                                <th className="th-qty">Kom</th>
                                <th className="th-dim">Širina</th>
                                <th className="th-dim">Visina</th>
                                <th className="th-edge">Obrada</th>
                                <th className="th-area">m²</th>
                                <th className="th-price">Cijena</th>
                                <th className="th-actions"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, index) => {
                                const area = calculateItemArea(item);
                                const price = calculateItemPrice(item);
                                return (
                                    <React.Fragment key={index}>
                                        <tr key={index} className={noteIndex === index ? 'row-active' : ''}>
                                            <td className="td-num">{index + 1}</td>
                                            <td>
                                                <input
                                                    type="number"
                                                    value={item.Qty || ''}
                                                    onChange={(e) => updateItem(index, 'Qty', parseInt(e.target.value) || 1)}
                                                    min="1"
                                                    className="inp inp-qty"
                                                />
                                            </td>
                                            <td>
                                                <div className="inp-unit">
                                                    <input
                                                        type="number"
                                                        value={item.Width || ''}
                                                        onChange={(e) => updateItem(index, 'Width', parseFloat(e.target.value) || 0)}
                                                        min="0"
                                                        placeholder="0"
                                                        className="inp"
                                                    />
                                                    <span>mm</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="inp-unit">
                                                    <input
                                                        type="number"
                                                        value={item.Height || ''}
                                                        onChange={(e) => updateItem(index, 'Height', parseFloat(e.target.value) || 0)}
                                                        min="0"
                                                        placeholder="0"
                                                        className="inp"
                                                    />
                                                    <span>mm</span>
                                                </div>
                                            </td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className={`edge-pill ${item.Edge_Processing ? 'on' : 'off'}`}
                                                    onClick={() => updateItem(index, 'Edge_Processing', !item.Edge_Processing)}
                                                    title={item.Edge_Processing ? 'Obrada rubova uključena (+10%)' : 'Bez obrade rubova'}
                                                >
                                                    {item.Edge_Processing ? '+10%' : 'Ne'}
                                                </button>
                                            </td>
                                            <td className="td-val">{area > 0 ? area.toFixed(3) : '—'}</td>
                                            <td className="td-val td-price">{price > 0 ? `${price.toFixed(2)}` : '—'}</td>
                                            <td className="td-actions">
                                                <button
                                                    type="button"
                                                    className="act-btn"
                                                    onClick={() => setNoteIndex(noteIndex === index ? null : index)}
                                                    title="Napomena"
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '16px', color: item.Note ? 'var(--accent)' : undefined }}>
                                                        {item.Note ? 'sticky_note_2' : 'note_add'}
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="act-btn act-del"
                                                    onClick={() => removeItem(index)}
                                                    disabled={items.length <= 1}
                                                    title="Obriši"
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '16px' }}>close</span>
                                                </button>
                                            </td>
                                        </tr>
                                        {noteIndex === index && (
                                            <tr key={`note-${index}`} className="note-row">
                                                <td></td>
                                                <td colSpan={7}>
                                                    <input
                                                        type="text"
                                                        className="inp inp-note"
                                                        value={item.Note}
                                                        onChange={(e) => updateItem(index, 'Note', e.target.value)}
                                                        placeholder="Napomena za ovaj komad..."
                                                        autoFocus
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Add row */}
                <button type="button" className="gm-add" onClick={addItem}>
                    <span className="material-icons-round">add</span>
                    Dodaj komad
                </button>

                {/* Summary */}
                <div className="gm-summary">
                    <div className="gm-stat">
                        <span>{getTotalCount()}</span> kom
                    </div>
                    <div className="gm-stat">
                        <span>{getTotalArea().toFixed(2)}</span> m²
                    </div>
                    <div className="gm-total">
                        {getTotalPrice().toFixed(2)} KM
                    </div>
                </div>
            </div>

            <style jsx>{`
                .gm {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                /* Top bar */
                .gm-topbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 14px;
                    background: linear-gradient(135deg, #e8f4fd 0%, #f0f4f8 100%);
                    border-radius: 10px;
                    gap: 12px;
                    flex-wrap: wrap;
                }

                .gm-info {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-width: 0;
                }

                .gm-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .gm-supplier {
                    font-size: 12px;
                    color: var(--text-secondary);
                    white-space: nowrap;
                }

                .gm-price {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-shrink: 0;
                }

                .gm-price label {
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    white-space: nowrap;
                }

                .gm-price input {
                    width: 72px;
                    padding: 6px 8px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    text-align: right;
                    background: white;
                    outline: none;
                    transition: border-color 0.15s;
                }

                .gm-price input:focus {
                    border-color: var(--accent);
                }

                /* Table */
                .gm-table-wrap {
                    overflow-x: auto;
                    border: 1px solid var(--border-light, #e5e7eb);
                    border-radius: 10px;
                    background: white;
                }

                .gm-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }

                .gm-table thead {
                    position: sticky;
                    top: 0;
                    z-index: 1;
                }

                .gm-table th {
                    padding: 8px 10px;
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-secondary, #6b7280);
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                    text-align: left;
                    background: var(--surface, #f9fafb);
                    border-bottom: 1px solid var(--border-light, #e5e7eb);
                    white-space: nowrap;
                }

                .th-num { width: 36px; text-align: center; }
                .th-qty { width: 60px; }
                .th-dim { width: 110px; }
                .th-edge { width: 64px; text-align: center; }
                .th-area { width: 70px; text-align: right; }
                .th-price { width: 80px; text-align: right; }
                .th-actions { width: 64px; }

                .gm-table td {
                    padding: 6px 10px;
                    border-bottom: 1px solid var(--border-light, #f3f4f6);
                    vertical-align: middle;
                }

                .gm-table tr:last-child td {
                    border-bottom: none;
                }

                .gm-table tr:hover {
                    background: #fafbfc;
                }

                .gm-table tr.row-active {
                    background: #f0f7ff;
                }

                .td-num {
                    text-align: center;
                    font-weight: 600;
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .td-val {
                    text-align: right;
                    font-weight: 500;
                    color: var(--text-secondary);
                    font-variant-numeric: tabular-nums;
                    font-size: 12px;
                    white-space: nowrap;
                }

                .td-price {
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .td-actions {
                    display: flex;
                    gap: 2px;
                    align-items: center;
                    justify-content: flex-end;
                }

                /* Inputs */
                .inp {
                    width: 100%;
                    padding: 6px 8px;
                    border: 1px solid var(--border, #e0e0e0);
                    border-radius: 6px;
                    font-size: 13px;
                    outline: none;
                    transition: border-color 0.15s;
                    background: white;
                }

                .inp:focus {
                    border-color: var(--accent);
                }

                .inp-qty {
                    width: 48px;
                    text-align: center;
                    font-weight: 600;
                }

                .inp-unit {
                    display: flex;
                    align-items: center;
                    border: 1px solid var(--border, #e0e0e0);
                    border-radius: 6px;
                    overflow: hidden;
                    transition: border-color 0.15s;
                }

                .inp-unit:focus-within {
                    border-color: var(--accent);
                }

                .inp-unit input {
                    flex: 1;
                    padding: 6px 8px;
                    border: none;
                    font-size: 13px;
                    outline: none;
                    min-width: 0;
                }

                .inp-unit span {
                    padding: 6px 6px 6px 2px;
                    font-size: 11px;
                    color: var(--text-tertiary, #9ca3af);
                    flex-shrink: 0;
                }

                .inp-note {
                    border-color: var(--accent);
                    font-size: 12px;
                    padding: 5px 8px;
                }

                /* Edge pill toggle */
                .edge-pill {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 600;
                    border: none;
                    cursor: pointer;
                    transition: all 0.15s;
                    white-space: nowrap;
                }

                .edge-pill.on {
                    background: #dbeafe;
                    color: #2563eb;
                }

                .edge-pill.off {
                    background: #f3f4f6;
                    color: #9ca3af;
                }

                .edge-pill:hover {
                    opacity: 0.8;
                }

                /* Note row */
                .note-row td {
                    padding: 0 10px 8px !important;
                    border-bottom: 1px solid var(--border-light, #f3f4f6) !important;
                }

                /* Action buttons */
                .act-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 26px;
                    height: 26px;
                    border: none;
                    border-radius: 6px;
                    background: transparent;
                    color: var(--text-tertiary, #9ca3af);
                    cursor: pointer;
                    transition: all 0.12s;
                }

                .act-btn:hover:not(:disabled) {
                    background: #f3f4f6;
                    color: var(--text-primary);
                }

                .act-del:hover:not(:disabled) {
                    background: #fef2f2;
                    color: #ef4444;
                }

                .act-btn:disabled {
                    opacity: 0.2;
                    cursor: not-allowed;
                }

                /* Add button */
                .gm-add {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    padding: 10px;
                    background: transparent;
                    border: 1.5px dashed var(--border, #e0e0e0);
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .gm-add:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                    background: rgba(0, 113, 227, 0.04);
                }

                .gm-add .material-icons-round {
                    font-size: 18px;
                }

                /* Summary */
                .gm-summary {
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 20px;
                    padding: 10px 14px;
                    background: var(--surface, #f9fafb);
                    border-radius: 10px;
                }

                .gm-stat {
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .gm-stat span {
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-right: 3px;
                }

                .gm-total {
                    padding: 6px 16px;
                    background: var(--accent, #0071e3);
                    color: white;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 700;
                }

                /* Mobile table → mini cards */
                @media (max-width: 640px) {
                    .gm-table thead { display: none; }

                    .gm-table, .gm-table tbody, .gm-table tr, .gm-table td {
                        display: block;
                    }

                    .gm-table tr {
                        padding: 10px 12px;
                        border-bottom: 1px solid var(--border-light, #f3f4f6);
                        display: grid;
                        grid-template-columns: 24px 48px 1fr 1fr;
                        gap: 6px 8px;
                        align-items: center;
                    }

                    .gm-table tr.note-row {
                        display: block;
                        padding: 0 12px 10px;
                    }

                    .gm-table td { padding: 0; border: none; }

                    .td-num {
                        grid-row: 1 / 3;
                        align-self: center;
                    }

                    .td-actions {
                        grid-column: 4;
                        grid-row: 1;
                        justify-self: end;
                    }

                    .td-val {
                        text-align: left;
                        font-size: 11px;
                    }

                    .td-val::before {
                        font-size: 10px;
                        color: var(--text-tertiary);
                        margin-right: 4px;
                    }

                    .gm-topbar {
                        flex-direction: column;
                        align-items: stretch;
                    }

                    .gm-price {
                        justify-content: space-between;
                    }

                    .gm-summary {
                        flex-wrap: wrap;
                        gap: 12px;
                    }
                }
            `}</style>
        </Modal>
    );
}
