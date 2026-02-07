'use client';

import React, { useState, useMemo } from 'react';
import type { WorkOrder, Project, Worker } from '@/lib/types';
import { WORK_ORDER_STATUSES } from '@/lib/types';

interface MobileWorkOrdersViewProps {
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[]; // Needed if we want to show worker avatars or names
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;

    // Actions
    onCreate: () => void;
    onEdit: (workOrder: WorkOrder) => void;
    onDelete: (workOrderId: string) => void;
    onStart: (workOrderId: string) => void;
    onPrint: (workOrder: WorkOrder) => void;
}

export default function MobileWorkOrdersView({
    workOrders,
    projects,
    workers,
    onCreate,
    onEdit,
    onDelete,
    onStart,
    onPrint
}: MobileWorkOrdersViewProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Toggle expand/collapse
    const toggleExpand = (id: string, e: React.MouseEvent) => {
        // Don't trigger if clicking buttons
        if ((e.target as HTMLElement).closest('button')) return;

        const newSet = new Set(expandedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setExpandedIds(newSet);
    };

    // Filtering
    const filteredOrders = useMemo(() => {
        return workOrders.filter(wo => {
            const matchesSearch =
                (wo.Work_Order_Number?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (wo.Name?.toLowerCase().includes(searchTerm.toLowerCase()));
            const matchesStatus = !statusFilter || wo.Status === statusFilter;
            return matchesSearch && matchesStatus;
        }).sort((a, b) => new Date(b.Created_Date).getTime() - new Date(a.Created_Date).getTime());
    }, [workOrders, searchTerm, statusFilter]);

    // Helpers
    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric', year: '2-digit' });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Završeno': return '#10b981'; // Green
            case 'U toku': return '#3b82f6';   // Blue
            case 'Na čekanju': return '#f59e0b'; // Amber
            case 'Otkazano': return '#ef4444'; // Red
            default: return '#9ca3af'; // Gray
        }
    };

    return (
        <div className="mobile-wo-view">
            {/* Toolbar */}
            <div className="wo-toolbar">
                <div className="wo-search">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Traži nalog..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button className="wo-create-btn" onClick={onCreate}>
                    <span className="material-icons-round">add</span>
                </button>
            </div>

            {/* Filter Pills */}
            <div className="wo-filters">
                <button
                    className={`wo-pill ${statusFilter === '' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('')}
                >
                    Sve
                </button>
                {WORK_ORDER_STATUSES.map(status => (
                    <button
                        key={status}
                        className={`wo-pill ${statusFilter === status ? 'active' : ''}`}
                        onClick={() => setStatusFilter(status)}
                    >
                        {status}
                    </button>
                ))}
            </div>

            {/* Orders List */}
            <div className="wo-list">
                {filteredOrders.map(wo => {
                    const isExpanded = expandedIds.has(wo.Work_Order_ID);
                    const statusColor = getStatusColor(wo.Status);

                    return (
                        <div
                            key={wo.Work_Order_ID}
                            className={`wo-card ${isExpanded ? 'expanded' : ''}`}
                            onClick={(e) => toggleExpand(wo.Work_Order_ID, e)}
                        >
                            {/* Card Header (Always Visible) */}
                            <div className="wo-card-header">
                                <div className="wo-status-indicator" style={{ backgroundColor: statusColor }} />
                                <div className="wo-main-info">
                                    <div className="wo-top-row">
                                        <span className="wo-number">#{wo.Work_Order_Number}</span>
                                        <span className="wo-date">{formatDate(wo.Due_Date)}</span>
                                    </div>
                                    <div className="wo-title">{wo.Name || 'Bez naziva'}</div>

                                    {/* Mini summary when collapsed */}
                                    {!isExpanded && (
                                        <div className="wo-mini-stats">
                                            <span>
                                                <span className="material-icons-round tiny">inventory_2</span>
                                                {wo.items?.length || 0}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <span className={`material-icons-round chevron ${isExpanded ? 'rotated' : ''}`}>
                                    expand_more
                                </span>
                            </div>

                            {/* Expanded Content */}
                            {isExpanded && (
                                <div className="wo-expanded-content">
                                    {/* Stats Grid */}
                                    <div className="wo-stats-grid">
                                        <div className="wo-stat-box">
                                            <label>Status</label>
                                            <div className="value" style={{ color: statusColor }}>
                                                {wo.Status}
                                            </div>
                                        </div>
                                        <div className="wo-stat-box">
                                            <label>Vrijednost</label>
                                            <div className="value">
                                                <span className="material-icons-round">payments</span>
                                                {wo.Total_Value ? `${wo.Total_Value.toFixed(0)} KM` : '-'}
                                            </div>
                                        </div>
                                        <div className="wo-stat-box">
                                            <label>Rok</label>
                                            <div className="value">
                                                <span className="material-icons-round">event</span>
                                                {formatDate(wo.Due_Date)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Product List */}
                                    {wo.items && wo.items.length > 0 && (
                                        <div className="wo-products-section">
                                            <h4 className="section-title">
                                                <span className="material-icons-round">category</span>
                                                Proizvodi ({wo.items.length})
                                            </h4>
                                            <div className="wo-products-list">
                                                {wo.items.map((item, idx) => (
                                                    <div key={idx} className="wo-product-item">
                                                        <div className="prod-main">
                                                            <div className="prod-name">{item.Product_Name}</div>
                                                            <div className="prod-sub">{item.Project_Name}</div>
                                                        </div>
                                                        <div className="prod-qty">
                                                            {item.Quantity} <span className="unit">kom</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Actions Bar */}
                                    <div className="wo-actions">
                                        {/* Status Actions */}
                                        {wo.Status === 'Na čekanju' && (
                                            <button
                                                className="wo-action-btn start"
                                                onClick={(e) => { e.stopPropagation(); onStart(wo.Work_Order_ID); }}
                                            >
                                                Start
                                                <span className="material-icons-round">play_arrow</span>
                                            </button>
                                        )}

                                        <button
                                            className="wo-action-btn secondary"
                                            onClick={(e) => { e.stopPropagation(); onPrint(wo); }}
                                        >
                                            <span className="material-icons-round">print</span>
                                        </button>

                                        <button
                                            className="wo-action-btn edit"
                                            onClick={(e) => { e.stopPropagation(); onEdit(wo); }}
                                        >
                                            <span className="material-icons-round">edit</span>
                                        </button>

                                        <button
                                            className="wo-action-btn delete"
                                            onClick={(e) => { e.stopPropagation(); onDelete(wo.Work_Order_ID); }}
                                        >
                                            <span className="material-icons-round">delete</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {filteredOrders.length === 0 && (
                    <div className="wo-empty">
                        <span className="material-icons-round">assignment_late</span>
                        <p>Nema radnih naloga</p>
                    </div>
                )}
            </div>

            <style jsx>{`
                .mobile-wo-view {
                    padding-bottom: 80px;
                    background: transparent;
                }

                .wo-toolbar {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 16px;
                }

                .wo-search {
                    flex: 1;
                    height: 48px;
                    background: white;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.03);
                }

                .wo-search input {
                    border: none;
                    background: transparent;
                    flex: 1;
                    margin-left: 8px;
                    font-size: 15px;
                    outline: none;
                }

                .wo-create-btn {
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                    background: #2563eb;
                    color: white;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
                }

                .wo-filters {
                    display: flex;
                    gap: 8px;
                    overflow-x: auto;
                    margin-bottom: 16px;
                    padding-bottom: 4px;
                    scrollbar-width: none;
                }

                .wo-filters::-webkit-scrollbar { display: none; }

                .wo-pill {
                    padding: 6px 14px;
                    border-radius: 20px;
                    background: white;
                    border: 1px solid #e2e8f0;
                    color: #64748b;
                    font-size: 13px;
                    font-weight: 500;
                    white-space: nowrap;
                    transition: all 0.2s;
                }

                .wo-pill.active {
                    background: #2563eb;
                    color: white;
                    border-color: #2563eb;
                }

                .wo-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .wo-card {
                    background: white;
                    border-radius: 16px;
                    padding: 0;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.03);
                    overflow: hidden;
                    transition: all 0.2s ease;
                }

                .wo-card.expanded {
                    box-shadow: 0 8px 24px rgba(0,0,0,0.08);
                }

                .wo-card-header {
                    display: flex;
                    align-items: stretch;
                    padding: 14px;
                    cursor: pointer;
                    position: relative;
                }

                .wo-status-indicator {
                    width: 4px;
                    border-radius: 4px;
                    margin-right: 12px;
                }

                .wo-main-info {
                    flex: 1;
                }

                .wo-top-row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 12px;
                    color: #94a3b8;
                    margin-bottom: 4px;
                }

                .wo-number { font-weight: 600; color: #64748b; }

                .wo-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #1e293b;
                    margin-bottom: 4px;
                }

                .chevron {
                    color: #cbd5e1;
                    transition: transform 0.2s;
                    align-self: center;
                }

                .chevron.rotated { transform: rotate(180deg); color: #2563eb; }

                .wo-mini-stats {
                    display: flex;
                    gap: 12px;
                    font-size: 12px;
                    color: #94a3b8;
                }
                
                .wo-mini-stats span {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                
                .tiny { font-size: 14px; }

                /* Expanded */
                .wo-expanded-content {
                    padding: 0 16px 16px 16px;
                    border-top: 1px solid #f1f5f9;
                    animation: slideDown 0.2s ease-out;
                }

                .wo-stats-grid {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    margin: 16px 0;
                }


                .wo-stat-box {
                    flex: 1;
                    background: #f8fafc;
                    padding: 8px;
                    border-radius: 8px;
                    text-align: center;
                    min-width: 0; /* Prevents overflow */
                }

                .wo-stat-box label {
                    display: block;
                    font-size: 10px;
                    color: #94a3b8;
                    margin-bottom: 4px;
                    text-transform: uppercase;
                }

                .wo-stat-box .value {
                    font-size: 13px;
                    font-weight: 600;
                    color: #334155;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                }
                
                .wo-stat-box .value .material-icons-round { font-size: 16px; color: #94a3b8; }

                .wo-actions {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    margin-top: 8px;
                }

                .wo-action-btn {
                    flex: 1;
                    height: 44px;
                    border: none;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #f1f5f9;
                    color: #64748b;
                    transition: all 0.1s;
                }

                .wo-action-btn:active { transform: scale(0.96); }

                .wo-action-btn.start {
                    background: #dcfce7;
                    color: #15803d;
                    flex: 1.5; 
                }

                .wo-action-btn.edit {
                    background: #eff6ff;
                    color: #2563eb;
                }

                .wo-action-btn.delete {
                    background: #fee2e2;
                    color: #dc2626;
                }
                
                .wo-action-btn.secondary {
                    background: white;
                    border: 1px solid #e2e8f0;
                }

                .wo-empty {
                    text-align: center;
                    padding: 40px;
                    color: #94a3b8;
                }
                
                .wo-empty span { font-size: 48px; opacity: 0.5; margin-bottom: 12px; display: block; }
                
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-5px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .wo-products-section {
                    margin: 16px 0;
                    background: #f8fafc;
                    border-radius: 12px;
                    padding: 12px;
                }

                .section-title {
                    font-size: 13px;
                    font-weight: 600;
                    color: #64748b;
                    margin: 0 0 12px 0;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .section-title .material-icons-round {
                    font-size: 16px;
                }

                .wo-products-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .wo-product-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 12px;
                    background: white;
                    border-radius: 8px;
                    border: 1px solid #e2e8f0;
                }

                .prod-main {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .prod-name {
                    font-size: 14px;
                    font-weight: 500;
                    color: #334155;
                }

                .prod-sub {
                    font-size: 11px;
                    color: #94a3b8;
                }

                .prod-qty {
                    font-size: 14px;
                    font-weight: 600;
                    color: #2563eb;
                    background: #eff6ff;
                    padding: 4px 8px;
                    border-radius: 6px;
                }

                .unit {
                    font-size: 11px;
                    font-weight: 400;
                    color: #64748b;
                    margin-left: 2px;
                }
            `}</style>
        </div>
    );
}
