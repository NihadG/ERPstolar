import { useState, useEffect, useMemo } from 'react';
import { Calendar, Play, CheckCircle, Clock, Edit2, Plus, X, TrendingUp, AlertTriangle } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { checkMissingAttendanceHistory } from '@/lib/attendance';
import type { WorkOrder, Worker, WorkOrderItem, ItemProcessStatus, SubTask, WorkLog } from '@/lib/types';
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
import { getWorkLogsForWorkOrder } from '@/lib/database';

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
    const { organizationId } = useData();

    // S16: Missing Attendance State
    const [missingAttendance, setMissingAttendance] = useState<{ count: number; details: string[] } | null>(null);

    // Workers Timeline State
    const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
    const [showTimeline, setShowTimeline] = useState(false);

    useEffect(() => {
        if (workOrder?.Work_Order_ID && organizationId && workOrder.Started_At) {
            checkMissingAttendanceHistory(workOrder.Work_Order_ID, organizationId)
                .then(result => {
                    if (result.missingDays > 0) {
                        setMissingAttendance({
                            count: result.missingDays,
                            details: result.details.map(d => `${d.workerName} (${d.date})`)
                        });
                    } else {
                        setMissingAttendance(null);
                    }
                })
                .catch(err => console.error('Error checking attendance:', err));
        }
    }, [workOrder?.Work_Order_ID, organizationId, workOrder?.Started_At]);

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

        // #2 Fix: Auto-merge legacy process names from item data
        // If items have process names that don't exist in the column list, add them
        if (workOrder?.items) {
            const columnProcesses = new Set(workOrder?.Production_Steps || PRODUCTION_STEPS);
            const missingProcesses: string[] = [];
            workOrder.items.forEach(item => {
                item.Processes?.forEach(p => {
                    if (p.Process_Name && !columnProcesses.has(p.Process_Name) && !missingProcesses.includes(p.Process_Name)) {
                        missingProcesses.push(p.Process_Name);
                    }
                });
                item.SubTasks?.forEach(st => {
                    if (st.Current_Process && !columnProcesses.has(st.Current_Process) && !missingProcesses.includes(st.Current_Process)) {
                        missingProcesses.push(st.Current_Process);
                    }
                });
            });
            if (missingProcesses.length > 0) {
                setLocalProcesses(prev => [...prev, ...missingProcesses]);
            }
        }
    }, [workOrder]);

    // Fetch work logs for timeline
    useEffect(() => {
        if (workOrder?.Work_Order_ID && organizationId && showTimeline) {
            getWorkLogsForWorkOrder(workOrder.Work_Order_ID, organizationId)
                .then(logs => setWorkLogs(logs))
                .catch(err => console.error('Error fetching work logs:', err));
        }
    }, [workOrder?.Work_Order_ID, organizationId, showTimeline]);

    // Process work logs into timeline data
    const timelineData = useMemo(() => {
        if (workLogs.length === 0) return null;

        // Get unique dates (sorted)
        const dates = Array.from(new Set(workLogs.map(l => l.Date))).sort();
        // Get unique workers
        const workerMap = new Map<string, { name: string; totalCost: number; totalDays: number }>();
        workLogs.forEach(l => {
            const existing = workerMap.get(l.Worker_ID) || { name: l.Worker_Name, totalCost: 0, totalDays: 0 };
            existing.totalCost += l.Daily_Rate;
            existing.totalDays += 1;
            workerMap.set(l.Worker_ID, existing);
        });

        // Build grid: worker -> date -> process entries
        const grid = new Map<string, Map<string, { process: string; rate: number; originalRate?: number; splitFactor?: number }[]>>();
        workLogs.forEach(l => {
            if (!grid.has(l.Worker_ID)) grid.set(l.Worker_ID, new Map());
            const workerGrid = grid.get(l.Worker_ID)!;
            if (!workerGrid.has(l.Date)) workerGrid.set(l.Date, []);
            workerGrid.get(l.Date)!.push({
                process: l.Process_Name || '—',
                rate: l.Daily_Rate,
                originalRate: l.Original_Daily_Rate,
                splitFactor: l.Split_Factor
            });
        });

        const totalLaborCost = Array.from(workerMap.values()).reduce((s, w) => s + w.totalCost, 0);

        return { dates, workerMap, grid, totalLaborCost };
    }, [workLogs]);

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
            {/* S16: Attendance Warning */}
            {missingAttendance && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                    <div>
                        <h4 className="font-medium text-amber-900 text-sm">Nedostaje evidencija rada ({missingAttendance.count} dana)</h4>
                        <p className="text-amber-700 text-xs mt-1">
                            Pronađene su rupe u sihtarici. Profit možda nije tačan.
                            <br />
                            <span className="opacity-75">
                                {missingAttendance.details.slice(0, 3).join(', ')}
                                {missingAttendance.details.length > 3 && ` i još ${missingAttendance.details.length - 3}...`}
                            </span>
                        </p>
                    </div>
                </div>
            )}

            {/* === HEADER: DATES === */}
            <div className="header-bar">
                <div className="date-chips">
                    {workOrder.Work_Order_Type === 'Montaža' && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 12px',
                            background: 'linear-gradient(135deg, rgba(0, 199, 190, 0.15), rgba(0, 199, 190, 0.25))',
                            color: '#00897b',
                            border: '1px solid rgba(0, 199, 190, 0.3)',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: 700,
                        }}>
                            <span className="material-icons-round" style={{ fontSize: '14px' }}>build</span>
                            Montažni Nalog
                        </div>
                    )}
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

            {/* === WORKERS TIMELINE === */}
            <div className="timeline-section">
                <button
                    className="timeline-toggle"
                    onClick={() => setShowTimeline(!showTimeline)}
                >
                    <span className="material-icons-round" style={{ fontSize: '16px' }}>
                        {showTimeline ? 'expand_less' : 'schedule'}
                    </span>
                    <span>Radnici — Timeline</span>
                    {workLogs.length > 0 && (
                        <span className="timeline-badge">{workLogs.length} zapisa</span>
                    )}
                </button>

                {showTimeline && timelineData && timelineData.dates.length > 0 && (
                    <div className="timeline-content">
                        <div className="timeline-summary">
                            <div className="summary-stat">
                                <span className="stat-label">Ukupan trošak rada</span>
                                <span className="stat-value">{timelineData.totalLaborCost.toFixed(2)} KM</span>
                            </div>
                            <div className="summary-stat">
                                <span className="stat-label">Radnika</span>
                                <span className="stat-value">{timelineData.workerMap.size}</span>
                            </div>
                            <div className="summary-stat">
                                <span className="stat-label">Dana</span>
                                <span className="stat-value">{timelineData.dates.length}</span>
                            </div>
                        </div>

                        <div className="timeline-grid-wrapper">
                            <table className="timeline-grid">
                                <thead>
                                    <tr>
                                        <th className="worker-col">Radnik</th>
                                        {timelineData.dates.map(date => {
                                            const d = new Date(date + 'T00:00:00');
                                            const dayName = d.toLocaleDateString('bs-BA', { weekday: 'short' });
                                            const dayNum = d.getDate();
                                            const month = d.getMonth() + 1;
                                            return (
                                                <th key={date} className="date-col">
                                                    <div className="date-header">
                                                        <span className="day-name">{dayName}</span>
                                                        <span className="day-num">{dayNum}.{month}.</span>
                                                    </div>
                                                </th>
                                            );
                                        })}
                                        <th className="total-col">Ukupno</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Array.from(timelineData.workerMap.entries()).map(([workerId, info]) => (
                                        <tr key={workerId}>
                                            <td className="worker-cell">
                                                <span className="worker-name-tl">{info.name}</span>
                                                <span className="worker-days">{info.totalDays} dana</span>
                                            </td>
                                            {timelineData.dates.map(date => {
                                                const entries = timelineData.grid.get(workerId)?.get(date);
                                                return (
                                                    <td key={date} className={`grid-cell ${entries ? 'has-data' : ''}`}>
                                                        {entries ? (
                                                            <div className="cell-content" title={
                                                                entries[0].originalRate && entries[0].splitFactor && entries[0].splitFactor > 1
                                                                    ? `Original: ${entries[0].originalRate} KM ÷ ${entries[0].splitFactor} stavki`
                                                                    : undefined
                                                            }>
                                                                <span className="cell-process">{entries[0].process}</span>
                                                                <span className="cell-rate">
                                                                    {entries.reduce((s, e) => s + e.rate, 0).toFixed(0)}
                                                                    {entries[0].splitFactor && entries[0].splitFactor > 1 && (
                                                                        <span className="split-indicator">
                                                                            ÷{entries[0].splitFactor}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <span className="cell-empty">—</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="total-cell">
                                                <strong>{info.totalCost.toFixed(2)} KM</strong>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {showTimeline && (!timelineData || timelineData.dates.length === 0) && (
                    <div className="timeline-empty">
                        Nema zabilježenih radnih dana. Radnici dobijaju zapise kada se popuni sihtarica.
                    </div>
                )}
            </div>

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

                /* Timeline Section */
                .timeline-section {
                    margin-top: 16px;
                }

                .timeline-toggle {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 12px 16px;
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 600;
                    color: #334155;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .timeline-toggle:hover {
                    background: #f8fafc;
                    border-color: #cbd5e1;
                }

                .timeline-badge {
                    margin-left: auto;
                    padding: 2px 10px;
                    background: #eff6ff;
                    color: #3b82f6;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 600;
                }

                .timeline-content {
                    margin-top: 8px;
                    background: white;
                    border-radius: 12px;
                    border: 1px solid #e2e8f0;
                    overflow: hidden;
                }

                .timeline-summary {
                    display: flex;
                    gap: 24px;
                    padding: 14px 16px;
                    border-bottom: 1px solid #f1f5f9;
                    background: linear-gradient(135deg, #f8fafc, #f1f5f9);
                }

                .summary-stat {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .stat-label {
                    font-size: 11px;
                    color: #94a3b8;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .stat-value {
                    font-size: 16px;
                    font-weight: 700;
                    color: #1e293b;
                }

                .timeline-grid-wrapper {
                    overflow-x: auto;
                    -webkit-overflow-scrolling: touch;
                }

                .timeline-grid {
                    width: 100%;
                    min-width: max-content;
                    border-collapse: collapse;
                    font-size: 12px;
                }

                .timeline-grid th {
                    padding: 8px 6px;
                    text-align: center;
                    font-weight: 600;
                    color: #64748b;
                    border-bottom: 2px solid #e2e8f0;
                    white-space: nowrap;
                    position: sticky;
                    top: 0;
                    background: white;
                }

                .worker-col {
                    text-align: left !important;
                    min-width: 120px;
                    position: sticky;
                    left: 0;
                    z-index: 2;
                    background: white !important;
                }

                .date-col {
                    min-width: 60px;
                }

                .date-header {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 1px;
                }

                .day-name {
                    font-size: 10px;
                    color: #94a3b8;
                    font-weight: 500;
                    text-transform: uppercase;
                }

                .day-num {
                    font-size: 12px;
                    font-weight: 600;
                    color: #475569;
                }

                .total-col {
                    min-width: 90px;
                    text-align: right !important;
                }

                .timeline-grid td {
                    padding: 6px;
                    text-align: center;
                    border-bottom: 1px solid #f1f5f9;
                }

                .worker-cell {
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                    text-align: left !important;
                    position: sticky;
                    left: 0;
                    background: white;
                    z-index: 1;
                    padding-left: 12px !important;
                }

                .worker-name-tl {
                    font-weight: 600;
                    color: #1e293b;
                    font-size: 12px;
                }

                .worker-days {
                    font-size: 10px;
                    color: #94a3b8;
                }

                .grid-cell.has-data {
                    background: rgba(59, 130, 246, 0.04);
                }

                .cell-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 1px;
                }

                .cell-process {
                    font-size: 10px;
                    color: #3b82f6;
                    font-weight: 500;
                    max-width: 60px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .cell-rate {
                    font-size: 10px;
                    color: #64748b;
                }

                .split-indicator {
                    font-size: 8px;
                    color: #f59e0b;
                    font-weight: 600;
                    margin-left: 2px;
                }

                .cell-empty {
                    color: #e2e8f0;
                    font-size: 10px;
                }

                .total-cell {
                    text-align: right !important;
                    padding-right: 12px !important;
                    font-size: 12px;
                    color: #1e293b;
                }

                .timeline-empty {
                    padding: 24px;
                    text-align: center;
                    color: #94a3b8;
                    font-size: 13px;
                    background: white;
                    border-radius: 12px;
                    border: 1px solid #e2e8f0;
                    margin-top: 8px;
                }
            `}</style>
        </div>
    );
}
