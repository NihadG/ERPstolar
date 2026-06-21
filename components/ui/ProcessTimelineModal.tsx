'use client';

import { useMemo } from 'react';
import Modal from './Modal';
import { User } from 'lucide-react';
import type { WorkLog } from '@/lib/types';

interface ProcessTimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    productName: string;
    logs: WorkLog[];   // svi work logovi za ovaj proizvod
}

const DAY_FULL = ['Nedjelja', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota'];
const fmtDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    return `${DAY_FULL[d.getDay()]}, ${d.toLocaleDateString('bs-BA')}`;
};

export default function ProcessTimelineModal({ isOpen, onClose, productName, logs }: ProcessTimelineModalProps) {
    // Grupisanje po danu (najnoviji prvo) → radnici + njihovi procesi
    const byDate = useMemo(() => {
        const m = new Map<string, { worker: string; processes: string[] }[]>();
        logs.forEach(l => {
            const tags = l.Process_Tags || [];
            if (tags.length === 0) return;
            const arr = m.get(l.Date) || [];
            arr.push({ worker: l.Worker_Name, processes: tags });
            m.set(l.Date, arr);
        });
        return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    }, [logs]);

    // Sažetak: koliko puta je koji proces rađen
    const processCounts = useMemo(() => {
        const m = new Map<string, number>();
        logs.forEach(l => (l.Process_Tags || []).forEach(p => m.set(p, (m.get(p) || 0) + 1)));
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    }, [logs]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Procesi — ${productName}`} size="large" footer={null}>
            <div className="ptl">
                {byDate.length === 0 ? (
                    <div className="ptl-empty">
                        Nema zabilježenih procesa za ovaj proizvod.<br />
                        <span>Procese dodaješ u Dnevnom unosu (na liniji bookinga proizvoda).</span>
                    </div>
                ) : (
                    <>
                        <div className="ptl-summary">
                            {processCounts.map(([p, n]) => (
                                <span key={p} className="ptl-sum-chip">{p}<b>{n}×</b></span>
                            ))}
                        </div>

                        <div className="ptl-timeline">
                            {byDate.map(([date, rows]) => (
                                <div className="ptl-day" key={date}>
                                    <div className="ptl-dot" />
                                    <div className="ptl-day-body">
                                        <div className="ptl-date">{fmtDate(date)}</div>
                                        {rows.map((r, i) => (
                                            <div className="ptl-row" key={i}>
                                                <span className="ptl-worker"><User size={13} /> {r.worker}</span>
                                                <span className="ptl-procs">
                                                    {r.processes.map(p => <span key={p} className="ptl-chip">{p}</span>)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <style jsx>{`
                .ptl { display: flex; flex-direction: column; gap: 18px; padding: 4px 2px; }
                .ptl-empty { text-align: center; color: var(--text-secondary); padding: 36px 16px; font-size: 14px; }
                .ptl-empty span { font-size: 12px; color: var(--text-tertiary); }

                .ptl-summary { display: flex; flex-wrap: wrap; gap: 8px; }
                .ptl-sum-chip {
                    display: inline-flex; align-items: center; gap: 6px;
                    font-size: 12px; font-weight: 600; color: #6d28d9; background: #f3f0ff;
                    padding: 5px 12px; border-radius: 999px;
                }
                .ptl-sum-chip b { color: #9b8bd4; font-weight: 700; }

                .ptl-timeline { display: flex; flex-direction: column; }
                .ptl-day { display: flex; gap: 14px; position: relative; padding-bottom: 16px; }
                .ptl-day:not(:last-child)::before {
                    content: ''; position: absolute; left: 5px; top: 14px; bottom: 0; width: 2px; background: var(--border-light);
                }
                .ptl-dot { width: 12px; height: 12px; border-radius: 50%; background: #7c3aed; margin-top: 3px; flex-shrink: 0; z-index: 1; }
                .ptl-day-body { flex: 1; min-width: 0; }
                .ptl-date { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }
                .ptl-row { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; padding: 4px 0; }
                .ptl-worker {
                    display: inline-flex; align-items: center; gap: 5px;
                    font-size: 12px; font-weight: 600; color: var(--text-secondary); min-width: 120px;
                }
                .ptl-procs { display: flex; flex-wrap: wrap; gap: 5px; flex: 1; }
                .ptl-chip {
                    font-size: 11px; font-weight: 500; color: #6d28d9; background: #f3f0ff;
                    padding: 3px 10px; border-radius: 999px;
                }
            `}</style>
        </Modal>
    );
}
