'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import type { PlanBlock, PlanScenario, Project, WorkOrder } from '@/lib/types';
import { getScenarios } from '@/lib/services/planning/scenarioService';
import { belongsToProject, shiftDate, weekStart } from '@/lib/projectCommand';
import { todayISO } from '@/lib/planning';
import { formatDate } from '@/lib/utils';

const kinds: Record<PlanBlock['kind'], string> = { order: 'Proizvodnja', purchase: 'Nabavka', transport: 'Transport', montaza: 'Montaža', milestone: 'Rok', note: 'Napomena' };

export default function ProjectPlanCalendar({ organizationId, project, workOrders, onOpenWorkOrder }: {
    organizationId?: string | null; project: Project; workOrders: WorkOrder[]; onOpenWorkOrder: (id: string) => void;
}) {
    const [plans, setPlans] = useState<PlanScenario[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [anchor, setAnchor] = useState(() => weekStart(todayISO()));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [reload, setReload] = useState(0);
    const [onlyProject, setOnlyProject] = useState(false);
    const [detailId, setDetailId] = useState<string | null>(null);
    const productIds = useMemo(() => new Set((project.products || []).map(p => p.Product_ID)), [project.products]);
    const orderIds = useMemo(() => new Set(workOrders.filter(w => w.items?.some(i => i.Project_ID === project.Project_ID)).map(w => w.Work_Order_ID)), [workOrders, project.Project_ID]);
    const related = (block: PlanBlock) => belongsToProject(block, project.Project_ID, productIds, orderIds);
    useEffect(() => {
        let alive = true;
        setPlans([]);
        if (!organizationId) { setLoading(false); return; }
        setLoading(true); setError(false);
        getScenarios(organizationId).then(result => { if (alive) setPlans(result); })
            .catch(() => { if (alive) setError(true); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [organizationId, reload]);
    const relevantPlans = plans.filter(plan => plan.Blocks.some(related));
    const selected = relevantPlans.find(plan => plan.Scenario_ID === selectedId) || relevantPlans[0];
    const days = Array.from({ length: 7 }, (_, i) => shiftDate(anchor, i));
    const blocks = (selected?.Blocks || []).filter(block => block.startISO <= days[6] && block.endISO >= days[0] && (!onlyProject || related(block)))
        .sort((a, b) => Number(related(b)) - Number(related(a)) || a.startISO.localeCompare(b.startISO) || a.title.localeCompare(b.title, 'bs'));
    const detail = selected?.Blocks.find(b => b.id === detailId);
    const focusProject = () => {
        const activities = (selected?.Blocks || []).filter(related).sort((a, b) => a.startISO.localeCompare(b.startISO));
        const next = activities.find(block => block.endISO >= todayISO()) || activities[0];
        if (next) setAnchor(weekStart(next.startISO < todayISO() && next.endISO >= todayISO() ? todayISO() : next.startISO));
    };

    return <section className="pc-panel pc-calendar" aria-label="Plan projekta">
        <div className="pc-section-head"><div><span className="pc-eyebrow">PLATNO · RASPORED</span><h2>Plan projekta</h2></div>
            <button className="pc-icon" aria-label="Osvježi planove" onClick={() => setReload(n => n + 1)} disabled={loading}><RefreshCw size={16} /></button></div>
        {loading ? <p className="pc-empty" role="status">Učitavam planove…</p> : error ? <div className="pc-empty" role="alert">Planovi se nisu učitali. <button className="cc-link" onClick={() => setReload(n => n + 1)}>Pokušaj ponovo</button></div> : !selected ? <div className="pc-empty"><CalendarDays size={24} /><p>Ovaj projekat još nije povezan s planom.</p><span>U Platnu dodajte proizvode projekta u plan. Raspored će biti vidljiv ovdje.</span></div> : <>
            <div className="pc-calendar-tools">
                <label className="pc-plan-select">Plan<select aria-label="Odaberi plan" value={selected.Scenario_ID} onChange={e => { setSelectedId(e.target.value); setDetailId(null); }}>{relevantPlans.map(plan => <option key={plan.Scenario_ID} value={plan.Scenario_ID}>{plan.Name}</option>)}</select></label>
                <div className="pc-week-nav"><button className="pc-icon" aria-label="Prethodna sedmica" onClick={() => setAnchor(shiftDate(anchor, -7))}><ChevronLeft size={17} /></button><span>{formatDate(days[0])} – {formatDate(days[6])}</span><button className="pc-icon" aria-label="Sljedeća sedmica" onClick={() => setAnchor(shiftDate(anchor, 7))}><ChevronRight size={17} /></button></div>
                <button className="pc-text-btn" onClick={() => setAnchor(weekStart(todayISO()))}>Danas</button><button className="pc-text-btn" onClick={focusProject}>Na termin projekta</button>
            </div>
            <div className="pc-calendar-legend"><span><i /> Ovaj projekat</span><span><i className="muted" /> Ostali poslovi u planu</span><label><input type="checkbox" checked={onlyProject} onChange={e => setOnlyProject(e.target.checked)} /> Samo ovaj projekat</label></div>
            <div className="pc-calendar-scroll" data-no-swipe><div className="pc-week-grid">
                {days.map((day, i) => <div key={day} className={`pc-day ${day === todayISO() ? 'today' : ''} ${i > 4 ? 'weekend' : ''}`}><span>{['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'][i]}</span><b>{Number(day.slice(8))}</b></div>)}
                {blocks.map((block, index) => {
                    const start = days.findIndex(day => day >= block.startISO);
                    const end = days.filter(day => day <= block.endISO).length;
                    return <button key={block.id} className={`pc-plan-block ${related(block) ? 'related' : 'context'}`} style={{ gridColumn: `${Math.max(0, start) + 1} / ${end + 1}`, gridRow: index + 2 }} onClick={() => setDetailId(block.id)} title={`${block.title} · ${formatDate(block.startISO)} – ${formatDate(block.endISO)}`}><span>{kinds[block.kind]}</span><strong>{block.title}</strong></button>;
                })}
            </div></div>
            {blocks.length === 0 && <div className="pc-empty">Nema aktivnosti u ovoj sedmici. <button className="cc-link" onClick={focusProject}>Prikaži termin projekta</button></div>}
            {detail && <div className="pc-plan-detail"><div className="pc-section-head"><div><span className="pc-eyebrow">{kinds[detail.kind]}</span><h3>{detail.title}</h3></div><button className="pc-icon" aria-label="Zatvori detalje aktivnosti" onClick={() => setDetailId(null)}><X size={16} /></button></div><p>{formatDate(detail.startISO)} – {formatDate(detail.endISO)}</p>
                {!!detail.productRefs?.length && <div className="pc-product-tags">{detail.productRefs.map((ref, i) => <span key={ref.id || i} className={ref.id && productIds.has(ref.id) ? 'related' : ''}>{ref.name} · {ref.qty} kom</span>)}</div>}
                {!!detail.workerRefs?.length && <p>Ekipa: {detail.workerRefs.map(ref => ref.name).join(', ')}</p>}{detail.notes && <p>{detail.notes}</p>}
                {detail.linkedWorkOrderId && orderIds.has(detail.linkedWorkOrderId) && <button className="cc-link" onClick={() => onOpenWorkOrder(detail.linkedWorkOrderId!)}>Otvori povezani nalog <ChevronRight size={15} /></button>}
            </div>}
            <p className="pc-footnote">Raspored iz sačuvanog plana. Termini se uređuju u Platnu.</p>
        </>}
    </section>;
}
