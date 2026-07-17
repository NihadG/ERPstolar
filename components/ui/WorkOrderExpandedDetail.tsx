import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { Play, Pause, CheckCircle, Clock, Edit2, AlertTriangle, NotebookPen, GitBranch, ListTodo, Hammer } from 'lucide-react';
import { useData } from '@/context/DataContext';
import {
    checkMissingAttendanceHistory,
    getWorkLogsForWorkOrder,
    startWorkOrderItem,
    completeWorkOrderItem,
    updateWorkOrderItemStatus,
    updateItemProcess,
    toggleItemPause,
    getAllAttendanceByMonth,
} from '@/lib/services';
import { workOrderDueDate, buildSaturdayChecker, todayISO, daysUntil, plannedVsActualDays, itemsWithoutPlannedDays, type AttendanceLite } from '@/lib/planning';
import { itemMaterialTotal } from '@/lib/materialCost';
import { itemProfitBreakdown, sumBreakdowns, type ProfitBreakdown } from '@/lib/profit';
import type { WorkOrder, Worker, WorkOrderItem, WorkLog, Task } from '@/lib/types';
import Modal from './Modal';
import ProductTimelineModal from './ProductTimelineModal';
import WorkOrderWorkLog from './WorkOrderWorkLog';
import ProcessGraphModal from './ProcessGraphModal';
import OrderProcessBoard from './OrderProcessBoard';
import WorkOrderTasksPanel from './WorkOrderTasksPanel';
import { tasksForWorkOrder, taskProgress, firstBookingDate } from '@/lib/workOrderTasks';
import { workOrderDisplayName, orderProcessProgress } from '@/lib/utils';
import './WorkOrderExpandedDetail.css';

interface WorkOrderExpandedDetailProps {
    workOrder: WorkOrder;
    workers: Worker[];
    /** Svi zadaci organizacije — tab „Zadaci" ih filtrira po Task.Links. */
    tasks?: Task[];
    onUpdate: (workOrderId: string, updates: any) => Promise<void>;
    onPrint: (workOrder: WorkOrder) => void;
    onDelete: (workOrderId: string) => Promise<void>;
    onStart: (workOrderId: string) => Promise<void>;
    onRefresh?: (...collections: string[]) => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkOrderExpandedDetail({
    workOrder,
    workers,
    tasks = [],
    onUpdate,
    onStart,
    onRefresh,
    showToast
}: WorkOrderExpandedDetailProps) {
    const [localItems, setLocalItems] = useState<WorkOrderItem[]>([]);
    const [isLoading, setIsLoading] = useState<string | null>(null);
    const [orderBusy, setOrderBusy] = useState(false);   // akcije na nivou naloga (Završi/Pauza)
    const { organizationId } = useData();

    // S16: Missing Attendance State
    const [missingAttendance, setMissingAttendance] = useState<{ count: number; details: string[] } | null>(null);

    // Work logs (izvor profita po proizvodu — iz dnevnika rada)
    const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
    const [timelineItem, setTimelineItem] = useState<WorkOrderItem | null>(null);
    const [processOpen, setProcessOpen] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [tab, setTab] = useState<'tok' | 'rad' | 'zadaci'>('tok');
    const [flowOpen, setFlowOpen] = useState(false);   // "Procesi naloga" — collapsed po defaultu (liste znaju biti duge)
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());   // sklopivi proizvodi (collapsed po defaultu)
    const [graphVersion, setGraphVersion] = useState(0);   // bump nakon zatvaranja grafa → OrderProcessBoard ponovo učita gating
    // Potvrda "opasnih" akcija kroz stilizovan Modal umjesto sirovog window.confirm
    // (konzistentno s ostalim dijalozima; pregled ŠTA će se desiti prije klika).
    const [confirmState, setConfirmState] = useState<{
        title: string;
        body: ReactNode;
        confirmLabel: string;
        onConfirm: () => void | Promise<void>;
    } | null>(null);
    const toggleProduct = (id: string) => setExpandedProducts(prev => {
        const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
    });

    const saveName = async () => {
        const v = nameDraft.trim();
        setEditingName(false);
        if (v !== (workOrder.Name || '')) {
            await onUpdate(workOrder.Work_Order_ID, { Name: v });
            // Vezani zadaci nose zapamćen naziv naloga (TaskLink.Entity_Name) — bez ovoga
            // bi tab Zadaci pokazivao stari naziv i poslije preimenovanja.
            if (organizationId) {
                try {
                    const { syncWorkOrderNameOnTasks } = await import('@/lib/services');
                    const res = await syncWorkOrderNameOnTasks(
                        workOrder.Work_Order_ID,
                        workOrderDisplayName({ ...workOrder, Name: v }),
                        organizationId
                    );
                    if (res.updatedCount > 0) onRefresh?.('tasks');
                } catch (e) {
                    console.warn('sync naziva naloga na zadacima preskočen:', e);
                }
            }
            onRefresh?.('workOrders');
        }
    };

    useEffect(() => {
        if (workOrder?.Work_Order_ID && organizationId && workOrder.Started_At) {
            checkMissingAttendanceHistory(workOrder.Work_Order_ID, organizationId)
                .then(result => {
                    if (result.missingDays > 0) {
                        setMissingAttendance({
                            count: result.missingDays,
                            details: result.details.map((d: any) => `${d.workerName} (${d.date})`)
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
        setLocalItems(workOrder?.items || []);
    }, [workOrder]);

    // ── Advisory rok: šihtarica (prošli + tekući mjesec) za subotnju rotaciju ──
    const [attLite, setAttLite] = useState<AttendanceLite[]>([]);
    const [dueSuggestionDismissed, setDueSuggestionDismissed] = useState(false);
    useEffect(() => {
        if (!organizationId || workOrder.Status === 'Završeno' || workOrder.Status === 'Otkazano') return;
        const now = new Date();
        const cur = { y: now.getFullYear(), m: now.getMonth() + 1 };
        const prev = cur.m === 1 ? { y: cur.y - 1, m: 12 } : { y: cur.y, m: cur.m - 1 };
        Promise.all([
            getAllAttendanceByMonth(String(prev.y), String(prev.m), organizationId),
            getAllAttendanceByMonth(String(cur.y), String(cur.m), organizationId),
        ]).then(([a, b]) => setAttLite([...a, ...b] as AttendanceLite[]))
            .catch(err => console.warn('attendance for due-date suggestion:', err));
    }, [workOrder.Work_Order_ID, organizationId, workOrder.Status]);

    // Predviđeni rok iz planiranih dana (isti model kao wizard: Σ dana sekvencijalno, subotnja rotacija)
    const dueSuggestion = useMemo(() => {
        if (workOrder.Status === 'Završeno' || workOrder.Status === 'Otkazano') return null;
        const totalDays = (workOrder.items || []).reduce((s, it) => s + (it.Planned_Labor_Days || 0), 0);
        if (totalDays <= 0) return null;
        const startISO = (workOrder.Started_At || (workOrder as any).Planned_Start_Date || todayISO()).split('T')[0];
        const workerIds = Array.from(new Set(
            (workOrder.items || []).flatMap(it => (it.Assigned_Workers || []).map(w => w.Worker_ID))
        ));
        const suggested = workOrderDueDate(startISO, totalDays, buildSaturdayChecker(workerIds, attLite));
        const currentDue = workOrder.Due_Date?.split('T')[0] || '';
        if (suggested === currentDue) return null;
        return { suggested, totalDays, startISO };
    }, [workOrder, attLite]);

    // Prekoračenje planiranih radnik-dana (živ signal erozije profita)
    const daysProgress = useMemo(() => plannedVsActualDays(localItems, workLogs), [localItems, workLogs]);

    const applySuggestedDue = async () => {
        if (!dueSuggestion) return;
        try {
            const { updateDueDate } = await import('@/lib/services');
            const res = await updateDueDate(workOrder.Work_Order_ID, dueSuggestion.suggested, workOrder.Organization_ID);
            if (res.success) {
                showToast?.('Rok ažuriran prema planiranim danima', 'success');
                onRefresh?.('workOrders');
            } else {
                showToast?.(res.message, 'error');
            }
        } catch {
            showToast?.('Greška pri ažuriranju roka', 'error');
        }
    };

    // Fetch work logs (per-product labor/profit)
    useEffect(() => {
        if (workOrder?.Work_Order_ID && organizationId) {
            getWorkLogsForWorkOrder(workOrder.Work_Order_ID, organizationId)
                .then(logs => setWorkLogs(logs))
                .catch(err => console.error('Error fetching work logs:', err));
        }
    }, [workOrder?.Work_Order_ID, organizationId]);

    // Re-fetch ovog naloga + osvježi globalno (poslije knjiženja rada u trackeru)
    const reloadWorkLogs = () => {
        if (workOrder?.Work_Order_ID && organizationId) {
            getWorkLogsForWorkOrder(workOrder.Work_Order_ID, organizationId)
                .then(logs => setWorkLogs(logs))
                .catch(err => console.error('Error fetching work logs:', err));
        }
        onRefresh?.('workOrders', 'projects', 'workLogs');
    };

    // Format helpers
    const formatDate = (dateStr: string | undefined): string => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('bs-BA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    // Status proizvoda: Na čekanju → U toku → Završeno
    const setItemStatus = async (item: WorkOrderItem, status: 'Na čekanju' | 'U toku' | 'Završeno') => {
        if (isLoading) return;
        // Provjera esencijalnih materijala pri pokretanju
        if (status === 'U toku' && item.materials && item.materials.length > 0) {
            const missing = item.materials.filter(m => m.Is_Essential && m.Status !== 'Primljeno' && m.Status !== 'Na stanju');
            if (missing.length > 0) {
                showToast?.(`Esencijalni materijali nisu spremni: ${missing.map(m => m.Material_Name).join(', ')}`, 'error');
                return;
            }
        }
        // Završetak proizvoda uz NEDOVRŠENE procese: ponudi da se preostali procesi uredno
        // označe završenim (radi čistog grafa/table). Procesi su odspojeni od statusa, pa
        // status stavke završavamo EKSPLICITNO (completeWorkOrderItem), ne kaskadom procesa.
        if (status === 'Završeno') {
            const unfinished = (item.Processes || []).filter(p => p.Status !== 'Završeno');
            if (unfinished.length > 0) {
                const fallbackWorkerId = (item as any).Assigned_Workers?.[0]?.Worker_ID
                    || item.Processes?.find(p => p.Worker_ID)?.Worker_ID;
                const fallbackWorker = workers.find(w => w.Worker_ID === fallbackWorkerId);
                setConfirmState({
                    title: `Završi proizvod: ${item.Product_Name}`,
                    confirmLabel: 'Označi i završi',
                    body: (
                        <>
                            <p style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)', fontSize: 14 }}>
                                {unfinished.length} {unfinished.length === 1 ? 'proces nije završen' : 'procesa nije završeno'}:
                            </p>
                            <ul style={{ margin: '0 0 12px 0', paddingLeft: 20, fontSize: 14, color: 'var(--text-primary)' }}>
                                {unfinished.map(p => <li key={p.Process_Name}>{p.Process_Name}</li>)}
                            </ul>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
                                Označiće se završenim (radnik: <strong>{fallbackWorker?.Name || '—'}</strong>, današnji datum) i proizvod će biti završen.
                            </p>
                        </>
                    ),
                    onConfirm: async () => {
                        try {
                            setIsLoading(item.ID);
                            const completedAt = new Date(new Date().toISOString().split('T')[0] + 'T12:00:00').toISOString();
                            for (const p of unfinished) {
                                await updateItemProcess(workOrder.Work_Order_ID, item.ID, p.Process_Name, {
                                    Status: 'Završeno',
                                    Completed_At: completedAt,
                                    Worker_ID: p.Worker_ID || fallbackWorker?.Worker_ID,
                                    Worker_Name: p.Worker_Name || fallbackWorker?.Name,
                                });
                            }
                            // Eksplicitno završi stavku (procesi ne pomiču status).
                            await completeWorkOrderItem(workOrder.Work_Order_ID, item.ID);
                            onRefresh?.('workOrders', 'projects', 'workLogs');
                        } catch (error) {
                            console.error('Error auto-completing processes:', error);
                            showToast?.('Greška pri završavanju procesa', 'error');
                        } finally {
                            setIsLoading(null);
                        }
                    },
                });
                return;
            }
        }
        try {
            setIsLoading(item.ID);
            if (status === 'U toku') await startWorkOrderItem(workOrder.Work_Order_ID, item.ID);
            else if (status === 'Završeno') await completeWorkOrderItem(workOrder.Work_Order_ID, item.ID);
            else await updateWorkOrderItemStatus(item.ID, 'Na čekanju', organizationId || '');
            onRefresh?.('workOrders', 'projects', 'workLogs');
        } catch (error) {
            console.error('Error setting item status:', error);
            showToast?.('Greška pri promjeni statusa', 'error');
        } finally {
            setIsLoading(null);
        }
    };

    // Pauza / nastavak proizvoda (dnevnice ne teku dok je pauziran)
    const pauseItem = async (item: WorkOrderItem, isPaused: boolean) => {
        setLocalItems(prev => prev.map(i => i.ID === item.ID ? { ...i, Is_Paused: isPaused } : i));
        try {
            await toggleItemPause(workOrder.Work_Order_ID, item.ID, isPaused);
            onRefresh?.('workOrders', 'projects', 'workLogs');
        } catch (error) {
            console.error('Error toggling pause:', error);
            setLocalItems(prev => prev.map(i => i.ID === item.ID ? { ...i, Is_Paused: !isPaused } : i));
        }
    };

    // ── Akcije na nivou naloga (eksplicitni životni ciklus: Pokreni → Završi) ──
    // Stavke koje nisu finalne (može se na njih djelovati grupno).
    const openItems = localItems.filter(i => {
        const s = (i.Status as string) || 'Na čekanju';
        return s !== 'Završeno' && s !== 'Otkazano';
    });
    const allPaused = openItems.length > 0 && openItems.every(i => i.Is_Paused);

    // Završi cijeli nalog (sve ne-završene stavke). Procesi su odspojeni — status vodi ova akcija.
    const completeOrder = () => {
        if (orderBusy) return;
        const unfinished = localItems.filter(i => (i.Status as string) !== 'Završeno');
        if (unfinished.length === 0) return;
        setConfirmState({
            title: 'Završi cijeli nalog',
            confirmLabel: 'Završi nalog',
            body: (
                <>
                    <p style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)', fontSize: 14 }}>
                        Završiće se {unfinished.length} {unfinished.length === 1 ? 'stavka' : 'stavki'}:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--text-primary)' }}>
                        {unfinished.map(i => <li key={i.ID}>{i.Product_Name} × {i.Quantity || 1}</li>)}
                    </ul>
                </>
            ),
            onConfirm: async () => {
                try {
                    setOrderBusy(true);
                    for (const it of unfinished) {
                        await completeWorkOrderItem(workOrder.Work_Order_ID, it.ID);
                    }
                    onRefresh?.('workOrders', 'projects', 'workLogs');
                } catch (error) {
                    console.error('Error completing order:', error);
                    showToast?.('Greška pri završavanju naloga', 'error');
                } finally {
                    setOrderBusy(false);
                }
            },
        });
    };

    // Pauza / nastavak cijelog naloga (sve otvorene stavke odjednom).
    const toggleOrderPause = async () => {
        if (orderBusy || openItems.length === 0) return;
        const next = !allPaused;
        const ids = openItems.map(i => i.ID);
        setLocalItems(prev => prev.map(i => ids.includes(i.ID) ? { ...i, Is_Paused: next } : i));
        try {
            setOrderBusy(true);
            for (const it of openItems) {
                await toggleItemPause(workOrder.Work_Order_ID, it.ID, next);
            }
            onRefresh?.('workOrders', 'projects', 'workLogs');
        } catch (error) {
            console.error('Error toggling order pause:', error);
            setLocalItems(prev => prev.map(i => ids.includes(i.ID) ? { ...i, Is_Paused: !next } : i));
            showToast?.('Greška pri pauzi naloga', 'error');
        } finally {
            setOrderBusy(false);
        }
    };

    // ── Izvedene vrijednosti za hero + tok ──────────────────────────────
    const isMontaza = workOrder.Work_Order_Type === 'Montaža';
    const fmt = (n: number) => Math.round(n).toLocaleString('hr-HR');
    const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

    // Financije po stavci — JEDINSTVENA formula iz lib/profit.ts (isti izvor kao
    // productivity i analitika); izvor i za per-item red i za hero total.
    const itemFin = useMemo(() => {
        const map = new Map<string, ProfitBreakdown>();
        for (const item of localItems) {
            const itemLogs = workLogs.filter(wl => wl.Work_Order_Item_ID === item.ID);
            const labor = itemLogs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);
            map.set(item.ID, itemProfitBreakdown({
                productValue: item.Product_Value,
                sellingOverride: (item as any).Profit_Overrides?.Selling_Price,
                materialPerUnit: item.Material_Cost,   // PO KOMADU (invarijanta baze)
                quantity: item.Quantity,
                laborTotal: labor,
                servicesTotal: (item as any).Services_Total,
                transportShare: (item as any).Transport_Share,
                transportOverride: (item as any).Profit_Overrides?.Transport_Share,
            }));
        }
        return map;
    }, [localItems, workLogs]);

    // Hero total = suma per-item (poklapa se s redovima).
    const orderFin = useMemo(() => sumBreakdowns(Array.from(itemFin.values())), [itemFin]);

    // Preusmjeren rad povezanih "raznih poslova" — SAMO INFORMATIVNO (namjerno NE ulazi u
    // itemFin/orderFin iznad): taj trošak je već uračunat u profit POVEZANOG proizvoda
    // (lib/laborTarget.ts resolveLaborCostTarget). Ovdje se prikazuje da rad nije "nestao"
    // s ovog naloga — vidljivo na oba mjesta, brojano samo jednom (kod proizvoda).
    const redirectedLaborByItem = useMemo(() => {
        const map = new Map<string, number>();
        for (const item of localItems) {
            if (item.Item_Type !== 'custom' || !item.Linked_Item_ID) continue;
            const total = workLogs
                .filter(wl => wl.Source_Work_Order_Item_ID === item.ID)
                .reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);
            if (total > 0) map.set(item.ID, total);
        }
        return map;
    }, [localItems, workLogs]);

    const procProgress = useMemo(() => orderProcessProgress(localItems), [localItems]);
    const bookedDays = useMemo(() => new Set(workLogs.map(l => l.Date)).size, [workLogs]);

    // Zadaci ovog naloga (žive iz Task.Links — isti dokument koji vidi tab Zadaci)
    const orderTasks = useMemo(() => tasksForWorkOrder(tasks, workOrder.Work_Order_ID), [tasks, workOrder.Work_Order_ID]);
    const taskStats = useMemo(() => taskProgress(orderTasks, todayISO()), [orderTasks]);

    // PRVI RAD: kad je radnik prvi put knjižen na nalog. Started_At je samo
    // pritisnuto dugme (zna se postaviti i automatski), a ovo je dokaz da je
    // neko stvarno stao na posao — zato ide u metrike, ne u fusnotu.
    const firstWork = useMemo(() => firstBookingDate(workLogs), [workLogs]);
    const firstWorkDaysAgo = useMemo(() => {
        if (!firstWork) return null;
        const d = daysUntil(firstWork);
        return d === null ? null : -d;
    }, [firstWork]);

    // Rok + odbrojavanje (živa boja metrike zamjenjuje baner)
    const dueDays = daysUntil(workOrder.Due_Date);
    const woActive = workOrder.Status !== 'Završeno' && workOrder.Status !== 'Otkazano';
    let rokSub = '';
    let rokState = '';
    if (woActive) {
        if (dueDays === null) rokSub = 'nije zadan';
        else if (dueDays < 0) { rokSub = `kasni ${-dueDays} ${-dueDays === 1 ? 'dan' : 'dana'}`; rokState = 'is-error'; }
        else if (dueDays === 0) { rokSub = 'danas'; rokState = 'is-warn'; }
        else { rokSub = `za ${dueDays} ${dueDays === 1 ? 'dan' : 'dana'}`; if (dueDays <= 2) rokState = 'is-warn'; }
    }

    const daniState = daysProgress.ratio === null ? '' : daysProgress.ratio > 1 ? 'is-error' : daysProgress.ratio >= 0.8 ? 'is-warn' : '';
    const profitWarn = !isMontaza && (orderFin.missingPrice || orderFin.missingMaterial);
    const profitWarnTitle = orderFin.missingPrice
        ? 'Prodajna cijena nije postavljena (nema prihvaćene ponude?) — profit je nepotpun'
        : 'Materijali nisu dodati ili nemaju cijenu — profit je nepotpun';

    // Rok advisory: stavke bez planiranih dana (ponuda nedopunjena) potcjenjuju auto-rok.
    const missingDaysCount = useMemo(() => (!isMontaza && woActive ? itemsWithoutPlannedDays(localItems) : 0), [localItems, isMontaza, woActive]);
    const rokWarnTitle = `${missingDaysCount} ${missingDaysCount === 1 ? 'stavka nema' : 'stavke/i nemaju'} planirane dane u ponudi — rok je potcijenjen`;

    return (
        <div className="wo-detail">
            {/* ═══ HERO: metrike (naziv/status/rok su već vidljivi u zaglavlju iznad) ═══ */}
            <div className="wo-hero">
                <div className="wo-hero-top">
                    {editingName ? (
                        <input autoFocus className="wo-name-input" value={nameDraft}
                            onChange={e => setNameDraft(e.target.value)}
                            onBlur={saveName}
                            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                            placeholder="Naziv naloga" />
                    ) : (
                        <button className="wo-rename-btn" onClick={() => { setNameDraft(workOrder.Name || ''); setEditingName(true); }} title="Preimenuj nalog">
                            <Edit2 size={13} /> Preimenuj
                        </button>
                    )}

                    {/* Životni ciklus naloga — jedino mjesto za start/pauza/završetak */}
                    <div className="wo-hero-actions">
                        {workOrder.Status === 'Na čekanju' && (
                            <button className="wo-hact start" onClick={() => onStart(workOrder.Work_Order_ID)}>
                                <Play size={16} /> Pokreni nalog
                            </button>
                        )}
                        {workOrder.Status === 'U toku' && (
                            <>
                                <button className="wo-hact" disabled={orderBusy} onClick={toggleOrderPause}
                                    title={allPaused ? 'Nastavi rad na nalogu' : 'Pauziraj nalog (dnevnice ne teku)'}>
                                    {allPaused ? <><Play size={15} /> Nastavi</> : <><Pause size={15} /> Pauza</>}
                                </button>
                                <button className="wo-hact done" disabled={orderBusy} onClick={completeOrder}
                                    title="Označi cijeli nalog završenim">
                                    <CheckCircle size={15} /> Završi nalog
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Traka metrika */}
                <div className="wo-metrics">
                    {/* Rok */}
                    <div className={`wo-metric clickable ${rokState}`}
                        title="Klikni za izmjenu roka"
                        onClick={() => { const i = document.getElementById(`wo-due-${workOrder.Work_Order_ID}`) as HTMLInputElement; i?.showPicker?.(); }}>
                        <span className="wo-metric-label" title={missingDaysCount > 0 ? rokWarnTitle : undefined}>
                            <Clock size={11} /> Rok
                            {missingDaysCount > 0 && <AlertTriangle size={11} className="wo-metric-warnicon" />}
                        </span>
                        <span className="wo-metric-value">{formatDate(workOrder.Due_Date)}</span>
                        {rokSub && <span className="wo-metric-sub">{rokSub}</span>}
                        <input id={`wo-due-${workOrder.Work_Order_ID}`} type="date" className="wo-hidden-date"
                            value={workOrder.Due_Date?.split('T')[0] || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={async (e) => {
                                const v = e.target.value; if (!v) return;
                                try {
                                    const { updateDueDate } = await import('@/lib/services');
                                    const res = await updateDueDate(workOrder.Work_Order_ID, v, workOrder.Organization_ID);
                                    if (res.success) { showToast?.('Rok ažuriran', 'success'); onRefresh?.('workOrders'); }
                                    else showToast?.(res.message, 'error');
                                } catch { showToast?.('Greška pri ažuriranju roka', 'error'); }
                            }} />
                    </div>

                    {/* Prvi rad — datum prvog knjiženja radnika (stvarni početak) */}
                    <div className="wo-metric" title={firstWork
                        ? `Prvi put je radnik knjižen na ovaj nalog ${formatDate(firstWork)} — stvarni početak rada`
                        : 'Nijedan radnik još nije knjižen na ovaj nalog'}>
                        <span className="wo-metric-label"><Hammer size={11} /> Prvi rad</span>
                        <span className="wo-metric-value">{firstWork ? formatDate(firstWork) : '—'}</span>
                        {firstWorkDaysAgo !== null && (
                            <span className="wo-metric-sub">
                                {firstWorkDaysAgo === 0 ? 'danas'
                                    : firstWorkDaysAgo === 1 ? 'jučer'
                                        : `prije ${firstWorkDaysAgo} dana`}
                            </span>
                        )}
                        {!firstWork && <span className="wo-metric-sub">nije počeo</span>}
                    </div>

                    {/* Profit / Trošak montaže */}
                    <div className={`wo-metric ${isMontaza ? '' : orderFin.profit >= 0 ? 'is-good' : 'is-error'}`}>
                        <span className="wo-metric-label" title={profitWarn ? profitWarnTitle : undefined}>
                            {isMontaza ? 'Trošak montaže' : 'Ostaje'}
                            {profitWarn && <AlertTriangle size={11} className="wo-metric-warnicon" />}
                        </span>
                        <span className="wo-metric-value">
                            {isMontaza
                                ? `${fmt(orderFin.labor)} KM`
                                : `${orderFin.profit < 0 ? '−' : ''}${fmt(Math.abs(orderFin.profit))} KM`}
                        </span>
                    </div>

                    {/* Radni dani (potrošeno / plan) */}
                    {daysProgress.planned > 0 && (
                        <div className={`wo-metric ${daniState}`} title="Potrošeni / planirani radnik-dani">
                            <span className="wo-metric-label"><span className="material-icons-round" style={{ fontSize: 12 }}>hourglass_bottom</span> Radni dani</span>
                            <span className="wo-metric-value">{fmtDays(daysProgress.actual)}/{fmtDays(daysProgress.planned)}</span>
                        </div>
                    )}

                    {/* Procesi */}
                    {procProgress && procProgress.total > 0 && (
                        <div className="wo-metric" title={`Završeno ${procProgress.done} od ${procProgress.total} procesa`}>
                            <span className="wo-metric-label"><GitBranch size={11} /> Procesi</span>
                            <span className="wo-metric-value">{procProgress.done}/{procProgress.total}</span>
                            <span className="wo-metric-bar"><span className={`wo-metric-bar-fill ${procProgress.pct >= 100 ? 'full' : ''}`} style={{ width: `${procProgress.pct}%` }} /></span>
                        </div>
                    )}

                    {/* Prisustvo (rupe u šihtarici) */}
                    {missingAttendance && (
                        <div className="wo-metric is-error"
                            title={`Nedostaje evidencija rada (${missingAttendance.count}): ${missingAttendance.details.slice(0, 4).join(', ')}${missingAttendance.details.length > 4 ? '…' : ''}. Profit možda nije tačan.`}>
                            <span className="wo-metric-label"><AlertTriangle size={11} /> Prisustvo</span>
                            <span className="wo-metric-value">⚠ {missingAttendance.count}</span>
                        </div>
                    )}
                </div>

                {/* Advisory rok — sitni inline prijedlog (ne baner) */}
                {dueSuggestion && !dueSuggestionDismissed && (
                    <div className="wo-advisory">
                        <Clock size={14} />
                        <span>Prema planu ({dueSuggestion.totalDays} radnih dana od {formatDate(dueSuggestion.startISO)}) predviđeni rok je <strong>{formatDate(dueSuggestion.suggested)}</strong>.</span>
                        <div className="wo-advisory-actions">
                            <button className="wo-advisory-btn" onClick={applySuggestedDue}>Ažuriraj rok</button>
                            <button className="wo-advisory-btn ghost" onClick={() => setDueSuggestionDismissed(true)}>Zanemari</button>
                        </div>
                    </div>
                )}
            </div>

            {/* ═══ SEGMENTED: Tok / Knjiga rada / Zadaci ═══ */}
            <div className="wo-seg">
                <button className={tab === 'tok' ? 'active' : ''} onClick={() => setTab('tok')}>
                    Tok proizvodnje {localItems.length > 0 && <span className="wo-seg-count">{localItems.length}</span>}
                </button>
                <button className={tab === 'rad' ? 'active' : ''} onClick={() => setTab('rad')}>
                    <NotebookPen size={14} /> Knjiga rada {bookedDays > 0 && <span className="wo-seg-count">{bookedDays}</span>}
                </button>
                <button className={tab === 'zadaci' ? 'active' : ''} onClick={() => setTab('zadaci')}
                    title={taskStats.overdue > 0 ? `${taskStats.overdue} zadataka kasni` : undefined}>
                    <ListTodo size={14} /> Zadaci
                    {taskStats.total > 0 && (
                        <span className={`wo-seg-count${taskStats.overdue > 0 ? ' late' : ''}`}>
                            {taskStats.done}/{taskStats.total}
                        </span>
                    )}
                </button>
            </div>

            {/* ═══ TOK: proizvodi + procesi (kičma) ═══ */}
            {tab === 'tok' && (
                <div className="wo-flow">
                    <div className="wo-flow-head">
                        <button className="wo-flow-toggle" onClick={() => setFlowOpen(o => !o)}>
                            <span className="material-icons-round wo-flow-chevron">{flowOpen ? 'expand_more' : 'chevron_right'}</span>
                            <span className="wo-flow-title">Procesi naloga</span>
                            {procProgress && procProgress.total > 0 && (
                                <span className="wo-flow-count">{procProgress.done}/{procProgress.total}</span>
                            )}
                        </button>
                        <button className="wo-graf-btn" onClick={() => setProcessOpen(true)}>
                            <GitBranch size={15} /> Graf procesa
                        </button>
                    </div>
                    {flowOpen && (
                        <OrderProcessBoard
                            workOrderId={workOrder.Work_Order_ID}
                            items={localItems.length ? localItems : (workOrder.items || [])}
                            workers={workers}
                            workLogs={workLogs}
                            organizationId={organizationId || undefined}
                            onChanged={() => { onRefresh?.('workOrders'); reloadWorkLogs(); }}
                            showToast={showToast}
                            graphReloadKey={graphVersion}
                        />
                    )}

                    <div className="wo-flow-title" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        Proizvodi
                        {localItems.length > 0 && <span className="wo-flow-count">{localItems.length}</span>}
                    </div>
                    {localItems.length > 0 ? localItems.map(item => {
                        const fin = itemFin.get(item.ID) || itemProfitBreakdown({});
                        const status = (item.Status as string) || 'Na čekanju';
                        const isPaused = !!item.Is_Paused;
                        const showWarn = !isMontaza && (fin.missingPrice || fin.missingMaterial);
                        // Sklopivo: 2+ proizvoda su sklopljeni po defaultu (klik = rasklopi).
                        // Za jedan proizvod uvijek otvoreno (nema šta sklapati, a Detalji su glavna radnja).
                        const collapsible = localItems.length > 1;
                        const isOpen = !collapsible || expandedProducts.has(item.ID);
                        const statusColor = status === 'Završeno' ? 'var(--success)' : status === 'U toku' ? 'var(--accent)' : 'var(--text-tertiary)';
                        return (
                            <div key={item.ID} className={`wo-product ${isOpen ? 'open' : ''}`}>
                                {/* Sažetak (naziv, količina, status, profit) — klik sklapa/rasklapa */}
                                <div className={`wo-product-top ${collapsible ? 'wo-product-summary' : ''}`}
                                    role={collapsible ? 'button' : undefined}
                                    onClick={collapsible ? () => toggleProduct(item.ID) : undefined}>
                                    <div className="wo-product-name-wrap">
                                        {collapsible && (
                                            <span className="material-icons-round wo-flow-chevron">{isOpen ? 'expand_more' : 'chevron_right'}</span>
                                        )}
                                        <span className="wo-product-name">{item.Product_Name}</span>
                                        <span className="wo-product-qty">× {item.Quantity || 1}</span>
                                        <span className="wo-product-status-pill" style={{ color: statusColor, borderColor: statusColor }}>
                                            {status === 'Na čekanju' ? 'Čeka' : status}
                                        </span>
                                        {isPaused && <span className="wo-pause-tag">PAUZA</span>}
                                        {showWarn && (
                                            <span className="wo-warn-tag" title={fin.missingPrice ? profitWarnTitle : 'Materijali nisu dodati ili nemaju cijenu — profit je nepotpun'}>
                                                <AlertTriangle size={11} /> {fin.missingPrice ? 'BEZ CIJENE' : 'BEZ MATERIJALA'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="wo-product-money">
                                        {redirectedLaborByItem.has(item.ID) ? (
                                            <>
                                                <div className="wo-product-money-value">{fmt(redirectedLaborByItem.get(item.ID)!)} KM</div>
                                                <div className="wo-product-money-label" title="Rad je uračunat u profit povezanog proizvoda — ovdje samo informativno">
                                                    preusmjereno{item.Linked_Product_Name ? ` → ${item.Linked_Product_Name}` : ''}
                                                </div>
                                            </>
                                        ) : isMontaza ? (
                                            <>
                                                <div className="wo-product-money-value">{fmt(fin.labor)} KM</div>
                                                <div className="wo-product-money-label">trošak montaže</div>
                                            </>
                                        ) : (
                                            <>
                                                <div className={`wo-product-money-value ${fin.profit >= 0 ? 'pos' : 'neg'}`}>
                                                    {fin.profit < 0 ? '−' : ''}{fmt(Math.abs(fin.profit))} KM
                                                </div>
                                                <div className="wo-product-money-label">ostaje</div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {isOpen && (
                                    <>
                                        {/* Status + pauza — per-proizvod kontrole SAMO kad ima 2+ proizvoda.
                                            Za jedan proizvod životni ciklus vodi status naloga (hero). */}
                                        {localItems.length > 1 && (
                                            <div className="wo-product-controls">
                                                <div className="wo-status-seg">
                                                    {(['Na čekanju', 'U toku', 'Završeno'] as const).map(s => (
                                                        <button key={s}
                                                            className={status === s ? 'active' : ''}
                                                            disabled={isLoading === item.ID}
                                                            onClick={() => setItemStatus(item, s)}
                                                        >{s === 'Na čekanju' ? 'Čeka' : s}</button>
                                                    ))}
                                                </div>
                                                {status === 'U toku' && (
                                                    <button className="wo-pause" disabled={isLoading === item.ID} onClick={() => pauseItem(item, !isPaused)}>
                                                        {isPaused ? <><Play size={13} /> Nastavi</> : <><Pause size={13} /> Pauza</>}
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        <button className="wo-details" onClick={() => setTimelineItem(item)}>
                                            Detalji proizvoda (cijena, materijal, rad) →
                                        </button>
                                    </>
                                )}
                            </div>
                        );
                    }) : (
                        <div className="wo-empty">Nema proizvoda u ovom nalogu.</div>
                    )}
                </div>
            )}

            {/* ═══ KNJIGA RADA: samo dnevni tracker ═══
                Traka datuma (Kreiran/Početak/Prvi rad/Rok) je uklonjena — rok i prvi rad
                stoje u hero metrikama iznad, pa se ovdje samo ponavljalo. Ispravka
                Started_At/Completed_At (adjustWorkOrderDates) je išla kroz tu traku:
                sad se datumi mijenjaju knjiženjem dana ispod, što je i izvor istine. */}
            {tab === 'rad' && (
                <div className="wo-rad">
                    <div>
                        <div className="wo-rad-head"><NotebookPen size={15} /> Knjiga rada naloga</div>
                        <WorkOrderWorkLog
                            workOrder={workOrder}
                            items={(localItems.length ? localItems : (workOrder.items || []))}
                            workLogs={workLogs}
                            workers={workers}
                            organizationId={organizationId || ''}
                            onReload={reloadWorkLogs}
                            showToast={showToast || (() => { })}
                        />
                    </div>
                </div>
            )}

            {/* ═══ ZADACI: pregled i čekiranje bez odlaska u tab Zadaci ═══ */}
            {tab === 'zadaci' && (
                <WorkOrderTasksPanel
                    workOrder={workOrder}
                    tasks={tasks}
                    workers={workers}
                    organizationId={organizationId || ''}
                    onRefresh={onRefresh || (() => { })}
                    showToast={showToast || (() => { })}
                />
            )}

            {/* Graf procesa naloga */}
            {processOpen && (
                <ProcessGraphModal
                    workOrderId={workOrder.Work_Order_ID}
                    workOrderNumber={workOrder.Work_Order_Number}
                    workOrderName={workOrderDisplayName(workOrder)}
                    items={(localItems.length ? localItems : (workOrder.items || [])).map(i => ({ ID: i.ID, Product_Name: i.Product_Name, Processes: i.Processes, Process_Stages: i.Process_Stages }))}
                    workLogs={workLogs}
                    organizationId={organizationId || ''}
                    onClose={() => { setProcessOpen(false); setGraphVersion(v => v + 1); }}
                    showToast={showToast}
                />
            )}

            {/* Potvrda akcija (završetak proizvoda/naloga) — stilizovan dijalog umjesto window.confirm */}
            {confirmState && (
                <Modal
                    isOpen={true}
                    onClose={() => setConfirmState(null)}
                    title={confirmState.title}
                    footer={
                        <>
                            <button className="btn btn-secondary" onClick={() => setConfirmState(null)}>Odustani</button>
                            <button className="btn btn-primary" onClick={async () => {
                                const fn = confirmState.onConfirm;
                                setConfirmState(null);
                                await fn();
                            }}>{confirmState.confirmLabel}</button>
                        </>
                    }
                >
                    {confirmState.body}
                </Modal>
            )}

            {/* ProductTimelineModal — SAMO PREGLED (uređivanje dnevnica ide kroz tab „Knjiga rada") */}
            {timelineItem && (
                <ProductTimelineModal
                    isOpen={true}
                    onClose={() => setTimelineItem(null)}
                    productId={timelineItem.Product_ID}
                    productName={timelineItem.Product_Name}
                    workOrderItem={timelineItem}
                    workLogs={workLogs.filter(wl => wl.Product_ID === timelineItem.Product_ID)}
                    sellingPrice={timelineItem.Product_Value}
                    materialCost={itemMaterialTotal(timelineItem.Material_Cost, timelineItem.Quantity)}
                    laborCost={timelineItem.Actual_Labor_Cost}
                    workers={workers}
                    readOnly
                />
            )}
        </div>
    );
}
