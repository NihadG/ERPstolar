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

    function duplicateItem(index: number) {
        const clone = { ...items[index], Hinge_Positions: [...items[index].Hinge_Positions] };
        const updated = [...items];
        updated.splice(index + 1, 0, clone);
        setItems(updated);
        setActiveTab(index + 1);
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
            title={existingMaterial ? 'Uređivanje Alu Vrata' : 'Nova Alu Vrata'}
            size="fullscreen"
            footer={
                <div className="premium-footer">
                    <div className="premium-footer-stats">
                        <div className="stat-group">
                            <span className="stat-icon material-icons-round">door_front</span>
                            <div className="stat-content">
                                <span className="stat-value">{getTotalCount()}</span>
                                <span className="stat-label">vrata</span>
                            </div>
                        </div>
                        <div className="stat-divider" />
                        <div className="stat-group">
                            <span className="stat-icon material-icons-round">square_foot</span>
                            <div className="stat-content">
                                <span className="stat-value">{getTotalArea().toFixed(2)}</span>
                                <span className="stat-label">kvadrata</span>
                            </div>
                        </div>
                        <div className="stat-divider" />
                        <div className="stat-group total-group">
                            <div className="stat-content">
                                <span className="stat-value highlight">{getTotalPrice().toFixed(2)}</span>
                                <span className="stat-label highlight">KM Ukupno</span>
                            </div>
                        </div>
                    </div>
                    <div className="premium-footer-actions">
                        <button className="btn-modern-ghost" onClick={onClose} disabled={saving}>Odustani</button>
                        <button className="btn-modern-primary" onClick={handleSave} disabled={saving}>
                            <span className="material-icons-round">{saving ? 'hourglass_empty' : 'check_circle'}</span>
                            {saving ? 'Spremanje...' : 'Sačuvaj Promjene'}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="premium-layout">
                {/* ---------- SIDEBAR / DOORS LIST ---------- */}
                <div className="premium-sidebar">
                    <div className="premium-sidebar-header">
                        <div className="premium-item-brand">
                            <div className="premium-icon-box">
                                <span className="material-icons-round">door_front</span>
                            </div>
                            <div className="brand-info">
                                <h3 className="brand-title">{material?.Name || existingMaterial?.Material_Name || 'Alu Vrata'}</h3>
                                <div className="brand-subtitle">{material?.Default_Supplier || existingMaterial?.Supplier || 'Konfiguracija'}</div>
                            </div>
                        </div>

                        <div className="premium-price-input">
                            <label>Cijena po m²</label>
                            <div className="price-input-wrapper">
                                <input
                                    type="number"
                                    value={pricePerM2 || ''}
                                    onChange={(e) => setPricePerM2(parseFloat(e.target.value) || 0)}
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                />
                                <span className="currency-badge">KM</span>
                            </div>
                        </div>
                    </div>

                    <div className="premium-door-list">
                        {items.map((item, index) => {
                            const hasSize = item.Width > 0 && item.Height > 0;
                            const area = calculateItemArea(item);
                            const price = calculateItemPrice(item);
                            const isActive = activeTab === index;

                            return (
                                <div
                                    key={index}
                                    className={`premium-door-card ${isActive ? 'active' : ''}`}
                                    onClick={() => setActiveTab(index)}
                                >
                                    <div className="door-card-header">
                                        <div className="door-card-title">
                                            <div className="door-badge">{index + 1}</div>
                                            <span className="door-name">Vrata #{index + 1}</span>
                                        </div>
                                        <div className="door-card-actions">
                                            <button
                                                type="button"
                                                className="ghost-icon-btn copy"
                                                onClick={(e) => { e.stopPropagation(); duplicateItem(index); }}
                                                title="Dupliraj"
                                            >
                                                <span className="material-icons-round">content_copy</span>
                                            </button>
                                            {items.length > 1 && (
                                                <button
                                                    type="button"
                                                    className="ghost-icon-btn delete"
                                                    onClick={(e) => { e.stopPropagation(); removeItem(index); }}
                                                    title="Obriši"
                                                >
                                                    <span className="material-icons-round">delete_outline</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="door-card-body">
                                        {hasSize ? (
                                            <div className="door-card-details">
                                                <div className="door-dims-large">{item.Width} × {item.Height} <span className="unit">mm</span></div>
                                                <div className="door-stats-row">
                                                    <span className="door-qty">{item.Qty} kom</span>
                                                    <span className="dot">•</span>
                                                    <span className="door-area">{area.toFixed(3)} m²</span>
                                                    <span className="dot">•</span>
                                                    <span className="door-price">{price.toFixed(2)} KM</span>
                                                </div>
                                                <div className="door-tags-row">
                                                    <span className="tag-pill">{FRAME_TYPES.find(f => f.value === item.Frame_Type)?.label || item.Frame_Type}</span>
                                                    <span className="tag-pill tinted">{GLASS_TYPES.find(g => g.value === item.Glass_Type)?.label || item.Glass_Type}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="door-empty-state">
                                                <span className="material-icons-round">straighten</span>
                                                Dimenzije nisu unesene
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        <button type="button" className="premium-btn-add-door" onClick={addItem}>
                            <span className="material-icons-round">add</span>
                            <span>Dodaj nova vrata</span>
                        </button>
                    </div>
                </div>

                {/* ---------- MAIN EDIT AREA ---------- */}
                <div className="premium-main">
                    <div className="premium-main-header">
                        <h2>Konfiguracija Vrata #{activeTab + 1}</h2>
                        <div className="main-header-stats">
                            <div className="stat-pill">
                                <span className="material-icons-round">aspect_ratio</span>
                                {calculateItemArea(currentItem).toFixed(3)} m²
                            </div>
                            <div className="stat-pill primary">
                                <span className="material-icons-round">payments</span>
                                {calculateItemPrice(currentItem).toFixed(2)} KM
                            </div>
                        </div>
                    </div>

                    <div className="premium-scroll-area">
                        <div className="premium-form-container">

                            {/* SECTION: Dimenzije */}
                            <div className="premium-section-card">
                                <div className="card-header">
                                    <div className="card-icon-wrapper"><span className="material-icons-round">straighten</span></div>
                                    <h3 className="card-title">Dimenzije i Količina</h3>
                                </div>
                                <div className="card-body">
                                    <div className="input-grid triple">
                                        <div className="elegant-input-group">
                                            <label>Količina komada</label>
                                            <div className="elegant-input-wrapper">
                                                <input
                                                    type="number"
                                                    value={currentItem.Qty || ''}
                                                    min="1"
                                                    onChange={(e) => updateItem(activeTab, 'Qty', parseInt(e.target.value) || 1)}
                                                />
                                                <span className="input-suffix">kom</span>
                                            </div>
                                        </div>
                                        <div className="elegant-input-group highlight">
                                            <label>Širina vrata</label>
                                            <div className="elegant-input-wrapper">
                                                <input
                                                    type="number"
                                                    value={currentItem.Width || ''}
                                                    min="0"
                                                    placeholder="0"
                                                    onChange={(e) => updateItem(activeTab, 'Width', parseFloat(e.target.value) || 0)}
                                                />
                                                <span className="input-suffix">mm</span>
                                            </div>
                                        </div>
                                        <div className="elegant-input-group highlight">
                                            <label>Visina vrata</label>
                                            <div className="elegant-input-wrapper">
                                                <input
                                                    type="number"
                                                    value={currentItem.Height || ''}
                                                    min="0"
                                                    placeholder="0"
                                                    onChange={(e) => updateItem(activeTab, 'Height', parseFloat(e.target.value) || 0)}
                                                />
                                                <span className="input-suffix">mm</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* SECTION: Izgled & Materijali */}
                            <div className="premium-section-card">
                                <div className="card-header">
                                    <div className="card-icon-wrapper coral"><span className="material-icons-round">auto_awesome</span></div>
                                    <h3 className="card-title">Izgled i Materijali</h3>
                                </div>
                                <div className="card-body">
                                    <div className="input-grid double">
                                        <div className="elegant-input-group">
                                            <label>Vrsta profila</label>
                                            <div className="elegant-segmented">
                                                {FRAME_TYPES.map(f => (
                                                    <button
                                                        key={f.value}
                                                        type="button"
                                                        className={`seg-item ${currentItem.Frame_Type === f.value ? 'active' : ''}`}
                                                        onClick={() => updateItem(activeTab, 'Frame_Type', f.value)}
                                                    >
                                                        {f.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="elegant-input-group">
                                            <label>Vrsta stakla</label>
                                            <div className="elegant-select-wrapper">
                                                <select
                                                    value={currentItem.Glass_Type}
                                                    onChange={(e) => updateItem(activeTab, 'Glass_Type', e.target.value)}
                                                >
                                                    {GLASS_TYPES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                                                </select>
                                                <span className="material-icons-round select-chevron">expand_more</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="separator" />

                                    <div className="input-grid double">
                                        <div className="elegant-input-group">
                                            <label>Boja rama (RAL ili Ime)</label>
                                            <div className="elegant-input-wrapper">
                                                <span className="material-icons-round input-prefix">palette</span>
                                                <input
                                                    type="text"
                                                    value={currentItem.Frame_Color}
                                                    placeholder="Npr. Antracit, Crna, Bijela..."
                                                    onChange={(e) => updateItem(activeTab, 'Frame_Color', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="elegant-input-group" style={{ justifyContent: 'flex-end', paddingBottom: '4px' }}>
                                            <label className="elegant-toggle">
                                                <div className="toggle-text">
                                                    <span className="toggle-title">Integrisana ručka</span>
                                                    <span className="toggle-desc">Ugrađena u ram profila</span>
                                                </div>
                                                <div className={`modern-switch ${currentItem.Integrated_Handle ? 'on' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={currentItem.Integrated_Handle}
                                                        onChange={(e) => updateItem(activeTab, 'Integrated_Handle', e.target.checked)}
                                                    />
                                                    <div className="switch-track">
                                                        <div className="switch-thumb"></div>
                                                    </div>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* SECTION: Baglame */}
                            <div className="premium-section-card">
                                <div className="card-header">
                                    <div className="card-icon-wrapper teal"><span className="material-icons-round">hardware</span></div>
                                    <h3 className="card-title">Okov i Baglame</h3>
                                </div>
                                <div className="card-body">
                                    <div className="input-grid double">
                                        <div className="elegant-input-group">
                                            <label>Tip baglama</label>
                                            <div className="elegant-segmented three-way">
                                                {HINGE_TYPES.map(h => (
                                                    <button
                                                        key={h.value}
                                                        type="button"
                                                        className={`seg-item ${currentItem.Hinge_Type === h.value ? 'active' : ''}`}
                                                        onClick={() => updateItem(activeTab, 'Hinge_Type', h.value)}
                                                    >
                                                        {h.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="elegant-input-group">
                                            <label>Boja baglama</label>
                                            <div className="elegant-input-wrapper">
                                                <span className="material-icons-round input-prefix">format_paint</span>
                                                <input
                                                    type="text"
                                                    value={currentItem.Hinge_Color}
                                                    placeholder="Npr. Inox, Crna..."
                                                    onChange={(e) => updateItem(activeTab, 'Hinge_Color', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="separator" />

                                    <div className="input-grid double">
                                        <div className="elegant-input-group">
                                            <label>Smjer otvaranja (Strana)</label>
                                            <div className="elegant-segmented">
                                                <button
                                                    type="button"
                                                    className={`seg-item icon-text ${currentItem.Hinge_Side === 'lijevo' ? 'active' : ''}`}
                                                    onClick={() => updateItem(activeTab, 'Hinge_Side', 'lijevo')}
                                                >
                                                    <span className="material-icons-round">keyboard_double_arrow_left</span>
                                                    Lijevo otvaranje
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`seg-item icon-text ${currentItem.Hinge_Side === 'desno' ? 'active' : ''}`}
                                                    onClick={() => updateItem(activeTab, 'Hinge_Side', 'desno')}
                                                >
                                                    Desno otvaranje
                                                    <span className="material-icons-round">keyboard_double_arrow_right</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="elegant-input-group">
                                            <label>Raspored baglama</label>
                                            <div className="elegant-segmented">
                                                <button
                                                    type="button"
                                                    className={`seg-item ${currentItem.Hinge_Layout === 'osnovna' ? 'active' : ''}`}
                                                    onClick={() => updateItem(activeTab, 'Hinge_Layout', 'osnovna')}
                                                >
                                                    Osnovni preporučeni
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`seg-item ${currentItem.Hinge_Layout === 'specijalna' ? 'active' : ''}`}
                                                    onClick={() => updateItem(activeTab, 'Hinge_Layout', 'specijalna')}
                                                >
                                                    Specijalni (Custom)
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Custom pozicije (samo ako je specijalno) */}
                                    {currentItem.Hinge_Layout === 'specijalna' && (
                                        <div className="custom-hinges-panel">
                                            <div className="custom-hinges-header">
                                                <span className="material-icons-round">rule</span>
                                                <h4>Unesite tačne pozicije baglama mjereći od dna vrata prama gore</h4>
                                            </div>
                                            <div className="custom-hinges-grid">
                                                {currentItem.Hinge_Positions.map((pos, hingeIdx) => (
                                                    <div key={hingeIdx} className="hinge-measurement">
                                                        <span className="hinge-num">#{hingeIdx + 1}</span>
                                                        <div className="hinge-input-box">
                                                            <input
                                                                type="number"
                                                                value={pos || ''}
                                                                min="0"
                                                                placeholder="mm"
                                                                onChange={(e) => updateHingePosition(activeTab, hingeIdx, parseFloat(e.target.value) || 0)}
                                                            />
                                                            <span className="mm-lbl">mm</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="remove-hinge-btn"
                                                            onClick={() => removeHingePosition(activeTab, hingeIdx)}
                                                        >
                                                            <span className="material-icons-round">close</span>
                                                        </button>
                                                    </div>
                                                ))}
                                                <button type="button" className="add-hinge-btn" onClick={() => addHingePosition(activeTab)}>
                                                    <span className="material-icons-round">add_circle</span>
                                                    Dodaj poziciju
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* SECTION: Napomene */}
                            <div className="premium-section-card note-card">
                                <div className="card-header">
                                    <div className="card-icon-wrapper amber"><span className="material-icons-round">edit_note</span></div>
                                    <h3 className="card-title">Dodatne Napomene</h3>
                                </div>
                                <div className="card-body">
                                    <div className="elegant-input-group">
                                        <div className="elegant-textarea-wrapper">
                                            <textarea
                                                value={currentItem.Note}
                                                placeholder="Unesite specifične napomene ili zahtjeve vezane samo za ova vrata..."
                                                onChange={(e) => updateItem(activeTab, 'Note', e.target.value)}
                                                rows={3}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Dno razmak */}
                            <div style={{ height: '40px' }} />
                        </div>
                    </div>
                </div>
            </div>

            <style jsx global>{`
                /* ==============================================================
                   ALU DOOR MODAL — PREMIUM NEXT-GEN UI (TAILWIND/STRIPE INSPIRED)
                   ============================================================== */
                
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

                .premium-layout {
                    display: flex;
                    height: 100%;
                    min-height: 0;
                    background: #f8fafc; /* Glavna pozadina cijelog appa */
                    font-family: 'Inter', sans-serif;
                }

                /* ---------- SIDEBAR ---------- */
                .premium-sidebar {
                    width: 280px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    background: #ffffff;
                    border-right: 1px solid #e2e8f0;
                    box-shadow: 2px 0 10px rgba(0,0,0,0.02);
                    z-index: 10;
                }

                .premium-sidebar-header {
                    padding: 14px 14px 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    border-bottom: 1px solid #f1f5f9;
                }

                .premium-item-brand {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                }

                .premium-icon-box {
                    width: 34px;
                    height: 34px;
                    background: linear-gradient(135deg, #6366f1, #4f46e5);
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    box-shadow: 0 4px 10px rgba(79, 70, 229, 0.2);
                }

                .premium-icon-box .material-icons-round {
                    font-size: 18px;
                }

                .brand-info {
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                }

                .brand-title {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 700;
                    color: #0f172a;
                    letter-spacing: -0.01em;
                }

                .brand-subtitle {
                    font-size: 11px;
                    color: #64748b;
                    font-weight: 500;
                }

                .premium-price-input {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 6px 10px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    transition: all 0.2s;
                }

                .premium-price-input:focus-within {
                    background: #ffffff;
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
                }

                .premium-price-input label {
                    font-size: 11px;
                    font-weight: 600;
                    color: #475569;
                    margin: 0;
                }

                .price-input-wrapper {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .price-input-wrapper input {
                    width: 70px;
                    text-align: right;
                    border: none;
                    background: transparent;
                    font-size: 14px;
                    font-weight: 800;
                    color: #0f172a;
                    outline: none;
                    font-family: inherit;
                }

                .currency-badge {
                    font-size: 12px;
                    font-weight: 700;
                    background: #e2e8f0;
                    color: #475569;
                    padding: 3px 6px;
                    border-radius: 6px;
                }

                .premium-door-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                /* Vrata Kartica (Meni lijevo) */
                .premium-door-card {
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    padding: 10px 12px;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                    position: relative;
                    overflow: hidden;
                }

                .premium-door-card:hover {
                    border-color: #cbd5e1;
                    background: #fbfbfc;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.03);
                }

                .premium-door-card.active {
                    border-color: #6366f1;
                    background: #eff6ff;
                    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.12);
                    transform: translateY(-2px);
                }

                /* Aktivna linija na rubu */
                .premium-door-card::before {
                    content: '';
                    position: absolute;
                    left: 0;
                    top: 0;
                    bottom: 0;
                    width: 4px;
                    background: #6366f1;
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                .premium-door-card.active::before { opacity: 1; }

                .door-card-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 6px;
                }

                .door-card-title {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .door-badge {
                    width: 20px;
                    height: 20px;
                    background: #f1f5f9;
                    color: #64748b;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: 800;
                    transition: all 0.2s;
                }
                .premium-door-card.active .door-badge {
                    background: #6366f1;
                    color: white;
                }

                .door-name {
                    font-size: 12px;
                    font-weight: 700;
                    color: #1e293b;
                }
                .premium-door-card.active .door-name { color: #4f46e5; }

                .door-card-actions {
                    display: flex;
                    gap: 4px;
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                .premium-door-card:hover .door-card-actions,
                .premium-door-card.active .door-card-actions { opacity: 1; }

                .ghost-icon-btn {
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    background: transparent;
                    border-radius: 6px;
                    cursor: pointer;
                    color: #94a3b8;
                    transition: all 0.15s;
                }
                .ghost-icon-btn:hover { background: #e2e8f0; color: #0f172a; }
                .ghost-icon-btn.delete:hover { background: #fee2e2; color: #ef4444; }
                .ghost-icon-btn .material-icons-round { font-size: 16px; }

                .door-card-details {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .door-dims-large {
                    font-size: 14px;
                    font-weight: 800;
                    color: #0f172a;
                    letter-spacing: -0.02em;
                }
                .door-dims-large .unit {
                    font-size: 11px;
                    font-weight: 600;
                    color: #64748b;
                }

                .door-stats-row {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    color: #475569;
                }
                .door-stats-row .dot { color: #cbd5e1; font-size: 10px; }
                .door-price { color: #10b981; font-weight: 700; } /* Zeleni naglasak za lovu */

                .door-tags-row {
                    display: flex;
                    gap: 6px;
                    margin-top: 6px;
                }

                .tag-pill {
                    padding: 2px 6px;
                    background: #f1f5f9;
                    color: #475569;
                    font-size: 10px;
                    font-weight: 600;
                    border-radius: 4px;
                }
                .tag-pill.tinted { background: #e0f2fe; color: #0284c7; }

                .door-empty-state {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: #94a3b8;
                    font-size: 13px;
                    font-weight: 500;
                    padding: 8px 0;
                }
                .door-empty-state .material-icons-round { font-size: 18px; }

                /* Dugme + Novo */
                .premium-btn-add-door {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    padding: 10px;
                    border: 2px dashed #cbd5e1;
                    border-radius: 10px;
                    background: transparent;
                    color: #64748b;
                    font-family: inherit;
                    font-size: 12px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-top: 2px;
                }
                .premium-btn-add-door:hover {
                    border-color: #6366f1;
                    color: #6366f1;
                    background: #eef2ff;
                }

                /* ---------- MAIN PANEL ---------- */
                .premium-main {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }

                .premium-main-header {
                    padding: 14px 28px;
                    background: #ffffff;
                    border-bottom: 1px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    z-index: 5;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.01);
                }

                .premium-main-header h2 {
                    margin: 0;
                    font-size: 17px;
                    font-weight: 700;
                    color: #0f172a;
                    letter-spacing: -0.02em;
                }

                .main-header-stats {
                    display: flex;
                    gap: 12px;
                }

                .stat-pill {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    padding: 4px 10px;
                    background: #f1f5f9;
                    color: #475569;
                    border-radius: 999px;
                    font-size: 12px;
                    font-weight: 700;
                }
                .stat-pill .material-icons-round { font-size: 14px; color: #94a3b8; }
                
                .stat-pill.primary {
                    background: #eef2ff;
                    color: #4f46e5;
                }
                .stat-pill.primary .material-icons-round { color: #818cf8; }

                /* Scrollable area */
                .premium-scroll-area {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px 28px;
                    position: relative;
                }

                .premium-form-container {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    max-width: 780px;
                    margin: 0 auto;
                }

                /* Sekcija kartica */
                .premium-section-card {
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    border-radius: 16px;
                    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.02);
                    overflow: hidden;
                    transition: box-shadow 0.3s;
                }
                .premium-section-card:hover {
                    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.03), 0 4px 6px -2px rgba(0,0,0,0.02);
                }

                .card-header {
                    padding: 12px 16px;
                    border-bottom: 1px solid #f1f5f9;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: #fbfbfc;
                }

                .card-icon-wrapper {
                    width: 28px;
                    height: 28px;
                    background: #eef2ff;
                    color: #6366f1;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .card-icon-wrapper .material-icons-round { font-size: 15px; }
                .card-icon-wrapper.coral { background: #ffe4e6; color: #e11d48; }
                .card-icon-wrapper.teal { background: #e6fffa; color: #0d9488; }
                .card-icon-wrapper.amber { background: #fef3c7; color: #d97706; }
                
                .card-header h3.card-title {
                    margin: 0;
                    font-size: 13px;
                    font-weight: 700;
                    color: #1e293b;
                }

                .card-body {
                    padding: 14px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                }

                .separator {
                    height: 1px;
                    background: #f1f5f9;
                    margin: 4px 0;
                }

                /* Grid system */
                .input-grid { display: grid; gap: 12px; }
                .input-grid.double { grid-template-columns: 1fr 1fr; }
                .input-grid.triple { grid-template-columns: 1fr 1fr 1fr; }

                /* Elegant Input Group */
                .elegant-input-group {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }

                .elegant-input-group label {
                    font-size: 11px;
                    font-weight: 600;
                    color: #475569;
                }

                /* Elegant Input Wrapper */
                .elegant-input-wrapper {
                    display: flex;
                    align-items: center;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    position: relative;
                    transition: all 0.2s;
                    box-sizing: border-box;
                    padding: 0 10px;
                }
                .elegant-input-wrapper:focus-within {
                    background: #ffffff;
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
                }

                .elegant-input-wrapper input {
                    flex: 1;
                    padding: 9px 0;
                    border: none;
                    background: transparent;
                    font-size: 13px;
                    font-weight: 600;
                    color: #0f172a;
                    outline: none;
                    width: 100%;
                    font-family: inherit;
                }

                .elegant-input-wrapper .input-prefix {
                    font-size: 16px;
                    color: #94a3b8;
                    margin-right: 8px;
                }

                .elegant-input-wrapper .input-suffix {
                    font-size: 11px;
                    font-weight: 600;
                    color: #64748b;
                }

                /* Highlighting input specifically for Dimensions */
                .elegant-input-group.highlight .elegant-input-wrapper input {
                    font-size: 15px;
                    font-weight: 800;
                    color: #4f46e5;
                }

                /* Elegant Select */
                .elegant-select-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    transition: all 0.2s;
                }
                .elegant-select-wrapper:focus-within {
                    background: #ffffff;
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
                }
                .elegant-select-wrapper select {
                    appearance: none;
                    flex: 1;
                    padding: 9px 12px;
                    background: transparent;
                    border: none;
                    font-size: 13px;
                    font-weight: 600;
                    color: #0f172a;
                    outline: none;
                    cursor: pointer;
                    z-index: 2;
                    padding-right: 36px;
                    font-family: inherit;
                }
                .select-chevron {
                    position: absolute;
                    right: 14px;
                    color: #94a3b8;
                    pointer-events: none;
                    z-index: 1;
                }

                /* Elegant Textarea */
                .elegant-textarea-wrapper {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 10px;
                    transition: all 0.2s;
                }
                .elegant-textarea-wrapper:focus-within {
                    background: #ffffff;
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
                }
                .elegant-textarea-wrapper textarea {
                    width: 100%;
                    border: none;
                    background: transparent;
                    font-size: 13px;
                    color: #0f172a;
                    resize: vertical;
                    outline: none;
                    font-family: inherit;
                }

                /* Premium Segmented Controls */
                .elegant-segmented {
                    display: flex;
                    background: #f1f5f9;
                    padding: 4px;
                    border-radius: 10px;
                    gap: 4px;
                }
                .elegant-segmented.three-way { display: flex; }
                
                .seg-item {
                    flex: 1;
                    padding: 7px 10px;
                    background: transparent;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #64748b;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                    text-align: center;
                }
                .seg-item.icon-text {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                }
                .seg-item.icon-text .material-icons-round { font-size: 18px; }

                .seg-item:hover:not(.active) {
                    color: #1e293b;
                    background: rgba(255,255,255,0.4);
                }
                .seg-item.active {
                    background: #ffffff;
                    color: #0f172a;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
                }

                /* Modern Toggle Switch with Text */
                .elegant-toggle {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    padding: 7px 12px;
                    border-radius: 10px;
                    cursor: pointer;
                    transition: all 0.2s;
                    user-select: none;
                }
                .elegant-toggle:hover {
                    background: #ffffff;
                    border-color: #cbd5e1;
                }
                .toggle-text {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .toggle-title {
                    font-size: 12px;
                    font-weight: 700;
                    color: #0f172a;
                }
                .toggle-desc {
                    font-size: 10px;
                    font-weight: 500;
                    color: #64748b;
                }

                .modern-switch {
                    position: relative;
                }
                .modern-switch input { display: none; }
                .switch-track {
                    width: 44px;
                    height: 24px;
                    background: #cbd5e1;
                    border-radius: 999px;
                    transition: background 0.3s;
                    position: relative;
                }
                .modern-switch.on .switch-track { background: #6366f1; }
                .switch-thumb {
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 20px;
                    height: 20px;
                    background: #ffffff;
                    border-radius: 50%;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .modern-switch.on .switch-thumb { transform: translateX(20px); }

                /* Custom Hinges Panel */
                .custom-hinges-panel {
                    margin-top: 10px;
                    background: #f8fafc;
                    border: 1px dashed #cbd5e1;
                    border-radius: 12px;
                    padding: 20px;
                }
                .custom-hinges-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 16px;
                }
                .custom-hinges-header .material-icons-round { font-size: 18px; color: #6366f1; }
                .custom-hinges-header h4 {
                    margin: 0;
                    font-size: 13px;
                    font-weight: 600;
                    color: #475569;
                }
                
                .custom-hinges-grid {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                }

                .hinge-measurement {
                    display: flex;
                    align-items: center;
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding-left: 12px;
                    height: 40px;
                }
                .hinge-measurement:focus-within {
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
                }
                .hinge-num { font-size: 12px; font-weight: 700; color: #94a3b8; margin-right: 8px; }
                .hinge-input-box {
                    display: flex;
                    align-items: center;
                }
                .hinge-input-box input {
                    width: 60px;
                    padding: 8px 0;
                    border: none;
                    background: transparent;
                    font-size: 15px;
                    font-weight: 700;
                    color: #0f172a;
                    outline: none;
                    text-align: right;
                }
                .hinge-input-box .mm-lbl { font-size: 12px; font-weight: 600; color: #64748b; padding-left: 6px; padding-right: 12px; }
                
                .remove-hinge-btn {
                    height: 100%;
                    padding: 0 10px;
                    border: none;
                    border-left: 1px solid #f1f5f9;
                    background: transparent;
                    color: #94a3b8;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 0 8px 8px 0;
                }
                .remove-hinge-btn:hover { background: #fee2e2; color: #ef4444; }

                .add-hinge-btn {
                    height: 40px;
                    padding: 0 16px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: transparent;
                    border: 1px dashed #cbd5e1;
                    border-radius: 8px;
                    color: #475569;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .add-hinge-btn:hover { background: #eef2ff; border-color: #6366f1; color: #4f46e5; }
                .add-hinge-btn .material-icons-round { font-size: 18px; color: #6366f1; }

                /* ---------- FOOTER ---------- */
                .premium-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 24px;
                    background: #ffffff;
                    border-top: 1px solid #e2e8f0;
                    box-shadow: 0 -4px 20px rgba(0,0,0,0.02);
                }

                .premium-footer-stats {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .stat-group {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .stat-icon {
                    width: 28px;
                    height: 28px;
                    background: #f1f5f9;
                    color: #64748b;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                }

                .stat-content {
                    display: flex;
                    flex-direction: column;
                }
                .stat-value { font-size: 15px; font-weight: 800; color: #0f172a; line-height: 1.1; }
                .stat-label { font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; }

                .stat-divider { width: 1px; height: 28px; background: #e2e8f0; }

                .total-group .stat-value { font-size: 18px; color: #4f46e5; }
                .total-group .stat-label { color: #6366f1; }

                .premium-footer-actions {
                    display: flex;
                    gap: 12px;
                }

                .btn-modern-ghost {
                    padding: 9px 18px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    color: #475569;
                    font-size: 13px;
                    font-weight: 600;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .btn-modern-ghost:hover { background: #f1f5f9; color: #0f172a; }

                .btn-modern-primary {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 9px 22px;
                    background: linear-gradient(135deg, #4f46e5, #4338ca);
                    color: white;
                    border: none;
                    font-size: 13px;
                    font-weight: 600;
                    border-radius: 8px;
                    cursor: pointer;
                    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
                    transition: all 0.2s;
                }
                .btn-modern-primary:hover {
                    box-shadow: 0 6px 16px rgba(79, 70, 229, 0.4);
                    transform: translateY(-1px);
                }
                .btn-modern-primary:active { transform: translateY(0); }
                .btn-modern-primary .material-icons-round { font-size: 17px; }

                /* RESPONSIVE */
                @media (max-width: 1024px) {
                    .premium-sidebar { width: 240px; }
                    .input-grid.triple { grid-template-columns: 1fr; }
                    .input-grid.double { grid-template-columns: 1fr; }
                }

                @media (max-width: 768px) {
                    .premium-layout { flex-direction: column; }
                    .premium-sidebar {
                        width: 100%;
                        max-height: 280px;
                        border-right: none;
                        border-bottom: 1px solid #e2e8f0;
                        box-shadow: 0 4px 10px rgba(0,0,0,0.02);
                    }
                    .premium-door-list {
                        flex-direction: row;
                        overflow-x: auto;
                        padding: 12px;
                        gap: 12px;
                    }
                    .premium-door-card { min-width: 220px; flex-shrink: 0; }
                    
                    .premium-main-header { padding: 16px; flex-direction: column; align-items: flex-start; gap: 12px; }
                    .premium-scroll-area { padding: 16px; }
                    .premium-form-container { gap: 16px; }
                    
                    .premium-footer { flex-direction: column; padding: 16px; gap: 20px; }
                    .premium-footer-stats { flex-wrap: wrap; justify-content: center; gap: 16px; }
                    .stat-divider { display: none; }
                    .premium-footer-actions { width: 100%; }
                    .btn-modern-ghost, .btn-modern-primary { flex: 1; justify-content: center; }
                }
            `}</style>
        </Modal>
    );
}
