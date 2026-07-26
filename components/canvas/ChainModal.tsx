'use client';

// ════════════════════════════════════════════════════════════════════
// ChainModal — unazadni lanac: PRIJEDLOG prije primjene.
//
// Ovo je razlika između alata i automatike koju je korisnik odbio: platno
// izračuna šta bi trebalo, POKAŽE razlike, i čeka. Ništa se ne mijenja dok se
// ne klikne „Primijeni", a i tada je jedan Ctrl+Z dovoljan da se sve vrati.
//
// Ako lanac ne stane, to se KAŽE OTVORENO s brojem dana koji fale — a ne sakrije
// iza tiho pomjerenih datuma.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { Link2, AlertTriangle, Lock, ArrowRight, ShoppingCart } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { PlanScenario } from '@/lib/types';
import { computeBackwardChain, anchorCandidates, type ScheduleChange } from '@/lib/canvas/schedule';
import { BLOCK_LABEL } from '@/lib/canvas/model';

interface ChainModalProps {
    isOpen: boolean;
    scenario: PlanScenario;
    todayISO: string;
    isSaturdayWorking?: (d: Date) => boolean;
    onClose: () => void;
    onApply: (changes: { id: string; startISO: string; endISO: string }[]) => void;
}

const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

function ChangeRow({ c }: { c: ScheduleChange }) {
    const earlier = c.deltaDays < 0;
    return (
        <li className="cv-chain-row">
            <span className={`cv-kind-chip k-${c.kind}`}>{BLOCK_LABEL[c.kind]}</span>
            <span className="cv-chain-title">{c.title}</span>
            <span className="cv-chain-dates">
                <s>{dm(c.fromStartISO)}–{dm(c.fromEndISO)}</s>
                <ArrowRight size={12} />
                <strong>{dm(c.startISO)}–{dm(c.endISO)}</strong>
            </span>
            <span className={`cv-chain-delta${earlier ? ' earlier' : ''}`}>
                {c.deltaDays > 0 ? `+${c.deltaDays}` : c.deltaDays} d
            </span>
            {c.orderByISO && (
                <span className="cv-chain-orderby">
                    <ShoppingCart size={11} /> naruči do <strong>{dm(c.orderByISO)}</strong>
                </span>
            )}
        </li>
    );
}

export default function ChainModal({
    isOpen, scenario, todayISO, isSaturdayWorking, onClose, onApply,
}: ChainModalProps) {
    const anchors = useMemo(() => anchorCandidates(scenario), [scenario]);
    const [anchorId, setAnchorId] = useState<string>('');
    const effectiveAnchor = anchorId || anchors[0]?.id || '';

    const result = useMemo(
        () => effectiveAnchor
            ? computeBackwardChain(scenario, effectiveAnchor, { todayISO, isSaturdayWorking })
            : null,
        [scenario, effectiveAnchor, todayISO, isSaturdayWorking]
    );

    const canApply = !!result && result.changes.length > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><Link2 size={17} /> Preračunaj lanac unazad</>}
            size="large"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                    <button className="btn btn-primary" disabled={!canApply}
                        onClick={() => {
                            if (!result) return;
                            onApply(result.changes.map(c => ({ id: c.id, startISO: c.startISO, endISO: c.endISO })));
                            onClose();
                        }}>
                        Primijeni {result?.changes.length ? `(${result.changes.length})` : ''}
                    </button>
                </>
            }
        >
            {anchors.length === 0 ? (
                <p className="cv-chain-empty">
                    Nema fiksne obaveze od koje bi se računalo unazad. Dodaj <strong>montažu</strong> ili
                    <strong> prekretnicu</strong> s datumom koji je klijent dao, poveži lanac, pa se vrati ovdje.
                </p>
            ) : (
                <>
                    <label className="cv-field">
                        <span>Računaj unazad od</span>
                        <select value={effectiveAnchor} onChange={e => setAnchorId(e.target.value)}>
                            {anchors.map(a => (
                                <option key={a.id} value={a.id}>
                                    {a.title} — {dm(a.startISO)}{a.locked ? ' (zaključano)' : ''}
                                </option>
                            ))}
                        </select>
                    </label>

                    {result && (
                        <>
                            {result.shortfallDays > 0 && (
                                <div className="cv-chain-alert err">
                                    <AlertTriangle size={16} />
                                    <div>
                                        <strong>Lanac ne stane — fali {result.shortfallDays} dana.</strong>
                                        <p>
                                            Neka narudžba bi morala otići u prošlost. Pomjeri montažu,
                                            povećaj ekipu, ili traži brži rok od dobavljača.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {result.urgentOrders.length > 0 && (
                                <div className="cv-chain-alert warn">
                                    <ShoppingCart size={16} />
                                    <div>
                                        <strong>Hitno naručiti</strong>
                                        <p>
                                            {result.urgentOrders.map(o =>
                                                `${o.title} — do ${dm(o.orderByISO)}${o.daysLeft < 0 ? ` (kasni ${-o.daysLeft} d)` : ''}`
                                            ).join(' · ')}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {result.warnings.map((w, i) => (
                                <p key={i} className="cv-chain-warn">{w}</p>
                            ))}

                            {result.changes.length > 0 ? (
                                <>
                                    <h4 className="cv-chain-h">Predložene izmjene</h4>
                                    <ul className="cv-chain-list">
                                        {result.changes.map(c => <ChangeRow key={c.id} c={c} />)}
                                    </ul>
                                </>
                            ) : (
                                <p className="cv-chain-empty">
                                    Sve već stoji kako treba — nema šta pomjeriti.
                                </p>
                            )}

                            {result.blockedByLock.length > 0 && (
                                <>
                                    <h4 className="cv-chain-h">
                                        <Lock size={13} /> Zaključano — neće se pomjeriti
                                    </h4>
                                    <ul className="cv-chain-list locked">
                                        {result.blockedByLock.map(c => <ChangeRow key={c.id} c={c} />)}
                                    </ul>
                                </>
                            )}
                        </>
                    )}
                </>
            )}
        </Modal>
    );
}
