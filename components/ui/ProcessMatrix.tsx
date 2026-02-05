'use client';

import { useState } from 'react';
import { Check, Play, Clock, Pause, ChevronDown } from 'lucide-react';
import type { WorkOrderItem, ItemProcessStatus, Worker } from '@/lib/types';

interface ProcessMatrixProps {
    items: WorkOrderItem[];
    processes: string[];
    workers: Worker[];
    onProcessUpdate: (itemId: string, processName: string, updates: Partial<ItemProcessStatus>) => void;
    onBulkStatusChange: (itemIds: string[], processName: string, status: ItemProcessStatus['Status']) => void;
}

const STATUS_CYCLE: ItemProcessStatus['Status'][] = ['Na čekanju', 'U toku', 'Završeno'];

export default function ProcessMatrix({
    items,
    processes,
    workers,
    onProcessUpdate,
    onBulkStatusChange
}: ProcessMatrixProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [expandedWorker, setExpandedWorker] = useState<{ itemId: string, process: string } | null>(null);

    // Get process status for item
    const getProcessStatus = (item: WorkOrderItem, processName: string): ItemProcessStatus | undefined => {
        return item.Processes?.find(p => p.Process_Name === processName);
    };

    // Cycle status on click
    const cycleStatus = (currentStatus: string): ItemProcessStatus['Status'] => {
        const idx = STATUS_CYCLE.indexOf(currentStatus as ItemProcessStatus['Status']);
        return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    };

    // Handle cell click
    const handleCellClick = (itemId: string, processName: string, currentStatus: string) => {
        const newStatus = cycleStatus(currentStatus);
        const updates: Partial<ItemProcessStatus> = { Status: newStatus };

        if (newStatus === 'U toku') {
            updates.Started_At = new Date().toISOString();
        } else if (newStatus === 'Završeno') {
            updates.Completed_At = new Date().toISOString();
        }

        onProcessUpdate(itemId, processName, updates);
    };

    // Handle bulk click on header
    const handleHeaderClick = (processName: string, targetStatus: ItemProcessStatus['Status']) => {
        const itemIds = selectedIds.size > 0 ? Array.from(selectedIds) : items.map(i => i.ID);
        onBulkStatusChange(itemIds, processName, targetStatus);
    };

    // Toggle selection
    const toggleSelect = (itemId: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemId)) {
                newSet.delete(itemId);
            } else {
                newSet.add(itemId);
            }
            return newSet;
        });
    };

    const toggleAll = () => {
        if (selectedIds.size === items.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(items.map(i => i.ID)));
        }
    };

    // Handle worker assignment
    const handleWorkerAssign = (itemId: string, processName: string, worker: Worker) => {
        onProcessUpdate(itemId, processName, {
            Worker_ID: worker.Worker_ID,
            Worker_Name: worker.Name
        });
        setExpandedWorker(null);
    };

    // Status icon/color
    const getStatusDisplay = (status: string, workerName?: string) => {
        switch (status) {
            case 'Završeno':
                return { icon: <Check size={16} />, bg: '#dcfce7', color: '#15803d', label: '✓' };
            case 'U toku':
                return { icon: <Play size={16} />, bg: '#dbeafe', color: '#1d4ed8', label: '▶' };
            case 'Odloženo':
                return { icon: <Pause size={16} />, bg: '#fef3c7', color: '#b45309', label: '⏸' };
            default:
                return { icon: <Clock size={16} />, bg: '#f1f5f9', color: '#64748b', label: '○' };
        }
    };

    // Calculate item progress
    const getItemProgress = (item: WorkOrderItem) => {
        const completed = (item.Processes || []).filter(p => p.Status === 'Završeno').length;
        const total = item.Processes?.length || processes.length;
        return total > 0 ? Math.round((completed / total) * 100) : 0;
    };

    return (
        <div className="process-matrix">
            <div className="matrix-container">
                <table>
                    <thead>
                        <tr>
                            <th className="col-checkbox">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === items.length && items.length > 0}
                                    onChange={toggleAll}
                                />
                            </th>
                            <th className="col-product">Proizvod</th>
                            {processes.map(process => (
                                <th key={process} className="col-process">
                                    <div className="process-header">
                                        <span className="process-name">{process}</span>
                                        {selectedIds.size > 0 && (
                                            <div className="bulk-actions">
                                                <button
                                                    className="bulk-btn done"
                                                    onClick={() => handleHeaderClick(process, 'Završeno')}
                                                    title="Označi završeno"
                                                >✓</button>
                                            </div>
                                        )}
                                    </div>
                                </th>
                            ))}
                            <th className="col-progress">%</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(item => {
                            const progress = getItemProgress(item);
                            const isSelected = selectedIds.has(item.ID);

                            return (
                                <tr key={item.ID} className={isSelected ? 'selected' : ''}>
                                    <td className="col-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelect(item.ID)}
                                        />
                                    </td>
                                    <td className="col-product">
                                        <div className="product-info">
                                            <span className="product-name">{item.Product_Name}</span>
                                            <span className="product-meta">{item.Quantity} kom • {item.Project_Name}</span>
                                        </div>
                                    </td>
                                    {processes.map(processName => {
                                        const processStatus = getProcessStatus(item, processName);
                                        const status = processStatus?.Status || 'Na čekanju';
                                        const display = getStatusDisplay(status, processStatus?.Worker_Name);
                                        const isWorkerOpen = expandedWorker?.itemId === item.ID && expandedWorker?.process === processName;

                                        return (
                                            <td key={processName} className="col-process">
                                                <div className="cell-wrapper">
                                                    <button
                                                        className="status-cell"
                                                        style={{ background: display.bg, color: display.color }}
                                                        onClick={() => handleCellClick(item.ID, processName, status)}
                                                        title={`${status} - klikni za promjenu`}
                                                    >
                                                        {display.icon}
                                                    </button>
                                                    {processStatus?.Worker_Name ? (
                                                        <span className="worker-badge" title={processStatus.Worker_Name}>
                                                            {processStatus.Worker_Name.split(' ')[0][0]}
                                                        </span>
                                                    ) : (
                                                        <button
                                                            className="worker-add"
                                                            onClick={() => setExpandedWorker(isWorkerOpen ? null : { itemId: item.ID, process: processName })}
                                                        >
                                                            <ChevronDown size={12} />
                                                        </button>
                                                    )}
                                                    {isWorkerOpen && (
                                                        <div className="worker-dropdown">
                                                            {workers.map(w => (
                                                                <button
                                                                    key={w.Worker_ID}
                                                                    onClick={() => handleWorkerAssign(item.ID, processName, w)}
                                                                >
                                                                    {w.Name}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    })}
                                    <td className="col-progress">
                                        <div className="progress-cell">
                                            <div className="progress-bar">
                                                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                                            </div>
                                            <span>{progress}%</span>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {selectedIds.size > 0 && (
                <div className="selection-bar">
                    <span>{selectedIds.size} odabrano</span>
                    <div className="selection-actions">
                        <button onClick={() => {
                            processes.forEach(p => handleHeaderClick(p, 'Završeno'));
                        }}>✓ Sve završi</button>
                        <button onClick={() => setSelectedIds(new Set())}>✕ Poništi</button>
                    </div>
                </div>
            )}

            <style jsx>{`
                .process-matrix {
                    background: white;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
                }

                .matrix-container {
                    overflow-x: auto;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }

                thead {
                    background: #f8fafc;
                    position: sticky;
                    top: 0;
                }

                th {
                    padding: 12px 8px;
                    text-align: left;
                    font-weight: 600;
                    color: #475569;
                    border-bottom: 2px solid #e2e8f0;
                    white-space: nowrap;
                }

                td {
                    padding: 10px 8px;
                    border-bottom: 1px solid #f1f5f9;
                    vertical-align: middle;
                }

                tr:hover {
                    background: #fafbfc;
                }

                tr.selected {
                    background: #eff6ff;
                }

                .col-checkbox {
                    width: 40px;
                    text-align: center;
                }

                .col-checkbox input {
                    width: 16px;
                    height: 16px;
                    accent-color: #3b82f6;
                    cursor: pointer;
                }

                .col-product {
                    min-width: 180px;
                }

                .product-info {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .product-name {
                    font-weight: 600;
                    color: #1e293b;
                }

                .product-meta {
                    font-size: 11px;
                    color: #94a3b8;
                }

                .col-process {
                    width: 80px;
                    text-align: center;
                }

                .process-header {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                }

                .process-name {
                    font-size: 12px;
                    max-width: 70px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .bulk-actions {
                    display: flex;
                    gap: 2px;
                }

                .bulk-btn {
                    width: 20px;
                    height: 20px;
                    border-radius: 4px;
                    border: none;
                    cursor: pointer;
                    font-size: 11px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .bulk-btn.done {
                    background: #dcfce7;
                    color: #15803d;
                }

                .bulk-btn:hover {
                    transform: scale(1.1);
                }

                .cell-wrapper {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    position: relative;
                }

                .status-cell {
                    width: 36px;
                    height: 36px;
                    border-radius: 8px;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s;
                }

                .status-cell:hover {
                    transform: scale(1.1);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                }

                .worker-badge {
                    width: 18px;
                    height: 18px;
                    background: #e0f2fe;
                    color: #0369a1;
                    border-radius: 50%;
                    font-size: 10px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .worker-add {
                    width: 18px;
                    height: 18px;
                    background: #f1f5f9;
                    border: 1px dashed #cbd5e1;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #94a3b8;
                }

                .worker-add:hover {
                    background: #e2e8f0;
                    color: #475569;
                }

                .worker-dropdown {
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                    z-index: 100;
                    min-width: 120px;
                    overflow: hidden;
                    margin-top: 4px;
                }

                .worker-dropdown button {
                    display: block;
                    width: 100%;
                    padding: 8px 12px;
                    border: none;
                    background: none;
                    text-align: left;
                    font-size: 12px;
                    cursor: pointer;
                }

                .worker-dropdown button:hover {
                    background: #f1f5f9;
                }

                .col-progress {
                    width: 80px;
                }

                .progress-cell {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .progress-bar {
                    flex: 1;
                    height: 6px;
                    background: #e2e8f0;
                    border-radius: 3px;
                    overflow: hidden;
                }

                .progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #22c55e, #16a34a);
                    transition: width 0.3s;
                }

                .progress-cell span {
                    font-size: 11px;
                    font-weight: 600;
                    color: #64748b;
                    min-width: 28px;
                    text-align: right;
                }

                .selection-bar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    background: linear-gradient(135deg, #1e293b, #334155);
                    color: white;
                    font-size: 13px;
                }

                .selection-actions {
                    display: flex;
                    gap: 8px;
                }

                .selection-actions button {
                    padding: 6px 12px;
                    background: rgba(255,255,255,0.15);
                    border: none;
                    border-radius: 6px;
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                }

                .selection-actions button:hover {
                    background: rgba(255,255,255,0.25);
                }

                @media (max-width: 768px) {
                    .process-name {
                        font-size: 10px;
                        max-width: 50px;
                    }
                    
                    .status-cell {
                        width: 30px;
                        height: 30px;
                    }
                    
                    .col-product {
                        min-width: 120px;
                    }
                }
            `}</style>
        </div>
    );
}
