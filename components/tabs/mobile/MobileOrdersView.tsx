'use client';

import React, { useState, useMemo } from 'react';
import type { Order, Supplier, Project, OrderItem } from '@/lib/types';
import { ALLOWED_ORDER_TRANSITIONS } from '@/lib/types';
import { useData } from '@/context/DataContext';
import { updateOrderStatus, markOrderSent, markMaterialsReceived, markMaterialsUnreceived } from '@/lib/services';
import { formatCurrency, formatDate, plural } from '@/lib/utils';
import { orderItemPricing } from '@/lib/orderPricing';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import './MobileOrdersView.css';

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

// ── Order.Status je samo Nacrt/Poslano/Primljeno (ALLOWED_ORDER_TRANSITIONS) —
// „Djelomično" nije zaseban status u bazi, nego IZVEDEN prikaz (isti pristup
// kao postojeća .status-djelomično CSS klasa u OrdersTab.css).
type DisplayStatus = 'Nacrt' | 'Poslano' | 'Djelomično' | 'Primljeno';

function receivedCountOf(order: Order): number {
    return order.items?.filter(i => i.Status === 'Primljeno').length || 0;
}
function displayStatusOf(order: Order): DisplayStatus {
    const total = order.items?.length || 0;
    const received = receivedCountOf(order);
    if (order.Status === 'Primljeno' || (total > 0 && received === total)) return 'Primljeno';
    if (order.Status === 'Poslano' && received > 0) return 'Djelomično';
    return (order.Status as DisplayStatus) || 'Nacrt';
}
/** Isti slug kao desktop (order.Status.toLowerCase().replace(/\s+/g,'-')) — pogađa iste status-* CSS klase. */
function statusSlug(s: string): string {
    return s.toLowerCase().replace(/\s+/g, '-');
}

type ConfirmSheet = {
    title: string;
    message: string;
    confirmLabel: string;
    tone: 'primary' | 'success';
    onConfirm: () => void;
} | null;

export default function MobileOrdersView({
    orders, projects, onRefresh, onPatchOrder, showToast,
    onOpenWizard, onEditOrder, onDeleteOrder, onDownloadPDF, onPrintOrder
}: MobileOrdersViewProps) {
    const { organizationId } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'' | DisplayStatus>('');
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [statusMenuOrderId, setStatusMenuOrderId] = useState<string | null>(null);
    const [confirmSheet, setConfirmSheet] = useState<ConfirmSheet>(null);

    const filteredOrders = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return orders
            .filter(order => {
                const matchesSearch = !q ||
                    order.Order_Number?.toLowerCase().includes(q) ||
                    order.Supplier_Name?.toLowerCase().includes(q) ||
                    order.Name?.toLowerCase().includes(q);
                const matchesStatus = !statusFilter || displayStatusOf(order) === statusFilter;
                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => new Date(b.Order_Date).getTime() - new Date(a.Order_Date).getTime());
    }, [orders, searchTerm, statusFilter]);

    // Brojači po statusu za filter-čipove.
    const counts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const o of orders) { const ds = displayStatusOf(o); c[ds] = (c[ds] || 0) + 1; }
        return c;
    }, [orders]);

    const chipDefs: { key: '' | DisplayStatus; label: string }[] = [
        { key: '', label: 'Sve' },
        { key: 'Nacrt', label: 'Nacrt' },
        { key: 'Poslano', label: 'Poslano' },
        { key: 'Djelomično', label: 'Djelomično' },
        { key: 'Primljeno', label: 'Primljeno' },
    ];

    function toggleOrder(orderId: string) {
        setExpandedOrderId(prev => prev === orderId ? null : orderId);
        setStatusMenuOrderId(null);
    }

    async function applyStatusChange(orderId: string, newStatus: string, currentStatus: string) {
        setStatusMenuOrderId(null);
        onPatchOrder?.(orderId, { Status: newStatus });   // optimistično
        const result = await updateOrderStatus(orderId, newStatus, organizationId!);
        if (result.success) {
            showToast(`Status promijenjen u „${newStatus}"`, 'success');
            onRefresh('orders');
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else {
            onPatchOrder?.(orderId, { Status: currentStatus });   // rollback
            showToast(result.message, 'error');
        }
    }

    function handleStatusMenuPick(order: Order, newStatus: string) {
        if (newStatus === 'Nacrt' && order.Status === 'Poslano') {
            setConfirmSheet({
                title: 'Vratiti na nacrt?',
                message: 'Statusi materijala vratit će se na „Nije naručeno".',
                confirmLabel: 'Vrati na nacrt', tone: 'primary',
                onConfirm: () => applyStatusChange(order.Order_ID, newStatus, order.Status),
            });
            return;
        }
        if (newStatus === 'Primljeno') {
            const cnt = order.items?.filter(i => i.Status !== 'Primljeno').length || 0;
            setConfirmSheet({
                title: 'Označiti kao primljeno?',
                message: `${cnt} ${plural(cnt, 'neprimljena stavka', 'neprimljene stavke', 'neprimljenih stavki')} bit će označeno primljenim.`,
                confirmLabel: 'Primi sve', tone: 'success',
                onConfirm: () => applyStatusChange(order.Order_ID, newStatus, order.Status),
            });
            return;
        }
        applyStatusChange(order.Order_ID, newStatus, order.Status);
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

    async function doReceiveAll(order: Order) {
        const unreceivedItems = order.items?.filter(i => i.Status !== 'Primljeno') || [];
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

    function handleReceiveAll(order: Order, e: React.MouseEvent) {
        e.stopPropagation();
        const unreceivedItems = order.items?.filter(i => i.Status !== 'Primljeno') || [];
        if (unreceivedItems.length === 0) { showToast('Sve stavke su već primljene', 'info'); return; }
        if (order.Status === 'Nacrt') { showToast('Pošaljite narudžbu prije primanja stavki', 'error'); return; }
        const n = unreceivedItems.length;
        setConfirmSheet({
            title: 'Primiti sve stavke?',
            message: `${n} ${plural(n, 'stavka', 'stavke', 'stavki')} bit će označeno primljenim.`,
            confirmLabel: 'Primi sve', tone: 'success',
            onConfirm: () => doReceiveAll(order),
        });
    }

    async function handleReceiveSingleItem(item: OrderItem, order: Order, e: React.MouseEvent) {
        e.stopPropagation();
        if (order.Status === 'Nacrt') { showToast('Pošaljite narudžbu prije primanja stavki', 'error'); return; }
        const result = await markMaterialsReceived([item.ID], organizationId!);
        if (result.success) {
            showToast('Stavka primljena', 'success');
            onRefresh('orders');
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else { showToast(result.message, 'error'); }
    }

    // Poništi prijem (greška, reklamacija, pogrešna isporuka) — vrati stavku u „Naručeno".
    async function handleUnreceiveSingleItem(item: OrderItem, order: Order, e: React.MouseEvent) {
        e.stopPropagation();
        if (!confirm(`Poništiti prijem stavke „${item.Material_Name}"?\n\nVraća se u „Naručeno" — za reklamaciju, grešku ili pogrešnu isporuku.`)) return;
        const result = await markMaterialsUnreceived([item.ID], organizationId!);
        if (result.success) {
            showToast('Prijem poništen', 'success');
            onRefresh('orders');
            (result.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
        } else { showToast(result.message, 'error'); }
    }

    return (
        <div className="ov">
            {/* Pretraga + dodavanje */}
            <div className="ov-top">
                <div className="ov-search">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Traži narudžbu ili dobavljača…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button className="ov-add" onClick={onOpenWizard}>
                    <span className="material-icons-round">add</span>
                    <span className="lbl">Nova narudžba</span>
                </button>
            </div>

            {/* Statusni filteri — segmentna traka (isti jezik kao ostatak appa) */}
            <div className="ov-chiprail">
                {chipDefs.map(c => (
                    <button
                        key={c.key || 'all'}
                        className={`ov-chip ${statusFilter === c.key ? 'on' : ''}`}
                        onClick={() => setStatusFilter(c.key)}
                    >
                        {c.label}
                        <span className="n">{c.key ? (counts[c.key] || 0) : orders.length}</span>
                    </button>
                ))}
            </div>

            {/* Lista kartica */}
            {filteredOrders.length === 0 ? (
                <div className="ov-empty">
                    <span className="material-icons-round">local_shipping</span>
                    <h3>Nema narudžbi</h3>
                    <p>{searchTerm || statusFilter ? 'Promijenite filtere' : 'Dodajte prvu narudžbu'}</p>
                </div>
            ) : (
                <div className="ov-grid">
                    {filteredOrders.map(order => {
                        const isExpanded = expandedOrderId === order.Order_ID;
                        const ds = displayStatusOf(order);
                        const slug = statusSlug(ds);
                        const firstItem = order.items?.[0];
                        const projectName = firstItem?.Project_ID
                            ? projects.find(p => p.Project_ID === firstItem.Project_ID)?.Client_Name
                            : null;
                        const total = order.items?.length || 0;
                        const received = receivedCountOf(order);
                        const allReceived = total > 0 && received === total;
                        const pct = total > 0 ? Math.round((received / total) * 100) : 0;
                        const allowed = ALLOWED_ORDER_TRANSITIONS[order.Status] || [];
                        // Statusna ivica + suptilan gradijent — isti obrazac kao WorkOrderCard.
                        const edgeColor = ds === 'Primljeno' ? 'var(--success)' : ds === 'Poslano' ? 'var(--accent)'
                            : ds === 'Djelomično' ? 'var(--warning)' : 'var(--text-tertiary)';

                        return (
                            <div
                                key={order.Order_ID}
                                className={`ov-card ${isExpanded ? 'open' : ''}`}
                                style={{ borderLeft: `3px solid ${edgeColor}` }}
                                onClick={() => toggleOrder(order.Order_ID)}
                            >
                                {/* Zaglavlje */}
                                <div className="ov-h">
                                    <div className="ov-h-t">
                                        <div className="ov-name-row">
                                            <span className="ov-name">{order.Name || `Narudžba ${order.Order_Number}`}</span>
                                            <span className="order-number-chip">{order.Order_Number}</span>
                                        </div>
                                        <div className="ov-supp">
                                            <span className="main"><span className="material-icons-round">storefront</span>{order.Supplier_Name}</span>
                                            {projectName && (
                                                <span className="order-meta-cell"><span className="material-icons-round">folder</span>{projectName}</span>
                                            )}
                                            <span className="order-meta-cell"><span className="material-icons-round">calendar_today</span>{formatDate(order.Order_Date)}</span>
                                        </div>
                                    </div>
                                    <div onClick={e => e.stopPropagation()}>
                                        <DropdownMenu trigger={
                                            <button className="icon-btn-custom"><span className="material-icons-round">more_vert</span></button>
                                        }>
                                            <div className="dropdown-item" onClick={() => onEditOrder(order)}>
                                                <span className="material-icons-round" style={{ fontSize: 18 }}>edit</span>Uredi
                                            </div>
                                            <div className="dropdown-item" onClick={() => onDownloadPDF(order)}>
                                                <span className="material-icons-round" style={{ fontSize: 18 }}>picture_as_pdf</span>Preuzmi PDF
                                            </div>
                                            <div className="dropdown-item" onClick={() => onPrintOrder(order)}>
                                                <span className="material-icons-round" style={{ fontSize: 18 }}>print</span>Printaj
                                            </div>
                                            {order.Status === 'Nacrt' && (
                                                <div className="dropdown-item" onClick={() => handleSendOrder(order.Order_ID)}>
                                                    <span className="material-icons-round" style={{ fontSize: 18 }}>send</span>Pošalji
                                                </div>
                                            )}
                                            <div className="dropdown-item danger" onClick={() => onDeleteOrder(order.Order_ID)}>
                                                <span className="material-icons-round" style={{ fontSize: 18 }}>delete</span>Obriši
                                            </div>
                                        </DropdownMenu>
                                    </div>
                                </div>

                                {/* Prijem */}
                                <div className="ov-prog">
                                    {total > 0 && order.Status !== 'Nacrt' ? (
                                        <>
                                            <div className="ov-prog-top"><span>Primljeno</span><strong>{received}/{total}</strong></div>
                                            <div className="order-progress-track"><div className={`order-progress-fill ${allReceived ? 'complete' : ds === 'Djelomično' ? 'partial' : ''}`} style={{ width: `${pct}%` }} /></div>
                                        </>
                                    ) : (
                                        <div className="ov-prog-none">
                                            {order.Status === 'Nacrt' ? 'Još nije poslano dobavljaču' : 'Bez stavki'}
                                        </div>
                                    )}
                                </div>

                                {/* Podnožje: iznos + status + radnja */}
                                <div className="ov-foot" onClick={e => e.stopPropagation()}>
                                    <div className="ov-amount">{formatCurrency(order.Total_Amount || 0)}</div>
                                    <div className="sp" />
                                    <div className="ov-status-wrap">
                                        <span
                                            className={`status-badge-custom status-${slug}`}
                                            style={{ cursor: allowed.length > 0 ? 'pointer' : 'default' }}
                                            onClick={() => { if (allowed.length > 0) setStatusMenuOrderId(statusMenuOrderId === order.Order_ID ? null : order.Order_ID); }}
                                        >
                                            {ds}
                                            {allowed.length > 0 && <span className="material-icons-round" style={{ fontSize: 14, marginLeft: 2 }}>expand_more</span>}
                                        </span>
                                        {statusMenuOrderId === order.Order_ID && (
                                            <div className="ov-status-menu">
                                                {allowed.map(ts => (
                                                    <button key={ts} className={`ov-status-item ${ts === 'Nacrt' ? 'danger' : ''}`}
                                                        onClick={() => handleStatusMenuPick(order, ts)}>
                                                        {ts}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {ds === 'Nacrt' ? (
                                        <button className="ov-act send" onClick={() => handleSendOrder(order.Order_ID)}>
                                            <span className="material-icons-round">send</span>Pošalji
                                        </button>
                                    ) : !allReceived ? (
                                        <button className="ov-act receive" onClick={(e) => handleReceiveAll(order, e)}>
                                            <span className="material-icons-round">check_circle</span>Primi
                                        </button>
                                    ) : null}
                                </div>

                                {/* Proširene stavke */}
                                {isExpanded && (
                                    <div className="ov-items" onClick={e => e.stopPropagation()}>
                                        <div className="ov-items-h">Stavke · {total}</div>
                                        {(() => { const pricing = orderItemPricing(order); return [...(order.items || [])].sort((a, b) => (a.Material_Name || '').localeCompare(b.Material_Name || '', 'hr')).map(item => {
                                            const isReceived = item.Status === 'Primljeno';
                                            const qty = item.Quantity || 0;
                                            const unitPrice = pricing.unitPrice(item);
                                            return (
                                                <div key={item.ID} className={`ov-item ${isReceived ? 'rec' : ''}`}>
                                                    <div className="ov-item-info">
                                                        <div className="ov-item-name">{item.Material_Name}</div>
                                                        <div className="ov-item-dim">
                                                            {qty} {item.Unit} · {formatCurrency(unitPrice)}/{item.Unit}
                                                            {item.Product_Name ? ` · ${item.Product_Name}` : ''}
                                                        </div>
                                                    </div>
                                                    <div className="ov-item-right">
                                                        <div className="ov-item-price">{formatCurrency(pricing.lineTotal(item))}</div>
                                                        {isReceived ? (
                                                            <button className="ov-unrecv-btn" title="Poništi prijem (reklamacija, greška, pogrešna isporuka)" onClick={(e) => handleUnreceiveSingleItem(item, order, e)}>
                                                                <span className="material-icons-round">undo</span>
                                                            </button>
                                                        ) : (
                                                            <button className="ov-recv-btn" onClick={(e) => handleReceiveSingleItem(item, order, e)}>Primi</button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }); })()}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* FAB (telefon) */}
            <button className="ov-fab" onClick={onOpenWizard}>
                <span className="material-icons-round">add</span>
            </button>

            {/* Bottom-sheet potvrda */}
            {confirmSheet && (
                <div className="ov-sheet-overlay" onClick={() => setConfirmSheet(null)}>
                    <div className="ov-sheet" onClick={e => e.stopPropagation()}>
                        <h4>{confirmSheet.title}</h4>
                        <p>{confirmSheet.message}</p>
                        <div className="ov-sheet-actions">
                            <button className="ov-sheet-btn ghost" onClick={() => setConfirmSheet(null)}>Odustani</button>
                            <button className={`ov-sheet-btn ${confirmSheet.tone}`}
                                onClick={() => { const fn = confirmSheet.onConfirm; setConfirmSheet(null); fn(); }}>
                                {confirmSheet.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
