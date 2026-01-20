'use client';

import { useState, useMemo } from 'react';
import Modal from '@/components/ui/Modal';
import type { Project, Material } from '@/lib/types';
import { MATERIAL_CATEGORIES } from '@/lib/types';

interface MaterialReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: Project | null;
    allMaterials: Material[];
}

type ViewMode = 'detailed' | 'summary';
type GroupByOption = 'none' | 'category' | 'supplier';
type SortByOption = 'name' | 'quantity' | 'total' | 'category';

interface MaterialItem {
    materialId: string;
    materialName: string;
    category: string;
    supplier: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    status: string;
    productName: string;
    productId: string;
}

interface SummarizedMaterial {
    materialId: string;
    materialName: string;
    category: string;
    supplier: string;
    unit: string;
    totalQuantity: number;
    avgUnitPrice: number;
    totalPrice: number;
    productCount: number;
    products: string[];
    statuses: string[];
}

export default function MaterialReportModal({ isOpen, onClose, project, allMaterials }: MaterialReportModalProps) {
    const [viewMode, setViewMode] = useState<ViewMode>('summary');
    const [groupBy, setGroupBy] = useState<GroupByOption>('category');
    const [sortBy, setSortBy] = useState<SortByOption>('name');
    const [sortDesc, setSortDesc] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');

    // Gather all materials from all products
    const allProjectMaterials = useMemo(() => {
        if (!project || !project.products) return [];

        const materials: MaterialItem[] = [];
        project.products.forEach(product => {
            if (!product.materials) return;
            product.materials.forEach(mat => {
                const originalMaterial = allMaterials.find(m => m.Material_ID === mat.Material_ID);
                const category = originalMaterial?.Category || 'Ostalo';

                materials.push({
                    materialId: mat.Material_ID,
                    materialName: mat.Material_Name,
                    category,
                    supplier: mat.Supplier || '-',
                    unit: mat.Unit,
                    quantity: mat.Quantity * (product.Quantity || 1),
                    unitPrice: mat.Unit_Price,
                    totalPrice: mat.Total_Price * (product.Quantity || 1),
                    status: mat.Status,
                    productName: product.Name,
                    productId: product.Product_ID,
                });
            });
        });
        return materials;
    }, [project, allMaterials]);

    // Summarize materials by name (aggregate same materials)
    const summarizedMaterials = useMemo(() => {
        const summary: Record<string, SummarizedMaterial> = {};

        allProjectMaterials.forEach(mat => {
            const key = `${mat.materialId}-${mat.unit}`;
            if (!summary[key]) {
                summary[key] = {
                    materialId: mat.materialId,
                    materialName: mat.materialName,
                    category: mat.category,
                    supplier: mat.supplier,
                    unit: mat.unit,
                    totalQuantity: 0,
                    avgUnitPrice: mat.unitPrice,
                    totalPrice: 0,
                    productCount: 0,
                    products: [],
                    statuses: [],
                };
            }
            summary[key].totalQuantity += mat.quantity;
            summary[key].totalPrice += mat.totalPrice;
            summary[key].productCount++;
            if (!summary[key].products.includes(mat.productName)) {
                summary[key].products.push(mat.productName);
            }
            if (!summary[key].statuses.includes(mat.status)) {
                summary[key].statuses.push(mat.status);
            }
        });

        return Object.values(summary);
    }, [allProjectMaterials]);

    // Filter
    const filteredDetailed = useMemo(() => {
        return allProjectMaterials.filter(mat => {
            const matchesSearch = !searchTerm ||
                mat.materialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                mat.productName.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = !categoryFilter || mat.category === categoryFilter;
            return matchesSearch && matchesCategory;
        });
    }, [allProjectMaterials, searchTerm, categoryFilter]);

    const filteredSummary = useMemo(() => {
        return summarizedMaterials.filter(mat => {
            const matchesSearch = !searchTerm ||
                mat.materialName.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = !categoryFilter || mat.category === categoryFilter;
            return matchesSearch && matchesCategory;
        });
    }, [summarizedMaterials, searchTerm, categoryFilter]);

    // Sort
    const sortedDetailed = useMemo(() => {
        return [...filteredDetailed].sort((a, b) => {
            let cmp = 0;
            switch (sortBy) {
                case 'name': cmp = a.materialName.localeCompare(b.materialName); break;
                case 'quantity': cmp = a.quantity - b.quantity; break;
                case 'total': cmp = a.totalPrice - b.totalPrice; break;
                case 'category': cmp = a.category.localeCompare(b.category); break;
            }
            return sortDesc ? -cmp : cmp;
        });
    }, [filteredDetailed, sortBy, sortDesc]);

    const sortedSummary = useMemo(() => {
        return [...filteredSummary].sort((a, b) => {
            let cmp = 0;
            switch (sortBy) {
                case 'name': cmp = a.materialName.localeCompare(b.materialName); break;
                case 'quantity': cmp = a.totalQuantity - b.totalQuantity; break;
                case 'total': cmp = a.totalPrice - b.totalPrice; break;
                case 'category': cmp = a.category.localeCompare(b.category); break;
            }
            return sortDesc ? -cmp : cmp;
        });
    }, [filteredSummary, sortBy, sortDesc]);

    // Group for summary view
    const groupedSummary = useMemo(() => {
        if (groupBy === 'none') return { '': sortedSummary };

        const groups: Record<string, SummarizedMaterial[]> = {};
        sortedSummary.forEach(mat => {
            const key = groupBy === 'category' ? mat.category : mat.supplier;
            if (!groups[key]) groups[key] = [];
            groups[key].push(mat);
        });

        const sorted: Record<string, SummarizedMaterial[]> = {};
        Object.keys(groups).sort().forEach(k => sorted[k] = groups[k]);
        return sorted;
    }, [sortedSummary, groupBy]);

    // Totals
    const grandTotal = useMemo(() => ({
        uniqueMaterials: summarizedMaterials.length,
        totalItems: allProjectMaterials.length,
        price: allProjectMaterials.reduce((s, m) => s + m.totalPrice, 0)
    }), [summarizedMaterials, allProjectMaterials]);

    function formatCurrency(n: number): string {
        return n.toFixed(2) + ' KM';
    }

    function formatQty(qty: number, unit: string): string {
        return `${qty % 1 === 0 ? qty : qty.toFixed(2)} ${unit}`;
    }

    function handleSort(col: SortByOption) {
        if (sortBy === col) setSortDesc(!sortDesc);
        else { setSortBy(col); setSortDesc(false); }
    }

    function getWorstStatus(statuses: string[]): string {
        if (statuses.includes('Nije naručeno')) return 'pending';
        if (statuses.includes('Naručeno')) return 'progress';
        return 'done';
    }

    if (!project) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Materijali - ${project.Client_Name}`}
            size="xl"
            footer={<button className="btn btn-secondary" onClick={onClose}>Zatvori</button>}
        >
            <div className="material-report-v2">
                {/* Toolbar */}
                <div className="report-toolbar">
                    <div className="view-toggle">
                        <button
                            className={`toggle-btn ${viewMode === 'summary' ? 'active' : ''}`}
                            onClick={() => setViewMode('summary')}
                        >
                            <span className="material-icons-round">functions</span>
                            Sumirano
                        </button>
                        <button
                            className={`toggle-btn ${viewMode === 'detailed' ? 'active' : ''}`}
                            onClick={() => setViewMode('detailed')}
                        >
                            <span className="material-icons-round">list</span>
                            Detaljno
                        </button>
                    </div>

                    <div className="search-box">
                        <span className="material-icons-round">search</span>
                        <input
                            type="text"
                            placeholder="Pretraži..."
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
                        {MATERIAL_CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>

                    {viewMode === 'summary' && (
                        <select
                            className="filter-select"
                            value={groupBy}
                            onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
                        >
                            <option value="none">Bez grupiranja</option>
                            <option value="category">Po kategoriji</option>
                            <option value="supplier">Po dobavljaču</option>
                        </select>
                    )}

                    <div className="toolbar-stats">
                        <span>{grandTotal.uniqueMaterials} vrsta</span>
                        <span>{grandTotal.totalItems} stavki</span>
                        <span className="total-value">{formatCurrency(grandTotal.price)}</span>
                    </div>
                </div>

                {/* Table */}
                <div className="report-table-container">
                    {viewMode === 'summary' ? (
                        <table className="report-table">
                            <thead>
                                <tr>
                                    <th className={`sortable ${sortBy === 'name' ? 'active' : ''}`} onClick={() => handleSort('name')}>
                                        Materijal {sortBy === 'name' && <span className="sort-icon">{sortDesc ? '↓' : '↑'}</span>}
                                    </th>
                                    <th className={`sortable ${sortBy === 'category' ? 'active' : ''}`} onClick={() => handleSort('category')}>
                                        Kategorija {sortBy === 'category' && <span className="sort-icon">{sortDesc ? '↓' : '↑'}</span>}
                                    </th>
                                    <th>Dobavljač</th>
                                    <th className={`sortable text-right ${sortBy === 'quantity' ? 'active' : ''}`} onClick={() => handleSort('quantity')}>
                                        Ukupna količina {sortBy === 'quantity' && <span className="sort-icon">{sortDesc ? '↓' : '↑'}</span>}
                                    </th>
                                    <th className="text-right">Jed. cijena</th>
                                    <th className={`sortable text-right ${sortBy === 'total' ? 'active' : ''}`} onClick={() => handleSort('total')}>
                                        Ukupno {sortBy === 'total' && <span className="sort-icon">{sortDesc ? '↓' : '↑'}</span>}
                                    </th>
                                    <th>Proizvodi</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.keys(groupedSummary).length === 0 ? (
                                    <tr><td colSpan={8} className="empty-row">Nema materijala</td></tr>
                                ) : (
                                    Object.entries(groupedSummary).map(([groupName, items]) => (
                                        <>
                                            {groupBy !== 'none' && (
                                                <tr key={`g-${groupName}`} className="group-row">
                                                    <td colSpan={5}>
                                                        <strong>{groupName}</strong>
                                                        <span className="group-count">{items.length} vrsta materijala</span>
                                                    </td>
                                                    <td colSpan={3} className="group-total">
                                                        {formatCurrency(items.reduce((s, m) => s + m.totalPrice, 0))}
                                                    </td>
                                                </tr>
                                            )}
                                            {items.map((mat, i) => (
                                                <tr key={`${mat.materialId}-${i}`}>
                                                    <td className="cell-name">
                                                        {mat.materialName}
                                                        {mat.productCount > 1 && (
                                                            <span className="occurrence-badge">{mat.productCount}×</span>
                                                        )}
                                                    </td>
                                                    <td><span className="category-tag">{mat.category}</span></td>
                                                    <td className="cell-supplier">{mat.supplier}</td>
                                                    <td className="cell-qty text-right">
                                                        <strong>{formatQty(mat.totalQuantity, mat.unit)}</strong>
                                                    </td>
                                                    <td className="text-right">{formatCurrency(mat.avgUnitPrice)}</td>
                                                    <td className="cell-total text-right">{formatCurrency(mat.totalPrice)}</td>
                                                    <td className="cell-products">
                                                        {mat.products.length <= 2
                                                            ? mat.products.join(', ')
                                                            : `${mat.products.slice(0, 2).join(', ')} +${mat.products.length - 2}`
                                                        }
                                                    </td>
                                                    <td className="cell-status">
                                                        <span className={`status-dot ${getWorstStatus(mat.statuses)}`}></span>
                                                        {mat.statuses.length === 1 ? mat.statuses[0] : 'Razno'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </>
                                    ))
                                )}
                            </tbody>
                        </table>
                    ) : (
                        <table className="report-table">
                            <thead>
                                <tr>
                                    <th className={`sortable ${sortBy === 'name' ? 'active' : ''}`} onClick={() => handleSort('name')}>
                                        Materijal {sortBy === 'name' && <span className="sort-icon">{sortDesc ? '↓' : '↑'}</span>}
                                    </th>
                                    <th>Proizvod</th>
                                    <th className={`sortable ${sortBy === 'category' ? 'active' : ''}`} onClick={() => handleSort('category')}>
                                        Kategorija {sortBy === 'category' && <span className="sort-icon">{sortDesc ? '↓' : '↑'}</span>}
                                    </th>
                                    <th>Dobavljač</th>
                                    <th className={`sortable text-right ${sortBy === 'quantity' ? 'active' : ''}`} onClick={() => handleSort('quantity')}>
                                        Količina {sortBy === 'quantity' && <span className="sort-icon">{sortDesc ? '↓' : '↑'}</span>}
                                    </th>
                                    <th className="text-right">Jed. cijena</th>
                                    <th className={`sortable text-right ${sortBy === 'total' ? 'active' : ''}`} onClick={() => handleSort('total')}>
                                        Ukupno {sortBy === 'total' && <span className="sort-icon">{sortDesc ? '↓' : '↑'}</span>}
                                    </th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedDetailed.length === 0 ? (
                                    <tr><td colSpan={8} className="empty-row">Nema materijala</td></tr>
                                ) : (
                                    sortedDetailed.map((mat, idx) => (
                                        <tr key={`${mat.materialId}-${mat.productId}-${idx}`}>
                                            <td className="cell-name">{mat.materialName}</td>
                                            <td className="cell-product">{mat.productName}</td>
                                            <td><span className="category-tag">{mat.category}</span></td>
                                            <td className="cell-supplier">{mat.supplier}</td>
                                            <td className="cell-qty text-right">{formatQty(mat.quantity, mat.unit)}</td>
                                            <td className="text-right">{formatCurrency(mat.unitPrice)}</td>
                                            <td className="cell-total text-right">{formatCurrency(mat.totalPrice)}</td>
                                            <td className="cell-status">
                                                <span className={`status-dot ${mat.status === 'Nije naručeno' ? 'pending' : mat.status === 'Primljeno' ? 'done' : 'progress'}`}></span>
                                                {mat.status}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </Modal>
    );
}
