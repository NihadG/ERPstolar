/**
 * offerService.ts — Offer CRUD + accept flow + product management
 * 
 * Extracted from database.ts (functions: getOffers, createOfferWithProducts, 
 * saveOffer, updateOfferWithProducts, deleteOffer, updateOfferStatus, 
 * updateOfferProduct)
 */

import { COLLECTIONS } from '../shared/collections';
import {
    queryByOrg,
    findByIdAndOrg,
    findRef,
    createDoc,
    updateDocByRef,
    getDb,
    query,
    collection,
    where,
    getDocs,
    writeBatch,
    doc,
    deleteDoc,
} from '../shared/firestoreClient';
import { eventBus } from '../eventBus';
import { v4 as uuidv4 } from 'uuid';
import { generateOfferNumber as _generateOfferNumber } from '../shared/idGenerator';
import type { Offer, OfferProduct, OfferExtra } from '../../types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Cijena stavke ponude iz sirovih editor polja — JEDINI izvor istine za
 * Base/Selling/Total_Price pri snimanju. Rabat (Discount_Percent, signed:
 * + popust / − doplata) se OBRAČUNA u neto cijenu, pa svi nizvodni prikazi
 * (profit, računi, nalozi) vide već sniženu cijenu; Base_Selling_Price čuva
 * cijenu prije rabata za razradu na štampi.
 */
export function offerProductPricing(p: any): {
    materialCost: number; margin: number; extrasTotal: number; laborTotal: number;
    quantity: number; discountPercent: number; baseSellingPrice: number;
    sellingPrice: number; totalPrice: number;
} {
    const materialCost = parseFloat(p.Material_Cost) || 0;
    const margin = parseFloat(p.Margin) || 0;
    const extrasTotal = (p.Extras || []).reduce((sum: number, e: any) => sum + (parseFloat(e.total) || 0), 0);
    const laborTotal = (parseFloat(p.Labor_Workers) || 0) * (parseFloat(p.Labor_Days) || 0) * (parseFloat(p.Labor_Daily_Rate) || 0);
    const quantity = parseFloat(p.Quantity) || 1;
    const discountPercent = parseFloat(p.Discount_Percent) || 0;
    const baseSellingPrice = round2(materialCost + margin + extrasTotal + laborTotal);
    const sellingPrice = round2(baseSellingPrice * (1 - discountPercent / 100));
    return {
        materialCost, margin, extrasTotal, laborTotal, quantity, discountPercent,
        baseSellingPrice, sellingPrice, totalPrice: round2(sellingPrice * quantity),
    };
}

// ============================================
// READ
// ============================================

export async function getOffers(organizationId: string): Promise<Offer[]> {
    if (!organizationId) return [];

    const db = getDb();
    const orgFilter = where('Organization_ID', '==', organizationId);

    const [offersSnap, offerProductsSnap, offerExtrasSnap, projectsSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.OFFERS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.OFFER_PRODUCTS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.OFFER_EXTRAS), orgFilter)),
        getDocs(query(collection(db, COLLECTIONS.PROJECTS), orgFilter)),
    ]);

    const offers = offersSnap.docs.map(d => ({ ...d.data() } as Offer));
    const offerProducts = offerProductsSnap.docs.map(d => ({ ...d.data() } as OfferProduct));
    const offerExtras = offerExtrasSnap.docs.map(d => ({ ...d.data() } as OfferExtra));

    // Build project lookup for Client_Name enrichment
    const projectsMap = new Map<string, { Client_Name: string; Client_Phone?: string; Client_Email?: string; Address?: string; Client_Type?: string; Client_ID_Number?: string; Client_PDV_Number?: string }>();
    projectsSnap.docs.forEach(d => {
        const p = d.data();
        projectsMap.set(p.Project_ID, {
            Client_Name: p.Client_Name || '',
            Client_Phone: p.Client_Phone,
            Client_Email: p.Client_Email,
            Address: p.Address,
            Client_Type: p.Client_Type,
            Client_ID_Number: p.Client_ID_Number,
            Client_PDV_Number: p.Client_PDV_Number,
        });
    });

    // Group products by offer
    const productsByOffer = new Map<string, OfferProduct[]>();
    offerProducts.forEach(op => {
        if (!productsByOffer.has(op.Offer_ID)) productsByOffer.set(op.Offer_ID, []);
        productsByOffer.get(op.Offer_ID)!.push(op);
    });

    // Group extras by offer product
    const extrasByProduct = new Map<string, OfferExtra[]>();
    offerExtras.forEach(oe => {
        if (!extrasByProduct.has(oe.Offer_Product_ID)) extrasByProduct.set(oe.Offer_Product_ID, []);
        extrasByProduct.get(oe.Offer_Product_ID)!.push(oe);
    });

    // Assemble: enrich offers with Client_Name and attach products/extras
    offers.forEach(offer => {
        // Enrich with project data — but ONLY if the offer doesn't have its own override
        const proj = projectsMap.get(offer.Project_ID);
        if (proj) {
            // If offer has no explicit client override, use project data
            if (!offer.Client_Name) {
                offer.Client_Name = proj.Client_Name;
            }
            if (!(offer as any).Client_Phone) {
                (offer as any).Client_Phone = proj.Client_Phone || '';
            }
            if (!(offer as any).Client_Email) {
                (offer as any).Client_Email = proj.Client_Email || '';
            }
            if (!(offer as any).Client_Address) {
                (offer as any).Client_Address = proj.Address || '';
            }
            if (!(offer as any).Client_Type) {
                (offer as any).Client_Type = proj.Client_Type || 'fizicko';
            }
            if (!(offer as any).Client_ID_Number) {
                (offer as any).Client_ID_Number = proj.Client_ID_Number || '';
            }
            if (!(offer as any).Client_PDV_Number) {
                (offer as any).Client_PDV_Number = proj.Client_PDV_Number || '';
            }
        }

        const products = productsByOffer.get(offer.Offer_ID) || [];
        products.forEach(p => {
            (p as any).extras = extrasByProduct.get(p.ID) || [];
        });
        (offer as any).products = products;
    });

    return offers;
}

// ============================================
// CREATE
// ============================================

export async function createOfferWithProducts(
    offerData: any,
    organizationId: string
): Promise<{ success: boolean; data?: { Offer_ID: string; Offer_Number: string }; message: string }> {
    if (!organizationId) {
        return { success: false, message: 'Organization ID is required' };
    }

    try {
        const offerId = uuidv4();

        // Query existing offer numbers for sequential numbering
        const db = getDb();
        const existingOffersSnap = await getDocs(
            query(collection(db, COLLECTIONS.OFFERS), where('Organization_ID', '==', organizationId))
        );
        const existingNumbers = existingOffersSnap.docs.map(d => d.data().Offer_Number as string).filter(Boolean);
        const offerNumber = _generateOfferNumber(existingNumbers);

        const products = offerData.products || [];
        const includedProducts = products.filter((p: any) => p.Included);
        if (includedProducts.length === 0) {
            return { success: false, message: 'Označite barem jedan proizvod' };
        }

        // Calculate subtotal (rabat po stavci ubačen u neto cijenu)
        let subtotal = 0;
        includedProducts.forEach((p: any) => {
            subtotal += offerProductPricing(p).totalPrice;
        });

        const transportCost = parseFloat(offerData.Transport_Cost) || 0;
        const discount = offerData.Onsite_Assembly ? (parseFloat(offerData.Onsite_Discount) || 0) : 0;
        const total = subtotal + transportCost - discount;

        let validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        if (offerData.Valid_Until) {
            validUntil = new Date(offerData.Valid_Until).toISOString();
        }

        const offer: Offer = {
            Offer_ID: offerId,
            Organization_ID: organizationId,
            Name: offerData.Name || '',
            Project_ID: offerData.Project_ID,
            Offer_Number: offerNumber,
            Created_Date: new Date().toISOString(),
            Valid_Until: validUntil,
            Status: 'Nacrt',
            Transport_Cost: transportCost,
            Onsite_Assembly: offerData.Onsite_Assembly || false,
            Onsite_Discount: offerData.Onsite_Discount || 0,
            Subtotal: subtotal,
            Total: total,
            Notes: offerData.Notes || '',
            Accepted_Date: '',
            Include_PDV: offerData.Include_PDV ?? true,
            PDV_Rate: offerData.PDV_Rate ?? 17,
            Currency: offerData.Currency || 'KM',
            Language: offerData.Language || 'bs',
            Show_Item_Discounts: offerData.Show_Item_Discounts ?? false,
        };

        const batch = writeBatch(db);

        const offerRef = doc(collection(db, COLLECTIONS.OFFERS));
        batch.set(offerRef, offer);

        for (const product of products) {
            const productId = uuidv4();
            const pricing = offerProductPricing(product);

            const offerProduct: OfferProduct & { Organization_ID: string } = {
                ID: productId,
                Organization_ID: organizationId,
                Offer_ID: offerId,
                Product_ID: product.Product_ID,
                Product_Name: product.Product_Name,
                Quantity: pricing.quantity,
                Included: product.Included === true,
                Material_Cost: pricing.materialCost,
                Margin: pricing.margin,
                Margin_Type: 'Fixed',
                LED_Meters: 0,
                LED_Price: 0,
                LED_Total: 0,
                Grouting: false,
                Grouting_Price: 0,
                Sink_Faucet: false,
                Sink_Faucet_Price: 0,
                Transport_Share: 0,
                Discount_Share: 0,
                Discount_Percent: pricing.discountPercent,
                Base_Selling_Price: pricing.baseSellingPrice,
                Selling_Price: pricing.sellingPrice,
                Total_Price: pricing.totalPrice,
                Labor_Workers: parseFloat(product.Labor_Workers) || 0,
                Labor_Days: parseFloat(product.Labor_Days) || 0,
                Labor_Daily_Rate: parseFloat(product.Labor_Daily_Rate) || 0,
            };

            const prodRef = doc(collection(db, COLLECTIONS.OFFER_PRODUCTS));
            batch.set(prodRef, offerProduct);

            for (const extra of product.Extras || []) {
                const extraData: OfferExtra & { Organization_ID: string } = {
                    ID: uuidv4(),
                    Organization_ID: organizationId,
                    Offer_Product_ID: productId,
                    Name: extra.name,
                    Quantity: parseFloat(extra.qty) || 1,
                    Unit: extra.unit || 'kom',
                    Unit_Price: parseFloat(extra.price) || 0,
                    Total: parseFloat(extra.total) || 0,
                };

                const extraRef = doc(collection(db, COLLECTIONS.OFFER_EXTRAS));
                batch.set(extraRef, extraData);
            }
        }

        await batch.commit();

        return { success: true, data: { Offer_ID: offerId, Offer_Number: offerNumber }, message: 'Ponuda kreirana' };
    } catch (error) {
        console.error('createOfferWithProducts error:', error);
        return { success: false, message: 'Greška pri kreiranju ponude' };
    }
}

// ============================================
// REVIZIJA
// ============================================

/**
 * REVIZIJA ponude: kopira ponudu (s proizvodima i extras) u NOVU 'Nacrt' ponudu s brojem
 * "<original>-R2" (pa -R3…), a original označi 'Revidirano'. Original ostaje netaknut →
 * audit trag šta je poslano klijentu i po kojoj cijeni. Izmjene se dalje rade na reviziji,
 * čime se izbjegava destruktivni edit poslane/prihvaćene ponude (delete+recreate stavki
 * i tihi live-sync cijena na radne naloge u updateOfferWithProducts).
 */
export async function reviseOffer(
    offerId: string,
    organizationId: string
): Promise<{ success: boolean; data?: { Offer_ID: string; Offer_Number: string }; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };

    try {
        const db = getDb();
        const orgFilter = where('Organization_ID', '==', organizationId);

        const offerSnap = await getDocs(query(
            collection(db, COLLECTIONS.OFFERS), where('Offer_ID', '==', offerId), orgFilter
        ));
        if (offerSnap.empty) return { success: false, message: 'Ponuda nije pronađena' };
        const original = offerSnap.docs[0].data() as Offer;

        // Broj revizije: skini postojeći -R sufiks pa nađi prvi slobodan (R2, R3…).
        const baseNumber = (original.Offer_Number || '').replace(/-R\d+$/, '');
        const allSnap = await getDocs(query(collection(db, COLLECTIONS.OFFERS), orgFilter));
        const existing = new Set(allSnap.docs.map(d => d.data().Offer_Number as string).filter(Boolean));
        let rev = 2;
        while (existing.has(`${baseNumber}-R${rev}`)) rev++;
        const newNumber = `${baseNumber}-R${rev}`;

        const [productsSnap] = await Promise.all([
            getDocs(query(collection(db, COLLECTIONS.OFFER_PRODUCTS), where('Offer_ID', '==', offerId), orgFilter)),
        ]);
        const originalProducts = productsSnap.docs.map(d => d.data() as OfferProduct);
        const productIds = originalProducts.map(p => p.ID);

        const extrasByProduct = new Map<string, OfferExtra[]>();
        for (let i = 0; i < productIds.length; i += 30) {
            const chunk = productIds.slice(i, i + 30);
            const extrasSnap = await getDocs(query(
                collection(db, COLLECTIONS.OFFER_EXTRAS), where('Offer_Product_ID', 'in', chunk), orgFilter
            ));
            extrasSnap.docs.forEach(d => {
                const e = d.data() as OfferExtra;
                const list = extrasByProduct.get(e.Offer_Product_ID) || [];
                list.push(e);
                extrasByProduct.set(e.Offer_Product_ID, list);
            });
        }

        const newOfferId = uuidv4();
        const batch = writeBatch(db);

        const newOffer: Offer = {
            ...original,
            Offer_ID: newOfferId,
            Offer_Number: newNumber,
            Status: 'Nacrt',
            Created_Date: new Date().toISOString(),
            Valid_Until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            Accepted_Date: '',
        };
        delete (newOffer as any).products;   // ugniježđeni prikazni podaci se ne pišu u dokument
        batch.set(doc(collection(db, COLLECTIONS.OFFERS)), newOffer);

        for (const p of originalProducts) {
            const newProductId = uuidv4();
            const { extras: _drop, ...plain } = p as OfferProduct & { extras?: unknown };
            batch.set(doc(collection(db, COLLECTIONS.OFFER_PRODUCTS)), {
                ...plain,
                ID: newProductId,
                Offer_ID: newOfferId,
                Organization_ID: organizationId,
            });
            for (const e of extrasByProduct.get(p.ID) || []) {
                batch.set(doc(collection(db, COLLECTIONS.OFFER_EXTRAS)), {
                    ...e,
                    ID: uuidv4(),
                    Offer_Product_ID: newProductId,
                    Organization_ID: organizationId,
                });
            }
        }

        // Original → 'Revidirano' (direktno; ne kroz updateOfferStatus da se ne diraju
        // statusi projekta — revizija ne mijenja stanje projekta).
        batch.update(offerSnap.docs[0].ref, { Status: 'Revidirano' });

        await batch.commit();
        eventBus.emit('offer:statusChanged', { offerId, newStatus: 'Revidirano', organizationId });

        return { success: true, data: { Offer_ID: newOfferId, Offer_Number: newNumber }, message: `Revizija ${newNumber} kreirana` };
    } catch (error) {
        console.error('reviseOffer error:', error);
        return { success: false, message: 'Greška pri kreiranju revizije' };
    }
}

// ============================================
// UPDATE
// ============================================

export async function saveOffer(
    data: Partial<Offer>,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };

    try {
        const ref = await findRef(COLLECTIONS.OFFERS, 'Offer_ID', data.Offer_ID!, organizationId);
        if (!ref) return { success: false, message: 'Ponuda nije pronađena' };

        const { Organization_ID, ...updateData } = data;
        await updateDocByRef(ref, updateData as Record<string, unknown>);

        return { success: true, message: 'Ponuda ažurirana' };
    } catch (error) {
        console.error('saveOffer error:', error);
        return { success: false, message: 'Greška pri spremanju ponude' };
    }
}

/**
 * Full offer update including products and extras.
 * Delegates to database.ts for the complex merge logic.
 */
export async function updateOfferWithProducts(
    offerData: any,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    // Delegate to existing database.ts implementation (complex merge logic)
    const { updateOfferWithProducts: _update } = await import('../../database');
    return _update(offerData, organizationId);
}

// ============================================
// DELETE
// ============================================

export async function deleteOffer(
    offerId: string,
    organizationId: string
): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };

    try {
        const db = getDb();

        // Delete offer products and extras
        const productsQ = query(
            collection(db, COLLECTIONS.OFFER_PRODUCTS),
            where('Offer_ID', '==', offerId),
            where('Organization_ID', '==', organizationId)
        );
        const productsSnap = await getDocs(productsQ);

        if (!productsSnap.empty) {
            const productIds = productsSnap.docs.map(d => d.data().ID);

            // Delete extras for these products
            for (let i = 0; i < productIds.length; i += 30) {
                const chunk = productIds.slice(i, i + 30);
                const extrasQ = query(
                    collection(db, COLLECTIONS.OFFER_EXTRAS),
                    where('Offer_Product_ID', 'in', chunk),
                    where('Organization_ID', '==', organizationId)
                );
                const extrasSnap = await getDocs(extrasQ);
                const batch = writeBatch(db);
                extrasSnap.docs.forEach(d => batch.delete(d.ref));
                if (!extrasSnap.empty) await batch.commit();
            }

            // Delete products
            const batch = writeBatch(db);
            productsSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }

        // Delete offer
        const ref = await findRef(COLLECTIONS.OFFERS, 'Offer_ID', offerId, organizationId);
        if (ref) await deleteDoc(ref);

        return { success: true, message: 'Ponuda obrisana' };
    } catch (error) {
        console.error('deleteOffer error:', error);
        return { success: false, message: 'Greška pri brisanju ponude' };
    }
}

// ============================================
// STATUS MANAGEMENT
// ============================================

/**
 * Update offer status with full conflict detection and acceptance logic.
 * Delegates to database.ts for the complex acceptance flow.
 */
export async function updateOfferStatus(
    offerId: string,
    status: string,
    organizationId: string
): Promise<{ success: boolean; message: string; conflicts?: any[]; conflictingOfferNames?: string[] }> {
    const { updateOfferStatus: _updateStatus } = await import('../../database');
    return _updateStatus(offerId, status, organizationId);
}

// ============================================
// OFFER PRODUCT UPDATE
// ============================================

export async function updateOfferProduct(
    data: Partial<OfferProduct>
): Promise<{ success: boolean; message: string }> {
    const { updateOfferProduct: _update } = await import('../../database');
    return _update(data);
}
