'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Check, ChevronDown, ChevronRight, Clock, Play, Users, Plus, X, Loader2, StickyNote, PauseCircle, RotateCcw, Search,
} from 'lucide-react';
import type { WorkOrderItem, Worker, WorkLog, ItemProcessStatus, ProcessCatalogItem, ProcessGraph } from '@/lib/types';
import { updateItemProcess, addProcessToOrderItem, getProcessCatalog, getProcessGraph } from '@/lib/services';
import { planToStages, synthesizeOrderGraph } from '@/lib/productProcesses';
import {
    buildOrderProcessRows, mergeDuplicateNameRows, dedupeProcessKey,
    type ProcRow as Row, type ProcPerItem as PerItem,
} from '@/lib/orderProcessRows';
import './OrderProcessBoard.css';

interface Props {
    workOrderId: string;
    items: WorkOrderItem[];
    workers: Worker[];
    workLogs?: WorkLog[];
    organizationId?: string;
    onChanged?: () => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
    /** Bump da se snimljeni graf procesa ponovo učita (npr. nakon Spremi u ProcessGraphModal). */
    graphReloadKey?: number;
}

const norm = (s: string) => (s || '').trim().toLowerCase();
const todayISO = () => new Date().toISOString().split('T')[0];

const STATUS_LABEL: Record<string, string> = {
    'Na čekanju': 'Čeka', 'U toku': 'U toku', 'Završeno': 'Završeno', 'Odloženo': 'Odloženo',
};
const STATUS_CLASS: Record<string, string> = {
    'Na čekanju': 'wait', 'U toku': 'active', 'Završeno': 'done', 'Odloženo': 'deferred',
};

/**
 * Jedinstveni pregled procesa naloga: isti proces preko N proizvoda = JEDAN red.
 * Završetak (ili odgoda / pokretanje) za ODABRANI podskup proizvoda — piše u
 * item.Processes svakog odabranog proizvoda (updateItemProcess), koji recalc-uje
 * status stavke i naloga. Model podataka ostaje netaknut; ovo je projekcija + akcija.
 */
export default function OrderProcessBoard({
    workOrderId, items, workers, organizationId, onChanged, showToast, graphReloadKey,
}: Props) {
    // Snimljeni graf procesa (ručne veze iz ProcessGraphModal) — AUTORITATIVAN za gating kad postoji.
    const [savedGraph, setSavedGraph] = useState<ProcessGraph | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (workOrderId && organizationId) {
            getProcessGraph(workOrderId, organizationId)
                .then(g => { if (!cancelled) setSavedGraph(g && g.nodes && g.nodes.length ? g : null); })
                .catch(() => { if (!cancelled) setSavedGraph(null); });
        } else {
            setSavedGraph(null);
        }
        return () => { cancelled = true; };
    }, [workOrderId, organizationId, graphReloadKey]);
    const [expanded, setExpanded] = useState<string | null>(null);   // row.id
    const [sel, setSel] = useState<Set<string>>(new Set());          // itemIds odabrani u proširenom redu
    const [busy, setBusy] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState<{ workerIds: string[]; date: string; notes: string }>({ workerIds: [], date: todayISO(), notes: '' });

    // Dodaj proces (globalno, na odabrane proizvode)
    const [addOpen, setAddOpen] = useState(false);
    const [addName, setAddName] = useState('');
    const [addSel, setAddSel] = useState<Set<string>>(new Set());
    const [catalog, setCatalog] = useState<ProcessCatalogItem[]>([]);
    useEffect(() => {
        if (addOpen && organizationId && catalog.length === 0) getProcessCatalog(organizationId).then(setCatalog).catch(() => { });
    }, [addOpen, organizationId, catalog.length]);

    // Prilagođen dropdown kataloga procesa (zamjena za native <input list>/<datalist>,
    // portal na document.body — ne siječe ga `.opb-row { overflow: hidden }`).
    const catInputRef = useRef<HTMLInputElement>(null);
    const catDropdownRef = useRef<HTMLDivElement>(null);
    const [catPopover, setCatPopover] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
    const openCatDropdown = () => {
        const el = catInputRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const estHeight = 240;
        const spaceBelow = window.innerHeight - r.bottom;
        const openUp = spaceBelow < estHeight && r.top > spaceBelow;
        setCatPopover({
            top: openUp ? undefined : r.bottom + 4,
            bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
            left: r.left,
            width: r.width,
        });
    };
    useEffect(() => {
        if (!catPopover) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (catDropdownRef.current?.contains(t) || catInputRef.current?.contains(t)) return;
            setCatPopover(null);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCatPopover(null); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [catPopover]);
    const filteredCatalog = useMemo(
        () => catalog.filter(c => c.Name.toLowerCase().includes(addName.trim().toLowerCase())),
        [catalog, addName]
    );

    const itemById = useMemo(() => new Map(items.map(it => [it.ID, it])), [items]);
    const workerName = (id: string) => workers.find(w => w.Worker_ID === id)?.Name || 'Radnik';

    // ── Projekcija: procesi ujedinjeni preko proizvoda, u redoslijedu toka ──
    // Gradnja redova + gating + dedup duplih naziva je u lib/orderProcessRows (testirano).
    const rows = useMemo<Row[]>(() => {
        const synthItems = items.map(it => ({
            itemId: it.ID,
            stages: planToStages((it as any).Process_Stages, (it.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[]),
        })).filter(si => si.stages.length > 0);
        const synth = synthesizeOrderGraph(synthItems).graph;

        // 1) SNIMLJENI graf (ručne veze iz ProcessGraphModal) je AUTORITATIVAN za gating.
        //    Npr. kantiranje se otvara ČIM je krojenje (njegov jedini prethodnik) gotovo — a ne
        //    kad su SVE stavke prve faze gotove (što daje dense sinteza).
        if (savedGraph && savedGraph.nodes.length) {
            const out = buildOrderProcessRows(savedGraph.nodes, savedGraph.edges, items);
            // Hibrid: procesi na stavkama koje snimljeni graf NE pokriva (dodani nakon zadnjeg snimanja)
            // → dopuni iz sinteze (među sobom gate-uju po fazama; ne skrivaj rad).
            const coveredKeys = new Set(out.map(r => dedupeProcessKey(r.name)));
            const extraNodes = synth.nodes.filter(n => !coveredKeys.has(dedupeProcessKey(n.name)));
            if (extraNodes.length) {
                const extraIds = new Set(extraNodes.map(n => n.id));
                const extraEdges = synth.edges.filter(e => extraIds.has(e.source) && extraIds.has(e.target));
                out.push(...buildOrderProcessRows(extraNodes, extraEdges, items));
            }
            // Završni spoj preko OBA izvora — čuva „isti proces = jedan red" i kad duplikat
            // dolazi iz različitih puteva (snimljeni + sinteza).
            return mergeDuplicateNameRows(out);
        }

        // 2) Fallback: sinteza iz faznih planova (nema snimljenog grafa).
        return buildOrderProcessRows(synth.nodes, synth.edges, items);
    }, [items, savedGraph]);

    const toggleExpand = (row: Row) => {
        if (expanded === row.id) { setExpanded(null); setSel(new Set()); setFormOpen(false); return; }
        setExpanded(row.id); setFormOpen(false);
        // default odabir = proizvodi koji NISU završeni (najčešća radnja)
        setSel(new Set(row.perItem.filter(p => p.status !== 'Završeno').map(p => p.itemId)));
    };

    const toggleSel = (itemId: string) => setSel(prev => {
        const n = new Set(prev); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n;
    });

    const runUpdates = async (row: Row, itemIds: string[], updates: Partial<ItemProcessStatus>) => {
        if (!itemIds.length || busy) return;
        setBusy(true);
        try {
            // Po stavci: koristi NJENO pohranjeno ime procesa (alias-safe; izbjegava upsert dup).
            for (const itemId of itemIds) {
                const procName = row.perItem.find(p => p.itemId === itemId)?.procName || row.name;
                await updateItemProcess(workOrderId, itemId, procName, updates);   // serijski: svaki recalc-uje nalog
            }
            onChanged?.();
        } catch (e) {
            console.error('OrderProcessBoard update', e);
            showToast?.('Greška pri ažuriranju procesa', 'error');
        } finally { setBusy(false); }
    };

    const openCompleteForm = (row: Row) => {
        // Prefill radnika za "Završi za odabrane". Wizard-kreirani nalozi NE postavljaju
        // Assigned_Workers — radnici žive u Processes[].Worker_ID/Helpers. Zato:
        //  1) najprije radnici dodijeljeni BAŠ ovom procesu na odabranim stavkama (glavni prvi),
        //  2) ako ničeg nema → ekipa naloga (Assigned_Workers ∪ svi Processes[].Worker_ID/Helpers).
        // Redoslijed je bitan: prvi radnik postaje glavni (confirmComplete koristi wIds[0]).
        const ordered: string[] = [];
        const add = (id?: string) => { if (id && !ordered.includes(id)) ordered.push(id); };
        const selIds = Array.from(sel);
        selIds.forEach(id => {
            const proc = itemById.get(id)?.Processes?.find(p => norm(p.Process_Name) === norm(row.name));
            add(proc?.Worker_ID);
            (proc?.Helpers || []).forEach(h => add(h.Worker_ID));
        });
        if (!ordered.length) {
            selIds.forEach(id => {
                const it = itemById.get(id);
                (it?.Assigned_Workers || []).forEach(w => add(w.Worker_ID));
                (it?.Processes || []).forEach(p => {
                    add(p.Worker_ID);
                    (p.Helpers || []).forEach(h => add(h.Worker_ID));
                });
            });
        }
        setForm({ workerIds: ordered, date: todayISO(), notes: '' });
        setFormOpen(true);
    };

    const confirmComplete = async (row: Row) => {
        const ids = Array.from(sel);
        const wIds = form.workerIds.filter(Boolean);
        if (!ids.length || !wIds.length) return;
        const first = workers.find(w => w.Worker_ID === wIds[0]);
        const helpers = wIds.slice(1).map(id => ({ Worker_ID: id, Worker_Name: workerName(id) }));
        await runUpdates(row, ids, {
            Status: 'Završeno',
            Completed_At: new Date(form.date + 'T12:00:00').toISOString(),
            Worker_ID: first?.Worker_ID,
            Worker_Name: first?.Name,
            Helpers: helpers,
            Notes: form.notes.trim() || undefined,
        });
        setFormOpen(false); setSel(new Set());
    };

    const setStatus = async (row: Row, status: 'U toku' | 'Odloženo' | 'Na čekanju') => {
        const ids = Array.from(sel);
        const updates: Partial<ItemProcessStatus> = { Status: status };
        if (status === 'U toku') updates.Started_At = new Date().toISOString();
        if (status === 'Na čekanju') updates.Completed_At = '';   // vrati iz završenog
        await runUpdates(row, ids, updates);
    };

    const doAdd = async () => {
        const name = addName.trim(); const ids = Array.from(addSel);
        if (!name || !ids.length || !organizationId || busy) return;
        setBusy(true);
        try {
            for (const itemId of ids) await addProcessToOrderItem(workOrderId, itemId, name, organizationId);
            showToast?.('Proces dodan', 'success');
            onChanged?.();
            setAddOpen(false); setAddName(''); setAddSel(new Set()); setCatPopover(null);
        } catch (e) {
            console.error('OrderProcessBoard add', e);
            showToast?.('Greška pri dodavanju procesa', 'error');
        } finally { setBusy(false); }
    };

    const allWorkers = workers;   // prosljeđuje se već aktivan set (kao u ItemProcessChecklist)

    return (
        <div className="opb">
            {rows.length === 0 ? (
                <div className="opb-empty">
                    Nema definisanih procesa za proizvode ovog naloga.
                    {organizationId && <> Dodaj ih ispod ili u „Graf procesa".</>}
                </div>
            ) : (
                <div className="opb-rows">
                    {rows.map(row => {
                        const isOpen = expanded === row.id;
                        const pct = row.total ? Math.round((row.done / row.total) * 100) : 0;
                        const deferred = row.perItem.filter(p => p.status === 'Odloženo').length;
                        return (
                            <div key={row.id} className={`opb-row ${row.state}`}>
                                <button className="opb-row-head" onClick={() => toggleExpand(row)}>
                                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                    <span className={`opb-dot ${row.state}`} />
                                    <span className="opb-name">{row.name}</span>
                                    {row.state === 'active' && <span className="opb-flowtag active">na redu</span>}
                                    {row.state === 'blocked' && <span className="opb-flowtag">čeka prethodni</span>}

                                    <span className="opb-progress">
                                        <span className="opb-bar"><span className={`opb-bar-fill ${pct >= 100 ? 'full' : ''}`} style={{ width: `${pct}%` }} /></span>
                                        <span className="opb-progress-txt">{row.done}/{row.total}</span>
                                    </span>

                                    {row.workers.length > 0 && (
                                        <span className="opb-workers" title={`Završili: ${row.workers.join(', ')}`}>
                                            <Users size={12} /> {row.workers.slice(0, 2).join(', ')}{row.workers.length > 2 ? ` +${row.workers.length - 2}` : ''}
                                        </span>
                                    )}
                                    {deferred > 0 && <span className="opb-deferred">{deferred} odloženo</span>}
                                </button>

                                {isOpen && (
                                    <div className="opb-body">
                                        {/* Proizvodi pokriveni ovim procesom — odaberi podskup */}
                                        <div className="opb-items">
                                            {row.perItem.map(p => {
                                                const on = sel.has(p.itemId);
                                                return (
                                                    <label key={p.itemId} className={`opb-item ${on ? 'sel' : ''}`}>
                                                        <input type="checkbox" checked={on} onChange={() => toggleSel(p.itemId)} disabled={busy} />
                                                        <span className="opb-item-name">{p.itemName}</span>
                                                        <span className={`opb-pill ${STATUS_CLASS[p.status] || 'wait'}`}>{STATUS_LABEL[p.status] || p.status}</span>
                                                        {p.status === 'Završeno' && p.workerName && (
                                                            <span className="opb-item-worker">
                                                                <Check size={11} /> {p.workerName}{p.helpers.length ? ` +${p.helpers.length}` : ''}
                                                            </span>
                                                        )}
                                                    </label>
                                                );
                                            })}
                                        </div>

                                        {/* Alatna traka nad odabranim */}
                                        <div className="opb-selbar">
                                            <button className="opb-linkbtn" disabled={busy}
                                                onClick={() => setSel(new Set(sel.size === row.perItem.length ? [] : row.perItem.map(p => p.itemId)))}>
                                                {sel.size === row.perItem.length ? 'Poništi sve' : 'Odaberi sve'}
                                            </button>
                                            <span className="opb-selcount">{sel.size} odabrano</span>
                                            <div className="opb-actions">
                                                <button className="opb-btn primary" disabled={busy || sel.size === 0} onClick={() => openCompleteForm(row)}>
                                                    <Check size={14} /> Završi za odabrane
                                                </button>
                                                <button className="opb-btn" disabled={busy || sel.size === 0} onClick={() => setStatus(row, 'U toku')} title="Označi kao u toku">
                                                    <Play size={13} /> Pokreni
                                                </button>
                                                <button className="opb-btn warn" disabled={busy || sel.size === 0} onClick={() => setStatus(row, 'Odloženo')} title="Odloži (čeka iz nekog razloga)">
                                                    <PauseCircle size={13} /> Odloži
                                                </button>
                                                <button className="opb-btn ghost" disabled={busy || sel.size === 0} onClick={() => setStatus(row, 'Na čekanju')} title="Vrati na čekanje">
                                                    <RotateCcw size={13} /> Vrati
                                                </button>
                                            </div>
                                        </div>

                                        {/* Forma završetka: radnici (1+), datum, napomena */}
                                        {formOpen && (
                                            <div className="opb-form">
                                                <div className="opb-field">
                                                    <span>Radnici ({form.workerIds.length})</span>
                                                    <div className="opb-chips">
                                                        {form.workerIds.map(id => (
                                                            <span key={id} className="opb-chip">
                                                                <Users size={11} /> {workerName(id)}
                                                                <button onClick={() => setForm(f => ({ ...f, workerIds: f.workerIds.filter(x => x !== id) }))}><X size={11} /></button>
                                                            </span>
                                                        ))}
                                                        <select value="" onChange={e => { const id = e.target.value; if (id && !form.workerIds.includes(id)) setForm(f => ({ ...f, workerIds: [...f.workerIds, id] })); }}>
                                                            <option value="">+ radnik</option>
                                                            {allWorkers.filter(w => !form.workerIds.includes(w.Worker_ID)).map(w => <option key={w.Worker_ID} value={w.Worker_ID}>{w.Name}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div className="opb-form-row">
                                                    <label className="opb-field">
                                                        <span>Datum</span>
                                                        <input type="date" value={form.date} max={todayISO()} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                                                    </label>
                                                    <label className="opb-field grow">
                                                        <span>Napomena (opcionalno)</span>
                                                        <input type="text" value={form.notes} placeholder="npr. serija, primjedba…" onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                                                    </label>
                                                </div>
                                                <div className="opb-form-actions">
                                                    <button className="opb-btn ghost" onClick={() => setFormOpen(false)} disabled={busy}>Otkaži</button>
                                                    <button className="opb-btn primary" disabled={busy || form.workerIds.length === 0 || sel.size === 0} onClick={() => confirmComplete(row)}>
                                                        {busy ? <Loader2 size={14} className="opb-spin" /> : <Check size={14} />} Završi {sel.size} {sel.size === 1 ? 'proizvod' : 'proizvoda'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Dodaj proces (na odabrane proizvode) */}
            {organizationId && (
                <div className="opb-add-wrap">
                    {!addOpen ? (
                        <button className="opb-add-btn" disabled={busy} onClick={() => { setAddOpen(true); setAddSel(new Set(items.map(i => i.ID))); }}>
                            <Plus size={14} /> Dodaj proces
                        </button>
                    ) : (
                        <div className="opb-add">
                            <div className="opb-add-head">
                                <span className="opb-add-title"><Plus size={14} /> Novi proces</span>
                                <button type="button" className="opb-add-close" onClick={() => { setAddOpen(false); setAddName(''); setCatPopover(null); }} disabled={busy} title="Zatvori">
                                    <X size={15} />
                                </button>
                            </div>
                            <div className="opb-field">
                                <span>Naziv procesa</span>
                                <input
                                    ref={catInputRef}
                                    type="text"
                                    autoFocus
                                    autoComplete="off"
                                    value={addName}
                                    placeholder="npr. Krojenje iverala"
                                    onChange={e => { setAddName(e.target.value); openCatDropdown(); }}
                                    onFocus={openCatDropdown}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && addName.trim() && addSel.size) { setCatPopover(null); doAdd(); }
                                        if (e.key === 'Escape') setCatPopover(null);
                                    }}
                                />
                            </div>
                            <div className="opb-field">
                                <span>Proizvodi ({addSel.size})</span>
                                <div className="opb-add-items">
                                    <button className="opb-linkbtn" onClick={() => setAddSel(new Set(addSel.size === items.length ? [] : items.map(i => i.ID)))}>
                                        {addSel.size === items.length ? 'Poništi sve' : 'Svi'}
                                    </button>
                                    {items.map(it => (
                                        <button key={it.ID} className={`opb-add-chip ${addSel.has(it.ID) ? 'on' : ''}`}
                                            onClick={() => setAddSel(prev => { const n = new Set(prev); n.has(it.ID) ? n.delete(it.ID) : n.add(it.ID); return n; })}>
                                            {addSel.has(it.ID) && <Check size={11} />} {it.Product_Name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="opb-form-actions">
                                <button className="opb-btn ghost" onClick={() => { setAddOpen(false); setAddName(''); setCatPopover(null); }} disabled={busy}>Otkaži</button>
                                <button className="opb-btn primary" disabled={busy || !addName.trim() || addSel.size === 0} onClick={doAdd}>
                                    {busy ? <Loader2 size={14} className="opb-spin" /> : <Plus size={14} />} Dodaj na {addSel.size}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Katalog procesa — prilagođen dropdown (portal, ne siječe ga overflow reda) */}
            {catPopover && createPortal(
                <div
                    ref={catDropdownRef}
                    className="opb-cat-dropdown"
                    style={{ top: catPopover.top, bottom: catPopover.bottom, left: catPopover.left, width: catPopover.width }}
                >
                    <div className="opb-cat-dropdown-list">
                        {filteredCatalog.map(c => (
                            <button key={c.ID} type="button" className="opb-cat-item" onClick={() => { setAddName(c.Name); setCatPopover(null); }}>
                                <Search size={12} className="opb-cat-item-icon" /> {c.Name}
                            </button>
                        ))}
                        {filteredCatalog.length === 0 && (
                            addName.trim() ? (
                                <div className="opb-cat-empty">
                                    <Plus size={12} /> Novi proces „{addName.trim()}"
                                </div>
                            ) : (
                                <div className="opb-cat-empty">Katalog procesa je prazan — upiši naziv za novi proces</div>
                            )
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
