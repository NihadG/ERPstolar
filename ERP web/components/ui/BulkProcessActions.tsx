'use client';

import { useState } from 'react';
import { RefreshCw, User, Plus, X, Check } from 'lucide-react';
import type { Worker, ItemProcessStatus } from '@/lib/types';

interface BulkProcessActionsProps {
    selectedCount: number;
    processes: string[];
    workers: Worker[];
    onBulkStatusChange: (processName: string | 'all', newStatus: ItemProcessStatus['Status']) => void;
    onBulkAssignWorker: (processName: string | 'all', worker: { Worker_ID: string; Worker_Name: string }) => void;
    onAddProcess: (processName: string) => void;
    onClearSelection: () => void;
}

const STATUS_OPTIONS: ItemProcessStatus['Status'][] = ['Na čekanju', 'U toku', 'Završeno', 'Odloženo'];

export default function BulkProcessActions({
    selectedCount,
    processes,
    workers,
    onBulkStatusChange,
    onBulkAssignWorker,
    onAddProcess,
    onClearSelection
}: BulkProcessActionsProps) {
    const [showStatusDropdown, setShowStatusDropdown] = useState(false);
    const [showWorkerDropdown, setShowWorkerDropdown] = useState(false);
    const [showAddProcess, setShowAddProcess] = useState(false);
    const [newProcessName, setNewProcessName] = useState('');
    const [selectedProcess, setSelectedProcess] = useState<string>('all');

    const handleAddProcess = () => {
        if (newProcessName.trim()) {
            onAddProcess(newProcessName.trim());
            setNewProcessName('');
            setShowAddProcess(false);
        }
    };

    if (selectedCount === 0) {
        return null;
    }

    return (
        <div className="bulk-actions-bar">
            <div className="selection-info">
                <span className="count-badge">{selectedCount}</span>
                <span className="selection-text">odabrano</span>
                <button className="btn-clear" onClick={onClearSelection}>
                    <X size={14} />
                </button>
            </div>

            <div className="actions-group">
                {/* Process selector */}
                <div className="process-selector">
                    <select
                        value={selectedProcess}
                        onChange={(e) => setSelectedProcess(e.target.value)}
                        className="select-process"
                    >
                        <option value="all">Svi procesi</option>
                        {processes.map(p => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                </div>

                {/* Status change dropdown */}
                <div className="dropdown-wrapper">
                    <button
                        className="btn-action"
                        onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                    >
                        <RefreshCw size={14} />
                        <span>Status</span>
                    </button>
                    {showStatusDropdown && (
                        <div className="dropdown-menu">
                            {STATUS_OPTIONS.map(status => (
                                <button
                                    key={status}
                                    className="dropdown-item"
                                    onClick={() => {
                                        onBulkStatusChange(selectedProcess, status);
                                        setShowStatusDropdown(false);
                                    }}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Worker assignment dropdown */}
                <div className="dropdown-wrapper">
                    <button
                        className="btn-action"
                        onClick={() => setShowWorkerDropdown(!showWorkerDropdown)}
                    >
                        <User size={14} />
                        <span>Radnik</span>
                    </button>
                    {showWorkerDropdown && (
                        <div className="dropdown-menu">
                            {workers.map(worker => (
                                <button
                                    key={worker.Worker_ID}
                                    className="dropdown-item"
                                    onClick={() => {
                                        onBulkAssignWorker(selectedProcess, {
                                            Worker_ID: worker.Worker_ID,
                                            Worker_Name: worker.Name
                                        });
                                        setShowWorkerDropdown(false);
                                    }}
                                >
                                    {worker.Name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Add process */}
                <div className="dropdown-wrapper">
                    <button
                        className="btn-action btn-add"
                        onClick={() => setShowAddProcess(!showAddProcess)}
                    >
                        <Plus size={14} />
                        <span>Proces</span>
                    </button>
                    {showAddProcess && (
                        <div className="dropdown-menu add-process-menu">
                            <input
                                type="text"
                                placeholder="Naziv procesa..."
                                value={newProcessName}
                                onChange={(e) => setNewProcessName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddProcess()}
                                autoFocus
                            />
                            <button className="btn-confirm" onClick={handleAddProcess}>
                                <Check size={14} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <style jsx>{`
                .bulk-actions-bar {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    padding: 12px 16px;
                    background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
                    border-radius: 12px;
                    margin-bottom: 12px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                }

                .selection-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .count-badge {
                    background: #3b82f6;
                    color: white;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 13px;
                    font-weight: 600;
                }

                .selection-text {
                    color: #94a3b8;
                    font-size: 13px;
                }

                .btn-clear {
                    background: rgba(255,255,255,0.1);
                    border: none;
                    padding: 4px;
                    border-radius: 4px;
                    color: #94a3b8;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                }

                .btn-clear:hover {
                    background: rgba(255,255,255,0.2);
                    color: white;
                }

                .actions-group {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-left: auto;
                }

                .process-selector {
                    margin-right: 8px;
                }

                .select-process {
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    color: white;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 12px;
                    cursor: pointer;
                }

                .select-process option {
                    background: #1e293b;
                    color: white;
                }

                .dropdown-wrapper {
                    position: relative;
                }

                .btn-action {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 14px;
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.15);
                    border-radius: 8px;
                    color: white;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .btn-action:hover {
                    background: rgba(255,255,255,0.2);
                }

                .btn-add {
                    background: rgba(34, 197, 94, 0.2);
                    border-color: rgba(34, 197, 94, 0.3);
                }

                .btn-add:hover {
                    background: rgba(34, 197, 94, 0.3);
                }

                .dropdown-menu {
                    position: absolute;
                    top: 100%;
                    right: 0;
                    margin-top: 4px;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                    min-width: 140px;
                    z-index: 100;
                    overflow: hidden;
                }

                .dropdown-item {
                    display: block;
                    width: 100%;
                    padding: 10px 14px;
                    border: none;
                    background: none;
                    text-align: left;
                    font-size: 13px;
                    color: #334155;
                    cursor: pointer;
                }

                .dropdown-item:hover {
                    background: #f1f5f9;
                }

                .add-process-menu {
                    display: flex;
                    padding: 8px;
                    gap: 4px;
                }

                .add-process-menu input {
                    flex: 1;
                    padding: 8px 10px;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    font-size: 13px;
                }

                .btn-confirm {
                    padding: 8px;
                    background: #22c55e;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    display: flex;
                }

                @media (max-width: 768px) {
                    .bulk-actions-bar {
                        flex-direction: column;
                        gap: 12px;
                    }
                    .actions-group {
                        margin-left: 0;
                        flex-wrap: wrap;
                        justify-content: center;
                    }
                }
            `}</style>
        </div>
    );
}
