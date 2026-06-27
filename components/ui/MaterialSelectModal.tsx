'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Material, MaterialTemplate } from '@/lib/types';
import { MATERIAL_CATEGORIES } from '@/lib/types';
import { saveMaterial, getMaterialTemplates, saveMaterialTemplate, deleteMaterialTemplate } from '@/lib/services';
import './MaterialSelectModal.css';

// ============================================
// TYPES
// ============================================

export interface SelectedMaterial {
    materialId: string;
    materialName: string;
    unit: string;
    quantity: number;
    price: number;
    supplier: string;
}

interface MaterialSelectModalProps {
    isOpen: boolean;
    onClose: () => void;
    materials: Material[];
    onAddMaterials: (items: SelectedMaterial[]) => Promise<void>;
    onGlassRedirect?: (productId: string, materialId: string) => void;
    onAluDoorRedirect?: (productId: string, materialId: string) => void;
    productId: string;
    organizationId: string;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

// ============================================
// COMPONENT
// ============================================

export default function MaterialSelectModal({
    isOpen,
    onClose,
    materials,
    onAddMaterials,
    onGlassRedirect,
    onAluDoorRedirect,
    productId,
    organizationId,
    onRefresh,
    showToast,
}: MaterialSelectModalProps) {
    // ---- State ----
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [selected, setSelected] = useState<Map<string, SelectedMaterial>>(new Map());
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [saving, setSaving] = useState(false);

    // Create form state
    const [newName, setNewName] = useState('');
    const [newCategory, setNewCategory] = useState('Ploče i trake');
    const [newUnit, setNewUnit] = useState('kom');
    const [newPrice, setNewPrice] = useState(0);
    const [newSupplier, setNewSupplier] = useState('');
    const [creatingMaterial, setCreatingMaterial] = useState(false);

    // Templates state
    const [templates, setTemplates] = useState<MaterialTemplate[]>([]);
    const [loadTemplateId, setLoadTemplateId] = useState('');
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [savingTemplate, setSavingTemplate] = useState(false);

    const searchInputRef = useRef<HTMLInputElement>(null);

    const refreshTemplates = async () => {
        if (!organizationId) return;
        try {
            setTemplates(await getMaterialTemplates(organizationId));
        } catch (err) {
            console.error('getMaterialTemplates error:', err);
        }
    };

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setSelected(new Map());
            setSearchQuery('');
            setCategoryFilter('');
            setShowCreateForm(false);
            setSaving(false);
            setLoadTemplateId('');
            setShowSaveTemplate(false);
            setTemplateName('');
            refreshTemplates();
            // Focus search on open
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEsc);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    // ---- Filtering ----
    const filteredMaterials = useMemo(() => {
        let list = materials;

        // Category filter
        if (categoryFilter) {
            list = list.filter(m => m.Category === categoryFilter);
        }

        // Search filter
        if (searchQuery.trim()) {
            const terms = searchQuery.toLowerCase().split(' ').filter(Boolean);
            list = list.filter(m => {
                const text = `${m.Name} ${m.Category} ${m.Default_Supplier || ''}`.toLowerCase();
                return terms.every(t => text.includes(t));
            });
        }

        return list;
    }, [materials, categoryFilter, searchQuery]);

    // Category counts
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        // Apply search filter first, then count per category
        let searchFiltered = materials;
        if (searchQuery.trim()) {
            const terms = searchQuery.toLowerCase().split(' ').filter(Boolean);
            searchFiltered = materials.filter(m => {
                const text = `${m.Name} ${m.Category} ${m.Default_Supplier || ''}`.toLowerCase();
                return terms.every(t => text.includes(t));
            });
        }
        for (const m of searchFiltered) {
            counts[m.Category] = (counts[m.Category] || 0) + 1;
        }
        return counts;
    }, [materials, searchQuery]);

    // ---- Handlers ----
    function isGlass(mat: Material): boolean {
        return mat.Is_Glass === true || mat.Category === 'Staklo';
    }

    function isAluDoor(mat: Material): boolean {
        return mat.Is_Alu_Door === true || mat.Category === 'Alu vrata';
    }

    async function toggleMaterial(mat: Material) {
        // Glass/Alu redirect — first save any pending selected materials, then redirect
        if (isGlass(mat) && onGlassRedirect) {
            // Save any already-selected regular materials first
            if (selected.size > 0) {
                setSaving(true);
                try {
                    await onAddMaterials(Array.from(selected.values()));
                } catch {
                    // Continue to glass even if batch save fails
                }
                setSaving(false);
            }
            onClose();
            onGlassRedirect(productId, mat.Material_ID);
            return;
        }
        if (isAluDoor(mat) && onAluDoorRedirect) {
            // Save any already-selected regular materials first
            if (selected.size > 0) {
                setSaving(true);
                try {
                    await onAddMaterials(Array.from(selected.values()));
                } catch {
                    // Continue to alu even if batch save fails
                }
                setSaving(false);
            }
            onClose();
            onAluDoorRedirect(productId, mat.Material_ID);
            return;
        }

        const next = new Map(selected);
        if (next.has(mat.Material_ID)) {
            next.delete(mat.Material_ID);
        } else {
            next.set(mat.Material_ID, {
                materialId: mat.Material_ID,
                materialName: mat.Name,
                unit: mat.Unit,
                quantity: 1,
                price: mat.Default_Unit_Price,
                supplier: mat.Default_Supplier || '',
            });
        }
        setSelected(next);
    }

    function updateSelectedField(materialId: string, field: 'quantity' | 'price', value: number) {
        const next = new Map(selected);
        const item = next.get(materialId);
        if (item) {
            next.set(materialId, { ...item, [field]: value });
            setSelected(next);
        }
    }

    function removeSelected(materialId: string) {
        const next = new Map(selected);
        next.delete(materialId);
        setSelected(next);
    }

    // ---- Templates ----
    function handleLoadTemplate() {
        const template = templates.find(t => t.Template_ID === loadTemplateId);
        if (!template) return;

        const next = new Map(selected);
        let added = 0;
        let missing = 0;

        for (const item of template.Items || []) {
            // Resolve to a catalog material (by ID first, then by name)
            const mat = (item.Material_ID && materials.find(m => m.Material_ID === item.Material_ID))
                || materials.find(m => m.Name.toLowerCase() === (item.Name || '').toLowerCase());

            if (!mat) {
                missing++;
                continue;
            }
            // Glass / Alu doors need their own flow — skip from bulk template load
            if (isGlass(mat) || isAluDoor(mat)) {
                missing++;
                continue;
            }

            next.set(mat.Material_ID, {
                materialId: mat.Material_ID,
                materialName: mat.Name,
                unit: mat.Unit,
                quantity: item.Quantity && item.Quantity > 0 ? item.Quantity : 1,
                price: item.Default_Unit_Price ?? mat.Default_Unit_Price ?? 0,
                supplier: item.Default_Supplier || mat.Default_Supplier || '',
            });
            added++;
        }

        setSelected(next);
        setLoadTemplateId('');

        if (added > 0) {
            showToast(
                missing > 0
                    ? `Učitano ${added} materijala (${missing} nije pronađeno u katalogu)`
                    : `Učitano ${added} materijala iz templejta`,
                'success'
            );
        } else {
            showToast('Nijedan materijal iz templejta nije pronađen u katalogu', 'error');
        }
    }

    async function handleSaveTemplate() {
        const name = templateName.trim();
        if (!name) {
            showToast('Unesite naziv templejta', 'error');
            return;
        }
        if (selected.size === 0) return;

        const items = Array.from(selected.values()).map(s => {
            const mat = materials.find(m => m.Material_ID === s.materialId);
            return {
                Material_ID: s.materialId,
                Name: s.materialName,
                Category: mat?.Category || 'Ostalo',
                Unit: s.unit,
                Default_Unit_Price: s.price,
                Default_Supplier: s.supplier,
                Quantity: s.quantity,
            };
        });

        setSavingTemplate(true);
        const res = await saveMaterialTemplate({ Name: name, Items: items }, organizationId);
        setSavingTemplate(false);

        if (res.success) {
            showToast(`Templejt "${name}" sačuvan`, 'success');
            setShowSaveTemplate(false);
            setTemplateName('');
            refreshTemplates();
        } else {
            showToast(res.message, 'error');
        }
    }

    async function handleDeleteTemplate(templateId: string) {
        const template = templates.find(t => t.Template_ID === templateId);
        if (!template) return;
        if (!confirm(`Obrisati templejt "${template.Name}"?`)) return;

        const res = await deleteMaterialTemplate(templateId, organizationId);
        if (res.success) {
            showToast('Templejt obrisan', 'success');
            if (loadTemplateId === templateId) setLoadTemplateId('');
            refreshTemplates();
        } else {
            showToast(res.message, 'error');
        }
    }

    // Calculate grand total
    const grandTotal = useMemo(() => {
        let total = 0;
        Array.from(selected.values()).forEach(item => {
            total += item.quantity * item.price;
        });
        return total;
    }, [selected]);

    // ---- Submit ----
    async function handleSubmit() {
        if (selected.size === 0) return;
        setSaving(true);
        try {
            await onAddMaterials(Array.from(selected.values()));
            onClose();
        } catch {
            showToast('Greška pri dodavanju materijala', 'error');
        } finally {
            setSaving(false);
        }
    }

    // ---- Create new material ----
    async function handleCreateMaterial() {
        if (!newName.trim()) {
            showToast('Unesite naziv materijala', 'error');
            return;
        }
        setCreatingMaterial(true);
        try {
            const result = await saveMaterial({
                Name: newName.trim(),
                Category: newCategory,
                Unit: newUnit,
                Default_Unit_Price: newPrice,
                Default_Supplier: newSupplier,
                Description: '',
            }, organizationId);

            if (result.success && result.data) {
                showToast('Materijal kreiran', 'success');
                // Add to selection
                const next = new Map(selected);
                next.set(result.data.Material_ID, {
                    materialId: result.data.Material_ID,
                    materialName: newName.trim(),
                    unit: newUnit,
                    quantity: 1,
                    price: newPrice,
                    supplier: newSupplier,
                });
                setSelected(next);

                // Reset form
                setNewName('');
                setNewPrice(0);
                setNewSupplier('');
                setShowCreateForm(false);

                // Refresh materials catalog
                onRefresh('materials');
            } else {
                showToast(result.message, 'error');
            }
        } catch {
            showToast('Greška pri kreiranju materijala', 'error');
        } finally {
            setCreatingMaterial(false);
        }
    }

    // ---- Render ----
    if (!isOpen || typeof window === 'undefined') return null;

    const selectedArray = Array.from(selected.values());

    return createPortal(
        <>
            <div className="msm-overlay" onClick={onClose} />
            <div className="msm-modal">
                {/* Header */}
                <div className="msm-header">
                    <div className="msm-header-left">
                        <div className="msm-header-icon">
                            <span className="material-icons-round">inventory_2</span>
                        </div>
                        <div>
                            <div className="msm-title">Dodaj Materijale</div>
                            <div className="msm-subtitle">Odaberite materijale iz kataloga</div>
                        </div>
                    </div>
                    <button className="msm-close-btn" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                {/* Body — two panels */}
                <div className="msm-body">
                    {/* LEFT: Catalog */}
                    <div className="msm-catalog">
                        {/* Search */}
                        <div className="msm-search">
                            <div className="msm-search-input-wrapper">
                                <span className="material-icons-round">search</span>
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    className="msm-search-input"
                                    placeholder="Pretraži materijale..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                                {searchQuery && (
                                    <button
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                                        onClick={() => setSearchQuery('')}
                                    >
                                        <span className="material-icons-round" style={{ fontSize: 16, color: '#aeaeb2' }}>close</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Templates loader */}
                        {templates.length > 0 && (
                            <div className="msm-tpl-bar">
                                <span className="material-icons-round msm-tpl-icon">bookmarks</span>
                                <select
                                    className="msm-tpl-select"
                                    value={loadTemplateId}
                                    onChange={e => setLoadTemplateId(e.target.value)}
                                >
                                    <option value="">Učitaj iz templejta…</option>
                                    {templates.map(t => (
                                        <option key={t.Template_ID} value={t.Template_ID}>
                                            {t.Name} ({t.Items?.length || 0})
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className="msm-tpl-btn primary"
                                    onClick={handleLoadTemplate}
                                    disabled={!loadTemplateId}
                                >
                                    <span className="material-icons-round">download</span>
                                    Učitaj
                                </button>
                                {loadTemplateId && (
                                    <button
                                        className="msm-tpl-btn danger"
                                        title="Obriši ovaj templejt"
                                        onClick={() => handleDeleteTemplate(loadTemplateId)}
                                    >
                                        <span className="material-icons-round">delete</span>
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Category Tabs */}
                        <div className="msm-categories">
                            <button
                                className={`msm-cat-tab ${!categoryFilter ? 'active' : ''}`}
                                onClick={() => setCategoryFilter('')}
                            >
                                Sve
                                <span className="msm-cat-count">{materials.length}</span>
                            </button>
                            {MATERIAL_CATEGORIES.map(cat => {
                                const count = categoryCounts[cat] || 0;
                                if (count === 0 && searchQuery) return null;
                                return (
                                    <button
                                        key={cat}
                                        className={`msm-cat-tab ${categoryFilter === cat ? 'active' : ''}`}
                                        onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
                                    >
                                        {cat}
                                        <span className="msm-cat-count">{count || materials.filter(m => m.Category === cat).length}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Material List */}
                        <div className="msm-material-list">
                            {filteredMaterials.length === 0 ? (
                                <div className="msm-empty">
                                    <span className="material-icons-round">search_off</span>
                                    <p>Nema rezultata za &quot;{searchQuery}&quot;</p>
                                </div>
                            ) : (
                                filteredMaterials.map(mat => {
                                    const isSelected = selected.has(mat.Material_ID);
                                    const glass = isGlass(mat);
                                    const alu = isAluDoor(mat);

                                    return (
                                        <div
                                            key={mat.Material_ID}
                                            className={`msm-material-item ${isSelected ? 'selected' : ''} ${glass ? 'glass-type' : ''} ${alu ? 'alu-type' : ''}`}
                                            onClick={() => toggleMaterial(mat)}
                                        >
                                            {/* Checkbox (not for glass/alu) */}
                                            {!glass && !alu ? (
                                                <div className={`msm-checkbox ${isSelected ? 'checked' : ''}`}>
                                                    <span className="material-icons-round">check</span>
                                                </div>
                                            ) : (
                                                <div style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <span className="material-icons-round" style={{ fontSize: 18, color: glass ? '#3b82f6' : '#8b5cf6' }}>
                                                        {glass ? 'window' : 'door_front'}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="msm-mat-info">
                                                <div className="msm-mat-name">{mat.Name}</div>
                                                <div className="msm-mat-meta">
                                                    {mat.Category} • {mat.Unit}
                                                    {mat.Default_Supplier ? ` • ${mat.Default_Supplier}` : ''}
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {glass && <span className="msm-mat-type-badge glass">Staklo</span>}
                                                {alu && <span className="msm-mat-type-badge alu">Alu vrata</span>}
                                                <span className="msm-mat-price">
                                                    {(mat.Default_Unit_Price || 0).toFixed(2)} KM
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Create New Material */}
                        {!showCreateForm ? (
                            <div
                                className="msm-create-trigger"
                                onClick={() => {
                                    setShowCreateForm(true);
                                    // Pre-fill name from search if not found
                                    if (searchQuery && filteredMaterials.length === 0) {
                                        setNewName(searchQuery);
                                    }
                                }}
                            >
                                <span className="material-icons-round">add_circle</span>
                                Kreiraj novi materijal
                            </div>
                        ) : (
                            <div className="msm-create-form">
                                <div className="msm-create-form-title">
                                    <span className="material-icons-round">add_circle</span>
                                    Novi materijal
                                </div>

                                <div className="msm-form-group full-width" style={{ marginBottom: 8 }}>
                                    <label>Naziv *</label>
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={e => setNewName(e.target.value)}
                                        placeholder="Naziv materijala"
                                        autoFocus
                                    />
                                </div>

                                <div className="msm-form-row">
                                    <div className="msm-form-group">
                                        <label>Kategorija</label>
                                        <select value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                                            {MATERIAL_CATEGORIES.map(c => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="msm-form-group">
                                        <label>Jedinica</label>
                                        <select value={newUnit} onChange={e => setNewUnit(e.target.value)}>
                                            <option value="kom">kom</option>
                                            <option value="m">m</option>
                                            <option value="m²">m²</option>
                                            <option value="set">set</option>
                                            <option value="kg">kg</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="msm-form-row">
                                    <div className="msm-form-group">
                                        <label>Cijena (KM)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={newPrice || ''}
                                            onChange={e => setNewPrice(parseFloat(e.target.value) || 0)}
                                        />
                                    </div>
                                    <div className="msm-form-group">
                                        <label>Dobavljač</label>
                                        <input
                                            type="text"
                                            value={newSupplier}
                                            onChange={e => setNewSupplier(e.target.value)}
                                            placeholder="Opciono"
                                        />
                                    </div>
                                </div>

                                <div className="msm-create-actions">
                                    <button
                                        className="msm-btn-create secondary"
                                        onClick={() => {
                                            setShowCreateForm(false);
                                            setNewName('');
                                            setNewPrice(0);
                                            setNewSupplier('');
                                        }}
                                    >
                                        Otkaži
                                    </button>
                                    <button
                                        className="msm-btn-create primary"
                                        onClick={handleCreateMaterial}
                                        disabled={creatingMaterial || !newName.trim()}
                                    >
                                        {creatingMaterial ? 'Kreiranje...' : 'Sačuvaj i dodaj'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Selection */}
                    <div className="msm-selection">
                        <div className="msm-selection-header">
                            <div className="msm-selection-title">
                                Odabrani materijali
                                {selectedArray.length > 0 && (
                                    <span className="msm-selection-count">{selectedArray.length}</span>
                                )}
                            </div>
                            {selectedArray.length > 0 && !showSaveTemplate && (
                                <button
                                    className="msm-tpl-save-link"
                                    onClick={() => { setShowSaveTemplate(true); setTemplateName(''); }}
                                >
                                    <span className="material-icons-round">bookmark_add</span>
                                    Sačuvaj kao templejt
                                </button>
                            )}
                        </div>

                        {showSaveTemplate && (
                            <div className="msm-tpl-save-row">
                                <input
                                    type="text"
                                    className="msm-tpl-name-input"
                                    placeholder="Naziv templejta (npr. Standardna kuhinja)"
                                    value={templateName}
                                    autoFocus
                                    onChange={e => setTemplateName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveTemplate(); }}
                                />
                                <button
                                    className="msm-tpl-btn primary"
                                    onClick={handleSaveTemplate}
                                    disabled={savingTemplate || !templateName.trim()}
                                >
                                    {savingTemplate ? 'Spremam...' : 'Sačuvaj'}
                                </button>
                                <button
                                    className="msm-tpl-btn ghost"
                                    title="Otkaži"
                                    onClick={() => { setShowSaveTemplate(false); setTemplateName(''); }}
                                >
                                    <span className="material-icons-round">close</span>
                                </button>
                            </div>
                        )}

                        {selectedArray.length === 0 ? (
                            <div className="msm-selection-empty">
                                <span className="material-icons-round">checklist</span>
                                <p>Nema odabranih materijala</p>
                                <p className="hint">Kliknite na materijal u katalogu za odabir</p>
                            </div>
                        ) : (
                            <div className="msm-selection-list">
                                {selectedArray.map(item => (
                                    <div key={item.materialId} className="msm-selected-card">
                                        <div className="msm-selected-top">
                                            <div>
                                                <div className="msm-selected-name">{item.materialName}</div>
                                                <div className="msm-selected-unit-label">{item.unit}{item.supplier ? ` • ${item.supplier}` : ''}</div>
                                            </div>
                                            <button
                                                className="msm-remove-btn"
                                                onClick={() => removeSelected(item.materialId)}
                                                title="Ukloni"
                                            >
                                                <span className="material-icons-round">close</span>
                                            </button>
                                        </div>

                                        <div className="msm-selected-math-row">
                                            <div className="msm-input-group">
                                                <label>Količina</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={item.quantity}
                                                    onChange={e => updateSelectedField(item.materialId, 'quantity', parseFloat(e.target.value) || 0)}
                                                    onFocus={e => e.target.select()}
                                                />
                                            </div>
                                            <div className="msm-math-sign">×</div>
                                            <div className="msm-input-group">
                                                <label>Cijena (KM)</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={item.price}
                                                    onChange={e => updateSelectedField(item.materialId, 'price', parseFloat(e.target.value) || 0)}
                                                    onFocus={e => e.target.select()}
                                                />
                                            </div>
                                            <div className="msm-math-sign">=</div>
                                            <div className="msm-selected-total-val">
                                                {(item.quantity * item.price).toFixed(2)} KM
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="msm-footer">
                    <div className="msm-footer-total">
                        {selectedArray.length > 0 && (
                            <>Ukupno: <span>{grandTotal.toFixed(2)} KM</span></>
                        )}
                    </div>
                    <div className="msm-footer-actions">
                        <button className="msm-btn secondary" onClick={onClose}>
                            Otkaži
                        </button>
                        <button
                            className="msm-btn primary"
                            onClick={handleSubmit}
                            disabled={selectedArray.length === 0 || saving}
                        >
                            {saving
                                ? 'Dodavanje...'
                                : selectedArray.length === 0
                                    ? 'Odaberite materijale'
                                    : `Dodaj ${selectedArray.length} materijal${selectedArray.length === 1 ? '' : selectedArray.length < 5 ? 'a' : 'a'}`
                            }
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
}
