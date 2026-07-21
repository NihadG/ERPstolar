'use client';

import React, { useState, useMemo } from 'react';
import type { Order, Supplier, Project, OrderItem } from '@/lib/types';
import { ORDER_STATUSES, ALLOWED_ORDER_TRANSITIONS } from '@/lib/types';
import { useData } from '@/context/DataContext';
import { updateOrderStatus, markOrderSent, markMaterialsReceived } from '@/lib/services';
import { formatCurrency, formatDate } from '@/lib/utils';
import { DropdownMenu } from '@/components/ui/DropdownMenu';

interface MobileOrdersViewProps {
    orders: Order[];
    suppliers: Supplier[];
    projects: Project[];
    onRefresh: (...collections: string[]) => void;
    onPatchOrder?: (orderId: string, partial: Partial<Order>) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onOpenWizard: () => void;
    onEditOrder: (order: Order) => void;
    onDeleteOrder: (orderId: string) => void;
    onDownloadPDF: (order: Order) => void;
    onPrintOrder: (order: Order) => void;
}

/* ─── shared inline-style objects ─── */
const S = {
    page: {
        padding: '16px 16px 100px 16px',
        backgroundColor: '#f8fafc',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    } as React.CSSProperties,
    headerSection: { display: 'flex', gap: 12, marginBottom: 16 } as React.CSSProperties,
    searchBar: {
        flex: 1, height: 48, background: 'white', borderRadius: 14,
        display: 'flex', alignItems: 'center', padding: '0 16px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9',
    } as React.CSSProperties,
    searchIcon: { color: '#94a3b8', fontSize: 20 } as React.CSSProperties,
    searchInput: {
        border: 'none', background: 'transparent', width: '100%', height: '100%',
        marginLeft: 10, fontSize: 15, outline: 'none', color: '#1e293b',
    } as React.CSSProperties,
    topAddBtn: {
        width: 48, height: 48, background: '#2563eb', color: 'white', border: 'none',
        borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(37,99,235,0.2)',
    } as React.CSSProperties,
    filtersScroll: {
        display: 'flex', gap: 8, overflowX: 'auto' as const, paddingBottom: 8,
        marginBottom: 16, WebkitOverflowScrolling: 'touch' as const,
        scrollbarWidth: 'none' as const,
    } as React.CSSProperties,
    filterPill: {
        whiteSpace: 'nowrap' as const, padding: '8px 16px', borderRadius: 20,
        border: '1px solid #e2e8f0', background: 'white', color: '#64748b',
        fontSize: 14, fontWeight: 500, transition: 'all 0.2s ease',
    } as React.CSSProperties,
    filterPillActive: {
        whiteSpace: 'nowrap' as const, padding: '8px 16px', borderRadius: 20,
        border: '1px solid #1e293b', background: '#1e293b', color: 'white',
        fontSize: 14, fontWeight: 500, transition: 'all 0.2s ease',
    } as React.CSSProperties,
    list: { display: 'flex', flexDirection: 'column' as const, gap: 16 },
    card: {
        background: 'white', borderRadius: 16, padding: 16,
        boxShadow: '0 4px 15px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9',
        transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', position: 'relative' as const,
    } as React.CSSProperties,
    cardExpanded: {
        background: 'white', borderRadius: 16, padding: 16,
        boxShadow: '0 8px 25px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0',
        transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', position: 'relative' as const,
    } as React.CSSProperties,
    titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 } as React.CSSProperties,
    orderTitle: { display: 'flex', alignItems: 'center', gap: 6 } as React.CSSProperties,
    orderName: { fontSize: 16, fontWeight: 700, color: '#0f172a' } as React.CSSProperties,
    orderNum: { fontSize: 12, color: '#94a3b8', fontWeight: 500 } as React.CSSProperties,
    date: { fontSize: 12, color: '#64748b', background: '#f8fafc', padding: '4px 8px', borderRadius: 8 } as React.CSSProperties,
    supplierRow: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 16 } as React.CSSProperties,
    metaLine: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' } as React.CSSProperties,
    tinyIcon: { fontSize: 14, color: '#94a3b8' } as React.CSSProperties,
    cardBody: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: 16 } as React.CSSProperties,
    totalAmount: { fontSize: 18, fontWeight: 700, color: '#0f172a' } as React.CSSProperties,
    statusActions: { display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties,
    statusWrapper: { position: 'relative' as const } as React.CSSProperties,
    statusDropdown: {
        position: 'absolute' as const, bottom: '100%', right: 0, marginBottom: 8,
        background: 'white', borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
        border: '1px solid #e2e8f0', overflow: 'hidden', zIndex: 50, minWidth: 140,
        display: 'flex', flexDirection: 'column' as const,
    } as React.CSSProperties,
    statusDDBtn: {
        padding: '12px 16px', textAlign: 'left' as const, background: 'transparent',
        border: 'none', borderBottom: '1px solid #f1f5f9', fontSize: 13, fontWeight: 500, color: '#334155', cursor: 'pointer',
    } as React.CSSProperties,
    quickActions: { display: 'flex', gap: 8 } as React.CSSProperties,
    iconBtnSuccess: {
        width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center',
        justifyContent: 'center', border: 'none', background: '#dcfce7', color: '#16a34a', cursor: 'pointer',
    } as React.CSSProperties,
    iconBtnDefault: {
        width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center',
        justifyContent: 'center', border: 'none', background: '#f1f5f9', color: '#64748b', cursor: 'pointer',
    } as React.CSSProperties,
    expandedSection: { marginTop: 16, paddingTop: 16, borderTop: '1px dashed #e2e8f0' } as React.CSSProperties,
    itemsHeader: { fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 12 } as React.CSSProperties,
    itemsList: { display: 'flex', flexDirection: 'column' as const, gap: 12 } as React.CSSProperties,
    item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: 12, borderRadius: 12 } as React.CSSProperties,
    itemMain: { flex: 1, paddingRight: 12 } as React.CSSProperties,
    itemName: { fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 4 } as React.CSSProperties,
    itemQty: { fontSize: 12, color: '#64748b' } as React.CSSProperties,
    itemRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: 6 } as React.CSSProperties,
    itemPrice: { fontSize: 13, fontWeight: 700, color: '#0f172a' } as React.CSSProperties,
    successIcon: { color: '#10b981', fontSize: 20 } as React.CSSProperties,
    receiveBtn: { padding: '4px 10px', background: '#e0e7ff', color: '#4f46e5', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
    empty: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' as const, color: '#94a3b8' } as React.CSSProperties,
    emptyIcon: { fontSize: 48, marginBottom: 16, color: '#cbd5e1' } as React.CSSProperties,
    emptyH3: { fontSize: 18, fontWeight: 600, color: '#475569', marginBottom: 8, margin: 0 } as React.CSSProperties,
    emptyP: { fontSize: 14, margin: 0 } as React.CSSProperties,
    fab: {
        position: 'fixed' as const, bottom: 88, right: 24, width: 56, height: 56,
        borderRadius: 28, background: '#0f172a', color: 'white', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 10px 25px rgba(15,23,42,0.3)', zIndex: 100, cursor: 'pointer',
    } as React.CSSProperties,
    fabIcon: { fontSize: 28 } as React.CSSProperties,
};

export default function MobileOrdersView({
    orders, suppliers, projects, onRefresh, onPatchOrder, showToast,
    onOpenWizard, onEditOrder, onDeleteOrder, onDownloadPDF, onPrintOrder
}: MobileOrdersViewProps) {
    const { organizationId } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [statusDropdownOrderId, setStatusDropdownOrderId] = useState<string | null>(null);

    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            const matchesSearch = !searchTerm.trim() ||
                order.Order_Number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.Supplier_Name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.Name?.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = !statusFilter || order.Status === statusFilter;
            return matchesSearch && matchesStatus;
        }).sort((a, b) => new Date(b.Order_Date).getTime() - new Date(a.Order_Date).getTime());
    }, [orders, searchTerm, statusFilter]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Nacrt': return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
            case 'Poslano': return { bg: '#dbeafe', color: '#2563eb', border: '#bfdbfe' };
            case 'Potvrđeno': return { bg: '#fef3c7', color: '#d97706', border: '#fde68a' };
            case 'Djelomično primljeno': return { bg: '#e0e7ff', color: '#4f46e5', border: '#c7d2fe' };
            case 'Primljeno': return { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' };
            case 'Otkazano': return { bg: '#fee2e2', color: '#dc2626', border: '#fecaca' };
            default: return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
        }
    };

    function toggleOrder(orderId: string) {
        setExpandedOrderId(prev => prev === orderId ? null : orderId);
        setStatusDropdownOrderId(null);
    }

    async function handleOrderStatusChange(orderId: string, newStatus: string, currentStatus: string) {
        if (newStatus === 'Nacrt' && currentStatus === 'Poslano') {
            if (!confirm('Vraćanje na "Nacrt" će resetirati statuse materijala na "Nije naručeno". Nastaviti?')) return;
        }
        if (newStatus === 'Primljeno') {
            const order = orders.find(o => o.Order_ID === orderId);
            const cnt = order?.items?.filter(i => i.Status !== 'Primljeno').length || 0;
            if (!confirm('Ovo će označiti svih ' + cnt + ' neprimljenih stavki kao primljene. Nastaviti?')) return;
        }
        if (newStatus === 'Poslano') {
            const order = orders.find(o => o.Order_ID === orderId);
            if (!order?.items || order.items.length === 0) {
                showToast('Narudžba nema stavki za slanje', 'error');
                return;
            }
        }
        setStatusDropdownOrderId(null);
        onPatchOrder?.(orderId, { Status: newStatus });   // optimistično: badge odmah
        const result = await updateOrderStatus(orderId, newStatus, organizationId!);
        if (result.success) {
            showToast('Status promijenjen u "' + newStatus + '"', 'success');
            onRefresh('orders');
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else {
            onPatchOrder?.(orderId, { Status: currentStatus });   // rollback
            showToast(result.message, 'error');
        }
    }

    async function handleSendOrder(orderId: string) {
        const order = orders.find(o => o.Order_ID === orderId);
        if (!order?.items || order.items.length === 0) {
            showToast('Narudžba nema stavki za slanje', 'error');
            return;
        }
        const prevStatus = order.Status;
        onPatchOrder?.(orderId, { Status: 'Poslano' });   // optimistično
        const result = await markOrderSent(orderId, organizationId!);
        if (result.success) {
            showToast('Narudžba poslana', 'success');
            onRefresh('orders');
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else {
            onPatchOrder?.(orderId, { Status: prevStatus });   // rollback
            showToast(result.message, 'error');
        }
    }

    async function handleQuickReceiveAll(order: Order, e: React.MouseEvent) {
        e.stopPropagation();
        const unreceivedItems = order.items?.filter(i => i.Status !== 'Primljeno') || [];
        if (unreceivedItems.length === 0) { showToast('Sve stavke su već primljene', 'info'); return; }
        if (order.Status === 'Nacrt') { showToast('Narudžba mora biti poslana prije primanja stavki', 'error'); return; }
        if (!confirm('Primiti svih ' + unreceivedItems.length + ' neprimljenih stavki?')) return;
        // Optimistično: sve stavke primljene → narudžba 'Primljeno'
        const prevStatus = order.Status;
        const prevItems = order.items;
        const nowIso = new Date().toISOString();
        onPatchOrder?.(order.Order_ID, {
            Status: 'Primljeno',
            items: (order.items || []).map(i => i.Status === 'Primljeno' ? i : { ...i, Status: 'Primljeno', Received_Date: nowIso }),
        });
        const result = await markMaterialsReceived(unreceivedItems.map(i => i.ID), organizationId!);
        if (result.success) {
            showToast('Sve stavke primljene', 'success');
            onRefresh('orders');
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else {
            onPatchOrder?.(order.Order_ID, { Status: prevStatus, items: prevItems });
            showToast(result.message, 'error');
        }
    }

    async function handleReceiveSingleItem(item: OrderItem, order: Order, e: React.MouseEvent) {
        e.stopPropagation();
        if (order.Status === 'Nacrt') { showToast('Narudžba mora biti poslana prije primanja stavki', 'error'); return; }
        const result = await markMaterialsReceived([item.ID], organizationId!);
        if (result.success) {
            showToast('Stavka primljena', 'success');
            onRefresh('orders');
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else { showToast(result.message, 'error'); }
    }

    return (
        <div style={S.page}>
            {/* Header / Search */}
            <div style={S.headerSection}>
                <div style={S.searchBar}>
                    <span className="material-icons-round" style={S.searchIcon}>search</span>
                    <input
                        style={S.searchInput}
                        type="text"
                        placeholder="Traži po broju, dobavljaču..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button style={S.topAddBtn} onClick={onOpenWizard}>
                    <span className="material-icons-round">add</span>
                </button>
            </div>

            {/* Filter Pills */}
            <div style={S.filtersScroll}>
                <button
                    style={statusFilter === '' ? S.filterPillActive : S.filterPill}
                    onClick={() => setStatusFilter('')}
                >Sve</button>
                {ORDER_STATUSES.map(status => (
                    <button
                        key={status}
                        style={statusFilter === status ? S.filterPillActive : S.filterPill}
                        onClick={() => setStatusFilter(status)}
                    >{status}</button>
                ))}
            </div>

            {/* Orders List */}
            <div style={S.list}>
                {filteredOrders.length === 0 ? (
                    <div style={S.empty}>
                        <span className="material-icons-round" style={S.emptyIcon}>local_shipping</span>
                        <h3 style={S.emptyH3}>Nema narudžbi</h3>
                        <p style={S.emptyP}>Promijenite filtere ili dodajte novu.</p>
                    </div>
                ) : (
                    filteredOrders.map(order => {
                        const isExpanded = expandedOrderId === order.Order_ID;
                        const sc = getStatusColor(order.Status);
                        const firstItem = order.items?.[0];
                        const projectName = firstItem?.Project_ID
                            ? projects.find(p => p.Project_ID === firstItem.Project_ID)?.Client_Name
                            : null;
                        const unreceivedCount = order.items?.filter(i => i.Status !== 'Primljeno').length || 0;
                        const allReceived = order.items && order.items.length > 0 && unreceivedCount === 0;

                        return (
                            <div key={order.Order_ID} style={isExpanded ? S.cardExpanded : S.card} onClick={() => toggleOrder(order.Order_ID)}>
                                {/* Card Header */}
                                <div>
                                    <div style={S.titleRow}>
                                        <div style={S.orderTitle}>
                                            <span style={S.orderName}>{order.Name || ('#' + order.Order_Number)}</span>
                                            {order.Name && <span style={S.orderNum}>#{order.Order_Number}</span>}
                                        </div>
                                        <div style={S.date}>{formatDate(order.Order_Date)}</div>
                                    </div>
                                    <div style={S.supplierRow}>
                                        <span style={S.metaLine}>
                                            <span className="material-icons-round" style={S.tinyIcon}>storefront</span>
                                            {order.Supplier_Name}
                                        </span>
                                        {projectName && (
                                            <span style={S.metaLine}>
                                                <span className="material-icons-round" style={S.tinyIcon}>folder</span>
                                                {projectName}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Card Body */}
                                <div style={S.cardBody}>
                                    <div style={S.totalAmount}>{formatCurrency(order.Total_Amount || 0)}</div>
                                    <div style={S.statusActions} onClick={e => e.stopPropagation()}>
                                        <div style={S.statusWrapper}>
                                            <button
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    fontSize: 12, fontWeight: 600, padding: '6px 10px',
                                                    borderRadius: 10, transition: 'all 0.2s', cursor: 'pointer',
                                                    backgroundColor: sc.bg, color: sc.color,
                                                    border: '1px solid ' + sc.border,
                                                }}
                                                onClick={() => {
                                                    const allowed = ALLOWED_ORDER_TRANSITIONS[order.Status] || [];
                                                    if (allowed.length > 0) {
                                                        setStatusDropdownOrderId(statusDropdownOrderId === order.Order_ID ? null : order.Order_ID);
                                                    }
                                                }}
                                            >
                                                {order.Status}
                                                {(ALLOWED_ORDER_TRANSITIONS[order.Status] || []).length > 0 && (
                                                    <span className="material-icons-round" style={{ fontSize: 16 }}>expand_more</span>
                                                )}
                                            </button>

                                            {statusDropdownOrderId === order.Order_ID && (
                                                <div style={S.statusDropdown}>
                                                    {(ALLOWED_ORDER_TRANSITIONS[order.Status] || []).map(ts => (
                                                        <button
                                                            key={ts}
                                                            style={{ ...S.statusDDBtn, color: ts === 'Nacrt' ? '#ef4444' : '#334155' }}
                                                            onClick={() => handleOrderStatusChange(order.Order_ID, ts, order.Status)}
                                                        >{ts}</button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div style={S.quickActions}>
                                            {!allReceived && order.Status !== 'Nacrt' && (
                                                <button style={S.iconBtnSuccess} onClick={(e) => handleQuickReceiveAll(order, e)}>
                                                    <span className="material-icons-round">check_circle</span>
                                                </button>
                                            )}
                                            <DropdownMenu trigger={
                                                <button style={S.iconBtnDefault}>
                                                    <span className="material-icons-round">more_vert</span>
                                                </button>
                                            }>
                                                <div className="dropdown-item" onClick={() => onEditOrder(order)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>edit</span>
                                                    Uredi
                                                </div>
                                                <div className="dropdown-item" onClick={() => onDownloadPDF(order)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>picture_as_pdf</span>
                                                    Preuzmi PDF
                                                </div>
                                                <div className="dropdown-item" onClick={() => onPrintOrder(order)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>print</span>
                                                    Printaj
                                                </div>
                                                {order.Status === 'Nacrt' && (
                                                    <div className="dropdown-item" onClick={() => handleSendOrder(order.Order_ID)}>
                                                        <span className="material-icons-round" style={{ fontSize: 18 }}>send</span>
                                                        Pošalji
                                                    </div>
                                                )}
                                                <div className="dropdown-item danger" onClick={() => onDeleteOrder(order.Order_ID)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>delete</span>
                                                    Obriši
                                                </div>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Items */}
                                {isExpanded && (
                                    <div style={S.expandedSection}>
                                        <div style={S.itemsHeader}>
                                            <span>Stavke ({order.items?.length || 0})</span>
                                        </div>
                                        <div style={S.itemsList}>
                                            {[...(order.items || [])].sort((a, b) => (a.Material_Name || '').localeCompare(b.Material_Name || '', 'hr')).map(item => {
                                                const isReceived = item.Status === 'Primljeno';
                                                return (
                                                    <div key={item.ID} style={S.item}>
                                                        <div style={S.itemMain}>
                                                            <div style={S.itemName}>{item.Material_Name}</div>
                                                            <div style={S.itemQty}>{item.Quantity} {item.Unit}</div>
                                                        </div>
                                                        <div style={S.itemRight} onClick={e => e.stopPropagation()}>
                                                            <div style={S.itemPrice}>{formatCurrency(item.Expected_Price)}</div>
                                                            {isReceived ? (
                                                                <span className="material-icons-round" style={S.successIcon}>check_circle</span>
                                                            ) : (
                                                                <button style={S.receiveBtn} onClick={(e) => handleReceiveSingleItem(item, order, e)}>
                                                                    Primi
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Floating Action Button */}
            <button style={S.fab} onClick={onOpenWizard}>
                <span className="material-icons-round" style={S.fabIcon}>add</span>
            </button>
        </div>
    );
}
