'use client';

// ════════════════════════════════════════════════════════════════════
// IZBOR POSTOJEĆIH ZADATAKA — „Poveži postojeći" na nalogu.
// Dijele ga kartica naloga (WorkOrderTasksPanel) i wizardi (TaskAttachEditor),
// pa je izbor zadatka svuda isti prizor.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { Search, Check, Link2, Lightbulb, ListChecks } from 'lucide-react';
import Modal from './Modal';
import { isTaskOverdue } from '@/lib/workOrderTasks';
import { TASK_PRIORITY_LABELS, TASK_CATEGORY_LABELS, type Task } from '@/lib/types';
import { todayISO } from '@/lib/planning';
import './TaskPickerModal.css';

interface TaskPickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Zadaci ponuđeni za izbor (pozivalac već izuzima one koji su na nalogu). */
    tasks: Task[];
    /** Task_ID-evi koji se predlažu na vrhu (vezani za proizvod iz naloga). */
    suggestedIds?: string[];
    onConfirm: (taskIds: string[]) => void;
    zIndex?: number;
}

export default function TaskPickerModal({
    isOpen, onClose, tasks, suggestedIds = [], onConfirm, zIndex,
}: TaskPickerModalProps) {
    const [search, setSearch] = useState('');
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const today = todayISO();
    const suggested = useMemo(() => new Set(suggestedIds), [suggestedIds]);

    // Prijedlozi (zadatak se tiče proizvoda iz ovog naloga) idu na vrh — to je
    // ono što korisnik u 9/10 slučajeva i traži.
    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        const matched = q
            ? tasks.filter(t =>
                t.Title.toLowerCase().includes(q) ||
                (t.Description || '').toLowerCase().includes(q) ||
                (t.Assigned_Worker_Name || '').toLowerCase().includes(q))
            : tasks;
        return [...matched].sort((a, b) => {
            const sa = suggested.has(a.Task_ID) ? 0 : 1;
            const sb = suggested.has(b.Task_ID) ? 0 : 1;
            if (sa !== sb) return sa - sb;
            const da = a.Due_Date || '9999-12-31';
            const db = b.Due_Date || '9999-12-31';
            if (da !== db) return da < db ? -1 : 1;
            return a.Title.localeCompare(b.Title, 'bs');
        });
    }, [tasks, search, suggested]);

    const toggle = (id: string) => setPicked(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const close = () => { setPicked(new Set()); setSearch(''); onClose(); };
    const confirm = () => { onConfirm(Array.from(picked)); setPicked(new Set()); setSearch(''); onClose(); };

    return (
        <Modal
            isOpen={isOpen}
            onClose={close}
            title="Poveži postojeće zadatke"
            size="large"
            zIndex={zIndex}
            footer={
                <>
                    <button className="btn btn-secondary" onClick={close}>Odustani</button>
                    <button className="btn btn-primary" disabled={picked.size === 0} onClick={confirm}>
                        <Link2 size={15} />
                        {picked.size === 0 ? 'Dodaj na nalog' : `Dodaj ${picked.size} na nalog`}
                    </button>
                </>
            }
        >
            <div className="tpick">
                <div className="tpick-search">
                    <Search size={16} />
                    <input
                        autoFocus
                        placeholder="Traži po nazivu, opisu ili radniku…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                {visible.length === 0 ? (
                    <div className="tpick-empty">
                        {tasks.length === 0
                            ? 'Nema slobodnih zadataka — svi otvoreni zadaci su već na nekom nalogu ili ih još nema.'
                            : 'Nema zadatka koji odgovara pretrazi.'}
                    </div>
                ) : (
                    <div className="tpick-list">
                        {visible.map(t => {
                            const isPicked = picked.has(t.Task_ID);
                            const overdue = isTaskOverdue(t, today);
                            return (
                                <button
                                    key={t.Task_ID}
                                    type="button"
                                    className={`tpick-row${isPicked ? ' picked' : ''}`}
                                    onClick={() => toggle(t.Task_ID)}
                                >
                                    <span className={`tpick-check${isPicked ? ' on' : ''}`}>
                                        {isPicked && <Check size={13} strokeWidth={3} />}
                                    </span>
                                    <span className="tpick-body">
                                        <span className="tpick-title-row">
                                            <span className="tpick-title">{t.Title}</span>
                                            {suggested.has(t.Task_ID) && (
                                                <span className="tpick-suggest" title="Vezan je za proizvod iz ovog naloga">
                                                    <Lightbulb size={10} /> prijedlog
                                                </span>
                                            )}
                                            <span className={`tpick-prio p-${t.Priority}`}>{TASK_PRIORITY_LABELS[t.Priority]}</span>
                                        </span>
                                        <span className="tpick-meta">
                                            <span>{TASK_CATEGORY_LABELS[t.Category]}</span>
                                            {t.Due_Date && (
                                                <span className={overdue ? 'is-overdue' : ''}>
                                                    Rok {new Date(t.Due_Date).toLocaleDateString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                    {overdue && ' · kasni'}
                                                </span>
                                            )}
                                            {t.Assigned_Worker_Name && <span>{t.Assigned_Worker_Name}</span>}
                                            {(t.Checklist?.length || 0) > 0 && (
                                                <span className="tpick-steps">
                                                    <ListChecks size={11} />
                                                    {t.Checklist!.filter(c => c.completed).length}/{t.Checklist!.length} koraka
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </Modal>
    );
}
