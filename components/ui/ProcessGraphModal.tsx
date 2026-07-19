'use client';

import { useState, useEffect, useCallback, useContext, createContext, useMemo } from 'react';
import {
    ReactFlow, Background, Controls, MiniMap, Handle, Position, addEdge, MarkerType,
    BaseEdge, EdgeLabelRenderer, getSmoothStepPath,
    useNodesState, useEdgesState,
} from '@xyflow/react';
import type { Node, Edge, Connection, NodeProps, EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './ProcessGraphModal.css';
import Modal from './Modal';
import { Plus, GitBranch, Save, Trash2, Loader2, List, Network, BookmarkPlus, Layers, X, CheckCircle2, Clock, MoveRight } from 'lucide-react';
import { COMMON_PROCESSES } from '@/lib/types';
import type { WorkLog, ProcessGraph, ProcessFlowTemplate } from '@/lib/types';
import {
    getProcessGraph, saveProcessGraph, generateUUID, listProcessTemplates, saveProcessTemplate,
} from '@/lib/services';
import { layoutProcessGraph, layoutColumns, computeGraphDepths, NODE_W, NODE_H } from '@/lib/processLayout';
import { nodeMatchesProcess } from '@/lib/productProcesses';

interface ProcessGraphModalProps {
    workOrderId: string;
    workOrderNumber?: string;
    workOrderName?: string;
    items: {
        ID: string;
        Product_Name: string;
        // ItemProcessChecklist zapisi — čvor grafa postaje "završeno" kad svi pokriveni
        // proizvodi imaju istoimeni proces označen završenim (veza po nazivu procesa)
        // Worker_Name/Helpers = KO je završio (prikaz u čvoru/listi, ne samo iz dnevnika)
        Processes?: { Process_Name: string; Status?: string; Completed_At?: string; Worker_Name?: string; Helpers?: { Worker_Name: string }[] }[];
        // Fazni plan stavke (snapshot pri kreiranju) — izvor za auto-sintezu grafa
        Process_Stages?: { processes: string[] }[];
    }[];
    workLogs?: WorkLog[];
    organizationId: string;
    onClose: () => void;
    showToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

type ProcData = { name: string; itemIds: string[]; aliases?: string[] };

// Status čvora: 'done' = svi pokriveni proizvodi završili proces, 'active' = ima dnevnica
// (radi se sada), 'pending' = još nije počelo. Boja ivice/minimape/ikone slijedi kind.
type StatusKind = 'done' | 'active' | 'pending';
type NodeStatus = { color: string; label: string; kind: StatusKind };
// Konkretni hex (SVG markeri/minimapa ne razrješavaju CSS varijable pouzdano)
const KIND_HEX: Record<StatusKind, string> = { done: '#34c759', active: '#0071e3', pending: '#c7c7cc' };

const fmt = (iso: string) => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : '';

// Kontekst da custom node zna nazive proizvoda + status/datum (iz dnevnika + checklist završetka).
// `aliases` = sinonimi čvora (spojeni različiti nazivi procesa) → poklapanje po skupu, ne samo po `name`.
// removeEdge/nodeStatusById služe custom vezi (uklanjanje + boja/animacija po statusu izvora).
const GraphCtx = createContext<{
    itemName: (id: string) => string;
    status: (nodeId: string, itemIds: string[], name?: string, aliases?: string[]) => NodeStatus;
    completers: (itemIds: string[], name?: string, aliases?: string[]) => string[];
    removeEdge: (id: string) => void;
    nodeStatusById: (id: string) => { kind: StatusKind };
}>({
    itemName: () => '',
    status: () => ({ color: 'var(--text-tertiary)', label: 'čeka', kind: 'pending' }),
    completers: () => [],
    removeEdge: () => {},
    nodeStatusById: () => ({ kind: 'pending' }),
});

const badge: React.CSSProperties = { fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', color: 'var(--accent)', background: 'var(--accent-light)', whiteSpace: 'nowrap' };
const badgeAll: React.CSSProperties = { ...badge, border: '1px dashed var(--border)', color: 'var(--text-secondary)', background: 'transparent' };

function StatusIcon({ kind }: { kind: StatusKind }) {
    if (kind === 'done') return <CheckCircle2 size={13} color="var(--success)" style={{ flexShrink: 0 }} />;
    if (kind === 'active') return <span className="pg-pulse" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />;
    return <Clock size={12} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />;
}

function ProcessRFNode({ id, data, selected }: NodeProps) {
    const ctx = useContext(GraphCtx);
    const d = data as ProcData;
    const st = ctx.status(id, d.itemIds || [], d.name, d.aliases);
    const done = ctx.completers(d.itemIds || [], d.name, d.aliases);
    const merged = (d.aliases || []).filter(a => a.trim().toLowerCase() !== (d.name || '').trim().toLowerCase());
    return (
        <div className="pg-node" style={{
            width: NODE_W, minHeight: NODE_H, background: 'var(--background)',
            border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-light)'}`, borderRadius: 'var(--radius-md)',
            boxShadow: selected ? '0 4px 14px rgba(0,113,227,0.18)' : '0 1px 3px var(--shadow-md)', overflow: 'hidden',
        }}>
            <Handle type="target" position={Position.Left} className="pg-handle" style={{ background: 'var(--text-tertiary)', width: 11, height: 11 }} />
            <div style={{ height: 5, background: st.color }} />
            <div style={{ padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusIcon kind={st.kind} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{d.name || 'Proces'}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{st.label}</div>
                {done.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--success)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        ✓ {done.slice(0, 2).join(', ')}{done.length > 2 ? ` +${done.length - 2}` : ''}
                    </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                    {(d.itemIds || []).length === 0
                        ? <span style={badgeAll}>svi proizvodi</span>
                        : d.itemIds.slice(0, 4).map(iid => <span key={iid} style={badge}>{ctx.itemName(iid)}</span>)}
                    {(d.itemIds || []).length > 4 && <span style={badge}>+{d.itemIds.length - 4}</span>}
                </div>
                {merged.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={`Spojeni nazivi: ${(d.aliases || []).join(', ')}`}>
                        ⇄ {merged.slice(0, 2).join(', ')}{merged.length > 2 ? ` +${merged.length - 2}` : ''}
                    </div>
                )}
            </div>
            <Handle type="source" position={Position.Right} className="pg-handle pg-handle-source" style={{ background: 'var(--accent)', width: 11, height: 11 }} />
        </div>
    );
}

const nodeTypes = { process: ProcessRFNode };

// Custom veza: status-obojena, animirana kad je izvorni proces "u toku", s uvijek vidljivim
// dugmetom × na sredini za uklanjanje (rješava „mogu samo povezati, ne i odvezati").
function ProcessFlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, source, selected, markerEnd }: EdgeProps) {
    const ctx = useContext(GraphCtx);
    const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 14 });
    const kind = ctx.nodeStatusById(source).kind;
    const stroke = selected ? KIND_HEX.active : KIND_HEX[kind];
    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                markerEnd={markerEnd}
                className={kind === 'active' ? 'pg-edge pg-edge-flow' : 'pg-edge'}
                style={{ stroke, strokeWidth: selected ? 3 : 2, opacity: kind === 'pending' && !selected ? 0.6 : 1 }}
            />
            <EdgeLabelRenderer>
                <div className="pg-edge-del-wrap" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
                    <button
                        type="button"
                        className={`pg-edge-del${selected ? ' is-selected' : ''}`}
                        onClick={(e) => { e.stopPropagation(); ctx.removeEdge(id); }}
                        title="Ukloni vezu"
                        aria-label="Ukloni vezu"
                    >
                        <X size={11} strokeWidth={2.5} />
                    </button>
                </div>
            </EdgeLabelRenderer>
        </>
    );
}

const edgeTypes = { process: ProcessFlowEdge };

export default function ProcessGraphModal({
    workOrderId, workOrderNumber, workOrderName, items, workLogs, organizationId, onClose, showToast,
}: ProcessGraphModalProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [view, setView] = useState<'graph' | 'stages' | 'list'>('graph');
    const [templates, setTemplates] = useState<ProcessFlowTemplate[]>([]);

    const itemName = useCallback((id: string) => {
        const n = items.find(i => i.ID === id)?.Product_Name || '';
        return n.length > 14 ? n.slice(0, 13) + '…' : (n || '—');
    }, [items]);

    const status = useCallback((nodeId: string, nodeItemIds: string[], name?: string, aliases?: string[]): NodeStatus => {
        // ZAVRŠENO: svi pokriveni proizvodi (prazno = svi) imaju odgovarajući proces označen
        // završenim u checklisti (ItemProcessChecklist → item.Processes). Veza po sinonimima (aliases).
        if (name) {
            const covered = nodeItemIds.length > 0 ? items.filter(i => nodeItemIds.includes(i.ID)) : items;
            if (covered.length > 0) {
                const entries = covered.map(i => i.Processes?.find(p => nodeMatchesProcess({ name, aliases }, p.Process_Name)));
                if (entries.every(e => e?.Status === 'Završeno')) {
                    const doneDates = entries.map(e => e!.Completed_At?.split('T')[0] || '').filter(Boolean).sort();
                    const last = doneDates[doneDates.length - 1];
                    return { color: 'var(--success)', label: last ? `završeno ${fmt(last)}` : 'završeno', kind: 'done' };
                }
            }
        }
        const logs = (workLogs || []).filter(l => l.Process_Node_ID === nodeId);
        if (!logs.length) return { color: 'var(--text-tertiary)', label: 'čeka', kind: 'pending' };
        const dates = logs.map(l => l.Date).filter(Boolean).sort();
        const start = dates[0], end = dates[dates.length - 1];
        return { color: 'var(--accent)', label: start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`, kind: 'active' };
    }, [workLogs, items]);

    // KO je završio proces (iz checkliste — Worker_Name + Helpers pokrivenih stavki), veza po nazivu
    const completers = useCallback((nodeItemIds: string[], name?: string, aliases?: string[]): string[] => {
        if (!name) return [];
        const covered = nodeItemIds.length > 0 ? items.filter(i => nodeItemIds.includes(i.ID)) : items;
        const set = new Set<string>();
        covered.forEach(i => {
            const p = i.Processes?.find(pp => nodeMatchesProcess({ name, aliases }, pp.Process_Name));
            if (p && p.Status === 'Završeno') {
                if (p.Worker_Name) set.add(p.Worker_Name);
                (p.Helpers || []).forEach(h => h?.Worker_Name && set.add(h.Worker_Name));
            }
        });
        return Array.from(set);
    }, [items]);

    // Status po čvoru (za boju/animaciju veze i minimapu) — jedan izračun, dijele custom veza i MiniMap.
    const statusById = useMemo(() => {
        const m = new Map<string, NodeStatus>();
        nodes.forEach(n => {
            const d = n.data as ProcData;
            m.set(n.id, status(n.id, d.itemIds || [], d.name, d.aliases));
        });
        return m;
    }, [nodes, status]);

    const removeEdge = useCallback((id: string) => {
        setEdges(es => es.filter(e => e.id !== id));
    }, [setEdges]);

    const ctxValue = useMemo(() => ({
        itemName, status, completers, removeEdge,
        nodeStatusById: (id: string) => ({ kind: statusById.get(id)?.kind ?? 'pending' as StatusKind }),
    }), [itemName, status, completers, removeEdge, statusById]);

    // Veze dobijaju custom tip + marker u boji statusa izvora (izvedeno; state ostaje čist za snimanje).
    const styledEdges = useMemo(() => edges.map(e => {
        const kind = statusById.get(e.source)?.kind ?? 'pending';
        return { ...e, type: 'process', markerEnd: { type: MarkerType.ArrowClosed, color: KIND_HEX[kind], width: 18, height: 18 } } as Edge;
    }), [edges, statusById]);

    // Učitaj graf
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            let g = await getProcessGraph(workOrderId, organizationId);
            if (cancelled) return;
            const persistedEmpty = !g.nodes || g.nodes.length === 0;
            // Auto-sinteza kad je perzistirani graf prazan → nikad prazan prikaz.
            // (Ne snima se automatski; "Spremi" ili "Sinhronizuj" za trajno.)
            if (persistedEmpty) {
                const { synthesizeOrderGraph, planToStages } = await import('@/lib/productProcesses');
                const planItems = items.map(i => ({
                    itemId: i.ID,
                    stages: planToStages(i.Process_Stages, (i.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[]),
                })).filter(pi => pi.stages.length > 0);
                // SA auto-vezama iz faza (gating radi odmah; korisnik ivice može dopuniti/obrisati).
                const synth = synthesizeOrderGraph(planItems, undefined, { includeEdges: true });
                if (synth.graph.nodes.length > 0) {
                    const pos = layoutColumns(synth.columns);
                    synth.graph.nodes.forEach(n => { n.position = n.position ?? pos[n.id]; });
                    g = synth.graph;
                }
            }
            if (cancelled) return;
            const needLayout = g.nodes.length > 0 && g.nodes.every(n => !n.position);
            const pos = needLayout ? layoutProcessGraph(g.nodes, g.edges) : {};
            setNodes(g.nodes.map((n, i) => ({
                id: n.id, type: 'process',
                position: n.position ?? pos[n.id] ?? { x: 24, y: 24 + i * (NODE_H + 30) },
                data: { name: n.name, itemIds: n.itemIds || [], aliases: n.aliases },
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

    // Procesi koji postoje na stavkama, a NEMA ih više NIGDJE u grafu → spremanje će ih
    // ukloniti iz naloga (graf je autoritet). Poklapanje po nazivu kroz cijeli graf — isto
    // pravilo kao reconcileItemsToGraph; itemIds se namjerno ne gledaju (vidi tamo).
    // Završeni se broje odvojeno, jer se s njima gubi i evidencija ko/kad je završio.
    const pendingRemovals = useMemo(() => {
        const inGraph = (name: string) => nodes.some(n => {
            const d = n.data as ProcData;
            return nodeMatchesProcess({ name: d.name, aliases: d.aliases }, name);
        });
        const names = new Map<string, boolean>();   // naziv → ima završenih
        for (const it of items) {
            for (const p of it.Processes || []) {
                if (!p.Process_Name || inGraph(p.Process_Name)) continue;
                names.set(p.Process_Name, (names.get(p.Process_Name) || false) || p.Status === 'Završeno');
            }
        }
        return Array.from(names.entries()).map(([name, hasDone]) => ({ name, hasDone }));
    }, [nodes, items]);

    const handleSave = useCallback(async () => {
        if (pendingRemovals.length && typeof window !== 'undefined') {
            const done = pendingRemovals.filter(r => r.hasDone).map(r => r.name);
            const ok = window.confirm(
                `Iz naloga će biti UKLONJENI procesi: ${pendingRemovals.map(r => r.name).join(', ')}.\n` +
                (done.length ? `\nPažnja — završeni su (gubi se ko/kad je završio): ${done.join(', ')}.\n` : '') +
                `\nNastaviti?`
            );
            if (!ok) return;
        }
        setSaving(true);
        const graph: ProcessGraph = {
            nodes: nodes.map(n => ({ id: n.id, name: (n.data as ProcData).name || '', itemIds: (n.data as ProcData).itemIds || [], aliases: (n.data as ProcData).aliases, position: n.position })),
            edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
        };
        const res = await saveProcessGraph(workOrderId, graph, organizationId);
        showToast?.(res.message, res.success ? 'success' : 'error');
        setSaving(false);
        if (res.success) onClose();
    }, [nodes, edges, pendingRemovals, workOrderId, organizationId, onClose, showToast]);

    const applyTemplate = useCallback(async (tpl: ProcessFlowTemplate) => {
        // Kad graf ima čvorove: OK = DODAJ šablon u postojeći graf (spoji), Odustani = ZAMIJENI.
        const append = nodes.length > 0 && typeof window !== 'undefined'
            && window.confirm(`Dodati šablon „${tpl.name}" U POSTOJEĆI graf?\n\nOK = dodaj (spoji s trenutnim), Odustani = zamijeni graf.`);
        if (append) {
            const { mergeFlowTemplateIntoGraph } = await import('@/lib/productProcesses');
            const prev = {
                nodes: nodes.map(n => ({ id: n.id, name: (n.data as ProcData).name, itemIds: (n.data as ProcData).itemIds || [], aliases: (n.data as ProcData).aliases, position: n.position })),
                edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
            };
            const { graph, addedNodeNames } = mergeFlowTemplateIntoGraph(prev, { nodes: tpl.nodes, edges: tpl.edges });
            setNodes(graph.nodes.map(n => ({ id: n.id, type: 'process', position: n.position ?? { x: 24, y: 24 }, data: { name: n.name, itemIds: n.itemIds || [], aliases: n.aliases } })));
            setEdges(graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target, markerEnd: { type: MarkerType.ArrowClosed } })));
            setSelectedId(null);
            showToast?.(`Šablon „${tpl.name}" dodan (+${addedNodeNames.length} čvorova) — provjeri veze pa Spremi`, 'success');
            return;
        }
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
    }, [nodes, edges, setNodes, setEdges, showToast]);

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
        const st = status(n.id, d.itemIds || [], d.name, d.aliases);
        const prods = (d.itemIds || []).length === 0 ? 'svi' : d.itemIds.map(itemName).join(', ');
        // Radnici · dani po čvoru — odgovor na "koji radnik je koji proces radio i koliko"
        const nodeLogs = (workLogs || []).filter(l => l.Process_Node_ID === n.id);
        const byWorker = new Map<string, number>();
        nodeLogs.forEach(l => byWorker.set(l.Worker_Name, (byWorker.get(l.Worker_Name) || 0) + (l.Day_Fraction ?? 1)));
        const fmtD = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
        // Radnici iz dnevnika (s danima) + završioci s checkliste (bez dana) koji nisu u dnevniku
        const doneNames = completers(d.itemIds || [], d.name, d.aliases);
        const extra = doneNames.filter(w => !byWorker.has(w));
        const workersStr = [
            ...Array.from(byWorker.entries()).sort((a, b) => b[1] - a[1]).map(([w, days]) => `${w} (${fmtD(days)}d)`),
            ...extra,
        ].join(', ') || '—';
        return { id: n.id, name: d.name || 'Proces', preds: preds.join(', ') || '—', prods, status: st.label, workers: workersStr };
    }), [nodes, edges, status, itemName, workLogs, completers]);

    // FAZE: kolone iz topologije TRENUTNOG canvasa (longest-path dubina) —
    // isti mentalni model kao fazni plan proizvoda (kolona = faza, unutar kolone paralelno).
    const stageColumns = useMemo(() => {
        if (view !== 'stages' || nodes.length === 0) return [] as Node<ProcData>[][];
        const depths = computeGraphDepths(nodes.map(n => ({ id: n.id })), edges.map(e => ({ source: e.source, target: e.target })));
        const byDepth = new Map<number, Node<ProcData>[]>();
        nodes.forEach(n => {
            const d = depths.get(n.id) ?? 0;
            if (!byDepth.has(d)) byDepth.set(d, []);
            byDepth.get(d)!.push(n);
        });
        return Array.from(byDepth.keys()).sort((a, b) => a - b).map(k => byDepth.get(k)!);
    }, [view, nodes, edges]);

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
                        <button style={{ ...tab, ...(view === 'stages' ? tabActive : {}) }} onClick={() => setView('stages')} title="Faze toka — isti pregled kao plan procesa proizvoda"><Layers size={14} /> Faze</button>
                        <button style={{ ...tab, ...(view === 'list' ? tabActive : {}) }} onClick={() => setView('list')}><List size={14} /> Lista</button>
                    </div>
                    {view === 'graph' && <>
                        <button style={btn} onClick={() => addNode()}><Plus size={15} /> Proces</button>
                    </>}
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

                {view === 'graph' && !loading && nodes.length > 0 && (
                    <div className="pg-hint">
                        <span><MoveRight size={13} /> Prevuci iz <b>plave tačke</b> (desno) za novu vezu</span>
                        <span><span className="pg-hint-x"><X size={9} strokeWidth={2.5} /></span> Klikni <b>×</b> na sredini veze da je ukloniš</span>
                        <span><Trash2 size={12} /> Označi čvor/vezu pa <b>Delete</b></span>
                    </div>
                )}

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
                                    className="pg-flow"
                                    nodes={nodes} edges={styledEdges}
                                    onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
                                    onConnect={onConnect}
                                    onSelectionChange={(p) => setSelectedId(p.nodes[0]?.id ?? null)}
                                    nodeTypes={nodeTypes}
                                    edgeTypes={edgeTypes}
                                    connectionLineStyle={{ stroke: KIND_HEX.active, strokeWidth: 2.5 }}
                                    fitView
                                    fitViewOptions={{ padding: 0.18 }}
                                    proOptions={{ hideAttribution: true }}
                                >
                                    <Background gap={18} size={1.5} color="rgba(0,0,0,0.07)" />
                                    <Controls showInteractive={false} />
                                    <MiniMap
                                        pannable
                                        zoomable
                                        nodeStrokeWidth={2}
                                        nodeColor={(n) => KIND_HEX[statusById.get(n.id)?.kind ?? 'pending']}
                                        maskColor="rgba(0,0,0,0.04)"
                                        style={{ width: 150, height: 100 }}
                                    />
                                </ReactFlow>
                                {nodes.length === 0 && (
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', pointerEvents: 'none', gap: 6 }}>
                                        <GitBranch size={28} />
                                        <div style={{ fontSize: 13 }}>Nema procesa. Klikni „+ Proces".</div>
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

                            {/* Veze čvora — drugi (jasan) put za odvezivanje kad se ivice teško kliknu */}
                            {(() => {
                                const nodeName = (nid: string) => (nodes.find(x => x.id === nid)?.data as ProcData | undefined)?.name || 'Proces';
                                const incoming = edges.filter(e => e.target === selected.id);
                                const outgoing = edges.filter(e => e.source === selected.id);
                                if (incoming.length === 0 && outgoing.length === 0) return null;
                                const row = (e: Edge, label: string, other: string) => (
                                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: 10, minWidth: 44 }}>{label}</span>
                                        <span style={{ flex: 1, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{other}</span>
                                        <button onClick={() => removeEdge(e.id)} title="Ukloni vezu" aria-label="Ukloni vezu"
                                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: '1px solid var(--border-light)', background: 'var(--background)', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                                            <X size={13} />
                                        </button>
                                    </div>
                                );
                                return (
                                    <div>
                                        <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Veze ({incoming.length + outgoing.length})</label>
                                        <div style={{ marginTop: 4 }}>
                                            {incoming.map(e => row(e, 'prije ←', nodeName(e.source)))}
                                            {outgoing.map(e => row(e, 'poslije →', nodeName(e.target)))}
                                        </div>
                                    </div>
                                );
                            })()}

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

                {view === 'stages' && (
                    <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-light)', borderRadius: 12, padding: 14, background: 'var(--surface)' }}>
                        {stageColumns.length === 0 ? (
                            <div style={{ padding: 24, color: 'var(--text-tertiary)', fontSize: 13 }}>Nema procesa. Dodaj ih u „Graf" prikazu.</div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto', paddingBottom: 6 }}>
                                {stageColumns.map((col, ci) => (
                                    <div key={ci} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                        <div style={{ width: 200, background: 'var(--background)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px 5px' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: 'var(--accent-light)', color: 'var(--accent)', fontSize: 10, fontWeight: 700 }}>{ci + 1}</span>
                                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Faza {ci + 1}</span>
                                                {col.length > 1 && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{col.length} paralelno</span>}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 8px 10px' }}>
                                                {col.map(n => {
                                                    const d = n.data as ProcData;
                                                    const st = status(n.id, d.itemIds || [], d.name, d.aliases);
                                                    return (
                                                        <div key={n.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--background)' }}>
                                                            <div style={{ height: 4, background: st.color }} />
                                                            <div style={{ padding: '6px 9px' }}>
                                                                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{d.name || 'Proces'}</div>
                                                                <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 1 }}>{st.label}</div>
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
                                                                    {(d.itemIds || []).length === 0
                                                                        ? <span style={badgeAll}>svi proizvodi</span>
                                                                        : d.itemIds.slice(0, 3).map(iid => <span key={iid} style={badge}>{itemName(iid)}</span>)}
                                                                    {(d.itemIds || []).length > 3 && <span style={badge}>+{d.itemIds.length - 3}</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {ci < stageColumns.length - 1 && (
                                            <span style={{ color: 'var(--border)', margin: '0 6px', display: 'flex', flexShrink: 0 }}>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10 }}>
                            Faze su izvedene iz veza grafa (kolona = faza; unutar kolone paralelno) — isti pregled kao plan procesa proizvoda. Veze i procese uređuješ u „Graf" prikazu.
                        </div>
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
