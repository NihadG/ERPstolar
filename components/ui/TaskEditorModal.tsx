'use client';

// ════════════════════════════════════════════════════════════════════
// MODAL: uređivač zadatka (kreiraj / uredi)
//
// Izdvojen iz ProjectOverviewScreen da ga uz pregled projekta može
// koristiti i Komandni centar — isti obrazac (naslov, hitnost, rok,
// kategorija, izvršilac, checklist) na oba mjesta, bez druge verzije.
// Veza na projekat se dodaje kod pozivaoca, ne ovdje.
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { LayoutDashboard, Trash2 } from 'lucide-react';
import type { ChecklistItem, Task, TaskChecklistGroup, TaskPriority, Worker } from '@/lib/types';
import { TASK_PRIORITY_LABELS } from '@/lib/types';
import Modal from './Modal';
import TaskChecklistEditor from './TaskChecklistEditor';
import './TaskEditorModal.css';

function dateOnly(iso?: string): string { return (iso || '').slice(0, 10); }

const TASK_CATEGORY_LABELS: Record<string, string> = {
    general: 'Općenito', manufacturing: 'Proizvodnja', ordering: 'Narudžba',
    installation: 'Montaža', design: 'Dizajn', meeting: 'Sastanak', reminder: 'Podsjetnik',
};
const PRIO_OPTIONS: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

export default function TaskEditorModal({ mode, task, projectName, workers, onClose, onSave, onDelete }: {
    mode: 'create' | 'edit'; task?: Task; projectName: string; workers: Worker[];
    onClose: () => void; onSave: (data: Partial<Task>) => Promise<void>; onDelete?: () => Promise<void>;
}) {
    const [title, setTitle] = useState(task?.Title || '');
    const [description, setDescription] = useState(task?.Description || '');
    const [priority, setPriority] = useState<TaskPriority>(task?.Priority || 'medium');
    const [category, setCategory] = useState<string>(task?.Category || 'general');
    const [dueDate, setDueDate] = useState<string>(dateOnly(task?.Due_Date));
    const [workerId, setWorkerId] = useState<string>(task?.Assigned_Worker_ID || '');
    const [checklist, setChecklist] = useState<ChecklistItem[]>(task?.Checklist ? task.Checklist.map(c => ({ ...c })) : []);
    const [checklistGroups, setChecklistGroups] = useState<TaskChecklistGroup[]>(task?.ChecklistGroups ? task.ChecklistGroups.map(group => ({ ...group })) : []);
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        if (!title.trim() || saving) return;
        setSaving(true);
        const worker = workers.find(w => w.Worker_ID === workerId);
        const data: Partial<Task> = {
            ...(task?.Task_ID ? { Task_ID: task.Task_ID } : {}),
            Title: title.trim(),
            Description: description.trim(),
            Priority: priority,
            Category: category as Task['Category'],
            Due_Date: dueDate || undefined,
            Assigned_Worker_ID: workerId || undefined,
            Assigned_Worker_Name: worker?.Name || undefined,
            Checklist: checklist,
            ChecklistGroups: checklistGroups,
            Links: task?.Links || [],
            ...(task?.Status ? { Status: task.Status } : { Status: 'pending' }),
        };
        try { await onSave(data); } finally { setSaving(false); }
    };

    const clDone = checklist.filter(c => c.completed).length;

    return (
        <Modal isOpen onClose={onClose} title={mode === 'create' ? 'Novi zadatak' : 'Uredi zadatak'} size="large"
            footer={<>
                {onDelete && <button className="btn btn-danger" onClick={onDelete} disabled={saving} style={{ marginRight: 'auto' }}><Trash2 size={15} /> Obriši</button>}
                <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Odustani</button>
                <button className="btn btn-primary" onClick={submit} disabled={saving || !title.trim()}>{saving ? 'Spremam…' : mode === 'create' ? 'Kreiraj zadatak' : 'Spremi'}</button>
            </>}>
            <div className="te">
                <div className="te-linkchip"><span className="te-link-ic"><LayoutDashboard size={13} /></span>Povezano s projektom <b>{projectName}</b></div>

                <label className="te-field">
                    <span className="te-label">Naslov</span>
                    <input className="te-input" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Šta treba uraditi?" />
                </label>

                <div className="te-row">
                    <div className="te-field">
                        <span className="te-label">Prioritet</span>
                        <div className="te-seg">
                            {PRIO_OPTIONS.map(p => (
                                <button key={p} className={`${priority === p ? 'on' : ''} p-${p}`} onClick={() => setPriority(p)}>{TASK_PRIORITY_LABELS[p]}</button>
                            ))}
                        </div>
                    </div>
                    <label className="te-field te-narrow">
                        <span className="te-label">Rok</span>
                        <input className="te-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                    </label>
                </div>

                <div className="te-row">
                    <label className="te-field">
                        <span className="te-label">Kategorija</span>
                        <select className="te-input" value={category} onChange={e => setCategory(e.target.value)}>
                            {Object.entries(TASK_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                    </label>
                    <label className="te-field">
                        <span className="te-label">Zaduženi radnik</span>
                        <select className="te-input" value={workerId} onChange={e => setWorkerId(e.target.value)}>
                            <option value="">— nitko —</option>
                            {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                        </select>
                    </label>
                </div>

                <label className="te-field">
                    <span className="te-label">Opis</span>
                    <textarea className="te-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Detalji (opcionalno)…" />
                </label>

                <div className="te-field">
                    <span className="te-label">Checklist {checklist.length > 0 && <span className="te-cl-cnt">{clDone}/{checklist.length}</span>}</span>
                    <TaskChecklistEditor
                        items={checklist}
                        groups={checklistGroups}
                        onChange={(nextItems, nextGroups) => {
                            setChecklist(nextItems);
                            setChecklistGroups(nextGroups);
                        }}
                    />
                </div>
            </div>
        </Modal>
    );
}
