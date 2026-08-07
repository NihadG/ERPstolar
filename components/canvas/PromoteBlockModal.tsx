'use client';

// ════════════════════════════════════════════════════════════════════
// PromoteBlockModal — „pretvori plan-blok u stvarnost".
//
// Nalog → PLANIRAN radni nalog (Na čekanju, nije pušten). Narudžba → Nacrt ili
// odmah Poslano (bira se ovdje). Prije potvrde: upozorenja o tome šta nedostaje,
// da korisnik zna šta dopunjuje kasnije. Ništa se ne dešava dok se ne klikne.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Package, ShoppingCart, AlertTriangle, Check, Loader2, Truck, FolderKanban } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { PlanBlock, Project, WorkOrder } from '@/lib/types';
import {
    promoteOrderBlock, promotePurchaseBlock,
    validateOrderBlock, validatePurchaseBlock, resolvePurchaseLines,
    type PromotionContext, type PurchaseChoice,
} from '@/lib/services';

interface PromoteBlockModalProps {
    block: PlanBlock | null;
    projects: Project[];
    workOrders: WorkOrder[];
    organizationId: string;
    onClose: () => void;
    /** Blok je pretvoren — pozivalac veže blok na stvarni entitet i restilira ga. */
    onPromoted: (result: { workOrderId?: string; orderId?: string }) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const money = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} KM`;
const dm = (iso: string) => {
    if (!iso) return '—';
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

export default function PromoteBlockModal({
    block, projects, workOrders, organizationId, onClose, onPromoted, showToast,
}: PromoteBlockModalProps) {
    const [busy, setBusy] = useState(false);
    const [choice, setChoice] = useState<PurchaseChoice>('draft');

    const ctx: PromotionContext = useMemo(() => ({ projects, workOrders }), [projects, workOrders]);
    const isPurchase = block?.kind === 'purchase';

    const issues = useMemo(() => {
        if (!block) return [];
        return isPurchase ? validatePurchaseBlock(block, ctx) : validateOrderBlock(block, ctx);
    }, [block, isPurchase, ctx]);

    const lines = useMemo(
        () => (block && isPurchase ? resolvePurchaseLines(block, ctx) : []),
        [block, isPurchase, ctx]
    );
    const linesTotal = lines.reduce((s, l) => s + l.expectedPrice, 0);

    if (!block) return null;

    const confirm = async () => {
        setBusy(true);
        try {
            const res = isPurchase
                ? await promotePurchaseBlock(block, choice, ctx, organizationId)
                : await promoteOrderBlock(block, ctx, organizationId);

            if (res.success) {
                showToast(res.message, 'success');
                onPromoted({ workOrderId: res.workOrderId, orderId: res.orderId });
                onClose();
            } else {
                showToast(res.message, 'error');
            }
        } finally {
            setBusy(false);
        }
    };

    const title = isPurchase
        ? <><ShoppingCart size={17} /> Naruči stvarno — „{block.title}"</>
        : <><Package size={17} /> Kreiraj stvarni nalog — „{block.title}"</>;

    return (
        <Modal
            isOpen={!!block}
            onClose={onClose}
            title={title}
            size="default"
            footer={
                <div className="cvp-foot">
                    <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Odustani</button>
                    <button className="btn btn-primary" onClick={confirm} disabled={busy}>
                        {busy ? <Loader2 size={14} className="cv-spin" /> : <Check size={14} />}
                        {isPurchase
                            ? (choice === 'send' ? 'Kreiraj i pošalji' : 'Kreiraj narudžbu (Nacrt)')
                            : 'Kreiraj planiran nalog'}
                    </button>
                </div>
            }
        >
            <div className="cvp-body">
                {/* ── Sažetak ─────────────────────────────────── */}
                {isPurchase ? (
                    <div className="cvp-summary">
                        <div className="cvp-row"><Truck size={13} /> Dobavljač: <strong>{block.supplierRef?.name || '—'}</strong></div>
                        {block.projectRef && (
                            <div className="cvp-row"><FolderKanban size={13} /> Projekt: <strong>{block.projectRef.name}</strong></div>
                        )}
                        <div className="cvp-row">Isporuka: <strong>{dm(block.endISO)}</strong></div>
                        <div className="cvp-row">
                            Stavki: <strong>{lines.length}</strong>
                            {lines.length > 0 && <> · <strong>{money(linesTotal)}</strong></>}
                        </div>
                        {lines.length > 0 && (
                            <ul className="cvp-lines">
                                {lines.slice(0, 6).map(l => (
                                    <li key={l.productMaterialId}>
                                        <span>{l.materialName}</span>
                                        <span className="cvp-line-qty">{l.quantity} {l.unit}</span>
                                    </li>
                                ))}
                                {lines.length > 6 && <li className="cvp-more">+ još {lines.length - 6}…</li>}
                            </ul>
                        )}
                    </div>
                ) : (
                    <div className="cvp-summary">
                        {block.projectRef && (
                            <div className="cvp-row"><FolderKanban size={13} /> Projekt: <strong>{block.projectRef.name}</strong></div>
                        )}
                        <div className="cvp-row">Početak: <strong>{dm(block.startISO)}</strong> · Rok: <strong>{dm(block.endISO)}</strong></div>
                        <div className="cvp-row">Proizvoda: <strong>{block.productRefs?.length || 0}</strong></div>
                        {(block.productRefs?.length || 0) > 0 && (
                            <ul className="cvp-lines">
                                {block.productRefs!.slice(0, 6).map((p, i) => (
                                    <li key={p.id || `${p.name}-${i}`}>
                                        <span>{p.name}</span>
                                        <span className="cvp-line-qty">{p.qty} kom</span>
                                    </li>
                                ))}
                                {(block.productRefs!.length) > 6 && <li className="cvp-more">+ još {block.productRefs!.length - 6}…</li>}
                            </ul>
                        )}
                        <p className="cvp-state">
                            Nastaje kao <strong>planiran nalog</strong> (Status „Na čekanju", zakazan za {dm(block.startISO)}).
                            Ne mijenja statuse proizvoda dok ga ne pustiš dugmetom „Pokreni" u nalozima.
                        </p>
                    </div>
                )}

                {/* ── Narudžba: Nacrt ili Pošalji ───────────────── */}
                {isPurchase && (
                    <div className="cvp-choice">
                        <label className={`cvp-opt${choice === 'draft' ? ' on' : ''}`}>
                            <input type="radio" name="cvp-choice" checked={choice === 'draft'}
                                onChange={() => setChoice('draft')} />
                            <div>
                                <strong>Sačuvaj kao Nacrt</strong>
                                <span>Materijali se ne mijenjaju. Šalješ je kasnije iz taba Narudžbe.</span>
                            </div>
                        </label>
                        <label className={`cvp-opt${choice === 'send' ? ' on' : ''}`}>
                            <input type="radio" name="cvp-choice" checked={choice === 'send'}
                                onChange={() => setChoice('send')} />
                            <div>
                                <strong>Kreiraj i pošalji odmah</strong>
                                <span>Materijali → „Naručeno", proizvod → „Materijali naručeni", projekt → „U proizvodnji".</span>
                            </div>
                        </label>
                    </div>
                )}

                {/* ── Upozorenja ────────────────────────────────── */}
                {issues.length > 0 && (
                    <ul className="cvp-issues">
                        {issues.map((it, i) => (
                            <li key={`${it.field}-${i}`}>
                                <AlertTriangle size={13} />
                                <span>{it.message}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Modal>
    );
}
