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
import { formatCurrency, plural } from '@/lib/utils';
import { formatQty, groupPlanMaterials, productNamesLabel } from '@/lib/orderItemGroups';
import type { MaterialOrderPlanGroup } from '@/lib/services';
import './MaterialOrderSelectModal.css';

interface MaterialOrderSelectModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Put kroz nalog — plan se vuče iz baze. Izostavlja se kad se šalje gotov `plan`. */
    workOrderId?: string;
    workOrderLabel: string;
    plannedStartDate: string;
    organizationId: string;
    onRefresh: (...collections: string[]) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    /**
     * Gotov plan (Komandni centar: materijali odabrani direktno s proizvoda,
     * bez naloga). Kad je zadan, modal ne čita ništa iz baze.
     */
    plan?: MaterialOrderPlanGroup[];
    /** Upis za gotov plan — obavezan uz `plan`. */
    onCreate?: (selectedMaterialIds: string[]) => Promise<{ ordersCreated: number; orderNumbers: string[] }>;
}

export default function MaterialOrderSelectModal({
    isOpen, onClose, workOrderId, workOrderLabel, plannedStartDate, organizationId, onRefresh, showToast, plan, onCreate,
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
        // Gotov plan (Komandni centar) se ne ponavlja iz baze — pozivalac ga je već izgradio.
        if (plan) {
            setGroups(plan);
            const all = new Set<string>();
            plan.forEach(g => g.materials.forEach(m => all.add(m.productMaterialId)));
            setSelected(all);
            setLoading(false);
            return;
        }
        if (!workOrderId) { setGroups([]); setLoading(false); return; }
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
    }, [isOpen, workOrderId, organizationId, plan]);

    const groupState = (g: MaterialOrderPlanGroup): 'all' | 'some' | 'none' => {
        const ids = g.materials.map(m => m.productMaterialId);
        const on = ids.filter(id => selected.has(id)).length;
        return on === 0 ? 'none' : on === ids.length ? 'all' : 'some';
    };

    // Isti materijal s više pozicija = jedan red (zbir), abecedno — ono što se
    // bira izgleda kao narudžba koja će iz toga nastati. Izbor i dalje ide po
    // materijalu proizvoda, pa red pali/gasi sve svoje stavke odjednom.
    const materialGroups = useMemo(
        () => new Map(groups.map(g => [g.supplierName, groupPlanMaterials(g.materials)])),
        [groups]
    );

    const toggleMaterials = (ids: string[]) => setSelected(prev => {
        const next = new Set(prev);
        const allOn = ids.every(id => next.has(id));
        ids.forEach(id => { if (allOn) next.delete(id); else next.add(id); });
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
            // Broji redove kako ih korisnik vidi (materijal), ne skrivene stavke.
            materialCount += (materialGroups.get(g.supplierName) || []).filter(mg => mg.ids.some(id => selected.has(id))).length;
            sum += sel.reduce((s, m) => s + m.quantity * m.unitPrice, 0);
        }
        return { materialCount, supplierCount, sum };
    }, [groups, selected, materialGroups]);

    const groupSubtotal = (g: MaterialOrderPlanGroup) =>
        g.materials.filter(m => selected.has(m.productMaterialId)).reduce((s, m) => s + m.quantity * m.unitPrice, 0);

    const handleConfirm = async () => {
        if (selected.size === 0 || creating) return;
        setCreating(true);
        try {
            const ids = Array.from(selected);
            const res = onCreate
                ? await onCreate(ids)
                : await import('@/lib/services').then(({ createSelectedMaterialOrders }) =>
                    createSelectedMaterialOrders(workOrderId || '', plannedStartDate, ids, organizationId));
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
                                const rows = materialGroups.get(g.supplierName) || [];
                                return (
                                    <div key={g.supplierName} className={`mos-group${state === 'none' ? ' is-off' : ''}`}>
                                        <div className="mos-group-head" onClick={() => toggleGroup(g)}>
                                            <span className={`mos-check${state === 'all' ? ' on' : ''}${state === 'some' ? ' partial' : ''}`}>
                                                {state === 'all' && <Check size={12} strokeWidth={3} />}
                                                {state === 'some' && <span className="mos-check-dash" />}
                                            </span>
                                            <Truck size={15} className="mos-group-icon" />
                                            <span className="mos-group-name">{g.supplierName}</span>
                                            <span className="mos-group-count">{rows.length} {rows.length === 1 ? 'materijal' : 'materijala'}</span>
                                            <span className="mos-group-subtotal">{formatCurrency(subtotal)}</span>
                                        </div>

                                        <div className="mos-materials">
                                            {rows.map(row => {
                                                const onCount = row.ids.filter(id => selected.has(id)).length;
                                                const on = onCount === row.ids.length;
                                                const some = onCount > 0 && !on;
                                                const merged = row.materials.length > 1;
                                                return (
                                                    <button key={row.key} type="button"
                                                        className={`mos-mat${on || some ? ' on' : ''}`}
                                                        onClick={() => toggleMaterials(row.ids)}>
                                                        <span className={`mos-check sm${on ? ' on' : ''}${some ? ' partial' : ''}`}>
                                                            {on && <Check size={10} strokeWidth={3} />}
                                                            {some && <span className="mos-check-dash" />}
                                                        </span>
                                                        <span className="mos-mat-body">
                                                            <span className="mos-mat-name">{row.name}</span>
                                                            <span className="mos-mat-meta" title={row.productNames.join(', ')}>
                                                                {merged && <b className="mos-mat-merged">{row.materials.length} {plural(row.materials.length, 'pozicija', 'pozicije', 'pozicija')} · </b>}
                                                                {productNamesLabel(row.productNames)}
                                                            </span>
                                                        </span>
                                                        <span className="mos-mat-qty">{formatQty(row.quantity)} {row.unit}</span>
                                                        <span className="mos-mat-price">{formatCurrency(row.total)}</span>
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
