'use client';

// ════════════════════════════════════════════════════════════════════
// NARUDŽBE — mobilni prikaz (lista)
//
// Zasebne kartice: narudžba nosi status, dobavljača, iznos i napredak
// prijema — u zbijenoj listi se to stapa. Dodir otvara MobileOrderDetail,
// gdje se roba čekira pri istovaru.
// ════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { Plus, Send, ShoppingCart, ArrowUpDown } from 'lucide-react';
import type { Order, Supplier, Project } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { markOrderSent } from '@/lib/services';
import { useData } from '@/context/DataContext';
import MobileOrderDetail from './MobileOrderDetail';
import {
    MLarge, MSearch, MChips, MSection, MCard, MCardHead, MCardBody, MIcon,
    MPill, MProgress, MEmpty, MButton, MSheet, MList, MOption,
} from './MobileUI';
import { useMobileSort, sortLabel, type SortKey, type GroupKey } from './useMobileSort';
import './MobileUI.css';

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

// „Djelomično" nije status u bazi nego IZVEDEN prikaz (kao i na desktopu).
type DisplayStatus = 'Nacrt' | 'Poslano' | 'Djelomično' | 'Primljeno';

function displayStatusOf(order: Order): DisplayStatus {
    const total = order.items?.length || 0;
    const received = order.items?.filter(i => i.Status === 'Primljeno').length || 0;
    if (order.Status === 'Primljeno' || (total > 0 && received === total)) return 'Primljeno';
    if (order.Status === 'Poslano' && received > 0) return 'Djelomično';
    return (order.Status as DisplayStatus) || 'Nacrt';
}

const statusTone = (s: DisplayStatus) =>
    s === 'Primljeno' ? 'green' : s === 'Poslano' ? 'blue' : s === 'Djelomično' ? 'orange' : 'gray';

export default function MobileOrdersView({
    orders, projects, onRefresh, onPatchOrder, showToast,
    onOpenWizard, onEditOrder, onDeleteOrder, onDownloadPDF, onPrintOrder,
}: MobileOrdersViewProps) {
    const { organizationId } = useData();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<'' | DisplayStatus>('');
    const [openId, setOpenId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const sort = useMobileSort('narudzbe', 'datum');

    const counts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const o of orders) { const ds = displayStatusOf(o); c[ds] = (c[ds] || 0) + 1; }
        return c;
    }, [orders]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = orders.filter(o => {
            const matchQ = !q
                || o.Order_Number?.toLowerCase().includes(q)
                || o.Supplier_Name?.toLowerCase().includes(q)
                || o.Name?.toLowerCase().includes(q);
            return matchQ && (!status || displayStatusOf(o) === status);
        });
        return sort.apply(list, {
            naziv: o => (o.Name || o.Order_Number || '').toLowerCase(),
            datum: o => -new Date(o.Order_Date).getTime(),
            vrijednost: o => -(o.Total_Amount || 0),
            status: o => displayStatusOf(o),
        });
    }, [orders, search, status, sort]);

    const groups = useMemo(() => sort.group(filtered, {
        status: o => displayStatusOf(o),
        dobavljac: o => o.Supplier_Name || 'Bez dobavljača',
    }), [filtered, sort]);

    const openOrder = openId ? orders.find(o => o.Order_ID === openId) : null;

    const sendOrder = async (order: Order) => {
        if (!order.items || order.items.length === 0) {
            showToast('Narudžba nema stavki za slanje', 'error');
            return;
        }
        const prev = order.Status;
        setBusyId(order.Order_ID);
        onPatchOrder?.(order.Order_ID, { Status: 'Poslano' });
        try {
            const res = await markOrderSent(order.Order_ID, organizationId!);
            if (res.success) {
                showToast('Narudžba poslana', 'success');
                onRefresh('orders');
                (res.postCascade ?? Promise.resolve()).finally(() => onRefresh('projects'));
            } else {
                onPatchOrder?.(order.Order_ID, { Status: prev });
                showToast(res.message, 'error');
            }
        } catch {
            onPatchOrder?.(order.Order_ID, { Status: prev });
            showToast('Greška pri slanju narudžbe', 'error');
        } finally { setBusyId(null); }
    };

    const renderCard = (order: Order) => {
        const items = order.items || [];
        const total = items.length;
        const received = items.filter(i => i.Status === 'Primljeno').length;
        const pct = total > 0 ? Math.round((received / total) * 100) : 0;
        const ds = displayStatusOf(order);
        const isDraft = ds === 'Nacrt';
        const allReceived = total > 0 && received === total;
        const projectName = items[0]?.Project_ID
            ? projects.find(p => p.Project_ID === items[0].Project_ID)?.Client_Name
            : undefined;

        return (
            <MCard key={order.Order_ID} onClick={() => setOpenId(order.Order_ID)}>
                <MCardHead>
                    <MIcon tone={statusTone(ds)}><ShoppingCart size={20} /></MIcon>
                    <MCardBody
                        name={order.Name || `Narudžba ${order.Order_Number}`}
                        meta={<>
                            <MPill tone={statusTone(ds)}>{ds}</MPill>
                            <span>{order.Supplier_Name || 'bez dobavljača'}{projectName ? ` · ${projectName}` : ''}</span>
                        </>}
                    />
                    <span className="mui-ec-val mui-num">{formatCurrency(order.Total_Amount || 0)}</span>
                </MCardHead>

                {isDraft ? (
                    <div className="mui-ec-foot">
                        <span className="mui-barl mui-dim">Još nije poslano dobavljaču</span>
                        <div className="mui-spacer" />
                        <button type="button" className="mui-actbtn" disabled={busyId === order.Order_ID}
                            onClick={(e) => { e.stopPropagation(); sendOrder(order); }}>
                            <Send size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Pošalji
                        </button>
                    </div>
                ) : total === 0 ? (
                    <div className="mui-ec-foot"><span className="mui-barl mui-dim">Bez stavki</span></div>
                ) : (
                    <MProgress
                        pct={pct}
                        tone={allReceived ? 'green' : ds === 'Djelomično' ? 'orange' : undefined}
                        label={<>Primljeno <b>{received}/{total}</b></>}
                    />
                )}
            </MCard>
        );
    };

    return (
        <div className="mui">
            <MLarge title="Narudžbe">
                {orders.length} {orders.length === 1 ? 'narudžba' : 'narudžbi'}
                {counts['Nacrt'] ? ` · ${counts['Nacrt']} za slanje` : ''}
            </MLarge>

            <div className="mui-stack mui-gap10" style={{ paddingBottom: 4 }}>
                <MSearch value={search} onChange={setSearch} placeholder="Traži narudžbu ili dobavljača…" />
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="mui-chip" onClick={sort.open}>
                        <ArrowUpDown size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                        {sortLabel(sort.sortKey, sort.groupKey)}
                    </button>
                    <div className="mui-spacer" />
                    <button type="button" className="mui-chip on" onClick={onOpenWizard}>
                        <Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Nova
                    </button>
                </div>
            </div>

            <MChips
                value={status}
                onChange={setStatus}
                options={[
                    { id: '' as const, label: 'Sve', count: orders.length },
                    { id: 'Nacrt' as const, label: 'Nacrt', count: counts['Nacrt'] || 0 },
                    { id: 'Poslano' as const, label: 'Poslano', count: counts['Poslano'] || 0 },
                    { id: 'Djelomično' as const, label: 'Djelomično', count: counts['Djelomično'] || 0 },
                    { id: 'Primljeno' as const, label: 'Primljeno', count: counts['Primljeno'] || 0 },
                ]}
            />

            {filtered.length === 0 ? (
                <MEmpty
                    title="Nema narudžbi"
                    sub={search || status ? 'Promijeni pretragu ili filter.' : 'Kreiraj prvu narudžbu.'}
                >
                    {!search && !status && (
                        <div style={{ width: '100%', paddingTop: 14 }}>
                            <MButton variant="filled" onClick={onOpenWizard}><Plus size={19} /> Nova narudžba</MButton>
                        </div>
                    )}
                </MEmpty>
            ) : groups ? (
                groups.map(g => (
                    <div key={g.key}>
                        <MSection title={g.key} right={<span className="mui-dim">{g.rows.length}</span>} />
                        <div className="mui-elist">{g.rows.map(renderCard)}</div>
                    </div>
                ))
            ) : (
                <div className="mui-elist">{filtered.map(renderCard)}</div>
            )}

            <MSheet open={sort.isOpen} title="Sortiraj i grupiši" onClose={sort.close}>
                <div className="mui-shd"><span>Sortiraj po</span></div>
                <MList>
                    {(['naziv', 'datum', 'vrijednost', 'status'] as SortKey[]).map(k => (
                        <MOption key={k} label={sortLabel(k)} selected={sort.sortKey === k} onClick={() => sort.setSortKey(k)} />
                    ))}
                </MList>
                <div className="mui-shd"><span>Grupiši po</span></div>
                <MList>
                    {([null, 'status', 'dobavljac'] as (GroupKey | null)[]).map(k => (
                        <MOption key={k || 'none'} label={k ? sortLabel(undefined, k) : 'Bez grupisanja'}
                            selected={sort.groupKey === k} onClick={() => sort.setGroupKey(k)} />
                    ))}
                </MList>
            </MSheet>

            {openOrder && (
                <MobileOrderDetail
                    order={openOrder}
                    projects={projects}
                    onClose={() => setOpenId(null)}
                    onRefresh={onRefresh}
                    onPatchOrder={onPatchOrder}
                    showToast={showToast}
                    onEdit={onEditOrder}
                    onDelete={onDeleteOrder}
                    onDownloadPDF={onDownloadPDF}
                    onPrint={onPrintOrder}
                />
            )}
        </div>
    );
}
