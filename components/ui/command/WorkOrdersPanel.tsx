'use client';

// ════════════════════════════════════════════════════════════════════
// NALOZI — isti prošireni prikaz kao u Nalozi tabu
//
// Prošireni red je doslovno WorkOrderExpandedDetail (layout="card"), ista
// komponenta koju koriste kartica naloga i puna stranica. Ovdje se ne
// pravi nikakva „mala verzija" — kad korisnik otvori nalog, mora dobiti
// tačno ono što već zna.
//
// Poredak grupa i pojam „pauziran" dolaze iz lib/utils (isOrderPaused,
// compareWorkOrdersDefault) — isti izvor kao Nalozi tab, da se redoslijed
// nigdje ne razlikuje.
// ════════════════════════════════════════════════════════════════════

import { useMemo, type ReactNode } from 'react';
import { ChevronRight, ClipboardList } from 'lucide-react';
import type { Task, WorkOrder, Worker } from '@/lib/types';
import { compareWorkOrdersDefault, isOrderPaused, workOrderDisplayName } from '@/lib/utils';
import type { BoardScope } from '@/lib/command/scope';
import { isWorkOrderLate, lensAllowsWorkOrder, type LensSelection } from '@/lib/command/signals';
import WorkOrderExpandedDetail from '../WorkOrderExpandedDetail';
import { hue, KcPanel, shortDate, SummaryBits } from './parts';

type Bucket = 'late' | 'running' | 'paused' | 'waiting' | 'done' | 'cancelled';

const BUCKETS: { id: Bucket; label: string; done?: boolean }[] = [
    { id: 'late', label: 'Kasni' },
    { id: 'running', label: 'U toku' },
    { id: 'paused', label: 'Pauzirani' },
    { id: 'waiting', label: 'Na čekanju' },
    { id: 'done', label: 'Završeni', done: true },
    { id: 'cancelled', label: 'Otkazani', done: true },
];

function bucketOf(wo: WorkOrder, today: string): Bucket {
    if (wo.Status === 'Otkazano') return 'cancelled';
    if (wo.Status === 'Završeno') return 'done';
    if (isWorkOrderLate(wo, today)) return 'late';
    if (wo.Status === 'U toku') return isOrderPaused(wo) ? 'paused' : 'running';
    return 'waiting';
}

export interface WorkOrderActions {
    onUpdate: (workOrderId: string, updates: Record<string, unknown>) => Promise<void>;
    onStart: (workOrderId: string) => Promise<void>;
    onPrint: (workOrder: WorkOrder) => void;
    onDelete: (workOrderId: string) => Promise<void>;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function WorkOrdersPanel({
    scope, workers, tasks, today, lens, showDone, actions, openId, onOpenChange, create,
    collapsed, onCollapse, pinned, onPin,
}: {
    scope: BoardScope;
    workers: Worker[];
    tasks: Task[];
    today: string;
    lens: LensSelection | null;
    showDone: boolean;
    actions: WorkOrderActions;
    openId: string | null;
    onOpenChange: (id: string | null) => void;
    /** „+ Nalog" — meni projekata, dolazi iz ekrana (isti kao u zaglavlju). */
    create?: ReactNode;
    collapsed?: boolean;
    onCollapse?: () => void;
    pinned?: boolean;
    onPin?: () => void;
}) {
    const grouped = useMemo(() => {
        const buckets = new Map<Bucket, WorkOrder[]>();
        for (const wo of scope.workOrders) {
            if (!lensAllowsWorkOrder(lens, wo.Work_Order_ID)) continue;
            const bucket = bucketOf(wo, today);
            if (!showDone && (bucket === 'done' || bucket === 'cancelled')) continue;
            const list = buckets.get(bucket) || [];
            list.push(wo);
            buckets.set(bucket, list);
        }
        for (const list of buckets.values()) list.sort(compareWorkOrdersDefault);
        return buckets;
    }, [scope.workOrders, lens, showDone, today]);

    const total = Array.from(grouped.values()).reduce((sum, list) => sum + list.length, 0);
    const lateCount = grouped.get('late')?.length || 0;
    const count = (bucket: Bucket) => grouped.get(bucket)?.length || 0;

    return (
        <KcPanel
            id="workorders"
            eyebrow="IZVOĐENJE"
            title="Radni nalozi"
            count={total}
            countTone={lateCount > 0 ? 'alert' : undefined}
            collapsed={collapsed}
            onCollapse={onCollapse}
            pinned={pinned}
            onPin={onPin}
            create={create}
            summary={(
                <SummaryBits bits={[
                    { label: lateCount > 0 ? `${lateCount} kasni` : '', tone: 'alert' },
                    { label: count('running') > 0 ? `${count('running')} u toku` : '' },
                    { label: count('paused') > 0 ? `${count('paused')} pauza` : '' },
                    { label: count('waiting') > 0 ? `${count('waiting')} čeka` : '' },
                ]} />
            )}
        >
            <div className="kc-panel-body">
                {total === 0 && (
                    <div className="kc-empty">
                        <ClipboardList size={22} style={{ opacity: 0.45 }} />
                        <p>Nema naloga u ovom prikazu.</p>
                        <span>Nalog praviš dugmetom „Nalog" gore, s pozicije bez naloga ili iz odabira proizvoda.</span>
                    </div>
                )}
                {BUCKETS.map(bucket => {
                    const list = grouped.get(bucket.id);
                    if (!list || list.length === 0) return null;
                    return (
                        <div className="kc-group" key={bucket.id}>
                            <div className="kc-group-head">
                                <span className="kc-group-dot" style={{ background: bucket.id === 'late' ? 'var(--kc-late)' : 'var(--text-tertiary)' }} />
                                <strong>{bucket.label}</strong>
                                <span>{list.length}</span>
                            </div>
                            {list.map(wo => (
                                <WorkOrderRow
                                    key={wo.Work_Order_ID}
                                    wo={wo}
                                    scope={scope}
                                    workers={workers}
                                    tasks={tasks}
                                    today={today}
                                    bucket={bucket.id}
                                    open={openId === wo.Work_Order_ID}
                                    actions={actions}
                                    onToggle={() => onOpenChange(openId === wo.Work_Order_ID ? null : wo.Work_Order_ID)}
                                />
                            ))}
                        </div>
                    );
                })}
            </div>
        </KcPanel>
    );
}

function WorkOrderRow({
    wo, scope, workers, tasks, today, bucket, open, actions, onToggle,
}: {
    wo: WorkOrder;
    scope: BoardScope;
    workers: Worker[];
    tasks: Task[];
    today: string;
    bucket: Bucket;
    open: boolean;
    actions: WorkOrderActions;
    onToggle: () => void;
}) {
    const projectIds = scope.workOrderProjects.get(wo.Work_Order_ID) || [];
    const items = wo.items || [];
    const done = items.filter(i => i.Status === 'Završeno').length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    const names = Array.from(new Set(items.map(i => i.Product_Name).filter(Boolean)));

    return (
        <>
            <div className={`kc-row${open ? ' open' : ''}${bucket === 'late' ? ' late' : ''}`} style={hue(projectIds[0])}>
                <span style={{ display: 'inline-flex', gap: 3, flex: 'none' }}>
                    {projectIds.slice(0, 3).map(id => (
                        <i
                            key={id}
                            className="kc-group-dot"
                            style={{ ...hue(id), background: 'var(--kc-ink)' }}
                            title={scope.projects.find(p => p.Project_ID === id)?.Name || ''}
                        />
                    ))}
                </span>
                <button
                    type="button"
                    className="kc-row-main"
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                    aria-expanded={open}
                    onClick={onToggle}
                >
                    <strong>{workOrderDisplayName(wo)}</strong>
                    <span title={names.join(', ')}>
                        #{wo.Work_Order_Number}
                        {names.length > 0 && ` · ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`}
                    </span>
                </button>
                <div className="kc-row-side">
                    <div className="kc-progress">
                        <div className="kc-progress-track"><i style={{ width: `${pct}%` }} /></div>
                        <span>{done}/{items.length} stavki</span>
                    </div>
                    <div className={`kc-row-date${wo.Due_Date ? '' : ' muted'}`}>
                        <span>{wo.Due_Date ? shortDate(wo.Due_Date, today) : 'Bez roka'}</span>
                        {bucket === 'late' && <small>Kasni</small>}
                    </div>
                    <button
                        type="button"
                        className="kc-icon-btn"
                        style={{ border: 'none', width: 26, height: 26 }}
                        aria-label={open ? 'Sklopi nalog' : 'Otvori nalog'}
                        onClick={onToggle}
                    >
                        <ChevronRight size={15} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }} />
                    </button>
                </div>
            </div>
            {open && (
                <div className="kc-expand" style={{ padding: 0 }}>
                    <WorkOrderExpandedDetail
                        workOrder={wo}
                        workers={workers}
                        tasks={tasks}
                        layout="card"
                        onUpdate={actions.onUpdate}
                        onStart={actions.onStart}
                        onPrint={actions.onPrint}
                        onDelete={actions.onDelete}
                        onRefresh={actions.onRefresh}
                        showToast={actions.showToast}
                    />
                </div>
            )}
        </>
    );
}
