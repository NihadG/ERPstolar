import { useState, useEffect, useMemo } from 'react';
import { Calendar, Play, Pause, CheckCircle, Clock, Edit2, AlertTriangle, NotebookPen, GitBranch } from 'lucide-react';
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
import { workOrderDueDate, buildSaturdayChecker, todayISO, daysUntil, plannedVsActualDays, type AttendanceLite } from '@/lib/planning';
import type { WorkOrder, Worker, WorkOrderItem, WorkLog } from '@/lib/types';
import ProductTimelineModal from './ProductTimelineModal';
import WorkOrderWorkLog from './WorkOrderWorkLog';
import ProcessGraphModal from './ProcessGraphModal';
import OrderProcessBoard from './OrderProcessBoard';
import { workOrderDisplayName, orderProcessProgress } from '@/lib/utils';
import './WorkOrderExpandedDetail.css';

interface WorkOrderExpandedDetailProps {
    workOrder: WorkOrder;
    workers: Worker[];
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
    const [tab, setTab] = useState<'tok' | 'rad'>('tok');
    const [flowOpen, setFlowOpen] = useState(false);   // "Procesi naloga" — collapsed po defaultu (liste znaju biti duge)

    const saveName = async () => {
        const v = nameDraft.trim();
        setEditingName(false);
        if (v !== (workOrder.Name || '')) {
            await onUpdate(workOrder.Work_Order_ID, { Name: v });
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
                const ok = window.confirm(
                    `${unfinished.length} ${unfinished.length === 1 ? 'proces nije završen' : 'procesa nije završeno'} (${unfinished.map(p => p.Process_Name).join(', ')}).\n\n` +
                    `Označiti ih završenim (radnik: ${fallbackWorker?.Name || '—'}, današnji datum) i završiti proizvod?`
                );
                if (!ok) return;
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
    const completeOrder = async () => {
        if (orderBusy) return;
        const unfinished = localItems.filter(i => (i.Status as string) !== 'Završeno');
        if (unfinished.length === 0) return;
        const ok = window.confirm(
            `Završiti cijeli nalog? (${unfinished.length} ${unfinished.length === 1 ? 'stavka' : 'stavki'})`
        );
        if (!ok) return;
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

    // Financije po stavci — ista formula kao ranije; izvor i za per-item red i za hero total.
    // (P&L: cijena − materijal − rad − usluge − transport = što ostaje.)
    const itemFin = useMemo(() => {
        const map = new Map<string, {
            value: number; material: number; labor: number; services: number; transport: number;
            profit: number; missingPrice: boolean; missingMaterial: boolean;
        }>();
        for (const item of localItems) {
            const itemLogs = workLogs.filter(wl => wl.Work_Order_Item_ID === item.ID);
            const labor = itemLogs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);
            const value = ((item as any).Profit_Overrides?.Selling_Price ?? item.Product_Value) || 0;
            const material = item.Material_Cost || 0;
            const services = (item as any).Services_Total || 0;
            const transport = (item as any).Profit_Overrides?.Transport_Share ?? (item as any).Transport_Share ?? 0;
            map.set(item.ID, {
                value, material, labor, services, transport,
                profit: value - material - labor - services - transport,
                missingPrice: value <= 0, missingMaterial: material <= 0,
            });
        }
        return map;
    }, [localItems, workLogs]);

    // Hero total = suma per-item (poklapa se s redovima).
    const orderFin = useMemo(() => {
        let value = 0, material = 0, labor = 0, services = 0, transport = 0, missingPrice = false, missingMaterial = false;
        itemFin.forEach(f => {
            value += f.value; material += f.material; labor += f.labor; services += f.services; transport += f.transport;
            if (f.missingPrice) missingPrice = true;
            if (f.missingMaterial) missingMaterial = true;
        });
        return { value, material, labor, services, transport, profit: value - material - labor - services - transport, missingPrice, missingMaterial };
    }, [itemFin]);

    const procProgress = useMemo(() => orderProcessProgress(localItems), [localItems]);
    const bookedDays = useMemo(() => new Set(workLogs.map(l => l.Date)).size, [workLogs]);

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
                        <span className="wo-metric-label"><Clock size={11} /> Rok</span>
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

            {/* ═══ SEGMENTED: Tok / Knjiga rada ═══ */}
            <div className="wo-seg">
                <button className={tab === 'tok' ? 'active' : ''} onClick={() => setTab('tok')}>
                    Tok proizvodnje {localItems.length > 0 && <span className="wo-seg-count">{localItems.length}</span>}
                </button>
                <button className={tab === 'rad' ? 'active' : ''} onClick={() => setTab('rad')}>
                    <NotebookPen size={14} /> Knjiga rada {bookedDays > 0 && <span className="wo-seg-count">{bookedDays}</span>}
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
                        />
                    )}

                    <div className="wo-flow-title" style={{ marginTop: 6 }}>Proizvodi</div>
                    {localItems.length > 0 ? localItems.map(item => {
                        const fin = itemFin.get(item.ID) || { value: 0, material: 0, labor: 0, services: 0, transport: 0, profit: 0, missingPrice: true, missingMaterial: true };
                        const status = (item.Status as string) || 'Na čekanju';
                        const isPaused = !!item.Is_Paused;
                        const showWarn = !isMontaza && (fin.missingPrice || fin.missingMaterial);
                        return (
                            <div key={item.ID} className="wo-product">
                                {/* Naziv + profit */}
                                <div className="wo-product-top">
                                    <div className="wo-product-name-wrap">
                                        <span className="wo-product-name">{item.Product_Name}</span>
                                        {isPaused && <span className="wo-pause-tag">PAUZA</span>}
                                        {showWarn && (
                                            <span className="wo-warn-tag" title={fin.missingPrice ? profitWarnTitle : 'Materijali nisu dodati ili nemaju cijenu — profit je nepotpun'}>
                                                <AlertTriangle size={11} /> {fin.missingPrice ? 'BEZ CIJENE' : 'BEZ MATERIJALA'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="wo-product-money">
                                        {isMontaza ? (
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
                            </div>
                        );
                    }) : (
                        <div className="wo-empty">Nema proizvoda u ovom nalogu.</div>
                    )}
                </div>
            )}

            {/* ═══ KNJIGA RADA: vremenska linija + dnevni tracker ═══ */}
            {tab === 'rad' && (
                <div className="wo-rad">
                    <div className="wo-timeline">
                        <span className="wo-date"><Calendar size={14} /> Kreiran <strong>{formatDate(workOrder.Created_Date)}</strong></span>
                        <span className={`wo-date ${workOrder.Started_At ? 'clickable' : ''}`}
                            onClick={() => { if (!workOrder.Started_At) return; const i = document.getElementById(`wo-start-${workOrder.Work_Order_ID}`) as HTMLInputElement; i?.showPicker?.(); }}>
                            <Play size={14} /> Početak <strong>{formatDate(workOrder.Started_At)}</strong>
                            {workOrder.Started_At && <Edit2 size={10} style={{ color: 'var(--text-tertiary)' }} />}
                            <input id={`wo-start-${workOrder.Work_Order_ID}`} type="date" className="wo-hidden-date"
                                value={workOrder.Started_At?.split('T')[0] || ''}
                                onClick={e => e.stopPropagation()}
                                onChange={async (e) => {
                                    const v = e.target.value; if (!v) return;
                                    try {
                                        const { adjustWorkOrderDates } = await import('@/lib/services');
                                        const res = await adjustWorkOrderDates(workOrder.Work_Order_ID, { Started_At: v }, workOrder.Organization_ID);
                                        if (res.success) { showToast?.('Datum početka ažuriran', 'success'); onRefresh?.('workOrders', 'projects'); }
                                        else showToast?.(res.message, 'error');
                                    } catch { showToast?.('Greška pri ažuriranju datuma', 'error'); }
                                }} />
                        </span>
                        {workOrder.Completed_At && (
                            <span className="wo-date clickable"
                                onClick={() => { const i = document.getElementById(`wo-comp-${workOrder.Work_Order_ID}`) as HTMLInputElement; i?.showPicker?.(); }}>
                                <CheckCircle size={14} /> Završeno <strong>{formatDate(workOrder.Completed_At)}</strong>
                                <Edit2 size={10} style={{ color: 'var(--text-tertiary)' }} />
                                <input id={`wo-comp-${workOrder.Work_Order_ID}`} type="date" className="wo-hidden-date"
                                    value={workOrder.Completed_At?.split('T')[0] || ''}
                                    onClick={e => e.stopPropagation()}
                                    onChange={async (e) => {
                                        const v = e.target.value; if (!v) return;
                                        try {
                                            const { adjustWorkOrderDates } = await import('@/lib/services');
                                            const res = await adjustWorkOrderDates(workOrder.Work_Order_ID, { Completed_At: v }, workOrder.Organization_ID);
                                            if (res.success) { showToast?.('Datum završetka ažuriran', 'success'); onRefresh?.('workOrders', 'projects'); }
                                            else showToast?.(res.message, 'error');
                                        } catch { showToast?.('Greška pri ažuriranju datuma', 'error'); }
                                    }} />
                            </span>
                        )}
                        <span className="wo-date deadline"><Clock size={14} /> Rok <strong>{formatDate(workOrder.Due_Date)}</strong></span>
                    </div>

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

            {/* Graf procesa naloga */}
            {processOpen && (
                <ProcessGraphModal
                    workOrderId={workOrder.Work_Order_ID}
                    workOrderNumber={workOrder.Work_Order_Number}
                    workOrderName={workOrderDisplayName(workOrder)}
                    items={(localItems.length ? localItems : (workOrder.items || [])).map(i => ({ ID: i.ID, Product_Name: i.Product_Name, Processes: i.Processes, Process_Stages: i.Process_Stages }))}
                    workLogs={workLogs}
                    organizationId={organizationId || ''}
                    onClose={() => setProcessOpen(false)}
                    showToast={showToast}
                />
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
                    materialCost={timelineItem.Material_Cost}
                    laborCost={timelineItem.Actual_Labor_Cost}
                    workers={workers}
                    readOnly
                />
            )}
        </div>
    );
}
