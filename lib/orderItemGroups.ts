// ════════════════════════════════════════════════════════════════════
// STAVKE NARUDŽBE GRUPISANE PO MATERIJALU
//
// Narudžba nosi jednu stavku PO MATERIJALU PROIZVODA: isti „Iveral bijeli
// 18mm" na tri pozicije = tri reda. Dobavljaču to ništa ne znači — on isporučuje
// ukupnu količinu jednog materijala. Zato pregled narudžbe, PDF i Komandni
// centar prikazuju JEDAN red po materijalu (zbir količine), abecednim redom,
// a pozicije ostaju vidljive kao razrada ispod reda.
//
// Wizard u tabu Narudžbe već spaja iste materijale pri kreiranju, ali samo po
// DOSLOVNO istom nazivu; narudžbe iz Komandnog centra i one predložene nakon
// kreiranja naloga uopšte ne spajaju. Grupisanje ovdje je prikazno — podaci
// (i prijem po stavci) ostaju netaknuti.
//
// Ključ grupe: naziv (bez razlike u velikim slovima, razmacima i dijakritici)
// + jedinica. Isti naziv u različitim jedinicama (m² vs kom) NIJE isti red —
// zbir takvih količina nema smisla.
// ════════════════════════════════════════════════════════════════════

import type { OrderItem, Project } from './types';
import type { OrderPricing } from './orderPricing';
import { normalizeForSearch } from './searchMatch';

const collator = new Intl.Collator('bs', { numeric: true, sensitivity: 'base' });

/** Poredak naziva materijala — abeceda, prirodno za brojeve (8mm < 18mm). */
export const compareMaterialNames = (a: string, b: string): number => collator.compare(a, b);

export type OrderGroupStatus = 'open' | 'partial' | 'received';

export interface OrderItemGroup {
    key: string;
    /** Naziv za prikaz (kako je upisan na prvoj stavci grupe). */
    name: string;
    unit: string;
    /** Σ naručene količine svih stavki grupe. */
    quantity: number;
    /** Σ primljene količine. */
    receivedQuantity: number;
    /** Stavke grupe, poredane po poziciji — izvor za prijem/poništenje. */
    items: OrderItem[];
    /** Pozicije (proizvodi) kojima materijal ide, bez ponavljanja. */
    productNames: string[];
    receivedCount: number;
    status: OrderGroupStatus;
}

/** Normalizovan ključ — „Iveral  Bijeli 18mm" i „iveral bijeli 18mm" su isto. */
export function materialGroupKey(name: string | undefined, unit: string | undefined): string {
    return `${normalizeForSearch(name)}||${normalizeForSearch(unit)}`;
}

/** Zaokruži zbir količina (0.1 + 0.2 ne smije ispasti 0.30000000000000004). */
export function roundQty(n: number): number {
    return Math.round((n || 0) * 1000) / 1000;
}

/** Količina za prikaz — cijeli broj bez decimala, inače do dvije. */
export function formatQty(n: number): string {
    const r = roundQty(n);
    return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '');
}

type ProductNamesOf = (item: OrderItem) => string[];

const defaultProductNames: ProductNamesOf = item => (item.Product_Name ? [item.Product_Name] : []);

/**
 * Grupiši stavke po materijalu. Grupe su abecedne; stavke unutar grupe po
 * nazivu pozicije.
 *
 * @param productNamesOf pozicije kojima stavka ide. Stavka koju je wizard već
 *   spojio pri kreiranju nosi više materijala (Product_Material_IDs), a samo
 *   ime PRVOG proizvoda — vidi `productNamesResolver`.
 */
export function groupOrderItems(items: OrderItem[] | undefined, productNamesOf: ProductNamesOf = defaultProductNames): OrderItemGroup[] {
    const groups = new Map<string, OrderItemGroup>();
    for (const item of items || []) {
        const key = materialGroupKey(item.Material_Name, item.Unit);
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                name: (item.Material_Name || '').trim() || 'Materijal',
                unit: (item.Unit || '').trim(),
                quantity: 0,
                receivedQuantity: 0,
                items: [],
                productNames: [],
                receivedCount: 0,
                status: 'open',
            };
            groups.set(key, group);
        }
        group.items.push(item);
        group.quantity += item.Quantity || 0;
        group.receivedQuantity += item.Received_Quantity || 0;
        if (item.Status === 'Primljeno') group.receivedCount++;
        for (const name of productNamesOf(item)) {
            if (name && !group.productNames.includes(name)) group.productNames.push(name);
        }
    }

    return Array.from(groups.values())
        .map(group => {
            group.quantity = roundQty(group.quantity);
            group.receivedQuantity = roundQty(group.receivedQuantity);
            group.items.sort((a, b) => collator.compare(a.Product_Name || '', b.Product_Name || ''));
            group.productNames.sort(collator.compare);
            group.status = group.receivedCount === 0 ? 'open'
                : group.receivedCount === group.items.length ? 'received' : 'partial';
            return group;
        })
        .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.unit, b.unit));
}

/** Ukupna i jedinična cijena grupe — ista normalizacija kao pojedinačna stavka. */
export function groupPricing(group: OrderItemGroup, pricing: OrderPricing): { total: number; unitPrice: number } {
    const total = group.items.reduce((sum, item) => sum + pricing.lineTotal(item), 0);
    return { total, unitPrice: group.quantity > 0 ? total / group.quantity : 0 };
}

/**
 * Pozicije stavke iz projekata: stavka spojena pri kreiranju nosi sve
 * materijale u Product_Material_IDs, pa se imena traže po njima. Bez projekata
 * (ili kad materijal više ne postoji) pada na Product_Name stavke.
 */
export function productNamesResolver(projects: Project[] | undefined): ProductNamesOf {
    const byMaterialId = new Map<string, string>();
    for (const project of projects || []) {
        for (const product of project.products || []) {
            for (const material of product.materials || []) {
                if (material.ID) byMaterialId.set(material.ID, product.Name);
            }
        }
    }
    return item => {
        const ids = item.Product_Material_IDs?.length ? item.Product_Material_IDs : [item.Product_Material_ID];
        const names = ids.map(id => (id ? byMaterialId.get(id) : undefined)).filter((n): n is string => !!n);
        if (names.length > 0) return Array.from(new Set(names));
        return item.Product_Name ? [item.Product_Name] : [];
    };
}

/** Stavka PLANA narudžbe (prije upisa) — oblik MaterialOrderPlanItem iz baze. */
interface PlanMaterialLike {
    productMaterialId: string;
    materialName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    productName: string;
}

export interface PlanMaterialGroup<T extends PlanMaterialLike> {
    key: string;
    name: string;
    unit: string;
    quantity: number;
    total: number;
    /** productMaterialId svih stavki — izbor u modalu ide po njima. */
    ids: string[];
    productNames: string[];
    materials: T[];
}

/**
 * Plan narudžbe (MaterialOrderSelectModal) po materijalu — isto pravilo kao
 * gotova narudžba, da ono što korisnik bira izgleda kao ono što će dobiti.
 */
export function groupPlanMaterials<T extends PlanMaterialLike>(materials: T[]): PlanMaterialGroup<T>[] {
    const groups = new Map<string, PlanMaterialGroup<T>>();
    for (const m of materials) {
        const key = materialGroupKey(m.materialName, m.unit);
        let group = groups.get(key);
        if (!group) {
            group = {
                key, name: (m.materialName || '').trim() || 'Materijal', unit: (m.unit || '').trim(),
                quantity: 0, total: 0, ids: [], productNames: [], materials: [],
            };
            groups.set(key, group);
        }
        group.materials.push(m);
        group.ids.push(m.productMaterialId);
        group.quantity += m.quantity || 0;
        group.total += (m.quantity || 0) * (m.unitPrice || 0);
        if (m.productName && !group.productNames.includes(m.productName)) group.productNames.push(m.productName);
    }
    return Array.from(groups.values())
        .map(g => ({ ...g, quantity: roundQty(g.quantity), productNames: [...g.productNames].sort(collator.compare) }))
        .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.unit, b.unit));
}

/** „Klupe, L-klupa +2" — kratka razrada pozicija za jedan red. */
export function productNamesLabel(names: string[], max = 2): string {
    if (names.length <= max) return names.join(', ');
    return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}
