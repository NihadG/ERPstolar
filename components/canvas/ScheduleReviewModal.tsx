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
import type { ProposalQuality } from '@/lib/canvas/opt/propose';
import type { QualityReport } from '@/lib/canvas/opt/quality';
import { isoAt } from '@/lib/canvas/opt/instance';
import './ScheduleReviewModal.css';

interface ScheduleReviewModalProps {
    isOpen: boolean;
    scenario: PlanScenario;
    /** Optimizator v2 dodaje ocjenu prije/poslije; stari raspored je nema. */
    result: (AutoScheduleResult & { quality?: ProposalQuality }) | null;
    onClose: () => void;
    onApply: (assignments: ScheduleAssignment[]) => void;
}

const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

/** Red poređenja „prije → poslije": brojevi iz ocjene (lib/canvas/opt/quality.ts). */
function compareRows(q: ProposalQuality) {
    const b = q.before.evaluation.objective, a = q.after.evaluation.objective;
    const ok = (v: number) => (v === 0 ? 'sve prolaze' : `prekršeno ${Math.round(v * 10) / 10}`);
    const day = (_r: QualityReport, d: number) => (d >= 0 ? dm(isoAt(q.startISO, d)) : '—');
    const rows: { label: string; before: string; after: string; good: boolean; note?: string }[] = [
        { label: 'Provjere', before: ok(b.violation), after: ok(a.violation), good: a.violation <= b.violation },
        {
            label: 'Sve gotovo', before: day(q.before, b.makespan), after: day(q.after, a.makespan), good: a.makespan <= b.makespan,
            note: q.after.bounds.makespan ? `dokazano najranije ${dm(q.after.bounds.makespan.iso)}` : undefined,
        },
    ];
    if (b.urgentEnd >= 0 || a.urgentEnd >= 0) rows.push({ label: 'Hitno gotovo', before: day(q.before, b.urgentEnd), after: day(q.after, a.urgentEnd), good: a.urgentEnd <= b.urgentEnd });
    if (b.highEnd >= 0 || a.highEnd >= 0) rows.push({ label: 'Visok prioritet', before: day(q.before, b.highEnd), after: day(q.after, a.highEnd), good: a.highEnd <= b.highEnd });
    rows.push({ label: 'Kašnjenje preko rokova', before: `${b.tardiness} d`, after: `${a.tardiness} d`, good: a.tardiness <= b.tardiness });
    rows.push({ label: 'Promjena projekta u nizu ekipa', before: String(b.switches), after: String(a.switches), good: a.switches <= b.switches });
    return rows;
}

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
    const quality = result?.quality;
    const rows = useMemo(() => (quality ? compareRows(quality) : []), [quality]);
    const proven = quality && quality.after.gapDays === 0 && quality.after.evaluation.objective.violation === 0;

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

                {quality && (
                    <div className="sr-compare">
                        <div className="sr-compare-head">
                            <span>Plan na platnu</span><span /><span>Prijedlog</span>
                        </div>
                        {rows.map(r => (
                            <div key={r.label} className={`sr-compare-row${r.good ? '' : ' worse'}`}>
                                <span className="sr-compare-lbl">{r.label}</span>
                                <span className="sr-compare-old">{r.before}</span>
                                <ArrowRight size={12} />
                                <span className="sr-compare-new">{r.after}{r.note && <em> · {r.note}</em>}</span>
                            </div>
                        ))}
                        <p className="sr-compare-note">
                            {proven
                                ? 'Prijedlog završava na dokazanoj donjoj granici — brže nije moguće s ovim ekipama i kalendarom.'
                                : quality.after.lines[0]}
                            {' '}Isprobano {quality.evals} rasporeda.
                        </p>
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
                                        <span className="sr-new">{dm(s.startISO)}{s.startsPM ? ' (pod.)' : ''}–{dm(s.endISO)}{s.endsAM ? ' (pod.)' : ''}</span>
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
