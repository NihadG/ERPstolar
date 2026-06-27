import { useState, useEffect } from 'react';
import { Calendar, Play, Pause, CheckCircle, Clock, Edit2, AlertTriangle, NotebookPen, Printer, Trash2, GitBranch } from 'lucide-react';
import { useData } from '@/context/DataContext';
import {
    checkMissingAttendanceHistory,
    getWorkLogsForWorkOrder,
    overrideWorkLogs,
    startWorkOrderItem,
    completeWorkOrderItem,
    updateWorkOrderItemStatus,
    toggleItemPause,
} from '@/lib/services';
import type { WorkOrder, Worker, WorkOrderItem, WorkLog } from '@/lib/types';
import ProductTimelineModal from './ProductTimelineModal';
import WorkOrderWorkLog from './WorkOrderWorkLog';
import ProcessGraphModal from './ProcessGraphModal';
import { workOrderDisplayName } from '@/lib/utils';

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
    onPrint,
    onDelete,
    onStart,
    onRefresh,
    showToast
}: WorkOrderExpandedDetailProps) {
    const [localItems, setLocalItems] = useState<WorkOrderItem[]>([]);
    const [isLoading, setIsLoading] = useState<string | null>(null);
    const { organizationId } = useData();

    // S16: Missing Attendance State
    const [missingAttendance, setMissingAttendance] = useState<{ count: number; details: string[] } | null>(null);

    // Work logs (izvor profita po proizvodu — iz dnevnika rada)
    const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
    const [timelineItem, setTimelineItem] = useState<WorkOrderItem | null>(null);
    const [processOpen, setProcessOpen] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');

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

            {/* === HEADER: NAZIV + DATES === */}
            <div className="wo-title-row" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                {editingName ? (
                    <input autoFocus value={nameDraft}
                        onChange={e => setNameDraft(e.target.value)}
                        onBlur={saveName}
                        onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                        placeholder="Naziv naloga"
                        style={{ fontSize: 18, fontWeight: 700, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent)', outline: 'none', minWidth: 260 }} />
                ) : (
                    <button onClick={() => { setNameDraft(workOrder.Name || ''); setEditingName(true); }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}
                        title="Preimenuj nalog">
                        {workOrderDisplayName(workOrder)}
                        <Edit2 size={15} style={{ color: 'var(--text-tertiary)' }} />
                    </button>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>#{workOrder.Work_Order_Number}</span>
            </div>

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
                    <div className="date-chip" style={{ cursor: workOrder.Started_At ? 'pointer' : 'default', position: 'relative' }}
                        onClick={() => {
                            if (!workOrder.Started_At) return;
                            const input = document.getElementById(`start-date-${workOrder.Work_Order_ID}`) as HTMLInputElement;
                            if (input) input.showPicker();
                        }}
                    >
                        <Play size={14} />
                        <span>Početak</span>
                        <strong>{formatDate(workOrder.Started_At)}</strong>
                        {workOrder.Started_At && <Edit2 size={10} style={{ color: '#86868b', marginLeft: 4 }} />}
                        <input
                            id={`start-date-${workOrder.Work_Order_ID}`}
                            type="date"
                            value={workOrder.Started_At?.split('T')[0] || ''}
                            onChange={async (e) => {
                                const newDate = e.target.value;
                                if (!newDate) return;
                                try {
                                    const { adjustWorkOrderDates } = await import('@/lib/services');
                                    const orgId = workOrder.Organization_ID;
                                    const res = await adjustWorkOrderDates(workOrder.Work_Order_ID, { Started_At: newDate }, orgId);
                                    if (res.success) {
                                        showToast?.('Datum početka ažuriran', 'success');
                                        onRefresh?.('workOrders', 'projects');
                                    } else {
                                        showToast?.(res.message, 'error');
                                    }
                                } catch (err) {
                                    showToast?.('Greška pri ažuriranju datuma', 'error');
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: 0,
                                height: 0,
                                opacity: 0,
                                overflow: 'hidden',
                                pointerEvents: 'none',
                            }}
                        />
                    </div>
                    <div className="date-chip" style={{ cursor: workOrder.Completed_At ? 'pointer' : 'default', position: 'relative' }}
                        onClick={() => {
                            if (!workOrder.Completed_At) return;
                            const input = document.getElementById(`complete-date-${workOrder.Work_Order_ID}`) as HTMLInputElement;
                            if (input) input.showPicker();
                        }}
                    >
                        <CheckCircle size={14} />
                        <span>Završeno</span>
                        <strong>{formatDate(workOrder.Completed_At)}</strong>
                        {workOrder.Completed_At && <Edit2 size={10} style={{ color: '#86868b', marginLeft: 4 }} />}
                        <input
                            id={`complete-date-${workOrder.Work_Order_ID}`}
                            type="date"
                            value={workOrder.Completed_At?.split('T')[0] || ''}
                            onChange={async (e) => {
                                const newDate = e.target.value;
                                if (!newDate) return;
                                try {
                                    const { adjustWorkOrderDates } = await import('@/lib/services');
                                    const orgId = workOrder.Organization_ID;
                                    const res = await adjustWorkOrderDates(workOrder.Work_Order_ID, { Completed_At: newDate }, orgId);
                                    if (res.success) {
                                        showToast?.('Datum završetka ažuriran', 'success');
                                        onRefresh?.('workOrders', 'projects');
                                    } else {
                                        showToast?.(res.message, 'error');
                                    }
                                } catch (err) {
                                    showToast?.('Greška pri ažuriranju datuma', 'error');
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: 0,
                                height: 0,
                                opacity: 0,
                                overflow: 'hidden',
                                pointerEvents: 'none',
                            }}
                        />
                    </div>
                    <div className="date-chip deadline" style={{ cursor: 'pointer', position: 'relative' }}
                        onClick={() => {
                            const input = document.getElementById(`due-date-${workOrder.Work_Order_ID}`) as HTMLInputElement;
                            if (input) input.showPicker();
                        }}
                    >
                        <Clock size={14} />
                        <span>Rok</span>
                        <strong>{formatDate(workOrder.Due_Date)}</strong>
                        <Edit2 size={10} style={{ color: '#86868b', marginLeft: 4 }} />
                        <input
                            id={`due-date-${workOrder.Work_Order_ID}`}
                            type="date"
                            value={workOrder.Due_Date?.split('T')[0] || ''}
                            onChange={async (e) => {
                                const newDate = e.target.value;
                                if (!newDate) return;
                                try {
                                    const { updateDueDate } = await import('@/lib/services');
                                    const orgId = workOrder.Organization_ID;
                                    const res = await updateDueDate(workOrder.Work_Order_ID, newDate, orgId);
                                    if (res.success) {
                                        showToast?.('Rok ažuriran', 'success');
                                        onRefresh?.('workOrders');
                                    } else {
                                        showToast?.(res.message, 'error');
                                    }
                                } catch (err) {
                                    showToast?.('Greška pri ažuriranju roka', 'error');
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: 0,
                                height: 0,
                                opacity: 0,
                                overflow: 'hidden',
                                pointerEvents: 'none',
                            }}
                        />
                    </div>
                </div>

                {workOrder.Status === 'Na čekanju' && (
                    <button className="btn-action btn-start" onClick={() => onStart(workOrder.Work_Order_ID)}>
                        <Play size={16} /> Pokreni
                    </button>
                )}
            </div>


            {/* === PROIZVODI (status + profit iz dnevnika rada) === */}
            <div className="products-section">
                <div className="products-head">
                    <span>Proizvodi</span>
                    {workLogs.length > 0 && <span className="products-badge">{workLogs.length} zapisa rada</span>}
                </div>

                {localItems.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {localItems.map(item => {
                            const itemLogs = workLogs.filter(wl => wl.Work_Order_Item_ID === item.ID);
                            const laborCost = itemLogs.reduce((sum, wl) => sum + (wl.Daily_Rate || 0), 0);
                            const workDays = Math.round(itemLogs.reduce((sum, wl) => sum + (wl.Day_Fraction ?? 1), 0) * 100) / 100;
                            const planned = item.Planned_Labor_Cost || 0;
                            const overBudget = planned > 0 && laborCost > planned;

                            // P&L: cijena − materijal − rad − usluge − transport = što je ostalo
                            // (usluge i transport su troškovi — isto kao u Projekti tabu)
                            const value = ((item as any).Profit_Overrides?.Selling_Price ?? item.Product_Value) || 0;
                            const material = item.Material_Cost || 0;
                            const services = (item as any).Services_Total || 0;
                            const transport = (item as any).Profit_Overrides?.Transport_Share ?? (item as any).Transport_Share ?? 0;
                            const profit = value - material - laborCost - services - transport;
                            const profitColor = profit >= 0 ? '#059669' : '#dc2626';
                            // Montažni nalog: nema prihoda/materijala (oni su na proizvodnom nalogu) → prikaži TROŠAK montaže, ne "profit".
                            const isMontaza = workOrder.Work_Order_Type === 'Montaža';

                            // Po radniku (iz dnevnika rada)
                            const wMap = new Map<string, { name: string; days: number; cost: number }>();
                            itemLogs.forEach(wl => {
                                const cur = wMap.get(wl.Worker_ID) || { name: wl.Worker_Name, days: 0, cost: 0 };
                                cur.days += wl.Day_Fraction ?? 1; cur.cost += wl.Daily_Rate || 0;
                                wMap.set(wl.Worker_ID, cur);
                            });
                            const workersArr = Array.from(wMap.values()).sort((a, b) => b.cost - a.cost);
                            const fmt = (n: number) => Math.round(n).toLocaleString('hr-HR');

                            const status = (item.Status as string) || 'Na čekanju';
                            const isPaused = !!item.Is_Paused;
                            return (
                                <div
                                    key={item.ID}
                                    style={{
                                        display: 'flex', flexDirection: 'column', gap: '10px',
                                        padding: '14px', borderRadius: '10px',
                                        border: '1px solid #e2e8f0', background: '#ffffff',
                                    }}
                                >
                                    {/* Header: naziv + profit */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                            <span style={{ fontWeight: 600, fontSize: '14px', color: '#0f172a' }}>{item.Product_Name}</span>
                                            {isPaused && <span style={{ fontSize: '10px', fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '2px 7px', borderRadius: '999px' }}>PAUZA</span>}
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            {isMontaza ? (
                                                <>
                                                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{fmt(laborCost)} KM</div>
                                                    <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>trošak montaže</div>
                                                </>
                                            ) : (
                                                <>
                                                    <div style={{ fontSize: '15px', fontWeight: 700, color: profitColor }}>
                                                        {profit >= 0 ? '' : '−'}{fmt(Math.abs(profit))} KM
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>ostaje</div>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Status + pauza */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <div className="status-seg">
                                            {(['Na čekanju', 'U toku', 'Završeno'] as const).map(s => (
                                                <button key={s}
                                                    className={status === s ? 'active' : ''}
                                                    disabled={isLoading === item.ID}
                                                    onClick={() => setItemStatus(item, s)}
                                                >{s === 'Na čekanju' ? 'Čeka' : s}</button>
                                            ))}
                                        </div>
                                        {status === 'U toku' && (
                                            <button className="pause-btn" disabled={isLoading === item.ID} onClick={() => pauseItem(item, !isPaused)}>
                                                {isPaused ? <><Play size={13} /> Nastavi</> : <><Pause size={13} /> Pauza</>}
                                            </button>
                                        )}
                                    </div>

                                    {/* Detalji (cijena/materijal/rad, po radniku, plan vs stvarno) na zahtjev — u modalu */}
                                    <button className="details-link" onClick={() => setTimelineItem(item)}>
                                        Detalji proizvoda →
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="products-empty">Nema proizvoda u ovom nalogu.</div>
                )}

                {/* Knjiga rada naloga — jedinstveni dnevni tracker (zamjenjuje Evidentiraj rad + Brzi unos) */}
                <div className="wo-worklog">
                    <div className="wo-worklog-head"><NotebookPen size={15} /> Knjiga rada naloga</div>
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

                {/* Akcije naloga */}
                <div className="wo-actions">
                    <button className="wo-act" onClick={() => setProcessOpen(true)}>
                        <GitBranch size={15} /> Procesi
                    </button>
                    <button className="wo-act" onClick={() => onPrint(workOrder)}>
                        <Printer size={15} /> Printaj
                    </button>
                    <button className="wo-act wo-act-danger" onClick={() => onDelete(workOrder.Work_Order_ID)}>
                        <Trash2 size={15} /> Obriši nalog
                    </button>
                </div>
            </div>

            {/* Graf procesa naloga */}
            {processOpen && (
                <ProcessGraphModal
                    workOrderId={workOrder.Work_Order_ID}
                    workOrderNumber={workOrder.Work_Order_Number}
                    workOrderName={workOrderDisplayName(workOrder)}
                    items={(localItems.length ? localItems : (workOrder.items || [])).map(i => ({ ID: i.ID, Product_Name: i.Product_Name }))}
                    workLogs={workLogs}
                    organizationId={organizationId || ''}
                    onClose={() => setProcessOpen(false)}
                    showToast={showToast}
                />
            )}

            {/* ProductTimelineModal for selected item */}
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
                    onOverrideWorkLogs={async (entries) => {
                        if (!timelineItem?.Work_Order_ID || !timelineItem?.ID || !organizationId) {
                            return { success: false, message: 'Nedostaju podaci' };
                        }
                        const result = await overrideWorkLogs(
                            timelineItem.Work_Order_ID,
                            timelineItem.ID,
                            entries,
                            organizationId,
                            timelineItem.Product_ID
                        );
                        if (result.success) {
                            showToast?.('Timeline ažuriran', 'success');
                            // Re-fetch work logs
                            getWorkLogsForWorkOrder(workOrder.Work_Order_ID, organizationId)
                                .then(logs => setWorkLogs(logs))
                                .catch(err => console.error('Error re-fetching work logs:', err));
                            onRefresh?.('workOrders', 'projects', 'workLogs');
                            setTimelineItem(null);
                        } else {
                            showToast?.(result.message, 'error');
                        }
                        return result;
                    }}
                />
            )}


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

                /* === Proizvodi === */
                .products-section { margin-top: 16px; }
                .products-head {
                    display: flex; align-items: center; gap: 10px;
                    font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
                    color: #64748b; margin-bottom: 10px;
                }
                .products-badge {
                    font-size: 11px; font-weight: 600; color: #3b82f6; background: #eff6ff;
                    padding: 2px 9px; border-radius: 999px; text-transform: none; letter-spacing: 0;
                }
                .products-empty {
                    text-align: center; color: #94a3b8; font-size: 13px;
                    padding: 28px; border: 1px dashed #e2e8f0; border-radius: 12px;
                }

                /* Status segment */
                .status-seg { display: inline-flex; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
                .status-seg button {
                    border: none; background: white; color: #64748b;
                    font-size: 12px; font-weight: 600; padding: 6px 12px; cursor: pointer; transition: all 0.15s;
                }
                .status-seg button + button { border-left: 1px solid #e2e8f0; }
                .status-seg button.active { background: #0f172a; color: white; }
                .status-seg button:disabled { opacity: 0.5; cursor: default; }

                .pause-btn {
                    display: inline-flex; align-items: center; gap: 5px;
                    border: 1px solid #e2e8f0; background: white; color: #b45309;
                    font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 8px; cursor: pointer;
                }
                .pause-btn:hover { background: #fffbeb; border-color: #fcd34d; }

                .details-link {
                    align-self: flex-start; border: none; background: transparent; color: #3b82f6;
                    font-size: 12px; font-weight: 600; padding: 2px 0; cursor: pointer;
                }
                .details-link:hover { text-decoration: underline; }

                /* Akcije naloga */
                /* === Knjiga rada naloga === */
                .wo-worklog {
                    margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0;
                }
                .wo-worklog-head {
                    display: flex; align-items: center; gap: 8px;
                    font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
                    color: #64748b; margin-bottom: 12px;
                }

                .wo-actions {
                    display: flex; gap: 8px; flex-wrap: wrap;
                    margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0;
                }
                .wo-act {
                    display: inline-flex; align-items: center; gap: 6px;
                    border: 1px solid #e2e8f0; background: white; color: #334155;
                    font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 8px; cursor: pointer;
                }
                .wo-act:hover { background: #f8fafc; }
                .wo-act-primary { background: #0f172a; border-color: #0f172a; color: white; }
                .wo-act-primary:hover { background: #1e293b; }
                .wo-act-danger { color: #dc2626; margin-left: auto; }
                .wo-act-danger:hover { background: #fef2f2; border-color: #fca5a5; }

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
