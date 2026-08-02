'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — NAPOMENE
//
// Napomene SU zadaci (isti `tasks`/Task.Links kao desktop tab Zadaci), samo
// filtrirani i preimenovani za radnika. GRUPISANE PO NALOGU: prvo nalozi u
// toku, pa pauzirani, pa na čekanju, pa lične (bez naloga). Unutar naloga prve
// su napomene proizvoda koji je u toku. Kreiranje/čekiranje/brisanje su direktne
// izmjene (bez odobrenja); poslodavac dobije notifikaciju na kreiranje.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Plus } from 'lucide-react';
import type { FieldOrderRow } from '@/lib/field/fieldOrders';
import type { NoteRow } from '@/lib/field/fieldNotes';
import { useWorkerNoteActions, useWorkerOrderDetail } from '@/lib/field/useFieldWorker';
import { MLarge, MList, MPill, MEmpty, MButton, MSheet, MOption, MSection } from '@/components/tabs/mobile/MobileUI';
import WorkerNoteCards from './WorkerNoteCards';
import type { ShowToast } from './WorkerApp';

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Status naloga za zaglavlje grupe (iz ranga: 0/1 u toku, 2 pauza, 3 čekanje). */
function orderStatusPill(rank: number): { label: string; tone: 'blue' | 'orange' | 'gray' } | null {
    if (rank <= 1) return { label: 'U toku', tone: 'blue' };
    if (rank === 2) return { label: 'Pauziran', tone: 'orange' };
    if (rank === 3) return { label: 'Na čekanju', tone: 'gray' };
    return null;
}

interface NoteGroup {
    key: string;
    name: string;
    rank: number;
    notes: NoteRow[];
}

interface Props {
    orders: FieldOrderRow[];
    notes: NoteRow[];
    setNotes: Dispatch<SetStateAction<NoteRow[]>>;
    loading: boolean;
    error: string | null;
    reload: () => void;
    /** Proizvodi u toku — napomene tih proizvoda idu prve unutar naloga. */
    activeProductIds: Set<string>;
    previewUid?: string | null;
    showToast: ShowToast;
}

export default function WorkerNotesScreen({
    orders, notes, setNotes, loading, error, reload, activeProductIds, previewUid, showToast,
}: Props) {
    const readOnly = !!previewUid;
    const { createNote, busy } = useWorkerNoteActions();

    const [addOpen, setAddOpen] = useState(false);

    // Nova napomena — tekst + obavezan nalog + opcioni proizvod tog naloga.
    const [text, setText] = useState('');
    const [orderId, setOrderId] = useState<string | null>(null);
    const [productId, setProductId] = useState<string | null>(null);
    const { detail: orderDetail } = useWorkerOrderDetail(addOpen ? orderId : null, previewUid);
    const orderProducts = orderDetail?.items || [];

    const openCount = useMemo(() => notes.filter(n => n.status !== 'completed').length, [notes]);

    // ── Grupisanje po nalogu; grupe u toku prve; unutar grupe „u toku" prvi ──
    const groups = useMemo<NoteGroup[]>(() => {
        const orderById = new Map(orders.map(o => [o.orderId, o]));
        const map = new Map<string, NoteGroup>();
        for (const n of notes) {
            const key = n.orderId || '__none__';
            let g = map.get(key);
            if (!g) {
                const o = n.orderId ? orderById.get(n.orderId) : undefined;
                g = {
                    key,
                    name: n.orderId ? (o?.name || n.orderName || 'Nalog') : 'Lične napomene',
                    rank: n.orderId ? (o?.rank ?? 8) : 9,
                    notes: [],
                };
                map.set(key, g);
            }
            g.notes.push(n);
        }
        for (const g of map.values()) {
            g.notes.sort((a, b) =>
                (activeProductIds.has(b.productId || '') ? 1 : 0) - (activeProductIds.has(a.productId || '') ? 1 : 0)
                || (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0)
                || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
                || a.title.localeCompare(b.title, 'bs'));
        }
        return [...map.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'bs'));
    }, [notes, orders, activeProductIds]);

    const resetForm = () => { setText(''); setOrderId(null); setProductId(null); };

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

            {groups.map(g => {
                const sp = orderStatusPill(g.rank);
                return (
                    <div key={g.key}>
                        <MSection
                            title={g.name}
                            right={sp ? <MPill tone={sp.tone}>{sp.label}</MPill> : <span className="mui-dim">{g.notes.length}</span>}
                        />
                        <WorkerNoteCards
                            notes={g.notes}
                            setNotes={setNotes}
                            reload={reload}
                            showToast={showToast}
                            readOnly={readOnly}
                            showLink={false}
                        />
                    </div>
                );
            })}

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
