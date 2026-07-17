'use client';

// ════════════════════════════════════════════════════════════════════
// WIZARD KONSOLIDACIJE PROCESA — "Sredi duplikate"
// Skupi SVE nazive procesa organizacije (katalog, pravila, šabloni, planovi
// proizvoda, stavke i grafovi naloga), predloži spajanja (heuristika),
// korisnik pregleda/doradi grupe pa jednim klikom migrira CIJELU bazu:
// katalog se očisti, a svi planovi/nalozi/grafovi/dnevnici preimenuju
// (čvorovi grafa čuvaju ID → knjižen rad ostaje netaknut).
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import Modal from './Modal';
import {
    getProcessUsageData, applyProcessConsolidation, generateUUID,
    type ProcessUsageData,
} from '@/lib/services';
import {
    suggestConsolidationGroups, normKey, pickCanonical,
    type ProcessUsage,
} from '@/lib/processConsolidation';
import { Loader2, Check, X, Plus, Combine, Pencil, AlertTriangle, PackageOpen } from 'lucide-react';

interface Props {
    organizationId: string;
    onClose: () => void;
    onApplied?: () => void;   // pozivalac osvježava katalog/naloge nakon migracije
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    zIndex?: number;
}

interface WizGroup {
    id: string;
    canonical: string;
    memberKeys: string[];
    enabled: boolean;
    source: 'auto' | 'manual';
    confidence?: 'exact' | 'high' | 'medium';
}

const confLabel: Record<string, { label: string; color: string }> = {
    exact: { label: 'isti naziv', color: 'var(--success)' },
    high: { label: 'vrlo slično', color: 'var(--accent)' },
    medium: { label: 'slično — provjeri', color: 'var(--warning, #b45309)' },
};

export default function ProcessConsolidationWizard({ organizationId, onClose, onApplied, showToast, zIndex }: Props) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<ProcessUsageData | null>(null);
    const [groups, setGroups] = useState<WizGroup[]>([]);
    const [applying, setApplying] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [addingToId, setAddingToId] = useState<string | null>(null);
    const [addSearch, setAddSearch] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const d = await getProcessUsageData(organizationId);
                if (cancelled) return;
                setData(d);
                const suggested = suggestConsolidationGroups(d.usage);
                setGroups(suggested.map(s => ({
                    id: generateUUID(), canonical: s.canonical, memberKeys: s.memberKeys,
                    enabled: true, source: 'auto', confidence: s.confidence,
                })));
            } catch (e) {
                console.error('consolidation load', e);
                showToast('Greška pri učitavanju procesa', 'error');
            } finally { if (!cancelled) setLoading(false); }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [organizationId]);

    const usageByKey = useMemo(() => new Map((data?.usage || []).map(u => [u.key, u])), [data]);
    const groupedKeys = useMemo(() => new Set(groups.flatMap(g => g.memberKeys)), [groups]);
    const ungrouped = useMemo(
        () => (data?.usage || []).filter(u => !groupedKeys.has(u.key)),
        [data, groupedKeys]
    );

    const usageLine = (u?: ProcessUsage) => {
        if (!u) return '';
        const parts: string[] = [];
        if (u.counts.products) parts.push(`${u.counts.products} proizv.`);
        if (u.counts.orderItems) parts.push(`${u.counts.orderItems} stavki`);
        if (u.counts.orderGraphs) parts.push(`${u.counts.orderGraphs} graf`);
        if (u.counts.rules) parts.push(`${u.counts.rules} prav.`);
        if (u.counts.stageTemplates + u.counts.flowTemplates) parts.push(`${u.counts.stageTemplates + u.counts.flowTemplates} šabl.`);
        return parts.join(' · ') || 'bez upotrebe';
    };

    // ── Uređivanje grupa ──
    const removeMember = (groupId: string, key: string) => setGroups(prev => prev
        .map(g => g.id === groupId ? { ...g, memberKeys: g.memberKeys.filter(k => k !== key) } : g)
        .filter(g => g.memberKeys.length > 0));

    const addMember = (groupId: string, key: string) => {
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, memberKeys: [...g.memberKeys, key] } : g));
        setAddingToId(null); setAddSearch('');
    };

    const newGroup = () => {
        const g: WizGroup = { id: generateUUID(), canonical: '', memberKeys: [], enabled: true, source: 'manual' };
        setGroups(prev => [g, ...prev]);
        setAddingToId(g.id); setEditingId(g.id);
    };

    // Grupa je primjenjiva ako: ≥2 člana (spajanje) ILI 1 član čije se pisanje mijenja (rename/normalizacija).
    const isEffective = (g: WizGroup) => {
        const canonical = (g.canonical || '').trim();
        if (!canonical || g.memberKeys.length === 0) return false;
        if (g.memberKeys.length > 1) return true;
        const u = usageByKey.get(g.memberKeys[0]);
        return !!u && (u.displays.length > 1 || u.display !== canonical);
    };
    const effectiveGroups = groups.filter(g => g.enabled && isEffective(g));

    const totalImpact = useMemo(() => {
        let products = 0, orders = 0;
        for (const g of effectiveGroups) {
            for (const k of g.memberKeys) {
                const u = usageByKey.get(k);
                if (!u) continue;
                products += u.counts.products;
                orders += u.counts.orderItems + u.counts.orderGraphs;
            }
        }
        return { products, orders };
    }, [effectiveGroups, usageByKey]);

    const apply = async () => {
        if (!effectiveGroups.length || applying) return;
        const summary = effectiveGroups.map(g => `• ${g.memberKeys.map(k => usageByKey.get(k)?.display || k).join(' + ')} → "${g.canonical.trim()}"`).join('\n');
        if (typeof window !== 'undefined' && !window.confirm(
            `Primijeniti ${effectiveGroups.length} ${effectiveGroups.length === 1 ? 'grupu' : 'grupa'} na CIJELU bazu?\n\n${summary}\n\nMijenja: katalog, pravila, šablone, planove proizvoda, naloge i dnevnike rada. Knjižen rad se čuva.`
        )) return;
        setApplying(true);
        try {
            const payload = effectiveGroups.map(g => ({
                canonical: g.canonical.trim(),
                // svi display oblici svakog ključa — rename mapa pokriva svaku varijantu zapisa
                members: g.memberKeys.flatMap(k => usageByKey.get(k)?.displays || []),
            }));
            const res = await applyProcessConsolidation(payload, organizationId);
            if (res.success) {
                const s = res.stats;
                const bits = s ? [
                    s.catalogRemoved ? `katalog −${s.catalogRemoved}` : '',
                    s.catalogAdded ? `katalog +${s.catalogAdded}` : '',
                    s.productsUpdated ? `${s.productsUpdated} proizvoda` : '',
                    s.workOrdersUpdated ? `${s.workOrdersUpdated} naloga` : '',
                    s.workLogsUpdated ? `${s.workLogsUpdated} dnevnika` : '',
                ].filter(Boolean).join(', ') : '';
                showToast(`Procesi sređeni${bits ? ` (${bits})` : ''}`, 'success');
                onApplied?.();
                onClose();
            } else showToast(res.message, 'error');
        } finally { setApplying(false); }
    };

    const chip: React.CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px',
        borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
        background: 'var(--background)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="xl"
            zIndex={zIndex}
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Combine size={18} style={{ color: 'var(--accent)' }} /> Sredi duplikate procesa</span>}
            footer={<>
                <button className="btn btn-secondary" onClick={onClose} disabled={applying}>Otkaži</button>
                <button className="btn btn-primary" onClick={apply} disabled={applying || effectiveGroups.length === 0}>
                    {applying ? <Loader2 size={15} className="pcw-spin" /> : <Check size={15} />}
                    {applying ? ' Primjena…' : ` Primijeni (${effectiveGroups.length})`}
                </button>
            </>}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 320 }}>
                {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 60, color: 'var(--text-tertiary)' }}>
                        <Loader2 size={18} className="pcw-spin" /> Analiziram procese iz cijele baze…
                    </div>
                ) : !data ? null : (
                    <>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                Nađeno <strong>{data.usage.length}</strong> različitih naziva procesa.
                                Grupe ispod spajaju duplikate/slične u <strong>jedan proces</strong> — svuda: katalog, pravila,
                                planovi proizvoda, nalozi, grafovi i dnevnici. Knjižen rad i završeci se čuvaju.
                            </div>
                            <button className="btn btn-secondary" onClick={newGroup} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Plus size={15} /> Nova grupa
                            </button>
                        </div>

                        {groups.length === 0 && (
                            <div style={{ padding: '28px 16px', textAlign: 'center', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: 13 }}>
                                <Check size={20} style={{ color: 'var(--success)', display: 'block', margin: '0 auto 8px' }} />
                                Nema očitih duplikata. Za sinonime koje prepoznaješ samo ti (npr. „Okivanje" i
                                „Montaža okova") napravi grupu ručno preko <strong>Nova grupa</strong>.
                            </div>
                        )}

                        {/* Grupe */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {groups.map(g => {
                                const conf = g.confidence ? confLabel[g.confidence] : null;
                                const effective = isEffective(g);
                                return (
                                    <div key={g.id} style={{
                                        border: `1px solid ${g.enabled && effective ? 'var(--accent)' : 'var(--border-light)'}`,
                                        borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'var(--background)',
                                        opacity: g.enabled ? 1 : 0.55,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <input type="checkbox" checked={g.enabled}
                                                onChange={e => setGroups(prev => prev.map(x => x.id === g.id ? { ...x, enabled: e.target.checked } : x))} />
                                            {editingId === g.id ? (
                                                <input
                                                    autoFocus value={g.canonical}
                                                    placeholder="Kanonski naziv procesa…"
                                                    onChange={e => setGroups(prev => prev.map(x => x.id === g.id ? { ...x, canonical: e.target.value } : x))}
                                                    onBlur={() => setEditingId(null)}
                                                    onKeyDown={e => { if (e.key === 'Enter') setEditingId(null); }}
                                                    style={{ flex: 1, minWidth: 180, padding: '5px 9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent)', fontSize: 13.5, fontWeight: 700 }}
                                                />
                                            ) : (
                                                <button onClick={() => setEditingId(g.id)} title="Preimenuj kanonski naziv"
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: g.canonical ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                                                    {g.canonical || 'Bez naziva — klikni'}
                                                    <Pencil size={12} style={{ color: 'var(--text-tertiary)' }} />
                                                </button>
                                            )}
                                            {conf && <span style={{ fontSize: 10.5, fontWeight: 700, color: conf.color, border: `1px solid ${conf.color}`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>{conf.label}</span>}
                                            {!effective && g.enabled && (
                                                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    <AlertTriangle size={12} /> bez efekta — dodaj članove ili promijeni naziv
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                            {g.memberKeys.map(k => {
                                                const u = usageByKey.get(k);
                                                return (
                                                    <span key={k} style={chip} title={usageLine(u)}>
                                                        {u?.display || k}
                                                        <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: 10.5 }}>{usageLine(u)}</span>
                                                        <button onClick={() => removeMember(g.id, k)} title="Izbaci iz grupe"
                                                            style={{ display: 'flex', border: 'none', background: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0 }}>
                                                            <X size={12} />
                                                        </button>
                                                    </span>
                                                );
                                            })}
                                            {addingToId === g.id ? (
                                                <span style={{ position: 'relative' }}>
                                                    <input
                                                        autoFocus value={addSearch} placeholder="Traži proces…"
                                                        onChange={e => setAddSearch(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Escape') { setAddingToId(null); setAddSearch(''); } }}
                                                        style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent)', fontSize: 12, width: 170 }}
                                                    />
                                                    <span style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 24px var(--shadow-md)', maxHeight: 200, overflowY: 'auto', minWidth: 230, display: 'block' }}>
                                                        {ungrouped
                                                            .filter(u => u.display.toLowerCase().includes(addSearch.trim().toLowerCase()))
                                                            .slice(0, 12)
                                                            .map(u => (
                                                                <button key={u.key} onClick={() => addMember(g.id, u.key)}
                                                                    style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 12.5, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}>
                                                                    <span style={{ fontWeight: 600 }}>{u.display}</span>
                                                                    <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{usageLine(u)}</span>
                                                                </button>
                                                            ))}
                                                        {ungrouped.length === 0 && <span style={{ display: 'block', padding: '8px 10px', fontSize: 12, color: 'var(--text-tertiary)' }}>Svi procesi su u grupama</span>}
                                                    </span>
                                                </span>
                                            ) : (
                                                <button onClick={() => { setAddingToId(g.id); setAddSearch(''); }}
                                                    style={{ ...chip, border: '1px dashed var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                                    <Plus size={12} /> dodaj
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Samostalni procesi (referenca) */}
                        {ungrouped.length > 0 && (
                            <div>
                                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '4px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <PackageOpen size={13} /> Bez prijedloga ({ungrouped.length})
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {ungrouped.map(u => (
                                        <span key={u.key} style={{ ...chip, borderStyle: 'dashed', fontWeight: 500 }} title={usageLine(u)}>
                                            {u.display}
                                            <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: 10.5 }}>{usageLine(u)}</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {effectiveGroups.length > 0 && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
                                Primjena mijenja ~{totalImpact.products} planova proizvoda i ~{totalImpact.orders} zapisa u nalozima.
                                Kanonska imena se upisuju u katalog; stari duplikati iz kataloga se brišu.
                            </div>
                        )}
                    </>
                )}
            </div>
            <style jsx>{`.pcw-spin { animation: pcw-rot 0.8s linear infinite; } @keyframes pcw-rot { to { transform: rotate(360deg); } }`}</style>
        </Modal>
    );
}
