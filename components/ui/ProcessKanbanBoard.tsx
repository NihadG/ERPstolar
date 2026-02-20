'use client';

import { useState, DragEvent, useMemo } from 'react';
import { GripVertical, User, CheckCircle, Clock, Scissors, Plus, X, Pause, Play, Edit2 } from 'lucide-react';
import type { WorkOrderItem, ItemProcessStatus, Worker, SubTask } from '@/lib/types';
import { canWorkerStartProcess, triggerWorkLogReconciliation } from '@/lib/attendance';

interface ProcessKanbanBoardProps {
    items: WorkOrderItem[];
    processes: string[];
    workers: Worker[];
    organizationId?: string;
    onProcessUpdate: (itemId: string, processName: string, updates: Partial<ItemProcessStatus>) => void;
    onMoveToStage: (itemId: string, targetProcess: string, allProcesses: string[]) => void;
    onSubTaskUpdate?: (itemId: string, subTaskId: string, updates: Partial<SubTask>) => void;
    onSubTaskCreate?: (itemId: string, subTasks: SubTask[]) => void;
    onSubTaskMove?: (itemId: string, subTaskId: string, targetProcess: string) => void;
    onPauseToggle?: (itemId: string, isPaused: boolean) => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

// Unified card type for rendering (can be legacy process-based or sub-task)
interface KanbanCard {
    id: string;
    itemId: string;
    productName: string;
    projectName: string;
    quantity: number;
    totalQuantity: number;
    currentProcess: string;
    status: 'Na čekanju' | 'U toku' | 'Završeno' | 'Odloženo';
    isPaused: boolean;
    workerId?: string;
    workerName?: string;
    helpers?: { Worker_ID: string; Worker_Name: string }[];
    isSubTask: boolean;
    subTaskId?: string;
    canSplit: boolean;
    assignedWorkers?: { Worker_ID: string; Worker_Name: string }[];
}

export default function ProcessKanbanBoard({
    items,
    processes,
    workers,
    organizationId,
    onProcessUpdate,
    onMoveToStage,
    onSubTaskUpdate,
    onSubTaskCreate,
    onSubTaskMove,
    onPauseToggle,
    showToast
}: ProcessKanbanBoardProps) {
    const [draggedCard, setDraggedCard] = useState<string | null>(null);
    const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
    const [splitModalOpen, setSplitModalOpen] = useState<string | null>(null);
    const [splitGroups, setSplitGroups] = useState<number[]>([]);

    // Worker edit modal state
    const [editWorkerModalOpen, setEditWorkerModalOpen] = useState<string | null>(null);
    const [selectedMainWorker, setSelectedMainWorker] = useState<string>('');
    const [selectedHelpers, setSelectedHelpers] = useState<string[]>([]);

    // Convert items to unified KanbanCard format
    const kanbanCards = useMemo((): KanbanCard[] => {
        const cards: KanbanCard[] = [];

        items.forEach(item => {
            // Check if item has sub-tasks
            if (item.SubTasks && item.SubTasks.length > 0) {
                // Render sub-tasks as individual cards
                item.SubTasks.forEach(subTask => {
                    cards.push({
                        id: `${item.ID}-${subTask.SubTask_ID}`,
                        itemId: item.ID,
                        productName: item.Product_Name,
                        projectName: item.Project_Name,
                        quantity: subTask.Quantity,
                        totalQuantity: item.Quantity,
                        currentProcess: subTask.Current_Process,
                        status: subTask.Status,
                        isPaused: subTask.Is_Paused || false,
                        workerId: subTask.Worker_ID,
                        workerName: subTask.Worker_Name,
                        helpers: subTask.Helpers, // Now properly populated from SubTask
                        isSubTask: true,
                        subTaskId: subTask.SubTask_ID,
                        canSplit: false,
                        assignedWorkers: item.Assigned_Workers
                    });
                });
            } else {
                // Legacy: use Processes array to determine current stage
                let currentProcess = processes[0] || 'ZAVRŠENO';
                let status: 'Na čekanju' | 'U toku' | 'Završeno' = 'Na čekanju';
                let workerId: string | undefined;
                let workerName: string | undefined;
                let helpers: { Worker_ID: string; Worker_Name: string }[] | undefined;

                if (item.Processes && item.Processes.length > 0) {
                    for (const processName of processes) {
                        const proc = item.Processes.find(p => p.Process_Name === processName);
                        if (!proc || proc.Status !== 'Završeno') {
                            currentProcess = processName;
                            // Map process status to card status (filter out 'Odloženo')
                            const procStatus = proc?.Status;
                            status = (procStatus === 'U toku' || procStatus === 'Završeno' || procStatus === 'Na čekanju')
                                ? procStatus : 'Na čekanju';
                            workerId = proc?.Worker_ID;
                            workerName = proc?.Worker_Name;
                            helpers = proc?.Helpers;
                            break;
                        }
                    }
                    // Check if all completed
                    const allCompleted = processes.every(pName =>
                        item.Processes?.find(p => p.Process_Name === pName)?.Status === 'Završeno'
                    );
                    if (allCompleted) {
                        currentProcess = 'ZAVRŠENO';
                        status = 'Završeno';
                    }
                }

                cards.push({
                    id: item.ID,
                    itemId: item.ID,
                    productName: item.Product_Name,
                    projectName: item.Project_Name,
                    quantity: item.Quantity,
                    totalQuantity: item.Quantity,
                    currentProcess,
                    status,
                    isPaused: item.Is_Paused || false,
                    workerId,
                    workerName,
                    helpers,
                    isSubTask: false,
                    canSplit: item.Quantity > 1, // Can split if more than 1
                    assignedWorkers: item.Assigned_Workers
                });
            }
        });

        return cards;
    }, [items, processes]);

    // Group cards by current process
    const cardsByProcess = useMemo(() => {
        const grouped: Record<string, KanbanCard[]> = {};
        processes.forEach(p => grouped[p] = []);
        grouped['ZAVRŠENO'] = [];

        kanbanCards.forEach(card => {
            if (card.status === 'Završeno') {
                grouped['ZAVRŠENO'].push(card);
            } else if (grouped[card.currentProcess]) {
                grouped[card.currentProcess].push(card);
            } else {
                grouped['ZAVRŠENO'].push(card);
            }
        });

        return grouped;
    }, [kanbanCards, processes]);

    // Drag handlers
    const handleDragStart = (e: DragEvent<HTMLDivElement>, cardId: string) => {
        setDraggedCard(cardId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cardId);
    };

    const handleDragEnd = () => {
        setDraggedCard(null);
        setDragOverColumn(null);
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>, columnId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverColumn !== columnId) {
            setDragOverColumn(columnId);
        }
    };

    const handleDragLeave = () => {
        setDragOverColumn(null);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>, targetColumn: string) => {
        e.preventDefault();
        const cardId = e.dataTransfer.getData('text/plain');
        const card = kanbanCards.find(c => c.id === cardId);

        if (!card) return;

        if (card.isSubTask && onSubTaskMove) {
            onSubTaskMove(card.itemId, card.subTaskId!, targetColumn);
        } else {
            onMoveToStage(card.itemId, targetColumn, processes);
        }

        setDraggedCard(null);
        setDragOverColumn(null);

        // Auto-prompt: When moving to Montaža and no worker assigned, open worker edit
        if (targetColumn.toLowerCase() === 'montaža' && !card.workerId) {
            // Small delay to let the move complete first
            setTimeout(() => {
                const updatedCard = { ...card, currentProcess: targetColumn };
                setEditWorkerModalOpen(updatedCard.id);
                setSelectedMainWorker('');
                setSelectedHelpers([]);
            }, 300);
        }
    };

    // Worker assignment
    const handleAssignWorker = async (card: KanbanCard, workerId: string) => {
        if (!workerId) return;

        const worker = workers.find(w => w.Worker_ID === workerId);
        if (!worker) return;

        // Check attendance
        const availability = await canWorkerStartProcess(workerId);
        if (!availability.allowed) {
            alert(`⚠️ Radnik "${worker.Name}" nije dostupan danas.\nRazlog: ${availability.reason}`);
            return;
        }

        if (card.isSubTask && onSubTaskUpdate) {
            onSubTaskUpdate(card.itemId, card.subTaskId!, {
                Worker_ID: worker.Worker_ID,
                Worker_Name: worker.Name,
                Status: 'U toku'
            });
        } else {
            onProcessUpdate(card.itemId, card.currentProcess, {
                Worker_ID: worker.Worker_ID,
                Worker_Name: worker.Name
            });
        }

        // FIX-1: Immediately create WorkLog for this assignment
        if (organizationId) {
            triggerWorkLogReconciliation(workerId, organizationId).then(result => {
                if (result.created > 0) {
                    showToast?.(`✅ ${result.message}`, 'success');
                } else {
                    showToast?.(`ℹ️ ${result.message}`, 'info');
                }
            }).catch(err => {
                console.error('WorkLog reconciliation failed:', err);
            });
        }
    };

    // Split functionality - supports N groups
    const handleSplit = (card: KanbanCard) => {
        setSplitModalOpen(card.id);
        // Initialize with 2 equal groups
        const half = Math.floor(card.quantity / 2);
        setSplitGroups([half, card.quantity - half]);
    };

    const addSplitGroup = () => {
        const card = kanbanCards.find(c => c.id === splitModalOpen);
        if (!card) return;

        // Add a new group with 1 item, taking from the largest group
        setSplitGroups(prev => {
            const maxIdx = prev.indexOf(Math.max(...prev));
            if (prev[maxIdx] < 2) return prev; // Can't split if largest group has only 1

            const newGroups = [...prev];
            newGroups[maxIdx] -= 1;
            newGroups.push(1);
            return newGroups;
        });
    };

    const removeSplitGroup = (index: number) => {
        if (splitGroups.length <= 2) return; // Minimum 2 groups

        setSplitGroups(prev => {
            const removed = prev[index];
            const newGroups = prev.filter((_, i) => i !== index);
            // Add removed quantity to the first group
            newGroups[0] += removed;
            return newGroups;
        });
    };

    const updateGroupQuantity = (index: number, value: number) => {
        setSplitGroups(prev => {
            const newGroups = [...prev];
            const oldValue = newGroups[index];
            const diff = value - oldValue;

            // Find another group to balance
            const otherIdx = index === 0 ? 1 : 0;
            if (newGroups[otherIdx] - diff < 1) return prev; // Can't go below 1

            newGroups[index] = value;
            newGroups[otherIdx] -= diff;
            return newGroups;
        });
    };

    const confirmSplit = () => {
        const card = kanbanCards.find(c => c.id === splitModalOpen);
        if (!card || !onSubTaskCreate) {
            setSplitModalOpen(null);
            return;
        }

        // Validate all groups have at least 1
        if (splitGroups.some(q => q < 1)) {
            alert('Sve grupe moraju imati barem 1 komad');
            return;
        }

        // Validate total matches original quantity
        const total = splitGroups.reduce((sum, q) => sum + q, 0);
        if (total !== card.quantity) {
            alert(`Ukupna količina (${total}) mora biti jednaka originalnoj (${card.quantity})`);
            return;
        }

        // Create sub-tasks for all groups
        const subTasks: SubTask[] = splitGroups.map((qty, idx) => ({
            SubTask_ID: `st-${Date.now()}-${idx + 1}`,
            Quantity: qty,
            Current_Process: card.currentProcess,
            Status: 'Na čekanju' as const
        }));

        onSubTaskCreate(card.itemId, subTasks);
        setSplitModalOpen(null);
    };

    // Pause/Resume a card (toggle Is_Paused and track Pause_Periods)
    // For sub-tasks: uses onSubTaskUpdate to pause individual sub-task
    // For items: uses onPauseToggle to pause entire item
    const handlePause = (card: KanbanCard) => {
        const now = new Date().toISOString();

        if (card.isSubTask && onSubTaskUpdate) {
            // Find current sub-task to get existing pause periods
            const item = items.find(i => i.ID === card.itemId);
            const subTask = item?.SubTasks?.find((st: any) => st.SubTask_ID === card.subTaskId);
            const currentPausePeriods = subTask?.Pause_Periods || [];

            if (!card.isPaused) {
                // PAUSING: Add new pause period
                onSubTaskUpdate(card.itemId, card.subTaskId!, {
                    Is_Paused: true,
                    Pause_Periods: [...currentPausePeriods, { Started_At: now }]
                });
                // WARN-3: Informative toast
                showToast?.('⏸️ Proizvod pauziran od sutra. Danas evidentiran rad ostaje.', 'info');
            } else {
                // RESUMING: Close the last open pause period
                const updatedPeriods = currentPausePeriods.map((p: any, idx: number) => {
                    if (idx === currentPausePeriods.length - 1 && !p.Ended_At) {
                        return { ...p, Ended_At: now };
                    }
                    return p;
                });
                onSubTaskUpdate(card.itemId, card.subTaskId!, {
                    Is_Paused: false,
                    Pause_Periods: updatedPeriods
                });
                showToast?.('▶️ Proizvod nastavljen — dnevnice se ponovo obračunavaju.', 'success');
            }
        } else if (onPauseToggle) {
            // Legacy item-level pause
            onPauseToggle(card.itemId, !card.isPaused);
            if (!card.isPaused) {
                showToast?.('⏸️ Proizvod pauziran od sutra. Danas evidentiran rad ostaje.', 'info');
            } else {
                showToast?.('▶️ Proizvod nastavljen — dnevnice se ponovo obračunavaju.', 'success');
            }
        }
    };

    // Open edit worker modal
    const openEditWorkerModal = (card: KanbanCard) => {
        setEditWorkerModalOpen(card.id);
        setSelectedMainWorker(card.workerId || '');
        setSelectedHelpers(card.helpers?.map(h => h.Worker_ID) || []);
    };

    // Toggle helper selection
    const toggleHelperSelection = (helperId: string) => {
        setSelectedHelpers(prev =>
            prev.includes(helperId)
                ? prev.filter(id => id !== helperId)
                : [...prev, helperId]
        );
    };

    // Save worker changes
    const saveWorkerChanges = async () => {
        const card = kanbanCards.find(c => c.id === editWorkerModalOpen);
        if (!card) {
            setEditWorkerModalOpen(null);
            return;
        }

        const mainWorker = workers.find(w => w.Worker_ID === selectedMainWorker);
        const helperWorkers = selectedHelpers.map(id => workers.find(w => w.Worker_ID === id)).filter(Boolean) as Worker[];

        // Build helpers array
        const helpers = helperWorkers.map(w => ({
            Worker_ID: w.Worker_ID,
            Worker_Name: w.Name
        }));

        // Collect all worker IDs that need WorkLog reconciliation
        const workerIdsToReconcile: string[] = [];

        if (card.isSubTask && onSubTaskUpdate) {
            // Update sub-task worker + helpers
            onSubTaskUpdate(card.itemId, card.subTaskId!, {
                Worker_ID: mainWorker?.Worker_ID,
                Worker_Name: mainWorker?.Name,
                Status: 'U toku',
                Helpers: helpers
            });
        } else {
            // Update process with main worker and helpers
            onProcessUpdate(card.itemId, card.currentProcess, {
                Worker_ID: mainWorker?.Worker_ID,
                Worker_Name: mainWorker?.Name,
                Helpers: helpers
            });
        }

        // FIX-1: Reconcile WorkLogs for main worker + all helpers
        if (organizationId) {
            if (mainWorker) workerIdsToReconcile.push(mainWorker.Worker_ID);
            helperWorkers.forEach(w => workerIdsToReconcile.push(w.Worker_ID));

            // Fire-and-forget reconciliation for all assigned workers
            Promise.all(
                workerIdsToReconcile.map(wId => triggerWorkLogReconciliation(wId, organizationId))
            ).then(results => {
                const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
                if (totalCreated > 0) {
                    showToast?.(`✅ WorkLog kreiran za ${totalCreated} dodjelu/e`, 'success');
                }
            }).catch(err => {
                console.error('WorkLog reconciliation failed:', err);
            });
        }

        setEditWorkerModalOpen(null);
    };

    return (
        <div className="kanban-container">
            <div className="kanban-board">
                {/* Process Columns */}
                {processes.map((process, index) => {
                    const columnCards = cardsByProcess[process] || [];
                    const isDropTarget = dragOverColumn === process;

                    return (
                        <div
                            key={process}
                            className={`kanban-column ${isDropTarget ? 'drop-target' : ''}`}
                            onDragOver={(e) => handleDragOver(e, process)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, process)}
                        >
                            <div className="column-header" style={process.toLowerCase() === 'montaža' ? { background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(139, 92, 246, 0.1))' } : undefined}>
                                <span className="step-number" style={process.toLowerCase() === 'montaža' ? { background: '#8b5cf6', color: 'white' } : undefined}>{index + 1}</span>
                                <span className="column-title">
                                    {process.toLowerCase() === 'montaža' && <span className="material-icons-round" style={{ fontSize: '14px', marginRight: '4px', verticalAlign: 'middle', color: '#8b5cf6' }}>build</span>}
                                    {process}
                                </span>
                                <span className="item-count">{columnCards.length}</span>
                            </div>
                            <div className="column-content">
                                {columnCards.map(card => {
                                    const isDragging = draggedCard === card.id;

                                    return (
                                        <div
                                            key={card.id}
                                            className={`kanban-card ${card.status === 'U toku' ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${card.isSubTask ? 'sub-task' : ''}`}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, card.id)}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <div className="card-header">
                                                <GripVertical size={14} className="drag-handle" />
                                                <div className="card-info">
                                                    <span className="item-name">
                                                        {card.productName}
                                                        {card.isSubTask && (
                                                            <span className="sub-task-badge">dio</span>
                                                        )}
                                                    </span>
                                                    <span className="item-meta">
                                                        <strong>{card.quantity}</strong>/{card.totalQuantity} kom • {card.projectName}
                                                    </span>
                                                </div>
                                                {card.canSplit && (
                                                    <button
                                                        className="split-btn"
                                                        onClick={(e) => { e.stopPropagation(); handleSplit(card); }}
                                                        title="Podijeli na dijelove"
                                                    >
                                                        <Scissors size={14} />
                                                    </button>
                                                )}
                                                {/* Pause/Resume Button - available for all non-completed items */}
                                                {card.status !== 'Završeno' && onPauseToggle && (
                                                    <button
                                                        className="split-btn"
                                                        onClick={(e) => { e.stopPropagation(); handlePause(card); }}
                                                        title={card.isPaused ? 'Nastavi rad' : 'Pauziraj (bez dnevnice)'}
                                                        style={{
                                                            background: card.isPaused ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                                            color: card.isPaused ? '#10b981' : '#f59e0b'
                                                        }}
                                                    >
                                                        {card.isPaused ? <Play size={14} /> : <Pause size={14} />}
                                                    </button>
                                                )}
                                            </div>

                                            {/* #3 Fix: Warning for unassigned Montaža cards */}
                                            {process.toLowerCase() === 'montaža' && !card.workerId && (
                                                <div className="montaza-warning">
                                                    <span className="material-icons-round" style={{ fontSize: '13px' }}>warning</span>
                                                    Radnik nije dodijeljen — trošak se ne bilježi!
                                                </div>
                                            )}

                                            <div className="card-footer">
                                                <div className="workers-section">
                                                    <div className="worker-display">
                                                        <button
                                                            className="edit-worker-btn"
                                                            onClick={(e) => { e.stopPropagation(); openEditWorkerModal(card); }}
                                                            title="Uredi radnike"
                                                        >
                                                            <Edit2 size={10} />
                                                        </button>
                                                        <User size={12} />
                                                        <span className={`worker-name ${process.toLowerCase() === 'montaža' && !card.workerId ? 'unassigned-warning' : ''}`}>
                                                            {card.workerName || 'Nije dodijeljen'}
                                                        </span>
                                                    </div>
                                                    {card.helpers && card.helpers.length > 0 && (
                                                        <div className="helpers-display">
                                                            {card.helpers.map(h => (
                                                                <span key={h.Worker_ID} className="helper-chip">
                                                                    +{h.Worker_Name.split(' ')[0]}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                {card.isPaused ? (
                                                    <span className="status-badge" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                                                        <Pause size={10} /> Pauzirano
                                                    </span>
                                                ) : card.status === 'U toku' && (
                                                    <span className="status-badge active">
                                                        <Clock size={10} /> U toku
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {columnCards.length === 0 && (
                                    <div className="empty-state">
                                        {isDropTarget ? 'Pusti ovdje' : 'Nema stavki'}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Completed Column */}
                <div
                    className={`kanban-column completed-col ${dragOverColumn === 'ZAVRŠENO' ? 'drop-target' : ''}`}
                    onDragOver={(e) => handleDragOver(e, 'ZAVRŠENO')}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, 'ZAVRŠENO')}
                >
                    <div className="column-header">
                        <CheckCircle size={16} className="check-icon" />
                        <span className="column-title">Završeno</span>
                        <span className="item-count">{(cardsByProcess['ZAVRŠENO'] || []).length}</span>
                    </div>
                    <div className="column-content">
                        {(cardsByProcess['ZAVRŠENO'] || []).map(card => (
                            <div
                                key={card.id}
                                className={`kanban-card completed ${card.isSubTask ? 'sub-task' : ''}`}
                            >
                                <div className="card-header">
                                    <CheckCircle size={14} className="check-icon" />
                                    <div className="card-info">
                                        <span className="item-name">{card.productName}</span>
                                        <span className="item-meta">
                                            {card.quantity} kom • {card.projectName}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Split Modal */}
            {splitModalOpen && (
                <div className="split-modal-overlay" onClick={() => setSplitModalOpen(null)}>
                    <div className="split-modal" onClick={e => e.stopPropagation()}>
                        <div className="split-modal-header">
                            <Scissors size={20} />
                            <span>Podijeli proizvod</span>
                            <button className="close-btn" onClick={() => setSplitModalOpen(null)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="split-modal-body">
                            {(() => {
                                const card = kanbanCards.find(c => c.id === splitModalOpen);
                                if (!card) return null;
                                const total = splitGroups.reduce((sum, q) => sum + q, 0);
                                return (
                                    <>
                                        <div className="split-info">
                                            <strong>{card.productName}</strong>
                                            <span>Ukupno: {card.quantity} kom (raspoređeno: {total})</span>
                                        </div>
                                        <div className="split-groups-list">
                                            {splitGroups.map((qty, idx) => (
                                                <div key={idx} className="split-group-row">
                                                    <span className="group-label">Grupa {idx + 1}</span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        max={card.quantity}
                                                        value={qty}
                                                        onChange={e => {
                                                            const newQty = parseInt(e.target.value) || 1;
                                                            setSplitGroups(prev => {
                                                                const newGroups = [...prev];
                                                                newGroups[idx] = newQty;
                                                                return newGroups;
                                                            });
                                                        }}
                                                    />
                                                    <span className="group-unit">kom</span>
                                                    {splitGroups.length > 2 && (
                                                        <button
                                                            className="btn-remove-group"
                                                            onClick={() => removeSplitGroup(idx)}
                                                            title="Ukloni grupu"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <button className="btn-add-group" onClick={addSplitGroup}>
                                            <Plus size={14} /> Dodaj grupu
                                        </button>
                                        {total !== card.quantity && (
                                            <div className="split-warning">
                                                ⚠️ Ukupno ({total}) mora biti jednako {card.quantity}
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                        <div className="split-modal-footer">
                            <button className="btn-cancel" onClick={() => setSplitModalOpen(null)}>Odustani</button>
                            <button className="btn-confirm" onClick={confirmSplit}>Podijeli</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Worker Edit Modal */}
            {editWorkerModalOpen && (
                <div className="split-modal-overlay" onClick={() => {
                    // #3 Fix: Warn when closing without worker on Montaža
                    const card = kanbanCards.find(c => c.id === editWorkerModalOpen);
                    if (card?.currentProcess?.toLowerCase() === 'montaža' && !selectedMainWorker) {
                        if (!confirm('Zatvaranje bez odabira radnika znači da se trošak rada NEĆE bilježiti za ovu stavku. Nastaviti?')) return;
                    }
                    setEditWorkerModalOpen(null);
                }}>
                    <div className="split-modal" onClick={e => e.stopPropagation()}>
                        <div className="split-modal-header">
                            <Edit2 size={20} />
                            <span>Uredi radnike</span>
                            <button className="close-btn" onClick={() => {
                                const card = kanbanCards.find(c => c.id === editWorkerModalOpen);
                                if (card?.currentProcess?.toLowerCase() === 'montaža' && !selectedMainWorker) {
                                    if (!confirm('Zatvaranje bez odabira radnika znači da se trošak rada NEĆE bilježiti za ovu stavku. Nastaviti?')) return;
                                }
                                setEditWorkerModalOpen(null);
                            }}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="split-modal-body">
                            {(() => {
                                const card = kanbanCards.find(c => c.id === editWorkerModalOpen);
                                if (!card) return null;
                                return (
                                    <>
                                        <div className="edit-worker-section">
                                            <label className="section-label">Glavni radnik</label>
                                            <select
                                                className="worker-select"
                                                value={selectedMainWorker}
                                                onChange={(e) => setSelectedMainWorker(e.target.value)}
                                            >
                                                <option value="">-- Nije dodijeljen --</option>
                                                {workers.map(w => (
                                                    <option key={w.Worker_ID} value={w.Worker_ID}>
                                                        {w.Name} ({w.Daily_Rate?.toFixed(0) || 0} KM/dan)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="edit-worker-section">
                                            <label className="section-label">Pomoćnici</label>
                                            <div className="helpers-list">
                                                {workers
                                                    .filter(w => w.Worker_ID !== selectedMainWorker)
                                                    .map(w => (
                                                        <label key={w.Worker_ID} className="helper-checkbox">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedHelpers.includes(w.Worker_ID)}
                                                                onChange={() => toggleHelperSelection(w.Worker_ID)}
                                                            />
                                                            <span className="helper-name">{w.Name}</span>
                                                            <span className="helper-rate">{w.Daily_Rate?.toFixed(0) || 0} KM</span>
                                                        </label>
                                                    ))
                                                }
                                            </div>
                                        </div>

                                        {card.workerName && selectedMainWorker !== card.workerId && (
                                            <div className="worker-change-notice">
                                                ⚠️ Mijenjate radnika sa: <strong>{card.workerName}</strong>
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                        <div className="split-modal-footer">
                            <button className="btn-cancel" onClick={() => {
                                const card = kanbanCards.find(c => c.id === editWorkerModalOpen);
                                if (card?.currentProcess?.toLowerCase() === 'montaža' && !selectedMainWorker) {
                                    if (!confirm('Zatvaranje bez odabira radnika znači da se trošak rada NEĆE bilježiti za ovu stavku. Nastaviti?')) return;
                                }
                                setEditWorkerModalOpen(null);
                            }}>Odustani</button>
                            <button className="btn-confirm" onClick={saveWorkerChanges}>Spremi</button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                .kanban-container {
                    width: 100%;
                    overflow-x: auto;
                }
                .kanban-board {
                    display: flex;
                    gap: 16px;
                    padding: 16px 0;
                    min-width: max-content;
                }
                .kanban-column {
                    min-width: 260px;
                    max-width: 280px;
                    background: #f8fafc;
                    border-radius: 12px;
                    border: 2px solid transparent;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .kanban-column.drop-target {
                    border-color: #3b82f6;
                    background: #eff6ff;
                    transform: scale(1.02);
                    box-shadow: 0 8px 25px rgba(59, 130, 246, 0.15);
                }
                .kanban-column.completed-col {
                    background: #f0fdf4;
                }
                .column-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px 16px;
                    border-bottom: 1px solid #e2e8f0;
                }
                .step-number {
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    background: #e2e8f0;
                    color: #475569;
                    font-size: 11px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .kanban-column.drop-target .step-number {
                    background: #3b82f6;
                    color: white;
                    transform: scale(1.1);
                }
                .column-title {
                    flex: 1;
                    font-weight: 600;
                    font-size: 13px;
                    color: #1e293b;
                }
                .item-count {
                    background: #e2e8f0;
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 600;
                    color: #64748b;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .kanban-column.drop-target .item-count {
                    background: #3b82f6;
                    color: white;
                }
                .check-icon {
                    color: #22c55e;
                }
                .column-content {
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    min-height: 200px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                
                /* Cards - Enhanced animations */
                .kanban-card {
                    background: white;
                    border-radius: 10px;
                    padding: 12px;
                    border: 1px solid #e2e8f0;
                    cursor: grab;
                    transition: 
                        transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
                        box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                        border-color 0.2s ease,
                        opacity 0.2s ease;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                    will-change: transform;
                }
                .kanban-card:hover {
                    border-color: #cbd5e1;
                    box-shadow: 0 8px 20px rgba(0,0,0,0.1);
                    transform: translateY(-3px) scale(1.01);
                }
                .kanban-card:active {
                    cursor: grabbing;
                    transform: scale(1.03) rotate(1deg);
                    box-shadow: 0 12px 30px rgba(0,0,0,0.15);
                    z-index: 100;
                }
                .kanban-card.active {
                    border-left: 3px solid #f59e0b;
                    background: linear-gradient(to right, #fffbeb, white);
                }
                .kanban-card.dragging {
                    opacity: 0.4;
                    transform: scale(0.95);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                .kanban-card.completed {
                    background: #f0fdf4;
                    border-color: #bbf7d0;
                    cursor: default;
                }
                .kanban-card.completed:hover {
                    transform: none;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                }
                .kanban-card.sub-task {
                    border-left: 3px solid #8b5cf6;
                }
                .kanban-card.sub-task.active {
                    border-left-color: #f59e0b;
                }

                .card-header {
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                }
                .drag-handle {
                    color: #94a3b8;
                    margin-top: 2px;
                    flex-shrink: 0;
                    transition: color 0.2s ease;
                }
                .kanban-card:hover .drag-handle {
                    color: #64748b;
                }
                .card-info {
                    flex: 1;
                    min-width: 0;
                }
                .item-name {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 600;
                    font-size: 13px;
                    color: #1e293b;
                    line-height: 1.3;
                }
                .sub-task-badge {
                    background: #ede9fe;
                    color: #7c3aed;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 9px;
                    font-weight: 700;
                    text-transform: uppercase;
                }
                .item-meta {
                    font-size: 11px;
                    color: #64748b;
                    margin-top: 2px;
                    display: block;
                }
                .item-meta strong {
                    color: #3b82f6;
                }
                
                .split-btn {
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    border: 1px solid #e2e8f0;
                    background: white;
                    color: #64748b;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .split-btn:hover {
                    background: #f1f5f9;
                    color: #8b5cf6;
                    border-color: #c4b5fd;
                    transform: scale(1.1);
                }
                .split-btn:active {
                    transform: scale(0.95);
                }
                
                .card-footer {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    margin-top: 10px;
                    padding-top: 10px;
                    border-top: 1px solid #f1f5f9;
                }
                .workers-section {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .worker-display {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: #64748b;
                }
                .edit-worker-btn {
                    width: 20px;
                    height: 20px;
                    border-radius: 4px;
                    border: 1px solid #e2e8f0;
                    background: white;
                    color: #94a3b8;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                    padding: 0;
                }
                .edit-worker-btn:hover {
                    background: #3b82f6;
                    color: white;
                    border-color: #3b82f6;
                    transform: scale(1.1);
                }
                .worker-display .worker-name {
                    font-size: 11px;
                    color: #334155;
                    font-weight: 500;
                }
                .helpers-display {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                    margin-left: 18px;
                }
                .helper-chip {
                    font-size: 9px;
                    padding: 1px 5px;
                    background: #eef2ff;
                    color: #4f46e5;
                    border-radius: 4px;
                    font-weight: 500;
                }
                .status-badge {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 8px;
                    border-radius: 6px;
                    font-size: 10px;
                    font-weight: 600;
                    transition: all 0.2s ease;
                }
                .status-badge.active {
                    background: #fef3c7;
                    color: #b45309;
                    animation: pulse-glow 2s ease-in-out infinite;
                }
                
                @keyframes pulse-glow {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.2); }
                    50% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.1); }
                }
                
                .empty-state {
                    padding: 24px;
                    text-align: center;
                    color: #94a3b8;
                    font-size: 12px;
                    border: 2px dashed #e2e8f0;
                    border-radius: 8px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .kanban-column.drop-target .empty-state {
                    border-color: #3b82f6;
                    background: rgba(59, 130, 246, 0.05);
                    color: #3b82f6;
                }
                
                /* Split Modal */
                .split-modal-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }
                .split-modal {
                    background: white;
                    border-radius: 16px;
                    width: 360px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                .split-modal-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 16px 20px;
                    border-bottom: 1px solid #e2e8f0;
                    font-weight: 600;
                    color: #1e293b;
                }
                .split-modal-header .close-btn {
                    margin-left: auto;
                    background: none;
                    border: none;
                    color: #64748b;
                    cursor: pointer;
                    padding: 4px;
                }
                .split-modal-body {
                    padding: 20px;
                }
                .split-info {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    margin-bottom: 20px;
                }
                .split-info strong {
                    font-size: 15px;
                }
                .split-info span {
                    font-size: 13px;
                    color: #64748b;
                }
                .split-input {
                    margin-bottom: 20px;
                }
                .split-input label {
                    display: block;
                    font-size: 13px;
                    color: #475569;
                    margin-bottom: 8px;
                }
                .split-input input {
                    width: 100%;
                    padding: 10px 12px;
                    border: 2px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    text-align: center;
                }
                .split-input input:focus {
                    outline: none;
                    border-color: #8b5cf6;
                }
                .split-preview {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 16px;
                    padding: 16px;
                    background: #f8fafc;
                    border-radius: 10px;
                }
                .split-group {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                    padding: 12px 20px;
                    background: white;
                    border-radius: 8px;
                    border: 2px solid #e2e8f0;
                }
                .group-label {
                    font-size: 11px;
                    color: #64748b;
                }
                .group-qty {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1e293b;
                }
                
                /* N-Group Split Styles */
                .split-groups-list {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin-bottom: 16px;
                }
                .split-group-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    background: #f8fafc;
                    border-radius: 8px;
                }
                .split-group-row .group-label {
                    font-size: 13px;
                    font-weight: 600;
                    color: #475569;
                    min-width: 70px;
                }
                .split-group-row input {
                    width: 80px;
                    padding: 8px 10px;
                    border: 2px solid #e2e8f0;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    text-align: center;
                }
                .split-group-row input:focus {
                    outline: none;
                    border-color: #8b5cf6;
                }
                .split-group-row .group-unit {
                    font-size: 12px;
                    color: #64748b;
                }
                .btn-remove-group {
                    padding: 4px;
                    background: #fee2e2;
                    border: none;
                    border-radius: 4px;
                    color: #dc2626;
                    cursor: pointer;
                    margin-left: auto;
                }
                .btn-remove-group:hover {
                    background: #fecaca;
                }
                .btn-add-group {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    width: 100%;
                    padding: 10px;
                    background: #f1f5f9;
                    border: 2px dashed #cbd5e1;
                    border-radius: 8px;
                    color: #475569;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .btn-add-group:hover {
                    background: #e2e8f0;
                    border-color: #94a3b8;
                }
                .split-warning {
                    margin-top: 12px;
                    padding: 10px 12px;
                    background: #fef3c7;
                    border-radius: 8px;
                    color: #b45309;
                    font-size: 12px;
                    text-align: center;
                }
                .split-modal-footer {
                    display: flex;
                    gap: 12px;
                    padding: 16px 20px;
                    border-top: 1px solid #e2e8f0;
                }
                .btn-cancel, .btn-confirm {
                    flex: 1;
                    padding: 10px;
                    border-radius: 8px;
                    font-weight: 600;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .btn-cancel {
                    background: #f1f5f9;
                    border: 1px solid #e2e8f0;
                    color: #475569;
                }
                .btn-cancel:hover {
                    background: #e2e8f0;
                }
                .btn-confirm {
                    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
                    border: none;
                    color: white;
                }
                .btn-confirm:hover {
                    background: linear-gradient(135deg, #7c3aed, #6d28d9);
                }
                
                /* Worker Edit Modal Styles */
                .edit-worker-section {
                    margin-bottom: 16px;
                }
                .section-label {
                    display: block;
                    font-size: 12px;
                    font-weight: 600;
                    color: #475569;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .worker-select {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 14px;
                    background: white;
                    cursor: pointer;
                    transition: border-color 0.2s;
                }
                .worker-select:focus {
                    outline: none;
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
                }
                .helpers-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: 180px;
                    overflow-y: auto;
                    padding: 4px;
                }
                .helper-checkbox {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 12px;
                    background: #f8fafc;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .helper-checkbox:hover {
                    background: #f1f5f9;
                }
                .helper-checkbox input[type="checkbox"] {
                    width: 16px;
                    height: 16px;
                    accent-color: #3b82f6;
                }
                .helper-name {
                    flex: 1;
                    font-size: 13px;
                    color: #1e293b;
                }
                .helper-rate {
                    font-size: 11px;
                    color: #64748b;
                    background: #e2e8f0;
                    padding: 2px 6px;
                    border-radius: 4px;
                }
                .worker-change-notice {
                    background: #fef3c7;
                    border: 1px solid #fcd34d;
                    border-radius: 8px;
                    padding: 10px 14px;
                    font-size: 12px;
                    color: #92400e;
                    margin-top: 12px;
                }
                .worker-change-notice strong {
                    color: #78350f;
                }

                /* #3 Fix: Montaža unassigned warning */
                .montaza-warning {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 8px;
                    background: #fef2f2;
                    border: 1px solid #fecaca;
                    border-radius: 6px;
                    font-size: 10px;
                    color: #dc2626;
                    font-weight: 500;
                    animation: pulseWarn 2s ease-in-out infinite;
                    margin-top: 4px;
                }
                @keyframes pulseWarn {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.6; }
                }
                .worker-name.unassigned-warning {
                    color: #dc2626 !important;
                    font-weight: 600 !important;
                }
            `}</style>
        </div >
    );
}
