'use client';

// ════════════════════════════════════════════════════════════════════
// ISTORIJA RADA naloga / proizvoda — samo pregled
//
// Dva pogleda nad istim podacima (lib/workHistory.ts):
//   Po procesima — redom toka: period, radnici, radnik-dana, osnova
//   Po danima    — hronologija: ko je šta radio + završeni procesi tog dana
// Osnova razlikuje upisan rad od pretpostavke („upisan je kasniji korak")
// i od procjene iz prisustva (automatska podjela pogađa proces).
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { ProcessGraph, WorkLog, WorkOrderItem } from '@/lib/types';
import {
    buildDayHistory, buildProcessHistory, historySummary,
    type DayMilestone, type LogSource, type ProcessBasis, type ProcessState,
} from '@/lib/workHistory';
import './WorkHistory.css';

interface WorkHistoryProps {
    items: Pick<WorkOrderItem, 'ID' | 'Product_ID' | 'Product_Name' | 'Processes'>[];
    graph?: ProcessGraph;
    workLogs: WorkLog[];
    /** Otvori odmah na jednom proizvodu. */
    initialItemId?: string;
}

const WEEKDAYS = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'];
const BASIS: Record<ProcessBasis, string> = {
    logged: 'Upisano', estimated: 'Procjena', assumed: 'Pretpostavljeno', checked: 'Čekirano', none: '',
};
const SOURCE: Record<LogSource, string> = { dictated: 'Diktirano', manual: 'Ručno', auto: 'Procjena' };
const STATE: Record<ProcessState, string> = { done: 'Završeno', active: 'U toku', waiting: 'Čeka' };

const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

function period(from?: string, to?: string): string {
    if (!from) return '—';
    if (!to || to === from) return dm(from);
    return `${dm(from)} – ${dm(to)}`;
}

/** Radnik-dana: 1 · ½ · 1½ · 2,3 */
function days(n: number): string {
    if (n <= 0) return '—';
    const whole = Math.floor(n + 1e-9);
    const rest = n - whole;
    if (Math.abs(rest) < 0.02) return String(whole);
    if (Math.abs(rest - 0.5) < 0.02) return whole ? `${whole}½` : '½';
    return n.toFixed(1).replace('.', ',');
}

/** Procesi završeni istog dana na istim proizvodima = jedan red („Završeno: A, B, C"). */
function groupMilestones(list: DayMilestone[]): { processes: string[]; products: string[]; assumed: boolean }[] {
    const out: { processes: string[]; products: string[]; assumed: boolean }[] = [];
    for (const m of list) {
        const same = out.find(g => g.assumed === m.assumed && g.products.join('|') === m.products.join('|'));
        if (same) same.processes.push(m.process);
        else out.push({ processes: [m.process], products: m.products, assumed: m.assumed });
    }
    return out;
}

function StateMark({ state }: { state: ProcessState }) {
    return <span className={`wh-mark ${state}`} role="img" aria-label={STATE[state]} title={STATE[state]} />;
}

export default function WorkHistory({ items, graph, workLogs, initialItemId }: WorkHistoryProps) {
    const [view, setView] = useState<'process' | 'days'>('process');
    const [itemId, setItemId] = useState<string>(initialItemId && items.some(i => i.ID === initialItemId) ? initialItemId : '');
    const scopeId = itemId || undefined;

    const rows = useMemo(() => buildProcessHistory(items, graph, workLogs, scopeId), [items, graph, workLogs, scopeId]);
    const dayList = useMemo(() => buildDayHistory(items, workLogs, scopeId), [items, workLogs, scopeId]);
    const sum = useMemo(() => historySummary(items, workLogs, scopeId), [items, workLogs, scopeId]);
    const multi = !scopeId && items.length > 1;

    return (
        <div className="wh">
            <div className="wh-bar">
                <div className="wh-seg" role="tablist">
                    <button role="tab" aria-selected={view === 'process'} className={view === 'process' ? 'active' : ''} onClick={() => setView('process')}>Po procesima</button>
                    <button role="tab" aria-selected={view === 'days'} className={view === 'days' ? 'active' : ''} onClick={() => setView('days')}>Po danima</button>
                </div>
                {items.length > 1 && (
                    <select className="wh-select" value={itemId} onChange={e => setItemId(e.target.value)} aria-label="Proizvod">
                        <option value="">Svi proizvodi ({items.length})</option>
                        {items.map(i => <option key={i.ID} value={i.ID}>{i.Product_Name}</option>)}
                    </select>
                )}
            </div>

            <p className="wh-summary">
                {sum.days ? (
                    <>
                        <span><strong>{sum.days}</strong> {sum.days === 1 ? 'dan' : 'dana'} rada</span>
                        <span><strong>{sum.workers}</strong> {sum.workers === 1 ? 'radnik' : 'radnika'}</span>
                        <span><strong>{days(sum.workerDays)}</strong> radnik-dana</span>
                        <span>{period(sum.from, sum.to)}</span>
                    </>
                ) : <span>Još nema upisanog rada.</span>}
            </p>

            {view === 'process' ? (
                rows.length ? (
                    <div className="wh-table" role="table">
                        <div className="wh-row wh-head" role="row">
                            <span role="columnheader" className="wh-c-name">Proces</span>
                            <span role="columnheader" className="wh-c-when">Period</span>
                            <span role="columnheader" className="wh-c-who">Radnici</span>
                            <span role="columnheader" className="wh-c-num">R-dana</span>
                            <span role="columnheader" className="wh-c-basis">Osnova</span>
                        </div>
                        {rows.map(r => (
                            <div key={r.name} className={`wh-row ${r.state}${r.basis === 'assumed' ? ' assumed' : ''}`} role="row">
                                <span role="cell" className="wh-c-name">
                                    {r.unassigned ? <span className="wh-mark none" aria-hidden /> : <StateMark state={r.state} />}
                                    <span className="wh-name">{r.name}</span>
                                    {multi && r.totalProducts > 0 && <span className="wh-frac" title="Završeno na proizvoda">{r.doneProducts}/{r.totalProducts}</span>}
                                </span>
                                {/* data-meta: na uskom ekranu radnici i radnik-dana idu u drugi red iza perioda */}
                                <span role="cell" className={`wh-c-when${r.from ? "" : " empty"}`}
                                    data-meta={r.workers.length ? ` · ${r.workers.map(w => w.name).join(', ')} · ${days(r.days)} r-dana` : ''}>
                                    {period(r.from, r.to)}
                                </span>
                                <span role="cell" className="wh-c-who">
                                    {r.workers.length ? r.workers.map(w => w.name).join(', ') : '—'}
                                </span>
                                <span role="cell" className="wh-c-num">{days(r.days)}</span>
                                <span role="cell" className={`wh-c-basis ${r.basis}`}>{BASIS[r.basis]}</span>
                            </div>
                        ))}
                    </div>
                ) : <p className="wh-empty">Nalog još nema procesa ni upisanog rada.</p>
            ) : (
                dayList.length ? (
                    <div className="wh-days">
                        {dayList.map(d => {
                            const total = d.work.reduce((s, w) => s + w.share, 0);
                            const people = new Set(d.work.map(w => w.workerId)).size;
                            return (
                                <section key={d.date} className="wh-day">
                                    <header className="wh-day-head">
                                        <span className="wh-day-date">{weekday(d.date)} {dm(d.date)}</span>
                                        {people > 0 && <span className="wh-day-meta">{people} {people === 1 ? 'radnik' : 'radnika'} · {days(total)} r-dana</span>}
                                    </header>
                                    {d.work.map((w, i) => (
                                        <div key={`${w.workerId}-${i}`} className={`wh-entry${w.source === 'auto' ? ' auto' : ''}`}>
                                            <span className="wh-e-who">{w.workerName}</span>
                                            <span className="wh-e-what">
                                                <span className="wh-e-proc">{w.processes.join(', ')}</span>
                                                {/* Na telefonu izvor ide u ovaj red (kolona izvora je skrivena). */}
                                                <span className={`wh-e-prod${multi && w.products.length ? '' : ' src-only'}`}>
                                                    {multi ? w.products.join(', ') : ''}
                                                    <span className="wh-e-src-inline">{multi && w.products.length ? ' · ' : ''}{SOURCE[w.source]}</span>
                                                </span>
                                            </span>
                                            <span className="wh-e-num">{days(w.share)}</span>
                                            <span className={`wh-e-src ${w.source}`}>{SOURCE[w.source]}</span>
                                        </div>
                                    ))}
                                    {groupMilestones(d.completed).map(m => (
                                        <div key={`${m.assumed}-${m.products.join('|')}`} className={`wh-done${m.assumed ? ' assumed' : ''}`}>
                                            <StateMark state="done" />
                                            <span>
                                                {m.assumed ? 'Završeno pretpostavkom' : 'Završeno'}: {m.processes.join(', ')}
                                                {multi && <span className="wh-e-prod"> · {m.products.join(', ')}</span>}
                                            </span>
                                        </div>
                                    ))}
                                </section>
                            );
                        })}
                    </div>
                ) : <p className="wh-empty">Još nema upisanog rada.</p>
            )}

            <p className="wh-note">
                Pretpostavljeno: upisan je kasniji korak, a ovaj niko nije javio. Procjena: automatska podjela iz prisustva, proces nije potvrđen.
            </p>
        </div>
    );
}
