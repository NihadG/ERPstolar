'use client';

// ════════════════════════════════════════════════════════════════════
// GRAF PLANA PROIZVODA — ISTI editor kao graf naloga (React Flow).
// Plan proizvoda su GRANE po materijalu: iveral (krojenje→kantiranje→sklapanje)
// teče PARALELNO s furnir+MDF granom (krojenje MDF-a→furniranje→srezivanje→
// brušenje); grane se sastaju na zajedničkim čvorovima (sklapanje, okivanje).
// Kad se više proizvoda objedini u nalog, ovi grafovi se SPAJAJU po istoimenim
// procesima (mergeProductGraphs) — zato je bitno da nazivi budu iz kataloga.
//
// Izvor istine: Product.Process_Graph. Faze (Process_Stages/Process_Plan) se
// pri spremanju deriviraju topološki (stagesFromGraph) — svi stari potrošači rade.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ReactFlow, Background, Controls, Handle, Position, addEdge, MarkerType,
    useNodesState, useEdgesState,
} from '@xyflow/react';
import type { Node, Edge, Connection, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Modal from './Modal';
import {
    Plus, GitBranch, Wand2, Save, Trash2, Loader2, RefreshCw, Lock, BookmarkPlus,
} from 'lucide-react';
import type { Product, ProcessCatalogItem, ProcessGraph, ProcessFlowTemplate } from '@/lib/types';
import {
    getProcessCatalog, saveProductProcessGraph, applyAutoProcessPlan, generateUUID,
    listProcessTemplates, saveProcessTemplate,
} from '@/lib/services';
import { layoutProcessGraph, layoutColumns, NODE_W, NODE_H } from '@/lib/processLayout';
import { synthesizeOrderGraph } from '@/lib/productProcesses';

interface Props {
    product: Product;
    organizationId: string;
    onChanged: () => void;   // refresh projekata nakon izmjene plana
    onClose: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

type ProcData = { name: string };

function ProductRFNode({ data, selected }: NodeProps) {
    const d = data as ProcData;
    return (
        <div style={{
            width: NODE_W, minHeight: 52, background: 'var(--background)',
            border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-light)'}`, borderRadius: 'var(--radius-md)',
            boxShadow: '0 1px 3px var(--shadow-md)', overflow: 'hidden',
        }}>
            <Handle type="target" position={Position.Left} style={{ background: 'var(--text-tertiary)', width: 10, height: 10 }} />
            <div style={{ height: 5, background: 'var(--accent)' }} />
            <div style={{ padding: '9px 10px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>{d.name || 'Proces'}</div>
            </div>
            <Handle type="source" position={Position.Right} style={{ background: 'var(--accent)', width: 10, height: 10 }} />
        </div>
    );
}
const nodeTypes = { process: ProductRFNode };

export default function ProductProcessGraphModal({ product, organizationId, onChanged, onClose, showToast }: Props) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<ProcessCatalogItem[]>([]);
    const [templates, setTemplates] = useState<ProcessFlowTemplate[]>([]);
    const [saving, setSaving] = useState(false);
    const [autoBusy, setAutoBusy] = useState(false);
    const [dirty, setDirty] = useState(false);

    const source = product.Process_Plan_Source;

    const graphToCanvas = useCallback((g: ProcessGraph) => {
        const needLayout = g.nodes.length > 0 && g.nodes.every(n => !n.position);
        const pos = needLayout ? layoutProcessGraph(g.nodes, g.edges) : {};
        setNodes(g.nodes.map((n, i) => ({
            id: n.id, type: 'process',
            position: n.position ?? pos[n.id] ?? { x: 24, y: 24 + i * (NODE_H + 30) },
            data: { name: n.name },
        })));
        setEdges(g.edges.map(e => ({ id: e.id, source: e.source, target: e.target, markerEnd: { type: MarkerType.ArrowClosed } })));
        setSelectedId(null);
    }, [setNodes, setEdges]);

    // Inicijal: snimljeni graf → fallback konverzija postojećih faza u graf (legacy proizvodi).
    useEffect(() => {
        const g = product.Process_Graph;
        if (g?.nodes?.length) { graphToCanvas(g); return; }
        const stages = (product.Process_Stages || []).map(s => s.processes).filter(s => s?.length);
        const flat = (product.Process_Plan || []);
        const eff = stages.length ? stages : flat.map(p => [p]);
        if (eff.length) {
            const synth = synthesizeOrderGraph([{ itemId: product.Product_ID, stages: eff }], undefined, { includeEdges: true });
            const pos = layoutColumns(synth.columns);
            synth.graph.nodes.forEach(n => { n.position = pos[n.id]; });
            graphToCanvas(synth.graph);
        } else {
            graphToCanvas({ nodes: [], edges: [] });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product.Product_ID]);

    useEffect(() => {
        getProcessCatalog(organizationId).then(setCatalog).catch(() => { });
        listProcessTemplates(organizationId).then(setTemplates).catch(() => { });
    }, [organizationId]);

    const markDirty = () => setDirty(true);

    const onConnect = useCallback((c: Connection) => {
        if (!c.source || !c.target || c.source === c.target) return;
        markDirty();
        setEdges(es => es.some(e => e.source === c.source && e.target === c.target)
            ? es
            : addEdge({ id: `e-${c.source}-${c.target}-${Date.now()}`, source: c.source!, target: c.target!, markerEnd: { type: MarkerType.ArrowClosed } }, es));
    }, [setEdges]);

    const addNode = useCallback((afterId?: string, parallel?: boolean) => {
        const id = `n-${generateUUID()}`;
        const base = afterId ? nodes.find(n => n.id === afterId) : null;
        const position = base
            ? { x: base.position.x + (parallel ? 0 : NODE_W + 70), y: base.position.y + (parallel ? NODE_H + 30 : 0) }
            : { x: 24, y: 24 + nodes.length * (NODE_H + 30) };
        markDirty();
        setNodes(ns => [...ns, { id, type: 'process', position, data: { name: '' } }]);
        if (afterId && !parallel) {
            setEdges(es => addEdge({ id: `e-${afterId}-${id}`, source: afterId, target: id, markerEnd: { type: MarkerType.ArrowClosed } }, es));
        } else if (afterId && parallel) {
            const preds = edges.filter(e => e.target === afterId).map(e => e.source);
            setEdges(es => [...es, ...preds.map(p => ({ id: `e-${p}-${id}-${Date.now()}`, source: p, target: id, markerEnd: { type: MarkerType.ArrowClosed } }))]);
        }
        setSelectedId(id);
    }, [nodes, edges, setNodes, setEdges]);

    const updateSelected = useCallback((patch: Partial<ProcData>) => {
        if (!selectedId) return;
        markDirty();
        setNodes(ns => ns.map(n => n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n));
    }, [selectedId, setNodes]);

    const deleteSelected = useCallback(() => {
        if (!selectedId) return;
        markDirty();
        setNodes(ns => ns.filter(n => n.id !== selectedId));
        setEdges(es => es.filter(e => e.source !== selectedId && e.target !== selectedId));
        setSelectedId(null);
    }, [selectedId, setNodes, setEdges]);

    const doLayout = useCallback(() => {
        const pos = layoutProcessGraph(nodes.map(n => ({ id: n.id })), edges.map(e => ({ source: e.source, target: e.target })));
        setNodes(ns => ns.map(n => pos[n.id] ? { ...n, position: pos[n.id] } : n));
    }, [nodes, edges, setNodes]);

    // AUTO IZ PRAVILA: server izgradi grane iz materijala (piše 'auto' u bazu) → reload canvasa.
    const autoFromRules = useCallback(async () => {
        if (autoBusy) return;
        if (dirty && typeof window !== 'undefined' && !window.confirm('Auto iz pravila PREGAZI trenutni plan grafom iz pravila materijal→proces. Nastaviti?')) return;
        setAutoBusy(true);
        try {
            const res = await applyAutoProcessPlan(product.Product_ID, organizationId, { force: true });
            if (!res.success) { showToast(res.message, 'error'); return; }
            if (res.graph?.nodes?.length) {
                graphToCanvas(res.graph);
                setDirty(false);
                showToast(res.message, 'success');
                onChanged();
            } else {
                showToast('Nema pravila za materijale ovog proizvoda — dodaj ih kroz „Katalog i pravila"', 'info');
            }
        } finally { setAutoBusy(false); }
    }, [autoBusy, dirty, product.Product_ID, organizationId, graphToCanvas, onChanged, showToast]);

    const applyTemplate = useCallback((tpl: ProcessFlowTemplate) => {
        if (nodes.length > 0 && typeof window !== 'undefined' && !window.confirm(`Templejt „${tpl.name}" ZAMJENJUJE trenutni graf. Nastaviti?`)) return;
        const idMap = new Map<string, string>();
        tpl.nodes.forEach(n => idMap.set(n.id, `n-${generateUUID()}`));
        const g: ProcessGraph = {
            nodes: tpl.nodes.map(n => ({ id: idMap.get(n.id)!, name: n.name, itemIds: [], position: n.position })),
            edges: tpl.edges.filter(e => idMap.has(e.source) && idMap.has(e.target))
                .map(e => ({ id: `e-${generateUUID()}`, source: idMap.get(e.source)!, target: idMap.get(e.target)! })),
        };
        graphToCanvas(g);
        setDirty(true);
        showToast(`Templejt „${tpl.name}" primijenjen — Spremi za trajno`, 'info');
    }, [nodes.length, graphToCanvas, showToast]);

    const saveAsTemplate = useCallback(async () => {
        const name = typeof window !== 'undefined' ? window.prompt('Naziv templejta toka:')?.trim() : '';
        if (!name) return;
        const tnodes = nodes.map(n => ({ id: n.id, name: (n.data as ProcData).name || '', position: n.position }));
        const tedges = edges.map(e => ({ id: e.id, source: e.source, target: e.target }));
        const res = await saveProcessTemplate(name, tnodes, tedges, organizationId);
        showToast(res.message, res.success ? 'success' : 'error');
        if (res.success) listProcessTemplates(organizationId).then(setTemplates);
    }, [nodes, edges, organizationId, showToast]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        const graph: ProcessGraph = {
            nodes: nodes.map(n => ({ id: n.id, name: (n.data as ProcData).name || '', itemIds: [], position: n.position })),
            edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
        };
        const res = await saveProductProcessGraph(product.Product_ID, graph, organizationId, 'manual');
        showToast(res.message, res.success ? 'success' : 'error');
        setSaving(false);
        if (res.success) { onChanged(); onClose(); }
    }, [nodes, edges, product.Product_ID, organizationId, onChanged, onClose, showToast]);

    const selected = nodes.find(n => n.id === selectedId) || null;
    const selData = selected?.data as ProcData | undefined;

    const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', background: 'var(--background)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary)', transition: 'var(--transition)' };

    const catalogNames = useMemo(() => catalog.map(c => c.Name), [catalog]);

    return (
        <Modal
            isOpen onClose={onClose} size="xl"
            title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <GitBranch size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Plan procesa · {product.Name}</span>
                    {source && (
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
                            padding: '2px 9px', borderRadius: 999, flexShrink: 0,
                            background: source === 'manual' ? 'var(--surface)' : 'var(--accent-light)',
                            color: source === 'manual' ? 'var(--text-secondary)' : 'var(--accent)',
                        }}>
                            {source === 'manual' ? <Lock size={10} /> : <Wand2 size={10} />}
                            {source === 'manual' ? 'Ručno' : 'Auto'}
                        </span>
                    )}
                </span>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: '72vh', width: '100%', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button style={{ ...btn, borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-light)' }}
                        onClick={autoFromRules} disabled={autoBusy}
                        title="Izgradi grane iz pravila materijal→proces (iveral grana ∥ furnir+MDF grana…; spajaju se na zajedničkim procesima)">
                        {autoBusy ? <Loader2 size={15} className="ppg-spin" /> : <RefreshCw size={15} />} Auto iz pravila
                    </button>
                    <button style={btn} onClick={() => addNode()}><Plus size={15} /> Proces</button>
                    <button style={btn} onClick={doLayout}><Wand2 size={15} /> Posloži</button>
                    {templates.length > 0 && (
                        <select defaultValue="" onChange={e => { const t = templates.find(x => x.id === e.target.value); if (t) applyTemplate(t); e.currentTarget.value = ''; }} style={{ ...btn, paddingRight: 8 }}>
                            <option value="">Templejt…</option>
                            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    )}
                    <button style={btn} onClick={saveAsTemplate} title="Snimi trenutni graf kao templejt toka"><BookmarkPlus size={15} /></button>
                    <div style={{ flex: 1 }} />
                    <button style={{ ...btn, background: 'var(--text-primary)', color: 'var(--background)', border: 'none' }} onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 size={15} className="ppg-spin" /> : <Save size={15} />} Spremi
                    </button>
                </div>

                <div style={{ flex: 1, display: 'flex', gap: 10, minHeight: 0 }}>
                    <div style={{ flex: 1, border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', position: 'relative' }}>
                        <ReactFlow
                            nodes={nodes} edges={edges}
                            onNodesChange={c => { onNodesChange(c); if (c.some(x => x.type === 'position' || x.type === 'remove')) markDirty(); }}
                            onEdgesChange={c => { onEdgesChange(c); if (c.some(x => x.type === 'remove')) markDirty(); }}
                            onConnect={onConnect}
                            onSelectionChange={(p) => setSelectedId(p.nodes[0]?.id ?? null)}
                            nodeTypes={nodeTypes}
                            fitView
                            proOptions={{ hideAttribution: true }}
                        >
                            <Background />
                            <Controls showInteractive={false} />
                        </ReactFlow>
                        {nodes.length === 0 && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', pointerEvents: 'none', gap: 6, textAlign: 'center', padding: 20 }}>
                                <GitBranch size={28} />
                                <div style={{ fontSize: 13, maxWidth: 380, lineHeight: 1.5 }}>
                                    Nema plana. <strong>Auto iz pravila</strong> gradi grane iz materijala
                                    (iveral ∥ furnir+MDF…), ili ih dodaj ručno preko <strong>+ Proces</strong>.
                                </div>
                            </div>
                        )}
                    </div>

                    {selected && selData && (
                        <div style={{ width: 260, border: '1px solid var(--border-light)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
                            <div>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Naziv procesa</label>
                                <input list="ppg-catalog" value={selData.name} placeholder="npr. Kantiranje" autoFocus
                                    onChange={e => updateSelected({ name: e.target.value })}
                                    style={{ width: '100%', marginTop: 4, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-light)', fontSize: 13 }} />
                                <datalist id="ppg-catalog">
                                    {catalogNames.map(p => <option key={p} value={p} />)}
                                </datalist>
                                <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                    Koristi nazive iz kataloga — po njima se procesi više proizvoda objedinjuju u nalogu.
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button style={btn} onClick={() => addNode(selected.id, false)}><Plus size={14} /> Nastavak</button>
                                <button style={btn} onClick={() => addNode(selected.id, true)}><GitBranch size={14} /> Paralelno</button>
                            </div>
                            <button style={{ ...btn, color: 'var(--error)', borderColor: 'var(--error-bg)', justifyContent: 'center' }} onClick={deleteSelected}>
                                <Trash2 size={14} /> Obriši proces
                            </button>
                        </div>
                    )}
                </div>

                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    Grane različitih materijala teku paralelno i spajaju se na zajedničkim procesima (sklapanje, okivanje).
                    U nalogu se planovi više proizvoda objedinjuju automatski — isti proces = jedan čvor.
                </div>
            </div>
            <style jsx>{`:global(.ppg-spin) { animation: ppg-rot 0.8s linear infinite; } @keyframes ppg-rot { to { transform: rotate(360deg); } }`}</style>
        </Modal>
    );
}
