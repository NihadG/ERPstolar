'use client';

// ════════════════════════════════════════════════════════════════════
// ŠTA NEDOSTAJE — jedan modal umjesto šest obavijesti
//
// Otvara se iz zvona (jedna stavka „Nedostaje podataka — N"). Nabraja sve
// nedostatke grupisano po vrsti; teži prvi. Gdje postoji prava popravka
// (trošak materijala) — unos je tu, inline. Ostalo vodi na pravi tab.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, DollarSign, ChevronRight, CheckCircle, AlertOctagon, AlertTriangle } from 'lucide-react';
import { setManualMaterialCost } from '@/lib/services';
import { groupDataGaps, type DataGap } from '@/lib/insights/dataGaps';
import './DataGapsModal.css';

interface Props {
    gaps: DataGap[];
    organizationId: string;
    onClose: () => void;
    onNavigate: (tab: string) => void;
    /** Materijal je dobio cijenu — roditelj može skinuti taj gap iz brojača. */
    onResolved?: (gapId: string) => void;
}

export default function DataGapsModal({ gaps, organizationId, onClose, onNavigate, onResolved }: Props) {
    const [resolved, setResolved] = useState<Set<string>>(new Set());
    const [costEntryId, setCostEntryId] = useState<string | null>(null);
    const [costValue, setCostValue] = useState('');
    const [saving, setSaving] = useState(false);

    const visible = useMemo(() => gaps.filter(g => !resolved.has(g.id)), [gaps, resolved]);
    const groups = useMemo(() => groupDataGaps(visible), [visible]);

    const navigate = (tab: string) => {
        onClose();
        window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab } }));
        onNavigate(tab);
    };

    const saveCost = async (gap: DataGap) => {
        const cost = parseFloat(costValue);
        if (!cost || cost <= 0 || gap.fix?.kind !== 'material-cost') return;
        setSaving(true);
        try {
            const res = await setManualMaterialCost(gap.fix.workOrderItemId, cost, organizationId, true);
            if (res.success) {
                setResolved(prev => new Set(prev).add(gap.id));
                setCostEntryId(null);
                setCostValue('');
                onResolved?.(gap.id);
            } else {
                alert(res.message);
            }
        } catch (e) {
            console.error('Trošak materijala nije spremljen:', e);
            alert('Greška pri spremanju troška materijala.');
        } finally {
            setSaving(false);
        }
    };

    const modal = (
        <div className="dgm-backdrop" onClick={onClose}>
            <div className="dgm-panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Šta nedostaje">
                <div className="dgm-head">
                    <div className="dgm-head-title">
                        <h3>Šta nedostaje</h3>
                        {visible.length > 0 && <span className="dgm-count">{visible.length}</span>}
                    </div>
                    <button type="button" className="dgm-close" onClick={onClose} aria-label="Zatvori">
                        <X size={18} />
                    </button>
                </div>

                <div className="dgm-body">
                    {visible.length === 0 ? (
                        <div className="dgm-empty">
                            <CheckCircle size={44} strokeWidth={1.4} />
                            <p>Sve je popunjeno. Nema nedostataka.</p>
                        </div>
                    ) : (
                        groups.map(group => (
                            <div key={group.kind} className="dgm-group">
                                <div className="dgm-group-head">
                                    {group.severity === 'high'
                                        ? <AlertOctagon size={15} className="dgm-sev-high" />
                                        : <AlertTriangle size={15} className="dgm-sev-med" />}
                                    <span className="dgm-group-title">{group.title}</span>
                                    <span className="dgm-group-n">{group.gaps.length}</span>
                                </div>

                                {group.gaps.map(gap => (
                                    <div key={gap.id} className="dgm-row">
                                        <div className="dgm-row-main">
                                            <span className="dgm-row-label">{gap.label}</span>
                                            <span className="dgm-row-detail">{gap.detail}</span>

                                            {gap.fix?.kind === 'material-cost' && costEntryId === gap.id && (
                                                <div className="dgm-cost-form" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        type="number" min="0" step="0.01" autoFocus
                                                        placeholder="Procijenjeni trošak"
                                                        value={costValue}
                                                        onChange={e => setCostValue(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') saveCost(gap);
                                                            if (e.key === 'Escape') setCostEntryId(null);
                                                        }}
                                                    />
                                                    <span className="dgm-cost-unit">KM</span>
                                                    <button
                                                        type="button" className="dgm-cost-save"
                                                        onClick={() => saveCost(gap)}
                                                        disabled={saving || !costValue || parseFloat(costValue) <= 0}
                                                    >
                                                        {saving ? '…' : 'Spremi'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="dgm-row-actions">
                                            {gap.fix?.kind === 'material-cost' && costEntryId !== gap.id && (
                                                <button type="button" className="dgm-btn primary" onClick={() => { setCostEntryId(gap.id); setCostValue(''); }}>
                                                    <DollarSign size={13} /> Unesi trošak
                                                </button>
                                            )}
                                            <button type="button" className="dgm-btn" onClick={() => navigate(gap.targetTab)}>
                                                Otvori <ChevronRight size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(modal, document.body);
}
