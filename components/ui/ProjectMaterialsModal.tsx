'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { Project, Product } from '@/lib/types';
import Modal from '@/components/ui/Modal';
import { sortProductsByName } from '@/lib/sortProducts';

interface ProjectMaterialsModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: Project;
}

interface AggregatedMaterial {
    Material_Name: string;
    Material_ID: string;
    Unit: string;
    Needed: number;
    On_Stock: number;
    Ordered: number;
    Received: number;
    Remaining: number;
    Status: string;
    Products: string[];
}

const STATUS_PRIORITY: Record<string, number> = {
    'Nije naručeno': 0,
    'Naručeno': 1,
    'Na stanju': 2,
    'Primljeno': 3,
};

function getWorstStatus(a: string, b: string): string {
    return (STATUS_PRIORITY[a] ?? 0) <= (STATUS_PRIORITY[b] ?? 0) ? a : b;
}

function statusColor(status: string) {
    switch (status) {
        case 'Primljeno': return { fg: '#059669', bg: '#ecfdf5', dot: '#10b981' };
        case 'Na stanju': return { fg: '#2563eb', bg: '#eff6ff', dot: '#3b82f6' };
        case 'Naručeno': return { fg: '#d97706', bg: '#fffbeb', dot: '#f59e0b' };
        default: return { fg: '#dc2626', bg: '#fef2f2', dot: '#ef4444' };
    }
}

export default function ProjectMaterialsModal({ isOpen, onClose, project }: ProjectMaterialsModalProps) {
    const allProducts = useMemo(
        () => sortProductsByName(project.products || [], p => p.Name || ''),
        [project.products]
    );

    // Explicit set: contains IDs of checked products. Starts with ALL checked.
    const [selected, setSelected] = useState<Set<string>>(() => new Set(allProducts.map(p => p.Product_ID)));
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [search, setSearch] = useState('');
    const ddRef = useRef<HTMLDivElement>(null);

    const isAllChecked = selected.size === allProducts.length;
    const isNoneChecked = selected.size === 0;

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDropdownOpen(false);
        };
        if (dropdownOpen) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [dropdownOpen]);

    // Reset to all selected when modal opens
    useEffect(() => {
        if (isOpen) {
            setSelected(new Set(allProducts.map(p => p.Product_ID)));
            setSearch('');
            setDropdownOpen(false);
        }
    }, [isOpen, allProducts]);

    const toggleProduct = useCallback((id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const toggleAll = useCallback(() => {
        if (isAllChecked) {
            // Uncheck all
            setSelected(new Set());
        } else {
            // Check all
            setSelected(new Set(allProducts.map(p => p.Product_ID)));
        }
    }, [isAllChecked, allProducts]);

    // Products visible in dropdown
    const filteredDropdownProducts = useMemo(() => {
        if (!search.trim()) return allProducts;
        const q = search.toLowerCase();
        return allProducts.filter(p => p.Name?.toLowerCase().includes(q));
    }, [allProducts, search]);

    // Active products for aggregation
    const activeProducts = useMemo(() => {
        return allProducts.filter(p => selected.has(p.Product_ID));
    }, [allProducts, selected]);

    // Aggregate
    const aggregated = useMemo(() => {
        const map = new Map<string, AggregatedMaterial>();
        for (const product of activeProducts) {
            for (const mat of product.materials || []) {
                const key = mat.Material_ID || mat.Material_Name;
                const ex = map.get(key);
                if (ex) {
                    ex.Needed += mat.Quantity || 0;
                    ex.On_Stock += mat.On_Stock || 0;
                    ex.Ordered += mat.Ordered_Quantity || 0;
                    ex.Received += mat.Received_Quantity || 0;
                    if (!ex.Products.includes(product.Name)) ex.Products.push(product.Name);
                    ex.Status = getWorstStatus(ex.Status, mat.Status || 'Nije naručeno');
                } else {
                    map.set(key, {
                        Material_Name: mat.Material_Name,
                        Material_ID: mat.Material_ID,
                        Unit: mat.Unit || 'Kom',
                        Needed: mat.Quantity || 0,
                        On_Stock: mat.On_Stock || 0,
                        Ordered: mat.Ordered_Quantity || 0,
                        Received: mat.Received_Quantity || 0,
                        Remaining: 0,
                        Status: mat.Status || 'Nije naručeno',
                        Products: [product.Name],
                    });
                }
            }
        }
        const result = Array.from(map.values());
        for (const m of result) m.Remaining = Math.max(0, m.Needed - m.On_Stock - m.Received);
        result.sort((a, b) => a.Material_Name.localeCompare(b.Material_Name, 'hr'));
        return result;
    }, [activeProducts]);

    const counts = useMemo(() => ({
        total: aggregated.length,
        notOrdered: aggregated.filter(m => m.Status === 'Nije naručeno').length,
        ordered: aggregated.filter(m => m.Status === 'Naručeno').length,
        ready: aggregated.filter(m => m.Status === 'Primljeno' || m.Status === 'Na stanju').length,
    }), [aggregated]);

    const fmt = (v: number, u: string) => {
        const n = v % 1 === 0 ? v.toString() : v.toFixed(2);
        return `${n} ${u}`;
    };

    // Dropdown label
    const dropdownLabel = isAllChecked
        ? `Svi proizvodi (${allProducts.length})`
        : isNoneChecked
            ? 'Odaberite proizvode'
            : selected.size === 1
                ? allProducts.find(p => selected.has(p.Product_ID))?.Name || '1 odabran'
                : `${selected.size} od ${allProducts.length} odabrano`;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Pregled materijala — ${project.Name || project.Client_Name}`} size="fullscreen">
            <div className="pmo">
                {/* Toolbar */}
                <div className="pmo-toolbar">
                    {allProducts.length > 1 && (
                        <div className="pmo-filter" ref={ddRef}>
                            <button className="pmo-select-btn" onClick={() => { setDropdownOpen(!dropdownOpen); setSearch(''); }}>
                                <span className="material-icons-round" style={{ fontSize: 18, opacity: 0.5 }}>filter_list</span>
                                <span className="pmo-select-label">{dropdownLabel}</span>
                                <span className="material-icons-round pmo-chevron" data-open={dropdownOpen}>expand_more</span>
                            </button>

                            {dropdownOpen && (
                                <div className="pmo-dd">
                                    <div className="pmo-dd-search">
                                        <span className="material-icons-round" style={{ fontSize: 18, color: '#94a3b8' }}>search</span>
                                        <input
                                            autoFocus
                                            placeholder="Pretraži proizvode…"
                                            value={search}
                                            onChange={e => setSearch(e.target.value)}
                                        />
                                        {search && (
                                            <button className="pmo-dd-clear" onClick={() => setSearch('')}>
                                                <span className="material-icons-round" style={{ fontSize: 16 }}>close</span>
                                            </button>
                                        )}
                                    </div>

                                    <div className="pmo-dd-list">
                                        {/* Select All */}
                                        <div className={`pmo-dd-item ${isAllChecked ? 'checked' : ''}`} onClick={toggleAll}>
                                            <span className={`pmo-check ${isAllChecked ? 'on' : ''}`}>
                                                {isAllChecked && <span className="material-icons-round" style={{ fontSize: 14 }}>check</span>}
                                            </span>
                                            <span className="pmo-dd-name" style={{ fontWeight: 600 }}>Svi proizvodi</span>
                                            <span className="pmo-dd-badge">{allProducts.length}</span>
                                        </div>

                                        <div className="pmo-dd-divider" />

                                        {filteredDropdownProducts.map(p => {
                                            const isChecked = selected.has(p.Product_ID);
                                            const mc = p.materials?.length || 0;
                                            return (
                                                <div key={p.Product_ID} className={`pmo-dd-item ${isChecked ? 'checked' : ''}`} onClick={() => toggleProduct(p.Product_ID)}>
                                                    <span className={`pmo-check ${isChecked ? 'on' : ''}`}>
                                                        {isChecked && <span className="material-icons-round" style={{ fontSize: 14 }}>check</span>}
                                                    </span>
                                                    <span className="pmo-dd-name">{p.Name}</span>
                                                    <span className="pmo-dd-badge">{mc} mat.</span>
                                                </div>
                                            );
                                        })}

                                        {filteredDropdownProducts.length === 0 && (
                                            <div className="pmo-dd-empty">Nema rezultata za „{search}"</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Compact stat chips */}
                    <div className="pmo-chips">
                        <span className="pmo-chip">{counts.total} mat.</span>
                        {counts.notOrdered > 0 && <span className="pmo-chip danger">{counts.notOrdered} čeka</span>}
                        {counts.ordered > 0 && <span className="pmo-chip warning">{counts.ordered} naruč.</span>}
                        {counts.ready > 0 && <span className="pmo-chip success">{counts.ready} spremno</span>}
                    </div>
                </div>

                {/* Table */}
                {aggregated.length === 0 ? (
                    <div className="pmo-empty">
                        <span className="material-icons-round" style={{ fontSize: 48, color: '#cbd5e1' }}>inventory_2</span>
                        <p>Nema materijala za odabrane proizvode.</p>
                    </div>
                ) : (
                    <div className="pmo-table-wrap">
                        <table className="pmo-table">
                            <thead>
                                <tr>
                                    <th>Materijal</th>
                                    <th className="r">Potrebno</th>
                                    <th className="r">Na stanju</th>
                                    <th className="r">Naručeno</th>
                                    <th className="r">Primljeno</th>
                                    <th className="r hl">Preostalo</th>
                                    <th className="c">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {aggregated.map((m, i) => {
                                    const sc = statusColor(m.Status);
                                    return (
                                        <tr key={m.Material_ID || i}>
                                            <td>
                                                <div className="pmo-mat-name">{m.Material_Name}</div>
                                                {m.Products.length > 0 && (
                                                    <div className="pmo-mat-sub" title={m.Products.join(', ')}>
                                                        {m.Products.length === 1 ? m.Products[0] : `${m.Products.length} proizvoda`}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="r fw">{fmt(m.Needed, m.Unit)}</td>
                                            <td className="r dim">{fmt(m.On_Stock, m.Unit)}</td>
                                            <td className="r dim">{fmt(m.Ordered, m.Unit)}</td>
                                            <td className="r dim">{fmt(m.Received, m.Unit)}</td>
                                            <td className="r hl">
                                                <span style={{ color: m.Remaining > 0 ? '#dc2626' : '#059669', fontWeight: 700 }}>
                                                    {fmt(m.Remaining, m.Unit)}
                                                </span>
                                            </td>
                                            <td className="c">
                                                <span className="pmo-status" style={{ color: sc.fg, background: sc.bg }}>
                                                    <span className="pmo-dot" style={{ background: sc.dot }} />
                                                    {m.Status}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <style jsx>{`
                .pmo { display: flex; flex-direction: column; gap: 16px; }

                /* ── Toolbar ── */
                .pmo-toolbar {
                    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
                }

                /* ── Filter dropdown ── */
                .pmo-filter { position: relative; }

                .pmo-select-btn {
                    display: flex; align-items: center; gap: 8px;
                    padding: 9px 14px;
                    background: white; border: 1.5px solid #e2e8f0; border-radius: 10px;
                    cursor: pointer; font-size: 13px; color: #334155; font-weight: 500;
                    transition: border-color 0.15s, box-shadow 0.15s;
                    white-space: nowrap;
                }
                .pmo-select-btn:hover { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }

                .pmo-chevron { font-size: 20px; color: #94a3b8; transition: transform 0.2s; }
                .pmo-chevron[data-open="true"] { transform: rotate(180deg); }

                .pmo-select-label { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }

                /* Dropdown panel */
                .pmo-dd {
                    position: absolute; top: calc(100% + 6px); left: 0;
                    min-width: 320px; max-width: 380px;
                    background: white; border: 1px solid #e2e8f0; border-radius: 12px;
                    box-shadow: 0 12px 32px -4px rgba(0,0,0,0.12), 0 4px 12px -2px rgba(0,0,0,0.05);
                    z-index: 100; overflow: hidden;
                    animation: pmo-slide-in 0.15s ease-out;
                }
                @keyframes pmo-slide-in {
                    from { opacity: 0; transform: translateY(-6px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .pmo-dd-search {
                    display: flex; align-items: center; gap: 8px;
                    padding: 10px 14px; border-bottom: 1px solid #f1f5f9;
                }
                .pmo-dd-search input {
                    flex: 1; border: none; outline: none; font-size: 13px; color: #1e293b;
                    background: transparent;
                }
                .pmo-dd-search input::placeholder { color: #94a3b8; }
                .pmo-dd-clear {
                    background: none; border: none; padding: 2px; cursor: pointer; color: #94a3b8;
                    display: flex; border-radius: 4px;
                }
                .pmo-dd-clear:hover { color: #475569; background: #f1f5f9; }

                .pmo-dd-list { max-height: 300px; overflow-y: auto; padding: 6px; }
                .pmo-dd-divider { height: 1px; background: #f1f5f9; margin: 4px 8px; }

                .pmo-dd-item {
                    display: flex; align-items: center; gap: 10px;
                    padding: 8px 10px; border-radius: 8px; cursor: pointer;
                    transition: background 0.1s; user-select: none;
                }
                .pmo-dd-item:hover { background: #f8fafc; }
                .pmo-dd-item.checked { background: #f0f0ff; }

                .pmo-check {
                    width: 18px; height: 18px; border-radius: 5px;
                    border: 1.5px solid #cbd5e1; display: flex; align-items: center; justify-content: center;
                    transition: all 0.15s; flex-shrink: 0;
                }
                .pmo-check.on {
                    background: #6366f1; border-color: #6366f1; color: white;
                }

                .pmo-dd-name { flex: 1; font-size: 13px; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .pmo-dd-badge {
                    font-size: 11px; color: #94a3b8; background: #f1f5f9;
                    padding: 2px 7px; border-radius: 6px; font-weight: 500; white-space: nowrap;
                }
                .pmo-dd-empty { padding: 20px; text-align: center; color: #94a3b8; font-size: 13px; }

                /* ── Stat chips ── */
                .pmo-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
                .pmo-chip {
                    font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 8px;
                    background: #f1f5f9; color: #475569;
                }
                .pmo-chip.danger { background: #fef2f2; color: #dc2626; }
                .pmo-chip.warning { background: #fffbeb; color: #d97706; }
                .pmo-chip.success { background: #ecfdf5; color: #059669; }

                /* ── Table ── */
                .pmo-table-wrap {
                    border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;
                    overflow-x: auto;
                }

                .pmo-table { width: 100%; border-collapse: collapse; font-size: 13px; }

                .pmo-table thead {
                    background: #f8fafc; position: sticky; top: 0; z-index: 2;
                }
                .pmo-table th {
                    padding: 11px 16px; font-size: 11px; font-weight: 700; color: #64748b;
                    text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap;
                    text-align: left; border-bottom: 1px solid #e2e8f0;
                }
                .pmo-table th.r { text-align: right; }
                .pmo-table th.c { text-align: center; }
                .pmo-table th.hl { background: #f1f5f9; }

                .pmo-table tbody tr { border-bottom: 1px solid #f1f5f9; transition: background 0.1s; }
                .pmo-table tbody tr:last-child { border-bottom: none; }
                .pmo-table tbody tr:hover { background: #fafbfd; }

                .pmo-table td { padding: 14px 16px; vertical-align: middle; }
                .pmo-table td.r { text-align: right; white-space: nowrap; }
                .pmo-table td.c { text-align: center; }
                .pmo-table td.hl { background: #fafbfc; }
                .pmo-table tr:hover td.hl { background: #f1f5f9; }
                .pmo-table td.fw { font-weight: 600; color: #1e293b; }
                .pmo-table td.dim { color: #94a3b8; }

                .pmo-mat-name { font-weight: 600; color: #1e293b; font-size: 13px; }
                .pmo-mat-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }

                .pmo-status {
                    display: inline-flex; align-items: center; gap: 6px;
                    padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
                    white-space: nowrap;
                }
                .pmo-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

                /* ── Empty ── */
                .pmo-empty {
                    display: flex; flex-direction: column; align-items: center; gap: 8px;
                    padding: 60px 20px; color: #94a3b8; text-align: center;
                }
                .pmo-empty p { margin: 0; font-size: 14px; }

                /* ── Responsive ── */
                @media (max-width: 768px) {
                    .pmo-toolbar { flex-direction: column; align-items: stretch; }
                    .pmo-chips { margin-left: 0; }
                    .pmo-dd { min-width: 280px; left: 0; right: 0; }
                }
            `}</style>
        </Modal>
    );
}
