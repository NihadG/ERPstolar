'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import type { WorkOrder, Worker, WorkOrderItem, WorkerConflict, WorkLog } from '@/lib/types';
import { scheduleWorkOrder, unscheduleWorkOrder, startWorkOrder, checkWorkerConflicts, rescheduleWorkOrder, updateDueDate, updatePlannedStartDate, getAllAttendanceByMonth, formatLocalDateISO } from '@/lib/services';
import { weeklyCapacity, plannedVsActualDays, itemsWithoutPlannedDays, todayISO, type AttendanceLite, type CapacityOrderInput } from '@/lib/planning';
import { buildWorkTimeline, type WorkTimelineDay, type WorkDayType, type PausePeriodLite } from '@/lib/workOrderTimeline';
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
    workLogs: WorkLog[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

// Status-based colors — vezano na app dizajn-tokene (globals.css) radi konzistentnosti
type StatusKey = 'scheduled' | 'inProgress' | 'paused' | 'completed';

const STATUS_COLORS: Record<StatusKey, string> = {
    scheduled: 'var(--accent)',    // Plava - Planirano/Zakazano
    inProgress: 'var(--success)',  // Zelena - U proizvodnji
    paused: 'var(--warning)',      // Narandžasta - Pauzirano
    completed: 'var(--text-secondary)' // Siva - Završeno
};

// LOKALNI datumski ključ (YYYY-MM-DD) — NE toISOString(): u UTC+ zonama lokalna ponoć
// se pod UTC vrati na prethodni dan pa je 6. juli prikazivan kao 7. Kanonski helper iz
// lib/services (isti kao workOrderTimeline.toLocalISO), pa se ključevi kalendara i timeline-a poklapaju.
const formatDateKey = formatLocalDateISO;

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

// Status key za nalog — jedan izvor istine za boju/labelu/CSS klasu bara
const getStatusKey = (wo: WorkOrder): StatusKey => {
    const items = wo.items || [];
    if (items.length === 0) {
        // No items - use WO-level status
        if (wo.Status === 'Završeno') return 'completed';
        if (wo.Status === 'U toku') return 'inProgress';
        return 'scheduled';
    }

    // Check if ALL items are fully paused (WO is paused)
    const allPaused = items.every(item => isItemFullyPaused(item));
    // Check if ANY item has active (in-progress, non-paused) work
    const anyActive = items.some(item => isItemActive(item));
    // Check if WO is completed
    const allCompleted = items.every(item => item.Status === 'Završeno');

    if (wo.Status === 'Završeno' || allCompleted) return 'completed';
    if (allPaused && wo.Status !== 'Na čekanju') return 'paused';
    if (anyActive || wo.Status === 'U toku') return 'inProgress';
    return 'scheduled';
};

const STATUS_META: Record<StatusKey, { text: string; icon: typeof Clock }> = {
    scheduled: { text: 'Zakazano', icon: Clock },
    inProgress: { text: 'U toku', icon: Play },
    paused: { text: 'Pauzirano', icon: Pause },
    completed: { text: 'Završeno', icon: CheckCircle },
};

// Get status color for work order
const getStatusColor = (wo: WorkOrder): string => STATUS_COLORS[getStatusKey(wo)];

// Get status label
const getStatusLabel = (wo: WorkOrder): { text: string; icon: typeof Clock } => STATUS_META[getStatusKey(wo)];

// Get project name from work order
const getProjectName = (wo: WorkOrder): string => {
    if (wo.Name && wo.Name.trim()) return wo.Name.trim();
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

export default function PlannerTab({ workOrders, workers, workLogs, onRefresh, showToast }: PlannerTabProps) {
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

    const visibleDates = useMemo(() => getDateRange(viewStart, days), [viewStart, days]);

    // ── Sedmični kapacitet: šihtarica (prošli/tekući/naredni mjesec) za rotaciju subota + buduće odsutnosti ──
    const [attLite, setAttLite] = useState<AttendanceLite[]>([]);
    useEffect(() => {
        if (!orgId) return;
        const now = new Date();
        const months: { y: number; m: number }[] = [-1, 0, 1].map(off => {
            const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
            return { y: d.getFullYear(), m: d.getMonth() + 1 };
        });
        Promise.all(months.map(mm => getAllAttendanceByMonth(String(mm.y), String(mm.m), orgId)))
            .then(res => setAttLite(res.flat() as AttendanceLite[]))
            .catch(err => console.warn('capacity attendance load:', err));
    }, [orgId]);

    // Raspoloživi vs planirani radnik-dani po sedmici vidljivog raspona
    const capacityWeeks = useMemo(() => {
        const activeWorkerIds = workers
            .filter(w => w.Status === 'Aktivan' || w.Status === 'Dostupan')
            .map(w => w.Worker_ID);
        if (activeWorkerIds.length === 0) return [];
        const capOrders: CapacityOrderInput[] = workOrders
            .filter(wo => wo.Status === 'U toku' || (wo.Status === 'Na čekanju' && wo.Is_Scheduled))
            .map(wo => {
                const dp = plannedVsActualDays(wo.items || [], workLogs);
                return {
                    id: wo.Work_Order_ID,
                    startISO: (wo.Started_At || wo.Planned_Start_Date || todayISO()).split('T')[0],
                    endISO: (wo.Due_Date || wo.Planned_End_Date || '').split('T')[0],
                    remainingWorkerDays: Math.max(0, dp.planned - dp.actual),
                };
            })
            .filter(o => o.remainingWorkerDays > 0);
        return weeklyCapacity(formatDateKey(viewStart), Math.max(1, Math.ceil(days / 7)), activeWorkerIds, attLite, capOrders);
    }, [workOrders, workers, workLogs, attLite, viewStart, days]);

    // Advisory: aktivni/zakazani proizvodni nalozi sa stavkama bez planiranih dana (nedopunjena
    // ponuda) potcjenjuju gornji kapacitet — montaža se isključuje (ona namjerno nema planirane dane).
    const capacityGapOrders = useMemo(() => {
        return workOrders.filter(wo =>
            wo.Work_Order_Type !== 'Montaža' &&
            (wo.Status === 'U toku' || (wo.Status === 'Na čekanju' && wo.Is_Scheduled)) &&
            itemsWithoutPlannedDays(wo.items || []) > 0
        ).length;
    }, [workOrders]);

    // Auto-forward: For 'Na čekanju' orders whose planned start is in the past,
    // shift both start and end dates forward so the bar starts from today.
    const scheduled = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = formatDateKey(today);

        return workOrders
            .filter(wo => wo.Is_Scheduled && wo.Planned_Start_Date)
            .map(wo => {
                // Only auto-forward waiting orders with past start dates
                if (wo.Status !== 'Na čekanju' || !wo.Planned_Start_Date) return wo;

                const plannedStart = new Date(wo.Planned_Start_Date);
                plannedStart.setHours(0, 0, 0, 0);

                if (plannedStart >= today) return wo; // Not expired

                // Calculate shift in days
                const shiftDays = Math.round((today.getTime() - plannedStart.getTime()) / 86400000);
                const oldEnd = wo.Planned_End_Date ? new Date(wo.Planned_End_Date) : plannedStart;
                const newEnd = new Date(oldEnd);
                newEnd.setDate(newEnd.getDate() + shiftDays);

                return {
                    ...wo,
                    Planned_Start_Date: todayStr,
                    Planned_End_Date: formatDateKey(newEnd),
                };
            });
    }, [workOrders]);

    const backlog = useMemo(() =>
        workOrders.filter(wo => !wo.Is_Scheduled && wo.Status !== 'Završeno' && wo.Status !== 'Otkazano'),
        [workOrders]
    );

    // TRENUTNA EKIPA po nalogu — radnici sa ZADNJEG zabilježenog dana (dnevnik = izvor istine).
    // Time Planer prati rotaciju: kad se radnik zamijeni, stari (raniji dani) više se ne prikazuje,
    // a prikazuju se samo oni koji su zadnji put radili na nalogu. (Cijela historija je u timeline-u.)
    const workerIdsByWO = useMemo(() => {
        const latestDate = new Map<string, string>();
        workLogs.forEach(l => {
            if (!l.Work_Order_ID || !l.Worker_ID || !l.Date) return;
            const cur = latestDate.get(l.Work_Order_ID);
            if (!cur || l.Date > cur) latestDate.set(l.Work_Order_ID, l.Date);
        });
        const m = new Map<string, Set<string>>();
        workLogs.forEach(l => {
            if (!l.Work_Order_ID || !l.Worker_ID || !l.Date) return;
            if (l.Date !== latestDate.get(l.Work_Order_ID)) return;  // samo zadnji radni dan naloga
            if (!m.has(l.Work_Order_ID)) m.set(l.Work_Order_ID, new Set());
            m.get(l.Work_Order_ID)!.add(l.Worker_ID);
        });
        return m;
    }, [workLogs]);

    const getWorkerIds = (wo: WorkOrder): string[] => {
        // 1) Ako ima zabilježenog rada → prikaži samo radnike koji su stvarno radili
        const fromLogs = workerIdsByWO.get(wo.Work_Order_ID);
        if (fromLogs && fromLogs.size > 0) return Array.from(fromLogs);
        // 2) Inače (nalog još nije ni počeo) → planirani radnici iz dodjele
        const ids = new Set<string>();
        wo.items?.forEach(item => {
            (item.Assigned_Workers || []).forEach(w => { if (w.Worker_ID) ids.add(w.Worker_ID); });
            item.Processes?.forEach(p => {
                if (p.Worker_ID) ids.add(p.Worker_ID);
                p.Helpers?.forEach(h => { if (h.Worker_ID) ids.add(h.Worker_ID); });
            });
        });
        return Array.from(ids);
    };

    const workerOrders = useMemo(() => {
        const map = new Map<string, WorkOrder[]>();
        workers.forEach(w => map.set(w.Worker_ID, []));

        scheduled.forEach(wo => {
            const wids = getWorkerIds(wo);
            if (wids.length > 0) {
                wids.forEach(wid => {
                    if (map.has(wid)) map.get(wid)!.push(wo);
                });
            } else {
                workers.forEach(w => map.get(w.Worker_ID)!.push(wo));
            }
        });

        return map;
    }, [scheduled, workers, workerIdsByWO]);

    // Sort workers: active orders first, then scheduled, then alphabetically
    const allWorkers = useMemo(() => {
        return [...workers].sort((a, b) => {
            const aOrders = workerOrders.get(a.Worker_ID) || [];
            const bOrders = workerOrders.get(b.Worker_ID) || [];

            const hasActive = (orders: WorkOrder[]) => orders.some(wo => wo.Status === 'U toku');
            const hasScheduled = (orders: WorkOrder[]) => orders.some(wo => wo.Status === 'Na čekanju' && wo.Is_Scheduled);

            const aActive = hasActive(aOrders);
            const bActive = hasActive(bOrders);
            if (aActive !== bActive) return aActive ? -1 : 1;

            const aScheduled = hasScheduled(aOrders);
            const bScheduled = hasScheduled(bOrders);
            if (aScheduled !== bScheduled) return aScheduled ? -1 : 1;

            return (a.Name || '').localeCompare(b.Name || '', 'hr');
        });
    }, [workers, workerOrders]);

    // ── Traka po danu: prošli dani prema DNEVNIKU RADA (buildWorkTimeline), budući dani
    // projicirani do ROKA (Due_Date). Indeksi rade po (radnik × nalog) paru jer isti nalog
    // može imati različitu "priču" za svakog dodijeljenog radnika (ko je kad radio/pauzirao).
    const logsByWorkerOrder = useMemo(() => {
        const m = new Map<string, WorkLog[]>();
        workLogs.forEach(l => {
            if (!l.Worker_ID || !l.Work_Order_ID) return;
            const key = `${l.Worker_ID}::${l.Work_Order_ID}`;
            if (!m.has(key)) m.set(key, []);
            m.get(key)!.push(l);
        });
        return m;
    }, [workLogs]);

    const pausePeriodsByWO = useMemo(() => {
        const m = new Map<string, PausePeriodLite[]>();
        workOrders.forEach(wo => {
            const periods: PausePeriodLite[] = [];
            (wo.items || []).forEach(item => {
                (item.Pause_Periods || []).forEach(p => periods.push({ Started_At: p.Started_At, Ended_At: p.Ended_At }));
            });
            if (periods.length > 0) m.set(wo.Work_Order_ID, periods);
        });
        return m;
    }, [workOrders]);

    // Timeline (dan-po-dan) po (radnik, nalog) — samo za parove koji se stvarno prikazuju.
    const timelineByWorkerOrder = useMemo(() => {
        const m = new Map<string, WorkTimelineDay[]>();
        const today = new Date();
        workerOrders.forEach((orders, workerId) => {
            orders.forEach(wo => {
                const key = `${workerId}::${wo.Work_Order_ID}`;
                if (m.has(key)) return;
                const logs = logsByWorkerOrder.get(key) || [];
                const isFinal = wo.Status === 'Završeno' || wo.Status === 'Otkazano';
                const dueOrPlannedEnd = wo.Due_Date || wo.Planned_End_Date;
                const days = buildWorkTimeline({
                    logs,
                    startedAt: wo.Started_At || wo.Planned_Start_Date,
                    completedAt: wo.Completed_At,
                    pausePeriods: pausePeriodsByWO.get(wo.Work_Order_ID),
                    // Budući dani se projiciraju do ROKA (ne do stare Planned_End_Date) — samo za AKTIVNE naloge.
                    extraDates: !isFinal && dueOrPlannedEnd ? new Set([dueOrPlannedEnd.split('T')[0]]) : undefined,
                    today,
                });
                if (days.length > 0) m.set(key, days);
            });
        });
        return m;
    }, [workerOrders, logsByWorkerOrder, pausePeriodsByWO]);

    interface BarSegment { date: string; dayType: WorkDayType }
    interface BarLayout { left: number; width: number; segments: BarSegment[] }

    // Visina jedne "trake" (lane) u redu radnika — bar (32px) + razmak, koristi se kad se
    // naloge istog radnika preklapaju u vremenu (svaki preklop dobije svoj red umjesto da
    // se crtaju jedan preko drugog).
    const LANE_SLOT = 44;

    const getBarLayout = (workerId: string, wo: WorkOrder): BarLayout | null => {
        const timeline = timelineByWorkerOrder.get(`${workerId}::${wo.Work_Order_ID}`);
        if (!timeline || timeline.length === 0) return null;

        const dayMap = new Map(timeline.map(d => [d.date, d]));

        const segments: BarSegment[] = [];
        let firstIdx = -1, lastIdx = -1;
        visibleDates.forEach((d, idx) => {
            const key = formatDateKey(d);
            const day = dayMap.get(key);
            if (!day) return;
            if (firstIdx === -1) firstIdx = idx;
            lastIdx = idx;
            segments.push({ date: key, dayType: day.dayType });
        });
        if (firstIdx === -1) return null;

        const left = firstIdx * cellWidth;
        const width = (lastIdx - firstIdx + 1) * cellWidth;
        if (width <= 0) return null;
        return { left, width, segments };
    };

    // Boje NAMJERNO ne koriste plavu (to je već "Zakazano" u legendi statusa gore) da se
    // značenja ne miješaju. Radio = zeleno (isto kao "U toku"), pauza = narandžasto (isto
    // kao legenda "Pauzirano"), planirano/do roka = neutralno sivo ("duh" traka).
    // Stil je definisan u CSS-u (klase) radi lakše kontrole gradijenata/tekstura.
    const DAY_ZONE_CLASS: Record<WorkDayType, string> = {
        working: 'zone-working',
        paused: 'zone-paused',
        future: 'zone-future',
        weekend: 'zone-empty',
        holiday: 'zone-empty',
        no_work: 'zone-empty',
    };

    const DAY_TYPE_LABEL: Record<WorkDayType, string> = {
        working: 'radio',
        paused: 'pauzirano',
        future: 'planirano (do roka)',
        weekend: 'vikend',
        holiday: 'praznik',
        no_work: 'nema zapisa',
    };

    // Spoji uzastopne dane ISTOG tipa u jednu zonu — bez ovoga bi svaki dan bio zaseban div
    // sa vlastitim šrafiranim uzorkom, pa bi npr. 3 uzastopna pauzirana dana izgledala kao
    // 3 vidljivo razdvojena "šahovska" polja umjesto jedne čitljive pauzirane trake.
    interface BarZone { dayType: WorkDayType; days: number }
    const toZones = (segments: BarSegment[]): BarZone[] => {
        const zones: BarZone[] = [];
        for (const seg of segments) {
            const last = zones[zones.length - 1];
            if (last && last.dayType === seg.dayType) last.days++;
            else zones.push({ dayType: seg.dayType, days: 1 });
        }
        return zones;
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

    // Detail Panel functions — always read fresh data from workOrders prop
    const openDetailPanel = (wo: WorkOrder) => {
        setDetailPanel({ open: true, wo });
    };

    // Keep detail panel data fresh when workOrders prop changes
    const detailWoId = detailPanel.wo?.Work_Order_ID;
    const detailWo = detailWoId
        ? workOrders.find(w => w.Work_Order_ID === detailWoId) || detailPanel.wo
        : null;

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
                    <span className="planner-icon-badge"><Calendar size={18} /></span>
                    <div className="planner-title-text">
                        <h1>Planer</h1>
                        <div className="status-legend">
                            <div className="legend-group">
                                <span className="legend-group-label">Nalog</span>
                                <span className="legend-chip"><span className="dot" style={{ background: STATUS_COLORS.scheduled }} />Zakazano</span>
                                <span className="legend-chip"><span className="dot" style={{ background: STATUS_COLORS.inProgress }} />U toku</span>
                                <span className="legend-chip"><span className="dot" style={{ background: STATUS_COLORS.paused }} />Pauzirano</span>
                            </div>
                            <div className="legend-sep" />
                            <div className="legend-group">
                                <span className="legend-group-label">Dani</span>
                                <span className="legend-chip"><span className="dot zone-working" />Radio</span>
                                <span className="legend-chip"><span className="dot zone-paused" />Pauza</span>
                                <span className="legend-chip"><span className="dot zone-future" />Planirano</span>
                            </div>
                        </div>
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
                        <button onClick={() => setDays(Math.max(7, days - 7))} disabled={days <= 7} title="Uže"><ZoomIn size={16} /></button>
                        <span>{days}d</span>
                        <button onClick={() => setDays(Math.min(28, days + 7))} disabled={days >= 28} title="Šire"><ZoomOut size={16} /></button>
                    </div>
                </div>
            </div>

            {/* Gantt: backlog + kapacitet + tabela u JEDNOM scroll okviru, da red datuma
               ostane zamrznut (sticky top), a backlog/kapacitet otklizaju pri skrolanju. */}
            <DragDropContext onDragEnd={onDragEnd}>
                <div className="gantt-table">
                    <div className="gantt-prehead">
            {/* Backlog */}
            <div className="planner-backlog">
                <div className="backlog-label">
                    <Package size={14} />
                    <span>Nezakazani</span>
                    <span className="backlog-count">{backlog.length}</span>
                </div>
                <div className="backlog-list">
                    {backlog.length === 0 ? (
                        <span className="backlog-empty"><CheckCircle size={14} /> Svi zakazani</span>
                    ) : (
                        backlog.map(wo => (
                            <button key={wo.Work_Order_ID} className="backlog-item" onClick={() => openScheduleModal(wo)}>
                                <span className="backlog-item-icon"><Box size={13} /></span>
                                <span className="backlog-item-text">
                                    <strong>{getProjectName(wo)}</strong>
                                    <span>{wo.Work_Order_Number}</span>
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Sedmični kapacitet: planirani vs raspoloživi radnik-dani */}
            {capacityWeeks.length > 0 && (
                <div className="capacity-strip">
                    {capacityGapOrders > 0 && (
                        <div
                            className="capacity-gap-note"
                            title={`${capacityGapOrders} ${capacityGapOrders === 1 ? 'nalog nema' : 'naloga nemaju'} planirane dane na dijelu stavki (ponuda nedopunjena) — opterećenje ispod je potcijenjeno`}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#92400e', padding: '2px 6px' }}
                        >
                            <AlertTriangle size={12} />
                            {capacityGapOrders} {capacityGapOrders === 1 ? 'nalog' : 'naloga'} bez planiranih dana — kapacitet potcijenjen
                        </div>
                    )}
                    {capacityWeeks.map(wk => {
                        const over = wk.ratio !== null && wk.ratio > 1;
                        const tight = wk.ratio !== null && wk.ratio > 0.85 && wk.ratio <= 1;
                        const state = over ? 'over' : tight ? 'tight' : 'ok';
                        const pct = wk.ratio === null ? 0 : Math.min(100, Math.round(wk.ratio * 100));
                        const fmtD = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
                        const label = `${new Date(wk.weekStartISO + 'T00:00:00').toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric' })}–${new Date(wk.weekEndISO + 'T00:00:00').toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric' })}`;
                        return (
                            <div
                                key={wk.weekStartISO}
                                className={`capacity-card state-${state}`}
                                title={`Sedmica ${label}: planirano ${fmtD(wk.planned)} od raspoloživih ${fmtD(wk.available)} radnik-dana${over ? ' — PREBUKIRANO' : ''}`}
                            >
                                <div className="capacity-card-head">
                                    <span className="capacity-card-label">{label}</span>
                                    <span className="capacity-card-value">{fmtD(wk.planned)}/{fmtD(wk.available)} rd</span>
                                </div>
                                <div className="capacity-track">
                                    <div className="capacity-fill" style={{ width: `${pct}%` }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
                    </div>{/* /gantt-prehead */}

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

                                // Nezavisne trake (lanes) za naloge koji se PREKLAPAJU u vremenu —
                                // umjesto da se crtaju jedan preko drugog, svaki dobije svoj red.
                                const withLayout = orders
                                    .map(wo => ({ wo, layout: getBarLayout(worker.Worker_ID, wo) }))
                                    .filter((x): x is { wo: WorkOrder; layout: BarLayout } => !!x.layout)
                                    .sort((a, b) => a.layout.left - b.layout.left);
                                const laneEnds: number[] = [];
                                const placedBars = withLayout.map(({ wo, layout }) => {
                                    const right = layout.left + layout.width;
                                    let lane = laneEnds.findIndex(end => end <= layout.left);
                                    if (lane === -1) { lane = laneEnds.length; laneEnds.push(right); }
                                    else { laneEnds[lane] = right; }
                                    return { wo, layout, lane };
                                });
                                const laneCount = Math.max(1, laneEnds.length);
                                const timelineHeight = Math.max(56, laneCount * LANE_SLOT + 16);

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

                                        <div className="gantt-timeline" style={{ width: totalWidth, height: timelineHeight }}>
                                            {visibleDates.map(d => (
                                                <div
                                                    key={formatDateKey(d)}
                                                    className={`timeline-cell ${isToday(d) ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''}`}
                                                    style={{ width: cellWidth }}
                                                />
                                            ))}

                                            {placedBars.map(({ wo, layout, lane }) => {
                                                const statusKey = getStatusKey(wo);
                                                const statusColor = STATUS_COLORS[statusKey];
                                                const statusInfo = STATUS_META[statusKey];
                                                const StatusIcon = statusInfo.icon;
                                                const deadlineStatus = getDeadlineWarning(wo);
                                                const dueStr = (wo.Due_Date || wo.Planned_End_Date)?.split('T')[0];
                                                const dueIdx = dueStr ? layout.segments.findIndex(s => s.date === dueStr) : -1;
                                                const pinLeft = dueIdx >= 0 ? (dueIdx + 1) * cellWidth : null;
                                                const segSummary = layout.segments.map(s => `${s.date}: ${DAY_TYPE_LABEL[s.dayType]}`).join('\n');

                                                return (
                                                    <div
                                                        key={wo.Work_Order_ID}
                                                        className={`order-bar status-${statusKey} ${deadlineStatus !== 'ok' ? `deadline-${deadlineStatus}` : ''}`}
                                                        style={{
                                                            left: layout.left + 3,
                                                            width: layout.width - 6,
                                                            top: lane * LANE_SLOT + 8,
                                                        }}
                                                        title={`${getProjectName(wo)} (${wo.Work_Order_Number})${deadlineStatus === 'overdue' ? ' ⚠️ ROK PREKORAČEN!' : deadlineStatus === 'approaching' ? ' ⏰ Rok se približava' : ''}\n${segSummary}`}
                                                        onClick={() => openDetailPanel(wo)}
                                                    >
                                                        {/* Glavni red: čitljivo ime + status (puna boja statusa) */}
                                                        <div className="order-bar-row" style={{ background: statusColor }}>
                                                            <span className="order-bar-name">
                                                                <StatusIcon size={11} className="order-bar-status-icon" />
                                                                {deadlineStatus === 'overdue' && <AlertTriangle size={11} className="order-bar-flag" />}
                                                                {deadlineStatus === 'approaching' && <AlertCircle size={11} className="order-bar-flag" />}
                                                                <span className="order-bar-name-text">{getProjectName(wo)}</span>
                                                            </span>
                                                            <div className="order-bar-actions">
                                                                {wo.Status === 'Na čekanju' && (() => {
                                                                    // Only show play button if today >= planned start date
                                                                    const today = new Date();
                                                                    today.setHours(0, 0, 0, 0);
                                                                    const plannedStart = wo.Planned_Start_Date ? new Date(wo.Planned_Start_Date) : today;
                                                                    plannedStart.setHours(0, 0, 0, 0);
                                                                    const canStart = plannedStart <= today;
                                                                    return canStart ? (
                                                                        <button onClick={e => { e.stopPropagation(); startOrder(wo); }} title="Pokreni"><Play size={11} /></button>
                                                                    ) : null;
                                                                })()}
                                                                {wo.Status !== 'U toku' && (
                                                                    <button onClick={e => { e.stopPropagation(); unschedule(wo); }} title="Ukloni"><X size={11} /></button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {/* Traka (footer mjerač): sažetak iz dnevnika rada (radio/pauziran) + projekcija do roka —
                                                            uzastopni dani istog tipa spojeni u jednu zonu (čitljivije od dan-po-dan mreže) */}
                                                        <div className="order-bar-track">
                                                            {toZones(layout.segments).map((z, i) => (
                                                                <div key={i} className={`order-bar-seg ${DAY_ZONE_CLASS[z.dayType]}`} style={{ flex: z.days }} />
                                                            ))}
                                                        </div>
                                                        {pinLeft !== null && pinLeft > 0 && pinLeft < layout.width - 6 && (
                                                            <div className="order-bar-deadline-flag" style={{ left: pinLeft }} />
                                                        )}
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
            {detailPanel.open && detailWo && typeof document !== 'undefined' && createPortal(
                <div className="planner-modal-overlay" onClick={closeDetailPanel}>
                    <div className="planner-modal detail-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="header-info">
                                <h3>{getProjectName(detailWo)}</h3>
                                <span className="order-num">{detailWo.Work_Order_Number}</span>
                            </div>
                            <button className="close-btn" onClick={closeDetailPanel}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            {/* Status */}
                            <div className="status-badge" style={{ backgroundColor: getStatusColor(detailWo) }}>
                                {(() => {
                                    const info = getStatusLabel(detailWo);
                                    const Icon = info.icon;
                                    return <><Icon size={14} /> {info.text}</>;
                                })()}
                            </div>

                            {/* Dates */}
                            <div className="dates-grid">
                                <div className="date-item">
                                    <span className="date-label">Kreiran</span>
                                    <span className="date-value">{detailWo.Created_Date?.split('T')[0] || '—'}</span>
                                </div>
                                {/* Editable Planned Start Date */}
                                {detailWo.Status === 'Na čekanju' && detailWo.Is_Scheduled ? (
                                    <div className="date-item editable" style={{ cursor: 'pointer', position: 'relative' }}
                                        onClick={() => {
                                            const input = document.getElementById(`planer-start-date-${detailWo!.Work_Order_ID}`) as HTMLInputElement;
                                            if (input) input.showPicker();
                                        }}
                                    >
                                        <span className="date-label">Planirani početak <Edit2 size={9} style={{ marginLeft: 2, opacity: 0.5 }} /></span>
                                        <span className="date-value" style={{ color: '#0071e3' }}>{detailWo.Planned_Start_Date || '—'}</span>
                                        <input
                                            id={`planer-start-date-${detailWo.Work_Order_ID}`}
                                            type="date"
                                            value={detailWo.Planned_Start_Date || ''}
                                            onChange={async (e) => {
                                                const val = e.target.value;
                                                if (!val || !orgId) return;
                                                const res = await updatePlannedStartDate(detailWo!.Work_Order_ID, val, orgId);
                                                if (res.success) {
                                                    showToast('Planirani datum ažuriran', 'success');
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
                                ) : (
                                    <div className="date-item">
                                        <span className="date-label">Početak</span>
                                        <span className="date-value">{detailWo.Started_At?.split('T')[0] || detailWo.Planned_Start_Date || '—'}</span>
                                    </div>
                                )}
                                <div className="date-item">
                                    <span className="date-label">Završeno</span>
                                    <span className="date-value">{detailWo.Completed_At?.split('T')[0] || '—'}</span>
                                </div>
                                <div className="date-item editable" style={{ cursor: 'pointer', position: 'relative' }}
                                    onClick={() => {
                                        const input = document.getElementById(`planer-due-date-${detailWo!.Work_Order_ID}`) as HTMLInputElement;
                                        if (input) input.showPicker();
                                    }}
                                >
                                    <span className="date-label">Rok <Edit2 size={9} style={{ marginLeft: 2, opacity: 0.5 }} /></span>
                                    <span className="date-value deadline">{detailWo.Due_Date?.split('T')[0] || '—'}</span>
                                    <input
                                        id={`planer-due-date-${detailWo.Work_Order_ID}`}
                                        type="date"
                                        value={detailWo.Due_Date?.split('T')[0] || ''}
                                        onChange={async (e) => {
                                            const val = e.target.value;
                                            if (!val || !orgId) return;
                                            const res = await updateDueDate(detailWo!.Work_Order_ID, val, orgId);
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
                                <h4><Box size={16} /> Proizvodi ({detailWo.items?.length || 0})</h4>
                                <div className="products-list">
                                    {detailWo.items?.map((item, idx) => {
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
                                        const wids = getWorkerIds(detailWo);
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
                                {detailWo.Status === 'Na čekanju' && (() => {
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    const plannedStart = detailWo.Planned_Start_Date ? new Date(detailWo.Planned_Start_Date) : today;
                                    plannedStart.setHours(0, 0, 0, 0);
                                    const canStart = plannedStart <= today;
                                    if (!canStart) {
                                        return (
                                            <p className="cannot-start-msg">⏳ Nalog zakazan za {detailWo.Planned_Start_Date}</p>
                                        );
                                    }
                                    return (
                                        <button className="action-btn start" onClick={() => { startOrder(detailWo!); closeDetailPanel(); }}>
                                            <Play size={16} /> Pokreni proizvodnju
                                        </button>
                                    );
                                })()}
                                {detailWo.Status !== 'U toku' ? (
                                    <button className="action-btn remove" onClick={() => { unschedule(detailWo!); closeDetailPanel(); }}>
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
