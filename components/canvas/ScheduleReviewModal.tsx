'use client';

// ════════════════════════════════════════════════════════════════════
// ScheduleReviewModal — pregled prijedloga auto-rasporeda PRIJE primjene.
//
// Isti princip kao ChainModal: algoritam vraća DIFF, korisnik ga vidi (staro→novo,
// izabrana ekipa, ZAŠTO), pa „Primijeni". Ništa se ne mijenja dok ne potvrdi, i
// jedan Ctrl+Z sve vraća. Objašnjenja su razlog da se rasporedu vjeruje — a ne
// da se prihvata na vjeru.
// ════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import {
    CalendarClock, ArrowRight, Users, AlertTriangle, Sparkles, Check, Info,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { PlanScenario } from '@/lib/types';
import {
    toAssignments, scheduleSummary, type AutoScheduleResult,
} from '@/lib/canvas/autoSchedule';
import type { ScheduleAssignment } from '@/lib/canvas/scenarioReducer';
import './ScheduleReviewModal.css';

interface ScheduleReviewModalProps {
    isOpen: boolean;
    scenario: PlanScenario;
    result: AutoScheduleResult | null;
    onClose: () => void;
    onApply: (assignments: ScheduleAssignment[]) => void;
}

const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

export default function ScheduleReviewModal({
    isOpen, scenario, result, onClose, onApply,
}: ScheduleReviewModalProps) {
    const byId = useMemo(() => new Map(scenario.Blocks.map(b => [b.id, b])), [scenario.Blocks]);
    const summary = useMemo(
        () => (result ? scheduleSummary(scenario, result) : null),
        [scenario, result]
    );

    const apply = () => {
        if (!result) return;
        onApply(toAssignments(result));
        onClose();
    };

    const hasScheduled = (result?.scheduled.length || 0) > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><Sparkles size={17} /> Prijedlog rasporeda</>}
            size="xl"
            footer={
                <div className="sr-foot">
                    <span className="sr-foot-note">
                        <Info size={13} /> Ništa se ne mijenja dok ne primijeniš. Ctrl+Z vraća.
                    </span>
                    <div className="sr-foot-actions">
                        <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                        <button className="btn btn-primary" disabled={!hasScheduled} onClick={apply}>
                            <Check size={15} /> Primijeni raspored
                        </button>
                    </div>
                </div>
            }
        >
            <div className="sr-shell">
                {summary && (
                    <div className="sr-summary">
                        <div className="sr-stat">
                            <span className="sr-stat-num">{summary.scheduledCount}</span>
                            <span className="sr-stat-lbl">raspoređeno</span>
                        </div>
                        <div className="sr-stat">
                            <span className="sr-stat-num">{summary.lastEndISO ? dm(summary.lastEndISO) : '—'}</span>
                            <span className="sr-stat-lbl">zadnji kraj</span>
                        </div>
                        {summary.unscheduledCount > 0 && (
                            <div className="sr-stat warn">
                                <span className="sr-stat-num">{summary.unscheduledCount}</span>
                                <span className="sr-stat-lbl">neraspoređeno</span>
                            </div>
                        )}
                    </div>
                )}

                {!hasScheduled && (
                    <p className="sr-empty">
                        Nema šta rasporediti. Nalozi trebaju kandidat-ekipe i radnik-dane — dodaj ih u batch unosu ili u detaljima naloga.
                    </p>
                )}

                {hasScheduled && (
                    <ul className="sr-list">
                        {result!.scheduled.map(s => {
                            const b = byId.get(s.blockId);
                            const moved = b && (b.startISO !== s.startISO || b.endISO !== s.endISO);
                            return (
                                <li key={s.blockId} className="sr-item">
                                    <div className="sr-item-head">
                                        <CalendarClock size={14} />
                                        <span className="sr-item-title">{b?.title || 'Nalog'}</span>
                                        <span className="sr-item-crew">
                                            <Users size={12} /> {s.workerRefs.map(w => w.name).join(' + ')}
                                        </span>
                                    </div>
                                    <div className="sr-item-dates">
                                        {moved && b && (
                                            <span className="sr-old">{dm(b.startISO)}–{dm(b.endISO)}</span>
                                        )}
                                        {moved && <ArrowRight size={12} />}
                                        <span className="sr-new">{dm(s.startISO)}–{dm(s.endISO)}</span>
                                    </div>
                                    <div className="sr-reasons">
                                        {s.reasons.map((r, i) => (
                                            <span key={i} className={`sr-reason r-${r.code.split('-')[0]}`}>{r.text}</span>
                                        ))}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {(result?.unscheduled.length || 0) > 0 && (
                    <div className="sr-unsched">
                        <h4><AlertTriangle size={14} /> Nije raspoređeno</h4>
                        <ul>
                            {result!.unscheduled.map(u => (
                                <li key={u.blockId}>
                                    <strong>{byId.get(u.blockId)?.title || 'Nalog'}</strong>
                                    <span>{u.reason}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </Modal>
    );
}
