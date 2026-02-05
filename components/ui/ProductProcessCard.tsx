'use client';

import { useState, useEffect } from 'react';
import { Check, Clock, Pause, Play, User, ChevronDown, ChevronUp } from 'lucide-react';
import type { ItemProcessStatus, Worker } from '@/lib/types';

interface ProductProcessCardProps {
    itemId: string;
    productName: string;
    projectName: string;
    quantity: number;
    processes: ItemProcessStatus[];
    workers: Worker[];
    isSelected: boolean;
    onSelect: (itemId: string) => void;
    onProcessUpdate: (itemId: string, processName: string, updates: Partial<ItemProcessStatus>) => void;
    expanded?: boolean;
}

export default function ProductProcessCard({
    itemId,
    productName,
    projectName,
    quantity,
    processes,
    workers,
    isSelected,
    onSelect,
    onProcessUpdate,
    expanded: initialExpanded = false
}: ProductProcessCardProps) {
    const [expanded, setExpanded] = useState(initialExpanded);
    const [activeTimer, setActiveTimer] = useState<string | null>(null);
    const [elapsedTime, setElapsedTime] = useState<Record<string, number>>({});

    // Calculate progress
    const completedCount = processes.filter(p => p.Status === 'Završeno').length;
    const progress = processes.length > 0 ? Math.round((completedCount / processes.length) * 100) : 0;

    // Timer effect for active processes
    useEffect(() => {
        const activeProcess = processes.find(p => p.Status === 'U toku' && p.Started_At);
        if (activeProcess) {
            setActiveTimer(activeProcess.Process_Name);
            const interval = setInterval(() => {
                const start = new Date(activeProcess.Started_At!).getTime();
                const now = Date.now();
                const minutes = Math.floor((now - start) / 60000);
                setElapsedTime(prev => ({ ...prev, [activeProcess.Process_Name]: minutes }));
            }, 1000);
            return () => clearInterval(interval);
        } else {
            setActiveTimer(null);
        }
    }, [processes]);

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'Završeno': return <Check size={14} />;
            case 'U toku': return <Play size={14} />;
            case 'Odloženo': return <Pause size={14} />;
            default: return <Clock size={14} />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Završeno': return { bg: '#dcfce7', color: '#15803d', border: '#86efac' };
            case 'U toku': return { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' };
            case 'Odloženo': return { bg: '#fef3c7', color: '#b45309', border: '#fcd34d' };
            default: return { bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' };
        }
    };

    const formatTime = (minutes: number) => {
        if (minutes < 60) return `${minutes}min`;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h}h ${m}min`;
    };

    const cycleStatus = (currentStatus: string): ItemProcessStatus['Status'] => {
        const order: ItemProcessStatus['Status'][] = ['Na čekanju', 'U toku', 'Završeno'];
        const idx = order.indexOf(currentStatus as any);
        return order[(idx + 1) % order.length];
    };

    const handleStatusClick = (processName: string, currentStatus: string) => {
        const newStatus = cycleStatus(currentStatus);
        const updates: Partial<ItemProcessStatus> = { Status: newStatus };

        if (newStatus === 'U toku' && currentStatus !== 'U toku') {
            updates.Started_At = new Date().toISOString();
        } else if (newStatus === 'Završeno') {
            updates.Completed_At = new Date().toISOString();
        }

        onProcessUpdate(itemId, processName, updates);
    };

    return (
        <div className={`product-process-card ${isSelected ? 'selected' : ''}`}>
            <div className="card-header">
                <label className="checkbox-wrapper" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onSelect(itemId)}
                    />
                    <span className="checkmark"></span>
                </label>

                <div className="product-info" onClick={() => setExpanded(!expanded)}>
                    <div className="product-title">
                        <span className="product-name">{productName}</span>
                        <span className="product-qty">{quantity} kom</span>
                    </div>
                    <span className="project-name">{projectName}</span>
                </div>

                <div className="progress-mini">
                    <div className="progress-bar-mini">
                        <div className="progress-fill-mini" style={{ width: `${progress}%` }}></div>
                    </div>
                    <span className="progress-text">{progress}%</span>
                </div>

                <button className="expand-toggle" onClick={() => setExpanded(!expanded)}>
                    {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
            </div>

            {expanded && (
                <div className="processes-list">
                    {processes.map((process, idx) => {
                        const colors = getStatusColor(process.Status);
                        const isActive = process.Status === 'U toku';
                        const elapsed = elapsedTime[process.Process_Name] || process.Duration_Minutes || 0;

                        return (
                            <div key={process.Process_Name} className="process-row">
                                <span className="process-order">{idx + 1}</span>
                                <span className="process-name">{process.Process_Name}</span>

                                <button
                                    className="status-chip"
                                    style={{
                                        background: colors.bg,
                                        color: colors.color,
                                        borderColor: colors.border
                                    }}
                                    onClick={() => handleStatusClick(process.Process_Name, process.Status)}
                                    title="Klikni za promjenu statusa"
                                >
                                    {getStatusIcon(process.Status)}
                                    <span>{process.Status}</span>
                                    {isActive && elapsed > 0 && (
                                        <span className="timer">{formatTime(elapsed)}</span>
                                    )}
                                </button>

                                <div className="worker-assign">
                                    {process.Worker_Name ? (
                                        <span className="worker-badge">
                                            <User size={12} />
                                            {process.Worker_Name.split(' ')[0]}
                                        </span>
                                    ) : (
                                        <select
                                            className="worker-select"
                                            value=""
                                            onChange={(e) => {
                                                const worker = workers.find(w => w.Worker_ID === e.target.value);
                                                if (worker) {
                                                    onProcessUpdate(itemId, process.Process_Name, {
                                                        Worker_ID: worker.Worker_ID,
                                                        Worker_Name: worker.Name
                                                    });
                                                }
                                            }}
                                        >
                                            <option value="">+ Radnik</option>
                                            {workers.map(w => (
                                                <option key={w.Worker_ID} value={w.Worker_ID}>
                                                    {w.Name}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <style jsx>{`
                .product-process-card {
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    overflow: hidden;
                    transition: all 0.2s;
                }

                .product-process-card:hover {
                    border-color: #cbd5e1;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
                }

                .product-process-card.selected {
                    border-color: #3b82f6;
                    background: #f8faff;
                }

                .card-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 14px 16px;
                    cursor: pointer;
                }

                .checkbox-wrapper {
                    position: relative;
                    cursor: pointer;
                }

                .checkbox-wrapper input {
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                    accent-color: #3b82f6;
                }

                .product-info {
                    flex: 1;
                    min-width: 0;
                }

                .product-title {
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                }

                .product-name {
                    font-weight: 600;
                    font-size: 14px;
                    color: #1e293b;
                }

                .product-qty {
                    font-size: 12px;
                    color: #64748b;
                    background: #f1f5f9;
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .project-name {
                    font-size: 12px;
                    color: #94a3b8;
                }

                .progress-mini {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .progress-bar-mini {
                    width: 60px;
                    height: 4px;
                    background: #e2e8f0;
                    border-radius: 2px;
                    overflow: hidden;
                }

                .progress-fill-mini {
                    height: 100%;
                    background: linear-gradient(90deg, #22c55e, #16a34a);
                    transition: width 0.3s;
                }

                .progress-text {
                    font-size: 12px;
                    font-weight: 600;
                    color: #64748b;
                    min-width: 32px;
                }

                .expand-toggle {
                    background: none;
                    border: none;
                    padding: 4px;
                    cursor: pointer;
                    color: #94a3b8;
                    border-radius: 4px;
                }

                .expand-toggle:hover {
                    background: #f1f5f9;
                    color: #64748b;
                }

                .processes-list {
                    border-top: 1px solid #f1f5f9;
                    padding: 8px 16px 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .process-row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 8px 12px;
                    background: #f8fafc;
                    border-radius: 8px;
                }

                .process-order {
                    width: 20px;
                    height: 20px;
                    background: #e2e8f0;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 11px;
                    font-weight: 600;
                    color: #64748b;
                }

                .process-row .process-name {
                    flex: 1;
                    font-size: 13px;
                    font-weight: 500;
                    color: #334155;
                }

                .status-chip {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 600;
                    border: 1px solid;
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .status-chip:hover {
                    filter: brightness(0.95);
                    transform: scale(1.02);
                }

                .timer {
                    background: rgba(0,0,0,0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 10px;
                    margin-left: 4px;
                }

                .worker-assign {
                    min-width: 90px;
                }

                .worker-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 8px;
                    background: #f0f9ff;
                    color: #0369a1;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                }

                .worker-select {
                    padding: 4px 8px;
                    border: 1px dashed #cbd5e1;
                    border-radius: 6px;
                    font-size: 12px;
                    color: #64748b;
                    background: white;
                    cursor: pointer;
                }

                .worker-select:hover {
                    border-color: #3b82f6;
                }

                @media (max-width: 640px) {
                    .card-header {
                        flex-wrap: wrap;
                    }
                    .progress-mini {
                        order: 3;
                        width: 100%;
                        margin-top: 8px;
                    }
                    .progress-bar-mini {
                        flex: 1;
                    }
                    .process-row {
                        flex-wrap: wrap;
                    }
                    .worker-assign {
                        width: 100%;
                        margin-top: 4px;
                    }
                }
            `}</style>
        </div>
    );
}
