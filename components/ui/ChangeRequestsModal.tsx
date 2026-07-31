'use client';

// ════════════════════════════════════════════════════════════════════
// PRIJEDLOZI RADNIKA — odobravanje (desktop, vlasnik)
//
// Grupisano po radniku. Za svaki prijedlog: Potvrdi / Odbij, a za materijalne
// vrste „Prilagodi i potvrdi" (uređivanje količina i cijena prije primjene) /
// „Kreiraj narudžbu". Nenovčano i zatvaranja primjenjuje server (approve);
// materijalne vrste se primijene ovdje (kroz gejt osnovice) pa zatvore (resolve).
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Trash2, ChevronRight, Hourglass } from 'lucide-react';
import { useApproverRequests } from '@/lib/useApproverRequests';
import { needsDesktopApply, requestKindLabel } from '@/lib/changeRequests';
import type { MaterialUsagePayload } from '@/lib/changeRequests';
import { applyMaterialUsage, applyMaterialOrder, type AdjustedUsageLine } from '@/lib/changeRequestApply';
import type { ChangeRequest } from '@/lib/types';
import './ChangeRequestsModal.css';

interface Props {
    organizationId: string;
    onClose: () => void;
    onChanged?: () => void;
}

export default function ChangeRequestsModal({ organizationId, onClose, onChanged }: Props) {
    const { requests, approve, reject, resolve } = useApproverRequests(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [rejectId, setRejectId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [adjustId, setAdjustId] = useState<string | null>(null);
    const [adjustLines, setAdjustLines] = useState<AdjustedUsageLine[]>([]);
    const [err, setErr] = useState<string | null>(null);

    const groups = useMemo(() => {
        const byWorker = new Map<string, ChangeRequest[]>();
        for (const r of requests) {
            const key = r.Created_By_Name || 'Radnik';
            const arr = byWorker.get(key) || [];
            arr.push(r);
            byWorker.set(key, arr);
        }
        return [...byWorker.entries()].map(([worker, reqs]) => ({ worker, reqs }));
    }, [requests]);

    const run = async (id: string, fn: () => Promise<void>) => {
        setBusyId(id); setErr(null);
        try {
            await fn();
            onChanged?.();
            setRejectId(null); setRejectReason(''); setAdjustId(null);
        } catch (e: any) {
            setErr(e?.message || 'Radnja nije uspjela.');
        } finally {
            setBusyId(null);
        }
    };

    const openAdjust = (req: ChangeRequest) => {
        const payload = req.Payload as MaterialUsagePayload;
        setAdjustLines((payload.lines || []).map(l => ({
            materialId: l.materialId, name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: 0,
        })));
        setAdjustId(req.Request_ID);
        setErr(null);
    };

    const modal = (
        <div className="crm-backdrop" onClick={onClose}>
            <div className="crm-panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Prijedlozi radnika">
                <div className="crm-head">
                    <div className="crm-head-title">
                        <h3>Prijedlozi radnika</h3>
                        {requests.length > 0 && <span className="crm-count">{requests.length}</span>}
                    </div>
                    <button type="button" className="crm-close" onClick={onClose} aria-label="Zatvori"><X size={18} /></button>
                </div>

                {err && <div className="crm-err">{err}</div>}

                <div className="crm-body">
                    {requests.length === 0 ? (
                        <div className="crm-empty">
                            <Check size={44} strokeWidth={1.4} />
                            <p>Nema prijedloga na čekanju.</p>
                        </div>
                    ) : (
                        groups.map(group => (
                            <div key={group.worker} className="crm-group">
                                <div className="crm-group-head">{group.worker}</div>
                                {group.reqs.map(req => {
                                    const desktop = needsDesktopApply(req.Kind);
                                    const isAdjusting = adjustId === req.Request_ID;
                                    const isRejecting = rejectId === req.Request_ID;
                                    const busy = busyId === req.Request_ID;
                                    return (
                                        <div key={req.Request_ID} className="crm-row">
                                            <div className="crm-row-main">
                                                <span className="crm-kind">{requestKindLabel(req.Kind)}</span>
                                                <span className="crm-summary">{req.Summary}</span>
                                                {req.Work_Order_Name && <span className="crm-meta">{req.Work_Order_Name}</span>}
                                            </div>

                                            {isAdjusting ? (
                                                <div className="crm-adjust">
                                                    {adjustLines.map((l, i) => (
                                                        <div key={i} className="crm-adjust-row">
                                                            <span className="crm-adjust-name">{l.name}</span>
                                                            <input className="crm-num" type="number" min="0" step="0.1" value={String(l.quantity)}
                                                                onChange={e => setAdjustLines(prev => prev.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))}
                                                                aria-label="Količina" />
                                                            <span className="crm-x">×</span>
                                                            <input className="crm-num" type="number" min="0" step="0.01" placeholder="cijena" value={l.unitPrice ? String(l.unitPrice) : ''}
                                                                onChange={e => setAdjustLines(prev => prev.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) } : x))}
                                                                aria-label="Cijena" />
                                                            <span className="crm-km">KM</span>
                                                            <button type="button" className="crm-iconbtn" aria-label="Ukloni"
                                                                onClick={() => setAdjustLines(prev => prev.filter((_, j) => j !== i))}>
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <div className="crm-actions">
                                                        <button type="button" className="crm-btn" onClick={() => setAdjustId(null)} disabled={busy}>Odustani</button>
                                                        <button type="button" className="crm-btn primary" disabled={busy || adjustLines.length === 0}
                                                            onClick={() => run(req.Request_ID, async () => {
                                                                await applyMaterialUsage(organizationId, req.Product_ID!, adjustLines);
                                                                await resolve(req.Request_ID, { lines: adjustLines });
                                                            })}>
                                                            {busy ? '…' : 'Primijeni i potvrdi'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : isRejecting ? (
                                                <div className="crm-adjust">
                                                    <input className="crm-reason" placeholder="Razlog (nije obavezno)" value={rejectReason}
                                                        onChange={e => setRejectReason(e.target.value)} autoFocus />
                                                    <div className="crm-actions">
                                                        <button type="button" className="crm-btn" onClick={() => { setRejectId(null); setRejectReason(''); }} disabled={busy}>Nazad</button>
                                                        <button type="button" className="crm-btn danger" disabled={busy}
                                                            onClick={() => run(req.Request_ID, () => reject(req.Request_ID, rejectReason.trim() || undefined))}>
                                                            {busy ? '…' : 'Odbij'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="crm-actions">
                                                    <button type="button" className="crm-btn ghost" onClick={() => setRejectId(req.Request_ID)} disabled={busy}>Odbij</button>
                                                    {req.Kind === 'material_usage' && (
                                                        <button type="button" className="crm-btn primary" onClick={() => openAdjust(req)} disabled={busy}>Prilagodi i potvrdi</button>
                                                    )}
                                                    {req.Kind === 'material_order' && (
                                                        <button type="button" className="crm-btn primary" disabled={busy}
                                                            onClick={() => run(req.Request_ID, async () => {
                                                                const nums = await applyMaterialOrder(organizationId, req);
                                                                await resolve(req.Request_ID, { orderNumbers: nums });
                                                            })}>
                                                            {busy ? '…' : 'Kreiraj narudžbu'} <ChevronRight size={14} />
                                                        </button>
                                                    )}
                                                    {!desktop && (
                                                        <button type="button" className="crm-btn primary" disabled={busy}
                                                            onClick={() => run(req.Request_ID, () => approve(req.Request_ID))}>
                                                            {busy ? '…' : 'Potvrdi'}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>

                <div className="crm-foot">
                    <Hourglass size={13} /> Radnik vidi status svakog prijedloga na svom telefonu.
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(modal, document.body);
}
