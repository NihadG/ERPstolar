'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import type { Product, ProcessCatalogItem } from '@/lib/types';
import { getProcessCatalog, saveProcessCatalogItem, saveProductProcessStages, applyAutoProcessPlan } from '@/lib/services';
import { planToStages } from '@/lib/productProcesses';
import Modal from '@/components/ui/Modal';
import ProcessCatalogModal from '@/components/ui/ProcessCatalogModal';
import ProcessStageTemplatesModal from '@/components/ui/ProcessStageTemplatesModal';
import { X, Plus, RefreshCw, Settings2, GitBranch, ArrowRight, GripVertical, Search, Lock, Sparkles, Bookmark } from 'lucide-react';

interface ProductProcessPlanProps {
    product: Product;
    organizationId: string;
    onChanged: () => void; // refresh projekata nakon izmjene plana
    onClose: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

// Mali cache kataloga po organizaciji (modal se otvara po potrebi, ne po svakom rerenderu)
let catalogCache: { orgId: string; items: ProcessCatalogItem[] } | null = null;
export function invalidateProcessCatalogCache() { catalogCache = null; }

interface AddPopoverState {
    stageIdx: number;   // -1 = nova faza
    top?: number;
    bottom?: number;
    left: number;
    width: number;
}

/**
 * FAZNI PLAN PROCESA proizvoda, u zasebnom modalu (otvara se dugmetom na kartici proizvoda).
 * Kolone = faze, slijeva nadesno: procesi u ISTOJ koloni teku PARALELNO
 * (npr. izrada nogu ∥ krojenje furnira), sljedeća kolona počinje kad prethodna završi
 * (→ sklapanje → lakiranje). Prevuci proces između kolona da promijeniš raspored.
 * Na uskim ekranima kolone se slažu odozgo nadolje.
 */
export default function ProductProcessPlan({ product, organizationId, onChanged, onClose, showToast }: ProductProcessPlanProps) {
    const [catalog, setCatalog] = useState<ProcessCatalogItem[]>(catalogCache?.orgId === organizationId ? catalogCache.items : []);
    const [stages, setStages] = useState<string[][]>(() => planToStages(product.Process_Stages, product.Process_Plan));
    const [busy, setBusy] = useState(false);
    const [catalogModalOpen, setCatalogModalOpen] = useState(false);
    const [templatesModalOpen, setTemplatesModalOpen] = useState(false);

    // Popover "dodaj proces" — portal na document.body, pozicioniran fiksno (ne siječe se overflowom modala)
    const [addPopover, setAddPopover] = useState<AddPopoverState | null>(null);
    const [popoverSearch, setPopoverSearch] = useState('');
    const [newName, setNewName] = useState('');
    const popoverRef = useRef<HTMLDivElement>(null);

    const source = product.Process_Plan_Source;

    // Sync s proizvodom (nakon refresha)
    useEffect(() => {
        setStages(planToStages(product.Process_Stages, product.Process_Plan));
    }, [product.Process_Stages, product.Process_Plan]);

    const loadCatalog = async (force = false) => {
        if (!force && catalogCache?.orgId === organizationId) { setCatalog(catalogCache.items); return; }
        const items = await getProcessCatalog(organizationId);
        catalogCache = { orgId: organizationId, items };
        setCatalog(items);
    };
    useEffect(() => { loadCatalog(); }, [organizationId]);

    // Zatvori popover na klik vani / Escape
    useEffect(() => {
        if (!addPopover) return;
        const onDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (popoverRef.current?.contains(target)) return;
            if (target.closest('[data-ppp-add-trigger]')) return; // trigger dugme upravlja svojim tap-om
            setAddPopover(null);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddPopover(null); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [addPopover]);

    async function persist(next: string[][], src: 'auto' | 'manual' = 'manual') {
        const clean = next.map(s => s.filter(Boolean)).filter(s => s.length > 0);
        setStages(clean); // optimistički
        setBusy(true);
        try {
            const res = await saveProductProcessStages(product.Product_ID, clean.map(s => ({ processes: s })), organizationId, src);
            if (res.success) onChanged();
            else { showToast(res.message, 'error'); setStages(planToStages(product.Process_Stages, product.Process_Plan)); }
        } finally { setBusy(false); }
    }

    function onDragEnd(result: DropResult) {
        const { source: src, destination: dst } = result;
        if (!dst) return;
        const next = stages.map(s => [...s]);
        const srcIdx = parseInt(src.droppableId.replace('stage-', ''), 10);
        const [moved] = next[srcIdx].splice(src.index, 1);
        if (moved === undefined) return;
        if (dst.droppableId === 'new-stage') {
            next.push([moved]);
        } else {
            const dstIdx = parseInt(dst.droppableId.replace('stage-', ''), 10);
            if (!next[dstIdx].some(p => p.toLowerCase() === moved.toLowerCase()) || srcIdx === dstIdx) {
                next[dstIdx].splice(dst.index, 0, moved);
            }
        }
        persist(next, 'manual');
    }

    const allInPlan = useMemo(() => new Set(stages.flat().map(p => p.toLowerCase())), [stages]);

    function openAddPopover(stageIdx: number, e: React.MouseEvent<HTMLButtonElement>) {
        if (addPopover?.stageIdx === stageIdx) { setAddPopover(null); return; }
        const r = e.currentTarget.getBoundingClientRect();
        const estHeight = 320;
        const spaceBelow = window.innerHeight - r.bottom;
        const openUp = spaceBelow < estHeight && r.top > spaceBelow;
        setAddPopover({
            stageIdx,
            top: openUp ? undefined : r.bottom + 6,
            bottom: openUp ? window.innerHeight - r.top + 6 : undefined,
            left: Math.min(r.left, window.innerWidth - 260),
            width: Math.max(r.width, 240),
        });
        setPopoverSearch('');
        setNewName('');
    }

    async function addProcess(name: string, stageIdx: number) {
        const trimmed = name.trim();
        if (!trimmed) return;
        setAddPopover(null);
        if (allInPlan.has(trimmed.toLowerCase())) { showToast('Proces je već u planu', 'info'); return; }
        if (!catalog.some(c => c.Name.toLowerCase() === trimmed.toLowerCase())) {
            const res = await saveProcessCatalogItem(trimmed, organizationId);
            if (res.success) { invalidateProcessCatalogCache(); await loadCatalog(true); }
        }
        const next = stages.map(s => [...s]);
        if (stageIdx === -1) next.push([trimmed]);
        else next[stageIdx].push(trimmed);
        persist(next, 'manual');
    }

    function removeProcess(stageIdx: number, procIdx: number) {
        const next = stages.map(s => [...s]);
        next[stageIdx].splice(procIdx, 1);
        persist(next, 'manual');
    }

    async function autoSuggest() {
        setBusy(true);
        try {
            const res = await applyAutoProcessPlan(product.Product_ID, organizationId, { force: true });
            if (res.success) {
                showToast(res.plan?.length
                    ? 'Auto plan postavljen (sekvencijalno) — prevuci procese u istu fazu za paralelni rad'
                    : 'Nema pravila za materijale ovog proizvoda — dodaj pravila kroz „Upravljaj"',
                    res.plan?.length ? 'success' : 'info');
                onChanged();
            } else showToast(res.message, 'error');
        } finally { setBusy(false); }
    }

    const popoverCatalog = addPopover
        ? catalog.filter(c => !allInPlan.has(c.Name.toLowerCase()) && c.Name.toLowerCase().includes(popoverSearch.toLowerCase()))
        : [];

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="xl"
            title={
                <span className="ppp-title">
                    <GitBranch size={18} className="ppp-title-icon" />
                    <span className="ppp-title-text">Plan procesa <span className="ppp-title-sep">·</span> {product.Name}</span>
                </span>
            }
            footer={<button className="btn btn-secondary" onClick={onClose}>Zatvori</button>}
        >
            <div className="ppp-root">
                {/* Traka s objašnjenjem + alati */}
                <div className="ppp-toolbar">
                    <div className="ppp-toolbar-info">
                        {stages.length > 0 && (
                            <span className={`ppp-source-badge ${source === 'manual' ? 'is-manual' : 'is-auto'}`}
                                title={source === 'manual' ? 'Ručno uređen — automatika ga ne mijenja' : 'Izveden iz pravila materijal→proces; mijenja se s materijalima'}>
                                {source === 'manual' ? <Lock size={11} /> : <Sparkles size={11} />}
                                {source === 'manual' ? 'Ručno' : 'Auto iz materijala'}
                            </span>
                        )}
                        <span className="ppp-hint">ista kolona = paralelno · prevuci za raspored</span>
                    </div>
                    <div className="ppp-toolbar-actions">
                        <button className="ppp-btn" onClick={autoSuggest} disabled={busy} title="Preračunaj plan iz pravila materijal→proces (pregazi trenutni plan)">
                            <RefreshCw size={14} /> <span>Auto prijedlog</span>
                        </button>
                        <button className="ppp-btn" onClick={() => setTemplatesModalOpen(true)} title="Sačuvaj trenutni plan kao templejt ili primijeni sačuvani">
                            <Bookmark size={14} /> <span>Templejti</span>
                        </button>
                        <button className="ppp-btn" onClick={() => setCatalogModalOpen(true)} title="Katalog procesa i pravila materijal→proces (za cijelu firmu)">
                            <Settings2 size={14} /> <span>Upravljaj</span>
                        </button>
                    </div>
                </div>

                {stages.length === 0 ? (
                    <div className="ppp-empty">
                        <div className="ppp-empty-icon"><GitBranch size={26} /></div>
                        <h4>Nema plana procesa</h4>
                        <p>Dodaj prvi proces ručno, ili izvedi plan iz pravila materijal→proces. Bez plana nalog koristi generički „Rad".</p>
                        <div className="ppp-empty-actions">
                            <button className="ppp-btn ppp-btn-primary" data-ppp-add-trigger onClick={(e) => openAddPopover(-1, e)}>
                                <Plus size={14} /> Dodaj proces
                            </button>
                            <button className="ppp-btn" onClick={autoSuggest} disabled={busy}>
                                <RefreshCw size={14} /> Auto prijedlog
                            </button>
                            <button className="ppp-btn" onClick={() => setTemplatesModalOpen(true)}>
                                <Bookmark size={14} /> Templejti
                            </button>
                        </div>
                    </div>
                ) : (
                    <DragDropContext onDragEnd={onDragEnd}>
                        <div className={`ppp-board ${busy ? 'is-busy' : ''}`}>
                            {stages.map((stage, si) => (
                                <div className="ppp-lane-wrap" key={si}>
                                    <div className="ppp-lane">
                                        <div className="ppp-lane-head">
                                            <span className="ppp-lane-num">{si + 1}</span>
                                            <span className="ppp-lane-title">Faza {si + 1}</span>
                                            {stage.length > 1 && <span className="ppp-lane-count">{stage.length} paralelno</span>}
                                        </div>
                                        <Droppable droppableId={`stage-${si}`}>
                                            {(provided, snapshot) => (
                                                <div ref={provided.innerRef} {...provided.droppableProps}
                                                    className={`ppp-lane-body ${snapshot.isDraggingOver ? 'is-over' : ''}`}>
                                                    {stage.map((proc, pi) => (
                                                        <Draggable key={`${si}-${proc}`} draggableId={`${si}::${proc}`} index={pi}>
                                                            {(prov, snap) => (
                                                                <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                                                                    className={`ppp-chip ${snap.isDragging ? 'is-dragging' : ''}`}
                                                                    style={prov.draggableProps.style}>
                                                                    <GripVertical size={13} className="ppp-chip-grip" />
                                                                    <span className="ppp-chip-label">{proc}</span>
                                                                    <button className="ppp-chip-remove" disabled={busy} title="Ukloni iz plana"
                                                                        onClick={() => removeProcess(si, pi)}>
                                                                        <X size={13} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                        <button className="ppp-lane-add" data-ppp-add-trigger disabled={busy}
                                            onClick={(e) => openAddPopover(si, e)} title="Dodaj paralelni proces u ovu fazu">
                                            <Plus size={12} /> paralelno
                                        </button>
                                    </div>
                                    <div className="ppp-connector"><ArrowRight size={16} /></div>
                                </div>
                            ))}

                            <Droppable droppableId="new-stage">
                                {(provided, snapshot) => (
                                    <div className="ppp-lane-wrap ppp-lane-wrap--new" ref={provided.innerRef} {...provided.droppableProps}>
                                        <button className={`ppp-new-lane ${snapshot.isDraggingOver ? 'is-over' : ''}`} data-ppp-add-trigger disabled={busy}
                                            onClick={(e) => openAddPopover(-1, e)} title="Nova faza (nastavlja se na prethodnu) — ili prevuci proces ovdje">
                                            <Plus size={16} />
                                            <span>{snapshot.isDraggingOver ? 'Pusti za novu fazu' : 'Nova faza'}</span>
                                        </button>
                                        <div style={{ display: 'none' }}>{provided.placeholder}</div>
                                    </div>
                                )}
                            </Droppable>
                        </div>
                    </DragDropContext>
                )}
            </div>

            {/* Popover "dodaj proces" — portal, fiksna pozicija (ne siječe se scroll-om modala) */}
            {addPopover && createPortal(
                <div
                    ref={popoverRef}
                    className="ppp-popover"
                    style={{
                        top: addPopover.top,
                        bottom: addPopover.bottom,
                        left: addPopover.left,
                        width: addPopover.width,
                    }}
                >
                    <div className="ppp-popover-search">
                        <Search size={14} />
                        <input
                            autoFocus
                            placeholder="Pretraži ili upiši novi…"
                            value={popoverSearch}
                            onChange={e => { setPopoverSearch(e.target.value); setNewName(e.target.value); }}
                            onKeyDown={e => { if (e.key === 'Enter' && popoverCatalog.length === 0 && newName.trim()) addProcess(newName, addPopover.stageIdx); }}
                        />
                    </div>
                    <div className="ppp-popover-list">
                        {popoverCatalog.map(c => (
                            <button key={c.ID} className="ppp-popover-item" onClick={() => addProcess(c.Name, addPopover.stageIdx)}>
                                {c.Name}
                            </button>
                        ))}
                        {popoverCatalog.length === 0 && (
                            popoverSearch.trim() ? (
                                <button className="ppp-popover-item ppp-popover-item--new" onClick={() => addProcess(newName, addPopover.stageIdx)}>
                                    <Plus size={13} /> Kreiraj „{popoverSearch.trim()}"
                                </button>
                            ) : (
                                <div className="ppp-popover-empty">Svi procesi iz kataloga su već u planu</div>
                            )
                        )}
                    </div>
                </div>,
                document.body
            )}

            {catalogModalOpen && (
                <ProcessCatalogModal
                    organizationId={organizationId}
                    onClose={() => setCatalogModalOpen(false)}
                    onChanged={() => { invalidateProcessCatalogCache(); loadCatalog(true); }}
                    showToast={showToast}
                    zIndex={1100}
                />
            )}

            {templatesModalOpen && (
                <ProcessStageTemplatesModal
                    organizationId={organizationId}
                    currentStages={stages}
                    onApply={(newStages) => persist(newStages, 'manual')}
                    onClose={() => setTemplatesModalOpen(false)}
                    showToast={showToast}
                    zIndex={1100}
                />
            )}

            <style jsx>{`
                .ppp-root {
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    min-height: 0;
                    gap: 16px;
                }

                :global(.ppp-title) {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    min-width: 0;
                }
                :global(.ppp-title-icon) { flex-shrink: 0; color: var(--accent); }
                :global(.ppp-title-text) {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    min-width: 0;
                }
                :global(.ppp-title-sep) { color: var(--text-tertiary); margin: 0 2px; }

                /* ── toolbar ── */
                .ppp-toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .ppp-toolbar-info {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-wrap: wrap;
                    min-width: 0;
                }
                .ppp-hint {
                    font-size: 12px;
                    color: var(--text-tertiary);
                }
                .ppp-toolbar-actions {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .ppp-source-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 11px;
                    font-weight: 600;
                    padding: 3px 9px;
                    border-radius: 999px;
                    white-space: nowrap;
                }
                .ppp-source-badge.is-auto { background: var(--accent-light); color: var(--accent); }
                .ppp-source-badge.is-manual { background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border-light); }

                .ppp-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 7px 13px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-primary);
                    background: var(--background);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                    transition: var(--transition);
                    white-space: nowrap;
                }
                .ppp-btn:hover:not(:disabled) { background: var(--surface); border-color: var(--text-tertiary); }
                .ppp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .ppp-btn-primary {
                    background: var(--accent);
                    border-color: var(--accent);
                    color: #fff;
                }
                .ppp-btn-primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

                /* ── empty state ── */
                .ppp-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                    gap: 6px;
                    padding: 48px 24px;
                    border: 1.5px dashed var(--border);
                    border-radius: var(--radius-md);
                    background: var(--surface);
                }
                .ppp-empty-icon {
                    width: 52px; height: 52px;
                    border-radius: 50%;
                    background: var(--accent-light);
                    color: var(--accent);
                    display: flex; align-items: center; justify-content: center;
                    margin-bottom: 6px;
                }
                .ppp-empty h4 { margin: 0; font-size: 15px; color: var(--text-primary); }
                .ppp-empty p { margin: 0; font-size: 13px; color: var(--text-secondary); max-width: 380px; line-height: 1.5; }
                .ppp-empty-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; justify-content: center; }

                /* ── board / lanes ── */
                .ppp-board {
                    display: flex;
                    align-items: flex-start;
                    gap: 0;
                    overflow-x: auto;
                    overflow-y: hidden;
                    padding: 4px 4px 14px;
                    transition: opacity 0.15s ease;
                }
                .ppp-board.is-busy { opacity: 0.6; pointer-events: none; }

                .ppp-lane-wrap {
                    display: flex;
                    align-items: center;
                    flex-shrink: 0;
                }
                .ppp-lane-wrap--new { flex-shrink: 0; }

                .ppp-lane {
                    width: 190px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    background: var(--surface);
                    border: 1px solid var(--border-light);
                    border-radius: var(--radius-md);
                    overflow: hidden;
                }
                .ppp-lane-head {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 10px 12px 6px;
                }
                .ppp-lane-num {
                    display: inline-flex; align-items: center; justify-content: center;
                    width: 16px; height: 16px;
                    border-radius: 50%;
                    background: var(--accent-light);
                    color: var(--accent);
                    font-size: 10px;
                    font-weight: 700;
                    flex-shrink: 0;
                }
                .ppp-lane-title {
                    font-size: 11px;
                    font-weight: 700;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .ppp-lane-count {
                    font-size: 10px;
                    color: var(--text-tertiary);
                    margin-left: auto;
                    white-space: nowrap;
                }

                .ppp-lane-body {
                    flex: 1;
                    min-height: 44px;
                    padding: 2px 8px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    border-radius: var(--radius-sm);
                    transition: background 0.12s ease;
                }
                .ppp-lane-body.is-over { background: var(--accent-light); }

                .ppp-chip {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 7px 8px;
                    background: var(--background);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-sm);
                    box-shadow: 0 1px 2px var(--shadow);
                    cursor: grab;
                }
                .ppp-chip.is-dragging {
                    box-shadow: 0 8px 20px var(--shadow-md);
                    cursor: grabbing;
                }
                .ppp-chip-grip { color: var(--text-tertiary); flex-shrink: 0; }
                .ppp-chip-label {
                    flex: 1;
                    min-width: 0;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-primary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .ppp-chip-remove {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    border: none;
                    background: none;
                    color: var(--text-tertiary);
                    cursor: pointer;
                    padding: 2px;
                    border-radius: 4px;
                }
                .ppp-chip-remove:hover:not(:disabled) { color: var(--error); background: var(--error-bg); }

                .ppp-lane-add {
                    margin: 6px 8px 8px;
                    padding: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    background: none;
                    border: 1px dashed var(--border);
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                    display: flex; align-items: center; justify-content: center; gap: 4px;
                }
                .ppp-lane-add:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }

                .ppp-connector {
                    color: var(--border);
                    flex-shrink: 0;
                    margin: 0 4px;
                    display: flex;
                }

                .ppp-new-lane {
                    width: 130px;
                    min-height: 90px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-tertiary);
                    background: none;
                    border: 1.5px dashed var(--border);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                }
                .ppp-new-lane:hover:not(:disabled), .ppp-new-lane.is-over {
                    border-color: var(--accent);
                    color: var(--accent);
                    background: var(--accent-light);
                }

                /* ── popover "dodaj proces" (portal na document.body — global jer je van ovog stabla) ── */
                :global(.ppp-popover) {
                    position: fixed;
                    z-index: 1050;
                    background: var(--background);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-md);
                    box-shadow: 0 10px 40px var(--shadow-md), 0 2px 8px var(--shadow);
                    display: flex;
                    flex-direction: column;
                    max-height: 320px;
                    overflow: hidden;
                    animation: ppp-fade-in 0.12s ease-out;
                }
                :global(.ppp-popover-search) {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 12px;
                    border-bottom: 1px solid var(--border-light);
                    color: var(--text-tertiary);
                    flex-shrink: 0;
                }
                :global(.ppp-popover-search input) {
                    flex: 1;
                    border: none;
                    outline: none;
                    background: transparent;
                    font-size: 13px;
                    color: var(--text-primary);
                }
                :global(.ppp-popover-list) {
                    overflow-y: auto;
                    padding: 4px;
                }
                :global(.ppp-popover-item) {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    width: 100%;
                    text-align: left;
                    padding: 8px 10px;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-primary);
                    background: none;
                    border: none;
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                }
                :global(.ppp-popover-item:hover) { background: var(--surface); }
                :global(.ppp-popover-item--new) { color: var(--accent); font-weight: 600; }
                :global(.ppp-popover-empty) {
                    padding: 14px 10px;
                    font-size: 12px;
                    color: var(--text-tertiary);
                    text-align: center;
                }
                @keyframes ppp-fade-in {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @media (max-width: 720px) {
                    :global(.ppp-popover) {
                        top: auto !important;
                        bottom: 0 !important;
                        left: 0 !important;
                        width: 100% !important;
                        max-height: 60vh;
                        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
                    }
                    :global(.ppp-popover-item) { padding: 12px 14px; font-size: 14px; }
                }

                /* ── mobile: kolone se slažu odozgo nadolje ── */
                @media (max-width: 720px) {
                    .ppp-board {
                        flex-direction: column;
                        align-items: stretch;
                        overflow-x: visible;
                        padding: 4px 2px 8px;
                    }
                    .ppp-lane-wrap, .ppp-lane-wrap--new {
                        flex-direction: column;
                        align-items: stretch;
                        width: 100%;
                    }
                    .ppp-lane, .ppp-new-lane {
                        width: 100%;
                    }
                    .ppp-new-lane { min-height: 56px; }
                    .ppp-connector {
                        margin: 6px 0;
                        justify-content: center;
                        transform: rotate(90deg);
                    }
                    .ppp-toolbar { flex-direction: column; align-items: stretch; }
                    .ppp-toolbar-actions .ppp-btn { flex: 1; justify-content: center; }
                }
            `}</style>
        </Modal>
    );
}
