// ════════════════════════════════════════════════════════════════════
// KOMANDNI CENTAR — NARUDŽBA IZ ODABRANIH MATERIJALA
//
// U Proizvodi kontejneru materijali se biraju DIREKTNO s proizvoda, pa
// nisu vezani ni za jedan radni nalog. Postojeći put (buildMaterialOrderPlan
// → createSelectedMaterialOrders) polazi od naloga i ovdje ne može poslužiti.
//
// Zato ovdje stoji ISTA računica pokrivenosti kao u buildMaterialOrderPlan
// (lib/database.ts) i isti izlazni oblik (MaterialOrderPlanGroup), da modal
// i upis u bazu ostanu nepromijenjeni — mijenja se samo odakle plan dolazi.
//
// Sve je čisto: ulaz su projekti iz memorije, izlaz je plan. Bez baze.
// ════════════════════════════════════════════════════════════════════

import type { Project, ProductMaterial } from '../types';
import type { MaterialOrderPlanGroup } from '../database';

const UNKNOWN_SUPPLIER = 'Nepoznat dobavljač';
const alphabet = new Intl.Collator('bs', { numeric: true, sensitivity: 'base' });

/** Materijal proizvoda obogaćen kontekstom projekta i računicom pokrivenosti. */
export interface CommandMaterialRow extends ProductMaterial {
    projectId: string;
    projectName: string;
    productId: string;
    productName: string;
    /** Naziv materijala (kratko ime za sortiranje i prikaz). */
    name: string;
    /** Ukupno potrebno = količina po komadu × količina proizvoda. */
    needed: number;
    /** Nedostaje za rad (na stanju + primljeno pokrivaju) — NE računa naručeno. */
    remaining: number;
    /** Koliko još treba NARUČITI (naručeno se ovdje računa kao pokriveno). */
    toOrder: number;
    /** Može li se ovaj red uopšte naručiti sada. */
    orderable: boolean;
}

/**
 * Svi materijali projekata s table, s računicom. `Status` i količine se ne
 * diraju — samo se izvodi šta nedostaje.
 */
export function commandMaterialRows(projects: Project[]): CommandMaterialRow[] {
    const rows: CommandMaterialRow[] = [];
    for (const project of projects) {
        for (const product of project.products || []) {
            const multiplier = product.Quantity > 0 ? product.Quantity : 1;
            for (const material of product.materials || []) {
                const needed = (material.Quantity || 0) * multiplier;
                const onStock = material.On_Stock || 0;
                const ordered = material.Ordered_Quantity || 0;
                const received = material.Received_Quantity || 0;
                const covered = material.Status === 'Primljeno' || material.Status === 'Na stanju'
                    || (material.Status === 'Naručeno' && !!material.Order_ID);
                const toOrder = needed - onStock - ordered - received;
                rows.push({
                    ...material,
                    projectId: project.Project_ID,
                    projectName: project.Name || project.Client_Name || 'Projekat',
                    productId: product.Product_ID,
                    productName: product.Name || 'Proizvod',
                    name: material.Material_Name,
                    needed,
                    remaining: Math.max(0, needed - onStock - received),
                    toOrder: Math.max(0, toOrder),
                    orderable: !covered && toOrder > 0,
                });
            }
        }
    }
    return rows;
}

/**
 * Odabrani redovi → plan grupisan po dobavljaču, spreman za
 * MaterialOrderSelectModal i za upis kroz createOrdersFromMaterialSelection.
 *
 * Redovi koji se u međuvremenu više ne mogu naručiti se TIHO ispuštaju —
 * isto ponašanje kao createSelectedMaterialOrders (ne ruši se zbog toga što
 * je neko drugi u međuvremenu naručio materijal).
 */
export function planFromSelection(rows: CommandMaterialRow[], selectedIds: Iterable<string>): MaterialOrderPlanGroup[] {
    const wanted = new Set(selectedIds);
    const bySupplier = new Map<string, MaterialOrderPlanGroup>();
    for (const row of rows) {
        if (!row.orderable || !wanted.has(row.ID)) continue;
        const supplierName = row.Supplier || UNKNOWN_SUPPLIER;
        const group = bySupplier.get(supplierName) || { supplierName, materials: [] };
        group.materials.push({
            productMaterialId: row.ID,
            materialName: row.Material_Name,
            quantity: row.toOrder,
            unit: row.Unit,
            unitPrice: row.Unit_Price || 0,
            productId: row.productId,
            productName: row.productName,
            projectId: row.projectId,
        });
        bySupplier.set(supplierName, group);
    }
    return Array.from(bySupplier.values())
        .sort((a, b) => alphabet.compare(a.supplierName, b.supplierName))
        .map(group => ({
            ...group,
            materials: group.materials.sort((a, b) => alphabet.compare(a.materialName, b.materialName)),
        }));
}

/** Ukupna vrijednost plana — isti izraz kao Total_Amount pri upisu narudžbe. */
export function planTotal(groups: MaterialOrderPlanGroup[]): number {
    return groups.reduce((sum, g) => sum + g.materials.reduce((s, m) => s + m.quantity * m.unitPrice, 0), 0);
}
