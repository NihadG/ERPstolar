'use client';

// ════════════════════════════════════════════════════════════════════
// ZADACI — zid ceduljica
//
// Ceduljica je namjerno papirna: boja papira nosi HITNOST (crveno-narančasto-
// žuto-sivo), traka na vrhu nosi PROJEKAT, a jedva primjetan nagib daje
// osjećaj hrpe na stolu. Nagib nestaje čim se ceduljica otvori — tada je
// bitna čitljivost, ne atmosfera.
//
// Dva poretka, jer se zadaci gledaju na dva načina:
//   • HITNOST — „šta prvo danas" (kasni → hitnost → rok), preko svih projekata
//   • PROJEKAT — „šta sve visi na ovom poslu"
//
// Klik ne otvara modal: ceduljica se širi NA MJESTU, da se ne izgubi kontekst
// ostalih ceduljica oko nje.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Check, ExternalLink, Pencil, Plus, Square, SquareCheckBig } from 'lucide-react';
import type { Task } from '@/lib/types';
import { TASK_PRIORITY_LABELS } from '@/lib/types';
import type { BoardScope } from '@/lib/command/scope';
import { isTaskOpen, taskProduct, taskProject } from '@/lib/command/scope';
import { isTaskLate, lensAllowsTask, type LensSelection } from '@/lib/command/signals';
import { hue, KcPanel, shortDate } from './parts';

const PRIORITY_RANK: Record<Task['Priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default function TaskWall({
    scope, lens, showDone, today, canCreate, wide, onToggleDone, onEdit, onToggleChecklist, onNew, onOpenWorkOrder, solo, onSolo,
}: {
    scope: BoardScope;
    lens: LensSelection | null;
    showDone: boolean;
    today: string;
    canCreate: boolean;
    wide: boolean;
    onToggleDone: (task: Task) => void;
    onEdit: (task: Task) => void;
    onToggleChecklist: (task: Task, itemId: string) => void;
    onNew: (projectId: string) => void;
    onOpenWorkOrder: (id: string) => void;
    solo?: string | null;
    onSolo?: (id: string | null) => void;
}) {
    const [openId, setOpenId] = useState<string | null>(null);
    const [groupBy, setGroupBy] = useState<'priority' | 'project'>('priority');
    const [adding, setAdding] = useState(false);

    const byUrgency = (a: Task, b: Task) =>
        Number(isTaskLate(b, today)) - Number(isTaskLate(a, today))
        || Number(isTaskOpen(b)) - Number(isTaskOpen(a))
        || PRIORITY_RANK[a.Priority] - PRIORITY_RANK[b.Priority]
        || (a.Due_Date || '9999').localeCompare(b.Due_Date || '9999');

    const tasks = useMemo(
        () => scope.tasks
            .filter(t => lensAllowsTask(lens, t.Task_ID) && (showDone || isTaskOpen(t)))
            .sort(byUrgency),
        [scope.tasks, lens, showDone, today],
    );

    const groups = useMemo(() => {
        if (groupBy === 'priority') return [{ id: '', label: '', tasks }];
        return scope.projects
            .map(project => ({
                id: project.Project_ID,
                label: project.Name || project.Client_Name || 'Projekat',
                tasks: tasks.filter(t => taskProject(t, scope) === project.Project_ID),
            }))
            .filter(g => g.tasks.length > 0);
    }, [groupBy, tasks, scope]);

    const openCount = tasks.filter(isTaskOpen).length;
    const renderNote = (task: Task) => (
        <StickyNote
            key={task.Task_ID}
            task={task}
            scope={scope}
            today={today}
            open={openId === task.Task_ID}
            onToggleOpen={() => setOpenId(openId === task.Task_ID ? null : task.Task_ID)}
            onToggleDone={() => onToggleDone(task)}
            onEdit={() => onEdit(task)}
            onToggleChecklist={itemId => onToggleChecklist(task, itemId)}
            onOpenWorkOrder={onOpenWorkOrder}
        />
    );

    return (
        <KcPanel
            id="tasks"
            eyebrow="ŠTA TREBA URADITI"
            title="Zadaci"
            count={openCount}
            wide={wide}
            solo={solo}
            onSolo={onSolo}
            actions={
                <div className="kc-seg" role="group" aria-label="Poredak zadataka">
                    <button type="button" aria-pressed={groupBy === 'priority'} onClick={() => setGroupBy('priority')}>Hitnost</button>
                    <button type="button" aria-pressed={groupBy === 'project'} onClick={() => setGroupBy('project')}>Projekat</button>
                </div>
            }
        >
            {groups.map(group => (
                <div key={group.id || 'all'}>
                    {group.label && (
                        <div className="kc-group-head" style={hue(group.id)}>
                            <span className="kc-group-dot" />
                            <strong>{group.label}</strong>
                            <span>{group.tasks.length}</span>
                            {canCreate && (
                                <div className="kc-group-actions">
                                    <button type="button" className="kc-link" onClick={() => onNew(group.id)}>+ ceduljica</button>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="kc-wall">{group.tasks.map(renderNote)}</div>
                </div>
            ))}

            {tasks.length === 0 && (
                <div className="kc-empty" style={{ padding: 22 }}>
                    <p>Nema zadataka u ovom prikazu.</p>
                </div>
            )}

            {canCreate && groupBy === 'priority' && (
                <div className="kc-wall" style={{ paddingTop: 0 }}>
                    {adding && scope.projects.length > 1 ? (
                        <div className="kc-qa-item">
                            <div className="kc-qa-meta" style={{ fontWeight: 650 }}>Za koji projekat?</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {scope.projects.map(project => (
                                    <button
                                        type="button"
                                        key={project.Project_ID}
                                        className="kc-chip-add"
                                        style={{ ...hue(project.Project_ID), borderStyle: 'solid', borderColor: 'var(--kc-ink)', color: 'var(--kc-txt)' }}
                                        onClick={() => { setAdding(false); onNew(project.Project_ID); }}
                                    >
                                        {project.Name || project.Client_Name}
                                    </button>
                                ))}
                                <button type="button" className="kc-btn sm" onClick={() => setAdding(false)}>Odustani</button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="kc-note-add"
                            onClick={() => (scope.projects.length === 1 ? onNew(scope.projects[0].Project_ID) : setAdding(true))}
                            disabled={scope.projects.length === 0}
                        >
                            <Plus size={16} /> Nova ceduljica
                        </button>
                    )}
                </div>
            )}
        </KcPanel>
    );
}

function StickyNote({
    task, scope, today, open, onToggleOpen, onToggleDone, onEdit, onToggleChecklist, onOpenWorkOrder,
}: {
    task: Task;
    scope: BoardScope;
    today: string;
    open: boolean;
    onToggleOpen: () => void;
    onToggleDone: () => void;
    onEdit: () => void;
    onToggleChecklist: (itemId: string) => void;
    onOpenWorkOrder: (id: string) => void;
}) {
    const projectId = taskProject(task, scope);
    const productId = taskProduct(task, scope);
    const project = projectId ? scope.projects.find(p => p.Project_ID === projectId) : undefined;
    const product = productId ? scope.products.get(productId) : undefined;
    const late = isTaskLate(task, today);
    const done = !isTaskOpen(task);
    const checklist = task.Checklist || [];
    const checked = checklist.filter(i => i.completed).length;
    const workOrderLink = (task.Links || []).find(l => l.Entity_Type === 'work_order');

    return (
        <div
            className={`kc-note p-${task.Priority}${open ? ' open' : ''}${done ? ' done' : ''}`}
            style={hue(projectId)}
            onClick={open ? undefined : onToggleOpen}
            role={open ? undefined : 'button'}
            tabIndex={open ? undefined : 0}
            onKeyDown={open ? undefined : e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOpen(); } }}
            aria-expanded={open}
        >
            <div className="kc-note-top">
                <button
                    type="button"
                    className={`kc-note-tick${done ? ' on' : ''}`}
                    aria-label={done ? `Vrati zadatak: ${task.Title}` : `Završi zadatak: ${task.Title}`}
                    onClick={e => { e.stopPropagation(); onToggleDone(); }}
                >
                    {done && <Check size={12} strokeWidth={3} />}
                </button>
                <strong>{task.Title}</strong>
            </div>

            <div className="kc-note-meta">
                {task.Priority !== 'medium' && <span className="kc-note-pri">{TASK_PRIORITY_LABELS[task.Priority]}</span>}
                <span>{[project?.Name || project?.Client_Name, product?.Name].filter(Boolean).join(' · ') || 'Bez veze'}</span>
                {task.Due_Date
                    ? <span className={late ? 'late' : undefined}>{late ? 'Kasni · ' : ''}{shortDate(task.Due_Date, today)}</span>
                    : <span>Bez roka</span>}
                {checklist.length > 0 && <span>{checked}/{checklist.length}</span>}
            </div>

            {checklist.length > 0 && !open && (
                <div className="kc-clbar"><i style={{ width: `${(checked / checklist.length) * 100}%` }} /></div>
            )}

            {open && (
                <div className="kc-note-body">
                    {task.Description && <p>{task.Description}</p>}
                    {task.Assigned_Worker_Name && <p style={{ fontSize: 11.5, opacity: 0.75 }}>Izvršilac: {task.Assigned_Worker_Name}</p>}
                    {checklist.length > 0 && (
                        <div className="kc-checklist">
                            {checklist.map(item => (
                                <button
                                    type="button"
                                    key={item.id}
                                    className={`kc-checklist-item${item.completed ? ' done' : ''}`}
                                    onClick={e => { e.stopPropagation(); onToggleChecklist(item.id); }}
                                >
                                    {item.completed ? <SquareCheckBig size={13} /> : <Square size={13} />}
                                    {item.text}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="kc-note-actions">
                        <button type="button" className="kc-note-btn" onClick={e => { e.stopPropagation(); onEdit(); }}>
                            <Pencil size={12} /> Uredi
                        </button>
                        {workOrderLink && (
                            <button type="button" className="kc-note-btn" onClick={e => { e.stopPropagation(); onOpenWorkOrder(workOrderLink.Entity_ID); }}>
                                <ExternalLink size={12} /> Otvori nalog
                            </button>
                        )}
                        <button type="button" className="kc-note-btn" onClick={e => { e.stopPropagation(); onToggleOpen(); }}>Sklopi</button>
                    </div>
                </div>
            )}
        </div>
    );
}
