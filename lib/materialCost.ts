/**
 * Trošak materijala — jedinstvena semantika kroz cijelu aplikaciju.
 *
 * INVARIJANTA: `WorkOrderItem.Material_Cost` se u bazi ČUVA PO KOMADU
 * (Σ `ProductMaterial.Total_Price`, jer product_materials opisuju JEDAN komad proizvoda),
 * dok je prihod (`Product_Value`) UKUPAN (jedinična cijena × količina).
 *
 * Zato se trošak materijala množi količinom na SVAKOM mjestu potrošnje (agregacija profita),
 * a nikad se ukupan iznos ne upisuje natrag na stavku. Time je nemoguće dvostruko množenje:
 *   pohranjeno = uvijek PO KOMADU, ukupno = uvijek IZRAČUNATO.
 *
 * (Bug iz PDF-a: 15 stolova × 255 = 3825 u sekciji Materijal, umjesto 255.)
 */

/**
 * Da li je trošak materijala stavke ZAMRZNUT (završena / ikad završena stavka)
 * ili RUČNO unesen (PriceEditModal) — u oba slučaja koristi se POHRANJENA vrijednost po komadu,
 * bez svježeg preračuna iz product_materials.
 */
export function isItemMaterialFrozen(item: {
    Status?: string;
    Completed_At?: string;
    Material_Cost_Source?: string;
}): boolean {
    return item.Status === 'Završeno' || !!item.Completed_At || item.Material_Cost_Source === 'manual';
}

/**
 * Ukupan trošak materijala stavke = trošak PO KOMADU × količina.
 * `quantity` < 1 ili nedostaje → tretira se kao 1 komad.
 */
export function itemMaterialTotal(perUnitCost: number | undefined, quantity: number | undefined): number {
    const q = quantity && quantity > 0 ? quantity : 1;
    return (perUnitCost || 0) * q;
}
