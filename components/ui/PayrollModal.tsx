'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Worker } from '@/lib/types';
import { getAllAttendanceByMonth, getWorkLogsForMonth } from '@/lib/services';
import { computeMonthlyPayroll, payrollToCSV, type MonthlyPayroll } from '@/lib/payroll';
import Modal from '@/components/ui/Modal';
import { Download, Printer, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

interface PayrollModalProps {
    isOpen: boolean;
    onClose: () => void;
    workers: Worker[];
    organizationId: string;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const MONTH_NAMES = ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni',
    'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'];

/**
 * Mjesečni obračun plata iz šihtarice + dnevnika rada.
 * Iznosi = Σ WorkLog.Daily_Rate (ista istina kao trošak rada u profitu).
 */
export default function PayrollModal({ isOpen, onClose, workers, organizationId, showToast }: PayrollModalProps) {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1); // 1–12
    const [loading, setLoading] = useState(false);
    const [payroll, setPayroll] = useState<MonthlyPayroll | null>(null);

    useEffect(() => {
        if (!isOpen || !organizationId) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [attendance, logs] = await Promise.all([
                    getAllAttendanceByMonth(String(year), String(month), organizationId),
                    getWorkLogsForMonth(year, month, organizationId),
                ]);
                if (cancelled) return;
                setPayroll(computeMonthlyPayroll(year, month, attendance as any, logs, workers as any));
            } catch (e) {
                console.error('payroll load error', e);
                if (!cancelled) showToast('Greška pri učitavanju obračuna', 'error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, year, month, organizationId, workers]);

    const fmt = (n: number) => n.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

    function prevMonth() {
        if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1);
    }
    function nextMonth() {
        if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1);
    }

    function downloadCSV() {
        if (!payroll) return;
        // BOM za ispravne š/č/ć u Excelu
        const blob = new Blob(['﻿' + payrollToCSV(payroll)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `obracun-${year}-${String(month).padStart(2, '0')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function printPayroll() {
        if (!payroll) return;
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) { showToast('Preglednik je blokirao print prozor', 'error'); return; }
        const rowsHtml = payroll.rows.map(r => `
            <tr>
                <td>${r.name}${r.deleted ? ' <em>(obrisan)</em>' : ''}</td>
                <td>${r.daysByStatus['Prisutan'] || 0}</td>
                <td>${r.daysByStatus['Teren'] || 0}</td>
                <td>${r.saturdaysWorked}</td>
                <td>${r.daysByStatus['Bolovanje'] || 0}</td>
                <td>${r.daysByStatus['Odmor'] || 0}</td>
                <td>${fmtDays(r.bookedDays)}</td>
                <td style="text-align:right;font-weight:600">${fmt(r.totalPay)} KM</td>
            </tr>`).join('');
        w.document.write(`<!DOCTYPE html><html><head><title>Obračun ${MONTH_NAMES[month - 1]} ${year}</title>
            <style>
                body{font-family:Arial,sans-serif;padding:24px;color:#111}
                h2{margin:0 0 4px} .sub{color:#666;margin-bottom:16px}
                table{width:100%;border-collapse:collapse;font-size:13px}
                th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
                th{background:#f3f4f6} tfoot td{font-weight:700;background:#f9fafb}
            </style></head><body>
            <h2>Obračun plata — ${MONTH_NAMES[month - 1]} ${year}.</h2>
            <div class="sub">Izvor: šihtarica (dani) + dnevnik rada (dnevnice)</div>
            <table>
                <thead><tr><th>Radnik</th><th>Prisutan</th><th>Teren</th><th>Subote</th><th>Bolovanje</th><th>Odmor</th><th>Radnik-dani</th><th>Dnevnice</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot><tr><td colspan="7">UKUPNO</td><td style="text-align:right">${fmt(payroll.totalPay)} KM</td></tr></tfoot>
            </table>
            </body></html>`);
        w.document.close();
        w.focus();
        w.print();
    }

    const anyUnbooked = useMemo(() => (payroll?.rows || []).some(r => r.unbookedPresentDays > 0), [payroll]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <span>Obračun plata</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button className="glass-btn" onClick={prevMonth} style={{ padding: '4px 8px' }}><ChevronLeft size={16} /></button>
                        <span style={{ fontSize: '14px', fontWeight: 600, minWidth: '130px', textAlign: 'center' }}>
                            {MONTH_NAMES[month - 1]} {year}.
                        </span>
                        <button className="glass-btn" onClick={nextMonth} style={{ padding: '4px 8px' }}><ChevronRight size={16} /></button>
                    </div>
                </div>
            }
            footer={
                <>
                    <button className="glass-btn" onClick={downloadCSV} disabled={!payroll || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Download size={15} /> CSV
                    </button>
                    <button className="glass-btn" onClick={printPayroll} disabled={!payroll || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Printer size={15} /> Printaj
                    </button>
                    <button className="btn btn-secondary" onClick={onClose}>Zatvori</button>
                </>
            }
        >
            {loading && <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>Učitavanje obračuna…</div>}

            {!loading && payroll && (
                <div>
                    {anyUnbooked && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 14px', marginBottom: '14px',
                            background: 'var(--warning-bg)', color: '#92400e',
                            borderRadius: '10px', fontSize: '13px',
                        }}>
                            <AlertTriangle size={16} />
                            Neki radnici imaju dane prisutnosti bez knjižene dnevnice — iznos je potcijenjen dok se ne proknjiži (vidi kolonu „Bez knjiž.").
                        </div>
                    )}
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'auto', maxHeight: '55vh' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                                    {['Radnik', 'Prisutan', 'Teren', 'Subote', 'Bolovanje', 'Odmor', 'Radnik-dani', 'Dnevnice (KM)', 'Bez knjiž.'].map(h => (
                                        <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Radnik' ? 'left' : 'center', fontWeight: 600, color: '#475569', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {payroll.rows.length === 0 && (
                                    <tr><td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Nema podataka za ovaj mjesec</td></tr>
                                )}
                                {payroll.rows.map((r, i) => (
                                    <tr key={r.workerId} style={{ background: i % 2 ? '#fafafa' : 'white', borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '9px 12px', fontWeight: 500, color: r.deleted ? '#94a3b8' : '#0f172a' }}>
                                            {r.name}{r.deleted && <span style={{ fontSize: '11px', color: '#94a3b8' }}> (obrisan)</span>}
                                        </td>
                                        <td style={{ padding: '9px', textAlign: 'center' }}>{r.daysByStatus['Prisutan'] || 0}</td>
                                        <td style={{ padding: '9px', textAlign: 'center' }}>{r.daysByStatus['Teren'] || 0}</td>
                                        <td style={{ padding: '9px', textAlign: 'center' }}>{r.saturdaysWorked}</td>
                                        <td style={{ padding: '9px', textAlign: 'center' }}>{r.daysByStatus['Bolovanje'] || 0}</td>
                                        <td style={{ padding: '9px', textAlign: 'center' }}>{r.daysByStatus['Odmor'] || 0}</td>
                                        <td style={{ padding: '9px', textAlign: 'center' }}>{fmtDays(r.bookedDays)}</td>
                                        <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmt(r.totalPay)}</td>
                                        <td style={{ padding: '9px', textAlign: 'center', color: r.unbookedPresentDays > 0 ? 'var(--warning)' : '#94a3b8', fontWeight: r.unbookedPresentDays > 0 ? 700 : 400 }}>
                                            {r.unbookedPresentDays || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                                    <td style={{ padding: '10px 12px', fontWeight: 700 }}>UKUPNO ({payroll.totalPresentDays} dana prisutnosti)</td>
                                    <td colSpan={6}></td>
                                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '14px' }}>{fmt(payroll.totalPay)} KM</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}
        </Modal>
    );
}
