'use client';

import { useState, useEffect, useCallback, useContext, createContext, useMemo } from 'react';
import {
    ReactFlow, Background, Controls, Handle, Position, addEdge, MarkerType,
    useNodesState, useEdgesState,
} from '@xyflow/react';
import type { Node, Edge, Connection, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Modal from './Modal';
import { Plus, GitBranch, Wand2, Save, Trash2, Loader2, List, Network, BookmarkPlus, RefreshCw } from 'lucide-react';
import { COMMON_PROCESSES } from '@/lib/types';
import type { WorkLog, ProcessGraph, ProcessFlowTemplate } from '@/lib/types';
import { getProcessGraph, saveProcessGraph, generateUUID, listProcessTemplates, saveProcessTemplate } from '@/lib/services';
import { layoutProcessGraph, NODE_W, NODE_H } from '@/lib/processLayout';

interface ProcessGraphModalProps {
    workOrderId: string;
    workOrderNumber?: string;
    workOrderName?: string;
    items: {
        ID: string;
        Product_Name: string;
        // ItemProcessChecklist zapisi — čvor grafa postaje "završeno" kad svi pokriveni
        // proizvodi imaju istoimeni proces označen završenim (veza po nazivu procesa)
        Processes?: { Process_Name: string; Status?: string; Completed_At?: string }[];
        // Fazni plan stavke (snapshot pri kreiranju) — izvor za "Sinhronizuj iz proizvoda"
        Process_Stages?: { processes: string[] }[];
    }[];
    workLogs?: WorkLog[];
    organizationId: string;
    onClose: () => void;
    showToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

type ProcData = { name: string; itemIds: string[] };

const fmt = (iso: string) => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : '';

// Kontekst da custom node zna nazive proizvoda + status/datum (iz dnevnika + checklist završetka)
const GraphCtx = createContext<{
    itemName: (id: string) => string;
    status: (nodeId: string, itemIds: string[], name?: string) => { color: string; label: string };
}>({ itemName: () => '', status: () => ({ color: 'var(--text-tertiary)', label: 'čeka' }) });

const badge: React.CSSProperties = { fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', color: 'var(--accent)', background: 'var(--accent-light)', whiteSpace: 'nowrap' };
const badgeAll: React.CSSProperties = { ...badge, border: '1px dashed var(--border)', color: 'var(--text-secondary)', background: 'transparent' };

function ProcessRFNode({ id, data, selected }: NodeProps) {
    const ctx = useContext(GraphCtx);
    const d = data as ProcData;
    const st = ctx.status(id, d.itemIds || [], d.name);
    return (
        <div style={{
            width: NODE_W, minHeight: NODE_H, background: 'var(--background)',
            border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-light)'}`, borderRadius: 'var(--radius-md)',
            boxShadow: '0 1px 3px var(--shadow-md)', overflow: 'hidden',
        }}>
            <Handle type="target" position={Position.Left} style={{ background: 'var(--text-tertiary)', width: 10, height: 10 }} />
            <div style={{ height: 5, background: st.color }} />
            <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{d.name || 'Proces'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{st.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                    {(d.itemIds || []).length === 0
                        ? <span style={badgeAll}>svi proizvodi</span>
                        : d.itemIds.slice(0, 4).map(iid => <span key={iid} style={badge}>{ctx.itemName(iid)}</span>)}
                    {(d.itemIds || []).length > 4 && <span style={badge}>+{d.itemIds.length - 4}</span>}
                </div>
            </div>
            <Handle type="source" position={Position.Right} style={{ background: 'var(--accent)', width: 10, height: 10 }} />
        </div>
    );
}

const nodeTypes = { process: ProcessRFNode };

export default function ProcessGraphModal({
    workOrderId, workOrderNumber, workOrderName, items, workLogs, organizationId, onClose, showToast,
}: ProcessGraphModalProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [view, setView] = useState<'graph' | 'list'>('graph');
    const [templates, setTemplates] = useState<ProcessFlowTemplate[]>([]);

    const itemName = useCallback((id: string) => {
        const n = items.find(i => i.ID === id)?.Product_Name || '';
        return n.length > 14 ? n.slice(0, 13) + '…' : (n || '—');
    }, [items]);

    const status = useCallback((nodeId: string, nodeItemIds: string[], name?: string) => {
        // ZAVRŠENO: svi pokriveni proizvodi (prazno = svi) imaju istoimeni proces označen
        // završenim u checklisti (ItemProcessChecklist → item.Processes). Veza po nazivu.
        if (name) {
            const covered = nodeItemIds.length > 0 ? items.filter(i => nodeItemIds.includes(i.ID)) : items;
            if (covered.length > 0) {
                const entries = covered.map(i => i.Processes?.find(p => p.Process_Name === name));
                if (entries.every(e => e?.Status === 'Završeno')) {
                    const doneDates = entries.map(e => e!.Completed_At?.split('T')[0] || '').filter(Boolean).sort();
                    const last = doneDates[doneDates.length - 1];
                    return { color: 'var(--success)', label: last ? `završeno ${fmt(last)}` : 'završeno' };
                }
            }
        }
        const logs = (workLogs || []).filter(l => l.Process_Node_ID === nodeId);
        if (!logs.length) return { color: 'var(--text-tertiary)', label: 'čeka' };
        const dates = logs.map(l => l.Date).filter(Boolean).sort();
        const start = dates[0], end = dates[dates.length - 1];
        return { color: 'var(--accent)', label: start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}` };
    }, [workLogs, items]);

    const ctxValue = useMemo(() => ({ itemName, status }), [itemName, status]);

    // Učitaj graf
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const g = await getProcessGraph(workOrderId, organizationId);
            if (cancelled) return;
            const needLayout = g.nodes.length > 0 && g.nodes.every(n => !n.position);
            const pos = needLayout ? layoutProcessGraph(g.nodes, g.edges) : {};
            setNodes(g.nodes.map((n, i) => ({
                id: n.id, type: 'process',
                position: n.position ?? pos[n.id] ?? { x: 24, y: 24 + i * (NODE_H + 30) },
                data: { name: n.name, itemIds: n.itemIds || [] },
            })));
            setEdges(g.edges.map(e => ({ id: e.id, source: e.source, target: e.target, markerEnd: { type: MarkerType.ArrowClosed } })));
            setLoading(false);
            const tpls = await listProcessTemplates(organizationId);
            if (!cancelled) setTemplates(tpls);
        })();
        return () => { cancelled = true; };
    }, [workOrderId, organizationId, setNodes, setEdges]);

    const onConnect = useCallback((c: Connection) => {
        if (!c.source || !c.target || c.source === c.target) return;
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
        setNodes(ns => [...ns, { id, type: 'process', position, data: { name: '', itemIds: [] } }]);
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
        setNodes(ns => ns.map(n => n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n));
    }, [selectedId, setNodes]);

    const deleteSelected = useCallback(() => {
        if (!selectedId) return;
        setNodes(ns => ns.filter(n => n.id !== selectedId));
        setEdges(es => es.filter(e => e.source !== selectedId && e.target !== selectedId));
        setSelectedId(null);
    }, [selectedId, setNodes, setEdges]);

    const doLayout = useCallback(() => {
        const pos = layoutProcessGraph(nodes.map(n => ({ id: n.id })), edges.map(e => ({ source: e.source, target: e.target })));
        setNodes(ns => ns.map(n => pos[n.id] ? { ...n, position: pos[n.id] } : n));
    }, [nodes, edges, setNodes]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        const graph: ProcessGraph = {
            nodes: nodes.map(n => ({ id: n.id, name: (n.data as ProcData).name || '', itemIds: (n.data as ProcData).itemIds || [], position: n.position })),
            edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
        };
        const res = await saveProcessGraph(workOrderId, graph, organizationId);
        showToast?.(res.message, res.success ? 'success' : 'error');
        setSaving(false);
        if (res.success) onClose();
    }, [nodes, edges, workOrderId, organizationId, onClose, showToast]);

    const applyTemplate = useCallback((tpl: ProcessFlowTemplate) => {
        if (nodes.length && typeof window !== 'undefined' && !window.confirm('Zamijeniti trenutne procese ovim templejtom?')) return;
        const idMap = new Map<string, string>();
        tpl.nodes.forEach(n => idMap.set(n.id, `n-${generateUUID()}`));
        const newNodes: Node<ProcData>[] = tpl.nodes.map(n => ({ id: idMap.get(n.id)!, type: 'process', position: n.position ?? { x: 24, y: 24 }, data: { name: n.name, itemIds: [] } }));
        const newEdges: Edge[] = tpl.edges.filter(e => idMap.has(e.source) && idMap.has(e.target))
            .map(e => ({ id: `e-${generateUUID()}`, source: idMap.get(e.source)!, target: idMap.get(e.target)!, markerEnd: { type: MarkerType.ArrowClosed } }));
        if (tpl.nodes.every(n => !n.position)) {
            const pos = layoutProcessGraph(newNodes.map(n => ({ id: n.id })), newEdges.map(e => ({ source: e.source, target: e.target })));
            newNodes.forEach(n => { if (pos[n.id]) n.position = pos[n.id]; });
        }
        setNodes(newNodes); setEdges(newEdges); setSelectedId(null);
        showToast?.(`Templejt „${tpl.name}" primijenjen — pridruži proizvode čvorovima`, 'info');
    }, [nodes.length, setNodes, setEdges, showToast]);

    // SINHRONIZUJ IZ PROIZVODA: ponovo sintetiši graf iz FAZNIH planova stavki
    // (Process_Stages snapshot pri kreiranju; fallback nazivi iz checkliste = sekvencijalno).
    // Isti proces više proizvoda = jedan čvor. Pozicije istoimenih čvorova se čuvaju.
    const syncFromProducts = useCallback(async () => {
        if (nodes.length && typeof window !== 'undefined' && !window.confirm('Zamijeniti trenutni graf procesima iz proizvoda? Ručne izmjene grafa se gube.')) return;
        const { synthesizeOrderGraph, planToStages } = await import('@/lib/productProcesses');
        const planItems = items.map(i => ({
            itemId: i.ID,
            stages: planToStages(i.Process_Stages, (i.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[]),
        })).filter(pi => pi.stages.length > 0);
        const { graph, warnings } = synthesizeOrderGraph(planItems);
        if (graph.nodes.length === 0) {
            showToast?.('Proizvodi nemaju definisane procese (checklist je prazan)', 'info');
            return;
        }
        // Zadrži pozicije istoimenih postojećih čvorova; ostale rasporedi
        const oldPosByName = new Map(nodes.map(n => [((n.data as ProcData).name || '').trim().toLowerCase(), n.position]));
        const pos = layoutProcessGraph(graph.nodes.map(n => ({ id: n.id })), graph.edges.map(e => ({ source: e.source, target: e.target })));
        const newNodes: Node<ProcData>[] = graph.nodes.map(n => ({
            id: n.id, type: 'process',
            position: oldPosByName.get(n.name.trim().toLowerCase()) ?? pos[n.id] ?? { x: 24, y: 24 },
            data: { name: n.name, itemIds: n.itemIds },
        }));
        const newEdges: Edge[] = graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target, markerEnd: { type: MarkerType.ArrowClosed } }));
        setNodes(newNodes); setEdges(newEdges); setSelectedId(null);
        showToast?.(warnings.length ? `Sinhronizovano uz ${warnings.length} upozorenje(a) o redoslijedu` : 'Graf sinhronizovan iz proizvoda — Spremi za potvrdu', warnings.length ? 'info' : 'success');
    }, [nodes, items, setNodes, setEdges, showToast]);

    const saveAsTemplate = useCallback(async () => {
        const name = typeof window !== 'undefined' ? window.prompt('Naziv templejta toka:')?.trim() : '';
        if (!name) return;
        const tnodes = nodes.map(n => ({ id: n.id, name: (n.data as ProcData).name || '', position: n.position }));
        const tedges = edges.map(e => ({ id: e.id, source: e.source, target: e.target }));
        const res = await saveProcessTemplate(name, tnodes, tedges, organizationId);
        showToast?.(res.message, res.success ? 'success' : 'error');
        if (res.success) listProcessTemplates(organizationId).then(setTemplates);
    }, [nodes, edges, organizationId, showToast]);

    const selected = nodes.find(n => n.id === selectedId) || null;
    const selData = selected?.data as ProcData | undefined;

    // Lista operacija: čvorovi + prethodnici + status/datum + KO JE RADIO (iz dnevnika po Process_Node_ID)
    const opRows = useMemo(() => nodes.map(n => {
        const d = n.data as ProcData;
        const preds = edges.filter(e => e.target === n.id).map(e => (nodes.find(x => x.id === e.source)?.data as ProcData | undefined)?.name || '—');
        const st = status(n.id, d.itemIds || [], d.name);
        const prods = (d.itemIds || []).length === 0 ? 'svi' : d.itemIds.map(itemName).join(', ');
        // Radnici · dani po čvoru — odgovor na "koji radnik je koji proces radio i koliko"
        const nodeLogs = (workLogs || []).filter(l => l.Process_Node_ID === n.id);
        const byWorker = new Map<string, number>();
        nodeLogs.forEach(l => byWorker.set(l.Worker_Name, (byWorker.get(l.Worker_Name) || 0) + (l.Day_Fraction ?? 1)));
        const fmtD = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
        const workersStr = Array.from(byWorker.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([w, days]) => `${w} (${fmtD(days)}d)`)
            .join(', ') || '—';
        return { id: n.id, name: d.name || 'Proces', preds: preds.join(', ') || '—', prods, status: st.label, workers: workersStr };
    }), [nodes, edges, status, itemName, workLogs]);

    const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', background: 'var(--background)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary)', transition: 'var(--transition)' };
    const tab: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: 'none', background: 'transparent', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)' };
    const tabActive: React.CSSProperties = { background: 'var(--background)', color: 'var(--text-primary)', boxShadow: '0 1px 2px var(--shadow-md)' };
    const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 600 };
    const td: React.CSSProperties = { padding: '8px 12px', color: 'var(--text-primary)', verticalAlign: 'top' };

    return (
        <Modal isOpen onClose={onClose} size="xl" title={`Procesi · ${workOrderName || ('Nalog ' + (workOrderNumber || ''))}`}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '74vh', width: '100%', gap: 10 }}>
                {/* Tabs + alati */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', borderRadius: 8, padding: 3 }}>
                        <button style={{ ...tab, ...(view === 'graph' ? tabActive : {}) }} onClick={() => setView('graph')}><Network size={14} /> Graf</button>
                        <button style={{ ...tab, ...(view === 'list' ? tabActive : {}) }} onClick={() => setView('list')}><List size={14} /> Lista</button>
                    </div>
                    {view === 'graph' && <>
                        <button style={btn} onClick={() => addNode()}><Plus size={15} /> Proces</button>
                        <button style={btn} onClick={doLayout}><Wand2 size={15} /> Posloži</button>
                    </>}
                    <button style={btn} onClick={syncFromProducts} title="Ponovo izgradi graf iz planova procesa proizvoda (isti proces = jedan čvor)">
                        <RefreshCw size={15} /> Sinhronizuj iz proizvoda
                    </button>
                    {templates.length > 0 && (
                        <select defaultValue="" onChange={e => { const t = templates.find(x => x.id === e.target.value); if (t) applyTemplate(t); e.currentTarget.value = ''; }} style={{ ...btn, paddingRight: 8 }}>
                            <option value="">Primijeni templejt…</option>
                            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    )}
                    <button style={btn} onClick={saveAsTemplate}><BookmarkPlus size={15} /> Snimi templejt</button>
                    <div style={{ flex: 1 }} />
                    <button style={{ ...btn, background: 'var(--text-primary)', color: 'var(--background)', border: 'none' }} onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 size={15} className="dwb-spin" /> : <Save size={15} />} Spremi
                    </button>
                </div>

                {view === 'graph' && (
                <div style={{ flex: 1, display: 'flex', gap: 10, minHeight: 0 }}>
                    {/* Canvas */}
                    <div style={{ flex: 1, border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', position: 'relative' }}>
                        {loading ? (
                            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', gap: 8 }}>
                                <Loader2 size={18} className="dwb-spin" /> Učitavam…
                            </div>
                        ) : (
                            <GraphCtx.Provider value={ctxValue}>
                                <ReactFlow
                                    nodes={nodes} edges={edges}
                                    onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
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
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', pointerEvents: 'none', gap: 6 }}>
                                        <GitBranch size={28} />
                                        <div style={{ fontSize: 13 }}>Nema procesa. Klikni „+ Proces" za početak.</div>
                                    </div>
                                )}
                            </GraphCtx.Provider>
                        )}
                    </div>

                    {/* Panel selektovanog čvora */}
                    {selected && selData && (
                        <div style={{ width: 280, border: '1px solid var(--border-light)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
                            <div>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Naziv procesa</label>
                                <input list="pg-common" value={selData.name} placeholder="npr. Kantiranje"
                                    onChange={e => updateSelected({ name: e.target.value })}
                                    style={{ width: '100%', marginTop: 4, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-light)', fontSize: 13 }} />
                                {/* Prijedlozi: nazivi iz templejta organizacije + standardna lista kao fallback */}
                                <datalist id="pg-common">
                                    {Array.from(new Set([
                                        ...templates.flatMap(t => (t.nodes || []).map(n => n.name).filter(Boolean)),
                                        ...COMMON_PROCESSES,
                                    ])).map(p => <option key={p} value={p} />)}
                                </datalist>
                            </div>

                            <div>
                                <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Proizvodi ({selData.itemIds.length === 0 ? 'svi' : selData.itemIds.length})</label>
                                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                                    {items.map(it => {
                                        const on = selData.itemIds.includes(it.ID);
                                        return (
                                            <label key={it.ID} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', color: 'var(--text-primary)' }}>
                                                <input type="checkbox" checked={on}
                                                    onChange={() => updateSelected({ itemIds: on ? selData.itemIds.filter(x => x !== it.ID) : [...selData.itemIds, it.ID] })} />
                                                {it.Product_Name}
                                            </label>
                                        );
                                    })}
                                </div>
                                <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 4 }}>Prazno = proces vrijedi za sve proizvode naloga.</div>
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
                )}

                {view === 'list' && (
                    <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-light)', borderRadius: 12 }}>
                        {opRows.length === 0 ? (
                            <div style={{ padding: 24, color: 'var(--text-tertiary)', fontSize: 13 }}>Nema procesa. Dodaj ih u „Graf" prikazu.</div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-light)', position: 'sticky', top: 0, background: 'var(--background)' }}>
                                        <th style={th}>Proces</th><th style={th}>Proizvodi</th><th style={th}>Prethodni proces</th><th style={th}>Status / datum</th><th style={th}>Radnici · dani</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {opRows.map(r => (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--surface)' }}>
                                            <td style={{ ...td, fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</td>
                                            <td style={td}>{r.prods}</td>
                                            <td style={td}>{r.preds}</td>
                                            <td style={td}>{r.status}</td>
                                            <td style={{ ...td, color: 'var(--text-secondary)' }}>{r.workers}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
