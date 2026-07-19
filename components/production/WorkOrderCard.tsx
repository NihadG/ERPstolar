'use client';

// ════════════════════════════════════════════════════════════════════
// KARTICA RADNOG NALOGA u listi Proizvodnje — izdvojena iz ProductionTab.tsx
// (razbijanje monolita, bez promjene ponašanja). Sažetak (status, rok,
// radnik-dani, napredak procesa, radnici) + akcije + prošireni detalj.
// ════════════════════════════════════════════════════════════════════

import type { WorkOrder, Project, Worker, Task } from '@/lib/types';
import { updatePlannedStartDate } from '@/lib/services';
import { daysUntil, plannedVsActualDays } from '@/lib/planning';
import { workOrderDisplayName, orderProcessProgress, isOrderPaused, workOrderStatusDetails } from '@/lib/utils';
import WorkOrderExpandedDetail from '@/components/ui/WorkOrderExpandedDetail';

export interface AttendanceWarningLite {
    Worker_ID: string;
    Worker_Name: string;
    Work_Order_ID: string;
    Work_Order_Name: string;
    Item_Name: string;
    Date: string;
}

interface WorkOrderCardProps {
    workOrder: WorkOrder;
    projects: Project[];
    workers: Worker[];
    tasks?: Task[];
    /** Datum prvog knjiženja radnika (YYYY-MM-DD) — stvarni početak rada. */
    firstWorkDate?: string;
    isExpanded: boolean;
    attendanceWarnings?: AttendanceWarningLite[];  // upozorenja SVIH naloga; kartica filtrira svoja
    organizationId: string | null;
    onToggle: (workOrderId: string) => void;
    /** Otvori nalog kao punu stranicu (full-screen overlay). */
    onOpenPage: (workOrderId: string) => void;
    onStart: (workOrderId: string) => Promise<void>;
    onPrint: (wo: WorkOrder) => void;
    onDelete: (workOrderId: string) => Promise<void>;
    onSummary: (wo: WorkOrder) => void;
    onAttendanceFix: (wo: WorkOrder) => void;
    onUpdate: (workOrderId: string, updates: any) => Promise<void>;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkOrderCard({
    workOrder: wo,
    projects,
    workers,
    tasks = [],
    firstWorkDate,
    isExpanded,
    attendanceWarnings,
    organizationId,
    onToggle,
    onOpenPage,
    onStart,
    onPrint,
    onDelete,
    onSummary,
    onAttendanceFix,
    onUpdate,
    onRefresh,
    showToast,
}: WorkOrderCardProps) {
    function formatDate(dateString: string): string {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('hr-HR');
    }
        const totalItems = wo.items?.length || 0;

        // Radnici naloga = Assigned_Workers + Processes[] (jedan model, bez legacy Process_Assignments)
        const orderWorkers = new Map<string, { name: string; isMain: boolean; helperCount: number }>();
        wo.items?.forEach(item => {
            (item.Assigned_Workers || []).forEach(w => {
                if (w.Worker_ID && w.Worker_Name) {
                    orderWorkers.set(w.Worker_ID, { name: w.Worker_Name, isMain: true, helperCount: 0 });
                }
            });
            item.Processes?.forEach(p => {
                if (p.Worker_ID && p.Worker_Name) {
                    orderWorkers.set(p.Worker_ID, { name: p.Worker_Name, isMain: true, helperCount: 0 });
                }
            });
        });

        // Get main workers only for display
        const mainWorkers = Array.from(orderWorkers.entries())
            .filter(([, v]) => v.isMain)
            .slice(0, 3); // Show up to 3 workers
        const totalHelpers = 0; // Simplified for new view

        const formatValue = (value?: number) =>
            value && Number.isFinite(value) ? `${value.toLocaleString('hr-HR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} KM` : null;


        const orderPaused = isOrderPaused(wo);
        const statusDetails = orderPaused
            ? { color: '#eab308', icon: 'pause_circle', bg: 'linear-gradient(135deg, rgba(234, 179, 8, 0.1), rgba(234, 179, 8, 0.2))' }
            : workOrderStatusDetails(wo.Status);
        const statusLabel = orderPaused ? 'Pauzirano' : wo.Status;

        const isMontaza = wo.Work_Order_Type === 'Montaža';

        // Rok + odbrojavanje (živ signal na kartici u listi)
        const dd = wo.Status !== 'Završeno' && wo.Status !== 'Otkazano' ? daysUntil(wo.Due_Date) : null;
        const dueCountdown = dd === null ? '' : dd < 0 ? `kasni ${-dd} ${-dd === 1 ? 'dan' : 'dana'}` : dd === 0 ? 'danas' : `za ${dd} ${dd === 1 ? 'dan' : 'dana'}`;
        const dueColor = dd === null ? undefined : dd < 0 ? 'var(--error)' : dd <= 2 ? 'var(--warning)' : undefined;

    return (
        <>
            <div key={wo.Work_Order_ID} className={`project-card ${isExpanded ? 'active' : ''}`}
                style={{
                    position: 'relative',
                    borderLeft: `3px solid ${isMontaza ? '#00C7BE' : statusDetails.color}`,
                }}>
                <div className="project-header" onClick={() => onToggle(wo.Work_Order_ID)}>
                    <button className={`expand-btn ${isExpanded ? 'expanded' : ''}`}>
                        <span className="material-icons-round">chevron_right</span>
                    </button>

                    <div className="project-main-info">
                        <div className="project-title-section">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <div className="project-name">{workOrderDisplayName(wo)}</div>
                                    <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>#{wo.Work_Order_Number}</span>
                                    {(() => {
                                        const firstItem = wo.items?.[0];
                                        if (!wo.Name || !firstItem) return null;
                                        // Resolve project name (Name → Client_Name) so legacy items that stored
                                        // Client_Name still show the descriptive project name when available.
                                        const proj = projects.find(p => p.Project_ID === firstItem.Project_ID);
                                        const projLabel = proj?.Name || proj?.Client_Name || firstItem.Project_Name;
                                        if (!projLabel) return null;
                                        return (
                                            <>
                                                <span style={{ color: '#d1d5db' }}>•</span>
                                                <span style={{ fontSize: '13px', color: '#4b5563', fontWeight: 500 }}>
                                                    {projLabel}
                                                </span>
                                            </>
                                        );
                                    })()}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                    <span style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        color: statusDetails.color,
                                    }}>
                                        <span className="material-icons-round" style={{ fontSize: '14px' }}>{statusDetails.icon}</span>
                                        {statusLabel}
                                    </span>
                                    {isMontaza && (
                                        <>
                                            <span style={{ color: '#d1d5db' }}>•</span>
                                            <span style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                color: '#00897b',
                                            }}>
                                                <span className="material-icons-round" style={{ fontSize: '14px' }}>build</span>
                                                Montaža
                                            </span>
                                        </>
                                    )}

                                    {/* S16: Per-card Missing Attendance Badge — clickable */}
                                    {wo.Status === 'U toku' && (() => {
                                        const woWarnings = (attendanceWarnings || []).filter(w => w.Work_Order_ID === wo.Work_Order_ID);
                                        if (woWarnings.length === 0) return null;
                                        return (
                                            <>
                                                <span style={{ color: '#d1d5db' }}>•</span>
                                                <span style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    color: '#d97706',
                                                    cursor: 'pointer',
                                                    transition: 'opacity 0.2s',
                                                }}
                                                    title={`Kliknite za popunu prisustva: ${woWarnings.map(w => w.Worker_Name).join(', ')}`}
                                                    onClick={(e) => { e.stopPropagation(); onAttendanceFix(wo); }}
                                                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.7')}
                                                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                                                >
                                                    <span className="material-icons-round" style={{ fontSize: '14px', animation: 'pulse 2s ease-in-out infinite' }}>person_off</span>
                                                    {woWarnings.length}
                                                </span>
                                            </>
                                        );
                                    })()}

                                </div>
                            </div>
                        </div>
                        <div className="project-details" style={{ marginTop: '12px' }}>
                            <div className="project-summary">
                                {/* Sažetak se sakriva kad je kartica proširena — WorkOrderExpandedDetail
                                    prikazuje iste podatke (i još) u hero traci, pa se ne duplira. */}
                                {!isExpanded && (
                                <>
                                <span className="summary-item">
                                    <span className="material-icons-round">inventory_2</span>
                                    {totalItems} {totalItems === 1 ? 'proizvod' : 'proizvoda'}
                                </span>
                                <span className="summary-item" style={dueColor ? { color: dueColor, fontWeight: 600 } : undefined}>
                                    <span className="material-icons-round">calendar_today</span>
                                    {wo.Due_Date ? formatDate(wo.Due_Date) : '-'}
                                    {dueCountdown && <span style={{ opacity: 0.85 }}>· {dueCountdown}</span>}
                                </span>
                                {/* Prvi rad — kad je radnik prvi put knjižen. Bez ovoga se iz liste
                                    ne vidi je li nalog uopšte krenuo (rok sam po sebi to ne kaže). */}
                                {firstWorkDate && (
                                    <span className="summary-item" title={`Prvi rad na nalogu: ${formatDate(firstWorkDate)}`}>
                                        <span className="material-icons-round">handyman</span>
                                        od {formatDate(firstWorkDate)}
                                    </span>
                                )}
                                {/* Planirano vs potrošeno radnik-dana (Actual_Labor_Days sync-uje recalculateWorkOrder) */}
                                {wo.Status !== 'Otkazano' && (() => {
                                    const dp = plannedVsActualDays(wo.items || []);
                                    if (dp.planned <= 0) return null;
                                    const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
                                    const color = dp.ratio !== null && dp.ratio > 1 ? 'var(--error)'
                                        : dp.ratio !== null && dp.ratio >= 0.8 ? 'var(--warning)'
                                        : undefined;
                                    return (
                                        <span
                                            className="summary-item"
                                            style={color ? { color, fontWeight: 600 } : undefined}
                                            title={`Potrošeno ${fmtDays(dp.actual)} od ${fmtDays(dp.planned)} planiranih radnik-dana`}
                                        >
                                            <span className="material-icons-round">hourglass_bottom</span>
                                            {fmtDays(dp.actual)}/{fmtDays(dp.planned)} dana
                                        </span>
                                    );
                                })()}
                                {/* Napredak iz procesa (checklist završetka) */}
                                {(wo.Status === 'U toku' || wo.Status === 'Na čekanju') && (() => {
                                    const prog = orderProcessProgress(wo.items || []);
                                    if (!prog || prog.total <= 1) return null;
                                    return (
                                        <span
                                            className="summary-item"
                                            title={`Završeno ${prog.done} od ${prog.total} procesa`}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                        >
                                            <span style={{ width: '44px', height: '5px', borderRadius: '3px', background: '#e2e8f0', overflow: 'hidden', display: 'inline-block' }}>
                                                <span style={{ display: 'block', width: `${prog.pct}%`, height: '100%', background: prog.pct >= 100 ? '#059669' : 'var(--accent, #0071e3)', borderRadius: '3px' }} />
                                            </span>
                                            {prog.pct}%
                                        </span>
                                    );
                                })()}
                                {mainWorkers.length > 0 && (
                                    <span className="summary-item" style={{ color: 'var(--primary-color)' }}>
                                        <span className="material-icons-round">person</span>
                                        {mainWorkers.map(([, w]) => w.name.split(' ')[0]).join(', ')}
                                    </span>
                                )}
                                </>
                                )}
                                {/* Planned Start Date badge for scheduled waiting orders — jedina akcija bez ekvivalenta u proširenom prikazu, ostaje uvijek vidljiva */}
                                {wo.Is_Scheduled && wo.Status === 'Na čekanju' && (() => {
                                    // Auto-forward: show today if planned start is in the past
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    const plannedStart = wo.Planned_Start_Date ? new Date(wo.Planned_Start_Date) : null;
                                    let effectiveDate = wo.Planned_Start_Date || '';
                                    if (plannedStart) {
                                        plannedStart.setHours(0, 0, 0, 0);
                                        if (plannedStart < today) {
                                            effectiveDate = today.toISOString().split('T')[0];
                                        }
                                    }
                                    const dateId = `prod-start-date-${wo.Work_Order_ID}`;
                                    return (
                                        <span
                                            className="summary-item"
                                            style={{
                                                color: '#0071e3',
                                                cursor: 'pointer',
                                                position: 'relative',
                                                fontWeight: 600,
                                            }}
                                            title="Planirani početak — kliknite za izmjenu"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const input = document.getElementById(dateId) as HTMLInputElement;
                                                if (input) input.showPicker();
                                            }}
                                        >
                                            <span className="material-icons-round" style={{ fontSize: '16px' }}>event</span>
                                            {effectiveDate ? new Date(effectiveDate + 'T00:00:00').toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' }) : '-'}
                                            <input
                                                id={dateId}
                                                type="date"
                                                value={effectiveDate}
                                                onChange={async (e) => {
                                                    const val = e.target.value;
                                                    if (!val || !organizationId) return;
                                                    const res = await updatePlannedStartDate(wo.Work_Order_ID, val, organizationId);
                                                    if (res.success) {
                                                        showToast('Planirani datum ažuriran', 'success');
                                                        onRefresh('workOrders');
                                                    } else {
                                                        showToast(res.message, 'error');
                                                    }
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                style={{ position: 'absolute', bottom: 0, left: 0, width: 0, height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}
                                            />
                                        </span>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* Otvori nalog kao punu stranicu (više prostora, fokusiran prikaz) */}
                        <button className="icon-btn" title="Otvori kao stranicu" onClick={(e) => {
                            e.stopPropagation();
                            onOpenPage(wo.Work_Order_ID);
                        }}>
                            <span className="material-icons-round">open_in_full</span>
                        </button>
                        {/* Pokreni direktno s kartice (guard-poruke stižu kroz postojeći toast) */}
                        {wo.Status === 'Na čekanju' && (
                            <button className="icon-btn" title="Pokreni nalog" style={{ color: '#059669' }} onClick={(e) => {
                                e.stopPropagation();
                                onStart(wo.Work_Order_ID);
                            }}>
                                <span className="material-icons-round">play_arrow</span>
                            </button>
                        )}
                        {/* Rezime završenog naloga (finalni P&L iz snapshota) */}
                        {wo.Status === 'Završeno' && (
                            <button className="icon-btn" title="Rezime naloga (finalni profit)" onClick={(e) => {
                                e.stopPropagation();
                                onSummary(wo);
                            }}>
                                <span className="material-icons-round">receipt_long</span>
                            </button>
                        )}
                        <button className="icon-btn" title="Printaj Nalog" onClick={(e) => {
                            e.stopPropagation();
                            onPrint(wo);
                        }}>
                            <span className="material-icons-round">print</span>
                        </button>
                        <button className="icon-btn delete" title="Obriši Nalog" onClick={(e) => {
                            e.stopPropagation();
                            onDelete(wo.Work_Order_ID);
                        }}>
                            <span className="material-icons-round">delete</span>
                        </button>
                    </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                    <WorkOrderExpandedDetail
                        workOrder={wo}
                        workers={workers}
                        tasks={tasks}
                        onUpdate={onUpdate}
                        onPrint={onPrint}
                        onDelete={onDelete}
                        onStart={onStart}
                        onRefresh={onRefresh}
                        showToast={showToast}
                    />
                )}
            </div>

            {/* Stilovi kartice — preseljeni iz ProductionTab (styled-jsx je scope-ovan po komponenti) */}
            <style jsx>{`
                /* Creating styles similar to ProjectsTab */
                .project-card {
                    background: white;
                    border: 1px solid #e0e0e0;
                    border-radius: 12px;
                    overflow: hidden;
                    transition: all 0.2s;
                }
                .project-card:hover { border-color: #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                .project-card.active { border-color: var(--accent); box-shadow: 0 4px 12px rgba(0,113,227,0.1); }
                
                .project-header {
                    display: flex;
                    align-items: center;
                    padding: 16px 20px;
                    gap: 16px;
                    cursor: pointer;
                    background: white;
                }
                
                .expand-btn {
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    border: 1px solid #e0e0e0;
                    background: #f5f5f7;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #666;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .expand-btn.expanded { transform: rotate(90deg); background: var(--accent); color: white; border-color: var(--accent); }
                
                .project-main-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
                .project-title-section { display: flex; align-items: baseline; gap: 10px; }
                .project-name { font-size: 16px; font-weight: 600; color: #1d1d1f; }
                .project-client { font-size: 13px; color: #86868b; }
                
                .project-details { display: flex; align-items: center; gap: 16px; margin-top: 2px; }
                .project-summary { display: flex; gap: 12px; }
                .summary-item { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #666; background: #f5f5f7; padding: 2px 8px; border-radius: 6px; }
                .summary-item .material-icons-round { font-size: 14px; }
                

                
                .project-actions { display: flex; gap: 8px; margin-left: 8px; }
                .icon-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: #666; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
                .icon-btn:hover { background: #f5f5f7; color: #333; }
                .icon-btn.danger:hover { background: #fee2e2; color: #ef4444; }
                .icon-btn .material-icons-round { font-size: 18px; }

                /* Standardized heights for right-side items */
                .progress-mini { 
                    display: flex; 
                    align-items: center; 
                    gap: 8px; 
                    margin-right: 8px; 
                    background: #f5f5f7; 
                    padding: 0 12px; 
                    border-radius: 8px; 
                    height: 32px; 
                }
                .progress-text { font-size: 12px; font-weight: 600; color: #333; }
                .progress-circle { width: 10px; height: 10px; border-radius: 50%; }

                .project-badges { display: flex; gap: 8px; height: 32px; align-items: center; }
                .status-badge { 
                    padding: 0 12px; 
                    border-radius: 8px; 
                    font-size: 11px; 
                    font-weight: 600; 
                    text-transform: uppercase; 
                    height: 32px; 
                    display: flex; 
                    align-items: center; 
                }
                .status-nacrt { background: #f3f4f6; color: #6b7280; }
                .status-dodijeljeno { background: #dbeafe; color: #1d4ed8; }
                .status-u-toku { background: #fef3c7; color: #b45309; }
                .status-završeno, .status-zavrseno { background: #dcfce7; color: #15803d; }
                .status-otkazano { background: #fee2e2; color: #dc2626; }
                .status-na-čekanju, .status-na-cekanju { background: #fff7ed; color: #c2410c; }

                @media (max-width: 767px) {
                    /* Project Card Mobile */
                    .project-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 12px;
                        padding: 12px;
                        position: relative;
                    }

                    .expand-btn {
                        position: absolute;
                        top: 12px;
                        right: 12px;
                    }

                    .project-main-info {
                        width: 100%;
                        padding-right: 32px; /* space for expand button */
                    }

                    .project-title-section {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 2px;
                    }

                    .project-details {
                        flex-wrap: wrap;
                        gap: 8px;
                        margin-top: 8px;
                    }

                    /* Right side container - now bottom row */
                    .project-header > div:last-child {
                        width: 100%;
                        justify-content: space-between;
                        padding-top: 12px;
                        border-top: 1px dashed #f0f0f0;
                        margin-top: 4px;
                    }

                    .progress-mini {
                        margin-right: 0;
                        height: 28px;
                        font-size: 11px;
                    }

                    .project-badges {
                        height: 28px;
                    }

                    .status-badge {
                        height: 28px;
                        font-size: 10px;
                        padding: 0 8px;
                    }

                    .project-actions {
                        margin-left: 0;
                    }
                }
            `}</style>
        </>
    );
}
