'use client';

// ════════════════════════════════════════════════════════════════════
// NALOZI — mobilni prikaz (lista)
//
// Svaki nalog je ZASEBNA kartica s razmakom: u zbijenoj listi se nalozi
// stapaju (naslov + status + napredak + rok + akcija je previše za jedan red).
// Dodir otvara MobileWorkOrderDetail kao vlastiti ekran — ne razvlači red.
//
// Bez profita na kartici: na terenu trebaju napredak, rok i radnja.
// ════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { Plus, Play, ClipboardList, Wrench, Layers, PersonStanding } from 'lucide-react';
import type { WorkOrder, Worker, Task, Project } from '@/lib/types';
import { WORK_ORDER_STATUSES } from '@/lib/types';
import { daysUntil } from '@/lib/planning';
import { workOrderDisplayName, orderProcessProgress, compareWorkOrdersDefault } from '@/lib/utils';
import MobileWorkOrderDetail from './MobileWorkOrderDetail';
import {
    MLarge, MSearch, MChips, MSection, MCard, MCardHead, MCardBody, MIcon,
    MPill, MProgress, MEmpty, MButton, MSheet, MList, MOption,
} from './MobileUI';
import { useMobileGrouping } from './useMobileGrouping';
import { groupWorkOrders, WORK_ORDER_GROUPING_OPTIONS, type WorkOrderGroupBy } from '@/lib/grouping';
import './MobileUI.css';

interface AttendanceWarnings {
    warnings: { Worker_ID: string; Worker_Name: string; Work_Order_ID: string; Work_Order_Name: string; Item_Name: string; Date: string }[];
    missingCount: number;
    totalAssigned: number;
}

interface MobileWorkOrdersViewProps {
    workOrders: WorkOrder[];
    workers: Worker[];
    tasks?: Task[];
    projects?: Project[];
    /** Work_Order_ID → datum prvog knjiženja radnika (firstBookingByOrder). */
    firstWorkByOrder?: Map<string, string>;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onCreate: () => void;
    onOpenPage: (workOrderId: string) => void;
    onUpdate: (workOrderId: string, updates: any) => Promise<void>;
    onDelete: (workOrderId: string) => void;
    onStart: (workOrderId: string) => void;
    onPrint: (workOrder: WorkOrder) => void;
    onSummary?: (workOrder: WorkOrder) => void;
    attendanceWarnings?: AttendanceWarnings | null;
    onAttendanceFix?: (workOrder: WorkOrder) => void;
}

const statusTone = (s?: string) =>
    s === 'Završeno' ? 'green' : s === 'U toku' ? 'blue' : s === 'Otkazano' ? 'red' : 'gray';

export default function MobileWorkOrdersView({
    workOrders, workers, tasks = [], projects = [], onRefresh, showToast,
    onCreate, onDelete, onStart, onPrint, attendanceWarnings, onAttendanceFix,
}: MobileWorkOrdersViewProps) {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<string>('');
    const [openId, setOpenId] = useState<string | null>(null);
    // Isti izbor kao desktop: samo grupisanje (poredak naloga je fiksan).
    const [groupBy, setGroupBy] = useMobileGrouping<WorkOrderGroupBy>('nalozi', 'project');
    const [groupSheet, setGroupSheet] = useState(false);

    const counts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const wo of workOrders) c[wo.Status] = (c[wo.Status] || 0) + 1;
        return c;
    }, [workOrders]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return workOrders.filter(wo => {
            const matchQ = !q
                || wo.Work_Order_Number?.toLowerCase().includes(q)
                || wo.Name?.toLowerCase().includes(q);
            return matchQ && (!status || wo.Status === status);
        });
    }, [workOrders, search, status]);

    // Grupisanje i poredak = ISTA logika kao desktop (lib/grouping).
    const groups = useMemo(
        () => groupWorkOrders(filtered, groupBy, workers),
        [filtered, groupBy, workers]
    );
    const ungrouped = useMemo(() => [...filtered].sort(compareWorkOrdersDefault), [filtered]);

    // Nalog otvoren u detalju — čita se SVJEŽ iz propsa da se prikaz mijenja
    // odmah nakon upisa (onRefresh vraća nove objekte).
    const openWo = openId ? workOrders.find(w => w.Work_Order_ID === openId) : null;

    const renderCard = (wo: WorkOrder) => {
        const items = wo.items || [];
        const isFinal = wo.Status === 'Završeno' || wo.Status === 'Otkazano';
        const prog = orderProcessProgress(items);
        const pct = prog?.pct ?? 0;
        const dd = !isFinal ? daysUntil(wo.Due_Date) : null;
        const dueText = dd === null ? null
            : dd < 0 ? `kasni ${-dd} ${-dd === 1 ? 'dan' : 'dana'}`
                : dd === 0 ? 'rok danas' : `rok za ${dd} ${dd === 1 ? 'dan' : 'dana'}`;
        const dueCls = dd === null ? '' : dd < 0 ? ' late' : dd <= 2 ? ' soon' : '';
        const isMontaza = wo.Work_Order_Type === 'Montaža';
        const attn = wo.Status === 'U toku' && attendanceWarnings
            ? attendanceWarnings.warnings.filter(w => w.Work_Order_ID === wo.Work_Order_ID).length : 0;

        return (
            <MCard key={wo.Work_Order_ID} onClick={() => setOpenId(wo.Work_Order_ID)}>
                <MCardHead>
                    <MIcon tone={isMontaza ? 'purple' : statusTone(wo.Status)}>
                        {isMontaza ? <Wrench size={21} /> : <ClipboardList size={21} />}
                    </MIcon>
                    <MCardBody
                        name={workOrderDisplayName(wo)}
                        meta={<>
                            <MPill tone={statusTone(wo.Status)}>{wo.Status}</MPill>
                            <span>#{wo.Work_Order_Number} · {items.length} {items.length === 1 ? 'proizvod' : 'proizvoda'}</span>
                        </>}
                    />
                </MCardHead>

                {wo.Status === 'Na čekanju' ? (
                    <div className="mui-ec-foot">
                        <span className={`mui-barl${dueCls}`}>{dueText || 'nije pokrenut'}</span>
                        <div className="mui-spacer" />
                        <button type="button" className="mui-actbtn green"
                            onClick={(e) => { e.stopPropagation(); onStart(wo.Work_Order_ID); }}>
                            <Play size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Pokreni
                        </button>
                    </div>
                ) : (
                    <MProgress
                        pct={pct}
                        tone={pct >= 100 ? 'green' : undefined}
                        label={<>
                            <b>{pct}%</b>
                            {dueText && <span className={dueCls.trim()}> · {dueText}</span>}
                        </>}
                    />
                )}

                {attn > 0 && (
                    <div className="mui-ec-foot">
                        <span className="mui-barl late">
                            <PersonStanding size={13} style={{ verticalAlign: -2 }} /> {attn} bez prisustva
                        </span>
                        <div className="mui-spacer" />
                        <button type="button" className="mui-actbtn"
                            onClick={(e) => { e.stopPropagation(); onAttendanceFix?.(wo); }}>Popravi</button>
                    </div>
                )}
            </MCard>
        );
    };

    return (
        <div className="mui">
            <MLarge title="Nalozi">
                {workOrders.length} {workOrders.length === 1 ? 'nalog' : 'naloga'}
                {counts['U toku'] ? ` · ${counts['U toku']} u toku` : ''}
            </MLarge>

            <div className="mui-stack mui-gap10" style={{ paddingBottom: 4 }}>
                <MSearch value={search} onChange={setSearch} placeholder="Traži nalog…" />
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="mui-chip" onClick={() => setGroupSheet(true)}>
                        <Layers size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                        {WORK_ORDER_GROUPING_OPTIONS.find(o => o.value === groupBy)?.label || 'Grupiši'}
                    </button>
                    <div className="mui-spacer" />
                    <button type="button" className="mui-chip on" onClick={onCreate}>
                        <Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Novi
                    </button>
                </div>
            </div>

            <MChips
                value={status}
                onChange={setStatus}
                options={[
                    { id: '', label: 'Sve', count: workOrders.length },
                    ...WORK_ORDER_STATUSES.map(s => ({ id: s, label: s, count: counts[s] || 0 })),
                ]}
            />

            {filtered.length === 0 ? (
                <MEmpty
                    title="Nema naloga"
                    sub={search || status ? 'Promijeni pretragu ili filter.' : 'Kreiraj prvi radni nalog.'}
                >
                    {!search && !status && (
                        <div style={{ width: '100%', paddingTop: 14 }}>
                            <MButton variant="filled" onClick={onCreate}><Plus size={19} /> Novi nalog</MButton>
                        </div>
                    )}
                </MEmpty>
            ) : groupBy === 'none' ? (
                <div className="mui-elist">{ungrouped.map(renderCard)}</div>
            ) : (
                groups.map(g => (
                    <div key={g.key}>
                        <MSection title={g.label} right={<span className="mui-dim">{g.count}</span>} />
                        <div className="mui-elist">{g.items.map(renderCard)}</div>
                    </div>
                ))
            )}

            {/* Grupisanje — iste opcije kao desktop (poredak naloga je fiksan). */}
            <MSheet open={groupSheet} title="Grupiši naloge" onClose={() => setGroupSheet(false)}>
                <MList>
                    {WORK_ORDER_GROUPING_OPTIONS.map(o => (
                        <MOption
                            key={o.value}
                            label={o.label}
                            selected={groupBy === o.value}
                            onClick={() => { setGroupBy(o.value); setGroupSheet(false); }}
                        />
                    ))}
                </MList>
            </MSheet>

            {/* Detalj naloga — vlastiti ekran */}
            {openWo && (
                <MobileWorkOrderDetail
                    workOrder={openWo}
                    workers={workers}
                    tasks={tasks}
                    projects={projects}
                    onClose={() => setOpenId(null)}
                    onRefresh={onRefresh}
                    showToast={showToast}
                    onStart={onStart}
                    onPrint={onPrint}
                    onDelete={onDelete}
                />
            )}
        </div>
    );
}
