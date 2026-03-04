'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Modal from './Modal';
import type { WorkLog, WorkerAttendance, ProductMaterial, WorkOrderItem, Worker } from '@/lib/types';
import {
    Calendar, Clock, Pause, Play, Package, User, Coffee, Sun,
    Stethoscope, Palmtree, AlertCircle, ChevronDown, ChevronUp,
    TrendingUp, TrendingDown, Minus, DollarSign, Edit3, Check, X,
    Plus, Trash2, Save
} from 'lucide-react';

// ============================================
// TYPES
// ============================================

interface ProductTimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    productId: string;
    productName: string;
    workOrderItem?: WorkOrderItem;
    workLogs: WorkLog[];
    attendance?: WorkerAttendance[];
    materials?: ProductMaterial[];
    holidays?: Set<string>;
    // Profit data
    sellingPrice?: number;
    materialCost?: number;
    laborCost?: number;
    profit?: number;
    profitMargin?: number;
    // Detailed cost breakdown
    costBreakdown?: {
        baseMaterial: number;
        led: number;
        grouting: number;
        sinkFaucet: number;
        extras: number;
        transportShare: number;
        discountShare: number;
    };
    // Retroactive editing
    onAttendanceChange?: (workerId: string, workerName: string, date: string, newStatus: string) => Promise<void>;
    // Profit overrides
    workOrderItemId?: string;
    originalSellingPrice?: number;
    originalExtras?: number;
    originalTransport?: number;
    hasOverrides?: boolean;
    onSaveOverrides?: (overrides: {
        Selling_Price?: number;
        Extras_Total?: number;
        Transport_Share?: number;
        Notes?: string;
    }) => Promise<void>;
    // Timeline editing
    onOverrideWorkLogs?: (entries: Array<{
        Worker_ID: string;
        Worker_Name: string;
        Date: string;
        Daily_Rate: number;
        Process_Name?: string;
    }>) => Promise<{ success: boolean; message: string }>;
    workers?: Worker[];
}

type DayType = 'working' | 'paused' | 'weekend' | 'holiday' | 'no_work' | 'future';

interface TimelineEntry {
    type: 'worker' | 'absent_worker' | 'pause_start' | 'pause_end' | 'material_received';
    workerName?: string;
    workerId?: string;
    dailyRate?: number;
    processName?: string;
    attendanceStatus?: string;
    materialName?: string;
}

interface TimelineDay {
    date: string;
    displayDate: string;
    dayOfWeek: number;
    dayType: DayType;
    entries: TimelineEntry[];
    dailyLaborCost: number;
    cumulativeLaborCost: number;
}

// ============================================
// CONSTANTS
// ============================================

const DAY_NAMES = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'];
const ATTENDANCE_OPTIONS = ['Prisutan', 'Teren', 'Odsutan', 'Bolovanje', 'Odmor'] as const;

function getStatusConfig(status: string) {
    switch (status) {
        case 'Prisutan': return { icon: User, color: '#166534', bg: '#dcfce7', label: 'Prisutan' };
        case 'Teren': return { icon: User, color: '#1e40af', bg: '#dbeafe', label: 'Teren' };
        case 'Odsutan': return { icon: X, color: '#991b1b', bg: '#fee2e2', label: 'Odsutan' };
        case 'Bolovanje': return { icon: Stethoscope, color: '#9a3412', bg: '#fed7aa', label: 'Bolovanje' };
        case 'Odmor': return { icon: Palmtree, color: '#92400e', bg: '#fef3c7', label: 'Odmor' };
        case 'Vikend': return { icon: Coffee, color: '#4338ca', bg: '#e0e7ff', label: 'Vikend' };
        default: return { icon: AlertCircle, color: '#6b7280', bg: '#f3f4f6', label: status || 'Nepoznato' };
    }
}

function getDayTypeConfig(type: DayType) {
    switch (type) {
        case 'working': return { bg: '#f0fdf4', border: '#86efac', accent: '#166534' };
        case 'paused': return { bg: '#fff7ed', border: '#fdba74', accent: '#c2410c' };
        case 'weekend': return { bg: '#f5f3ff', border: '#c4b5fd', accent: '#5b21b6' };
        case 'holiday': return { bg: '#fef2f2', border: '#fca5a5', accent: '#991b1b' };
        case 'no_work': return { bg: '#f9fafb', border: '#e5e7eb', accent: '#6b7280' };
        case 'future': return { bg: '#f8fafc', border: '#e2e8f0', accent: '#94a3b8' };
    }
}

// ============================================
// COMPONENT
// ============================================

export default function ProductTimelineModal({
    isOpen,
    onClose,
    productName,
    workOrderItem,
    workLogs,
    attendance = [],
    materials = [],
    holidays = new Set(),
    sellingPrice,
    materialCost,
    laborCost,
    profit,
    profitMargin,
    costBreakdown,
    onAttendanceChange,
    workOrderItemId,
    originalSellingPrice,
    originalExtras,
    originalTransport,
    hasOverrides,
    onSaveOverrides,
    onOverrideWorkLogs,
    workers = []
}: ProductTimelineModalProps) {
    const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
    const [editingEntry, setEditingEntry] = useState<{ date: string; workerId: string } | null>(null);
    const [editLoading, setEditLoading] = useState(false);

    // === PROFIT OVERRIDE EDITING STATE ===
    const [isEditingProfit, setIsEditingProfit] = useState(false);
    const [editSellingPrice, setEditSellingPrice] = useState<number>(0);
    const [editExtras, setEditExtras] = useState<number>(0);
    const [editTransport, setEditTransport] = useState<number>(0);
    const [editNotes, setEditNotes] = useState<string>('');
    const [savingOverrides, setSavingOverrides] = useState(false);

    // === TIMELINE EDITING STATE ===
    interface EditedLogEntry {
        id: string;
        Worker_ID: string;
        Worker_Name: string;
        Date: string;
        Daily_Rate: number;
        Process_Name?: string;
    }
    const [isEditingTimeline, setIsEditingTimeline] = useState(false);
    const [editedLogs, setEditedLogs] = useState<EditedLogEntry[]>([]);
    const [savingTimeline, setSavingTimeline] = useState(false);
    const [addingWorkerDay, setAddingWorkerDay] = useState<string | null>(null);
    const [newDayDate, setNewDayDate] = useState('');
    const [extraDates, setExtraDates] = useState<Set<string>>(new Set());

    const startTimelineEdit = () => {
        // Clone work logs into editable state
        const logs: EditedLogEntry[] = workLogs.map((wl, i) => ({
            id: `log-${i}`,
            Worker_ID: wl.Worker_ID,
            Worker_Name: wl.Worker_Name,
            Date: wl.Date,
            Daily_Rate: wl.Daily_Rate || 0,
            Process_Name: wl.Process_Name
        }));
        setEditedLogs(logs);
        setIsEditingTimeline(true);
        // Expand all days for editing
        const allDates = new Set(logs.map(l => l.Date));
        setExpandedDays(allDates);
    };

    const cancelTimelineEdit = () => {
        setIsEditingTimeline(false);
        setEditedLogs([]);
        setAddingWorkerDay(null);
        setNewDayDate('');
        setExtraDates(new Set());
    };

    const handleSaveTimeline = async () => {
        if (!onOverrideWorkLogs) return;
        setSavingTimeline(true);
        try {
            const result = await onOverrideWorkLogs(editedLogs.map(l => ({
                Worker_ID: l.Worker_ID,
                Worker_Name: l.Worker_Name,
                Date: l.Date,
                Daily_Rate: l.Daily_Rate,
                Process_Name: l.Process_Name
            })));
            if (result.success) {
                setIsEditingTimeline(false);
                setEditedLogs([]);
            }
        } catch (err) {
            console.error('Error saving timeline:', err);
        } finally {
            setSavingTimeline(false);
        }
    };

    const updateLogRate = (logId: string, newRate: number) => {
        setEditedLogs(prev => prev.map(l => l.id === logId ? { ...l, Daily_Rate: newRate } : l));
    };

    const removeLog = (logId: string) => {
        setEditedLogs(prev => prev.filter(l => l.id !== logId));
    };

    const addWorkerToDay = (date: string, worker: Worker) => {
        const newLog: EditedLogEntry = {
            id: `new-${Date.now()}-${Math.random()}`,
            Worker_ID: worker.Worker_ID,
            Worker_Name: worker.Name,
            Date: date,
            Daily_Rate: worker.Daily_Rate || 0,
        };
        setEditedLogs(prev => [...prev, newLog]);
        setAddingWorkerDay(null);
    };

    // Auto-enter editing mode when timeline is empty and manual editing is available
    // This makes the "add day" UI immediately accessible instead of requiring a separate click
    useEffect(() => {
        if (isOpen && workLogs.length === 0 && onOverrideWorkLogs && !isEditingTimeline) {
            startTimelineEdit();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, workLogs.length]);

    const removeDay = (date: string) => {
        setEditedLogs(prev => prev.filter(l => l.Date !== date));
    };

    // Group edited logs by date for the editing view
    const editedLogsByDate = useMemo(() => {
        const map = new Map<string, EditedLogEntry[]>();
        editedLogs.forEach(l => {
            const existing = map.get(l.Date) || [];
            existing.push(l);
            map.set(l.Date, existing);
        });
        return map;
    }, [editedLogs]);

    const editedTotalCost = useMemo(() => {
        return editedLogs.reduce((sum, l) => sum + l.Daily_Rate, 0);
    }, [editedLogs]);

    // Initialize edit fields when modal opens or override state changes
    const startEditing = () => {
        setEditSellingPrice(sellingPrice || originalSellingPrice || 0);
        setEditExtras(originalExtras || 0);
        setEditTransport(originalTransport || 0);
        setEditNotes('');
        setIsEditingProfit(true);
    };

    const cancelEditing = () => {
        setIsEditingProfit(false);
    };

    const handleSaveOverrides = async () => {
        if (!onSaveOverrides) return;
        setSavingOverrides(true);
        try {
            await onSaveOverrides({
                Selling_Price: editSellingPrice,
                Extras_Total: editExtras,
                Transport_Share: editTransport,
                Notes: editNotes || undefined,
            });
            setIsEditingProfit(false);
        } catch (err) {
            console.error('Error saving overrides:', err);
        } finally {
            setSavingOverrides(false);
        }
    };

    // Build worker IDs set from assigned workers + work logs
    const assignedWorkerIds = useMemo(() => {
        const ids = new Set<string>();
        workOrderItem?.Assigned_Workers?.forEach(w => ids.add(w.Worker_ID));
        workOrderItem?.SubTasks?.forEach(st => {
            if (st.Worker_ID) ids.add(st.Worker_ID);
            st.Helpers?.forEach(h => ids.add(h.Worker_ID));
        });
        workLogs.forEach(wl => ids.add(wl.Worker_ID));
        return ids;
    }, [workOrderItem, workLogs]);

    // Build attendance lookup map: Worker_ID + Date -> status
    const attendanceMap = useMemo(() => {
        const map = new Map<string, WorkerAttendance>();
        attendance.forEach(a => {
            if (assignedWorkerIds.has(a.Worker_ID)) {
                map.set(`${a.Worker_ID}_${a.Date}`, a);
            }
        });
        return map;
    }, [attendance, assignedWorkerIds]);

    // Build work logs lookup map: Date -> WorkLog[]
    const workLogsByDate = useMemo(() => {
        const map = new Map<string, WorkLog[]>();
        workLogs.forEach(wl => {
            const existing = map.get(wl.Date) || [];
            existing.push(wl);
            map.set(wl.Date, existing);
        });
        return map;
    }, [workLogs]);

    // Build material received events (from status, not a date field)
    const materialEvents = useMemo(() => {
        const map = new Map<string, string[]>();
        // Materials don't have a Received_Date — we can only show materials
        // that have reached 'Primljeno' status. No date-specific event available.
        return map;
    }, [materials]);

    // Gather pause periods from item-level AND subtasks
    const pausePeriods = useMemo(() => {
        const periods: Array<{ Started_At: string; Ended_At?: string }> = [];
        // Item-level pause periods (tracked by toggleItemPause)
        if (workOrderItem?.Pause_Periods) {
            periods.push(...workOrderItem.Pause_Periods);
        }
        // SubTask-level pause periods
        workOrderItem?.SubTasks?.forEach(st => {
            if (st.Pause_Periods) {
                periods.push(...st.Pause_Periods);
            }
        });
        return periods;
    }, [workOrderItem]);

    // Check if a date falls within any pause period
    const isPausedOnDate = useCallback((dateStr: string) => {
        return pausePeriods.some(p => {
            const start = p.Started_At.split('T')[0];
            const end = p.Ended_At ? p.Ended_At.split('T')[0] : new Date().toISOString().split('T')[0];
            return dateStr >= start && dateStr <= end;
        });
    }, [pausePeriods]);

    // Build the full timeline — ALL days from Started_At to today/Completed_At
    const timeline = useMemo((): TimelineDay[] => {
        // Start from item Started_At, then WO Created_Date, then earliest work log
        // NEVER use a date before the WO was created
        const woCreatedDate = (workOrderItem as any)?.Created_Date
            ? new Date((workOrderItem as any).Created_Date)
            : null;

        let startDate: Date | null = workOrderItem?.Started_At
            ? new Date(workOrderItem.Started_At)
            : woCreatedDate;

        // If still no start date, use earliest work log — but clamp to WO creation
        if (!startDate && workLogs.length > 0) {
            const earliest = new Date([...workLogs].sort((a, b) => a.Date.localeCompare(b.Date))[0].Date);
            startDate = woCreatedDate && woCreatedDate > earliest ? woCreatedDate : earliest;
        }

        if (!startDate) return [];

        const endDate = workOrderItem?.Completed_At
            ? new Date(workOrderItem.Completed_At)
            : new Date();

        // Extend range to include any extra dates added during editing
        if (extraDates.size > 0 && startDate) {
            extraDates.forEach(d => {
                const extraDate = new Date(d + 'T12:00:00');
                if (extraDate < startDate!) startDate = new Date(extraDate);
                if (extraDate > endDate) endDate.setTime(extraDate.getTime());
            });
        }

        const days: TimelineDay[] = [];
        let cumulativeCost = 0;
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        while (current <= endDate) {
            // Use local time for dateStr to avoid UTC timezone shift (midnight CET = 23:00 UTC prev day)
            const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
            const dow = current.getDay();
            const isWeekend = dow === 0 || dow === 6;
            const isHoliday = holidays.has(dateStr);
            const isPaused = isPausedOnDate(dateStr);
            const isFuture = current > today;
            const dayLogs = workLogsByDate.get(dateStr) || [];

            // Determine day type
            let dayType: DayType;
            if (isFuture) dayType = 'future';
            else if (isPaused) dayType = 'paused';
            else if (isHoliday) dayType = 'holiday';
            else if (isWeekend) dayType = 'weekend';
            else if (dayLogs.length > 0) dayType = 'working';
            else dayType = 'no_work';

            // Build entries for this day
            const entries: TimelineEntry[] = [];

            // Worker entries from work logs
            dayLogs.forEach(wl => {
                entries.push({
                    type: 'worker',
                    workerName: wl.Worker_Name,
                    workerId: wl.Worker_ID,
                    dailyRate: wl.Daily_Rate,
                    processName: wl.Process_Name
                });
            });

            // Check absent assigned workers (only on working days, non-paused)
            if (!isWeekend && !isHoliday && !isPaused && !isFuture) {
                const workedWorkerIds = new Set(dayLogs.map(wl => wl.Worker_ID));
                assignedWorkerIds.forEach(workerId => {
                    if (!workedWorkerIds.has(workerId)) {
                        const att = attendanceMap.get(`${workerId}_${dateStr}`);
                        const workerName = att?.Worker_Name ||
                            workOrderItem?.Assigned_Workers?.find(w => w.Worker_ID === workerId)?.Worker_Name ||
                            workLogs.find(wl => wl.Worker_ID === workerId)?.Worker_Name ||
                            'Radnik';
                        entries.push({
                            type: 'absent_worker',
                            workerName,
                            workerId,
                            attendanceStatus: att?.Status || 'Nepoznato'
                        });
                    }
                });
            }

            // Pause markers
            pausePeriods.forEach(p => {
                const pStart = p.Started_At.split('T')[0];
                const pEnd = p.Ended_At?.split('T')[0];
                if (pStart === dateStr) {
                    entries.push({ type: 'pause_start' });
                }
                if (pEnd === dateStr) {
                    entries.push({ type: 'pause_end' });
                }
            });

            // Material received events
            const matEvents = materialEvents.get(dateStr);
            if (matEvents) {
                matEvents.forEach(name => {
                    entries.push({ type: 'material_received', materialName: name });
                });
            }

            const dailyLaborCost = dayLogs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);
            cumulativeCost += dailyLaborCost;

            days.push({
                date: dateStr,
                displayDate: new Date(dateStr + 'T12:00:00').toLocaleDateString('hr-HR', {
                    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
                }),
                dayOfWeek: dow,
                dayType,
                entries,
                dailyLaborCost,
                cumulativeLaborCost: cumulativeCost
            });

            current.setDate(current.getDate() + 1);
        }

        return days;
    }, [workOrderItem, workLogs, workLogsByDate, holidays, isPausedOnDate, assignedWorkerIds, attendanceMap, pausePeriods, materialEvents, extraDates]);

    // Summary stats
    const stats = useMemo(() => {
        const workingDays = timeline.filter(d => d.entries.some(e => e.type === 'worker')).length;
        const pausedDays = timeline.filter(d => d.dayType === 'paused').length;
        const totalDays = timeline.filter(d => d.dayType !== 'future').length;
        const totalLaborCost = timeline.reduce((sum, d) => sum + d.dailyLaborCost, 0);
        return { workingDays, pausedDays, totalDays, totalLaborCost };
    }, [timeline]);

    // Handlers
    const toggleDay = (date: string) => {
        setExpandedDays(prev => {
            const next = new Set(prev);
            if (next.has(date)) next.delete(date);
            else next.add(date);
            return next;
        });
    };

    const handleAttendanceEdit = async (workerId: string, workerName: string, date: string, newStatus: string) => {
        if (!onAttendanceChange) return;
        setEditLoading(true);
        try {
            await onAttendanceChange(workerId, workerName, date, newStatus);
            setEditingEntry(null);
        } catch (err) {
            console.error('Error updating attendance:', err);
        } finally {
            setEditLoading(false);
        }
    };

    const expandAll = () => setExpandedDays(new Set(timeline.map(d => d.date)));
    const collapseAll = () => setExpandedDays(new Set());

    const getProfitColor = (margin: number) => {
        if (margin >= 30) return '#10b981';
        if (margin >= 15) return '#f59e0b';
        return '#ef4444';
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Calendar size={22} style={{ color: '#3b82f6' }} />
                    <div>
                        <div style={{ fontSize: '16px', fontWeight: 700 }}>{productName}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 400 }}>
                            Kompletni Timeline Proizvoda
                        </div>
                    </div>
                </div>
            }
            size="large"
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* ====== PROFIT SUMMARY ====== */}
                {sellingPrice != null && sellingPrice > 0 && (
                    <div style={{
                        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                        borderRadius: '16px', padding: '18px', border: '1px solid #e2e8f0'
                    }}>
                        {/* Override indicator */}
                        {hasOverrides && !isEditingProfit && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                marginBottom: '12px', padding: '6px 12px',
                                background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px',
                                fontSize: '12px', color: '#6366f1', fontWeight: 500
                            }}>
                                <span className="material-icons-round" style={{ fontSize: '14px' }}>tune</span>
                                Prilagođene vrijednosti — razlikuju se od originalne ponude
                            </div>
                        )}

                        {/* Edit button */}
                        {workOrderItemId && onSaveOverrides && !isEditingProfit && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                                <button
                                    onClick={startEditing}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                        padding: '6px 14px', borderRadius: '8px',
                                        border: '1px solid #e2e8f0', background: 'white',
                                        cursor: 'pointer', fontSize: '12px', color: '#6366f1',
                                        fontWeight: 500, transition: 'all 0.15s'
                                    }}
                                >
                                    <Edit3 size={13} />
                                    Prilagodi profit
                                </button>
                            </div>
                        )}

                        {/* === EDITING MODE === */}
                        {isEditingProfit ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <div style={{
                                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px'
                                }}>
                                    {/* Selling Price */}
                                    <div style={{
                                        padding: '14px', background: 'white', borderRadius: '12px',
                                        border: '2px solid #6366f1'
                                    }}>
                                        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <DollarSign size={13} /> Prodajna cijena
                                        </div>
                                        <input
                                            type="number"
                                            value={editSellingPrice}
                                            onChange={(e) => setEditSellingPrice(parseFloat(e.target.value) || 0)}
                                            style={{
                                                width: '100%', padding: '8px 10px', borderRadius: '8px',
                                                border: '1px solid #e2e8f0', fontSize: '15px', fontWeight: 700,
                                                color: '#0f172a', outline: 'none'
                                            }}
                                        />
                                        {originalSellingPrice && originalSellingPrice !== editSellingPrice && (
                                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                                                Ponuda: {originalSellingPrice.toLocaleString('hr-HR')} KM
                                            </div>
                                        )}
                                    </div>

                                    {/* Extras */}
                                    <div style={{
                                        padding: '14px', background: 'white', borderRadius: '12px',
                                        border: '2px solid #f59e0b'
                                    }}>
                                        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Package size={13} /> Dodaci / Usluge
                                        </div>
                                        <input
                                            type="number"
                                            value={editExtras}
                                            onChange={(e) => setEditExtras(parseFloat(e.target.value) || 0)}
                                            style={{
                                                width: '100%', padding: '8px 10px', borderRadius: '8px',
                                                border: '1px solid #e2e8f0', fontSize: '15px', fontWeight: 700,
                                                color: '#0f172a', outline: 'none'
                                            }}
                                        />
                                        {originalExtras != null && originalExtras !== editExtras && (
                                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                                                Ponuda: {originalExtras.toLocaleString('hr-HR')} KM
                                            </div>
                                        )}
                                    </div>

                                    {/* Transport */}
                                    <div style={{
                                        padding: '14px', background: 'white', borderRadius: '12px',
                                        border: '2px solid #10b981'
                                    }}>
                                        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Package size={13} /> Transport
                                        </div>
                                        <input
                                            type="number"
                                            value={editTransport}
                                            onChange={(e) => setEditTransport(parseFloat(e.target.value) || 0)}
                                            style={{
                                                width: '100%', padding: '8px 10px', borderRadius: '8px',
                                                border: '1px solid #e2e8f0', fontSize: '15px', fontWeight: 700,
                                                color: '#0f172a', outline: 'none'
                                            }}
                                        />
                                        {originalTransport != null && originalTransport !== editTransport && (
                                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                                                Ponuda: {originalTransport.toLocaleString('hr-HR')} KM
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Notes */}
                                <div style={{
                                    padding: '14px', background: 'white', borderRadius: '12px',
                                    border: '1px solid #e2e8f0'
                                }}>
                                    <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
                                        Napomena (opciono)
                                    </div>
                                    <input
                                        type="text"
                                        value={editNotes}
                                        onChange={(e) => setEditNotes(e.target.value)}
                                        placeholder="Razlog prilagodbe..."
                                        style={{
                                            width: '100%', padding: '8px 10px', borderRadius: '8px',
                                            border: '1px solid #e2e8f0', fontSize: '13px',
                                            color: '#0f172a', outline: 'none'
                                        }}
                                    />
                                </div>

                                {/* Live Preview + Save/Cancel */}
                                {(() => {
                                    const previewProfit = editSellingPrice - (materialCost || 0) - editExtras - editTransport - (laborCost ?? stats.totalLaborCost);
                                    const previewMargin = editSellingPrice > 0 ? (previewProfit / editSellingPrice) * 100 : 0;
                                    return (
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                padding: '8px 14px', borderRadius: '10px',
                                                background: previewMargin >= 15 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'
                                            }}>
                                                {previewMargin >= 15 ? <TrendingUp size={16} style={{ color: '#10b981' }} /> : <TrendingDown size={16} style={{ color: '#ef4444' }} />}
                                                <span style={{
                                                    fontSize: '14px', fontWeight: 700,
                                                    color: previewMargin >= 15 ? '#10b981' : '#ef4444'
                                                }}>
                                                    Procjena: {previewProfit.toLocaleString('hr-HR')} KM ({previewMargin.toFixed(1)}%)
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    onClick={cancelEditing}
                                                    disabled={savingOverrides}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                        padding: '8px 16px', borderRadius: '8px',
                                                        border: '1px solid #e2e8f0', background: 'white',
                                                        cursor: 'pointer', fontSize: '13px', color: '#64748b', fontWeight: 500
                                                    }}
                                                >
                                                    <X size={14} /> Odustani
                                                </button>
                                                <button
                                                    onClick={handleSaveOverrides}
                                                    disabled={savingOverrides}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                        padding: '8px 16px', borderRadius: '8px',
                                                        border: 'none', background: '#6366f1',
                                                        cursor: savingOverrides ? 'wait' : 'pointer',
                                                        fontSize: '13px', color: 'white', fontWeight: 600,
                                                        opacity: savingOverrides ? 0.7 : 1
                                                    }}
                                                >
                                                    <Check size={14} /> {savingOverrides ? 'Spremam...' : 'Sačuvaj'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        ) : (
                            /* === DISPLAY MODE (existing cards) === */
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                                {(() => {
                                    const displayLaborCost = stats.totalLaborCost;
                                    const transportShareVal = costBreakdown?.transportShare || workOrderItem?.Transport_Share || 0;
                                    const servicesTotalVal = (workOrderItem as any)?.Services_Total || 0;
                                    const displayProfit = profit ?? (sellingPrice - (materialCost || 0) - displayLaborCost - transportShareVal - servicesTotalVal);
                                    const displayMargin = profitMargin ?? (sellingPrice > 0 ? (displayProfit / sellingPrice) * 100 : 0);
                                    return [
                                        { label: 'Prodajna', value: sellingPrice, icon: DollarSign, color: '#0f172a' },
                                        { label: 'Materijal', value: materialCost || 0, icon: Package, color: '#dc2626' },
                                        { label: 'Rad', value: displayLaborCost, icon: User, color: '#ea580c' },
                                        { label: 'Profit', value: displayProfit, icon: displayMargin >= 15 ? TrendingUp : TrendingDown, color: getProfitColor(displayMargin) }
                                    ];
                                })().map((item, i) => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', gap: '10px',
                                        padding: '12px', background: 'white', borderRadius: '12px',
                                        border: `1px solid ${i === 3 ? item.color + '40' : '#e5e7eb'}`
                                    }}>
                                        <item.icon size={20} style={{ color: item.color, flexShrink: 0 }} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: '11px', color: '#6b7280' }}>{item.label}</div>
                                            <div style={{ fontSize: '15px', fontWeight: 700, color: item.color }}>
                                                {item.value.toLocaleString('hr-HR')} KM
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ====== STATS BAR ====== */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {[
                        { label: 'Radni dani', value: stats.workingDays, bg: '#dcfce7', color: '#166534' },
                        { label: 'Pauzirani', value: stats.pausedDays, bg: '#fff7ed', color: '#c2410c' },
                        { label: 'Ukupno dana', value: stats.totalDays, bg: '#f0f9ff', color: '#0369a1' },
                        { label: 'Trošak rada', value: `${stats.totalLaborCost.toLocaleString('hr-HR')} KM`, bg: '#fef3c7', color: '#92400e' }
                    ].map((s, i) => (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px 14px', background: s.bg, borderRadius: '10px',
                            fontSize: '13px', fontWeight: 600, color: s.color
                        }}>
                            <span style={{ fontSize: '16px', fontWeight: 700 }}>{s.value}</span>
                            {s.label}
                        </div>
                    ))}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                        {onOverrideWorkLogs && !isEditingTimeline && (
                            <button onClick={startTimelineEdit} style={{
                                padding: '6px 12px', borderRadius: '8px', border: '1px solid #6366f1',
                                background: 'rgba(99,102,241,0.1)', cursor: 'pointer', fontSize: '12px',
                                color: '#6366f1', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px'
                            }}>
                                <Edit3 size={13} /> Uredi Timeline
                            </button>
                        )}
                        {isEditingTimeline && (
                            <>
                                <span style={{ fontSize: '12px', color: '#6366f1', fontWeight: 600, padding: '6px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    Ukupno: {editedTotalCost.toLocaleString('hr-HR')} KM
                                </span>
                                <button onClick={cancelTimelineEdit} disabled={savingTimeline} style={{
                                    padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0',
                                    background: 'white', cursor: 'pointer', fontSize: '12px', color: '#64748b',
                                    display: 'flex', alignItems: 'center', gap: '4px'
                                }}>
                                    <X size={13} /> Odustani
                                </button>
                                <button onClick={handleSaveTimeline} disabled={savingTimeline} style={{
                                    padding: '6px 12px', borderRadius: '8px', border: 'none',
                                    background: '#6366f1', cursor: savingTimeline ? 'wait' : 'pointer',
                                    fontSize: '12px', color: 'white', fontWeight: 600,
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    opacity: savingTimeline ? 0.7 : 1
                                }}>
                                    <Save size={13} /> {savingTimeline ? 'Spremam...' : 'Sačuvaj'}
                                </button>
                            </>
                        )}
                        {!isEditingTimeline && (
                            <>
                                <button onClick={expandAll} style={{
                                    padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0',
                                    background: 'white', cursor: 'pointer', fontSize: '12px', color: '#64748b'
                                }}>
                                    <ChevronDown size={14} style={{ verticalAlign: 'middle' }} /> Sve
                                </button>
                                <button onClick={collapseAll} style={{
                                    padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0',
                                    background: 'white', cursor: 'pointer', fontSize: '12px', color: '#64748b'
                                }}>
                                    <ChevronUp size={14} style={{ verticalAlign: 'middle' }} /> Skupi
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* ====== LEGEND ====== */}
                <div style={{
                    display: 'flex', gap: '16px', flexWrap: 'wrap',
                    padding: '10px 14px', background: '#f9fafb', borderRadius: '10px',
                    fontSize: '12px', color: '#64748b'
                }}>
                    {[
                        { type: 'working' as DayType, label: 'Radni dan' },
                        { type: 'paused' as DayType, label: 'Pauziran' },
                        { type: 'weekend' as DayType, label: 'Vikend' },
                        { type: 'holiday' as DayType, label: 'Praznik' },
                        { type: 'no_work' as DayType, label: 'Bez rada' }
                    ].map(l => {
                        const cfg = getDayTypeConfig(l.type);
                        return (
                            <div key={l.type} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{
                                    width: '12px', height: '12px', borderRadius: '4px',
                                    background: cfg.bg, border: `2px solid ${cfg.border}`
                                }} />
                                {l.label}
                            </div>
                        );
                    })}
                </div>

                {/* ====== TIMELINE DAYS ====== */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {timeline.length === 0 ? (
                        <div style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            padding: '48px', background: '#f9fafb', borderRadius: '12px', color: '#9ca3af'
                        }}>
                            <Clock size={48} style={{ marginBottom: '8px' }} />
                            <p style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Nema zabilježenog rada na ovom proizvodu</p>
                            <p style={{ margin: '8px 0 0', fontSize: '13px', textAlign: 'center', lineHeight: '1.5' }}>
                                {onOverrideWorkLogs
                                    ? 'Koristite "Dodaj novi dan" ispod da ručno unesete radne dane, ili evidentirajte prisustvo u Sihtarici.'
                                    : 'Evidentirajte prisustvo radnika u Sihtarici da bi se radni dani automatski zabilježili.'}
                            </p>
                        </div>
                    ) : (
                        timeline.map(day => {
                            const cfg = getDayTypeConfig(day.dayType);
                            const isExpanded = expandedDays.has(day.date);
                            const hasEntries = day.entries.length > 0;
                            const isToday = day.date === new Date().toISOString().split('T')[0];

                            return (
                                <div key={day.date} style={{
                                    borderRadius: '10px',
                                    border: `1.5px solid ${isToday ? '#3b82f6' : cfg.border}`,
                                    overflow: 'hidden',
                                    background: cfg.bg,
                                    opacity: day.dayType === 'future' ? 0.5 : 1,
                                    transition: 'all 0.15s'
                                }}>
                                    {/* Day Header — always visible */}
                                    <div
                                        onClick={() => (hasEntries || isEditingTimeline) && toggleDay(day.date)}
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '10px 14px',
                                            cursor: (hasEntries || isEditingTimeline) ? 'pointer' : 'default',
                                            gap: '12px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                                            {/* Day type icon */}
                                            <div style={{
                                                width: '30px', height: '30px', borderRadius: '8px',
                                                background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                border: `1px solid ${cfg.border}`, flexShrink: 0
                                            }}>
                                                {day.dayType === 'working' && <User size={16} style={{ color: cfg.accent }} />}
                                                {day.dayType === 'paused' && <Pause size={16} style={{ color: cfg.accent }} />}
                                                {day.dayType === 'weekend' && <Coffee size={16} style={{ color: cfg.accent }} />}
                                                {day.dayType === 'holiday' && <Sun size={16} style={{ color: cfg.accent }} />}
                                                {day.dayType === 'no_work' && <Minus size={16} style={{ color: cfg.accent }} />}
                                                {day.dayType === 'future' && <Clock size={16} style={{ color: cfg.accent }} />}
                                            </div>

                                            {/* Date */}
                                            <div>
                                                <div style={{
                                                    fontSize: '13px', fontWeight: isToday ? 700 : 600,
                                                    color: isToday ? '#1d4ed8' : '#0f172a'
                                                }}>
                                                    {day.displayDate}
                                                    {isToday && <span style={{
                                                        marginLeft: '8px', fontSize: '10px', padding: '2px 6px',
                                                        background: '#3b82f6', color: 'white', borderRadius: '4px', fontWeight: 600
                                                    }}>DANAS</span>}
                                                </div>
                                                {/* Quick summary */}
                                                <div style={{ fontSize: '11px', color: cfg.accent, marginTop: '1px' }}>
                                                    {day.dayType === 'working' && `${day.entries.filter(e => e.type === 'worker').length} radnik(a)`}
                                                    {day.dayType === 'paused' && 'Proizvod pauziran'}
                                                    {day.dayType === 'weekend' && 'Vikend'}
                                                    {day.dayType === 'holiday' && 'Praznik'}
                                                    {day.dayType === 'no_work' && 'Bez rada'}
                                                    {day.dayType === 'future' && 'Budući dan'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right side: cost + expand */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            {day.dailyLaborCost > 0 && (
                                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>
                                                    {day.dailyLaborCost.toLocaleString('hr-HR')} KM
                                                </span>
                                            )}
                                            {(hasEntries || isEditingTimeline) && (
                                                isExpanded
                                                    ? <ChevronUp size={16} style={{ color: '#94a3b8' }} />
                                                    : <ChevronDown size={16} style={{ color: '#94a3b8' }} />
                                            )}
                                        </div>
                                    </div>

                                    {/* Expanded entries — EDITING MODE */}
                                    {isExpanded && isEditingTimeline && (() => {
                                        const dayLogs = editedLogsByDate.get(day.date) || [];
                                        const availableWorkers = workers.filter(w =>
                                            (w.Status === 'Aktivan' || w.Status === 'Dostupan') &&
                                            !dayLogs.some(l => l.Worker_ID === w.Worker_ID)
                                        );
                                        return (
                                            <div style={{
                                                padding: '8px 14px 12px',
                                                borderTop: `1px solid ${cfg.border}`,
                                                background: 'rgba(255,255,255,0.8)',
                                                display: 'flex', flexDirection: 'column', gap: '6px'
                                            }}>
                                                {dayLogs.map(log => (
                                                    <div key={log.id} style={{
                                                        display: 'flex', alignItems: 'center', gap: '10px',
                                                        padding: '8px 12px', background: '#dcfce7',
                                                        borderRadius: '8px', border: '1px solid #86efac'
                                                    }}>
                                                        <User size={16} style={{ color: '#166534', flexShrink: 0 }} />
                                                        <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a', flex: 1 }}>
                                                            {log.Worker_Name}
                                                        </span>
                                                        <input
                                                            type="number"
                                                            value={log.Daily_Rate}
                                                            onChange={(e) => updateLogRate(log.id, parseFloat(e.target.value) || 0)}
                                                            onClick={(e) => e.stopPropagation()}
                                                            style={{
                                                                width: '80px', padding: '4px 8px', borderRadius: '6px',
                                                                border: '2px solid #6366f1', fontSize: '13px',
                                                                fontWeight: 700, textAlign: 'right', outline: 'none'
                                                            }}
                                                        />
                                                        <span style={{ fontSize: '12px', color: '#6b7280' }}>KM</span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); removeLog(log.id); }}
                                                            style={{
                                                                padding: '4px', borderRadius: '6px', border: '1px solid #fca5a5',
                                                                background: '#fee2e2', cursor: 'pointer', display: 'flex'
                                                            }}
                                                        >
                                                            <Trash2 size={12} style={{ color: '#dc2626' }} />
                                                        </button>
                                                    </div>
                                                ))}

                                                {/* Add worker button */}
                                                {addingWorkerDay === day.date ? (
                                                    <div style={{
                                                        display: 'flex', gap: '6px', flexWrap: 'wrap',
                                                        padding: '8px', background: '#f0f9ff', borderRadius: '8px'
                                                    }} onClick={e => e.stopPropagation()}>
                                                        {availableWorkers.length > 0 ? availableWorkers.map(w => (
                                                            <button key={w.Worker_ID} onClick={() => addWorkerToDay(day.date, w)} style={{
                                                                padding: '4px 10px', fontSize: '12px', borderRadius: '6px',
                                                                border: '1px solid #93c5fd', background: 'white',
                                                                cursor: 'pointer', fontWeight: 500, color: '#1e40af'
                                                            }}>
                                                                {w.Name} ({w.Daily_Rate || 0} KM)
                                                            </button>
                                                        )) : (
                                                            <span style={{ fontSize: '12px', color: '#6b7280' }}>Svi radnici su već dodani</span>
                                                        )}
                                                        <button onClick={() => setAddingWorkerDay(null)} style={{
                                                            padding: '4px 6px', borderRadius: '6px', border: '1px solid #e2e8f0',
                                                            background: 'white', cursor: 'pointer', display: 'flex'
                                                        }}>
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setAddingWorkerDay(day.date); }}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: '4px',
                                                                padding: '6px 12px', borderRadius: '6px',
                                                                border: '1px dashed #93c5fd', background: '#f0f9ff',
                                                                cursor: 'pointer', fontSize: '12px', color: '#2563eb', fontWeight: 500
                                                            }}
                                                        >
                                                            <Plus size={12} /> Dodaj radnika
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); removeDay(day.date); }}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: '4px',
                                                                padding: '6px 12px', borderRadius: '6px',
                                                                border: '1px dashed #fca5a5', background: '#fef2f2',
                                                                cursor: 'pointer', fontSize: '12px', color: '#dc2626', fontWeight: 500
                                                            }}
                                                        >
                                                            <Trash2 size={12} /> Obriši dan
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Expanded entries — READ MODE */}
                                    {isExpanded && !isEditingTimeline && hasEntries && (
                                        <div style={{
                                            padding: '8px 14px 12px',
                                            borderTop: `1px solid ${cfg.border}`,
                                            background: 'rgba(255,255,255,0.6)',
                                            display: 'flex', flexDirection: 'column', gap: '6px'
                                        }}>
                                            {day.entries.map((entry, idx) => (
                                                <div key={idx}>
                                                    {/* Worker entry */}
                                                    {entry.type === 'worker' && (
                                                        <div style={{
                                                            display: 'flex', alignItems: 'center', gap: '10px',
                                                            padding: '8px 12px', background: '#dcfce7',
                                                            borderRadius: '8px', border: '1px solid #86efac'
                                                        }}>
                                                            <User size={16} style={{ color: '#166534', flexShrink: 0 }} />
                                                            <div style={{ flex: 1 }}>
                                                                <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>
                                                                    {entry.workerName}
                                                                </span>
                                                                {entry.processName && (
                                                                    <span style={{
                                                                        marginLeft: '8px', fontSize: '11px', padding: '2px 8px',
                                                                        background: '#e0e7ff', color: '#4338ca', borderRadius: '4px'
                                                                    }}>{entry.processName}</span>
                                                                )}
                                                            </div>
                                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#166534' }}>
                                                                {entry.dailyRate?.toLocaleString('hr-HR')} KM
                                                            </span>
                                                            {onAttendanceChange && entry.workerId && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setEditingEntry({ date: day.date, workerId: entry.workerId! }); }}
                                                                    style={{
                                                                        padding: '4px', borderRadius: '6px', border: '1px solid #e2e8f0',
                                                                        background: 'white', cursor: 'pointer', display: 'flex'
                                                                    }}
                                                                    title="Uredi prisustvo"
                                                                >
                                                                    <Edit3 size={12} style={{ color: '#64748b' }} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Absent worker */}
                                                    {entry.type === 'absent_worker' && (() => {
                                                        const sc = getStatusConfig(entry.attendanceStatus || '');
                                                        const isEditingAtt = editingEntry?.date === day.date && editingEntry?.workerId === entry.workerId;
                                                        return (
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                                padding: '8px 12px', background: sc.bg,
                                                                borderRadius: '8px', border: `1px solid ${sc.color}30`
                                                            }}>
                                                                <sc.icon size={16} style={{ color: sc.color, flexShrink: 0 }} />
                                                                <div style={{ flex: 1 }}>
                                                                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>
                                                                        {entry.workerName}
                                                                    </span>
                                                                    <span style={{
                                                                        marginLeft: '8px', fontSize: '11px', padding: '2px 8px',
                                                                        background: sc.color + '20', color: sc.color,
                                                                        borderRadius: '4px', fontWeight: 500
                                                                    }}>{sc.label}</span>
                                                                </div>

                                                                {isEditingAtt ? (
                                                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                                                                        {ATTENDANCE_OPTIONS.map(opt => (
                                                                            <button
                                                                                key={opt}
                                                                                disabled={editLoading}
                                                                                onClick={() => handleAttendanceEdit(entry.workerId!, entry.workerName!, day.date, opt)}
                                                                                style={{
                                                                                    padding: '3px 8px', fontSize: '11px', borderRadius: '6px',
                                                                                    border: `1px solid ${getStatusConfig(opt).color}40`,
                                                                                    background: opt === entry.attendanceStatus ? getStatusConfig(opt).bg : 'white',
                                                                                    color: getStatusConfig(opt).color, cursor: 'pointer',
                                                                                    fontWeight: 500, opacity: editLoading ? 0.5 : 1
                                                                                }}
                                                                            >{opt}</button>
                                                                        ))}
                                                                        <button onClick={(e) => { e.stopPropagation(); setEditingEntry(null); }} style={{
                                                                            padding: '3px 6px', borderRadius: '6px', border: '1px solid #e2e8f0',
                                                                            background: 'white', cursor: 'pointer', display: 'flex'
                                                                        }}>
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    onAttendanceChange && entry.workerId && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); setEditingEntry({ date: day.date, workerId: entry.workerId! }); }}
                                                                            style={{
                                                                                padding: '4px', borderRadius: '6px', border: '1px solid #e2e8f0',
                                                                                background: 'white', cursor: 'pointer', display: 'flex'
                                                                            }}
                                                                            title="Uredi prisustvo"
                                                                        >
                                                                            <Edit3 size={12} style={{ color: '#64748b' }} />
                                                                        </button>
                                                                    )
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Pause events */}
                                                    {entry.type === 'pause_start' && (
                                                        <div style={{
                                                            display: 'flex', alignItems: 'center', gap: '10px',
                                                            padding: '8px 12px', background: '#fff7ed',
                                                            borderRadius: '8px', border: '1px solid #fdba74'
                                                        }}>
                                                            <Pause size={16} style={{ color: '#c2410c' }} />
                                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#c2410c' }}>
                                                                Proizvod pauziran
                                                            </span>
                                                        </div>
                                                    )}
                                                    {entry.type === 'pause_end' && (
                                                        <div style={{
                                                            display: 'flex', alignItems: 'center', gap: '10px',
                                                            padding: '8px 12px', background: '#ecfdf5',
                                                            borderRadius: '8px', border: '1px solid #6ee7b7'
                                                        }}>
                                                            <Play size={16} style={{ color: '#059669' }} />
                                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#059669' }}>
                                                                Proizvod nastavljen
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Material received */}
                                                    {entry.type === 'material_received' && (
                                                        <div style={{
                                                            display: 'flex', alignItems: 'center', gap: '10px',
                                                            padding: '8px 12px', background: '#eff6ff',
                                                            borderRadius: '8px', border: '1px solid #93c5fd'
                                                        }}>
                                                            <Package size={16} style={{ color: '#2563eb' }} />
                                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af' }}>
                                                                Materijal primljen: {entry.materialName}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}

                    {/* Add new day — always visible when editing is available */}
                    {(isEditingTimeline || onOverrideWorkLogs) && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 14px', marginTop: '4px',
                            background: '#f0f9ff', borderRadius: '10px',
                            border: '1px dashed #93c5fd'
                        }}>
                            <Plus size={14} style={{ color: '#2563eb' }} />
                            <span style={{ fontSize: '13px', color: '#1e40af', fontWeight: 500 }}>
                                Dodaj novi dan:
                            </span>
                            <input
                                type="date"
                                value={newDayDate}
                                onChange={(e) => setNewDayDate(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    padding: '4px 8px', borderRadius: '6px',
                                    border: '1px solid #93c5fd', fontSize: '13px',
                                    outline: 'none'
                                }}
                            />
                            <button
                                onClick={() => {
                                    if (!newDayDate) return;
                                    // Auto-enter editing mode if not already
                                    if (!isEditingTimeline) {
                                        startTimelineEdit();
                                    }
                                    setExtraDates(prev => { const next = new Set(prev); next.add(newDayDate); return next; });
                                    setExpandedDays(prev => { const next = new Set(Array.from(prev)); next.add(newDayDate); return next; });
                                    setAddingWorkerDay(newDayDate);
                                    setNewDayDate('');
                                }}
                                disabled={!newDayDate}
                                style={{
                                    padding: '4px 12px', borderRadius: '6px',
                                    border: 'none', background: newDayDate ? '#2563eb' : '#94a3b8',
                                    color: 'white', fontSize: '12px', fontWeight: 600,
                                    cursor: newDayDate ? 'pointer' : 'not-allowed',
                                    display: 'flex', alignItems: 'center', gap: '4px'
                                }}
                            >
                                <Plus size={12} /> Dodaj
                            </button>
                        </div>
                    )}
                </div>

                {/* ====== COST BREAKDOWN ====== */}
                {costBreakdown && (
                    <div style={{
                        background: '#fff', borderRadius: '12px', padding: '16px', border: '1px solid #e5e7eb'
                    }}>
                        <h4 style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            fontSize: '14px', fontWeight: 600, color: '#374151', margin: '0 0 12px 0'
                        }}>
                            <DollarSign size={16} style={{ color: '#6b7280' }} />
                            Detaljan Pregled Troškova
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                            {[
                                { label: 'Materijal (osnova)', value: costBreakdown.baseMaterial, show: true },
                                { label: 'LED rasvjeta', value: costBreakdown.led, show: costBreakdown.led > 0 },
                                { label: 'Fugiranje', value: costBreakdown.grouting, show: costBreakdown.grouting > 0 },
                                { label: 'Sudoper/Slavina', value: costBreakdown.sinkFaucet, show: costBreakdown.sinkFaucet > 0 },
                                { label: 'Dodaci', value: costBreakdown.extras, show: costBreakdown.extras > 0 },
                                { label: 'Transport', value: costBreakdown.transportShare, show: costBreakdown.transportShare > 0, positive: true },
                                { label: 'Popust', value: costBreakdown.discountShare, show: costBreakdown.discountShare > 0, negative: true }
                            ].filter(item => item.show).map((item, i) => (
                                <div key={i} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '8px 12px', borderRadius: '6px',
                                    background: item.positive ? 'rgba(16,185,129,0.1)' : item.negative ? 'rgba(239,68,68,0.1)' : '#f9fafb'
                                }}>
                                    <span style={{ fontSize: '12px', color: '#6b7280' }}>{item.label}</span>
                                    <span style={{
                                        fontSize: '13px', fontWeight: 600,
                                        color: item.positive ? '#10b981' : item.negative ? '#ef4444' : '#374151'
                                    }}>
                                        {item.positive ? '+' : item.negative ? '-' : ''}{item.value.toLocaleString('hr-HR')} KM
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
