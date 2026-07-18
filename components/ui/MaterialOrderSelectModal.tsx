'use client';

// ════════════════════════════════════════════════════════════════════
// IZBOR NARUDŽBI MATERIJALA — otvara se poslije kreiranja radnog naloga
// (ako je korisnik ostavio čekiranu opciju u wizardu). Prije se ovdje
// TIHO kreirala po jedna narudžba za svakog dobavljača sa nedostajućim
// materijalom — korisnik nije imao priliku da odluči.
//
// Sada: prikaže se PLAN (buildMaterialOrderPlan — čisto čitanje, ništa
// nije upisano), grupisan po dobavljaču. Korisnik čekira dobavljače i/ili
// pojedinačne materijale, pa potvrdi — tek TADA se narudžbe kreiraju
// (createSelectedMaterialOrders), samo za ono što je izabrano.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { Check, Package, ShoppingCart, Loader2, Truck } from 'lucide-react';
import Modal from './Modal';
import { formatCurrency } from '@/lib/utils';
import type { MaterialOrderPlanGroup } from '@/lib/services';
import './MaterialOrderSelectModal.css';

interface MaterialOrderSelectModalProps {
    isOpen: boolean;
    onClose: () => void;
    workOrderId: string;
    workOrderLabel: string;
    plannedStartDate: string;
    organizationId: string;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function MaterialOrderSelectModal({
    isOpen, onClose, workOrderId, workOrderLabel, plannedStartDate, organizationId, onRefresh, showToast,
}: MaterialOrderSelectModalProps) {
    const [loading, setLoading] = useState(true);
    const [groups, setGroups] = useState<MaterialOrderPlanGroup[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [creating, setCreating] = useState(false);

    // Učitaj plan pri otvaranju — SVI materijali su čekirani na startu (isto
    // pokriće kao stari "auto" tok), korisnik onda SVJESNO isključi šta ne želi.
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoading(true);
        import('@/lib/services').then(({ buildMaterialOrderPlan }) => buildMaterialOrderPlan(workOrderId, organizationId))
            .then(plan => {
                if (cancelled) return;
                setGroups(plan);
                const all = new Set<string>();
                plan.forEach(g => g.materials.forEach(m => all.add(m.productMaterialId)));
                setSelected(all);
            })
            .catch(() => { if (!cancelled) showToast('Greška pri učitavanju materijala za narudžbu', 'error'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, workOrderId, organizationId]);

    const groupState = (g: MaterialOrderPlanGroup): 'all' | 'some' | 'none' => {
        const ids = g.materials.map(m => m.productMaterialId);
        const on = ids.filter(id => selected.has(id)).length;
        return on === 0 ? 'none' : on === ids.length ? 'all' : 'some';
    };

    const toggleMaterial = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const toggleGroup = (g: MaterialOrderPlanGroup) => {
        const state = groupState(g);
        setSelected(prev => {
            const next = new Set(prev);
            const ids = g.materials.map(m => m.productMaterialId);
            if (state === 'all') ids.forEach(id => next.delete(id));
            else ids.forEach(id => next.add(id));
            return next;
        });
    };

    const totals = useMemo(() => {
        let materialCount = 0, supplierCount = 0, sum = 0;
        for (const g of groups) {
            const sel = g.materials.filter(m => selected.has(m.productMaterialId));
            if (sel.length === 0) continue;
            supplierCount++;
            materialCount += sel.length;
            sum += sel.reduce((s, m) => s + m.quantity * m.unitPrice, 0);
        }
        return { materialCount, supplierCount, sum };
    }, [groups, selected]);

    const groupSubtotal = (g: MaterialOrderPlanGroup) =>
        g.materials.filter(m => selected.has(m.productMaterialId)).reduce((s, m) => s + m.quantity * m.unitPrice, 0);

    const handleConfirm = async () => {
        if (selected.size === 0 || creating) return;
        setCreating(true);
        try {
            const { createSelectedMaterialOrders } = await import('@/lib/services');
            const res = await createSelectedMaterialOrders(workOrderId, plannedStartDate, Array.from(selected), organizationId);
            if (res.ordersCreated > 0) {
                showToast(`Kreirano ${res.ordersCreated} ${res.ordersCreated === 1 ? 'narudžba' : 'narudžbi'} (${res.orderNumbers.join(', ')})`, 'success');
                onRefresh('orders');
            } else {
                showToast('Nijedna narudžba nije kreirana — materijali su u međuvremenu pokriveni', 'info');
            }
            onClose();
        } catch {
            showToast('Greška pri kreiranju narudžbi', 'error');
        } finally {
            setCreating(false);
        }
    };

    const allEmpty = !loading && groups.length === 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="large"
            title={
                <span className="mos-title">
                    <ShoppingCart size={18} /> Narudžbe materijala
                    <span className="mos-title-sub">{workOrderLabel}</span>
                </span>
            }
            footer={
                loading || allEmpty ? (
                    <button className="btn btn-secondary" onClick={onClose}>Zatvori</button>
                ) : (
                    <div className="mos-foot">
                        <span className="mos-foot-sum">
                            {totals.materialCount === 0
                                ? 'Ništa nije izabrano'
                                : <>{totals.materialCount} {totals.materialCount === 1 ? 'materijal' : 'materijala'} · {totals.supplierCount} {totals.supplierCount === 1 ? 'dobavljač' : 'dobavljača'} · <strong>{formatCurrency(totals.sum)}</strong></>}
                        </span>
                        <div className="mos-foot-btns">
                            <button className="btn btn-secondary" onClick={onClose} disabled={creating}>Preskoči</button>
                            <button className="btn btn-primary" onClick={handleConfirm} disabled={totals.supplierCount === 0 || creating}>
                                {creating ? <Loader2 size={15} className="mos-spin" /> : <ShoppingCart size={15} />}
                                {creating ? 'Kreiranje…' : `Kreiraj narudžbe (${totals.supplierCount})`}
                            </button>
                        </div>
                    </div>
                )
            }
        >
            <div className="mos">
                {loading ? (
                    <div className="mos-loading"><Loader2 size={20} className="mos-spin" /> Provjeravam nedostajuće materijale…</div>
                ) : allEmpty ? (
                    <div className="mos-empty">
                        <Package size={32} />
                        <p>Svi materijali za ovaj nalog su već na stanju, naručeni ili primljeni.<br />Nema šta naručiti.</p>
                    </div>
                ) : (
                    <>
                        <p className="mos-hint">
                            Materijali koji nedostaju, grupisani po dobavljaču. Sve je unaprijed izabrano —
                            isključi šta ne želiš naručiti sada.
                        </p>
                        <div className="mos-groups">
                            {groups.map(g => {
                                const state = groupState(g);
                                const subtotal = groupSubtotal(g);
                                return (
                                    <div key={g.supplierName} className={`mos-group${state === 'none' ? ' is-off' : ''}`}>
                                        <div className="mos-group-head" onClick={() => toggleGroup(g)}>
                                            <span className={`mos-check${state === 'all' ? ' on' : ''}${state === 'some' ? ' partial' : ''}`}>
                                                {state === 'all' && <Check size={12} strokeWidth={3} />}
                                                {state === 'some' && <span className="mos-check-dash" />}
                                            </span>
                                            <Truck size={15} className="mos-group-icon" />
                                            <span className="mos-group-name">{g.supplierName}</span>
                                            <span className="mos-group-count">{g.materials.length} {g.materials.length === 1 ? 'stavka' : 'stavki'}</span>
                                            <span className="mos-group-subtotal">{formatCurrency(subtotal)}</span>
                                        </div>

                                        <div className="mos-materials">
                                            {g.materials.map(m => {
                                                const on = selected.has(m.productMaterialId);
                                                return (
                                                    <button key={m.productMaterialId} type="button"
                                                        className={`mos-mat${on ? ' on' : ''}`}
                                                        onClick={() => toggleMaterial(m.productMaterialId)}>
                                                        <span className={`mos-check sm${on ? ' on' : ''}`}>
                                                            {on && <Check size={10} strokeWidth={3} />}
                                                        </span>
                                                        <span className="mos-mat-body">
                                                            <span className="mos-mat-name">{m.materialName}</span>
                                                            <span className="mos-mat-meta">{m.productName} · {m.quantity} {m.unit}</span>
                                                        </span>
                                                        <span className="mos-mat-price">{formatCurrency(m.quantity * m.unitPrice)}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}
