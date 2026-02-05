'use client';

import { useState, useEffect } from 'react';
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
        }
    }, [isOpen, existingMaterial, material]);

    function addItem() {
        setItems([...items, { ...DEFAULT_ITEM }]);
    }

    function removeItem(index: number) {
        if (items.length > 1) {
            setItems(items.filter((_, i) => i !== index));
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
            <div className="glass-modal">
                {/* Header Info Bar */}
                <div className="glass-header">
                    <div className="glass-header-left">
                        <span className="glass-icon">🪟</span>
                        <div>
                            <div className="glass-title">{material?.Name || existingMaterial?.Material_Name}</div>
                            <div className="glass-subtitle">{material?.Default_Supplier || existingMaterial?.Supplier || 'Nema dobavljača'}</div>
                        </div>
                    </div>
                    <div className="glass-header-right">
                        <div className="price-input-group">
                            <label>Cijena/m²</label>
                            <div className="price-input-wrapper">
                                <input
                                    type="number"
                                    value={pricePerM2 || ''}
                                    onChange={(e) => setPricePerM2(parseFloat(e.target.value) || 0)}
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                />
                                <span>KM</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Glass Items List */}
                <div className="glass-items">
                    {items.map((item, index) => (
                        <div key={index} className="glass-item">
                            <div className="glass-item-header">
                                <span className="glass-item-number">{index + 1}</span>
                                <span className="glass-item-dims">
                                    {item.Width > 0 && item.Height > 0
                                        ? `${item.Width} × ${item.Height} mm`
                                        : 'Unesite dimenzije'}
                                </span>
                                <button
                                    type="button"
                                    className="glass-item-delete"
                                    onClick={() => removeItem(index)}
                                    disabled={items.length <= 1}
                                    title="Obriši"
                                >
                                    <span className="material-icons-round">close</span>
                                </button>
                            </div>

                            <div className="glass-item-body">
                                <div className="glass-field">
                                    <label>Kom</label>
                                    <input
                                        type="number"
                                        value={item.Qty || ''}
                                        onChange={(e) => updateItem(index, 'Qty', parseInt(e.target.value) || 1)}
                                        min="1"
                                        className="input-qty"
                                    />
                                </div>
                                <div className="glass-field">
                                    <label>Širina</label>
                                    <div className="input-with-unit">
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
                                <div className="glass-field">
                                    <label>Visina</label>
                                    <div className="input-with-unit">
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
                                <div className="glass-field glass-field-checkbox">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={item.Edge_Processing}
                                            onChange={(e) => updateItem(index, 'Edge_Processing', e.target.checked)}
                                        />
                                        <span>Obrada rubova (+10%)</span>
                                    </label>
                                </div>
                                <div className="glass-field glass-field-note">
                                    <label>Napomena</label>
                                    <input
                                        type="text"
                                        value={item.Note}
                                        onChange={(e) => updateItem(index, 'Note', e.target.value)}
                                        placeholder="Opcionalno..."
                                    />
                                </div>
                            </div>

                            <div className="glass-item-footer">
                                <div className="glass-item-stat">
                                    <span className="stat-label">Površina</span>
                                    <span className="stat-value">{calculateItemArea(item).toFixed(4)} m²</span>
                                </div>
                                <div className="glass-item-stat">
                                    <span className="stat-label">Cijena</span>
                                    <span className="stat-value stat-price">{calculateItemPrice(item).toFixed(2)} KM</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Add Button */}
                <button type="button" className="glass-add-btn" onClick={addItem}>
                    <span className="material-icons-round">add</span>
                    Dodaj komad stakla
                </button>

                {/* Summary Bar */}
                <div className="glass-summary">
                    <div className="summary-item">
                        <span className="summary-label">Komada</span>
                        <span className="summary-value">{getTotalCount()}</span>
                    </div>
                    <div className="summary-item">
                        <span className="summary-label">Površina</span>
                        <span className="summary-value">{getTotalArea().toFixed(2)} m²</span>
                    </div>
                    <div className="summary-item summary-total">
                        <span className="summary-label">Ukupno</span>
                        <span className="summary-value">{getTotalPrice().toFixed(2)} KM</span>
                    </div>
                </div>
            </div>

            <style jsx>{`
                .glass-modal {
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }

                /* Header */
                .glass-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #e3f2fd 0%, #f5f5f7 100%);
                    border-radius: 12px;
                    gap: 16px;
                    flex-wrap: wrap;
                }

                .glass-header-left {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                }

                .glass-icon {
                    font-size: 32px;
                    line-height: 1;
                }

                .glass-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .glass-subtitle {
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .glass-header-right {
                    display: flex;
                    align-items: center;
                }

                .price-input-group {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .price-input-group label {
                    font-size: 11px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .price-input-wrapper {
                    display: flex;
                    align-items: center;
                    background: white;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    overflow: hidden;
                }

                .price-input-wrapper input {
                    width: 80px;
                    padding: 8px 10px;
                    border: none;
                    font-size: 14px;
                    font-weight: 600;
                    text-align: right;
                    outline: none;
                }

                .price-input-wrapper span {
                    padding: 8px 10px 8px 4px;
                    font-size: 13px;
                    color: var(--text-secondary);
                    background: var(--surface);
                }

                /* Items List */
                .glass-items {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    padding-right: 4px;
                }

                .glass-item {
                    background: white;
                    border: 1px solid var(--border-light);
                    border-radius: 12px;
                    overflow: hidden;
                    transition: box-shadow 0.2s;
                }

                .glass-item:hover {
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                }

                .glass-item-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 16px;
                    background: var(--surface);
                    border-bottom: 1px solid var(--border-light);
                }

                .glass-item-number {
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--accent);
                    color: white;
                    border-radius: 50%;
                    font-size: 12px;
                    font-weight: 600;
                }

                .glass-item-dims {
                    flex: 1;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-primary);
                }

                .glass-item-delete {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 28px;
                    height: 28px;
                    background: transparent;
                    border: none;
                    border-radius: 6px;
                    color: var(--text-tertiary);
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .glass-item-delete:hover:not(:disabled) {
                    background: var(--error-bg);
                    color: var(--error);
                }

                .glass-item-delete:disabled {
                    opacity: 0.3;
                    cursor: not-allowed;
                }

                .glass-item-delete .material-icons-round {
                    font-size: 18px;
                }

                .glass-item-body {
                    display: grid;
                    grid-template-columns: 80px 1fr 1fr 160px 1.5fr;
                    gap: 16px;
                    padding: 20px;
                    align-items: end;
                }

                @media (max-width: 900px) {
                    .glass-item-body {
                        grid-template-columns: 80px 1fr 1fr;
                    }
                    
                    .glass-field-checkbox,
                    .glass-field-note {
                        grid-column: span 3;
                    }
                }

                @media (max-width: 540px) {
                    .glass-item-body {
                        grid-template-columns: 1fr 1fr;
                    }
                    
                    .glass-field-checkbox,
                    .glass-field-note {
                        grid-column: span 2;
                    }
                }

                .glass-field {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .glass-field label {
                    font-size: 11px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                }

                .glass-field input[type="number"],
                .glass-field input[type="text"] {
                    padding: 10px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    font-size: 14px;
                    transition: border-color 0.2s, box-shadow 0.2s;
                }

                .glass-field input:focus {
                    outline: none;
                    border-color: var(--accent);
                    box-shadow: 0 0 0 3px var(--accent-light);
                }

                .input-qty {
                    text-align: center;
                    font-weight: 600;
                }

                .input-with-unit {
                    display: flex;
                    align-items: center;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    overflow: hidden;
                    transition: border-color 0.2s, box-shadow 0.2s;
                }

                .input-with-unit:focus-within {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 3px var(--accent-light);
                }

                .input-with-unit input {
                    flex: 1;
                    padding: 10px 12px;
                    border: none;
                    font-size: 14px;
                    outline: none;
                }

                .input-with-unit span {
                    padding: 10px 10px 10px 4px;
                    font-size: 12px;
                    color: var(--text-tertiary);
                }

                .glass-field-checkbox label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: pointer;
                    font-size: 13px;
                    color: var(--text-primary);
                    text-transform: none;
                    letter-spacing: 0;
                    font-weight: 400;
                    padding: 10px 0;
                }

                .glass-field-checkbox input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    accent-color: var(--accent);
                }

                .glass-item-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 24px;
                    padding: 12px 16px;
                    background: var(--surface);
                    border-top: 1px solid var(--border-light);
                }

                .glass-item-stat {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .stat-label {
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .stat-value {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .stat-price {
                    color: var(--accent);
                }

                /* Add Button */
                .glass-add-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 14px;
                    background: white;
                    border: 2px dashed var(--border);
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .glass-add-btn:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                    background: var(--accent-light);
                }

                .glass-add-btn .material-icons-round {
                    font-size: 20px;
                }

                /* Summary Bar */
                .glass-summary {
                    display: flex;
                    justify-content: flex-end;
                    gap: 32px;
                    padding: 16px 20px;
                    background: var(--surface);
                    border-radius: 12px;
                }

                @media (max-width: 480px) {
                    .glass-summary {
                        flex-direction: column;
                        gap: 12px;
                    }
                }

                .summary-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .summary-label {
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .summary-value {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .summary-total {
                    padding: 10px 20px;
                    background: var(--accent);
                    border-radius: 8px;
                    margin-left: 8px;
                }

                .summary-total .summary-label,
                .summary-total .summary-value {
                    color: white;
                }
            `}</style>
        </Modal>
    );
}
