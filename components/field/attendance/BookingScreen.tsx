'use client';

// ════════════════════════════════════════════════════════════════════
// DODJELA NALOGA — ono što se otvori kad se radnik označi prisutnim
//
// Isti korak kao `AttendanceBookingConfirmModal` na desktopu, ali kao VLASTITI
// EKRAN, ne modal. Razlog: kad je prisutno deset ljudi, modal na telefonu
// postane prozorčić kroz koji se skroluje — a ovo je odluka koja se donosi
// jednom dnevno i mora se vidjeti cijela.
//
// Podaci su `ProposalRow[]` sa servera — taj oblik NE SADRŽI nijedan iznos.
// Kontrolor bira NA ŠTA se knjiži, ne koliko to košta.
//
// TEREN nije poseban slučaj s posebnim pravilima. Ranije je ovaj ekran terenskom
// radniku pokazivao samo rečenicu „odaberi ga na desktopu" i nijednu opciju — pa
// je dugme na dnu ostajalo zauvijek na „Odaberi bar jedan nalog" i dan se nije
// mogao proknjižiti s telefona. Sada teren dobija istu listu naloga kao prisutan
// radnik (montaža prva, ali i „Razni poslovi"), plus dugme koje tu i tamo otvori
// novi nalog za razne poslove.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Plus, Search } from 'lucide-react';
import type { ProposalRow } from '@/lib/attendanceBooking';
import type { BookingDecision } from '@/lib/field/useFieldAttendance';
import { MAvatar, MEmpty, MPill } from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';
import NewOrderSheet from '../orders/NewOrderSheet';

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

const longDate = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' });

/** Koliko naloga se pokaže prije nego lista traži pretragu. */
const VISIBLE_LIMIT = 7;

interface Props {
    rows: ProposalRow[];
    date: string;
    onClose: () => void;
    onConfirm: (decisions: BookingDecision[]) => Promise<void>;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface WorkerState {
    orderIds: Set<string>;
    presence: 0.5 | 1;
}

/** Nalog napravljen ovdje i odmah ponuđen svima na ekranu. */
interface FreshOrder {
    workOrderId: string;
    name: string;
    status: string;
    paused: boolean;
    assigned: boolean;
    notStarted: boolean;
    type?: string;
}

export default function BookingScreen({ rows, date, onClose, onConfirm, showToast }: Props) {
    const [state, setState] = useState<Map<string, WorkerState>>(() => {
        const init = new Map<string, WorkerState>();
        for (const r of rows) {
            const preselected = r.kind === 'present'
                ? r.suggestedOrderIds
                : (r.suggestedWorkOrderId ? [r.suggestedWorkOrderId] : []);
            init.set(r.workerId, { orderIds: new Set(preselected), presence: 1 });
        }
        return init;
    });
    const [saving, setSaving] = useState(false);
    const [queries, setQueries] = useState<Record<string, string>>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [fresh, setFresh] = useState<FreshOrder[]>([]);
    const [newOrderFor, setNewOrderFor] = useState<{ workerId: string; workerName: string } | null>(null);

    // Hardverska nazad-tipka i swipe zatvaraju ekran — ista pogodba kao
    // ostali puni ekrani (MobileOrderDetail).
    useEffect(() => {
        window.history.pushState({ fieldBooking: true }, '');
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
    const swipeRef = useSwipeBack(goBack, { enabled: !saving && !newOrderFor });

    const toggleOrder = (workerId: string, orderId: string) => {
        setState(prev => {
            const next = new Map(prev);
            const cur = next.get(workerId) || { orderIds: new Set<string>(), presence: 1 as const };
            const ids = new Set(cur.orderIds);
            if (ids.has(orderId)) ids.delete(orderId); else ids.add(orderId);
            next.set(workerId, { ...cur, orderIds: ids });
            return next;
        });
    };

    const setPresence = (workerId: string, presence: 0.5 | 1) => {
        setState(prev => {
            const next = new Map(prev);
            const cur = next.get(workerId) || { orderIds: new Set<string>(), presence: 1 as const };
            next.set(workerId, { ...cur, presence });
            return next;
        });
    };

    /**
     * Ponuda naloga za jedan red. Nalozi napravljeni na ovom ekranu idu na vrh
     * svima — kad se otvori „Razni poslovi" za jednog radnika, isti posao je po
     * pravilu radila cijela ekipa, pa ga ne treba tražiti ponovo.
     */
    const optionsFor = (row: ProposalRow) => {
        const base = row.orders;
        if (fresh.length === 0) return base;
        const known = new Set(base.map(o => o.workOrderId));
        return [...fresh.filter(f => !known.has(f.workOrderId)), ...base];
    };

    const willBook = useMemo(
        () => rows.filter(r => (state.get(r.workerId)?.orderIds.size || 0) > 0).length,
        [rows, state]
    );

    const confirm = async () => {
        if (saving) return;
        const decisions: BookingDecision[] = rows
            .map(r => {
                const s = state.get(r.workerId);
                return {
                    workerId: r.workerId,
                    workerName: r.workerName,
                    orderIds: Array.from(s?.orderIds || []),
                    presence: s?.presence || 1,
                };
            })
            .filter(d => d.orderIds.length > 0);

        setSaving(true);
        try {
            await onConfirm(decisions);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mui fbk" ref={swipeRef}>
            <header className="mwd-nav mui-subnav">
                <button type="button" className="mwd-back" onClick={goBack} disabled={saving}>
                    <ArrowLeft size={21} strokeWidth={2.3} /> Šihtarica
                </button>
            </header>

            <div className="fbk-head">
                <h1>Dodjela naloga</h1>
                <p>{longDate(date)} · biraš na čemu je ko radio</p>
            </div>

            {rows.length === 0 && (
                <MEmpty title="Nema šta da se knjiži" sub="Nijedan prisutan radnik nema aktivan nalog." />
            )}

            <div className="fbk-list">
                {rows.map(row => {
                    const s = state.get(row.workerId);
                    const chosen = s?.orderIds || new Set<string>();
                    const all = optionsFor(row);
                    const q = (queries[row.workerId] || '').trim().toLowerCase();
                    const matching = q ? all.filter(o => o.name.toLowerCase().includes(q)) : all;
                    // Odabrani nalozi ostaju vidljivi i kad ih skraćivanje liste izbaci —
                    // inače se čekirano „izgubi" čim lista pređe granicu.
                    const showAll = expanded[row.workerId] || !!q;
                    const visible = showAll
                        ? matching
                        : matching.filter((o, i) => i < VISIBLE_LIMIT || chosen.has(o.workOrderId));
                    const hidden = matching.length - visible.length;

                    return (
                        <div key={row.workerId} className="fbk-card">
                            <div className="fbk-card-head">
                                <MAvatar tone={chosen.size > 0 ? 'green' : 'gray'}>{initials(row.workerName)}</MAvatar>
                                <div className="fbk-card-name">
                                    <strong>{row.workerName}</strong>
                                    <span>
                                        {row.kind === 'teren' && 'teren · '}
                                        {chosen.size > 0
                                            ? `${chosen.size} ${chosen.size === 1 ? 'nalog' : 'naloga'} izabrano`
                                            : 'nijedan nalog'}
                                    </span>
                                </div>
                                <div className="fbk-presence" role="group" aria-label="Koliko je radio">
                                    <button
                                        type="button"
                                        className={s?.presence === 0.5 ? 'on' : ''}
                                        onClick={() => setPresence(row.workerId, 0.5)}
                                    >½ dana</button>
                                    <button
                                        type="button"
                                        className={s?.presence !== 0.5 ? 'on' : ''}
                                        onClick={() => setPresence(row.workerId, 1)}
                                    >Cijeli dan</button>
                                </div>
                            </div>

                            {row.kind === 'teren' && (
                                <p className="fbk-none">
                                    Na šta se odnosi teren? Montaža je najčešća, ali može i „Razni poslovi"
                                    (isporuka, popravka kod kupca).
                                </p>
                            )}

                            {all.length === 0 && (
                                <p className="fbk-none">
                                    Nema naloga na koje bi se dan mogao knjižiti — otvori novi ispod.
                                </p>
                            )}

                            {all.length > VISIBLE_LIMIT && (
                                <label className="fbk-find">
                                    <Search size={16} />
                                    <input
                                        type="text"
                                        value={queries[row.workerId] || ''}
                                        onChange={e => setQueries(p => ({ ...p, [row.workerId]: e.target.value }))}
                                        placeholder={`Traži među ${all.length} naloga…`}
                                    />
                                </label>
                            )}

                            {q && matching.length === 0 && (
                                <p className="fbk-none">Nijedan nalog ne odgovara pretrazi.</p>
                            )}

                            {visible.map(o => {
                                const on = chosen.has(o.workOrderId);
                                return (
                                    <button
                                        key={o.workOrderId}
                                        type="button"
                                        className={`fbk-order${on ? ' on' : ''}`}
                                        onClick={() => toggleOrder(row.workerId, o.workOrderId)}
                                    >
                                        <span className={`fbk-check${on ? ' on' : ''}`}>
                                            {on && <Check size={15} strokeWidth={3.4} />}
                                        </span>
                                        <span className="fbk-order-main">
                                            <span className="fbk-order-name">{o.name}</span>
                                            <span className="fbk-order-meta">
                                                {o.assigned && <MPill tone="blue">dodijeljen</MPill>}
                                                {o.type === 'Montaža' && <MPill tone="purple">montaža</MPill>}
                                                {o.type === 'Zadaci' && <MPill tone="gray">razni poslovi</MPill>}
                                                {o.paused && <MPill tone="orange">pauziran</MPill>}
                                                {o.notStarted && on && <MPill tone="green">pokrenuće se</MPill>}
                                                {!o.paused && !o.notStarted && <span>{o.status}</span>}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}

                            {hidden > 0 && (
                                <button
                                    type="button"
                                    className="fbk-more"
                                    onClick={() => setExpanded(p => ({ ...p, [row.workerId]: true }))}
                                >
                                    Prikaži još {hidden}
                                </button>
                            )}

                            <button
                                type="button"
                                className="fbk-more fbk-more--new"
                                onClick={() => setNewOrderFor({ workerId: row.workerId, workerName: row.workerName })}
                            >
                                <Plus size={16} /> Novi nalog — razni poslovi
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="fbk-foot">
                <button type="button" className="fbk-confirm" disabled={saving || willBook === 0} onClick={confirm}>
                    {saving
                        ? 'Knjižim…'
                        : willBook === 0
                            ? 'Odaberi bar jedan nalog'
                            : `Potvrdi i proknjiži · ${willBook} ${willBook === 1 ? 'radnik' : 'radnika'}`}
                </button>
                <p className="fbk-foot-note">
                    Ako otkažeš, prisustvo ostaje zabilježeno — samo dnevnica neće biti knjižena.
                </p>
            </div>

            <NewOrderSheet
                open={!!newOrderFor}
                seedWorker={newOrderFor || undefined}
                onClose={() => setNewOrderFor(null)}
                showToast={showToast}
                onCreated={(order) => {
                    const workerId = newOrderFor?.workerId;
                    setFresh(prev => [
                        { ...order, status: 'Na čekanju', paused: false, assigned: true, notStarted: true, type: 'Zadaci' },
                        ...prev,
                    ]);
                    // Nalog je otvoren zbog ovog radnika — odmah ga i čekiraj,
                    // inače bi se odmah nakon kreiranja morao tražiti i dodirnuti.
                    if (workerId) toggleOrder(workerId, order.workOrderId);
                    setNewOrderFor(null);
                }}
            />
        </div>
    );
}
