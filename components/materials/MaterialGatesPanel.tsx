'use client';

// ════════════════════════════════════════════════════════════════════
// MATERIJAL PO FAZAMA — tab „Materijal" u nalogu
//
// Kapije naloga (lib/materialGates): za svaki proces kod kojeg se materijal
// troši — šta je tu, šta se čeka, šta fali. Isti izračun koristi Telegram
// bot, pa ekran i poruke uvijek govore isto. Označeno → „Tu je" (prijem kroz
// poslanu narudžbu ili „Na stanju"); ono što fali → nacrt narudžbe.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, PackageCheck, ShoppingCart, Truck } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { apiPost } from '@/lib/apiClient';
import { gateReady, rowIsReady, stateNote, type Gate, type GateRow, type MaterialState } from '@/lib/materialGates';
import { workOrderGatesFrom } from '@/lib/materialGatesData';
import { useStockRules } from './useStockRules';
import type { WorkOrder } from '@/lib/types';
import './MaterialGatesPanel.css';

interface Props {
    workOrder: WorkOrder;
    onRefresh?: (...collections: string[]) => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const STATE_LABEL: Record<MaterialState, string> = {
    here: 'Tu je', partial: 'Dio stigao', ordered: 'Naručeno', stock: 'Zaliha?', missing: 'Nije naručeno',
};

function whenLabel(g: Gate): string {
    if (g.status === 'done') return 'prošlo';
    if (g.status === 'active') return 'u toku';
    if (g.distance === 0) return 'na redu';
    if (g.distance == null) return 'kasnije';
    return `za ${g.distance} ${g.distance === 1 ? 'korak' : 'koraka'}`;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('bs-BA', { maximumFractionDigits: 2 });

export default function MaterialGatesPanel({ workOrder, onRefresh, showToast }: Props) {
    const { organizationId, appState, isTabLoaded, loadTabData } = useData();
    const { rules } = useStockRules(organizationId);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [showDone, setShowDone] = useState(false);

    useEffect(() => {
        if (!isTabLoaded('orders')) loadTabData('orders');
        if (!isTabLoaded('materials')) loadTabData('materials');
    }, [isTabLoaded, loadTabData]);

    const items = useMemo(() => (workOrder.items || []).filter(i => i.Item_Type !== 'custom'), [workOrder.items]);
    const projectIds = useMemo(() => Array.from(new Set(items.map(i => i.Project_ID).filter(Boolean))), [items]);

    const gates = useMemo(() => workOrderGatesFrom({ ...workOrder, items }, {
        projects: appState.projects || [], materials: appState.materials || [], orders: appState.orders || [], stock: rules,
    }), [appState.projects, appState.materials, appState.orders, items, rules, workOrder]);

    const open = gates.filter(g => g.status !== 'done');
    const done = gates.filter(g => g.status === 'done');
    const rowsAll = open.flatMap(g => g.rows);
    const count = (s: MaterialState) => rowsAll.filter(r => r.state === s).length;
    // Broj tu-je uključuje i prošle faze — inače nalog pri kraju izgleda kao da nema ničega.
    const hereCount = gates.flatMap(g => g.rows).filter(r => r.state === 'here').length;
    const rowId = (g: Gate, r: GateRow) => `${g.process}|${r.key}`;
    const selectedRows = open.flatMap(g => g.rows.filter(r => selected.has(rowId(g, r))));
    const orderable = selectedRows.filter(r => r.state === 'missing' || r.state === 'stock');

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    async function act(action: 'here' | 'order', rows: GateRow[]) {
        if (!rows.length || busy) return;
        setBusy(true);
        try {
            const materialIds = rows.flatMap(r => r.materialIds);
            if (action === 'here') {
                await apiPost('/api/materials/gates', { action, materialIds });
                showToast?.(`Označeno kao tu: ${rows.length}`, 'success');
            } else {
                const res = await apiPost<{ orders: { orderNumber: string; supplier: string }[] }>('/api/materials/gates', {
                    action, materialIds, projectIds, name: workOrder.Name || workOrder.Work_Order_Number,
                });
                showToast?.(res.orders.length
                    ? `Nacrt narudžbe: ${res.orders.map(o => `${o.orderNumber} (${o.supplier})`).join(', ')} — pošalji ga iz Narudžbi`
                    : 'Sve je već naručeno ili u nacrtu', res.orders.length ? 'success' : 'info');
            }
            setSelected(new Set());
            onRefresh?.('projects', 'orders');
        } catch (e) {
            showToast?.((e as Error).message || 'Greška', 'error');
        } finally {
            setBusy(false);
        }
    }

    if (!gates.length) {
        return (
            <div className="mg-empty">
                <PackageCheck size={22} />
                <p>Nalog nema materijala vezanog za procese. Materijal se dodaje u sastavnicu proizvoda (Projekti → proizvod → Materijali).</p>
            </div>
        );
    }

    return (
        <div className="mg">
            <div className="mg-summary" role="status">
                <span className="mg-pill here"><Check size={13} /> {hereCount} tu</span>
                <span className="mg-pill ordered"><Truck size={13} /> {count('ordered') + count('partial')} na putu</span>
                <span className="mg-pill stock">{count('stock')} zaliha nepotvrđena</span>
                <span className="mg-pill missing">{count('missing')} nije naručeno</span>
            </div>

            {open.map(g => {
                const pending = g.rows.filter(r => !rowIsReady(r));
                return (
                    <section key={g.process} className={`mg-gate ${g.status}${gateReady(g) ? ' ready' : ''}`}>
                        <header className="mg-gate-head">
                            <span className="mg-dot" aria-hidden />
                            <h4>{g.process}</h4>
                            <span className="mg-when">{whenLabel(g)}</span>
                            <span className="mg-gate-state">{gateReady(g) ? 'sve je tu' : `${pending.length} od ${g.rows.length} nije tu`}</span>
                            {pending.length > 1 && (
                                <button className="mg-link" onClick={() => setSelected(prev => {
                                    const next = new Set(prev);
                                    const all = pending.every(r => next.has(rowId(g, r)));
                                    pending.forEach(r => (all ? next.delete(rowId(g, r)) : next.add(rowId(g, r))));
                                    return next;
                                })}>označi sve</button>
                            )}
                        </header>
                        <ul className="mg-rows">
                            {g.rows.map(r => {
                                const id = rowId(g, r);
                                const ready = rowIsReady(r);
                                return (
                                    <li key={id} className={`mg-row ${r.state}`}>
                                        <label>
                                            <input type="checkbox" disabled={ready || busy} checked={ready || selected.has(id)} onChange={() => toggle(id)} />
                                            <span className="mg-name">{r.name}</span>
                                        </label>
                                        <span className="mg-qty">{r.needed > 0 ? `${fmt(r.needed)} ${r.unit}` : ''}</span>
                                        <span className={`mg-state ${r.state}`} title={stateNote(r)}>{r.state === 'ordered' && r.order ? stateNote(r) : STATE_LABEL[r.state]}</span>
                                        {r.productNames.length > 1 && <span className="mg-products">{r.productNames.join(', ')}</span>}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                );
            })}

            {done.length > 0 && (
                <button className="mg-done-toggle" onClick={() => setShowDone(v => !v)} aria-expanded={showDone}>
                    <ChevronDown size={14} className={showDone ? 'open' : ''} /> Prošle faze ({done.length})
                </button>
            )}
            {showDone && done.map(g => (
                <section key={g.process} className="mg-gate done">
                    <header className="mg-gate-head"><span className="mg-dot" aria-hidden /><h4>{g.process}</h4><span className="mg-when">prošlo</span></header>
                    <ul className="mg-rows">
                        {g.rows.map(r => (
                            <li key={r.key} className={`mg-row ${r.state}`}>
                                <span className="mg-name">{r.name}</span>
                                <span className="mg-qty">{r.needed > 0 ? `${fmt(r.needed)} ${r.unit}` : ''}</span>
                                <span className={`mg-state ${r.state}`}>{STATE_LABEL[r.state]}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            {selectedRows.length > 0 && (
                <div className="mg-actions">
                    <span>{selectedRows.length} označeno</span>
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act('here', selectedRows)}>
                        <Check size={14} /> Tu je
                    </button>
                    {orderable.length > 0 && (
                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act('order', orderable)}>
                            <ShoppingCart size={14} /> Naruči ({orderable.length})
                        </button>
                    )}
                    <button className="mg-link" onClick={() => setSelected(new Set())}>poništi izbor</button>
                </div>
            )}
        </div>
    );
}
