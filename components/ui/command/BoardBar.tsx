'use client';

// ════════════════════════════════════════════════════════════════════
// TABLA PROJEKATA — čipovi + birač
//
// Tabla je lična i mijenja se često, pa čip mora reći dovoljno da se
// odluči hoće li ostati: koliko proizvoda, koliko otvorenih naloga,
// koliko zadataka i — najvažnije — koliko toga kasni.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { Project } from '@/lib/types';
import Modal from '../Modal';
import { hue } from './parts';
import type { BoardScope } from '@/lib/command/scope';
import { isTaskOpen, isWorkOrderOpen, taskProject } from '@/lib/command/scope';
import { isTaskLate, isWorkOrderLate } from '@/lib/command/signals';

export interface ChipCounts { products: number; workOrders: number; tasks: number; late: number }

export function boardChipCounts(scope: BoardScope, today: string): Map<string, ChipCounts> {
    const counts = new Map<string, ChipCounts>();
    for (const project of scope.projects) {
        counts.set(project.Project_ID, { products: (project.products || []).length, workOrders: 0, tasks: 0, late: 0 });
    }
    for (const wo of scope.workOrders) {
        if (!isWorkOrderOpen(wo)) continue;
        const late = isWorkOrderLate(wo, today);
        for (const projectId of scope.workOrderProjects.get(wo.Work_Order_ID) || []) {
            const entry = counts.get(projectId);
            if (!entry) continue;
            entry.workOrders++;
            if (late) entry.late++;
        }
    }
    for (const task of scope.tasks) {
        if (!isTaskOpen(task)) continue;
        const projectId = taskProject(task, scope);
        const entry = projectId ? counts.get(projectId) : undefined;
        if (!entry) continue;
        entry.tasks++;
        if (isTaskLate(task, today)) entry.late++;
    }
    return counts;
}

export default function BoardBar({
    projects, boardIds, counts, onAdd, onRemove,
}: {
    /** Svi projekti organizacije — izvor za birač. */
    projects: Project[];
    boardIds: string[];
    counts: Map<string, ChipCounts>;
    onAdd: (ids: string[]) => void;
    onRemove: (id: string) => void;
}) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const onBoard = useMemo(() => {
        const index = new Map(projects.map(p => [p.Project_ID, p]));
        return boardIds.map(id => index.get(id)).filter((p): p is Project => !!p);
    }, [projects, boardIds]);

    return (
        <div className="kc-boardbar">
            {onBoard.map(project => {
                const c = counts.get(project.Project_ID);
                return (
                    <div className="kc-chip" key={project.Project_ID} style={hue(project.Project_ID)}>
                        <span className="kc-chip-text">
                            <strong>{project.Name || project.Client_Name}</strong>
                            <span>{project.Name ? project.Client_Name : 'Projekat'}</span>
                        </span>
                        {c && (
                            <span className="kc-chip-counts">
                                <span title="Proizvoda"><b>{c.products}</b> pr</span>
                                <span title="Otvorenih naloga"><b>{c.workOrders}</b> nal</span>
                                <span title="Otvorenih zadataka"><b>{c.tasks}</b> zad</span>
                                {c.late > 0 && <span className="late" title="Kasni">{c.late} kasni</span>}
                            </span>
                        )}
                        <button
                            type="button"
                            className="kc-chip-x"
                            aria-label={`Ukloni s table: ${project.Name || project.Client_Name}`}
                            title="Ukloni s table (projekat ostaje netaknut)"
                            onClick={() => onRemove(project.Project_ID)}
                        >
                            <X size={15} />
                        </button>
                    </div>
                );
            })}
            <button type="button" className="kc-chip-add" onClick={() => setPickerOpen(true)}>
                <Plus size={15} /> Dodaj projekat
            </button>

            <ProjectPicker
                isOpen={pickerOpen}
                projects={projects}
                boardIds={boardIds}
                onClose={() => setPickerOpen(false)}
                onConfirm={ids => { onAdd(ids); setPickerOpen(false); }}
            />
        </div>
    );
}

export function ProjectPicker({
    isOpen, projects, boardIds, onClose, onConfirm,
}: {
    isOpen: boolean;
    projects: Project[];
    boardIds: string[];
    onClose: () => void;
    onConfirm: (ids: string[]) => void;
}) {
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const already = useMemo(() => new Set(boardIds), [boardIds]);

    // Arhivirani (Hidden) projekti se ne nude — tabla je za ono što se radi.
    const list = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase('bs');
        return projects
            .filter(p => !p.Hidden && !already.has(p.Project_ID))
            .filter(p => !needle || `${p.Name || ''} ${p.Client_Name || ''} ${p.Address || ''}`.toLocaleLowerCase('bs').includes(needle))
            .slice(0, 200);
    }, [projects, already, query]);

    const toggle = (id: string) => setPicked(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const close = () => { setPicked(new Set()); setQuery(''); onClose(); };

    return (
        <Modal
            isOpen={isOpen}
            onClose={close}
            size="default"
            title="Dodaj projekte na tablu"
            footer={
                <div className="kc-selbar-actions" style={{ width: '100%' }}>
                    <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>
                        {picked.size ? `Označeno: ${picked.size}` : 'Označi projekte koje pratiš'}
                    </span>
                    <button type="button" className="kc-btn" onClick={close}>Odustani</button>
                    <button type="button" className="kc-btn primary" disabled={picked.size === 0} onClick={() => { onConfirm(Array.from(picked)); setPicked(new Set()); setQuery(''); }}>
                        Dodaj ({picked.size})
                    </button>
                </div>
            }
        >
            <div className="kc-picker">
                <label className="kc-qa-input" style={{ padding: 0 }}>
                    <Search size={15} style={{ color: 'var(--text-tertiary)' }} />
                    <input
                        className="kc-input"
                        placeholder="Pretraži po nazivu, klijentu ili adresi"
                        aria-label="Pretraži projekte"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                </label>
                <div className="kc-picker-list">
                    {list.map(project => (
                        <button
                            type="button"
                            key={project.Project_ID}
                            className={`kc-picker-row${picked.has(project.Project_ID) ? ' on' : ''}`}
                            style={hue(project.Project_ID)}
                            aria-pressed={picked.has(project.Project_ID)}
                            onClick={() => toggle(project.Project_ID)}
                        >
                            <span className="kc-picker-main">
                                <strong>{project.Name || project.Client_Name}</strong>
                                <span>{[project.Client_Name, project.Status, `${(project.products || []).length} proizvoda`].filter(Boolean).join(' · ')}</span>
                            </span>
                        </button>
                    ))}
                    {list.length === 0 && (
                        <div className="kc-empty">
                            <p>{query ? 'Nema projekta za ovu pretragu.' : 'Svi aktivni projekti su već na tabli.'}</p>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
