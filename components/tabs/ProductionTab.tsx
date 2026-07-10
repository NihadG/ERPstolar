'use client';

import { useState, useMemo, useEffect } from 'react';
import type { WorkOrder, Project, Worker } from '@/lib/types';
import { deleteWorkOrder, startWorkOrder, updateWorkOrder } from '@/lib/services';
import { checkMissingAttendanceForActiveOrders, recalculateWorkOrder } from '@/lib/services';
import { getWorkerAttendance, bookWorkerDayItems } from '@/lib/services';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import { repairAllProductStatuses } from '@/lib/services';
import { todayISO } from '@/lib/planning';
import { workOrderDisplayName, isOrderPaused } from '@/lib/utils';
import { useData } from '@/context/DataContext';
import Modal from '@/components/ui/Modal';
import WorkOrderPrintTemplate from '@/components/ui/WorkOrderPrintTemplate';
import AnalyticsDashboard from '@/components/ui/AnalyticsDashboard';
import OrderSummaryModal from '@/components/ui/OrderSummaryModal';
import PriceEditModal from '@/components/ui/PriceEditModal';
import AttendanceFixModal from '@/components/ui/AttendanceFixModal';
import CustomTasksModal from '@/components/ui/CustomTasksModal';
import { WORK_ORDER_STATUSES } from '@/lib/types';
import MobileWorkOrdersView from './mobile/MobileWorkOrdersView';
import WorkOrderWizard, { type WizardMode, type WizardInitialProducts } from '@/components/production/WorkOrderWizard';
import WorkOrderCard from '@/components/production/WorkOrderCard';

interface ProductionTabProps {
    workOrders: WorkOrder[];
    projects: Project[];
    workers: Worker[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    pendingWorkOrderProducts?: { projectId: string; projectName: string; products: { productId: string; productName: string; quantity: number }[] } | null;
    onClearPendingWorkOrder?: () => void;
}

// Sort prioritet: U toku (aktivno) → U toku (pauzirano) → Na čekanju → Završeno → Otkazano
function statusSortPriority(wo: WorkOrder): number {
    if (wo.Status === 'U toku') return isOrderPaused(wo) ? 1 : 0;
    if (wo.Status === 'Na čekanju') return 2;
    if (wo.Status === 'Završeno') return 3;
    if (wo.Status === 'Otkazano') return 4;
    return 99;
}

export default function ProductionTab({ workOrders, projects, workers, onRefresh, showToast, pendingWorkOrderProducts, onClearPendingWorkOrder }: ProductionTabProps) {
    const { organizationId } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');


    // S16: Proactive attendance notification state
    const [attendanceWarnings, setAttendanceWarnings] = useState<{
        warnings: { Worker_ID: string; Worker_Name: string; Work_Order_ID: string; Work_Order_Name: string; Item_Name: string; Date: string }[];
        missingCount: number;
        totalAssigned: number;
    } | null>(null);
    const [attendanceBannerDismissed, setAttendanceBannerDismissed] = useState(false);
    const [priceEditWorkOrder, setPriceEditWorkOrder] = useState<WorkOrder | null>(null);
    const [attendanceFixWorkOrder, setAttendanceFixWorkOrder] = useState<WorkOrder | null>(null);
    const [profitDashboardOpen, setProfitDashboardOpen] = useState(false);

    // Check attendance on mount and when workOrders change
    useEffect(() => {
        if (!organizationId) return;

        // Only check if there are active work orders
        const hasActiveOrders = workOrders.some(wo => wo.Status === 'U toku');
        if (!hasActiveOrders) {
            setAttendanceWarnings(null);
            return;
        }

        checkMissingAttendanceForActiveOrders(organizationId)
            .then(result => {
                if (result.missingCount > 0) {
                    setAttendanceWarnings(result);
                    setAttendanceBannerDismissed(false); // Re-show on new warnings
                } else {
                    setAttendanceWarnings(null);
                }
            })
            .catch(err => console.error('Attendance check failed:', err));
    }, [organizationId, workOrders]);

    // Grouping State
    type GroupBy = 'none' | 'status' | 'project' | 'date' | 'worker';
    const [groupBy, setGroupBy] = useState<GroupBy>('project');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    const groupingOptions = [
        { value: 'none', label: 'Bez grupisanja' },
        { value: 'status', label: 'Po statusu' },
        { value: 'project', label: 'Po projektu' },
        { value: 'date', label: 'Po datumu' },
        { value: 'worker', label: 'Po radniku' }
    ];

    const filteredWorkOrders = useMemo(() => {
        const filtered = workOrders.filter(wo => {
            const matchesSearch = wo.Work_Order_Number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                wo.Name?.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = !statusFilter || wo.Status === statusFilter;
            return matchesSearch && matchesStatus;
        });

        // Default sort: U toku (aktivno) → U toku (pauzirano) → Na čekanju → Završeno → Otkazano, then by date desc
        return filtered.sort((a, b) => {
            const priorityA = statusSortPriority(a);
            const priorityB = statusSortPriority(b);
            if (priorityA !== priorityB) return priorityA - priorityB;
            // Within same status, newest first
            return new Date(b.Created_Date).getTime() - new Date(a.Created_Date).getTime();
        });
    }, [workOrders, searchTerm, statusFilter]);

    // Grouping Logic
    const groupedWorkOrders = useMemo(() => {
        if (groupBy === 'none') return [];

        const groups: Record<string, { key: string; label: string; count: number; totalValue: number; items: WorkOrder[] }> = {};

        filteredWorkOrders.forEach(wo => {
            // For worker grouping, one order can appear in multiple groups
            if (groupBy === 'worker') {
                // Jedan model: dodjela radnika = Assigned_Workers + Processes[] (bez legacy Process_Assignments)
                const workerIds = new Set<string>();
                wo.items?.forEach(item => {
                    (item.Assigned_Workers || []).forEach(w => { if (w.Worker_ID) workerIds.add(w.Worker_ID); });
                    item.Processes?.forEach(p => {
                        if (p.Worker_ID) workerIds.add(p.Worker_ID);
                        p.Helpers?.forEach(h => { if (h.Worker_ID) workerIds.add(h.Worker_ID); });
                    });
                });

                if (workerIds.size === 0) {
                    // No workers assigned
                    const key = 'unassigned';
                    if (!groups[key]) {
                        groups[key] = { key, label: 'Nedodijeljeno', count: 0, totalValue: 0, items: [] };
                    }
                    groups[key].items.push(wo);
                    groups[key].count++;
                    groups[key].totalValue += wo.Total_Value || 0;
                } else {
                    workerIds.forEach(workerId => {
                        const worker = workers.find(w => w.Worker_ID === workerId);
                        const key = workerId;
                        const label = worker?.Name || 'Nepoznat';
                        if (!groups[key]) {
                            groups[key] = { key, label, count: 0, totalValue: 0, items: [] };
                        }
                        if (!groups[key].items.some(i => i.Work_Order_ID === wo.Work_Order_ID)) {
                            groups[key].items.push(wo);
                            groups[key].count++;
                            groups[key].totalValue += wo.Total_Value || 0;
                        }
                    });
                }
                return;
            }

            let key = '';
            let label = '';

            switch (groupBy) {
                case 'status':
                    key = wo.Status || 'Ostalo';
                    label = key;
                    break;
                case 'project':
                    key = wo.items?.[0]?.Project_ID || 'unknown';
                    label = wo.items?.[0]?.Project_Name || 'Nepoznat projekat';
                    break;
                case 'date':
                    key = wo.Created_Date ? wo.Created_Date.split('T')[0] : 'unknown';
                    label = wo.Created_Date ? formatDate(wo.Created_Date) : 'Nepoznat datum';
                    break;
            }

            if (!groups[key]) {
                groups[key] = { key, label, count: 0, totalValue: 0, items: [] };
            }
            groups[key].items.push(wo);
            groups[key].count++;
            groups[key].totalValue += wo.Total_Value || 0;
        });

        // Sort groups
        return Object.values(groups).sort((a, b) => {
            if (groupBy === 'date') return b.key.localeCompare(a.key);
            if (groupBy === 'status') {
                return WORK_ORDER_STATUSES.indexOf(a.key) - WORK_ORDER_STATUSES.indexOf(b.key);
            }
            if (groupBy === 'worker') {
                // Sort by total value descending (most productive first)
                return b.totalValue - a.totalValue;
            }
            if (groupBy === 'project') {
                // Projekti poredani prema datumu prvog (najstarijeg) naloga u projektu — najmlađi prvo
                const firstOrderDate = (items: WorkOrder[]) =>
                    Math.min(...items.map(i => new Date(i.Created_Date).getTime()));
                return firstOrderDate(b.items) - firstOrderDate(a.items);
            }
            return a.label.localeCompare(b.label);
        });
    }, [filteredWorkOrders, groupBy, workers]);

    function toggleGroup(groupKey: string) {
        const newCollapsed = new Set(collapsedGroups);
        if (newCollapsed.has(groupKey)) {
            newCollapsed.delete(groupKey);
        } else {
            newCollapsed.add(groupKey);
        }
        setCollapsedGroups(newCollapsed);
    }

    // Wizard novog naloga — kompletna logika je u components/production/WorkOrderWizard.
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardMode, setWizardMode] = useState<WizardMode>('production');
    const [wizardInitialProducts, setWizardInitialProducts] = useState<WizardInitialProducts | null>(null);
    const [tasksModal, setTasksModal] = useState(false);

    function openCreateModal() {
        setWizardMode('production');
        setWizardInitialProducts(null);
        setWizardOpen(true);
    }

    function openMontazaModal() {
        setWizardMode('montaza');
        setWizardInitialProducts(null);
        setWizardOpen(true);
    }

    // Predselekcija proizvoda iz ProjectsTab → otvori wizard s tim proizvodima
    useEffect(() => {
        if (!pendingWorkOrderProducts) return;
        setWizardMode('production');
        setWizardInitialProducts(pendingWorkOrderProducts);
        setWizardOpen(true);
        if (onClearPendingWorkOrder) onClearPendingWorkOrder();
    }, [pendingWorkOrderProducts]);

    // Expansion State
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [currentWorkOrderForPrint, setCurrentWorkOrderForPrint] = useState<WorkOrder | null>(null);
    // Rezime završenog naloga (finalni P&L iz snapshota)
    const [summaryOrder, setSummaryOrder] = useState<WorkOrder | null>(null);

    function toggleWorkOrder(id: string) {
        setExpandedOrderId(prev => prev === id ? null : id);
    }

    // Print Modal
    const [printModal, setPrintModal] = useState(false);

    // Delete Confirmation Modal
    const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
        isOpen: boolean;
        workOrderId: string | null;
        workOrderNumber: string;
    }>({ isOpen: false, workOrderId: null, workOrderNumber: '' });

    // Upit "Proknjiži današnji dan?" nakon pokretanja naloga — pokriva slučaj kad je
    // šihtarica popunjena PRIJE starta: taj dan inače ostaje neproknjižen na ovom nalogu
    // (auto-knjiženje se okida samo pri označavanju prisustva, ne pri startu naloga).
    const [bookTodayModal, setBookTodayModal] = useState<{
        isOpen: boolean;
        workOrderId: string | null;
        workers: { workerId: string; workerName: string }[];
    }>({ isOpen: false, workOrderId: null, workers: [] });
    const [bookTodaySaving, setBookTodaySaving] = useState(false);
    function formatDate(dateString: string): string {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('hr-HR');
    }

    // View/Edit/Delete/Print logic
    async function handleUpdateWorkOrder(workOrderId: string, updates: any) {
        // S6.6: Validate all items before manual completion
        if (updates.Status === 'Završeno') {
            const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
            if (wo) {
                const unfinished = (wo.items || []).filter(
                    item => item.Status !== 'Završeno'
                );
                if (unfinished.length > 0) {
                    const names = unfinished.map(i => i.Product_Name).join(', ');
                    showToast(`Stavke nisu završene: ${names}. Završite sve stavke prije kompletiranja naloga.`, 'error');
                    return;
                }
            }
        }

        const res = await updateWorkOrder(workOrderId, updates, organizationId || '');
        if (res.success) {
            showToast(res.message, 'success');
            onRefresh('workOrders', 'projects');
        } else {
            showToast(res.message, 'error');
        }
    }

    function handlePrintWorkOrder(wo: WorkOrder) {
        // Enrich items with materials from project data for printing
        const enrichedWo = {
            ...wo,
            items: wo.items?.map(item => {
                // Find the product in projects to get its materials
                const project = projects.find(p => p.Project_ID === item.Project_ID);
                const product = project?.products?.find(prod => prod.Product_ID === item.Product_ID);
                return {
                    ...item,
                    materials: product?.materials || item.materials || []
                };
            })
        };
        setCurrentWorkOrderForPrint(enrichedWo);
        setPrintModal(true);
    }

    // Opens the delete confirmation modal
    async function handleDeleteWorkOrder(workOrderId: string) {
        const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
        setDeleteConfirmModal({
            isOpen: true,
            workOrderId,
            workOrderNumber: wo?.Work_Order_Number || ''
        });
    }

    // Actually performs the delete with the selected action
    async function confirmDeleteWorkOrder(productAction: 'completed' | 'waiting') {
        if (!deleteConfirmModal.workOrderId) return;

        const workOrderId = deleteConfirmModal.workOrderId;

        // Optimistic: close modal immediately
        setDeleteConfirmModal({ isOpen: false, workOrderId: null, workOrderNumber: '' });
        if (expandedOrderId === workOrderId) {
            setExpandedOrderId(null);
        }
        showToast('Brisanje naloga...', 'info');

        // Run delete in background
        try {
            const res = await deleteWorkOrder(workOrderId, organizationId || '', productAction);
            if (res.success) {
                showToast(res.message, 'success');
            } else {
                showToast(res.message, 'error');
            }
        } catch {
            showToast('Greška pri brisanju naloga', 'error');
        }
        onRefresh('workOrders', 'projects');
    }

    // Dijeljeni modali (isti render-poziv koriste desktop i mobilna grana ispod —
    // portal-bazirani `Modal`, pa nema styled-jsx scoping problema).
    function renderDeleteConfirmModal() {
        const wo = workOrders.find(w => w.Work_Order_ID === deleteConfirmModal.workOrderId);
        return (
            <Modal
                isOpen={deleteConfirmModal.isOpen}
                onClose={() => setDeleteConfirmModal({ isOpen: false, workOrderId: null, workOrderNumber: '' })}
                title={`Obriši nalog: ${workOrderDisplayName(wo || { Work_Order_Number: deleteConfirmModal.workOrderNumber })}`}
                footer={<button className="btn btn-secondary" onClick={() => setDeleteConfirmModal({ isOpen: false, workOrderId: null, workOrderNumber: '' })}>Odustani</button>}
            >
                <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)', fontSize: 14 }}>Šta želite uraditi sa proizvodima iz ovog naloga?</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <button
                        onClick={() => confirmDeleteWorkOrder('completed')}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16, border: '2px solid var(--border)', borderRadius: 12, background: 'var(--background)', cursor: 'pointer', textAlign: 'left' }}
                    >
                        <span style={{ fontSize: 24 }}>✅</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <strong style={{ fontSize: 15, color: 'var(--text-primary)' }}>Završi proizvode</strong>
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Postavi status na "Spremno" (bez kalkulacije profita)</span>
                        </div>
                    </button>
                    <button
                        onClick={() => confirmDeleteWorkOrder('waiting')}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16, border: '2px solid var(--border)', borderRadius: 12, background: 'var(--background)', cursor: 'pointer', textAlign: 'left' }}
                    >
                        <span style={{ fontSize: 24 }}>⏳</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <strong style={{ fontSize: 15, color: 'var(--text-primary)' }}>Vrati na čekanje</strong>
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Postavi status na "Na čekanju"</span>
                        </div>
                    </button>
                </div>
            </Modal>
        );
    }

    // Upit knjiženja današnjeg dana nakon "Pokreni nalog" (šihtarica popunjena prije starta).
    function renderBookTodayModal() {
        const wo = workOrders.find(w => w.Work_Order_ID === bookTodayModal.workOrderId);
        const close = () => setBookTodayModal({ isOpen: false, workOrderId: null, workers: [] });
        return (
            <Modal
                isOpen={bookTodayModal.isOpen}
                onClose={close}
                title={`Proknjiži današnji dan${wo ? `: ${workOrderDisplayName(wo)}` : ''}`}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={close} disabled={bookTodaySaving}>Ne sada</button>
                        <button className="btn btn-primary" onClick={confirmBookToday} disabled={bookTodaySaving}>
                            {bookTodaySaving ? 'Knjižim…' : `Proknjiži (${bookTodayModal.workers.length})`}
                        </button>
                    </>
                }
            >
                <p style={{ margin: '0 0 12px 0', color: 'var(--text-secondary)', fontSize: 14 }}>
                    Sljedeći dodijeljeni radnici su danas prisutni u šihtarici. Da li da im se današnji dan odmah proknjiži na ovaj nalog?
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-primary)', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {bookTodayModal.workers.map(w => <li key={w.workerId}>{w.workerName}</li>)}
                </ul>
                <p style={{ margin: '12px 0 0 0', color: 'var(--text-tertiary)', fontSize: 12 }}>
                    Već knjiženi dani se preskaču. Odbijanjem se ništa ne knjiži — dnevnice možeš kasnije unijeti kroz Knjigu rada.
                </p>
            </Modal>
        );
    }

    function renderPrintModal() {
        return (
            <Modal
                isOpen={printModal}
                onClose={() => setPrintModal(false)}
                title="Printaj Radni Nalog"
                size="xl"
                footer={<button className="btn btn-secondary" onClick={() => setPrintModal(false)}>Zatvori</button>}
            >
                {currentWorkOrderForPrint && <WorkOrderPrintTemplate workOrder={currentWorkOrderForPrint} />}
            </Modal>
        );
    }

    function renderAttendanceFixModal() {
        if (!attendanceFixWorkOrder || !organizationId) return null;
        return (
            <AttendanceFixModal
                workOrder={attendanceFixWorkOrder}
                organizationId={organizationId}
                warnings={attendanceWarnings?.warnings}
                onClose={() => setAttendanceFixWorkOrder(null)}
                onSaved={() => onRefresh('workOrders')}
                showToast={showToast}
            />
        );
    }

    function renderSummaryModal() {
        if (!summaryOrder) return null;
        return (
            <OrderSummaryModal
                workOrder={summaryOrder}
                organizationId={organizationId || ''}
                onClose={() => setSummaryOrder(null)}
            />
        );
    }

    async function handleStartWorkOrder(workOrderId: string) {
        // Get the work order to validate
        const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
        if (!wo) {
            showToast('Nalog nije pronađen', 'error');
            return;
        }

        // S2.2: Check at least one worker is assigned
        const hasWorker = (wo.items || []).some(item =>
            (item.Processes || []).some(p => p.Worker_ID)
        );
        if (!hasWorker) {
            showToast('Dodijelite barem jednog radnika prije pokretanja naloga', 'error');
            return;
        }

        // VALIDATION 1: Check essential materials are received
        const missingMaterials: string[] = [];
        for (const item of wo.items || []) {
            // Get product materials from projects
            const project = projects.find(p => p.Project_ID === item.Project_ID);
            const product = project?.products?.find(pr => pr.Product_ID === item.Product_ID);

            if (product?.materials) {
                const missing = product.materials.filter(
                    m => m.Is_Essential && m.Status !== 'Primljeno' && m.Status !== 'Na stanju'
                );
                missing.forEach(m => missingMaterials.push(`${item.Product_Name}: ${m.Material_Name}`));
            }
        }

        if (missingMaterials.length > 0) {
            showToast(`Esencijalni materijali nisu spremni: ${missingMaterials.join(', ')}`, 'error');
            return;
        }

        // VALIDATION 2: Check ALL workers (all processes + helpers) are present today
        const { canWorkerStartProcess } = await import('@/lib/services');
        const workerChecks: { workerId: string; label: string }[] = [];
        const checkedWorkers = new Set<string>(); // Avoid duplicate checks

        for (const item of wo.items || []) {
            for (const process of item.Processes || []) {
                if (process.Worker_ID && !checkedWorkers.has(process.Worker_ID)) {
                    checkedWorkers.add(process.Worker_ID);
                    workerChecks.push({ workerId: process.Worker_ID, label: `${process.Worker_Name} (${process.Process_Name})` });
                }
                if (process.Helpers && process.Helpers.length > 0) {
                    for (const helper of process.Helpers) {
                        if (helper.Worker_ID && !checkedWorkers.has(helper.Worker_ID)) {
                            checkedWorkers.add(helper.Worker_ID);
                            workerChecks.push({ workerId: helper.Worker_ID, label: `${helper.Worker_Name} (pomoćnik za ${process.Process_Name})` });
                        }
                    }
                }
            }
        }

        // Parallel availability check instead of serial
        const availabilityResults = await Promise.all(
            workerChecks.map(async ({ workerId, label }) => {
                const availability = await canWorkerStartProcess(workerId);
                return { label, availability };
            })
        );
        const workerIssues = availabilityResults
            .filter(r => !r.availability.allowed)
            .map(r => `${r.label} - ${r.availability.reason}`);

        if (workerIssues.length > 0) {
            showToast(`Radnici nisu prisutni: ${workerIssues.join(', ')}`, 'error');
            return;
        }

        // All validations passed, start the work order
        showToast('Pokretanje naloga...', 'info');
        const res = await startWorkOrder(workOrderId, organizationId || '');
        if (res.success) {
            showToast('Nalog pokrenut', 'success');
            onRefresh('workOrders', 'projects');
            // Šihtarica popunjena prije starta? Ponudi knjiženje današnjeg dana odmah,
            // umjesto da korisnik mora ponovo snimati prisustvo ili ručno knjižiti.
            offerBookTodayAfterStart(workOrderId).catch(e => console.warn('offerBookTodayAfterStart failed', e));
        } else {
            showToast(res.message, 'error');
        }
    }

    // Nađi dodijeljene radnike naloga koji su DANAS prisutni u šihtarici (Prisutan → proizvodnja,
    // Teren → montaža; isti raspored kao auto-knjiženje) i otvori upit za knjiženje današnjeg dana.
    // bookWorkerDayItems je idempotentan (preskače postojeće logove), pa je upit bezopasan.
    async function offerBookTodayAfterStart(workOrderId: string) {
        const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
        if (!wo) return;
        const assigned = new Map<string, string>();
        const note = (id?: string, name?: string) => {
            if (!id) return;
            assigned.set(id, name || workers.find(w => w.Worker_ID === id)?.Name || id);
        };
        for (const item of wo.items || []) {
            (item.Assigned_Workers || []).forEach(w => note(w.Worker_ID, w.Worker_Name));
            (item.Processes || []).forEach(p => {
                note(p.Worker_ID, p.Worker_Name);
                (p.Helpers || []).forEach(h => note(h.Worker_ID, h.Worker_Name));
            });
            (item.SubTasks || []).forEach(st => {
                note(st.Worker_ID, st.Worker_Name);
                (st.Helpers || []).forEach(h => note(h.Worker_ID, h.Worker_Name));
            });
        }
        if (assigned.size === 0) return;

        const today = todayISO();
        const isMontaza = wo.Work_Order_Type === 'Montaža';
        const eligible: { workerId: string; workerName: string }[] = [];
        await Promise.all(Array.from(assigned.entries()).map(async ([workerId, workerName]) => {
            try {
                const att = await getWorkerAttendance(workerId, today, organizationId || undefined);
                if (!att) return;
                if ((att.Status === 'Prisutan' && !isMontaza) || (att.Status === 'Teren' && isMontaza)) {
                    eligible.push({ workerId, workerName });
                }
            } catch (e) { console.warn('attendance check failed', workerId, e); }
        }));
        if (eligible.length === 0) return;

        setBookTodayModal({ isOpen: true, workOrderId, workers: eligible });
    }

    async function confirmBookToday() {
        const { workOrderId, workers: toBook } = bookTodayModal;
        if (!workOrderId) return;
        setBookTodaySaving(true);
        try {
            const wo = workOrders.find(w => w.Work_Order_ID === workOrderId);
            const today = todayISO();
            let booked = 0;
            for (const w of toBook) {
                const live = (wo?.items || []).filter(it => it.Status !== 'Završeno');
                const mine = live.filter(it =>
                    isWorkerAssignedToAutoItem({ ID: it.ID, Assigned_Workers: it.Assigned_Workers, Processes: it.Processes, SubTasks: it.SubTasks }, w.workerId)
                );
                const targets = (mine.length > 0 ? mine : live).map(it => ({ workOrderId, itemId: it.ID, productId: it.Product_ID }));
                if (targets.length === 0) continue;
                const res = await bookWorkerDayItems(w.workerId, w.workerName, today, organizationId || '', targets, 1);
                booked += res.created;
            }
            if (booked > 0) {
                await recalculateWorkOrder(workOrderId, { skipMaterialRefresh: true, skipStatusSync: true });
                showToast(`Proknjiženo ${booked} dnevnica za danas`, 'success');
                onRefresh('workOrders', 'workers');
            } else {
                showToast('Dnevnice za danas već postoje — ništa novo nije knjiženo', 'info');
            }
        } catch (e) {
            console.error('confirmBookToday error', e);
            showToast('Greška pri knjiženju današnjeg dana', 'error');
        } finally {
            setBookTodaySaving(false);
            setBookTodayModal({ isOpen: false, workOrderId: null, workers: [] });
        }
    }

    // Kartica naloga — izdvojena u components/production/WorkOrderCard.
    const renderWorkOrderCard = (wo: WorkOrder) => (
        <WorkOrderCard
            key={wo.Work_Order_ID}
            workOrder={wo}
            projects={projects}
            workers={workers}
            isExpanded={expandedOrderId === wo.Work_Order_ID}
            attendanceWarnings={attendanceWarnings?.warnings}
            organizationId={organizationId}
            onToggle={toggleWorkOrder}
            onStart={handleStartWorkOrder}
            onPrint={handlePrintWorkOrder}
            onDelete={handleDeleteWorkOrder}
            onSummary={setSummaryOrder}
            onAttendanceFix={setAttendanceFixWorkOrder}
            onUpdate={handleUpdateWorkOrder}
            onRefresh={onRefresh}
            showToast={showToast}
        />
    );

    // Mobile State
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Mobile View Render
    if (isMobile) {
        return (
            <>
                <MobileWorkOrdersView
                    workOrders={workOrders}
                    workers={workers}
                    onRefresh={onRefresh}
                    showToast={showToast}
                    onCreate={openCreateModal}
                    onUpdate={handleUpdateWorkOrder}
                    onDelete={handleDeleteWorkOrder}
                    onStart={handleStartWorkOrder}
                    onPrint={handlePrintWorkOrder}
                    onSummary={setSummaryOrder}
                    attendanceWarnings={attendanceWarnings}
                    onAttendanceFix={setAttendanceFixWorkOrder}
                />

                {/* Isti dijaloški modali kao na desktopu — bez ovoga Print/Brisanje/Rezime/Prisustvo
                    tiho ne bi radili na mobitelu (mijenjaju state, ali se nigdje ne prikazuju). */}
                {renderDeleteConfirmModal()}
                {renderBookTodayModal()}
                {renderPrintModal()}
                {renderAttendanceFixModal()}
                {renderSummaryModal()}

                {/* Mobilni unos/izmjena naloga kroz wizard je zaseban, veći zadatak — za sada placeholder. */}
                {wizardOpen && (
                    <Modal isOpen={wizardOpen} onClose={() => setWizardOpen(false)} title="Novi Radni Nalog" size="fullscreen" footer={null}>
                        <div style={{ padding: '20px', textAlign: 'center' }}>
                            <h3>Mobilni unos naloga</h3>
                            <p>Ova funkcionalnost će biti uskoro dostupna na mobilnim uređajima.</p>
                            <button onClick={() => setWizardOpen(false)} style={{ padding: '10px 20px', marginTop: '20px' }}>Zatvori</button>
                        </div>
                    </Modal>
                )}
            </>
        );
    }

    return (
        <div className="tab-content active">
            <div className="content-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 24px' }}>
                {/* Glass Search */}
                <div className="glass-search" style={{ flex: '1 1 180px', minWidth: '140px' }}>
                    <span className="material-icons-round">search</span>
                    <input type="text" placeholder="Pretraži naloge..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>

                {/* Glass Controls Group */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                    {/* Grouping Control */}
                    <div className="glass-control-group">
                        <span className="control-label">Grupiši:</span>
                        <select
                            value={groupBy}
                            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                        >
                            {groupingOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Status Filter */}
                    <select className="glass-select-standalone" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="">Svi statusi</option>
                        {WORK_ORDER_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                    </select>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                        className="glass-btn"
                        onClick={() => setProfitDashboardOpen(true)}
                        style={{
                            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                            color: 'white',
                            border: 'none',
                            fontWeight: 600,
                            padding: '8px 14px',
                            whiteSpace: 'nowrap',
                        }}
                        title="Pregled profita svih aktivnih proizvoda"
                    >
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>insights</span>
                        Profiti
                    </button>
                    <button
                        className="glass-btn"
                        onClick={async () => {
                            showToast('Sinkronizacija u toku...', 'info');
                            const result = await repairAllProductStatuses();
                            if (result.success) {
                                showToast(result.message, 'success');
                                onRefresh('workOrders', 'projects');
                            } else {
                                showToast(result.message, 'error');
                            }
                        }}
                        title="Sinkroniziraj statuse svih proizvoda sa radnim nalozima"
                        style={{ padding: '8px 12px' }}
                    >
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>sync</span>
                    </button>
                    <button className="glass-btn glass-btn-primary" onClick={openCreateModal} style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>add</span>
                        Novi nalog
                    </button>
                    <button
                        className="glass-btn"
                        onClick={openMontazaModal}
                        style={{
                            background: '#00C7BE',
                            color: 'white',
                            border: 'none',
                            fontWeight: 600,
                            padding: '8px 14px',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>build</span>
                        Montaža
                    </button>
                    <button
                        className="glass-btn"
                        onClick={() => setTasksModal(true)}
                        style={{
                            background: '#7c3aed',
                            color: 'white',
                            border: 'none',
                            fontWeight: 600,
                            padding: '8px 14px',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>checklist</span>
                        Razni poslovi
                    </button>
                </div>
            </div>

            {/* S16: Proactive Attendance Notification Banner */}
            {attendanceWarnings && attendanceWarnings.missingCount > 0 && !attendanceBannerDismissed && (
                <div style={{
                    margin: '0 24px 16px',
                    padding: '14px 18px',
                    background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                    border: '1px solid #fbbf24',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    boxShadow: '0 2px 8px rgba(251, 191, 36, 0.15)',
                    animation: 'slideDown 0.3s ease-out'
                }}>
                    <span className="material-icons-round" style={{ color: '#d97706', fontSize: '22px', marginTop: '1px' }}>warning</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#92400e', marginBottom: '4px' }}>
                            ⚠️ {attendanceWarnings.missingCount} {attendanceWarnings.missingCount === 1 ? 'radnik nema' : 'radnika nemaju'} popunjeno prisustvo za danas
                        </div>
                        <div style={{ fontSize: '12px', color: '#a16207', lineHeight: '1.5' }}>
                            {attendanceWarnings.warnings.slice(0, 5).map((w, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: i > 0 ? '2px' : '0' }}>
                                    <span className="material-icons-round" style={{ fontSize: '14px' }}>person_off</span>
                                    <strong>{w.Worker_Name}</strong>
                                    <span style={{ opacity: 0.7 }}>→</span>
                                    <span>{w.Work_Order_Name}</span>
                                </div>
                            ))}
                            {attendanceWarnings.warnings.length > 5 && (
                                <div style={{ marginTop: '4px', fontStyle: 'italic', opacity: 0.8 }}>
                                    ...i još {attendanceWarnings.warnings.length - 5} radnika
                                </div>
                            )}
                        </div>
                        <div style={{ marginTop: '8px', fontSize: '11px', color: '#b45309', opacity: 0.8 }}>
                            💡 Kliknite na badge pored radnog naloga za popunu prisustva direktno.
                        </div>
                    </div>
                    <button
                        onClick={() => setAttendanceBannerDismissed(true)}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px',
                            color: '#92400e',
                            opacity: 0.6,
                            borderRadius: '6px'
                        }}
                        title="Sakrij obavijest"
                    >
                        <span className="material-icons-round" style={{ fontSize: '18px' }}>close</span>
                    </button>
                </div>
            )}

            <div className="orders-list">
                {filteredWorkOrders.length === 0 ? (
                    <div className="empty-state"><span className="material-icons-round">engineering</span><h3>Nema radnih naloga</h3><p>Kreirajte prvi radni nalog</p></div>
                ) : (
                    groupBy === 'none' ? (
                        (expandedOrderId
                            ? filteredWorkOrders.filter(wo => wo.Work_Order_ID === expandedOrderId)
                            : filteredWorkOrders
                        ).map(wo => renderWorkOrderCard(wo))
                    ) : (
                        (expandedOrderId
                            ? groupedWorkOrders.filter(g => g.items.some(wo => wo.Work_Order_ID === expandedOrderId))
                            : groupedWorkOrders
                        ).map(group => (
                            <div key={group.key} className="group-section" style={{ marginBottom: '24px' }}>
                                <div
                                    className="group-header"
                                    onClick={() => toggleGroup(group.key)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                        userSelect: 'none',
                                        background: groupBy === 'worker' ? 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)' : 'transparent',
                                        borderRadius: '12px',
                                        border: groupBy === 'worker' ? '1px solid #e2e8f0' : 'none'
                                    }}
                                >
                                    <span className="material-icons-round" style={{
                                        transform: collapsedGroups.has(group.key) ? 'rotate(-90deg)' : 'rotate(0deg)',
                                        transition: 'transform 0.2s',
                                        color: '#666'
                                    }}>
                                        expand_more
                                    </span>

                                    {groupBy === 'worker' && group.key !== 'unassigned' && (
                                        <div style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontWeight: 600,
                                            fontSize: '14px'
                                        }}>
                                            {group.label.split(' ').map(w => w[0]).slice(0, 2).join('')}
                                        </div>
                                    )}

                                    <div style={{ flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1d1d1f' }}>
                                            {group.label}
                                        </h3>
                                        {groupBy === 'worker' && (
                                            <span style={{ fontSize: '12px', color: '#64748b' }}>
                                                {group.count} {group.count === 1 ? 'nalog' : group.count < 5 ? 'naloga' : 'naloga'}
                                            </span>
                                        )}
                                    </div>

                                    {groupBy !== 'worker' && (
                                        <span style={{
                                            background: '#f5f5f7',
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            color: '#666'
                                        }}>
                                            {group.count}
                                        </span>
                                    )}

                                    {groupBy === 'worker' && group.totalValue > 0 && (
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            background: '#dcfce7',
                                            padding: '6px 12px',
                                            borderRadius: '8px',
                                            fontWeight: 600,
                                            fontSize: '14px',
                                            color: '#15803d'
                                        }}>
                                            <span className="material-icons-round" style={{ fontSize: '16px' }}>payments</span>
                                            {group.totalValue.toLocaleString('hr-HR')} KM
                                        </div>
                                    )}
                                </div>

                                {!collapsedGroups.has(group.key) && (
                                    <div className="group-items" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                                        {(expandedOrderId
                                            ? group.items.filter(wo => wo.Work_Order_ID === expandedOrderId)
                                            : group.items
                                        ).map(wo => renderWorkOrderCard(wo))}
                                    </div>
                                )}
                            </div>
                        ))
                    )
                )}
            </div>


            <style jsx>{`
                .orders-list { display: flex; flex-direction: column; gap: 12px; }

                @media (max-width: 767px) {
                    .content-header { flex-direction: column; align-items: stretch; gap: 12px; }
                }
            `}</style>

            {/* Wizard novog naloga (proizvodnja + montaža) */}
            <WorkOrderWizard
                isOpen={wizardOpen}
                mode={wizardMode}
                workOrders={workOrders}
                projects={projects}
                workers={workers}
                organizationId={organizationId}
                initialProducts={wizardInitialProducts}
                onClose={() => setWizardOpen(false)}
                onRefresh={onRefresh}
                showToast={showToast}
            />

            {/* ========== PRINT TEMPLATE MODAL ========== */}
            {renderPrintModal()}


            {/* Delete Confirmation Modal */}
            {renderDeleteConfirmModal()}

            {/* Upit knjiženja današnjeg dana nakon pokretanja naloga */}
            {renderBookTodayModal()}


            {priceEditWorkOrder && (
                <PriceEditModal
                    workOrder={priceEditWorkOrder}
                    onClose={() => setPriceEditWorkOrder(null)}
                    onSaved={() => onRefresh('workOrders')}
                    showToast={showToast}
                />
            )}
            {renderAttendanceFixModal()}
            {profitDashboardOpen && (
                <AnalyticsDashboard
                    onClose={() => setProfitDashboardOpen(false)}
                    showToast={showToast}
                    onRefresh={onRefresh}
                />
            )}

            {/* Rezime završenog naloga (finalni P&L iz snapshota / živi fallback) */}
            {renderSummaryModal()}

            <CustomTasksModal
                isOpen={tasksModal}
                onClose={() => setTasksModal(false)}
                workOrders={workOrders}
                workers={workers}
                organizationId={organizationId || ''}
                onCreated={onRefresh}
                showToast={showToast}
            />
        </div >
    );
}



