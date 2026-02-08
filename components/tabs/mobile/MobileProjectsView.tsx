'use client';

import React, { useState, useMemo } from 'react';
import type { Project, Material, WorkOrder, Offer, WorkLog, Product, ProductMaterial } from '@/lib/types';
import { PROJECT_STATUSES } from '@/lib/types';

interface MobileProjectsViewProps {
    projects: Project[];
    materials: Material[];
    workOrders: WorkOrder[];
    offers?: Offer[];
    workLogs?: WorkLog[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onNavigateToTasks?: (projectId: string) => void;

    // Explicitly passing handlers from parent to keep logic centralized
    onOpenProjectModal: (project?: Project) => void;
    onDeleteProject: (projectId: string) => void;

    // Product & Material Handlers
    onOpenProductModal: (projectId: string, product?: Product) => void;
    onDeleteProduct: (productId: string) => void;
    onOpenMaterialModal: (productId: string) => void;
    onDeleteMaterial: (materialId: string) => void;
    onEditMaterial: (material: ProductMaterial) => void;
    onEditGlass: (productId: string, material: ProductMaterial) => void;
    onEditAluDoor: (productId: string, material: ProductMaterial) => void;
    onUpdateMaterial: (materialId: string, updates: { Quantity: number; Unit_Price: number; Total_Price: number }) => Promise<void>;
}

export default function MobileProjectsView({
    projects,
    materials,
    onNavigateToTasks,
    onOpenProjectModal,
    onDeleteProject,
    onOpenProductModal,
    onDeleteProduct,
    onOpenMaterialModal,
    onDeleteMaterial,
    onEditMaterial,
    onEditGlass,
    onEditAluDoor,
    onUpdateMaterial
}: MobileProjectsViewProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
    const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

    // Quick edit mode for materials
    const [quickEditMode, setQuickEditMode] = useState<string | null>(null); // Product_ID in quick edit mode
    const [editingMaterialValues, setEditingMaterialValues] = useState<Record<string, { qty: number; price: number }>>({});

    // Focus Mode: when a project is expanded, only show that project
    const isInFocusMode = expandedProjectId !== null;
    const isInProductFocusMode = expandedProductId !== null;

    function toggleProject(projectId: string, e: React.MouseEvent) {
        if ((e.target as HTMLElement).closest('button')) return;
        if (expandedProjectId === projectId) {
            // Collapse project and reset product
            setExpandedProjectId(null);
            setExpandedProductId(null);
        } else {
            // Expand this project, collapse any expanded product
            setExpandedProjectId(projectId);
            setExpandedProductId(null);
        }
    }

    function toggleProduct(productId: string, e: React.MouseEvent) {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest('button')) return;

        // Toggle single product (focus mode for products)
        setExpandedProductId(prev => prev === productId ? null : productId);
    }

    function exitFocusMode() {
        setExpandedProjectId(null);
        setExpandedProductId(null);
    }

    function exitProductFocusMode() {
        setExpandedProductId(null);
    }

    // Helper to determine edit action
    function handleMaterialEdit(productId: string, mat: ProductMaterial) {
        const isGlass = mat.glassItems && mat.glassItems.length > 0;
        const isAluDoor = mat.aluDoorItems && mat.aluDoorItems.length > 0;

        if (isGlass) {
            onEditGlass(productId, mat);
        } else if (isAluDoor) {
            onEditAluDoor(productId, mat);
        } else {
            onEditMaterial(mat);
        }
    }

    // Natural sort for "Poz X" product names (supports decimals: 1, 1.1, 1.2, 2, 10)
    function sortProductsByPosition(products: Product[]): Product[] {
        return [...products].sort((a, b) => {
            // Extract position numbers from names like "Poz 1 - Kitchen", "Poz 1.2 - Table"
            const extractPoz = (name: string): number => {
                const match = name?.match(/^Poz\s*(\d+(?:\.\d+)?)/i);
                return match ? parseFloat(match[1]) : Infinity;
            };

            const pozA = extractPoz(a.Name || '');
            const pozB = extractPoz(b.Name || '');

            if (pozA !== pozB) return pozA - pozB;
            // If same position, sort alphabetically
            return (a.Name || '').localeCompare(b.Name || '');
        });
    }

    // Quick Edit Functions for Mobile
    function toggleQuickEdit(productId: string) {
        if (quickEditMode === productId) {
            // Exit quick edit mode
            setQuickEditMode(null);
            setEditingMaterialValues({});
        } else {
            // Enter quick edit mode
            setQuickEditMode(productId);
            // Initialize values for all materials in this product
            const product = projects.flatMap(p => p.products || []).find(prod => prod.Product_ID === productId);
            if (product?.materials) {
                const initialValues: Record<string, { qty: number; price: number }> = {};
                product.materials.forEach(mat => {
                    initialValues[mat.ID] = {
                        qty: mat.Quantity,
                        price: mat.Unit_Price
                    };
                });
                setEditingMaterialValues(initialValues);
            }
        }
    }

    function handleQuickEditChange(materialId: string, field: 'qty' | 'price', value: string) {
        const numValue = parseFloat(value) || 0;
        setEditingMaterialValues(prev => ({
            ...prev,
            [materialId]: {
                ...prev[materialId],
                [field]: numValue
            }
        }));
    }

    async function saveQuickEdit(materialId: string) {
        const values = editingMaterialValues[materialId];
        if (!values) return;

        // Find the original material to check if values changed
        const material = projects
            .flatMap(p => p.products || [])
            .flatMap(prod => prod.materials || [])
            .find(m => m.ID === materialId);

        if (!material) return;

        // Only save if changed
        if (values.qty === material.Quantity && values.price === material.Unit_Price) {
            return;
        }

        await onUpdateMaterial(materialId, {
            Quantity: values.qty,
            Unit_Price: values.price,
            Total_Price: values.qty * values.price
        });
    }

    const filteredProjects = useMemo(() => {
        let result = projects.filter(project => {
            const term = searchTerm?.toLowerCase() || '';
            const matchesSearch =
                (project.Client_Name?.toLowerCase() || '').includes(term) ||
                (project.Name?.toLowerCase() || '').includes(term) ||
                (project.Address?.toLowerCase() || '').includes(term);
            const matchesStatus = !statusFilter || project.Status === statusFilter;
            return matchesSearch && matchesStatus;
        });

        // Focus Mode: only show expanded project
        if (isInFocusMode) {
            result = result.filter(p => p.Project_ID === expandedProjectId);
        }

        return result;
    }, [projects, searchTerm, statusFilter, isInFocusMode, expandedProjectId]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Nacrt': return { bg: '#f3f4f6', color: '#6b7280' };
            case 'Ponuđeno': return { bg: '#fef3c7', color: '#d97706' };
            case 'Odobreno': return { bg: '#dbeafe', color: '#2563eb' };
            case 'U proizvodnji': return { bg: '#ede9fe', color: '#7c3aed' };
            case 'Završeno': return { bg: '#dcfce7', color: '#15803d' };
            case 'Otkazano': return { bg: '#fee2e2', color: '#dc2626' };
            default: return { bg: '#f3f4f6', color: '#6b7280' };
        }
    };

    function formatCurrency(amount: number) {
        return (amount || 0).toFixed(2) + ' KM';
    }

    return (
        <div className="mobile-projects-view">
            {/* Mobile Toolbar */}
            <div className="mobile-toolbar">
                <div className="mobile-search">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Traži..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button className="mobile-add-btn" onClick={() => onOpenProjectModal()}>
                    <span className="material-icons-round">add</span>
                </button>
            </div>

            {/* Filter Pills - Hidden in Focus Mode */}
            {!isInFocusMode && (
                <div className="filter-scroll">
                    <button
                        className={`filter-pill ${statusFilter === '' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('')}
                    >
                        Sve
                    </button>
                    {PROJECT_STATUSES.map(status => (
                        <button
                            key={status}
                            className={`filter-pill ${statusFilter === status ? 'active' : ''}`}
                            onClick={() => setStatusFilter(status)}
                        >
                            {status}
                        </button>
                    ))}
                </div>
            )}

            {/* Back Button for Focus Mode */}
            {isInFocusMode && (
                <button className="focus-back-btn" onClick={exitFocusMode}>
                    <span className="material-icons-round">arrow_back</span>
                    Svi Projekti
                </button>
            )}

            {/* Projects List */}
            <div className="mobile-list">
                {filteredProjects.map(project => {
                    const statusStyle = getStatusColor(project.Status);
                    const totalProducts = project.products?.length || 0;
                    const isExpanded = expandedProjectId === project.Project_ID;

                    return (
                        <div
                            key={project.Project_ID}
                            className={`mobile-project-card ${isExpanded ? 'expanded' : ''}`}
                            onClick={(e) => toggleProject(project.Project_ID, e)}
                        >
                            <div className="mp-header">
                                <div className="mp-title-row">
                                    <h3 className="mp-client">{project.Client_Name}</h3>
                                    <span
                                        className="mp-status-badge"
                                        style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}
                                    >
                                        {project.Status}
                                    </span>
                                </div>
                                {project.Name && <div className="mp-subtitle">{project.Name}</div>}
                                {project.Address && <div className="mp-address">{project.Address}</div>}
                            </div>

                            <div className="mp-stats">
                                <span className="mp-stat-item">
                                    <span className="material-icons-round">layers</span>
                                    {totalProducts} proizvoda
                                </span>
                                <span className="material-icons-round chevron">
                                    {isExpanded ? 'expand_less' : 'expand_more'}
                                </span>
                            </div>

                            {/* Expanded Content: Products */}
                            {isExpanded && (
                                <div className="mp-products-section">
                                    {/* Back Button for Product Focus Mode */}
                                    {isInProductFocusMode && (
                                        <button className="focus-back-btn small" onClick={(e) => { e.stopPropagation(); exitProductFocusMode(); }}>
                                            <span className="material-icons-round">arrow_back</span>
                                            Svi Proizvodi
                                        </button>
                                    )}

                                    {!isInProductFocusMode && (
                                        <div className="label-row">
                                            <span>Proizvodi</span>
                                            <button
                                                className="mobile-add-tiny-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onOpenProductModal(project.Project_ID);
                                                }}
                                            >
                                                <span className="material-icons-round">add</span>
                                            </button>
                                        </div>
                                    )}

                                    <div className="mp-products-list">
                                        {sortProductsByPosition(project.products || [])
                                            .filter(p => !isInProductFocusMode || expandedProductId === p.Product_ID)
                                            .map((product, idx) => {
                                                const isProdExpanded = expandedProductId === product.Product_ID;
                                                return (
                                                    <div
                                                        key={idx}
                                                        className={`mp-product-card ${isProdExpanded ? 'expanded' : ''}`}
                                                        onClick={(e) => toggleProduct(product.Product_ID, e)}
                                                    >
                                                        <div className="img-ph-actions-row">
                                                            <div className="mpp-header">
                                                                <span className="mpp-name">{product.Name}</span>
                                                                <span className="mpp-qty">x{product.Quantity}</span>
                                                            </div>
                                                            <div className="mp-prod-buttons">
                                                                <button
                                                                    className="mini-btn"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onOpenProductModal(project.Project_ID, product);
                                                                    }}
                                                                >
                                                                    <span className="material-icons-round">edit</span>
                                                                </button>
                                                                {isProdExpanded && (
                                                                    <button
                                                                        className="mini-btn danger"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            onDeleteProduct(product.Product_ID);
                                                                        }}
                                                                    >
                                                                        <span className="material-icons-round">delete</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="mpp-dims">
                                                            {product.Width && `${product.Width}×${product.Height}×${product.Depth}mm`}
                                                        </div>

                                                        {/* Materials Summary (When Collapsed) */}
                                                        {!isProdExpanded && (product.materials && product.materials.length > 0) && (
                                                            <div className="mpp-materials-summary">
                                                                <span className="material-icons-round tiny">layers</span>
                                                                {product.materials.length} materijala
                                                                <span className="material-icons-round tiny" style={{ marginLeft: 'auto' }}>expand_more</span>
                                                            </div>
                                                        )}

                                                        {/* Expanded Product Content: Materials */}
                                                        {isProdExpanded && (
                                                            <div className="mpp-expanded-materials">
                                                                <div className="mpp-mat-header">
                                                                    <span>Materijali ({product.materials?.length || 0})</span>
                                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                                        {(product.materials?.length || 0) > 0 && (
                                                                            <button
                                                                                className={`mobile-quick-edit-btn ${quickEditMode === product.Product_ID ? 'active' : ''}`}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    toggleQuickEdit(product.Product_ID);
                                                                                }}
                                                                            >
                                                                                <span className="material-icons-round">
                                                                                    {quickEditMode === product.Product_ID ? 'check' : 'flash_on'}
                                                                                </span>
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            className="mobile-add-tiny-btn"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                onOpenMaterialModal(product.Product_ID);
                                                                            }}
                                                                        >
                                                                            <span className="material-icons-round">add</span>
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                <div className="mpp-materials-list detailed">
                                                                    {product.materials?.map((mat, mIdx) => {
                                                                        const isInQuickEdit = quickEditMode === product.Product_ID;
                                                                        const editValues = editingMaterialValues[mat.ID] || { qty: mat.Quantity, price: mat.Unit_Price };
                                                                        const isGlass = mat.glassItems && mat.glassItems.length > 0;
                                                                        const isAluDoor = mat.aluDoorItems && mat.aluDoorItems.length > 0;

                                                                        return (
                                                                            <div key={mIdx} className={`mpp-material-item-detailed ${isInQuickEdit ? 'editing' : ''}`}>
                                                                                <div className="m-info">
                                                                                    <span className="m-name">{mat.Material_Name}</span>
                                                                                    {isInQuickEdit && !isGlass && !isAluDoor ? (
                                                                                        <div className="m-quick-edit-controls">
                                                                                            <div className="m-edit-field">
                                                                                                <label>Količina</label>
                                                                                                <input
                                                                                                    type="number"
                                                                                                    className="mobile-quick-edit-input"
                                                                                                    value={editValues.qty}
                                                                                                    onChange={(e) => handleQuickEditChange(mat.ID, 'qty', e.target.value)}
                                                                                                    onBlur={() => saveQuickEdit(mat.ID)}
                                                                                                    step="0.01"
                                                                                                    min="0"
                                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                                />
                                                                                                <span className="unit-label">{mat.Unit}</span>
                                                                                            </div>
                                                                                            <div className="m-edit-field">
                                                                                                <label>Cijena</label>
                                                                                                <input
                                                                                                    type="number"
                                                                                                    className="mobile-quick-edit-input"
                                                                                                    value={editValues.price}
                                                                                                    onChange={(e) => handleQuickEditChange(mat.ID, 'price', e.target.value)}
                                                                                                    onBlur={() => saveQuickEdit(mat.ID)}
                                                                                                    step="0.01"
                                                                                                    min="0"
                                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                                />
                                                                                                <span className="unit-label">KM</span>
                                                                                            </div>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <span className="m-detail">
                                                                                            {mat.Quantity} {mat.Unit} × {formatCurrency(mat.Unit_Price)}
                                                                                        </span>
                                                                                    )}
                                                                                    <span className="m-total">
                                                                                        Ukupno: <strong>
                                                                                            {isInQuickEdit && !isGlass && !isAluDoor
                                                                                                ? formatCurrency(editValues.qty * editValues.price)
                                                                                                : formatCurrency(mat.Total_Price || 0)
                                                                                            }
                                                                                        </strong>
                                                                                    </span>
                                                                                </div>
                                                                                {!isInQuickEdit && (
                                                                                    <div className="m-actions">
                                                                                        <button
                                                                                            className="mini-btn"
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                handleMaterialEdit(product.Product_ID, mat);
                                                                                            }}
                                                                                        >
                                                                                            <span className="material-icons-round">edit</span>
                                                                                        </button>
                                                                                        <button
                                                                                            className="mini-btn danger"
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                onDeleteMaterial(mat.ID);
                                                                                            }}
                                                                                        >
                                                                                            <span className="material-icons-round">delete</span>
                                                                                        </button>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {(!product.materials || product.materials.length === 0) && (
                                                                        <div className="mp-no-data">Nema materijala</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                        {(!project.products || project.products.length === 0) && (
                                            <div className="mp-no-products">Nema proizvoda</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="mp-actions" onClick={(e) => e.stopPropagation()}>
                                {onNavigateToTasks && (
                                    <button className="mp-action-btn" onClick={() => onNavigateToTasks(project.Project_ID)}>
                                        <span className="material-icons-round">task_alt</span>
                                    </button>
                                )}
                                <button className="mp-action-btn primary" onClick={() => onOpenProjectModal(project)}>
                                    <span className="material-icons-round">edit</span>
                                </button>
                                <button className="mp-action-btn danger-text" onClick={() => onDeleteProject(project.Project_ID)}>
                                    <span className="material-icons-round">delete</span>
                                </button>
                            </div>
                        </div>
                    );
                })}

                {filteredProjects.length === 0 && (
                    <div className="mobile-empty-state">
                        <span className="material-icons-round">folder_off</span>
                        <p>Nema pronađenih projekata</p>
                    </div>
                )}
            </div>

            <style jsx>{`
                .mobile-projects-view {
                    padding-bottom: 80px; /* Space for FAB or bottom nav */
                }

                .mobile-toolbar {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 16px;
                }

                .mobile-search {
                    flex: 1;
                    height: 52px;
                    background: white;
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.04);
                    border: 1px solid #f1f5f9;
                }

                .mobile-search input {
                    border: none;
                    background: transparent;
                    width: 100%;
                    height: 100%;
                    margin-left: 10px;
                    font-size: 16px;
                    outline: none;
                    color: #1e293b;
                }

                .mobile-add-btn {
                    width: 44px;
                    height: 44px;
                    background: #2563eb;
                    color: white;
                    border: none;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
                }

                /* Focus Mode Back Button */
                .focus-back-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 16px;
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    color: #475569;
                    margin-bottom: 12px;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.05);
                }
                
                .focus-back-btn:active {
                    background: #f8fafc;
                }
                
                .focus-back-btn .material-icons-round {
                    font-size: 20px;
                    color: #64748b;
                }
                
                .focus-back-btn.small {
                    padding: 8px 12px;
                    font-size: 13px;
                    margin-bottom: 10px;
                }
                
                .focus-back-btn.small .material-icons-round {
                    font-size: 18px;
                }

                /* Mobile Add Tiny Btn - Compact */
                .mobile-add-tiny-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    background: #eff6ff;
                    color: #2563eb;
                    border: 1px solid #bfdbfe;
                    padding: 0;
                    border-radius: 8px;
                    transition: all 0.2s;
                }
                
                .mobile-add-tiny-btn:active {
                    background: #dbeafe;
                    transform: scale(0.98);
                }

                .mobile-add-tiny-btn .material-icons-round {
                    font-size: 18px;
                }

                .filter-scroll {
                    display: flex;
                    gap: 8px;
                    overflow-x: auto;
                    padding-bottom: 4px; /* Hide scrollbar visual glitch */
                    margin-bottom: 20px;
                    -webkit-overflow-scrolling: touch;
                    scrollbar-width: none;
                }
                
                .filter-scroll::-webkit-scrollbar {
                    display: none;
                }

                .filter-pill {
                    white-space: nowrap;
                    padding: 8px 16px;
                    border-radius: 20px;
                    border: 1px solid #e2e8f0;
                    background: white;
                    color: #64748b;
                    font-size: 14px;
                    font-weight: 500;
                }

                .filter-pill.active {
                    background: #2563eb;
                    color: white;
                    border-color: #2563eb;
                }

                .mobile-list {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .mobile-project-card {
                    background: white;
                    border-radius: 16px;
                    padding: 16px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                }

                .mp-header {
                    margin-bottom: 12px;
                }

                .mp-title-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 4px;
                }

                .mp-client {
                    font-size: 18px;
                    font-weight: 700;
                    margin: 0;
                    color: #1e293b;
                }

                .mp-status-badge {
                    font-size: 11px;
                    font-weight: 600;
                    padding: 4px 8px;
                    border-radius: 6px;
                    text-transform: uppercase;
                }

                .mp-subtitle {
                    color: #64748b;
                    font-size: 14px;
                }

                .mp-address {
                    color: #94a3b8;
                    font-size: 13px;
                    margin-top: 4px;
                }

                .mp-stats {
                    padding: 16px;
                    background: #f8fafc;
                    border-radius: 12px;
                    margin-bottom: 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border: 1px solid #e2e8f0;
                }

                .mp-stat-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 15px;
                    font-weight: 600;
                    color: #334155;
                }

                .mp-stat-item .material-icons-round {
                    font-size: 24px;
                    color: #2563eb;
                    background: #dbeafe;
                    padding: 6px;
                    border-radius: 8px;
                }
                
                .chevron {
                    color: #cbd5e1;
                    transition: transform 0.2s;
                }
                
                .mobile-project-card.expanded .chevron {
                    transform: rotate(180deg);
                    color: #2563eb;
                }
                
                .mp-products-section {
                    margin-bottom: 16px;
                    background: #f8fafc;
                    border-radius: 12px;
                    padding: 12px;
                }
                
                .label-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #64748b;
                }
                
                .mp-products-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                .mp-product-card {
                    background: white;
                    border-radius: 8px;
                    padding: 10px;
                    border: 1px solid #e2e8f0;
                    transition: all 0.2s;
                }
                
                .mp-product-card.expanded {
                    border-color: #2563eb;
                    box-shadow: 0 4px 12px rgba(37,99,235,0.1);
                }

                .img-ph-actions-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                }
                
                .mpp-header {
                    flex: 1;
                }
                
                .mp-prod-buttons {
                    display: flex;
                    gap: 4px;
                    margin-left: 8px;
                }
                
                .mini-btn {
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 1px solid #e2e8f0;
                    background: white;
                    border-radius: 8px;
                    color: #64748b;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }
                
                .mini-btn:active {
                    background: #f1f5f9;
                }

                .mini-btn.danger {
                    color: #ef4444;
                    background: #fff;
                    border-color: #fee2e2;
                }
                
                .mini-btn.danger:active {
                    background: #fef2f2;
                }

                .mini-btn .material-icons-round {
                    font-size: 20px;
                }

                .mpp-name {
                    display: block;
                    font-weight: 600;
                    color: #1e293b;
                    font-size: 14px;
                    margin-bottom: 2px;
                }
                
                .mpp-qty {
                    background: #eff6ff;
                    color: #2563eb;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                }
                
                .mpp-dims {
                    font-size: 12px;
                    color: #94a3b8;
                    margin-bottom: 8px;
                    margin-top: 4px;
                }
                
                .mpp-materials-summary {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    color: #64748b;
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px dashed #e2e8f0;
                }

                /* Expanded Materials */
                .mpp-expanded-materials {
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid #f1f5f9;
                }
                
                .mpp-mat-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #64748b;
                }
                
                .mpp-materials-list.detailed {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                .mpp-material-item-detailed {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px;
                    background: #f8fafc;
                    border-radius: 6px;
                    border: 1px solid #f1f5f9;
                }
                
                .m-info {
                    flex: 1;
                    font-size: 12px;
                }
                
                .m-name {
                    display: block;
                    font-weight: 600;
                    color: #334155;
                    margin-bottom: 2px;
                }
                
                .m-detail {
                    display: block;
                    color: #64748b;
                    font-size: 11px;
                }
                
                .m-total {
                    display: block;
                    margin-top: 2px;
                    color: #15803d;
                    font-size: 11px;
                }
                
                .m-actions {
                    display: flex;
                    gap: 4px;
                    margin-left: 8px;
                }
                
                .mp-no-data {
                    text-align: center;
                    font-size: 12px;
                    color: #94a3b8;
                    padding: 12px;
                }
                
                .mp-actions {
                    display: flex;
                    gap: 8px;
                    justify-content: flex-end;
                    margin-top: 12px;
                }

                .mp-action-btn {
                    width: 40px;
                    height: 40px;
                    padding: 0;
                    border: 1px solid #e2e8f0;
                    background: white;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #475569;
                    transition: all 0.2s;
                }
                
                .mp-action-btn:active {
                    background: #f8fafc;
                    transform: scale(0.96);
                }

                .mp-action-btn.primary {
                    background: #eff6ff;
                    color: #2563eb;
                    border-color: #bfdbfe;
                }
                
                .mp-action-btn.primary:active {
                    background: #dbeafe;
                }

                .mp-action-btn.danger-text {
                    color: #ef4444;
                    border-color: #fee2e2;
                    background: #fef2f2;
                }
                
                .mp-action-btn .material-icons-round {
                    font-size: 20px;
                }

                /* Mobile Quick Edit Styles */
                .mobile-quick-edit-btn {
                    padding: 0;
                    background: none;
                    color: #f59e0b;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }

                .mobile-quick-edit-btn:active {
                    transform: scale(0.9);
                }

                .mobile-quick-edit-btn.active {
                    color: #10b981;
                }

                .mobile-quick-edit-btn .material-icons-round {
                    font-size: 24px;
                }

                .mpp-material-item-detailed.editing {
                    background: linear-gradient(135deg, #fffbeb 0%, #ffffff 100%);
                    border-left: 3px solid #f59e0b;
                }

                .m-quick-edit-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    margin-top: 12px;
                    padding: 12px;
                    background: white;
                    border-radius: 8px;
                    border: 1px solid #fde68a;
                }

                .m-edit-field {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .m-edit-field label {
                    font-size: 12px;
                    font-weight: 600;
                    color: #64748b;
                    min-width: 60px;
                }

                .mobile-quick-edit-input {
                    flex: 1;
                    padding: 10px 12px;
                    border: 1.5px solid #f59e0b;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 500;
                    text-align: center;
                    background: white;
                    color: #1e293b;
                }

                .mobile-quick-edit-input:focus {
                    outline: none;
                    border-color: #d97706;
                    background: #fffbeb;
                    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
                }

                .unit-label {
                    font-size: 13px;
                    font-weight: 600;
                    color: #64748b;
                    min-width: 30px;
                }

                /* Remove spinner arrows for mobile number inputs */
                .mobile-quick-edit-input::-webkit-outer-spin-button,
                .mobile-quick-edit-input::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }

                .mobile-quick-edit-input[type=number] {
                    -moz-appearance: textfield;
                }
            `}</style>
        </div>
    );
}
