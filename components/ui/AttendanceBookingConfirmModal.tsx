'use client';

import { useMemo, useState } from 'react';
import type { WorkOrder, Worker } from '@/lib/types';
import type { ProposalRow, PresentOrderOption } from '@/lib/attendanceBooking';
import { formatDate } from '@/lib/utils';
import Modal from './Modal';
import CustomTasksModal from './CustomTasksModal';
import { SearchableSelect } from './SearchableSelect';
import { CheckCircle2, Car, Plus, RotateCcw, Play, Search, X, Users, ClipboardList } from 'lucide-react';
import './AttendanceBookingConfirmModal.css';

// ── Odluka koju modal vraća roditelju (AttendanceTab je izvršava) ─────────────
// Jedan oblik za oba tipa radnika: knjiženje je isto (bookWorkerDayItems po
// radniku), `kind` je samo prikaz. Teren smije na više naloga kao i prisutan —
// montažer koji obiđe dva gradilišta se više ne mora birati.
export interface BookingDecision {
    kind: 'present' | 'teren';
    workerId: string;
    workerName: string;
    orderIds: string[];                 // prazno = ne knjiži (prisustvo ostaje zapisano)
    presence?: 0.5 | 1;                 // ½ ili cijeli dan (default 1)
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    date: string;
    rows: ProposalRow[];
    workOrders: WorkOrder[];
    workers: Worker[];
    organizationId: string;
    /** workerId → Work_Order_ID[] s posljednjeg dana koji je imao knjiženja. */
    yesterdayByWorker?: Map<string, string[]>;
    /** Datum iz kojeg je gornja mapa — ponedjeljkom/nakon praznika nije doslovno jučer. */
    yesterdaySourceDate?: string;
    onConfirm: (decisions: BookingDecision[]) => Promise<void>;
    onCreated: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

/** Radnik + nalozi koje smije izabrati — jedinstven oblik za prisutne i teren. */
interface Entry {
    workerId: string;
    workerName: string;
    kind: 'present' | 'teren';
    options: PresentOrderOption[];
}

type ViewMode = 'workers' | 'orders';

export default function AttendanceBookingConfirmModal({
    isOpen, onClose, date, rows, workOrders, workers, organizationId,
    yesterdayByWorker, yesterdaySourceDate, onConfirm, onCreated, showToast,
}: Props) {
    const [view, setView] = useState<ViewMode>('workers');
    const [query, setQuery] = useState('');
    const [saving, setSaving] = useState(false);

    // Nalozi kreirani iz ovog modala („Razni poslovi") — roditelj ih još nije
    // osvježio u `workOrders`, pa ih držimo lokalno da budu odmah vidljivi.
    const [extraOrders, setExtraOrders] = useState<PresentOrderOption[]>([]);

    // ── Jedinstveno stanje izbora: workerId → Set(Work_Order_ID) ──────────────
    const [picks, setPicks] = useState<Record<string, Set<string>>>(() => {
        const init: Record<string, Set<string>> = {};
        rows.forEach(r => {
            init[r.workerId] = new Set(
                r.kind === 'present'
                    ? r.suggestedOrderIds
                    : (r.suggestedWorkOrderId ? [r.suggestedWorkOrderId] : [])
            );
        });
        return init;
    });

    // Nalozi koje je korisnik ručno dodao na karticu radnika — ostaju vidljivi i
    // kad se odčekiraju (inače bi red nestao ispod prsta).
    const [revealed, setRevealed] = useState<Record<string, Set<string>>>({});

    // Nalozi vidljivi u prikazu „Po nalozima": relevantni + svaki taknut. Skup
    // samo RASTE — kartica ne smije nestati kad se skine zadnji radnik s nje.
    const [revealedOrders, setRevealedOrders] = useState<Set<string>>(() => {
        const s = new Set<string>();
        rows.forEach(r => {
            if (r.kind === 'present') r.suggestedOrderIds.forEach(id => s.add(id));
            else if (r.suggestedWorkOrderId) s.add(r.suggestedWorkOrderId);
        });
        return s;
    });
    const [showAllOrders, setShowAllOrders] = useState(false);

    // ½ ili cijeli dan po radniku (default 1) — bez odlaska u Knjigu rada.
    const [presenceByWorker, setPresenceByWorker] = useState<Record<string, 0.5 | 1>>({});
    const presenceOf = (workerId: string): 0.5 | 1 => presenceByWorker[workerId] ?? 1;

    // Radnik za kojeg je otvoren „Razni poslovi" modal (kreiranje novog naloga).
    const [creatingFor, setCreatingFor] = useState<{ workerId: string; workerName: string } | null>(null);

    const orderById = useMemo(() => {
        const m = new Map<string, WorkOrder>();
        workOrders.forEach(w => m.set(w.Work_Order_ID, w));
        return m;
    }, [workOrders]);

    // Ponudu naloga je već izračunao prijedlog (prisutan: aktivni/pauzirani/nepokrenuti;
    // teren: šire — i završeni, i „Razni poslovi"). Modal je samo crta.
    const entries = useMemo<Entry[]>(() => rows.map(r => {
        const known = new Set(r.orders.map(o => o.workOrderId));
        return {
            workerId: r.workerId,
            workerName: r.workerName,
            kind: r.kind,
            options: [...r.orders, ...extraOrders.filter(o => !known.has(o.workOrderId))],
        };
    }), [rows, extraOrders]);

    // ── Izbor ────────────────────────────────────────────────────────────────
    function setPick(workerId: string, orderId: string, on: boolean) {
        setPicks(prev => {
            const next = new Set(prev[workerId] || []);
            if (on) next.add(orderId); else next.delete(orderId);
            return { ...prev, [workerId]: next };
        });
        if (on) {
            setRevealed(prev => ({ ...prev, [workerId]: new Set(prev[workerId] || []).add(orderId) }));
            setRevealedOrders(prev => new Set(prev).add(orderId));
        }
    }

    function togglePick(workerId: string, orderId: string) {
        setPick(workerId, orderId, !picks[workerId]?.has(orderId));
    }

    /** Jedan nalog — više radnika (prikaz po nalozima: „Svi" / „Niko"). */
    function setOrderForWorkers(workerIds: string[], orderId: string, on: boolean) {
        setPicks(prev => {
            const next = { ...prev };
            workerIds.forEach(id => {
                const s = new Set(next[id] || []);
                if (on) s.add(orderId); else s.delete(orderId);
                next[id] = s;
            });
            return next;
        });
        if (on) {
            setRevealed(prev => {
                const next = { ...prev };
                workerIds.forEach(id => { next[id] = new Set(next[id] || []).add(orderId); });
                return next;
            });
            setRevealedOrders(prev => new Set(prev).add(orderId));
        }
    }

    function setManyPicks(workerId: string, orderIds: string[], on: boolean) {
        setPicks(prev => {
            const next = new Set(prev[workerId] || []);
            orderIds.forEach(id => { if (on) next.add(id); else next.delete(id); });
            return { ...prev, [workerId]: next };
        });
        if (on) {
            setRevealed(prev => {
                const s = new Set(prev[workerId] || []);
                orderIds.forEach(id => s.add(id));
                return { ...prev, [workerId]: s };
            });
            setRevealedOrders(prev => {
                const s = new Set(prev);
                orderIds.forEach(id => s.add(id));
                return s;
            });
        }
    }

    // ── „Prepiši jučer" ──────────────────────────────────────────────────────
    // Nalozi s posljednjeg dana koji je imao knjiženja, suženi na one koje radnik
    // i danas smije dobiti (nalog u međuvremenu otkazan nije izbor).
    function yesterdayFor(e: Entry): string[] {
        const list = yesterdayByWorker?.get(e.workerId);
        if (!list || list.length === 0) return [];
        const available = new Set(e.options.map(o => o.workOrderId));
        return list.filter(id => available.has(id));
    }

    // Dugme ne smije lagati: ako izvor nije doslovno jučer, piše koji je dan.
    const sourceIsYesterday = !yesterdaySourceDate || yesterdaySourceDate === shiftISO(date, -1);
    const sourceLabel = sourceIsYesterday ? 'jučer' : dayLabel(yesterdaySourceDate);

    const yesterdayCount = useMemo(
        () => entries.reduce((n, e) => n + (yesterdayFor(e).length > 0 ? 1 : 0), 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [entries, yesterdayByWorker]
    );

    /** Prepiši naloge s prošlog dana — ZAMJENA izbora (to i znači „kao jučer"). */
    function copyYesterday(target?: Entry) {
        const list = target ? [target] : entries;
        const nextPicks: Record<string, Set<string>> = { ...picks };
        const nextRevealed: Record<string, Set<string>> = { ...revealed };
        const nextOrders = new Set(revealedOrders);
        let applied = 0;
        for (const e of list) {
            const ids = yesterdayFor(e);
            if (ids.length === 0) continue;
            nextPicks[e.workerId] = new Set(ids);
            nextRevealed[e.workerId] = new Set([...(revealed[e.workerId] || []), ...ids]);
            ids.forEach(id => nextOrders.add(id));
            applied++;
        }
        if (applied === 0) {
            showToast(target
                ? `Nema knjiženja s ${sourceLabel} za ovog radnika`
                : `Nema knjiženja s ${sourceLabel} za prepisivanje`, 'info');
            return;
        }
        setPicks(nextPicks);
        setRevealed(nextRevealed);
        setRevealedOrders(nextOrders);
        if (!target) showToast(`Prepisano s ${sourceLabel} za ${applied} ${plural(applied, 'radnika', 'radnika')}`, 'success');
    }

    // ── Novi nalog („Razni poslovi") ─────────────────────────────────────────
    // Nalog je stvaran, samo ga roditelj još nije dovukao — prikaži ga lokalno i
    // odmah čekiraj, da knjiženje ide istim putem kao za svaki drugi nalog.
    function handleOrderCreated(workerId: string, workOrderId: string, workOrderNumber: string) {
        setExtraOrders(prev => prev.some(o => o.workOrderId === workOrderId) ? prev : [...prev, {
            workOrderId,
            name: workOrderNumber ? `#${workOrderNumber}` : 'Novi nalog',
            status: 'Na čekanju',
            paused: false,
            assigned: true,
            notStarted: true,
        }]);
        setPick(workerId, workOrderId, true);
        setCreatingFor(null);
    }

    // ── Sažetak ──────────────────────────────────────────────────────────────
    const summary = useMemo(() => {
        const orders = new Set<string>();
        let withOrders = 0;
        for (const e of entries) {
            const chosen = picks[e.workerId];
            if (chosen && chosen.size > 0) { withOrders++; chosen.forEach(id => orders.add(id)); }
        }
        return { workers: withOrders, empty: entries.length - withOrders, orders: orders.size };
    }, [entries, picks]);

    function buildDecisions(): BookingDecision[] {
        return entries.map(e => ({
            kind: e.kind,
            workerId: e.workerId,
            workerName: e.workerName,
            orderIds: Array.from(picks[e.workerId] || []),
            presence: presenceOf(e.workerId),
        }));
    }

    async function handleConfirm() {
        setSaving(true);
        try {
            await onConfirm(buildDecisions());
            onClose();
        } finally {
            setSaving(false);
        }
    }

    if (!isOpen) return null;

    const searching = query.trim().length > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="large"
            title={
                <span className="abcm-title">
                    <CheckCircle2 size={20} className="abcm-title-icon" />
                    Knjiženje dnevnica
                    <span className="abcm-title-date">· {formatDate(date)}</span>
                </span>
            }
            footer={
                <div className="abcm-foot">
                    <span className="abcm-foot-count">
                        {summary.workers > 0
                            ? <>
                                <strong>{summary.workers}</strong> {plural(summary.workers, 'radnik', 'radnika')} ·{' '}
                                <strong>{summary.orders}</strong> {plural(summary.orders, 'nalog', 'naloga')}
                                {summary.empty > 0 && <span className="abcm-foot-warn"> · {summary.empty} bez naloga</span>}
                            </>
                            : 'Nijedna dnevnica neće biti knjižena'}
                    </span>
                    <div className="abcm-foot-btns">
                        <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Otkaži</button>
                        <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
                            {saving ? 'Knjižim…' : 'Potvrdi i proknjiži'}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="abcm">
                {/* ── Alatna traka: prikaz, pretraga, prepiši jučer ───────────── */}
                <div className="abcm-bar">
                    <div className="abcm-bar-row">
                        <div className="abcm-seg" role="tablist" aria-label="Prikaz">
                            <button type="button" role="tab" aria-selected={view === 'workers'}
                                className={view === 'workers' ? 'is-on' : ''}
                                onClick={() => setView('workers')}>
                                <Users size={14} /> Po radnicima
                            </button>
                            <button type="button" role="tab" aria-selected={view === 'orders'}
                                className={view === 'orders' ? 'is-on' : ''}
                                onClick={() => setView('orders')}>
                                <ClipboardList size={14} /> Po nalozima
                            </button>
                        </div>

                        <div className="abcm-search">
                            <Search size={15} />
                            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                                placeholder="Pretraži naloge…" />
                            {searching && (
                                <button type="button" className="abcm-search-clear" onClick={() => setQuery('')}
                                    aria-label="Očisti pretragu"><X size={14} /></button>
                            )}
                        </div>

                        <button type="button" className="abcm-ghost" onClick={() => copyYesterday()}
                            disabled={yesterdayCount === 0}
                            title={yesterdayCount === 0
                                ? 'Nema ranijeg knjiženja za prepisivanje'
                                : `Prepiši naloge s ${sourceLabel} za ${yesterdayCount} ${plural(yesterdayCount, 'radnika', 'radnika')}`}>
                            <RotateCcw size={14} /> Prepiši {sourceLabel}
                        </button>
                    </div>

                    <p className="abcm-hint">
                        {view === 'workers'
                            ? 'Potvrdi na koje naloge ide radni dan. Otkazivanje ostavlja prisustvo zabilježeno — bez dnevnica.'
                            : 'Klikni radnika da ga dodaš ili skineš s naloga. Isti izbor kao u prikazu po radnicima.'}
                    </p>
                </div>

                {view === 'workers'
                    ? <WorkersView
                        entries={entries}
                        picks={picks}
                        revealed={revealed}
                        query={query}
                        orderById={orderById}
                        presenceOf={presenceOf}
                        onPresence={(workerId, v) => setPresenceByWorker(prev => ({ ...prev, [workerId]: v }))}
                        onToggle={togglePick}
                        onSetMany={setManyPicks}
                        onCopyYesterday={copyYesterday}
                        yesterdayFor={yesterdayFor}
                        sourceLabel={sourceLabel}
                        onCreateOrder={(workerId, workerName) => setCreatingFor({ workerId, workerName })}
                    />
                    : <OrdersView
                        entries={entries}
                        picks={picks}
                        query={query}
                        orderById={orderById}
                        revealedOrders={revealedOrders}
                        showAll={showAllOrders}
                        onShowAll={() => setShowAllOrders(true)}
                        onToggle={togglePick}
                        onSetAll={setOrderForWorkers}
                        presenceOf={presenceOf}
                    />}
            </div>

            {creatingFor && (
                <CustomTasksModal
                    isOpen={!!creatingFor}
                    onClose={() => setCreatingFor(null)}
                    workOrders={workOrders}
                    workers={workers}
                    organizationId={organizationId}
                    onCreated={onCreated}
                    showToast={showToast}
                    zIndex={2000}
                    initialWorkerId={creatingFor.workerId}
                    onOrderCreated={(workOrderId, workOrderNumber) =>
                        handleOrderCreated(creatingFor.workerId, workOrderId, workOrderNumber)}
                />
            )}
        </Modal>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIKAZ PO RADNICIMA — kartica po radniku, samo relevantni nalozi + „Dodaj nalog"
// ═══════════════════════════════════════════════════════════════════════════
interface WorkersViewProps {
    entries: Entry[];
    picks: Record<string, Set<string>>;
    revealed: Record<string, Set<string>>;
    query: string;
    orderById: Map<string, WorkOrder>;
    presenceOf: (workerId: string) => 0.5 | 1;
    onPresence: (workerId: string, v: 0.5 | 1) => void;
    onToggle: (workerId: string, orderId: string) => void;
    onSetMany: (workerId: string, orderIds: string[], on: boolean) => void;
    onCopyYesterday: (entry: Entry) => void;
    yesterdayFor: (entry: Entry) => string[];
    sourceLabel: string;
    onCreateOrder: (workerId: string, workerName: string) => void;
}

function WorkersView({
    entries, picks, revealed, query, orderById, presenceOf, onPresence,
    onToggle, onSetMany, onCopyYesterday, yesterdayFor, sourceLabel, onCreateOrder,
}: WorkersViewProps) {
    const searching = query.trim().length > 0;

    // Bez pretrage kartica pokazuje SAMO ono što je bitno za tog radnika (izabrano,
    // dodijeljeno, ručno dodano); ostatak je iza „Dodaj nalog". Lista svih naloga
    // po svakom radniku je bila glavni razlog beskrajnog skrolanja.
    const cards = entries.map(e => {
        const chosen = picks[e.workerId] || new Set<string>();
        const visible = searching
            ? e.options.filter(o => matches(query, o.name))
            : e.options.filter(o => chosen.has(o.workOrderId) || o.assigned || revealed[e.workerId]?.has(o.workOrderId));
        return { entry: e, chosen, visible };
    }).filter(c => !searching || c.visible.length > 0);

    if (cards.length === 0) return <div className="abcm-empty">Nijedan nalog ne odgovara pretrazi.</div>;

    return (
        <div className="abcm-list">
            {cards.map(({ entry: e, chosen, visible }) => {
                const teren = e.kind === 'teren';
                const yesterday = yesterdayFor(e);
                const allOn = visible.length > 0 && visible.every(o => chosen.has(o.workOrderId));
                const visibleIds = new Set(visible.map(o => o.workOrderId));
                const rest = e.options.filter(o => !visibleIds.has(o.workOrderId));
                const presence = presenceOf(e.workerId);

                return (
                    <section key={e.workerId} className={`abcm-card${chosen.size === 0 ? ' is-empty' : ''}`}>
                        <header className="abcm-head">
                            <div className={`abcm-avatar ${teren ? 'abcm-avatar--teren' : 'abcm-avatar--present'}`}>
                                {initials(e.workerName)}
                            </div>
                            <div className="abcm-who">
                                <span className="abcm-name">{e.workerName}</span>
                                <span className={`abcm-sub${chosen.size === 0 ? ' abcm-sub--warn' : ''}`}>
                                    {chosen.size === 0
                                        ? 'Bez naloga — neće biti knjiženo'
                                        : `${chosen.size} ${plural(chosen.size, 'nalog', 'naloga')}${presence === 0.5 ? ' · pola dana' : ''}`}
                                </span>
                            </div>

                            <div className="abcm-head-right">
                                <span className="abcm-presence" title="Pola ili cijeli dan">
                                    {([0.5, 1] as const).map(v => (
                                        <button key={v} type="button" className={presence === v ? 'is-on' : ''}
                                            onClick={() => onPresence(e.workerId, v)}>
                                            {v === 0.5 ? '½' : '1'}
                                        </button>
                                    ))}
                                </span>
                                {yesterday.length > 0 && (
                                    <button type="button" className="abcm-icon-btn" onClick={() => onCopyYesterday(e)}
                                        title={`Prepiši naloge s ${sourceLabel} (${yesterday.length})`}>
                                        <RotateCcw size={13} /> {sourceLabel}
                                    </button>
                                )}
                                <span className={`abcm-badge ${teren ? 'abcm-badge--teren' : 'abcm-badge--present'}`}>
                                    {teren ? <><Car size={12} /> Teren</> : <><CheckCircle2 size={12} /> Prisutan</>}
                                </span>
                            </div>
                        </header>

                        {visible.length > 0 && (
                            <div className="abcm-items">
                                {visible.map(o => {
                                    const on = chosen.has(o.workOrderId);
                                    return (
                                        <label key={o.workOrderId} className={`abcm-item${on ? ' is-on' : ''}`}>
                                            <input type="checkbox" checked={on} onChange={() => onToggle(e.workerId, o.workOrderId)} />
                                            <span className="abcm-item-name">
                                                {o.name}
                                                {o.assigned && <span className="abcm-tag">dodijeljen</span>}
                                            </span>
                                            <OrderChip option={o} active={on} />
                                        </label>
                                    );
                                })}
                            </div>
                        )}

                        {!searching && (rest.length > 0 || visible.length > 2 || teren) && (
                            <footer className="abcm-card-foot">
                                {rest.length > 0 && (
                                    <div className="abcm-add">
                                        <SearchableSelect
                                            options={rest.map(o => toSelectOption(o, orderById))}
                                            value=""
                                            onChange={id => onToggle(e.workerId, id)}
                                            placeholder="+ Dodaj nalog…"
                                        />
                                    </div>
                                )}
                                {visible.length > 2 && (
                                    <button type="button" className="abcm-link"
                                        onClick={() => onSetMany(e.workerId, visible.map(o => o.workOrderId), !allOn)}>
                                        {allOn ? 'Poništi sve' : 'Označi sve'}
                                    </button>
                                )}
                                {/* Novi nalog je terenska potreba („Razni poslovi" na gradilištu);
                                    prisutan radnik bira iz naloga koji već postoje. */}
                                {teren && (
                                    <button type="button" className="abcm-link" onClick={() => onCreateOrder(e.workerId, e.workerName)}>
                                        <Plus size={13} /> Novi nalog
                                    </button>
                                )}
                            </footer>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIKAZ PO NALOZIMA — kartica po nalogu, radnici kao dugmad koja se pale/gase
// ═══════════════════════════════════════════════════════════════════════════
interface OrdersViewProps {
    entries: Entry[];
    picks: Record<string, Set<string>>;
    query: string;
    orderById: Map<string, WorkOrder>;
    revealedOrders: Set<string>;
    showAll: boolean;
    onShowAll: () => void;
    onToggle: (workerId: string, orderId: string) => void;
    onSetAll: (workerIds: string[], orderId: string, on: boolean) => void;
    presenceOf: (workerId: string) => 0.5 | 1;
}

interface OrderCard {
    option: PresentOrderOption;
    anyAssigned: boolean;
    candidates: { entry: Entry; assigned: boolean }[];
}

function OrdersView({ entries, picks, query, orderById, revealedOrders, showAll, onShowAll, onToggle, onSetAll, presenceOf }: OrdersViewProps) {
    const searching = query.trim().length > 0;

    const cards = useMemo<OrderCard[]>(() => {
        const map = new Map<string, OrderCard>();
        for (const e of entries) {
            for (const o of e.options) {
                let card = map.get(o.workOrderId);
                if (!card) { card = { option: o, anyAssigned: false, candidates: [] }; map.set(o.workOrderId, card); }
                card.candidates.push({ entry: e, assigned: o.assigned });
                if (o.assigned) card.anyAssigned = true;
            }
        }
        // Stabilan redoslijed (ne ovisi o izboru) — kartice ne smiju skakati pri kliku.
        return Array.from(map.values()).sort((a, b) => {
            if (a.anyAssigned !== b.anyAssigned) return a.anyAssigned ? -1 : 1;
            const aAct = a.option.status === 'U toku', bAct = b.option.status === 'U toku';
            if (aAct !== bAct) return aAct ? -1 : 1;
            return a.option.name.localeCompare(b.option.name);
        });
    }, [entries]);

    const pickedCount = (orderId: string) => entries.reduce((n, e) => n + (picks[e.workerId]?.has(orderId) ? 1 : 0), 0);

    const shown = searching
        ? cards.filter(c => matches(query, c.option.name, orderItemsPreview(orderById.get(c.option.workOrderId))))
        : cards.filter(c => showAll || c.anyAssigned || revealedOrders.has(c.option.workOrderId));
    const hidden = cards.length - shown.length;

    if (shown.length === 0) return <div className="abcm-empty">Nijedan nalog ne odgovara pretrazi.</div>;

    return (
        <div className="abcm-list">
            {shown.map(card => {
                const o = card.option;
                const n = pickedCount(o.workOrderId);
                const preview = orderItemsPreview(orderById.get(o.workOrderId));
                return (
                    <section key={o.workOrderId} className={`abcm-card${n === 0 ? ' is-empty' : ''}`}>
                        <header className="abcm-head abcm-head--order">
                            <div className="abcm-who">
                                <span className="abcm-name">{o.name}</span>
                                {preview && <span className="abcm-sub">{preview}</span>}
                            </div>
                            <div className="abcm-head-right">
                                <span className={`abcm-count${n > 0 ? ' is-on' : ''}`}>
                                    {n} {plural(n, 'radnik', 'radnika')}
                                </span>
                                <OrderChip option={o} active={n > 0} />
                            </div>
                        </header>

                        <div className="abcm-chips">
                            {card.candidates.map(({ entry: e, assigned }) => {
                                const on = !!picks[e.workerId]?.has(o.workOrderId);
                                const half = presenceOf(e.workerId) === 0.5;
                                return (
                                    <button key={e.workerId} type="button"
                                        className={`abcm-wchip${on ? ' is-on' : ''}${assigned ? ' is-assigned' : ''}`}
                                        onClick={() => onToggle(e.workerId, o.workOrderId)}
                                        title={assigned ? `${e.workerName} — dodijeljen ovom nalogu` : e.workerName}>
                                        <span className={`abcm-wchip-dot ${e.kind === 'teren' ? 'is-teren' : 'is-present'}`}>
                                            {e.kind === 'teren' ? <Car size={11} /> : initials(e.workerName)}
                                        </span>
                                        {shortName(e.workerName)}
                                        {half && <span className="abcm-wchip-half">½</span>}
                                    </button>
                                );
                            })}

                            {card.candidates.length > 2 && (
                                <button type="button" className="abcm-link abcm-link--chip"
                                    onClick={() => onSetAll(card.candidates.map(c => c.entry.workerId), o.workOrderId, n < card.candidates.length)}>
                                    {n < card.candidates.length ? 'Svi' : 'Niko'}
                                </button>
                            )}
                        </div>
                    </section>
                );
            })}

            {!searching && hidden > 0 && (
                <button type="button" className="abcm-more" onClick={onShowAll}>
                    Prikaži još {hidden} {plural(hidden, 'nalog', 'naloga')}
                </button>
            )}
        </div>
    );
}

// ── Sitni dijelovi ───────────────────────────────────────────────────────────

/** Desni bedž naloga: šta će potvrda uraditi (pokreni/nastavi) ili status naloga. */
function OrderChip({ option: o, active }: { option: PresentOrderOption; active: boolean }) {
    if (o.paused && active) return <span className="abcm-chip abcm-chip--resume"><RotateCcw size={11} /> pokreni ponovo</span>;
    if (o.notStarted && active) return <span className="abcm-chip abcm-chip--resume"><Play size={11} /> pokrenuće se</span>;
    if (o.notStarted) return <span className="abcm-chip abcm-chip--new">nije pokrenut</span>;
    if (o.paused) return <span className="abcm-chip abcm-chip--paused">Pauziran</span>;
    return <span className="abcm-chip">{o.status}</span>;
}

function toSelectOption(o: PresentOrderOption, orderById: Map<string, WorkOrder>) {
    return {
        value: o.workOrderId,
        label: o.name,
        subLabel: orderItemsPreview(orderById.get(o.workOrderId)),
        badge: {
            text: o.paused ? 'Pauziran' : o.status,
            tone: (o.status === 'U toku' && !o.paused ? 'active' : 'neutral') as 'active' | 'neutral',
        },
    };
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase() || '?';
}

/** „Samir Plećan" → „Samir P." — dugmad radnika ostaju uska, a imena razlučiva. */
function shortName(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return name;
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** Do 3 naziva stavki s naloga — nalozi sličnih imena se razlikuju po sadržaju. */
function orderItemsPreview(w?: WorkOrder): string {
    if (!w) return '';
    const names = Array.from(new Set((w.items || []).map(i => i.Product_Name).filter(Boolean)));
    if (names.length === 0) return '';
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}

/** Svi termini moraju biti sadržani (redoslijed nebitan) — isto kao SearchableSelect. */
function matches(query: string, ...texts: (string | undefined)[]): boolean {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const hay = texts.filter(Boolean).join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
}

/** ISO pomak za N dana, lokalno (bez UTC pomaka) — isti račun kao u šihtarici. */
function shiftISO(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** „pet 11.09." — kratko ime dana za dugme kad izvor nije jučer. */
function dayLabel(iso?: string): string {
    if (!iso) return 'jučer';
    try {
        return new Date(iso + 'T00:00:00').toLocaleDateString('bs-BA', { weekday: 'short', day: '2-digit', month: '2-digit' });
    } catch {
        return iso;
    }
}

function plural(n: number, one: string, many: string): string {
    const mod10 = n % 10, mod100 = n % 100;
    return (mod10 === 1 && mod100 !== 11) ? one : many;
}
