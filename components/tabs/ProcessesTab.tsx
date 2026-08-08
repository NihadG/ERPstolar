'use client';

// ════════════════════════════════════════════════════════════════════
// PROCESI — DVIJE LEĆE nad istim skupom zadataka (nalog × proces):
//
//   • PO NALOGU  — napredak svake EKIPE kroz njen tok (kartica po nalogu).
//                  Odgovara: „dokle je ovaj posao stigao?"
//   • PO PROCESU — red čekanja po STANICI (kartica po procesu).
//                  Odgovara: „ko sve čeka na lakiranju / brušenju?"
//
// Zašto dvije leće: „po nalogu" se preklapa s tabom Nalozi. Tek „po procesu"
// daje Procesima zasebnu svrhu — pregled opterećenja stanica preko svih naloga.
// Ista, testirana logika (lib/processBoard.ts); mijenja se samo grupisanje.
//
// PRAVILA LAYOUTA (nose cijeli izgled):
//  1. NA REDU je jedino istaknuto — ostalo je tiho. Nalog ima 30+ procesa,
//     ali u datom trenutku radiš 2-3; prikazati svih 30 znači ne prikazati ništa.
//  2. Glagol je VIDLJIV: svaki red ima dugme „Završi". Checkbox je SAMO za
//     grupni odabir — checkbox pored procesa inače laže („gotovo je"), a selektuje.
//  3. AKCENAT JE REZERVISAN ZA RADNJU: jedini akcentni elementi su dugme „Završi"
//     i traka napretka na 100%. Bedževi stanja koriste meke tonove.
//
// JEDINICA RADA = ZADATAK (nalog × proces): „Priprema masive" za 3 proizvoda je
// JEDNA kartica i JEDAN klik; strelica je rastavi na proizvode kad treba dio.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useCallback } from 'react';
import type { WorkOrder, Worker, WorkLog, ProcessCatalogItem, ItemProcessStatus } from '@/lib/types';
import { useData } from '@/context/DataContext';
import { getProcessCatalog, updateItemProcess } from '@/lib/services';
import {
    buildProcessCells, groupByOrder, groupByProcess, sortOrdersForBoard, isOrderPaused,
    type ProcessCell, type ProcessTask,
} from '@/lib/processBoard';
import { workOrderDisplayName } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import ProcessCatalogModal from '@/components/ui/ProcessCatalogModal';
import ProcessGraphModal from '@/components/ui/ProcessGraphModal';
import './ProcessesTab.css';

interface Props {
    workOrders: WorkOrder[];
    workers: Worker[];
    workLogs: WorkLog[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onNavigateToOrder?: (workOrderId: string) => void;
}

type Lens = 'order' | 'process';
type OrderFlags = { paused: boolean; today: boolean; waiting: boolean };

const cellKey = (c: ProcessCell) => `${c.workOrderId}|${c.itemId}|${c.itemProcessName}`;
const todayISO = () => new Date().toISOString().split('T')[0];
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('hr-HR', { day: '2-digit', month: '2-digit' }) : '');
const plural = (n: number, one: string, few: string) => `${n} ${n === 1 ? one : few}`;

/** Ćelije koje se SMIJU mijenjati: nezavršene, i proces im je na redu (ili već pokrenut). */
const selectableOf = (t: ProcessTask) =>
    t.cells.filter(c => c.status !== 'Završeno' && (t.gate === 'active' || c.status === 'U toku'));

/** NA REDU = radi se sada ili može odmah početi. Ostalo: čeka prethodni / završeno. */
const isNow = (t: ProcessTask) =>
    t.status !== 'Završeno' && (t.gate === 'active' || t.status === 'U toku' || t.status === 'Djelimično');
const isDone = (t: ProcessTask) => t.status === 'Završeno';
const partition = (tasks: ProcessTask[]) => ({
    now: tasks.filter(isNow),
    waiting: tasks.filter(t => !isNow(t) && !isDone(t)),
    done: tasks.filter(isDone),
});

export default function ProcessesTab({ workOrders, workers, workLogs, onRefresh, showToast, onNavigateToOrder }: Props) {
    const { organizationId } = useData();
    const [lens, setLens] = useState<Lens>('order');
    const [search, setSearch] = useState('');
    const [includeWaiting, setIncludeWaiting] = useState(false);
    const [catalog, setCatalog] = useState<ProcessCatalogItem[]>([]);
    const [catalogModal, setCatalogModal] = useState(false);
    const [graphOrderId, setGraphOrderId] = useState<string | null>(null);
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());   // zadatak → proizvodi
    const [openSec, setOpenSec] = useState<Set<string>>(new Set());     // sklopive sekcije (čeka/završeno)
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState<{ workerIds: string[]; date: string; notes: string }>({ workerIds: [], date: todayISO(), notes: '' });
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!organizationId) return;
        let cancelled = false;
        getProcessCatalog(organizationId).then(c => { if (!cancelled) setCatalog(c); }).catch(() => { });
        return () => { cancelled = true; };
    }, [organizationId]);

    const workerName = useCallback((id: string) => workers.find(w => w.Worker_ID === id)?.Name || 'Nepoznat', [workers]);

    /** Nalozi na kojima se DANAS knjižio rad — najjači signal „ovo je danas u pogonu". */
    const workedTodayOrderIds = useMemo(() => {
        const t = todayISO();
        const ids = new Set<string>();
        for (const l of workLogs) if (l.Date === t && l.Work_Order_ID) ids.add(l.Work_Order_ID);
        return ids;
    }, [workLogs]);

    // Opseg: SAMO proizvodnja. „Montaža" ima fiksne korake, a „Zadaci" (Razni poslovi) su
    // ad-hoc rad bez plana procesa — njihov jedini „proces" je generički „Rad" koji ovdje ne
    // znači ništa (prate se kroz šihtaricu/dnevnice). Legacy nalozi bez tipa = proizvodnja.
    // Status: U toku (default) + Na čekanju (toggle); nikad Otkazano/Završeno.
    // Redoslijed: u toku → pauzirani → na čekanju; unutar toga današnji rad prvi, pa najnoviji.
    const ordersInScope = useMemo(() => sortOrdersForBoard(
        workOrders
            .filter(wo => (wo.Work_Order_Type || 'Proizvodnja') === 'Proizvodnja')
            .filter(wo => wo.Status === 'U toku' || (includeWaiting && wo.Status === 'Na čekanju'))
            .map(wo => ({ workOrder: wo, items: wo.items || [], orderLabel: workOrderDisplayName(wo) })),
        workedTodayOrderIds,
    ), [workOrders, includeWaiting, workedTodayOrderIds]);

    const orderFlags = useMemo(() => {
        const m = new Map<string, OrderFlags>();
        for (const o of ordersInScope) {
            m.set(o.workOrder.Work_Order_ID, {
                paused: isOrderPaused(o.items),
                today: workedTodayOrderIds.has(o.workOrder.Work_Order_ID),
                waiting: o.workOrder.Status === 'Na čekanju',
            });
        }
        return m;
    }, [ordersInScope, workedTodayOrderIds]);

    const cells = useMemo(() => buildProcessCells(ordersInScope, catalog, workLogs), [ordersInScope, catalog, workLogs]);

    const ordersWithoutProcesses = useMemo(() => {
        const withCells = new Set(cells.map(c => c.workOrderId));
        return ordersInScope.filter(o => !withCells.has(o.workOrder.Work_Order_ID));
    }, [ordersInScope, cells]);

    const graphOrder = graphOrderId ? workOrders.find(wo => wo.Work_Order_ID === graphOrderId) : null;

    const q = search.trim().toLowerCase();
    const filteredCells = useMemo(() => !q ? cells : cells.filter(c =>
        c.orderLabel.toLowerCase().includes(q) || c.itemName.toLowerCase().includes(q) || c.processName.toLowerCase().includes(q)
    ), [cells, q]);

    const cellByKey = useMemo(() => new Map(cells.map(c => [cellKey(c), c])), [cells]);
    const selectedCells = useMemo(() => Array.from(sel).map(k => cellByKey.get(k)).filter(Boolean) as ProcessCell[], [sel, cellByKey]);

    const orderGroups = useMemo(() => groupByOrder(filteredCells), [filteredCells]);
    const processGroups = useMemo(() => groupByProcess(filteredCells), [filteredCells]);

    /**
     * Orijentacija na vrhu — oblik dana u jednoj rečenici (ista za obje leće).
     * SVI brojevi se računaju nad ISTIM skupom (ordersInScope), inače rezime laže.
     */
    const summary = useMemo(() => {
        const nowCount = orderGroups.reduce((n, g) => n + g.tasks.filter(isNow).length, 0);
        const flags = Array.from(orderFlags.values());
        return {
            orders: ordersInScope.length,
            nowCount,
            paused: flags.filter(f => f.paused).length,
            today: flags.filter(f => f.today).length,
        };
    }, [orderGroups, orderFlags, ordersInScope]);

    // ── ODABIR ──────────────────────────────────────────────────────────
    const toggleCell = (c: ProcessCell) => setSel(prev => {
        const n = new Set(prev); const k = cellKey(c);
        n.has(k) ? n.delete(k) : n.add(k);
        return n;
    });
    const toggleTask = (t: ProcessTask) => {
        const keys = selectableOf(t).map(cellKey);
        if (!keys.length) return;
        const allOn = keys.every(k => sel.has(k));
        setSel(prev => {
            const n = new Set(prev);
            keys.forEach(k => allOn ? n.delete(k) : n.add(k));
            return n;
        });
    };
    const taskCheck = (t: ProcessTask): 'on' | 'off' | 'partial' => {
        const keys = selectableOf(t).map(cellKey);
        if (!keys.length) return 'off';
        const on = keys.filter(k => sel.has(k)).length;
        return on === 0 ? 'off' : on === keys.length ? 'on' : 'partial';
    };
    const toggleIn = (set: Set<string>, key: string) => {
        const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); return n;
    };

    // ── AKCIJE ──────────────────────────────────────────────────────────
    const runUpdate = async (cellsToUpdate: ProcessCell[], updates: Partial<ItemProcessStatus>) => {
        if (!cellsToUpdate.length || busy) return;
        setBusy(true);
        try {
            // Serijski: svaki updateItemProcess recalc-uje svoj nalog (namjerno, status-decoupled).
            for (const c of cellsToUpdate) await updateItemProcess(c.workOrderId, c.itemId, c.itemProcessName, updates);
            onRefresh('workOrders');
            setSel(new Set()); setFormOpen(false);
            showToast('Procesi ažurirani', 'success');
        } catch (e) {
            console.error('ProcessesTab update', e);
            showToast('Greška pri ažuriranju procesa', 'error');
        } finally { setBusy(false); }
    };

    /** Otvori formu završetka za DATE ćelije (radnici se prefilluju iz ekipe naloga). */
    const openCompleteForm = (target: ProcessCell[]) => {
        if (!target.length) return;
        const ordered: string[] = [];
        target.forEach(c => c.crewWorkerIds.forEach(id => { if (!ordered.includes(id)) ordered.push(id); }));
        setSel(new Set(target.map(cellKey)));   // forma radi nad odabirom → poravnaj ga s ciljem
        setForm({ workerIds: ordered, date: todayISO(), notes: '' });
        setFormOpen(true);
    };

    const confirmComplete = () => {
        const wIds = form.workerIds.filter(Boolean);
        const first = wIds[0] ? workers.find(w => w.Worker_ID === wIds[0]) : undefined;
        const helpers = wIds.slice(1).map(id => ({ Worker_ID: id, Worker_Name: workerName(id) }));
        return runUpdate(selectedCells, {
            Status: 'Završeno',
            Completed_At: new Date(form.date + 'T12:00:00').toISOString(),
            Worker_ID: first?.Worker_ID, Worker_Name: first?.Name,
            Helpers: helpers, Notes: form.notes.trim() || undefined,
        });
    };
    const startSelected = () => runUpdate(selectedCells, { Status: 'U toku', Started_At: new Date().toISOString() });

    // ── RENDER ──────────────────────────────────────────────────────────
    /** Traka napretka — čitljivija od prstena i ne otima pažnju naslovu. */
    const Bar = ({ done, total }: { done: number; total: number }) => {
        const pct = total ? Math.round((done / total) * 100) : 0;
        return (
            <span className="pt-bar" title={`${done}/${total} završeno`}>
                <span className="pt-bar-track"><span className={`pt-bar-fill ${pct >= 100 ? 'full' : ''}`} style={{ width: `${pct}%` }} /></span>
                <span className="pt-bar-txt">{done}/{total}</span>
            </span>
        );
    };

    /** Mali bedževi stanja naloga (danas / pauza / na čekanju) — dijeljeni između obje leće. */
    const OrderBadges = ({ f }: { f?: OrderFlags }) => (
        <>
            {f?.today && <span className="pt-badge today" title="Danas je knjižen rad na ovom nalogu">danas</span>}
            {f?.paused && <span className="pt-badge paused" title="Nalog je pauziran — dnevnice ne teku">pauza</span>}
            {f?.waiting && <span className="pt-badge waiting">na čekanju</span>}
        </>
    );

    /**
     * Red zadatka (nalog × proces) — isti u obje leće.
     *  • `primary='process'` (leća PO NALOGU): naslov = naziv procesa.
     *  • `primary='order'`   (leća PO PROCESU): naslov = naziv naloga + bedževi stanja.
     * `tone`: 'now' = akcijski (checkbox + „Završi"), 'quiet' = u sklopljenoj sekciji.
     */
    const TaskRow = ({ t, tone, primary = 'process', flags }: { t: ProcessTask; tone: 'now' | 'quiet'; primary?: 'process' | 'order'; flags?: OrderFlags }) => {
        const check = taskCheck(t);
        const canAct = selectableOf(t).length > 0;
        const isOpen = expanded.has(t.key);
        const multi = t.totalCount > 1;
        const title = primary === 'order' ? t.orderLabel : t.processName;
        const sub = multi ? plural(t.totalCount, 'proizvod', 'proizvoda') : t.itemNames[0];

        return (
            <div className={`pt-task ${tone} ${check !== 'off' ? 'sel' : ''} ${isDone(t) ? 'is-done' : ''}`}>
                <div className="pt-task-head">
                    {canAct && tone === 'now' ? (
                        <input type="checkbox" className="pt-check" checked={check === 'on'}
                            ref={el => { if (el) el.indeterminate = check === 'partial'; }}
                            onChange={() => toggleTask(t)} disabled={busy}
                            aria-label={`Odaberi ${title}`}
                            title={multi ? `Odaberi za svih ${t.totalCount} proizvoda` : 'Odaberi'} />
                    ) : (
                        <span className={`pt-dot ${isDone(t) ? 'done' : 'wait'}`}>
                            {isDone(t) && <span className="material-icons-round">check</span>}
                        </span>
                    )}

                    <button className="pt-task-main" onClick={() => multi && setExpanded(s => toggleIn(s, t.key))} disabled={!multi}
                        title={multi ? 'Prikaži proizvode' : undefined}>
                        <span className="pt-task-title">
                            {title}
                            {primary === 'order' && <OrderBadges f={flags} />}
                        </span>
                        <span className="pt-task-sub">
                            {sub}
                            {multi && <span className="pt-task-caret material-icons-round">{isOpen ? 'expand_less' : 'expand_more'}</span>}
                        </span>
                    </button>

                    {/* Bedževi napretka + glagol kao jedan blok, poravnati desno. */}
                    <div className="pt-task-aside">
                        {t.status === 'Djelimično' && <span className="pt-badge partial">{t.doneCount}/{t.totalCount}</span>}
                        {t.status === 'U toku' && <span className="pt-badge running">u toku</span>}
                        {t.hasLoggedWork && !isDone(t) && <span className="pt-badge logged" title="Ima knjižen rad">knjižen rad</span>}
                        {isDone(t) && (
                            <span className="pt-done-meta">
                                {t.completedAt ? fmtDate(t.completedAt) : ''}{t.workerNames.length ? ` · ${t.workerNames.join(', ')}` : ''}
                            </span>
                        )}

                        {/* GLAGOL JE VIDLJIV — bez ovoga checkbox „laže" da je označavanje = završetak */}
                        {tone === 'now' && canAct && (
                            <button className="pt-do" disabled={busy} onClick={() => openCompleteForm(selectableOf(t))}
                                title={multi ? `Završi za svih ${t.totalCount} proizvoda` : 'Završi ovaj proces'}>
                                <span className="material-icons-round">check</span> Završi
                            </button>
                        )}
                    </div>
                </div>

                {isOpen && (
                    <div className="pt-subs">
                        {t.cells.map(c => {
                            const k = cellKey(c);
                            const done = c.status === 'Završeno';
                            const sub2 = !done && (t.gate === 'active' || c.status === 'U toku');
                            return (
                                <div key={k} className={`pt-sub ${sel.has(k) ? 'sel' : ''} ${done ? 'is-done' : ''}`}>
                                    {sub2 ? (
                                        <input type="checkbox" className="pt-check sm" checked={sel.has(k)} onChange={() => toggleCell(c)} disabled={busy}
                                            aria-label={`Odaberi ${c.itemName}`} />
                                    ) : (
                                        <span className={`pt-dot sm ${done ? 'done' : 'wait'}`}>
                                            {done && <span className="material-icons-round">check</span>}
                                        </span>
                                    )}
                                    <span className="pt-sub-name">{c.itemName}</span>
                                    {done && <span className="pt-sub-meta">{c.completedAt ? fmtDate(c.completedAt) : ''}{c.workerName ? ` · ${c.workerName}` : ''}</span>}
                                    {!done && c.status === 'U toku' && <span className="pt-sub-meta">u toku</span>}
                                    {sub2 && (
                                        <button className="pt-do sm" disabled={busy} onClick={() => openCompleteForm([c])} title={`Završi samo ${c.itemName}`}>
                                            <span className="material-icons-round">check</span>
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    /** Sklopiva sekcija (Čeka / Završeno) — dostupno na jedan klik, ali ne zauzima ekran. */
    const Section = ({ id, label, tasks, primary = 'process' }: { id: string; label: string; tasks: ProcessTask[]; primary?: 'process' | 'order' }) => {
        if (tasks.length === 0) return null;
        const open = openSec.has(id);
        return (
            <div className={`pt-sec ${open ? 'open' : ''}`}>
                <button className="pt-sec-head" onClick={() => setOpenSec(s => toggleIn(s, id))} aria-expanded={open}>
                    <span className="material-icons-round">{open ? 'expand_more' : 'chevron_right'}</span>
                    {label} <span className="pt-sec-count">{tasks.length}</span>
                </button>
                {open && <div className="pt-sec-body">{tasks.map(t => <TaskRow key={t.key} t={t} tone="quiet" primary={primary} flags={primary === 'order' ? orderFlags.get(t.workOrderId) : undefined} />)}</div>}
            </div>
        );
    };

    // ── LEĆA PO NALOGU: kartica po nalogu (ekipa + tok) ──────────────────
    const renderOrderCard = (og: (typeof orderGroups)[number]) => {
        const f = orderFlags.get(og.workOrderId);
        const p = partition(og.tasks);
        return (
            <div key={og.workOrderId} className={`pt-card ${f?.paused ? 'is-paused' : ''}`}>
                <div className="pt-card-head" style={{ borderLeftColor: og.orderColor || 'var(--accent)' }}>
                    <button className="pt-card-id" onClick={() => onNavigateToOrder?.(og.workOrderId)} disabled={!onNavigateToOrder}>
                        <span className="pt-card-title">
                            {og.orderLabel}
                            <OrderBadges f={f} />
                        </span>
                        <span className="pt-card-sub">
                            {plural(og.productCount, 'proizvod', 'proizvoda')}
                            {og.crewWorkerIds.length > 0 && ` · ${og.crewWorkerIds.map(workerName).join(', ')}`}
                        </span>
                    </button>
                    <div className="pt-card-spacer" />
                    <Bar done={og.doneCount} total={og.totalCount} />
                    <button className="pt-btn" onClick={() => setGraphOrderId(og.workOrderId)}
                        title="Graf procesa naloga — uredi tok, dodaj ili ukloni procese">
                        <span className="material-icons-round">account_tree</span> Graf
                    </button>
                </div>

                <div className="pt-body">
                    {p.now.length > 0 ? (
                        <div className="pt-now">
                            <div className="pt-now-label">Na redu</div>
                            {p.now.map(t => <TaskRow key={t.key} t={t} tone="now" primary="process" />)}
                        </div>
                    ) : (
                        <div className="pt-note">
                            {p.done.length === og.tasks.length
                                ? 'Svi procesi završeni — nalog se može zatvoriti.'
                                : 'Ništa nije na redu — svi sljedeći procesi čekaju prethodne.'}
                        </div>
                    )}
                    <div className="pt-secs">
                        <Section id={`o|${og.workOrderId}|w`} label="Čeka" tasks={p.waiting} primary="process" />
                        <Section id={`o|${og.workOrderId}|d`} label="Završeno" tasks={p.done} primary="process" />
                    </div>
                </div>
            </div>
        );
    };

    // ── LEĆA PO PROCESU: kartica po stanici (ko čeka na ovom procesu) ────
    const renderStationCard = (pg: (typeof processGroups)[number]) => {
        const p = partition(pg.tasks);
        return (
            <div key={pg.key} className="pt-card pt-station">
                <div className="pt-card-head">
                    <div className="pt-card-id">
                        <span className="pt-card-title">{pg.name}</span>
                        <span className="pt-card-sub">
                            {p.now.length > 0
                                ? <><strong className="pt-sum-now">{plural(p.now.length, 'na redu', 'na redu')}</strong>{p.waiting.length > 0 && ` · ${p.waiting.length} čeka`}</>
                                : p.waiting.length > 0 ? `${p.waiting.length} čeka prethodne` : 'sve završeno'}
                        </span>
                    </div>
                    <div className="pt-card-spacer" />
                    <Bar done={pg.doneCount} total={pg.totalCount} />
                </div>

                <div className="pt-body">
                    {p.now.length > 0 ? (
                        <div className="pt-now">
                            <div className="pt-now-label">Na redu — spremno za rad</div>
                            {p.now.map(t => <TaskRow key={t.key} t={t} tone="now" primary="order" flags={orderFlags.get(t.workOrderId)} />)}
                        </div>
                    ) : (
                        <div className="pt-note">
                            {p.waiting.length > 0 ? 'Ništa nije spremno — svi nalozi čekaju prethodne procese.' : 'Ova stanica je završena na svim nalozima.'}
                        </div>
                    )}
                    <div className="pt-secs">
                        <Section id={`p|${pg.key}|w`} label="Čeka prethodne" tasks={p.waiting} primary="order" />
                    </div>
                </div>
            </div>
        );
    };

    // Leća PO PROCESU krije stanice bez ijednog aktivnog/čekajućeg zadatka (potpuno završene) —
    // one nisu red čekanja; napredak se ionako vidi u leći „po nalogu".
    const stationGroups = useMemo(
        () => processGroups.filter(pg => pg.tasks.some(t => !isDone(t))),
        [processGroups],
    );
    const doneStations = processGroups.length - stationGroups.length;

    const isEmpty = filteredCells.length === 0;

    return (
        <div className="pt-wrap">
            {/* ── Header: naslov + orijentacija lijevo, leće + alati desno ── */}
            <div className="pt-header">
                <div className="pt-head-id">
                    <h1 className="pt-title">Procesi</h1>
                    <p className="pt-summary">
                        {summary.orders === 0
                            ? 'Nema naloga u pogonu'
                            : <>
                                <strong>{plural(summary.nowCount, 'proces', 'procesa')} na redu</strong>
                                {' · '}{plural(summary.orders, 'nalog', 'naloga')}
                                {summary.today > 0 && <> · <span className="pt-sum-today">{summary.today} danas u pogonu</span></>}
                                {summary.paused > 0 && <> · {summary.paused} pauzirano</>}
                            </>}
                    </p>
                </div>
                <div className="pt-header-spacer" />

                {/* Prebacivač leća — srce redizajna: dva pogleda na isti posao */}
                <div className="pt-seg" role="tablist" aria-label="Pogled">
                    <button role="tab" aria-selected={lens === 'order'} className={lens === 'order' ? 'on' : ''} onClick={() => setLens('order')}
                        title="Napredak svakog naloga kroz njegov tok procesa">
                        <span className="material-icons-round">assignment</span> Po nalogu
                    </button>
                    <button role="tab" aria-selected={lens === 'process'} className={lens === 'process' ? 'on' : ''} onClick={() => setLens('process')}
                        title="Red čekanja po stanici — ko sve čeka na kojem procesu">
                        <span className="material-icons-round">account_tree</span> Po procesu
                    </button>
                </div>

                <div className="pt-search">
                    <span className="material-icons-round">search</span>
                    <input placeholder="Traži nalog / proizvod / proces…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <button className={`pt-toggle ${includeWaiting ? 'on' : ''}`} onClick={() => setIncludeWaiting(v => !v)} title="Uključi i naloge Na čekanju">
                    <span className="material-icons-round">{includeWaiting ? 'check_box' : 'check_box_outline_blank'}</span> Na čekanju
                </button>
                <button className="pt-icon" onClick={() => setCatalogModal(true)} title="Katalog procesa i pravila">
                    <span className="material-icons-round">tune</span>
                </button>
                <button className="pt-icon" onClick={() => onRefresh('workOrders')} title="Osvježi">
                    <span className="material-icons-round">refresh</span>
                </button>
            </div>

            {/* ── Sadržaj: leća PO NALOGU ili PO PROCESU ── */}
            {isEmpty && ordersWithoutProcesses.length === 0 ? (
                <div className="pt-empty">
                    <span className="material-icons-round">inbox</span>
                    <p>Nema aktivnih procesa{includeWaiting ? '' : ' — probaj „Na čekanju"'}.</p>
                </div>
            ) : lens === 'order' ? (
                !isEmpty && <div className="pt-list">{orderGroups.map(renderOrderCard)}</div>
            ) : (
                stationGroups.length > 0 ? (
                    <div className="pt-list">
                        {stationGroups.map(renderStationCard)}
                        {doneStations > 0 && (
                            <div className="pt-note pt-done-stations">
                                <span className="material-icons-round">check_circle</span>
                                {plural(doneStations, 'stanica', 'stanica')} završena na svim nalozima (sakriveno)
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="pt-empty">
                        <span className="material-icons-round">{isEmpty ? 'account_tree' : 'done_all'}</span>
                        <p>{isEmpty
                            ? 'Nalozi u pogonu još nemaju definisane procese — postavi ih u leći „Po nalogu".'
                            : 'Sve stanice su završene na svim nalozima u opsegu.'}</p>
                    </div>
                )
            )}

            {/* Nalozi bez ijednog procesa — odavde se procesi POSTAVE (samo leća po nalogu) */}
            {lens === 'order' && ordersWithoutProcesses.length > 0 && (
                <div className="pt-list">
                    <div className="pt-section-label">Bez definisanih procesa ({ordersWithoutProcesses.length})</div>
                    {ordersWithoutProcesses.map(o => (
                        <div key={o.workOrder.Work_Order_ID} className="pt-card">
                            <div className="pt-card-head" style={{ borderLeftColor: o.workOrder.Color_Code || 'var(--border)' }}>
                                <div className="pt-card-id">
                                    <span className="pt-card-title">{o.orderLabel}</span>
                                    <span className="pt-card-sub">{plural(o.items.length, 'proizvod', 'proizvoda')} · procesi nisu postavljeni</span>
                                </div>
                                <div className="pt-card-spacer" />
                                <button className="pt-btn primary" onClick={() => setGraphOrderId(o.workOrder.Work_Order_ID)}
                                    title="Postavi procese: iz plana proizvoda, šablon ili ručno">
                                    <span className="material-icons-round">account_tree</span> Postavi procese
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Traka grupnog odabira — samo kad je nešto označeno */}
            {selectedCells.length > 0 && !formOpen && (
                <div className="pt-actionbar">
                    <span>{plural(selectedCells.length, 'stavka označena', 'stavki označeno')}</span>
                    <button className="ghost" disabled={busy} onClick={startSelected}>Pokreni</button>
                    <button className="primary" disabled={busy} onClick={() => openCompleteForm(selectedCells)}>Završi…</button>
                    <button className="ghost" onClick={() => setSel(new Set())}>Odustani</button>
                </div>
            )}

            {formOpen && (
                <Modal isOpen onClose={() => setFormOpen(false)} title={`Završi ${plural(selectedCells.length, 'stavku', 'stavki')}`}
                    footer={<>
                        <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>Otkaži</button>
                        <button className="btn btn-primary" disabled={busy} onClick={confirmComplete}>{busy ? 'Spremanje…' : 'Potvrdi završetak'}</button>
                    </>}>
                    <div className="pt-form-field">
                        <label>Radnici (prvi = glavni)</label>
                        <div className="pt-worker-pick">
                            {workers.filter(w => w.Status !== 'Obrisan').map(w => {
                                const on = form.workerIds.includes(w.Worker_ID);
                                return (
                                    <button key={w.Worker_ID} type="button" className={`pt-worker-opt ${on ? 'on' : ''}`}
                                        onClick={() => setForm(f => ({ ...f, workerIds: on ? f.workerIds.filter(id => id !== w.Worker_ID) : [...f.workerIds, w.Worker_ID] }))}>
                                        {on && form.workerIds[0] === w.Worker_ID && <span className="material-icons-round" style={{ fontSize: 13 }}>star</span>}
                                        {w.Name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="pt-form-field">
                        <label>Datum završetka</label>
                        <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="pt-form-field">
                        <label>Napomena (opciono)</label>
                        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="npr. gdje je stalo, šta treba…" />
                    </div>
                </Modal>
            )}

            {catalogModal && organizationId && (
                <ProcessCatalogModal organizationId={organizationId} onClose={() => setCatalogModal(false)}
                    onChanged={() => { getProcessCatalog(organizationId).then(setCatalog).catch(() => { }); onRefresh('workOrders'); }} showToast={showToast} />
            )}

            {graphOrder && organizationId && (
                <ProcessGraphModal
                    workOrderId={graphOrder.Work_Order_ID}
                    workOrderNumber={graphOrder.Work_Order_Number}
                    workOrderName={workOrderDisplayName(graphOrder)}
                    items={(graphOrder.items || []).map(i => ({
                        ID: i.ID, Product_Name: i.Product_Name,
                        Processes: i.Processes, Process_Stages: i.Process_Stages,
                    }))}
                    workLogs={workLogs}
                    organizationId={organizationId}
                    onClose={() => { setGraphOrderId(null); onRefresh('workOrders'); }}
                    showToast={showToast}
                />
            )}
        </div>
    );
}
