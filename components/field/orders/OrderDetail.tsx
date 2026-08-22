'use client';

// ════════════════════════════════════════════════════════════════════
// NALOG — detalj
//
// Isti obrazac kao MobileWorkOrderDetail: puni ekran, hero s napretkom i
// rokom, pa segmentna kontrola. Hero nosi NAPREDAK, ne novac — a ovdje ni
// ne može, jer projekcija iznose ni ne sadrži.
//
// Tabovi: Tok (čekiranje procesa) · Proizvodi (zatvaranje) · Knjiga (ko je radio
// kojeg dana) · Zadaci (problemi).
//
// „Dodaj proces" NAMJERNO nije ovdje — ono mijenja graf naloga, što je
// vlasnikova odluka, ne kontrolorova.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft, Check, ChevronDown, ChevronRight, CircleDot, Lock, Plus, RotateCcw,
} from 'lucide-react';
import { useFieldOrderDetail } from '@/lib/field/useFieldOrders';
import {
    MHero, MSegmented, MSection, MList, MItem, MCell, MText, MPill,
    MEmpty, MButton, MProgress, MSheet, MCheck,
} from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';
import CompleteSheet from './CompleteSheet';
import WorkLogPanel from './WorkLogPanel';

type Tab = 'tok' | 'proizvodi' | 'knjiga' | 'zadaci';

const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function dueText(days: number | null): string | null {
    if (days === null) return null;
    if (days < 0) return `kasni ${-days} ${-days === 1 ? 'dan' : 'dana'}`;
    if (days === 0) return 'rok danas';
    return `rok za ${days} ${days === 1 ? 'dan' : 'dana'}`;
}

const PRIORITY_TONE: Record<string, 'red' | 'orange' | 'blue' | 'gray'> = {
    urgent: 'red', high: 'orange', medium: 'blue', low: 'gray',
};

interface Props {
    orderId: string;
    onClose: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    readOnly?: boolean;
}

export default function OrderDetail({ orderId, onClose, showToast, readOnly }: Props) {
    const {
        detail, loading, error, reload,
        updateProcess, completeProduct, reopenProduct, toggleTask, addTask,
    } = useFieldOrderDetail(orderId);

    const [tab, setTab] = useState<Tab>('tok');
    const [expanded, setExpanded] = useState<string | null>(null);
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [completeFor, setCompleteFor] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [taskOpen, setTaskOpen] = useState(false);
    const [taskTitle, setTaskTitle] = useState('');
    const [taskPriority, setTaskPriority] = useState('medium');
    const [confirmItem, setConfirmItem] = useState<{ itemId: string; name: string } | null>(null);

    // Hardverska nazad-tipka i swipe zatvaraju ekran — ista pogodba kao
    // ostali puni ekrani u aplikaciji.
    useEffect(() => {
        window.history.pushState({ fieldOrder: true }, '');
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
    const swipeRef = useSwipeBack(goBack, { enabled: !completeFor && !taskOpen && !confirmItem });

    const activeRow = useMemo(
        () => detail?.flow.find(r => r.id === completeFor) || null,
        [detail, completeFor]
    );

    /** Radnici koji su već na tom procesu — prijedlog za sheet. */
    const suggestedWorkerIds = useMemo(() => {
        if (!activeRow || !detail) return [];
        const out: string[] = [];
        for (const p of activeRow.perItem) {
            if (!sel.has(p.itemId)) continue;
            for (const h of p.helpers || []) if (h.Worker_ID && !out.includes(h.Worker_ID)) out.push(h.Worker_ID);
        }
        // Ako ništa nije zapisano, ekipa naloga je bolji prijedlog od praznog.
        return out.length > 0 ? out : detail.crew.slice(0, 1).map(c => c.workerId);
    }, [activeRow, detail, sel]);

    const toggleExpand = (rowId: string, perItem: { itemId: string; status: string }[]) => {
        if (expanded === rowId) { setExpanded(null); setSel(new Set()); return; }
        setExpanded(rowId);
        // Podrazumijevani odabir = ono što NIJE gotovo (najčešća radnja).
        setSel(new Set(perItem.filter(p => p.status !== 'Završeno').map(p => p.itemId)));
    };

    const run = async (fn: () => Promise<void>, okMessage: string) => {
        if (busy) return;
        setBusy(true);
        try {
            await fn();
            showToast(okMessage, 'success');
        } catch (e: any) {
            showToast(e?.message || 'Radnja nije uspjela', 'error');
        } finally {
            setBusy(false);
        }
    };

    if (loading && !detail) {
        return (
            <div className="mui fod" ref={swipeRef}>
                <header className="mwd-nav mui-subnav">
                    <button type="button" className="mwd-back" onClick={goBack}>
                        <ArrowLeft size={21} strokeWidth={2.3} /> Nalozi
                    </button>
                </header>
                <div className="fld-loading">Učitavanje…</div>
            </div>
        );
    }

    if (error || !detail) {
        return (
            <div className="mui fod" ref={swipeRef}>
                <header className="mwd-nav mui-subnav">
                    <button type="button" className="mwd-back" onClick={goBack}>
                        <ArrowLeft size={21} strokeWidth={2.3} /> Nalozi
                    </button>
                </header>
                <MEmpty title="Nalog nije učitan" sub={error || undefined}>
                    <div style={{ width: '100%', paddingTop: 14 }}>
                        <MButton variant="filled" onClick={reload}>Pokušaj ponovo</MButton>
                    </div>
                </MEmpty>
            </div>
        );
    }

    const openTasks = detail.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');

    return (
        <div className="mui fod" ref={swipeRef}>
            <header className="mwd-nav mui-subnav">
                <button type="button" className="mwd-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Nalozi
                </button>
            </header>

            <div className="mui-large">
                <h1>{detail.name}</h1>
                <p>
                    <MPill tone={detail.isPaused ? 'orange' : detail.status === 'U toku' ? 'blue' : 'gray'}>
                        {detail.isPaused ? 'Pauziran' : detail.status}
                    </MPill>
                    <span>#{detail.number}{detail.projectName ? ` · ${detail.projectName}` : ''}</span>
                </p>
            </div>

            <MHero
                kicker="Napredak naloga"
                value={<>{detail.progressPct}<small>%</small></>}
                chip={dueText(detail.daysUntilDue) || undefined}
                pct={detail.progressPct}
                green={detail.progressPct >= 100}
            />

            <div className="fld-seg">
                <MSegmented<Tab>
                    value={tab}
                    onChange={setTab}
                    options={[
                        { id: 'tok', label: 'Tok' },
                        { id: 'proizvodi', label: `Proizvodi ${detail.items.length}` },
                        { id: 'knjiga', label: 'Knjiga' },
                        { id: 'zadaci', label: `Zadaci ${openTasks.length}` },
                    ]}
                />
            </div>

            {/* ── TOK ─────────────────────────────────────────────────── */}
            {tab === 'tok' && (
                detail.flow.length === 0 ? (
                    <MEmpty title="Nema procesa" sub="Nalog još nema definisan tok proizvodnje." />
                ) : (
                    <div className="fod-flow">
                        {detail.flow.map(row => {
                            const isOpen = expanded === row.id;
                            const pct = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;

                            return (
                                <div key={row.id} className={`fod-row ${row.state}`}>
                                    <button
                                        type="button"
                                        className="fod-row-head"
                                        onClick={() => toggleExpand(row.id, row.perItem)}
                                    >
                                        <span className="fod-row-icon">
                                            {row.state === 'done' ? <Check size={17} strokeWidth={3} />
                                                : row.state === 'blocked' ? <Lock size={15} />
                                                    : <CircleDot size={16} />}
                                        </span>
                                        <span className="fod-row-main">
                                            <span className="fod-row-name">{row.name}</span>
                                            <span className="fod-row-meta">
                                                {row.state === 'blocked' && <MPill tone="gray">čeka prethodni</MPill>}
                                                {row.state === 'active' && <MPill tone="blue">na redu</MPill>}
                                                <span>{row.done}/{row.total} gotovo</span>
                                                {row.workers.length > 0 && <span>· {row.workers.slice(0, 2).join(', ')}</span>}
                                            </span>
                                        </span>
                                        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    </button>

                                    <MProgress pct={pct} tone={pct >= 100 ? 'green' : undefined} />

                                    {isOpen && (
                                        <div className="fod-row-body">
                                            {row.perItem.map(p => {
                                                const done = p.status === 'Završeno';
                                                return (
                                                    <button
                                                        key={p.itemId}
                                                        type="button"
                                                        className={`fod-item${sel.has(p.itemId) ? ' on' : ''}${done ? ' done' : ''}`}
                                                        disabled={readOnly}
                                                        onClick={() => setSel(prev => {
                                                            const n = new Set(prev);
                                                            if (n.has(p.itemId)) n.delete(p.itemId); else n.add(p.itemId);
                                                            return n;
                                                        })}
                                                    >
                                                        <span className={`fbk-check${sel.has(p.itemId) ? ' on' : ''}`}>
                                                            {sel.has(p.itemId) && <Check size={14} strokeWidth={3.4} />}
                                                        </span>
                                                        <span className="fod-item-main">
                                                            <span className="fod-item-name">{p.itemName}</span>
                                                            <span className="fod-item-meta">
                                                                {done
                                                                    ? <>gotovo{p.workerName ? ` · ${p.workerName}` : ''}</>
                                                                    : p.status}
                                                            </span>
                                                        </span>
                                                    </button>
                                                );
                                            })}

                                            {!readOnly && (
                                                <div className="fod-actions">
                                                    <button
                                                        type="button"
                                                        className="fod-act primary"
                                                        disabled={busy || sel.size === 0}
                                                        onClick={() => setCompleteFor(row.id)}
                                                    >
                                                        <Check size={17} strokeWidth={2.6} /> Završi ({sel.size})
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="fod-act"
                                                        disabled={busy || sel.size === 0}
                                                        onClick={() => run(
                                                            () => updateProcess('reset',
                                                                row.perItem.filter(p => sel.has(p.itemId))
                                                                    .map(p => ({ itemId: p.itemId, procName: p.procName }))),
                                                            'Vraćeno na čekanje'
                                                        )}
                                                    >
                                                        <RotateCcw size={16} /> Vrati
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )
            )}

            {/* ── PROIZVODI ───────────────────────────────────────────── */}
            {tab === 'proizvodi' && (
                <>
                    <MSection title="Proizvodi u nalogu" right={<span className="mui-dim">{detail.items.length}</span>} />
                    <div className="mui-elist">
                        {detail.items.map(it => (
                            <div key={it.itemId} className="fod-product">
                                <div className="fod-product-head">
                                    <span className="fod-product-name">{it.productName}</span>
                                    <MPill tone={it.status === 'Završeno' ? 'green' : it.isPaused ? 'orange' : 'blue'}>
                                        {it.isPaused ? 'Pauziran' : it.status}
                                    </MPill>
                                </div>
                                <span className="fod-product-meta">
                                    {it.quantity > 1 && `${it.quantity} kom · `}{it.projectName}
                                </span>
                                <MProgress
                                    pct={it.progressPct}
                                    tone={it.progressPct >= 100 ? 'green' : undefined}
                                    label={<b>{it.progressPct}%</b>}
                                />
                                {!readOnly && (
                                    it.status === 'Završeno' ? (
                                        <button
                                            type="button"
                                            className="fod-act"
                                            disabled={busy}
                                            onClick={() => run(() => reopenProduct(it.itemId), 'Proizvod vraćen u rad')}
                                        >
                                            <RotateCcw size={16} /> Vrati u rad
                                        </button>
                                    ) : it.canComplete ? (
                                        <button
                                            type="button"
                                            className="fod-act primary"
                                            disabled={busy}
                                            onClick={() => setConfirmItem({ itemId: it.itemId, name: it.productName })}
                                        >
                                            <Check size={17} strokeWidth={2.6} /> Završi proizvod
                                        </button>
                                    ) : (
                                        <p className="fod-hint">Svi procesi moraju biti gotovi prije zatvaranja.</p>
                                    )
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* ── KNJIGA RADA ─────────────────────────────────────────── */}
            {tab === 'knjiga' && (
                <WorkLogPanel orderId={orderId} readOnly={readOnly} showToast={showToast} onChanged={reload} />
            )}

            {/* ── ZADACI ──────────────────────────────────────────────── */}
            {tab === 'zadaci' && (
                <>
                    {!readOnly && (
                        <div className="fod-addtask">
                            <button type="button" className="fat-bulk" onClick={() => setTaskOpen(true)}>
                                <Plus size={18} /> Prijavi problem
                            </button>
                        </div>
                    )}

                    {detail.tasks.length === 0 ? (
                        <MEmpty
                            title="Nema zadataka"
                            sub="Kad nešto zapne, prijavi problem — zadatak stiže vlasniku odmah."
                        />
                    ) : (
                        <MList>
                            {detail.tasks.map(t => {
                                const done = t.status === 'completed';
                                return (
                                    <MItem key={t.taskId}>
                                        <MCell done={done}>
                                            <MCheck
                                                on={done}
                                                disabled={readOnly || busy}
                                                label={t.title}
                                                onClick={() => run(() => toggleTask(t.taskId, !done), done ? 'Vraćeno' : 'Riješeno')}
                                            />
                                            <MText
                                                title={t.title}
                                                sub={<>
                                                    <MPill tone={PRIORITY_TONE[t.priority] || 'gray'}>{t.priority}</MPill>
                                                    {t.assignedWorkerName && <span>{t.assignedWorkerName}</span>}
                                                    {t.checklistTotal > 0 && <span>{t.checklistDone}/{t.checklistTotal}</span>}
                                                </>}
                                            />
                                        </MCell>
                                    </MItem>
                                );
                            })}
                        </MList>
                    )}
                </>
            )}

            {/* ── Sheetovi ────────────────────────────────────────────── */}
            <CompleteSheet
                open={!!completeFor}
                processName={activeRow?.name || ''}
                itemCount={sel.size}
                crew={detail.crew}
                suggestedWorkerIds={suggestedWorkerIds}
                busy={busy}
                onClose={() => setCompleteFor(null)}
                onConfirm={async ({ workerIds, date, notes }) => {
                    if (!activeRow) return;
                    const targets = activeRow.perItem
                        .filter(p => sel.has(p.itemId))
                        .map(p => ({ itemId: p.itemId, procName: p.procName }));
                    await run(
                        () => updateProcess('complete', targets, { date, workerIds, notes }),
                        `${activeRow.name} — završeno`
                    );
                    setCompleteFor(null);
                    setSel(new Set());
                    setExpanded(null);
                }}
            />

            <MSheet open={taskOpen} title="Prijavi problem" onClose={() => setTaskOpen(false)}>
                <div className="fod-field">
                    <label htmlFor="fod-task">Šta je problem</label>
                    <input
                        id="fod-task"
                        value={taskTitle}
                        onChange={e => setTaskTitle(e.target.value)}
                        placeholder="npr. fali okov za gornje elemente"
                        autoFocus
                    />
                </div>
                <div className="mui-shd"><span>Hitnost</span></div>
                <div className="fat-secondary">
                    {['low', 'medium', 'high', 'urgent'].map(p => (
                        <button
                            key={p}
                            type="button"
                            className={`mui-chip${taskPriority === p ? ' on' : ''}`}
                            onClick={() => setTaskPriority(p)}
                        >
                            {p === 'low' ? 'Nisko' : p === 'medium' ? 'Srednje' : p === 'high' ? 'Visoko' : 'Hitno'}
                        </button>
                    ))}
                </div>
                <div className="fod-confirm-wrap">
                    <button
                        type="button"
                        className="fbk-confirm"
                        disabled={busy || !taskTitle.trim()}
                        onClick={async () => {
                            await run(
                                () => addTask({ title: taskTitle.trim(), priority: taskPriority }),
                                'Problem prijavljen'
                            );
                            setTaskTitle('');
                            setTaskPriority('medium');
                            setTaskOpen(false);
                        }}
                    >
                        {busy ? 'Šaljem…' : 'Pošalji'}
                    </button>
                </div>
            </MSheet>

            <MSheet
                open={!!confirmItem}
                title="Završiti proizvod?"
                onClose={() => setConfirmItem(null)}
            >
                <p className="fat-sheet-sub">
                    <b>{confirmItem?.name}</b> — trošak rada se zamrzava i proizvod se zatvara.
                    Vlasnik ga može vratiti u rad ako zatreba.
                </p>
                <div className="fod-confirm-wrap">
                    <button
                        type="button"
                        className="fbk-confirm"
                        disabled={busy}
                        onClick={async () => {
                            if (!confirmItem) return;
                            await run(
                                () => completeProduct(confirmItem.itemId, todayISO()),
                                `${confirmItem.name} — završeno`
                            );
                            setConfirmItem(null);
                        }}
                    >
                        {busy ? 'Snimam…' : 'Da, završi'}
                    </button>
                </div>
            </MSheet>
        </div>
    );
}
