'use client';

import React, { useState, useMemo } from 'react';
import type { WorkOrder, Worker } from '@/lib/types';
import { WORK_ORDER_STATUSES } from '@/lib/types';
import { daysUntil } from '@/lib/planning';
import { workOrderDisplayName, orderProcessProgress } from '@/lib/utils';
import { validateWorkOrderProfitData } from '@/lib/services';
import WorkOrderExpandedDetail from '@/components/ui/WorkOrderExpandedDetail';

interface AttendanceWarnings {
    warnings: { Worker_ID: string; Worker_Name: string; Work_Order_ID: string; Work_Order_Name: string; Item_Name: string; Date: string }[];
    missingCount: number;
    totalAssigned: number;
}

interface MobileWorkOrdersViewProps {
    workOrders: WorkOrder[];
    workers: Worker[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;

    // Actions
    onCreate: () => void;
    onUpdate: (workOrderId: string, updates: any) => Promise<void>;
    onDelete: (workOrderId: string) => void;
    onStart: (workOrderId: string) => void;
    onPrint: (workOrder: WorkOrder) => void;
    onSummary?: (workOrder: WorkOrder) => void;
    attendanceWarnings?: AttendanceWarnings | null;
    onAttendanceFix?: (workOrder: WorkOrder) => void;
}

export default function MobileWorkOrdersView({
    workOrders,
    workers,
    onRefresh,
    showToast,
    onCreate,
    onUpdate,
    onDelete,
    onStart,
    onPrint,
    onSummary,
    attendanceWarnings,
    onAttendanceFix,
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
            case 'Završeno': return 'var(--success)';
            case 'U toku': return 'var(--accent)';
            case 'Na čekanju': return 'var(--warning)';
            case 'Otkazano': return 'var(--error)';
            default: return 'var(--text-tertiary)';
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
                    const isMontaza = wo.Work_Order_Type === 'Montaža';
                    const items = wo.items || [];

                    // Rok + odbrojavanje (isti model kao desktop kartica)
                    const woActive = wo.Status !== 'Završeno' && wo.Status !== 'Otkazano';
                    const dd = woActive ? daysUntil(wo.Due_Date) : null;
                    const dueCountdown = dd === null ? '' : dd < 0 ? `kasni ${-dd} ${-dd === 1 ? 'dan' : 'dana'}` : dd === 0 ? 'danas' : `za ${dd} ${dd === 1 ? 'dan' : 'dana'}`;
                    const dueColor = dd === null ? undefined : dd < 0 ? 'var(--error)' : dd <= 2 ? 'var(--warning)' : undefined;

                    // Napredak procesa
                    const prog = orderProcessProgress(items);
                    const showProg = prog && prog.total > 1;

                    // Upozorenje o profitu (samo standardna proizvodnja)
                    const profitWarnings = (!wo.Work_Order_Type || wo.Work_Order_Type === 'Proizvodnja') && wo.Status !== 'Otkazano'
                        ? validateWorkOrderProfitData(wo) : [];
                    const hasProfitError = profitWarnings.some((w: any) => w.type === 'error');

                    // Rupe u šihtarici za aktivan nalog
                    const attWarningsForOrder = wo.Status === 'U toku' && attendanceWarnings
                        ? attendanceWarnings.warnings.filter(w => w.Work_Order_ID === wo.Work_Order_ID) : [];

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
                                        <span className="wo-date" style={dueColor ? { color: dueColor, fontWeight: 700 } : undefined}>
                                            {formatDate(wo.Due_Date)}{dueCountdown && ` · ${dueCountdown}`}
                                        </span>
                                    </div>
                                    <div className="wo-title-row">
                                        <span className="wo-title">{workOrderDisplayName(wo)}</span>
                                        {isMontaza && <span className="wo-tag montaza">Montaža</span>}
                                    </div>

                                    {/* Mini summary when collapsed */}
                                    {!isExpanded && (
                                        <div className="wo-mini-stats">
                                            <span>
                                                <span className="material-icons-round tiny">inventory_2</span>
                                                {items.length || 0}
                                            </span>
                                            {showProg && (
                                                <span title={`Završeno ${prog!.done} od ${prog!.total} procesa`}>
                                                    <span className="wo-mini-bar"><span className="wo-mini-bar-fill" style={{ width: `${prog!.pct}%`, background: prog!.pct >= 100 ? 'var(--success)' : 'var(--accent)' }} /></span>
                                                    {prog!.pct}%
                                                </span>
                                            )}
                                            {profitWarnings.length > 0 && (
                                                <span className="warn" style={{ color: hasProfitError ? 'var(--error)' : 'var(--warning)' }}
                                                    title={profitWarnings.map((w: any) => (w.itemName ? `${w.itemName}: ` : '') + w.message).join('\n')}>
                                                    <span className="material-icons-round tiny">report_problem</span>
                                                </span>
                                            )}
                                            {attWarningsForOrder.length > 0 && (
                                                <span className="warn"
                                                    style={{ color: 'var(--warning)' }}
                                                    title={`Nedostaje prisustvo: ${attWarningsForOrder.map(w => w.Worker_Name).join(', ')}`}
                                                    onClick={(e) => { e.stopPropagation(); onAttendanceFix?.(wo); }}>
                                                    <span className="material-icons-round tiny">person_off</span>
                                                    {attWarningsForOrder.length}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Brze akcije — isti set kao desktop red naloga */}
                                <div className="wo-header-actions">
                                    {wo.Status === 'Na čekanju' && (
                                        <button className="wo-icon-btn start" title="Pokreni nalog"
                                            onClick={(e) => { e.stopPropagation(); onStart(wo.Work_Order_ID); }}>
                                            <span className="material-icons-round">play_arrow</span>
                                        </button>
                                    )}
                                    {wo.Status === 'Završeno' && onSummary && (
                                        <button className="wo-icon-btn" title="Rezime naloga"
                                            onClick={(e) => { e.stopPropagation(); onSummary(wo); }}>
                                            <span className="material-icons-round">receipt_long</span>
                                        </button>
                                    )}
                                    <button className="wo-icon-btn" title="Printaj nalog"
                                        onClick={(e) => { e.stopPropagation(); onPrint(wo); }}>
                                        <span className="material-icons-round">print</span>
                                    </button>
                                    <button className="wo-icon-btn delete" title="Obriši nalog"
                                        onClick={(e) => { e.stopPropagation(); onDelete(wo.Work_Order_ID); }}>
                                        <span className="material-icons-round">delete</span>
                                    </button>
                                </div>
                                <span className={`material-icons-round chevron ${isExpanded ? 'rotated' : ''}`}>
                                    expand_more
                                </span>
                            </div>

                            {/* Expanded Content — isti prikaz kao desktop (hero metrike, Tok/Knjiga rada) */}
                            {isExpanded && (
                                <div className="wo-expanded-content">
                                    <WorkOrderExpandedDetail
                                        workOrder={wo}
                                        workers={workers}
                                        onUpdate={onUpdate}
                                        onPrint={onPrint}
                                        onDelete={async (id) => onDelete(id)}
                                        onStart={async (id) => onStart(id)}
                                        onRefresh={onRefresh}
                                        showToast={showToast}
                                    />
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
                    background: var(--background);
                    border-radius: var(--radius-md);
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                    box-shadow: 0 2px 8px var(--shadow);
                }

                .wo-search input {
                    border: none;
                    background: transparent;
                    flex: 1;
                    margin-left: 8px;
                    font-size: 15px;
                    outline: none;
                    color: var(--text-primary);
                }

                .wo-create-btn {
                    width: 48px;
                    height: 48px;
                    border-radius: var(--radius-md);
                    background: var(--accent);
                    color: white;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px var(--shadow-md);
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
                    background: var(--background);
                    border: 1px solid var(--border);
                    color: var(--text-secondary);
                    font-size: 13px;
                    font-weight: 500;
                    white-space: nowrap;
                    transition: all 0.2s;
                }

                .wo-pill.active {
                    background: var(--accent);
                    color: white;
                    border-color: var(--accent);
                }

                .wo-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .wo-card {
                    background: var(--background);
                    border-radius: 16px;
                    padding: 0;
                    box-shadow: 0 2px 8px var(--shadow);
                    overflow: hidden;
                    transition: all 0.2s ease;
                }

                .wo-card.expanded {
                    box-shadow: 0 8px 24px var(--shadow-md);
                }

                .wo-card-header {
                    display: flex;
                    align-items: stretch;
                    padding: 14px;
                    cursor: pointer;
                    position: relative;
                    gap: 8px;
                }

                .wo-status-indicator {
                    width: 4px;
                    border-radius: 4px;
                    margin-right: 4px;
                    flex-shrink: 0;
                }

                .wo-main-info {
                    flex: 1;
                    min-width: 0;
                }

                .wo-top-row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 12px;
                    color: var(--text-tertiary);
                    margin-bottom: 4px;
                    gap: 8px;
                }

                .wo-number { font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
                .wo-date { white-space: nowrap; text-align: right; }

                .wo-title-row {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 4px;
                    min-width: 0;
                }

                .wo-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--text-primary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .wo-tag {
                    font-size: 10px;
                    font-weight: 700;
                    padding: 2px 7px;
                    border-radius: 999px;
                    flex-shrink: 0;
                    text-transform: uppercase;
                }
                .wo-tag.montaza { color: #00897b; background: rgba(0, 137, 123, 0.12); }

                .wo-header-actions {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    flex-shrink: 0;
                }

                .wo-icon-btn {
                    width: 32px;
                    height: 32px;
                    border: none;
                    border-radius: var(--radius-sm);
                    background: transparent;
                    color: var(--text-tertiary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .wo-icon-btn .material-icons-round { font-size: 19px; }
                .wo-icon-btn:active { background: var(--surface); }
                .wo-icon-btn.start { color: var(--success); }
                .wo-icon-btn.delete { color: var(--error); }

                .chevron {
                    color: var(--text-tertiary);
                    transition: transform 0.2s;
                    align-self: center;
                    flex-shrink: 0;
                }

                .chevron.rotated { transform: rotate(180deg); color: var(--accent); }

                .wo-mini-stats {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 12px;
                    color: var(--text-tertiary);
                    flex-wrap: wrap;
                }

                .wo-mini-stats span {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .wo-mini-stats span.warn { font-weight: 600; cursor: help; }

                .wo-mini-bar { width: 28px; height: 4px; border-radius: 2px; background: var(--border-light); overflow: hidden; display: inline-block; }
                .wo-mini-bar-fill { display: block; height: 100%; border-radius: 2px; }

                .tiny { font-size: 14px; }

                /* Expanded */
                .wo-expanded-content {
                    border-top: 1px solid var(--border-light);
                    animation: slideDown 0.2s ease-out;
                }

                .wo-empty {
                    text-align: center;
                    padding: 40px;
                    color: var(--text-tertiary);
                }

                .wo-empty span { font-size: 48px; opacity: 0.5; margin-bottom: 12px; display: block; }

                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
