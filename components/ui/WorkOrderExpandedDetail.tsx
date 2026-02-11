import { useState, useEffect, useMemo } from 'react';
import { Calendar, Play, CheckCircle, Clock, Edit2, Plus, X, TrendingUp } from 'lucide-react';
import type { WorkOrder, Worker, WorkOrderItem, ItemProcessStatus, SubTask } from '@/lib/types';
import ProcessKanbanBoard from './ProcessKanbanBoard';
import ProfitOverviewWidget from './ProfitOverviewWidget';
import PlanVsActualCard from './PlanVsActualCard';
import { PRODUCTION_STEPS } from '@/lib/types';
import {
    updateItemProcess,
    updateAllItemProcesses,
    bulkUpdateProcesses,
    createSubTasks,
    updateSubTask,
    moveSubTask,
    canWorkerStartProcess
} from '@/lib/attendance';

interface WorkOrderExpandedDetailProps {
    workOrder: WorkOrder;
    workers: Worker[];
    onUpdate: (workOrderId: string, updates: any) => Promise<void>;
    onPrint: (workOrder: WorkOrder) => void;
    onDelete: (workOrderId: string) => Promise<void>;
    onStart: (workOrderId: string) => Promise<void>;
    onRefresh?: (...collections: string[]) => void;
}

export default function WorkOrderExpandedDetail({
    workOrder,
    workers,
    onUpdate,
    onPrint,
    onDelete,
    onStart,
    onRefresh
}: WorkOrderExpandedDetailProps) {
    const [localItems, setLocalItems] = useState<WorkOrderItem[]>([]);
    const [isLoading, setIsLoading] = useState<string | null>(null);

    // Process editing
    const [editingProcesses, setEditingProcesses] = useState(false);
    const [localProcesses, setLocalProcesses] = useState<string[]>([]);
    const [newProcessName, setNewProcessName] = useState('');

    // Initialize local state
    useEffect(() => {
        if (workOrder?.items) {
            const itemsWithProcesses = workOrder.items.map(item => {
                if (!item.Processes || item.Processes.length === 0) {
                    return {
                        ...item,
                        Processes: (workOrder.Production_Steps || PRODUCTION_STEPS).map(step => ({
                            Process_Name: step,
                            Status: 'Na čekanju' as const
                        }))
                    };
                }
                return item;
            });
            setLocalItems(itemsWithProcesses);
        }
        if (workOrder?.Production_Steps) {
            setLocalProcesses(workOrder.Production_Steps);
        } else {
            setLocalProcesses(PRODUCTION_STEPS);
        }
    }, [workOrder]);

    // Format helpers
    const formatDate = (dateStr: string | undefined): string => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('bs-BA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    // Process update handler (for single field updates like worker assignment)
    const handleProcessUpdate = async (itemId: string, processName: string, updates: Partial<ItemProcessStatus>) => {
        try {
            setIsLoading(itemId);
            await updateItemProcess(workOrder.Work_Order_ID, itemId, processName, updates);

            setLocalItems(prev => prev.map(item => {
                if (item.ID !== itemId) return item;
                const processes = (item.Processes || []).map(p =>
                    p.Process_Name === processName ? { ...p, ...updates } : p
                );
                return { ...item, Processes: processes };
            }));
        } catch (error) {
            console.error('Error updating process:', error);
        } finally {
            setIsLoading(null);
            onRefresh?.('workOrders', 'projects'); // Refresh parent data
        }
    };

    // Move item to a specific stage (drag-and-drop) - synchronizes ALL process statuses
    const handleMoveToStage = async (itemId: string, targetProcess: string, allProcesses: string[]) => {
        const now = new Date().toISOString();
        const targetIndex = targetProcess === 'ZAVRŠENO' ? allProcesses.length : allProcesses.indexOf(targetProcess);

        // Find the item
        const item = localItems.find(i => i.ID === itemId);
        if (!item) return;

        // VALIDATION: Check if item is currently waiting and moving to U toku
        const currentStage = item.Processes?.find(p => p.Status !== 'Završeno');
        const isStartingWork = currentStage?.Status === 'Na čekanju' && targetIndex >= 0;

        if (isStartingWork && item.materials && item.materials.length > 0) {
            // Check essential materials
            const missingMaterials = item.materials.filter(
                m => m.Is_Essential && m.Status !== 'Primljeno'
            );

            if (missingMaterials.length > 0) {
                const materialNames = missingMaterials.map(m => m.Material_Name).join(', ');
                alert(`⚠️ Ne možete pokrenuti rad.\n\nEsencijalni materijali nisu spremni:\n${materialNames}`);
                return;
            }
        }

        // VALIDATION: Check worker attendance when starting work
        if (isStartingWork && currentStage?.Worker_ID) {
            const availability = await canWorkerStartProcess(currentStage.Worker_ID);
            if (!availability.allowed) {
                alert(`⚠️ Ne možete pokrenuti rad.\n\nRadnik "${currentStage.Worker_Name}" nije prisutan.\nRazlog: ${availability.reason}`);
                return;
            }

            // Check helpers for this stage
            if (currentStage.Helpers && currentStage.Helpers.length > 0) {
                for (const helper of currentStage.Helpers) {
                    const helperAvailability = await canWorkerStartProcess(helper.Worker_ID);
                    if (!helperAvailability.allowed) {
                        alert(`⚠️ Ne možete pokrenuti rad.\n\nPomoćnik "${helper.Worker_Name}" nije prisutan.\nRazlog: ${helperAvailability.reason}`);
                        return;
                    }
                }
            }
        }

        // Build new process statuses
        const newProcesses: ItemProcessStatus[] = allProcesses.map((processName, index) => {
            const existing = (item.Processes?.find(p => p.Process_Name === processName) || {}) as Partial<ItemProcessStatus>;

            if (targetProcess === 'ZAVRŠENO' || index < targetIndex) {
                // All processes before target (or all if target is ZAVRŠENO) are completed
                return {
                    ...existing,
                    Process_Name: processName,
                    Status: 'Završeno' as const,
                    Started_At: existing.Started_At || now,
                    Completed_At: existing.Completed_At || now
                };
            } else if (index === targetIndex) {
                // Target process is "In Progress" - don't include Completed_At (undefined not allowed in Firestore)
                const inProgressProcess: ItemProcessStatus = {
                    Process_Name: processName,
                    Status: 'U toku' as const,
                    Started_At: existing.Started_At || now
                };
                if (existing.Worker_ID) inProgressProcess.Worker_ID = existing.Worker_ID;
                if (existing.Worker_Name) inProgressProcess.Worker_Name = existing.Worker_Name;
                return inProgressProcess;
            } else {
                // Processes after target are waiting
                return {
                    Process_Name: processName,
                    Status: 'Na čekanju' as const,
                    Worker_ID: existing.Worker_ID,
                    Worker_Name: existing.Worker_Name
                };
            }
        });

        // OPTIMISTIC UPDATE: Update UI immediately for smooth experience
        setLocalItems(prev => prev.map(i =>
            i.ID === itemId ? { ...i, Processes: newProcesses } : i
        ));

        // Then persist to database (single write!)
        try {
            setIsLoading(itemId);
            await updateAllItemProcesses(workOrder.Work_Order_ID, itemId, newProcesses);
        } catch (error) {
            console.error('Error moving item to stage:', error);
            // Revert optimistic update on error
            setLocalItems(prev => prev.map(i =>
                i.ID === itemId ? { ...i, Processes: item.Processes } : i
            ));
        } finally {
            setIsLoading(null);
            onRefresh?.('workOrders', 'projects'); // Refresh parent data
        }
    };

    // Work order level process editing
    const addWorkOrderProcess = () => {
        if (!newProcessName.trim()) return;
        if (localProcesses.includes(newProcessName.trim())) return;
        setLocalProcesses([...localProcesses, newProcessName.trim()]);
        setNewProcessName('');
    };

    const removeWorkOrderProcess = (process: string) => {
        setLocalProcesses(localProcesses.filter(p => p !== process));
    };

    const saveWorkOrderProcesses = async () => {
        try {
            setIsLoading('processes');
            await onUpdate(workOrder.Work_Order_ID, { Production_Steps: localProcesses });
            setEditingProcesses(false);
            onRefresh?.('workOrders', 'projects'); // CRITICAL: refresh data so UI reflects saved changes
        } catch (error) {
            console.error('Error saving processes:', error);
        } finally {
            setIsLoading(null);
        }
    };

    return (
        <div className="wo-detail-v2">
            {/* === HEADER: DATES === */}
            <div className="header-bar">
                <div className="date-chips">
                    <div className="date-chip">
                        <Calendar size={14} />
                        <span>Kreiran</span>
                        <strong>{formatDate(workOrder.Created_Date)}</strong>
                    </div>
                    <div className="date-chip">
                        <Play size={14} />
                        <span>Početak</span>
                        <strong>{formatDate(workOrder.Started_At)}</strong>
                    </div>
                    <div className="date-chip">
                        <CheckCircle size={14} />
                        <span>Završeno</span>
                        <strong>{formatDate(workOrder.Completed_At)}</strong>
                    </div>
                    <div className="date-chip deadline">
                        <Clock size={14} />
                        <span>Rok</span>
                        <strong>{formatDate(workOrder.Due_Date)}</strong>
                    </div>
                </div>

                {workOrder.Status === 'Na čekanju' && (
                    <button className="btn-action btn-start" onClick={() => onStart(workOrder.Work_Order_ID)}>
                        <Play size={16} /> Pokreni
                    </button>
                )}
            </div>


            {/* === DEFAULT PROCESSES - only visible when editing === */}
            {editingProcesses ? (
                <div className="processes-section">
                    <div className="section-header">
                        <span>🔧 Zadani procesi</span>
                        <button className="btn-save-sm" onClick={saveWorkOrderProcesses} disabled={isLoading === 'processes'}>
                            {isLoading === 'processes' ? '...' : 'Sačuvaj'}
                        </button>
                    </div>
                    <div className="process-chips">
                        {localProcesses.map((process, idx) => (
                            <div key={process} className="process-chip">
                                <span className="chip-num">{idx + 1}</span>
                                {process}
                                <button className="chip-remove" onClick={() => removeWorkOrderProcess(process)}>
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                        <div className="add-chip">
                            <input
                                placeholder="Novi..."
                                value={newProcessName}
                                onChange={(e) => setNewProcessName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addWorkOrderProcess()}
                            />
                            <button onClick={addWorkOrderProcess}><Plus size={14} /></button>
                        </div>
                    </div>
                    <div className="quick-add">
                        {PRODUCTION_STEPS.filter(s => !localProcesses.includes(s)).map(step => (
                            <button key={step} onClick={() => setLocalProcesses([...localProcesses, step])}>
                                + {step}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="edit-processes-bar">
                    <button className="btn-edit-processes" onClick={() => setEditingProcesses(true)}>
                        <Edit2 size={14} /> Uredi procese
                    </button>
                </div>
            )}

            {/* === KANBAN BOARD === */}
            <ProcessKanbanBoard
                items={localItems}
                processes={localProcesses}
                workers={workers}
                onProcessUpdate={handleProcessUpdate}
                onMoveToStage={handleMoveToStage}
                onSubTaskUpdate={async (itemId, subTaskId, updates) => {
                    // OPTIMISTIC UPDATE: Update UI immediately
                    setLocalItems(prev => prev.map(item => {
                        if (item.ID !== itemId) return item;
                        const updatedSubTasks = item.SubTasks?.map(st =>
                            st.SubTask_ID === subTaskId ? { ...st, ...updates } : st
                        );
                        return { ...item, SubTasks: updatedSubTasks };
                    }));

                    // Then persist to database (non-blocking)
                    updateSubTask(workOrder.Work_Order_ID, itemId, subTaskId, updates)
                        .then(() => onRefresh?.('workOrders', 'projects'))
                        .catch(error => {
                            console.error('Error updating sub-task:', error);
                            // Could revert optimistic update here if needed
                        });
                }}
                onSubTaskCreate={async (itemId, subTasks) => {
                    const item = localItems.find(i => i.ID === itemId);
                    if (!item) return;

                    // OPTIMISTIC UPDATE: Update UI immediately
                    const existingSubTasks = item.SubTasks || [];
                    const allSubTasks = [...existingSubTasks, ...subTasks];
                    setLocalItems(prev => prev.map(i =>
                        i.ID === itemId ? { ...i, SubTasks: allSubTasks } : i
                    ));

                    // Then persist to database
                    createSubTasks(workOrder.Work_Order_ID, itemId, allSubTasks)
                        .then(() => onRefresh?.('workOrders', 'projects'))
                        .catch(error => console.error('Error creating sub-task:', error));
                }}
                onSubTaskMove={async (itemId, subTaskId, targetProcess) => {
                    // OPTIMISTIC UPDATE: Update UI immediately
                    const now = new Date().toISOString();
                    setLocalItems(prev => prev.map(item => {
                        if (item.ID !== itemId) return item;
                        const updatedSubTasks = item.SubTasks?.map(st => {
                            if (st.SubTask_ID !== subTaskId) return st;
                            return {
                                ...st,
                                Current_Process: targetProcess,
                                Status: targetProcess === 'ZAVRŠENO' ? 'Završeno' as const : 'U toku' as const,
                                Started_At: st.Started_At || now
                            };
                        });
                        return { ...item, SubTasks: updatedSubTasks };
                    }));

                    // Then persist to database
                    moveSubTask(workOrder.Work_Order_ID, itemId, subTaskId, targetProcess)
                        .then(() => onRefresh?.('workOrders', 'projects'))
                        .catch(error => console.error('Error moving sub-task:', error));
                }}
                onPauseToggle={async (itemId, isPaused) => {
                    // OPTIMISTIC UPDATE: Update UI immediately (before DB call)
                    setLocalItems(prev => prev.map(item =>
                        item.ID === itemId ? { ...item, Is_Paused: isPaused } : item
                    ));

                    // Then persist to database
                    import('@/lib/attendance').then(({ toggleItemPause }) => {
                        toggleItemPause(workOrder.Work_Order_ID, itemId, isPaused)
                            .then(() => onRefresh?.('workOrders', 'projects'))
                            .catch(error => console.error('Error toggling pause:', error));
                    });
                }}
            />

            <style jsx>{`
                .wo-detail-v2 {
                    padding: 16px;
                    background: #f8fafc;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }

                /* Header Bar */
                .header-bar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 12px;
                    padding: 12px 16px;
                    background: white;
                    border-radius: 12px;
                    margin-bottom: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                }

                .date-chips {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                }

                .date-chip {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    color: #64748b;
                }

                .date-chip strong {
                    color: #1e293b;
                    font-weight: 600;
                }

                .date-chip.deadline strong {
                    color: #f59e0b;
                }

                .btn-action {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 14px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    border: none;
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .btn-start {
                    background: linear-gradient(135deg, #3b82f6, #2563eb);
                    color: white;
                }

                /* Edit Processes Bar */
                .edit-processes-bar {
                    margin-bottom: 12px;
                }

                .btn-edit-processes {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 10px 16px;
                    background: white;
                    border: 1px dashed #cbd5e1;
                    border-radius: 10px;
                    font-size: 13px;
                    font-weight: 500;
                    color: #64748b;
                    cursor: pointer;
                    transition: all 0.15s;
                    width: 100%;
                    justify-content: center;
                }

                .btn-edit-processes:hover {
                    background: #f1f5f9;
                    border-color: #94a3b8;
                    color: #475569;
                }

                /* Processes Section */
                .processes-section {
                    background: white;
                    border-radius: 12px;
                    padding: 14px 16px;
                    margin-bottom: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                }

                .section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                    font-weight: 600;
                    font-size: 14px;
                }

                .btn-edit, .btn-save-sm {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    border: none;
                    cursor: pointer;
                }

                .btn-edit { background: #f1f5f9; color: #64748b; }
                .btn-save-sm { background: #3b82f6; color: white; }

                .process-chips {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    align-items: center;
                }

                .process-chip {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    color: white;
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 500;
                }

                .chip-num {
                    width: 18px;
                    height: 18px;
                    background: rgba(255,255,255,0.2);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 11px;
                }

                .chip-remove {
                    background: rgba(255,255,255,0.2);
                    border: none;
                    border-radius: 50%;
                    width: 18px;
                    height: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: white;
                }

                .add-chip {
                    display: flex;
                    gap: 4px;
                }

                .add-chip input {
                    padding: 6px 10px;
                    border: 1px dashed #cbd5e1;
                    border-radius: 8px;
                    font-size: 12px;
                    width: 100px;
                }

                .add-chip button {
                    padding: 6px 10px;
                    background: #f1f5f9;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                }

                .quick-add {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                    margin-top: 10px;
                    padding-top: 10px;
                    border-top: 1px dashed #e2e8f0;
                }

                .quick-add button {
                    padding: 4px 10px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    font-size: 12px;
                    color: #64748b;
                    cursor: pointer;
                }

                /* Responsive */
                @media (max-width: 768px) {
                    .wo-detail-v2 { padding: 10px; }
                    .header-bar { flex-direction: column; align-items: flex-start; }
                }
            `}</style>
        </div>
    );
}
