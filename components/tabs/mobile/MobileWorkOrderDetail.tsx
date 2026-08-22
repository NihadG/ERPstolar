'use client';

// ════════════════════════════════════════════════════════════════════
// DETALJ NALOGA — mobilni (full-screen)
//
// Zamjena za „razvuci karticu u listi": na telefonu se nalog otvara kao
// vlastiti ekran, jer u nalogu ima previše radnji za jedan red liste.
//
// Zaglavlje NE prikazuje novac (profit/marža) — na terenu trebaju napredak,
// rok i radnje; finansije žive u pregledu projekta.
//
// Tab „Zadaci" NAMJERNO renderuje isti panel kao desktop (WorkOrderTasksPanel) —
// logika zadataka postoji na jednom mjestu i ne smije se duplirati.
//
// „Knjiga rada" je izuzetak i to je promišljeno: desktop `WorkOrderWorkLog` je
// mreža radnik × proizvod s pretraživim izbornicima i iznosom po komadu — na
// 375px se ne može koristiti. Zato ovdje ide `WorkLogPanel`, isti onaj koji
// kontrolor ima u pogonu. Logika se opet NE duplira: panel ne računa ništa sam,
// nego čita i piše kroz /api/field/…/worklog, gdje knjiženje radi isti
// `bookWorkerDayItems` kao i svugdje drugdje.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowLeft, Play, Pause, CheckCircle, Printer, Trash2, Check,
} from 'lucide-react';
import type { WorkOrder, WorkOrderItem, Worker, Task, WorkLog, Project } from '@/lib/types';
import { workOrderDisplayName, orderProcessProgress } from '@/lib/utils';
import { daysUntil, todayISO } from '@/lib/planning';
import { tasksForWorkOrder, taskProgress, lastBookingDate } from '@/lib/workOrderTasks';
import { toggleItemPause, completeWorkOrderItem, getWorkLogsForWorkOrder } from '@/lib/services';
import { useData } from '@/context/DataContext';
import WorkOrderTasksPanel from '@/components/ui/WorkOrderTasksPanel';
import WorkLogPanel from '@/components/field/orders/WorkLogPanel';
import OrderProcessBoard from '@/components/ui/OrderProcessBoard';
import '@/components/field/Controller.css';
import { useSwipeBack } from './useSwipe';
import { useOverlayGuard } from './overlayGuard';
import {
    MHero, MSegmented, MSection, MList, MItem, MCell, MText, MPill,
    MActions, MAction, MButton, MSheet, MOption, MEmpty,
} from './MobileUI';
import './MobileUI.css';
import './MobileWorkOrderDetail.css';

type Tab = 'tok' | 'zadaci' | 'rad' | 'stavke';

interface Props {
    workOrder: WorkOrder;
    workers: Worker[];
    tasks?: Task[];
    projects?: Project[];
    onClose: () => void;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onStart: (workOrderId: string) => void;
    onPrint: (workOrder: WorkOrder) => void;
    onDelete: (workOrderId: string) => void;
}

const statusTone = (s?: string) =>
    s === 'Završeno' ? 'green' : s === 'U toku' ? 'blue' : s === 'Otkazano' ? 'red' : 'gray';

export default function MobileWorkOrderDetail({
    workOrder, workers, tasks = [], onClose, onRefresh, showToast, onStart, onPrint, onDelete,
}: Props) {
    const { organizationId } = useData();
    const [tab, setTab] = useState<Tab>('tok');
    const [busy, setBusy] = useState(false);
    const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
    const [completeSheet, setCompleteSheet] = useState(false);
    const [completeDate, setCompleteDate] = useState<string>(todayISO());

    // Stavke se čitaju iz propsa (osvježava ih onRefresh) — bez lokalne kopije
    // statusa, da prikaz ne odluta od baze.
    const items: WorkOrderItem[] = useMemo(() => workOrder.items || [], [workOrder.items]);
    const openItems = items.filter(i => i.Status !== 'Završeno');
    const allPaused = openItems.length > 0 && openItems.every(i => i.Is_Paused);
    const isWaiting = workOrder.Status === 'Na čekanju';
    const isFinal = workOrder.Status === 'Završeno' || workOrder.Status === 'Otkazano';

    const prog = orderProcessProgress(items);
    const pct = prog?.pct ?? 0;
    const dd = !isFinal ? daysUntil(workOrder.Due_Date) : null;
    const dueText = dd === null ? (workOrder.Status === 'Završeno' ? 'završen' : 'bez roka')
        : dd < 0 ? `kasni ${-dd} ${-dd === 1 ? 'dan' : 'dana'}`
            : dd === 0 ? 'rok danas' : `rok za ${dd} ${dd === 1 ? 'dan' : 'dana'}`;

    const orderTasks = useMemo(() => tasksForWorkOrder(tasks, workOrder.Work_Order_ID), [tasks, workOrder.Work_Order_ID]);
    const tProg = useMemo(() => taskProgress(orderTasks, todayISO()), [orderTasks]);

    // Logovi naloga — za knjigu rada i za prijedlog datuma završetka.
    const reloadLogs = async () => {
        if (!organizationId) return;
        try { setWorkLogs(await getWorkLogsForWorkOrder(workOrder.Work_Order_ID, organizationId)); }
        catch (e) { console.warn('getWorkLogsForWorkOrder failed', e); }
    };
    useEffect(() => { reloadLogs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workOrder.Work_Order_ID]);

    // Zatvaranje nazad-tipkom telefona + zaključan scroll pozadine.
    useEffect(() => {
        window.history.pushState({ moWoDetail: true }, '');
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
    // Prijavljuje da je full-screen detalj otvoren — sprječava globalni
    // tab-swipe (page.tsx) da otme isti dodir dok je ovaj ekran na vrhu.
    useOverlayGuard(true);

    // Povlačenje s lijeve ivice = nazad; isključeno dok je sheet otvoren.
    const swipeRef = useSwipeBack(goBack, { enabled: !completeSheet });

    // ── Radnje ──────────────────────────────────────────────────────

    /** Pauza/nastavak cijelog naloga (dnevnice ne teku dok je pauziran). */
    const togglePause = async () => {
        if (busy || openItems.length === 0) return;
        const next = !allPaused;
        try {
            setBusy(true);
            for (const it of openItems) await toggleItemPause(workOrder.Work_Order_ID, it.ID, next);
            showToast(next ? 'Nalog pauziran' : 'Nalog nastavljen', 'success');
            onRefresh('workOrders', 'projects', 'workLogs');
        } catch (e) {
            console.error(e);
            showToast('Greška pri pauzi naloga', 'error');
        } finally { setBusy(false); }
    };

    const openComplete = () => {
        const last = lastBookingDate(workLogs);
        setCompleteDate(last && last !== todayISO() ? last : todayISO());
        setCompleteSheet(true);
    };

    /** Završetak naloga na odabrani ZVANIČNI datum (isti model kao desktop). */
    const runComplete = async (dateISO: string) => {
        setCompleteSheet(false);
        const unfinished = items.filter(i => i.Status !== 'Završeno');
        if (unfinished.length === 0) return;
        try {
            setBusy(true);
            const customDate = `${dateISO}T12:00:00`;
            for (const it of unfinished) {
                await completeWorkOrderItem(workOrder.Work_Order_ID, it.ID, { customDate });
            }
            showToast('Nalog završen', 'success');
            onRefresh('workOrders', 'projects', 'workLogs');
        } catch (e) {
            console.error(e);
            showToast('Greška pri završavanju naloga', 'error');
        } finally { setBusy(false); }
    };

    const pauseItem = async (item: WorkOrderItem) => {
        if (busy) return;
        try {
            setBusy(true);
            await toggleItemPause(workOrder.Work_Order_ID, item.ID, !item.Is_Paused);
            onRefresh('workOrders', 'projects', 'workLogs');
        } catch (e) {
            console.error(e);
            showToast('Greška pri pauzi proizvoda', 'error');
        } finally { setBusy(false); }
    };

    if (typeof document === 'undefined') return null;

    const lastWork = lastBookingDate(workLogs);

    return createPortal(
        <div
            className="mui mwd"
            ref={swipeRef}
        >
            <header className="mwd-nav">
                <button type="button" className="mwd-back" onClick={goBack}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Nalozi
                </button>
                <div className="mwd-nav-actions">
                    <button type="button" className="mwd-navbtn" onClick={() => onPrint(workOrder)} aria-label="Printaj">
                        <Printer size={19} />
                    </button>
                    <button type="button" className="mwd-navbtn danger" onClick={() => { onDelete(workOrder.Work_Order_ID); onClose(); }} aria-label="Obriši">
                        <Trash2 size={19} />
                    </button>
                </div>
            </header>

            <div className="mwd-body">
                <div className="mui-large">
                    <h1>{workOrderDisplayName(workOrder)}</h1>
                    <p>
                        <MPill tone={statusTone(workOrder.Status)}>{workOrder.Status}</MPill>
                        {workOrder.Work_Order_Type === 'Montaža' && <MPill tone="purple">Montaža</MPill>}
                        <span>#{workOrder.Work_Order_Number} · {items.length} {items.length === 1 ? 'proizvod' : 'proizvoda'}</span>
                    </p>
                </div>

                <MHero
                    kicker="Napredak naloga"
                    value={<>{pct}<small>%</small></>}
                    chip={dueText}
                    pct={pct}
                    green={workOrder.Status === 'Završeno'}
                />

                {!isFinal && (
                    <MActions>
                        {isWaiting ? (
                            <MAction tone="green" disabled={busy} onClick={() => onStart(workOrder.Work_Order_ID)}>
                                <Play size={18} /> Pokreni nalog
                            </MAction>
                        ) : (
                            <>
                                <MAction tone="otint" disabled={busy || openItems.length === 0} onClick={togglePause}>
                                    {allPaused ? <><Play size={18} /> Nastavi</> : <><Pause size={18} /> Pauza</>}
                                </MAction>
                                <MAction tone="green" disabled={busy} onClick={openComplete}>
                                    <CheckCircle size={18} /> Završi
                                </MAction>
                            </>
                        )}
                    </MActions>
                )}

                <MSegmented<Tab>
                    value={tab}
                    onChange={setTab}
                    options={[
                        { id: 'tok', label: 'Tok' },
                        { id: 'zadaci', label: tProg.total > 0 ? `Zadaci ${tProg.done}/${tProg.total}` : 'Zadaci' },
                        { id: 'rad', label: 'Knjiga' },
                        { id: 'stavke', label: `Stavke ${items.length}` },
                    ]}
                />

                {/* ── TOK: isti prikaz kao desktop ──────────────────────────
                    OrderProcessBoard je JEDINI ispravan izvor toka: gradi redove
                    iz GRAFA naloga (+ sinteze iz faznih planova), a `Processes` na
                    stavci koristi samo za status. Ranija mobilna verzija je čitala
                    `item.Processes` direktno — tamo postoje samo procesi koji su
                    već dirani, pa su procesi falili, izgledali svi završeni, a
                    legacy placeholder „Rad" se prikazivao kao pravi proces. */}
                {tab === 'tok' && (
                    items.length === 0 ? (
                        <MEmpty title="Nalog nema proizvoda" sub="Dodaj proizvode da bi se pratio tok procesa." />
                    ) : (
                        <div className="mwd-panel">
                            <OrderProcessBoard
                                workOrderId={workOrder.Work_Order_ID}
                                items={items}
                                workers={workers}
                                workLogs={workLogs}
                                organizationId={organizationId || ''}
                                onChanged={() => onRefresh('workOrders', 'projects', 'workLogs')}
                                showToast={showToast}
                            />
                        </div>
                    )
                )}

                {/* ── ZADACI: isti panel kao desktop (Task.Links je izvor istine) ── */}
                {tab === 'zadaci' && (
                    <div className="mwd-panel">
                        <WorkOrderTasksPanel
                            workOrder={workOrder}
                            tasks={tasks}
                            workers={workers}
                            organizationId={organizationId || ''}
                            onRefresh={onRefresh}
                            showToast={showToast}
                        />
                    </div>
                )}

                {/* ── RAD: knjiga rada (isti panel kao desktop) ── */}
                {tab === 'rad' && (
                    <div className="mwd-panel mui">
                        <WorkLogPanel
                            orderId={workOrder.Work_Order_ID}
                            showToast={showToast}
                            onChanged={() => { reloadLogs(); onRefresh('workOrders', 'projects', 'workLogs'); }}
                        />
                    </div>
                )}

                {/* ── STAVKE: proizvodi naloga + pauza po proizvodu ── */}
                {tab === 'stavke' && (
                    <>
                        <MSection title="Proizvodi u nalogu" />
                        <MList>
                            {items.map(item => {
                                const procs = item.Processes || [];
                                const done = procs.filter(p => p.Status === 'Završeno').length;
                                return (
                                    <MItem key={item.ID}>
                                        <MCell>
                                            <MText
                                                title={item.Product_Name}
                                                sub={<>
                                                    <MPill tone={statusTone(item.Status)}>{item.Status}</MPill>
                                                    {item.Is_Paused && <MPill tone="orange">Pauzirano</MPill>}
                                                    <span>{procs.length > 0 ? `${done}/${procs.length} procesa` : `${item.Quantity || 1} kom`}</span>
                                                </>}
                                            />
                                            {!isFinal && item.Status !== 'Završeno' && (
                                                <button type="button" className="mui-actbtn" onClick={() => pauseItem(item)} disabled={busy}>
                                                    {item.Is_Paused ? 'Nastavi' : 'Pauza'}
                                                </button>
                                            )}
                                        </MCell>
                                    </MItem>
                                );
                            })}
                        </MList>
                        <div className="mui-pt14">
                            <MButton variant="tinted" onClick={() => onPrint(workOrder)}>
                                <Printer size={19} /> Printaj nalog
                            </MButton>
                        </div>
                    </>
                )}
            </div>

            {/* Završetak naloga — izbor zvaničnog datuma (kao desktop) */}
            <MSheet open={completeSheet} title="Završi nalog" onClose={() => setCompleteSheet(false)}
                footer={
                    <div className="mui-pt14">
                        <MButton variant="gfilled" onClick={() => runComplete(completeDate)}>
                            <Check size={19} /> Završi nalog
                        </MButton>
                    </div>
                }>
                <p className="mwd-sheet-note">
                    {items.filter(i => i.Status !== 'Završeno').length} {items.filter(i => i.Status !== 'Završeno').length === 1 ? 'proizvod će biti završen' : 'proizvoda će biti završeno'}.
                    Odaberi datum završetka — on ulazi u obračun.
                </p>
                <MList>
                    <MOption label="Danas" sub={todayISO().split('-').reverse().join('.')}
                        selected={completeDate === todayISO()} onClick={() => setCompleteDate(todayISO())} />
                    {lastWork && lastWork !== todayISO() && (
                        <MOption label="Dan zadnjeg rada" sub={lastWork.split('-').reverse().join('.')}
                            selected={completeDate === lastWork} onClick={() => setCompleteDate(lastWork)} />
                    )}
                </MList>
                <div className="mui-shd"><span>Drugi datum</span></div>
                <MList>
                    <div className="mui-field">
                        <label htmlFor="mwd-date">Datum</label>
                        <input id="mwd-date" type="date" value={completeDate} onChange={e => setCompleteDate(e.target.value)} />
                    </div>
                </MList>
            </MSheet>
        </div>,
        document.body
    );
}
