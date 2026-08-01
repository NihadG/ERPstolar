'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — NAPOMENE
//
// Napomene (Task) koje se tiču radnika: dodijeljene njemu ILI vezane za
// njegov nalog/proizvod. Radnik može upisati novu napomenu i ovdje — uz
// OBAVEZNO vezivanje za jedan od svojih naloga (i opciono proizvod tog
// naloga). Kao i svaka radnikova radnja, to je PRIJEDLOG koji poslodavac
// potvrđuje; zato nakon slanja: „Prijedlog poslan — čeka potvrdu".
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Package, Plus, ClipboardList, Trash2, StickyNote } from 'lucide-react';
import type { FieldOrderRow } from '@/lib/field/fieldOrders';
import type { FieldProductDetail } from '@/lib/field/fieldProjects';
import { useWorkerNotes, useWorkerOrderDetail } from '@/lib/field/useFieldWorker';
import { useWorkerRequests } from '@/lib/field/useWorkerRequests';
import {
    MLarge, MList, MItem, MCell, MText, MPill, MEmpty, MButton,
    MSheet, MCheck, MOption, MSection,
} from '@/components/tabs/mobile/MobileUI';
import type { ShowToast } from './WorkerApp';

const PRIORITY_TONE: Record<string, 'red' | 'orange' | 'blue' | 'gray'> = {
    urgent: 'red', high: 'orange', medium: 'blue', low: 'gray',
};

interface Props {
    orders: FieldOrderRow[];
    productById: Map<string, FieldProductDetail>;
    previewUid?: string | null;
    showToast: ShowToast;
}

export default function WorkerNotesScreen({ orders, previewUid, showToast }: Props) {
    const readOnly = !!previewUid;
    const { notes, loading, error, reload } = useWorkerNotes(previewUid);
    const { propose } = useWorkerRequests(readOnly);

    const [addOpen, setAddOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    // Nova napomena — tekst + obavezan nalog + opcioni proizvod tog naloga.
    const [text, setText] = useState('');
    const [orderId, setOrderId] = useState<string | null>(null);
    const [productId, setProductId] = useState<string | null>(null);
    const { detail: orderDetail } = useWorkerOrderDetail(addOpen ? orderId : null, previewUid);
    const orderProducts = orderDetail?.items || [];

    const openCount = useMemo(
        () => notes.filter(n => n.status === 'pending' || n.status === 'in_progress').length,
        [notes]
    );

    const resetForm = () => { setText(''); setOrderId(null); setProductId(null); };

    const submit = async (input: Parameters<typeof propose>[0], okMsg: string) => {
        if (readOnly || busy) return;
        setBusy(true);
        try {
            await propose(input);
            showToast(okMsg, 'success');
            setAddOpen(false); resetForm();
            reload();
        } catch (e: any) {
            showToast(e?.message || 'Slanje nije uspjelo.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const create = () => {
        if (!text.trim() || !orderId) return;
        submit(
            { kind: 'task_create', payload: { title: text.trim(), ...(productId ? { productId } : {}) }, workOrderId: orderId },
            'Napomena poslana — čeka potvrdu',
        );
    };

    const toggle = (taskId: string, done: boolean, title: string, linkedOrderId: string | null) =>
        submit(
            { kind: 'task_status', payload: { taskId, done, taskTitle: title }, ...(linkedOrderId ? { workOrderId: linkedOrderId } : {}) },
            'Prijedlog poslan — čeka potvrdu',
        );

    const remove = (taskId: string, title: string, linkedOrderId: string | null) =>
        submit(
            { kind: 'task_delete', payload: { taskId, taskTitle: title }, ...(linkedOrderId ? { workOrderId: linkedOrderId } : {}) },
            'Prijedlog brisanja poslan — čeka potvrdu',
        );

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
                    sub="Upiši napomenu i veži je za svoj nalog ili proizvod — poslodavac je potvrđuje."
                />
            )}

            {notes.length > 0 && (
                <MList lead>
                    {notes.map(n => (
                        <MItem key={n.taskId}>
                            <MCell done={n.status === 'completed'}>
                                <MCheck
                                    on={n.status === 'completed'}
                                    disabled={readOnly || busy}
                                    onClick={() => toggle(n.taskId, n.status !== 'completed', n.title, n.orderId)}
                                />
                                <MText
                                    title={n.title}
                                    sub={<>
                                        <MPill tone={PRIORITY_TONE[n.priority] || 'gray'}>{n.priority}</MPill>
                                        {n.productName
                                            ? <span className="fwk-note-link"><Package size={12} /> {n.productName}</span>
                                            : n.orderName
                                                ? <span className="fwk-note-link"><ClipboardList size={12} /> {n.orderName}</span>
                                                : <span className="fwk-note-link"><StickyNote size={12} /> lična</span>}
                                    </>}
                                />
                                {!readOnly && (
                                    <button
                                        type="button" className="fwk-iconbtn danger" aria-label="Obriši napomenu"
                                        onClick={(e) => { e.stopPropagation(); remove(n.taskId, n.title, n.orderId); }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </MCell>
                        </MItem>
                    ))}
                </MList>
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
                        Pošalji prijedlog
                    </MButton>
                </div>
            </MSheet>
        </>
    );
}
