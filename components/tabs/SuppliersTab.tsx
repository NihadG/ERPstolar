'use client';

import { useState } from 'react';
import type { Supplier } from '@/lib/types';
import { saveSupplier, deleteSupplier } from '@/lib/database';
import { useData } from '@/context/DataContext';
import Modal from '@/components/ui/Modal';

interface SuppliersTabProps {
    suppliers: Supplier[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function SuppliersTab({ suppliers, onRefresh, showToast }: SuppliersTabProps) {
    const { organizationId } = useData();
    const [supplierModal, setSupplierModal] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Partial<Supplier> | null>(null);

    function openSupplierModal(supplier?: Supplier) {
        setEditingSupplier(supplier || {});
        setSupplierModal(true);
    }

    async function handleSaveSupplier() {
        if (!editingSupplier?.Name) {
            showToast('Unesite naziv dobavljača', 'error');
            return;
        }
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await saveSupplier(editingSupplier, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            setSupplierModal(false);
            onRefresh('suppliers');
        } else {
            showToast(result.message, 'error');
        }
    }

    async function handleDeleteSupplier(supplierId: string) {
        if (!confirm('Jeste li sigurni da želite obrisati ovog dobavljača?')) return;
        if (!organizationId) {
            showToast('Organization ID is required', 'error');
            return;
        }

        const result = await deleteSupplier(supplierId, organizationId);
        if (result.success) {
            showToast(result.message, 'success');
            onRefresh('suppliers');
        } else {
            showToast(result.message, 'error');
        }
    }

    return (
        <div className="tab-content active" id="suppliers-content">
            <div className="content-header">
                <button className="btn btn-primary" onClick={() => openSupplierModal()}>
                    <span className="material-icons-round">add_business</span>
                    Novi Dobavljač
                </button>
            </div>

            <div className="suppliers-list">
                {suppliers.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">store</span>
                        <h3>Nema dobavljača</h3>
                        <p>Dodajte prvog dobavljača klikom na "Novi Dobavljač"</p>
                    </div>
                ) : (
                    suppliers.map(supplier => (
                        <div key={supplier.Supplier_ID} className="simple-card">
                            <div className="simple-card-info">
                                <div className="simple-card-title">{supplier.Name}</div>
                                <div className="simple-card-subtitle">
                                    {supplier.Contact_Person || 'Bez kontakt osobe'} • {supplier.Phone || 'Bez telefona'}
                                </div>
                            </div>
                            <div className="simple-card-meta">
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    {supplier.Categories || 'Bez kategorija'}
                                </span>
                            </div>
                            <div className="project-actions">
                                <button className="icon-btn" onClick={() => openSupplierModal(supplier)}>
                                    <span className="material-icons-round">edit</span>
                                </button>
                                <button className="icon-btn danger" onClick={() => handleDeleteSupplier(supplier.Supplier_ID)}>
                                    <span className="material-icons-round">delete</span>
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Supplier Modal */}
            <Modal
                isOpen={supplierModal}
                onClose={() => setSupplierModal(false)}
                title={editingSupplier?.Supplier_ID ? 'Uredi Dobavljača' : 'Novi Dobavljač'}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setSupplierModal(false)}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleSaveSupplier}>Sačuvaj</button>
                    </>
                }
            >
                <div className="form-group">
                    <label>Naziv *</label>
                    <input
                        type="text"
                        value={editingSupplier?.Name || ''}
                        onChange={(e) => setEditingSupplier({ ...editingSupplier, Name: e.target.value })}
                    />
                </div>
                <div className="form-group">
                    <label>Kontakt osoba</label>
                    <input
                        type="text"
                        value={editingSupplier?.Contact_Person || ''}
                        onChange={(e) => setEditingSupplier({ ...editingSupplier, Contact_Person: e.target.value })}
                    />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Telefon</label>
                        <input
                            type="tel"
                            value={editingSupplier?.Phone || ''}
                            onChange={(e) => setEditingSupplier({ ...editingSupplier, Phone: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            value={editingSupplier?.Email || ''}
                            onChange={(e) => setEditingSupplier({ ...editingSupplier, Email: e.target.value })}
                        />
                    </div>
                </div>
                <div className="form-group">
                    <label>Adresa</label>
                    <input
                        type="text"
                        value={editingSupplier?.Address || ''}
                        onChange={(e) => setEditingSupplier({ ...editingSupplier, Address: e.target.value })}
                    />
                </div>
                <div className="form-group">
                    <label>Kategorije (odvojene zarezom)</label>
                    <input
                        type="text"
                        placeholder="npr. Ploča, Kanttraka, Okovi"
                        value={editingSupplier?.Categories || ''}
                        onChange={(e) => setEditingSupplier({ ...editingSupplier, Categories: e.target.value })}
                    />
                </div>
            </Modal>
        </div>
    );
}
