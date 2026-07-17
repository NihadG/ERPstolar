'use client';

// ════════════════════════════════════════════════════════════════════
// ZADACI PRI KREIRANJU NALOGA — kontrolisana komponenta (bez upisa u bazu).
//
// Nalog još ne postoji, pa se izbor samo SKUPLJA (TaskAttachSelection), a
// pozivalac ga preda attachTasksToWorkOrder tek kad nalog nastane. Isti
// prizor u oba wizarda (proizvodnja/montaža i „Razni poslovi").
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { Plus, X, Link2, ListTodo, ListChecks } from 'lucide-react';
import TaskPickerModal from './TaskPickerModal';
import ChecklistEditor from './ChecklistEditor';
import PrioritySelect from './PrioritySelect';
import {
    taskSelectionCount,
    type TaskAttachSelection, type TaskDraft,
} from '@/lib/workOrderTasks';
import {
    TASK_PRIORITY_LABELS, TASK_CATEGORY_LABELS, TASK_CATEGORIES,
    type Task, type TaskCategory, type Worker,
} from '@/lib/types';
import './TaskAttachEditor.css';

interface TaskAttachEditorProps {
    value: TaskAttachSelection;
    onChange: (next: TaskAttachSelection) => void;
    /** Svi zadaci organizacije — izvor za „Poveži postojeći". */
    tasks: Task[];
    workers: Worker[];
    /** Proizvodi budućeg naloga (za vezu zadatak→proizvod). */
    products: { Product_ID: string; Product_Name: string }[];
    /** Task_ID-evi koje treba istaknuti u izborniku (vezani za te proizvode). */
    suggestedIds?: string[];
    /** Modal se otvara iznad wizarda — mora imati veći z-index. */
    pickerZIndex?: number;
}

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random()}`);

const newDraft = (): TaskDraft => ({ id: uid(), Title: '', Priority: 'medium', Category: 'general' });

export default function TaskAttachEditor({
    value, onChange, tasks, workers, products, suggestedIds = [], pickerZIndex,
}: TaskAttachEditorProps) {
    const [pickerOpen, setPickerOpen] = useState(false);

    const byId = useMemo(() => new Map(tasks.map(t => [t.Task_ID, t])), [tasks]);
    const pickable = useMemo(
        () => tasks.filter(t => !value.existingTaskIds.includes(t.Task_ID)),
        [tasks, value.existingTaskIds]
    );
    const count = taskSelectionCount(value);

    const addDrafts = () => onChange({ ...value, newTasks: [...value.newTasks, newDraft()] });
    const patchDraft = (id: string, patch: Partial<TaskDraft>) =>
        onChange({ ...value, newTasks: value.newTasks.map(d => d.id === id ? { ...d, ...patch } : d) });
    const removeDraft = (id: string) =>
        onChange({ ...value, newTasks: value.newTasks.filter(d => d.id !== id) });
    const removeExisting = (id: string) =>
        onChange({ ...value, existingTaskIds: value.existingTaskIds.filter(t => t !== id) });
    const addExisting = (ids: string[]) =>
        onChange({ ...value, existingTaskIds: Array.from(new Set([...value.existingTaskIds, ...ids])) });

    return (
        <div className="tae">
            <div className="tae-head">
                <span className="tae-head-title"><ListTodo size={15} /> Zadaci <em>(opciono)</em></span>
                {count > 0 && <span className="tae-count">{count}</span>}
                <div className="tae-head-actions">
                    <button type="button" className="tae-btn" onClick={() => setPickerOpen(true)}>
                        <Link2 size={14} /> Poveži postojeći
                    </button>
                    <button type="button" className="tae-btn" onClick={addDrafts}>
                        <Plus size={14} /> Novi zadatak
                    </button>
                </div>
            </div>

            {count === 0 ? (
                <p className="tae-hint">
                    Zadaci koji idu uz nalog (npr. „Napraviti raspored umivaonika", „Dogovoriti prevoz").
                    Vide se u tabu Zadaci i na kartici naloga, i mogu se odštampati zajedno s nalogom.
                    Možeš ih dodati i kasnije.
                </p>
            ) : (
                <div className="tae-list">
                    {/* Postojeći — samo prikaz; uređuju se u tabu Zadaci */}
                    {value.existingTaskIds.map(id => {
                        const t = byId.get(id);
                        if (!t) return null;
                        return (
                            <div className="tae-existing" key={id}>
                                <Link2 size={13} className="tae-existing-icon" />
                                <span className="tae-existing-title">{t.Title}</span>
                                {(t.Checklist?.length || 0) > 0 && (
                                    <span className="tae-existing-steps" title={`${t.Checklist!.length} koraka`}>
                                        <ListChecks size={11} /> {t.Checklist!.length}
                                    </span>
                                )}
                                <span className={`tae-prio p-${t.Priority}`}>{TASK_PRIORITY_LABELS[t.Priority]}</span>
                                {t.Due_Date && (
                                    <span className="tae-existing-due">
                                        {new Date(t.Due_Date).toLocaleDateString('bs-BA', { day: '2-digit', month: '2-digit' })}
                                    </span>
                                )}
                                <button type="button" className="tae-remove" onClick={() => removeExisting(id)} aria-label="Ukloni">
                                    <X size={14} />
                                </button>
                            </div>
                        );
                    })}

                    {/* Novi — pune se ovdje */}
                    {value.newTasks.map((d, idx) => (
                        <div className="tae-draft" key={d.id}>
                            <div className="tae-draft-top">
                                <span className="tae-num">{idx + 1}</span>
                                <input
                                    className="tae-title"
                                    placeholder="Šta treba uraditi?"
                                    value={d.Title}
                                    onChange={e => patchDraft(d.id, { Title: e.target.value })}
                                />
                                <button type="button" className="tae-remove" onClick={() => removeDraft(d.id)} aria-label="Ukloni zadatak">
                                    <X size={16} />
                                </button>
                            </div>
                            <label className="tae-draft-priority">
                                <span>Prioritet</span>
                                <PrioritySelect value={d.Priority} onChange={p => patchDraft(d.id, { Priority: p })} />
                            </label>

                            <div className="tae-draft-fields">
                                <label>
                                    <span>Kategorija</span>
                                    <select value={d.Category} onChange={e => patchDraft(d.id, { Category: e.target.value as TaskCategory })}>
                                        {TASK_CATEGORIES.map(c => <option key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</option>)}
                                    </select>
                                </label>
                                <label>
                                    <span>Rok</span>
                                    <input type="date" value={d.Due_Date || ''} onChange={e => patchDraft(d.id, { Due_Date: e.target.value || undefined })} />
                                </label>
                                {products.length > 0 && (
                                    <label>
                                        <span>Proizvod</span>
                                        <select value={d.productId || ''} onChange={e => patchDraft(d.id, { productId: e.target.value || undefined })}>
                                            <option value="">Cijeli nalog</option>
                                            {products.map(p => <option key={p.Product_ID} value={p.Product_ID}>{p.Product_Name}</option>)}
                                        </select>
                                    </label>
                                )}
                                <label>
                                    <span>Radnik</span>
                                    <select value={d.Assigned_Worker_ID || ''} onChange={e => patchDraft(d.id, { Assigned_Worker_ID: e.target.value || undefined })}>
                                        <option value="">Bez zaduženja</option>
                                        {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                    </select>
                                </label>
                            </div>

                            {/* Koraci — bez štikliranja: zadatak još ne postoji, nema šta biti urađeno */}
                            <div className="tae-draft-checklist">
                                <ChecklistEditor
                                    items={(d.checklist || []).map((text, i) => ({ id: `${d.id}-${i}`, text, completed: false }))}
                                    onAdd={text => patchDraft(d.id, { checklist: [...(d.checklist || []), text] })}
                                    onRemove={id => {
                                        const idx = Number(id.slice(d.id.length + 1));
                                        patchDraft(d.id, { checklist: (d.checklist || []).filter((_, i) => i !== idx) });
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <TaskPickerModal
                isOpen={pickerOpen}
                onClose={() => setPickerOpen(false)}
                tasks={pickable}
                suggestedIds={suggestedIds}
                onConfirm={addExisting}
                zIndex={pickerZIndex}
            />
        </div>
    );
}
