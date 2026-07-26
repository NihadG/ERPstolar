'use client';

// ════════════════════════════════════════════════════════════════════
// MaterialOrderModal — narudžbe se prave IZ PROIZVODA naloga.
//
// Isti layout kao izbor proizvoda: LIJEVO biraš dobavljače, DESNO vidiš šta
// nastaje i kad. Sastavnice su već u bazi, pa se ništa ne prekucava.
//
// KLJUČNA ODLUKA: veza `delivery-to-start` se pravi SAMO za grupe s esencijalnim
// materijalom. Okov može stići usred naloga bez posljedice; iveral ne može.
// Da se veže sve, platno bi lažno vikalo na svaku narudžbu koju namjerno staviš
// usred proizvodnje — a upravo to je slučaj koji treba podržati.
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { ShoppingCart, Truck, AlertTriangle, Link2, ChevronRight, Calendar } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { Project, Supplier, PlanBlock } from '@/lib/types';
import {
    groupMaterialsForProducts, availableMaterialTypes, purchaseDataFromGroup,
} from '@/lib/canvas/fromProducts';
import { suggestLeadDays, type SupplierLeadTime } from '@/lib/canvas/leadTime';
import { addDays } from '@/lib/canvas/model';
import { MATERIAL_TYPES } from '@/lib/productProcesses';
import './ProductPickerModal.css';

/** Rok koji se koristi kad dobavljač nema dovoljno istorije. */
const FALLBACK_LEAD_DAYS = 7;

export interface CreatedPurchase {
    data: Partial<PlanBlock>;
    linkToOrder: boolean;
}

interface MaterialOrderModalProps {
    isOpen: boolean;
    orderBlock: PlanBlock | null;
    projects: Project[];
    suppliers: Supplier[];
    leadTimes: Map<string, SupplierLeadTime>;
    onClose: () => void;
    onCreate: (purchases: CreatedPurchase[]) => void;
}

const typeLabel = new Map(MATERIAL_TYPES.map(t => [t.key, t.label]));
const money = (n: number) => `${Math.round(n).toLocaleString('hr-HR')} KM`;
const dm = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
};

export default function MaterialOrderModal({
    isOpen, orderBlock, projects, suppliers, leadTimes, onClose, onCreate,
}: MaterialOrderModalProps) {
    const [supplierFilter, setSupplierFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [includeSettled, setIncludeSettled] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const productIds = useMemo(
        () => (orderBlock?.productRefs || []).map(p => p.id).filter(Boolean) as string[],
        [orderBlock]
    );

    const allGroups = useMemo(
        () => groupMaterialsForProducts(projects, productIds, { includeSettled }),
        [projects, productIds, includeSettled]
    );
    const groups = useMemo(
        () => groupMaterialsForProducts(projects, productIds, {
            includeSettled,
            supplierFilter: supplierFilter || undefined,
            typeFilter: typeFilter || undefined,
        }),
        [projects, productIds, includeSettled, supplierFilter, typeFilter]
    );
    const types = useMemo(() => availableMaterialTypes(allGroups), [allGroups]);

    // Podrazumijevano sve čekirano — „naruči sve" je najčešći slučaj
    useEffect(() => {
        if (isOpen) { setPicked(new Set(groups.map(g => g.supplierKey))); setExpanded(new Set()); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, supplierFilter, typeFilter, includeSettled]);

    const leadFor = (name: string) => suggestLeadDays(name, leadTimes)?.days ?? FALLBACK_LEAD_DAYS;

    const chosen = groups.filter(g => picked.has(g.supplierKey));
    const totalCost = chosen.reduce((s, g) => s + g.totalPrice, 0);
    const linkedCount = chosen.filter(g => g.hasEssential).length;
    const delivery = orderBlock ? addDays(orderBlock.startISO, -1) : '';

    const create = () => {
        if (!orderBlock) return;
        const purchases: CreatedPurchase[] = chosen.map(g => {
            const lead = leadFor(g.supplierName);
            const orderBy = addDays(delivery, -lead);
            const supplier = suppliers.find(s => s.Name.trim().toLowerCase() === g.supplierKey);
            return {
                data: {
                    ...purchaseDataFromGroup(g, supplier?.Supplier_ID),
                    startISO: orderBy,
                    endISO: delivery,
                    orderByISO: orderBy,
                    leadDays: lead,
                    projectRef: orderBlock.projectRef,
                },
                linkToOrder: g.hasEssential,
            };
        });
        onCreate(purchases);
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<><ShoppingCart size={17} /> Narudžbe za „{orderBlock?.title || ''}"</>}
            size="xl"
            footer={
                <div className="pp-foot">
                    <div className="pp-foot-calc">
                        {chosen.length === 0 ? (
                            <span className="pp-foot-hint">Izaberi dobavljače s lijeve strane</span>
                        ) : (
                            <>
                                <strong>{chosen.length}</strong> narudžb{chosen.length === 1 ? 'a' : 'i'}
                                <span className="pp-sep">·</span>
                                <strong>{money(totalCost)}</strong>
                                <span className="pp-foot-dates">
                                    <Calendar size={13} /> dostava do {dm(delivery)}
                                </span>
                            </>
                        )}
                    </div>
                    <div className="pp-foot-actions">
                        <button className="btn btn-secondary" onClick={onClose}>Odustani</button>
                        <button className="btn btn-primary" disabled={chosen.length === 0} onClick={create}>
                            Kreiraj narudžbe
                        </button>
                    </div>
                </div>
            }
        >
            <div className="pp-shell">
                {/* ── Lijevo: dobavljači ──────────────────────── */}
                <section className="pp-pane pp-pane-pick">
                    <header className="pp-pane-head">
                        <select className="pp-toggle" value={supplierFilter}
                            onChange={e => setSupplierFilter(e.target.value)}>
                            <option value="">Svi dobavljači</option>
                            {allGroups.map(g => (
                                <option key={g.supplierKey} value={g.supplierName}>{g.supplierName}</option>
                            ))}
                        </select>
                        <select className="pp-toggle" value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value)}>
                            <option value="">Sve vrste</option>
                            {types.map(t => <option key={t} value={t}>{typeLabel.get(t) || t}</option>)}
                        </select>
                        <button className={`pp-toggle${includeSettled ? ' on' : ''}`}
                            onClick={() => setIncludeSettled(v => !v)}
                            title="Prikaži i materijal koji je već primljen ili na stanju">
                            I nabavljeno
                        </button>
                    </header>

                    <div className="pp-scroll">
                        {productIds.length === 0 && (
                            <p className="pp-empty">
                                Ovaj nalog nema izabranih proizvoda, pa se sastavnica ne može pročitati.
                            </p>
                        )}
                        {productIds.length > 0 && groups.length === 0 && (
                            <p className="pp-empty">
                                Nema materijala za ovaj filter — sve je već primljeno ili na stanju.
                            </p>
                        )}

                        {groups.map(g => {
                            const on = picked.has(g.supplierKey);
                            const open = expanded.has(g.supplierKey);
                            const lead = suggestLeadDays(g.supplierName, leadTimes);
                            return (
                                <div key={g.supplierKey} className="pp-group">
                                    <div className={`pp-row${on ? ' on' : ''}`} style={{ paddingLeft: 9 }}>
                                        <span className={`pp-box${on ? ' on' : ''}`}
                                            role="button" tabIndex={0}
                                            onClick={() => setPicked(prev => {
                                                const next = new Set(prev);
                                                if (next.has(g.supplierKey)) next.delete(g.supplierKey);
                                                else next.add(g.supplierKey);
                                                return next;
                                            })}
                                            onKeyDown={e => {
                                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                                e.preventDefault();
                                                setPicked(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(g.supplierKey)) next.delete(g.supplierKey);
                                                    else next.add(g.supplierKey);
                                                    return next;
                                                });
                                            }} />
                                        <Truck size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                        <button className="pp-name"
                                            style={{ border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                                            onClick={() => setExpanded(prev => {
                                                const next = new Set(prev);
                                                if (next.has(g.supplierKey)) next.delete(g.supplierKey);
                                                else next.add(g.supplierKey);
                                                return next;
                                            })}>
                                            {g.supplierName}
                                        </button>
                                        {g.hasEssential && (
                                            <span className="pp-essential" title="Sadrži esencijalni materijal — veže se na početak naloga">
                                                <Link2 size={10} /> gate
                                            </span>
                                        )}
                                        <span className="pp-avail">{g.lines.length} · {money(g.totalPrice)}</span>
                                        <ChevronRight size={13}
                                            className={open ? 'rot' : ''}
                                            style={{
                                                color: 'var(--text-tertiary)', flexShrink: 0,
                                                transform: open ? 'rotate(90deg)' : 'none',
                                            }} />
                                    </div>

                                    {open && (
                                        <div className="pp-lines">
                                            {g.lines.map(l => (
                                                <div key={l.materialId} className="pp-line">
                                                    <span className={`pp-line-name${l.isEssential ? ' ess' : ''}`}>
                                                        {l.name}
                                                    </span>
                                                    <span className="pp-line-qty">{l.quantity} {l.unit}</span>
                                                    <span className="pp-line-price">{money(l.totalPrice)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* ── Desno: šta nastaje ──────────────────────── */}
                <section className="pp-pane pp-pane-cart">
                    <header className="pp-pane-head">
                        <h4 className="pp-cart-title">
                            Nastaje na platnu
                            {chosen.length > 0 && <span className="pp-group-count">{chosen.length}</span>}
                        </h4>
                    </header>

                    <div className="pp-scroll">
                        {chosen.length === 0 ? (
                            <p className="pp-empty">Nijedan dobavljač nije izabran.</p>
                        ) : (
                            <ul className="pp-cart">
                                {chosen.map(g => {
                                    const lead = suggestLeadDays(g.supplierName, leadTimes);
                                    const days = lead?.days ?? FALLBACK_LEAD_DAYS;
                                    const orderBy = addDays(delivery, -days);
                                    return (
                                        <li key={g.supplierKey}>
                                            <div className="pp-cart-main">
                                                <span className="pp-name">{g.supplierName}</span>
                                                <span className="pp-cart-sub">
                                                    naruči {dm(orderBy)} → stiže {dm(delivery)}
                                                </span>
                                            </div>
                                            <span className="pp-lead">
                                                {lead ? lead.label : <>{days} d <em>(bez istorije)</em></>}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {chosen.length > 0 && (
                            <p className={`pp-note${linkedCount < chosen.length ? ' warn' : ''}`}
                                style={linkedCount === chosen.length
                                    ? { background: 'var(--accent-light)', color: 'var(--text-primary)' }
                                    : undefined}>
                                {linkedCount < chosen.length ? <AlertTriangle size={12} /> : <Link2 size={12} />}
                                <span>
                                    {linkedCount > 0
                                        ? `${linkedCount} se veže na početak naloga (esencijalni materijal). `
                                        : 'Nijedna se ne veže — nema esencijalnog materijala. '}
                                    {linkedCount < chosen.length &&
                                        'Nevezane možeš slobodno pomjerati usred naloga.'}
                                </span>
                            </p>
                        )}
                    </div>
                </section>
            </div>
        </Modal>
    );
}
