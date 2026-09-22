'use client';

// ════════════════════════════════════════════════════════════════════
// TRAKA ODABIRA — plutajuća, uvijek na dnu ekrana
//
// Ranije je traka s „Naruči materijale" / „Napravi nalog" stajala na dnu
// ploče Proizvodi. Ploča zna biti duga preko hiljadu piksela, pa je
// korisnik označio materijal i onda skrolao do dna da ga naruči — a i tada
// je bila bijela traka na bijeloj ploči, lako za previdjeti.
//
// Sada traka lebdi iznad svega čim nešto označiš, tamna, s jasnim
// radnjama. Radnje se prilagode odabiru:
//   • označeni materijali → „Naruči označene (n)"
//   • samo proizvodi      → „Naruči što fali (n)" — sve što fali na njima
//   • proizvodi           → „Napravi nalog" (po projektu, jer je nalog
//                            vezan za projekat)
// Esc čisti odabir (tek drugi Esc zatvara Komandni centar).
// ════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { ShoppingCart, Wrench, X } from 'lucide-react';
import type { Project } from '@/lib/types';
import { orderableIds, type CommandMaterialRow } from '@/lib/command/materialOrder';
import { CreateMenu, plural } from './parts';

export default function SelectionDock({
    projects, materials, selectedProducts, selectedMaterials, canCreate, onClear, onOrder, onCreateWorkOrder,
}: {
    /** Projekti s table, redoslijedom table. */
    projects: Project[];
    materials: CommandMaterialRow[];
    selectedProducts: Set<string>;
    selectedMaterials: Set<string>;
    canCreate: boolean;
    onClear: () => void;
    /** `explicit` = korisnik je sam označio materijale (a ne „sve što fali"). */
    onOrder: (ids: string[], explicit: boolean) => void;
    onCreateWorkOrder: (projectId: string) => void;
}) {
    const byProject = useMemo(() => projects
        .map(project => ({
            project,
            count: (project.products || []).filter(p => selectedProducts.has(p.Product_ID)).length,
        }))
        .filter(entry => entry.count > 0), [projects, selectedProducts]);

    const explicit = useMemo(
        () => materials.filter(m => selectedMaterials.has(m.ID) && m.orderable).map(m => m.ID),
        [materials, selectedMaterials],
    );
    const fromProducts = useMemo(
        () => (selectedProducts.size > 0 ? orderableIds(materials, { productIds: selectedProducts }) : []),
        [materials, selectedProducts],
    );

    const productCount = selectedProducts.size;
    const materialCount = selectedMaterials.size;
    if (productCount === 0 && materialCount === 0) return null;

    const orderIds = explicit.length > 0 ? explicit : fromProducts;
    const orderLabel = explicit.length > 0 ? 'Naruči označene' : 'Naruči što fali';
    const orderTitle = orderIds.length > 0
        ? undefined
        : productCount > 0 ? 'Na označenim proizvodima je sve već naručeno ili na stanju' : 'Označeni materijali su već pokriveni';

    return (
        <div className="kc-dock" role="region" aria-label="Označeno">
            <div className="kc-dock-sum">
                <span className="kc-dock-num" aria-hidden>{productCount + materialCount}</span>
                <span>
                    <b>Označeno:</b>{' '}
                    {[
                        productCount > 0 ? `${productCount} ${plural(productCount, 'proizvod', 'proizvoda', 'proizvoda')}` : null,
                        materialCount > 0 ? `${materialCount} ${plural(materialCount, 'materijal', 'materijala', 'materijala')}` : null,
                    ].filter(Boolean).join(' · ')}
                    {byProject.length > 1 && <small> · iz {byProject.length} {plural(byProject.length, 'projekta', 'projekta', 'projekata')}</small>}
                </span>
            </div>
            <button type="button" className="kc-dock-clear" onClick={onClear} title="Očisti odabir (Esc)">
                <X size={14} /> Očisti
            </button>
            {canCreate && (
                <div className="kc-dock-actions">
                    <button
                        type="button"
                        className="kc-dock-btn"
                        disabled={orderIds.length === 0}
                        title={orderTitle}
                        onClick={() => onOrder(orderIds, explicit.length > 0)}
                    >
                        <ShoppingCart size={15} /> {orderLabel} ({orderIds.length})
                    </button>
                    {byProject.length > 0 && (
                        <CreateMenu
                            variant="dock"
                            icon={<Wrench size={15} />}
                            label="Napravi nalog"
                            heading="Nalog za označene proizvode iz"
                            items={byProject.map(({ project, count }) => ({
                                id: project.Project_ID,
                                label: project.Name || project.Client_Name || 'Projekat',
                                projectId: project.Project_ID,
                                hint: `${count} ${plural(count, 'proizvod', 'proizvoda', 'proizvoda')}`,
                            }))}
                            onPick={onCreateWorkOrder}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
