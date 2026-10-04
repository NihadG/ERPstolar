'use client';

import { useState, useEffect, useMemo } from 'react';
import type { WorkOrder, WorkOrderItem, WorkLog } from '@/lib/types';
import { getWorkLogsForWorkOrder } from '@/lib/services';
import { workOrderDisplayName } from '@/lib/utils';
import { itemFinance, sumItemFinance, liveLogs, type FinanceBasis, type ItemFinance } from '@/lib/projectFinance';
import { useFinanceBasis } from '@/context/FinanceBasisContext';
import Modal from '@/components/ui/Modal';
import { Receipt } from 'lucide-react';

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
    other: number;      // ostali troškovi (razni poslovi)
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
    rows: SummaryRow[];
    workers: SummaryWorker[];
    totals: { selling: number; material: number; labor: number; other: number; profit: number; margin: number | null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Rezime naloga = ISTI proračun kao detalj naloga, kartica projekta i analitika
// (lib/projectFinance): prihod iz prihvaćene ponude (ili završni račun), materijal =
// živa sastavnica + dodaci iz ponude, rad = Σ dnevnica. Ranije se čitao zamrznuti
// snapshot sa završetka, pa je rezime znao pokazati drugi broj od ostatka aplikacije.
function summarize(wo: WorkOrder, allLogs: WorkLog[], basis: FinanceBasis): SummaryData {
    const logs = liveLogs(allLogs);
    const itemFins: { item: WorkOrderItem; actualDays: number; fin: ItemFinance }[] = (wo.items || []).map(item => {
        const itemLogs = logs.filter(l => l.Work_Order_Item_ID === item.ID);
        const labor = itemLogs.reduce((s, l) => s + (l.Daily_Rate || 0), 0);
        const actualDays = round2(itemLogs.reduce((s, l) => s + (l.Day_Fraction ?? 1), 0));
        return { item, actualDays, fin: itemFinance(item, wo, basis, labor) };
    });

    const rows: SummaryRow[] = itemFins.map(({ item, actualDays, fin }) => ({
        name: item.Product_Name,
        qty: item.Quantity || 1,
        selling: fin.revenue,
        material: fin.material,
        labor: fin.labor,
        other: fin.other,
        profit: fin.profit,
        margin: fin.revenue > 0 ? fin.margin : null,
        plannedDays: item.Planned_Labor_Days,
        actualDays,
    }));

    const wMap = new Map<string, SummaryWorker>();
    logs.forEach(l => {
        const cur = wMap.get(l.Worker_ID) || { name: l.Worker_Name, days: 0, cost: 0 };
        cur.days += l.Day_Fraction ?? 1;
        cur.cost += l.Daily_Rate || 0;
        wMap.set(l.Worker_ID, cur);
    });

    // Ukupno = Σ istih per-item proračuna (invarijanta Σ redova == ukupno).
    const total = sumItemFinance(itemFins.map(x => x.fin));
    return {
        rows,
        workers: Array.from(wMap.values()).map(w => ({ ...w, days: round2(w.days), cost: round2(w.cost) })).sort((a, b) => b.cost - a.cost),
        totals: {
            selling: total.revenue, material: total.material, labor: total.labor,
            other: total.other, profit: total.profit,
            margin: total.revenue > 0 ? total.margin : null,
        },
    };
}

/** Rezime naloga: P&L po proizvodu — isti proračun kao ostatak aplikacije (lib/projectFinance). */
export default function OrderSummaryModal({ workOrder, organizationId, onClose }: OrderSummaryModalProps) {
    const [loading, setLoading] = useState(true);
    const [logs, setLogs] = useState<WorkLog[] | null>(null);
    const basis = useFinanceBasis();

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const l = await getWorkLogsForWorkOrder(workOrder.Work_Order_ID, organizationId);
                if (!cancelled) setLogs(l);
            } catch (e) {
                console.error('order summary load error', e);
                if (!cancelled) setLogs(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [workOrder.Work_Order_ID, organizationId]);

    const data = useMemo(() => (logs ? summarize(workOrder, logs, basis) : null), [logs, workOrder, basis]);

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
                        <span style={{ marginLeft: '10px' }}>
                            · prihod iz prihvaćene ponude, materijal = sastavnica + dodaci, rad = dnevnice
                        </span>
                    </div>

                    {/* Totali */}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                        {[
                            { label: 'Prihod', value: data.totals.selling, color: '#0f172a' },
                            { label: 'Materijal', value: data.totals.material, color: '#0f172a' },
                            { label: 'Rad', value: data.totals.labor, color: '#b45309' },
                            ...(data.totals.other > 0 ? [{ label: 'Ostali troškovi', value: data.totals.other, color: '#0f172a' }] : []),
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
