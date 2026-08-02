'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — NAPOMENE
//
// Napomene SU zadaci (isti `tasks`/Task.Links kao desktop tab Zadaci), samo
// filtrirani i preimenovani za radnika. Kartica se OTVARA (dodir na naslov) da
// pokaže opis, rok i checklistu. Sve izmjene su DIREKTNE (bez odobrenja) i
// OPTIMISTIČNE — čekiranje se vidi odmah, bez čekanja mreže; ako upis padne,
// stanje se vrati. Poslodavac dobije notifikaciju kad radnik doda napomenu.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ClipboardList, Package, Plus, StickyNote, Trash2 } from 'lucide-react';
import type { FieldOrderRow } from '@/lib/field/fieldOrders';
import type { FieldProductDetail } from '@/lib/field/fieldProjects';
import type { NoteRow } from '@/lib/field/fieldNotes';
import { useWorkerNoteActions, useWorkerNotes, useWorkerOrderDetail } from '@/lib/field/useFieldWorker';
import {
    MLarge, MList, MPill, MEmpty, MButton, MSheet, MCheck, MOption, MSection,
} from '@/components/tabs/mobile/MobileUI';
import type { ShowToast } from './WorkerApp';

const PRIORITY_TONE: Record<string, 'red' | 'orange' | 'blue' | 'gray'> = {
    urgent: 'red', high: 'orange', medium: 'blue', low: 'gray',
};

const dueText = (iso: string) =>
    new Date(iso.split('T')[0] + 'T12:00:00').toLocaleDateString('bs-BA', { day: 'numeric', month: 'long' });

interface Props {
    orders: FieldOrderRow[];
    productById: Map<string, FieldProductDetail>;
    previewUid?: string | null;
    showToast: ShowToast;
}

export default function WorkerNotesScreen({ orders, previewUid, showToast }: Props) {
    const readOnly = !!previewUid;
    const { notes, setNotes, loading, error, reload } = useWorkerNotes(previewUid);
    const { createNote, toggleNote, toggleChecklistItem, deleteNote, busy } = useWorkerNoteActions();

    const [addOpen, setAddOpen] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Nova napomena — tekst + obavezan nalog + opcioni proizvod tog naloga.
    const [text, setText] = useState('');
    const [orderId, setOrderId] = useState<string | null>(null);
    const [productId, setProductId] = useState<string | null>(null);
    const { detail: orderDetail } = useWorkerOrderDetail(addOpen ? orderId : null, previewUid);
    const orderProducts = orderDetail?.items || [];

    const openCount = useMemo(
        () => notes.filter(n => n.status !== 'completed').length,
        [notes]
    );

    const resetForm = () => { setText(''); setOrderId(null); setProductId(null); };

    const patch = (taskId: string, fn: (n: NoteRow) => NoteRow) =>
        setNotes(prev => prev.map(n => (n.taskId === taskId ? fn(n) : n)));

    // ── Optimistične izmjene (instant, bez reload-a) ─────────────────
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

    const create = async () => {
        if (readOnly || busy || !text.trim() || !orderId) return;
        try {
            await createNote({ title: text.trim(), workOrderId: orderId, ...(productId ? { productId } : {}) });
            showToast('Napomena kreirana', 'success');
            setAddOpen(false); resetForm();
            reload();
        } catch (e: any) {
            showToast(e?.message || 'Slanje nije uspjelo.', 'error');
        }
    };

    return (
        <>
            <MLarge title="Napomene">
                {notes.length} {notes.length === 1 ? 'napomena' : 'napomena'}
                {openCount > 0 && <span className="mui-dim">· {openCount} otvoreno</span>}
            </MLarge>

            {!readOnly && (
                <div style={{ padding: '2px 0 12px' }}>
                    <MButton variant="filled" onClick={() => { resetForm(); setAddOpen(true); }}>
                        <Plus size={18} /> Nova napomena
                    </MButton>
                </div>
            )}

            {loading && notes.length === 0 && <div className="fld-loading">Učitavanje…</div>}

            {error && (
                <MEmpty title="Napomene nisu učitane" sub={error}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={reload}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            )}

            {!loading && !error && notes.length === 0 && (
                <MEmpty
                    title="Nema napomena"
                    sub="Upiši napomenu i veži je za svoj nalog ili proizvod — odmah se vidi, poslodavac dobije obavijest."
                />
            )}

            {notes.length > 0 && (
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
                                            {n.productName
                                                ? <span className="fwk-note-link"><Package size={12} /> {n.productName}</span>
                                                : n.orderName
                                                    ? <span className="fwk-note-link"><ClipboardList size={12} /> {n.orderName}</span>
                                                    : <span className="fwk-note-link"><StickyNote size={12} /> lična</span>}
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
            )}

            {/* ── Nova napomena ───────────────────────────────────────── */}
            <MSheet open={addOpen} title="Nova napomena" onClose={() => setAddOpen(false)}>
                <input
                    className="fwk-input" placeholder="Upiši napomenu…" value={text}
                    onChange={(e) => setText(e.target.value)} autoFocus
                />

                <MSection title="Veži za nalog" />
                {orders.length === 0 ? (
                    <p className="fwk-hint" style={{ padding: '2px 2px' }}>Nemaš naloga za vezivanje.</p>
                ) : (
                    <MList>
                        {orders.map(o => (
                            <MOption
                                key={o.orderId}
                                label={o.name}
                                sub={o.projectName || `#${o.number}`}
                                selected={orderId === o.orderId}
                                onClick={() => { setOrderId(o.orderId); setProductId(null); }}
                            />
                        ))}
                    </MList>
                )}

                {orderId && orderProducts.length > 0 && (
                    <>
                        <MSection title="Proizvod (opcionalno)" />
                        <MList>
                            <MOption
                                label="Cijeli nalog"
                                sub="bez određenog proizvoda"
                                selected={productId === null}
                                onClick={() => setProductId(null)}
                            />
                            {orderProducts.map(it => (
                                <MOption
                                    key={it.itemId}
                                    label={it.productName}
                                    sub={it.quantity > 1 ? `×${it.quantity}` : undefined}
                                    selected={productId === it.productId}
                                    onClick={() => setProductId(it.productId)}
                                />
                            ))}
                        </MList>
                    </>
                )}

                <div className="fld-submit">
                    <MButton variant="filled" disabled={busy || !text.trim() || !orderId} onClick={create}>
                        Sačuvaj napomenu
                    </MButton>
                </div>
            </MSheet>
        </>
    );
}
