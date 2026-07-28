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
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import type { ProposalRow } from '@/lib/attendanceBooking';
import type { BookingDecision } from '@/lib/field/useFieldAttendance';
import { MAvatar, MEmpty, MPill } from '@/components/tabs/mobile/MobileUI';
import { useOverlayGuard } from '@/components/tabs/mobile/overlayGuard';
import { useSwipeBack } from '@/components/tabs/mobile/useSwipe';

const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';

const longDate = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' });

interface Props {
    rows: ProposalRow[];
    date: string;
    onClose: () => void;
    onConfirm: (decisions: BookingDecision[]) => Promise<void>;
}

interface WorkerState {
    orderIds: Set<string>;
    presence: 0.5 | 1;
}

export default function BookingScreen({ rows, date, onClose, onConfirm }: Props) {
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
    const swipeRef = useSwipeBack(goBack, { enabled: !saving });

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
                    const options = row.kind === 'present' ? row.orders : [];

                    return (
                        <div key={row.workerId} className="fbk-card">
                            <div className="fbk-card-head">
                                <MAvatar tone={chosen.size > 0 ? 'green' : 'gray'}>{initials(row.workerName)}</MAvatar>
                                <div className="fbk-card-name">
                                    <strong>{row.workerName}</strong>
                                    <span>
                                        {row.kind === 'teren' ? 'teren' : `${chosen.size} od ${options.length} naloga`}
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

                            {row.kind === 'present' && options.length === 0 && (
                                <p className="fbk-none">Nema aktivnih naloga — dnevnica se neće knjižiti.</p>
                            )}

                            {row.kind === 'teren' && (
                                <p className="fbk-none">
                                    Teren se knjiži na montažni nalog. Ako ga nema, odaberi ga na desktopu.
                                </p>
                            )}

                            {options.map(o => {
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
                                                {o.paused && <MPill tone="orange">pauziran</MPill>}
                                                {o.notStarted && on && <MPill tone="green">pokrenuće se</MPill>}
                                                {!o.assigned && !o.paused && !o.notStarted && <span>{o.status}</span>}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
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
        </div>
    );
}
