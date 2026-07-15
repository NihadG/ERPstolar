// ════════════════════════════════════════════════════════════════════
// ZAKLJUČAVANJE PONUDE PO REDU
//
// Prije: cijela ponuda se zaključavala kad je Poslano/Prihvaćeno (editLocked),
// s dugmadima "Otključaj izmjenu" / "Revidiraj" / "Ažuriraj cijene" na CIJELOJ
// ponudi — konfuzno, i sukobljeno sa inkrementalnim tokom (korisnik dopunjava
// ponudu proizvod-po-proizvod dok kreira naloge za već definisane proizvode).
//
// Sada: SVAKI RED se zaključava nezavisno — red koji već ima cijenu (Selling_Price
// ili Total_Price > 0) u poslanoj/prihvaćenoj ponudi je zaključan (izmjena samo
// kroz Revidiraj); prazan red (0 KM, nedefinisan proizvod) ostaje editabilan i
// nakon snimanja. Nema više "otključaj cijelu ponudu" — samo eksplicitni izuzetak
// (unlockProductIds) za rješavanje konflikata (duplo prihvaćen proizvod).
// ════════════════════════════════════════════════════════════════════

export interface OfferProductLockFields {
    Selling_Price?: number;
    Total_Price?: number;
}

/** Red je zaključan ako ponuda ima status Poslano/Prihvaćeno I red već ima cijenu. */
export function isRowLocked(offerStatus: string | undefined, p: OfferProductLockFields): boolean {
    if (offerStatus !== 'Poslano' && offerStatus !== 'Prihvaćeno') return false;
    return (p.Selling_Price || 0) > 0 || (p.Total_Price || 0) > 0;
}

export interface OfferProductMergeResult<TExisting, TIncoming> {
    /** Postojeći redovi koji su ZAKLJUČANI — ostaju netaknuti (ni podaci ni extras se ne diraju). */
    toKeep: TExisting[];
    /** Postojeći redovi koji su OTKLJUČANI — update-in-place (isti doc ID, extras se zamjenjuju). */
    toUpdate: { existingId: string; incoming: TIncoming }[];
    /** Redovi kojih nema u postojećoj ponudi — kreiraju se novi. */
    toCreate: TIncoming[];
    /** Postojeći ID-evi odsutni iz incoming-a, ALI SAMO ako su bili otključani (korisnik ih je uklonio). */
    toDeleteIds: string[];
}

/**
 * Spoji postojeće offer_products (iz baze) sa incoming (iz editora), poštujući
 * zaključavanje po redu. Server-side enforcement — čak i stale/kompromitovan klijent
 * ne može promijeniti podatke zaključanog reda (merge ih jednostavno ignoriše).
 *
 * `unlockProductIds` — eksplicitni izuzetak (npr. rješavanje konflikta duplo prihvaćenog
 * proizvoda): ti Product_ID-evi se tretiraju kao otključani bez obzira na cijenu/status.
 */
export function mergeOfferProducts<
    TExisting extends { ID: string; Product_ID: string } & OfferProductLockFields,
    TIncoming extends { Product_ID: string }
>(
    existing: TExisting[],
    incoming: TIncoming[],
    offerStatus: string | undefined,
    opts?: { unlockProductIds?: Set<string> }
): OfferProductMergeResult<TExisting, TIncoming> {
    const unlock = opts?.unlockProductIds;
    const locked = (row: OfferProductLockFields, productId: string): boolean =>
        isRowLocked(offerStatus, row) && !unlock?.has(productId);

    const existingByProduct = new Map(existing.map(e => [e.Product_ID, e]));
    const incomingProductIds = new Set(incoming.map(i => i.Product_ID));

    const toKeep: TExisting[] = [];
    const toUpdate: { existingId: string; incoming: TIncoming }[] = [];
    const toCreate: TIncoming[] = [];
    const toDeleteIds: string[] = [];

    for (const inc of incoming) {
        const ex = existingByProduct.get(inc.Product_ID);
        if (!ex) { toCreate.push(inc); continue; }
        if (locked(ex, inc.Product_ID)) toKeep.push(ex);
        else toUpdate.push({ existingId: ex.ID, incoming: inc });
    }
    for (const ex of existing) {
        if (incomingProductIds.has(ex.Product_ID)) continue; // već obrađen gore
        if (locked(ex, ex.Product_ID)) toKeep.push(ex);
        else toDeleteIds.push(ex.ID);
    }
    return { toKeep, toUpdate, toCreate, toDeleteIds };
}
