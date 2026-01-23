'use client';

import { useState, useMemo } from 'react';
import Modal from '@/components/ui/Modal';
import type { WorkOrder, Worker } from '@/lib/types';

interface WorkOrderViewModalProps {
    isOpen: boolean;
    onClose: () => void;
    workOrder: WorkOrder | null;
    workers: Worker[];
    onUpdate: (workOrderId: string, updates: any) => Promise<void>;
    onPrint: () => void;
}

const PROCESS_STATUSES = ['Na čekanju', 'U toku', 'Završeno', 'Odloženo'];

export default function WorkOrderViewModal({ isOpen, onClose, workOrder, workers, onUpdate, onPrint }: WorkOrderViewModalProps) {
    const [isEditMode, setIsEditMode] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [localItems, setLocalItems] = useState<any[]>([]);

    // Bulk edit state
    const [bulkProcess, setBulkProcess] = useState('');
    const [bulkStatus, setBulkStatus] = useState('');
    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

    // Initialize local items when work order changes
    useMemo(() => {
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
        if (!workOrder) return;

        // Create updates object with modified items
        await onUpdate(workOrder.Work_Order_ID, {
            items: localItems,
            Status: progress === 100 ? 'Završeno' : (progress > 0 ? 'U toku' : workOrder.Status)
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

    if (!workOrder) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Radni Nalog ${workOrder.Work_Order_Number}`}
            size="xl"
            footer={
                <div className="modal-footer-actions">
                    {isEditMode ? (
                        <>
                            <button className="btn btn-secondary" onClick={handleCancel}>Otkaži</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={!hasChanges}>
                                Sačuvaj izmjene
                            </button>
                        </>
                    ) : (
                        <>
                            <button className="btn btn-secondary" onClick={onPrint}>
                                <span className="material-icons-round">print</span>
                                Printaj
                            </button>
                            <button className="btn btn-primary" onClick={() => setIsEditMode(true)}>
                                <span className="material-icons-round">edit</span>
                                Uredi
                            </button>
                        </>
                    )}
                </div>
            }
        >
            <div className="work-order-view">
                {/* Info Panel */}
                <div className="info-panel">
                    <div className="info-row">
                        <div className="info-item">
                            <span className="info-label">Status</span>
                            <span className={`status-badge ${getStatusClass(workOrder.Status)}`}>
                                {workOrder.Status}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Kreirano</span>
                            <span className="info-value">{formatDate(workOrder.Created_Date)}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Rok</span>
                            <span className="info-value">{formatDate(workOrder.Due_Date)}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Napredak</span>
                            <div className="progress-bar-container">
                                <div className="progress-bar">
                                    <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                                </div>
                                <span className="progress-text">{progress}%</span>
                            </div>
                        </div>
                    </div>

                    {workOrder.Notes && (
                        <div className="info-notes">
                            <span className="info-label">Napomena:</span>
                            <p>{workOrder.Notes}</p>
                        </div>
                    )}
                </div>

                {/* Bulk Edit Toolbar (only in edit mode) */}
                {isEditMode && selectedProducts.size > 0 && (
                    <div className="bulk-edit-toolbar">
                        <div className="bulk-info">
                            <span className="material-icons-round">checklist</span>
                            <strong>{selectedProducts.size}</strong> proizvoda odabrano
                        </div>
                        <div className="bulk-controls">
                            <select
                                value={bulkProcess}
                                onChange={e => setBulkProcess(e.target.value)}
                                className="bulk-select"
                            >
                                <option value="">-- Odaberi proces --</option>
                                {workOrder.Production_Steps.map(step => (
                                    <option key={step} value={step}>{step}</option>
                                ))}
                            </select>
                            <select
                                value={bulkStatus}
                                onChange={e => setBulkStatus(e.target.value)}
                                className="bulk-select"
                            >
                                <option value="">-- Odaberi status --</option>
                                {PROCESS_STATUSES.map(status => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleBulkApply}
                                disabled={!bulkProcess || !bulkStatus}
                            >
                                Primijeni
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setSelectedProducts(new Set())}
                            >
                                Poništi
                            </button>
                        </div>
                    </div>
                )}

                {/* Products Matrix */}
                <div className="products-matrix">
                    <div className="matrix-header">
                        {isEditMode && (
                            <div className="matrix-col checkbox-col">
                                <input
                                    type="checkbox"
                                    checked={selectedProducts.size === localItems.length && localItems.length > 0}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedProducts(new Set(localItems.map(i => i.ID)));
                                        } else {
                                            setSelectedProducts(new Set());
                                        }
                                    }}
                                />
                            </div>
                        )}
                        <div className="matrix-col product-col">Proizvod</div>
                        {workOrder.Production_Steps.map(step => (
                            <div key={step} className="matrix-col process-col">
                                <div className="process-header">
                                    <span className="process-name">{step}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="matrix-body">
                        {localItems.map(item => (
                            <div key={item.ID} className="matrix-row">
                                {isEditMode && (
                                    <div className="matrix-col checkbox-col">
                                        <input
                                            type="checkbox"
                                            checked={selectedProducts.has(item.ID)}
                                            onChange={() => handleToggleProduct(item.ID)}
                                        />
                                    </div>
                                )}
                                <div className="matrix-col product-col">
                                    <strong>{item.Product_Name}</strong>
                                    <small>{item.Project_Name}</small>
                                    <span className="qty-badge">{item.Quantity} kom</span>
                                </div>
                                {workOrder.Production_Steps.map(process => {
                                    const assignment = item.Process_Assignments?.[process];
                                    return (
                                        <div key={process} className="matrix-col process-col">
                                            <span className="mobile-process-label">{process}</span>
                                            {isEditMode ? (
                                                <>
                                                    <select
                                                        value={assignment?.Status || 'Na čekanju'}
                                                        onChange={e => handleStatusChange(item.ID, process, e.target.value)}
                                                        className={`status-select ${getStatusClass(assignment?.Status || 'Na čekanju')}`}
                                                    >
                                                        {PROCESS_STATUSES.map(status => (
                                                            <option key={status} value={status}>{status}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        value={assignment?.Worker_ID || ''}
                                                        onChange={e => handleWorkerChange(item.ID, process, e.target.value)}
                                                        className="worker-select"
                                                    >
                                                        <option value="">Nije dodijeljen</option>
                                                        {workers.map(worker => (
                                                            <option key={worker.Worker_ID} value={worker.Worker_ID}>
                                                                {worker.Name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </>
                                            ) : (
                                                <div className="process-content">
                                                    <span className={`status-badge ${getStatusClass(assignment?.Status || 'Na čekanju')}`}>
                                                        {assignment?.Status || 'Na čekanju'}
                                                    </span>
                                                    {assignment?.Worker_Name && (
                                                        <span className="worker-name">
                                                            <span className="material-icons-round">person</span>
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
            </div>

            <style jsx>{`
                .work-order-view { display: flex; flex-direction: column; gap: 20px; }
                
                /* Info Panel */
                .info-panel { background: #f8f9fa; padding: 20px; border-radius: 12px; }
                .info-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
                .info-item { display: flex; flex-direction: column; gap: 6px; }
                .info-label { font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; }
                .info-value { font-size: 14px; font-weight: 600; }
                .info-notes { margin-top: 16px; padding-top: 16px; border-top: 1px solid #e0e0e0; }
                .info-notes p { margin: 6px 0 0 0; font-size: 14px; color: var(--text-secondary); }
                
                .progress-bar-container { display: flex; align-items: center; gap: 12px; }
                .progress-bar { flex: 1; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; }
                .progress-fill { height: 100%; background: var(--success); transition: width 0.3s; }
                .progress-text { font-size: 13px; font-weight: 600; min-width: 40px; }
                
                .status-badge {
                    padding: 4px 12px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                    display: inline-block;
                }
                .status-pending { background: #fff3cd; color: #856404; }
                .status-progress { background: #cfe2ff; color: #084298; }
                .status-done { background: #d1e7dd; color: #0f5132; }
                .status-delayed { background: #f8d7da; color: #842029; }

                 /* Bulk Edit Toolbar */
                .bulk-edit-toolbar {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 16px 20px;
                    border-radius: 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 20px;
                    box-shadow: 0 4px 12px rgba(102,126,234,0.3);
                }
                .bulk-info {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    color: white;
                    font-size: 14px;
                }
                .bulk-info .material-icons-round { font-size: 20px; }
                .bulk-info strong { font-size: 18px; }
                .bulk-controls {
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .bulk-select {
                    padding: 8px 12px;
                    border-radius: 8px;
                    border: 2px solid rgba(255,255,255,0.3);
                    background: rgba(255,255,255,0.95);
                    font-size: 13px;
                    font-weight: 600;
                    min-width: 180px;
                    outline: none;
                    transition: all 0.2s;
                }
                .bulk-select:focus { border-color: white; box-shadow: 0 0 0 3px rgba(255,255,255,0.3); }

                /* Products Matrix */
                .products-matrix { background: white; border-radius: 12px; border: 1px solid #e0e0e0; overflow: hidden; }
                .matrix-header {
                    display: flex;
                    background: linear-gradient(180deg, #f8f9fa 0%, #f0f1f3 100%);
                    border-bottom: 2px solid #e0e0e0;
                    font-weight: 700;
                    font-size: 12px;
                    position: sticky;
                    top: 0;
                    z-index: 5;
                }
                .matrix-body { max-height: 500px; overflow-y: auto; }
                .matrix-row {
                    display: flex;
                    border-bottom: 1px solid #e8e8e8;
                    transition: background 0.15s;
                }
                .matrix-row:hover { background: #f9fafb; }
                .matrix-col {
                    padding: 12px 16px;
                    border-right: 1px solid #e8e8e8;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .matrix-col:last-child { border-right: none; }
                .checkbox-col { width: 50px; justify-content: center; align-items: center; }
                .checkbox-col input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
                .product-col {
                    width: 280px;
                    flex-shrink: 0;
                    background: #fafbfc;
                }
                .product-col strong { font-size: 14px; font-weight: 600; }
                .product-col small { font-size: 12px; color: var(--text-secondary); }
                .qty-badge {
                    padding: 2px 8px;
                    background: #e8f4ff;
                    color: var(--accent);
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    align-self: flex-start;
                }
                .process-col {
                    flex: 1;
                    min-width: 180px;
                    justify-content: center;
                }
                .process-header { text-align: center; }
                .process-name {
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                }
                .status-select, .worker-select {
                    width: 100%;
                    padding: 6px 10px;
                    border: 1px solid #d0d0d0;
                    border-radius: 6px;
                    font-size: 12px;
                    outline: none;
                    transition: all 0.2s;
                }
                .status-select:focus, .worker-select:focus {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px rgba(0,113,227,0.1);
                }
                .worker-name {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 12px;
                    color: var(--text-secondary);
                }
                .worker-name .material-icons-round { font-size: 14px; }
                
                .modal-footer-actions {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }
                
                /* Default State - Hidden on Desktop */
                .mobile-process-label { display: none; }
                .process-content { display: flex; flex-direction: column; gap: 4px; align-items: center; }

                @media (max-width: 1024px) {
                    .info-row { grid-template-columns: 1fr 1fr; }
                    .bulk-edit-toolbar { flex-direction: column; align-items: stretch; }
                    .product-col { width: 200px; }
                    .process-col { min-width: 150px; }
                }
                
                @media (max-width: 768px) {
                    .work-order-view { gap: 16px; }
                    
                    /* Info Panel Mobile */
                    .info-row { grid-template-columns: 1fr; gap: 12px; }
                    .info-panel { padding: 16px; }
                    
                    /* Matrix Mobile - Card View */
                    .matrix-header { display: none; }
                    .products-matrix { background: transparent; border: none; }
                    .matrix-body { max-height: none; overflow: visible; display: flex; flex-direction: column; gap: 12px; }
                    
                    .matrix-row {
                        flex-direction: column;
                        background: white;
                        border: 1px solid #e0e0e0;
                        border-radius: 12px;
                        padding: 16px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.02);
                    }
                    
                    .product-col {
                        width: 100%;
                        border-right: none;
                        border-bottom: 1px solid #f0f0f0;
                        padding: 0 0 12px 0;
                        margin-bottom: 12px;
                        background: transparent;
                        flex-direction: row;
                        justify-content: space-between;
                        align-items: center;
                        flex-wrap: wrap;
                    }
                    
                    .product-col strong { font-size: 16px; width: 100%; margin-bottom: 4px; }
                    
                    .matrix-col {
                        padding: 0;
                        border: none;
                    }
                    
                    .process-col {
                        flex-direction: row;
                        align-items: center;
                        justify-content: space-between;
                        padding: 8px 0;
                        border-bottom: 1px solid #f9f9f9;
                        min-width: 0;
                        gap: 12px;
                    }
                    
                    .process-col:last-child { border-bottom: none; }
                    
                    .mobile-process-label {
                        display: block;
                        font-size: 13px;
                        font-weight: 600;
                        color: var(--text-secondary);
                        min-width: 100px;
                    }
                    
                    .process-content {
                        align-items: flex-end;
                    }
                    
                    .status-select, .worker-select {
                        width: 100%;
                        max-width: 200px;
                    }

                    /* Edit Mode Mobile Adjustments */
                    .checkbox-col {
                        position: absolute;
                        top: 16px;
                        right: 16px;
                        width: auto;
                        padding: 0;
                    }
                    
                    .matrix-row { position: relative; }
                    
                    /* Hide checkbox column in normal flow if absolute positioned */
                    .matrix-col.checkbox-col { border: none; }
                }
            `}</style>
        </Modal>
    );
}
