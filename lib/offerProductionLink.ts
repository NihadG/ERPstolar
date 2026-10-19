// ════════════════════════════════════════════════════════════════════
// PONUDA ↔ PROIZVODNJA — proizvod smije u nalog PRIJE ponude.
// Čista logika (bez Firebase), pokrivena testovima: lib/__tests__/offerProductionLink.test.ts
//
// Nalog i ponuda se vežu preko Product_ID-a, ne preko redoslijeda: proizvod može ući
// u proizvodnju (pa i završiti) prije nego što je ponuda napravljena ili prihvaćena.
// Kad klijent kasnije prihvati ponudu:
//   • profit (lib/projectFinance) odmah čita cijenu iz te ponude — i za proizvode u
//     izradi i za već završene (nema zamrzavanja);
//   • ogledala na stavkama naloga (Product_Value, plan rada) se osvježe i na završenim
//     nalozima (database.ts → resyncWorkOrdersFromOffer);
//   • status projekta ide na 'Odobreno' SAMO ako proizvodnja još nije krenula —
//     projekat 'U proizvodnji' / 'Završeno' ostaje gdje jeste;
//   • upit „Kreiraj radni nalog?" nudi samo ono što još NIJE u nalogu, a za ostalo
//     pokazuje s kojim nalozima je ponuda povezana.
// ════════════════════════════════════════════════════════════════════

export interface OfferWithProducts<P> {
    Status?: string;
    Accepted_Date?: string;
    Created_Date?: string;
    products?: P[];
}

/**
 * Stavka PRIHVAĆENE ponude za proizvod. Projekat može imati više prihvaćenih ponuda
 * (faze) — uzima se ona u kojoj je proizvod uključen, novije prihvaćena ima prednost
 * (isto pravilo kao buildFinanceBasis u lib/projectFinance.ts).
 */
export function acceptedOfferProduct<P extends { Product_ID?: string; Included?: boolean }>(
    offers: OfferWithProducts<P>[] | null | undefined,
    productId: string,
): P | undefined {
    const accepted = (offers || [])
        .filter(o => o.Status === 'Prihvaćeno')
        .sort((a, b) => (b.Accepted_Date || b.Created_Date || '').localeCompare(a.Accepted_Date || a.Created_Date || ''));
    for (const o of accepted) {
        const hit = (o.products || []).find(p => p.Product_ID === productId && p.Included !== false);
        if (hit) return hit;
    }
    return undefined;
}

/** Statusi projekta prije proizvodnje — iz njih prihvaćena ponuda vodi na 'Odobreno'. */
const BEFORE_PRODUCTION = ['Nacrt', 'Ponuđeno', 'Otkazano'];

/**
 * Status projekta nakon prihvatanja ponude; `null` = ne diraj. Ponuda prihvaćena dok je
 * proizvodnja već u toku (ili gotova) ne smije vratiti projekat nazad na 'Odobreno'.
 */
export function projectStatusOnOfferAccepted(current: string | null | undefined): 'Odobreno' | null {
    if (!current || BEFORE_PRODUCTION.includes(current)) return 'Odobreno';
    return null;
}

// ── Veza prihvaćene ponude s nalozima ─────────────────────────────────

export interface LinkOfferProduct {
    Product_ID?: string;
    Product_Name?: string;
    Quantity?: number;
    Included?: boolean;
}
export interface LinkItem {
    Product_ID?: string;
    Quantity?: number;
    Status?: string;
    Work_Order_ID?: string;
    Item_Type?: string;
}
export interface LinkWorkOrder {
    Work_Order_ID: string;
    Work_Order_Number?: string;
    Status?: string;
    Work_Order_Type?: string;
}

export interface LinkedProduct {
    productId: string;
    productName: string;
    offerQty: number;
    /** Σ količina u neotkazanim proizvodnim nalozima. */
    inProductionQty: number;
    /** Sve stavke završene i pokrivaju količinu iz ponude. */
    finished: boolean;
    workOrderNumbers: string[];
}

export interface OfferProductionLink {
    /** Proizvodi ponude koji su VEĆ u proizvodnji — profit ih od sada računa po ponudi. */
    linked: LinkedProduct[];
    /** Proizvodi (ili ostatak količine) koji još nisu ni u jednom nalogu. */
    toStart: { productId: string; productName: string; quantity: number }[];
}

/**
 * Koji proizvodi prihvaćene ponude su već u proizvodnji, a koji tek trebaju nalog.
 * Broje se samo proizvodne stavke neotkazanih naloga (montaža i razni posao ne troše
 * količinu proizvoda — ista aritmetika kao guard količine u čarobnjaku naloga).
 */
export function linkOfferToProduction(
    offerProducts: LinkOfferProduct[],
    items: LinkItem[],
    workOrders: LinkWorkOrder[],
): OfferProductionLink {
    const woById = new Map(workOrders.map(w => [w.Work_Order_ID, w]));
    const byProduct = new Map<string, { qty: number; allDone: boolean; numbers: string[] }>();
    for (const it of items) {
        if (!it.Product_ID || it.Item_Type === 'custom') continue;
        const wo = it.Work_Order_ID ? woById.get(it.Work_Order_ID) : undefined;
        if (!wo || wo.Status === 'Otkazano' || wo.Work_Order_Type === 'Montaža') continue;
        const acc = byProduct.get(it.Product_ID) || { qty: 0, allDone: true, numbers: [] };
        acc.qty += it.Quantity || 0;
        acc.allDone = acc.allDone && it.Status === 'Završeno';
        const num = wo.Work_Order_Number || '';
        if (num && !acc.numbers.includes(num)) acc.numbers.push(num);
        byProduct.set(it.Product_ID, acc);
    }

    const linked: LinkedProduct[] = [];
    const toStart: OfferProductionLink['toStart'] = [];
    const seen = new Set<string>();
    for (const op of offerProducts) {
        if (op.Included === false || !op.Product_ID || seen.has(op.Product_ID)) continue;
        seen.add(op.Product_ID);
        const offerQty = op.Quantity && op.Quantity > 0 ? op.Quantity : 1;
        const productName = op.Product_Name || 'Proizvod';
        const prod = byProduct.get(op.Product_ID);
        const inProductionQty = prod?.qty || 0;
        if (prod && inProductionQty > 0) {
            linked.push({
                productId: op.Product_ID,
                productName,
                offerQty,
                inProductionQty,
                finished: prod.allDone && inProductionQty + 1e-9 >= offerQty,
                workOrderNumbers: prod.numbers,
            });
        }
        const remaining = offerQty - inProductionQty;
        if (remaining > 1e-9) toStart.push({ productId: op.Product_ID, productName, quantity: remaining });
    }
    return { linked, toStart };
}
