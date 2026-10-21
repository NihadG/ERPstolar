'use client';

// ════════════════════════════════════════════════════════════════════
// NOVI / UREDI ZADATAK — mobilni (full-screen forma)
//
// Jedan ekran odozgo nadolje umjesto skrivenih tabova starog modala:
// šta → kad i ko → kontrolna lista → veze → napomena. Rok, radnik i
// hitnost su odmah vidljivi (u starom modalu bili su ispod preklopa).
//
// Grupe kontrolne liste se ovdje ne uređuju (desktop), ali se čuvaju:
// stavke zadržavaju svoj groupId, nove idu u „bez grupe".
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import type {
    Task, TaskLink, TaskPriority, TaskCategory, ChecklistItem, TaskChecklistGroup,
    Project, Worker, Material, WorkOrder, Order,
} from '@/lib/types';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_CATEGORIES, TASK_CATEGORY_LABELS, TASK_STATUS_LABELS } from '@/lib/types';
import { generateUUID } from '@/lib/services';
import VoiceInput, { type ExtractedTaskData } from '@/components/VoiceInput';
import { buildVoiceContext } from '@/lib/voice/context';
import { applyVoiceResult, EMPTY_VOICE_APPLIED, type VoiceApplied } from '@/lib/voice/apply';
import {
    MSegmented, MSection, MList, MItem, MCell, MText, MCheck, MSheet, MIcon, MSearch, MChips, MEmpty,
} from './MobileUI';
import { useOverlayGuard } from './overlayGuard';
import { LINK_META } from './MobileTaskDetail';
import './MobileUI.css';
import './MobileWorkOrderDetail.css';
import './MobileTasks.css';

type LinkType = TaskLink['Entity_Type'];
const LINK_TYPES: LinkType[] = ['project', 'product', 'work_order', 'order', 'material', 'worker'];

interface Props {
    /** null = novi zadatak */
    task: Task | null;
    projects: Project[];
    workers: Worker[];
    materials: Material[];
    workOrders: WorkOrder[];
    orders: Order[];
    onSave: (task: Partial<Task>) => Promise<boolean>;
    onClose: () => void;
}

/** Textarea koja raste sa sadržajem — bez unutrašnjeg skrolanja na telefonu. */
function AutoTextarea({ value, onChange, placeholder, minRows = 2 }: {
    value: string; onChange: (v: string) => void; placeholder?: string; minRows?: number;
}) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
        <textarea ref={ref} className="mt-ta" rows={minRows} value={value} placeholder={placeholder}
            style={{ minHeight: minRows * 23 }} onChange={e => onChange(e.target.value)} />
    );
}

export default function MobileTaskEditor({ task, projects, workers, materials, workOrders, orders, onSave, onClose }: Props) {
    const isEdit = !!task;
    const [title, setTitle] = useState(task?.Title || '');
    const [description, setDescription] = useState(task?.Description || '');
    const [priority, setPriority] = useState<TaskPriority>(task?.Priority || 'medium');
    const [category, setCategory] = useState<TaskCategory>(task?.Category || 'general');
    const [status, setStatus] = useState<Task['Status']>(task?.Status || 'pending');
    const [dueDate, setDueDate] = useState(task?.Due_Date ? task.Due_Date.split('T')[0] : '');
    const [workerId, setWorkerId] = useState(task?.Assigned_Worker_ID || '');
    const [notes, setNotes] = useState(task?.Notes || '');
    const [links, setLinks] = useState<TaskLink[]>(task?.Links || []);
    const [checklist, setChecklist] = useState<ChecklistItem[]>(task?.Checklist || []);
    const [groups] = useState<TaskChecklistGroup[]>(task?.ChecklistGroups || []);
    const [newItem, setNewItem] = useState('');
    const [linkSheet, setLinkSheet] = useState(false);
    const [linkType, setLinkType] = useState<LinkType>('project');
    const [linkSearch, setLinkSearch] = useState('');
    const [saving, setSaving] = useState(false);

    // Radnik iz starih zadataka (samo ime, bez ID-ja) ostaje prikazan dok se ne promijeni.
    const legacyWorkerName = !task?.Assigned_Worker_ID ? task?.Assigned_Worker_Name : undefined;

    // Isti dogovor s historijom kao detalj: nazad zatvara samo ovaj ekran.
    useEffect(() => {
        // Bez dvostrukog unosa kad React (strict mode) efekat pokrene dvaput.
        if (!window.history.state?.moTaskEditor) window.history.pushState({ moTaskEditor: true }, '');
        const onPop = (e: PopStateEvent) => { if (!e.state?.moTaskEditor) onClose(); };
        window.addEventListener('popstate', onPop);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('popstate', onPop);
            document.body.style.overflow = prev;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const goBack = () => window.history.back();
    useOverlayGuard(true);

    const entities = useMemo(() => {
        switch (linkType) {
            case 'project': return projects.map(p => ({ id: p.Project_ID, name: p.Name || p.Client_Name, info: p.Name ? p.Client_Name : p.Address }));
            case 'product': return projects.flatMap(p => (p.products || []).map(pr => ({ id: pr.Product_ID, name: pr.Name, info: p.Name || p.Client_Name })));
            case 'work_order': return workOrders.map(w => ({ id: w.Work_Order_ID, name: w.Work_Order_Number || w.Name || 'Nalog', info: w.Status }));
            case 'order': return orders.map(o => ({ id: o.Order_ID, name: o.Order_Number, info: o.Supplier_Name }));
            case 'material': return materials.map(m => ({ id: m.Material_ID, name: m.Name, info: m.Category }));
            case 'worker': return workers.map(w => ({ id: w.Worker_ID, name: w.Name, info: w.Role }));
            default: return [];
        }
    }, [linkType, projects, workOrders, orders, materials, workers]);

    const linkResults = useMemo(() => {
        const taken = new Set(links.filter(l => l.Entity_Type === linkType).map(l => l.Entity_ID));
        const q = linkSearch.trim().toLowerCase();
        return entities
            .filter(e => !taken.has(e.id))
            .filter(e => !q || e.name?.toLowerCase().includes(q) || e.info?.toLowerCase().includes(q))
            .slice(0, 40);
    }, [entities, links, linkType, linkSearch]);

    const addItem = () => {
        const text = newItem.trim();
        if (!text) return;
        setChecklist(prev => [...prev, { id: generateUUID(), text, completed: false }]);
        setNewItem('');
    };

    const voiceContext = useMemo(() => buildVoiceContext(projects, workers, orders), [projects, workers, orders]);
    const voiceAppliedRef = useRef<VoiceApplied>(EMPTY_VOICE_APPLIED);

    // Ponovljen/ispravljen diktat zamjenjuje ono što je upisao prethodni (ne dopisuje).
    const handleVoice = (data: ExtractedTaskData) => {
        const p = data.suggestedProjectId ? projects.find(x => x.Project_ID === data.suggestedProjectId) : undefined;
        const { form, applied } = applyVoiceResult(
            { title, description, priority, category, dueDate, workerId, checklist, links },
            voiceAppliedRef.current,
            data,
            p ? { id: p.Project_ID, name: p.Name || p.Client_Name } : null,
            generateUUID,
        );
        voiceAppliedRef.current = applied;
        setTitle(form.title);
        setDescription(form.description);
        setPriority(form.priority);
        setCategory(form.category);
        setDueDate(form.dueDate);
        setWorkerId(form.workerId);
        setChecklist(form.checklist);
        setLinks(form.links);
    };

    const submit = async () => {
        if (!title.trim() || saving) return;
        // Stavka upisana a nije potvrđena s „Dodaj" ne smije se izgubiti.
        const pending = newItem.trim();
        const finalChecklist = pending ? [...checklist, { id: generateUUID(), text: pending, completed: false }] : checklist;
        const worker = workers.find(w => w.Worker_ID === workerId);
        setSaving(true);
        const ok = await onSave({
            Task_ID: task?.Task_ID,
            Title: title.trim(),
            Description: description.trim(),
            Priority: priority,
            Category: category,
            Status: status,
            Due_Date: dueDate || undefined,
            Assigned_Worker_ID: worker ? worker.Worker_ID : undefined,
            Assigned_Worker_Name: worker ? worker.Name : (workerId === '' && legacyWorkerName ? legacyWorkerName : undefined),
            Notes: notes.trim() || undefined,
            Links: links,
            Checklist: finalChecklist,
            ChecklistGroups: groups,
        });
        setSaving(false);
        if (ok) goBack();
    };

    const groupName = (id?: string) => (id ? groups.find(g => g.id === id)?.name : undefined);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="mui mwd mt-ed">
            <header className="mwd-nav mt-ed-nav">
                <button type="button" className="mwd-back" onClick={goBack}>Odustani</button>
                <h2>{isEdit ? 'Uredi zadatak' : 'Novi zadatak'}</h2>
                <button type="button" className="mwd-back mt-ed-save" onClick={submit} disabled={!title.trim() || saving}>
                    {saving ? 'Čuvam…' : 'Sačuvaj'}
                </button>
            </header>

            <div className="mwd-body">
                <MList>
                    <MItem><MCell>
                        <input className="mt-in title" value={title} onChange={e => setTitle(e.target.value)}
                            placeholder="Šta treba uraditi?" autoFocus={!isEdit} enterKeyHint="next" />
                    </MCell></MItem>
                    <MItem><MCell>
                        <AutoTextarea value={description} onChange={setDescription} placeholder="Opis (nije obavezno)" />
                    </MCell></MItem>
                </MList>

                {!isEdit && (
                    <div className="mt-voice">
                        <VoiceInput onResult={handleVoice} context={voiceContext} layout="inline" />
                        <small>ili izdiktiraj zadatak — šta, za koga, ko i do kada</small>
                    </div>
                )}

                <MSection title="Hitnost" />
                <MSegmented<TaskPriority>
                    value={priority}
                    onChange={setPriority}
                    options={TASK_PRIORITIES.map(p => ({ id: p, label: TASK_PRIORITY_LABELS[p] }))}
                />

                <MSection title="Kad i ko" />
                <MList>
                    <MItem>
                        <div className="mui-field">
                            <label htmlFor="mt-due">Rok</label>
                            <input id="mt-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                            {dueDate && <button type="button" className="mt-x" onClick={() => setDueDate('')} aria-label="Ukloni rok"><X size={16} /></button>}
                        </div>
                    </MItem>
                    <MItem>
                        <div className="mui-field">
                            <label htmlFor="mt-worker">Radnik</label>
                            <select id="mt-worker" value={workerId} onChange={e => setWorkerId(e.target.value)}>
                                <option value="">{legacyWorkerName || 'Nedodijeljeno'}</option>
                                {workers.map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                            </select>
                        </div>
                    </MItem>
                    <MItem>
                        <div className="mui-field">
                            <label htmlFor="mt-cat">Kategorija</label>
                            <select id="mt-cat" value={category} onChange={e => setCategory(e.target.value as TaskCategory)}>
                                {TASK_CATEGORIES.map(c => <option key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</option>)}
                            </select>
                        </div>
                    </MItem>
                    {isEdit && (
                        <MItem>
                            <div className="mui-field">
                                <label htmlFor="mt-status">Status</label>
                                <select id="mt-status" value={status} onChange={e => setStatus(e.target.value as Task['Status'])}>
                                    {(['pending', 'in_progress', 'completed', 'cancelled'] as const).map(s => (
                                        <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                                    ))}
                                </select>
                            </div>
                        </MItem>
                    )}
                </MList>

                <MSection title="Kontrolna lista" right={checklist.length > 0 ? <span className="mui-dim">{checklist.filter(c => c.completed).length}/{checklist.length}</span> : undefined} />
                <MList>
                    {checklist.map(item => (
                        <MItem key={item.id}>
                            <div className={`mui-cell mt-cl-item${item.completed ? ' done' : ''}`}>
                                <MCheck small on={item.completed} label={item.text}
                                    onClick={() => setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, completed: !c.completed } : c))} />
                                <input className="mt-in" value={item.text} aria-label="Stavka"
                                    onChange={e => setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, text: e.target.value } : c))} />
                                {groupName(item.groupId) && <span className="mui-dim" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{groupName(item.groupId)}</span>}
                                <button type="button" className="mt-x" aria-label={`Ukloni ${item.text}`}
                                    onClick={() => setChecklist(prev => prev.filter(c => c.id !== item.id))}><X size={16} /></button>
                            </div>
                        </MItem>
                    ))}
                    <MItem>
                        <div className="mui-cell mt-add">
                            <Plus size={20} style={{ flex: '0 0 auto' }} />
                            <input className="mt-in" value={newItem} placeholder="Dodaj stavku"
                                onChange={e => setNewItem(e.target.value)} enterKeyHint="done"
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
                            <button type="button" className="mt-addbtn" onClick={addItem} disabled={!newItem.trim()}>Dodaj</button>
                        </div>
                    </MItem>
                </MList>

                <MSection title="Povezano" />
                <MList lead>
                    {links.map((l, i) => {
                        const m = LINK_META[l.Entity_Type] || LINK_META.project;
                        return (
                            <MItem key={`${l.Entity_Type}:${l.Entity_ID}:${i}`}>
                                <MCell>
                                    <MIcon tone={m.tone === 'gray' ? undefined : m.tone}><m.Icon size={18} /></MIcon>
                                    <MText title={l.Entity_Name || '—'} sub={m.label} />
                                    <button type="button" className="mt-x" aria-label={`Ukloni ${l.Entity_Name}`}
                                        onClick={() => setLinks(prev => prev.filter((_, j) => j !== i))}><X size={16} /></button>
                                </MCell>
                            </MItem>
                        );
                    })}
                    <MItem>
                        <MCell onClick={() => { setLinkSearch(''); setLinkSheet(true); }}>
                            <MIcon tone="blue"><Plus size={20} /></MIcon>
                            <span className="mui-ctitle" style={{ color: 'var(--mui-blue)' }}>Poveži s projektom, nalogom…</span>
                        </MCell>
                    </MItem>
                </MList>

                <MSection title="Napomena" />
                <MList>
                    <MItem><MCell>
                        <AutoTextarea value={notes} onChange={setNotes} placeholder="Interna napomena" />
                    </MCell></MItem>
                </MList>
            </div>

            <MSheet open={linkSheet} title="Poveži zadatak" onClose={() => setLinkSheet(false)}>
                <MChips<LinkType>
                    value={linkType}
                    onChange={(t) => { setLinkType(t); setLinkSearch(''); }}
                    options={LINK_TYPES.map(t => ({ id: t, label: LINK_META[t].label }))}
                />
                <div className="mt-sheet-search">
                    <MSearch value={linkSearch} onChange={setLinkSearch} placeholder={`Traži: ${LINK_META[linkType].label.toLowerCase()}…`} />
                </div>
                {linkResults.length === 0 ? (
                    <MEmpty title="Nema rezultata" sub={linkSearch ? 'Promijeni pretragu.' : 'Nema stavki ove vrste.'} />
                ) : (
                    <MList>
                        {linkResults.map(e => (
                            <MItem key={e.id}>
                                <MCell onClick={() => {
                                    setLinks(prev => [...prev, { Entity_Type: linkType, Entity_ID: e.id, Entity_Name: e.name || '' }]);
                                    setLinkSheet(false);
                                }}>
                                    <MText title={e.name || '—'} sub={e.info || undefined} />
                                    <Plus size={18} color="var(--mui-blue)" style={{ flex: '0 0 auto' }} />
                                </MCell>
                            </MItem>
                        ))}
                    </MList>
                )}
            </MSheet>
        </div>,
        document.body
    );
}
