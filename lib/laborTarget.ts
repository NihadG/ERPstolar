// ════════════════════════════════════════════════════════════════════
// CILJ TROŠKA RADA — čista logika (bez Firebase, pokrivena testovima).
//
// "Razni poslovi" (custom stavke, Item_Type='custom') mogu biti POVEZANI s
// stvarnim proizvodom (Linked_Item_ID). Kad radnik knjiži rad na takav zadatak,
// trošak (work log) NE ostaje na zadatku nego se upisuje na POVEZANI proizvod —
// pa svi prikazi profita (kartica projekta, nalog, analitika) taj rad uračunaju
// u trošak tog proizvoda, koliko god ga bude (i za već završene proizvode; rad
// nije zamrznut kao materijal).
//
// Log se dodatno "žigoše" izvornim zadatkom (Source_Work_Order_ID /
// Source_Work_Order_Item_ID) da bi Knjiga rada izvornog naloga mogla te logove
// pronaći i očistiti pri ponovnom snimanju (clean-slate), iako fizički žive na
// nalogu povezanog proizvoda.
// ════════════════════════════════════════════════════════════════════

export interface LaborTargetItem {
    ID: string;
    Work_Order_ID?: string;
    Product_ID?: string;
    Product_Name?: string;
    Item_Type?: 'product' | 'custom';
    Linked_Item_ID?: string;
}

export interface ResolvedLaborTarget<T extends LaborTargetItem> {
    /** Stavka na koju se upisuje trošak (povezani proizvod, ili sama stavka). */
    target: T;
    /** Da li je došlo do preusmjeravanja (custom zadatak → povezani proizvod). */
    redirected: boolean;
    /** Izvorni (custom) zadatak — postoji samo kad je redirected=true. */
    source?: T;
}

/**
 * Odredi CILJNU stavku za trošak rada. Custom zadatak s Linked_Item_ID koji
 * pokazuje na postojeću stavku → trošak ide na tu (povezanu) stavku. Inače →
 * sama stavka. Ako veza pokazuje na nepostojeću stavku (obrisanu), pada nazad
 * na sam zadatak (ne gubimo trošak).
 */
export function resolveLaborCostTarget<T extends LaborTargetItem>(
    item: T,
    byId: Map<string, T>
): ResolvedLaborTarget<T> {
    if (item.Item_Type === 'custom' && item.Linked_Item_ID) {
        const linked = byId.get(item.Linked_Item_ID);
        if (linked) return { target: linked, redirected: true, source: item };
    }
    return { target: item, redirected: false };
}
