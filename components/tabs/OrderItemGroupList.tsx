'use client';

// ════════════════════════════════════════════════════════════════════
// STAVKE NARUDŽBE — jedan red po materijalu (desktop pregled narudžbe)
//
// Isti materijal na više pozicija se prikazuje kao JEDAN red sa zbirnom
// količinom i cijenom, abecedno (lib/orderItemGroups — isto pravilo kao
// PDF i Komandni centar). Pozicije su razrada ispod reda.
//
// Prijem ostaje po STAVCI: klik na red bira sve njegove neprimljene stavke,
// a u razradi se može izabrati ili vratiti i pojedinačna pozicija (kad
// dobavljač isporuči samo dio).
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { Order, OrderItem, Project } from '@/lib/types';
import { formatCurrency, formatDate, plural } from '@/lib/utils';
import { orderItemPricing } from '@/lib/orderPricing';
import {
    formatQty, groupOrderItems, groupPricing, productNamesLabel, productNamesResolver, type OrderItemGroup,
} from '@/lib/orderItemGroups';

interface Props {
    order: Order;
    projects: Project[];
    selectedItemIds: Set<string>;
    onSelectItems: (itemIds: string[], on: boolean) => void;
    onReceiveSelected: () => void;
    onUnreceive: (items: OrderItem[]) => void;
}

export default function OrderItemGroupList({ order, projects, selectedItemIds, onSelectItems, onReceiveSelected, onUnreceive }: Props) {
    const pricing = useMemo(() => orderItemPricing(order), [order]);
    const resolveNames = useMemo(() => productNamesResolver(projects), [projects]);
    const groups = useMemo(() => groupOrderItems(order.items, resolveNames), [order.items, resolveNames]);
    const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

    const toggleOpen = (key: string) => setOpenKeys(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    // Dugme broji REDOVE koje je korisnik izabrao, ne skrivene stavke ispod njih.
    const selectedRows = groups.filter(g => g.items.some(i => selectedItemIds.has(i.ID))).length;
    const merged = (order.items?.length || 0) - groups.length;

    return (
        <>
            <div className="products-header">
                <h4>
                    Materijali ({groups.length})
                    {merged > 0 && <span className="oi-merged-note"> · {merged} {plural(merged, 'stavka spojena', 'stavke spojene', 'stavki spojeno')} po materijalu</span>}
                </h4>
                {selectedRows > 0 && (
                    <button className="btn btn-sm btn-success" onClick={onReceiveSelected}>
                        <span className="material-icons-round">check</span>
                        Primi odabrano ({selectedRows})
                    </button>
                )}
            </div>

            {groups.map(group => (
                <GroupRow
                    key={group.key}
                    group={group}
                    pricing={pricing}
                    open={openKeys.has(group.key)}
                    onToggleOpen={() => toggleOpen(group.key)}
                    selectedItemIds={selectedItemIds}
                    onSelectItems={onSelectItems}
                    onUnreceive={onUnreceive}
                />
            ))}
        </>
    );
}

function GroupRow({ group, pricing, open, onToggleOpen, selectedItemIds, onSelectItems, onUnreceive }: {
    group: OrderItemGroup;
    pricing: ReturnType<typeof orderItemPricing>;
    open: boolean;
    onToggleOpen: () => void;
    selectedItemIds: Set<string>;
    onSelectItems: (itemIds: string[], on: boolean) => void;
    onUnreceive: (items: OrderItem[]) => void;
}) {
    const { total, unitPrice } = groupPricing(group, pricing);
    const pending = group.items.filter(i => i.Status !== 'Primljeno');
    const received = group.items.filter(i => i.Status === 'Primljeno');
    const isReceived = group.status === 'received';
    const selectedOpen = pending.filter(i => selectedItemIds.has(i.ID)).length;
    const isSelected = pending.length > 0 && selectedOpen === pending.length;
    const isPartlySelected = selectedOpen > 0 && !isSelected;
    const multi = group.items.length > 1;
    const lastReceived = received.map(i => i.Received_Date).filter(Boolean).sort().pop();

    const toggleSelect = () => {
        if (pending.length === 0) return;
        onSelectItems(pending.map(i => i.ID), !isSelected);
    };

    return (
        <div className={`oi-group${open ? ' is-open' : ''}`}>
            <div
                className={`oi-row${isReceived ? ' received' : ''}${isSelected || isPartlySelected ? ' selected' : ''}`}
                onClick={toggleSelect}
            >
                {isReceived ? (
                    <span className="oi-status" title="Primljeno">
                        <span className="material-icons-round">check_circle</span>
                    </span>
                ) : (
                    <label className="oi-check" onClick={e => e.stopPropagation()}>
                        <input
                            type="checkbox"
                            checked={isSelected}
                            ref={el => { if (el) el.indeterminate = isPartlySelected; }}
                            onChange={toggleSelect}
                        />
                    </label>
                )}

                <div className="oi-body">
                    <div className="oi-name">{group.name}</div>
                    <div className="oi-meta">
                        <span className="oi-qty">{formatQty(group.quantity)} {group.unit}</span>
                        {group.quantity > 0 && <><span className="oi-sep">·</span><span>{formatCurrency(unitPrice)}/{group.unit}</span></>}
                        {group.productNames.length > 0 && (
                            <>
                                <span className="oi-sep">·</span>
                                {multi ? (
                                    <button
                                        type="button"
                                        className="oi-group-toggle"
                                        aria-expanded={open}
                                        title={group.productNames.join(', ')}
                                        onClick={e => { e.stopPropagation(); onToggleOpen(); }}
                                    >
                                        {group.items.length} {plural(group.items.length, 'pozicija', 'pozicije', 'pozicija')}
                                        <span className="material-icons-round">{open ? 'expand_less' : 'expand_more'}</span>
                                    </button>
                                ) : (
                                    <span className="oi-prod" title={group.productNames[0]}>{productNamesLabel(group.productNames)}</span>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="oi-right">
                    <span className="oi-price">{formatCurrency(total)}</span>
                    {isReceived ? (
                        <div className="oi-recv">
                            {lastReceived && (
                                <span className="oi-recv-date">
                                    <span className="material-icons-round">event_available</span>
                                    {formatDate(lastReceived)}
                                </span>
                            )}
                            <button
                                className="oi-undo"
                                title="Poništi prijem — reklamacija, greška pri unosu ili pogrešna isporuka"
                                onClick={e => { e.stopPropagation(); onUnreceive(received); }}
                            >
                                <span className="material-icons-round">undo</span>
                                Vrati
                            </button>
                        </div>
                    ) : group.status === 'partial' ? (
                        <span className="oi-partial">primljeno {group.receivedCount}/{group.items.length}</span>
                    ) : (
                        <span className="oi-await">čeka prijem</span>
                    )}
                </div>
            </div>

            {/* Razrada po pozicijama — i pojedinačan prijem/povrat, kad stigne samo dio. */}
            {multi && open && (
                <div className="oi-breakdown">
                    {group.items.map(item => {
                        const rec = item.Status === 'Primljeno';
                        const sel = selectedItemIds.has(item.ID);
                        return (
                            <div
                                key={item.ID}
                                className={`oi-bd-row${rec ? ' received' : ''}${sel ? ' selected' : ''}`}
                                onClick={() => { if (!rec) onSelectItems([item.ID], !sel); }}
                            >
                                {rec ? (
                                    <span className="oi-bd-mark material-icons-round">check_circle</span>
                                ) : (
                                    <input
                                        type="checkbox"
                                        className="oi-bd-check"
                                        checked={sel}
                                        onClick={e => e.stopPropagation()}
                                        onChange={() => onSelectItems([item.ID], !sel)}
                                    />
                                )}
                                <span className="oi-bd-name" title={item.Product_Name}>{item.Product_Name || 'Bez pozicije'}</span>
                                <span className="oi-bd-qty">{formatQty(item.Quantity || 0)} {item.Unit}</span>
                                <span className="oi-bd-price">{formatCurrency(pricing.lineTotal(item))}</span>
                                <span className="oi-bd-state">
                                    {rec ? (
                                        <button
                                            className="oi-undo"
                                            title="Poništi prijem ove pozicije"
                                            onClick={e => { e.stopPropagation(); onUnreceive([item]); }}
                                        >
                                            <span className="material-icons-round">undo</span>
                                            Vrati
                                        </button>
                                    ) : 'čeka'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
