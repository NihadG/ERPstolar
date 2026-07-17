'use client';

// ════════════════════════════════════════════════════════════════════
// ZADACI NALOGA — tab „Zadaci" na kartici (desktop i mobitel dijele ovo).
//
// Radi nad ŽIVIM Task dokumentima (nema lokalne kopije statusa): čekiranje
// ovdje je isto pisanje kao čekiranje u tabu Zadaci, pa su oba prikaza uvijek
// isti podatak. Vidi lib/workOrderTasks.ts.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import {
    Check, Plus, Link2, X, ChevronRight, Lightbulb, Package, Calendar,
    User, Loader2, ListChecks, ClipboardList,
} from 'lucide-react';
import {
    tasksForWorkOrder, suggestedTasksForWorkOrder, taskProgress,
    isTaskOverdue, taskProductInOrder, isTaskLinkedToWorkOrder,
} from '@/lib/workOrderTasks';
import { workOrderDisplayName } from '@/lib/utils';
import { todayISO } from '@/lib/planning';
import {
    TASK_PRIORITY_LABELS, TASK_CATEGORY_LABELS, TASK_CATEGORIES,
    type Task, type TaskPriority, type TaskCategory, type WorkOrder, type Worker,
} from '@/lib/types';
import TaskPickerModal from './TaskPickerModal';
import ChecklistEditor from './ChecklistEditor';
import PrioritySelect from './PrioritySelect';
import './WorkOrderTasksPanel.css';

interface WorkOrderTasksPanelProps {
    workOrder: WorkOrder;
    /** Svi zadaci organizacije — filtriranje po nalogu ide kroz Task.Links. */
    tasks: Task[];
    workers: Worker[];
    organizationId: string;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const fmtDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

/** Ključ za korake nacrta — pravi ID dodjeljuje baza pri upisu. */
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random()}`);

export default function WorkOrderTasksPanel({
    workOrder, tasks, workers, organizationId, onRefresh, showToast,
}: WorkOrderTasksPanelProps) {
    const [busyId, setBusyId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [pickerOpen, setPickerOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [saving, setSaving] = useState(false);

    // Nacrt novog zadatka (inline forma — bez odlaska u tab Zadaci)
    const [draftTitle, setDraftTitle] = useState('');
    const [draftPriority, setDraftPriority] = useState<TaskPriority>('medium');
    const [draftCategory, setDraftCategory] = useState<TaskCategory>('general');
    const [draftDue, setDraftDue] = useState('');
    const [draftProduct, setDraftProduct] = useState('');
    const [draftWorker, setDraftWorker] = useState('');
    // Koraci nacrta — lokalni ID-evi (pravi se dodjeljuju pri upisu).
    const [draftChecklist, setDraftChecklist] = useState<{ id: string; text: string; completed: boolean }[]>([]);

    const items = workOrder.items || [];
    const today = todayISO();
    const woRef = { Work_Order_ID: workOrder.Work_Order_ID, displayName: workOrderDisplayName(workOrder) };

    const orderTasks = useMemo(() => tasksForWorkOrder(tasks, workOrder.Work_Order_ID), [tasks, workOrder.Work_Order_ID]);
    const progress = useMemo(() => taskProgress(orderTasks, today), [orderTasks, today]);
    const suggestions = useMemo(
        () => suggestedTasksForWorkOrder(tasks, workOrder.Work_Order_ID, items),
        [tasks, workOrder.Work_Order_ID, items]
    );
    // Za ručni izbor nudimo SVE što nije na ovom nalogu (i završene — nekad se
    // veže gotov zadatak radi evidencije na printu).
    const pickable = useMemo(
        () => tasks.filter(t => !isTaskLinkedToWorkOrder(t, workOrder.Work_Order_ID)),
        [tasks, workOrder.Work_Order_ID]
    );

    const productName = (id?: string) => items.find(i => i.Product_ID === id)?.Product_Name;

    const toggleExpand = (id: string) => setExpanded(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const resetDraft = () => {
        setDraftTitle(''); setDraftPriority('medium'); setDraftCategory('general');
        setDraftDue(''); setDraftProduct(''); setDraftWorker(''); setDraftChecklist([]); setCreating(false);
    };

    // ── Akcije ──────────────────────────────────────────────────────

    /** Čekiranje: završeno ⇄ na čekanju. Isti upis koji radi i tab Zadaci. */
    const toggleDone = async (task: Task) => {
        if (busyId) return;
        const next = task.Status === 'completed' ? 'pending' : 'completed';
        try {
            setBusyId(task.Task_ID);
            const { updateTaskStatus } = await import('@/lib/services');
            const res = await updateTaskStatus(task.Task_ID, next, organizationId);
            if (res.success) onRefresh('tasks');
            else showToast(res.message, 'error');
        } catch {
            showToast('Greška pri promjeni statusa zadatka', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const toggleChecklist = async (task: Task, itemId: string) => {
        if (busyId) return;
        try {
            setBusyId(task.Task_ID);
            const { toggleTaskChecklistItem } = await import('@/lib/services');
            const res = await toggleTaskChecklistItem(task.Task_ID, itemId, organizationId);
            if (res.success) onRefresh('tasks');
            else showToast(res.message, 'error');
        } catch {
            showToast('Greška pri ažuriranju checkliste', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const addChecklist = async (task: Task, text: string) => {
        if (busyId) return;
        try {
            setBusyId(task.Task_ID);
            const { addChecklistItem } = await import('@/lib/services');
            const res = await addChecklistItem(task.Task_ID, text, organizationId);
            if (res.success) onRefresh('tasks');
            else showToast(res.message, 'error');
        } catch {
            showToast('Greška pri dodavanju koraka', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const removeChecklist = async (task: Task, itemId: string) => {
        if (busyId) return;
        try {
            setBusyId(task.Task_ID);
            const { removeChecklistItem } = await import('@/lib/services');
            const res = await removeChecklistItem(task.Task_ID, itemId, organizationId);
            if (res.success) onRefresh('tasks');
            else showToast(res.message, 'error');
        } catch {
            showToast('Greška pri uklanjanju koraka', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const setProduct = async (task: Task, productId: string) => {
        if (busyId) return;
        try {
            setBusyId(task.Task_ID);
            const { setTaskProductInOrder } = await import('@/lib/services');
            const res = await setTaskProductInOrder(task.Task_ID, items, productId || null, organizationId);
            if (res.success) onRefresh('tasks');
            else showToast(res.message, 'error');
        } catch {
            showToast('Greška pri povezivanju proizvoda', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const unlink = async (task: Task) => {
        if (busyId) return;
        try {
            setBusyId(task.Task_ID);
            const { unlinkTaskFromWorkOrder } = await import('@/lib/services');
            const res = await unlinkTaskFromWorkOrder(task.Task_ID, workOrder.Work_Order_ID, organizationId);
            if (res.success) { showToast('Zadatak skinut s naloga (ostaje u Zadacima)', 'success'); onRefresh('tasks'); }
            else showToast(res.message, 'error');
        } catch {
            showToast('Greška pri skidanju zadatka', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const linkExisting = async (taskIds: string[]) => {
        if (taskIds.length === 0) return;
        try {
            setSaving(true);
            const { linkTasksToWorkOrder } = await import('@/lib/services');
            const res = await linkTasksToWorkOrder(taskIds, woRef, organizationId);
            if (res.success) { showToast(res.message, 'success'); onRefresh('tasks'); }
            else showToast(res.message, 'error');
        } catch {
            showToast('Greška pri vezivanju zadataka', 'error');
        } finally {
            setSaving(false);
        }
    };

    const createTask = async () => {
        const title = draftTitle.trim();
        if (!title || saving) return;
        try {
            setSaving(true);
            const { attachTasksToWorkOrder } = await import('@/lib/services');
            const res = await attachTasksToWorkOrder({
                existingTaskIds: [],
                newTasks: [{
                    id: 'draft',
                    Title: title,
                    Priority: draftPriority,
                    Category: draftCategory,
                    ...(draftDue ? { Due_Date: draftDue } : {}),
                    ...(draftProduct ? { productId: draftProduct } : {}),
                    ...(draftWorker ? { Assigned_Worker_ID: draftWorker } : {}),
                    ...(draftChecklist.length > 0 ? { checklist: draftChecklist.map(c => c.text) } : {}),
                }],
            }, woRef, items, organizationId);
            if (res.success) { showToast('Zadatak dodan na nalog', 'success'); resetDraft(); onRefresh('tasks'); }
            else showToast(res.message, 'error');
        } catch {
            showToast('Greška pri kreiranju zadatka', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ── Prikaz ──────────────────────────────────────────────────────

    return (
        <div className="wot">
            {/* Traka: napredak + akcije */}
            <div className="wot-bar">
                <div className="wot-summary">
                    {progress.total === 0 ? (
                        <span className="wot-summary-empty">Nema zadataka</span>
                    ) : (
                        <>
                            <span className="wot-summary-count">{progress.done}/{progress.total}</span>
                            <span className="wot-summary-label">urađeno</span>
                            <span className="wot-bar-track">
                                <span className={`wot-bar-fill${progress.pct >= 100 ? ' full' : ''}`} style={{ width: `${progress.pct}%` }} />
                            </span>
                            {progress.overdue > 0 && (
                                <span className="wot-summary-overdue">
                                    {progress.overdue} {progress.overdue === 1 ? 'kasni' : 'kasne'}
                                </span>
                            )}
                        </>
                    )}
                </div>
                <div className="wot-actions">
                    <button className="wot-btn" onClick={() => setPickerOpen(true)} disabled={saving}>
                        <Link2 size={14} /> Poveži postojeći
                    </button>
                    <button className="wot-btn primary" onClick={() => setCreating(c => !c)} disabled={saving}>
                        <Plus size={14} /> Novi zadatak
                    </button>
                </div>
            </div>

            {/* Nacrt novog zadatka */}
            {creating && (
                <div className="wot-create">
                    <div className="wot-create-head">
                        <span className="wot-create-head-title"><ClipboardList size={14} /> Novi zadatak</span>
                        <button type="button" className="wot-create-close" onClick={resetDraft} aria-label="Zatvori">
                            <X size={15} />
                        </button>
                    </div>

                    <input
                        autoFocus
                        className="wot-create-title"
                        placeholder="Šta treba uraditi?"
                        value={draftTitle}
                        onChange={e => setDraftTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') createTask(); if (e.key === 'Escape') resetDraft(); }}
                    />

                    <label className="wot-create-priority">
                        <span>Prioritet</span>
                        <PrioritySelect value={draftPriority} onChange={setDraftPriority} disabled={saving} />
                    </label>

                    <div className="wot-create-fields">
                        <label>
                            <span>Kategorija</span>
                            <select value={draftCategory} onChange={e => setDraftCategory(e.target.value as TaskCategory)}>
                                {TASK_CATEGORIES.map(c => <option key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</option>)}
                            </select>
                        </label>
                        <label>
                            <span>Rok</span>
                            <input type="date" value={draftDue} onChange={e => setDraftDue(e.target.value)} />
                        </label>
                        {items.length > 0 && (
                            <label>
                                <span>Proizvod</span>
                                <select value={draftProduct} onChange={e => setDraftProduct(e.target.value)}>
                                    <option value="">Cijeli nalog</option>
                                    {items.map(i => <option key={i.ID} value={i.Product_ID}>{i.Product_Name}</option>)}
                                </select>
                            </label>
                        )}
                        <label>
                            <span>Radnik</span>
                            <select value={draftWorker} onChange={e => setDraftWorker(e.target.value)}>
                                <option value="">Bez zaduženja</option>
                                {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                            </select>
                        </label>
                    </div>

                    {/* Koraci — razbijanje zadatka na stavke odmah pri unosu */}
                    <div className="wot-create-checklist">
                        <ChecklistEditor
                            items={draftChecklist}
                            disabled={saving}
                            onAdd={text => setDraftChecklist(prev => [...prev, { id: uid(), text, completed: false }])}
                            onRemove={id => setDraftChecklist(prev => prev.filter(c => c.id !== id))}
                        />
                    </div>

                    <div className="wot-create-foot">
                        <button className="wot-btn" onClick={resetDraft} disabled={saving}>Odustani</button>
                        <button className="wot-btn primary" onClick={createTask} disabled={!draftTitle.trim() || saving}>
                            {saving ? <Loader2 size={14} className="wot-spin" /> : <Plus size={14} />} Dodaj zadatak
                        </button>
                    </div>
                </div>
            )}

            {/* Prijedlozi: vezani za proizvod iz naloga, ali nisu na nalogu */}
            {suggestions.length > 0 && (
                <div className="wot-suggest">
                    <Lightbulb size={15} />
                    <span>
                        {suggestions.length === 1
                            ? <>Zadatak <strong>{suggestions[0].Title}</strong> se tiče proizvoda iz ovog naloga, ali nije na njemu.</>
                            : <><strong>{suggestions.length} zadataka</strong> se tiče proizvoda iz ovog naloga, ali nisu na njemu.</>}
                    </span>
                    <button
                        className="wot-suggest-btn"
                        disabled={saving}
                        onClick={() => linkExisting(suggestions.map(t => t.Task_ID))}
                    >
                        Dodaj {suggestions.length > 1 ? 'sve' : ''}
                    </button>
                </div>
            )}

            {/* Lista zadataka */}
            {orderTasks.length === 0 ? (
                <div className="wot-empty">
                    Nijedan zadatak nije vezan za ovaj nalog.<br />
                    Dodaj novi ili poveži postojeći iz taba Zadaci — vidjeće se i ovdje i tamo.
                </div>
            ) : (
                <div className="wot-list">
                    {orderTasks.map(task => {
                        const done = task.Status === 'completed';
                        const cancelled = task.Status === 'cancelled';
                        const overdue = isTaskOverdue(task, today);
                        const isOpen = expanded.has(task.Task_ID);
                        const linkedProduct = taskProductInOrder(task, items);
                        const checklist = task.Checklist || [];
                        const checkDone = checklist.filter(c => c.completed).length;
                        const busy = busyId === task.Task_ID;
                        const cardClass = `wot-task${done ? ' done' : cancelled ? ' cancelled' : ` p-${task.Priority}`}`;

                        return (
                            <div key={task.Task_ID} className={cardClass}>
                                <div className="wot-task-main">
                                    <button
                                        className={`wot-check${done ? ' on' : ''}`}
                                        disabled={busy || cancelled}
                                        onClick={() => toggleDone(task)}
                                        title={done ? 'Vrati na čekanje' : 'Označi završenim'}
                                        aria-label={done ? 'Vrati na čekanje' : 'Označi završenim'}
                                    >
                                        {busy ? <Loader2 size={12} className="wot-spin" /> : done && <Check size={13} strokeWidth={3} />}
                                    </button>

                                    <div className="wot-task-body">
                                        <div className="wot-task-title-row">
                                            {/* Uvijek sklopivo: i zadatak bez opisa/koraka se otvara,
                                                jer se korak može DODATI u svakom trenutku. */}
                                            <button className="wot-task-title as-toggle" onClick={() => toggleExpand(task.Task_ID)}>
                                                <ChevronRight size={13} className={`wot-chev${isOpen ? ' open' : ''}`} />
                                                {task.Title}
                                            </button>
                                            {!done && !cancelled && (
                                                <span className={`wot-prio p-${task.Priority}`}>{TASK_PRIORITY_LABELS[task.Priority]}</span>
                                            )}
                                            {task.Status === 'in_progress' && <span className="wot-tag progress">U toku</span>}
                                            {cancelled && <span className="wot-tag cancelled">Otkazano</span>}
                                        </div>

                                        <div className="wot-task-meta">
                                            <span className="wot-cat">{TASK_CATEGORY_LABELS[task.Category]}</span>
                                            {linkedProduct && (
                                                <span title="Zadatak se odnosi na ovaj proizvod">
                                                    <Package size={11} /> {productName(linkedProduct)}
                                                </span>
                                            )}
                                            {task.Due_Date && (
                                                <span className={overdue ? 'is-overdue' : ''}>
                                                    <Calendar size={11} /> {fmtDate(task.Due_Date)}{overdue && ' · kasni'}
                                                </span>
                                            )}
                                            {task.Assigned_Worker_Name && (
                                                <span><User size={11} /> {task.Assigned_Worker_Name}</span>
                                            )}
                                            {/* Samo dok je sklopljeno — otvoren zadatak ima puno
                                                zaglavlje koraka (s trakom) u detalju ispod. */}
                                            {checklist.length > 0 && !isOpen && (
                                                <span title={`${checkDone} od ${checklist.length} koraka urađeno`}>
                                                    <ListChecks size={11} /> {checkDone}/{checklist.length}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="wot-task-side">
                                        {items.length > 0 && (
                                            <select
                                                className="wot-prod-select"
                                                value={linkedProduct || ''}
                                                disabled={busy}
                                                title="Na koji proizvod se zadatak odnosi"
                                                onChange={e => setProduct(task, e.target.value)}
                                            >
                                                <option value="">Cijeli nalog</option>
                                                {items.map(i => <option key={i.ID} value={i.Product_ID}>{i.Product_Name}</option>)}
                                            </select>
                                        )}
                                        <button
                                            className="wot-unlink"
                                            disabled={busy}
                                            onClick={() => unlink(task)}
                                            title="Skini s naloga (zadatak ostaje u Zadacima)"
                                            aria-label="Skini s naloga"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>

                                {isOpen && (
                                    <div className="wot-task-detail">
                                        {task.Description && <p className="wot-desc">{task.Description}</p>}
                                        <ChecklistEditor
                                            items={checklist}
                                            disabled={busy}
                                            onToggle={id => toggleChecklist(task, id)}
                                            onAdd={text => addChecklist(task, text)}
                                            onRemove={id => removeChecklist(task, id)}
                                        />
                                        {task.Notes && <p className="wot-notes"><strong>Napomena:</strong> {task.Notes}</p>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <TaskPickerModal
                isOpen={pickerOpen}
                onClose={() => setPickerOpen(false)}
                tasks={pickable}
                suggestedIds={suggestions.map(t => t.Task_ID)}
                onConfirm={linkExisting}
            />
        </div>
    );
}
