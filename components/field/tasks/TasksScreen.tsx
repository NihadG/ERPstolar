'use client';

// ════════════════════════════════════════════════════════════════════
// ZADACI — kontrolorov ekran
//
// Kontrolor ovdje vidi CIJELU listu zadataka firme i vodi je kroz dan:
// šta gori, ko je na čemu, dokad, i koliko je urađeno. Isti jezik oblika kao
// ostatak pogonske aplikacije (MobileUI + .fat/.fod obrasci) — velike mete,
// boja lijeve ivice = hitnost, ništa što se ne može ispraviti drugim dodirom.
//
// Poredak i grupisanje su ono što listu čini preglednom: podrazumijevano „po
// hitnosti", uz filter (aktivni / prekoračeni / u toku / završeni). Prekoračeni
// dobiju vlastitu crvenu traku na vrhu — to je jedino što traži da se pogleda.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
    AlertTriangle, Calendar, ChevronDown, FolderOpen, HardHat,
    ListChecks, Package, Plus, ShoppingCart, User,
} from 'lucide-react';
import type { FieldTaskLink, FieldTaskRow } from '@/lib/field/fieldTasks';
import { useFieldTasks, type CreateFieldTaskInput } from '@/lib/field/useFieldTasks';
import {
    MLarge, MSearch, MChips, MEmpty, MButton, MSheet, MPill, MCheck, MSegmented,
    MList, MItem, MCell, MText, MOption,
} from '@/components/tabs/mobile/MobileUI';
import { haptic } from '@/components/tabs/mobile/useSwipe';
import {
    TASK_CATEGORIES, TASK_CATEGORY_LABELS, TASK_PRIORITIES, TASK_PRIORITY_LABELS,
} from '@/lib/types';
import type { Task, TaskCategory, TaskPriority } from '@/lib/types';
import './Tasks.css';

type Tone = 'red' | 'orange' | 'blue' | 'purple' | 'green' | 'gray';
type Filter = 'active' | 'overdue' | 'progress' | 'done' | 'all';
type GroupBy = 'priority' | 'due' | 'worker' | 'order' | 'none';

const PRIORITY_TONE: Record<string, Tone> = { urgent: 'red', high: 'orange', medium: 'blue', low: 'gray' };
const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

const GROUP_LABEL: Record<GroupBy, string> = {
    priority: 'Po hitnosti', due: 'Po roku', worker: 'Po radniku', order: 'Po nalogu', none: 'Bez grupe',
};

const DAY_MS = 86400000;
const daysBetween = (fromISO: string, toISO: string): number =>
    Math.round((new Date(toISO + 'T12:00:00').getTime() - new Date(fromISO + 'T12:00:00').getTime()) / DAY_MS);

const shortDate = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { day: 'numeric', month: 'short' });

const firstName = (name: string) => name.split(' ')[0] || name;

/** Rok kao ljudski natpis, s klasom za boju (prekoračeno crveno, blizu narandžasto). */
function dueInfo(t: FieldTaskRow, today: string): { text: string; cls: string } | null {
    if (!t.dueDate) return null;
    if (t.overdue) {
        const d = daysBetween(t.dueDate, today);
        return { text: d <= 0 ? 'kasni' : `kasni ${d} ${d === 1 ? 'dan' : 'dana'}`, cls: 'over' };
    }
    if (t.dueDate === today) return { text: 'danas', cls: 'soon' };
    const d = daysBetween(today, t.dueDate);
    if (d >= 1 && d <= 2) return { text: `za ${d} ${d === 1 ? 'dan' : 'dana'}`, cls: 'soon' };
    return { text: shortDate(t.dueDate), cls: '' };
}

/** Nalog/projekat na koji zadatak najprije upućuje — za chip na kartici i grupu „po nalogu". */
function primaryLink(t: FieldTaskRow): FieldTaskLink | null {
    return t.links.find(l => l.type === 'work_order')
        || t.links.find(l => l.type === 'project')
        || t.links[0] || null;
}

function LinkGlyph({ type, size = 12 }: { type: FieldTaskLink['type']; size?: number }) {
    if (type === 'project') return <FolderOpen size={size} />;
    if (type === 'work_order') return <HardHat size={size} />;
    if (type === 'order') return <ShoppingCart size={size} />;
    if (type === 'worker') return <User size={size} />;
    return <Package size={size} />;
}

interface Section { key: string; label: string; count: number; rows: FieldTaskRow[] }

function buildSections(rows: FieldTaskRow[], group: GroupBy, today: string): Section[] {
    const mk = (key: string, label: string, list: FieldTaskRow[]): Section =>
        ({ key, label, count: list.length, rows: list });

    if (group === 'none') return rows.length ? [mk('all', '', rows)] : [];

    if (group === 'priority') {
        return PRIORITY_ORDER
            .map(p => mk(p, TASK_PRIORITY_LABELS[p], rows.filter(t => t.priority === p)))
            .filter(s => s.count > 0);
    }

    if (group === 'due') {
        const overdue = rows.filter(t => t.overdue);
        const rest = rows.filter(t => !t.overdue);
        const today_ = rest.filter(t => t.dueDate === today);
        const week = rest.filter(t => t.dueDate && t.dueDate > today && daysBetween(today, t.dueDate) <= 7);
        const later = rest.filter(t => t.dueDate && daysBetween(today, t.dueDate) > 7);
        const none = rest.filter(t => !t.dueDate);
        return [
            mk('overdue', 'Prekoračeno', overdue),
            mk('today', 'Danas', today_),
            mk('week', 'Ova sedmica', week),
            mk('later', 'Kasnije', later),
            mk('none', 'Bez roka', none),
        ].filter(s => s.count > 0);
    }

    if (group === 'worker') {
        const byName = new Map<string, FieldTaskRow[]>();
        const none: FieldTaskRow[] = [];
        for (const t of rows) {
            if (t.assignedWorkerName) {
                const list = byName.get(t.assignedWorkerName) || [];
                list.push(t);
                byName.set(t.assignedWorkerName, list);
            } else none.push(t);
        }
        const out = Array.from(byName.entries())
            .sort((a, b) => a[0].localeCompare(b[0], 'bs'))
            .map(([name, list]) => mk(name, name, list));
        if (none.length) out.push(mk('__none', 'Nedodijeljeno', none));
        return out;
    }

    // group === 'order'
    const byLink = new Map<string, FieldTaskRow[]>();
    const none: FieldTaskRow[] = [];
    for (const t of rows) {
        const gl = t.links.find(l => l.type === 'work_order') || t.links.find(l => l.type === 'project');
        if (gl) {
            const list = byLink.get(gl.name) || [];
            list.push(t);
            byLink.set(gl.name, list);
        } else none.push(t);
    }
    const out = Array.from(byLink.entries())
        .sort((a, b) => a[0].localeCompare(b[0], 'bs'))
        .map(([name, list]) => mk(name, name, list));
    if (none.length) out.push(mk('__none', 'Bez veze', none));
    return out;
}

interface Props {
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    readOnly?: boolean;
}

export default function TasksScreen({ showToast, readOnly }: Props) {
    const {
        tasks, workers, today, loading, error, reload,
        toggleTask, setStatus, toggleChecklistItem, createTask,
    } = useFieldTasks();

    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<Filter>('active');
    const [group, setGroup] = useState<GroupBy>('priority');
    const [groupOpen, setGroupOpen] = useState(false);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const detail = useMemo(() => tasks.find(t => t.taskId === detailId) || null, [tasks, detailId]);

    const counts = useMemo(() => {
        let active = 0, overdue = 0, progress = 0, done = 0;
        for (const t of tasks) {
            if (t.status === 'completed') done++;
            else if (t.status !== 'cancelled') active++;
            if (t.overdue) overdue++;
            if (t.status === 'in_progress') progress++;
        }
        return { active, overdue, progress, done, total: tasks.length };
    }, [tasks]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return tasks.filter(t => {
            if (q
                && !t.title.toLowerCase().includes(q)
                && !t.description.toLowerCase().includes(q)
                && !(t.assignedWorkerName || '').toLowerCase().includes(q)
                && !t.links.some(l => l.name.toLowerCase().includes(q))) return false;
            switch (filter) {
                case 'active': return t.open;
                case 'overdue': return t.overdue;
                case 'progress': return t.status === 'in_progress';
                case 'done': return t.status === 'completed';
                default: return true;
            }
        });
    }, [tasks, search, filter]);

    const sections = useMemo(() => buildSections(filtered, group, today), [filtered, group, today]);

    const run = async (fn: () => Promise<void>, okMsg?: string) => {
        if (readOnly) return;
        setBusy(true);
        try { await fn(); if (okMsg) showToast(okMsg, 'success'); }
        catch (e: any) { showToast(e?.message || 'Radnja nije uspjela.', 'error'); }
        finally { setBusy(false); }
    };

    const toggleDone = (t: FieldTaskRow) => {
        haptic(6);
        const done = t.status === 'completed';
        run(() => toggleTask(t.taskId, !done), done ? 'Vraćeno u rad' : 'Zadatak završen');
    };

    const handleCreate = async (input: CreateFieldTaskInput): Promise<boolean> => {
        if (readOnly) return false;
        setBusy(true);
        try {
            await createTask(input);
            showToast('Zadatak dodan', 'success');
            return true;
        } catch (e: any) {
            showToast(e?.message || 'Zadatak nije sačuvan.', 'error');
            return false;
        } finally {
            setBusy(false);
        }
    };

    // ── Prikaz ───────────────────────────────────────────────────────
    return (
        <>
            <MLarge title="Zadaci">
                {counts.active} {counts.active === 1 ? 'aktivan' : 'aktivnih'}
                {counts.overdue > 0 && <span className="ftk-sub-over"> · {counts.overdue} prekoračeno</span>}
            </MLarge>

            {!readOnly && counts.overdue > 0 && filter !== 'overdue' && (
                <button type="button" className="ftk-alert" onClick={() => { haptic(5); setFilter('overdue'); }}>
                    <AlertTriangle size={19} />
                    <span><b>{counts.overdue}</b> {counts.overdue === 1 ? 'prekoračen zadatak' : 'prekoračenih zadataka'}</span>
                    <span className="ftk-alert-cta">Pogledaj</span>
                </button>
            )}

            <div className="fld-search">
                <MSearch value={search} onChange={setSearch} placeholder="Traži zadatak, radnika, nalog…" />
            </div>

            <MChips<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                    { id: 'active', label: 'Aktivni', count: counts.active },
                    { id: 'overdue', label: 'Prekoračeni', count: counts.overdue },
                    { id: 'progress', label: 'U toku', count: counts.progress },
                    { id: 'done', label: 'Završeni', count: counts.done },
                    { id: 'all', label: 'Svi', count: counts.total },
                ]}
            />

            <div className="ftk-toolbar">
                <span className="ftk-toolbar-n">
                    {filtered.length} {filtered.length === 1 ? 'zadatak' : 'zadataka'}
                </span>
                <button type="button" className="ftk-groupbtn" onClick={() => setGroupOpen(true)}>
                    {GROUP_LABEL[group]} <ChevronDown size={15} />
                </button>
            </div>

            {loading && tasks.length === 0 && <div className="fld-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Podaci nisu učitani" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={reload}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {!loading && !error && filtered.length === 0 && (
                <MEmpty
                    title={search || filter !== 'active' ? 'Nema rezultata' : 'Nema aktivnih zadataka'}
                    sub={search || filter !== 'active'
                        ? 'Promijeni pretragu ili filter.'
                        : 'Sve je čisto. Novi zadatak dodaješ dugmetom +.'}
                />
            )}

            <div className="ftk-sections">
                {sections.map(sec => (
                    <section key={sec.key} className="ftk-sec">
                        {sec.label && (
                            <div className="ftk-shd">
                                <span>{sec.label}</span>
                                <span className="ftk-shd-n">{sec.count}</span>
                            </div>
                        )}
                        <div className="ftk-list">
                            {sec.rows.map(t => {
                                const done = t.status === 'completed';
                                const tone = PRIORITY_TONE[t.priority] || 'gray';
                                const due = dueInfo(t, today);
                                const link = primaryLink(t);
                                return (
                                    <div key={t.taskId} className={`ftk-card ${tone}${done ? ' done' : ''}`}>
                                        <MCheck
                                            on={done}
                                            disabled={readOnly || busy}
                                            label={done ? 'Vrati u rad' : 'Označi završenim'}
                                            onClick={() => toggleDone(t)}
                                        />
                                        <button type="button" className="ftk-card-main" onClick={() => setDetailId(t.taskId)}>
                                            <span className="ftk-card-title">{t.title}</span>
                                            <span className="ftk-card-meta">
                                                <MPill tone={tone}>{TASK_PRIORITY_LABELS[t.priority]}</MPill>
                                                {t.status === 'in_progress' && <MPill tone="blue">U toku</MPill>}
                                                {due && <span className={`ftk-due ${due.cls}`}><Calendar size={12} /> {due.text}</span>}
                                                {t.assignedWorkerName && (
                                                    <span className="ftk-meta-i"><User size={12} /> {firstName(t.assignedWorkerName)}</span>
                                                )}
                                                {t.checklistTotal > 0 && (
                                                    <span className="ftk-meta-i"><ListChecks size={12} /> {t.checklistDone}/{t.checklistTotal}</span>
                                                )}
                                            </span>
                                            {link && (
                                                <span className={`ftk-link ${link.type}`}>
                                                    <LinkGlyph type={link.type} /> {link.name}
                                                </span>
                                            )}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>

            {!readOnly && (
                <button type="button" className="ftk-fab" onClick={() => setCreateOpen(true)} aria-label="Novi zadatak">
                    <Plus size={26} strokeWidth={2.4} />
                </button>
            )}

            {/* ── Grupisanje ──────────────────────────────────────────── */}
            <MSheet open={groupOpen} title="Grupiši zadatke" onClose={() => setGroupOpen(false)}>
                <MList>
                    {(Object.keys(GROUP_LABEL) as GroupBy[]).map(g => (
                        <MOption
                            key={g}
                            label={GROUP_LABEL[g]}
                            selected={group === g}
                            onClick={() => { setGroup(g); setGroupOpen(false); }}
                        />
                    ))}
                </MList>
            </MSheet>

            {/* ── Detalj ──────────────────────────────────────────────── */}
            <TaskDetailSheet
                task={detail}
                readOnly={readOnly}
                busy={busy}
                today={today}
                onClose={() => setDetailId(null)}
                onStatus={(status) => run(() => setStatus(detail!.taskId, status), 'Status promijenjen')}
                onToggleChecklist={(itemId) => run(() => toggleChecklistItem(detail!.taskId, itemId))}
            />

            {/* ── Novi zadatak ────────────────────────────────────────── */}
            {createOpen && (
                <CreateTaskSheet
                    workers={workers}
                    busy={busy}
                    onClose={() => setCreateOpen(false)}
                    onCreate={handleCreate}
                />
            )}
        </>
    );
}

// ════════════════════════════════════════════════════════════════════
// DETALJ ZADATKA
// ════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
    { id: 'pending', label: 'Na čekanju' },
    { id: 'in_progress', label: 'U toku' },
    { id: 'completed', label: 'Završeno' },
];

function TaskDetailSheet({
    task, readOnly, busy, today, onClose, onStatus, onToggleChecklist,
}: {
    task: FieldTaskRow | null;
    readOnly?: boolean;
    busy: boolean;
    today: string;
    onClose: () => void;
    onStatus: (status: Task['Status']) => void;
    onToggleChecklist: (itemId: string) => void;
}) {
    const due = task ? dueInfo(task, today) : null;
    const tone = task ? (PRIORITY_TONE[task.priority] || 'gray') : 'gray';

    return (
        <MSheet open={!!task} title={task?.title} onClose={onClose}>
            {task && (
                <>
                    <div className="ftk-d-chips">
                        <MPill tone={tone}>{TASK_PRIORITY_LABELS[task.priority]}</MPill>
                        <span className="ftk-d-chip">{TASK_CATEGORY_LABELS[task.category]}</span>
                        {due && <span className={`ftk-due ${due.cls}`}><Calendar size={12} /> {due.text}</span>}
                        {task.assignedWorkerName && (
                            <span className="ftk-d-chip"><User size={12} /> {task.assignedWorkerName}</span>
                        )}
                    </div>

                    {!readOnly && (
                        <>
                            <div className="mui-shd"><span>Status</span></div>
                            <MSegmented<string>
                                value={task.status}
                                options={STATUS_OPTIONS}
                                onChange={(s) => { if (s !== task.status) onStatus(s as Task['Status']); }}
                            />
                        </>
                    )}

                    {task.description && (
                        <>
                            <div className="mui-shd"><span>Opis</span></div>
                            <p className="ftk-d-text">{task.description}</p>
                        </>
                    )}

                    {task.notes && (
                        <>
                            <div className="mui-shd"><span>Napomena</span></div>
                            <p className="ftk-d-text">{task.notes}</p>
                        </>
                    )}

                    {task.links.length > 0 && (
                        <>
                            <div className="mui-shd"><span>Povezano</span></div>
                            <div className="ftk-d-links">
                                {task.links.map((l, i) => (
                                    <span key={i} className={`ftk-linkchip ${l.type}`}>
                                        <LinkGlyph type={l.type} /> {l.name}
                                    </span>
                                ))}
                            </div>
                        </>
                    )}

                    {task.checklist.length > 0 && (
                        <>
                            <div className="mui-shd">
                                <span>Checklist</span>
                                <span>{task.checklistDone}/{task.checklistTotal}</span>
                            </div>
                            <MList>
                                {task.checklist.map(c => (
                                    <MItem key={c.id}>
                                        <MCell done={c.completed}>
                                            <MCheck
                                                on={c.completed}
                                                small
                                                disabled={readOnly || busy}
                                                label={c.text}
                                                onClick={() => onToggleChecklist(c.id)}
                                            />
                                            <MText title={c.text} />
                                        </MCell>
                                    </MItem>
                                ))}
                            </MList>
                        </>
                    )}
                </>
            )}
        </MSheet>
    );
}

// ════════════════════════════════════════════════════════════════════
// NOVI ZADATAK
// ════════════════════════════════════════════════════════════════════

function CreateTaskSheet({
    workers, busy, onClose, onCreate,
}: {
    workers: { workerId: string; name: string }[];
    busy: boolean;
    onClose: () => void;
    onCreate: (input: CreateFieldTaskInput) => Promise<boolean>;
}) {
    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [category, setCategory] = useState<TaskCategory>('general');
    const [dueDate, setDueDate] = useState('');
    const [workerId, setWorkerId] = useState('');
    const [notes, setNotes] = useState('');

    const submit = async () => {
        if (!title.trim() || busy) return;
        const ok = await onCreate({
            title: title.trim(),
            priority,
            category,
            dueDate: dueDate || undefined,
            assignedWorkerId: workerId || undefined,
            notes: notes.trim() || undefined,
        });
        if (ok) onClose();
    };

    return (
        <MSheet open title="Novi zadatak" onClose={onClose}>
            <div className="ftk-field">
                <input
                    className="ftk-input"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Šta treba uraditi?"
                    autoFocus
                />
            </div>

            <div className="mui-shd"><span>Hitnost</span></div>
            <div className="ftk-pick">
                {TASK_PRIORITIES.map(p => (
                    <button
                        key={p}
                        type="button"
                        className={`mui-chip${priority === p ? ' on' : ''}`}
                        onClick={() => setPriority(p)}
                    >
                        {TASK_PRIORITY_LABELS[p]}
                    </button>
                ))}
            </div>

            <div className="mui-shd"><span>Rok i radnik</span></div>
            <div className="ftk-row2">
                <input
                    type="date"
                    className="ftk-select"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                />
                <select
                    className="ftk-select"
                    value={workerId}
                    onChange={e => setWorkerId(e.target.value)}
                >
                    <option value="">Bez radnika</option>
                    {workers.map(w => <option key={w.workerId} value={w.workerId}>{w.name}</option>)}
                </select>
            </div>

            <div className="mui-shd"><span>Kategorija</span></div>
            <select
                className="ftk-select ftk-select-full"
                value={category}
                onChange={e => setCategory(e.target.value as TaskCategory)}
            >
                {TASK_CATEGORIES.map(c => <option key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</option>)}
            </select>

            <div className="mui-shd"><span>Napomena</span></div>
            <textarea
                className="ftk-textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Nije obavezno…"
                rows={3}
            />

            <div className="fod-confirm-wrap">
                <button type="button" className="fbk-confirm" disabled={busy || !title.trim()} onClick={submit}>
                    {busy ? 'Šaljem…' : 'Dodaj zadatak'}
                </button>
            </div>
        </MSheet>
    );
}
