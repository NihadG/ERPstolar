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

    function formatDate(dateString: string): string {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('hr-HR');
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
        <div className="wo-expanded-content">
            {/* Toolbar / Header Actions inside expansion */}
            <div className="wo-expanded-toolbar">
                <div className="toolbar-info">
                    <div className="progress-section">
                        <span className="label">Napredak</span>
                        <div className="progress-bar">
                            <div className="bar-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                        <span className="percent">{progress}%</span>
                    </div>
                </div>

                <div className="toolbar-actions">
                    {isEditMode ? (
                        <>
                            <button className="btn-text" onClick={handleCancel}>Otkaži</button>
                            <button className="btn-primary-sm" onClick={handleSave} disabled={!hasChanges}>
                                Sačuvaj izmjene
                            </button>
                        </>
                    ) : (
                        <>
                            {workOrder.Status === 'Nacrt' || workOrder.Status === 'Dodijeljeno' ? (
                                <button className="btn-secondary-sm" onClick={() => onStart(workOrder.Work_Order_ID)}>
                                    <span className="material-icons-round">play_arrow</span>
                                    Pokreni
                                </button>
                            ) : null}

                            <button className="btn-secondary-sm" onClick={() => onPrint(workOrder)}>
                                <span className="material-icons-round">print</span>
                                Printaj
                            </button>

                            <button className="btn-secondary-sm" onClick={() => setIsEditMode(true)}>
                                <span className="material-icons-round">edit</span>
                                Uredi
                            </button>

                            <button className="btn-icon-danger" onClick={() => onDelete(workOrder.Work_Order_ID)} title="Obriši nalog">
                                <span className="material-icons-round">delete</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Bulk Edit Toolbar (only in edit mode) */}
            {isEditMode && selectedProducts.size > 0 && (
                <div className="bulk-edit-bar">
                    <div className="bulk-left">
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>checklist</span>
                        <strong>{selectedProducts.size}</strong> odabrano
                    </div>
                    <div className="bulk-right">
                        <select
                            value={bulkProcess}
                            onChange={e => setBulkProcess(e.target.value)}
                            className="mini-select"
                        >
                            <option value="">Proces...</option>
                            {workOrder.Production_Steps.map(step => (
                                <option key={step} value={step}>{step}</option>
                            ))}
                        </select>
                        <select
                            value={bulkStatus}
                            onChange={e => setBulkStatus(e.target.value)}
                            className="mini-select"
                        >
                            <option value="">Status...</option>
                            {PROCESS_STATUSES.map(status => (
                                <option key={status} value={status}>{status}</option>
                            ))}
                        </select>
                        <button className="btn-primary-xs" onClick={handleBulkApply} disabled={!bulkProcess || !bulkStatus}>
                            Primijeni
                        </button>
                    </div>
                </div>
            )}

            {/* Matrix / List View */}
            <div className="wo-matrix">
                <div className="matrix-header">
                    {isEditMode && (
                        <div className="col-checkbox">
                            <input
                                type="checkbox"
                                checked={selectedProducts.size === localItems.length && localItems.length > 0}
                                onChange={(e) => {
                                    if (e.target.checked) setSelectedProducts(new Set(localItems.map(i => i.ID)));
                                    else setSelectedProducts(new Set());
                                }}
                            />
                        </div>
                    )}
                    <div className="col-product">Proizvod</div>
                    {workOrder.Production_Steps.map(step => (
                        <div key={step} className="col-process-header">{step}</div>
                    ))}
                </div>

                <div className="matrix-body">
                    {localItems.map(item => (
                        <div key={item.ID} className={`matrix-row ${isEditMode && selectedProducts.has(item.ID) ? 'selected' : ''}`}>
                            {isEditMode && (
                                <div className="col-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={selectedProducts.has(item.ID)}
                                        onChange={() => handleToggleProduct(item.ID)}
                                    />
                                </div>
                            )}
                            <div className="col-product">
                                <div className="prod-name">{item.Product_Name}</div>
                                <div className="prod-sub">{item.Project_Name} • {item.Quantity} kom</div>
                            </div>

                            {workOrder.Production_Steps.map(process => {
                                const assignment = item.Process_Assignments?.[process];
                                return (
                                    <div key={process} className="col-process">
                                        {isEditMode ? (
                                            <div className="edit-controls">
                                                <select
                                                    value={assignment?.Status || 'Na čekanju'}
                                                    onChange={e => handleStatusChange(item.ID, process, e.target.value)}
                                                    className={`status-select-sm ${getStatusClass(assignment?.Status || 'Na čekanju')}`}
                                                >
                                                    {PROCESS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                                <select
                                                    value={assignment?.Worker_ID || ''}
                                                    onChange={e => handleWorkerChange(item.ID, process, e.target.value)}
                                                    className="worker-select-sm"
                                                >
                                                    <option value="">-</option>
                                                    {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                                </select>
                                            </div>
                                        ) : (
                                            <div className="view-status">
                                                <span className={`status-badge-xs ${getStatusClass(assignment?.Status || 'Na čekanju')}`}>
                                                    {assignment?.Status || 'Na čekanju'}
                                                </span>
                                                {assignment?.Worker_Name && (
                                                    <span className="worker-label-xs">
                                                        {assignment.Worker_Name}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            <style jsx>{`
                .wo-expanded-content {
                    padding: 20px;
                    background: #fff;
                    border-top: 1px solid #f0f0f0;
                    animation: slideDown 0.2s ease-out;
                }
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .wo-expanded-toolbar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    gap: 20px;
                    flex-wrap: wrap;
                }

                .toolbar-info { flex: 1; }
                .progress-section { display: flex; align-items: center; gap: 12px; max-width: 300px; }
                .progress-bar { flex: 1; height: 6px; background: #eee; border-radius: 3px; overflow: hidden; }
                .bar-fill { height: 100%; background: #34c759; transition: width 0.3s; }
                .percent { font-size: 12px; font-weight: 600; color: #666; min-width: 30px; }
                .label { font-size: 12px; color: #888; font-weight: 500; }

                .toolbar-actions { display: flex; align-items: center; gap: 10px; }

                .btn-primary-sm { background: #000; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
                .btn-primary-sm:disabled { opacity: 0.5; }
                .btn-secondary-sm { background: #f0f0f0; color: #333; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.2s; }
                .btn-secondary-sm:hover { background: #e5e5e5; }
                .btn-secondary-sm .material-icons-round { font-size: 16px; }
                
                .btn-text { background: none; border: none; color: #666; font-size: 12px; font-weight: 600; cursor: pointer; margin-right: 4px; }
                .btn-icon-danger { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; border: none; background: #fff0f0; color: #d32f2f; cursor: pointer; margin-left: 8px; }
                .btn-icon-danger:hover { background: #fee2e2; }
                .btn-icon-danger .material-icons-round { font-size: 18px; }

                /* Bulk Edit Bar */
                .bulk-edit-bar {
                    background: #f8f9fa;
                    border-radius: 8px;
                    padding: 8px 12px;
                    margin-bottom: 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border: 1px solid #e0e0e0;
                }
                .bulk-left { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #555; }
                .bulk-right { display: flex; align-items: center; gap: 8px; }
                .mini-select { padding: 4px 8px; border-radius: 6px; border: 1px solid #ddd; font-size: 11px; outline: none; background: white; }
                .btn-primary-xs { background: #0071e3; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; }
                .btn-primary-xs:disabled { opacity: 0.5; background: #999; }

                /* Matrix styles */
                .wo-matrix { border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; }
                .matrix-header { display: flex; background: #f9fafb; border-bottom: 1px solid #e5e5e5; padding: 0; font-size: 11px; font-weight: 600; color: #666; }
                .matrix-row { display: flex; border-bottom: 1px solid #f0f0f0; transition: background 0.1s; }
                .matrix-row:last-child { border-bottom: none; }
                .matrix-row:hover { background: #fafafa; }
                .matrix-row.selected { background: #f0f7ff; }

                .col-checkbox { width: 40px; display: flex; align-items: center; justify-content: center; border-right: 1px solid #eee; }
                .col-product { flex: 2; padding: 10px 14px; min-width: 200px; border-right: 1px solid #eee; display: flex; flex-direction: column; justify-content: center; }
                .col-process-header { flex: 1; padding: 10px; text-align: center; border-right: 1px solid #eee; min-width: 120px; }
                .col-process-header:last-child { border-right: none; }
                .col-process { flex: 1; padding: 8px; border-right: 1px solid #eee; display: flex; align-items: center; justify-content: center; min-width: 120px; }
                .col-process:last-child { border-right: none; }

                .prod-name { font-weight: 600; font-size: 13px; color: #333; margin-bottom: 2px; }
                .prod-sub { font-size: 11px; color: #888; }

                /* Status Styles */
                .status-badge-xs { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
                .status-pending { background: #fff8e1; color: #b45309; }
                .status-progress { background: #eff6ff; color: #1d4ed8; }
                .status-done { background: #f0fdf4; color: #15803d; }
                .status-delayed { background: #fef2f2; color: #b91c1c; }

                .view-status { display: flex; flex-direction: column; align-items: center; gap: 4px; }
                .worker-label-xs { font-size: 10px; color: #666; background: #f5f5f7; padding: 1px 6px; border-radius: 4px; }

                /* Edit inputs */
                .edit-controls { display: flex; flex-direction: column; gap: 4px; width: 100%; }
                .status-select-sm, .worker-select-sm { width: 100%; padding: 3px; font-size: 11px; border: 1px solid #ddd; border-radius: 4px; background: white; }
                .status-select-sm.status-done { border-color: #bbf7d0; background: #f0fdf4; color: #15803d; }
                .status-select-sm.status-progress { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }

                @media (max-width: 768px) {
                    .matrix-header { display: none; }
                    .matrix-row { flex-direction: column; padding: 12px; position: relative; }
                    .col-checkbox { position: absolute; top: 12px; right: 12px; border: none; }
                    .col-product { border: none; padding: 0 0 12px 0; width: 100%; border-bottom: 1px solid #f0f0f0; margin-bottom: 8px; min-width: 0; }
                    .col-process { border: none; justify-content: space-between; padding: 4px 0; width: 100%; }
                    .col-process::before { content: attr(key); font-size: 11px; font-weight: 600; color: #888; margin-right: auto; }
                }
            `}</style>
        </div>
    );
}
