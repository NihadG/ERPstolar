'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — LISTA NAPOMENA (dijeljena)
//
// Expandable kartica napomene: dodir na naslov otvara opis, rok i checklistu.
// Sve izmjene su DIREKTNE i OPTIMISTIČNE — čekiranje/brisanje se vidi odmah,
// bez čekanja mreže; na grešku upisa stanje se vrati. Koristi je i tab Napomene
// (grupisano po nalogu) i tab Danas (napomene naloga u toku).
// ════════════════════════════════════════════════════════════════════

import { useState, type Dispatch, type SetStateAction } from 'react';
import { Check, ChevronDown, ClipboardList, Package, StickyNote, Trash2 } from 'lucide-react';
import type { NoteRow } from '@/lib/field/fieldNotes';
import { useWorkerNoteActions } from '@/lib/field/useFieldWorker';
import { MPill, MCheck } from '@/components/tabs/mobile/MobileUI';
import type { ShowToast } from './WorkerApp';

const PRIORITY_TONE: Record<string, 'red' | 'orange' | 'blue' | 'gray'> = {
    urgent: 'red', high: 'orange', medium: 'blue', low: 'gray',
};

const dueText = (iso: string) =>
    new Date(iso.split('T')[0] + 'T12:00:00').toLocaleDateString('bs-BA', { day: 'numeric', month: 'long' });

interface Props {
    notes: NoteRow[];
    /** Mijenja PUNU listu (optimistične izmjene rade po taskId). */
    setNotes: Dispatch<SetStateAction<NoteRow[]>>;
    reload: () => void;
    showToast: ShowToast;
    readOnly: boolean;
    /** Prikaži vezani nalog/proizvod uz naslov (tab Danas da; u tab-grupi ne treba). */
    showLink?: boolean;
}

export default function WorkerNoteCards({ notes, setNotes, reload, showToast, readOnly, showLink = true }: Props) {
    const { toggleNote, toggleChecklistItem, deleteNote } = useWorkerNoteActions();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const patch = (taskId: string, fn: (n: NoteRow) => NoteRow) =>
        setNotes(prev => prev.map(n => (n.taskId === taskId ? fn(n) : n)));

    const toggleDone = (n: NoteRow) => {
        if (readOnly) return;
        const done = n.status !== 'completed';
        patch(n.taskId, x => ({ ...x, status: done ? 'completed' : 'pending' }));
        toggleNote(n.taskId, done).catch(() => {
            patch(n.taskId, x => ({ ...x, status: n.status }));
            showToast('Nije sačuvano.', 'error');
        });
    };

    const toggleCheck = (n: NoteRow, itemId: string, completed: boolean) => {
        if (readOnly) return;
        patch(n.taskId, x => ({ ...x, checklist: x.checklist.map(c => (c.id === itemId ? { ...c, completed } : c)) }));
        toggleChecklistItem(n.taskId, itemId, completed).catch(() => {
            patch(n.taskId, x => ({ ...x, checklist: x.checklist.map(c => (c.id === itemId ? { ...c, completed: !completed } : c)) }));
            showToast('Nije sačuvano.', 'error');
        });
    };

    const remove = (taskId: string) => {
        if (readOnly) return;
        setNotes(prev => prev.filter(n => n.taskId !== taskId));
        deleteNote(taskId).catch(() => { showToast('Brisanje nije uspjelo.', 'error'); reload(); });
    };

    return (
        <div className="fwk-notes">
            {notes.map(n => {
                const done = n.status === 'completed';
                const open = expandedId === n.taskId;
                const hasDetail = !!(n.description || n.notes || n.dueDate || n.checklist.length);
                const checkDone = n.checklist.filter(c => c.completed).length;
                return (
                    <div key={n.taskId} className={`fwk-note${done ? ' done' : ''}`}>
                        <div className="fwk-note-head">
                            <MCheck on={done} disabled={readOnly} onClick={() => toggleDone(n)} />
                            <button
                                type="button"
                                className="fwk-note-open"
                                onClick={() => hasDetail && setExpandedId(open ? null : n.taskId)}
                            >
                                <span className="fwk-note-title">{n.title}</span>
                                <span className="fwk-note-tags">
                                    <MPill tone={PRIORITY_TONE[n.priority] || 'gray'}>{n.priority}</MPill>
                                    {showLink && (n.productName
                                        ? <span className="fwk-note-link"><Package size={12} /> {n.productName}</span>
                                        : n.orderName
                                            ? <span className="fwk-note-link"><ClipboardList size={12} /> {n.orderName}</span>
                                            : <span className="fwk-note-link"><StickyNote size={12} /> lična</span>)}
                                    {!showLink && n.productName && (
                                        <span className="fwk-note-link"><Package size={12} /> {n.productName}</span>
                                    )}
                                    {n.checklist.length > 0 && (
                                        <span className="fwk-note-cl">{checkDone}/{n.checklist.length}</span>
                                    )}
                                </span>
                            </button>
                            {hasDetail && <ChevronDown size={18} className={`fwk-note-chev${open ? ' open' : ''}`} />}
                            {!readOnly && (
                                <button
                                    type="button" className="fwk-iconbtn danger" aria-label="Obriši napomenu"
                                    onClick={() => remove(n.taskId)}
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>

                        {open && hasDetail && (
                            <div className="fwk-note-detail">
                                {n.description && <p className="fwk-note-desc">{n.description}</p>}
                                {n.notes && <p className="fwk-note-desc">{n.notes}</p>}
                                {n.dueDate && <div className="fwk-note-due">Rok: {dueText(n.dueDate)}</div>}
                                {n.checklist.length > 0 && (
                                    <div className="fwk-note-checklist">
                                        {n.checklist.map(c => (
                                            <button
                                                key={c.id} type="button"
                                                className={`fwk-note-citem${c.completed ? ' on' : ''}`}
                                                disabled={readOnly}
                                                onClick={() => toggleCheck(n, c.id, !c.completed)}
                                            >
                                                <span className="fwk-note-cbox">
                                                    {c.completed && <Check size={12} strokeWidth={3.5} />}
                                                </span>
                                                <span className="fwk-note-ctext">{c.text}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
