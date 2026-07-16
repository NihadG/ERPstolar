'use client';

import { useState, useMemo, useEffect } from 'react';
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
    zIndex?: number;               // for stacking on top of another open modal
    initialWorkerId?: string;      // pre-select a worker on the first task row when opened
    onOrderCreated?: (workOrderId: string, workOrderNumber: string) => void; // fired on success, in addition to onCreated
}

interface TaskRow {
    id: string;
    text: string;
    workerIds: string[];     // više radnika po zadatku (prvi = glavni, ostali = pomoćnici)
    linkedItemId?: string;  // WorkOrderItem ID of a real product (optional)
}

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`);

export default function CustomTasksModal({ isOpen, onClose, workOrders, workers, organizationId, onCreated, showToast, zIndex, initialWorkerId, onOrderCreated }: CustomTasksModalProps) {
    const [rows, setRows] = useState<TaskRow[]>([{ id: uid(), text: '', workerIds: initialWorkerId ? [initialWorkerId] : [] }]);
    const [notes, setNotes] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [saving, setSaving] = useState(false);

    // Component may stay mounted across opens (parent toggles `isOpen`), so
    // re-seed a clean, pre-filled state every time it actually opens.
    useEffect(() => {
        if (isOpen) {
            setRows([{ id: uid(), text: '', workerIds: initialWorkerId ? [initialWorkerId] : [] }]);
            setNotes('');
            setDueDate('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

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

    const addRow = () => setRows(prev => [...prev, { id: uid(), text: '', workerIds: [] }]);
    const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));
    const updateRow = (id: string, patch: Partial<TaskRow>) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    const addWorker = (id: string, workerId: string) => setRows(prev => prev.map(r =>
        r.id === id && workerId && !r.workerIds.includes(workerId) ? { ...r, workerIds: [...r.workerIds, workerId] } : r
    ));
    const removeWorker = (id: string, workerId: string) => setRows(prev => prev.map(r =>
        r.id === id ? { ...r, workerIds: r.workerIds.filter(w => w !== workerId) } : r
    ));

    const validRows = rows.filter(r => r.text.trim().length > 0);
    const hasAnyWorker = validRows.some(r => r.workerIds.length > 0);
    const reset = () => { setRows([{ id: uid(), text: '', workerIds: [] }]); setNotes(''); setDueDate(''); };

    const handleCreate = async () => {
        if (!organizationId || saving) return;
        if (validRows.length === 0) { showToast('Dodaj barem jedan zadatak', 'error'); return; }
        setSaving(true);
        try {
            const items = validRows.map(r => {
                const link = r.linkedItemId ? linkLookup.get(r.linkedItemId) : undefined;
                const chosen = r.workerIds.map(id => workerLookup.get(id)).filter((w): w is Worker => !!w);
                const [main, ...helpers] = chosen;
                return {
                    Product_ID: `custom-${uid()}`,
                    Product_Name: r.text.trim(),
                    Project_ID: '',
                    Project_Name: 'Razni poslovi',
                    Quantity: 1,
                    Item_Type: 'custom' as const,
                    // Implicitni proces "Rad": prvi radnik = glavni, ostali = pomoćnici. Svi u
                    // Assigned_Workers (izvor za auto-knjiženje iz šihtarice za SVAKOG radnika).
                    ...(chosen.length > 0 ? {
                        Processes: [{
                            Process_Name: 'Rad', Status: 'Na čekanju',
                            Worker_ID: main.Worker_ID, Worker_Name: main.Name,
                            ...(helpers.length > 0 ? { Helpers: helpers.map(h => ({ Worker_ID: h.Worker_ID, Worker_Name: h.Name })) } : {}),
                        }],
                        Assigned_Workers: chosen.map(w => ({ Worker_ID: w.Worker_ID, Worker_Name: w.Name, Daily_Rate: w.Daily_Rate || 0 })),
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
                if (res.data) onOrderCreated?.(res.data.Work_Order_ID, res.data.Work_Order_Number);
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
        <Modal isOpen={isOpen} onClose={onClose} title="Razni poslovi — nalog sa zadacima" size="large" footer={null} zIndex={zIndex}>
            <div className="ctm">
                <p className="ctm-intro">
                    Zadaci koji nisu proizvodi iz baze (izrada paleta, čišćenje pogona…). Dodijeli jednog ili više
                    radnika da nalog možeš pokrenuti, a zadatak možeš povezati s bilo kojim proizvodom (i završenim) —
                    tada se sav rad na ovom zadatku uračuna u trošak tog proizvoda.
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
                                    <div className="ctm-field">
                                        <span>Radnici <em>(prvi = glavni)</em></span>
                                        {row.workerIds.length > 0 && (
                                            <div className="ctm-chips">
                                                {row.workerIds.map((wid, i) => {
                                                    const w = workerLookup.get(wid);
                                                    return (
                                                        <span key={wid} className={`ctm-chip${i === 0 ? ' ctm-chip-main' : ''}`}>
                                                            {i === 0 && <span className="ctm-chip-tag">glavni</span>}
                                                            {w?.Name || 'Nepoznat'}
                                                            <button type="button" className="ctm-chip-x" onClick={() => removeWorker(row.id, wid)} aria-label="Ukloni radnika"><X size={12} /></button>
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        <SearchableSelect
                                            options={workerOptions.filter(o => !row.workerIds.includes(o.value))}
                                            value=""
                                            onChange={v => addWorker(row.id, v)}
                                            placeholder={row.workerIds.length > 0 ? 'Dodaj još radnika…' : 'Izaberi radnika…'}
                                        />
                                    </div>
                                    <label className="ctm-field">
                                        <span>Poveži s proizvodom <em>(bilo koji — trošak rada ide tom proizvodu)</em></span>
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
                /* Single source of truth for every form control's box (input,
                   date field, and the SearchableSelect trigger below) so none
                   of them drift apart in height/radius/border/font again. */
                .ctm {
                    --ctm-control-h: 42px;
                    --ctm-radius: var(--radius-sm);
                    --ctm-font: 14px;
                    display: flex; flex-direction: column; gap: 24px; padding: 4px 4px 0;
                }
                .ctm-intro { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; }

                .ctm-section { display: flex; flex-direction: column; gap: 14px; }
                .ctm-section-head {
                    display: flex; align-items: center; gap: 10px;
                    font-size: 14px; font-weight: 700; color: var(--text-primary);
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
                    flex: 1; min-width: 0; height: var(--ctm-control-h); box-sizing: border-box;
                    border: 1px solid var(--border); border-radius: var(--ctm-radius);
                    padding: 0 14px; font-size: var(--ctm-font); font-weight: 500; color: var(--text-primary); background: var(--background);
                    transition: var(--transition);
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

                /* Field caption + control — shared by native inputs (Rok, Napomena)
                   and the SearchableSelect fields (Radnik, Poveži s proizvodom).
                   .ctm-field is itself the label element, so resetting text-transform
                   here (not uppercase, not any other case) also fixes the global
                   .modal label text-transform:uppercase rule that was inherited
                   all the way down into the SearchableSelect trigger text. */
                .ctm-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; text-transform: none; }
                .ctm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
                .ctm-chip {
                    display: inline-flex; align-items: center; gap: 6px;
                    padding: 4px 6px 4px 10px; border-radius: 999px;
                    background: var(--surface); border: 1px solid var(--border);
                    font-size: 12px; font-weight: 600; color: var(--text-primary);
                }
                .ctm-chip-main { border-color: var(--accent); background: var(--accent-light); }
                .ctm-chip-tag {
                    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
                    color: var(--accent); background: var(--background); padding: 1px 5px; border-radius: 999px;
                }
                .ctm-chip-x {
                    display: inline-flex; align-items: center; justify-content: center;
                    width: 18px; height: 18px; border: none; background: transparent;
                    color: var(--text-tertiary); border-radius: 999px; cursor: pointer;
                }
                .ctm-chip-x:hover { color: var(--error); background: var(--error-bg); }
                .ctm-field > span { font-size: 13px; color: var(--text-secondary); font-weight: 600; text-transform: none; letter-spacing: normal; }
                .ctm-field > span em { font-style: normal; color: var(--text-tertiary); font-weight: 400; }
                .ctm-field > input {
                    height: var(--ctm-control-h); box-sizing: border-box;
                    border: 1px solid var(--border); border-radius: var(--ctm-radius);
                    padding: 0 14px; font-size: var(--ctm-font); color: var(--text-primary); background: var(--background);
                    transition: var(--transition);
                }
                .ctm-field > input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }

                /* SearchableSelect renders its own trigger box — pin it to the
                   exact same height/radius/border/font as the inputs above so
                   nothing in this modal is a different size from anything else. */
                .ctm-field :global(.searchable-select-trigger) {
                    height: var(--ctm-control-h) !important;
                    box-sizing: border-box !important;
                    padding: 0 14px !important;
                    border: 1px solid var(--border) !important;
                    border-radius: var(--ctm-radius) !important;
                    background: var(--background) !important;
                    box-shadow: none !important;
                }
                .ctm-field :global(.searchable-select-trigger.active) {
                    border-color: var(--accent) !important;
                    box-shadow: 0 0 0 3px var(--accent-light) !important;
                }
                .ctm-field :global(.trigger-text) {
                    font-size: var(--ctm-font) !important;
                    font-weight: 500 !important;
                    color: var(--text-primary) !important;
                }
                .ctm-field :global(.trigger-text.placeholder) {
                    color: var(--text-tertiary) !important;
                    font-weight: 400 !important;
                }
                .ctm-field :global(.trigger-icon) {
                    color: var(--text-tertiary) !important;
                    font-size: 18px !important;
                }

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
