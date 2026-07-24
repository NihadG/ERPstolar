'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Material, MaterialTemplate } from '@/lib/types';
import { saveMaterial, deleteMaterial, deleteDuplicateMaterials, getMaterialTemplates, applyMaterialTemplate, applyBasisReview } from '@/lib/services';
import type { ProjectBasisReview, BasisReviewItem } from '@/lib/profitBasis';
import { useData } from '@/context/DataContext';
import Modal from '@/components/ui/Modal';
import ProfitBasisReviewModal from '@/components/ui/ProfitBasisReviewModal';
import MaterialTemplatesModal from '@/components/ui/MaterialTemplatesModal';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { MATERIAL_CATEGORIES } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface MaterialsTabProps {
    materials: Material[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function MaterialsTab({ materials, onRefresh, showToast }: MaterialsTabProps) {
    const { organizationId, appState, loadTabData, isTabLoaded } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [materialModal, setMaterialModal] = useState(false);
    const [editingMaterial, setEditingMaterial] = useState<Partial<Material> | null>(null);
    const [removingDuplicates, setRemovingDuplicates] = useState(false);
    // Gejt „utiče li na profit?" nakon promjene cijene materijala u katalogu.
    const [basisReview, setBasisReview] = useState<{ review: ProjectBasisReview[]; label: string } | null>(null);

    // Material templates
    const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
    const [templates, setTemplates] = useState<MaterialTemplate[]>([]);
    const [quickTemplateId, setQuickTemplateId] = useState('');
    const [applyingTemplate, setApplyingTemplate] = useState(false);

    // Load suppliers if not loaded
    useEffect(() => {
        if (!isTabLoaded('suppliers')) {
            loadTabData('suppliers');
        }
    }, [isTabLoaded, loadTabData]);

    const loadTemplates = useCallback(async () => {
        if (!organizationId) return;
        try {
            setTemplates(await getMaterialTemplates(organizationId));
        } catch (err) {
            console.error('loadTemplates error:', err);
        }
    }, [organizationId]);

    useEffect(() => {
        loadTemplates();
    }, [loadTemplates]);

    async function handleApplyQuickTemplate() {
        if (!quickTemplateId || !organizationId) return;
        setApplyingTemplate(true);
        const result = await applyMaterialTemplate(quickTemplateId, organizationId);
        setApplyingTemplate(false);
        if (result.success) {
            showToast(result.message, 'success');
            setMaterialModal(false);
            setQuickTemplateId('');
            onRefresh('materials');
        } else {
            showToast(result.message, 'error');
        }
    }

    const supplierOptions = useMemo(() => {
        return (appState.suppliers || []).map(s => ({
            value: s.Name,
            label: s.Name
        }));
    }, [appState.suppliers]);

    const filteredMaterials = materials.filter(material => {
        const matchesSearch = material.Name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            material.Description?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = !categoryFilter || material.Category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    function openMaterialModal(material?: Material) {
        setEditingMaterial(material || { Category: 'Ploča', Unit: 'kom' });
        setMaterialModal(true);
    }

    async function handleSaveMaterial() {
        if (!editingMaterial?.Name) {
            showToast('Unesite naziv materijala', 'error');
            return;
        }
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const materialName = editingMaterial.Name;
        const result = await saveMaterial(editingMaterial, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            setMaterialModal(false);
            onRefresh('materials');
            // Promjena cijene dira osnovicu profita proizvodnih naloga → gejt pregled.
            if (result.basisReview && result.basisReview.length > 0) {
                setBasisReview({ review: result.basisReview, label: materialName || 'materijal' });
            }
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleApplyBasisReview(approvedItems: BasisReviewItem[]) {
        if (!organizationId) return;
        const res = await applyBasisReview(approvedItems, organizationId);
        if (res.success) {
            showToast(approvedItems.length > 0 ? 'Profit ažuriran' : 'Profit nepromijenjen', 'success');
            onRefresh('workOrders', 'projects');
        } else {
            showToast(res.message, 'error');
        }
        setBasisReview(null);
    }

    async function handleDeleteMaterial(materialId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovaj materijal?')) return;
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await deleteMaterial(materialId, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('materials');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleRemoveDuplicates() {
        if (!confirm('Obrisati sve materijale sa identičnim nazivom i cijenom? Ostat će samo po jedan od svakog.')) return;
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        setRemovingDuplicates(true);
        try {
            const result = await deleteDuplicateMaterials(organizationId);
            if (result.success) {
                showToast(result.message, result.deletedCount > 0 ? 'success' : 'info');
                if (result.deletedCount > 0) {
                    onRefresh('materials');
                }
            } else {
                showToast(result.message, 'error');
            }
        } finally {
            setRemovingDuplicates(false);
        }
    }

    return (
        <div className="tab-content active" id="materials-content">
            <div className="content-header">
                <div className="search-box">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži materijale..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select
                    className="filter-select"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                >
                    <option value="">Sve kategorije</option>
                    {MATERIAL_CATEGORIES.map(category => (
                        <option key={category} value={category}>{category}</option>
                    ))}
                </select>
                <button
                    className="btn btn-secondary"
                    onClick={handleRemoveDuplicates}
                    disabled={removingDuplicates}
                    title="Obriši duplikate materijala (isti naziv i cijena)"
                >
                    <span className="material-icons-round">delete_sweep</span>
                    {removingDuplicates ? 'Brisanje...' : 'Obriši Duplikate'}
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={() => setTemplatesModalOpen(true)}
                    title="Upravljaj templejtima materijala"
                >
                    <span className="material-icons-round">bookmarks</span>
                    Templejti
                </button>
                <button className="btn btn-primary" onClick={() => openMaterialModal()}>
                    <span className="material-icons-round">add</span>
                    Novi Materijal
                </button>
            </div>

            <div className="materials-list">
                {filteredMaterials.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">inventory_2</span>
                        <h3>Nema materijala</h3>
                        <p>Dodajte prvi materijal klikom na "Novi Materijal"</p>
                    </div>
                ) : (
                    filteredMaterials.map(material => (
                        <div key={material.Material_ID} className="simple-card">
                            <div className="simple-card-info">
                                <div className="simple-card-title">{material.Name}</div>
                                <div className="simple-card-subtitle">
                                    {material.Category} • {material.Unit} • {material.Default_Supplier || 'Bez dobavljača'}
                                </div>
                            </div>
                            <div className="simple-card-meta">
                                <span className="simple-card-price">{formatCurrency(material.Default_Unit_Price || 0)}/{material.Unit}</span>
                            </div>
                            <div className="project-actions">
                                <button className="icon-btn" onClick={() => openMaterialModal(material)}>
                                    <span className="material-icons-round">edit</span>
                                </button>
                                <button className="icon-btn danger" onClick={() => handleDeleteMaterial(material.Material_ID)}>
                                    <span className="material-icons-round">delete</span>
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Material Modal */}
            <Modal
                isOpen={materialModal}
                onClose={() => setMaterialModal(false)}
                title={editingMaterial?.Material_ID ? 'Uredi Materijal' : 'Novi Materijal'}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setMaterialModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleSaveMaterial}>Sačuvaj</button>
                    </>
                }
            >
                {!editingMaterial?.Material_ID && templates.length > 0 && (
                    <div className="material-template-bar">
                        <span className="material-icons-round">bookmarks</span>
                        <select
                            className="filter-select"
                            value={quickTemplateId}
                            onChange={(e) => setQuickTemplateId(e.target.value)}
                        >
                            <option value="">Učitaj iz templejta…</option>
                            {templates.map(t => (
                                <option key={t.Template_ID} value={t.Template_ID}>
                                    {t.Name} ({t.Items?.length || 0})
                                </option>
                            ))}
                        </select>
                        <button
                            className="btn btn-sm btn-primary"
                            onClick={handleApplyQuickTemplate}
                            disabled={!quickTemplateId || applyingTemplate}
                        >
                            <span className="material-icons-round">download</span>
                            {applyingTemplate ? 'Učitavam...' : 'Učitaj'}
                        </button>
                        <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => { setMaterialModal(false); setTemplatesModalOpen(true); }}
                        >
                            Upravljaj
                        </button>
                    </div>
                )}

                <div className="form-group">
                    <label>Naziv *</label>
                    <input
                        type="text"
                        value={editingMaterial?.Name || ''}
                        onChange={(e) => setEditingMaterial({ ...editingMaterial, Name: e.target.value })}
                    />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Kategorija</label>
                        <select
                            value={editingMaterial?.Category || 'Ploča'}
                            onChange={(e) => setEditingMaterial({ ...editingMaterial, Category: e.target.value })}
                        >
                            {MATERIAL_CATEGORIES.map(category => (
                                <option key={category} value={category}>{category}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Jedinica</label>
                        <select
                            value={editingMaterial?.Unit || 'kom'}
                            onChange={(e) => setEditingMaterial({ ...editingMaterial, Unit: e.target.value })}
                        >
                            <option value="kom">kom</option>
                            <option value="m">m</option>
                            <option value="m²">m²</option>
                            <option value="set">set</option>
                            <option value="kg">kg</option>
                        </select>
                    </div>
                </div>
                <div className="form-group">
                    <label>Cijena (KM)</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingMaterial?.Default_Unit_Price || ''}
                        onChange={(e) => setEditingMaterial({ ...editingMaterial, Default_Unit_Price: parseFloat(e.target.value) || 0 })}
                    />
                </div>
                <div className="form-group">
                    <SearchableSelect
                        label="Dobavljač"
                        options={supplierOptions}
                        value={editingMaterial?.Default_Supplier || ''}
                        onChange={(val) => setEditingMaterial({ ...editingMaterial, Default_Supplier: val })}
                        placeholder="Odaberi dobavljača..."
                    />
                </div>
                <div className="form-group">
                    <label>Opis</label>
                    <textarea
                        rows={2}
                        value={editingMaterial?.Description || ''}
                        onChange={(e) => setEditingMaterial({ ...editingMaterial, Description: e.target.value })}
                    />
                </div>
            </Modal>

            <MaterialTemplatesModal
                isOpen={templatesModalOpen}
                onClose={() => { setTemplatesModalOpen(false); loadTemplates(); }}
                organizationId={organizationId || ''}
                materials={materials}
                supplierOptions={supplierOptions}
                showToast={showToast}
                onApplied={() => onRefresh('materials')}
            />

            {basisReview && (
                <ProfitBasisReviewModal
                    review={basisReview.review}
                    changeLabel={basisReview.label}
                    onClose={() => setBasisReview(null)}
                    onApply={handleApplyBasisReview}
                />
            )}
        </div>
    );
}
