'use client';

// ════════════════════════════════════════════════════════════════════
// PROIZVODNI PROCESI — pravila i katalog na JEDNOM ekranu.
//
//  ┌───────────────────────────────┬──────────────────────┐
//  │ PRAVILA  materijali → procesi │ KATALOG (tok, drag)  │
//  │  builder: [Iveral][MDF][Furnir…] │  ① Krojenje ⠿     │
//  │  → procesi čipovi             │  ② Kantiranje ⠿      │
//  │  lista pravila (klik = uredi) │  ③ Bušenje ⠿         │
//  │  🧪 test: odaberi materijale  │  [Sredi duplikate]   │
//  └───────────────────────────────┴──────────────────────┘
//
// Glavni koncept: pravilo se pravi KLIKOM na tipove materijala —
// jedan tip = obično pravilo, VIŠE tipova = kombinacija (svi prisutni,
// npr. Furnir+MDF → srezivanje iz prese). Bez tehničkih dropdowna.
// Test panel odmah pokazuje koji plan proizvod dobija i koja pravila okidaju.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import type { ProcessCatalogItem, ProcessMaterialRule, ProcessStageTemplate } from '@/lib/types';
import { MATERIAL_CATEGORIES } from '@/lib/types';
import {
    getProcessCatalog, saveProcessCatalogItem, renameProcessCatalogItem,
    deleteProcessCatalogItem, reorderProcessCatalog,
    getProcessMaterialRules, saveProcessMaterialRule, deleteProcessMaterialRule,
    getProcessStageTemplates, getProcessUsageData,
} from '@/lib/services';
import type { ProcessUsage } from '@/lib/processConsolidation';
import { MATERIAL_TYPES, buildAutoPlan } from '@/lib/processAutoPlan';
import Modal from '@/components/ui/Modal';
import ProcessConsolidationWizard from '@/components/ui/ProcessConsolidationWizard';
import {
    Trash2, Plus, Pencil, Check, GripVertical, Combine, X, ArrowRight, Loader2,
    FlaskConical, ChevronDown, ChevronUp, Layers,
} from 'lucide-react';

const norm = (s: string) => (s || '').trim().toLowerCase();
const typeLabel = (key: string) => MATERIAL_TYPES.find(t => t.key === key)?.label || key;

// Ikonice/boje tipova materijala — vizuelni identitet čipova (emoji = bez novih zavisnosti)
const TYPE_ICON: Record<string, string> = {
    iveral: '🪵', mdf: '🟫', furnir: '🍂', masiv: '🌳', lak: '🎨',
    vodilice: '🛤️', sarke: '🔩', rucke: '🖐️', staklo: '🪟', ogledalo: '🪞',
    led: '💡', kant: '📏', hdf: '📄', alu: '⬜',
};

interface ProcessCatalogModalProps {
    organizationId: string;
    onClose: () => void;
    onChanged?: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    zIndex?: number;
}

interface Builder {
    id: string | null;                                            // null = novo pravilo
    types: string[];                                              // 1 tip = obično, 2+ = kombinacija
    advanced: { kind: 'category' | 'name_contains'; value: string } | null;
    processes: string[];
}
const emptyBuilder = (): Builder => ({ id: null, types: [], advanced: null, processes: [] });

export default function ProcessCatalogModal({ organizationId, onClose, onChanged, showToast, zIndex }: ProcessCatalogModalProps) {
    const [loading, setLoading] = useState(true);
    const [catalog, setCatalog] = useState<ProcessCatalogItem[]>([]);
    const [rules, setRules] = useState<ProcessMaterialRule[]>([]);
    const [templates, setTemplates] = useState<ProcessStageTemplate[]>([]);
    const [usageByKey, setUsageByKey] = useState<Map<string, ProcessUsage> | null>(null);

    const [builder, setBuilder] = useState<Builder>(emptyBuilder());
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const [testTypes, setTestTypes] = useState<string[]>([]);

    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [wizardOpen, setWizardOpen] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [cat, r, tpl] = await Promise.all([
                getProcessCatalog(organizationId),
                getProcessMaterialRules(organizationId),
                getProcessStageTemplates(organizationId),
            ]);
            setCatalog(cat); setRules(r); setTemplates(tpl);
        } catch (e) {
            console.error('catalog load error', e);
            showToast('Greška pri učitavanju', 'error');
        } finally { setLoading(false); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [organizationId]);
    useEffect(() => { load(); }, [load]);

    const loadUsage = useCallback(() => {
        getProcessUsageData(organizationId)
            .then(d => setUsageByKey(new Map(d.usage.map(u => [u.key, u]))))
            .catch(() => setUsageByKey(new Map()));
    }, [organizationId]);
    useEffect(() => { loadUsage(); }, [loadUsage]);

    const refreshAll = async () => { await load(); loadUsage(); onChanged?.(); };

    // ── BUILDER ─────────────────────────────────────────────────────────
    const builderValid = builder.processes.length > 0
        && (builder.advanced ? !!builder.advanced.value.trim() : builder.types.length > 0);
    const isCombo = !builder.advanced && builder.types.length > 1;

    function toggleBuilderType(key: string) {
        setBuilder(b => ({
            ...b, advanced: null,
            types: b.types.includes(key) ? b.types.filter(t => t !== key) : [...b.types, key],
        }));
    }
    function toggleBuilderProcess(name: string) {
        setBuilder(b => ({
            ...b,
            processes: b.processes.includes(name) ? b.processes.filter(p => p !== name) : [...b.processes, name],
        }));
    }
    function editRule(r: ProcessMaterialRule) {
        if (r.Match_Kind === 'material_type') setBuilder({ id: r.ID, types: [r.Match_Value], advanced: null, processes: [...r.Processes] });
        else if (r.Match_Kind === 'material_type_combo') setBuilder({ id: r.ID, types: [...(r.Match_Types || [])], advanced: null, processes: [...r.Processes] });
        else { setBuilder({ id: r.ID, types: [], advanced: { kind: r.Match_Kind, value: r.Match_Value }, processes: [...r.Processes] }); setAdvancedOpen(true); }
        if (typeof document !== 'undefined') document.getElementById('pcm-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    async function saveBuilder() {
        if (!builderValid || saving) return;
        setSaving(true);
        try {
            const payload = builder.advanced
                ? { Match_Kind: builder.advanced.kind, Match_Value: builder.advanced.value.trim() }
                : builder.types.length === 1
                    ? { Match_Kind: 'material_type' as const, Match_Value: builder.types[0] }
                    : { Match_Kind: 'material_type_combo' as const, Match_Value: '', Match_Types: builder.types };
            const res = await saveProcessMaterialRule({
                ...(builder.id ? { ID: builder.id } : {}),
                ...payload,
                Processes: builder.processes,
                Organization_ID: organizationId,
            }, organizationId);
            if (res.success) {
                setBuilder(emptyBuilder()); setAdvancedOpen(false);
                showToast(builder.id ? 'Pravilo izmijenjeno' : 'Pravilo dodano', 'success');
                await refreshAll();
            } else showToast(res.message, 'error');
        } finally { setSaving(false); }
    }
    async function removeRule(id: string) {
        const res = await deleteProcessMaterialRule(id, organizationId);
        if (res.success) { if (builder.id === id) setBuilder(emptyBuilder()); await refreshAll(); }
        else showToast(res.message, 'error');
    }

    // ── TEST PRAVILA (live) ─────────────────────────────────────────────
    // Lažni materijali iz odabranih tipova (pattern[0] = naziv) → ista logika kao pravi auto-plan.
    const testResult = useMemo(() => {
        if (!testTypes.length) return null;
        const fakeMaterials = testTypes.map(t => ({ Material_Name: MATERIAL_TYPES.find(x => x.key === t)?.patterns[0] || t }));
        return buildAutoPlan(fakeMaterials, rules, catalog, templates);
    }, [testTypes, rules, catalog, templates]);

    /** Da li pravilo okida za trenutno odabrane TEST tipove (highlight u listi). */
    const ruleFires = useCallback((r: ProcessMaterialRule): boolean => {
        if (!testTypes.length) return false;
        const present = new Set(testTypes);
        if (r.Match_Kind === 'material_type') return present.has(r.Match_Value);
        if (r.Match_Kind === 'material_type_combo') return (r.Match_Types || []).length > 0 && (r.Match_Types || []).every(t => present.has(t));
        return false;   // category/name_contains — test radi po tipovima
    }, [testTypes]);

    // ── KATALOG ─────────────────────────────────────────────────────────
    const orderByName = useMemo(() => new Map(catalog.map(c => [norm(c.Name), c.Order])), [catalog]);
    const procNumber = (name: string) => {
        const o = orderByName.get(norm(name));
        return o === undefined ? null : catalog.findIndex(c => norm(c.Name) === norm(name)) + 1;
    };

    async function addProcess(name: string) {
        const res = await saveProcessCatalogItem(name, organizationId);
        if (res.success) { setNewName(''); await refreshAll(); }
        else showToast(res.message, 'error');
    }
    function onDragEnd(result: DropResult) {
        const { source, destination } = result;
        if (!destination || destination.index === source.index) return;
        const next = [...catalog];
        const [moved] = next.splice(source.index, 1);
        next.splice(destination.index, 0, moved);
        setCatalog(next);
        reorderProcessCatalog(next.map(c => c.ID), organizationId).then(res => {
            if (!res.success) { showToast(res.message, 'error'); load(); }
            else onChanged?.();
        });
    }
    async function saveRename(id: string) {
        const res = await renameProcessCatalogItem(id, editName, organizationId);
        setEditingId(null);
        if (res.success) await refreshAll();
        else showToast(res.message, 'error');
    }
    async function removeProcess(item: ProcessCatalogItem) {
        const u = usageByKey?.get(norm(item.Name));
        const usedIn = u ? [
            u.counts.products ? `${u.counts.products} proizvoda` : '',
            u.counts.orderItems ? `${u.counts.orderItems} stavki naloga` : '',
            u.counts.rules ? `${u.counts.rules} pravila` : '',
        ].filter(Boolean).join(', ') : '';
        if (!confirm(`Obrisati proces "${item.Name}" iz kataloga?${usedIn ? `\nKoristi se u: ${usedIn}.` : ''}`)) return;
        const res = await deleteProcessCatalogItem(item.ID, organizationId);
        if (res.success) await refreshAll();
        else showToast(res.message, 'error');
    }

    const usageStr = (name: string): string | null => {
        if (!usageByKey) return null;
        const u = usageByKey.get(norm(name));
        if (!u) return null;
        const parts: string[] = [];
        if (u.counts.products) parts.push(`${u.counts.products}P`);
        const orders = Math.max(u.counts.orderItems, u.counts.orderGraphs);
        if (orders) parts.push(`${orders}N`);
        if (u.counts.rules) parts.push(`${u.counts.rules}pr`);
        return parts.length ? parts.join(' · ') : null;
    };

    // Čip pravila u listi: tipovi ili napredni uslov
    const RuleCondition = ({ r }: { r: ProcessMaterialRule }) => {
        if (r.Match_Kind === 'material_type' || r.Match_Kind === 'material_type_combo') {
            const keys = r.Match_Kind === 'material_type' ? [r.Match_Value] : (r.Match_Types || []);
            return (
                <span className="pcm2-cond">
                    {keys.map((k, i) => (
                        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {i > 0 && <span className="pcm2-plus">+</span>}
                            <span className="pcm2-mat-chip on small">{TYPE_ICON[k] || '▪'} {typeLabel(k)}</span>
                        </span>
                    ))}
                </span>
            );
        }
        return (
            <span className="pcm2-cond">
                <span className="pcm2-mat-chip on small">
                    {r.Match_Kind === 'category' ? `Kategorija: ${r.Match_Value}` : `Naziv sadrži „${r.Match_Value}"`}
                </span>
            </span>
        );
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="xl"
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Layers size={18} style={{ color: 'var(--accent)' }} /> Proizvodni procesi</span>}
            footer={<button className="btn btn-secondary" onClick={onClose}>Zatvori</button>}
            zIndex={zIndex}
        >
            {loading ? (
                <div className="pcm2-loading"><Loader2 size={16} className="pcm2-spin" /> Učitavanje…</div>
            ) : (
                <div className="pcm2-grid">
                    {/* ═══════════ LIJEVO: PRAVILA (glavni sadržaj) ═══════════ */}
                    <section className="pcm2-rules">
                        <header className="pcm2-sec-head">
                            <h3>Pravila <span className="pcm2-sec-sub">materijali → procesi</span></h3>
                            <span className="pcm2-hint">Odaberi materijal(e) proizvoda i procese koje oni povlače — plan proizvoda se popunjava sam.</span>
                        </header>

                        {/* BUILDER */}
                        <div className="pcm2-builder" id="pcm-builder">
                            <div className="pcm2-builder-step">
                                <span className="pcm2-step-num">1</span>
                                <div className="pcm2-step-body">
                                    <div className="pcm2-step-label">
                                        Kad proizvod sadrži
                                        {isCombo && <span className="pcm2-combo-badge">kombinacija — svi zajedno</span>}
                                    </div>
                                    <div className="pcm2-mat-grid">
                                        {MATERIAL_TYPES.map(t => {
                                            const on = builder.types.includes(t.key);
                                            return (
                                                <button key={t.key} className={`pcm2-mat-chip ${on ? 'on' : ''}`} onClick={() => toggleBuilderType(t.key)}>
                                                    <span className="pcm2-mat-ico">{TYPE_ICON[t.key] || '▪'}</span> {t.label}
                                                    {on && <Check size={12} className="pcm2-mat-check" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <button className="pcm2-adv-toggle" onClick={() => setAdvancedOpen(o => !o)}>
                                        {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} napredno (kategorija / dio naziva)
                                    </button>
                                    {advancedOpen && (
                                        <div className="pcm2-adv">
                                            <select
                                                value={builder.advanced?.kind || ''}
                                                onChange={e => {
                                                    const kind = e.target.value as 'category' | 'name_contains' | '';
                                                    setBuilder(b => ({
                                                        ...b, types: [],
                                                        advanced: kind ? { kind, value: kind === 'category' ? MATERIAL_CATEGORIES[0] : '' } : null,
                                                    }));
                                                }}>
                                                <option value="">— po tipu (gore) —</option>
                                                <option value="category">Kategorija materijala</option>
                                                <option value="name_contains">Naziv materijala sadrži</option>
                                            </select>
                                            {builder.advanced?.kind === 'category' && (
                                                <select value={builder.advanced.value}
                                                    onChange={e => setBuilder(b => ({ ...b, advanced: { kind: 'category', value: e.target.value } }))}>
                                                    {MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            )}
                                            {builder.advanced?.kind === 'name_contains' && (
                                                <input value={builder.advanced.value} placeholder='npr. "protupožarn", "inox"…'
                                                    onChange={e => setBuilder(b => ({ ...b, advanced: { kind: 'name_contains', value: e.target.value } }))} />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pcm2-builder-step">
                                <span className="pcm2-step-num">2</span>
                                <div className="pcm2-step-body">
                                    <div className="pcm2-step-label">dodaj procese <span className="pcm2-dim">(redoslijed određuje katalog)</span></div>
                                    <div className="pcm2-mat-grid">
                                        {catalog.length === 0 && <span className="pcm2-dim">Katalog je prazan — dodaj procese desno.</span>}
                                        {catalog.map(c => {
                                            const on = builder.processes.includes(c.Name);
                                            return (
                                                <button key={c.ID} className={`pcm2-proc-chip ${on ? 'on' : ''}`} onClick={() => toggleBuilderProcess(c.Name)}>
                                                    {on ? <Check size={12} /> : <Plus size={12} />} {c.Name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div className="pcm2-builder-foot">
                                {builder.id && <span className="pcm2-editing-badge"><Pencil size={11} /> mijenjaš postojeće pravilo</span>}
                                <div className="pcm2-builder-actions">
                                    {(builder.id || builder.types.length > 0 || builder.processes.length > 0 || builder.advanced) && (
                                        <button className="pcm2-btn ghost" onClick={() => { setBuilder(emptyBuilder()); setAdvancedOpen(false); }}>Poništi</button>
                                    )}
                                    <button className="pcm2-btn primary" disabled={!builderValid || saving} onClick={saveBuilder}>
                                        {saving ? <Loader2 size={14} className="pcm2-spin" /> : <Check size={14} />}
                                        {builder.id ? 'Sačuvaj izmjene' : 'Sačuvaj pravilo'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* LISTA PRAVILA */}
                        {rules.length === 0 ? (
                            <div className="pcm2-empty">Još nema pravila. Odaberi materijale i procese gore — npr. <strong>Iveral → Krojenje, Kantiranje</strong> ili kombinaciju <strong>Furnir + MDF → Srezivanje iz prese</strong>.</div>
                        ) : (
                            <div className="pcm2-rule-list">
                                {rules.map(r => {
                                    const fires = ruleFires(r);
                                    return (
                                        <div key={r.ID} className={`pcm2-rule ${builder.id === r.ID ? 'editing' : ''} ${fires ? 'fires' : ''}`}
                                            onClick={() => editRule(r)} role="button" title="Klikni za izmjenu">
                                            <RuleCondition r={r} />
                                            <ArrowRight size={14} className="pcm2-arrow" />
                                            <span className="pcm2-rule-procs">
                                                {r.Processes.map((p, i) => {
                                                    const num = procNumber(p);
                                                    return <span key={i} className="pcm2-proc-pill">{num !== null && <b>{num}</b>}{p}</span>;
                                                })}
                                            </span>
                                            {fires && <span className="pcm2-fires-badge"><FlaskConical size={11} /> okida</span>}
                                            <button className="pcm2-icon danger" onClick={e => { e.stopPropagation(); removeRule(r.ID); }} title="Obriši pravilo"><Trash2 size={14} /></button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* TEST PANEL */}
                        <div className="pcm2-test">
                            <div className="pcm2-test-head">
                                <FlaskConical size={15} />
                                <span>Provjeri pravila — šta dobija proizvod koji sadrži:</span>
                            </div>
                            <div className="pcm2-mat-grid">
                                {MATERIAL_TYPES.map(t => {
                                    const on = testTypes.includes(t.key);
                                    return (
                                        <button key={t.key} className={`pcm2-mat-chip ${on ? 'on test' : ''}`}
                                            onClick={() => setTestTypes(prev => on ? prev.filter(x => x !== t.key) : [...prev, t.key])}>
                                            <span className="pcm2-mat-ico">{TYPE_ICON[t.key] || '▪'}</span> {t.label}
                                        </button>
                                    );
                                })}
                                {testTypes.length > 0 && (
                                    <button className="pcm2-adv-toggle" onClick={() => setTestTypes([])}><X size={12} /> očisti</button>
                                )}
                            </div>
                            {testTypes.length > 0 && (
                                <div className="pcm2-test-out">
                                    {!testResult || testResult.stages.length === 0 ? (
                                        <span className="pcm2-dim">Nijedno pravilo ne okida za ovu kombinaciju — plan bi ostao prazan.</span>
                                    ) : (
                                        <>
                                            <div className="pcm2-test-flow">
                                                {testResult.stages.map((stage, si) => (
                                                    <span key={si} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                        {si > 0 && <ArrowRight size={13} className="pcm2-arrow" />}
                                                        <span className="pcm2-test-stage">{stage.join(' ∥ ')}</span>
                                                    </span>
                                                ))}
                                            </div>
                                            {testResult.templateName && <div className="pcm2-dim" style={{ marginTop: 6 }}>faze prema šablonu „{testResult.templateName}"</div>}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* ═══════════ DESNO: KATALOG (tok proizvodnje) ═══════════ */}
                    <aside className="pcm2-catalog">
                        <header className="pcm2-sec-head">
                            <h3>Katalog <span className="pcm2-sec-sub">tok proizvodnje</span></h3>
                            <span className="pcm2-hint">Redoslijed odozgo = redoslijed u planovima. Prevuci za promjenu.</span>
                        </header>

                        <div className="pcm2-cat-add">
                            <input
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) addProcess(newName); }}
                                placeholder="Novi proces…"
                            />
                            <button className="pcm2-btn primary sq" disabled={!newName.trim()} onClick={() => addProcess(newName)} title="Dodaj u katalog"><Plus size={16} /></button>
                        </div>

                        {catalog.length === 0 ? (
                            <div className="pcm2-empty small">Prazno — upiši prvi proces (npr. „Krojenje iverala").</div>
                        ) : (
                            <DragDropContext onDragEnd={onDragEnd}>
                                <Droppable droppableId="catalog-list">
                                    {(provided) => (
                                        <div className="pcm2-cat-list" ref={provided.innerRef} {...provided.droppableProps}>
                                            {catalog.map((item, idx) => (
                                                <Draggable key={item.ID} draggableId={item.ID} index={idx}>
                                                    {(prov, snap) => (
                                                        <div ref={prov.innerRef} {...prov.draggableProps}
                                                            className={`pcm2-cat-row ${snap.isDragging ? 'dragging' : ''}`}
                                                            style={prov.draggableProps.style}>
                                                            <span className="pcm2-cat-num">{idx + 1}</span>
                                                            {editingId === item.ID ? (
                                                                <>
                                                                    <input className="pcm2-cat-edit" value={editName} autoFocus
                                                                        onChange={e => setEditName(e.target.value)}
                                                                        onKeyDown={e => { if (e.key === 'Enter') saveRename(item.ID); if (e.key === 'Escape') setEditingId(null); }} />
                                                                    <button className="pcm2-icon" onClick={() => saveRename(item.ID)}><Check size={14} /></button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <span className="pcm2-cat-name">{item.Name}</span>
                                                                    {usageStr(item.Name) && <span className="pcm2-cat-usage" title="Koristi se u: P=proizvodi, N=nalozi, pr=pravila">{usageStr(item.Name)}</span>}
                                                                    <span className="pcm2-cat-actions">
                                                                        <button className="pcm2-icon" onClick={() => { setEditingId(item.ID); setEditName(item.Name); }} title="Preimenuj u katalogu"><Pencil size={13} /></button>
                                                                        <button className="pcm2-icon danger" onClick={() => removeProcess(item)} title="Obriši"><Trash2 size={13} /></button>
                                                                    </span>
                                                                </>
                                                            )}
                                                            <span {...prov.dragHandleProps} className="pcm2-cat-grip"><GripVertical size={14} /></span>
                                                        </div>
                                                    )}
                                                </Draggable>
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    )}
                                </Droppable>
                            </DragDropContext>
                        )}

                        <button className="pcm2-btn accent block" onClick={() => setWizardOpen(true)}
                            title="Nađi duplikate i slične nazive u cijeloj bazi i spoji ih — mijenja katalog, planove, naloge i dnevnike">
                            <Combine size={15} /> Sredi duplikate
                        </button>
                    </aside>
                </div>
            )}

            {wizardOpen && (
                <ProcessConsolidationWizard
                    organizationId={organizationId}
                    onClose={() => setWizardOpen(false)}
                    onApplied={() => { refreshAll(); }}
                    showToast={showToast}
                    zIndex={(zIndex || 1000) + 100}
                />
            )}

            <style jsx>{`
                .pcm2-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 40px; color: var(--text-tertiary); font-size: 13px; }
                :global(.pcm2-spin) { animation: pcm2-rot 0.8s linear infinite; }
                @keyframes pcm2-rot { to { transform: rotate(360deg); } }

                .pcm2-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) 300px;
                    gap: 18px;
                    align-items: start;
                }

                .pcm2-sec-head { display: flex; flex-direction: column; gap: 3px; margin-bottom: 12px; }
                .pcm2-sec-head h3 { margin: 0; font-size: 15px; font-weight: 800; color: var(--text-primary); }
                .pcm2-sec-sub { font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-left: 6px; }
                .pcm2-hint { font-size: 12px; color: var(--text-secondary); line-height: 1.45; }
                .pcm2-dim { font-size: 12px; color: var(--text-tertiary); }

                /* ── BUILDER ── */
                .pcm2-builder {
                    border: 1.5px solid var(--accent);
                    border-radius: var(--radius-lg, 14px);
                    background: var(--background);
                    padding: 14px;
                    display: flex; flex-direction: column; gap: 14px;
                    box-shadow: 0 2px 12px var(--shadow);
                }
                .pcm2-builder-step { display: flex; gap: 10px; }
                .pcm2-step-num {
                    flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
                    background: var(--accent); color: #fff; font-size: 12px; font-weight: 800;
                    display: inline-flex; align-items: center; justify-content: center; margin-top: 1px;
                }
                .pcm2-step-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
                .pcm2-step-label { font-size: 13px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
                .pcm2-combo-badge {
                    font-size: 10.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px;
                    background: var(--warning-bg); color: var(--warning);
                }

                .pcm2-mat-grid { display: flex; flex-wrap: wrap; gap: 6px; }
                .pcm2-mat-chip {
                    display: inline-flex; align-items: center; gap: 5px;
                    padding: 6px 11px; border-radius: 999px; cursor: pointer;
                    border: 1.5px solid var(--border); background: var(--background);
                    font-size: 12.5px; font-weight: 600; color: var(--text-secondary);
                    transition: all 0.12s ease;
                }
                .pcm2-mat-chip:hover { border-color: var(--accent); color: var(--accent); }
                .pcm2-mat-chip.on { border-color: var(--accent); background: var(--accent); color: #fff; }
                .pcm2-mat-chip.on.test { background: var(--accent-light); color: var(--accent); }
                .pcm2-mat-chip.small { padding: 3px 9px; font-size: 11.5px; cursor: default; }
                .pcm2-mat-chip.small:hover { border-color: var(--accent); }
                .pcm2-mat-ico { font-size: 13px; line-height: 1; }
                :global(.pcm2-mat-check) { margin-left: 2px; }

                .pcm2-proc-chip {
                    display: inline-flex; align-items: center; gap: 5px;
                    padding: 6px 11px; border-radius: var(--radius-sm);
                    border: 1.5px dashed var(--border); background: var(--background);
                    font-size: 12.5px; font-weight: 600; color: var(--text-secondary); cursor: pointer;
                    transition: all 0.12s ease;
                }
                .pcm2-proc-chip:hover { border-color: var(--accent); color: var(--accent); }
                .pcm2-proc-chip.on { border: 1.5px solid var(--success); background: var(--success-bg); color: var(--success); }

                .pcm2-adv-toggle {
                    display: inline-flex; align-items: center; gap: 4px; align-self: flex-start;
                    border: none; background: none; cursor: pointer;
                    font-size: 11.5px; font-weight: 600; color: var(--text-tertiary); padding: 2px 0;
                }
                .pcm2-adv-toggle:hover { color: var(--accent); }
                .pcm2-adv { display: flex; gap: 8px; flex-wrap: wrap; }
                .pcm2-adv select, .pcm2-adv input {
                    padding: 7px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border);
                    font-size: 12.5px; background: var(--background); color: var(--text-primary);
                }
                .pcm2-adv input { flex: 1; min-width: 150px; }

                .pcm2-builder-foot { display: flex; align-items: center; gap: 10px; }
                .pcm2-editing-badge {
                    display: inline-flex; align-items: center; gap: 5px;
                    font-size: 11.5px; font-weight: 700; color: var(--warning);
                }
                .pcm2-builder-actions { margin-left: auto; display: flex; gap: 8px; }

                .pcm2-btn {
                    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
                    padding: 8px 16px; border-radius: var(--radius-sm); cursor: pointer;
                    font-size: 13px; font-weight: 700; border: 1px solid var(--border);
                    background: var(--background); color: var(--text-primary); transition: all 0.12s ease;
                }
                .pcm2-btn:disabled { opacity: 0.45; cursor: not-allowed; }
                .pcm2-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
                .pcm2-btn.primary:hover:not(:disabled) { background: var(--accent-hover, var(--accent)); }
                .pcm2-btn.ghost { border-color: transparent; color: var(--text-secondary); }
                .pcm2-btn.ghost:hover { background: var(--surface); }
                .pcm2-btn.accent { color: var(--accent); border-color: var(--accent); background: var(--accent-light); }
                .pcm2-btn.block { width: 100%; margin-top: 10px; }
                .pcm2-btn.sq { padding: 8px 10px; }

                /* ── LISTA PRAVILA ── */
                .pcm2-rule-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
                .pcm2-rule {
                    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
                    padding: 10px 12px; border: 1px solid var(--border-light);
                    border-radius: var(--radius-md); background: var(--background); cursor: pointer;
                    transition: all 0.12s ease;
                }
                .pcm2-rule:hover { border-color: var(--accent); box-shadow: 0 2px 8px var(--shadow); }
                .pcm2-rule.editing { border-color: var(--warning); background: var(--warning-bg); }
                .pcm2-rule.fires { border-color: var(--success); background: var(--success-bg); }
                .pcm2-cond { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
                .pcm2-plus { font-weight: 800; color: var(--text-tertiary); font-size: 13px; }
                :global(.pcm2-arrow) { color: var(--text-tertiary); flex-shrink: 0; }
                .pcm2-rule-procs { flex: 1; min-width: 140px; display: inline-flex; gap: 4px; flex-wrap: wrap; }
                .pcm2-proc-pill {
                    display: inline-flex; align-items: center; gap: 4px;
                    font-size: 11.5px; font-weight: 600; padding: 3px 9px;
                    border-radius: var(--radius-sm); background: var(--surface); color: var(--text-primary);
                }
                .pcm2-proc-pill b { font-size: 10px; color: var(--accent); }
                .pcm2-fires-badge {
                    display: inline-flex; align-items: center; gap: 4px;
                    font-size: 10.5px; font-weight: 800; color: var(--success);
                }
                .pcm2-icon {
                    display: inline-flex; align-items: center; justify-content: center;
                    width: 26px; height: 26px; border: none; background: none;
                    border-radius: var(--radius-sm); color: var(--text-tertiary); cursor: pointer; flex-shrink: 0;
                }
                .pcm2-icon:hover { background: var(--surface); color: var(--text-primary); }
                .pcm2-icon.danger:hover { background: var(--error-bg); color: var(--error); }

                .pcm2-empty {
                    margin-top: 14px; padding: 20px 16px; text-align: center;
                    border: 1.5px dashed var(--border); border-radius: var(--radius-md);
                    color: var(--text-secondary); font-size: 12.5px; line-height: 1.6;
                }
                .pcm2-empty.small { padding: 14px; margin-top: 0; }

                /* ── TEST ── */
                .pcm2-test {
                    margin-top: 16px; padding: 12px 14px;
                    border: 1px dashed var(--border); border-radius: var(--radius-md);
                    background: var(--surface); display: flex; flex-direction: column; gap: 10px;
                }
                .pcm2-test-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: var(--text-secondary); }
                .pcm2-test-out { padding-top: 2px; }
                .pcm2-test-flow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
                .pcm2-test-stage {
                    font-size: 12px; font-weight: 700; padding: 5px 11px;
                    border-radius: var(--radius-sm); background: var(--accent-light); color: var(--accent);
                }

                /* ── KATALOG (desno) ── */
                .pcm2-catalog {
                    border-left: 1px solid var(--border-light);
                    padding-left: 18px;
                    min-width: 0;
                }
                .pcm2-cat-add { display: flex; gap: 6px; margin-bottom: 10px; }
                .pcm2-cat-add input {
                    flex: 1; min-width: 0; padding: 8px 11px; border-radius: var(--radius-sm);
                    border: 1px solid var(--border); font-size: 12.5px;
                    background: var(--background); color: var(--text-primary);
                }
                .pcm2-cat-list { display: flex; flex-direction: column; position: relative; }
                .pcm2-cat-row {
                    display: flex; align-items: center; gap: 8px;
                    padding: 7px 4px 7px 0; background: var(--background);
                    border-bottom: 1px dashed var(--border-light);
                    font-size: 12.5px; position: relative;
                }
                .pcm2-cat-row.dragging { box-shadow: 0 8px 24px var(--shadow-md); border-radius: var(--radius-sm); border-bottom-color: transparent; padding-left: 6px; }
                .pcm2-cat-num {
                    flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
                    background: var(--accent-light); color: var(--accent);
                    font-size: 10.5px; font-weight: 800;
                    display: inline-flex; align-items: center; justify-content: center;
                }
                .pcm2-cat-name { flex: 1; min-width: 0; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .pcm2-cat-edit { flex: 1; min-width: 0; padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--accent); font-size: 12.5px; }
                .pcm2-cat-usage { flex-shrink: 0; font-size: 10px; font-weight: 700; color: var(--text-tertiary); background: var(--surface); padding: 2px 6px; border-radius: 999px; }
                .pcm2-cat-actions { display: none; align-items: center; gap: 0; }
                .pcm2-cat-row:hover .pcm2-cat-actions { display: inline-flex; }
                .pcm2-cat-row:hover .pcm2-cat-usage { display: none; }
                .pcm2-cat-grip { color: var(--text-tertiary); cursor: grab; display: flex; flex-shrink: 0; }

                @media (max-width: 860px) {
                    .pcm2-grid { grid-template-columns: 1fr; }
                    .pcm2-catalog { border-left: none; padding-left: 0; border-top: 1px solid var(--border-light); padding-top: 16px; }
                }
            `}</style>
        </Modal>
    );
}
