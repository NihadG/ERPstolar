'use client';

// ════════════════════════════════════════════════════════════════════
// BatchPlanModal — brz unos MNOGO naloga odjednom (full-screen).
//
// Lijevo: izvor proizvoda (grupisano po projektu). Čekiraš 4–5 komada pa
// „→ Novi nalog" — desno nastane red. Ponavljaš dok ne isplaniraš projekat.
// Montaža i „razni" idu dugmadima. Svaki red nosi kandidat-ekipe i prioritet;
// zadane ekipe se naslijede na nove redove (da se za 50 naloga ne klika 50×).
//
// KANONSKA JEDINICA su radnik-dani (dani × radnici). „Dana × radnika" se
// prikazuje po redu; proizvod bez broja radnika u ponudi (`crewAssumed`) je žuto
// označen uz uredljiv broj radnika — nikad se tiho ne uzme 1.
//
// NE dira stvarnost: na kraju samo vraća PlanBlock[] roditelju (ADD_BLOCKS).
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import {
    Search, X, ChevronRight, Plus, Minus, Users, Wrench, Package, ClipboardList,
    AlertTriangle, Trash2, Layers,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { Project, Worker, WorkOrder, PlanBlock, PlanCrew, TaskPriority } from '@/lib/types';
import { TASK_PRIORITY_LABELS } from '@/lib/types';
import {
    collectProductCandidates, groupCandidatesByProject, type ProductCandidate,
} from '@/lib/canvas/fromProducts';
import {
    emptyBatchRow, batchToBlocks, batchSummary, rowWorkerDays, rowTitle, rowWarnings,
    effectiveWorkerDaysPerUnit, type BatchRow, type BatchProductPick,
} from '@/lib/canvas/batchDraft';
import CrewPicker from './CrewPicker';
import './BatchPlanModal.css';

interface BatchPlanModalProps {
    isOpen: boolean;
    projects: Project[];
    workOrders: WorkOrder[];
    workers: Worker[];
    startISO: string;
    isSaturdayWorking?: (d: Date) => boolean;
    onClose: () => void;
    onCreate: (blocks: PlanBlock[]) => void;
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export default function BatchPlanModal({
    isOpen, projects, workOrders, workers, startISO, isSaturdayWorking, onClose, onCreate,
}: BatchPlanModalProps) {
    const [search, setSearch] = useState('');
    const [onlyAvailable, setOnlyAvailable] = useState(true);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [pending, setPending] = useState<Map<string, number>>(new Map());
    const [rows, setRows] = useState<BatchRow[]>([]);
    const [defaultCrews, setDefaultCrews] = useState<PlanCrew[]>([]);
    const [defaultPriority, setDefaultPriority] = useState<TaskPriority>('medium');
    // Cilj CrewPicker-a: zadane ekipe ('default') ili konkretan red (rowId).
    const [crewTarget, setCrewTarget] = useState<'default' | string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setSearch(''); setExpanded(new Set()); setPending(new Map());
            setRows([]); setDefaultCrews([]); setDefaultPriority('medium'); setCrewTarget(null);
        }
    }, [isOpen]);

    const candidates = useMemo(() => collectProductCandidates(projects, workOrders), [projects, workOrders]);
    const byId = useMemo(() => new Map(candidates.map(c => [c.productId, c])), [candidates]);
    const groups = useMemo(
        () => groupCandidatesByProject(candidates, { onlyAvailable, search }),
        [candidates, onlyAvailable, search]
    );
    const searching = search.trim().length > 0;
    const isOpenGroup = (id: string) => searching || expanded.has(id);

    // ── Lijevo: izbor u „pending nalog" ──────────────────────────
    const togglePending = (c: ProductCandidate) =>
        setPending(prev => {
            const next = new Map(prev);
            if (next.has(c.productId)) next.delete(c.productId);
            else next.set(c.productId, Math.max(1, c.availableQty || 1));
            return next;
        });

    const addProjectToPending = (projectId: string) =>
        setPending(prev => {
            const next = new Map(prev);
            for (const c of candidates) {
                if (c.projectId === projectId && (!onlyAvailable || c.availableQty > 0)) {
                    next.set(c.productId, Math.max(1, c.availableQty || 1));
                }
            }
            return next;
        });

    const pendingWorkerDays = useMemo(() => {
        let sum = 0;
        for (const [id, qty] of pending) {
            const c = byId.get(id);
            if (c) sum += effectiveWorkerDaysPerUnit({ candidate: c, qty }) * qty;
        }
        return Math.round(sum * 100) / 100;
    }, [pending, byId]);

    const commitPendingRow = () => {
        if (pending.size === 0) return;
        const products: BatchProductPick[] = [];
        for (const [id, qty] of pending) {
            const c = byId.get(id);
            if (c) products.push({ candidate: c, qty });
        }
        setRows(r => [...r, {
            ...emptyBatchRow('proizvodni'),
            products,
            crewOptions: [...defaultCrews],
            priority: defaultPriority,
        }]);
        setPending(new Map());
    };

    // ── Desno: uređivanje redova ─────────────────────────────────
    const patchRow = (id: string, patch: Partial<BatchRow>) =>
        setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
    const removeRow = (id: string) => setRows(rs => rs.filter(r => r.id !== id));

    const addFreeRow = (kind: 'montaza' | 'razni') =>
        setRows(r => [...r, { ...emptyBatchRow(kind), crewOptions: [...defaultCrews], priority: defaultPriority }]);

    const setProductQty = (rowId: string, productId: string, qty: number) =>
        setRows(rs => rs.map(r => r.id !== rowId ? r : {
            ...r,
            products: r.products.map(p => p.candidate.productId === productId
                ? { ...p, qty: Math.min(Math.max(1, qty), Math.max(1, p.candidate.availableQty)) } : p),
        }));

    const setProductWorkers = (rowId: string, productId: string, workers: number) =>
        setRows(rs => rs.map(r => r.id !== rowId ? r : {
            ...r,
            products: r.products.map(p => p.candidate.productId === productId
                ? { ...p, workersOverride: Math.max(1, workers) } : p),
        }));

    const removeProduct = (rowId: string, productId: string) =>
        setRows(rs => rs.map(r => r.id !== rowId ? r : {
            ...r, products: r.products.filter(p => p.candidate.productId !== productId),
        }).filter(r => !(r.kind === 'proizvodni' && r.products.length === 0)));

    const addCrew = (crew: PlanCrew) => {
        if (crewTarget === 'default') setDefaultCrews(cs => [...cs, crew]);
        else if (crewTarget) patchRow(crewTarget, {
            crewOptions: [...(rows.find(r => r.id === crewTarget)?.crewOptions || []), crew],
        });
        setCrewTarget(null);
    };
    const removeCrew = (rowId: string, crewId: string) =>
        patchRow(rowId, { crewOptions: (rows.find(r => r.id === rowId)?.crewOptions || []).filter(c => c.id !== crewId) });

    const summary = useMemo(() => batchSummary(rows), [rows]);

    const create = () => {
        const { blocks } = batchToBlocks(rows, { startISO, isSaturdayWorking });
        if (blocks.length === 0) return;
        onCreate(blocks);
        onClose();
    };

    const crewChip = (crew: PlanCrew, onRemove?: () => void) => (
        <span key={crew.id} className="bp-crew-chip">
            <Users size={11} />
            {crew.lead.name}{crew.helper ? ` + ${crew.helper.name}` : ''}
            {onRemove && <X size={11} onClick={onRemove} className="bp-crew-x" />}
        </span>
    );

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><ClipboardList size={17} /> Batch unos naloga</>}
            size="fullscreen"
            footer={
                <div className="bp-foot">
                    <div className="bp-foot-sum">
                        <span className="bp-foot-metric">
                            <strong>{summary.rowCount}</strong>&nbsp;{summary.rowCount === 1 ? 'nalog' : 'naloga'}
                        </span>
                        <span className="bp-sep">·</span>
                        <span className="bp-foot-metric">
                            <strong>{summary.totalWorkerDays}</strong>&nbsp;radnik-dana
                        </span>
                        {summary.crewAssumedCount > 0 && (
                            <span className="bp-foot-warn" title="Proizvodi bez broja radnika u ponudi — provjeri">
                                <AlertTriangle size={12} /> {summary.crewAssumedCount} pretpostavljena ekipa
                            </span>
                        )}
                        {summary.noCrewCount > 0 && (
                            <span className="bp-foot-note">{summary.noCrewCount} bez ekipa (ostaju ručni)</span>
                        )}
                    </div>
                    <div className="bp-foot-actions">
                        <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                        <button className="btn btn-primary" disabled={summary.rowCount === 0} onClick={create}>
                            Kreiraj sve ({summary.rowCount})
                        </button>
                    </div>
                </div>
            }
        >
            <div className="bp-shell">
                {/* ── Lijevo: izvor proizvoda ─────────────────── */}
                <section className="bp-pane bp-source">
                    <header className="bp-pane-head">
                        <div className="bp-search">
                            <Search size={15} />
                            <input placeholder="Traži proizvod ili projekt…" value={search}
                                onChange={e => setSearch(e.target.value)} />
                            {search && <button className="bp-clear" onClick={() => setSearch('')}><X size={13} /></button>}
                        </div>
                        <button className={`bp-toggle${onlyAvailable ? ' on' : ''}`}
                            onClick={() => setOnlyAvailable(v => !v)}>Samo neraspoređeni</button>
                    </header>

                    <div className="bp-scroll">
                        {groups.length === 0 && <p className="bp-empty">Nema proizvoda za prikaz.</p>}
                        {groups.map(g => {
                            const open = isOpenGroup(g.projectId);
                            const pickedHere = g.items.filter(i => pending.has(i.productId)).length;
                            return (
                                <div key={g.projectId} className="bp-group">
                                    <div className="bp-group-head">
                                        <button className="bp-group-toggle" onClick={() => setExpanded(prev => {
                                            const n = new Set(prev);
                                            n.has(g.projectId) ? n.delete(g.projectId) : n.add(g.projectId);
                                            return n;
                                        })}>
                                            <ChevronRight size={14} className={open ? 'rot' : ''} />
                                            <strong>{g.projectName}</strong>
                                            <span className="bp-group-meta">{g.items.length} · {g.availableWorkerDays} rd</span>
                                            {pickedHere > 0 && <span className="bp-group-count">{pickedHere}</span>}
                                        </button>
                                        <button className="bp-group-all" title="Svi proizvodi projekta u pending nalog"
                                            onClick={() => addProjectToPending(g.projectId)}>sve →</button>
                                    </div>
                                    {open && g.items.map(c => {
                                        const on = pending.has(c.productId);
                                        return (
                                            <div key={c.productId} className={`bp-src-row${on ? ' on' : ''}`}
                                                onClick={() => togglePending(c)} role="button" tabIndex={0}
                                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePending(c); } }}>
                                                <span className={`bp-box${on ? ' on' : ''}`} />
                                                <span className="bp-src-name" title={c.productName}>{c.productName}</span>
                                                <span className="bp-src-avail">{c.availableQty}/{c.totalQty}</span>
                                                {c.missingLabor
                                                    ? <span className="bp-tag warn">bez plana</span>
                                                    : c.crewAssumed
                                                        ? <span className="bp-tag warn" title="Ponuda nema broj radnika">{c.laborDays}d ? rad</span>
                                                        : <span className="bp-tag">{c.workerDaysPerUnit} rd</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>

                    <footer className="bp-source-foot">
                        <span className="bp-pending-info">
                            {pending.size === 0
                                ? 'Čekiraj proizvode za novi nalog'
                                : <><strong>{pending.size}</strong> izabrano · <strong>{pendingWorkerDays}</strong> rd</>}
                        </span>
                        <button className="btn btn-primary sm" disabled={pending.size === 0} onClick={commitPendingRow}>
                            <Plus size={14} /> Novi nalog
                        </button>
                    </footer>
                </section>

                {/* ── Desno: redovi (nalozi) ───────────────────── */}
                <section className="bp-pane bp-rows">
                    <header className="bp-pane-head bp-rows-head">
                        <div className="bp-defaults">
                            <span className="bp-defaults-lbl"><Layers size={13} /> Zadano za nove naloge:</span>
                            <div className="bp-defaults-crews">
                                {defaultCrews.map(c => crewChip(c, () => setDefaultCrews(cs => cs.filter(x => x.id !== c.id))))}
                                <button className="bp-add-crew" onClick={() => setCrewTarget('default')}>
                                    <Plus size={12} /> ekipa
                                </button>
                            </div>
                            <select className="bp-prio-sel" value={defaultPriority}
                                onChange={e => setDefaultPriority(e.target.value as TaskPriority)}>
                                {PRIORITIES.map(p => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}
                            </select>
                        </div>
                        <div className="bp-add-row">
                            <button className="bp-add-btn" onClick={() => addFreeRow('montaza')}><Wrench size={13} /> Montaža</button>
                            <button className="bp-add-btn" onClick={() => addFreeRow('razni')}><Package size={13} /> Razni</button>
                        </div>
                    </header>

                    <div className="bp-scroll">
                        {rows.length === 0 && (
                            <p className="bp-empty big">
                                Još nijedan nalog. Čekiraj proizvode lijevo pa „Novi nalog", ili dodaj montažu/razni.
                            </p>
                        )}
                        {rows.map((row, i) => {
                            const wd = rowWorkerDays(row);
                            const warns = rowWarnings(row);
                            return (
                                <div key={row.id} className={`bp-order k-${row.kind}`}>
                                    <div className="bp-order-top">
                                        <span className="bp-order-idx">{i + 1}</span>
                                        <span className={`bp-kind-tag k-${row.kind}`}>
                                            {row.kind === 'montaza' ? 'Montaža' : row.kind === 'razni' ? 'Razni' : 'Nalog'}
                                        </span>
                                        {row.kind === 'proizvodni' ? (
                                            <span className="bp-order-title" title={rowTitle(row)}>{rowTitle(row)}</span>
                                        ) : (
                                            <input className="bp-order-title-input" placeholder={rowTitle(row)}
                                                value={row.title || ''} onChange={e => patchRow(row.id, { title: e.target.value })} />
                                        )}
                                        <span className="bp-order-wd">
                                            {wd > 0 ? <><strong>{wd}</strong> rd</> : <span className="bp-order-wd-warn">0 rd</span>}
                                        </span>
                                        <button className="bp-order-del" onClick={() => removeRow(row.id)} aria-label="Ukloni">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>

                                    {/* Proizvodi (samo proizvodni) */}
                                    {row.kind === 'proizvodni' && (
                                        <div className="bp-order-products">
                                            {row.products.map(p => (
                                                <div key={p.candidate.productId} className="bp-oprod">
                                                    <span className="bp-oprod-name" title={p.candidate.productName}>{p.candidate.productName}</span>
                                                    <span className="bp-oprod-breakdown">
                                                        {p.candidate.crewAssumed && p.workerDaysPerUnitOverride === undefined ? (
                                                            <>
                                                                {p.candidate.laborDays}d ×
                                                                <input className="bp-workers-in" type="number" min={1}
                                                                    value={p.workersOverride ?? 2}
                                                                    onChange={e => setProductWorkers(row.id, p.candidate.productId, Number(e.target.value))} />
                                                                rad
                                                                <AlertTriangle size={11} className="bp-oprod-warn" />
                                                            </>
                                                        ) : (
                                                            <>{effectiveWorkerDaysPerUnit(p)} rd/kom</>
                                                        )}
                                                    </span>
                                                    <span className="bp-oprod-stepper">
                                                        <button onClick={() => setProductQty(row.id, p.candidate.productId, p.qty - 1)} disabled={p.qty <= 1}><Minus size={11} /></button>
                                                        <span>{p.qty}</span>
                                                        <button onClick={() => setProductQty(row.id, p.candidate.productId, p.qty + 1)} disabled={p.qty >= Math.max(1, p.candidate.availableQty)}><Plus size={11} /></button>
                                                    </span>
                                                    <button className="bp-oprod-x" onClick={() => removeProduct(row.id, p.candidate.productId)}><X size={12} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Montaža/razni: ručni radnik-dani */}
                                    {row.kind !== 'proizvodni' && (
                                        <div className="bp-order-manual">
                                            <label>Radnik-dani
                                                <input type="number" min={0} value={row.manualWorkerDays ?? ''}
                                                    placeholder="npr. 2"
                                                    onChange={e => patchRow(row.id, { manualWorkerDays: Number(e.target.value) || 0 })} />
                                            </label>
                                        </div>
                                    )}

                                    {/* Ekipe + prioritet */}
                                    <div className="bp-order-bottom">
                                        <div className="bp-order-crews">
                                            {row.crewOptions.map(c => crewChip(c, () => removeCrew(row.id, c.id)))}
                                            <button className="bp-add-crew" onClick={() => setCrewTarget(row.id)}>
                                                <Plus size={12} /> ekipa
                                            </button>
                                        </div>
                                        <select className="bp-prio-sel" value={row.priority || 'medium'}
                                            onChange={e => patchRow(row.id, { priority: e.target.value as TaskPriority })}>
                                            {PRIORITIES.map(p => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}
                                        </select>
                                    </div>

                                    {warns.includes('no-crew') && (
                                        <p className="bp-order-hint">Bez kandidat-ekipa auto-raspored ga preskače (ostaje ručni).</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>

            <CrewPicker
                isOpen={crewTarget !== null}
                workers={workers}
                onClose={() => setCrewTarget(null)}
                onAdd={addCrew}
                title={crewTarget === 'default' ? 'Zadana ekipa (za nove naloge)' : 'Dodaj ekipu nalogu'}
            />
        </Modal>
    );
}
