'use client';

// ════════════════════════════════════════════════════════════════════
// DETALJ ZADATKA — mobilni (full-screen)
//
// Sve što se s otvorenim zadatkom radi na terenu: promjena statusa,
// čekiranje kontrolne liste, pregled veza. Uređivanje polja ide u
// MobileTaskEditor (olovka gore desno).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowLeft, Pencil, Trash2, FolderOpen, Package, Layers, User, HardHat, ShoppingCart, Check, RotateCcw,
} from 'lucide-react';
import type { Task, TaskLink } from '@/lib/types';
import { TASK_CATEGORY_LABELS, TASK_PRIORITY_LABELS } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { getTaskChecklistSections } from '@/lib/taskChecklist';
import {
    MSegmented, MSection, MList, MItem, MCell, MText, MValue, MPill, MCheck, MButton, MSheet, MIcon,
} from './MobileUI';
import { useSwipeBack } from './useSwipe';
import { useOverlayGuard } from './overlayGuard';
import { dueLabel } from './taskListModel';
import './MobileUI.css';
import './MobileWorkOrderDetail.css';
import './MobileTasks.css';

export const LINK_META: Record<TaskLink['Entity_Type'], { label: string; Icon: typeof FolderOpen; tone: 'blue' | 'green' | 'orange' | 'purple' | 'gray' }> = {
    project: { label: 'Projekat', Icon: FolderOpen, tone: 'blue' },
    product: { label: 'Proizvod', Icon: Package, tone: 'purple' },
    work_order: { label: 'Nalog', Icon: HardHat, tone: 'orange' },
    order: { label: 'Narudžba', Icon: ShoppingCart, tone: 'green' },
    material: { label: 'Materijal', Icon: Layers, tone: 'gray' },
    worker: { label: 'Radnik', Icon: User, tone: 'gray' },
};

type MainStatus = 'pending' | 'in_progress' | 'completed';

interface Props {
    task: Task;
    today: string;
    onClose: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onStatus: (s: Task['Status']) => void;
    onToggleChecklist: (itemId: string) => void;
}

export default function MobileTaskDetail({ task, today, onClose, onEdit, onDelete, onStatus, onToggleChecklist }: Props) {
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Nazad (dugme, gesta, Android „nazad") ide kroz historiju preglednika.
    // Povratak NA ovaj unos (kad se zatvori editor iznad) ne zatvara detalj.
    useEffect(() => {
        // Bez dvostrukog unosa kad React (strict mode) efekat pokrene dvaput.
        if (!window.history.state?.moTaskDetail) window.history.pushState({ moTaskDetail: true }, '');
        const onPop = (e: PopStateEvent) => { if (!e.state?.moTaskDetail) onClose(); };
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
    const swipeRef = useSwipeBack(goBack, { enabled: !confirmDelete });

    const due = dueLabel(task, today);
    const sections = getTaskChecklistSections(task);
    const cl = task.Checklist || [];
    const clDone = cl.filter(c => c.completed).length;
    const done = task.Status === 'completed';

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="mui mwd" ref={swipeRef}>
            <header className="mwd-nav">
                <button type="button" className="mwd-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Zadaci
                </button>
                <div className="mwd-nav-actions">
                    <button type="button" className="mwd-navbtn" onClick={onEdit} aria-label="Uredi">
                        <Pencil size={18} />
                    </button>
                    <button type="button" className="mwd-navbtn danger" onClick={() => setConfirmDelete(true)} aria-label="Obriši">
                        <Trash2 size={19} />
                    </button>
                </div>
            </header>

            <div className="mwd-body">
                <div className="mui-large mt-large">
                    <h1>{task.Title}</h1>
                    <p>
                        {task.Status === 'cancelled' && <MPill>Otkazano</MPill>}
                        <MPill tone={task.Priority === 'urgent' ? 'red' : task.Priority === 'high' ? 'orange' : task.Priority === 'medium' ? 'blue' : 'gray'}>
                            {TASK_PRIORITY_LABELS[task.Priority]} prioritet
                        </MPill>
                        <span>{TASK_CATEGORY_LABELS[task.Category] || ''}</span>
                    </p>
                </div>

                <MSegmented<MainStatus>
                    value={(task.Status === 'cancelled' ? '' : task.Status) as MainStatus}
                    onChange={(s) => { if (s !== task.Status) onStatus(s); }}
                    options={[
                        { id: 'pending', label: 'Na čekanju' },
                        { id: 'in_progress', label: 'U toku' },
                        { id: 'completed', label: 'Završeno' },
                    ]}
                />

                <MSection title="Detalji" />
                <MList>
                    <MItem><MCell>
                        <MText title="Rok" />
                        <MValue num={false}>
                            {task.Due_Date
                                ? <span className={due?.tone ? `mt-due ${due.tone}` : ''} style={{ fontSize: 16 }}>
                                    {formatDate(task.Due_Date)}{due?.tone ? ` · ${due.text}` : ''}
                                </span>
                                : 'bez roka'}
                        </MValue>
                    </MCell></MItem>
                    <MItem><MCell><MText title="Radnik" /><MValue num={false}>{task.Assigned_Worker_Name || 'nedodijeljeno'}</MValue></MCell></MItem>
                    {task.Completed_Date && done && (
                        <MItem><MCell><MText title="Završeno" /><MValue num={false}>{formatDate(task.Completed_Date)}</MValue></MCell></MItem>
                    )}
                    <MItem><MCell><MText title="Kreiran" /><MValue num={false}>{formatDate(task.Created_Date)}</MValue></MCell></MItem>
                </MList>

                {task.Description?.trim() && (
                    <>
                        <MSection title="Opis" />
                        <MList><MItem><MCell><span className="mt-text">{task.Description}</span></MCell></MItem></MList>
                    </>
                )}

                {cl.length > 0 && (
                    <>
                        <MSection title="Kontrolna lista" right={<span className="mui-dim">{clDone}/{cl.length}</span>} />
                        <MList>
                            {sections.map(section => (
                                <div key={section.id || 'ungrouped'}>
                                    {section.name && <div className="mt-cl-group">{section.name}</div>}
                                    {section.items.map(item => (
                                        <MItem key={item.id}>
                                            <div className={`mui-cell mui-tap mt-cl-item${item.completed ? ' done' : ''}`}
                                                role="button" tabIndex={0} onClick={() => onToggleChecklist(item.id)}>
                                                <MCheck small on={item.completed} label={item.completed ? `Poništi ${item.text}` : `Završi ${item.text}`}
                                                    onClick={() => onToggleChecklist(item.id)} />
                                                <span className="mt-text">{item.text}</span>
                                            </div>
                                        </MItem>
                                    ))}
                                </div>
                            ))}
                        </MList>
                    </>
                )}

                {(task.Links || []).length > 0 && (
                    <>
                        <MSection title="Povezano" />
                        <MList lead>
                            {task.Links.map((l, i) => {
                                const m = LINK_META[l.Entity_Type] || LINK_META.project;
                                return (
                                    <MItem key={`${l.Entity_Type}:${l.Entity_ID}:${i}`}>
                                        <MCell>
                                            <MIcon tone={m.tone === 'gray' ? undefined : m.tone}><m.Icon size={18} /></MIcon>
                                            <MText title={l.Entity_Name || '—'} sub={m.label} />
                                        </MCell>
                                    </MItem>
                                );
                            })}
                        </MList>
                    </>
                )}

                {task.Notes?.trim() && (
                    <>
                        <MSection title="Napomena" />
                        <MList><MItem><MCell><span className="mt-text">{task.Notes}</span></MCell></MItem></MList>
                    </>
                )}

                <div className="mui-stack mui-gap10 mui-pt14" style={{ paddingTop: 22 }}>
                    {done ? (
                        <MButton variant="tinted" onClick={() => onStatus('pending')}>
                            <RotateCcw size={19} /> Vrati u rad
                        </MButton>
                    ) : (
                        <MButton variant="gfilled" onClick={() => onStatus('completed')}>
                            <Check size={20} /> Označi kao završeno
                        </MButton>
                    )}
                    <MButton variant="tinted" onClick={onEdit}><Pencil size={18} /> Uredi zadatak</MButton>
                </div>
            </div>

            <MSheet
                open={confirmDelete}
                title="Obrisati zadatak?"
                onClose={() => setConfirmDelete(false)}
                footer={
                    <div className="mui-stack mui-gap10 mui-pt14">
                        <MButton variant="danger" onClick={() => { setConfirmDelete(false); onDelete(); goBack(); }}>
                            <Trash2 size={19} /> Obriši zadatak
                        </MButton>
                        <MButton variant="tinted" onClick={() => setConfirmDelete(false)}>Odustani</MButton>
                    </div>
                }
            >
                <p className="mwd-sheet-note">„{task.Title}" se trajno briše.</p>
            </MSheet>
        </div>,
        document.body
    );
}
