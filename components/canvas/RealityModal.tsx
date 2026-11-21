'use client';

// ════════════════════════════════════════════════════════════════════
// RealityModal — plan s Platna naspram Knjige rada (faza 6).
//
// Samo čita: nalozi s Platna pretvoreni u stvarne naloge, njihovi upisi rada i
// status → kasni / u planu / prognoza kraja / koliko je rada stvarno trebalo.
// Logika: lib/canvas/opt/reality.ts. Klik na red skoči na nalog na platnu.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { Activity, Loader2, CheckCircle2, Clock, AlertTriangle, CircleDashed } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { PlanBlock, PlanScenario, WorkLog, WorkOrder } from '@/lib/types';
import { planVsReality, type RealityStatus } from '@/lib/canvas/opt/reality';
import type { IsWork } from '@/lib/canvas/quickActions';
import './RealityModal.css';

interface RealityModalProps {
    isOpen: boolean;
    scenario: PlanScenario;
    workOrders: WorkOrder[];
    todayISO: string;
    isWorkFor: (b: PlanBlock) => IsWork;
    /** Učita upise rada od datuma (Knjiga rada). */
    loadLogs: (sinceISO: string) => Promise<WorkLog[]>;
    onSelectBlock: (blockId: string) => void;
    onClose: () => void;
}

const STATUS: Record<RealityStatus, { label: string; icon: JSX.Element }> = {
    'gotov': { label: 'Završen', icon: <CheckCircle2 size={13} /> },
    'u-toku': { label: 'U toku', icon: <Activity size={13} /> },
    'ceka': { label: 'Čeka', icon: <Clock size={13} /> },
    'nije-pokrenut': { label: 'Nije pokrenut', icon: <CircleDashed size={13} /> },
    'otkazan': { label: 'Otkazan', icon: <CircleDashed size={13} /> },
};

const dm = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.` : '—');

export default function RealityModal({
    isOpen, scenario, workOrders, todayISO, isWorkFor, loadLogs, onSelectBlock, onClose,
}: RealityModalProps) {
    const [logs, setLogs] = useState<WorkLog[] | null>(null);

    // Upisi od najranijeg planiranog početka (−60 dana: posao je mogao krenuti ranije od plana).
    const sinceISO = useMemo(() => {
        const starts = scenario.Blocks.filter(b => b.linkedWorkOrderId).map(b => b.startISO).sort();
        const first = starts[0] || todayISO;
        return new Date(Date.parse(`${first}T12:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
    }, [scenario.Blocks, todayISO]);

    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        setLogs(null);
        loadLogs(sinceISO).then(l => { if (alive) setLogs(l); }).catch(() => { if (alive) setLogs([]); });
        return () => { alive = false; };
    }, [isOpen, sinceISO, loadLogs]);

    const result = useMemo(
        () => (logs ? planVsReality({ scenario, workOrders, workLogs: logs, todayISO, isWorkFor }) : null),
        [logs, scenario, workOrders, todayISO, isWorkFor]
    );

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><Activity size={17} /> Plan vs stvarnost</>}
            size="large"
            footer={<button className="btn btn-secondary" onClick={onClose}>Zatvori</button>}
        >
            {!result ? (
                <p className="rv-loading"><Loader2 size={14} className="cv-spin" /> Čitam Knjigu rada…</p>
            ) : (
                <div className="rv-shell">
                    <div className="rv-summary">
                        <div className="rv-stat"><span className="rv-num">{result.onTime}</span><span className="rv-lbl">u planu</span></div>
                        <div className={`rv-stat${result.late ? ' warn' : ''}`}><span className="rv-num">{result.late}</span><span className="rv-lbl">kasni</span></div>
                        <div className="rv-stat">
                            <span className="rv-num">{result.effortAccuracy === null ? '—' : `${Math.round(result.effortAccuracy * 100)} %`}</span>
                            <span className="rv-lbl">rad ÷ plan (završeni)</span>
                        </div>
                    </div>
                    {result.lines.map((l, i) => <p key={i} className="rv-line">{l}</p>)}

                    {result.rows.length > 0 && (
                        <ul className="rv-list">
                            {result.rows.map(r => (
                                <li key={r.blockId} className={`rv-item s-${r.status}${r.late ? ' late' : ''}`}>
                                    <button className="rv-row" onClick={() => { onSelectBlock(r.blockId); onClose(); }}>
                                        <span className="rv-status">{r.late ? <AlertTriangle size={13} /> : STATUS[r.status].icon} {STATUS[r.status].label}</span>
                                        <span className="rv-title">{r.title}<em>{r.projectName}</em></span>
                                        <span className="rv-dates">
                                            plan {dm(r.plannedStartISO)}–{dm(r.plannedEndISO)}{r.plannedWD ? ` · ${r.plannedWD} rd` : ''}
                                            {r.bookedWD > 0 && <> · upisano {r.bookedWD} rd ({dm(r.firstISO)}–{dm(r.lastISO)})</>}
                                        </span>
                                        <span className="rv-verdict">{r.verdict}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </Modal>
    );
}
