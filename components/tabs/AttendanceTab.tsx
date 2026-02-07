'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { Worker, WorkerAttendance } from '@/lib/types';
import { ATTENDANCE_STATUSES } from '@/lib/types';
import {
    markAttendanceAndRecalculate,
    getAllAttendanceByMonth,
    autoPopulateWeekends,
    formatLocalDateISO,
    backfillWorkLogsFromAttendance,
} from '@/lib/attendance';
import {
    CheckCircle2,
    XCircle,
    Stethoscope,
    Palmtree,
    Car,
    Coffee,
    HelpCircle,
    Search,
    ChevronLeft,
    ChevronRight,
    Calendar,
    Users,
    Database
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useData } from '@/context/DataContext';

interface AttendanceTabProps {
    workers: Worker[];
    onRefresh: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function AttendanceTab({ workers, onRefresh, showToast }: AttendanceTabProps) {
    const { organizationId } = useData();
    // State for infinity scroll
    const [loadedMonths, setLoadedMonths] = useState<{ year: number; month: number }[]>([
        { year: new Date().getFullYear(), month: new Date().getMonth() }, // Previous month
        { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }, // Current month
        { year: new Date().getFullYear(), month: new Date().getMonth() + 2 }, // Next month
    ]);
    const [attendanceCache, setAttendanceCache] = useState<Record<string, WorkerAttendance[]>>({});
    const [loading, setLoading] = useState(false);

    // UI State
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [selectedCell, setSelectedCell] = useState<{ workerId: string; workerName: string; date: string; dateLabel: string } | null>(null);
    const [selectedStatus, setSelectedStatus] = useState<string>('');
    const [notes, setNotes] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [hoveredWorkerId, setHoveredWorkerId] = useState<string | null>(null);

    // Bulk edit state
    const [bulkEditModalOpen, setBulkEditModalOpen] = useState(false);
    const [bulkEditDate, setBulkEditDate] = useState<{ dateStr: string; day: number; dayName: string } | null>(null);
    const [bulkStatuses, setBulkStatuses] = useState<Record<string, string>>({});

    // Table ref for auto-scroll
    const tableContainerRef = useRef<HTMLDivElement>(null);

    // Initial load
    useEffect(() => {
        // Correct initial load: Prev, Current, Next
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth() + 1;

        // Initial months: M-1, M, M+1
        const initialMonths = [
            { year: m === 1 ? y - 1 : y, month: m === 1 ? 12 : m - 1 },
            { year: y, month: m },
            { year: m === 12 ? y + 1 : y, month: m === 12 ? 1 : m + 1 }
        ];

        setLoadedMonths(initialMonths);
        initialMonths.forEach(m => loadMonth(m.year, m.month));

        // Scroll to today after data load (handled by another effect)
    }, []);

    async function loadMonth(year: number, month: number) {
        const key = `${year}-${month}`;
        if (attendanceCache[key]) return; // Already loaded

        try {
            setLoading(true);
            const data = await getAllAttendanceByMonth(year.toString(), month.toString(), organizationId || undefined);
            setAttendanceCache(prev => ({ ...prev, [key]: data }));
        } catch (error) {
            console.error('Error loading month:', year, month, error);
        } finally {
            setLoading(false);
        }
    }

    // Generate calendar days for ALL loaded months
    const flattenedDays = useMemo(() => {
        return loadedMonths.flatMap(m => {
            const daysInMonth = new Date(m.year, m.month, 0).getDate();
            return Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const date = new Date(m.year, m.month - 1, day);
                const dateStr = formatLocalDateISO(date);
                const dayOfWeek = date.getDay();
                const dayName = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'][dayOfWeek];
                return {
                    day,
                    date,
                    dateStr,
                    dayOfWeek,
                    dayName,
                    month: m.month,
                    year: m.year
                };
            });
        });
    }, [loadedMonths]);

    // Filter active workers
    const activeWorkers = workers.filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan');

    // Filter workers by search
    const filteredWorkers = useMemo(() => {
        if (!searchTerm.trim()) return activeWorkers;
        const search = searchTerm.toLowerCase();
        return activeWorkers.filter(w => w.Name.toLowerCase().includes(search));
    }, [activeWorkers, searchTerm]);

    // Auto-scroll to today when viewing current month (Removed, handled by table layout logic if needed)
    // useEffect(() => {
    // }, [isCurrentMonth, attendanceData]);

    // Calculate statistics for ALL loaded months
    const stats = useMemo(() => {
        let prisutan = 0;
        let teren = 0;
        let odsutan = 0;
        let bolovanje = 0;
        let odmor = 0;
        let vikend = 0;

        // Iterate over cache to get stats
        Object.values(attendanceCache).forEach(monthData => {
            monthData.forEach(a => {
                if (a.Status === 'Prisutan') prisutan++;
                else if (a.Status === 'Teren') teren++;
                else if (a.Status === 'Odsutan') odsutan++;
                else if (a.Status === 'Bolovanje') bolovanje++;
                else if (a.Status === 'Odmor') odmor++;
                else if (a.Status === 'Vikend') vikend++;
            });
        });

        const total = prisutan + teren;
        const workDays = activeWorkers.length * flattenedDays.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6).length;
        const attendanceRate = workDays > 0 ? Math.round((total / workDays) * 100) : 0;
        return { prisutan, teren, odsutan, bolovanje, odmor, vikend, total, attendanceRate };
    }, [attendanceCache, activeWorkers, flattenedDays]);

    // Scroll to a specific date
    function scrollToDate(dateStr: string) {
        if (!tableContainerRef.current) return;
        const cell = tableContainerRef.current.querySelector(`[data-date="${dateStr}"]`);
        if (cell) {
            const container = tableContainerRef.current;
            const cellRect = cell.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const scrollLeft = container.scrollLeft + (cellRect.left - containerRect.left) - (containerRect.width / 2) + (cellRect.width / 2);
            container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
        }
    }

    // Go to today
    function goToToday() {
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth() + 1;

        // Reset to Prev, Current, Next
        const initialMonths = [
            { year: m === 1 ? y - 1 : y, month: m === 1 ? 12 : m - 1 },
            { year: y, month: m },
            { year: m === 12 ? y + 1 : y, month: m === 12 ? 1 : m + 1 }
        ];
        setLoadedMonths(initialMonths);
        initialMonths.forEach(mo => loadMonth(mo.year, mo.month));

        // Scroll to today after a short delay to allow render
        setTimeout(() => scrollToDate(formatLocalDateISO(today)), 200);
    }

    // Get attendance for specific worker and date
    function getAttendance(workerId: string, dateStr: string): WorkerAttendance | undefined {
        const date = new Date(dateStr);
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        return attendanceCache[key]?.find(a => a.Worker_ID === workerId && a.Date === dateStr);
    }

    // Get display data for status
    function getStatusDisplay(status: string) {
        switch (status) {
            case 'Prisutan': return { icon: CheckCircle2, color: '#166534', bg: '#dcfce7', label: 'Prisutan' };
            case 'Odsutan': return { icon: XCircle, color: '#991b1b', bg: '#fee2e2', label: 'Odsutan' };
            case 'Bolovanje': return { icon: Stethoscope, color: '#9a3412', bg: '#fed7aa', label: 'Bolovanje' };
            case 'Odmor': return { icon: Palmtree, color: '#7c2d12', bg: '#fef3c7', label: 'Odmor' };
            case 'Teren': return { icon: Car, color: '#1e40af', bg: '#dbeafe', label: 'Teren' };
            case 'Vikend': return { icon: Coffee, color: '#4338ca', bg: '#e0e7ff', label: 'Vikend' };
            case 'Praznik': return { icon: Calendar, color: '#dc2626', bg: '#fef2f2', label: 'Praznik' };
            default: return { icon: HelpCircle, color: '#6b7280', bg: '#f3f4f6', label: status };
        }
    }

    // Handle cell click
    // Handle cell click
    function handleCellClick(worker: Worker, dayInfo: any) {
        const attendance = getAttendance(worker.Worker_ID, dayInfo.dateStr);
        setSelectedCell({
            workerId: worker.Worker_ID,
            workerName: worker.Name,
            date: dayInfo.dateStr,
            dateLabel: `${dayInfo.day}. ${dayInfo.dayName}`
        });
        setSelectedStatus(attendance?.Status || '');
        setNotes(attendance?.Notes || '');
        setEditModalOpen(true);
    }

    // Save attendance with OPTIMISTIC UPDATE
    async function handleSaveAttendance(status?: string, notesVal?: string) {
        // Support both direct call (from Modal) and wrapper
        const finalStatus = status || selectedStatus;
        const finalNotes = notesVal !== undefined ? notesVal : notes;

        if (!selectedCell || !finalStatus) return;

        // 1. Optimistic Update
        const date = new Date(selectedCell.date);
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;

        setAttendanceCache(prev => {
            const monthData = prev[key] || [];
            const newRec: WorkerAttendance = {
                Attendance_ID: 'opt-' + Date.now(),
                Worker_ID: selectedCell.workerId,
                Worker_Name: selectedCell.workerName,
                Date: selectedCell.date,
                Status: finalStatus as any,
                Notes: finalNotes,
                Created_Date: new Date().toISOString(),
                Organization_ID: organizationId || ''
            };

            // Remove old, add new
            const filtered = monthData.filter(a => !(a.Worker_ID === selectedCell.workerId && a.Date === selectedCell.date));
            return { ...prev, [key]: [...filtered, newRec] };
        });

        // Close modal
        setEditModalOpen(false);

        try {
            await markAttendanceAndRecalculate({
                Worker_ID: selectedCell.workerId,
                Worker_Name: selectedCell.workerName,
                Date: selectedCell.date,
                Status: finalStatus as any,
                Notes: finalNotes,
                Organization_ID: organizationId || undefined
            });

            // Reload just this month to confirm
            loadMonth(date.getFullYear(), date.getMonth() + 1);
            onRefresh();
        } catch (error) {
            showToast('Greška pri spremanju', 'error');
            loadMonth(date.getFullYear(), date.getMonth() + 1);
        }
    }

    // Auto-populate weekends
    async function handleAutoPopulateWeekends() {
        try {
            setLoading(true);
            await Promise.all(loadedMonths.map(m => autoPopulateWeekends(workers, m.year, m.month)));

            // Reload all loaded months
            loadedMonths.forEach(m => {
                setAttendanceCache(prev => {
                    const key = `${m.year}-${m.month}`;
                    const newData = { ...prev };
                    delete newData[key]; // Clear cache to force reload
                    return newData;
                });
                loadMonth(m.year, m.month);
            });

            showToast('Vikendi su popunjeni za prikazane mjesece', 'success');
        } catch (error) {
            showToast('Greška pri popunjavanju vikenda', 'error');
        } finally {
            setLoading(false);
        }
    }

    // Backfill work logs from existing attendance records
    async function handleBackfillWorkLogs() {
        if (!organizationId) {
            showToast('Greška: Nema organizacije', 'error');
            return;
        }

        try {
            setLoading(true);

            // Get date range from loaded months
            const firstMonth = loadedMonths[0];
            const lastMonth = loadedMonths[loadedMonths.length - 1];
            const dateFrom = `${firstMonth.year}-${String(firstMonth.month).padStart(2, '0')}-01`;
            const lastDay = new Date(lastMonth.year, lastMonth.month, 0).getDate();
            const dateTo = `${lastMonth.year}-${String(lastMonth.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

            const result = await backfillWorkLogsFromAttendance(organizationId, dateFrom, dateTo);

            showToast(`Sinkronizacija završena: ${result.totalCreated} work logova kreirano`, 'success');
            onRefresh();
        } catch (error) {
            console.error('Backfill error:', error);
            showToast('Greška pri sinkronizaciji', 'error');
        } finally {
            setLoading(false);
        }
    }

    // Navigate months (Infinity Scroll Loaders)
    function previousMonth() {
        setLoadedMonths(prev => {
            const first = prev[0];
            const newMonth = first.month === 1 ? 12 : first.month - 1;
            const newYear = first.month === 1 ? first.year - 1 : first.year;
            loadMonth(newYear, newMonth);
            return [{ year: newYear, month: newMonth }, ...prev];
        });
    }

    function nextMonth() {
        setLoadedMonths(prev => {
            const last = prev[prev.length - 1];
            const newMonth = last.month === 12 ? 1 : last.month + 1;
            const newYear = last.month === 12 ? last.year + 1 : last.year;
            loadMonth(newYear, newMonth);
            return [...prev, { year: newYear, month: newMonth }];
        });
    }

    // ============================================
    // BULK EDIT HANDLERS
    // ============================================

    // Open bulk edit modal for a specific day
    function openBulkEditModal(dayInfo: any) {
        // Initialize statuses from existing attendance data
        const initialStatuses: Record<string, string> = {};
        activeWorkers.forEach(worker => {
            const existing = getAttendance(worker.Worker_ID, dayInfo.dateStr);
            initialStatuses[worker.Worker_ID] = existing?.Status || '';
        });

        setBulkEditDate({ dateStr: dayInfo.dateStr, day: dayInfo.day, dayName: dayInfo.dayName });
        setBulkStatuses(initialStatuses);
        setBulkEditModalOpen(true);
    }

    // Set all workers to a specific status
    function handleBulkSetAll(status: string) {
        const newStatuses: Record<string, string> = {};
        activeWorkers.forEach(worker => {
            newStatuses[worker.Worker_ID] = status;
        });
        setBulkStatuses(newStatuses);
    }

    // Save bulk changes with optimistic update
    async function handleBulkSave() {
        if (!bulkEditDate) return;

        // Get workers that have a status set
        const workersToUpdate = activeWorkers.filter(w => bulkStatuses[w.Worker_ID]);

        if (workersToUpdate.length === 0) {
            showToast('Nema promjena za sačuvati', 'info');
            return;
        }

        // 1. Optimistic Update
        const date = new Date(bulkEditDate.dateStr);
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;

        setAttendanceCache(prev => {
            const monthData = prev[key] || [];
            const newRecords = workersToUpdate.map(worker => ({
                Attendance_ID: 'opt-' + Date.now() + '-' + worker.Worker_ID,
                Worker_ID: worker.Worker_ID,
                Worker_Name: worker.Name,
                Date: bulkEditDate.dateStr,
                Status: bulkStatuses[worker.Worker_ID] as any,
                Notes: null,
                Created_Date: new Date().toISOString(),
                Organization_ID: organizationId || ''
            }));

            // Remove old for this day, add new
            const filtered = monthData.filter(a => a.Date !== bulkEditDate.dateStr);
            return { ...prev, [key]: [...filtered, ...newRecords] };
        });

        // Close modal immediately
        setBulkEditModalOpen(false);
        setBulkEditDate(null);
        setBulkStatuses({});

        try {
            // 2. Save all in parallel
            await Promise.all(
                workersToUpdate.map(worker =>
                    markAttendanceAndRecalculate({
                        Worker_ID: worker.Worker_ID,
                        Worker_Name: worker.Name,
                        Date: bulkEditDate.dateStr,
                        Status: bulkStatuses[worker.Worker_ID] as any,
                        Notes: null,
                        Organization_ID: organizationId || undefined
                    })
                )
            );

            showToast(`Prisustvo sačuvano za ${workersToUpdate.length} radnika`, 'success');
            loadMonth(date.getFullYear(), date.getMonth() + 1);
            onRefresh();
        } catch (error) {
            showToast('Greška pri čuvanju prisustva', 'error');
            loadMonth(date.getFullYear(), date.getMonth() + 1);
        }
    }

    // Today detection helpers
    const todayStr = formatLocalDateISO(new Date());

    // Scroll handler for infinity scroll
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollLeft, scrollWidth, clientWidth } = e.currentTarget;
        // If near end (within 200px), load next month
        if (scrollWidth - scrollLeft - clientWidth < 200 && !loading) {
            nextMonth(); // Reuse nextMonth logic which appends
        }
    };

    return (
        <div className="tab-content active">
            {/* Header */}
            <div className="content-header" style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="glass-btn" onClick={goToToday} style={{ padding: '8px 14px', fontWeight: 600, color: '#3b82f6' }}>
                            <Calendar size={16} />
                            Danas
                        </button>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                        <input
                            type="text"
                            placeholder="Pretraži..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                padding: '8px 12px 8px 36px',
                                borderRadius: '10px',
                                border: '1px solid #e2e8f0',
                                fontSize: '13px',
                                width: '160px',
                                outline: 'none'
                            }}
                        />
                    </div>
                    {/* Bulk Danas button removed as it is specific to one day, can use header click instead */}
                    <button className="glass-btn" onClick={() => {
                        const todayInfo = flattenedDays.find(d => d.dateStr === todayStr);
                        if (todayInfo) openBulkEditModal(todayInfo);
                    }} style={{ padding: '8px 14px', fontWeight: 600 }}>
                        <Users size={16} />
                        Bulk Danas
                    </button>

                    <button className="glass-btn glass-btn-primary" onClick={handleAutoPopulateWeekends} disabled={loading} style={{ padding: '8px 14px' }}>
                        <Coffee size={16} />
                        Vikendi (Učitani)
                    </button>

                    <button
                        className="glass-btn"
                        onClick={handleBackfillWorkLogs}
                        disabled={loading}
                        style={{ padding: '8px 14px', background: '#fff7ed', borderColor: '#fed7aa', color: '#c2410c' }}
                        title="Sync prisustvo sa work logovima za učitane mjesece"
                    >
                        <Database size={16} />
                        Sync Work Logs
                    </button>
                </div>
            </div>

            {/* Stats Bar */}
            <div style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '16px',
                flexWrap: 'wrap'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: '#dcfce7', borderRadius: '10px', border: '1px solid #86efac' }}>
                    <CheckCircle2 size={18} style={{ color: '#166534' }} />
                    <span style={{ fontWeight: 600, color: '#166534' }}>{stats.prisutan}</span>
                    <span style={{ fontSize: '12px', color: '#166534' }}>Prisutni</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: '#dbeafe', borderRadius: '10px', border: '1px solid #93c5fd' }}>
                    <Car size={18} style={{ color: '#1e40af' }} />
                    <span style={{ fontWeight: 600, color: '#1e40af' }}>{stats.teren}</span>
                    <span style={{ fontSize: '12px', color: '#1e40af' }}>Teren</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: '#fee2e2', borderRadius: '10px', border: '1px solid #fca5a5' }}>
                    <XCircle size={18} style={{ color: '#991b1b' }} />
                    <span style={{ fontWeight: 600, color: '#991b1b' }}>{stats.odsutan}</span>
                    <span style={{ fontSize: '12px', color: '#991b1b' }}>Odsutni</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: '#e0e7ff', borderRadius: '10px', border: '1px solid #a5b4fc' }}>
                    <Coffee size={18} style={{ color: '#4338ca' }} />
                    <span style={{ fontWeight: 600, color: '#4338ca' }}>{stats.vikend}</span>
                    <span style={{ fontSize: '12px', color: '#4338ca' }}>Vikend</span>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)', borderRadius: '10px', border: '1px solid #7dd3fc' }}>
                    <span style={{ fontSize: '13px', color: '#0369a1' }}>Prisustvo:</span>
                    <span style={{ fontWeight: 700, fontSize: '16px', color: stats.attendanceRate >= 80 ? '#166534' : stats.attendanceRate >= 50 ? '#ca8a04' : '#991b1b' }}>
                        {stats.attendanceRate}%
                    </span>
                </div>
            </div>

            {/* Calendar Grid */}
            <div style={{
                background: 'white',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
            }}>
                <div ref={tableContainerRef} onScroll={handleScroll} style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                        <thead>
                            {/* Month Header Row */}
                            <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                                <th style={{
                                    padding: '8px',
                                    background: '#f1f5f9',
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 20,
                                    borderRight: '2px solid #e2e8f0'
                                }}></th>
                                {loadedMonths.map(m => {
                                    const daysInMonth = new Date(m.year, m.month, 0).getDate();
                                    const MONTH_NAMES = [
                                        'Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni',
                                        'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'
                                    ];
                                    return (
                                        <th
                                            key={`${m.year}-${m.month}`}
                                            colSpan={daysInMonth}
                                            style={{
                                                padding: '8px',
                                                textAlign: 'center',
                                                fontWeight: 700,
                                                color: '#475569',
                                                borderRight: '2px solid #cbd5e1',
                                                fontSize: '14px'
                                            }}
                                        >
                                            {MONTH_NAMES[m.month - 1]} {m.year}
                                        </th>
                                    );
                                })}
                            </tr>

                            {/* Days Header Row */}
                            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                                <th style={{
                                    padding: '12px 16px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: '#0f172a',
                                    position: 'sticky',
                                    left: 0,
                                    background: '#f8fafc',
                                    zIndex: 20,
                                    minWidth: '150px',
                                    borderRight: '2px solid #e2e8f0',
                                    top: '36px' // Push down below month header if we made month header sticky too, but for complexity let's keep month header static or sticky? 
                                    // Actually if Month header scrolls away, it's confusing. 
                                    // But implementing dual sticky top is CSS heavy.
                                    // For now, let's keep sticky left for worker.
                                }}>
                                    Radnik
                                </th>
                                {flattenedDays.map((dayInfo) => {
                                    const isToday = dayInfo.dateStr === todayStr;
                                    const isWeekend = dayInfo.dayOfWeek === 0 || dayInfo.dayOfWeek === 6;
                                    return (
                                        <th
                                            key={dayInfo.dateStr}
                                            data-date={dayInfo.dateStr}
                                            onClick={() => openBulkEditModal(dayInfo)}
                                            style={{
                                                padding: '8px 4px',
                                                textAlign: 'center',
                                                fontWeight: isToday ? 700 : 600,
                                                fontSize: '12px',
                                                color: isToday ? '#1d4ed8' : '#64748b',
                                                background: isToday ? '#dbeafe' : isWeekend ? '#fef3c7' : '#f8fafc',
                                                borderLeft: isToday ? '2px solid #3b82f6' : '1px solid #f1f5f9',
                                                borderRight: isToday ? '2px solid #3b82f6' : '1px solid #f1f5f9',
                                                borderTop: isToday ? '2px solid #3b82f6' : 'none',
                                                minWidth: '40px',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!isToday) e.currentTarget.style.background = '#e2e8f0';
                                            }}
                                            onMouseLeave={(e) => {
                                                if (!isToday) e.currentTarget.style.background = isWeekend ? '#fef3c7' : '#f8fafc';
                                            }}
                                            title={isToday ? 'Danas - klikni za bulk uređivanje' : 'Klikni za bulk uređivanje'}
                                        >
                                            <div style={{ fontSize: isToday ? '15px' : '13px', color: isToday ? '#1d4ed8' : '#0f172a', marginBottom: '2px' }}>{dayInfo.day}</div>
                                            <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{dayInfo.dayName}</div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredWorkers.length === 0 ? (
                                <tr>
                                    <td colSpan={flattenedDays.length + 1} style={{ padding: '48px', textAlign: 'center' }}>
                                        <span className="material-icons-round" style={{ fontSize: '48px', color: '#cbd5e1', display: 'block', marginBottom: '12px' }}>person_search</span>
                                        <div style={{ fontSize: '16px', color: '#64748b', fontWeight: 500 }}>
                                            {searchTerm ? 'Nema radnika koji odgovaraju pretrazi' : 'Nema aktivnih radnika'}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredWorkers.map(worker => (
                                    <tr
                                        key={worker.Worker_ID}
                                        style={{ borderBottom: '1px solid #f1f5f9' }}
                                        onMouseEnter={() => setHoveredWorkerId(worker.Worker_ID)}
                                        onMouseLeave={() => setHoveredWorkerId(null)}
                                    >
                                        <td style={{
                                            padding: '16px',
                                            fontWeight: 500,
                                            fontSize: '14px',
                                            color: hoveredWorkerId === worker.Worker_ID ? '#0369a1' : '#0f172a',
                                            position: 'sticky',
                                            left: 0,
                                            background: hoveredWorkerId === worker.Worker_ID ? '#e0f2fe' : 'white',
                                            zIndex: 10,
                                            borderRight: hoveredWorkerId === worker.Worker_ID ? '2px solid #3b82f6' : '2px solid #f1f5f9',
                                            transition: 'all 0.1s ease-in-out'
                                        }}>
                                            <div>{worker.Name}</div>
                                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                                                {worker.Role}
                                            </div>
                                        </td>
                                        {flattenedDays.map((dayInfo) => {
                                            const attendance = getAttendance(worker.Worker_ID, dayInfo.dateStr);
                                            const isWeekend = dayInfo.dayOfWeek === 0 || dayInfo.dayOfWeek === 6;
                                            const isToday = dayInfo.dateStr === todayStr;
                                            const display = attendance ? getStatusDisplay(attendance.Status) : null;

                                            return (
                                                <td
                                                    key={dayInfo.dateStr}
                                                    data-date={dayInfo.dateStr}
                                                    onClick={() => handleCellClick(worker, dayInfo)}
                                                    style={{
                                                        padding: '8px 4px',
                                                        textAlign: 'center',
                                                        background: isToday ? '#eff6ff' : isWeekend ? '#fef3c7' : 'white',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.12s',
                                                        borderLeft: isToday ? '2px solid #3b82f6' : '1px solid #f1f5f9',
                                                        borderRight: isToday ? '2px solid #3b82f6' : '1px solid #f1f5f9',
                                                        position: 'relative'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.background = display ? display.bg : (isToday ? '#dbeafe' : isWeekend ? '#fef3c7' : '#f8fafc');
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.background = isToday ? '#eff6ff' : isWeekend ? '#fef3c7' : 'white';
                                                    }}
                                                    title={attendance?.Notes || (isToday ? 'Danas - klikni za označavanje' : 'Klikni za označavanje')}
                                                >
                                                    {display && (
                                                        <div style={{
                                                            fontSize: '18px',
                                                            lineHeight: 1,
                                                            color: display.color
                                                        }}>
                                                            <display.icon size={18} />
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>



            {/* Edit Modal */}
            <Modal
                isOpen={editModalOpen}
                onClose={() => {
                    setEditModalOpen(false);
                    setSelectedCell(null);
                    setSelectedStatus('');
                    setNotes('');
                }}
                title="Označi Prisustvo"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setEditModalOpen(false)}>
                            Otkaži
                        </button>
                        <button className="btn btn-primary" onClick={() => handleSaveAttendance()} disabled={!selectedStatus}>
                            Sačuvaj
                        </button>
                    </>
                }
            >
                {/* ... existing modal content ... */}
                {selectedCell && (
                    <div>
                        <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
                                {selectedCell.dateLabel}
                            </div>
                            <div style={{ fontSize: '14px', color: '#64748b' }}>
                                {selectedCell.workerName}
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Status</label>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gap: '12px',
                                marginTop: '8px'
                            }}>
                                {ATTENDANCE_STATUSES.map(status => {
                                    const display = getStatusDisplay(status);
                                    const isSelected = selectedStatus === status;
                                    return (
                                        <button
                                            key={status}
                                            type="button"
                                            onClick={() => setSelectedStatus(status)}
                                            style={{
                                                padding: '16px 12px',
                                                border: `2px solid ${isSelected ? display.color : '#e2e8f0'}`,
                                                borderRadius: '12px',
                                                background: isSelected ? display.bg : 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!isSelected) {
                                                    e.currentTarget.style.borderColor = '#cbd5e1';
                                                    e.currentTarget.style.background = '#f8fafc';
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (!isSelected) {
                                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                                    e.currentTarget.style.background = 'white';
                                                }
                                            }}
                                        >
                                            <span style={{ color: display.color }}><display.icon size={24} /></span>
                                            <span style={{
                                                fontSize: '13px',
                                                fontWeight: isSelected ? 600 : 500,
                                                color: isSelected ? display.color : '#64748b'
                                            }}>
                                                {status}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="form-group" style={{ marginTop: '20px' }}>
                            <label>Napomena (opcionalno)</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Razlog odsutnosti, lokacija terena..."
                                rows={3}
                                style={{ width: '100%', marginTop: '8px' }}
                            />
                        </div>
                    </div>
                )}
            </Modal>

            {/* Bulk Edit Modal */}
            <Modal
                isOpen={bulkEditModalOpen}
                onClose={() => {
                    setBulkEditModalOpen(false);
                    setBulkEditDate(null);
                    setBulkStatuses({});
                }}
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Users size={24} />
                        <span>Bulk uređivanje - {bulkEditDate?.dateStr} ({bulkEditDate?.dayName})</span>
                    </div>
                }
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setBulkEditModalOpen(false)}>
                            Otkaži
                        </button>
                        <button className="glass-btn glass-btn-primary" onClick={handleBulkSave}>
                            Sačuvaj sve
                        </button>
                    </>
                }
            >
                <div>
                    {/* Quick Set All Buttons */}
                    <div style={{
                        marginBottom: '20px',
                        padding: '16px',
                        background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0'
                    }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '12px' }}>
                            ⚡ Brzo postavi sve radnike na:
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {ATTENDANCE_STATUSES.map(status => {
                                const display = getStatusDisplay(status);
                                return (
                                    <button
                                        key={status}
                                        className="glass-btn"
                                        onClick={() => handleBulkSetAll(status)}
                                        style={{
                                            padding: '8px 14px',
                                            fontSize: '13px',
                                            gap: '6px'
                                        }}
                                    >
                                        <display.icon size={16} style={{ color: display.color }} />
                                        {status}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Worker List */}
                    <div style={{
                        maxHeight: '400px',
                        overflowY: 'auto',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px'
                    }}>
                        {activeWorkers.map((worker, index) => {
                            const currentStatus = bulkStatuses[worker.Worker_ID] || '';
                            const display = currentStatus ? getStatusDisplay(currentStatus) : null;

                            return (
                                <div
                                    key={worker.Worker_ID}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '14px 16px',
                                        borderBottom: index < activeWorkers.length - 1 ? '1px solid #f1f5f9' : 'none',
                                        background: index % 2 === 0 ? 'white' : '#fafafa'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 500, color: '#0f172a' }}>{worker.Name}</div>
                                        <div style={{ fontSize: '12px', color: '#64748b' }}>{worker.Role}</div>
                                    </div>
                                    <select
                                        value={currentStatus}
                                        onChange={(e) => setBulkStatuses(prev => ({
                                            ...prev,
                                            [worker.Worker_ID]: e.target.value
                                        }))}
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: '8px',
                                            border: `2px solid ${display ? display.color : '#e2e8f0'}`,
                                            background: display ? display.bg : 'white',
                                            color: display ? display.color : '#64748b',
                                            fontWeight: 500,
                                            fontSize: '13px',
                                            cursor: 'pointer',
                                            minWidth: '140px'
                                        }}
                                    >
                                        <option value="">— Ne mijenjaj —</option>
                                        {ATTENDANCE_STATUSES.map(status => (
                                            <option key={status} value={status}>{status}</option>
                                        ))}
                                    </select>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </Modal>

            {/* Styles moved to globals.css */}
        </div>
    );
}
