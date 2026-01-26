'use client';

import { useState, useMemo, useEffect } from 'react';
import type { WorkOrder, Worker } from '@/lib/types';
import WorkOrderPrintTemplate from './WorkOrderPrintTemplate';
import Modal from './Modal';

interface WorkOrderExpandedDetailProps {
    workOrder: WorkOrder;
    workers: Worker[];
    onUpdate: (workOrderId: string, updates: any) => Promise<void>;
    onPrint: (workOrder: WorkOrder) => void;
    onDelete: (workOrderId: string) => Promise<void>;
    onStart: (workOrderId: string) => Promise<void>;
}

const PROCESS_STATUSES = ['Na čekanju', 'U toku', 'Završeno', 'Odloženo'];

export default function WorkOrderExpandedDetail({
    workOrder,
    workers,
    onUpdate,
    onPrint,
    onDelete,
    onStart
}: WorkOrderExpandedDetailProps) {
    const [isEditMode, setIsEditMode] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [localItems, setLocalItems] = useState<any[]>([]);

    // Bulk edit state
    const [bulkProcess, setBulkProcess] = useState('');
    const [bulkStatus, setBulkStatus] = useState('');
    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

    // Initialize local items when work order changes
    useEffect(() => {
        if (workOrder?.items) {
            setLocalItems(JSON.parse(JSON.stringify(workOrder.items)));
        }
    }, [workOrder]);

    // Calculate progress
    const progress = useMemo(() => {
        if (!localItems.length || !workOrder?.Production_Steps?.length) return 0;

        let total = localItems.length * workOrder.Production_Steps.length;
        let completed = 0;

        localItems.forEach(item => {
            workOrder.Production_Steps.forEach(process => {
                const assignment = item.Process_Assignments?.[process];
                if (assignment?.Status === 'Završeno') completed++;
            });
        });

        return Math.round((completed / total) * 100);
    }, [localItems, workOrder]);

    function handleStatusChange(itemId: string, processName: string, newStatus: string) {
        setLocalItems(prev => prev.map(item => {
            if (item.ID === itemId) {
                return {
                    ...item,
                    Process_Assignments: {
                        ...item.Process_Assignments,
                        [processName]: {
                            ...item.Process_Assignments?.[processName],
                            Status: newStatus
                        }
                    }
                };
            }
            return item;
        }));
        setHasChanges(true);
    }

    function handleWorkerChange(itemId: string, processName: string, workerId: string) {
        const worker = workers.find(w => w.Worker_ID === workerId);
        setLocalItems(prev => prev.map(item => {
            if (item.ID === itemId) {
                return {
                    ...item,
                    Process_Assignments: {
                        ...item.Process_Assignments,
                        [processName]: {
                            ...item.Process_Assignments?.[processName],
                            Worker_ID: workerId,
                            Worker_Name: worker?.Name || ''
                        }
                    }
                };
            }
            return item;
        }));
        setHasChanges(true);
    }

    function handleToggleProduct(productId: string) {
        setSelectedProducts(prev => {
            const newSet = new Set(prev);
            if (newSet.has(productId)) {
                newSet.delete(productId);
            } else {
                newSet.add(productId);
            }
            return newSet;
        });
    }

    function handleBulkApply() {
        if (!bulkProcess || !bulkStatus) return;

        setLocalItems(prev => prev.map(item => {
            if (selectedProducts.has(item.ID)) {
                return {
                    ...item,
                    Process_Assignments: {
                        ...item.Process_Assignments,
                        [bulkProcess]: {
                            ...item.Process_Assignments?.[bulkProcess],
                            Status: bulkStatus
                        }
                    }
                };
            }
            return item;
        }));

        setHasChanges(true);
        setSelectedProducts(new Set());
        setBulkProcess('');
        setBulkStatus('');
    }

    async function handleSave() {
        // Create updates object with modified items
        await onUpdate(workOrder.Work_Order_ID, {
            items: localItems,
            Status: progress === 100 ? 'Završeno' : (progress > 0 && workOrder.Status !== 'Završeno' ? 'U toku' : workOrder.Status)
        });

        setHasChanges(false);
        setIsEditMode(false);
    }

    function handleCancel() {
        if (workOrder?.items) {
            setLocalItems(JSON.parse(JSON.stringify(workOrder.items)));
        }
        setHasChanges(false);
        setIsEditMode(false);
        setSelectedProducts(new Set());
    }

    function getStatusClass(status: string): string {
        switch (status) {
            case 'Završeno': return 'status-done';
            case 'U toku': return 'status-progress';
            case 'Odloženo': return 'status-delayed';
            default: return 'status-pending';
        }
    }

    return (
        <div className="wo-expanded-container">
            {/* Header / Toolbar */}
            <div className="wo-toolbar">
                <div className="progress-card">
                    <div className="progress-header">
                        <span className="label">Ukupni napredak</span>
                        <span className="percent">{progress}%</span>
                    </div>
                    <div className="progress-bar-bg">
                        <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>

                <div className="actions-card">
                    {isEditMode ? (
                        <div className="edit-actions">
                            <button className="btn-iso btn-cancel" onClick={handleCancel}>Poništi</button>
                            <button className="btn-iso btn-save" onClick={handleSave} disabled={!hasChanges}>
                                Sačuvaj
                            </button>
                        </div>
                    ) : (
                        <div className="view-actions">
                            {workOrder.Status === 'Nacrt' || workOrder.Status === 'Dodijeljeno' ? (
                                <button className="btn-iso btn-secondary" onClick={() => onStart(workOrder.Work_Order_ID)}>
                                    <span className="material-icons-round">play_arrow</span>
                                    <span>Pokreni</span>
                                </button>
                            ) : null}

                            <button className="btn-iso btn-secondary" onClick={() => onPrint(workOrder)}>
                                <span className="material-icons-round">print</span>
                                <span>Printaj</span>
                            </button>

                            <button className="btn-iso btn-primary" onClick={() => setIsEditMode(true)}>
                                <span className="material-icons-round">edit</span>
                                <span>Uredi</span>
                            </button>

                            <button className="btn-iso btn-danger-icon" onClick={() => onDelete(workOrder.Work_Order_ID)} title="Obriši nalog">
                                <span className="material-icons-round">delete</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Bulk Edit Tool (Edit Mode Only) */}
            {isEditMode && selectedProducts.size > 0 && (
                <div className="bulk-edit-container">
                    <div className="bulk-info">
                        <div className="selection-badge">{selectedProducts.size}</div>
                        <span>odabrano</span>
                    </div>
                    <div className="bulk-controls">
                        <select
                            value={bulkProcess}
                            onChange={e => setBulkProcess(e.target.value)}
                            className="ios-select"
                        >
                            <option value="">Odaberi proces...</option>
                            {workOrder.Production_Steps.map(step => (
                                <option key={step} value={step}>{step}</option>
                            ))}
                        </select>
                        <select
                            value={bulkStatus}
                            onChange={e => setBulkStatus(e.target.value)}
                            className="ios-select"
                        >
                            <option value="">Postavi status...</option>
                            {PROCESS_STATUSES.map(status => (
                                <option key={status} value={status}>{status}</option>
                            ))}
                        </select>
                        <button className="btn-iso btn-apply" onClick={handleBulkApply} disabled={!bulkProcess || !bulkStatus}>
                            Primijeni
                        </button>
                    </div>
                </div>
            )}

            {/* Desktop Table View */}
            <div className="desktop-view">
                <div className="table-container">
                    <table className="ios-table">
                        <thead>
                            <tr>
                                {isEditMode && (
                                    <th className="th-checkbox">
                                        <input
                                            type="checkbox"
                                            className="ios-checkbox"
                                            checked={selectedProducts.size === localItems.length && localItems.length > 0}
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedProducts(new Set(localItems.map(i => i.ID)));
                                                else setSelectedProducts(new Set());
                                            }}
                                        />
                                    </th>
                                )}
                                <th className="th-product">Proizvod</th>
                                {workOrder.Production_Steps.map(step => (
                                    <th key={step} className="th-process">{step}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {localItems.map(item => (
                                <tr key={item.ID} className={isEditMode && selectedProducts.has(item.ID) ? 'selected' : ''}>
                                    {isEditMode && (
                                        <td className="td-checkbox">
                                            <input
                                                type="checkbox"
                                                className="ios-checkbox"
                                                checked={selectedProducts.has(item.ID)}
                                                onChange={() => handleToggleProduct(item.ID)}
                                            />
                                        </td>
                                    )}
                                    <td className="td-product">
                                        <div className="prod-name">{item.Product_Name}</div>
                                        <div className="prod-meta">{item.Project_Name} • {item.Quantity} kom</div>
                                    </td>
                                    {workOrder.Production_Steps.map(process => {
                                        const assignment = item.Process_Assignments?.[process];
                                        return (
                                            <td key={process} className="td-process">
                                                {isEditMode ? (
                                                    <div className="cell-edit">
                                                        <select
                                                            value={assignment?.Status || 'Na čekanju'}
                                                            onChange={e => handleStatusChange(item.ID, process, e.target.value)}
                                                            className={`status-select ${getStatusClass(assignment?.Status || 'Na čekanju')}`}
                                                        >
                                                            {PROCESS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                        <select
                                                            value={assignment?.Worker_ID || ''}
                                                            onChange={e => handleWorkerChange(item.ID, process, e.target.value)}
                                                            className="worker-select"
                                                        >
                                                            <option value="">Dodijeli radnika...</option>
                                                            {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                                        </select>
                                                    </div>
                                                ) : (
                                                    <div className="cell-view">
                                                        <span className={`status-pill ${getStatusClass(assignment?.Status || 'Na čekanju')}`}>
                                                            {assignment?.Status || 'Na čekanju'}
                                                        </span>
                                                        {assignment?.Worker_Name && (
                                                            <span className="worker-pill">
                                                                <span className="material-icons-round">person</span>
                                                                {assignment.Worker_Name}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Mobile Card View */}
            <div className="mobile-view">
                {isEditMode && (
                    <div className="mobile-select-all">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                className="ios-checkbox"
                                checked={selectedProducts.size === localItems.length && localItems.length > 0}
                                onChange={(e) => {
                                    if (e.target.checked) setSelectedProducts(new Set(localItems.map(i => i.ID)));
                                    else setSelectedProducts(new Set());
                                }}
                            />
                            <span>Odaberi sve</span>
                        </label>
                    </div>
                )}
                {localItems.map(item => (
                    <div
                        key={item.ID}
                        className={`mobile-card ${isEditMode && selectedProducts.has(item.ID) ? 'selected' : ''}`}
                        onClick={() => {
                            if (isEditMode) handleToggleProduct(item.ID);
                        }}
                    >
                        <div className="card-header">
                            <div className="card-title">
                                <div className="prod-name">{item.Product_Name}</div>
                                <div className="prod-meta">{item.Project_Name} • {item.Quantity} kom</div>
                            </div>
                            {isEditMode && (
                                <div className="card-check">
                                    <input
                                        type="checkbox"
                                        className="ios-checkbox"
                                        checked={selectedProducts.has(item.ID)}
                                        readOnly
                                    />
                                </div>
                            )}
                        </div>

                        <div className="card-steps" onClick={e => e.stopPropagation()}>
                            {workOrder.Production_Steps.map(process => {
                                const assignment = item.Process_Assignments?.[process];
                                return (
                                    <div key={process} className="step-row">
                                        <div className="step-label">{process}</div>
                                        <div className="step-content">
                                            {isEditMode ? (
                                                <div className="step-edit">
                                                    <select
                                                        value={assignment?.Status || 'Na čekanju'}
                                                        onChange={e => handleStatusChange(item.ID, process, e.target.value)}
                                                        className={`status-select ${getStatusClass(assignment?.Status || 'Na čekanju')}`}
                                                    >
                                                        {PROCESS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                                    </select>
                                                    <select
                                                        value={assignment?.Worker_ID || ''}
                                                        onChange={e => handleWorkerChange(item.ID, process, e.target.value)}
                                                        className="worker-select"
                                                    >
                                                        <option value="">Dodijeli...</option>
                                                        {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                                    </select>
                                                </div>
                                            ) : (
                                                <div className="step-view">
                                                    <span className={`status-pill ${getStatusClass(assignment?.Status || 'Na čekanju')}`}>
                                                        {assignment?.Status || 'Na čekanju'}
                                                    </span>
                                                    {assignment?.Worker_Name && (
                                                        <span className="worker-text">
                                                            {assignment.Worker_Name}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <style jsx>{`
                .wo-expanded-container {
                    padding: 24px;
                    background: #f5f5f7;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }

                /* Toolbar */
                .wo-toolbar {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 24px;
                    flex-wrap: wrap;
                }

                .progress-card, .actions-card {
                    background: white;
                    border-radius: 16px;
                    padding: 16px 20px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.03);
                    border: 1px solid rgba(0,0,0,0.04);
                }

                .progress-card {
                    flex: 1;
                    min-width: 250px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 8px;
                }

                .actions-card {
                    display: flex;
                    align-items: center;
                }

                .progress-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                }

                .progress-header .label { font-size: 13px; color: #86868b; font-weight: 500; }
                .progress-header .percent { font-size: 17px; font-weight: 600; color: #1d1d1f; }

                .progress-bar-bg {
                    height: 8px;
                    background: #f5f5f7;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .progress-bar-fill { height: 100%; background: #34c759; transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1); }

                /* Buttons */
                .view-actions, .edit-actions {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }

                .btn-iso {
                    height: 36px;
                    padding: 0 16px;
                    border-radius: 10px;
                    font-size: 13px;
                    font-weight: 500;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.2s ease;
                }

                .btn-iso .material-icons-round { font-size: 16px; }

                .btn-primary { background: #0071e3; color: white; }
                .btn-primary:hover { background: #0077ed; }

                .btn-secondary { background: #f5f5f7; color: #1d1d1f; }
                .btn-secondary:hover { background: #e8e8ed; }

                .btn-save { background: #000; color: white; }
                .btn-cancel { background: transparent; color: #86868b; }
                .btn-cancel:hover { background: #f5f5f7; color: #1d1d1f; }

                .btn-danger-icon {
                    width: 36px;
                    padding: 0;
                    justify-content: center;
                    background: #fff0f0;
                    color: #d32f2f;
                }
                .btn-danger-icon:hover { background: #fee2e2; }

                .btn-apply { background: #0071e3; color: white; height: 32px; padding: 0 14px; }

                /* Bulk Edit */
                .bulk-edit-container {
                    background: white;
                    border-radius: 12px;
                    padding: 12px 16px;
                    margin-bottom: 24px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.03);
                    flex-wrap: wrap;
                    gap: 12px;
                }

                .bulk-info { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #1d1d1f; }
                .selection-badge {
                    background: #000; color: white; font-weight: 600;
                    width: 20px; height: 20px; border-radius: 10px;
                    display: flex; align-items: center; justify-content: center; font-size: 11px;
                }

                .bulk-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

                .ios-select {
                    height: 32px;
                    padding: 0 10px;
                    border-radius: 8px;
                    border: 1px solid #d2d2d7;
                    font-size: 12px;
                    background: white;
                    color: #1d1d1f;
                    outline: none;
                }

                /* Table View (Desktop) */
                .desktop-view { display: block; }
                .mobile-view { display: none; }

                .table-container {
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.04);
                    overflow: hidden;
                    overflow-x: auto;
                }

                .ios-table {
                    width: 100%;
                    border-collapse: collapse;
                    min-width: 800px;
                }

                .ios-table th {
                    text-align: left;
                    padding: 14px 16px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #86868b;
                    border-bottom: 1px solid #e5e5e5;
                    background: #fafafa;
                    white-space: nowrap;
                }

                .ios-table td {
                    padding: 14px 16px;
                    border-bottom: 1px solid #f0f0f0;
                    vertical-align: top;
                }

                .ios-table tr:hover td { background: #fafafa; }
                .ios-table tr:last-child td { border-bottom: none; }
                .ios-table tr.selected td { background: #f2f7ff; }

                .th-checkbox, .td-checkbox { width: 40px; text-align: center; }
                .th-product, .td-product { max-width: 250px; }
                .th-process, .td-process { min-width: 140px; }

                .prod-name { font-size: 14px; font-weight: 600; color: #1d1d1f; margin-bottom: 2px; }
                .prod-meta { font-size: 12px; color: #86868b; }

                .status-pill {
                    display: inline-flex;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 500;
                    white-space: nowrap;
                }

                .status-pending { background: #f5f5f7; color: #666; }
                .status-progress { background: #e3f2fd; color: #0071e3; }
                .status-done { background: #e8f5e9; color: #34c759; }
                .status-delayed { background: #ffebee; color: #d32f2f; }

                .worker-pill {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    color: #666;
                    background: #f5f5f7;
                    padding: 2px 8px;
                    border-radius: 6px;
                    margin-top: 6px;
                    width: fit-content;
                }
                .worker-pill .material-icons-round { font-size: 12px; }

                /* Cell Edit/View */
                .cell-view { display: flex; flex-direction: column; gap: 4px; }
                .cell-edit { display: flex; flex-direction: column; gap: 6px; }

                .status-select, .worker-select {
                    width: 100%;
                    padding: 6px;
                    border-radius: 6px;
                    border: 1px solid #e5e5e5;
                    font-size: 12px;
                    outline: none;
                }
                .status-select.status-done { color: #34c759; border-color: #ccebd2; background: #e8f5e9; }
                .status-select.status-progress { color: #0071e3; border-color: #cce4f7; background: #e3f2fd; }

                /* Mobile View */
                @media (max-width: 768px) {
                    .wo-expanded-container { padding: 16px; background: #f2f2f7; }
                    .desktop-view { display: none; }
                    .mobile-view { display: flex; flex-direction: column; gap: 12px; }

                    .wo-toolbar { flex-direction: column; gap: 12px; margin-bottom: 20px; }
                    .progress-card { min-width: auto; }
                    .actions-card { flex-wrap: wrap; justify-content: space-between; }
                    .view-actions button { flex: 1; justify-content: center; }

                    .mobile-select-all {
                        padding: 0 4px;
                        margin-bottom: 8px;
                    }
                    .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }

                    .mobile-card {
                        background: white;
                        border-radius: 16px;
                        padding: 16px;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                        border: 1px solid transparent;
                        transition: all 0.2s;
                    }
                    .mobile-card.selected { border-color: #0071e3; background: #f7fbff; }

                    .card-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        margin-bottom: 16px;
                        padding-bottom: 12px;
                        border-bottom: 1px solid #f5f5f7;
                    }

                    .card-steps { display: flex; flex-direction: column; gap: 12px; }

                    .step-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 13px;
                    }

                    .step-label { color: #86868b; font-weight: 500; flex: 1; }
                    .step-content { flex: 1.5; display: flex; justify-content: flex-end; }
                    
                    .step-view { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
                    .worker-text { font-size: 11px; color: #666; }

                    .step-edit { width: 100%; display: flex; flex-direction: column; gap: 6px; }

                    /* Bulk Edit Mobile */
                    .bulk-edit-container { flex-direction: column; align-items: stretch; }
                    .bulk-controls { flex-direction: column; width: 100%; }
                    .ios-select { width: 100%; }
                    .btn-apply { width: 100%; }
                }
            `}</style>
        </div>
    );
}
