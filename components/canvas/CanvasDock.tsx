'use client';

// ════════════════════════════════════════════════════════════════════
// CanvasDock — dnevni izlaz platna.
//
// Planerske table umiru kad prestanu davati nešto upotrebljivo SVAKI DAN.
// Zato su „Naruči danas" i „Problemi" uvijek pri ruci, a ne skriveni u meniju:
// oni su razlog da se platno otvori i kad se ništa ne planira.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { AlertTriangle, AlertCircle, ShoppingCart, BarChart3, ChevronDown, Check } from 'lucide-react';
import type { PlanScenario, PlanBlock } from '@/lib/types';
import { detectConflicts, ordersDueSoon, CONFLICT_LABEL, type ConflictContext, type ConflictFix } from '@/lib/canvas/conflicts';
import { dailyCapacity, capacitySummary, type CapacityContext } from '@/lib/canvas/capacity';
import './CanvasDock.css';

type DockTab = 'problemi' | 'naruci' | 'kapacitet';

interface CanvasDockProps {
    scenario: PlanScenario;
    conflictCtx: ConflictContext;
    capacityCtx: CapacityContext;
    fromISO: string;
    days: number;
    onJumpToBlock: (blockId: string) => void;
    onMarkSent: (blockId: string) => void;
    /** Primijeni ponuđeno rješenje konflikta jednim klikom. */
    onFix: (fix: ConflictFix) => void;
}

const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

export default function CanvasDock({
    scenario, conflictCtx, capacityCtx, fromISO, days, onJumpToBlock, onMarkSent, onFix,
}: CanvasDockProps) {
    const [open, setOpen] = useState(true);
    const [tab, setTab] = useState<DockTab>('problemi');

    const conflicts = useMemo(() => detectConflicts(scenario, conflictCtx), [scenario, conflictCtx]);
    const due = useMemo(() => ordersDueSoon(scenario, conflictCtx.todayISO), [scenario, conflictCtx.todayISO]);
    const cap = useMemo(
        () => dailyCapacity(scenario, capacityCtx, fromISO, days),
        [scenario, capacityCtx, fromISO, days]
    );
    const summary = useMemo(() => capacitySummary(cap), [cap]);

    const errors = conflicts.filter(c => c.severity === 'error').length;
    const maxBar = Math.max(1, ...cap.map(d => d.available), ...cap.map(d => d.planned + d.committed));

    return (
        <div className={`cv-dock${open ? ' open' : ''}`}>
            <div className="cv-dock-tabs">
                <button className={tab === 'problemi' ? 'on' : ''}
                    onClick={() => { setTab('problemi'); setOpen(true); }}>
                    <AlertTriangle size={14} /> Problemi
                    {conflicts.length > 0 && (
                        <span className={`cv-badge${errors ? ' err' : ''}`}>{conflicts.length}</span>
                    )}
                </button>
                <button className={tab === 'naruci' ? 'on' : ''}
                    onClick={() => { setTab('naruci'); setOpen(true); }}>
                    <ShoppingCart size={14} /> Naruči danas
                    {due.length > 0 && <span className="cv-badge err">{due.length}</span>}
                </button>
                <button className={tab === 'kapacitet' ? 'on' : ''}
                    onClick={() => { setTab('kapacitet'); setOpen(true); }}>
                    <BarChart3 size={14} /> Kapacitet
                    {summary.overloadedCount > 0 && <span className="cv-badge">{summary.overloadedCount}</span>}
                </button>

                <span className="cv-spacer" />
                <button className="cv-dock-toggle" onClick={() => setOpen(v => !v)}
                    aria-label={open ? 'Sakrij' : 'Prikaži'}>
                    <ChevronDown size={16} style={{ transform: open ? 'none' : 'rotate(180deg)' }} />
                </button>
            </div>

            {open && (
                <div className="cv-dock-body">
                    {tab === 'problemi' && (
                        conflicts.length === 0
                            ? <p className="cv-dock-empty">Nema problema u ovom scenariju.</p>
                            : (
                                <ul className="cv-conflicts">
                                    {conflicts.map(c => (
                                        <li key={c.id} className={c.severity}>
                                            {c.severity === 'error'
                                                ? <AlertCircle size={14} />
                                                : <AlertTriangle size={14} />}
                                            <span className="cv-conflict-kind">{CONFLICT_LABEL[c.kind]}</span>
                                            <span className="cv-conflict-msg">{c.message}</span>
                                            {c.fix && (
                                                <button className="cv-link-btn fix"
                                                    onClick={() => onFix(c.fix!)}
                                                    title="Primijeni rješenje (Ctrl+Z vraća)">
                                                    <Check size={12} /> {c.fix.label}
                                                </button>
                                            )}
                                            <button className="cv-link-btn"
                                                onClick={() => onJumpToBlock(c.blockIds[0])}>
                                                pokaži
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                    )}

                    {tab === 'naruci' && (
                        due.length === 0
                            ? <p className="cv-dock-empty">Nijedna narudžba ne ističe u naredna 3 dana.</p>
                            : (
                                <ul className="cv-due">
                                    {due.map(({ block, orderByISO, daysLeft }) => (
                                        <li key={block.id} className={daysLeft < 0 ? 'late' : ''}>
                                            <span className="cv-due-when">
                                                {daysLeft < 0
                                                    ? `kasni ${-daysLeft} d`
                                                    : daysLeft === 0 ? 'danas' : `za ${daysLeft} d`}
                                            </span>
                                            <span className="cv-due-title">{block.title}</span>
                                            {block.supplierRef?.name && (
                                                <span className="cv-due-sup">{block.supplierRef.name}</span>
                                            )}
                                            <span className="cv-due-date">rok slanja {dm(orderByISO)}</span>
                                            <button className="cv-link-btn" onClick={() => onJumpToBlock(block.id)}>
                                                pokaži
                                            </button>
                                            {/* „Poslano" je oznaka SAMO u scenariju — ne kreira stvarnu narudžbu */}
                                            <button className="cv-link-btn ok" onClick={() => onMarkSent(block.id)}
                                                title="Označi kao poslano (samo u planu)">
                                                <Check size={12} /> poslano
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                    )}

                    {tab === 'kapacitet' && (
                        <div className="cv-cap">
                            <div className="cv-cap-summary">
                                <span>
                                    Vrh: <strong className={summary.peakRatio && summary.peakRatio > 1 ? 'over' : ''}>
                                        {summary.peakRatio !== null ? `${Math.round(summary.peakRatio * 100)}%` : '—'}
                                    </strong>
                                </span>
                                <span>Preopterećenih dana: <strong>{summary.overloadedCount}</strong></span>
                                <span>Ukupno raspoloživo: <strong>{summary.totalAvailable}</strong> radnik-dana</span>
                                <span>Opterećenje: <strong>{summary.totalLoad}</strong></span>
                            </div>
                            <div className="cv-cap-chart">
                                {cap.map(d => {
                                    const load = d.planned + d.committed;
                                    const over = d.ratio !== null && d.ratio > 1;
                                    return (
                                        <div key={d.dateISO} className="cv-cap-col" title={
                                            `${d.dateISO}\nraspoloživo ${d.available}\nplan ${d.planned}\npreuzeto ${d.committed}`
                                        }>
                                            <div className="cv-cap-stack">
                                                <div className="cv-cap-avail"
                                                    style={{ height: `${(d.available / maxBar) * 100}%` }} />
                                                <div className={`cv-cap-load${over ? ' over' : ''}`}
                                                    style={{ height: `${(load / maxBar) * 100}%` }} />
                                            </div>
                                            <span className={`cv-cap-lbl${d.isWorkingDay ? '' : ' off'}`}>
                                                {dm(d.dateISO).replace('.', '')}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="cv-dock-note">
                                Siva traka = raspoloživi ljudi (šihtarica). Plava = plan + <strong>već preuzet
                                    stvarni posao</strong>. Crveno = preko kapaciteta.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export type { PlanBlock };
