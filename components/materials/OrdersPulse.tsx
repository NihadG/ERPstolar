'use client';

// ════════════════════════════════════════════════════════════════════
// PULS NARUDŽBI — vrh taba Narudžbe: šta kasni, šta je na putu i šta
// nalozi u toku trebaju uskoro (kapije ≤ 2 koraka), a nije tu.
// Zaliha se ovdje ne broji (ne naručuje se po projektu).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, PackageSearch, Truck } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { stateNote } from '@/lib/materialGates';
import { upcomingNeeds } from '@/lib/materialGatesData';
import { workOrderDisplayName } from '@/lib/utils';
import { useStockRules } from './useStockRules';
import type { Order } from '@/lib/types';
import './OrdersPulse.css';

const day = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

export default function OrdersPulse({ orders }: { orders: Order[] }) {
    const { organizationId, appState, isTabLoaded, loadTabData } = useData();
    const { rules } = useStockRules(organizationId);
    const [open, setOpen] = useState<'late' | 'way' | 'soon' | null>(null);

    useEffect(() => {
        if (!isTabLoaded('production')) loadTabData('production');
        if (!isTabLoaded('materials')) loadTabData('materials');
    }, [isTabLoaded, loadTabData]);

    const today = new Date().toISOString().slice(0, 10);
    const sent = orders.filter(o => o.Status === 'Poslano');
    const late = sent.filter(o => o.Expected_Delivery && o.Expected_Delivery.slice(0, 10) < today)
        .sort((a, b) => a.Expected_Delivery.localeCompare(b.Expected_Delivery));
    const onWay = sent.filter(o => !late.includes(o));

    const soon = useMemo(() => upcomingNeeds(appState.workOrders || [], {
        projects: appState.projects || [], materials: appState.materials || [], orders, stock: rules,
    }), [appState.workOrders, appState.projects, appState.materials, orders, rules]);
    const soonMissing = soon.reduce((s, x) => s + x.rows.filter(r => r.state === 'missing').length, 0);

    const toggle = (k: typeof open) => setOpen(prev => (prev === k ? null : k));

    return (
        <div className="op">
            <div className="op-cards">
                <button className={`op-card late${open === 'late' ? ' on' : ''}`} onClick={() => toggle('late')} disabled={!late.length} aria-expanded={open === 'late'}>
                    <AlertTriangle size={16} />
                    <span className="op-num">{late.length}</span>
                    <span className="op-label">kasni</span>
                </button>
                <button className={`op-card way${open === 'way' ? ' on' : ''}`} onClick={() => toggle('way')} disabled={!onWay.length} aria-expanded={open === 'way'}>
                    <Truck size={16} />
                    <span className="op-num">{onWay.length}</span>
                    <span className="op-label">na putu</span>
                </button>
                <button className={`op-card soon${open === 'soon' ? ' on' : ''}`} onClick={() => toggle('soon')} disabled={!soon.length} aria-expanded={open === 'soon'}>
                    <PackageSearch size={16} />
                    <span className="op-num">{soon.length}</span>
                    <span className="op-label">treba uskoro{soonMissing ? ` · ${soonMissing} nije naručeno` : ''}</span>
                </button>
            </div>

            {open === 'late' && (
                <ul className="op-list">
                    {late.map(o => (
                        <li key={o.Order_ID}>
                            <strong>{o.Order_Number}</strong> {o.Supplier_Name}
                            <span className="op-meta late">trebalo {day(o.Expected_Delivery)}</span>
                        </li>
                    ))}
                </ul>
            )}
            {open === 'way' && (
                <ul className="op-list">
                    {onWay.map(o => (
                        <li key={o.Order_ID}>
                            <strong>{o.Order_Number}</strong> {o.Supplier_Name}
                            <span className="op-meta">{o.Expected_Delivery ? `stiže ${day(o.Expected_Delivery)}` : `poslano ${o.Order_Date ? day(o.Order_Date) : ''}`}</span>
                        </li>
                    ))}
                </ul>
            )}
            {open === 'soon' && (
                <ul className="op-list">
                    {soon.map(s => (
                        <li key={`${s.workOrder.Work_Order_ID}|${s.gate.process}`}>
                            <strong>{workOrderDisplayName(s.workOrder)}</strong> · {s.gate.process.toLowerCase()}
                            <span className="op-meta">{s.gate.status === 'active' ? 'u toku' : s.gate.distance === 0 ? 'na redu' : `za ${s.gate.distance} koraka`}</span>
                            <div className="op-rows">
                                {s.rows.map(r => (
                                    <span key={r.key} className={`op-chip ${r.state}`}>{r.name} — {stateNote(r)}</span>
                                ))}
                            </div>
                        </li>
                    ))}
                    <li className="op-foot">Naručuje se iz naloga → Materijal, ili porukom botu.</li>
                </ul>
            )}
        </div>
    );
}
