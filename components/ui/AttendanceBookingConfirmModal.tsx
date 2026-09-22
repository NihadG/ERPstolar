'use client';

// ════════════════════════════════════════════════════════════════════
// KNJIŽENJE DNEVNICA — upit nakon unosa prisustva u šihtarici
//
// Pitanje na koje ekran odgovara: „na koje naloge ide današnji dan svakog
// radnika?" Dva pogleda na ISTI izbor (workerId → Set naloga):
//
//   • PO RADNICIMA — lijevo svi radnici dana (šta je kome izabrano, ko je
//     bez naloga), desno PUNA lista naloga izabranog radnika, grupisana po
//     tome koliko je nalog bitan za njega. Nema padajućih izbornika: ranije
//     se nalog dodavao kroz uski select od 250px u podnožju svake kartice,
//     a kartice su se slagale jedna ispod druge bez kraja.
//   • PO NALOZIMA — tabela nalozi × radnici. Svaka ćelija je jedan izbor,
//     pa se na prvi pogled vidi ko je danas gdje, i sve je poravnato.
//
// Funkcionalnost je ista kao prije (½ dana, „Prepiši jučer", novi nalog
// „Razni poslovi" za teren, auto-start nepokrenutih i nastavak pauziranih
// na potvrdi) — mijenja se samo raspored.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { WorkOrder, Worker, Project, Task } from '@/lib/types';
import type { ProposalRow, PresentOrderOption } from '@/lib/attendanceBooking';
import { workOrderDisplayName } from '@/lib/utils';
import { searchTokens, matchesSearch, highlightRanges } from '@/lib/searchMatch';
import { isWorkerAssignedToAutoItem } from '@/lib/autoBook';
import Modal from './Modal';
import CustomTasksModal from './CustomTasksModal';
import {
    CheckCircle2, Car, Plus, RotateCcw, Play, Search, X, Users, Table2, AlertTriangle, Check, ChevronDown,
} from 'lucide-react';
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
    /** Za „Razni poslovi" otvoren odavde — izbor projekta i vezivanje zadataka. */
    projects?: Project[];
    tasks?: Task[];
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
type Picks = Record<string, Set<string>>;

export default function AttendanceBookingConfirmModal({
    isOpen, onClose, date, rows, workOrders, workers, projects = [], tasks = [], organizationId,
    yesterdayByWorker, yesterdaySourceDate, onConfirm, onCreated, showToast,
}: Props) {
    const [view, setView] = useState<ViewMode>('workers');
    const [query, setQuery] = useState('');
    const [saving, setSaving] = useState(false);

    // Nalozi kreirani iz ovog modala („Razni poslovi") — roditelj ih još nije
    // osvježio u `workOrders`, pa ih držimo lokalno da budu odmah vidljivi.
    // `createdFor` = radnik zbog kojeg je nalog otvoren (njemu je „dodijeljen").
    const [extraOrders, setExtraOrders] = useState<{ option: PresentOrderOption; createdFor: string }[]>([]);

    // ── Jedinstveno stanje izbora: workerId → Set(Work_Order_ID) ──────────────
    const [picks, setPicks] = useState<Picks>(() => {
        const init: Picks = {};
        rows.forEach(r => {
            init[r.workerId] = new Set(
                r.kind === 'present'
                    ? r.suggestedOrderIds
                    : (r.suggestedWorkOrderId ? [r.suggestedWorkOrderId] : [])
            );
        });
        return init;
    });

    // Nalozi vidljivi u tabeli „Po nalozima": relevantni + svaki taknut. Skup
    // samo RASTE — red ne smije nestati kad se skine zadnji radnik s njega.
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
    // teren: šire — i završeni, i „Razni poslovi"). Nalog kreiran odavde nosi naziv
    // iz baze čim ga roditelj osvježi, a do tada onaj koji je korisnik upisao.
    const entries = useMemo<Entry[]>(() => rows.map(r => {
        const known = new Set(r.orders.map(o => o.workOrderId));
        const extra = extraOrders
            .filter(x => !known.has(x.option.workOrderId))
            .map(({ option, createdFor }) => {
                const live = orderById.get(option.workOrderId);
                const assigned = createdFor === r.workerId || !!live?.items?.some(it => isWorkerAssignedToAutoItem(
                    { ID: it.ID, Assigned_Workers: it.Assigned_Workers, Processes: it.Processes, SubTasks: it.SubTasks },
                    r.workerId,
                ));
                return live
                    ? { ...option, assigned, name: workOrderDisplayName(live), status: live.Status, type: live.Work_Order_Type }
                    : { ...option, assigned };
            });
        return {
            workerId: r.workerId,
            workerName: r.workerName,
            kind: r.kind,
            options: [...r.orders, ...extra],
        };
    }), [rows, extraOrders, orderById]);

    // Izabrani radnik u prikazu „Po radnicima": prvi kome fali nalog, inače prvi.
    const [selectedId, setSelectedId] = useState<string>(() => {
        const empty = rows.find(r => r.kind === 'present' ? r.suggestedOrderIds.length === 0 : !r.suggestedWorkOrderId);
        return (empty || rows[0])?.workerId || '';
    });
    const selected = entries.find(e => e.workerId === selectedId) || entries[0];

    // ── Izbor ────────────────────────────────────────────────────────────────
    function setMany(workerIds: string[], orderIds: string[], on: boolean) {
        setPicks(prev => {
            const next = { ...prev };
            workerIds.forEach(w => {
                const s = new Set(next[w] || []);
                orderIds.forEach(id => { if (on) s.add(id); else s.delete(id); });
                next[w] = s;
            });
            return next;
        });
        if (on) setRevealedOrders(prev => { const s = new Set(prev); orderIds.forEach(id => s.add(id)); return s; });
    }

    function togglePick(workerId: string, orderId: string) {
        setMany([workerId], [orderId], !picks[workerId]?.has(orderId));
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
        const nextPicks: Picks = { ...picks };
        const nextOrders = new Set(revealedOrders);
        let applied = 0;
        for (const e of list) {
            const ids = yesterdayFor(e);
            if (ids.length === 0) continue;
            nextPicks[e.workerId] = new Set(ids);
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
        setRevealedOrders(nextOrders);
        if (!target) showToast(`Prepisano s ${sourceLabel} za ${applied} ${plural(applied, 'radnika', 'radnika')}`, 'success');
    }

    // ── Novi nalog („Razni poslovi") ─────────────────────────────────────────
    // Nalog je stvaran, samo ga roditelj još nije dovukao — prikaži ga lokalno
    // POD NAZIVOM KOJI JE KORISNIK UPISAO (ne „#broj") i odmah čekiraj, da
    // knjiženje ide istim putem kao za svaki drugi nalog.
    function handleOrderCreated(workerId: string, workOrderId: string, workOrderNumber: string, name?: string) {
        setExtraOrders(prev => prev.some(x => x.option.workOrderId === workOrderId) ? prev : [...prev, {
            createdFor: workerId,
            option: {
                workOrderId,
                name: name?.trim() || (workOrderNumber ? `#${workOrderNumber}` : 'Novi nalog'),
                status: 'Na čekanju',
                paused: false,
                assigned: true,
                notStarted: true,
                type: 'Zadaci',
            },
        }]);
        setMany([workerId], [workOrderId], true);
        setCreatingFor(null);
    }

    // ── Sažetak ──────────────────────────────────────────────────────────────
    const summary = useMemo(() => {
        const orders = new Set<string>();
        const starting = new Set<string>();
        let withOrders = 0;
        for (const e of entries) {
            const chosen = picks[e.workerId];
            if (!chosen || chosen.size === 0) continue;
            withOrders++;
            chosen.forEach(id => {
                orders.add(id);
                const o = e.options.find(x => x.workOrderId === id);
                if (o && (o.notStarted || o.paused)) starting.add(id);
            });
        }
        return { workers: withOrders, empty: entries.length - withOrders, orders: orders.size, starting: starting.size };
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

    const tokens = useMemo(() => searchTokens(query), [query]);

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="xl"
            className="abk-modal"
            title={
                <span className="abk-title">
                    <CheckCircle2 size={20} className="abk-title-icon" />
                    Knjiženje dnevnica
                    <span className="abk-title-date">{dayTitle(date)}</span>
                </span>
            }
            footer={
                <div className="abk-foot">
                    <div className="abk-foot-sum">
                        {summary.workers > 0 ? (
                            <span>
                                <b>{summary.workers}</b> {plural(summary.workers, 'radnik', 'radnika')} na{' '}
                                <b>{summary.orders}</b> {plural(summary.orders, 'nalogu', 'naloga')}
                            </span>
                        ) : <span>Nijedna dnevnica neće biti knjižena</span>}
                        {summary.empty > 0 && (
                            <span className="abk-foot-warn">
                                <AlertTriangle size={13} /> {summary.empty} bez naloga — ostaje samo prisustvo
                            </span>
                        )}
                        {summary.starting > 0 && (
                            <span className="abk-foot-note">
                                <Play size={12} /> {summary.starting} {plural(summary.starting, 'nalog', 'naloga')} će se pokrenuti
                            </span>
                        )}
                    </div>
                    <div className="abk-foot-btns">
                        <button className="abk-btn" onClick={onClose} disabled={saving}
                            title="Prisustvo ostaje zabilježeno — bez dnevnica">
                            Otkaži
                        </button>
                        <button className="abk-btn abk-btn--primary" onClick={handleConfirm} disabled={saving}>
                            {saving ? 'Knjižim…' : 'Potvrdi i proknjiži'}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="abk">
                {/* ── Alatna traka — sve kontrole iste visine, u jednom redu ───── */}
                <div className="abk-bar">
                    <div className="abk-seg" role="tablist" aria-label="Prikaz">
                        <button type="button" role="tab" aria-selected={view === 'workers'}
                            className={view === 'workers' ? 'is-on' : ''} onClick={() => setView('workers')}>
                            <Users size={14} /> Po radnicima
                        </button>
                        <button type="button" role="tab" aria-selected={view === 'orders'}
                            className={view === 'orders' ? 'is-on' : ''} onClick={() => setView('orders')}>
                            <Table2 size={14} /> Po nalozima
                        </button>
                    </div>

                    <label className="abk-search">
                        <Search size={15} />
                        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                            placeholder="Traži nalog po nazivu ili proizvodu…" />
                        {query && (
                            <button type="button" className="abk-search-clear" onClick={() => setQuery('')}
                                aria-label="Očisti pretragu"><X size={14} /></button>
                        )}
                    </label>

                    <button type="button" className="abk-btn abk-btn--ghost" onClick={() => copyYesterday()}
                        disabled={yesterdayCount === 0}
                        title={yesterdayCount === 0
                            ? 'Nema ranijeg knjiženja za prepisivanje'
                            : `Prepiši naloge s ${sourceLabel} za ${yesterdayCount} ${plural(yesterdayCount, 'radnika', 'radnika')}`}>
                        <RotateCcw size={14} /> Prepiši {sourceLabel} za sve
                        {yesterdayCount > 0 && <span className="abk-btn-count">{yesterdayCount}</span>}
                    </button>
                </div>

                {entries.length === 0 ? (
                    <div className="abk-empty">Nema radnika za knjiženje.</div>
                ) : view === 'workers' ? (
                    <div className="abk-split">
                        <WorkerRail
                            entries={entries}
                            picks={picks}
                            selectedId={selected?.workerId || ''}
                            onSelect={setSelectedId}
                            presenceOf={presenceOf}
                        />
                        {selected && (
                            <WorkerDetail
                                key={selected.workerId}
                                entry={selected}
                                chosen={picks[selected.workerId] || new Set()}
                                tokens={tokens}
                                orderById={orderById}
                                presence={presenceOf(selected.workerId)}
                                onPresence={v => setPresenceByWorker(prev => ({ ...prev, [selected.workerId]: v }))}
                                onToggle={orderId => togglePick(selected.workerId, orderId)}
                                onSetMany={(orderIds, on) => setMany([selected.workerId], orderIds, on)}
                                yesterday={yesterdayFor(selected)}
                                sourceLabel={sourceLabel}
                                onCopyYesterday={() => copyYesterday(selected)}
                                onCreateOrder={() => setCreatingFor({ workerId: selected.workerId, workerName: selected.workerName })}
                            />
                        )}
                    </div>
                ) : (
                    <OrdersMatrix
                        entries={entries}
                        picks={picks}
                        tokens={tokens}
                        orderById={orderById}
                        revealedOrders={revealedOrders}
                        showAll={showAllOrders}
                        onShowAll={() => setShowAllOrders(true)}
                        onToggle={togglePick}
                        onSetMany={setMany}
                        presenceOf={presenceOf}
                    />
                )}
            </div>

            {creatingFor && (
                <CustomTasksModal
                    isOpen={!!creatingFor}
                    onClose={() => setCreatingFor(null)}
                    workOrders={workOrders}
                    workers={workers}
                    projects={projects}
                    tasks={tasks}
                    organizationId={organizationId}
                    onCreated={onCreated}
                    showToast={showToast}
                    zIndex={2000}
                    initialWorkerId={creatingFor.workerId}
                    onOrderCreated={(workOrderId, workOrderNumber, name) =>
                        handleOrderCreated(creatingFor.workerId, workOrderId, workOrderNumber, name)}
                />
            )}
        </Modal>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// LIJEVO — svi radnici dana: izbor, sažetak i upozorenje „bez naloga"
// ═══════════════════════════════════════════════════════════════════════════
function WorkerRail({ entries, picks, selectedId, onSelect, presenceOf }: {
    entries: Entry[];
    picks: Picks;
    selectedId: string;
    onSelect: (workerId: string) => void;
    presenceOf: (workerId: string) => 0.5 | 1;
}) {
    const listRef = useRef<HTMLDivElement>(null);
    const empty = entries.filter(e => (picks[e.workerId]?.size || 0) === 0).length;

    // ↑/↓ kroz radnike — pregled dana bez miša.
    function onKeyDown(ev: KeyboardEvent<HTMLDivElement>) {
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
        ev.preventDefault();
        const i = entries.findIndex(e => e.workerId === selectedId);
        const next = entries[Math.max(0, Math.min(entries.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))];
        if (next) {
            onSelect(next.workerId);
            listRef.current?.querySelector<HTMLElement>(`[data-worker="${next.workerId}"]`)?.focus();
        }
    }

    return (
        <aside className="abk-rail" aria-label="Radnici">
            <div className="abk-rail-head">
                <span>Radnici <b>{entries.length}</b></span>
                {empty > 0 && <span className="abk-rail-warn"><AlertTriangle size={12} /> {empty} bez naloga</span>}
            </div>
            <div className="abk-rail-list" ref={listRef} role="listbox" onKeyDown={onKeyDown}>
                {entries.map(e => {
                    const chosen = picks[e.workerId] || new Set<string>();
                    const names = e.options.filter(o => chosen.has(o.workOrderId)).map(o => o.name);
                    const isSel = e.workerId === selectedId;
                    const half = presenceOf(e.workerId) === 0.5;
                    return (
                        <button
                            key={e.workerId}
                            type="button"
                            role="option"
                            aria-selected={isSel}
                            data-worker={e.workerId}
                            tabIndex={isSel ? 0 : -1}
                            className={`abk-rail-row${isSel ? ' is-selected' : ''}${names.length === 0 ? ' is-empty' : ''}`}
                            onClick={() => onSelect(e.workerId)}
                        >
                            <Avatar name={e.workerName} kind={e.kind} />
                            <span className="abk-rail-text">
                                <span className="abk-rail-name">{e.workerName}</span>
                                <span className="abk-rail-sub" title={names.join(', ')}>
                                    {names.length === 0 ? 'Bez naloga' : names.join(', ')}
                                </span>
                            </span>
                            <span className="abk-rail-meta">
                                {half && <span className="abk-half" title="Pola dana">½</span>}
                                <span className={`abk-rail-count${names.length === 0 ? ' is-zero' : ''}`}>{names.length}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </aside>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// DESNO — izabrani radnik: dan, šta je izabrano, sve ponuđene naloge po grupama
// ═══════════════════════════════════════════════════════════════════════════
interface Section { id: string; title: string; hint?: string; options: PresentOrderOption[] }

function WorkerDetail({
    entry, chosen, tokens, orderById, presence, onPresence, onToggle, onSetMany,
    yesterday, sourceLabel, onCopyYesterday, onCreateOrder,
}: {
    entry: Entry;
    chosen: Set<string>;
    tokens: string[];
    orderById: Map<string, WorkOrder>;
    presence: 0.5 | 1;
    onPresence: (v: 0.5 | 1) => void;
    onToggle: (orderId: string) => void;
    /** Cijela grupa odjednom („Označi sve" / „Poništi") — kao stari „Označi sve" na kartici. */
    onSetMany: (orderIds: string[], on: boolean) => void;
    yesterday: string[];
    sourceLabel: string;
    onCopyYesterday: () => void;
    onCreateOrder: () => void;
}) {
    const [showDone, setShowDone] = useState(false);
    const teren = entry.kind === 'teren';
    const searching = tokens.length > 0;
    const chosenOptions = entry.options.filter(o => chosen.has(o.workOrderId));

    // Grupe su STABILNE (ne ovise o izboru) — red ne smije pobjeći ispod prsta.
    const { sections, hiddenDone, matchCount } = useMemo(() => {
        const visible = searching
            ? entry.options.filter(o => matchesSearch(tokens, o.name, orderItemsPreview(orderById.get(o.workOrderId))))
            : entry.options;
        const done = (o: PresentOrderOption) => o.status === 'Završeno';
        const buckets: Section[] = [
            { id: 'assigned', title: 'Dodijeljeni radniku', options: [] },
            { id: 'active', title: 'U toku', options: [] },
            { id: 'paused', title: 'Pauzirani', hint: 'potvrda ih nastavlja', options: [] },
            { id: 'new', title: 'Nisu pokrenuti', hint: 'potvrda ih pokreće', options: [] },
            { id: 'done', title: 'Završeni', hint: 'montaža se knjiži i na zatvoren nalog', options: [] },
        ];
        const at = (id: string) => buckets.find(b => b.id === id)!;
        for (const o of visible) {
            if (done(o)) at('done').options.push(o);
            else if (o.assigned) at('assigned').options.push(o);
            else if (o.paused) at('paused').options.push(o);
            else if (o.notStarted) at('new').options.push(o);
            else at('active').options.push(o);
        }
        // Završeni (samo teren) su istorija — bez pretrage se vide samo izabrani.
        const doneBucket = at('done');
        let hidden = 0;
        if (!searching && !showDone) {
            const keep = doneBucket.options.filter(o => chosen.has(o.workOrderId));
            hidden = doneBucket.options.length - keep.length;
            doneBucket.options = keep;
        }
        return { sections: buckets.filter(b => b.options.length > 0), hiddenDone: hidden, matchCount: visible.length };
        // `chosen` ulazi samo zbog izabranih završenih — ostale grupe ga ne gledaju.
    }, [entry.options, tokens, searching, showDone, chosen, orderById]);

    return (
        <section className="abk-detail" aria-label={entry.workerName}>
            <header className="abk-dh">
                <Avatar name={entry.workerName} kind={entry.kind} size="lg" />
                <div className="abk-dh-who">
                    <h3>{entry.workerName}</h3>
                    <span className={`abk-kind abk-kind--${entry.kind}`}>
                        {teren ? <><Car size={12} /> Teren</> : <><CheckCircle2 size={12} /> Prisutan</>}
                    </span>
                </div>
                <div className="abk-day" role="radiogroup" aria-label="Dio dana">
                    {([0.5, 1] as const).map(v => (
                        <button key={v} type="button" role="radio" aria-checked={presence === v}
                            className={presence === v ? 'is-on' : ''} onClick={() => onPresence(v)}>
                            {v === 0.5 ? 'Pola dana' : 'Cijeli dan'}
                        </button>
                    ))}
                </div>
            </header>

            {/* Šta će se knjižiti — uvijek na vrhu, bez obzira na skrol liste ispod. */}
            <div className={`abk-picked${chosenOptions.length === 0 ? ' is-empty' : ''}`}>
                <span className="abk-picked-label">Knjiži se na</span>
                <div className="abk-picked-chips">
                    {chosenOptions.length === 0 ? (
                        <span className="abk-picked-none"><AlertTriangle size={13} /> nijedan nalog — dnevnica neće biti knjižena</span>
                    ) : chosenOptions.map(o => (
                        <span key={o.workOrderId} className="abk-chip">
                            {o.name}
                            <button type="button" onClick={() => onToggle(o.workOrderId)} aria-label={`Skini ${o.name}`}>
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                </div>
                {yesterday.length > 0 && (
                    <button type="button" className="abk-btn abk-btn--ghost abk-btn--sm" onClick={onCopyYesterday}
                        title={`Zamijeni izbor nalozima s ${sourceLabel}`}>
                        <RotateCcw size={13} /> Kao {sourceLabel} ({yesterday.length})
                    </button>
                )}
            </div>

            <div className="abk-options" role="group" aria-label="Nalozi">
                {sections.length === 0 && (
                    <div className="abk-empty abk-empty--inline">
                        {searching ? 'Nijedan nalog ne odgovara pretrazi.' : 'Nema naloga koje ovaj radnik može dobiti.'}
                    </div>
                )}
                {sections.map(sec => {
                    const ids = sec.options.map(o => o.workOrderId);
                    const allOn = ids.every(id => chosen.has(id));
                    return (
                    <div key={sec.id} className="abk-sec">
                        <div className="abk-sec-head">
                            <span className="abk-sec-title">{sec.title}</span>
                            <span className="abk-sec-count">{sec.options.length}</span>
                            {sec.hint && <span className="abk-sec-hint">{sec.hint}</span>}
                            {ids.length > 1 && (
                                <button type="button" className="abk-sec-act" onClick={() => onSetMany(ids, !allOn)}>
                                    {allOn ? 'Poništi' : 'Označi sve'}
                                </button>
                            )}
                        </div>
                        {sec.options.map(o => (
                            <OptionRow
                                key={o.workOrderId}
                                option={o}
                                on={chosen.has(o.workOrderId)}
                                preview={orderItemsPreview(orderById.get(o.workOrderId))}
                                tokens={tokens}
                                onToggle={() => onToggle(o.workOrderId)}
                            />
                        ))}
                    </div>
                    );
                })}

                {hiddenDone > 0 && (
                    <button type="button" className="abk-more" onClick={() => setShowDone(true)}>
                        <ChevronDown size={14} /> Prikaži završene naloge ({hiddenDone})
                    </button>
                )}

                {/* Novi nalog je terenska potreba („Razni poslovi" na gradilištu);
                    prisutan radnik bira iz naloga koji već postoje. */}
                {teren && (
                    <button type="button" className="abk-new" onClick={onCreateOrder}>
                        <span className="abk-new-ico"><Plus size={15} /></span>
                        <span className="abk-new-text">
                            <b>Novi nalog — razni poslovi</b>
                            <span>isporuka, popravka kod kupca… nalog dobija naziv koji upišeš</span>
                        </span>
                    </button>
                )}

                {searching && matchCount > 0 && (
                    <p className="abk-foot-hint">{matchCount} {plural(matchCount, 'nalog odgovara', 'naloga odgovara')} pretrazi</p>
                )}
            </div>
        </section>
    );
}

/** Red naloga: [kvačica] [naziv + proizvodi] [šta potvrda radi / status]. */
function OptionRow({ option: o, on, preview, tokens, onToggle }: {
    option: PresentOrderOption;
    on: boolean;
    preview: string;
    tokens: string[];
    onToggle: () => void;
}) {
    return (
        <button type="button" role="checkbox" aria-checked={on}
            className={`abk-opt${on ? ' is-on' : ''}`} onClick={onToggle}>
            <span className="abk-box">{on && <Check size={13} strokeWidth={3} />}</span>
            <span className="abk-opt-text">
                <span className="abk-opt-name">
                    <span className="abk-ellip"><Hl text={o.name} tokens={tokens} /></span>
                    {o.type === 'Montaža' && <span className="abk-type">Montaža</span>}
                    {o.type === 'Zadaci' && <span className="abk-type">Razni poslovi</span>}
                </span>
                {preview && <span className="abk-opt-sub"><Hl text={preview} tokens={tokens} /></span>}
            </span>
            <StateChip option={o} active={on} />
        </button>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// PO NALOZIMA — tabela nalozi × radnici, jedna ćelija = jedan izbor
// ═══════════════════════════════════════════════════════════════════════════
interface MatrixRow {
    option: PresentOrderOption;
    anyAssigned: boolean;
    /** workerId → da li je radnik dodijeljen nalogu; odsutan ključ = nalog mu nije ponuđen. */
    candidates: Map<string, boolean>;
}

function OrdersMatrix({ entries, picks, tokens, orderById, revealedOrders, showAll, onShowAll, onToggle, onSetMany, presenceOf }: {
    entries: Entry[];
    picks: Picks;
    tokens: string[];
    orderById: Map<string, WorkOrder>;
    revealedOrders: Set<string>;
    showAll: boolean;
    onShowAll: () => void;
    onToggle: (workerId: string, orderId: string) => void;
    onSetMany: (workerIds: string[], orderIds: string[], on: boolean) => void;
    presenceOf: (workerId: string) => 0.5 | 1;
}) {
    const searching = tokens.length > 0;

    const all = useMemo<MatrixRow[]>(() => {
        const map = new Map<string, MatrixRow>();
        for (const e of entries) {
            for (const o of e.options) {
                let row = map.get(o.workOrderId);
                if (!row) { row = { option: o, anyAssigned: false, candidates: new Map() }; map.set(o.workOrderId, row); }
                row.candidates.set(e.workerId, o.assigned);
                if (o.assigned) row.anyAssigned = true;
            }
        }
        // Stabilan redoslijed (ne ovisi o izboru) — redovi ne smiju skakati pri kliku.
        // Završeni (teren ih smije dobiti) idu na dno i ne računaju se kao „dodijeljeni" —
        // to je istorija, ne današnji posao.
        map.forEach(row => { if (row.option.status === 'Završeno') row.anyAssigned = false; });
        return Array.from(map.values()).sort((a, b) => {
            const aDone = a.option.status === 'Završeno', bDone = b.option.status === 'Završeno';
            if (aDone !== bDone) return aDone ? 1 : -1;
            if (a.anyAssigned !== b.anyAssigned) return a.anyAssigned ? -1 : 1;
            const aAct = a.option.status === 'U toku', bAct = b.option.status === 'U toku';
            if (aAct !== bAct) return aAct ? -1 : 1;
            return a.option.name.localeCompare(b.option.name, 'bs');
        });
    }, [entries]);

    const picked = (workerId: string, orderId: string) => !!picks[workerId]?.has(orderId);
    const rows = searching
        ? all.filter(r => matchesSearch(tokens, r.option.name, orderItemsPreview(orderById.get(r.option.workOrderId))))
        : all.filter(r => showAll || r.anyAssigned || revealedOrders.has(r.option.workOrderId)
            || entries.some(e => picked(e.workerId, r.option.workOrderId)));
    const hidden = all.length - rows.length;

    if (rows.length === 0) {
        return <div className="abk-empty">{searching ? 'Nijedan nalog ne odgovara pretrazi.' : 'Nema naloga za prikaz.'}</div>;
    }

    return (
        <div className="abk-mx-wrap">
            <table className="abk-mx">
                <thead>
                    <tr>
                        <th className="abk-mx-corner" scope="col">
                            <span>Nalog</span>
                            <span className="abk-mx-legend"><i className="abk-mx-dot" /> dodijeljen</span>
                        </th>
                        {entries.map(e => {
                            const half = presenceOf(e.workerId) === 0.5;
                            return (
                                <th key={e.workerId} scope="col" className="abk-mx-worker" title={`${e.workerName}${e.kind === 'teren' ? ' — teren' : ''}${half ? ' — pola dana' : ''}`}>
                                    <Avatar name={e.workerName} kind={e.kind} size="sm" />
                                    <span className="abk-mx-wname">{shortName(e.workerName)}</span>
                                    <span className="abk-mx-wmeta">{e.kind === 'teren' ? 'teren' : half ? '½ dana' : ' '}</span>
                                </th>
                            );
                        })}
                        <th className="abk-mx-allcol" scope="col"><span className="abk-sr">Svi</span></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => {
                        const o = r.option;
                        const cand = entries.filter(e => r.candidates.has(e.workerId));
                        const n = cand.filter(e => picked(e.workerId, o.workOrderId)).length;
                        const preview = orderItemsPreview(orderById.get(o.workOrderId));
                        return (
                            <tr key={o.workOrderId} className={n > 0 ? 'is-on' : ''}>
                                <th scope="row" className="abk-mx-order">
                                    <span className="abk-mx-oname">
                                        <span className="abk-ellip"><Hl text={o.name} tokens={tokens} /></span>
                                        {o.type === 'Montaža' && <span className="abk-type">Montaža</span>}
                                        {o.type === 'Zadaci' && <span className="abk-type">Razni</span>}
                                    </span>
                                    <span className="abk-mx-osub">
                                        <StateChip option={o} active={n > 0} compact />
                                        {preview && <span className="abk-mx-prev"><Hl text={preview} tokens={tokens} /></span>}
                                    </span>
                                </th>
                                {entries.map(e => {
                                    if (!r.candidates.has(e.workerId)) {
                                        return <td key={e.workerId} className="abk-mx-cell"><span className="abk-mx-na" title="Nalog nije ponuđen ovom radniku">–</span></td>;
                                    }
                                    const on = picked(e.workerId, o.workOrderId);
                                    const assigned = r.candidates.get(e.workerId);
                                    return (
                                        <td key={e.workerId} className="abk-mx-cell">
                                            <button type="button" role="checkbox" aria-checked={on}
                                                aria-label={`${e.workerName} — ${o.name}`}
                                                className={`abk-mx-box${on ? ' is-on' : ''}${assigned ? ' is-assigned' : ''}`}
                                                onClick={() => onToggle(e.workerId, o.workOrderId)}>
                                                {on && <Check size={14} strokeWidth={3} />}
                                            </button>
                                        </td>
                                    );
                                })}
                                <td className="abk-mx-all">
                                    {cand.length > 1 && (
                                        <button type="button" className="abk-link"
                                            onClick={() => onSetMany(cand.map(e => e.workerId), [o.workOrderId], n < cand.length)}>
                                            {n < cand.length ? 'Svi' : 'Niko'}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
                <tfoot>
                    <tr>
                        <th scope="row" className="abk-mx-order abk-mx-total">Naloga po radniku</th>
                        {entries.map(e => {
                            const c = picks[e.workerId]?.size || 0;
                            return <td key={e.workerId} className={`abk-mx-sum${c === 0 ? ' is-zero' : ''}`}>{c === 0 ? '0 !' : c}</td>;
                        })}
                        <td />
                    </tr>
                </tfoot>
            </table>

            {!searching && hidden > 0 && (
                <button type="button" className="abk-more" onClick={onShowAll}>
                    <ChevronDown size={14} /> Prikaži još {hidden} {plural(hidden, 'nalog', 'naloga')}
                </button>
            )}
        </div>
    );
}

// ── Sitni dijelovi ───────────────────────────────────────────────────────────

function Avatar({ name, kind, size = 'md' }: { name: string; kind: 'present' | 'teren'; size?: 'sm' | 'md' | 'lg' }) {
    return (
        <span className={`abk-ava abk-ava--${kind} abk-ava--${size}`} aria-hidden>
            {kind === 'teren' && size === 'sm' ? <Car size={11} /> : initials(name)}
        </span>
    );
}

/** Šta će potvrda uraditi s nalogom (pokrenuti/nastaviti) ili njegov status. */
function StateChip({ option: o, active, compact }: { option: PresentOrderOption; active: boolean; compact?: boolean }) {
    const cls = `abk-state${compact ? ' abk-state--compact' : ''}`;
    if (o.paused && active) return <span className={`${cls} is-go`}><RotateCcw size={11} /> nastavlja se</span>;
    if (o.notStarted && active) return <span className={`${cls} is-go`}><Play size={11} /> pokreće se</span>;
    if (o.notStarted) return <span className={`${cls} is-new`}>nije pokrenut</span>;
    if (o.paused) return <span className={`${cls} is-paused`}>pauziran</span>;
    if (o.status === 'Završeno') return <span className={`${cls} is-done`}>završen</span>;
    return <span className={`${cls} is-run`}>{o.status === 'U toku' ? 'u toku' : o.status.toLowerCase()}</span>;
}

/** Podebljan pogodak pretrage (tolerantno na dijakritiku). */
function Hl({ text, tokens }: { text: string; tokens: string[] }): ReactNode {
    const ranges = highlightRanges(text, tokens);
    if (ranges.length === 0) return text;
    const out: ReactNode[] = [];
    let at = 0;
    ranges.forEach(([s, e], i) => {
        if (s > at) out.push(text.slice(at, s));
        out.push(<mark key={i} className="abk-hit">{text.slice(s, e)}</mark>);
        at = e;
    });
    if (at < text.length) out.push(text.slice(at));
    return <>{out}</>;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase() || '?';
}

/** „Samir Plećan" → „Samir P." — kolone radnika ostaju uske, a imena razlučiva. */
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

/** ISO pomak za N dana, lokalno (bez UTC pomaka) — isti račun kao u šihtarici. */
function shiftISO(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Nazivi dana su fiksni, ne iz lokalizacije preglednika — bez bs-BA podataka
// Intl pada na engleski („Tue"), pa bi isti ekran različito izgledao na dva računara.
const DAYS_LONG = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];
const DAYS_SHORT = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];

function parseDay(iso: string): Date | null {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
}
const dd = (n: number) => String(n).padStart(2, '0');

/** „pet 11.09." — kratko ime dana za dugme kad izvor nije jučer. */
function dayLabel(iso?: string): string {
    const d = iso ? parseDay(iso) : null;
    if (!d) return iso || 'jučer';
    return `${DAYS_SHORT[d.getDay()]} ${dd(d.getDate())}.${dd(d.getMonth() + 1)}.`;
}

/** „utorak, 22.09.2026." — dan u naslovu upita. */
function dayTitle(iso: string): string {
    const d = parseDay(iso);
    if (!d) return iso;
    return `${DAYS_LONG[d.getDay()]}, ${dd(d.getDate())}.${dd(d.getMonth() + 1)}.${d.getFullYear()}.`;
}

function plural(n: number, one: string, many: string): string {
    const mod10 = n % 10, mod100 = n % 100;
    return (mod10 === 1 && mod100 !== 11) ? one : many;
}
