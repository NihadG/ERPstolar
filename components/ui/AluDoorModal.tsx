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

const HINGE_SIDES = [
    { value: 'lijevo', label: 'Lijevo' },
    { value: 'desno', label: 'Desno' },
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
            <div className="alu-modal">
                {/* Header */}
                <div className="alu-header">
                    <div className="alu-header-left">
                        <span className="alu-icon">🚪</span>
                        <div>
                            <div className="alu-title">{material?.Name || existingMaterial?.Material_Name}</div>
                            <div className="alu-subtitle">{material?.Default_Supplier || existingMaterial?.Supplier || 'Nema dobavljača'}</div>
                        </div>
                    </div>
                    <div className="alu-header-right">
                        <div className="price-input-group">
                            <label>Cijena/m²</label>
                            <div className="price-input-wrapper">
                                <input
                                    type="number"
                                    value={pricePerM2 || ''}
                                    onChange={(e) => setPricePerM2(parseFloat(e.target.value) || 0)}
                                    step="0.01"
                                    min="0"
                                />
                                <span>KM</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Door Tabs */}
                <div className="door-tabs">
                    <div className="door-tabs-list">
                        {items.map((item, index) => (
                            <button
                                key={index}
                                type="button"
                                className={`door-tab ${activeTab === index ? 'active' : ''}`}
                                onClick={() => setActiveTab(index)}
                            >
                                <span className="tab-number">{index + 1}</span>
                                <span className="tab-label">
                                    {item.Width > 0 && item.Height > 0
                                        ? `${item.Width}×${item.Height}`
                                        : 'Vrata'}
                                </span>
                            </button>
                        ))}
                        <button type="button" className="door-tab add-tab" onClick={addItem}>
                            <span className="material-icons-round">add</span>
                        </button>
                    </div>
                </div>

                {/* Active Door Form */}
                <div className="door-form">
                    {/* Delete Button */}
                    {items.length > 1 && (
                        <button
                            type="button"
                            className="door-delete-btn"
                            onClick={() => removeItem(activeTab)}
                        >
                            <span className="material-icons-round">delete</span>
                            Obriši ova vrata
                        </button>
                    )}

                    {/* Dimensions Section */}
                    <div className="form-section">
                        <div className="section-title">
                            <span className="section-icon">📐</span>
                            Dimenzije
                        </div>
                        <div className="section-grid cols-3">
                            <div className="form-field">
                                <label>Količina</label>
                                <input
                                    type="number"
                                    value={currentItem.Qty || ''}
                                    min="1"
                                    onChange={(e) => updateItem(activeTab, 'Qty', parseInt(e.target.value) || 1)}
                                />
                            </div>
                            <div className="form-field">
                                <label>Širina (mm)</label>
                                <input
                                    type="number"
                                    value={currentItem.Width || ''}
                                    min="0"
                                    placeholder="0"
                                    onChange={(e) => updateItem(activeTab, 'Width', parseFloat(e.target.value) || 0)}
                                />
                            </div>
                            <div className="form-field">
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
                    </div>

                    {/* Appearance Section */}
                    <div className="form-section">
                        <div className="section-title">
                            <span className="section-icon">🎨</span>
                            Izgled
                        </div>
                        <div className="section-grid cols-2">
                            <div className="form-field">
                                <label>Vrsta rama</label>
                                <select
                                    value={currentItem.Frame_Type}
                                    onChange={(e) => updateItem(activeTab, 'Frame_Type', e.target.value)}
                                >
                                    {FRAME_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Vrsta stakla</label>
                                <select
                                    value={currentItem.Glass_Type}
                                    onChange={(e) => updateItem(activeTab, 'Glass_Type', e.target.value)}
                                >
                                    {GLASS_TYPES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Boja rama</label>
                                <input
                                    type="text"
                                    value={currentItem.Frame_Color}
                                    placeholder="npr. Crna, Bijela..."
                                    onChange={(e) => updateItem(activeTab, 'Frame_Color', e.target.value)}
                                />
                            </div>
                            <div className="form-field checkbox-field">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={currentItem.Integrated_Handle}
                                        onChange={(e) => updateItem(activeTab, 'Integrated_Handle', e.target.checked)}
                                    />
                                    <span>Integrisana ručka</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Hinges Section */}
                    <div className="form-section">
                        <div className="section-title">
                            <span className="section-icon">🔩</span>
                            Baglame
                        </div>
                        <div className="section-grid cols-2">
                            <div className="form-field">
                                <label>Tip baglama</label>
                                <select
                                    value={currentItem.Hinge_Type}
                                    onChange={(e) => updateItem(activeTab, 'Hinge_Type', e.target.value)}
                                >
                                    {HINGE_TYPES.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Boja baglama</label>
                                <input
                                    type="text"
                                    value={currentItem.Hinge_Color}
                                    placeholder="npr. Crna, Inox..."
                                    onChange={(e) => updateItem(activeTab, 'Hinge_Color', e.target.value)}
                                />
                            </div>
                            <div className="form-field">
                                <label>Strana otvaranja</label>
                                <div className="radio-group">
                                    {HINGE_SIDES.map(s => (
                                        <label key={s.value} className="radio-label">
                                            <input
                                                type="radio"
                                                name={`hinge-side-${activeTab}`}
                                                value={s.value}
                                                checked={currentItem.Hinge_Side === s.value}
                                                onChange={(e) => updateItem(activeTab, 'Hinge_Side', e.target.value)}
                                            />
                                            <span>{s.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="form-field">
                                <label>Raspored baglama</label>
                                <div className="radio-group">
                                    <label className="radio-label">
                                        <input
                                            type="radio"
                                            name={`hinge-layout-${activeTab}`}
                                            value="osnovna"
                                            checked={currentItem.Hinge_Layout === 'osnovna'}
                                            onChange={(e) => updateItem(activeTab, 'Hinge_Layout', e.target.value)}
                                        />
                                        <span>Osnovna</span>
                                    </label>
                                    <label className="radio-label">
                                        <input
                                            type="radio"
                                            name={`hinge-layout-${activeTab}`}
                                            value="specijalna"
                                            checked={currentItem.Hinge_Layout === 'specijalna'}
                                            onChange={(e) => updateItem(activeTab, 'Hinge_Layout', e.target.value)}
                                        />
                                        <span>Specijalna</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Custom Hinge Positions */}
                        {currentItem.Hinge_Layout === 'specijalna' && (
                            <div className="hinge-positions">
                                <div className="hinge-positions-title">Pozicije baglama od dna (mm)</div>
                                <div className="hinge-positions-list">
                                    {currentItem.Hinge_Positions.map((pos, hingeIdx) => (
                                        <div key={hingeIdx} className="hinge-position-item">
                                            <span className="hinge-label">#{hingeIdx + 1}</span>
                                            <input
                                                type="number"
                                                value={pos || ''}
                                                min="0"
                                                placeholder="mm"
                                                onChange={(e) => updateHingePosition(activeTab, hingeIdx, parseFloat(e.target.value) || 0)}
                                            />
                                            <button
                                                type="button"
                                                className="hinge-remove"
                                                onClick={() => removeHingePosition(activeTab, hingeIdx)}
                                            >
                                                <span className="material-icons-round">close</span>
                                            </button>
                                        </div>
                                    ))}
                                    <button type="button" className="hinge-add" onClick={() => addHingePosition(activeTab)}>
                                        <span className="material-icons-round">add</span>
                                        Dodaj
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Note */}
                    <div className="form-section">
                        <div className="form-field">
                            <label>Napomena</label>
                            <input
                                type="text"
                                value={currentItem.Note}
                                placeholder="Dodatne napomene za ova vrata..."
                                onChange={(e) => updateItem(activeTab, 'Note', e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Item Summary */}
                    <div className="item-summary">
                        <div className="item-summary-stat">
                            <span>Površina:</span>
                            <strong>{calculateItemArea(currentItem).toFixed(4)} m²</strong>
                        </div>
                        <div className="item-summary-stat">
                            <span>Cijena:</span>
                            <strong>{calculateItemPrice(currentItem).toFixed(2)} KM</strong>
                        </div>
                    </div>
                </div>

                {/* Total Summary */}
                <div className="alu-summary">
                    <div className="summary-item">
                        <span className="summary-label">Vrata</span>
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
                .alu-modal {
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }

                /* Header */
                .alu-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
                    border-radius: 12px;
                    gap: 16px;
                    flex-wrap: wrap;
                }

                .alu-header-left {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                }

                .alu-icon {
                    font-size: 32px;
                    line-height: 1;
                }

                .alu-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .alu-subtitle {
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .alu-header-right {
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

                /* Door Tabs */
                .door-tabs {
                    background: var(--surface);
                    border-radius: 12px;
                    padding: 8px;
                }

                .door-tabs-list {
                    display: flex;
                    gap: 6px;
                    overflow-x: auto;
                    padding-bottom: 4px;
                }

                .door-tab {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 16px;
                    background: white;
                    border: 1px solid var(--border-light);
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.15s;
                    white-space: nowrap;
                }

                .door-tab:hover {
                    border-color: var(--accent);
                }

                .door-tab.active {
                    background: var(--accent);
                    border-color: var(--accent);
                    color: white;
                }

                .door-tab .tab-number {
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface);
                    border-radius: 50%;
                    font-size: 11px;
                    font-weight: 600;
                }

                .door-tab.active .tab-number {
                    background: rgba(255,255,255,0.3);
                    color: white;
                }

                .door-tab.add-tab {
                    background: transparent;
                    border-style: dashed;
                    color: var(--text-tertiary);
                }

                .door-tab.add-tab:hover {
                    color: var(--accent);
                    border-color: var(--accent);
                }

                .door-tab .material-icons-round {
                    font-size: 18px;
                }

                /* Door Form */
                .door-form {
                    background: white;
                    border: 1px solid var(--border-light);
                    border-radius: 12px;
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                }

                .door-delete-btn {
                    align-self: flex-end;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 12px;
                    background: var(--error-bg);
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--error);
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .door-delete-btn:hover {
                    background: var(--error);
                    color: white;
                }

                .door-delete-btn .material-icons-round {
                    font-size: 16px;
                }

                /* Form Sections */
                .form-section {
                    padding: 16px;
                    background: var(--surface);
                    border-radius: 10px;
                }

                .section-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: 14px;
                }

                .section-icon {
                    font-size: 16px;
                }

                .section-grid {
                    display: grid;
                    gap: 14px;
                }

                .section-grid.cols-2 {
                    grid-template-columns: repeat(2, 1fr);
                }

                .section-grid.cols-3 {
                    grid-template-columns: repeat(3, 1fr);
                }

                @media (max-width: 768px) {
                    .section-grid.cols-3 {
                        grid-template-columns: repeat(2, 1fr);
                    }
                }

                @media (max-width: 540px) {
                    .section-grid.cols-2,
                    .section-grid.cols-3 {
                        grid-template-columns: 1fr;
                    }
                    
                    .radio-group {
                        flex-direction: column;
                        gap: 10px;
                    }
                }

                .form-field {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .form-field > label {
                    font-size: 11px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                }

                .form-field input[type="text"],
                .form-field input[type="number"],
                .form-field select {
                    padding: 10px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    font-size: 14px;
                    background: white;
                    transition: border-color 0.2s, box-shadow 0.2s;
                }

                .form-field input:focus,
                .form-field select:focus {
                    outline: none;
                    border-color: var(--accent);
                    box-shadow: 0 0 0 3px var(--accent-light);
                }

                .checkbox-field label {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    cursor: pointer;
                    padding: 10px 0;
                    font-size: 13px;
                    color: var(--text-primary);
                    text-transform: none;
                    letter-spacing: 0;
                    font-weight: 400;
                }

                .checkbox-field input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    accent-color: var(--accent);
                }

                .radio-group {
                    display: flex;
                    gap: 16px;
                }

                .radio-label {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    color: var(--text-primary);
                    cursor: pointer;
                }

                .radio-label input[type="radio"] {
                    width: 16px;
                    height: 16px;
                    accent-color: var(--accent);
                }

                /* Hinge Positions */
                .hinge-positions {
                    margin-top: 14px;
                    padding-top: 14px;
                    border-top: 1px solid var(--border-light);
                }

                .hinge-positions-title {
                    font-size: 12px;
                    color: var(--text-secondary);
                    margin-bottom: 10px;
                }

                .hinge-positions-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    align-items: center;
                }

                .hinge-position-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 10px;
                    background: white;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                }

                .hinge-label {
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-secondary);
                }

                .hinge-position-item input {
                    width: 60px;
                    padding: 6px 8px;
                    border: 1px solid var(--border-light);
                    border-radius: 4px;
                    font-size: 13px;
                    text-align: center;
                }

                .hinge-remove {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 22px;
                    height: 22px;
                    background: transparent;
                    border: none;
                    border-radius: 4px;
                    color: var(--text-tertiary);
                    cursor: pointer;
                }

                .hinge-remove:hover {
                    background: var(--error-bg);
                    color: var(--error);
                }

                .hinge-remove .material-icons-round {
                    font-size: 16px;
                }

                .hinge-add {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 6px 12px;
                    background: transparent;
                    border: 1px dashed var(--border);
                    border-radius: 6px;
                    font-size: 12px;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .hinge-add:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                }

                .hinge-add .material-icons-round {
                    font-size: 14px;
                }

                /* Item Summary */
                .item-summary {
                    display: flex;
                    justify-content: flex-end;
                    gap: 24px;
                    padding: 14px 16px;
                    background: var(--surface);
                    border-radius: 8px;
                }

                .item-summary-stat {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                }

                .item-summary-stat span {
                    color: var(--text-secondary);
                }

                .item-summary-stat strong {
                    color: var(--accent);
                    font-weight: 600;
                }

                /* Total Summary */
                .alu-summary {
                    display: flex;
                    justify-content: flex-end;
                    gap: 32px;
                    padding: 16px 20px;
                    background: var(--surface);
                    border-radius: 12px;
                }

                @media (max-width: 480px) {
                    .alu-summary {
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
