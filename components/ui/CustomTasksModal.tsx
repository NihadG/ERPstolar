'use client';

import { useState, useMemo } from 'react';
import { Plus, X, Loader2, ClipboardList, AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import { SearchableSelect } from './SearchableSelect';
import { createWorkOrder } from '@/lib/services';
import type { WorkOrder, Worker } from '@/lib/types';

interface CustomTasksModalProps {
    isOpen: boolean;
    onClose: () => void;
    workOrders: WorkOrder[];
    workers: Worker[];
    organizationId: string;
    onCreated: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface TaskRow {
    id: string;
    text: string;
    workerId?: string;
    linkedItemId?: string;  // WorkOrderItem ID of a real product (optional)
}

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`);

export default function CustomTasksModal({ isOpen, onClose, workOrders, workers, organizationId, onCreated, showToast }: CustomTasksModalProps) {
    const [rows, setRows] = useState<TaskRow[]>([{ id: uid(), text: '' }]);
    const [notes, setNotes] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [saving, setSaving] = useState(false);

    const workerOptions = useMemo(
        () => workers.map(w => ({ value: w.Worker_ID, label: w.Name, subLabel: `${w.Worker_Type} · ${w.Daily_Rate || 0} KM` })),
        [workers]
    );
    const workerLookup = useMemo(() => {
        const m = new Map<string, Worker>();
        workers.forEach(w => m.set(w.Worker_ID, w));
        return m;
    }, [workers]);

    // Real products (across all work orders, including finished) — for optional linking
    const linkOptions = useMemo(() => {
        const opts: { value: string; label: string; subLabel: string; productId: string; productName: string }[] = [];
        workOrders.forEach(wo => {
            (wo.items || []).forEach(it => {
                if (it.Item_Type === 'custom') return;
                opts.push({
                    value: it.ID,
                    label: it.Product_Name,
                    subLabel: `${it.Project_Name || ''} · Nalog ${wo.Work_Order_Number}${wo.Status === 'Završeno' ? ' (završen)' : ''}`,
                    productId: it.Product_ID,
                    productName: it.Product_Name,
                });
            });
        });
        return opts;
    }, [workOrders]);
    const linkLookup = useMemo(() => {
        const m = new Map<string, { productId: string; productName: string }>();
        linkOptions.forEach(o => m.set(o.value, { productId: o.productId, productName: o.productName }));
        return m;
    }, [linkOptions]);

    const addRow = () => setRows(prev => [...prev, { id: uid(), text: '' }]);
    const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));
    const updateRow = (id: string, patch: Partial<TaskRow>) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

    const validRows = rows.filter(r => r.text.trim().length > 0);
    const hasAnyWorker = validRows.some(r => r.workerId);
    const reset = () => { setRows([{ id: uid(), text: '' }]); setNotes(''); setDueDate(''); };

    const handleCreate = async () => {
        if (!organizationId || saving) return;
        if (validRows.length === 0) { showToast('Dodaj barem jedan zadatak', 'error'); return; }
        setSaving(true);
        try {
            const items = validRows.map(r => {
                const link = r.linkedItemId ? linkLookup.get(r.linkedItemId) : undefined;
                const worker = r.workerId ? workerLookup.get(r.workerId) : undefined;
                return {
                    Product_ID: `custom-${uid()}`,
                    Product_Name: r.text.trim(),
                    Project_ID: '',
                    Project_Name: 'Razni poslovi',
                    Quantity: 1,
                    Item_Type: 'custom' as const,
                    // Implicitni proces "Rad" sa radnikom → nalog se može pokrenuti
                    ...(worker ? {
                        Processes: [{ Process_Name: 'Rad', Status: 'Na čekanju', Worker_ID: worker.Worker_ID, Worker_Name: worker.Name }],
                        Assigned_Workers: [{ Worker_ID: worker.Worker_ID, Worker_Name: worker.Name, Daily_Rate: worker.Daily_Rate || 0 }],
                    } : {}),
                    ...(r.linkedItemId && link ? {
                        Linked_Item_ID: r.linkedItemId,
                        Linked_Product_ID: link.productId,
                        Linked_Product_Name: link.productName,
                    } : {}),
                };
            });

            const res = await createWorkOrder({
                Work_Order_Type: 'Zadaci',
                Production_Steps: [],
                Due_Date: dueDate || undefined,
                Notes: notes || undefined,
                items,
            }, organizationId);

            if (res.success) {
                showToast(`Nalog "Razni poslovi" kreiran (${items.length} zadataka)`, 'success');
                onCreated('workOrders');
                reset();
                onClose();
            } else {
                showToast(res.message || 'Greška pri kreiranju', 'error');
            }
        } catch (err) {
            console.error('CustomTasksModal create error', err);
            showToast('Greška pri kreiranju naloga', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Razni poslovi — nalog sa zadacima" size="large" footer={null}>
            <div className="ctm">
                <p className="ctm-intro">
                    Zadaci koji nisu proizvodi iz baze (izrada paleta, čišćenje pogona…). Dodijeli radnika da
                    nalog možeš pokrenuti, a zadatak možeš opciono povezati s proizvodom — tada se trošak rada dodaje tom proizvodu.
                </p>

                <section className="ctm-section">
                    <div className="ctm-section-head">
                        <span>Zadaci</span>
                        <span className="ctm-count">{validRows.length}</span>
                    </div>

                    <div className="ctm-tasks">
                        {rows.map((row, idx) => (
                            <div className="ctm-task" key={row.id}>
                                <div className="ctm-task-top">
                                    <span className="ctm-num">{idx + 1}</span>
                                    <input
                                        className="ctm-input"
                                        placeholder="Naziv zadatka (npr. Izrada paleta)"
                                        value={row.text}
                                        onChange={e => updateRow(row.id, { text: e.target.value })}
                                    />
                                    {rows.length > 1 && (
                                        <button className="ctm-remove" onClick={() => removeRow(row.id)} aria-label="Ukloni zadatak"><X size={16} /></button>
                                    )}
                                </div>
                                <div className="ctm-task-fields">
                                    <label className="ctm-field">
                                        <span>Radnik</span>
                                        <SearchableSelect
                                            options={workerOptions}
                                            value={row.workerId || ''}
                                            onChange={v => updateRow(row.id, { workerId: v || undefined })}
                                            placeholder="Izaberi radnika…"
                                        />
                                    </label>
                                    <label className="ctm-field">
                                        <span>Poveži s proizvodom <em>(opciono)</em></span>
                                        <SearchableSelect
                                            options={linkOptions}
                                            value={row.linkedItemId || ''}
                                            onChange={v => updateRow(row.id, { linkedItemId: v || undefined })}
                                            placeholder="Bez veze — samostalan trošak"
                                        />
                                    </label>
                                </div>
                            </div>
                        ))}
                    </div>

                    <button className="ctm-add" onClick={addRow}><Plus size={16} /> Dodaj zadatak</button>
                </section>

                <section className="ctm-section">
                    <div className="ctm-section-head"><span>Detalji naloga</span></div>
                    <div className="ctm-grid2">
                        <label className="ctm-field">
                            <span>Rok <em>(opciono)</em></span>
                            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                        </label>
                        <label className="ctm-field">
                            <span>Napomena <em>(opciono)</em></span>
                            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="npr. interni poslovi za juni" />
                        </label>
                    </div>
                </section>

                <div className="ctm-footer">
                    {validRows.length > 0 && !hasAnyWorker && (
                        <span className="ctm-warn"><AlertTriangle size={14} /> Bez radnika nalog se neće moći pokrenuti</span>
                    )}
                    <div className="ctm-footer-btns">
                        <button className="ctm-btn" onClick={onClose} disabled={saving}>Odustani</button>
                        <button className="ctm-btn ctm-btn-primary" onClick={handleCreate} disabled={saving || validRows.length === 0}>
                            {saving ? <Loader2 size={15} className="ctm-spin" /> : <ClipboardList size={15} />}
                            Kreiraj nalog
                        </button>
                    </div>
                </div>
            </div>

            <style jsx>{`
                .ctm { display: flex; flex-direction: column; gap: 24px; padding: 4px 4px 0; }
                .ctm-intro { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; }

                .ctm-section { display: flex; flex-direction: column; gap: 14px; }
                .ctm-section-head {
                    display: flex; align-items: center; gap: 10px;
                    font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-secondary);
                }
                .ctm-count {
                    display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px;
                    font-size: 11px; font-weight: 700; color: var(--accent); background: var(--accent-light); border-radius: 999px;
                }

                .ctm-tasks { display: flex; flex-direction: column; gap: 12px; }
                .ctm-task {
                    display: flex; flex-direction: column; gap: 12px;
                    padding: 16px; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--background);
                }
                .ctm-task-top { display: flex; align-items: center; gap: 12px; }
                .ctm-num {
                    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 12px; font-weight: 700; color: var(--text-secondary); background: var(--surface);
                }
                .ctm-input {
                    flex: 1; min-width: 0; height: 40px; box-sizing: border-box;
                    border: 1px solid var(--border); border-radius: var(--radius-sm);
                    padding: 0 12px; font-size: 14px; font-weight: 500; color: var(--text-primary); background: var(--background);
                }
                .ctm-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
                .ctm-remove {
                    display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
                    width: 32px; height: 32px; border: none; background: transparent;
                    color: var(--text-tertiary); border-radius: var(--radius-sm); cursor: pointer;
                }
                .ctm-remove:hover { color: var(--error); background: var(--error-bg); }

                .ctm-task-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-left: 38px; }
                .ctm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .ctm-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
                .ctm-field > span { font-size: 12px; color: var(--text-secondary); font-weight: 600; }
                .ctm-field > span em { font-style: normal; color: var(--text-tertiary); font-weight: 400; }
                .ctm-field > input {
                    height: 40px; box-sizing: border-box;
                    border: 1px solid var(--border); border-radius: var(--radius-sm);
                    padding: 0 12px; font-size: 14px; color: var(--text-primary); background: var(--background);
                }
                .ctm-field > input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }

                .ctm-add {
                    align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
                    border: 1px dashed var(--border); background: transparent; color: var(--accent);
                    font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: var(--radius-sm); cursor: pointer;
                }
                .ctm-add:hover { background: var(--accent-light); border-color: var(--accent); }

                .ctm-footer {
                    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
                    padding-top: 16px; border-top: 1px solid var(--border-light);
                }
                .ctm-warn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--warning); }
                .ctm-footer-btns { display: flex; gap: 10px; margin-left: auto; }
                .ctm-btn {
                    display: inline-flex; align-items: center; gap: 6px;
                    border: 1px solid var(--border); background: var(--background); color: var(--text-primary);
                    font-size: 13px; font-weight: 600; padding: 10px 18px; border-radius: var(--radius-sm); cursor: pointer;
                }
                .ctm-btn:hover:not(:disabled) { background: var(--surface-hover); }
                .ctm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .ctm-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
                .ctm-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
                .ctm-spin { animation: ctm-spin 0.8s linear infinite; }
                @keyframes ctm-spin { to { transform: rotate(360deg); } }

                @media (max-width: 640px) {
                    .ctm-task-fields { grid-template-columns: 1fr; padding-left: 0; }
                    .ctm-grid2 { grid-template-columns: 1fr; }
                }
            `}</style>
        </Modal>
    );
}
