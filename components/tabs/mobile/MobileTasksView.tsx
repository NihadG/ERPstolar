'use client';

// ════════════════════════════════════════════════════════════════════
// ZADACI — mobilni prikaz (lista)
//
// Isti kartični jezik kao Ponude/Narudžbe/Nalozi. Pitanje na koje lista
// odgovara je „šta je sljedeće i šta kasni", pa je podrazumijevano
// grupisanje po roku, a rok stoji desno na svakoj kartici.
//
// Kvačica na kartici zatvara zadatak bez otvaranja; dodir na karticu
// otvara detalj (status, kontrolna lista, uređivanje, brisanje).
//
// Upis ide kroz callbackove (MobileTasksTab ih veže na servise), pa
// preview ruta isti ekran vozi nad lokalnim stanjem.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Plus, Layers, FolderOpen, X, Users } from 'lucide-react';
import type { Task, TaskProfile, Project, Worker, Material, WorkOrder, Order } from '@/lib/types';
import { TASK_PRIORITY_LABELS } from '@/lib/types';
import {
    MLarge, MSearch, MChips, MSection, MCardHead, MCardBody, MCheck, MPill, MProgress,
    MEmpty, MButton, MSheet, MList, MOption,
} from './MobileUI';
import { useMobileGrouping } from './useMobileGrouping';
import MobileTaskDetail from './MobileTaskDetail';
import MobileTaskEditor from './MobileTaskEditor';
import {
    TASK_FILTERS, TASK_GROUPINGS, countFilters, dueLabel, groupTasks, isOpen, localISO,
    matchesFilter, searchTasks, sortTasks, taskProjectId,
    type TaskFilter, type TaskGroupBy,
} from './taskListModel';
import './MobileUI.css';
import './MobileTasks.css';

export interface MobileTasksActions {
    /** Kreira (bez Task_ID) ili snima zadatak; true = uspjelo, editor se zatvara. */
    onSave: (task: Partial<Task>) => Promise<boolean>;
    onDelete: (taskId: string) => void;
    onStatus: (taskId: string, status: Task['Status']) => void;
    onToggleChecklist: (taskId: string, itemId: string) => void;
}

export interface MobileTasksViewProps extends MobileTasksActions {
    tasks: Task[];
    projects: Project[];
    workers: Worker[];
    materials: Material[];
    workOrders?: WorkOrder[];
    orders?: Order[];
    taskProfiles?: TaskProfile[];
    projectFilter?: string | null;
    onClearFilter?: () => void;
    /** Dan za koji se računaju rokovi (preview ga fiksira); podrazumijevano danas. */
    today?: string;
}

const ALL_PROFILES = '__all__';

export const priorityTone = (p: Task['Priority']) => p === 'urgent' ? 'red' : p === 'high' ? 'orange' : 'gray';

export default function MobileTasksView({
    tasks, projects, workers, materials, workOrders = [], orders = [], taskProfiles = [],
    projectFilter, onClearFilter, onSave, onDelete, onStatus, onToggleChecklist, today: todayProp,
}: MobileTasksViewProps) {
    const today = todayProp || localISO();
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<TaskFilter>('open');
    const [savedGroupBy, setGroupBy] = useMobileGrouping<TaskGroupBy>('zadaci', 'due');
    const groupBy: TaskGroupBy = TASK_GROUPINGS.some(g => g.id === savedGroupBy) ? savedGroupBy : 'due';
    const [profileId, setProfileId] = useState(ALL_PROFILES);
    const [sheet, setSheet] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    // undefined = zatvoreno, null = novi zadatak, Task = uređivanje
    const [editing, setEditing] = useState<Task | null | undefined>(undefined);

    // Opseg (profil + projekat) — brojevi na čipovima se računaju unutar njega.
    const scoped = useMemo(() => tasks.filter(t =>
        (profileId === ALL_PROFILES || t.Profile_ID === profileId)
        && (!projectFilter || taskProjectId(t, projects) === projectFilter)
    ), [tasks, profileId, projectFilter, projects]);

    const counts = useMemo(() => countFilters(scoped, today), [scoped, today]);

    const visible = useMemo(() => sortTasks(
        searchTasks(scoped, search).filter(t => matchesFilter(t, filter, today)), today,
    ), [scoped, search, filter, today]);

    const groups = useMemo(() => groupTasks(visible, groupBy, today, projects), [visible, groupBy, today, projects]);

    const openTask = openId ? tasks.find(t => t.Task_ID === openId) || null : null;
    const filterProject = projectFilter ? projects.find(p => p.Project_ID === projectFilter) : null;
    const profileName = profileId === ALL_PROFILES ? null : taskProfiles.find(p => p.Profile_ID === profileId)?.Name;

    const save = async (data: Partial<Task>) => {
        // Novi zadatak ulazi u profil koji je trenutno izabran (isto kao desktop).
        if (!data.Task_ID) data.Profile_ID = profileId === ALL_PROFILES ? '' : profileId;
        // Zadatak napravljen iz filtera projekta odmah nosi vezu na taj projekat.
        if (!data.Task_ID && filterProject && !(data.Links || []).some(l => l.Entity_ID === filterProject.Project_ID)) {
            data.Links = [...(data.Links || []), {
                Entity_Type: 'project', Entity_ID: filterProject.Project_ID,
                Entity_Name: filterProject.Name || filterProject.Client_Name,
            }];
        }
        return onSave(data);
    };

    const renderCard = (t: Task) => {
        const done = !isOpen(t);
        const due = dueLabel(t, today);
        const cl = t.Checklist || [];
        const clDone = cl.filter(c => c.completed).length;
        const link = t.Links?.find(l => l.Entity_Type === 'project') || t.Links?.[0];
        const metaText = [t.Assigned_Worker_Name, link?.Entity_Name].filter(Boolean).join(' · ');

        return (
            <div key={t.Task_ID} className={`mui-ecard mt-card${done ? ' done' : ''}`} onClick={() => setOpenId(t.Task_ID)}>
                <MCardHead>
                    <MCheck
                        on={t.Status === 'completed'}
                        label={t.Status === 'completed' ? 'Vrati u rad' : 'Označi kao završeno'}
                        onClick={() => onStatus(t.Task_ID, t.Status === 'completed' ? 'pending' : 'completed')}
                    />
                    <MCardBody
                        name={t.Title}
                        meta={(t.Status === 'in_progress' || t.Status === 'cancelled' || (!done && (t.Priority === 'urgent' || t.Priority === 'high')) || metaText) ? <>
                            {t.Status === 'in_progress' && <MPill tone="blue">U toku</MPill>}
                            {t.Status === 'cancelled' && <MPill>Otkazano</MPill>}
                            {!done && (t.Priority === 'urgent' || t.Priority === 'high') && (
                                <MPill tone={priorityTone(t.Priority)}>{TASK_PRIORITY_LABELS[t.Priority]}</MPill>
                            )}
                            {metaText && <span className="mt-meta-txt">{metaText}</span>}
                        </> : undefined}
                    />
                    {due && <span className={`mt-due ${due.tone}`}>{due.text}</span>}
                </MCardHead>
                {cl.length > 0 && !done && (
                    <MProgress foot pct={(clDone / cl.length) * 100} tone={clDone === cl.length ? 'green' : undefined}
                        label={<><b>{clDone}</b>/{cl.length}</>} />
                )}
            </div>
        );
    };

    const emptyText = search ? 'Nema zadataka za ovu pretragu.'
        : filter === 'late' ? 'Ništa ne kasni.'
            : filter === 'done' ? 'Još nema završenih zadataka.'
                : filter === 'in_progress' ? 'Nijedan zadatak nije u toku.'
                    : 'Dodaj prvi zadatak.';

    return (
        <div className="mui">
            <MLarge title="Zadaci">
                <span>{counts.open} {counts.open === 1 ? 'otvoren' : 'otvorenih'}</span>
                {counts.late > 0 && <span style={{ color: 'var(--mui-red-t)', fontWeight: 590 }}>· {counts.late} kasni</span>}
            </MLarge>

            {filterProject && (
                <div className="mt-filter">
                    <FolderOpen size={16} />
                    <span>{filterProject.Name || filterProject.Client_Name}</span>
                    {onClearFilter && <button type="button" onClick={onClearFilter} aria-label="Ukloni filter projekta"><X size={16} /></button>}
                </div>
            )}

            <div className="mui-stack mui-gap10" style={{ paddingBottom: 10 }}>
                <MSearch value={search} onChange={setSearch} placeholder="Traži zadatak, radnika, projekat…" />
                <div className="mt-toolbar">
                    <button type="button" className="mui-chip" onClick={() => setSheet(true)}>
                        <Layers size={13} />
                        <span>{TASK_GROUPINGS.find(g => g.id === groupBy)?.label}</span>
                    </button>
                    {taskProfiles.length > 0 && (
                        <button type="button" className={`mui-chip${profileName ? ' on' : ''}`} onClick={() => setSheet(true)}>
                            <Users size={13} />
                            <span>{profileName || 'Svi profili'}</span>
                        </button>
                    )}
                    <div className="mui-spacer" />
                    <button type="button" className="mui-chip on" onClick={() => setEditing(null)}>
                        <Plus size={14} />Novi
                    </button>
                </div>
            </div>

            <MChips
                value={filter}
                onChange={setFilter}
                options={TASK_FILTERS.map(f => ({ id: f.id, label: f.label, count: counts[f.id] }))}
            />

            {visible.length === 0 ? (
                <MEmpty title="Nema zadataka" sub={emptyText}>
                    {!search && (filter === 'open' || filter === 'all') && (
                        <div style={{ width: '100%', paddingTop: 14 }}>
                            <MButton variant="filled" onClick={() => setEditing(null)}><Plus size={19} /> Novi zadatak</MButton>
                        </div>
                    )}
                </MEmpty>
            ) : (
                groups.map(g => (
                    <div key={g.key}>
                        {g.label && (
                            <div className={`mui-shd${g.tone === 'late' ? ' mt-late' : ''}`}>
                                <span>{g.label}</span>
                                <span className="mui-dim">{g.items.length}</span>
                            </div>
                        )}
                        <div className="mui-elist">{g.items.map(renderCard)}</div>
                    </div>
                ))
            )}

            <MSheet open={sheet} title="Prikaz" onClose={() => setSheet(false)}>
                <MSection title="Grupiši po" />
                <MList>
                    {TASK_GROUPINGS.map(g => (
                        <MOption key={g.id} label={g.label} selected={groupBy === g.id} onClick={() => setGroupBy(g.id)} />
                    ))}
                </MList>
                {taskProfiles.length > 0 && (
                    <>
                        <MSection title="Profil" />
                        <MList>
                            <MOption label="Svi profili" selected={profileId === ALL_PROFILES} onClick={() => setProfileId(ALL_PROFILES)} />
                            {taskProfiles.map(p => (
                                <MOption key={p.Profile_ID} label={p.Name} selected={profileId === p.Profile_ID}
                                    onClick={() => setProfileId(p.Profile_ID)} />
                            ))}
                        </MList>
                    </>
                )}
            </MSheet>

            {openTask && (
                <MobileTaskDetail
                    task={openTask}
                    today={today}
                    onClose={() => setOpenId(null)}
                    onEdit={() => setEditing(openTask)}
                    onDelete={() => { onDelete(openTask.Task_ID); setOpenId(null); }}
                    onStatus={(s) => onStatus(openTask.Task_ID, s)}
                    onToggleChecklist={(itemId) => onToggleChecklist(openTask.Task_ID, itemId)}
                />
            )}

            {editing !== undefined && (
                <MobileTaskEditor
                    task={editing}
                    projects={projects}
                    workers={workers}
                    materials={materials}
                    workOrders={workOrders}
                    orders={orders}
                    onSave={save}
                    onClose={() => setEditing(undefined)}
                />
            )}
        </div>
    );
}
