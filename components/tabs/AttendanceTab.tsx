'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { Worker, WorkerAttendance, WorkOrder } from '@/lib/types';
import { ATTENDANCE_STATUSES } from '@/lib/types';
import {
    markAttendanceAndRecalculate,
    getAllAttendanceByMonth,
    autoPopulateWeekends,
    formatLocalDateISO,
    bookWorkerDayItems,
    startWorkOrder,
    toggleItemPause,
    recalculateWorkOrder,
    getWorkerAttendance,
    getDailyWorkBooking,
    getBookedWorkerDaysByMonth,
} from '@/lib/services';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { workOrderDisplayName } from '@/lib/utils';
import { buildBookingProposal, type ProposalRow } from '@/lib/attendanceBooking';
import AttendanceBookingConfirmModal, { type BookingDecision } from '@/components/ui/AttendanceBookingConfirmModal';
import PayrollModal from '@/components/ui/PayrollModal';
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
    History
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useData } from '@/context/DataContext';

interface AttendanceTabProps {
    workers: Worker[];
    workOrders: WorkOrder[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function AttendanceTab({ workers, workOrders, onRefresh, showToast }: AttendanceTabProps) {
    const { organizationId } = useData();
    // State for infinity scroll
    const [loadedMonths, setLoadedMonths] = useState<{ year: number; month: number }[]>([
        { year: new Date().getFullYear(), month: new Date().getMonth() }, // Previous month
        { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }, // Current month
        { year: new Date().getFullYear(), month: new Date().getMonth() + 2 }, // Next month
    ]);
    const [attendanceCache, setAttendanceCache] = useState<Record<string, WorkerAttendance[]>>({});
    // (radnik|dan) parovi s bar jednim work logom, po mjesecu — za indikator "prisutan bez knjiženja"
    const [bookedCache, setBookedCache] = useState<Record<string, Set<string>>>({});
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

    // Upit knjiženja dnevnica (potvrda nakon unosa prisustva)
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmRows, setConfirmRows] = useState<ProposalRow[]>([]);
    const [confirmDate, setConfirmDate] = useState('');

    // Mjesečni obračun plata
    const [payrollOpen, setPayrollOpen] = useState(false);

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

        // Auto-scroll to today after data loads
        setTimeout(() => scrollToDate(formatLocalDateISO(today)), 500);

        // Auto-populate Sundays for loaded months
        if (organizationId) {
            initialMonths.forEach(m => {
                autoPopulateWeekends(workers, m.year, m.month, organizationId)
                    .catch(err => console.warn('Auto Sunday fill error:', err));
            });
        }
    }, []);

    async function loadMonth(year: number, month: number) {
        const key = `${year}-${month}`;
        if (attendanceCache[key]) return; // Already loaded

        try {
            setLoading(true);
            const data = await getAllAttendanceByMonth(year.toString(), month.toString(), organizationId || undefined);
            setAttendanceCache(prev => ({ ...prev, [key]: data }));
            refreshBookedMonth(year, month);
        } catch (error) {
            console.error('Error loading month:', year, month, error);
        } finally {
            setLoading(false);
        }
    }

    // Osvježi (radnik|dan) knjižene parove mjeseca — poziva se i nakon knjiženja/brisanja dnevnica.
    function refreshBookedMonth(year: number, month: number) {
        if (!organizationId) return;
        getBookedWorkerDaysByMonth(year, month, organizationId)
            .then(keys => setBookedCache(prev => ({ ...prev, [`${year}-${month}`]: new Set(keys) })))
            .catch(err => console.warn('booked-days load error:', err));
    }

    // Da li (radnik, dan) ima bar jednu proknjiženu dnevnicu (undefined = mjesec još nije učitan)
    function isBookedInfo(workerId: string, dateStr: string): boolean | undefined {
        const d = new Date(dateStr + 'T00:00:00');
        const set = bookedCache[`${d.getFullYear()}-${d.getMonth() + 1}`];
        if (!set) return undefined;
        return set.has(`${workerId}|${dateStr}`);
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
            // skipAutoBook: prisustvo se snima, ali dnevnice se knjiže tek nakon potvrde u upitu.
            const result = await markAttendanceAndRecalculate({
                Worker_ID: selectedCell.workerId,
                Worker_Name: selectedCell.workerName,
                Date: selectedCell.date,
                Status: finalStatus as any,
                Notes: finalNotes,
                Organization_ID: organizationId || undefined
            }, { skipAutoBook: true });

            const isPresent = finalStatus === 'Prisutan' || finalStatus === 'Teren';
            if (isPresent) {
                // Izgradi prijedlog → otvori upit (Prisutan bez kandidata ne otvara upit).
                const opened = await openBookingConfirm(
                    [{ workerId: selectedCell.workerId, workerName: selectedCell.workerName, status: finalStatus }],
                    selectedCell.date,
                );
                if (!opened) showToast('Prisustvo sačuvano', 'success');
            } else if (result.manualKept > 0) {
                // Odsutan, ali ima RUČNIH dnevnica → zadržane (ne brišemo ručni unos bez potvrde). Rizik #5.
                showToast(`Prisustvo sačuvano — zadržano ${result.manualKept} ručnih dnevnica (provjeri ručno ako ne treba)`, 'info');
            } else if (result.workLogsDeleted > 0) {
                // Odsutan → auto-dnevnice tog dana uklonjene (ne računaju se).
                showToast(`Prisustvo sačuvano — uklonjeno ${result.workLogsDeleted} dnevnica (odsutan se ne računa)`, 'info');
            } else {
                showToast('Prisustvo sačuvano', 'success');
            }

            // Reload just this month to confirm
            loadMonth(date.getFullYear(), date.getMonth() + 1);
            refreshBookedMonth(date.getFullYear(), date.getMonth() + 1);
            onRefresh('workers', 'workOrders');
        } catch (error) {
            showToast('Greška pri spremanju', 'error');
            loadMonth(date.getFullYear(), date.getMonth() + 1);
        }
    }

    // Pomjeri ISO datum za N dana (lokalno, bez UTC pomaka)
    function shiftISO(iso: string, days: number): string {
        const d = new Date(iso + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return formatLocalDateISO(d);
    }

    // Jučerašnji status radnika (za labelu dugmeta "Kao jučer"; cache-only, brzo)
    function yesterdayStatusOf(workerId: string, dateStr: string): string | undefined {
        return getAttendance(workerId, shiftISO(dateStr, -1))?.Status;
    }

    // "Kao jučer" izvor za prijedlog u modalu: workerId → Work_Order_ID[] knjiženi JUČER.
    async function buildYesterdayOrderMap(dateStr: string): Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        if (!organizationId) return map;
        try {
            const yEntries = await getDailyWorkBooking(shiftISO(dateStr, -1), organizationId);
            yEntries.forEach(e => {
                const orderIds: string[] = [];
                (e.items || []).forEach(bi => { if (bi.workOrderId && !orderIds.includes(bi.workOrderId)) orderIds.push(bi.workOrderId); });
                if (orderIds.length) map.set(e.workerId, orderIds);
            });
        } catch { /* greška u dohvatu nije kritična — samo nema "kao jučer" predabira */ }
        return map;
    }

    // Izgradi prijedlog knjiženja s "kao jučer" fallback-om (Teren/Prisutan bez auto-prijedloga) i
    // otvori upit ako ima redova. Vrati true ako je upit otvoren.
    async function openBookingConfirm(
        savedWorkers: { workerId: string; workerName: string; status: string }[],
        dateStr: string,
    ): Promise<boolean> {
        const yMap = await buildYesterdayOrderMap(dateStr);
        const rows = buildBookingProposal(savedWorkers, workOrders, dateStr, undefined, yMap);
        if (rows.length > 0) {
            setConfirmRows(rows);
            setConfirmDate(dateStr);
            setConfirmOpen(true);
            return true;
        }
        return false;
    }

    // "KAO JUČER": ponovi jučerašnji status + ISTO knjiženje (isti nalozi/stavke, ista prisutnost).
    // Ide isključivo kroz postojeći pipeline bookWorkerDayItems → renormalizeWorkerDay → recalculateWorkOrder;
    // idempotentno (postojeći/ručni zapisi imaju prednost). Jučer bez knjiženja → normalan upit.
    async function handleRepeatYesterday() {
        if (!selectedCell || !organizationId) return;
        const { workerId, workerName, date } = selectedCell;
        const yesterday = shiftISO(date, -1);

        let yAtt: WorkerAttendance | undefined = getAttendance(workerId, yesterday);
        if (!yAtt) {
            try { yAtt = (await getWorkerAttendance(workerId, yesterday, organizationId)) || undefined; } catch { /* cache-miss fallback nije kritičan */ }
        }
        if (!yAtt) {
            showToast('Nema jučerašnjeg unosa za ovog radnika', 'info');
            return;
        }
        const yStatus = yAtt.Status;

        // Optimistički upis u cache + zatvori modal odmah
        const dt = new Date(date);
        const key = `${dt.getFullYear()}-${dt.getMonth() + 1}`;
        setAttendanceCache(prev => {
            const monthData = prev[key] || [];
            const filtered = monthData.filter(a => !(a.Worker_ID === workerId && a.Date === date));
            const rec: WorkerAttendance = {
                Attendance_ID: 'opt-' + Date.now(),
                Worker_ID: workerId,
                Worker_Name: workerName,
                Date: date,
                Status: yStatus,
                Notes: yAtt!.Notes || null,
                Created_Date: new Date().toISOString(),
                Organization_ID: organizationId,
            } as WorkerAttendance;
            return { ...prev, [key]: [...filtered, rec] };
        });
        setEditModalOpen(false);

        try {
            await markAttendanceAndRecalculate({
                Worker_ID: workerId,
                Worker_Name: workerName,
                Date: date,
                Status: yStatus,
                Notes: yAtt.Notes || null,
                Organization_ID: organizationId,
            } as any, { skipAutoBook: true });

            if (yStatus === 'Prisutan' || yStatus === 'Teren') {
                const yEntries = await getDailyWorkBooking(yesterday, organizationId);
                const mine = yEntries.find(e => e.workerId === workerId);
                if (mine && mine.items.length > 0) {
                    const targets = mine.items.map(bi => {
                        const wo = workOrders.find(w => w.Work_Order_ID === bi.workOrderId);
                        const item = wo?.items?.find(x => x.ID === bi.workOrderItemId);
                        return { workOrderId: bi.workOrderId, itemId: bi.workOrderItemId, productId: item?.Product_ID };
                    });
                    const res = await bookWorkerDayItems(workerId, workerName, date, organizationId, targets, mine.presence || 1);
                    // Nalozi su nezavisni dokumenti → preračunaj paralelno (bilo sekvencijalno, sporo).
                    // skipMaterialRefresh/skipStatusSync: čisto knjiženje rada ne mijenja materijal
                    // ni status proizvoda/projekta → isti obrazac kao saveDailyWorkBooking (brzo).
                    await Promise.all(res.affectedWorkOrderIds.map(woId =>
                        recalculateWorkOrder(woId, { skipMaterialRefresh: true, skipStatusSync: true }).catch(e => console.warn('recalc failed', woId, e))
                    ));
                    showToast(res.created > 0
                        ? `Kao jučer: ${yStatus} + ${res.created} dnevnica proknjiženo`
                        : `Kao jučer: ${yStatus} (dnevnice već postoje)`, 'success');
                } else {
                    // Jučer nije bilo knjiženja → standardni upit s prijedlogom.
                    const rows = buildBookingProposal([{ workerId, workerName, status: yStatus }], workOrders, date);
                    if (rows.length > 0) {
                        setConfirmRows(rows);
                        setConfirmDate(date);
                        setConfirmOpen(true);
                    } else {
                        showToast(`Kao jučer: ${yStatus}`, 'success');
                    }
                }
            } else {
                showToast(`Kao jučer: ${yStatus}`, 'success');
            }

            loadMonth(dt.getFullYear(), dt.getMonth() + 1);
            refreshBookedMonth(dt.getFullYear(), dt.getMonth() + 1);
            onRefresh('workers', 'workOrders');
        } catch (error) {
            showToast('Greška pri spremanju', 'error');
            loadMonth(dt.getFullYear(), dt.getMonth() + 1);
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
            // 2. Save all in parallel — skip per-worker recalculation (we batch it below) and
            //    skip auto-book (dnevnice se knjiže nakon potvrde u upitu).
            const results = await Promise.all(
                workersToUpdate.map(worker =>
                    markAttendanceAndRecalculate({
                        Worker_ID: worker.Worker_ID,
                        Worker_Name: worker.Name,
                        Date: bulkEditDate.dateStr,
                        Status: bulkStatuses[worker.Worker_ID] as any,
                        Notes: null,
                        Organization_ID: organizationId || undefined
                    }, { skipRecalculation: true, skipAutoBook: true })
                )
            );

            // 3. Single batch recalculation — only if any work logs were created/deleted
            const totalChanges = results.reduce((sum, r) => sum + r.workLogsCreated + r.workLogsDeleted, 0);
            if (totalChanges > 0 && organizationId) {
                try {
                    const { recalculateAllActiveWorkOrders } = await import('@/lib/services');
                    await recalculateAllActiveWorkOrders(organizationId, { includeCompleted: true });
                } catch (recalcError) {
                    console.error('Batch recalculation failed:', recalcError);
                }
            }

            // Odsutni dani uklanjaju auto-dnevnice; ručne se zadržavaju (rizik #5).
            const totalDeleted = results.reduce((sum, r) => sum + r.workLogsDeleted, 0);
            const totalManualKept = results.reduce((sum, r) => sum + (r.manualKept || 0), 0);
            if (totalManualKept > 0) {
                showToast(`Prisustvo sačuvano — uklonjeno ${totalDeleted} auto-dnevnica, zadržano ${totalManualKept} ručnih`, 'info');
            } else if (totalDeleted > 0) {
                showToast(`Prisustvo sačuvano za ${workersToUpdate.length} radnika — uklonjeno ${totalDeleted} dnevnica (odsutni)`, 'info');
            } else {
                showToast(`Prisustvo sačuvano za ${workersToUpdate.length} radnika`, 'success');
            }

            // Konsolidovani upit knjiženja za sve prisutne/teren radnike tog dana.
            const presentSaved = workersToUpdate
                .filter(w => bulkStatuses[w.Worker_ID] === 'Prisutan' || bulkStatuses[w.Worker_ID] === 'Teren')
                .map(w => ({ workerId: w.Worker_ID, workerName: w.Name, status: bulkStatuses[w.Worker_ID] }));
            if (presentSaved.length > 0) {
                await openBookingConfirm(presentSaved, bulkEditDate.dateStr);
            }

            loadMonth(date.getFullYear(), date.getMonth() + 1);
            refreshBookedMonth(date.getFullYear(), date.getMonth() + 1);
            onRefresh('workers', 'workOrders');
        } catch (error) {
            showToast('Greška pri čuvanju prisustva', 'error');
            loadMonth(date.getFullYear(), date.getMonth() + 1);
        }
    }

    // ============================================
    // KNJIŽENJE NA POTVRDU (iz upita)
    // ============================================

    // Prikupi CILJNE stavke za radnika na nalogu: bira dodijeljene (ili sve) nezavršene stavke,
    // POKRENE PONOVO pauzirane stavke i starta nalog ako je još „Na čekanju".
    // NE knjiži — cijeli dan radnika se knjiži JEDNIM bookWorkerDayItems (jedna renormalizacija),
    // pa radnik na više naloga ne pokreće renormalizeWorkerDay/getWorkers po svakom nalogu.
    // startWarnings: startWorkOrder vraća {success,message} (ne baca) — neuspjeh starta se
    // prikuplja i prijavljuje korisniku; dnevnica se IPAK knjiži (trošak nezavisan od statusa),
    // ali nepokrenut nalog ne bi primao auto-dnevnice narednih dana, pa korisnik mora znati.
    async function prepareWorkerOrderTargets(workerId: string, orgId: string, workOrderId: string, startWarnings?: string[]): Promise<{ workOrderId: string; itemId: string; productId?: string }[]> {
        const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
        if (!wo) return [];
        const all = wo.items || [];
        const live = all.filter(it => it.Status !== 'Završeno');
        const base = live.length > 0 ? live : all;   // sve završeno (npr. teren na gotovom nalogu) → ipak knjiži
        const assigned = base.filter(it =>
            isWorkerAssignedToAutoItem({ ID: it.ID, Assigned_Workers: it.Assigned_Workers, Processes: it.Processes, SubTasks: it.SubTasks }, workerId)
        );
        const chosen = assigned.length > 0 ? assigned : base;
        if (chosen.length === 0) return [];

        // Pokreni ponovo pauzirane stavke koje knjižimo.
        for (const it of chosen) {
            if (it.Is_Paused) {
                try { await toggleItemPause(workOrderId, it.ID, false); } catch (e) { console.warn('resume failed', it.ID, e); }
            }
        }
        // Startaj nalog ako još nije pokrenut.
        if (wo.Status === 'Na čekanju') {
            try {
                const res = await startWorkOrder(workOrderId, orgId);
                if (!res.success) startWarnings?.push(`„${workOrderDisplayName(wo)}" nije pokrenut: ${res.message}`);
            } catch (e) {
                console.warn('start failed', workOrderId, e);
                startWarnings?.push(`„${workOrderDisplayName(wo)}" nije pokrenut (greška pri startu)`);
            }
        }

        return chosen.map(it => ({ workOrderId, itemId: it.ID, productId: it.Product_ID }));
    }

    async function commitDecisions(decisions: BookingDecision[]) {
        const orgId = organizationId || '';
        const date = confirmDate;
        let booked = 0;
        const affectedOrders = new Set<string>();
        const touchedCompleted = new Set<string>();
        // Radnik čije je knjiženje palo u grešku — obrađuje se PO RADNIKU (ne jedan try za sve),
        // da greška kod jednog ne blokira knjiženje ostalih, i da se tačno zna KO nije proknjižen.
        const failedWorkers: string[] = [];
        // Nalozi 'Na čekanju' koje potvrda pokušava startati, a start odbije (npr. materijal
        // nije primljen) — dnevnica se knjiži svejedno, ali korisnik mora vidjeti razlog.
        const startWarnings: string[] = [];
        const noteAffected = (orderId: string) => {
            affectedOrders.add(orderId);
            if (workOrders.find(w => w.Work_Order_ID === orderId)?.Status === 'Završeno') touchedCompleted.add(orderId);
        };

        // 1) Prikupi ciljeve PO RADNIKU (radnik na više naloga = SVI ciljevi u jednom knjiženju).
        const perWorker = new Map<string, { workerName: string; presence: 0.5 | 1; targets: { workOrderId: string; itemId: string; productId?: string }[] }>();
        for (const d of decisions) {
            const presence: 0.5 | 1 = d.presence === 0.5 ? 0.5 : 1;
            const orderIds: string[] = d.kind === 'present'
                ? d.orderIds
                : (d.choice.mode === 'order' ? [d.choice.workOrderId] : []);
            if (orderIds.length === 0) continue;
            const entry = perWorker.get(d.workerId) || { workerName: d.workerName, presence, targets: [] };
            for (const orderId of orderIds) {
                try {
                    const t = await prepareWorkerOrderTargets(d.workerId, orgId, orderId, startWarnings);
                    entry.targets.push(...t);
                    noteAffected(orderId);
                } catch (e) {
                    console.error(`commitDecisions: priprema za ${d.workerName} (${orderId}) nije uspjela`, e);
                    if (!failedWorkers.includes(d.workerName)) failedWorkers.push(d.workerName);
                }
            }
            if (entry.targets.length > 0) perWorker.set(d.workerId, entry);
        }

        // 2) Knjiži PO RADNIKU, PARALELNO — svaki: JEDAN bookWorkerDayItems (→ jedna renormalizacija dana).
        const results = await Promise.all(Array.from(perWorker.entries()).map(async ([workerId, w]) => {
            try {
                const res = await bookWorkerDayItems(workerId, w.workerName, date, orgId, w.targets, w.presence);
                res.affectedWorkOrderIds.forEach(id => noteAffected(id));
                return res.created;
            } catch (e) {
                console.error(`commitDecisions: knjiženje za ${w.workerName} nije uspjelo`, e);
                if (!failedWorkers.includes(w.workerName)) failedWorkers.push(w.workerName);
                return 0;
            }
        }));
        booked = results.reduce((s, n) => s + n, 0);

        try {
            // Preračunaj pogođene naloge: osvježi Actual_Labor_Cost/Profit na dokumentu naloga;
            // završeni nalozi pritom dobiju NOVI production snapshot (rizik #4) + dosljedan prikaz.
            // Nalozi su nezavisni dokumenti → paralelno (bio je glavni uzrok sporog knjiženja kad
            // je radnik dodijeljen na više naloga odjednom).
            // skipMaterialRefresh/skipStatusSync: knjiženje dnevnice ne mijenja materijal ni status
            // proizvoda/projekta (isti obrazac kao saveDailyWorkBooking) — bez ovoga se ovdje ponovo
            // dohvatao materijal po stavci I skenirali SVI aktivni nalozi organizacije (syncProjectStatus),
            // što je bio glavni uzrok sporog potvrđivanja knjiženja. skipSnapshot NIJE postavljen —
            // završeni nalozi i dalje dobiju svjež production snapshot (namjerno, vidi komentar iznad).
            await Promise.all(Array.from(affectedOrders).map(orderId =>
                recalculateWorkOrder(orderId, { skipMaterialRefresh: true, skipStatusSync: true }).catch(e => console.warn('recalc failed', orderId, e))
            ));
            if (touchedCompleted.size > 0) {
                showToast(`Ažurirano ${touchedCompleted.size} završen${touchedCompleted.size > 1 ? 'a naloga' : ' nalog'} — profit preračunat`, 'info');
            }

            // Neuspjeli auto-start naloga: dnevnice su knjižene, ali nalog je ostao 'Na čekanju'
            // → neće primati auto-dnevnice narednih dana dok se uzrok ne otkloni.
            for (const w of Array.from(new Set(startWarnings))) {
                showToast(w, 'error');
            }

            if (failedWorkers.length > 0) {
                showToast(`Greška pri knjiženju za: ${failedWorkers.join(', ')}${booked > 0 ? ` — ostalo (${booked}) proknjiženo` : ''}`, 'error');
            } else if (booked > 0) {
                showToast(`Proknjiženo ${booked} dnevnica`, 'success');
            } else {
                showToast('Dnevnice nisu knjižene', 'info');
            }
            onRefresh('workers', 'workOrders');
            const dt = new Date(date);
            loadMonth(dt.getFullYear(), dt.getMonth() + 1);
            refreshBookedMonth(dt.getFullYear(), dt.getMonth() + 1);
        } catch (e) {
            console.error('commitDecisions error', e);
            showToast('Greška pri knjiženju dnevnica', 'error');
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
                        <button className="glass-btn" onClick={() => setPayrollOpen(true)} style={{ padding: '8px 14px', fontWeight: 600 }} title="Mjesečni obračun plata iz šihtarice i dnevnika rada">
                            <Users size={16} />
                            Obračun
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
                                            {/* Brojač "prisutni bez knjiženja" — klik otvara upit knjiženja za te radnike */}
                                            {(() => {
                                                const unbooked = activeWorkers.filter(w => {
                                                    const a = getAttendance(w.Worker_ID, dayInfo.dateStr);
                                                    return a && (a.Status === 'Prisutan' || a.Status === 'Teren')
                                                        && isBookedInfo(w.Worker_ID, dayInfo.dateStr) === false;
                                                });
                                                if (unbooked.length === 0) return null;
                                                return (
                                                    <div
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            const opened = await openBookingConfirm(
                                                                unbooked.map(w => ({
                                                                    workerId: w.Worker_ID,
                                                                    workerName: w.Name,
                                                                    status: getAttendance(w.Worker_ID, dayInfo.dateStr)!.Status,
                                                                })),
                                                                dayInfo.dateStr,
                                                            );
                                                            if (!opened) {
                                                                showToast('Nema kandidata za knjiženje (provjeri naloge/dodjele)', 'info');
                                                            }
                                                        }}
                                                        title={`${unbooked.length} prisutn${unbooked.length === 1 ? 'i radnik' : 'a radnika'} bez knjižene dnevnice — klikni za knjiženje`}
                                                        style={{
                                                            marginTop: '3px',
                                                            fontSize: '9px',
                                                            fontWeight: 700,
                                                            color: '#64748b',
                                                            background: '#f1f5f9',
                                                            border: '1px solid #cbd5e1',
                                                            borderRadius: '999px',
                                                            padding: '1px 5px',
                                                            display: 'inline-block',
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        {unbooked.length}!
                                                    </div>
                                                );
                                            })()}
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
                                            // Prisutan/Teren bez ijedne dnevnice → suptilna donja ivica (bez bedža)
                                            const presentUnbooked = !!attendance
                                                && (attendance.Status === 'Prisutan' || attendance.Status === 'Teren')
                                                && isBookedInfo(worker.Worker_ID, dayInfo.dateStr) === false;

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
                                                        borderBottom: presentUnbooked ? '3px solid #94a3b8' : undefined,
                                                        position: 'relative'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.background = display ? display.bg : (isToday ? '#dbeafe' : isWeekend ? '#fef3c7' : '#f8fafc');
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.background = isToday ? '#eff6ff' : isWeekend ? '#fef3c7' : 'white';
                                                    }}
                                                    title={presentUnbooked
                                                        ? `${attendance!.Status} — dnevnica NIJE proknjižena (klikni za označavanje/knjiženje)`
                                                        : attendance?.Notes || (isToday ? 'Danas - klikni za označavanje' : 'Klikni za označavanje')}
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
                        {selectedCell && (() => {
                            const yStatus = yesterdayStatusOf(selectedCell.workerId, selectedCell.date);
                            return (
                                <button
                                    className="glass-btn"
                                    onClick={handleRepeatYesterday}
                                    title={yStatus
                                        ? `Ponovi jučerašnji dan: ${yStatus}${(yStatus === 'Prisutan' || yStatus === 'Teren') ? ' + isti nalozi' : ''}`
                                        : 'Ponovi jučerašnji status i knjiženje'}
                                    style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                >
                                    <History size={15} />
                                    Kao jučer{yStatus ? ` (${yStatus})` : ''}
                                </button>
                            );
                        })()}
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
                            {/* Kao jučer: svaki radnik dobije svoj jučerašnji status (bez jučerašnjeg unosa → ne mijenja se) */}
                            {bulkEditDate && (
                                <button
                                    className="glass-btn"
                                    onClick={() => {
                                        const next: Record<string, string> = { ...bulkStatuses };
                                        let applied = 0;
                                        activeWorkers.forEach(w => {
                                            const ys = yesterdayStatusOf(w.Worker_ID, bulkEditDate.dateStr);
                                            if (ys) { next[w.Worker_ID] = ys; applied++; }
                                        });
                                        setBulkStatuses(next);
                                        showToast(applied > 0
                                            ? `Postavljeno "kao jučer" za ${applied} radnika`
                                            : 'Nema jučerašnjih unosa', applied > 0 ? 'success' : 'info');
                                    }}
                                    title="Svakom radniku postavi status koji je imao jučer"
                                    style={{ padding: '8px 14px', fontSize: '13px', gap: '6px', fontWeight: 600 }}
                                >
                                    <History size={16} />
                                    Kao jučer
                                </button>
                            )}
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

            {/* Upit knjiženja dnevnica nakon unosa prisustva */}
            {confirmOpen && (
                <AttendanceBookingConfirmModal
                    isOpen={confirmOpen}
                    onClose={() => setConfirmOpen(false)}
                    date={confirmDate}
                    rows={confirmRows}
                    workOrders={workOrders}
                    workers={workers}
                    organizationId={organizationId || ''}
                    onConfirm={commitDecisions}
                    onCreated={onRefresh}
                    showToast={showToast}
                />
            )}

            {/* Mjesečni obračun plata */}
            {payrollOpen && (
                <PayrollModal
                    isOpen={payrollOpen}
                    onClose={() => setPayrollOpen(false)}
                    workers={workers}
                    organizationId={organizationId || ''}
                    showToast={showToast}
                />
            )}

            {/* Styles moved to globals.css */}
        </div>
    );
}
