'use client';

// ════════════════════════════════════════════════════════════════════
// GENERIŠI PLANOVE PROCESA — za sve proizvode projekta odjednom.
// Keyword/rules (buildAutoPlan) instant; AI (Gemini) za proizvode bez
// prijedloga; pregled faza → primjena batch-om (bulkSaveProductProcessStages).
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import type { Project } from '@/lib/types';
import { getProcessMaterialRules, getProcessCatalog, getProcessStageTemplates, bulkSaveProductProcessStages } from '@/lib/services';
import { buildAutoPlan } from '@/lib/processAutoPlan';
import Modal from '@/components/ui/Modal';
import { Sparkles, Loader2, Bot } from 'lucide-react';

interface Props {
    project: Project;
    organizationId: string;
    onClose: () => void;
    onChanged: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface Row {
    productId: string;
    name: string;
    materialNames: string[];
    stages: string[][];
    source: 'rules' | 'ai' | 'none' | 'manual';
    included: boolean;
}

export default function BulkProcessPlanModal({ project, organizationId, onClose, onChanged, showToast }: Props) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [aiBusy, setAiBusy] = useState(false);
    const [rows, setRows] = useState<Row[]>([]);
    const [catalogNames, setCatalogNames] = useState<string[]>([]);
    const [templateInfo, setTemplateInfo] = useState<{ name?: string; stages?: string[][] } | null>(null);
    const [forceManual, setForceManual] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [rules, catalog, templates] = await Promise.all([
                    getProcessMaterialRules(organizationId), getProcessCatalog(organizationId), getProcessStageTemplates(organizationId),
                ]);
                if (cancelled) return;
                setCatalogNames(catalog.map(c => c.Name));
                if (templates.length === 1) setTemplateInfo({ name: templates[0].Name, stages: templates[0].Stages.map(s => s.processes) });
                const built: Row[] = (project.products || []).map(p => {
                    const materialNames = (p.materials || []).map(m => m.Material_Name).filter(Boolean);
                    if (p.Process_Plan_Source === 'manual' && (p.Process_Stages?.length || p.Process_Plan?.length)) {
                        return { productId: p.Product_ID, name: p.Name, materialNames, stages: (p.Process_Stages || []).map(s => s.processes), source: 'manual', included: false };
                    }
                    const r = buildAutoPlan((p.materials || []).map(m => ({ Material_Name: m.Material_Name })), rules, catalog, templates);
                    return { productId: p.Product_ID, name: p.Name, materialNames, stages: r.stages, source: r.source === 'rules' ? 'rules' : 'none', included: r.stages.length > 0 };
                });
                setRows(built);
            } catch (e) {
                console.error('BulkProcessPlanModal load', e);
                showToast('Greška pri učitavanju', 'error');
            } finally { if (!cancelled) setLoading(false); }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project.Project_ID, organizationId]);

    const noneRows = useMemo(() => rows.filter(r => r.source === 'none'), [rows]);
    const includedCount = rows.filter(r => r.included && r.stages.length > 0).length;

    const toggle = (productId: string) => setRows(rs => rs.map(r => r.productId === productId ? { ...r, included: !r.included } : r));

    async function runAI() {
        if (!noneRows.length || aiBusy) return;
        setAiBusy(true);
        try {
            const res = await fetch('/api/suggest-processes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    products: noneRows.map(r => ({ id: r.productId, name: r.name, materials: r.materialNames })),
                    catalog: catalogNames,
                    template: templateInfo || undefined,
                }),
            });
            const data = await res.json();
            if (!data.success) { showToast(data.error || 'AI nije uspio', 'error'); return; }
            const byId = new Map<string, string[][]>((data.suggestions || []).map((s: { id: string; stages: string[][] }) => [s.id, s.stages]));
            setRows(rs => rs.map(r => byId.has(r.productId) ? { ...r, stages: byId.get(r.productId)!, source: 'ai', included: true } : r));
            const got = data.suggestions?.length || 0;
            showToast(got ? `AI predložio ${got} planova` : 'AI nije predložio nijedan plan', got ? 'success' : 'info');
        } catch (e) {
            console.error('runAI', e); showToast('Greška pri AI prijedlogu', 'error');
        } finally { setAiBusy(false); }
    }

    async function apply() {
        const updates = rows.filter(r => r.included && r.stages.length > 0 && r.source !== 'manual')
            .map(r => ({ productId: r.productId, stages: r.stages.map(s => ({ processes: s })), source: (r.source === 'ai' ? 'ai' : 'auto') as 'auto' | 'ai' }));
        if (!updates.length) { showToast('Ništa za primjenu', 'info'); return; }
        setSaving(true);
        try {
            const res = await bulkSaveProductProcessStages(project.Project_ID, updates, organizationId);
            if (res.success) { showToast(res.message, 'success'); onChanged(); onClose(); }
            else showToast(res.message, 'error');
        } finally { setSaving(false); }
    }

    const sourceBadge = (s: Row['source']) => {
        const map = { rules: ['Auto', '#0071e3'], ai: ['AI', '#7c3aed'], none: ['Bez prijedloga', '#94a3b8'], manual: ['Ručno — preskočeno', '#64748b'] } as const;
        const [label, color] = map[s];
        return <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}18`, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{label}</span>;
    };

    const visibleRows = forceManual ? rows : rows.filter(r => r.source !== 'manual');

    return (
        <Modal isOpen onClose={onClose} size="large"
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Sparkles size={18} /> Generiši planove procesa — {project.Name || project.Client_Name}</span>}
            footer={<>
                <button className="btn btn-secondary" onClick={onClose}>Zatvori</button>
                {noneRows.length > 0 && (
                    <button className="btn btn-secondary" disabled={aiBusy} onClick={runAI} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {aiBusy ? <Loader2 size={15} className="spin" /> : <Bot size={15} />} AI za preostale ({noneRows.length})
                    </button>
                )}
                <button className="btn btn-primary" disabled={saving || includedCount === 0} onClick={apply}>
                    {saving ? 'Primjena…' : `Primijeni (${includedCount})`}
                </button>
            </>}>
            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Učitavanje…</div>
            ) : rows.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>Projekat nema proizvoda.</div>
            ) : (
                <div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                        Plan se izvodi iz materijala (pravila + tipovi + kombinacije){templateInfo ? `, mapirano na šablon „${templateInfo.name}"` : ''}. Proizvodi bez sastavnice → koristi AI.
                    </div>
                    {rows.some(r => r.source === 'manual') && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 10, cursor: 'pointer' }}>
                            <input type="checkbox" checked={forceManual} onChange={e => setForceManual(e.target.checked)} /> prikaži i ručno uređene (preskaču se osim ako ih uključiš)
                        </label>
                    )}
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                        {visibleRows.map((r, i) => (
                            <div key={r.productId} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderBottom: i < visibleRows.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 ? '#fafafa' : 'white' }}>
                                <input type="checkbox" checked={r.included} disabled={r.stages.length === 0}
                                    onChange={() => toggle(r.productId)} style={{ marginTop: 4 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                                        {sourceBadge(r.source)}
                                    </div>
                                    {r.stages.length > 0 ? (
                                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                                            {r.stages.map((st, si) => (
                                                <span key={si} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    {si > 0 && <span style={{ color: '#cbd5e1' }}>→</span>}
                                                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#eef2ff', color: '#3730a3' }}>{st.join(' + ')}</span>
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                                            bez prijedloga — dodaj pravila/materijale ili koristi AI
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <style jsx>{`.spin { animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </Modal>
    );
}
