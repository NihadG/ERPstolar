'use client';

// ════════════════════════════════════════════════════════════════════
// PROIZVODI — jedini kontejner s kojeg se i naručuje i pravi nalog
//
// Red proizvoda mora, bez otvaranja, odgovoriti na tri pitanja:
//   1. je li materijal spreman        → segmentirani mjerač
//   2. je li već u nalogu i u kojem   → značka naloga
//   3. gori li nešto                  → crvena ivica reda
// Tek kad nešto od toga ne valja, red se otvara u tabelu materijala.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Check, ChevronRight, Package, Search, ShoppingCart, Wrench, X } from 'lucide-react';
import type { Product, Project } from '@/lib/types';
import type { BoardScope } from '@/lib/command/scope';
import type { CommandMaterialRow } from '@/lib/command/materialOrder';
import { essentialState, lensAllowsMaterial, lensAllowsProduct, type LensSelection } from '@/lib/command/signals';
import { matches, queryTokens } from '@/lib/command/search';
import { productSearchText, sortProductsForBoard } from '@/lib/command/products';
import { hue, KcPanel, plural, qty } from './parts';

const READY = new Set(['Primljeno', 'Na stanju']);

/** Koliko proizvoda grupa pokaže prije „Prikaži još" — projekat zna imati 70+
    pozicija, a tada lista prestane biti pregled i postane zid teksta. */
const PAGE = 12;

const toggle = (setter: (fn: (prev: Set<string>) => Set<string>) => void, id: string) => setter(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
});

export interface ProductsPanelProps {
    scope: BoardScope;
    materials: CommandMaterialRow[];
    lens: LensSelection | null;
    canCreate: boolean;
    selectedProducts: Set<string>;
    selectedMaterials: Set<string>;
    onToggleProduct: (productId: string) => void;
    onToggleProductMany: (productIds: string[], on: boolean) => void;
    onToggleMaterial: (materialId: string) => void;
    onToggleMaterialMany: (materialIds: string[], on: boolean) => void;
    onClearSelection: () => void;
    onCreateWorkOrder: (projectId: string) => void;
    onOrderMaterials: () => void;
    solo?: string | null;
    onSolo?: (id: string | null) => void;
}

export default function ProductsPanel(props: ProductsPanelProps) {
    const { scope, materials, lens, canCreate, selectedProducts, selectedMaterials } = props;
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [showAll, setShowAll] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState('');

    const byProduct = useMemo(() => {
        const map = new Map<string, CommandMaterialRow[]>();
        for (const row of materials) {
            const list = map.get(row.productId) || [];
            list.push(row);
            map.set(row.productId, list);
        }
        return map;
    }, [materials]);

    // Proizvod → otvoreni nalozi u kojima se nalazi (značka na redu).
    const productOrders = useMemo(() => {
        const map = new Map<string, { id: string; number: string; status: string }[]>();
        for (const wo of scope.workOrders) {
            for (const item of wo.items || []) {
                if (!item.Product_ID) continue;
                const list = map.get(item.Product_ID) || [];
                list.push({ id: wo.Work_Order_ID, number: wo.Work_Order_Number, status: wo.Status });
                map.set(item.Product_ID, list);
            }
        }
        return map;
    }, [scope.workOrders]);

    // Crvena ivica reda je rezervisana za ono što STVARNO koči: proizvod kojem
    // fali ključni materijal, a već je u otvorenom nalogu. Bez toga bi skoro
    // svaki red bio crven (rano u poslu ništa nije naručeno) i crveno ne bi
    // više ništa značilo.
    const activeOrderProducts = useMemo(() => {
        const ids = new Set<string>();
        for (const wo of scope.workOrders) {
            if (wo.Status === 'Završeno' || wo.Status === 'Otkazano') continue;
            for (const item of wo.items || []) if (item.Product_ID) ids.add(item.Product_ID);
        }
        return ids;
    }, [scope.workOrders]);

    // Pozicije iz naloga koji se UPRAVO rade — one idu na vrh liste.
    // Uže od `activeOrderProducts`: nalog „Na čekanju" je planiran, ne aktivan.
    const inProgressProducts = useMemo(() => {
        const ids = new Set<string>();
        for (const wo of scope.workOrders) {
            if (wo.Status !== 'U toku') continue;
            for (const item of wo.items || []) if (item.Product_ID) ids.add(item.Product_ID);
        }
        return ids;
    }, [scope.workOrders]);

    // Pretraga je tolerantna (dijakritika, redoslijed, razmaci, tipfeleri) i
    // gleda i materijale — „gdje mi je iveral" je stvarno pitanje nad ovom listom.
    const tokens = useMemo(() => queryTokens(query), [query]);
    const groups = useMemo(() => scope.projects
        .map(project => ({
            project,
            products: sortProductsForBoard(
                (project.products || []).filter(product =>
                    lensAllowsProduct(lens, product.Product_ID)
                    && matches(productSearchText(product, byProduct.get(product.Product_ID) || [], project.Name || project.Client_Name || ''), tokens)),
                byProduct,
                inProgressProducts,
            ),
        }))
        .filter(g => g.products.length > 0), [scope.projects, lens, tokens, byProduct, inProgressProducts]);

    const total = groups.reduce((sum, g) => sum + g.products.length, 0);
    const selectedMaterialRows = materials.filter(m => selectedMaterials.has(m.ID));
    const selectedProjects = Array.from(new Set(
        groups.flatMap(g => g.products.filter(p => selectedProducts.has(p.Product_ID)).map(() => g.project)),
    ));

    const toggleOpen = (productId: string) => setOpen(prev => {
        const next = new Set(prev);
        if (next.has(productId)) next.delete(productId); else next.add(productId);
        return next;
    });

    return (
        <KcPanel
            id="products"
            eyebrow="ŠTA SE PRAVI"
            title="Proizvodi"
            count={total}
            solo={props.solo}
            onSolo={props.onSolo}
            actions={
                <label className="kc-search">
                    <Search size={14} />
                    <input
                        aria-label="Pretraži pozicije, materijale i dobavljače"
                        placeholder="Nađi poziciju ili materijal…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                    {query && (
                        <button type="button" aria-label="Očisti pretragu" onClick={() => setQuery('')}><X size={13} /></button>
                    )}
                </label>
            }
        >
            <div className="kc-panel-body">
                {groups.length === 0 && (
                    <div className="kc-empty">
                        <Package size={22} style={{ opacity: 0.45 }} />
                        <p>{query ? 'Ništa ne odgovara pretrazi.' : 'Nema proizvoda u ovom prikazu.'}</p>
                        {query && <button type="button" className="kc-link" onClick={() => setQuery('')}>Očisti pretragu</button>}
                    </div>
                )}
                {groups.map(({ project, products }) => {
                    const ids = products.map(p => p.Product_ID);
                    const allOn = ids.every(id => selectedProducts.has(id));
                    const searching = tokens.length > 0;
                    const isOpen = searching || !collapsed.has(project.Project_ID);
                    const expandedList = searching || showAll.has(project.Project_ID);
                    const shown = expandedList ? products : products.slice(0, PAGE);
                    const hidden = products.length - shown.length;
                    return (
                        <div className="kc-group" key={project.Project_ID} style={hue(project.Project_ID)}>
                            <div className="kc-group-head">
                                <button
                                    type="button"
                                    className="kc-group-toggle"
                                    aria-expanded={isOpen}
                                    onClick={() => toggle(setCollapsed, project.Project_ID)}
                                >
                                    <ChevronRight size={13} style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} />
                                    <span className="kc-group-dot" />
                                    <strong>{project.Name || project.Client_Name}</strong>
                                    <span>{products.length} proizvoda</span>
                                </button>
                                {isOpen && (
                                    <div className="kc-group-actions">
                                        <button type="button" className="kc-link" onClick={() => props.onToggleProductMany(ids, !allOn)}>
                                            {allOn ? 'Poništi' : 'Označi sve'}
                                        </button>
                                    </div>
                                )}
                            </div>
                            {isOpen && shown.map(product => (
                                <ProductRow
                                    key={product.Product_ID}
                                    product={product}
                                    project={project}
                                    rows={byProduct.get(product.Product_ID) || []}
                                    orders={productOrders.get(product.Product_ID) || []}
                                    activeOrder={activeOrderProducts.has(product.Product_ID)}
                                    open={open.has(product.Product_ID)}
                                    selected={selectedProducts.has(product.Product_ID)}
                                    selectedMaterials={selectedMaterials}
                                    lens={lens}
                                    onToggleOpen={() => toggleOpen(product.Product_ID)}
                                    onToggleSelect={() => props.onToggleProduct(product.Product_ID)}
                                    onToggleMaterial={props.onToggleMaterial}
                                    onToggleMaterialMany={props.onToggleMaterialMany}
                                />
                            ))}
                            {isOpen && hidden > 0 && (
                                <button type="button" className="kc-more" onClick={() => toggle(setShowAll, project.Project_ID)}>
                                    Prikaži još {hidden} {plural(hidden, 'proizvod', 'proizvoda', 'proizvoda')}
                                </button>
                            )}
                            {isOpen && expandedList && products.length > PAGE && (
                                <button type="button" className="kc-more" onClick={() => toggle(setShowAll, project.Project_ID)}>
                                    Prikaži manje
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {(selectedProducts.size > 0 || selectedMaterials.size > 0) && (
                <div className="kc-selbar">
                    <span>
                        Označeno: <b>{selectedProducts.size}</b> {plural(selectedProducts.size, 'proizvod', 'proizvoda', 'proizvoda')}
                        {selectedMaterials.size > 0 && <> · <b>{selectedMaterials.size}</b> {plural(selectedMaterials.size, 'materijal', 'materijala', 'materijala')}</>}
                    </span>
                    <div className="kc-selbar-actions">
                        <button type="button" className="kc-btn sm" onClick={props.onClearSelection}>Očisti</button>
                        {canCreate && selectedMaterials.size > 0 && (
                            <button type="button" className="kc-btn sm" onClick={props.onOrderMaterials}>
                                <ShoppingCart size={14} /> Naruči materijale ({selectedMaterialRows.length})
                            </button>
                        )}
                        {canCreate && selectedProjects.map(project => (
                            <button type="button" key={project.Project_ID} className="kc-btn sm primary" onClick={() => props.onCreateWorkOrder(project.Project_ID)}>
                                <Wrench size={14} /> Napravi nalog{selectedProjects.length > 1 ? ` · ${project.Name || project.Client_Name}` : ''}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </KcPanel>
    );
}

function ProductRow({
    product, project, rows, orders, activeOrder, open, selected, selectedMaterials, lens,
    onToggleOpen, onToggleSelect, onToggleMaterial, onToggleMaterialMany,
}: {
    product: Product;
    project: Project;
    rows: CommandMaterialRow[];
    orders: { id: string; number: string; status: string }[];
    activeOrder: boolean;
    open: boolean;
    selected: boolean;
    selectedMaterials: Set<string>;
    lens: LensSelection | null;
    onToggleOpen: () => void;
    onToggleSelect: () => void;
    onToggleMaterial: (id: string) => void;
    onToggleMaterialMany: (ids: string[], on: boolean) => void;
}) {
    const ready = rows.filter(r => READY.has(r.Status)).length;
    const ordered = rows.filter(r => r.Status === 'Naručeno').length;
    const missing = rows.length - ready - ordered;
    const missingEssential = rows.some(r => essentialState(r) === 'missing');
    const incomingEssential = rows.some(r => essentialState(r) === 'incoming');
    const blocked = missingEssential && activeOrder;   // koči STVARNI rad
    const orderable = rows.filter(r => r.orderable);
    const openOrder = orders.find(o => o.status === 'U toku') || orders.find(o => o.status === 'Na čekanju') || orders[0];
    const dims = [product.Width, product.Height, product.Depth].filter(Boolean).join('×');

    return (
        <>
            <div className={`kc-row${open ? ' open' : ''}${blocked ? ' late' : ''}`}>
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={`Označi proizvod ${product.Name}`}
                    className="kc-check"
                    onClick={onToggleSelect}
                >
                    {selected && <Check size={12} strokeWidth={3} />}
                </button>
                <button type="button" className="kc-row-main" onClick={onToggleOpen} aria-expanded={open} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <strong>{product.Name || 'Proizvod'}</strong>
                    <span>{[dims, product.Quantity > 1 ? `×${product.Quantity}` : null, product.Status].filter(Boolean).join(' · ')}</span>
                </button>
                <div className="kc-row-side">
                    {rows.length > 0 ? (
                        <div className="kc-meter" title={`${ready} spremno · ${ordered} naručeno · ${missing} nedostaje`}>
                            <div className="kc-meter-bar">
                                {ready > 0 && <i className="ready" style={{ width: `${(ready / rows.length) * 100}%` }} />}
                                {ordered > 0 && <i className="ordered" style={{ width: `${(ordered / rows.length) * 100}%` }} />}
                                {missing > 0 && <i className="missing" style={{ width: `${(missing / rows.length) * 100}%` }} />}
                            </div>
                            <span className={blocked ? 'kc-meter-alert' : undefined}>
                                {ready}/{rows.length} spremno
                                {blocked ? ' · KOČI NALOG' : missingEssential ? ' · ključni nije naručen' : incomingEssential ? ' · ključni u dolasku' : ''}
                            </span>
                        </div>
                    ) : (
                        <div className="kc-meter"><span>Bez materijala</span></div>
                    )}
                    {openOrder
                        ? <span className="kc-tag" title={`Nalog #${openOrder.number} — ${openOrder.status}`}>#{openOrder.number} {openOrder.status}</span>
                        : <span className="kc-tag ghost">bez naloga</span>}
                    <button type="button" className="kc-icon-btn" style={{ border: 'none', width: 26, height: 26 }} aria-label={open ? 'Sklopi materijale' : 'Prikaži materijale'} onClick={onToggleOpen}>
                        <ChevronRight size={15} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }} />
                    </button>
                </div>
            </div>

            {open && (
                <div className="kc-expand">
                    {rows.length === 0 ? (
                        <div className="kc-empty" style={{ padding: 16 }}><p>Ovaj proizvod nema unesenih materijala.</p></div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                                <span className="kc-eyebrow" style={{ margin: 0 }}>MATERIJALI · {project.Name || project.Client_Name}</span>
                                {orderable.length > 0 && (
                                    <button
                                        type="button"
                                        className="kc-link"
                                        style={{ marginLeft: 'auto' }}
                                        onClick={() => onToggleMaterialMany(orderable.map(r => r.ID), !orderable.every(r => selectedMaterials.has(r.ID)))}
                                    >
                                        {orderable.every(r => selectedMaterials.has(r.ID)) ? 'Poništi' : `Označi za narudžbu (${orderable.length})`}
                                    </button>
                                )}
                            </div>
                            <div className="kc-table-wrap">
                                <table className="kc-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 34 }} />
                                            <th>Materijal</th>
                                            <th className="r">Potrebno</th>
                                            <th className="r opt">Na stanju</th>
                                            <th className="r opt">Naručeno</th>
                                            <th className="r opt">Primljeno</th>
                                            <th className="r">Nedostaje</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.filter(r => lensAllowsMaterial(lens, r.ID) || !lens).map(row => (
                                            <tr key={row.ID} className={essentialState(row) === 'missing' ? 'blocked' : undefined}>
                                                <td>
                                                    <button
                                                        type="button"
                                                        role="checkbox"
                                                        aria-checked={selectedMaterials.has(row.ID)}
                                                        aria-label={`Naruči ${row.Material_Name}`}
                                                        className="kc-check"
                                                        disabled={!row.orderable}
                                                        title={row.orderable ? 'Označi za narudžbu' : 'Nema šta da se naruči'}
                                                        onClick={() => onToggleMaterial(row.ID)}
                                                    >
                                                        {selectedMaterials.has(row.ID) && <Check size={12} strokeWidth={3} />}
                                                    </button>
                                                </td>
                                                <td>
                                                    <div className="kc-mat-name">{row.Material_Name}{row.Is_Essential && <span className="kc-tag" style={{ marginLeft: 6 }}>ključni</span>}</div>
                                                    {row.Supplier && <div className="kc-mat-sub">{row.Supplier}</div>}
                                                </td>
                                                <td className="r fw">{qty(row.needed, row.Unit)}</td>
                                                <td className="r opt">{qty(row.On_Stock || 0, row.Unit)}</td>
                                                <td className="r opt">{qty(row.Ordered_Quantity || 0, row.Unit)}</td>
                                                <td className="r opt">{qty(row.Received_Quantity || 0, row.Unit)}</td>
                                                <td className="r fw">{qty(row.remaining, row.Unit)}</td>
                                                <td><span className={`kc-status ${statusClass(row.Status)}`}>{row.Status}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}
        </>
    );
}

function statusClass(status: string): string {
    if (READY.has(status)) return 's-done';
    if (status === 'Naručeno') return 's-running';
    return 's-late';
}



