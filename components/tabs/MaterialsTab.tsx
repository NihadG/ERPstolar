'use client';

import { useState } from 'react';
import type { Material } from '@/lib/types';
import { saveMaterial, deleteMaterial } from '@/lib/database';
import { useData } from '@/context/DataContext';
import Modal from '@/components/ui/Modal';
import { MATERIAL_CATEGORIES } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface MaterialsTabProps {
    materials: Material[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function MaterialsTab({ materials, onRefresh, showToast }: MaterialsTabProps) {
    const { organizationId } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [materialModal, setMaterialModal] = useState(false);
    const [editingMaterial, setEditingMaterial] = useState<Partial<Material> | null>(null);

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

        const result = await saveMaterial(editingMaterial, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            setMaterialModal(false);
            onRefresh();
        } else {
            showToast(result.message, 'error');
        }
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
            onRefresh();
        } else {
            showToast(result.message, 'error');
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
                    <label>Opis</label>
                    <textarea
                        rows={2}
                        value={editingMaterial?.Description || ''}
                        onChange={(e) => setEditingMaterial({ ...editingMaterial, Description: e.target.value })}
                    />
                </div>
            </Modal>
        </div>
    );
}
