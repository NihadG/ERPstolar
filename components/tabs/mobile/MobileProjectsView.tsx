'use client';

import React, { useState, useMemo } from 'react';
import type { Project, Material, WorkOrder, Offer, WorkLog, Product, ProductMaterial } from '@/lib/types';
import { PROJECT_STATUSES } from '@/lib/types';
import { sortProductsByName } from '@/lib/sortProducts';

interface MobileProjectsViewProps {
    projects: Project[];
    materials: Material[];
    workOrders: WorkOrder[];
    offers?: Offer[];
    workLogs?: WorkLog[];
    onRefresh: (...collections: string[]) => void;
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
    onToggleHidden?: (project: Project) => void;
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
    onUpdateMaterial,
    onToggleHidden
}: MobileProjectsViewProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
    const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
    const [showHidden, setShowHidden] = useState(false);

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

    // Prirodni + hijerarhijski poredak naziva (Poz 1 < Poz 1.1 < Poz 2 < Poz 10, E1 < E2 < E10) —
    // zajednički util, isti kao na desktopu (OffersTab) i data-sloju.
    function sortProductsByPosition(products: Product[]): Product[] {
        return sortProductsByName(products, p => p.Name || '');
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

    const hiddenCount = projects.filter(p => p.Hidden).length;

    const filteredProjects = useMemo(() => {
        let result = projects.filter(project => {
            // Hide hidden projects unless showHidden is on
            if (!showHidden && project.Hidden) return false;
            if (showHidden && !project.Hidden) return false;

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
    }, [projects, searchTerm, statusFilter, isInFocusMode, expandedProjectId, showHidden]);

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
            {/* Main FAB for adding projects */}
            {!isInFocusMode && (
                <button className="mobile-fab" onClick={() => onOpenProjectModal()}>
                    <span className="material-icons-round">add</span>
                </button>
            )}

            {/* Mobile Toolbar */}
            <div className="mobile-toolbar">
                <div className="mobile-search">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Traži projekte..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
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
                    <button
                        className={`filter-pill archive-pill ${showHidden ? 'active' : ''}`}
                        onClick={() => setShowHidden(!showHidden)}
                    >
                        <span className="material-icons-round" style={{ fontSize: '15px' }}>{showHidden ? 'inventory_2' : 'archive'}</span>
                        Arhiva{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
                    </button>
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
                                    <h3 className="mp-client">{project.Name || project.Client_Name}</h3>
                                    <span
                                        className="mp-status-badge"
                                        style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}
                                    >
                                        {project.Status}
                                    </span>
                                </div>
                                {project.Name && <div className="mp-subtitle">{project.Client_Name}</div>}
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
                                {onToggleHidden && (
                                    <button className={`mp-action-btn archive-action ${project.Hidden ? 'is-hidden' : ''}`} onClick={() => onToggleHidden(project)} title={project.Hidden ? 'Vrati iz arhive' : 'Arhiviraj'}>
                                        <span className="material-icons-round">{project.Hidden ? 'unarchive' : 'archive'}</span>
                                    </button>
                                )}
                                <button className="mp-action-btn danger-text" onClick={() => onDeleteProject(project.Project_ID)}>
                                    <span className="material-icons-round">delete</span>
                                </button>
                            </div>
                        </div>
                    );
                })}

                {filteredProjects.length === 0 && (
                    <div className="mobile-empty-state">
                        <span className="material-icons-round">{showHidden ? 'inventory_2' : 'folder_off'}</span>
                        <p>{showHidden ? 'Nema arhiviranih projekata' : 'Nema pronađenih projekata'}</p>
                    </div>
                )}
            </div>

            <style jsx>{`
                .mobile-projects-view {
                    padding-bottom: 90px; /* Space for FAB */
                    position: relative;
                    min-height: 100%;
                }

                /* Floating Action Button */
                .mobile-fab {
                    position: fixed;
                    bottom: 80px; /* Above bottom nav */
                    right: 20px;
                    width: 56px;
                    height: 56px;
                    border-radius: 28px;
                    background: linear-gradient(135deg, #007aff 0%, #005bb5 100%);
                    color: white;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 8px 24px rgba(0, 122, 255, 0.4);
                    z-index: 100;
                    transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.2s;
                }
                
                .mobile-fab:active {
                    transform: scale(0.92);
                    box-shadow: 0 4px 12px rgba(0, 122, 255, 0.3);
                }
                
                .mobile-fab .material-icons-round {
                    font-size: 28px;
                }

                .mobile-toolbar {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 16px;
                    position: sticky;
                    top: 0;
                    z-index: 50;
                    background: rgba(245, 245, 247, 0.8);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    padding: 8px 0;
                    margin-top: -8px;
                }

                .mobile-search {
                    flex: 1;
                    height: 48px;
                    background: #ffffff;
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.03);
                    border: 1px solid rgba(0,0,0,0.05);
                }

                .mobile-search .material-icons-round {
                    color: #86868b;
                }

                .mobile-search input {
                    border: none;
                    background: transparent;
                    width: 100%;
                    height: 100%;
                    margin-left: 10px;
                    font-size: 16px;
                    outline: none;
                    color: #1d1d1f;
                    font-weight: 500;
                }
                
                .mobile-search input::placeholder {
                    color: #86868b;
                }

                /* Focus Mode Back Button */
                .focus-back-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px 16px;
                    background: rgba(0, 122, 255, 0.1);
                    border: none;
                    border-radius: 16px;
                    font-size: 15px;
                    font-weight: 600;
                    color: #007aff;
                    margin-bottom: 16px;
                    transition: transform 0.2s, background 0.2s;
                }
                
                .focus-back-btn:active {
                    transform: scale(0.97);
                    background: rgba(0, 122, 255, 0.15);
                }
                
                .focus-back-btn .material-icons-round {
                    font-size: 20px;
                }
                
                .focus-back-btn.small {
                    padding: 8px 12px;
                    font-size: 13px;
                    margin-bottom: 12px;
                    border-radius: 12px;
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
                    background: rgba(0, 122, 255, 0.1);
                    color: #007aff;
                    border: none;
                    padding: 0;
                    border-radius: 10px;
                    transition: all 0.2s;
                }
                
                .mobile-add-tiny-btn:active {
                    background: rgba(0, 122, 255, 0.2);
                    transform: scale(0.95);
                }

                .mobile-add-tiny-btn .material-icons-round {
                    font-size: 18px;
                }

                .filter-scroll {
                    display: flex;
                    gap: 8px;
                    overflow-x: auto;
                    padding-bottom: 8px; 
                    margin-bottom: 16px;
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
                    border: 1px solid rgba(0,0,0,0.05);
                    background: #ffffff;
                    color: #86868b;
                    font-size: 14px;
                    font-weight: 600;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.02);
                    transition: all 0.2s;
                }

                .filter-pill.active {
                    background: #1d1d1f;
                    color: #ffffff;
                    border-color: #1d1d1f;
                }

                .mobile-list {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .mobile-project-card {
                    background: #ffffff;
                    border-radius: 24px;
                    padding: 20px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.04);
                    border: 1px solid rgba(0,0,0,0.02);
                    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                }
                
                .mobile-project-card.expanded {
                    border: 1px solid rgba(0, 122, 255, 0.3);
                    box-shadow: 0 8px 30px rgba(0, 122, 255, 0.1);
                }

                .mp-header {
                    margin-bottom: 16px;
                }

                .mp-title-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 6px;
                }

                .mp-client {
                    font-size: 20px;
                    font-weight: 700;
                    margin: 0;
                    color: #1d1d1f;
                    line-height: 1.2;
                }

                .mp-status-badge {
                    font-size: 11px;
                    font-weight: 700;
                    padding: 4px 10px;
                    border-radius: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .mp-subtitle {
                    color: #515154;
                    font-size: 15px;
                    font-weight: 500;
                }

                .mp-address {
                    color: #86868b;
                    font-size: 14px;
                    margin-top: 4px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .mp-stats {
                    padding: 12px 16px;
                    background: #f5f5f7;
                    border-radius: 16px;
                    margin-bottom: 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .mp-stat-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    color: #1d1d1f;
                }

                .mp-stat-item .material-icons-round {
                    font-size: 20px;
                    color: #007aff;
                    background: #ffffff;
                    padding: 6px;
                    border-radius: 10px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
                }
                
                .chevron {
                    color: #86868b;
                    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                    background: #ffffff;
                    border-radius: 50%;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
                }
                
                .mobile-project-card.expanded .chevron {
                    transform: rotate(180deg);
                    color: #007aff;
                }
                
                .mp-products-section {
                    margin-bottom: 16px;
                    background: transparent;
                }
                
                .label-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    font-size: 14px;
                    font-weight: 700;
                    color: #1d1d1f;
                    padding-left: 4px;
                }
                
                .mp-products-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                
                .mp-product-card {
                    background: #ffffff;
                    border-radius: 16px;
                    padding: 16px;
                    border: 1px solid rgba(0,0,0,0.06);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.02);
                    transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
                }
                
                .mp-product-card.expanded {
                    border-color: #007aff;
                    box-shadow: 0 4px 16px rgba(0, 122, 255, 0.08);
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
                    gap: 6px;
                    margin-left: 12px;
                }
                
                .mini-btn {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    background: #f5f5f7;
                    border-radius: 10px;
                    color: #515154;
                    transition: all 0.2s;
                }
                
                .mini-btn:active {
                    transform: scale(0.92);
                    background: #e5e5ea;
                }

                .mini-btn.danger {
                    color: #ff3b30;
                    background: rgba(255, 59, 48, 0.1);
                }
                
                .mini-btn.danger:active {
                    background: rgba(255, 59, 48, 0.2);
                }

                .mini-btn .material-icons-round {
                    font-size: 18px;
                }

                .mpp-name {
                    display: block;
                    font-weight: 700;
                    color: #1d1d1f;
                    font-size: 15px;
                    margin-bottom: 4px;
                }
                
                .mpp-qty {
                    background: rgba(0, 122, 255, 0.1);
                    color: #007aff;
                    padding: 2px 8px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 700;
                    display: inline-block;
                }
                
                .mpp-dims {
                    font-size: 13px;
                    color: #86868b;
                    margin-bottom: 12px;
                    margin-top: 6px;
                    font-weight: 500;
                }
                
                .mpp-materials-summary {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #515154;
                    margin-top: 12px;
                    padding: 12px;
                    background: #f5f5f7;
                    border-radius: 12px;
                }

                /* Expanded Materials */
                .mpp-expanded-materials {
                    margin-top: 16px;
                    padding-top: 16px;
                    border-top: 1px solid rgba(0,0,0,0.06);
                }
                
                .mpp-mat-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    font-size: 13px;
                    font-weight: 700;
                    color: #86868b;
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
                    padding: 12px;
                    background: #fcfcfd;
                    border-radius: 12px;
                    border: 1px solid rgba(0,0,0,0.04);
                }
                
                .m-info {
                    flex: 1;
                    font-size: 13px;
                }
                
                .m-name {
                    display: block;
                    font-weight: 600;
                    color: #1d1d1f;
                    margin-bottom: 4px;
                }
                
                .m-detail {
                    display: block;
                    color: #86868b;
                    font-size: 12px;
                    font-weight: 500;
                }
                
                .m-total {
                    display: block;
                    margin-top: 4px;
                    color: #34c759;
                    font-size: 12px;
                    font-weight: 600;
                }
                
                .m-actions {
                    display: flex;
                    gap: 6px;
                    margin-left: 8px;
                }
                
                .mp-no-data, .mp-no-products {
                    text-align: center;
                    font-size: 14px;
                    font-weight: 500;
                    color: #86868b;
                    padding: 16px;
                    background: #f5f5f7;
                    border-radius: 12px;
                }
                
                .mp-actions {
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                    margin-top: 16px;
                    padding-top: 16px;
                    border-top: 1px solid rgba(0,0,0,0.04);
                }

                .mp-action-btn {
                    width: 44px;
                    height: 44px;
                    padding: 0;
                    border: none;
                    background: #f5f5f7;
                    border-radius: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #515154;
                    transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
                }
                
                .mp-action-btn:active {
                    transform: scale(0.92);
                    background: #e5e5ea;
                }

                .mp-action-btn.primary {
                    background: rgba(0, 122, 255, 0.1);
                    color: #007aff;
                }
                
                .mp-action-btn.primary:active {
                    background: rgba(0, 122, 255, 0.2);
                }

                .mp-action-btn.danger-text {
                    color: #ff3b30;
                    background: rgba(255, 59, 48, 0.1);
                }
                
                .mp-action-btn.danger-text:active {
                    background: rgba(255, 59, 48, 0.2);
                }

                .mp-action-btn .material-icons-round {
                    font-size: 22px;
                }

                /* Archive Filter Pill */
                .filter-pill.archive-pill {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: #fffbeb;
                    border-color: #fde68a;
                    color: #92400e;
                }

                .filter-pill.archive-pill.active {
                    background: linear-gradient(135deg, #f59e0b, #d97706);
                    border-color: #b45309;
                    color: #ffffff;
                }

                .filter-pill.archive-pill .material-icons-round {
                    color: inherit;
                }

                /* Archive Action Button on Cards */
                .mp-action-btn.archive-action {
                    background: rgba(245, 158, 11, 0.1);
                    color: #d97706;
                }

                .mp-action-btn.archive-action:active {
                    background: rgba(245, 158, 11, 0.2);
                    transform: scale(0.92);
                }

                .mp-action-btn.archive-action.is-hidden {
                    background: rgba(5, 150, 105, 0.1);
                    color: #059669;
                }

                .mp-action-btn.archive-action.is-hidden:active {
                    background: rgba(5, 150, 105, 0.2);
                }

                /* Mobile Quick Edit Styles */
                .mobile-quick-edit-btn {
                    padding: 0;
                    background: none;
                    color: #ff9500;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }

                .mobile-quick-edit-btn:active {
                    transform: scale(0.85);
                }

                .mobile-quick-edit-btn.active {
                    color: #34c759;
                }

                .mobile-quick-edit-btn .material-icons-round {
                    font-size: 24px;
                }

                .mpp-material-item-detailed.editing {
                    background: #fffcf2;
                    border: 1px solid #ffcc00;
                }

                .m-quick-edit-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    margin-top: 12px;
                    padding: 12px;
                    background: #ffffff;
                    border-radius: 10px;
                    border: 1px solid rgba(255, 149, 0, 0.3);
                }

                .m-edit-field {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .m-edit-field label {
                    font-size: 13px;
                    font-weight: 600;
                    color: #515154;
                    min-width: 60px;
                }

                .mobile-quick-edit-input {
                    flex: 1;
                    padding: 12px;
                    border: 1px solid #e5e5ea;
                    border-radius: 10px;
                    font-size: 16px;
                    font-weight: 600;
                    text-align: center;
                    background: #f9f9f9;
                    color: #1d1d1f;
                    transition: all 0.2s;
                }

                .mobile-quick-edit-input:focus {
                    outline: none;
                    border-color: #ff9500;
                    background: #ffffff;
                    box-shadow: 0 0 0 3px rgba(255, 149, 0, 0.15);
                }

                .unit-label {
                    font-size: 14px;
                    font-weight: 600;
                    color: #86868b;
                    min-width: 30px;
                }

                .mobile-quick-edit-input::-webkit-outer-spin-button,
                .mobile-quick-edit-input::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }

                .mobile-quick-edit-input[type=number] {
                    -moz-appearance: textfield;
                }
                
                .mobile-empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 40px 20px;
                    text-align: center;
                    color: #86868b;
                }
                
                .mobile-empty-state .material-icons-round {
                    font-size: 48px;
                    margin-bottom: 16px;
                    color: #d1d1d6;
                }
                
                .mobile-empty-state p {
                    font-size: 16px;
                    font-weight: 500;
                }
            `}</style>
        </div>
    );
}
