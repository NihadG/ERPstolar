'use client';

import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import type { WorkOrder, Worker, WorkOrderItem, WorkerConflict } from '@/lib/types';
import { scheduleWorkOrder, unscheduleWorkOrder, startWorkOrder, checkWorkerConflicts, rescheduleWorkOrder, updateDueDate } from '@/lib/database';
import { useAuth } from '@/context/AuthContext';
import {
    ChevronLeft,
    ChevronRight,
    Calendar,
    X,
    Play,
    Edit2,
    ZoomIn,
    ZoomOut,
    Package,
    User,
    Loader2,
    Box,
    Layers,
    CheckCircle,
    Clock,
    Pause,
    AlertCircle,
    AlertTriangle
} from 'lucide-react';
import './PlannerTab.css';

interface PlannerTabProps {
    workOrders: WorkOrder[];
    workers: Worker[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

// Status-based colors
const STATUS_COLORS = {
    scheduled: '#0071e3',   // Blue - Planned/Scheduled
    inProgress: '#34c759', // Green - In production
    paused: '#ff9500',     // Orange - Paused
    completed: '#86868b'   // Gray - Completed
};

const formatDateKey = (d: Date) => d.toISOString().split('T')[0];

const getMonday = (d: Date) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    return date;
};

const getDateRange = (start: Date, days: number) => {
    const dates: Date[] = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        dates.push(d);
    }
    return dates;
};

// Helper: Check if an item (or its subtasks) has any active (non-paused) work
const isItemActive = (item: WorkOrderItem): boolean => {
    // If item has SubTasks, check SubTask level
    if (item.SubTasks && item.SubTasks.length > 0) {
        // Active if any SubTask is NOT paused AND status is 'U toku'
        return item.SubTasks.some(st => !st.Is_Paused && st.Status === 'U toku');
    }
    // No SubTasks - check item level
    return !item.Is_Paused && item.Status === 'U toku';
};

// Helper: Check if an item (or all its subtasks) is fully paused
const isItemFullyPaused = (item: WorkOrderItem): boolean => {
    // If item has SubTasks, ALL must be paused
    if (item.SubTasks && item.SubTasks.length > 0) {
        return item.SubTasks.every(st => st.Is_Paused === true);
    }
    // No SubTasks - check item level
    return item.Is_Paused === true;
};

// Get status color for work order
const getStatusColor = (wo: WorkOrder): string => {
    const items = wo.items || [];
    if (items.length === 0) {
        // No items - use WO-level status
        if (wo.Status === 'Završeno') return STATUS_COLORS.completed;
        if (wo.Status === 'U toku') return STATUS_COLORS.inProgress;
        return STATUS_COLORS.scheduled;
    }

    // Check if ALL items are fully paused (WO is paused)
    const allPaused = items.every(item => isItemFullyPaused(item));
    // Check if ANY item has active (in-progress, non-paused) work
    const anyActive = items.some(item => isItemActive(item));
    // Check if WO is completed
    const allCompleted = items.every(item => item.Status === 'Završeno');

    if (wo.Status === 'Završeno' || allCompleted) return STATUS_COLORS.completed;
    if (allPaused && wo.Status !== 'Na čekanju') return STATUS_COLORS.paused;
    if (anyActive || wo.Status === 'U toku') return STATUS_COLORS.inProgress;
    return STATUS_COLORS.scheduled;
};

// Get status label
const getStatusLabel = (wo: WorkOrder): { text: string; icon: typeof Clock } => {
    const items = wo.items || [];
    if (items.length === 0) {
        if (wo.Status === 'Završeno') return { text: 'Završeno', icon: CheckCircle };
        if (wo.Status === 'U toku') return { text: 'U toku', icon: Play };
        return { text: 'Zakazano', icon: Clock };
    }

    const allPaused = items.every(item => isItemFullyPaused(item));
    const anyActive = items.some(item => isItemActive(item));
    const allCompleted = items.every(item => item.Status === 'Završeno');

    if (wo.Status === 'Završeno' || allCompleted) return { text: 'Završeno', icon: CheckCircle };
    if (allPaused && wo.Status !== 'Na čekanju') return { text: 'Pauzirano', icon: Pause };
    if (anyActive || wo.Status === 'U toku') return { text: 'U toku', icon: Play };
    return { text: 'Zakazano', icon: Clock };
};

// Get project name from work order
const getProjectName = (wo: WorkOrder): string => {
    if (wo.items && wo.items.length > 0) {
        return wo.items[0].Project_Name || 'Nepoznat projekt';
    }
    return 'Nepoznat projekt';
};

// Get deadline warning status
const getDeadlineWarning = (wo: WorkOrder): 'overdue' | 'approaching' | 'ok' => {
    if (!wo.Due_Date || wo.Status === 'Završeno') return 'ok';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(wo.Due_Date);
    dueDate.setHours(0, 0, 0, 0);

    const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) return 'overdue';
    if (daysUntilDue <= 2) return 'approaching';
    return 'ok';
};

export default function PlannerTab({ workOrders, workers, onRefresh, showToast }: PlannerTabProps) {
    const { organization } = useAuth();
    const orgId = organization?.Organization_ID || '';
    const cellWidth = 65;

    const [viewStart, setViewStart] = useState(() => getMonday(new Date()));
    const [days, setDays] = useState(14);
    const [submitting, setSubmitting] = useState(false);

    // Schedule modal
    const [scheduleModal, setScheduleModal] = useState<{ open: boolean; wo: WorkOrder | null; start: string; end: string }>({
        open: false, wo: null, start: '', end: ''
    });

    // Detail panel
    const [detailPanel, setDetailPanel] = useState<{ open: boolean; wo: WorkOrder | null }>({
        open: false, wo: null
    });

    // Conflict modal - shows when workers have overlapping schedules
    const [conflictModal, setConflictModal] = useState<{
        open: boolean;
        conflicts: WorkerConflict[];
        pendingSchedule: { wo: WorkOrder; start: string; end: string } | null;
    }>({ open: false, conflicts: [], pendingSchedule: null });

    const allWorkers = useMemo(() => workers, [workers]);
    const visibleDates = useMemo(() => getDateRange(viewStart, days), [viewStart, days]);

    const scheduled = useMemo(() =>
        workOrders.filter(wo => wo.Is_Scheduled && wo.Planned_Start_Date),
        [workOrders]
    );

    const backlog = useMemo(() =>
        workOrders.filter(wo => !wo.Is_Scheduled && wo.Status !== 'Završeno' && wo.Status !== 'Otkazano'),
        [workOrders]
    );

    const getWorkerIds = (wo: WorkOrder): string[] => {
        const ids = new Set<string>();
        wo.items?.forEach(item => {
            item.Processes?.forEach(p => {
                if (p.Worker_ID) ids.add(p.Worker_ID);
                p.Helpers?.forEach(h => { if (h.Worker_ID) ids.add(h.Worker_ID); });
            });
        });
        return Array.from(ids);
    };

    const workerOrders = useMemo(() => {
        const map = new Map<string, WorkOrder[]>();
        allWorkers.forEach(w => map.set(w.Worker_ID, []));

        scheduled.forEach(wo => {
            const wids = getWorkerIds(wo);
            if (wids.length > 0) {
                wids.forEach(wid => {
                    if (map.has(wid)) map.get(wid)!.push(wo);
                });
            } else {
                allWorkers.forEach(w => map.get(w.Worker_ID)!.push(wo));
            }
        });

        return map;
    }, [scheduled, allWorkers]);

    const getBarPosition = (wo: WorkOrder): { left: number; width: number } | null => {
        if (!wo.Planned_Start_Date) return null;

        const oStart = new Date(wo.Planned_Start_Date);
        const oEnd = wo.Planned_End_Date ? new Date(wo.Planned_End_Date) : oStart;
        oStart.setHours(0, 0, 0, 0);
        oEnd.setHours(0, 0, 0, 0);

        const vStart = visibleDates[0];
        const vEnd = visibleDates[visibleDates.length - 1];

        if (oEnd < vStart || oStart > vEnd) return null;

        const startDayOffset = Math.max(0, (oStart.getTime() - vStart.getTime()) / 86400000);
        const endDayOffset = Math.min(days, (oEnd.getTime() - vStart.getTime()) / 86400000 + 1);

        const left = startDayOffset * cellWidth;
        const width = (endDayOffset - startDayOffset) * cellWidth;

        if (width <= 0) return null;
        return { left, width };
    };

    // Navigation
    const prev = () => { const d = new Date(viewStart); d.setDate(d.getDate() - 7); setViewStart(d); };
    const next = () => { const d = new Date(viewStart); d.setDate(d.getDate() + 7); setViewStart(d); };
    const goToday = () => setViewStart(getMonday(new Date()));

    // Schedule Modal functions
    const openScheduleModal = (wo: WorkOrder) => {
        const now = new Date();
        const end = new Date(now);
        end.setDate(end.getDate() + 4);
        setScheduleModal({
            open: true,
            wo,
            start: wo.Planned_Start_Date || formatDateKey(now),
            end: wo.Planned_End_Date || formatDateKey(end)
        });
    };

    const closeScheduleModal = () => setScheduleModal({ open: false, wo: null, start: '', end: '' });

    const submitSchedule = async (forceSchedule: boolean = false) => {
        if (!scheduleModal.wo || !orgId || submitting) return;

        // Validate dates: end date must be >= start date
        if (new Date(scheduleModal.end) < new Date(scheduleModal.start)) {
            showToast('Krajnji datum mora biti jednak ili nakon početnog datuma', 'error');
            return;
        }

        setSubmitting(true);
        try {
            // Get worker IDs from the work order
            const workerIds = getWorkerIds(scheduleModal.wo);

            // Check for conflicts (unless force scheduling)
            if (!forceSchedule && workerIds.length > 0) {
                const { hasConflicts, conflicts } = await checkWorkerConflicts(
                    workerIds,
                    scheduleModal.start,
                    scheduleModal.end,
                    scheduleModal.wo.Is_Scheduled ? scheduleModal.wo.Work_Order_ID : null,
                    orgId
                );

                if (hasConflicts) {
                    // Show conflict modal instead of scheduling
                    setConflictModal({
                        open: true,
                        conflicts,
                        pendingSchedule: {
                            wo: scheduleModal.wo,
                            start: scheduleModal.start,
                            end: scheduleModal.end
                        }
                    });
                    setSubmitting(false);
                    return;
                }
            }

            // No conflicts or force schedule - proceed
            const color = getStatusColor(scheduleModal.wo);
            const res = await scheduleWorkOrder(scheduleModal.wo.Work_Order_ID, scheduleModal.start, scheduleModal.end, orgId, color);

            if (res.success) {
                showToast(res.message || 'Nalog zakazan', 'success');
                closeScheduleModal();
                setConflictModal({ open: false, conflicts: [], pendingSchedule: null });
                onRefresh('workOrders');
            } else {
                showToast(res.message, 'error');
            }
        } catch (err) {
            showToast('Greška', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    // Force schedule after confirming conflicts
    const forceScheduleWithConflicts = async () => {
        if (!conflictModal.pendingSchedule) return;

        setScheduleModal({
            open: true,
            wo: conflictModal.pendingSchedule.wo,
            start: conflictModal.pendingSchedule.start,
            end: conflictModal.pendingSchedule.end
        });
        setConflictModal({ open: false, conflicts: [], pendingSchedule: null });

        // Trigger schedule with force flag
        setTimeout(() => submitSchedule(true), 100);
    };

    const closeConflictModal = () => {
        setConflictModal({ open: false, conflicts: [], pendingSchedule: null });
    };

    // Detail Panel functions
    const openDetailPanel = (wo: WorkOrder) => {
        setDetailPanel({ open: true, wo });
    };

    const closeDetailPanel = () => setDetailPanel({ open: false, wo: null });

    // Actions
    const unschedule = async (wo: WorkOrder) => {
        if (!orgId) return;
        const res = await unscheduleWorkOrder(wo.Work_Order_ID, orgId);
        if (res.success) { showToast('Uklonjeno', 'success'); onRefresh('workOrders'); }
        else showToast(res.message, 'error');
    };

    const startOrder = async (wo: WorkOrder) => {
        if (!orgId) return;
        const res = await startWorkOrder(wo.Work_Order_ID, orgId);
        if (res.success) { showToast('Pokrenuto', 'success'); onRefresh('workOrders'); }
        else showToast(res.message, 'error');
    };

    // Drag-and-drop handler for rescheduling work orders
    const onDragEnd = useCallback(async (result: DropResult) => {
        const { draggableId, destination, source } = result;

        // No destination or dropped in same place
        if (!destination) return;

        // Find the work order being dragged
        const draggedOrder = scheduled.find(wo => wo.Work_Order_ID === draggableId);
        if (!draggedOrder || !draggedOrder.Planned_Start_Date) return;

        // Cannot drag orders that are in progress
        if (draggedOrder.Status === 'U toku') {
            showToast('Nalog U toku se ne može premjestiti', 'info');
            return;
        }

        // Calculate the day offset from drag
        const sourceIdx = parseInt(source.droppableId.replace('timeline-', ''));
        const destIdx = parseInt(destination.droppableId.replace('timeline-', ''));
        const dayOffset = destIdx - sourceIdx;

        if (dayOffset === 0) return; // No change

        // Calculate new dates
        const oldStart = new Date(draggedOrder.Planned_Start_Date);
        const oldEnd = draggedOrder.Planned_End_Date ? new Date(draggedOrder.Planned_End_Date) : oldStart;

        const newStart = new Date(oldStart);
        const newEnd = new Date(oldEnd);
        newStart.setDate(newStart.getDate() + dayOffset);
        newEnd.setDate(newEnd.getDate() + dayOffset);

        const newStartStr = newStart.toISOString().split('T')[0];
        const newEndStr = newEnd.toISOString().split('T')[0];

        // Check for conflicts before rescheduling
        const workerIds = getWorkerIds(draggedOrder);
        if (workerIds.length > 0) {
            const { hasConflicts, conflicts } = await checkWorkerConflicts(
                workerIds,
                newStartStr,
                newEndStr,
                draggedOrder.Work_Order_ID,
                orgId
            );

            if (hasConflicts) {
                // Show conflict modal with pending schedule
                setConflictModal({
                    open: true,
                    conflicts,
                    pendingSchedule: {
                        wo: draggedOrder,
                        start: newStartStr,
                        end: newEndStr
                    }
                });
                return;
            }
        }

        // No conflicts - reschedule directly
        const res = await rescheduleWorkOrder(draggedOrder.Work_Order_ID, newStartStr, newEndStr, orgId);
        if (res.success) {
            showToast('Nalog premješten', 'success');
            onRefresh('workOrders');
        } else {
            showToast(res.message, 'error');
        }
    }, [scheduled, orgId, onRefresh, showToast]);

    const isToday = (d: Date) => d.toDateString() === new Date().toDateString();
    const isWeekend = (d: Date) => [0, 6].includes(d.getDay());
    const totalWidth = days * cellWidth;

    // Get all materials from work order items
    const getMaterialsFromOrder = (wo: WorkOrder) => {
        const materials: { name: string; qty: number; unit: string; status: string }[] = [];
        wo.items?.forEach(item => {
            // We'd need products with materials here - for now show placeholder
            // In real implementation, we should fetch materials from product
        });
        return materials;
    };

    return (
        <div className="planner-container">
            {/* Header */}
            <div className="planner-header">
                <div className="planner-title">
                    <Calendar size={20} />
                    <h1>Planer</h1>
                    <div className="status-legend">
                        <span className="legend-item"><span className="dot" style={{ background: STATUS_COLORS.scheduled }}></span> Zakazano</span>
                        <span className="legend-item"><span className="dot" style={{ background: STATUS_COLORS.inProgress }}></span> U toku</span>
                        <span className="legend-item"><span className="dot" style={{ background: STATUS_COLORS.paused }}></span> Pauzirano</span>
                    </div>
                </div>

                <div className="planner-controls">
                    <div className="nav-group">
                        <button className="nav-btn" onClick={prev}><ChevronLeft size={18} /></button>
                        <button className="today-btn" onClick={goToday}>Danas</button>
                        <button className="nav-btn" onClick={next}><ChevronRight size={18} /></button>
                    </div>

                    <span className="date-label">
                        {visibleDates[0]?.toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' })} — {visibleDates[visibleDates.length - 1]?.toLocaleDateString('hr-HR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>

                    <div className="zoom-group">
                        <button onClick={() => setDays(Math.max(7, days - 7))} disabled={days <= 7}><ZoomIn size={16} /></button>
                        <span>{days}d</span>
                        <button onClick={() => setDays(Math.min(28, days + 7))} disabled={days >= 28}><ZoomOut size={16} /></button>
                    </div>
                </div>
            </div>

            {/* Backlog */}
            <div className="planner-backlog">
                <div className="backlog-label">
                    <Package size={16} />
                    <span>Nezakazani ({backlog.length})</span>
                </div>
                <div className="backlog-list">
                    {backlog.length === 0 ? (
                        <span className="backlog-empty">✓ Svi zakazani</span>
                    ) : (
                        backlog.map(wo => (
                            <button key={wo.Work_Order_ID} className="backlog-item" onClick={() => openScheduleModal(wo)}>
                                <strong>{getProjectName(wo)}</strong>
                                <span>{wo.Work_Order_Number}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Gantt Table with Drag-and-Drop */}
            <DragDropContext onDragEnd={onDragEnd}>
                <div className="gantt-table">
                    {/* Date Header */}
                    <div className="gantt-header-row">
                        <div className="gantt-worker-header">Radnici</div>
                        <div className="gantt-dates-header" style={{ width: totalWidth }}>
                            {visibleDates.map(d => (
                                <div
                                    key={formatDateKey(d)}
                                    className={`gantt-date-cell ${isToday(d) ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''}`}
                                    style={{ width: cellWidth }}
                                >
                                    <span className="day-name">{d.toLocaleDateString('hr-HR', { weekday: 'short' })}</span>
                                    <span className="day-num">{d.getDate()}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Worker Rows */}
                    <div className="gantt-body">
                        {allWorkers.length === 0 ? (
                            <div className="gantt-empty">
                                <User size={40} />
                                <p>Nema radnika</p>
                            </div>
                        ) : (
                            allWorkers.map(worker => {
                                const orders = workerOrders.get(worker.Worker_ID) || [];
                                return (
                                    <div key={worker.Worker_ID} className="gantt-row">
                                        <div className="gantt-worker-cell">
                                            <div className={`avatar ${worker.Worker_Type === 'Glavni' ? 'main' : ''}`}>
                                                {worker.Name?.charAt(0) || '?'}
                                            </div>
                                            <div className="worker-info">
                                                <span className="name">{worker.Name}</span>
                                                <span className="type">{worker.Worker_Type}</span>
                                            </div>
                                            {orders.length > 0 && <span className="count">{orders.length}</span>}
                                        </div>

                                        <div className="gantt-timeline" style={{ width: totalWidth }}>
                                            {visibleDates.map(d => (
                                                <div
                                                    key={formatDateKey(d)}
                                                    className={`timeline-cell ${isToday(d) ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''}`}
                                                    style={{ width: cellWidth }}
                                                />
                                            ))}

                                            {orders.map(wo => {
                                                const pos = getBarPosition(wo);
                                                if (!pos) return null;
                                                const color = getStatusColor(wo);
                                                const statusInfo = getStatusLabel(wo);
                                                const StatusIcon = statusInfo.icon;
                                                const deadlineStatus = getDeadlineWarning(wo);

                                                return (
                                                    <div
                                                        key={wo.Work_Order_ID}
                                                        className={`gantt-bar ${deadlineStatus !== 'ok' ? `deadline-${deadlineStatus}` : ''}`}
                                                        style={{
                                                            left: pos.left + 2,
                                                            width: pos.width - 4,
                                                            backgroundColor: color
                                                        }}
                                                        title={`${getProjectName(wo)} (${wo.Work_Order_Number})${deadlineStatus === 'overdue' ? ' ⚠️ ROK PREKORAČEN!' : deadlineStatus === 'approaching' ? ' ⏰ Rok se približava' : ''}`}
                                                        onClick={() => openDetailPanel(wo)}
                                                    >
                                                        <div className="bar-content">
                                                            <span className="bar-project">
                                                                {deadlineStatus === 'overdue' && <AlertTriangle size={10} style={{ marginRight: 3, color: '#fff' }} />}
                                                                {deadlineStatus === 'approaching' && <AlertCircle size={10} style={{ marginRight: 3, color: '#fff' }} />}
                                                                {getProjectName(wo)}
                                                            </span>
                                                            <span className="bar-status">
                                                                <StatusIcon size={10} />
                                                                {statusInfo.text}
                                                            </span>
                                                        </div>
                                                        <div className="bar-actions">
                                                            {wo.Status === 'Na čekanju' && (() => {
                                                                // Only show play button if today >= planned start date
                                                                const today = new Date();
                                                                today.setHours(0, 0, 0, 0);
                                                                const plannedStart = wo.Planned_Start_Date ? new Date(wo.Planned_Start_Date) : today;
                                                                plannedStart.setHours(0, 0, 0, 0);
                                                                const canStart = plannedStart <= today;
                                                                return canStart ? (
                                                                    <button onClick={e => { e.stopPropagation(); startOrder(wo); }} title="Pokreni"><Play size={12} /></button>
                                                                ) : null;
                                                            })()}
                                                            {wo.Status !== 'U toku' && (
                                                                <button onClick={e => { e.stopPropagation(); unschedule(wo); }} title="Ukloni"><X size={12} /></button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </DragDropContext>

            {/* Schedule Modal */}
            {scheduleModal.open && scheduleModal.wo && typeof document !== 'undefined' && createPortal(
                <div className="planner-modal-overlay" onClick={closeScheduleModal}>
                    <div className="planner-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Zakaži nalog</h3>
                            <button className="close-btn" onClick={closeScheduleModal}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="order-info">
                                <span className="project-name">{getProjectName(scheduleModal.wo)}</span>
                                <span className="order-number">{scheduleModal.wo.Work_Order_Number}</span>
                            </div>

                            <div className="workers-section">
                                <label>Radnici:</label>
                                <div className="worker-chips">
                                    {(() => {
                                        const wids = getWorkerIds(scheduleModal.wo);
                                        if (wids.length === 0) return <span className="no-workers">⚠️ Nema dodijeljenih</span>;
                                        return wids.map(wid => {
                                            const w = workers.find(x => x.Worker_ID === wid);
                                            return w ? <span key={wid} className="chip"><User size={12} /> {w.Name}</span> : null;
                                        });
                                    })()}
                                </div>
                            </div>

                            <div className="date-inputs">
                                <div className="date-field">
                                    <label>Od</label>
                                    <input type="date" value={scheduleModal.start} onChange={e => setScheduleModal(p => ({ ...p, start: e.target.value }))} />
                                </div>
                                <div className="date-field">
                                    <label>Do</label>
                                    <input type="date" value={scheduleModal.end} onChange={e => setScheduleModal(p => ({ ...p, end: e.target.value }))} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="cancel-btn" onClick={closeScheduleModal} disabled={submitting}>Odustani</button>
                            <button className="submit-btn" onClick={() => submitSchedule()} disabled={submitting}>
                                {submitting ? <><Loader2 size={16} className="spin" /> Zakazujem...</> : 'Zakaži'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Detail Panel */}
            {detailPanel.open && detailPanel.wo && typeof document !== 'undefined' && createPortal(
                <div className="planner-modal-overlay" onClick={closeDetailPanel}>
                    <div className="planner-modal detail-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="header-info">
                                <h3>{getProjectName(detailPanel.wo)}</h3>
                                <span className="order-num">{detailPanel.wo.Work_Order_Number}</span>
                            </div>
                            <button className="close-btn" onClick={closeDetailPanel}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            {/* Status */}
                            <div className="status-badge" style={{ backgroundColor: getStatusColor(detailPanel.wo) }}>
                                {(() => {
                                    const info = getStatusLabel(detailPanel.wo);
                                    const Icon = info.icon;
                                    return <><Icon size={14} /> {info.text}</>;
                                })()}
                            </div>

                            {/* Dates */}
                            <div className="dates-grid">
                                <div className="date-item">
                                    <span className="date-label">Kreiran</span>
                                    <span className="date-value">{detailPanel.wo.Created_Date?.split('T')[0] || '—'}</span>
                                </div>
                                <div className="date-item">
                                    <span className="date-label">Početak</span>
                                    <span className="date-value">{detailPanel.wo.Started_At?.split('T')[0] || detailPanel.wo.Planned_Start_Date || '—'}</span>
                                </div>
                                <div className="date-item">
                                    <span className="date-label">Završeno</span>
                                    <span className="date-value">{detailPanel.wo.Completed_At?.split('T')[0] || '—'}</span>
                                </div>
                                <div className="date-item editable" style={{ cursor: 'pointer', position: 'relative' }}
                                    onClick={() => {
                                        const input = document.getElementById(`planer-due-date-${detailPanel.wo!.Work_Order_ID}`) as HTMLInputElement;
                                        if (input) input.showPicker();
                                    }}
                                >
                                    <span className="date-label">Rok <Edit2 size={9} style={{ marginLeft: 2, opacity: 0.5 }} /></span>
                                    <span className="date-value deadline">{detailPanel.wo.Due_Date?.split('T')[0] || '—'}</span>
                                    <input
                                        id={`planer-due-date-${detailPanel.wo.Work_Order_ID}`}
                                        type="date"
                                        value={detailPanel.wo.Due_Date?.split('T')[0] || ''}
                                        onChange={async (e) => {
                                            const val = e.target.value;
                                            if (!val || !orgId) return;
                                            const res = await updateDueDate(detailPanel.wo!.Work_Order_ID, val, orgId);
                                            if (res.success) {
                                                showToast('Rok ažuriran', 'success');
                                                closeDetailPanel();
                                                onRefresh('workOrders');
                                            } else {
                                                showToast(res.message, 'error');
                                            }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        style={{ position: 'absolute', bottom: 0, left: 0, width: 0, height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}
                                    />
                                </div>
                            </div>

                            {/* Products */}
                            <div className="detail-section">
                                <h4><Box size={16} /> Proizvodi ({detailPanel.wo.items?.length || 0})</h4>
                                <div className="products-list">
                                    {detailPanel.wo.items?.map((item, idx) => {
                                        const hasSubTasks = item.SubTasks && item.SubTasks.length > 0;

                                        // For items with SubTasks, show SubTask-level detail
                                        if (hasSubTasks) {
                                            return (
                                                <div key={item.ID || idx} className="product-row with-subtasks">
                                                    <div className="product-info">
                                                        <span className="product-name">{item.Product_Name}</span>
                                                        <span className="product-qty">{item.Quantity} kom ({item.SubTasks!.length} grupa)</span>
                                                    </div>
                                                    <div className="subtasks-status">
                                                        {item.SubTasks!.map((st, stIdx) => (
                                                            <div key={stIdx} className={`subtask-chip ${st.Is_Paused ? 'paused' : st.Status === 'U toku' ? 'active' : st.Status === 'Završeno' ? 'done' : 'pending'}`}>
                                                                {st.Is_Paused ? <Pause size={10} /> : st.Status === 'U toku' ? <Play size={10} /> : st.Status === 'Završeno' ? <CheckCircle size={10} /> : <Clock size={10} />}
                                                                <span>{st.Quantity}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        // Regular item without SubTasks
                                        return (
                                            <div key={item.ID || idx} className="product-row">
                                                <div className="product-info">
                                                    <span className="product-name">{item.Product_Name}</span>
                                                    <span className="product-qty">{item.Quantity} kom</span>
                                                </div>
                                                <div className={`product-status ${item.Is_Paused ? 'paused' : item.Status === 'U toku' ? 'active' : item.Status === 'Završeno' ? 'done' : 'pending'}`}>
                                                    {item.Is_Paused ? (
                                                        <><Pause size={12} /> Pauzirano</>
                                                    ) : item.Status === 'Završeno' ? (
                                                        <><CheckCircle size={12} /> Završeno</>
                                                    ) : item.Status === 'U toku' ? (
                                                        <><Play size={12} /> U toku</>
                                                    ) : (
                                                        <><Clock size={12} /> Na čekanju</>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    }) || <p className="empty-msg">Nema proizvoda</p>}
                                </div>
                            </div>

                            {/* Workers */}
                            <div className="detail-section">
                                <h4><User size={16} /> Radnici</h4>
                                <div className="workers-list">
                                    {(() => {
                                        const wids = getWorkerIds(detailPanel.wo);
                                        if (wids.length === 0) return <p className="empty-msg">Nema dodijeljenih radnika</p>;
                                        return wids.map(wid => {
                                            const w = workers.find(x => x.Worker_ID === wid);
                                            if (!w) return null;
                                            return (
                                                <div key={wid} className="worker-row">
                                                    <div className={`avatar small ${w.Worker_Type === 'Glavni' ? 'main' : ''}`}>
                                                        {w.Name?.charAt(0) || '?'}
                                                    </div>
                                                    <span>{w.Name}</span>
                                                    <span className="worker-type-badge">{w.Worker_Type}</span>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>

                            {/* Quick Actions */}
                            <div className="quick-actions">
                                {detailPanel.wo.Status === 'Na čekanju' && (() => {
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    const plannedStart = detailPanel.wo.Planned_Start_Date ? new Date(detailPanel.wo.Planned_Start_Date) : today;
                                    plannedStart.setHours(0, 0, 0, 0);
                                    const canStart = plannedStart <= today;
                                    if (!canStart) {
                                        return (
                                            <p className="cannot-start-msg">⏳ Nalog zakazan za {detailPanel.wo.Planned_Start_Date}</p>
                                        );
                                    }
                                    return (
                                        <button className="action-btn start" onClick={() => { startOrder(detailPanel.wo!); closeDetailPanel(); }}>
                                            <Play size={16} /> Pokreni proizvodnju
                                        </button>
                                    );
                                })()}
                                {detailPanel.wo.Status !== 'U toku' ? (
                                    <button className="action-btn remove" onClick={() => { unschedule(detailPanel.wo!); closeDetailPanel(); }}>
                                        <X size={16} /> Ukloni iz planera
                                    </button>
                                ) : (
                                    <p className="cannot-remove-msg">🔒 Nalog U toku ostaje u planeru</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Conflict Warning Modal */}
            {conflictModal.open && conflictModal.conflicts.length > 0 && typeof document !== 'undefined' && createPortal(
                <div className="planner-modal-overlay" onClick={closeConflictModal}>
                    <div className="planner-modal conflict-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header conflict-header">
                            <div className="conflict-icon">
                                <AlertTriangle size={24} />
                            </div>
                            <div>
                                <h3>Upozorenje: Konflikt rasporeda</h3>
                                <p>Neki radnici već imaju zakazane naloge u ovom periodu</p>
                            </div>
                            <button className="close-btn" onClick={closeConflictModal}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="conflict-list">
                                {conflictModal.conflicts.map((conflict, idx) => (
                                    <div key={idx} className="conflict-item">
                                        <div className="conflict-worker">
                                            <User size={16} />
                                            <strong>{conflict.Worker_Name}</strong>
                                        </div>
                                        <div className="conflict-details">
                                            <span className="conflict-order">
                                                {conflict.Conflicting_Project_Name} ({conflict.Conflicting_Work_Order_Number})
                                            </span>
                                            <span className="conflict-dates">
                                                {conflict.Overlap_Start} — {conflict.Overlap_End}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="conflict-info">
                                <AlertCircle size={14} />
                                <span>Možete ipak zakazati nalog ako je to namjerno (npr. iskorištenje materijala).</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="cancel-btn" onClick={closeConflictModal}>
                                Odustani
                            </button>
                            <button className="submit-btn warning" onClick={forceScheduleWithConflicts}>
                                <AlertTriangle size={14} />
                                Ipak zakaži
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
