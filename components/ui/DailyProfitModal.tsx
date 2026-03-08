'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { DailyProfitEntry, WorkOrderItem } from '@/lib/types';

// ============================================
// TYPES
// ============================================

interface DailyProfitModalProps {
    isOpen: boolean;
    onClose: () => void;
    workOrderId: string;
    workOrderNumber: string;
    organizationId: string;
    items?: WorkOrderItem[];  // For per-item drill-down
    showToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

interface FormState {
    Revenue_Today: string;
    Material_Cost_Today: string;
    Labor_Cost_Today: string;
    Other_Costs_Today: string;
    Notes: string;
}

const EMPTY_FORM: FormState = {
    Revenue_Today: '',
    Material_Cost_Today: '',
    Labor_Cost_Today: '',
    Other_Costs_Today: '',
    Notes: '',
};

interface ProfitSummaryData {
    totalRevenue: number;
    totalMaterialCost: number;
    totalLaborCost: number;
    totalOtherCosts: number;
    totalProfit: number;
    entryCount: number;
    latestDate: string | null;
}

// ============================================
// COMPONENT
// ============================================

export default function DailyProfitModal({
    isOpen,
    onClose,
    workOrderId,
    workOrderNumber,
    organizationId,
    items = [],
    showToast,
}: DailyProfitModalProps) {
    const [tab, setTab] = useState<'today' | 'history'>('today');
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [selectedDate, setSelectedDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [entries, setEntries] = useState<DailyProfitEntry[]>([]);
    const [summary, setSummary] = useState<ProfitSummaryData | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [expandedItem, setExpandedItem] = useState<string | null>(null);
    const [itemForms, setItemForms] = useState<Record<string, FormState>>({});

    // ---- Data Loading ----
    const loadData = useCallback(async () => {
        if (!workOrderId || !organizationId) return;
        setLoading(true);
        try {
            const { getDailyProfitEntries, getDailyProfitSummary } = await import('@/lib/services');
            const [entriesData, summaryData] = await Promise.all([
                getDailyProfitEntries(workOrderId, organizationId),
                getDailyProfitSummary(workOrderId, organizationId),
            ]);
            setEntries(entriesData);
            setSummary(summaryData);

            // Pre-fill form if entry exists for selected date
            const todayEntry = entriesData.find(
                (e) => e.Date === selectedDate && !e.Work_Order_Item_ID
            );
            if (todayEntry) {
                setForm({
                    Revenue_Today: todayEntry.Revenue_Today ? String(todayEntry.Revenue_Today) : '',
                    Material_Cost_Today: todayEntry.Material_Cost_Today ? String(todayEntry.Material_Cost_Today) : '',
                    Labor_Cost_Today: todayEntry.Labor_Cost_Today ? String(todayEntry.Labor_Cost_Today) : '',
                    Other_Costs_Today: todayEntry.Other_Costs_Today ? String(todayEntry.Other_Costs_Today) : '',
                    Notes: todayEntry.Notes || '',
                });
            } else {
                setForm(EMPTY_FORM);
            }
        } catch (err) {
            console.error('DailyProfitModal loadData error:', err);
        } finally {
            setLoading(false);
        }
    }, [workOrderId, organizationId, selectedDate]);

    useEffect(() => {
        if (isOpen) loadData();
    }, [isOpen, loadData]);

    // ---- Save WO-level entry ----
    const handleSave = async () => {
        if (!workOrderId || !organizationId) return;
        setSaving(true);
        try {
            const { saveDailyProfitEntry } = await import('@/lib/services');
            const result = await saveDailyProfitEntry(
                {
                    Organization_ID: organizationId,
                    Work_Order_ID: workOrderId,
                    Work_Order_Number: workOrderNumber,
                    Date: selectedDate,
                    Revenue_Today: parseFloat(form.Revenue_Today) || 0,
                    Material_Cost_Today: parseFloat(form.Material_Cost_Today) || 0,
                    Labor_Cost_Today: parseFloat(form.Labor_Cost_Today) || 0,
                    Other_Costs_Today: parseFloat(form.Other_Costs_Today) || 0,
                    Notes: form.Notes,
                },
                organizationId
            );
            if (result.success) {
                showToast?.(result.message, 'success');
                await loadData();
            } else {
                showToast?.(result.message, 'error');
            }
        } catch (err) {
            showToast?.('Greška pri čuvanju', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ---- Save per-item entry ----
    const handleSaveItem = async (item: WorkOrderItem) => {
        if (!workOrderId || !organizationId) return;
        const itemForm = itemForms[item.ID] || EMPTY_FORM;
        setSaving(true);
        try {
            const { saveDailyProfitEntry } = await import('@/lib/services');
            const result = await saveDailyProfitEntry(
                {
                    Organization_ID: organizationId,
                    Work_Order_ID: workOrderId,
                    Work_Order_Number: workOrderNumber,
                    Work_Order_Item_ID: item.ID,
                    Product_Name: item.Product_Name,
                    Date: selectedDate,
                    Revenue_Today: parseFloat(itemForm.Revenue_Today) || 0,
                    Material_Cost_Today: parseFloat(itemForm.Material_Cost_Today) || 0,
                    Labor_Cost_Today: parseFloat(itemForm.Labor_Cost_Today) || 0,
                    Other_Costs_Today: parseFloat(itemForm.Other_Costs_Today) || 0,
                    Notes: itemForm.Notes,
                },
                organizationId
            );
            if (result.success) {
                showToast?.(`${item.Product_Name}: ${result.message}`, 'success');
                await loadData();
            } else {
                showToast?.(result.message, 'error');
            }
        } catch (err) {
            showToast?.('Greška pri čuvanju', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ---- Delete entry ----
    const handleDelete = async (entryId: string) => {
        if (!confirm('Obrisati ovaj unos?')) return;
        try {
            const { deleteDailyProfitEntry } = await import('@/lib/services');
            const result = await deleteDailyProfitEntry(entryId, organizationId);
            if (result.success) {
                showToast?.(result.message, 'success');
                await loadData();
            } else {
                showToast?.(result.message, 'error');
            }
        } catch (err) {
            showToast?.('Greška pri brisanju', 'error');
        }
    };

    // ---- Helpers ----
    const calcDailyProfit = (f: FormState) => {
        return (parseFloat(f.Revenue_Today) || 0)
            - (parseFloat(f.Material_Cost_Today) || 0)
            - (parseFloat(f.Labor_Cost_Today) || 0)
            - (parseFloat(f.Other_Costs_Today) || 0);
    };

    const formatNum = (n: number) =>
        n.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('hr-HR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    if (!isOpen) return null;

    const dailyProfit = calcDailyProfit(form);

    return (
        <>
            <div className="dpm-overlay" onClick={onClose} />
            <div className="dpm-modal">
                {/* Header */}
                <div className="dpm-header">
                    <div className="dpm-header-left">
                        <span className="material-icons-round" style={{ fontSize: '22px', color: '#667eea' }}>account_balance_wallet</span>
                        <div>
                            <h2>Profit — {workOrderNumber}</h2>
                            <p>Ručno praćenje dnevnog profita</p>
                        </div>
                    </div>
                    <button className="dpm-close" onClick={onClose}>
                        <span className="material-icons-round">close</span>
                    </button>
                </div>

                {/* Summary Strip */}
                {summary && summary.entryCount > 0 && (
                    <div className="dpm-summary">
                        <div className="dpm-summary-item">
                            <span className="label">Ukupni prihod</span>
                            <span className="value green">{formatNum(summary.totalRevenue)} KM</span>
                        </div>
                        <div className="dpm-summary-item">
                            <span className="label">Troškovi</span>
                            <span className="value red">
                                {formatNum(summary.totalMaterialCost + summary.totalLaborCost + summary.totalOtherCosts)} KM
                            </span>
                        </div>
                        <div className="dpm-summary-item main">
                            <span className="label">Kumulativni profit</span>
                            <span className={`value ${summary.totalProfit >= 0 ? 'green' : 'red'}`}>
                                {formatNum(summary.totalProfit)} KM
                            </span>
                        </div>
                        <div className="dpm-summary-item">
                            <span className="label">Unosa</span>
                            <span className="value">{summary.entryCount}</span>
                        </div>
                    </div>
                )}

                {/* Tabs */}
                <div className="dpm-tabs">
                    <button className={`dpm-tab ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
                        <span className="material-icons-round" style={{ fontSize: '16px' }}>edit_note</span>
                        Dnevni unos
                    </button>
                    <button className={`dpm-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
                        <span className="material-icons-round" style={{ fontSize: '16px' }}>history</span>
                        Historija ({entries.filter(e => !e.Work_Order_Item_ID).length})
                    </button>
                </div>

                {/* Content */}
                <div className="dpm-body">
                    {loading ? (
                        <div className="dpm-loading">
                            <div className="loading-spinner" />
                            <span>Učitavanje...</span>
                        </div>
                    ) : tab === 'today' ? (
                        <div className="dpm-today">
                            {/* Date picker */}
                            <div className="dpm-date-row">
                                <label>Datum</label>
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                />
                            </div>

                            {/* WO-Level Form */}
                            <div className="dpm-form-grid">
                                <div className="dpm-field">
                                    <label>
                                        <span className="material-icons-round" style={{ fontSize: '14px', color: '#10b981' }}>arrow_upward</span>
                                        Prihod (KM)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={form.Revenue_Today}
                                        onChange={(e) => setForm({ ...form, Revenue_Today: e.target.value })}
                                    />
                                </div>
                                <div className="dpm-field">
                                    <label>
                                        <span className="material-icons-round" style={{ fontSize: '14px', color: '#f59e0b' }}>inventory_2</span>
                                        Materijal (KM)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={form.Material_Cost_Today}
                                        onChange={(e) => setForm({ ...form, Material_Cost_Today: e.target.value })}
                                    />
                                </div>
                                <div className="dpm-field">
                                    <label>
                                        <span className="material-icons-round" style={{ fontSize: '14px', color: '#3b82f6' }}>engineering</span>
                                        Rad (KM)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={form.Labor_Cost_Today}
                                        onChange={(e) => setForm({ ...form, Labor_Cost_Today: e.target.value })}
                                    />
                                </div>
                                <div className="dpm-field">
                                    <label>
                                        <span className="material-icons-round" style={{ fontSize: '14px', color: '#8b5cf6' }}>local_shipping</span>
                                        Ostalo (KM)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={form.Other_Costs_Today}
                                        onChange={(e) => setForm({ ...form, Other_Costs_Today: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Daily profit preview */}
                            <div className={`dpm-daily-result ${dailyProfit >= 0 ? 'positive' : 'negative'}`}>
                                <span>Dnevni profit</span>
                                <strong>{formatNum(dailyProfit)} KM</strong>
                            </div>

                            {/* Notes */}
                            <div className="dpm-field full">
                                <label>
                                    <span className="material-icons-round" style={{ fontSize: '14px' }}>sticky_note_2</span>
                                    Napomena
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Šta se desilo danas na ovom nalogu..."
                                    value={form.Notes}
                                    onChange={(e) => setForm({ ...form, Notes: e.target.value })}
                                />
                            </div>

                            {/* Save button */}
                            <button className="dpm-save" onClick={handleSave} disabled={saving}>
                                {saving ? 'Čuvanje...' : 'Sačuvaj dnevni unos'}
                            </button>

                            {/* Per-Item Drill-Down */}
                            {items.length > 0 && (
                                <div className="dpm-items-section">
                                    <div className="dpm-items-header">
                                        <span className="material-icons-round" style={{ fontSize: '16px' }}>view_list</span>
                                        Detalji po stavci (opciono)
                                    </div>
                                    {items.map((item) => {
                                        const isExpanded = expandedItem === item.ID;
                                        const itemForm = itemForms[item.ID] || EMPTY_FORM;
                                        const itemProfit = calcDailyProfit(itemForm);
                                        // Check if per-item entry exists
                                        const existingItemEntry = entries.find(
                                            e => e.Date === selectedDate && e.Work_Order_Item_ID === item.ID
                                        );

                                        return (
                                            <div key={item.ID} className="dpm-item-card">
                                                <button
                                                    className={`dpm-item-toggle ${isExpanded ? 'expanded' : ''}`}
                                                    onClick={() => {
                                                        if (isExpanded) {
                                                            setExpandedItem(null);
                                                        } else {
                                                            setExpandedItem(item.ID);
                                                            // Pre-fill from existing entry
                                                            if (existingItemEntry) {
                                                                setItemForms(prev => ({
                                                                    ...prev,
                                                                    [item.ID]: {
                                                                        Revenue_Today: existingItemEntry.Revenue_Today ? String(existingItemEntry.Revenue_Today) : '',
                                                                        Material_Cost_Today: existingItemEntry.Material_Cost_Today ? String(existingItemEntry.Material_Cost_Today) : '',
                                                                        Labor_Cost_Today: existingItemEntry.Labor_Cost_Today ? String(existingItemEntry.Labor_Cost_Today) : '',
                                                                        Other_Costs_Today: existingItemEntry.Other_Costs_Today ? String(existingItemEntry.Other_Costs_Today) : '',
                                                                        Notes: existingItemEntry.Notes || '',
                                                                    },
                                                                }));
                                                            }
                                                        }
                                                    }}
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '16px', transition: 'transform 0.2s' }}>
                                                        {isExpanded ? 'expand_more' : 'chevron_right'}
                                                    </span>
                                                    <span className="item-name">{item.Product_Name}</span>
                                                    {existingItemEntry && (
                                                        <span className="item-badge">
                                                            {formatNum(existingItemEntry.Daily_Profit)} KM
                                                        </span>
                                                    )}
                                                </button>

                                                {isExpanded && (
                                                    <div className="dpm-item-form">
                                                        <div className="dpm-form-grid">
                                                            <div className="dpm-field">
                                                                <label>Prihod</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    placeholder="0.00"
                                                                    value={itemForm.Revenue_Today}
                                                                    onChange={(e) => setItemForms(prev => ({
                                                                        ...prev,
                                                                        [item.ID]: { ...itemForm, Revenue_Today: e.target.value },
                                                                    }))}
                                                                />
                                                            </div>
                                                            <div className="dpm-field">
                                                                <label>Materijal</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    placeholder="0.00"
                                                                    value={itemForm.Material_Cost_Today}
                                                                    onChange={(e) => setItemForms(prev => ({
                                                                        ...prev,
                                                                        [item.ID]: { ...itemForm, Material_Cost_Today: e.target.value },
                                                                    }))}
                                                                />
                                                            </div>
                                                            <div className="dpm-field">
                                                                <label>Rad</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    placeholder="0.00"
                                                                    value={itemForm.Labor_Cost_Today}
                                                                    onChange={(e) => setItemForms(prev => ({
                                                                        ...prev,
                                                                        [item.ID]: { ...itemForm, Labor_Cost_Today: e.target.value },
                                                                    }))}
                                                                />
                                                            </div>
                                                            <div className="dpm-field">
                                                                <label>Ostalo</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    placeholder="0.00"
                                                                    value={itemForm.Other_Costs_Today}
                                                                    onChange={(e) => setItemForms(prev => ({
                                                                        ...prev,
                                                                        [item.ID]: { ...itemForm, Other_Costs_Today: e.target.value },
                                                                    }))}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className={`dpm-daily-result small ${itemProfit >= 0 ? 'positive' : 'negative'}`}>
                                                            <span>Profit stavke</span>
                                                            <strong>{formatNum(itemProfit)} KM</strong>
                                                        </div>
                                                        <button
                                                            className="dpm-save small"
                                                            onClick={() => handleSaveItem(item)}
                                                            disabled={saving}
                                                        >
                                                            {saving ? '...' : `Sačuvaj ${item.Product_Name}`}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* History Tab */
                        <div className="dpm-history">
                            {entries.filter(e => !e.Work_Order_Item_ID).length === 0 ? (
                                <div className="dpm-empty">
                                    <span className="material-icons-round" style={{ fontSize: '40px', color: '#d1d5db' }}>receipt_long</span>
                                    <p>Nema unesenih podataka</p>
                                </div>
                            ) : (
                                entries
                                    .filter(e => !e.Work_Order_Item_ID)
                                    .map((entry) => (
                                        <div key={entry.ID} className="dpm-history-card">
                                            <div className="history-header">
                                                <div className="history-date">{formatDate(entry.Date)}</div>
                                                <div className={`history-profit ${entry.Daily_Profit >= 0 ? 'green' : 'red'}`}>
                                                    {formatNum(entry.Daily_Profit)} KM
                                                </div>
                                            </div>
                                            <div className="history-details">
                                                <span>Prihod: {formatNum(entry.Revenue_Today)}</span>
                                                <span>Mat: {formatNum(entry.Material_Cost_Today)}</span>
                                                <span>Rad: {formatNum(entry.Labor_Cost_Today)}</span>
                                                {entry.Other_Costs_Today > 0 && <span>Ost: {formatNum(entry.Other_Costs_Today)}</span>}
                                            </div>
                                            {entry.Notes && (
                                                <div className="history-notes">{entry.Notes}</div>
                                            )}
                                            {/* Per-item entries for this date */}
                                            {entries.filter(e => e.Work_Order_Item_ID && e.Date === entry.Date).length > 0 && (
                                                <div className="history-items">
                                                    {entries.filter(e => e.Work_Order_Item_ID && e.Date === entry.Date).map(itemEntry => (
                                                        <div key={itemEntry.ID} className="history-item-row">
                                                            <span className="item-label">{itemEntry.Product_Name}</span>
                                                            <span className={itemEntry.Daily_Profit >= 0 ? 'green' : 'red'}>
                                                                {formatNum(itemEntry.Daily_Profit)} KM
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="history-actions">
                                                <button
                                                    className="btn-edit-entry"
                                                    onClick={() => {
                                                        setSelectedDate(entry.Date);
                                                        setForm({
                                                            Revenue_Today: String(entry.Revenue_Today),
                                                            Material_Cost_Today: String(entry.Material_Cost_Today),
                                                            Labor_Cost_Today: String(entry.Labor_Cost_Today),
                                                            Other_Costs_Today: String(entry.Other_Costs_Today),
                                                            Notes: entry.Notes || '',
                                                        });
                                                        setTab('today');
                                                    }}
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '14px' }}>edit</span>
                                                    Uredi
                                                </button>
                                                <button className="btn-delete-entry" onClick={() => handleDelete(entry.ID)}>
                                                    <span className="material-icons-round" style={{ fontSize: '14px' }}>delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    ))
                            )}
                        </div>
                    )}
                </div>
            </div>

            <style jsx>{`
                .dpm-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.5);
                    backdrop-filter: blur(4px);
                    z-index: 999;
                    animation: fadeIn 0.2s;
                }
                .dpm-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: min(560px, 94vw);
                    max-height: 90vh;
                    background: #fff;
                    border-radius: 16px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
                    z-index: 1000;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    animation: slideUp 0.25s ease;
                }

                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes slideUp { from { opacity: 0; transform: translate(-50%, -48%) } to { opacity: 1; transform: translate(-50%, -50%) } }

                /* Header */
                .dpm-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 18px 22px;
                    border-bottom: 1px solid #f0f0f0;
                    background: linear-gradient(135deg, #fafbff, #f5f7ff);
                }
                .dpm-header-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .dpm-header h2 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 700;
                    color: #1a1a2e;
                }
                .dpm-header p {
                    margin: 2px 0 0;
                    font-size: 12px;
                    color: #64748b;
                }
                .dpm-close {
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 6px;
                    border-radius: 8px;
                    color: #94a3b8;
                    transition: all 0.15s;
                }
                .dpm-close:hover { background: #f1f5f9; color: #475569; }

                /* Summary */
                .dpm-summary {
                    display: flex;
                    gap: 16px;
                    padding: 14px 22px;
                    background: #f8fafc;
                    border-bottom: 1px solid #f0f0f0;
                    overflow-x: auto;
                }
                .dpm-summary-item {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    min-width: 0;
                }
                .dpm-summary-item.main {
                    padding: 6px 14px;
                    background: white;
                    border-radius: 10px;
                    border: 1px solid #e2e8f0;
                }
                .dpm-summary-item .label {
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: #94a3b8;
                    font-weight: 600;
                }
                .dpm-summary-item .value {
                    font-size: 14px;
                    font-weight: 700;
                    color: #334155;
                    white-space: nowrap;
                }
                .dpm-summary-item .value.green { color: #10b981; }
                .dpm-summary-item .value.red { color: #ef4444; }

                /* Tabs */
                .dpm-tabs {
                    display: flex;
                    padding: 0 22px;
                    border-bottom: 1px solid #f0f0f0;
                    gap: 0;
                }
                .dpm-tab {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 12px 16px;
                    background: none;
                    border: none;
                    border-bottom: 2px solid transparent;
                    font-size: 13px;
                    font-weight: 600;
                    color: #94a3b8;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .dpm-tab.active {
                    color: #667eea;
                    border-bottom-color: #667eea;
                }
                .dpm-tab:hover:not(.active) { color: #64748b; }

                /* Body */
                .dpm-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 18px 22px;
                }
                .dpm-loading {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 40px;
                    color: #94a3b8;
                    font-size: 13px;
                }

                /* Date row */
                .dpm-date-row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 16px;
                }
                .dpm-date-row label {
                    font-size: 13px;
                    font-weight: 600;
                    color: #475569;
                }
                .dpm-date-row input {
                    padding: 8px 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 13px;
                    color: #1e293b;
                }

                /* Form Grid */
                .dpm-form-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                    margin-bottom: 12px;
                }
                .dpm-field {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .dpm-field.full { grid-column: 1 / -1; }
                .dpm-field label {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #64748b;
                }
                .dpm-field input, .dpm-field textarea {
                    padding: 10px 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    font-size: 14px;
                    color: #1e293b;
                    transition: border-color 0.15s;
                    background: #fafbfc;
                }
                .dpm-field input:focus, .dpm-field textarea:focus {
                    border-color: #667eea;
                    outline: none;
                    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
                    background: #fff;
                }
                .dpm-field textarea {
                    resize: vertical;
                    min-height: 48px;
                }

                /* Daily result */
                .dpm-daily-result {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    border-radius: 10px;
                    margin-bottom: 12px;
                    font-size: 14px;
                }
                .dpm-daily-result.positive {
                    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.04));
                    border: 1px solid rgba(16, 185, 129, 0.2);
                }
                .dpm-daily-result.negative {
                    background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.04));
                    border: 1px solid rgba(239, 68, 68, 0.2);
                }
                .dpm-daily-result span { color: #64748b; font-weight: 500; }
                .dpm-daily-result strong { font-size: 16px; }
                .dpm-daily-result.positive strong { color: #10b981; }
                .dpm-daily-result.negative strong { color: #ef4444; }
                .dpm-daily-result.small { padding: 8px 12px; margin-bottom: 8px; font-size: 12px; }
                .dpm-daily-result.small strong { font-size: 13px; }

                /* Save Button */
                .dpm-save {
                    width: 100%;
                    padding: 12px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .dpm-save:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(102, 126, 234, 0.3); }
                .dpm-save:disabled { opacity: 0.6; cursor: not-allowed; }
                .dpm-save.small {
                    padding: 8px;
                    font-size: 12px;
                    border-radius: 8px;
                    background: linear-gradient(135deg, #3b82f6, #2563eb);
                }

                /* Per-Item Section */
                .dpm-items-section {
                    margin-top: 20px;
                    border-top: 1px solid #e2e8f0;
                    padding-top: 16px;
                }
                .dpm-items-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #475569;
                    margin-bottom: 10px;
                }
                .dpm-item-card {
                    margin-bottom: 6px;
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    overflow: hidden;
                }
                .dpm-item-toggle {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 10px 14px;
                    background: #fafbfc;
                    border: none;
                    cursor: pointer;
                    text-align: left;
                    transition: background 0.15s;
                }
                .dpm-item-toggle:hover { background: #f0f4ff; }
                .dpm-item-toggle .item-name {
                    flex: 1;
                    font-size: 13px;
                    font-weight: 600;
                    color: #1e293b;
                }
                .dpm-item-toggle .item-badge {
                    padding: 2px 8px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    background: rgba(16, 185, 129, 0.1);
                    color: #10b981;
                }
                .dpm-item-form {
                    padding: 12px 14px;
                    background: white;
                    border-top: 1px solid #f0f0f0;
                }

                /* History */
                .dpm-history { display: flex; flex-direction: column; gap: 8px; }
                .dpm-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    padding: 40px;
                    color: #94a3b8;
                }
                .dpm-history-card {
                    padding: 14px 16px;
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    background: white;
                }
                .history-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }
                .history-date {
                    font-size: 14px;
                    font-weight: 700;
                    color: #1e293b;
                }
                .history-profit {
                    font-size: 15px;
                    font-weight: 700;
                }
                .history-profit.green { color: #10b981; }
                .history-profit.red { color: #ef4444; }
                .history-details {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    font-size: 12px;
                    color: #64748b;
                    margin-bottom: 6px;
                }
                .history-details span {
                    padding: 2px 8px;
                    background: #f8fafc;
                    border-radius: 4px;
                }
                .history-notes {
                    font-size: 12px;
                    color: #475569;
                    padding: 6px 10px;
                    background: #fefce8;
                    border-radius: 6px;
                    margin-bottom: 6px;
                    font-style: italic;
                }
                .history-items {
                    border-top: 1px dashed #e2e8f0;
                    padding-top: 6px;
                    margin-top: 6px;
                    margin-bottom: 6px;
                }
                .history-item-row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 12px;
                    padding: 3px 0;
                }
                .item-label { color: #64748b; }
                .green { color: #10b981; font-weight: 600; }
                .red { color: #ef4444; font-weight: 600; }
                .history-actions {
                    display: flex;
                    gap: 6px;
                    margin-top: 8px;
                }
                .btn-edit-entry, .btn-delete-entry {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    border: none;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .btn-edit-entry {
                    background: #f1f5f9;
                    color: #64748b;
                }
                .btn-edit-entry:hover { background: #e2e8f0; }
                .btn-delete-entry {
                    background: rgba(239, 68, 68, 0.08);
                    color: #ef4444;
                }
                .btn-delete-entry:hover { background: rgba(239, 68, 68, 0.15); }

                @media (max-width: 600px) {
                    .dpm-modal { width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; top: 0; left: 0; transform: none; }
                    .dpm-form-grid { grid-template-columns: 1fr; }
                    .dpm-summary { flex-direction: column; gap: 8px; }
                }
            `}</style>
        </>
    );
}
