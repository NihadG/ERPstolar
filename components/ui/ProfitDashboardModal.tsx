'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useData } from '@/context/DataContext';
import type { DashboardProduct, ProfitDashboardData } from '@/lib/services/profit/profitDashboardService';
import type { WorkLog } from '@/lib/types';
import ProductTimelineModal from './ProductTimelineModal';

interface ProfitDashboardModalProps {
    onClose: () => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function ProfitDashboardModal({ onClose, showToast }: ProfitDashboardModalProps) {
    const { organizationId, appState } = useData();
    const allWorkers = appState.workers || [];
    const [data, setData] = useState<ProfitDashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

    // Timeline modal state
    const [timelineProduct, setTimelineProduct] = useState<DashboardProduct | null>(null);
    const [timelineWorkLogs, setTimelineWorkLogs] = useState<WorkLog[]>([]);
    const [loadingTimeline, setLoadingTimeline] = useState(false);

    const loadData = useCallback(async () => {
        if (!organizationId) return;
        try {
            const { getActiveProfitDashboard } = await import('@/lib/services/profit/profitDashboardService');
            const result = await getActiveProfitDashboard(organizationId);
            setData(result);
        } catch (error) {
            console.error('Failed to load profit dashboard:', error);
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

    useEffect(() => { loadData(); }, [loadData]);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !timelineProduct) onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose, timelineProduct]);

    const fmt = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} KM`;
    const pct = (n: number) => `${n.toFixed(0)}%`;

    // Group by work order
    const grouped = useMemo(() => {
        if (!data) return [];
        let products = data.products;
        if (searchTerm.trim()) {
            const s = searchTerm.toLowerCase();
            products = products.filter(p =>
                p.productName.toLowerCase().includes(s) ||
                p.projectName.toLowerCase().includes(s) ||
                p.workOrderNumber.toLowerCase().includes(s)
            );
        }
        const map = new Map<string, { woId: string; woNumber: string; woType: string; items: DashboardProduct[] }>();
        for (const p of products) {
            const ex = map.get(p.workOrderId);
            if (ex) ex.items.push(p);
            else map.set(p.workOrderId, { woId: p.workOrderId, woNumber: p.workOrderNumber, woType: p.workOrderType, items: [p] });
        }
        return Array.from(map.values());
    }, [data, searchTerm]);

    // Open timeline for a product — fetch work logs first
    const openTimeline = async (product: DashboardProduct) => {
        if (!organizationId) return;
        setLoadingTimeline(true);
        try {
            const { getWorkLogsForWorkOrder } = await import('@/lib/services');
            const logs = await getWorkLogsForWorkOrder(product.workOrderId, organizationId);
            setTimelineWorkLogs(logs);
            setTimelineProduct(product);
        } catch (err) {
            console.error('Error fetching work logs:', err);
            showToast?.('Greška pri učitavanju timeline-a', 'error');
        } finally {
            setLoadingTimeline(false);
        }
    };

    // Handle timeline close — reload dashboard data
    const closeTimeline = () => {
        setTimelineProduct(null);
        setTimelineWorkLogs([]);
        // Reload data to reflect changes
        setLoading(true);
        loadData();
    };

    return (
        <>
            <div className="pdm-overlay" onClick={onClose} />
            <div className="pdm-modal">
                {/* Header */}
                <div className="pdm-header">
                    <div className="pdm-header-left">
                        <span className="material-icons-round" style={{ fontSize: '22px', color: '#22c55e' }}>insights</span>
                        <div>
                            <h2>Pregled Profita</h2>
                            <p>Aktivni nalozi — dnevnice i profit</p>
                        </div>
                    </div>
                    <button className="pdm-close" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                {/* Summary */}
                {data && data.summary.activeProductCount > 0 && (
                    <div className="pdm-summary-strip">
                        <div className="pdm-stat">
                            <span className="label">Prihod</span>
                            <span className="value">{fmt(data.summary.totalRevenue)}</span>
                        </div>
                        <div className="pdm-stat">
                            <span className="label">Materijal</span>
                            <span className="value">{fmt(data.summary.totalMaterialCost)}</span>
                        </div>
                        <div className="pdm-stat">
                            <span className="label">Dnevnice</span>
                            <span className="value amber">{fmt(data.summary.totalLaborCost)}</span>
                        </div>
                        <div className="pdm-stat main">
                            <span className="label">Profit</span>
                            <span className={`value ${data.summary.totalProfit >= 0 ? 'green' : 'red'}`}>
                                {fmt(data.summary.totalProfit)}
                            </span>
                        </div>
                        <div className="pdm-stat">
                            <span className="label">Marža</span>
                            <span className={`value ${data.summary.avgProfitMargin >= 0 ? 'green' : 'red'}`}>
                                {pct(data.summary.avgProfitMargin)}
                            </span>
                        </div>
                    </div>
                )}

                {/* Search */}
                <div className="pdm-search-row">
                    <span className="material-icons-round" style={{ fontSize: '18px', color: '#94a3b8' }}>search</span>
                    <input
                        type="text"
                        placeholder="Pretraži..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <button className="pdm-refresh" onClick={() => { setLoading(true); loadData(); }}>
                        <span className="material-icons-round" style={{ fontSize: '16px' }}>refresh</span>
                    </button>
                </div>

                {/* Body */}
                <div className="pdm-body">
                    {loading ? (
                        <div className="pdm-center"><span>Učitavanje...</span></div>
                    ) : grouped.length === 0 ? (
                        <div className="pdm-center">
                            <span className="material-icons-round" style={{ fontSize: '40px', color: '#d1d5db' }}>analytics</span>
                            <p>Nema aktivnih proizvoda</p>
                        </div>
                    ) : (
                        grouped.map(group => (
                            <div key={group.woId} className="pdm-wo-group">
                                {/* WO Header */}
                                <div className="wo-group-header">
                                    <span className="material-icons-round" style={{
                                        fontSize: '15px',
                                        color: group.woType === 'Montaža' ? '#00C7BE' : '#3b82f6'
                                    }}>
                                        {group.woType === 'Montaža' ? 'build' : 'precision_manufacturing'}
                                    </span>
                                    <span className="wo-num">{group.woNumber}</span>
                                    <span className="wo-type-badge">{group.woType}</span>
                                    <span className={`wo-profit-badge ${group.items.reduce((s, i) => s + i.profit, 0) >= 0 ? 'green' : 'red'}`}>
                                        {fmt(group.items.reduce((s, i) => s + i.profit, 0))}
                                    </span>
                                </div>

                                {/* Products */}
                                {group.items.map(product => {
                                    const isExpanded = expandedProduct === product.workOrderItemId;
                                    return (
                                        <div key={product.workOrderItemId} className="pdm-product-card">
                                            {/* Product row */}
                                            <div className="product-row" onClick={() => setExpandedProduct(isExpanded ? null : product.workOrderItemId)}>
                                                <div className="pr-left">
                                                    <span className="material-icons-round" style={{ fontSize: '14px', color: '#94a3b8' }}>
                                                        {isExpanded ? 'expand_more' : 'chevron_right'}
                                                    </span>
                                                    <div>
                                                        <div className="pr-name">{product.productName}</div>
                                                        <div className="pr-project">{product.projectName}</div>
                                                    </div>
                                                </div>
                                                <div className="pr-numbers">
                                                    <div className="pr-num">
                                                        <span className="pr-label">Cijena</span>
                                                        <span className="pr-val">{fmt(product.sellingPrice)}</span>
                                                    </div>
                                                    <div className="pr-num">
                                                        <span className="pr-label">Materijal</span>
                                                        <span className="pr-val">{fmt(product.materialCost)}</span>
                                                    </div>
                                                    <div className="pr-num">
                                                        <span className="pr-label">Dnevnice</span>
                                                        <span className="pr-val amber">{fmt(product.laborCost)}</span>
                                                    </div>
                                                    <div className="pr-num profit-num">
                                                        <span className="pr-label">Profit</span>
                                                        <span className={`pr-val bold ${product.profit >= 0 ? 'green' : 'red'}`}>{fmt(product.profit)}</span>
                                                        <span className={`pr-margin ${product.profitMargin >= 0 ? 'green' : 'red'}`}>{pct(product.profitMargin)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expanded detail */}
                                            {isExpanded && (
                                                <div className="product-detail">
                                                    {/* Workers */}
                                                    {product.workers.length === 0 ? (
                                                        <div className="detail-empty">Nema evidentiranih radnika</div>
                                                    ) : (
                                                        <div className="worker-list">
                                                            {product.workers.map(w => (
                                                                <div key={w.workerId} className="worker-row">
                                                                    <span className="wr-name">
                                                                        <span className="material-icons-round" style={{ fontSize: '14px', color: '#64748b' }}>person</span>
                                                                        {w.name}
                                                                    </span>
                                                                    <span className="wr-info">
                                                                        {w.days} dana
                                                                        {w.baseDailyRate !== w.splitDailyRate && w.baseDailyRate > 0 && (
                                                                            <span className="wr-split"> (dnevnica {Math.round(w.baseDailyRate)} → split {Math.round(w.splitDailyRate)} KM)</span>
                                                                        )}
                                                                    </span>
                                                                    <span className="wr-total">{fmt(w.totalCost)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Edit Timeline button */}
                                                    <button
                                                        className="edit-timeline-btn"
                                                        onClick={() => openTimeline(product)}
                                                        disabled={loadingTimeline}
                                                    >
                                                        <span className="material-icons-round" style={{ fontSize: '16px' }}>
                                                            {loadingTimeline ? 'hourglass_empty' : 'edit_calendar'}
                                                        </span>
                                                        {loadingTimeline ? 'Učitavanje...' : 'Uredi Timeline'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ProductTimelineModal — opens when user clicks "Uredi Timeline" */}
            {timelineProduct && (
                <ProductTimelineModal
                    isOpen={true}
                    onClose={closeTimeline}
                    productId={timelineProduct.productId}
                    productName={timelineProduct.productName}
                    workOrderItem={{
                        ID: timelineProduct.workOrderItemId,
                        Product_ID: timelineProduct.productId,
                        Product_Name: timelineProduct.productName,
                        Work_Order_ID: timelineProduct.workOrderId,
                        Status: timelineProduct.status,
                        Product_Value: timelineProduct.sellingPrice,
                        Material_Cost: timelineProduct.materialCost,
                        Actual_Labor_Cost: timelineProduct.laborCost,
                    } as any}
                    workLogs={timelineWorkLogs.filter(wl => wl.Product_ID === timelineProduct.productId)}
                    sellingPrice={timelineProduct.sellingPrice}
                    materialCost={timelineProduct.materialCost}
                    laborCost={timelineProduct.laborCost}
                    workers={allWorkers}
                    onOverrideWorkLogs={async (entries) => {
                        if (!organizationId) return { success: false, message: 'Nedostaju podaci' };
                        const { overrideWorkLogs } = await import('@/lib/services');
                        const result = await overrideWorkLogs(
                            timelineProduct.workOrderId,
                            timelineProduct.workOrderItemId,
                            entries,
                            organizationId,
                            timelineProduct.productId
                        );
                        if (result.success) {
                            showToast?.('Timeline ažuriran', 'success');
                            closeTimeline();
                        } else {
                            showToast?.(result.message, 'error');
                        }
                        return result;
                    }}
                />
            )}

            <style jsx>{`
                .pdm-overlay {
                    position: fixed; inset: 0;
                    background: rgba(0,0,0,0.5);
                    backdrop-filter: blur(4px);
                    z-index: 999;
                    animation: fadeIn 0.2s;
                }
                .pdm-modal {
                    position: fixed;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    width: min(640px, 95vw);
                    max-height: 92vh;
                    background: #fff;
                    border-radius: 16px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
                    z-index: 1000;
                    display: flex; flex-direction: column;
                    overflow: hidden;
                    animation: slideUp 0.25s ease;
                }
                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes slideUp { from { opacity: 0; transform: translate(-50%, -48%) } to { opacity: 1; transform: translate(-50%, -50%) } }

                .pdm-header {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 18px 22px;
                    border-bottom: 1px solid #f0f0f0;
                    background: linear-gradient(135deg, #f0fdf4, #f5fdf8);
                }
                .pdm-header-left { display: flex; align-items: center; gap: 12px; }
                .pdm-header h2 { margin: 0; font-size: 16px; font-weight: 700; color: #1a1a2e; }
                .pdm-header p { margin: 2px 0 0; font-size: 12px; color: #64748b; }
                .pdm-close {
                    background: none; border: none; cursor: pointer; padding: 6px;
                    border-radius: 8px; color: #94a3b8; transition: all 0.15s;
                }
                .pdm-close:hover { background: #f1f5f9; color: #475569; }

                .pdm-summary-strip {
                    display: flex; gap: 16px; padding: 12px 22px;
                    background: #f8fafc; border-bottom: 1px solid #f0f0f0;
                    overflow-x: auto;
                }
                .pdm-stat { display: flex; flex-direction: column; gap: 1px; }
                .pdm-stat.main {
                    padding: 4px 12px; background: white;
                    border-radius: 8px; border: 1px solid #e2e8f0;
                }
                .pdm-stat .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; font-weight: 600; }
                .pdm-stat .value { font-size: 13px; font-weight: 700; color: #334155; white-space: nowrap; }
                .pdm-stat .value.green { color: #22c55e; }
                .pdm-stat .value.red { color: #ef4444; }
                .pdm-stat .value.amber { color: #f59e0b; }

                .pdm-search-row {
                    display: flex; align-items: center; gap: 8px;
                    padding: 10px 22px; border-bottom: 1px solid #f0f0f0;
                }
                .pdm-search-row input {
                    flex: 1; padding: 7px 10px; border: 1px solid #e2e8f0;
                    border-radius: 8px; font-size: 13px; color: #1e293b; outline: none;
                }
                .pdm-search-row input:focus { border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.1); }
                .pdm-refresh {
                    background: none; border: 1px solid #e2e8f0; border-radius: 8px;
                    padding: 6px 8px; cursor: pointer; color: #64748b;
                }
                .pdm-refresh:hover { background: #f1f5f9; }

                .pdm-body { flex: 1; overflow-y: auto; padding: 16px 22px; }
                .pdm-center {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    gap: 8px; padding: 40px; color: #94a3b8; font-size: 13px;
                }

                /* WO Group */
                .pdm-wo-group { margin-bottom: 16px; }
                .wo-group-header {
                    display: flex; align-items: center; gap: 8px;
                    margin-bottom: 8px; padding: 0 4px;
                }
                .wo-num { font-size: 13px; font-weight: 700; color: #0f172a; }
                .wo-type-badge {
                    font-size: 10px; font-weight: 600; text-transform: uppercase;
                    color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;
                }
                .wo-profit-badge { font-size: 12px; font-weight: 700; margin-left: auto; }
                .wo-profit-badge.green { color: #22c55e; }
                .wo-profit-badge.red { color: #ef4444; }

                /* Product Card */
                .pdm-product-card {
                    background: white; border: 1px solid #e2e8f0;
                    border-radius: 12px; margin-bottom: 8px; overflow: hidden;
                }
                .product-row {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 12px 14px; cursor: pointer; transition: background 0.1s; gap: 12px;
                }
                .product-row:hover { background: #fafffe; }
                .pr-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
                .pr-name { font-size: 13px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .pr-project { font-size: 11px; color: #94a3b8; }
                .pr-numbers { display: flex; align-items: flex-end; gap: 14px; flex-shrink: 0; }
                .pr-num { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
                .pr-label { font-size: 10px; color: #94a3b8; }
                .pr-val { font-size: 11px; font-weight: 600; color: #374151; white-space: nowrap; }
                .pr-val.bold { font-weight: 700; }
                .pr-val.green { color: #22c55e; }
                .pr-val.red { color: #ef4444; }
                .pr-val.amber { color: #f59e0b; }
                .pr-margin { font-size: 10px; font-weight: 600; }
                .pr-margin.green { color: #22c55e; }
                .pr-margin.red { color: #ef4444; }

                /* Product Detail */
                .product-detail {
                    border-top: 1px solid #f0f0f0;
                    padding: 12px 14px;
                    background: #fafffe;
                }
                .detail-empty { font-size: 12px; color: #94a3b8; text-align: center; padding: 8px; }

                /* Workers */
                .worker-list { display: flex; flex-direction: column; gap: 4px; }
                .worker-row {
                    display: flex; align-items: center; gap: 8px;
                    padding: 6px 10px; border-radius: 8px;
                    background: white; border: 1px solid #f1f5f9; font-size: 12px;
                }
                .wr-name { display: flex; align-items: center; gap: 6px; font-weight: 600; color: #0f172a; flex: 1; min-width: 0; }
                .wr-info { color: #64748b; white-space: nowrap; }
                .wr-split { color: #94a3b8; font-size: 11px; }
                .wr-total { font-weight: 700; color: #f59e0b; min-width: 65px; text-align: right; white-space: nowrap; }

                /* Edit Timeline Button */
                .edit-timeline-btn {
                    display: flex; align-items: center; justify-content: center; gap: 6px;
                    margin-top: 10px; padding: 10px; border: 1px dashed #3b82f6;
                    border-radius: 8px; background: rgba(59,130,246,0.04); cursor: pointer;
                    font-size: 13px; color: #3b82f6; font-weight: 600;
                    width: 100%; transition: all 0.15s;
                }
                .edit-timeline-btn:hover { background: rgba(59,130,246,0.08); border-style: solid; }
                .edit-timeline-btn:disabled { opacity: 0.5; cursor: wait; }

                @media (max-width: 600px) {
                    .pdm-modal { width: 100%; max-height: 100vh; border-radius: 0; }
                    .pdm-summary-strip { gap: 8px; padding: 10px 16px; flex-wrap: wrap; }
                    .pr-numbers { gap: 8px; flex-wrap: wrap; }
                    .product-row { flex-wrap: wrap; }
                    .pr-left { flex: 0 0 100%; margin-bottom: 4px; }
                    .pr-numbers { flex: 0 0 100%; justify-content: space-between; }
                }
            `}</style>
        </>
    );
}
