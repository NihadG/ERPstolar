'use client';

import { useState, useMemo } from 'react';
import type { Project, WorkOrder } from '@/lib/types';

interface OverviewTabProps {
    projects: Project[];
    workOrders: WorkOrder[];
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

type GroupBy = 'none' | 'project' | 'productStatus' | 'materialStatus' | 'supplier';
type ViewMode = 'products' | 'materials' | 'both';

interface OverviewItem {
    type: 'product' | 'material';
    // Product fields
    Product_ID?: string;
    Product_Name?: string;
    Product_Status?: string;
    Product_Quantity?: number;
    // Material fields
    Material_ID?: string;
    Material_Name?: string;
    Material_Status?: string;
    Material_Quantity?: number;
    Material_Unit?: string;
    Material_Supplier?: string;
    // Common fields
    Project_ID: string;
    Project_Name: string;
    Client_Name: string;
    Deadline?: string;
}

export default function OverviewTab({ projects, workOrders, showToast }: OverviewTabProps) {
    const [groupBy, setGroupBy] = useState<GroupBy>('project');
    const [viewMode, setViewMode] = useState<ViewMode>('both');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);

    // Helper function to derive product status from work orders
    function getProductStatusFromWorkOrders(productId: string, workOrders: WorkOrder[]): string {
        // Find work order items for this product
        const workOrderItems = workOrders.flatMap(wo =>
            (wo.items || []).filter(item => item.Product_ID === productId)
        );

        if (workOrderItems.length === 0) {
            return 'Na čekanju'; // No work order yet
        }

        // Get the most recent work order item
        const latestItem = workOrderItems[workOrderItems.length - 1];

        // Check process assignments to determine current status
        const assignments = latestItem.Process_Assignments || {};
        const processes = Object.keys(assignments);

        if (processes.length === 0) {
            return 'Na čekanju';
        }

        // Check if all processes are completed
        const allCompleted = processes.every(proc => assignments[proc]?.Status === 'Završeno');
        if (allCompleted) {
            return 'Spremno';
        }

        // Find the current process being worked on
        const inProgressProcess = processes.find(proc => assignments[proc]?.Status === 'U toku');
        if (inProgressProcess) {
            return inProgressProcess; // Return the process name (e.g., "Rezanje", "Kantiranje")
        }

        // If some are completed but none in progress, return "U proizvodnji"
        const someCompleted = processes.some(proc => assignments[proc]?.Status === 'Završeno');
        if (someCompleted) {
            return 'U proizvodnji';
        }

        return 'Na čekanju';
    }

    // Aggregate all data
    const allItems = useMemo(() => {
        const items: OverviewItem[] = [];

        projects.forEach(project => {
            // Add products
            if (viewMode === 'products' || viewMode === 'both') {
                (project.products || []).forEach(product => {
                    // Derive actual status from work orders
                    const productStatus = getProductStatusFromWorkOrders(product.Product_ID, workOrders);

                    items.push({
                        type: 'product',
                        Product_ID: product.Product_ID,
                        Product_Name: product.Name,
                        Product_Status: productStatus,
                        Product_Quantity: product.Quantity,
                        Project_ID: project.Project_ID,
                        Project_Name: project.Client_Name,
                        Client_Name: project.Client_Name,
                        Deadline: project.Deadline,
                    });
                });
            }

            // Add materials
            if (viewMode === 'materials' || viewMode === 'both') {
                (project.products || []).forEach(product => {
                    (product.materials || []).forEach(material => {
                        items.push({
                            type: 'material',
                            Material_ID: material.ID,
                            Material_Name: material.Material_Name,
                            Material_Status: material.Status,
                            Material_Quantity: material.Quantity,
                            Material_Unit: material.Unit,
                            Material_Supplier: material.Supplier,
                            Product_ID: product.Product_ID,
                            Product_Name: product.Name,
                            Project_ID: project.Project_ID,
                            Project_Name: project.Client_Name,
                            Client_Name: project.Client_Name,
                            Deadline: project.Deadline,
                        });
                    });
                });
            }
        });

        return items;
    }, [projects, viewMode]);

    // Filter items
    const filteredItems = useMemo(() => {
        return allItems.filter(item => {
            // Search filter
            if (searchTerm.trim()) {
                const search = searchTerm.toLowerCase();
                const matchesSearch =
                    item.Client_Name.toLowerCase().includes(search) ||
                    item.Product_Name?.toLowerCase().includes(search) ||
                    item.Material_Name?.toLowerCase().includes(search);
                if (!matchesSearch) return false;
            }

            // Status filter
            if (statusFilter) {
                const status = item.type === 'product' ? item.Product_Status : item.Material_Status;
                if (status !== statusFilter) return false;
            }

            return true;
        });
    }, [allItems, searchTerm, statusFilter]);

    // Group items
    const groupedData = useMemo(() => {
        const groups = new Map<string, OverviewItem[]>();

        filteredItems.forEach(item => {
            let groupKey = '';

            switch (groupBy) {
                case 'project':
                    groupKey = item.Project_ID;
                    break;
                case 'productStatus':
                    groupKey = item.type === 'product' ? (item.Product_Status || 'Unknown') : 'N/A';
                    break;
                case 'materialStatus':
                    groupKey = item.type === 'material' ? (item.Material_Status || 'Unknown') : 'N/A';
                    break;
                case 'supplier':
                    groupKey = item.Material_Supplier || 'No Supplier';
                    break;
                default:
                    groupKey = 'all';
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(item);
        });

        return Array.from(groups.entries()).map(([key, items]) => ({
            groupKey: key,
            groupLabel: getGroupLabel(key, items[0]),
            items,
            count: items.length,
        }));
    }, [filteredItems, groupBy]);

    function getGroupLabel(key: string, firstItem?: OverviewItem): string {
        if (groupBy === 'project') {
            return firstItem?.Client_Name || key;
        }
        return key;
    }

    function toggleGroup(groupKey: string) {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    }

    function getStatusClass(status: string): string {
        const normalized = status.toLowerCase().replace(/\s+/g, '-');
        return 'status-' + normalized
            .replace(/č/g, 'c')
            .replace(/ć/g, 'c')
            .replace(/š/g, 's')
            .replace(/ž/g, 'z')
            .replace(/đ/g, 'd');
    }

    // Statistics
    const stats = useMemo(() => {
        const productItems = filteredItems.filter(i => i.type === 'product');
        const materialItems = filteredItems.filter(i => i.type === 'material');

        return {
            totalProducts: productItems.length,
            totalMaterials: materialItems.length,
            productsInProduction: productItems.filter(i => i.Product_Status === 'U proizvodnji').length,
            productsWaiting: productItems.filter(i => i.Product_Status === 'Na čekanju').length,
            materialsNotOrdered: materialItems.filter(i => i.Material_Status === 'Nije naručeno').length,
            materialsOrdered: materialItems.filter(i => i.Material_Status === 'Naručeno').length,
            materialsReceived: materialItems.filter(i => i.Material_Status === 'Primljeno').length,
        };
    }, [filteredItems]);

    return (
        <div className="tab-content active">
            {/* Header with controls */}
            <div className="overview-header">
                <div className="header-top">
                    <h2>Pregled Proizvodnje</h2>
                    <div className="header-stats">
                        <div className="stat-pill">
                            <span className="material-icons-round">inventory</span>
                            {stats.totalProducts} proizvoda
                        </div>
                        <div className="stat-pill">
                            <span className="material-icons-round">category</span>
                            {stats.totalMaterials} materijala
                        </div>
                    </div>
                </div>

                <div className="controls-row">
                    {/* View Mode */}
                    <div className="control-group">
                        <label>Prikaz:</label>
                        <div className="button-group">
                            <button
                                className={viewMode === 'both' ? 'active' : ''}
                                onClick={() => setViewMode('both')}
                            >
                                Sve
                            </button>
                            <button
                                className={viewMode === 'products' ? 'active' : ''}
                                onClick={() => setViewMode('products')}
                            >
                                Proizvodi
                            </button>
                            <button
                                className={viewMode === 'materials' ? 'active' : ''}
                                onClick={() => setViewMode('materials')}
                            >
                                Materijali
                            </button>
                        </div>
                    </div>

                    {/* Group By */}
                    <div className="control-group">
                        <label>Grupiši po:</label>
                        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                            <option value="none">Bez grupiranja</option>
                            <option value="project">Projektu</option>
                            <option value="productStatus">Statusu proizvoda</option>
                            <option value="materialStatus">Statusu materijala</option>
                            <option value="supplier">Dobavljaču</option>
                        </select>
                    </div>

                    {/* Search */}
                    <div className="search-box">
                        <span className="material-icons-round">search</span>
                        <input
                            type="text"
                            placeholder="Pretraži..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Quick stats badges */}
                <div className="quick-stats">
                    {stats.productsInProduction > 0 && (
                        <div className="stat-badge production">
                            <span className="material-icons-round">engineering</span>
                            {stats.productsInProduction} u proizvodnji
                        </div>
                    )}
                    {stats.productsWaiting > 0 && (
                        <div className="stat-badge waiting">
                            <span className="material-icons-round">schedule</span>
                            {stats.productsWaiting} čeka
                        </div>
                    )}
                    {stats.materialsNotOrdered > 0 && (
                        <div className="stat-badge alert">
                            <span className="material-icons-round">warning</span>
                            {stats.materialsNotOrdered} nije naručeno
                        </div>
                    )}
                    {stats.materialsOrdered > 0 && (
                        <div className="stat-badge ordered">
                            <span className="material-icons-round">local_shipping</span>
                            {stats.materialsOrdered} naručeno
                        </div>
                    )}
                </div>
            </div>

            {/* Grouped content */}
            <div className="overview-content">
                {groupedData.length === 0 ? (
                    <div className="empty-state">
                        <span className="material-icons-round">inbox</span>
                        <h3>Nema rezultata</h3>
                        <p>Pokušajte promijeniti filtere</p>
                    </div>
                ) : (
                    groupedData.map(group => (
                        <div key={group.groupKey} className="group-section">
                            <div
                                className="group-header"
                                onClick={() => toggleGroup(group.groupKey)}
                            >
                                <div className="group-info">
                                    <span className="material-icons-round">
                                        {collapsedGroups.has(group.groupKey) ? 'chevron_right' : 'expand_more'}
                                    </span>
                                    <h3>{group.groupLabel}</h3>
                                    <span className="group-count">{group.count}</span>
                                </div>
                            </div>

                            {!collapsedGroups.has(group.groupKey) && (
                                <div className="group-items">
                                    <div className="items-table">
                                        {/* Desktop Header */}
                                        <div className="table-header desktop-only">
                                            <div className="col-type">Tip</div>
                                            <div className="col-name">Naziv</div>
                                            <div className="col-qty">Kol.</div>
                                            <div className="col-unit">Jed.</div>
                                            <div className="col-project">Projekat</div>
                                            <div className="col-status">Status</div>
                                            <div className="col-details">Detalji</div>
                                        </div>

                                        {group.items.map((item, idx) => (
                                            <div key={idx} className="table-row">
                                                {/* Desktop Columns */}
                                                <div className="col-type desktop-only">
                                                    <span className={`type-badge ${item.type}`}>
                                                        <span className="material-icons-round">
                                                            {item.type === 'product' ? 'inventory_2' : 'category'}
                                                        </span>
                                                        {item.type === 'product' ? 'Proizvod' : 'Materijal'}
                                                    </span>
                                                </div>

                                                <div className="col-name">
                                                    <strong>
                                                        {item.type === 'product' ? item.Product_Name : item.Material_Name}
                                                    </strong>
                                                    {item.type === 'material' && item.Product_Name && (
                                                        <small>Za: {item.Product_Name}</small>
                                                    )}
                                                    {/* Mobile Only Meta */}
                                                    <div className="mobile-meta mobile-only">
                                                        <span>{item.Client_Name}</span>
                                                        <span className="dot">•</span>
                                                        <span className={`status-text status-${item.type === 'product' ? item.Product_Status?.toLowerCase().replace(/\s+/g, '-') : item.Material_Status?.toLowerCase().replace(/\s+/g, '-')}`}>
                                                            {item.type === 'product' ? item.Product_Status : item.Material_Status}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="col-qty text-right">
                                                    <span className="mobile-label mobile-only">Količina:</span>
                                                    <span className="qty-val">{item.type === 'material' ? item.Material_Quantity : (item.Product_Quantity || 1)}</span>
                                                </div>

                                                <div className="col-unit text-left">
                                                    <span className="unit-val">{item.type === 'material' ? (item.Material_Unit || 'kom') : 'kom'}</span>
                                                </div>

                                                <div className="col-project desktop-only">
                                                    <span>{item.Client_Name}</span>
                                                    {item.Deadline && (
                                                        <small className="deadline">
                                                            <span className="material-icons-round">event</span>
                                                            {new Date(item.Deadline).toLocaleDateString('hr')}
                                                        </small>
                                                    )}
                                                </div>

                                                <div className="col-status desktop-only">
                                                    <span className={`status-badge ${getStatusClass(
                                                        item.type === 'product' ? item.Product_Status! : item.Material_Status!
                                                    )}`}>
                                                        {item.type === 'product' ? item.Product_Status : item.Material_Status}
                                                    </span>
                                                </div>

                                                <div className="col-details">
                                                    {item.type === 'material' && item.Material_Supplier && (
                                                        <span className="detail-item supplier">
                                                            <span className="material-icons-round">store</span>
                                                            {item.Material_Supplier}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            <style jsx>{`
                .overview-header {
                    background: var(--background);
                    padding: 20px 24px;
                    border-bottom: 1px solid var(--border);
                    position: sticky;
                    top: 0;
                    z-index: 10;
                }

                .header-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }

                .header-top h2 {
                    font-size: 24px;
                    font-weight: 700;
                    margin: 0;
                }

                .header-stats {
                    display: flex;
                    gap: 12px;
                }

                .stat-pill {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: var(--surface);
                    border-radius: 20px;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-secondary);
                }

                .stat-pill .material-icons-round {
                    font-size: 18px;
                }

                .controls-row {
                    display: flex;
                    gap: 16px;
                    align-items: center;
                    flex-wrap: wrap;
                    margin-bottom: 16px;
                }

                .control-group {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .control-group label {
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-secondary);
                }

                .button-group {
                    display: flex;
                    background: var(--surface);
                    border-radius: 8px;
                    padding: 2px;
                }

                .button-group button {
                    padding: 6px 14px;
                    border: none;
                    background: transparent;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .button-group button.active {
                    background: var(--accent);
                    color: white;
                }

                .control-group select {
                    padding: 8px 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    font-size: 14px;
                    background: var(--surface);
                    cursor: pointer;
                }

                .search-box {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: var(--surface);
                    padding: 8px 14px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    flex: 1;
                    max-width: 300px;
                }

                .search-box .material-icons-round {
                    font-size: 20px;
                    color: var(--text-tertiary);
                }

                .search-box input {
                    border: none;
                    background: transparent;
                    outline: none;
                    flex: 1;
                    font-size: 14px;
                }

                .quick-stats {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }

                .stat-badge {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .stat-badge .material-icons-round {
                    font-size: 16px;
                }

                .stat-badge.production {
                    background: #e3f2fd;
                    color: #1976d2;
                }

                .stat-badge.waiting {
                    background: #fff3e0;
                    color: #f57c00;
                }

                .stat-badge.alert {
                    background: #ffebee;
                    color: #d32f2f;
                }

                .stat-badge.ordered {
                    background: #f3e5f5;
                    color: #7b1fa2;
                }

                .overview-content {
                    padding: 16px 24px;
                }

                .group-section {
                    background: var(--background);
                    border-radius: 12px;
                    margin-bottom: 16px;
                    overflow: hidden;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                }

                .group-header {
                    padding: 16px 20px;
                    background: var(--surface);
                    cursor: pointer;
                    border-bottom: 1px solid var(--border);
                    transition: background 0.2s;
                }

                .group-header:hover {
                    background: var(--surface-hover);
                }

                .group-info {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .group-info h3 {
                    font-size: 16px;
                    font-weight: 600;
                    margin: 0;
                    flex: 1;
                }

                .group-count {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 24px;
                    height: 24px;
                    padding: 0 8px;
                    background: var(--accent);
                    color: white;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .group-items {
                    padding: 0;
                }
                
                /* Responsive Table Layout */
                .items-table {
                    width: 100%;
                }

                .table-header {
                    display: grid;
                    grid-template-columns: 100px minmax(200px, 2fr) 70px 60px minmax(150px, 2.5fr) 130px minmax(150px, 1.5fr);
                    gap: 12px;
                    padding: 16px 24px;
                    align-items: center;
                    background: var(--surface);
                    border-bottom: 1px solid var(--border);
                    font-size: 11px;
                    font-weight: 700;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .table-row {
                    display: grid;
                    grid-template-columns: 100px minmax(200px, 2fr) 70px 60px minmax(150px, 2.5fr) 130px minmax(150px, 1.5fr);
                    gap: 12px;
                    padding: 16px 24px;
                    align-items: center;
                    border-bottom: 1px solid var(--border-light);
                    transition: background 0.15s;
                    font-size: 14px; /* Uniform base size */
                }

                .col-type {
                    display: flex;
                    align-items: center;
                }

                .col-qty { 
                    font-size: 14px;
                    font-weight: 500; 
                    font-variant-numeric: tabular-nums; 
                    color: var(--text-primary);
                    text-align: right;
                }
                
                .col-unit { 
                    font-size: 14px;
                    color: var(--text-secondary); 
                    text-align: left;
                    padding-left: 4px;
                }

                /* Header alignments must match row alignments */
                .table-header .col-qty { 
                    text-align: right; 
                    font-size: 11px;
                    font-weight: 700;
                }
                
                .table-header .col-unit { 
                    text-align: left; 
                    padding-left: 4px;
                    font-size: 11px;
                    font-weight: 700;
                }
                
                /* Ensure other text columns align left */
                .col-name, .col-project, .col-details { text-align: left; }
                
                /* Mobile Components Hidden by Default */
                .mobile-only { display: none; }
                
                /* Mobile Responsive Styles */
                @media (max-width: 1100px) {
                    .desktop-only { display: none !important; }
                    .mobile-only { display: block; }
                    
                    .items-table {
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                    }
                    
                    .table-header { display: none; }
                    
                    .table-row {
                        display: flex;
                        flex-direction: column;
                        align-items: flex-start;
                        padding: 16px;
                        gap: 12px;
                        background: var(--surface);
                        border: 1px solid var(--border-light);
                        border-radius: 12px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
                        font-size: 15px; 
                    }
                    
                    /* Mobile Card Internal Layout */
                    .col-name {
                        width: 100%;
                        margin-bottom: 4px;
                        order: 1; 
                    }
                    
                    .col-name strong {
                        font-size: 16px;
                        margin-bottom: 6px;
                        color: var(--text-primary);
                        display: block;
                    }

                    .mobile-meta {
                        display: flex;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 8px;
                        font-size: 13px;
                        color: var(--text-secondary);
                    }
                    
                    .col-qty, .col-unit {
                        text-align: left;
                        display: inline-block;
                        width: auto;
                        padding: 0;
                        margin: 0;
                    }
                    
                    .col-qty {
                        font-size: 14px;
                        margin-right: 4px;
                        order: 2;
                    }
                    
                    .col-unit {
                        font-size: 14px;
                        order: 3;
                        display: inline-block;
                    }
                    
                    .col-details {
                        order: 4;
                        width: 100%;
                        margin-top: 4px;
                        font-size: 13px;
                    }
                }

                .table-row {
                    border-bottom: 1px solid var(--border-light);
                    transition: background 0.15s;
                }

                .table-row:last-child {
                    border-bottom: none;
                }

                .table-row:hover {
                    background: var(--surface);
                }

                .type-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                }

                .type-badge.product {
                    background: #e3f2fd;
                    color: #1976d2;
                }

                .type-badge.material {
                    background: #f3e5f5;
                    color: #7b1fa2;
                }

                .type-badge .material-icons-round {
                    font-size: 14px;
                }

                .col-name strong {
                    display: block;
                    font-size: 14px;
                    font-weight: 500;
                    margin-bottom: 2px;
                }

                .col-name small {
                    display: block;
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .col-project span {
                    display: block;
                    font-size: 13px;
                }

                .col-project small {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    color: var(--text-tertiary);
                    margin-top: 4px;
                }

                .col-project small .material-icons-round {
                    font-size: 12px;
                }

                .status-badge {
                    display: inline-flex;
                    padding: 4px 12px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                }

                .status-u-proizvodnji { background: #e3f2fd; color: #1976d2; }
                .status-na-cekanju { background: #fff3e0; color: #f57c00; }
                .status-spremno { background: #e8f5e9; color: #388e3c; }
                .status-instalirano { background: #f3e5f5; color: #7b1fa2; }
                .status-nije-naruceno { background: #ffebee; color: #d32f2f; }
                .status-naruceno { background: #fff3e0; color: #f57c00; }
                .status-primljeno { background: #e8f5e9; color: #388e3c; }
                .status-u-upotrebi { background: #e3f2fd; color: #1976d2; }

                .col-details {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .detail-item {
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .detail-item.supplier {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .detail-item .material-icons-round {
                    font-size: 14px;
                }

                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    color: var(--text-tertiary);
                }

                .empty-state .material-icons-round {
                    font-size: 64px;
                    margin-bottom: 16px;
                    opacity: 0.4;
                }

                .empty-state h3 {
                    margin: 0 0 8px 0;
                    font-size: 18px;
                }

                .empty-state p {
                    margin: 0;
                    font-size: 14px;
                }

                /* Mobile Specific Styles */
                .mobile-filter-toggle {
                    display: none;
                }
                
                .mobile-filters-summary {
                    display: none;
                }

                /* Responsive Design */
                @media (max-width: 1200px) {
                    .table-header,
                    .table-row {
                        grid-template-columns: 100px 1.5fr 1fr 130px 1fr;
                    }
                }

                @media (max-width: 900px) {
                    .overview-header {
                        padding: 16px;
                    }

                    .overview-title-bar {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 12px;
                    }

                    .mobile-filter-toggle {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        padding: 6px 12px;
                        background: var(--surface);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        font-size: 13px;
                        font-weight: 600;
                        color: var(--text-primary);
                        cursor: pointer;
                    }

                    .mobile-filters-summary {
                        display: flex;
                        gap: 8px;
                        overflow-x: auto;
                        padding-bottom: 4px;
                        margin-bottom: 12px;
                    }

                    .summary-pill {
                        font-size: 12px;
                        padding: 4px 10px;
                        background: var(--surface);
                        border-radius: 12px;
                        color: var(--text-secondary);
                        white-space: nowrap;
                        border: 1px solid var(--border-light);
                    }

                    .summary-pill.active {
                        background: var(--accent-light);
                        color: var(--accent);
                        border-color: var(--accent-light);
                    }

                    .overview-controls {
                        display: none; /* Hidden by default on mobile */
                    }

                    .overview-controls.open {
                        display: flex; /* Show when open */
                        flex-direction: column;
                        gap: 12px;
                        margin-bottom: 16px;
                        padding-top: 12px;
                        border-top: 1px solid var(--border-light);
                        animation: slideDown 0.2s ease-out;
                    }

                    @keyframes slideDown {
                        from { opacity: 0; transform: translateY(-10px); }
                        to { opacity: 1; transform: translateY(0); }
                    }

                    .header-top {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 12px;
                        margin-bottom: 16px;
                    }

                    .header-stats {
                        flex-direction: column;
                        width: 100%;
                        gap: 8px;
                    }

                    .stat-pill {
                        font-size: 13px;
                        padding: 6px 12px;
                    }

                    .controls-row {
                        flex-direction: column;
                        align-items: stretch;
                        gap: 12px;
                        margin-bottom: 12px;
                    }

                    .control-group {
                        flex-direction: column;
                        align-items: stretch;
                        gap: 6px;
                    }

                    .control-group label {
                        font-size: 12px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }

                    .search-box {
                        max-width: 100%;
                    }

                    .button-group {
                        width: 100%;
                    }

                    .button-group button {
                        flex: 1;
                    }

                    .quick-stats {
                        flex-direction: column;
                        gap: 8px;
                    }

                    .stat-badge {
                        justify-content: flex-start;
                        padding: 8px 12px;
                    }

                    .table-header {
                        display: none;
                    }

                    .table-row {
                        grid-template-columns: 1fr;
                        gap: 8px;
                        padding: 16px 20px;
                    }

                    .col-type,
                    .col-name,
                    .col-project,
                    .col-status,
                    .col-details {
                        display: flex;
                        flex-direction: column;
                    }
                }

                @media (max-width: 600px) {
                    .overview-header {
                        padding: 12px;
                    }

                    .header-top h2 {
                        font-size: 20px;
                    }

                    .controls-row {
                        gap: 10px;
                    }

                    .overview-content {
                        padding: 12px;
                    }

                    .group-section {
                        margin-bottom: 12px;
                    }
                }
            `}</style>
        </div>
    );
}
