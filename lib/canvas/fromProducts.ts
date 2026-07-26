// ════════════════════════════════════════════════════════════════════
// PLATNO — IZ PROIZVODA U BLOKOVE
//
// Most između stvarnih podataka i platna. Čita projekte/ponude/naloge (nikad ne
// piše) i pretvara ih u ono što platnu treba:
//
//   1. Koji proizvodi su SLOBODNI za planiranje (nisu već u nalozima)
//   2. Koliko RADNIK-DANA nose po ponudi  → trajanje = radnik-dani ÷ ekipa
//   3. Koji MATERIJALI im trebaju, grupisani po dobavljaču → narudžbe
//
// Ovo je razlog zašto se ne mora ništa ručno prekucavati: ponuda već zna
// „2 radnika × 2 dana", pa ako na platnu staviš 4 radnika, nalog traje 1 dan.
// ════════════════════════════════════════════════════════════════════

import type { Project, Product, WorkOrder, PlanBlock, PlanProductRef } from '../types';
import { materialTypesFromName } from '../productProcesses';

export interface ProductCandidate {
    productId: string;
    productName: string;
    projectId: string;
    projectName: string;
    /** Ukupna količina iz projekta. */
    totalQty: number;
    /** Već raspoređeno kroz NE-otkazane naloge. */
    usedQty: number;
    /** Ono što se još može planirati. */
    availableQty: number;
    /** Dani iz ponude (bez množenja radnicima). */
    laborDays: number;
    laborWorkers: number;
    /** laborDays × laborWorkers × količina — jedinica kojom platno računa trajanje. */
    workerDaysPerUnit: number;
    materialCount: number;
    /** Ima li ijedan esencijalni materijal — takva narudžba gate-uje početak. */
    hasEssential: boolean;
    status: string;
    /** Nema podatka o radu u ponudi → trajanje se mora unijeti ručno. */
    missingLabor: boolean;
}

/** Iskorištena količina kroz sve NE-otkazane naloge — isti kriterij kao WorkOrderWizard. */
function usedQuantityForProduct(workOrders: WorkOrder[], productId: string): number {
    let used = 0;
    for (const wo of workOrders) {
        if (wo.Status === 'Otkazano') continue;
        for (const item of wo.items || []) {
            if (item.Product_ID === productId) used += item.Quantity || 0;
        }
    }
    return used;
}

/**
 * Rad iz ponude za proizvod. Traži se PRIHVAĆENA ponuda projekta; ako je nema,
 * uzima se bilo koja koja sadrži taj proizvod (nacrt je bolji od ničega, a
 * `missingLabor` kaže koliko se tome vjeruje).
 */
function laborFromOffers(project: Project, productId: string): { days: number; workers: number } {
    const offers = project.offers || [];
    const accepted = offers.filter(o => o.Status === 'Prihvaćeno');
    const pools = [accepted, offers];

    for (const pool of pools) {
        for (const offer of pool) {
            const op = (offer.products || []).find(p => p.Product_ID === productId);
            if (op && (op.Labor_Days || op.Labor_Workers)) {
                return { days: op.Labor_Days || 0, workers: op.Labor_Workers || 0 };
            }
        }
    }
    return { days: 0, workers: 0 };
}

/**
 * Svi proizvodi koji se mogu planirati, s podacima potrebnim za odluku.
 *
 * `appState.products` je UVIJEK prazan niz — proizvodi žive ugniježdeni u
 * `projects[].products[]` (getProjects sastavlja cijeli graf). Zato se čita odatle.
 */
export function collectProductCandidates(
    projects: Project[],
    workOrders: WorkOrder[]
): ProductCandidate[] {
    const out: ProductCandidate[] = [];

    for (const project of projects || []) {
        if (project.Hidden) continue;
        const projectName = project.Name?.trim() || project.Client_Name || 'Bez naziva';

        for (const product of project.products || []) {
            const totalQty = product.Quantity || 0;
            const usedQty = usedQuantityForProduct(workOrders, product.Product_ID);
            const labor = laborFromOffers(project, product.Product_ID);
            const materials = product.materials || [];

            out.push({
                productId: product.Product_ID,
                productName: product.Name,
                projectId: project.Project_ID,
                projectName,
                totalQty,
                usedQty,
                availableQty: Math.max(0, totalQty - usedQty),
                laborDays: labor.days,
                laborWorkers: labor.workers,
                workerDaysPerUnit: labor.days * Math.max(1, labor.workers || 1),
                materialCount: materials.length,
                hasEssential: materials.some(m => m.Is_Essential),
                status: product.Status || '',
                missingLabor: labor.days <= 0,
            });
        }
    }

    return out.sort((a, b) =>
        a.projectName.localeCompare(b.projectName, 'hr')
        || a.productName.localeCompare(b.productName, 'hr'));
}

export interface CandidateGroup {
    projectId: string;
    projectName: string;
    items: ProductCandidate[];
    /** Zbir radnik-dana slobodnih količina — koliko posla projekt još nosi. */
    availableWorkerDays: number;
}

/** Grupisano po projektu — tako korisnik i razmišlja o poslu. */
export function groupCandidatesByProject(
    candidates: ProductCandidate[],
    opts?: { onlyAvailable?: boolean; search?: string }
): CandidateGroup[] {
    const q = (opts?.search || '').trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];

    const filtered = candidates.filter(c => {
        if (opts?.onlyAvailable && c.availableQty <= 0) return false;
        if (terms.length === 0) return true;
        const hay = `${c.productName} ${c.projectName} ${c.status}`.toLowerCase();
        return terms.every(t => hay.includes(t));
    });

    const byProject = new Map<string, CandidateGroup>();
    for (const c of filtered) {
        const g = byProject.get(c.projectId)
            || { projectId: c.projectId, projectName: c.projectName, items: [], availableWorkerDays: 0 };
        g.items.push(c);
        g.availableWorkerDays += c.workerDaysPerUnit * c.availableQty;
        byProject.set(c.projectId, g);
    }

    return Array.from(byProject.values())
        .map(g => ({ ...g, availableWorkerDays: Math.round(g.availableWorkerDays * 100) / 100 }))
        .sort((a, b) => a.projectName.localeCompare(b.projectName, 'hr'));
}

// ════════════════════════════════════════════════════════════════════
// PROIZVODI → BLOK NALOGA
// ════════════════════════════════════════════════════════════════════

export interface SelectedProduct {
    candidate: ProductCandidate;
    qty: number;
}

/**
 * Podaci bloka iz izabranih proizvoda.
 *
 * Radnik-dani se ZBRAJAJU po ponudi (dani × radnici × količina). Ekipa je odvojena
 * odluka: 4 radnik-dana s 4 čovjeka = 1 dan, s 2 čovjeka = 2 dana. Zato platno
 * računa trajanje iz `workerDays ÷ crew`, a ne iz „dana iz ponude" direktno.
 */
export function blockDataFromProducts(selected: SelectedProduct[]): {
    title: string;
    productRefs: PlanProductRef[];
    workerDays: number;
    projectRef?: { id: string; name: string };
    missingLaborCount: number;
} {
    const productRefs: PlanProductRef[] = selected.map(s => ({
        id: s.candidate.productId,
        name: s.candidate.productName,
        qty: s.qty,
    }));

    const workerDays = Math.round(
        selected.reduce((sum, s) => sum + s.candidate.workerDaysPerUnit * s.qty, 0) * 100
    ) / 100;

    // Svi iz istog projekta → blok naslijedi projekt; iz više projekata → bez projekta,
    // jer bi bilo koji izbor bio proizvoljan.
    const projectIds = new Set(selected.map(s => s.candidate.projectId));
    const projectRef = projectIds.size === 1 && selected[0]
        ? { id: selected[0].candidate.projectId, name: selected[0].candidate.projectName }
        : undefined;

    const title = selected.length === 0
        ? 'Nalog'
        : selected.length === 1
            ? selected[0].candidate.productName
            : projectRef
                ? `${projectRef.name} — ${selected.length} proizvoda`
                : `${selected.length} proizvoda`;

    return {
        title,
        productRefs,
        workerDays,
        projectRef,
        missingLaborCount: selected.filter(s => s.candidate.missingLabor).length,
    };
}

// ════════════════════════════════════════════════════════════════════
// PROIZVODI → NARUDŽBE MATERIJALA
// ════════════════════════════════════════════════════════════════════

export interface PlanMaterialLine {
    materialId: string;
    name: string;
    quantity: number;
    unit: string;
    totalPrice: number;
    productName: string;
    isEssential: boolean;
    /** Status u stvarnoj bazi — da se ne planira ponovo ono što je već naručeno. */
    status: string;
    materialTypes: string[];
}

export interface MaterialSupplierGroup {
    supplierKey: string;
    supplierName: string;
    lines: PlanMaterialLine[];
    totalPrice: number;
    /** Ijedan esencijalni → narudžba gate-uje početak proizvodnje. */
    hasEssential: boolean;
}

/** Materijali koji NE trebaju novu narudžbu (već su tu ili već naručeni). */
const SETTLED = new Set(['Primljeno', 'Na stanju']);

/**
 * Sastavnice izabranih proizvoda, grupisane po dobavljaču.
 *
 * `includeSettled` po defaultu ISKLJUČUJE ono što je već primljeno ili na stanju —
 * planirati narudžbu za materijal koji je već u radionici je čist šum.
 */
export function groupMaterialsForProducts(
    projects: Project[],
    productIds: string[],
    opts?: { includeSettled?: boolean; supplierFilter?: string; typeFilter?: string }
): MaterialSupplierGroup[] {
    const wanted = new Set(productIds);
    const groups = new Map<string, MaterialSupplierGroup>();

    for (const project of projects || []) {
        for (const product of project.products || []) {
            if (!wanted.has(product.Product_ID)) continue;

            for (const m of product.materials || []) {
                if (!opts?.includeSettled && SETTLED.has(m.Status)) continue;

                const supplierName = (m.Supplier || '').trim() || 'Nepoznat dobavljač';
                const key = supplierName.toLowerCase();
                if (opts?.supplierFilter && key !== opts.supplierFilter.toLowerCase()) continue;

                const types = materialTypesFromName(m.Material_Name);
                if (opts?.typeFilter && !types.includes(opts.typeFilter)) continue;

                const g = groups.get(key) || {
                    supplierKey: key, supplierName, lines: [], totalPrice: 0, hasEssential: false,
                };
                g.lines.push({
                    materialId: m.ID,
                    name: m.Material_Name,
                    quantity: m.Quantity,
                    unit: m.Unit,
                    totalPrice: m.Total_Price || 0,
                    productName: product.Name,
                    isEssential: !!m.Is_Essential,
                    status: m.Status,
                    materialTypes: types,
                });
                g.totalPrice += m.Total_Price || 0;
                if (m.Is_Essential) g.hasEssential = true;
                groups.set(key, g);
            }
        }
    }

    return Array.from(groups.values())
        .map(g => ({ ...g, totalPrice: Math.round(g.totalPrice * 100) / 100 }))
        .sort((a, b) => b.totalPrice - a.totalPrice || a.supplierName.localeCompare(b.supplierName, 'hr'));
}

/** Svi tipovi materijala prisutni u ponuđenim grupama — za filter. */
export function availableMaterialTypes(groups: MaterialSupplierGroup[]): string[] {
    const set = new Set<string>();
    for (const g of groups) for (const l of g.lines) for (const t of l.materialTypes) set.add(t);
    return Array.from(set).sort();
}

/** Podaci `purchase` bloka iz jedne grupe dobavljača. */
export function purchaseDataFromGroup(
    group: MaterialSupplierGroup,
    supplierId?: string
): Partial<PlanBlock> {
    return {
        title: group.supplierName,
        supplierRef: { id: supplierId, name: group.supplierName },
        materialNames: group.lines.map(l => l.name),
    };
}
