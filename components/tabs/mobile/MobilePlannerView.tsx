'use client';

import { useState, useMemo } from 'react';
import type { WorkOrder, Worker } from '@/lib/types';
import type { WeekCapacity } from '@/lib/planning';
import type { LucideIcon } from 'lucide-react';

interface MobilePlannerViewProps {
    workers: Worker[];
    workerOrders: Map<string, WorkOrder[]>;
    backlog: WorkOrder[];
    capacityWeeks: WeekCapacity[];
    capacityGapOrders: number;
    getStatusColor: (wo: WorkOrder) => string;
    getStatusLabel: (wo: WorkOrder) => { text: string; icon: LucideIcon };
    getProjectName: (wo: WorkOrder) => string;
    getDeadlineWarning: (wo: WorkOrder) => 'overdue' | 'approaching' | 'ok';
    onOpenScheduleModal: (wo: WorkOrder) => void;
    onOpenDetailPanel: (wo: WorkOrder) => void;
    onUnschedule: (wo: WorkOrder) => void;
    onStart: (wo: WorkOrder) => void;
}

const PAGE_SIZE = 4;

function shortDate(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso.split('T')[0] + 'T00:00:00');
    return d.toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' });
}

function canStart(wo: WorkOrder): boolean {
    if (wo.Status !== 'Na čekanju') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const plannedStart = wo.Planned_Start_Date ? new Date(wo.Planned_Start_Date) : today;
    plannedStart.setHours(0, 0, 0, 0);
    return plannedStart <= today;
}

function sortWorkerOrders(orders: WorkOrder[]): WorkOrder[] {
    return [...orders].sort((a, b) => {
        const aActive = a.Status === 'U toku';
        const bActive = b.Status === 'U toku';
        if (aActive !== bActive) return aActive ? -1 : 1;
        return (a.Planned_Start_Date || '').localeCompare(b.Planned_Start_Date || '');
    });
}

export default function MobilePlannerView({
    workers,
    workerOrders,
    backlog,
    capacityWeeks,
    capacityGapOrders,
    getStatusColor,
    getStatusLabel,
    getProjectName,
    getDeadlineWarning,
    onOpenScheduleModal,
    onOpenDetailPanel,
    onUnschedule,
    onStart,
}: MobilePlannerViewProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());

    // Radnik ima preklapanje ako mu se dva ili više zakazanih naloga vremenski sijeku
    // (lokalna provjera nad već učitanim podacima — bez novih Firestore poziva).
    const overlapsByWorker = useMemo(() => {
        const result = new Map<string, Set<string>>();
        workerOrders.forEach((orders, workerId) => {
            const withDates = orders.filter(o => !!o.Planned_Start_Date);
            const overlapSet = new Set<string>();
            for (let i = 0; i < withDates.length; i++) {
                for (let j = i + 1; j < withDates.length; j++) {
                    const a = withDates[i], b = withDates[j];
                    const aStart = a.Planned_Start_Date!;
                    const aEnd = a.Planned_End_Date || aStart;
                    const bStart = b.Planned_Start_Date!;
                    const bEnd = b.Planned_End_Date || bStart;
                    if (aStart <= bEnd && bStart <= aEnd) {
                        overlapSet.add(a.Work_Order_ID);
                        overlapSet.add(b.Work_Order_ID);
                    }
                }
            }
            if (overlapSet.size > 0) result.set(workerId, overlapSet);
        });
        return result;
    }, [workerOrders]);

    const sections = useMemo(() => {
        const s = searchTerm.trim().toLowerCase();
        return workers
            .filter(w => !s || w.Name.toLowerCase().includes(s))
            .map(w => ({ worker: w, orders: sortWorkerOrders(workerOrders.get(w.Worker_ID) || []) }))
            .filter(section => section.orders.length > 0);
    }, [workers, workerOrders, searchTerm]);

    function toggleExpanded(workerId: string) {
        setExpandedWorkers(prev => {
            const next = new Set(prev);
            if (next.has(workerId)) next.delete(workerId); else next.add(workerId);
            return next;
        });
    }

    return (
        <div className="mob-plan">
            <div className="mob-plan-toolbar">
                <div className="mob-plan-search">
                    <span className="material-icons-round">search</span>
                    <input
                        type="text"
                        placeholder="Pretraži radnika..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="mob-plan-section">
                <div className="mob-plan-section-head">
                    <span className="material-icons-round">inventory_2</span>
                    <span>Nezakazani</span>
                    <span className="mob-plan-count">{backlog.length}</span>
                </div>
                {backlog.length === 0 ? (
                    <div className="mob-plan-backlog-empty">
                        <span className="material-icons-round">check_circle</span>
                        Svi zakazani
                    </div>
                ) : (
                    <div className="mob-plan-backlog-list">
                        {backlog.map(wo => (
                            <button key={wo.Work_Order_ID} className="mob-plan-backlog-chip" onClick={() => onOpenScheduleModal(wo)}>
                                <span className="mob-plan-backlog-chip-name">{getProjectName(wo)}</span>
                                <span className="mob-plan-backlog-chip-num">{wo.Work_Order_Number}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {capacityWeeks.length > 0 && (
                <div className="mob-plan-section">
                    <div className="mob-plan-section-head">
                        <span className="material-icons-round">insights</span>
                        <span>Kapacitet</span>
                    </div>
                    {capacityGapOrders > 0 && (
                        <div className="mob-plan-gap-note">
                            <span className="material-icons-round">warning</span>
                            {capacityGapOrders} {capacityGapOrders === 1 ? 'nalog' : 'naloga'} bez planiranih dana — kapacitet potcijenjen
                        </div>
                    )}
                    <div className="mob-plan-capacity-list">
                        {capacityWeeks.map(wk => {
                            const over = wk.ratio !== null && wk.ratio > 1;
                            const tight = wk.ratio !== null && wk.ratio > 0.85 && wk.ratio <= 1;
                            const state = over ? 'over' : tight ? 'tight' : 'ok';
                            const pct = wk.ratio === null ? 0 : Math.min(100, Math.round(wk.ratio * 100));
                            const fmtD = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
                            const label = `${shortDate(wk.weekStartISO)} – ${shortDate(wk.weekEndISO)}`;
                            return (
                                <div key={wk.weekStartISO} className={`mob-plan-cap-card state-${state}`}>
                                    <div className="mob-plan-cap-head">
                                        <span>{label}</span>
                                        <span>{fmtD(wk.planned)}/{fmtD(wk.available)} rd</span>
                                    </div>
                                    <div className="mob-plan-cap-track">
                                        <div className="mob-plan-cap-fill" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {sections.length === 0 ? (
                <div className="mob-plan-empty">
                    <span className="material-icons-round">event_busy</span>
                    <div>{searchTerm ? 'Nema radnika koji odgovaraju pretrazi' : 'Nema zakazanih naloga'}</div>
                </div>
            ) : (
                sections.map(({ worker, orders }) => {
                    const isExpanded = expandedWorkers.has(worker.Worker_ID);
                    const visibleOrders = isExpanded ? orders : orders.slice(0, PAGE_SIZE);
                    const overlapSet = overlapsByWorker.get(worker.Worker_ID);
                    return (
                        <div key={worker.Worker_ID} className="mob-plan-worker-section">
                            <div className="mob-plan-worker-head">
                                <div className={`mob-plan-avatar ${worker.Worker_Type === 'Glavni' ? 'main' : ''}`}>
                                    {worker.Name?.charAt(0) || '?'}
                                </div>
                                <div className="mob-plan-worker-name">
                                    {worker.Name}
                                    <span className="mob-plan-worker-type">{worker.Worker_Type}</span>
                                </div>
                                <span className="mob-plan-count">{orders.length}</span>
                            </div>

                            <div className="mob-plan-order-list">
                                {visibleOrders.map(wo => {
                                    const { text: statusText, icon: StatusIcon } = getStatusLabel(wo);
                                    const deadline = getDeadlineWarning(wo);
                                    const overlap = overlapSet?.has(wo.Work_Order_ID);
                                    return (
                                        <div
                                            key={wo.Work_Order_ID}
                                            className="mob-plan-order-card"
                                            style={{ borderLeftColor: getStatusColor(wo) }}
                                            onClick={() => onOpenDetailPanel(wo)}
                                        >
                                            <div className="mob-plan-order-main">
                                                <div className="mob-plan-order-name">{getProjectName(wo)}</div>
                                                <div className="mob-plan-order-meta">
                                                    <span className="mob-plan-status-chip" style={{ color: getStatusColor(wo) }}>
                                                        <StatusIcon size={12} />
                                                        {statusText}
                                                    </span>
                                                    <span className="mob-plan-order-dates">
                                                        {shortDate(wo.Planned_Start_Date)} – {shortDate(wo.Planned_End_Date)}
                                                    </span>
                                                </div>
                                                {(deadline !== 'ok' || overlap) && (
                                                    <div className="mob-plan-order-flags">
                                                        {deadline !== 'ok' && (
                                                            <span className={`mob-plan-flag mob-plan-flag--${deadline}`}>
                                                                <span className="material-icons-round">
                                                                    {deadline === 'overdue' ? 'error' : 'schedule'}
                                                                </span>
                                                                {deadline === 'overdue' ? 'Rok prekoračen' : 'Rok se približava'}
                                                            </span>
                                                        )}
                                                        {overlap && (
                                                            <span className="mob-plan-flag mob-plan-flag--overlap">
                                                                <span className="material-icons-round">warning</span>
                                                                Preklapanje
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="mob-plan-order-actions">
                                                {canStart(wo) && (
                                                    <button
                                                        className="mob-plan-action-btn mob-plan-action-btn--start"
                                                        onClick={(e) => { e.stopPropagation(); onStart(wo); }}
                                                        title="Pokreni"
                                                        aria-label="Pokreni"
                                                    >
                                                        <span className="material-icons-round">play_arrow</span>
                                                    </button>
                                                )}
                                                <button
                                                    className="mob-plan-action-btn"
                                                    onClick={(e) => { e.stopPropagation(); onOpenScheduleModal(wo); }}
                                                    title="Pomjeri"
                                                    aria-label="Pomjeri"
                                                >
                                                    <span className="material-icons-round">event</span>
                                                </button>
                                                {wo.Status !== 'U toku' && (
                                                    <button
                                                        className="mob-plan-action-btn"
                                                        onClick={(e) => { e.stopPropagation(); onUnschedule(wo); }}
                                                        title="Ukloni"
                                                        aria-label="Ukloni"
                                                    >
                                                        <span className="material-icons-round">close</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {orders.length > PAGE_SIZE && (
                                <button className="mob-plan-more-btn" onClick={() => toggleExpanded(worker.Worker_ID)}>
                                    {isExpanded ? 'Prikaži manje' : `Prikaži još (${orders.length - PAGE_SIZE})`}
                                </button>
                            )}
                        </div>
                    );
                })
            )}

            <style jsx>{`
                .mob-plan {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    padding: 12px;
                }

                .mob-plan-toolbar { display: flex; }
                .mob-plan-search {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-md);
                    padding: 0 12px;
                    height: 40px;
                }
                .mob-plan-search .material-icons-round { font-size: 18px; color: var(--text-tertiary); }
                .mob-plan-search input {
                    flex: 1;
                    border: none;
                    background: transparent;
                    outline: none;
                    font-size: 14px;
                    color: var(--text-primary);
                    height: 100%;
                }

                .mob-plan-section { display: flex; flex-direction: column; gap: 8px; }
                .mob-plan-section-head {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                    color: var(--text-secondary);
                }
                .mob-plan-section-head .material-icons-round { font-size: 16px; }
                .mob-plan-count {
                    margin-left: auto;
                    font-size: 11px;
                    font-weight: 700;
                    background: var(--surface);
                    color: var(--text-secondary);
                    border-radius: 999px;
                    padding: 1px 8px;
                }

                .mob-plan-backlog-empty {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    color: var(--success);
                    padding: 8px 0;
                }
                .mob-plan-backlog-empty .material-icons-round { font-size: 16px; }
                .mob-plan-backlog-list {
                    display: flex;
                    gap: 8px;
                    overflow-x: auto;
                    padding-bottom: 2px;
                    scrollbar-width: none;
                }
                .mob-plan-backlog-chip {
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    background: var(--background);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-md);
                    padding: 8px 12px;
                    min-width: 140px;
                    max-width: 200px;
                    cursor: pointer;
                    text-align: left;
                }
                .mob-plan-backlog-chip:active { background: var(--surface); }
                .mob-plan-backlog-chip-name {
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .mob-plan-backlog-chip-num { font-size: 11px; color: var(--text-secondary); }

                .mob-plan-gap-note {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    color: #92400e;
                    background: var(--warning-bg);
                    border-radius: var(--radius-sm);
                    padding: 6px 10px;
                }
                .mob-plan-gap-note .material-icons-round { font-size: 15px; }

                .mob-plan-capacity-list {
                    display: flex;
                    gap: 8px;
                    overflow-x: auto;
                    padding-bottom: 2px;
                    scrollbar-width: none;
                }
                .mob-plan-cap-card {
                    flex-shrink: 0;
                    min-width: 120px;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-sm);
                    padding: 8px 10px;
                }
                .mob-plan-cap-card.state-tight { background: var(--warning-bg); border-color: #f3e1c0; }
                .mob-plan-cap-card.state-over { background: var(--error-bg); border-color: #f5c2c0; }
                .mob-plan-cap-head {
                    display: flex;
                    justify-content: space-between;
                    gap: 6px;
                    font-size: 11px;
                    color: var(--text-secondary);
                    margin-bottom: 4px;
                }
                .mob-plan-cap-track {
                    height: 4px;
                    border-radius: 2px;
                    background: var(--border-light);
                    overflow: hidden;
                }
                .mob-plan-cap-fill { height: 100%; background: var(--accent); }
                .mob-plan-cap-card.state-tight .mob-plan-cap-fill { background: var(--warning); }
                .mob-plan-cap-card.state-over .mob-plan-cap-fill { background: var(--error); }

                .mob-plan-worker-section { display: flex; flex-direction: column; gap: 8px; }
                .mob-plan-worker-head {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .mob-plan-avatar {
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface);
                    color: var(--text-secondary);
                    font-size: 13px;
                    font-weight: 700;
                    flex-shrink: 0;
                }
                .mob-plan-avatar.main { background: var(--accent-light); color: var(--accent); }
                .mob-plan-worker-name {
                    display: flex;
                    align-items: baseline;
                    gap: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                }
                .mob-plan-worker-type { font-size: 11px; font-weight: 500; color: var(--text-tertiary); }

                .mob-plan-order-list { display: flex; flex-direction: column; gap: 8px; }
                .mob-plan-order-card {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    background: var(--background);
                    border: 1px solid var(--border-light);
                    border-left: 3px solid var(--border);
                    border-radius: var(--radius-md);
                    padding: 10px 12px;
                    cursor: pointer;
                }
                .mob-plan-order-card:active { background: var(--surface); }
                .mob-plan-order-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
                .mob-plan-order-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .mob-plan-order-meta {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    color: var(--text-secondary);
                }
                .mob-plan-status-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    font-size: 11px;
                    font-weight: 700;
                }
                .mob-plan-order-dates { white-space: nowrap; }
                .mob-plan-order-flags { display: flex; gap: 6px; flex-wrap: wrap; }
                .mob-plan-flag {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    font-size: 11px;
                    font-weight: 600;
                    padding: 2px 7px;
                    border-radius: 999px;
                }
                .mob-plan-flag .material-icons-round { font-size: 13px; }
                .mob-plan-flag--overdue { background: var(--error-bg); color: var(--error); }
                .mob-plan-flag--approaching { background: var(--warning-bg); color: #8a5a00; }
                .mob-plan-flag--overlap { background: var(--warning-bg); color: #8a5a00; }

                .mob-plan-order-actions { display: flex; gap: 6px; flex-shrink: 0; }
                .mob-plan-action-btn {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                    color: var(--text-secondary);
                }
                .mob-plan-action-btn:active { background: var(--surface-active); }
                .mob-plan-action-btn .material-icons-round { font-size: 17px; }
                .mob-plan-action-btn--start { color: var(--success); }

                .mob-plan-more-btn {
                    align-self: center;
                    background: none;
                    border: none;
                    color: var(--accent);
                    font-size: 12px;
                    font-weight: 600;
                    padding: 4px 8px;
                    cursor: pointer;
                }

                .mob-plan-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    padding: 48px 16px;
                    text-align: center;
                    color: var(--text-secondary);
                }
                .mob-plan-empty .material-icons-round {
                    font-size: 40px;
                    color: var(--text-tertiary);
                }
            `}</style>
        </div>
    );
}
