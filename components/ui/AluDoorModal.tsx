'use client';

import { useState, useEffect } from 'react';
import type { Material, ProductMaterial } from '@/lib/types';
import Modal from './Modal';

interface AluDoorModalProps {
    isOpen: boolean;
    onClose: () => void;
    productId: string;
    material: Material | null;
    existingMaterial?: ProductMaterial | null;
    onSave: (data: AluDoorModalData) => Promise<void>;
}

export interface AluDoorModalData {
    productId: string;
    productMaterialId?: string;
    materialId: string;
    materialName: string;
    supplier: string;
    unitPrice: number;
    items: AluDoorItemInput[];
    isEditMode: boolean;
}

export interface AluDoorItemInput {
    Qty: number;
    Width: number;
    Height: number;
    Frame_Type: string;
    Glass_Type: string;
    Frame_Color: string;
    Hinge_Color: string;
    Hinge_Type: string;
    Hinge_Side: string;
    Hinge_Layout: string;
    Hinge_Positions: number[];
    Integrated_Handle: boolean;
    Note: string;
}

const GLASS_TYPES = [
    { value: 'float', label: 'Float (čisto)' },
    { value: 'bronza', label: 'Bronza' },
    { value: 'flutes', label: 'Flutes (rebrasto)' },
    { value: 'gray', label: 'Gray (sivo)' },
    { value: 'dark gray', label: 'Dark Gray' },
    { value: 'mlijecno', label: 'Mliječno' },
    { value: 'satinato', label: 'Satinato (mat)' },
];

const FRAME_TYPES = [
    { value: 'uski', label: 'Uski profil' },
    { value: 'siroki', label: 'Široki profil' },
];

const HINGE_TYPES = [
    { value: 'ravne', label: 'Ravne' },
    { value: 'krive', label: 'Krive' },
    { value: 'polukrive', label: 'Polukrive' },
];

const DEFAULT_ITEM: AluDoorItemInput = {
    Qty: 1,
    Width: 0,
    Height: 0,
    Frame_Type: 'uski',
    Glass_Type: 'float',
    Frame_Color: '',
    Hinge_Color: '',
    Hinge_Type: 'ravne',
    Hinge_Side: 'lijevo',
    Hinge_Layout: 'osnovna',
    Hinge_Positions: [],
    Integrated_Handle: false,
    Note: '',
};

export default function AluDoorModal({
    isOpen,
    onClose,
    productId,
    material,
    existingMaterial,
    onSave,
}: AluDoorModalProps) {
    const [items, setItems] = useState<AluDoorItemInput[]>([{ ...DEFAULT_ITEM }]);
    const [pricePerM2, setPricePerM2] = useState(200);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState(0);

    useEffect(() => {
        if (isOpen) {
            if (existingMaterial?.aluDoorItems?.length) {
                setItems(existingMaterial.aluDoorItems.map(item => {
                    let hingePositions: number[] = [];
                    if (item.Hinge_Positions) {
                        if (typeof item.Hinge_Positions === 'string') {
                            try { hingePositions = JSON.parse(item.Hinge_Positions); } catch { hingePositions = []; }
                        } else if (Array.isArray(item.Hinge_Positions)) {
                            hingePositions = item.Hinge_Positions as unknown as number[];
                        }
                    }
                    return {
                        Qty: item.Qty || 1,
                        Width: item.Width || 0,
                        Height: item.Height || 0,
                        Frame_Type: item.Frame_Type || 'uski',
                        Glass_Type: item.Glass_Type || 'float',
                        Frame_Color: item.Frame_Color || '',
                        Hinge_Color: item.Hinge_Color || '',
                        Hinge_Type: item.Hinge_Type || 'ravne',
                        Hinge_Side: item.Hinge_Side || 'lijevo',
                        Hinge_Layout: item.Hinge_Layout || 'osnovna',
                        Hinge_Positions: hingePositions,
                        Integrated_Handle: item.Integrated_Handle === true,
                        Note: item.Note || '',
                    };
                }));
                setPricePerM2(existingMaterial.Unit_Price || material?.Default_Unit_Price || 200);
                setActiveTab(0);
            } else {
                setItems([{ ...DEFAULT_ITEM, Hinge_Positions: [] }]);
                setPricePerM2(material?.Default_Unit_Price || 200);
                setActiveTab(0);
            }
        }
    }, [isOpen, existingMaterial, material]);

    function addItem() {
        setItems([...items, { ...DEFAULT_ITEM, Hinge_Positions: [] }]);
        setActiveTab(items.length);
    }

    function removeItem(index: number) {
        if (items.length > 1) {
            setItems(items.filter((_, i) => i !== index));
            if (activeTab >= items.length - 1) setActiveTab(Math.max(0, items.length - 2));
        }
    }

    function updateItem(index: number, field: keyof AluDoorItemInput, value: any) {
        const updated = [...items];
        updated[index] = { ...updated[index], [field]: value };
        if (field === 'Hinge_Layout' && value === 'specijalna' && !updated[index].Hinge_Positions.length) {
            updated[index].Hinge_Positions = [100];
        }
        setItems(updated);
    }

    function addHingePosition(doorIndex: number) {
        const updated = [...items];
        updated[doorIndex].Hinge_Positions = [...updated[doorIndex].Hinge_Positions, 0];
        setItems(updated);
    }

    function removeHingePosition(doorIndex: number, hingeIndex: number) {
        const updated = [...items];
        updated[doorIndex].Hinge_Positions = updated[doorIndex].Hinge_Positions.filter((_, i) => i !== hingeIndex);
        setItems(updated);
    }

    function updateHingePosition(doorIndex: number, hingeIndex: number, value: number) {
        const updated = [...items];
        updated[doorIndex].Hinge_Positions[hingeIndex] = value;
        setItems(updated);
    }

    function calculateItemArea(item: AluDoorItemInput): number {
        return ((item.Width || 0) * (item.Height || 0) / 1000000) * (item.Qty || 1);
    }

    function calculateItemPrice(item: AluDoorItemInput): number {
        return calculateItemArea(item) * pricePerM2;
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
            alert('Unesite bar jedna vrata sa dimenzijama');
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
                items: validItems.map(item => ({
                    ...item,
                    Hinge_Positions: item.Hinge_Positions.filter(p => p > 0),
                })),
                isEditMode: !!existingMaterial,
            });
            onClose();
        } catch (error) {
            console.error('Save alu door error:', error);
        } finally {
            setSaving(false);
        }
    }

    const currentItem = items[activeTab] || items[0];

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={existingMaterial ? 'Uredi Alu Vrata' : 'Nova Alu Vrata'}
            size="xl"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Otkaži</button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? 'Spremanje...' : 'Sačuvaj'}
                    </button>
                </>
            }
        >
            <div className="am">
                {/* Compact header */}
                <div className="am-topbar">
                    <div className="am-info">
                        <span className="am-name">{material?.Name || existingMaterial?.Material_Name}</span>
                        <span className="am-supplier">{material?.Default_Supplier || existingMaterial?.Supplier || ''}</span>
                    </div>
                    <div className="am-price">
                        <label>KM/m²</label>
                        <input
                            type="number"
                            value={pricePerM2 || ''}
                            onChange={(e) => setPricePerM2(parseFloat(e.target.value) || 0)}
                            step="0.01"
                            min="0"
                        />
                    </div>
                </div>

                {/* Compact tabs */}
                <div className="am-tabs">
                    {items.map((item, index) => (
                        <button
                            key={index}
                            type="button"
                            className={`am-tab ${activeTab === index ? 'active' : ''}`}
                            onClick={() => setActiveTab(index)}
                        >
                            <span className="am-tab-num">{index + 1}</span>
                            {item.Width > 0 && item.Height > 0 && (
                                <span className="am-tab-dims">{item.Width}×{item.Height}</span>
                            )}
                            {items.length > 1 && activeTab === index && (
                                <button
                                    type="button"
                                    className="am-tab-del"
                                    onClick={(e) => { e.stopPropagation(); removeItem(index); }}
                                    title="Obriši"
                                >
                                    <span className="material-icons-round">close</span>
                                </button>
                            )}
                        </button>
                    ))}
                    <button type="button" className="am-tab am-tab-add" onClick={addItem}>
                        <span className="material-icons-round">add</span>
                    </button>
                </div>

                {/* Form — two-column dense layout */}
                <div className="am-form">
                    {/* Row 1: Dimensions */}
                    <div className="am-row am-row-3">
                        <div className="am-field">
                            <label>Količina</label>
                            <input
                                type="number"
                                value={currentItem.Qty || ''}
                                min="1"
                                onChange={(e) => updateItem(activeTab, 'Qty', parseInt(e.target.value) || 1)}
                            />
                        </div>
                        <div className="am-field">
                            <label>Širina (mm)</label>
                            <input
                                type="number"
                                value={currentItem.Width || ''}
                                min="0"
                                placeholder="0"
                                onChange={(e) => updateItem(activeTab, 'Width', parseFloat(e.target.value) || 0)}
                            />
                        </div>
                        <div className="am-field">
                            <label>Visina (mm)</label>
                            <input
                                type="number"
                                value={currentItem.Height || ''}
                                min="0"
                                placeholder="0"
                                onChange={(e) => updateItem(activeTab, 'Height', parseFloat(e.target.value) || 0)}
                            />
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="am-divider"></div>

                    {/* Row 2: Appearance */}
                    <div className="am-row am-row-2">
                        <div className="am-field">
                            <label>Ram</label>
                            <div className="seg-group">
                                {FRAME_TYPES.map(f => (
                                    <button
                                        key={f.value}
                                        type="button"
                                        className={`seg-btn ${currentItem.Frame_Type === f.value ? 'active' : ''}`}
                                        onClick={() => updateItem(activeTab, 'Frame_Type', f.value)}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="am-field">
                            <label>Staklo</label>
                            <select
                                value={currentItem.Glass_Type}
                                onChange={(e) => updateItem(activeTab, 'Glass_Type', e.target.value)}
                            >
                                {GLASS_TYPES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="am-row am-row-2">
                        <div className="am-field">
                            <label>Boja rama</label>
                            <input
                                type="text"
                                value={currentItem.Frame_Color}
                                placeholder="npr. Crna, Bijela..."
                                onChange={(e) => updateItem(activeTab, 'Frame_Color', e.target.value)}
                            />
                        </div>
                        <div className="am-field am-field-check">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={currentItem.Integrated_Handle}
                                    onChange={(e) => updateItem(activeTab, 'Integrated_Handle', e.target.checked)}
                                />
                                Integrisana ručka
                            </label>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="am-divider"></div>

                    {/* Row 3: Hinges */}
                    <div className="am-row am-row-2">
                        <div className="am-field">
                            <label>Baglame</label>
                            <div className="seg-group">
                                {HINGE_TYPES.map(h => (
                                    <button
                                        key={h.value}
                                        type="button"
                                        className={`seg-btn ${currentItem.Hinge_Type === h.value ? 'active' : ''}`}
                                        onClick={() => updateItem(activeTab, 'Hinge_Type', h.value)}
                                    >
                                        {h.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="am-field">
                            <label>Boja baglama</label>
                            <input
                                type="text"
                                value={currentItem.Hinge_Color}
                                placeholder="npr. Crna, Inox..."
                                onChange={(e) => updateItem(activeTab, 'Hinge_Color', e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="am-row am-row-2">
                        <div className="am-field">
                            <label>Strana</label>
                            <div className="seg-group">
                                <button
                                    type="button"
                                    className={`seg-btn ${currentItem.Hinge_Side === 'lijevo' ? 'active' : ''}`}
                                    onClick={() => updateItem(activeTab, 'Hinge_Side', 'lijevo')}
                                >
                                    ← Lijevo
                                </button>
                                <button
                                    type="button"
                                    className={`seg-btn ${currentItem.Hinge_Side === 'desno' ? 'active' : ''}`}
                                    onClick={() => updateItem(activeTab, 'Hinge_Side', 'desno')}
                                >
                                    Desno →
                                </button>
                            </div>
                        </div>
                        <div className="am-field">
                            <label>Raspored</label>
                            <div className="seg-group">
                                <button
                                    type="button"
                                    className={`seg-btn ${currentItem.Hinge_Layout === 'osnovna' ? 'active' : ''}`}
                                    onClick={() => updateItem(activeTab, 'Hinge_Layout', 'osnovna')}
                                >
                                    Osnovna
                                </button>
                                <button
                                    type="button"
                                    className={`seg-btn ${currentItem.Hinge_Layout === 'specijalna' ? 'active' : ''}`}
                                    onClick={() => updateItem(activeTab, 'Hinge_Layout', 'specijalna')}
                                >
                                    Specijalna
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Custom hinge positions */}
                    {currentItem.Hinge_Layout === 'specijalna' && (
                        <div className="am-hinges">
                            <span className="am-hinges-label">Pozicije od dna (mm):</span>
                            <div className="am-hinges-list">
                                {currentItem.Hinge_Positions.map((pos, hingeIdx) => (
                                    <div key={hingeIdx} className="am-hinge-chip">
                                        <input
                                            type="number"
                                            value={pos || ''}
                                            min="0"
                                            placeholder="mm"
                                            onChange={(e) => updateHingePosition(activeTab, hingeIdx, parseFloat(e.target.value) || 0)}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeHingePosition(activeTab, hingeIdx)}
                                        >
                                            <span className="material-icons-round">close</span>
                                        </button>
                                    </div>
                                ))}
                                <button type="button" className="am-hinge-add" onClick={() => addHingePosition(activeTab)}>
                                    <span className="material-icons-round">add</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Note */}
                    <div className="am-field am-field-full">
                        <label>Napomena</label>
                        <input
                            type="text"
                            value={currentItem.Note}
                            placeholder="Dodatne napomene..."
                            onChange={(e) => updateItem(activeTab, 'Note', e.target.value)}
                        />
                    </div>

                    {/* Item stats */}
                    <div className="am-item-stats">
                        <span>{calculateItemArea(currentItem).toFixed(3)} m²</span>
                        <span className="am-item-price">{calculateItemPrice(currentItem).toFixed(2)} KM</span>
                    </div>
                </div>

                {/* Total summary */}
                <div className="am-summary">
                    <div className="am-stat">
                        <span>{getTotalCount()}</span> vrata
                    </div>
                    <div className="am-stat">
                        <span>{getTotalArea().toFixed(2)}</span> m²
                    </div>
                    <div className="am-total">
                        {getTotalPrice().toFixed(2)} KM
                    </div>
                </div>
            </div>

            <style jsx>{`
                .am {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                /* Top bar */
                .am-topbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 14px;
                    background: linear-gradient(135deg, #fef3e2 0%, #fdf0e8 100%);
                    border-radius: 10px;
                    gap: 12px;
                    flex-wrap: wrap;
                }

                .am-info {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-width: 0;
                }

                .am-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .am-supplier {
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .am-price {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-shrink: 0;
                }

                .am-price label {
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-secondary);
                }

                .am-price input {
                    width: 72px;
                    padding: 6px 8px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    text-align: right;
                    background: white;
                    outline: none;
                }

                .am-price input:focus {
                    border-color: var(--accent);
                }

                /* Tabs */
                .am-tabs {
                    display: flex;
                    gap: 4px;
                    overflow-x: auto;
                    padding: 4px;
                    background: var(--surface, #f9fafb);
                    border-radius: 10px;
                }

                .am-tab {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    padding: 6px 12px;
                    background: white;
                    border: 1px solid var(--border-light, #e5e7eb);
                    border-radius: 7px;
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.12s;
                    white-space: nowrap;
                    position: relative;
                }

                .am-tab:hover { border-color: var(--accent); }

                .am-tab.active {
                    background: var(--accent, #0071e3);
                    border-color: var(--accent);
                    color: white;
                }

                .am-tab-num {
                    width: 18px;
                    height: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface, #f3f4f6);
                    border-radius: 50%;
                    font-size: 10px;
                    font-weight: 700;
                }

                .am-tab.active .am-tab-num {
                    background: rgba(255,255,255,0.25);
                    color: white;
                }

                .am-tab-dims {
                    font-size: 11px;
                    opacity: 0.8;
                }

                .am-tab-del {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 16px;
                    height: 16px;
                    border: none;
                    border-radius: 50%;
                    background: rgba(255,255,255,0.3);
                    color: white;
                    cursor: pointer;
                    padding: 0;
                    margin-left: 2px;
                }

                .am-tab-del:hover {
                    background: rgba(255,255,255,0.5);
                }

                .am-tab-del .material-icons-round {
                    font-size: 12px;
                }

                .am-tab-add {
                    background: transparent !important;
                    border-style: dashed !important;
                    color: var(--text-tertiary) !important;
                }

                .am-tab-add:hover {
                    color: var(--accent) !important;
                    border-color: var(--accent) !important;
                }

                .am-tab-add .material-icons-round {
                    font-size: 16px;
                }

                /* Form */
                .am-form {
                    background: white;
                    border: 1px solid var(--border-light, #e5e7eb);
                    border-radius: 10px;
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .am-divider {
                    height: 1px;
                    background: var(--border-light, #f3f4f6);
                    margin: 2px 0;
                }

                .am-row {
                    display: grid;
                    gap: 12px;
                }

                .am-row-2 { grid-template-columns: 1fr 1fr; }
                .am-row-3 { grid-template-columns: 1fr 1fr 1fr; }

                @media (max-width: 540px) {
                    .am-row-2, .am-row-3 { grid-template-columns: 1fr; }
                }

                .am-field {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .am-field-full {
                    grid-column: 1 / -1;
                }

                .am-field > label {
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-secondary, #6b7280);
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                }

                .am-field input[type="text"],
                .am-field input[type="number"],
                .am-field select {
                    padding: 7px 10px;
                    border: 1px solid var(--border, #e0e0e0);
                    border-radius: 7px;
                    font-size: 13px;
                    background: white;
                    outline: none;
                    transition: border-color 0.15s;
                }

                .am-field input:focus,
                .am-field select:focus {
                    border-color: var(--accent);
                }

                /* Checkbox field */
                .am-field-check {
                    justify-content: flex-end;
                }

                .am-field-check label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 400;
                    color: var(--text-primary);
                    text-transform: none;
                    letter-spacing: 0;
                    cursor: pointer;
                    padding: 7px 0;
                }

                .am-field-check input[type="checkbox"] {
                    width: 16px;
                    height: 16px;
                    accent-color: var(--accent);
                }

                /* Segmented buttons */
                .seg-group {
                    display: flex;
                    border: 1px solid var(--border, #e0e0e0);
                    border-radius: 7px;
                    overflow: hidden;
                }

                .seg-btn {
                    flex: 1;
                    padding: 7px 8px;
                    border: none;
                    background: white;
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.12s;
                    border-right: 1px solid var(--border-light, #f3f4f6);
                    white-space: nowrap;
                }

                .seg-btn:last-child { border-right: none; }

                .seg-btn.active {
                    background: var(--accent, #0071e3);
                    color: white;
                    font-weight: 600;
                }

                .seg-btn:hover:not(.active) {
                    background: #f9fafb;
                }

                /* Hinge positions */
                .am-hinges {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-wrap: wrap;
                    padding: 8px 0;
                }

                .am-hinges-label {
                    font-size: 11px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    white-space: nowrap;
                }

                .am-hinges-list {
                    display: flex;
                    gap: 6px;
                    flex-wrap: wrap;
                    align-items: center;
                }

                .am-hinge-chip {
                    display: flex;
                    align-items: center;
                    background: var(--surface, #f3f4f6);
                    border-radius: 6px;
                    overflow: hidden;
                }

                .am-hinge-chip input {
                    width: 52px;
                    padding: 5px 6px;
                    border: none;
                    background: transparent;
                    font-size: 12px;
                    text-align: center;
                    outline: none;
                }

                .am-hinge-chip button {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 22px;
                    height: 22px;
                    border: none;
                    background: transparent;
                    color: var(--text-tertiary);
                    cursor: pointer;
                    padding: 0;
                }

                .am-hinge-chip button:hover {
                    color: #ef4444;
                }

                .am-hinge-chip button .material-icons-round {
                    font-size: 14px;
                }

                .am-hinge-add {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 28px;
                    height: 28px;
                    border: 1px dashed var(--border);
                    border-radius: 6px;
                    background: transparent;
                    color: var(--text-tertiary);
                    cursor: pointer;
                    transition: all 0.12s;
                }

                .am-hinge-add:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                }

                .am-hinge-add .material-icons-round {
                    font-size: 16px;
                }

                /* Item stats */
                .am-item-stats {
                    display: flex;
                    gap: 16px;
                    justify-content: flex-end;
                    padding: 8px 0 0;
                    border-top: 1px solid var(--border-light, #f3f4f6);
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .am-item-price {
                    font-weight: 600;
                    color: var(--accent);
                }

                /* Summary */
                .am-summary {
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 20px;
                    padding: 10px 14px;
                    background: var(--surface, #f9fafb);
                    border-radius: 10px;
                }

                .am-stat {
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .am-stat span {
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-right: 3px;
                }

                .am-total {
                    padding: 6px 16px;
                    background: var(--accent, #0071e3);
                    color: white;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 700;
                }

                /* Mobile */
                @media (max-width: 540px) {
                    .am-topbar {
                        flex-direction: column;
                        align-items: stretch;
                    }

                    .am-price {
                        justify-content: space-between;
                    }

                    .am-summary {
                        flex-wrap: wrap;
                        gap: 12px;
                    }

                    .seg-group {
                        flex-wrap: wrap;
                    }

                    .seg-btn {
                        min-width: auto;
                    }
                }
            `}</style>
        </Modal>
    );
}
