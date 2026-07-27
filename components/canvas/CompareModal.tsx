'use client';

// ════════════════════════════════════════════════════════════════════
// CompareModal — „isplati li se uzeti posao".
//
// Dupliraš plan, ubaciš novi nalog, i ovdje vidiš ŠTA TE KOŠTA: koliko
// konflikata nastane, koliko naraste vršno opterećenje, koliko se pomjeri
// zadnji datum.
//
// Boji se SAMO ono što boli u radionici. Više radnik-dana je namjerno
// neutralno — to je prihod, ne problem.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { GitCompareArrows, Loader2, ArrowRight } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { PlanScenario } from '@/lib/types';
import { getScenario } from '@/lib/services';
import { computeScenarioKpi, compareScenarios } from '@/lib/canvas/compare';
import type { ConflictContext } from '@/lib/canvas/conflicts';
import type { CapacityContext } from '@/lib/canvas/capacity';

interface CompareModalProps {
    isOpen: boolean;
    /** Trenutno otvoreni scenarij — lijeva strana poređenja. */
    current: PlanScenario;
    /** Lista za izbor druge strane. */
    scenarios: PlanScenario[];
    organizationId: string;
    conflictCtx: ConflictContext;
    capacityCtx: CapacityContext;
    fromISO: string;
    days: number;
    onClose: () => void;
}

export default function CompareModal({
    isOpen, current, scenarios, organizationId, conflictCtx, capacityCtx, fromISO, days, onClose,
}: CompareModalProps) {
    const others = useMemo(
        () => scenarios.filter(s => s.Scenario_ID !== current.Scenario_ID),
        [scenarios, current.Scenario_ID]
    );

    const [otherId, setOtherId] = useState('');
    const [other, setOther] = useState<PlanScenario | null>(null);
    const [loading, setLoading] = useState(false);

    const effectiveId = otherId || others[0]?.Scenario_ID || '';

    // Lista scenarija u memoriji nosi SAMO metapodatke iz posljednjeg dohvata —
    // blokovi se moraju učitati svježi, inače se poredi zastarjelo stanje.
    useEffect(() => {
        if (!isOpen || !effectiveId || !organizationId) { setOther(null); return; }
        let alive = true;
        setLoading(true);
        getScenario(effectiveId, organizationId)
            .then(s => { if (alive) setOther(s); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [isOpen, effectiveId, organizationId]);

    const rows = useMemo(() => {
        if (!other) return null;
        const opts = { fromISO, days };
        return compareScenarios(
            computeScenarioKpi(current, conflictCtx, capacityCtx, opts),
            computeScenarioKpi(other, conflictCtx, capacityCtx, opts),
        );
    }, [current, other, conflictCtx, capacityCtx, fromISO, days]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><GitCompareArrows size={17} /> Uporedi planove</>}
            size="large"
            footer={<button className="btn btn-secondary" onClick={onClose}>Zatvori</button>}
        >
            {others.length === 0 ? (
                <p className="cv-chain-empty">
                    Nema drugog plana za poređenje. Klikni <strong>Dupliraj</strong>, promijeni nešto
                    u kopiji, pa se vrati ovdje.
                </p>
            ) : (
                <>
                    <div className="cv-tpl-grid">
                        <label className="cv-field">
                            <span>Trenutni plan</span>
                            <input value={current.Name} readOnly />
                        </label>
                        <label className="cv-field">
                            <span>Uporedi sa</span>
                            <select value={effectiveId} onChange={e => setOtherId(e.target.value)}>
                                {others.map(s => (
                                    <option key={s.Scenario_ID} value={s.Scenario_ID}>{s.Name}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {loading && (
                        <p className="cv-chain-warn">
                            <Loader2 size={13} className="cv-spin" /> Učitavam plan…
                        </p>
                    )}

                    {rows && other && (
                        <>
                            <table className="cv-cmp">
                                <thead>
                                    <tr>
                                        <th />
                                        <th>{current.Name}</th>
                                        <th />
                                        <th>{other.Name}</th>
                                        <th className="cv-cmp-delta">Razlika</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => (
                                        <tr key={r.key}>
                                            <td className="cv-cmp-label">{r.label}</td>
                                            <td className="cv-cmp-val">{r.a}</td>
                                            <td className="cv-cmp-arrow"><ArrowRight size={12} /></td>
                                            <td className="cv-cmp-val">{r.b}</td>
                                            <td className={`cv-cmp-delta${r.delta && !r.neutral ? (r.worse ? ' worse' : ' better') : ''}`}>
                                                {r.delta || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <p className="cv-chain-warn">
                                Crveno = gore u radionici (više problema, veće opterećenje, kasniji kraj).
                                Više radnik-dana nije obojeno — to je posao, ne problem.
                            </p>
                        </>
                    )}
                </>
            )}
        </Modal>
    );
}
