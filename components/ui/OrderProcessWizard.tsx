'use client';

import { useState, useMemo, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import Modal from './Modal';
import { planToStages, type Consolidation } from '@/lib/productProcesses';
import { generateUUID } from '@/lib/services';
import { Users, User, GripVertical, Split, Combine, Check, Pencil } from 'lucide-react';

interface WizardItem {
    ID: string;
    Product_Name: string;
    Processes?: { Process_Name: string }[];
    Process_Stages?: { processes: string[] }[];
}

interface OrderProcessWizardProps {
    items: WizardItem[];
    onConfirm: (consolidation: Consolidation) => void;
    onClose: () => void;
    zIndex?: number;
}

const norm = (s: string) => (s || '').trim().toLowerCase();

interface Member { name: string; itemIds: string[]; }
interface Group { id: string; canonical: string; members: Member[]; }

/**
 * WIZARD KONSOLIDACIJE PROCESA NALOGA (samo grupisanje).
 * Skupi sve procese svih proizvoda naloga, auto-grupiše identične nazive, pa korisnik
 * prevlačenjem spaja SLIČNE (različito imenovane) u jedan ZAJEDNIČKI proces i imenuje grupu.
 * Rezultat (Consolidation) šalje pozivaocu koji sintetiše graf (aliasi čuvaju originalne nazive
 * → status/knjiženje po proizvodu ostaju tačni). Redoslijed/veze i dalje izvodi synthesizeOrderGraph.
 */
export default function OrderProcessWizard({ items, onConfirm, onClose, zIndex }: OrderProcessWizardProps) {
    const itemName = useCallback((id: string) => items.find(i => i.ID === id)?.Product_Name || '—', [items]);

    // Početno stanje: distinct proces (identična imena spojena) = jedan član; svaki član svoja grupa.
    const initialGroups = useMemo<Group[]>(() => {
        const distinct = new Map<string, Member>();
        for (const it of items) {
            const stages = planToStages(it.Process_Stages, (it.Processes || []).map(p => p.Process_Name).filter(Boolean) as string[]);
            for (const stage of stages) {
                for (const p of stage) {
                    const k = norm(p);
                    if (!k) continue;
                    if (!distinct.has(k)) distinct.set(k, { name: p.trim(), itemIds: [] });
                    const m = distinct.get(k)!;
                    if (!m.itemIds.includes(it.ID)) m.itemIds.push(it.ID);
                }
            }
        }
        return Array.from(distinct.values()).map(m => ({ id: generateUUID(), canonical: m.name, members: [m] }));
    }, [items]);

    const [groups, setGroups] = useState<Group[]>(initialGroups);
    const [editingId, setEditingId] = useState<string | null>(null);

    const coverageOf = (g: Group): string[] => {
        const s = new Set<string>();
        g.members.forEach(m => m.itemIds.forEach(id => s.add(id)));
        return Array.from(s);
    };

    const onDragEnd = useCallback((result: DropResult) => {
        const { source, destination } = result;
        if (!destination) return;
        const srcId = source.droppableId.replace('group-', '');
        setGroups(prev => {
            const next = prev.map(g => ({ ...g, members: [...g.members] }));
            const srcG = next.find(g => g.id === srcId);
            if (!srcG) return prev;
            const [moved] = srcG.members.splice(source.index, 1);
            if (!moved) return prev;
            if (destination.droppableId === 'new-group') {
                next.push({ id: generateUUID(), canonical: moved.name, members: [moved] });
            } else {
                const dstId = destination.droppableId.replace('group-', '');
                const dstG = next.find(g => g.id === dstId);
                if (!dstG) return prev;
                if (dstG.members.some(m => norm(m.name) === norm(moved.name))) {
                    // duplikat naziva u odredišnoj grupi — vrati nazad (ne spaja se sam sa sobom)
                    srcG.members.splice(source.index, 0, moved);
                    return next.filter(g => g.members.length > 0);
                }
                dstG.members.splice(destination.index, 0, moved);
            }
            return next.filter(g => g.members.length > 0);
        });
    }, []);

    function renameGroup(id: string, name: string) {
        setGroups(prev => prev.map(g => g.id === id ? { ...g, canonical: name } : g));
    }

    const mergedCount = groups.filter(g => g.members.length > 1).length;

    function handleConfirm() {
        const consolidation: Consolidation = {
            groups: groups.map(g => ({
                canonical: (g.canonical || '').trim() || g.members[0]?.name || '',
                members: g.members.map(m => m.name),
            })).filter(g => g.canonical && g.members.length > 0),
        };
        onConfirm(consolidation);
    }

    const badgeCommon: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', background: 'var(--accent-light)', color: 'var(--accent)' };
    const badgeIndiv: React.CSSProperties = { ...badgeCommon, background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' };

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="xl"
            zIndex={zIndex}
            title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Combine size={18} style={{ color: 'var(--accent)' }} />
                    <span>Konsolidacija procesa naloga</span>
                </span>
            }
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose}>Otkaži</button>
                    <button className="btn btn-primary" onClick={handleConfirm} disabled={groups.length === 0}>
                        <Check size={15} /> Primijeni na graf
                    </button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Svaki proces svih proizvoda naloga je kartica. <strong>Prevuci</strong> procese koji su isti/slični u istu karticu da
                    postanu <strong>jedan zajednički</strong> proces (npr. „lijepljenje furnira" + „Lijepljenje i obrada"). Kartica s
                    više proizvoda je <em>zajednička</em>, s jednim <em>pojedinačna</em>. Naziv kartice postaje naziv čvora u grafu.
                </div>

                {groups.length === 0 ? (
                    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-md)' }}>
                        Proizvodi ovog naloga nemaju definisane procese.
                    </div>
                ) : (
                    <DragDropContext onDragEnd={onDragEnd}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
                            {groups.map(g => {
                                const cov = coverageOf(g);
                                const common = cov.length > 1;
                                return (
                                    <div key={g.id} style={{
                                        width: 240, flexShrink: 0, background: 'var(--surface)',
                                        border: `1px solid ${common ? 'var(--accent)' : 'var(--border-light)'}`,
                                        borderRadius: 'var(--radius-md)', overflow: 'hidden',
                                    }}>
                                        <div style={{ padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {common
                                                    ? <span style={badgeCommon}><Users size={11} /> Zajednički · {cov.length}</span>
                                                    : <span style={badgeIndiv}><User size={11} /> {itemName(cov[0] || '')}</span>}
                                            </div>
                                            {editingId === g.id ? (
                                                <input
                                                    autoFocus
                                                    value={g.canonical}
                                                    onChange={e => renameGroup(g.id, e.target.value)}
                                                    onBlur={() => setEditingId(null)}
                                                    onKeyDown={e => { if (e.key === 'Enter') setEditingId(null); }}
                                                    style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--accent)', fontSize: 13, fontWeight: 700 }}
                                                />
                                            ) : (
                                                <button onClick={() => setEditingId(g.id)} title="Preimenuj zajednički proces"
                                                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                                                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.canonical || '—'}</span>
                                                    <Pencil size={11} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                                </button>
                                            )}
                                        </div>
                                        <Droppable droppableId={`group-${g.id}`}>
                                            {(provided, snapshot) => (
                                                <div ref={provided.innerRef} {...provided.droppableProps}
                                                    style={{ minHeight: 40, padding: '2px 8px 8px', display: 'flex', flexDirection: 'column', gap: 6, background: snapshot.isDraggingOver ? 'var(--accent-light)' : 'transparent', transition: 'background 0.12s ease' }}>
                                                    {g.members.map((m, mi) => (
                                                        <Draggable key={norm(m.name)} draggableId={`${g.id}::${norm(m.name)}`} index={mi}>
                                                            {(prov, snap) => (
                                                                <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                                                                    style={{
                                                                        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px',
                                                                        background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                                                                        boxShadow: snap.isDragging ? '0 8px 20px var(--shadow-md)' : '0 1px 2px var(--shadow)',
                                                                        cursor: 'grab', ...prov.draggableProps.style,
                                                                    }}>
                                                                    <GripVertical size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                                                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                                                                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>{m.itemIds.length}×</span>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </div>
                                );
                            })}

                            {/* Zona za razdvajanje: prevuci proces ovdje da dobije svoju karticu */}
                            <Droppable droppableId="new-group">
                                {(provided, snapshot) => (
                                    <div ref={provided.innerRef} {...provided.droppableProps}
                                        style={{
                                            width: 150, minHeight: 90, flexShrink: 0, display: 'flex', flexDirection: 'column',
                                            alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center',
                                            border: `1.5px dashed ${snapshot.isDraggingOver ? 'var(--accent)' : 'var(--border)'}`,
                                            borderRadius: 'var(--radius-md)', color: snapshot.isDraggingOver ? 'var(--accent)' : 'var(--text-tertiary)',
                                            background: snapshot.isDraggingOver ? 'var(--accent-light)' : 'transparent', fontSize: 12, fontWeight: 600, padding: 8,
                                        }}>
                                        <Split size={16} />
                                        <span>{snapshot.isDraggingOver ? 'Pusti za odvajanje' : 'Razdvoji (nova kartica)'}</span>
                                        <div style={{ display: 'none' }}>{provided.placeholder}</div>
                                    </div>
                                )}
                            </Droppable>
                        </div>
                    </DragDropContext>
                )}

                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {groups.length} {groups.length === 1 ? 'proces' : 'procesa'} · {mergedCount} spojeno.
                    Nakon „Primijeni na graf" fini raspored i veze dorađuješ u editoru, pa „Spremi".
                </div>
            </div>
        </Modal>
    );
}
