'use client';

// ════════════════════════════════════════════════════════════════════
// TEMPLEJTI FAZNOG PLANA PROCESA — snimi plan pod nazivom, primijeni ga na
// drugi proizvod, i UREDI ga na licu mjesta (naziv + faze + procesi), bez
// zaobilaznice „obriši pa ponovo snimi s nekog proizvoda".
// Faza = kolona; procesi unutar faze teku PARALELNO, faze idu redom.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import type { ProcessStageTemplate, ProcessCatalogItem } from '@/lib/types';
import {
    getProcessStageTemplates,
    saveProcessStageTemplate,
    updateProcessStageTemplate,
    renameProcessStageTemplate,
    deleteProcessStageTemplate,
    getProcessCatalog,
} from '@/lib/services';
import Modal from '@/components/ui/Modal';
import { Bookmark, Download, Pencil, Check, Trash2, Plus, Save, X, ArrowUp, ArrowDown, GitBranch } from 'lucide-react';

interface ProcessStageTemplatesModalProps {
    organizationId: string;
    currentStages: string[][]; // fazni plan trenutno otvorenog proizvoda
    onApply: (stages: string[][]) => void;
    onClose: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    zIndex?: number; // za slaganje preko Plana procesa (koji je i sam modal)
}

function previewStages(stages: { processes: string[] }[]): string {
    if (!stages.length) return '—';
    const parts = stages.map(s => s.processes.join(' ∥ '));
    return parts.length > 3 ? `${parts.slice(0, 3).join(' → ')} → +${parts.length - 3}` : parts.join(' → ');
}

const card: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
    border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', background: 'var(--surface)',
};
const iconBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
    border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', background: 'var(--background)',
    color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0,
};
const miniBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 26, padding: '0 8px',
    border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', background: 'var(--background)',
    color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0, fontSize: 12, fontWeight: 600,
};
const procInput: React.CSSProperties = {
    flex: 1, minWidth: 0, padding: '6px 9px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-light)', fontSize: 13, background: 'var(--background)', color: 'var(--text-primary)',
};

export default function ProcessStageTemplatesModal({
    organizationId, currentStages, onApply, onClose, showToast, zIndex,
}: ProcessStageTemplatesModalProps) {
    const [view, setView] = useState<'list' | 'save' | 'edit'>('list');
    const [templates, setTemplates] = useState<ProcessStageTemplate[]>([]);
    const [catalogNames, setCatalogNames] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);   // inline preimenovanje u listi
    const [editName, setEditName] = useState('');
    const [saveName, setSaveName] = useState('');
    const [saving, setSaving] = useState(false);

    // Uređivanje templejta (naziv + faze)
    const [editTpl, setEditTpl] = useState<ProcessStageTemplate | null>(null);
    const [draftName, setDraftName] = useState('');
    const [draftStages, setDraftStages] = useState<string[][]>([]);

    const hasCurrentPlan = currentStages.some(s => s.length > 0);

    const load = async () => {
        setLoading(true);
        try {
            setTemplates(await getProcessStageTemplates(organizationId));
        } catch (e) {
            console.error('load process stage templates error:', e);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, [organizationId]);
    useEffect(() => {
        getProcessCatalog(organizationId).then(c => setCatalogNames(c.map((x: ProcessCatalogItem) => x.Name))).catch(() => { });
    }, [organizationId]);

    function handleApply(t: ProcessStageTemplate) {
        if (hasCurrentPlan && !confirm(`Primijeniti templejt "${t.Name}"? Trenutni plan procesa ovog proizvoda će biti zamijenjen.`)) return;
        onApply(t.Stages.map(s => s.processes));
        onClose();
    }

    // Dodaj faze šablona NA KRAJ postojećeg plana (spajanje više šablona) — NE zatvara modal,
    // pa se može dodati još šablona; procesi koji već postoje se preskaču.
    async function handleAppend(t: ProcessStageTemplate) {
        const { appendStagesTemplate } = await import('@/lib/productProcesses');
        onApply(appendStagesTemplate(currentStages, t.Stages.map(s => s.processes)));
        showToast(`Dodano: ${t.Name}`, 'success');
    }

    async function handleDelete(t: ProcessStageTemplate) {
        if (!confirm(`Obrisati templejt "${t.Name}"?`)) return;
        setBusyId(t.Template_ID);
        const res = await deleteProcessStageTemplate(t.Template_ID, organizationId);
        setBusyId(null);
        if (res.success) { showToast(res.message, 'success'); await load(); }
        else showToast(res.message, 'error');
    }

    async function saveRename(t: ProcessStageTemplate) {
        const trimmed = editName.trim();
        setEditingId(null);
        if (!trimmed || trimmed === t.Name) return;
        const res = await renameProcessStageTemplate(t.Template_ID, trimmed, organizationId);
        if (res.success) await load();
        else showToast(res.message, 'error');
    }

    async function handleSaveNew() {
        const name = saveName.trim();
        if (!name) { showToast('Unesite naziv templejta', 'error'); return; }
        setSaving(true);
        const res = await saveProcessStageTemplate(name, currentStages.map(s => ({ processes: s })), organizationId);
        setSaving(false);
        if (res.success) {
            showToast(res.message, 'success');
            setSaveName('');
            await load();
            setView('list');
        } else showToast(res.message, 'error');
    }

    // ── UREĐIVANJE ──────────────────────────────────────────────────────
    function openEditor(t: ProcessStageTemplate) {
        setEditTpl(t);
        setDraftName(t.Name);
        setDraftStages(t.Stages.map(s => [...s.processes]));
        setView('edit');
    }
    const setProc = (si: number, pi: number, val: string) =>
        setDraftStages(prev => prev.map((s, i) => i === si ? s.map((p, j) => (j === pi ? val : p)) : s));
    const addProc = (si: number) =>
        setDraftStages(prev => prev.map((s, i) => (i === si ? [...s, ''] : s)));
    const removeProc = (si: number, pi: number) =>
        setDraftStages(prev => prev.map((s, i) => (i === si ? s.filter((_, j) => j !== pi) : s)));
    const addStage = () => setDraftStages(prev => [...prev, ['']]);
    const removeStage = (si: number) => setDraftStages(prev => prev.filter((_, i) => i !== si));
    const moveStage = (si: number, dir: -1 | 1) => setDraftStages(prev => {
        const to = si + dir;
        if (to < 0 || to >= prev.length) return prev;
        const next = [...prev];
        [next[si], next[to]] = [next[to], next[si]];
        return next;
    });

    async function handleSaveEdit() {
        if (!editTpl) return;
        setSaving(true);
        const res = await updateProcessStageTemplate(
            editTpl.Template_ID,
            { name: draftName, stages: draftStages.map(s => ({ processes: s })) },
            organizationId,
        );
        setSaving(false);
        if (res.success) {
            showToast(res.message, 'success');
            await load();
            setView('list'); setEditTpl(null);
        } else showToast(res.message, 'error');
    }

    const draftHasContent = draftStages.some(s => s.some(p => p.trim()));

    const title = view === 'save' ? 'Sačuvaj templejt plana'
        : view === 'edit' ? `Uredi templejt${editTpl ? ` · ${editTpl.Name}` : ''}`
            : 'Templejti plana procesa';

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="large"
            zIndex={zIndex}
            title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Bookmark size={18} style={{ color: 'var(--accent)' }} />
                    <span>{title}</span>
                </span>
            }
            footer={
                view === 'list' ? (
                    <>
                        <button className="btn btn-secondary" onClick={onClose}>Zatvori</button>
                        <button
                            className="btn btn-primary"
                            disabled={!hasCurrentPlan}
                            title={!hasCurrentPlan ? 'Trenutni plan je prazan' : ''}
                            onClick={() => { setSaveName(''); setView('save'); }}
                        >
                            <Plus size={15} /> Sačuvaj trenutni plan
                        </button>
                    </>
                ) : view === 'save' ? (
                    <>
                        <button className="btn btn-secondary" onClick={() => setView('list')} disabled={saving}>Nazad</button>
                        <button className="btn btn-primary" onClick={handleSaveNew} disabled={saving}>
                            <Save size={15} /> {saving ? 'Spremanje...' : 'Sačuvaj'}
                        </button>
                    </>
                ) : (
                    <>
                        <button className="btn btn-secondary" onClick={() => { setView('list'); setEditTpl(null); }} disabled={saving}>Odustani</button>
                        <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving || !draftName.trim() || !draftHasContent}
                            title={!draftHasContent ? 'Dodaj bar jedan proces' : ''}>
                            <Save size={15} /> {saving ? 'Spremanje...' : 'Sačuvaj izmjene'}
                        </button>
                    </>
                )
            }
        >
            {view === 'list' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 160 }}>
                    {loading ? (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>Učitavanje…</div>
                    ) : templates.length === 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '40px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <Bookmark size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 4 }} />
                            <h4 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>Nema templejta</h4>
                            <p style={{ margin: 0, fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>
                                Sačuvaj plan procesa koji često ponavljaš (npr. za kuhinje ili ormare), pa ga primijeni na drugi proizvod jednim klikom.
                            </p>
                        </div>
                    ) : (
                        templates.map(t => (
                            <div key={t.Template_ID} style={card}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {editingId === t.Template_ID ? (
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <input
                                                autoFocus
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') saveRename(t); }}
                                                style={{ flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent)', fontSize: 13 }}
                                            />
                                            <button style={iconBtn} onClick={() => saveRename(t)} title="Sačuvaj naziv"><Check size={14} /></button>
                                        </div>
                                    ) : (
                                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t.Name}</div>
                                    )}
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {previewStages(t.Stages)}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    {hasCurrentPlan && (
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            disabled={busyId === t.Template_ID}
                                            onClick={() => handleAppend(t)}
                                            title="Dodaj faze ovog šablona na kraj postojećeg plana (spajanje više šablona)"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                        >
                                            <Plus size={14} /> Dodaj u plan
                                        </button>
                                    )}
                                    <button
                                        className="btn btn-sm btn-primary"
                                        disabled={busyId === t.Template_ID}
                                        onClick={() => handleApply(t)}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                    >
                                        <Download size={14} /> {hasCurrentPlan ? 'Zamijeni' : 'Primijeni'}
                                    </button>
                                    <button style={iconBtn} title="Uredi templejt (faze i procesi)" onClick={() => openEditor(t)}>
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        style={{ ...iconBtn, color: 'var(--error)' }}
                                        title="Obriši"
                                        disabled={busyId === t.Template_ID}
                                        onClick={() => handleDelete(t)}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : view === 'save' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                            Trenutni plan koji se sprema
                        </label>
                        <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', border: '1px solid var(--border-light)', fontSize: 13, color: 'var(--text-primary)' }}>
                            {previewStages(currentStages.map(s => ({ processes: s })))}
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Naziv templejta *</label>
                        <input
                            type="text"
                            autoFocus
                            placeholder="npr. Kuhinja standard"
                            value={saveName}
                            onChange={e => setSaveName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && saveName.trim()) handleSaveNew(); }}
                        />
                    </div>
                </div>
            ) : (
                /* ── UREĐIVAČ: naziv + faze (unutar faze paralelno) ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label>Naziv templejta *</label>
                        <input type="text" autoFocus value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="npr. Kuhinja standard" />
                    </div>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <GitBranch size={14} style={{ color: 'var(--accent)' }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                                Faze — procesi u istoj fazi teku paralelno, faze idu redom
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto', paddingRight: 2 }}>
                            {draftStages.length === 0 && (
                                <div style={{ padding: '18px 14px', textAlign: 'center', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: 13 }}>
                                    Templejt je prazan — dodaj prvu fazu.
                                </div>
                            )}
                            {draftStages.map((stage, si) => (
                                <div key={si} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', padding: '10px 12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20,
                                            borderRadius: '50%', background: 'var(--accent-light)', color: 'var(--accent)', fontSize: 11, fontWeight: 800, flexShrink: 0,
                                        }}>{si + 1}</span>
                                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                            Faza {si + 1}
                                        </span>
                                        {stage.filter(p => p.trim()).length > 1 && (
                                            <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{stage.filter(p => p.trim()).length} paralelno</span>
                                        )}
                                        <div style={{ flex: 1 }} />
                                        <button style={iconBtn} title="Pomjeri gore" disabled={si === 0} onClick={() => moveStage(si, -1)}><ArrowUp size={13} /></button>
                                        <button style={iconBtn} title="Pomjeri dolje" disabled={si === draftStages.length - 1} onClick={() => moveStage(si, 1)}><ArrowDown size={13} /></button>
                                        <button style={{ ...iconBtn, color: 'var(--error)' }} title="Obriši fazu" onClick={() => removeStage(si)}><Trash2 size={13} /></button>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {stage.map((proc, pi) => (
                                            <div key={pi} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <input
                                                    list="pst-catalog"
                                                    value={proc}
                                                    placeholder="npr. Kantiranje"
                                                    onChange={e => setProc(si, pi, e.target.value)}
                                                    style={procInput}
                                                />
                                                <button style={{ ...iconBtn, width: 26, height: 26 }} title="Ukloni proces" onClick={() => removeProc(si, pi)}>
                                                    <X size={13} />
                                                </button>
                                            </div>
                                        ))}
                                        <button style={{ ...miniBtn, alignSelf: 'flex-start' }} onClick={() => addProc(si)}>
                                            <Plus size={12} /> Proces u ovu fazu
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <button className="btn btn-secondary btn-sm" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={addStage}>
                            <Plus size={14} /> Dodaj fazu
                        </button>
                    </div>

                    <datalist id="pst-catalog">
                        {catalogNames.map(n => <option key={n} value={n} />)}
                    </datalist>

                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                        Izmjene mijenjaju SAMO templejt — planovi proizvoda na koje je ranije primijenjen ostaju kakvi jesu.
                        Prazni procesi i faze se izbacuju pri spremanju.
                    </div>
                </div>
            )}
        </Modal>
    );
}
