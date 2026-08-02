'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — DETALJ NALOGA (s prijedlozima)
//
// Tri taba: Tok (procesi), Proizvodi (materijali + zatvaranje), Napomene. Svaka
// radnja radnika je PRIJEDLOG — ništa se ne mijenja dok vlasnik/kontrolor ne
// potvrdi. Zato nakon svake radnje: „Prijedlog poslan — čeka potvrdu", a gore
// stoji koliko prijedloga na ovom nalogu čeka. U pregledu je sve ugašeno.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft, CheckCircle2, Circle, Clock, ListChecks, Plus, Play, Pause, Flag, Trash2, Hourglass,
} from 'lucide-react';
import type { FieldProductDetail } from '@/lib/field/fieldProjects';
import type { ProcRow, ProcRowState } from '@/lib/orderProcessRows';
import { useWorkerNoteActions, useWorkerOrderDetail } from '@/lib/field/useFieldWorker';
import { useWorkerRequests, type ProposeInput } from '@/lib/field/useWorkerRequests';
import {
    MPill, MProgress, MEmpty, MSection, MList, MItem, MCell, MText,
    MCard, MCardHead, MCardBody, MIcon, MSegmented, MCheck, MSheet, MButton, MActions, MAction,
} from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';
import WorkerProductDetail from './WorkerProductDetail';
import type { ShowToast } from './WorkerApp';

type Tab = 'flow' | 'products' | 'tasks';

const STATE_META: Record<ProcRowState, { tone: 'green' | 'blue' | 'gray'; label: string; Icon: typeof Circle }> = {
    done: { tone: 'green', label: 'Gotovo', Icon: CheckCircle2 },
    active: { tone: 'blue', label: 'U toku', Icon: Clock },
    blocked: { tone: 'gray', label: 'Čeka', Icon: Circle },
};

const PRIORITY_TONE: Record<string, 'red' | 'orange' | 'blue' | 'gray'> = {
    urgent: 'red', high: 'orange', medium: 'blue', low: 'gray',
};

const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function dueLabel(days: number | null): { text: string; cls: string } | null {
    if (days === null) return null;
    if (days < 0) return { text: `kasni ${-days} ${-days === 1 ? 'dan' : 'dana'}`, cls: 'late' };
    if (days === 0) return { text: 'rok danas', cls: 'soon' };
    if (days <= 2) return { text: `rok za ${days} ${days === 1 ? 'dan' : 'dana'}`, cls: 'soon' };
    return { text: `rok za ${days} dana`, cls: '' };
}

interface Props {
    orderId: string;
    productById: Map<string, FieldProductDetail>;
    previewUid?: string | null;
    showToast: ShowToast;
    onClose: () => void;
}

export default function WorkerOrderDetail({ orderId, productById, previewUid, showToast, onClose }: Props) {
    const readOnly = !!previewUid;
    const { detail, loading, error, reload } = useWorkerOrderDetail(orderId, previewUid);
    const { pending, propose } = useWorkerRequests(readOnly);
    const [tab, setTab] = useState<Tab>('flow');
    const [openProductId, setOpenProductId] = useState<string | null>(null);
    const [procSheet, setProcSheet] = useState<ProcRow | null>(null);
    const [addProcOpen, setAddProcOpen] = useState(false);
    const [addTaskOpen, setAddTaskOpen] = useState(false);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        window.history.pushState({ fwkOrder: true }, '');
        const onPop = () => onClose();
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
    const swipeRef = useSwipeBack(goBack, { enabled: !openProductId && !procSheet && !addProcOpen && !addTaskOpen });

    const pendingHere = useMemo(
        () => pending.filter(r => r.Work_Order_ID === orderId).length,
        [pending, orderId]
    );

    const submit = async (input: ProposeInput, okMsg = 'Prijedlog poslan — čeka potvrdu') => {
        if (readOnly || busy) return;
        setBusy(true);
        try {
            await propose(input);
            showToast(okMsg, 'success');
            setProcSheet(null); setAddProcOpen(false); setAddTaskOpen(false); setText('');
        } catch (e: any) {
            showToast(e?.message || 'Slanje nije uspjelo.', 'error');
        } finally {
            setBusy(false);
        }
    };

    // Napomene su zadaci — kreiraju/mijenjaju se DIREKTNO (bez odobrenja).
    const { createNote, toggleNote, deleteNote, busy: noteBusy } = useWorkerNoteActions();
    const noteAction = async (fn: () => Promise<unknown>, okMsg: string) => {
        if (readOnly || noteBusy) return;
        try {
            await fn();
            showToast(okMsg, 'success');
            setAddTaskOpen(false); setText('');
            reload();
        } catch (e: any) {
            showToast(e?.message || 'Radnja nije uspjela.', 'error');
        }
    };

    // Poniranje u proizvod (materijali) — iz već dovučenih projekata.
    const openProduct = openProductId ? productById.get(openProductId) : null;
    if (openProduct) {
        return (
            <WorkerProductDetail
                product={openProduct}
                backLabel={detail?.name || 'Nalog'}
                previewUid={previewUid}
                showToast={showToast}
                onClose={() => setOpenProductId(null)}
            />
        );
    }

    const due = detail ? dueLabel(detail.daysUntilDue) : null;

    const targetsOf = (row: ProcRow) => row.perItem.map(pi => ({ itemId: pi.itemId, procName: pi.procName }));

    return (
        <div className="mui fwk-fod" ref={swipeRef}>
            <header className="fwk-nav">
                <button type="button" className="fwk-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Nalozi
                </button>
            </header>

            {loading && !detail && <div className="fld-loading">Učitavanje…</div>}
            {error && <MEmpty title="Nalog nije učitan" sub={error} />}

            {detail && (
                <>
                    <div className="mui-large">
                        <h1>{detail.name}</h1>
                        <p>
                            <MPill tone={detail.isPaused ? 'orange' : detail.status === 'Na čekanju' ? 'gray' : 'blue'}>
                                {detail.isPaused ? 'Pauziran' : detail.status}
                            </MPill>
                            <span>
                                {detail.projectName || `#${detail.number}`}
                                {due && <span className={due.cls}> · {due.text}</span>}
                            </span>
                        </p>
                    </div>

                    {pendingHere > 0 && (
                        <div className="fld-notice fld-notice--info">
                            <Hourglass size={16} />
                            <span><b>{pendingHere}</b> {pendingHere === 1 ? 'prijedlog čeka' : 'prijedloga čeka'} potvrdu poslodavca.</span>
                        </div>
                    )}

                    <MProgress
                        pct={detail.progressPct}
                        tone={detail.progressPct >= 100 ? 'green' : undefined}
                        label={<><b>{detail.progressPct}%</b> gotovo</>}
                    />

                    {/* ── Hero akcije naloga ──────────────────────────── */}
                    {!readOnly && (
                        <MActions>
                            {detail.status === 'Na čekanju' && (
                                <MAction tone="green" disabled={busy} onClick={() => submit({ kind: 'order_start', payload: {}, workOrderId: orderId })}>
                                    <Play size={17} /> Pokreni nalog
                                </MAction>
                            )}
                            {detail.status === 'U toku' && (
                                <>
                                    <MAction tone="otint" disabled={busy}
                                        onClick={() => submit({ kind: 'order_pause', payload: { paused: !detail.isPaused }, workOrderId: orderId })}>
                                        <Pause size={17} /> {detail.isPaused ? 'Nastavi' : 'Pauza'}
                                    </MAction>
                                    <MAction tone="tint" disabled={busy}
                                        onClick={() => submit({ kind: 'order_complete', payload: {}, workOrderId: orderId })}>
                                        <Flag size={17} /> Završi
                                    </MAction>
                                </>
                            )}
                        </MActions>
                    )}

                    <div className="fld-seg">
                        <MSegmented<Tab>
                            value={tab}
                            onChange={setTab}
                            options={[
                                { id: 'flow', label: `Tok ${detail.flow.length}` },
                                { id: 'products', label: `Proizvodi ${detail.items.length}` },
                                { id: 'tasks', label: `Napomene ${detail.tasks.length}` },
                            ]}
                        />
                    </div>

                    {/* ── Tok procesa: u toku gore, gotovi ispod ──────── */}
                    {tab === 'flow' && (
                        <>
                            {!readOnly && (
                                <div style={{ padding: '2px 0 10px' }}>
                                    <MButton variant="tinted" onClick={() => { setText(''); setAddProcOpen(true); }}>
                                        <Plus size={18} /> Dodaj proces
                                    </MButton>
                                </div>
                            )}
                            {detail.flow.length === 0 ? (
                                <MEmpty title="Nema toka" sub="Nalog još nema definisane procese." />
                            ) : (() => {
                                const openRows = detail.flow.filter(r => r.state !== 'done');
                                const doneRows = detail.flow.filter(r => r.state === 'done');
                                const renderRow = (row: ProcRow) => {
                                    const meta = STATE_META[row.state];
                                    return (
                                        <MItem key={row.id}>
                                            <MCell onClick={readOnly ? undefined : () => setProcSheet(row)} chevron={!readOnly}>
                                                <MIcon tone={meta.tone}><meta.Icon size={19} /></MIcon>
                                                <MText
                                                    title={row.name}
                                                    sub={<>
                                                        <MPill tone={meta.tone}>{meta.label}</MPill>
                                                        {row.total > 1 && <span>{row.done}/{row.total} proizvoda</span>}
                                                        {row.workers.length > 0 && <span>{row.workers.join(', ')}</span>}
                                                    </>}
                                                />
                                            </MCell>
                                        </MItem>
                                    );
                                };
                                return (
                                    <>
                                        {openRows.length > 0 && <MList lead>{openRows.map(renderRow)}</MList>}
                                        {doneRows.length > 0 && (
                                            <>
                                                <MSection title="Gotovo" right={<span className="mui-dim">{doneRows.length}</span>} />
                                                <MList lead>{doneRows.map(renderRow)}</MList>
                                            </>
                                        )}
                                    </>
                                );
                            })()}
                        </>
                    )}

                    {/* ── Proizvodi ───────────────────────────────────── */}
                    {tab === 'products' && (
                        detail.items.length === 0 ? (
                            <MEmpty title="Nema proizvoda" sub="Nalog još nema unesene proizvode." />
                        ) : (
                            <div className="mui-elist">
                                {detail.items.map(it => {
                                    const canOpen = productById.has(it.productId);
                                    return (
                                        <div key={it.itemId}>
                                            <MCard onClick={canOpen ? () => setOpenProductId(it.productId) : undefined}>
                                                <MCardHead>
                                                    <MCardBody
                                                        name={it.productName}
                                                        meta={<>
                                                            <MPill tone={it.isPaused ? 'orange' : it.status === 'Završeno' ? 'green' : 'gray'}>
                                                                {it.isPaused ? 'Pauziran' : it.status}
                                                            </MPill>
                                                            <span>×{it.quantity}{it.projectName ? ` · ${it.projectName}` : ''}</span>
                                                        </>}
                                                    />
                                                </MCardHead>
                                                <MProgress
                                                    pct={it.progressPct}
                                                    tone={it.progressPct >= 100 ? 'green' : undefined}
                                                    label={<><b>{it.progressPct}%</b>{canOpen ? ' · materijali →' : ''}</>}
                                                />
                                            </MCard>
                                            {!readOnly && it.canComplete && (
                                                <MActions>
                                                    <MAction tone="green" disabled={busy}
                                                        onClick={() => submit({ kind: 'item_complete', payload: { itemId: it.itemId, date: todayISO() }, workOrderId: orderId })}>
                                                        <Flag size={16} /> Predloži zatvaranje
                                                    </MAction>
                                                </MActions>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {/* ── Napomene ────────────────────────────────────── */}
                    {tab === 'tasks' && (
                        <>
                            {!readOnly && (
                                <div style={{ padding: '2px 0 10px' }}>
                                    <MButton variant="tinted" onClick={() => { setText(''); setAddTaskOpen(true); }}>
                                        <Plus size={18} /> Dodaj napomenu
                                    </MButton>
                                </div>
                            )}
                            {detail.tasks.length === 0 ? (
                                <MEmpty title="Nema napomena" sub="Dodaj napomenu — odmah se vidi, poslodavac dobije obavijest." />
                            ) : (
                                <MList lead>
                                    {detail.tasks.map(t => (
                                        <MItem key={t.taskId}>
                                            <MCell done={t.status === 'completed'}>
                                                <MCheck
                                                    on={t.status === 'completed'}
                                                    disabled={readOnly || noteBusy}
                                                    onClick={() => noteAction(
                                                        () => toggleNote(t.taskId, t.status !== 'completed'),
                                                        t.status !== 'completed' ? 'Označeno gotovim' : 'Vraćeno',
                                                    )}
                                                />
                                                <MText
                                                    title={t.title}
                                                    sub={<>
                                                        <MPill tone={PRIORITY_TONE[t.priority] || 'gray'}>{t.priority}</MPill>
                                                        {t.assignedWorkerName && <span>{t.assignedWorkerName}</span>}
                                                        {t.checklistTotal > 0 && <span>{t.checklistDone}/{t.checklistTotal}</span>}
                                                    </>}
                                                />
                                                {!readOnly && (
                                                    <button
                                                        type="button" className="fwk-iconbtn danger" aria-label="Obriši napomenu"
                                                        onClick={(e) => { e.stopPropagation(); noteAction(() => deleteNote(t.taskId), 'Napomena obrisana'); }}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </MCell>
                                        </MItem>
                                    ))}
                                </MList>
                            )}
                        </>
                    )}

                    {detail.notes && (
                        <>
                            <MSection title="Napomena" />
                            <p className="fwk-hint">{detail.notes}</p>
                        </>
                    )}
                </>
            )}

            {/* ── Sheet: radnje procesa ───────────────────────────────── */}
            <MSheet open={!!procSheet} title={procSheet?.name} onClose={() => setProcSheet(null)}>
                {procSheet && (
                    <div className="fwk-sheet-actions">
                        {procSheet.state !== 'done' && (
                            <MButton variant="gfilled" disabled={busy}
                                onClick={() => submit({ kind: 'process_check', payload: { targets: targetsOf(procSheet), action: 'complete', date: todayISO() }, workOrderId: orderId })}>
                                <CheckCircle2 size={18} /> Označi gotovim
                            </MButton>
                        )}
                        {procSheet.state === 'blocked' && (
                            <MButton variant="tinted" disabled={busy}
                                onClick={() => submit({ kind: 'process_check', payload: { targets: targetsOf(procSheet), action: 'start' }, workOrderId: orderId })}>
                                <Play size={18} /> Pokreni proces
                            </MButton>
                        )}
                        {procSheet.state === 'done' && (
                            <MButton variant="tinted" disabled={busy}
                                onClick={() => submit({ kind: 'process_check', payload: { targets: targetsOf(procSheet), action: 'reset' }, workOrderId: orderId })}>
                                <Circle size={18} /> Poništi
                            </MButton>
                        )}
                        <MButton variant="danger" disabled={busy}
                            onClick={() => submit({ kind: 'process_remove', payload: { targets: targetsOf(procSheet) }, workOrderId: orderId })}>
                            <Trash2 size={18} /> Obriši proces
                        </MButton>
                    </div>
                )}
            </MSheet>

            {/* ── Sheet: dodaj proces ─────────────────────────────────── */}
            <MSheet open={addProcOpen} title="Dodaj proces" onClose={() => setAddProcOpen(false)}>
                <input
                    className="fwk-input" placeholder="Naziv procesa (npr. Lakiranje)" value={text}
                    onChange={(e) => setText(e.target.value)} autoFocus
                />
                <div className="fld-submit">
                    <MButton variant="filled" disabled={busy || !text.trim()}
                        onClick={() => submit({ kind: 'process_add', payload: { itemIds: detail?.items.map(i => i.itemId) || [], procName: text.trim() }, workOrderId: orderId })}>
                        Pošalji prijedlog
                    </MButton>
                </div>
            </MSheet>

            {/* ── Sheet: dodaj napomenu (direktno, bez odobrenja) ─────── */}
            <MSheet open={addTaskOpen} title="Nova napomena" onClose={() => setAddTaskOpen(false)}>
                <input
                    className="fwk-input" placeholder="Upiši napomenu…" value={text}
                    onChange={(e) => setText(e.target.value)} autoFocus
                />
                <div className="fld-submit">
                    <MButton variant="filled" disabled={noteBusy || !text.trim()}
                        onClick={() => noteAction(() => createNote({ title: text.trim(), workOrderId: orderId }), 'Napomena kreirana')}>
                        Sačuvaj napomenu
                    </MButton>
                </div>
            </MSheet>
        </div>
    );
}
