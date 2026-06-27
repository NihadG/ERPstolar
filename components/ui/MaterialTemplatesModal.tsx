'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Material, MaterialTemplate, MaterialTemplateItem } from '@/lib/types';
import { MATERIAL_CATEGORIES } from '@/lib/types';
import {
    getMaterialTemplates,
    saveMaterialTemplate,
    deleteMaterialTemplate,
    applyMaterialTemplate,
} from '@/lib/services';
import Modal from '@/components/ui/Modal';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { formatCurrency } from '@/lib/utils';
import './MaterialTemplatesModal.css';

const UNITS = ['kom', 'm', 'm²', 'set', 'kg'];

interface MaterialTemplatesModalProps {
    isOpen: boolean;
    onClose: () => void;
    organizationId: string;
    materials: Material[];
    supplierOptions: { value: string; label: string }[];
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    /** Called after a template is loaded so the parent can refresh the catalog. */
    onApplied: () => void;
}

function emptyRow(): MaterialTemplateItem {
    return { Name: '', Category: 'Ploče i trake', Unit: 'kom', Default_Unit_Price: 0, Default_Supplier: '' };
}

export default function MaterialTemplatesModal({
    isOpen,
    onClose,
    organizationId,
    materials,
    supplierOptions,
    showToast,
    onApplied,
}: MaterialTemplatesModalProps) {
    const [view, setView] = useState<'list' | 'edit'>('list');
    const [templates, setTemplates] = useState<MaterialTemplate[]>([]);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    // Editor state
    const [draft, setDraft] = useState<Partial<MaterialTemplate>>({ Name: '', Items: [] });
    const [saving, setSaving] = useState(false);
    const [addFromCatalog, setAddFromCatalog] = useState('');

    const catalogOptions = materials.map(m => ({
        value: m.Material_ID,
        label: m.Name,
        subLabel: `${m.Category} • ${formatCurrency(m.Default_Unit_Price || 0)}/${m.Unit}`,
    }));

    const loadTemplates = useCallback(async () => {
        if (!organizationId) return;
        setLoading(true);
        try {
            setTemplates(await getMaterialTemplates(organizationId));
        } catch (err) {
            console.error('loadTemplates error:', err);
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

    useEffect(() => {
        if (isOpen) {
            setView('list');
            loadTemplates();
        }
    }, [isOpen, loadTemplates]);

    // ---- List actions ----
    async function handleApply(template: MaterialTemplate) {
        setBusyId(template.Template_ID);
        const res = await applyMaterialTemplate(template.Template_ID, organizationId);
        setBusyId(null);
        if (res.success) {
            showToast(res.message, 'success');
            onApplied();
            onClose();
        } else {
            showToast(res.message, 'error');
        }
    }

    async function handleDelete(template: MaterialTemplate) {
        if (!confirm(`Obrisati templejt "${template.Name}"?`)) return;
        setBusyId(template.Template_ID);
        const res = await deleteMaterialTemplate(template.Template_ID, organizationId);
        setBusyId(null);
        if (res.success) {
            showToast(res.message, 'success');
            loadTemplates();
        } else {
            showToast(res.message, 'error');
        }
    }

    function startNew() {
        setDraft({ Name: '', Items: [emptyRow()] });
        setView('edit');
    }

    function startEdit(template: MaterialTemplate) {
        setDraft({ ...template, Items: template.Items?.length ? template.Items.map(i => ({ ...i })) : [emptyRow()] });
        setView('edit');
    }

    // ---- Editor row helpers ----
    function updateRow(index: number, field: keyof MaterialTemplateItem, value: string | number) {
        setDraft(prev => {
            const items = [...(prev.Items || [])];
            items[index] = { ...items[index], [field]: value };
            return { ...prev, Items: items };
        });
    }

    function addRow() {
        setDraft(prev => ({ ...prev, Items: [...(prev.Items || []), emptyRow()] }));
    }

    function removeRow(index: number) {
        setDraft(prev => ({ ...prev, Items: (prev.Items || []).filter((_, i) => i !== index) }));
    }

    function handleAddFromCatalog(materialId: string) {
        const mat = materials.find(m => m.Material_ID === materialId);
        if (!mat) return;
        setDraft(prev => ({
            ...prev,
            Items: [...(prev.Items || []), {
                Name: mat.Name,
                Category: mat.Category || 'Ostalo',
                Unit: mat.Unit || 'kom',
                Default_Unit_Price: mat.Default_Unit_Price || 0,
                Default_Supplier: mat.Default_Supplier || '',
                Description: mat.Description || '',
            }],
        }));
        setAddFromCatalog('');
    }

    async function handleSave() {
        const name = (draft.Name || '').trim();
        if (!name) {
            showToast('Unesite naziv templejta', 'error');
            return;
        }
        const items = (draft.Items || []).filter(i => i.Name && i.Name.trim());
        if (items.length === 0) {
            showToast('Dodajte barem jedan materijal u templejt', 'error');
            return;
        }

        setSaving(true);
        const res = await saveMaterialTemplate({ ...draft, Name: name, Items: items }, organizationId);
        setSaving(false);
        if (res.success) {
            showToast(res.message, 'success');
            await loadTemplates();
            setView('list');
        } else {
            showToast(res.message, 'error');
        }
    }

    const rows = draft.Items || [];

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="mt-modal-title">
                    <span className="material-icons-round">bookmarks</span>
                    <span>{view === 'edit' ? (draft.Template_ID ? 'Uredi templejt' : 'Novi templejt') : 'Templejti materijala'}</span>
                </div>
            }
            size="xl"
            footer={
                view === 'list' ? (
                    <>
                        <button className="btn btn-secondary" onClick={onClose}>Zatvori</button>
                        <button className="btn btn-primary" onClick={startNew}>
                            <span className="material-icons-round">add</span>
                            Novi templejt
                        </button>
                    </>
                ) : (
                    <>
                        <button className="btn btn-secondary" onClick={() => setView('list')} disabled={saving}>Nazad</button>
                        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                            <span className="material-icons-round">save</span>
                            {saving ? 'Spremanje...' : 'Sačuvaj templejt'}
                        </button>
                    </>
                )
            }
        >
            {view === 'list' ? (
                <div className="mt-list">
                    {loading ? (
                        <div className="mt-empty"><p>Učitavanje...</p></div>
                    ) : templates.length === 0 ? (
                        <div className="mt-empty">
                            <span className="material-icons-round">bookmark_border</span>
                            <h3>Nema templejta</h3>
                            <p>Kreirajte templejt sa materijalima koje često koristite, pa ih učitajte jednim klikom.</p>
                        </div>
                    ) : (
                        templates.map(t => (
                            <div key={t.Template_ID} className="mt-card">
                                <div className="mt-card-info">
                                    <div className="mt-card-title">{t.Name}</div>
                                    <div className="mt-card-sub">
                                        {(t.Items?.length || 0)} {(t.Items?.length === 1) ? 'materijal' : 'materijala'}
                                        {t.Items?.length ? ` • ${t.Items.slice(0, 3).map(i => i.Name).join(', ')}${t.Items.length > 3 ? '…' : ''}` : ''}
                                    </div>
                                </div>
                                <div className="mt-card-actions">
                                    <button
                                        className="btn btn-sm btn-primary"
                                        onClick={() => handleApply(t)}
                                        disabled={busyId === t.Template_ID}
                                    >
                                        <span className="material-icons-round">download</span>
                                        {busyId === t.Template_ID ? 'Učitavam...' : 'Učitaj'}
                                    </button>
                                    <button className="icon-btn" title="Uredi" onClick={() => startEdit(t)} disabled={busyId === t.Template_ID}>
                                        <span className="material-icons-round">edit</span>
                                    </button>
                                    <button className="icon-btn danger" title="Obriši" onClick={() => handleDelete(t)} disabled={busyId === t.Template_ID}>
                                        <span className="material-icons-round">delete</span>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : (
                <div className="mt-editor">
                    <div className="form-group">
                        <label>Naziv templejta *</label>
                        <input
                            type="text"
                            placeholder="npr. Standardna kuhinja"
                            value={draft.Name || ''}
                            onChange={(e) => setDraft(prev => ({ ...prev, Name: e.target.value }))}
                        />
                    </div>

                    <div className="mt-rows">
                        <div className="mt-rows-head">
                            <span className="mt-col-name">Naziv materijala</span>
                            <span className="mt-col-cat">Kategorija</span>
                            <span className="mt-col-unit">Jed.</span>
                            <span className="mt-col-price">Cijena</span>
                            <span className="mt-col-sup">Dobavljač</span>
                            <span className="mt-col-act" />
                        </div>

                        {rows.map((row, index) => (
                            <div key={index} className="mt-row">
                                <input
                                    className="mt-col-name"
                                    type="text"
                                    placeholder="Naziv"
                                    value={row.Name}
                                    onChange={(e) => updateRow(index, 'Name', e.target.value)}
                                />
                                <select
                                    className="mt-col-cat"
                                    value={row.Category}
                                    onChange={(e) => updateRow(index, 'Category', e.target.value)}
                                >
                                    {MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <select
                                    className="mt-col-unit"
                                    value={row.Unit}
                                    onChange={(e) => updateRow(index, 'Unit', e.target.value)}
                                >
                                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                                <input
                                    className="mt-col-price"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                    value={row.Default_Unit_Price || ''}
                                    onChange={(e) => updateRow(index, 'Default_Unit_Price', parseFloat(e.target.value) || 0)}
                                />
                                <input
                                    className="mt-col-sup"
                                    type="text"
                                    placeholder="Dobavljač"
                                    list="mt-supplier-list"
                                    value={row.Default_Supplier}
                                    onChange={(e) => updateRow(index, 'Default_Supplier', e.target.value)}
                                />
                                <button className="icon-btn danger mt-col-act" title="Ukloni red" onClick={() => removeRow(index)}>
                                    <span className="material-icons-round">close</span>
                                </button>
                            </div>
                        ))}

                        <datalist id="mt-supplier-list">
                            {supplierOptions.map(s => <option key={s.value} value={s.value} />)}
                        </datalist>
                    </div>

                    <div className="mt-editor-tools">
                        <button className="btn btn-sm btn-secondary" onClick={addRow}>
                            <span className="material-icons-round">add</span>
                            Dodaj red
                        </button>
                        <div className="mt-from-catalog">
                            <SearchableSelect
                                options={catalogOptions}
                                value={addFromCatalog}
                                onChange={handleAddFromCatalog}
                                placeholder="Dodaj iz kataloga..."
                            />
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
}
