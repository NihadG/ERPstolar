'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronRight, Circle, ClipboardList, Plus, Search } from 'lucide-react';
import type { Project, Task, WorkOrder } from '@/lib/types';
import type { ProjectOverview } from '@/lib/projectOverview';
import { projectMaterialRows } from '@/lib/projectCommand';
import { todayISO } from '@/lib/planning';
import { formatDate } from '@/lib/utils';
import ProjectPlanCalendar from './ProjectPlanCalendar';
import './ProjectCommand.css';

type Destination = 'proizvodi' | 'materijali' | 'nalozi' | 'zadaci' | 'radnici';
export default function ProjectCommand({ ov, project, organizationId, rawWorkOrders, projectTasks, orderableCount, canCreate,
    onOpenWorkOrder, onNewWorkOrder, onNaruci, onAddTask, onToggleTask, onOpenTask, onGoTab,
}: {
    ov: ProjectOverview; project: Project; organizationId?: string | null; rawWorkOrders: WorkOrder[]; projectTasks: Task[];
    orderableCount: number; canCreate: boolean;
    onOpenWorkOrder: (id: string) => void; onNewWorkOrder: () => void; onNaruci: () => void;
    onAddTask: () => void; onToggleTask: (task: Task) => void; onOpenTask: (task: Task) => void; onGoTab: (tab: Destination) => void;
}) {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('active');
    const today = todayISO();
    const overdue = (date?: string) => !!date && date.slice(0, 10) < today;
    const active = ov.workOrders.filter(w => w.status !== 'Završeno' && w.status !== 'Otkazano');
    const late = active.filter(w => overdue(w.dueDate));
    const products = ov.products.filter(p => !p.isCustom);
    const doneProducts = products.filter(p => p.status === 'Završeno').length;
    const progress = products.length ? Math.round(doneProducts / products.length * 100) : 0;
    const materials = useMemo(() => projectMaterialRows(project), [project]);
    const ready = materials.filter(m => m.Status === 'Primljeno' || m.Status === 'Na stanju').length;
    const ordered = materials.filter(m => m.Status === 'Naručeno').length;
    const openTasks = projectTasks.filter(t => t.Status !== 'completed' && t.Status !== 'cancelled').sort((a, b) => {
        const priority = { urgent: 0, high: 1, medium: 2, low: 3 };
        return Number(overdue(b.Due_Date)) - Number(overdue(a.Due_Date)) || priority[a.Priority] - priority[b.Priority] || (a.Due_Date || '9999').localeCompare(b.Due_Date || '9999');
    });
    const rows = ov.workOrders.filter(w => {
        if (filter === 'active' && (w.status === 'Završeno' || w.status === 'Otkazano')) return false;
        if (filter === 'late' && !late.some(l => l.workOrderId === w.workOrderId)) return false;
        if (filter === 'done' && w.status !== 'Završeno') return false;
        const raw = rawWorkOrders.find(r => r.Work_Order_ID === w.workOrderId);
        return `${w.name} ${w.number} ${(raw?.items || []).filter(i => i.Project_ID === project.Project_ID).map(i => i.Product_Name).join(' ')}`.toLocaleLowerCase('bs').includes(query.trim().toLocaleLowerCase('bs'));
    }).sort((a, b) => Number(overdue(b.dueDate)) - Number(overdue(a.dueDate)) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

    return <div className="pc-command">
        <section className="pc-summary" aria-label="Napredak projekta">
            <div className="pc-summary-intro"><span className="pc-eyebrow">KOMANDA PROJEKTA</span><h2>Pregled projekta</h2><p>{project.Deadline ? `Rok projekta · ${formatDate(project.Deadline)}` : 'Rok projekta nije postavljen'}{late.length > 0 ? ` · ${late.length} naloga kasni` : ''}</p></div>
            <button className="pc-progress" onClick={() => onGoTab('proizvodi')}><div><span>Završeni proizvodi</span><strong>{doneProducts}<small> / {products.length}</small></strong></div><div className="pc-progress-track"><i style={{ width: `${progress}%` }} /></div><span>{progress}% završeno <ArrowUpRight size={14} /></span></button>
        </section>
        <div className="pc-stats">
            <button onClick={() => { setFilter('active'); document.getElementById('project-command-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span>Aktivni nalozi</span><strong>{active.length}</strong><small>{late.length ? `${late.length} s prekoračenim rokom` : 'Pregled izvođenja'}<ChevronRight size={14} /></small></button>
            <button onClick={() => onGoTab('materijali')}><span>Spremnost materijala</span><strong>{ready}<em> / {materials.length}</em></strong><small>{orderableCount ? `${orderableCount} čeka narudžbu` : ordered ? `${ordered} čeka isporuku` : materials.length ? 'Materijali su spremni' : 'Materijali nisu uneseni'}<ChevronRight size={14} /></small></button>
            <button onClick={() => onGoTab('zadaci')}><span>Otvoreni zadaci</span><strong>{openTasks.length}</strong><small>{openTasks.filter(t => overdue(t.Due_Date)).length} s prošlim rokom<ChevronRight size={14} /></small></button>
            <button onClick={() => onGoTab('radnici')}><span>Tim projekta</span><strong>{ov.workers.length}</strong><small>Radnici s evidentiranim radom<ChevronRight size={14} /></small></button>
        </div>
        <div className="pc-workspace">
            <div className="pc-main">
                <section className="pc-panel" id="project-command-orders">
                    <div className="pc-section-head"><div><span className="pc-eyebrow">IZVOĐENJE</span><h2>Radni nalozi <span>{ov.workOrders.length}</span></h2></div>{canCreate && <button className="pov-btn-primary sm" onClick={onNewWorkOrder}><Plus size={16} /> Novi nalog</button>}</div>
                    <div className="pc-order-tools"><div className="pc-segment" aria-label="Filter naloga">{[['active', 'Aktivni'], ['late', `Kasne (${late.length})`], ['done', 'Završeni'], ['all', 'Svi']].map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="pc-search"><Search size={15} /><input aria-label="Pretraži naloge i proizvode" placeholder="Nađi nalog ili proizvod" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
                    <div className="pc-order-labels"><span>Nalog / proizvodi</span><span>Napredak</span><span>Rok</span></div>
                    <div className="pc-orders">{rows.map(w => {
                        const items = (rawWorkOrders.find(r => r.Work_Order_ID === w.workOrderId)?.items || []).filter(i => i.Project_ID === project.Project_ID);
                        const done = items.filter(i => i.Status === 'Završeno').length;
                        const pct = items.length ? Math.round(done / items.length * 100) : 0;
                        const isLate = overdue(w.dueDate) && w.status !== 'Završeno' && w.status !== 'Otkazano';
                        const names = Array.from(new Set(items.map(i => i.Product_Name).filter(Boolean)));
                        return <button key={w.workOrderId} className="pc-order" onClick={() => onOpenWorkOrder(w.workOrderId)}>
                            <div className="pc-order-title"><div><strong>{w.name || `Nalog ${w.number}`}</strong><span className={`pc-status ${w.status === 'U toku' ? 'running' : w.status === 'Završeno' ? 'done' : ''}`}>{w.status}</span></div><span title={names.join(', ')}>{w.name && w.number ? `#${w.number} · ` : ''}{names.slice(0, 2).join(', ') || w.type}{names.length > 2 ? ` +${names.length - 2}` : ''}</span></div>
                            <div className="pc-order-progress"><span>{done} / {items.length} <small>stavki</small></span><div className="pc-progress-track"><i style={{ width: `${pct}%` }} /></div></div>
                            <div className={`pc-order-date ${isLate ? 'late' : ''}`}><span>{w.dueDate ? formatDate(w.dueDate) : 'Bez roka'}</span>{isLate && <small>Kasni</small>}</div><ChevronRight size={16} />
                        </button>;
                    })}</div>
                    {rows.length === 0 && <div className="pc-empty"><ClipboardList size={25} /><p>{query ? 'Nema naloga za ovu pretragu.' : filter === 'late' ? 'Nijedan aktivni nalog ne kasni.' : 'Nema naloga u ovom prikazu.'}</p>{query && <button className="cc-link" onClick={() => setQuery('')}>Očisti pretragu</button>}</div>}
                </section>
                <ProjectPlanCalendar organizationId={organizationId} project={project} workOrders={rawWorkOrders} onOpenWorkOrder={onOpenWorkOrder} />
            </div>
            <aside className="pc-rail">
                <section className="pc-panel"><div className="pc-section-head"><div><span className="pc-eyebrow">SLJEDEĆI KORACI</span><h2>Za pažnju</h2></div></div>
                    {late.length > 0 && <button className="pc-attention" onClick={() => { setFilter('late'); document.getElementById('project-command-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><i className="late" /><div><strong>{late.length} naloga kasni</strong><span>Provjerite rokove i napredak.</span></div><ChevronRight size={15} /></button>}
                    {orderableCount > 0 && <button className="pc-attention" onClick={canCreate ? onNaruci : () => onGoTab('materijali')}><i /><div><strong>{orderableCount} materijala za narudžbu</strong><span>Odaberite stavke po proizvodu.</span></div><ChevronRight size={15} /></button>}
                    {ov.counts.productsNotStarted > 0 && <button className="pc-attention" onClick={() => onGoTab('proizvodi')}><i className="neutral" /><div><strong>{ov.counts.productsNotStarted} proizvoda bez naloga</strong><span>Rasporedite ih u proizvodnju.</span></div><ChevronRight size={15} /></button>}
                    {!late.length && !orderableCount && !ov.counts.productsNotStarted && <div className="pc-empty"><CheckCircle2 size={23} /><p>Nema izdvojenih upozorenja.</p></div>}
                </section>
                <section className="pc-panel"><div className="pc-section-head"><h2>Materijali</h2><button className="cc-link" onClick={() => onGoTab('materijali')}>Pregled <ChevronRight size={14} /></button></div>
                    <div className="pc-material-state"><div><span>Spremno</span><strong>{ready}</strong></div><div><span>Čeka isporuku</span><strong>{ordered}</strong></div><div><span>Za naručiti</span><strong>{orderableCount}</strong></div></div>
                    <p className="pc-footnote">Grupisano po proizvodima, abecednim redom.</p>{canCreate && orderableCount > 0 && <button className="pc-secondary" onClick={onNaruci}>Naruči materijale <ArrowUpRight size={15} /></button>}
                </section>
                <section className="pc-panel"><div className="pc-section-head"><h2>Zadaci <span>{openTasks.length}</span></h2>{canCreate && <button className="pc-icon" aria-label="Novi zadatak" onClick={onAddTask}><Plus size={18} /></button>}</div>
                    {openTasks.slice(0, 5).map(task => <div className="pc-task" key={task.Task_ID}><button className="pc-icon" aria-label={`Završi zadatak: ${task.Title}`} onClick={() => onToggleTask(task)}><Circle size={19} /></button><button className="pc-task-title" onClick={() => onOpenTask(task)}><strong>{task.Title}</strong><span className={overdue(task.Due_Date) ? 'late' : ''}>{task.Due_Date ? `${overdue(task.Due_Date) ? 'Kasni · ' : ''}${formatDate(task.Due_Date)}` : 'Bez roka'}{task.Checklist?.length ? ` · ${task.Checklist.filter(i => i.completed).length}/${task.Checklist.length} koraka` : ''}</span></button></div>)}
                    {!openTasks.length && <p className="pc-empty">Nema otvorenih zadataka.</p>}<button className="pc-secondary" onClick={() => onGoTab('zadaci')}>Svi zadaci <ChevronRight size={15} /></button>
                </section>
            </aside>
        </div>
    </div>;
}
