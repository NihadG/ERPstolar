'use client';

// ════════════════════════════════════════════════════════════════════
// PROCESI — pregled procesa preko SVIH naloga s prebacivim grupacijama
// (po nalozima / po procesima / po radnicima). Zanatske ekipe nose nalog
// kroz faze; ovdje se jednim klikom završava proces za odabrane stavke.
// Čista logika + gating: lib/processBoard.ts (buildProcessCells/groupBy*).
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useCallback } from 'react';
import type { WorkOrder, Worker, WorkLog, ProcessCatalogItem, ItemProcessStatus } from '@/lib/types';
import { useData } from '@/context/DataContext';
import { getProcessCatalog, updateItemProcess } from '@/lib/services';
import { buildProcessCells, groupByOrder, groupByProcess, groupByWorker, type ProcessCell } from '@/lib/processBoard';
import { workOrderDisplayName } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import ProcessCatalogModal from '@/components/ui/ProcessCatalogModal';
import './ProcessesTab.css';

interface Props {
    workOrders: WorkOrder[];
    workers: Worker[];
    workLogs: WorkLog[];
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onNavigateToOrder?: (workOrderId: string) => void;
}

type GroupMode = 'order' | 'process' | 'worker';
const cellKey = (c: ProcessCell) => `${c.workOrderId}|${c.itemId}|${c.itemProcessName}`;
const todayISO = () => new Date().toISOString().split('T')[0];

export default function ProcessesTab({ workOrders, workers, workLogs, onRefresh, showToast, onNavigateToOrder }: Props) {
    const { organizationId } = useData();
    const [groupMode, setGroupMode] = useState<GroupMode>('order');
    const [search, setSearch] = useState('');
    const [includeWaiting, setIncludeWaiting] = useState(false);
    const [catalog, setCatalog] = useState<ProcessCatalogItem[]>([]);
    const [catalogModal, setCatalogModal] = useState(false);
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState<{ workerIds: string[]; date: string; notes: string }>({ workerIds: [], date: todayISO(), notes: '' });
    const [busy, setBusy] = useState(false);

    // Persist izbor grupacije.
    useEffect(() => {
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem('pt-group') : null;
        if (saved === 'order' || saved === 'process' || saved === 'worker') setGroupMode(saved);
    }, []);
    const changeGroup = (m: GroupMode) => { setGroupMode(m); setSel(new Set()); if (typeof window !== 'undefined') window.localStorage.setItem('pt-group', m); };

    useEffect(() => {
        if (!organizationId) return;
        let cancelled = false;
        getProcessCatalog(organizationId).then(c => { if (!cancelled) setCatalog(c); }).catch(() => { });
        return () => { cancelled = true; };
    }, [organizationId]);

    const workerName = useCallback((id: string) => workers.find(w => w.Worker_ID === id)?.Name || 'Nepoznat', [workers]);

    // Nalozi u opsegu: U toku (default) + Na čekanju (toggle); nikad Otkazano/Završeno; ne Montaža (nema procese).
    const cells = useMemo(() => {
        const orders = workOrders
            .filter(wo => wo.Work_Order_Type !== 'Montaža')
            .filter(wo => wo.Status === 'U toku' || (includeWaiting && wo.Status === 'Na čekanju'))
            .map(wo => ({ workOrder: wo, items: wo.items || [], orderLabel: workOrderDisplayName(wo) }));
        return buildProcessCells(orders, catalog, workLogs);
    }, [workOrders, catalog, workLogs, includeWaiting]);

    const q = search.trim().toLowerCase();
    const matchesSearch = (c: ProcessCell) => !q ||
        c.orderLabel.toLowerCase().includes(q) || c.itemName.toLowerCase().includes(q) || c.processName.toLowerCase().includes(q);
    const filteredCells = useMemo(() => q ? cells.filter(matchesSearch) : cells, [cells, q]);

    const cellByKey = useMemo(() => new Map(cells.map(c => [cellKey(c), c])), [cells]);
    const toggleSel = (c: ProcessCell) => setSel(prev => { const n = new Set(prev); const k = cellKey(c); n.has(k) ? n.delete(k) : n.add(k); return n; });
    const selectedCells = useMemo(() => Array.from(sel).map(k => cellByKey.get(k)).filter(Boolean) as ProcessCell[], [sel, cellByKey]);

    // ── AKCIJE ──────────────────────────────────────────────────────────
    const runUpdate = async (updates: (c: ProcessCell) => Partial<ItemProcessStatus>) => {
        if (!selectedCells.length || busy) return;
        setBusy(true);
        try {
            // Serijski: svaki updateItemProcess recalc-uje svoj nalog (namjerno, status-decoupled).
            for (const c of selectedCells) await updateItemProcess(c.workOrderId, c.itemId, c.itemProcessName, updates(c));
            onRefresh('workOrders');
            setSel(new Set()); setFormOpen(false);
            showToast('Procesi ažurirani', 'success');
        } catch (e) {
            console.error('ProcessesTab update', e);
            showToast('Greška pri ažuriranju procesa', 'error');
        } finally { setBusy(false); }
    };

    const openCompleteForm = () => {
        // Prefill radnika = unija ekipa odabranih naloga (glavni prvi po redoslijedu pojave).
        const ordered: string[] = [];
        selectedCells.forEach(c => c.crewWorkerIds.forEach(id => { if (!ordered.includes(id)) ordered.push(id); }));
        setForm({ workerIds: ordered, date: todayISO(), notes: '' });
        setFormOpen(true);
    };
    const confirmComplete = () => {
        const wIds = form.workerIds.filter(Boolean);
        const first = wIds[0] ? workers.find(w => w.Worker_ID === wIds[0]) : undefined;
        const helpers = wIds.slice(1).map(id => ({ Worker_ID: id, Worker_Name: workerName(id) }));
        return runUpdate(() => ({
            Status: 'Završeno',
            Completed_At: new Date(form.date + 'T12:00:00').toISOString(),
            Worker_ID: first?.Worker_ID, Worker_Name: first?.Name,
            Helpers: helpers, Notes: form.notes.trim() || undefined,
        }));
    };
    const startSelected = () => runUpdate(() => ({ Status: 'U toku', Started_At: new Date().toISOString() }));

    // ── RENDER HELPERI ──────────────────────────────────────────────────
    const CrewChips = ({ ids }: { ids: string[] }) => (
        <span className="pt-crew">
            {ids.length === 0 && <span className="pt-crew-chip">bez ekipe</span>}
            {ids.map((id, i) => <span key={id} className={`pt-crew-chip ${i === 0 ? 'main' : ''}`}>{workerName(id)}</span>)}
        </span>
    );
    const Cell = ({ c, showOrder }: { c: ProcessCell; showOrder?: boolean }) => {
        const done = c.status === 'Završeno';
        const selectable = !done && (c.gate === 'active' || c.status === 'U toku');
        const k = cellKey(c);
        return (
            <div className={`pt-cell ${sel.has(k) ? 'sel' : ''}`}>
                {selectable ? (
                    <input type="checkbox" className="pt-cell-check" checked={sel.has(k)} onChange={() => toggleSel(c)} />
                ) : <span style={{ width: 18 }} />}
                <div className="pt-cell-main">
                    <div className="pt-cell-proc">
                        {c.processName}
                        {done && <span className="pt-cell-done"> · završeno{c.completedAt ? ` ${new Date(c.completedAt).toLocaleDateString('hr-HR')}` : ''}</span>}
                    </div>
                    <div className="pt-cell-ctx">
                        {showOrder ? `${c.orderLabel} · ` : ''}{c.itemName}
                        {c.status === 'U toku' && ' · u toku'}
                    </div>
                </div>
                {c.hasLoggedWork && !done && <span className="pt-badge logged" title="Ima knjižen rad">knjižen rad</span>}
                {!done && c.gate === 'blocked' && <span className="pt-badge blocked">čeka prethodni</span>}
                {!done && c.gate === 'active' && <span className="pt-badge active">na redu</span>}
            </div>
        );
    };
    const Progress = ({ done, total }: { done: number; total: number }) => (
        <div className="pt-progress" title={`${done}/${total} završeno`}>
            <div className="pt-progress-fill" style={{ width: `${total ? (100 * done / total) : 0}%` }} />
        </div>
    );

    // ── GRUPACIJE ───────────────────────────────────────────────────────
    const orderGroups = useMemo(() => groupByOrder(filteredCells), [filteredCells]);
    const processGroups = useMemo(() => groupByProcess(filteredCells), [filteredCells]);
    const workerGroups = useMemo(() => groupByWorker(filteredCells, workers), [filteredCells, workers]);

    const isEmpty = filteredCells.length === 0;

    return (
        <div className="pt-wrap">
            <div className="pt-header">
                <h1 className="pt-title">Procesi</h1>
                <div className="pt-seg">
                    <button className={groupMode === 'order' ? 'active' : ''} onClick={() => changeGroup('order')}><span className="material-icons-round" style={{ fontSize: 16 }}>assignment</span> Po nalozima</button>
                    <button className={groupMode === 'process' ? 'active' : ''} onClick={() => changeGroup('process')}><span className="material-icons-round" style={{ fontSize: 16 }}>account_tree</span> Po procesima</button>
                    <button className={groupMode === 'worker' ? 'active' : ''} onClick={() => changeGroup('worker')}><span className="material-icons-round" style={{ fontSize: 16 }}>engineering</span> Po radnicima</button>
                </div>
                <div className="pt-header-spacer" />
                <div className="pt-search">
                    <span className="material-icons-round">search</span>
                    <input placeholder="Traži nalog / proizvod / proces…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <button className={`pt-toggle ${includeWaiting ? 'on' : ''}`} onClick={() => setIncludeWaiting(v => !v)} title="Uključi i naloge Na čekanju">
                    <span className="material-icons-round" style={{ fontSize: 16 }}>{includeWaiting ? 'check_box' : 'check_box_outline_blank'}</span> + Na čekanju
                </button>
                <button className="pt-btn" onClick={() => setCatalogModal(true)}><span className="material-icons-round" style={{ fontSize: 16 }}>tune</span> Katalog i pravila</button>
                <button className="pt-btn" onClick={() => onRefresh('workOrders')} title="Osvježi"><span className="material-icons-round" style={{ fontSize: 16 }}>refresh</span></button>
            </div>

            {isEmpty ? (
                <div className="pt-empty">
                    <span className="material-icons-round">inbox</span>
                    <p>Nema aktivnih procesa{includeWaiting ? '' : ' — probaj „+ Na čekanju"'}.</p>
                </div>
            ) : groupMode === 'order' ? (
                <div className="pt-list">
                    {orderGroups.map(og => (
                        <div key={og.workOrderId} className="pt-card">
                            <div className="pt-card-head" style={{ borderLeftColor: og.orderColor || 'var(--accent)' }}
                                onClick={() => onNavigateToOrder?.(og.workOrderId)} role={onNavigateToOrder ? 'button' : undefined}>
                                <div>
                                    <div className="pt-card-title">{og.orderLabel}</div>
                                    <div className="pt-card-sub">{og.doneCount}/{og.totalCount} procesa · {og.currentPhaseIndex < 0 ? 'sve faze gotove' : `faza ${og.currentPhaseIndex + 1}/${og.phases.length}`}</div>
                                </div>
                                <div className="pt-card-spacer" />
                                <CrewChips ids={og.crewWorkerIds} />
                                <Progress done={og.doneCount} total={og.totalCount} />
                            </div>
                            {/* Fazni stepper */}
                            <div className="pt-stepper">
                                {og.phases.map((p, i) => (
                                    <span key={p.phaseIndex} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        {i > 0 && <span className="material-icons-round pt-phase-arrow">chevron_right</span>}
                                        <span className={`pt-phase ${p.allDone ? 'done' : i === og.currentPhaseIndex ? 'current' : 'future'}`}
                                            title={p.cells.map(c => c.processName).filter((v, idx, a) => a.indexOf(v) === idx).join(', ')}>
                                            {p.allDone && <span className="material-icons-round" style={{ fontSize: 14 }}>check</span>}
                                            {Array.from(new Set(p.cells.map(c => c.processName))).join(' + ')}
                                        </span>
                                    </span>
                                ))}
                            </div>
                            {/* Na redu (tekuća faza) */}
                            {og.activeCells.length > 0 && (
                                <div className="pt-cells">
                                    <div className="pt-section-label">Na redu</div>
                                    {og.activeCells.map(c => <Cell key={cellKey(c)} c={c} />)}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ) : groupMode === 'process' ? (
                <div className="pt-list">
                    {(() => {
                        const catalogGroups = processGroups.filter(g => g.catalogOrder !== null);
                        const legacyGroups = processGroups.filter(g => g.catalogOrder === null);
                        const renderGroup = (g: typeof processGroups[number]) => (
                            <div key={g.key} className="pt-card">
                                <div className="pt-card-head">
                                    <div>
                                        <div className="pt-card-title">{g.name} {g.catalogOrder === null && <span className="pt-badge legacy">van kataloga</span>}</div>
                                        <div className="pt-card-sub">{g.active.length} na redu · {g.blockedCount} čeka · {g.doneCount}/{g.totalCount} završeno</div>
                                    </div>
                                    <div className="pt-card-spacer" />
                                    {g.hasLoggedWork && <span className="pt-badge logged">knjižen rad</span>}
                                    <Progress done={g.doneCount} total={g.totalCount} />
                                </div>
                                {g.active.length > 0 && (
                                    <div className="pt-cells">
                                        {g.active.map(c => <Cell key={cellKey(c)} c={c} showOrder />)}
                                    </div>
                                )}
                            </div>
                        );
                        return (
                            <>
                                {catalogGroups.map(renderGroup)}
                                {legacyGroups.length > 0 && <div className="pt-section-label" style={{ marginTop: 8 }}>Ostali procesi (van kataloga)</div>}
                                {legacyGroups.map(renderGroup)}
                            </>
                        );
                    })()}
                </div>
            ) : (
                <div className="pt-list">
                    {workerGroups.map(wg => (
                        <div key={wg.workerId} className="pt-card">
                            <div className="pt-card-head">
                                <div>
                                    <div className="pt-card-title">{wg.workerName}</div>
                                    <div className="pt-card-sub">{wg.orders.length} {wg.orders.length === 1 ? 'nalog' : 'naloga'} · {wg.activeCount} na redu</div>
                                </div>
                            </div>
                            <div className="pt-cells">
                                {wg.orders.map(o => (
                                    <div key={o.workOrderId}>
                                        <div className="pt-section-label" style={{ padding: '4px 0' }}>{o.orderLabel}</div>
                                        {o.activeCells.length === 0 ? <div className="pt-cell-ctx" style={{ padding: '0 12px 6px' }}>nema procesa na redu</div>
                                            : o.activeCells.map(c => <Cell key={cellKey(c)} c={c} />)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Floating action bar */}
            {selectedCells.length > 0 && (
                <div className="pt-actionbar">
                    <span>{selectedCells.length} {selectedCells.length === 1 ? 'proces' : 'procesa'} odabrano</span>
                    <button className="ghost" disabled={busy} onClick={startSelected}>Pokreni</button>
                    <button className="primary" disabled={busy} onClick={openCompleteForm}>Završi…</button>
                    <button className="ghost" onClick={() => setSel(new Set())}>Odustani</button>
                </div>
            )}

            {/* Completion form */}
            {formOpen && (
                <Modal isOpen onClose={() => setFormOpen(false)} title={`Završi ${selectedCells.length} ${selectedCells.length === 1 ? 'proces' : 'procesa'}`}
                    footer={<>
                        <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>Otkaži</button>
                        <button className="btn btn-primary" disabled={busy} onClick={confirmComplete}>{busy ? 'Spremanje…' : 'Potvrdi završetak'}</button>
                    </>}>
                    <div className="pt-form-field">
                        <label>Radnici (prvi = glavni)</label>
                        <div className="pt-worker-pick">
                            {workers.filter(w => w.Status !== 'Obrisan').map(w => {
                                const on = form.workerIds.includes(w.Worker_ID);
                                return (
                                    <button key={w.Worker_ID} type="button" className={`pt-worker-opt ${on ? 'on' : ''}`}
                                        onClick={() => setForm(f => ({ ...f, workerIds: on ? f.workerIds.filter(id => id !== w.Worker_ID) : [...f.workerIds, w.Worker_ID] }))}>
                                        {on && form.workerIds[0] === w.Worker_ID && <span className="material-icons-round" style={{ fontSize: 13 }}>star</span>}
                                        {w.Name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="pt-form-field">
                        <label>Datum završetka</label>
                        <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="pt-form-field">
                        <label>Napomena (opciono)</label>
                        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="npr. gdje je stalo, šta treba…" />
                    </div>
                </Modal>
            )}

            {catalogModal && organizationId && (
                <ProcessCatalogModal organizationId={organizationId} onClose={() => setCatalogModal(false)}
                    onChanged={() => { getProcessCatalog(organizationId).then(setCatalog).catch(() => { }); }} showToast={showToast} />
            )}
        </div>
    );
}
