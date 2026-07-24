'use client';

// ════════════════════════════════════════════════════════════════════
// PREGLED „UTIČE LI NA PROFIT?" — kad promjena cijene/materijala dira osnovicu
// profita proizvodnih naloga. Po projektu biraš uključi/ostavi. Uključeni →
// osnovica se pomjeri za Δ TE izmjene; ostavljeni ostaju netaknuti (snapshot).
// Vidi lib/profitBasis.ts (delta-model: „odbijeno ostaje odbijeno").
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import type { ProjectBasisReview, BasisReviewItem } from '@/lib/profitBasis';

interface Props {
    review: ProjectBasisReview[];
    /** Naziv materijala/izmjene (za naslov). */
    changeLabel?: string;
    /** Alternativni uvodni tekst (npr. za badge „profit zastario" → sinhronizacija na trenutno). */
    intro?: string;
    /** Tekst primarnog dugmeta (default „Primijeni odabrano"). */
    applyLabel?: string;
    onClose: () => void;
    onApply: (approvedItems: BasisReviewItem[]) => Promise<void> | void;
}

export default function ProfitBasisReviewModal({ review, changeLabel, intro, applyLabel, onClose, onApply }: Props) {
    // Podrazumijevano SVE uključeno (izmjena je najčešće stvarna) — lako se isključi po projektu.
    const [included, setIncluded] = useState<Set<string>>(() => new Set(review.map(r => r.projectId || r.projectName)));
    const [busy, setBusy] = useState(false);

    const keyOf = (r: ProjectBasisReview) => r.projectId || r.projectName;
    const toggle = (k: string) => setIncluded(prev => {
        const next = new Set(prev);
        next.has(k) ? next.delete(k) : next.add(k);
        return next;
    });

    const selectedRows = review.filter(r => included.has(keyOf(r)));
    const approvedItems: BasisReviewItem[] = selectedRows.flatMap(r => r.items);
    const totalProfitDelta = selectedRows.reduce((s, r) => s + r.profitDelta, 0);

    const apply = async () => {
        setBusy(true);
        try { await onApply(approvedItems); }
        finally { setBusy(false); }
    };

    return (
        <>
            <div className="pbr-overlay" onClick={busy ? undefined : onClose} />
            <div className="pbr-modal" role="dialog" aria-modal="true">
                <div className="pbr-head">
                    <div className="pbr-title">
                        <span className="material-icons-round">query_stats</span>
                        <div>
                            <h3>Utiče li ovo na profit?</h3>
                            <p>{intro ? intro : <>{changeLabel ? <>Izmjena: <b>{changeLabel}</b>. </> : null}Ovi projekti u proizvodnji mijenjaju osnovicu profita. Odaberi šta uključiti — ostatak ostaje netaknut.</>}</p>
                        </div>
                    </div>
                </div>

                <div className="pbr-body">
                    {review.map(r => {
                        const k = keyOf(r);
                        const on = included.has(k);
                        const worse = r.profitDelta < 0;
                        return (
                            <label key={k} className={`pbr-row${on ? ' on' : ''}`}>
                                <input type="checkbox" checked={on} onChange={() => toggle(k)} disabled={busy} />
                                <div className="pbr-proj">
                                    <span className="pbr-proj-name">{r.projectName}</span>
                                    {r.productNames.length > 0 && (
                                        <span className="pbr-proj-prod" title={r.productNames.join(', ')}>{r.productNames.join(', ')}</span>
                                    )}
                                </div>
                                <div className="pbr-delta">
                                    <span className="pbr-mat">materijal {r.materialDelta >= 0 ? '+' : ''}{formatCurrency(r.materialDelta)}</span>
                                    <span className={`pbr-profit ${worse ? 'neg' : 'pos'}`}>profit {r.profitDelta >= 0 ? '+' : ''}{formatCurrency(r.profitDelta)}</span>
                                </div>
                            </label>
                        );
                    })}
                </div>

                <div className="pbr-foot">
                    <div className="pbr-sum">
                        {approvedItems.length > 0 ? (
                            <>Efekat na profit: <b className={totalProfitDelta < 0 ? 'neg' : 'pos'}>{totalProfitDelta >= 0 ? '+' : ''}{formatCurrency(totalProfitDelta)}</b> · {selectedRows.length} {selectedRows.length === 1 ? 'projekat' : 'projekta'}</>
                        ) : (
                            <span className="muted">Ništa nije odabrano — profit ostaje nepromijenjen.</span>
                        )}
                    </div>
                    <div className="pbr-actions">
                        <button className="pbr-btn ghost" onClick={onClose} disabled={busy}>Ostavi sve</button>
                        <button className="pbr-btn primary" onClick={apply} disabled={busy || approvedItems.length === 0}>
                            {busy ? 'Primjenjujem…' : `${applyLabel || 'Primijeni odabrano'}${approvedItems.length ? ` (${selectedRows.length})` : ''}`}
                        </button>
                    </div>
                </div>
            </div>

            <style jsx>{`
                .pbr-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); z-index: 1000; backdrop-filter: blur(2px); }
                .pbr-modal {
                    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    width: min(560px, calc(100vw - 32px)); max-height: min(80vh, 720px);
                    background: var(--bg-card, #fff); border-radius: 16px; z-index: 1001;
                    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28); display: flex; flex-direction: column; overflow: hidden;
                }
                .pbr-head { padding: 20px 22px 14px; border-bottom: 1px solid var(--border, #eef0f3); }
                .pbr-title { display: flex; gap: 12px; align-items: flex-start; }
                .pbr-title > .material-icons-round { font-size: 24px; color: var(--accent, #0071e3); margin-top: 2px; }
                .pbr-title h3 { margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary, #111827); }
                .pbr-title p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary, #6b7280); }
                .pbr-body { padding: 8px 12px; overflow-y: auto; flex: 1; }
                .pbr-row {
                    display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 10px;
                    cursor: pointer; transition: background 0.15s; border: 1px solid transparent;
                }
                .pbr-row:hover { background: var(--bg-hover, #f8fafc); }
                .pbr-row.on { background: var(--accent-light, #eff6ff); border-color: #dbeafe; }
                .pbr-row input { width: 18px; height: 18px; cursor: pointer; accent-color: var(--accent, #0071e3); flex-shrink: 0; }
                .pbr-proj { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
                .pbr-proj-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary, #1f2937); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .pbr-proj-prod { font-size: 11.5px; color: var(--text-secondary, #9ca3af); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .pbr-delta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
                .pbr-mat { font-size: 11.5px; color: var(--text-secondary, #9ca3af); }
                .pbr-profit { font-size: 13px; font-weight: 700; }
                .pbr-profit.neg { color: var(--error, #ef4444); }
                .pbr-profit.pos { color: var(--success, #16a34a); }
                .pbr-foot { padding: 14px 20px; border-top: 1px solid var(--border, #eef0f3); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
                .pbr-sum { font-size: 12.5px; color: var(--text-secondary, #6b7280); }
                .pbr-sum b.neg { color: var(--error, #ef4444); }
                .pbr-sum b.pos { color: var(--success, #16a34a); }
                .pbr-sum .muted { color: var(--text-tertiary, #9ca3af); }
                .pbr-actions { display: flex; gap: 8px; margin-left: auto; }
                .pbr-btn { padding: 9px 16px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; }
                .pbr-btn.ghost { background: transparent; border-color: var(--border, #e5e7eb); color: var(--text-secondary, #6b7280); }
                .pbr-btn.ghost:hover:not(:disabled) { background: var(--bg-hover, #f8fafc); color: var(--text-primary, #374151); }
                .pbr-btn.primary { background: var(--accent, #0071e3); color: #fff; }
                .pbr-btn.primary:hover:not(:disabled) { filter: brightness(1.05); }
                .pbr-btn:disabled { opacity: 0.5; cursor: default; }
            `}</style>
        </>
    );
}
