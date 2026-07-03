'use client';

import { useState, useEffect } from 'react';
import type { WorkOrder, ProductionSnapshot, WorkLog } from '@/lib/types';
import { getProductionSnapshotForWorkOrder, getWorkLogsForWorkOrder } from '@/lib/services';
import { workOrderDisplayName } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import { Receipt, AlertTriangle } from 'lucide-react';

interface OrderSummaryModalProps {
    workOrder: WorkOrder;
    organizationId: string;
    onClose: () => void;
}

interface SummaryRow {
    name: string;
    qty: number;
    selling: number;
    material: number;
    labor: number;
    other: number;      // transport + usluge
    profit: number;
    margin: number | null;
    plannedDays?: number;
    actualDays?: number;
}

interface SummaryWorker {
    name: string;
    days: number;
    cost: number;
}

interface SummaryData {
    source: 'snapshot' | 'live';
    rows: SummaryRow[];
    workers: SummaryWorker[];
    totals: { selling: number; material: number; labor: number; other: number; profit: number; margin: number | null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function fromSnapshot(s: ProductionSnapshot): SummaryData {
    const rows: SummaryRow[] = (s.Items || []).map(it => {
        const extras = (it.Extras || []).reduce((sum, e) => sum + (e.Total || 0), 0);
        const other = (it.Transport_Share || 0) + extras;
        const laborCost = (it.Workers_Assigned || []).reduce((sum, w) => sum + (w.Total_Cost || 0), 0);
        return {
            name: it.Product_Name,
            qty: it.Quantity || 1,
            selling: it.Selling_Price || 0,
            material: it.Total_Material_Cost || 0,
            labor: laborCost,
            other,
            profit: it.Profit || 0,
            margin: it.Selling_Price > 0 ? ((it.Profit || 0) / it.Selling_Price) * 100 : null,
            plannedDays: it.Planned_Labor_Days,
            actualDays: it.Actual_Labor_Days,
        };
    });

    // Radnici agregirano preko svih stavki
    const wMap = new Map<string, SummaryWorker>();
    (s.Items || []).forEach(it => (it.Workers_Assigned || []).forEach(w => {
        const cur = wMap.get(w.Worker_ID) || { name: w.Worker_Name, days: 0, cost: 0 };
        cur.days += w.Days_Worked || 0;
        cur.cost += w.Total_Cost || 0;
        wMap.set(w.Worker_ID, cur);
    }));

    const selling = s.Total_Selling_Price || rows.reduce((x, r) => x + r.selling, 0);
    const material = s.Total_Material_Cost || rows.reduce((x, r) => x + r.material, 0);
    const labor = s.Actual_Labor_Cost || rows.reduce((x, r) => x + r.labor, 0);
    const other = rows.reduce((x, r) => x + r.other, 0);
    const profit = s.Net_Profit ?? (selling - material - labor - other);
    return {
        source: 'snapshot',
        rows,
        workers: Array.from(wMap.values()).sort((a, b) => b.cost - a.cost),
        totals: {
            selling: round2(selling), material: round2(material), labor: round2(labor),
            other: round2(other), profit: round2(profit),
            margin: selling > 0 ? round2((profit / selling) * 100) : null,
        },
    };
}

// Fallback za stare naloge bez snapshota — ista formula kao P&L u detalju naloga
function fromLive(wo: WorkOrder, logs: WorkLog[]): SummaryData {
    const rows: SummaryRow[] = (wo.items || []).map(item => {
        const itemLogs = logs.filter(l => l.Work_Order_Item_ID === item.ID);
        const labor = itemLogs.reduce((s, l) => s + (l.Daily_Rate || 0), 0);
        const actualDays = itemLogs.reduce((s, l) => s + (l.Day_Fraction ?? 1), 0);
        const selling = ((item as any).Profit_Overrides?.Selling_Price ?? item.Product_Value) || 0;
        const material = item.Material_Cost || 0;
        const other = ((item as any).Profit_Overrides?.Transport_Share ?? (item as any).Transport_Share ?? 0) + ((item as any).Services_Total || 0);
        const profit = selling - material - labor - other;
        return {
            name: item.Product_Name,
            qty: item.Quantity || 1,
            selling, material, labor: round2(labor), other, profit: round2(profit),
            margin: selling > 0 ? (profit / selling) * 100 : null,
            plannedDays: item.Planned_Labor_Days,
            actualDays: round2(actualDays),
        };
    });

    const wMap = new Map<string, SummaryWorker>();
    logs.forEach(l => {
        const cur = wMap.get(l.Worker_ID) || { name: l.Worker_Name, days: 0, cost: 0 };
        cur.days += l.Day_Fraction ?? 1;
        cur.cost += l.Daily_Rate || 0;
        wMap.set(l.Worker_ID, cur);
    });

    const t = rows.reduce((acc, r) => ({
        selling: acc.selling + r.selling, material: acc.material + r.material,
        labor: acc.labor + r.labor, other: acc.other + r.other, profit: acc.profit + r.profit,
    }), { selling: 0, material: 0, labor: 0, other: 0, profit: 0 });
    return {
        source: 'live',
        rows,
        workers: Array.from(wMap.values()).map(w => ({ ...w, days: round2(w.days), cost: round2(w.cost) })).sort((a, b) => b.cost - a.cost),
        totals: { ...t, selling: round2(t.selling), material: round2(t.material), labor: round2(t.labor), other: round2(t.other), profit: round2(t.profit), margin: t.selling > 0 ? round2((t.profit / t.selling) * 100) : null },
    };
}

/** Rezime završenog naloga: finalni P&L iz production snapshota (fallback: živi izračun). */
export default function OrderSummaryModal({ workOrder, organizationId, onClose }: OrderSummaryModalProps) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<SummaryData | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const snap = await getProductionSnapshotForWorkOrder(workOrder.Work_Order_ID, organizationId);
                if (cancelled) return;
                if (snap && (snap.Items || []).length > 0) {
                    setData(fromSnapshot(snap));
                } else {
                    const logs = await getWorkLogsForWorkOrder(workOrder.Work_Order_ID, organizationId);
                    if (cancelled) return;
                    setData(fromLive(workOrder, logs));
                }
            } catch (e) {
                console.error('order summary load error', e);
                if (!cancelled) setData(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [workOrder.Work_Order_ID, organizationId]);

    const fmt = (n: number) => Math.round(n).toLocaleString('hr-HR');
    const fmtDays = (n?: number) => n === undefined ? '—' : (Number.isInteger(n) ? String(n) : n.toFixed(1));
    const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    const profitColor = (n: number) => n >= 0 ? '#059669' : '#dc2626';

    const totalCell: React.CSSProperties = { padding: '10px 12px', fontWeight: 700 };
    const th: React.CSSProperties = { padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: '#475569', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' };
    const td: React.CSSProperties = { padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' };

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Receipt size={20} />
                    <span>Rezime — {workOrderDisplayName(workOrder)}</span>
                    <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>#{workOrder.Work_Order_Number}</span>
                </div>
            }
            footer={<button className="btn btn-secondary" onClick={onClose}>Zatvori</button>}
        >
            {loading && <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>Učitavanje rezimea…</div>}

            {!loading && !data && (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Nije moguće učitati rezime naloga.</div>
            )}

            {!loading && data && (
                <div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                        {fmtDate(workOrder.Started_At)} → {fmtDate(workOrder.Completed_At)}
                        {data.source === 'live' && (
                            <span style={{ marginLeft: '10px', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <AlertTriangle size={13} /> izračunato uživo (nalog nema snapshot)
                            </span>
                        )}
                    </div>

                    {/* Totali */}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                        {[
                            { label: 'Prihod', value: data.totals.selling, color: '#0f172a' },
                            { label: 'Materijal', value: data.totals.material, color: '#0f172a' },
                            { label: 'Rad', value: data.totals.labor, color: '#b45309' },
                            { label: 'Transport + usluge', value: data.totals.other, color: '#0f172a' },
                        ].map(k => (
                            <div key={k.label} style={{ flex: '1 1 120px', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</div>
                                <div style={{ fontSize: '16px', fontWeight: 700, color: k.color }}>{fmt(k.value)} KM</div>
                            </div>
                        ))}
                        <div style={{ flex: '1 1 140px', padding: '10px 14px', border: `1px solid ${data.totals.profit >= 0 ? '#a7f3d0' : '#fecaca'}`, background: data.totals.profit >= 0 ? '#ecfdf5' : '#fef2f2', borderRadius: '10px' }}>
                            <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Profit{data.totals.margin !== null ? ` · ${Math.round(data.totals.margin)}%` : ''}</div>
                            <div style={{ fontSize: '18px', fontWeight: 800, color: profitColor(data.totals.profit) }}>
                                {data.totals.profit < 0 ? '−' : ''}{fmt(Math.abs(data.totals.profit))} KM
                            </div>
                        </div>
                    </div>

                    {/* Po proizvodu */}
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'auto', maxHeight: '38vh', marginBottom: '16px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                                    <th style={{ ...th, textAlign: 'left' }}>Proizvod</th>
                                    <th style={th}>Cijena</th>
                                    <th style={th}>Materijal</th>
                                    <th style={th}>Rad</th>
                                    <th style={th}>Ostalo</th>
                                    <th style={th}>Profit</th>
                                    <th style={th}>Dani (plan/stv.)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((r, i) => (
                                    <tr key={i} style={{ background: i % 2 ? '#fafafa' : 'white', borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ ...td, textAlign: 'left', fontWeight: 500 }}>{r.name}{r.qty > 1 ? ` × ${r.qty}` : ''}</td>
                                        <td style={td}>{fmt(r.selling)}</td>
                                        <td style={td}>{fmt(r.material)}</td>
                                        <td style={{ ...td, color: '#b45309' }}>{fmt(r.labor)}</td>
                                        <td style={td}>{fmt(r.other)}</td>
                                        <td style={{ ...td, fontWeight: 700, color: profitColor(r.profit) }}>
                                            {r.profit < 0 ? '−' : ''}{fmt(Math.abs(r.profit))}{r.margin !== null ? ` (${Math.round(r.margin)}%)` : ''}
                                        </td>
                                        <td style={td}>{fmtDays(r.plannedDays)} / {fmtDays(r.actualDays)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                                    <td style={totalCell}>UKUPNO</td>
                                    <td style={{ ...td, fontWeight: 700 }}>{fmt(data.totals.selling)}</td>
                                    <td style={{ ...td, fontWeight: 700 }}>{fmt(data.totals.material)}</td>
                                    <td style={{ ...td, fontWeight: 700, color: '#b45309' }}>{fmt(data.totals.labor)}</td>
                                    <td style={{ ...td, fontWeight: 700 }}>{fmt(data.totals.other)}</td>
                                    <td style={{ ...td, fontWeight: 800, color: profitColor(data.totals.profit) }}>
                                        {data.totals.profit < 0 ? '−' : ''}{fmt(Math.abs(data.totals.profit))}
                                    </td>
                                    <td style={td}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Radnici */}
                    {data.workers.length > 0 && (
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                                Radnici na nalogu
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {data.workers.map(w => (
                                    <div key={w.name} style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '13px' }}>
                                        <strong>{w.name}</strong>
                                        <span style={{ color: '#64748b' }}> · {fmtDays(w.days)} dana · </span>
                                        <span style={{ color: '#b45309', fontWeight: 600 }}>{fmt(w.cost)} KM</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}
