'use client';

// ════════════════════════════════════════════════════════════════════
// PromoteBlockModal — „pretvori plan-blok u stvarnost".
//
// Nalog → PLANIRAN radni nalog (Na čekanju, nije pušten). Narudžba → Nacrt ili
// odmah Poslano (bira se ovdje). Prije potvrde: upozorenja o tome šta nedostaje,
// da korisnik zna šta dopunjuje kasnije. Ništa se ne dešava dok se ne klikne.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { Package, ShoppingCart, AlertTriangle, Check, Loader2, Truck, FolderKanban, Wrench, ClipboardList, ArrowRight } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { PlanBlock, Project, WorkOrder } from '@/lib/types';
import {
    promotePurchaseBlock,
    validateOrderBlock, validatePurchaseBlock, resolvePurchaseLines,
    type PromotionContext, type PurchaseChoice,
} from '@/lib/services';

/** Tip stvarnog naloga koji se kreira iz nalog-bloka — isti izbor kao u tabu Nalozi. */
export type PromoteOrderType = 'production' | 'montaza' | 'zadaci';

interface PromoteBlockModalProps {
    block: PlanBlock | null;
    projects: Project[];
    workOrders: WorkOrder[];
    organizationId: string;
    onClose: () => void;
    /** Narudžba je pretvorena — pozivalac veže blok na stvarni Order i restilira ga. */
    onPromoted: (result: { workOrderId?: string; orderId?: string }) => void;
    /** Nalog-blok: korisnik je izabrao tip → pozivalac otvara pravi flow iz taba Nalozi. */
    onChooseType: (type: PromoteOrderType) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const ORDER_TYPE_OPTIONS: { key: PromoteOrderType; label: string; hint: string; icon: typeof Package }[] = [
    { key: 'production', label: 'Proizvodni nalog', hint: 'Proizvodi iz projekta — cijena iz ponude, procesi, ekipa, auto-rok.', icon: Package },
    { key: 'montaza', label: 'Montažni nalog', hint: 'Ugradnja spremnih proizvoda kod klijenta — koraci montaže i ekipa.', icon: Wrench },
    { key: 'zadaci', label: 'Razni posao', hint: 'Posao bez proizvoda iz baze (npr. palete, čišćenje) — slobodne stavke.', icon: ClipboardList },
];

const money = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} KM`;
const dm = (iso: string) => {
    if (!iso) return '—';
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

export default function PromoteBlockModal({
    block, projects, workOrders, organizationId, onClose, onPromoted, onChooseType, showToast,
}: PromoteBlockModalProps) {
    const [busy, setBusy] = useState(false);
    const [choice, setChoice] = useState<PurchaseChoice>('draft');
    const [orderType, setOrderType] = useState<PromoteOrderType>('production');

    // Podrazumijevani tip prati vrstu bloka: montaža-blok → montažni, ostalo → proizvodni.
    useEffect(() => {
        if (block) setOrderType(block.kind === 'montaza' ? 'montaza' : 'production');
    }, [block?.id, block?.kind]);

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

    // Narudžba se kreira ovdje (Order, po izboru odmah poslana). Nalog se OVDJE
    // samo bira po tipu — pravi nalog nastaje u punom obrascu iz taba Nalozi.
    const confirmPurchase = async () => {
        setBusy(true);
        try {
            const res = await promotePurchaseBlock(block, choice, ctx, organizationId);
            if (res.success) {
                showToast(res.message, 'success');
                onPromoted({ orderId: res.orderId });
                onClose();
            } else {
                showToast(res.message, 'error');
            }
        } finally {
            setBusy(false);
        }
    };

    const proceedOrder = () => {
        onChooseType(orderType);
        onClose();
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
                    {isPurchase ? (
                        <button className="btn btn-primary" onClick={confirmPurchase} disabled={busy}>
                            {busy ? <Loader2 size={14} className="cv-spin" /> : <Check size={14} />}
                            {choice === 'send' ? 'Kreiraj i pošalji' : 'Kreiraj narudžbu (Nacrt)'}
                        </button>
                    ) : (
                        <button className="btn btn-primary" onClick={proceedOrder}>
                            <ArrowRight size={14} /> Nastavi u kreiranje
                        </button>
                    )}
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
                    <>
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
                        </div>

                        {/* ── Koji tip naloga? (isti izbor kao u tabu Nalozi) ── */}
                        <div className="cvp-choice">
                            <p className="cvp-choice-lbl">Koji nalog kreirati?</p>
                            {ORDER_TYPE_OPTIONS.map(opt => {
                                const Icon = opt.icon;
                                return (
                                    <label key={opt.key} className={`cvp-opt${orderType === opt.key ? ' on' : ''}`}>
                                        <input type="radio" name="cvp-order-type" checked={orderType === opt.key}
                                            onChange={() => setOrderType(opt.key)} />
                                        <div>
                                            <strong><Icon size={13} /> {opt.label}</strong>
                                            <span>{opt.hint}</span>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        <p className="cvp-state">
                            Otvara se puni obrazac iz taba <strong>Nalozi</strong>, pre-popunjen iz bloka
                            (projekt, proizvodi, ekipa, rokovi). Nalog nastaje <strong>„Na čekanju"</strong> i
                            ne mijenja statuse proizvoda dok ga ne pustiš „Pokreni".
                        </p>
                    </>
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
