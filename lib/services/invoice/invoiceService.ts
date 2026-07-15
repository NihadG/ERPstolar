/**
 * invoiceService.ts — Završni račun (final invoice) CRUD + izdavanje/storno.
 *
 * Rješava sukob "cijena prihvaćene ponude" vs "cijena po trenutnim materijalima"
 * u trenutku fakturisanja bez uticaja na samu ponudu (koja ostaje ugovorni zapis):
 * korisnik po proizvodu bira ponuda/svježe preračunato/ručno (lib/invoicePricing.ts),
 * a izdavanjem se izabrane cijene upisuju kao Profit_Overrides.Selling_Price na
 * WorkOrderItem — isti mehanizam kao ručna korekcija profita (saveProfitOverrides),
 * pa ih SVI prikazi profita odmah koriste.
 */

import { COLLECTIONS } from '../shared/collections';
import {
    getDb, query, collection, where, getDocs, writeBatch, doc,
    findByIdAndOrg, findRef, updateDocByRef,
    type DocumentReference,
} from '../shared/firestoreClient';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from '../shared/idGenerator';
import { distributeAmountByQuantity, type InvoiceLineDraft } from '../../invoicePricing';
import type { Invoice, InvoiceItem, OfferProduct, WorkOrder, WorkOrderItem } from '../../types';

// ============================================
// READ
// ============================================

export async function getInvoicesForProject(projectId: string, organizationId: string): Promise<Invoice[]> {
    if (!organizationId || !projectId) return [];
    const db = getDb();

    const invoicesSnap = await getDocs(query(
        collection(db, COLLECTIONS.INVOICES),
        where('Project_ID', '==', projectId),
        where('Organization_ID', '==', organizationId)
    ));
    const invoices = invoicesSnap.docs.map(d => d.data() as Invoice);
    if (invoices.length === 0) return [];

    const invoiceIds = invoices.map(i => i.Invoice_ID);
    const itemsByInvoice = new Map<string, InvoiceItem[]>();
    for (let i = 0; i < invoiceIds.length; i += 30) {
        const chunk = invoiceIds.slice(i, i + 30);
        const itemsSnap = await getDocs(query(
            collection(db, COLLECTIONS.INVOICE_ITEMS),
            where('Invoice_ID', 'in', chunk),
            where('Organization_ID', '==', organizationId)
        ));
        itemsSnap.docs.forEach(d => {
            const item = d.data() as InvoiceItem;
            const arr = itemsByInvoice.get(item.Invoice_ID) || [];
            arr.push(item);
            itemsByInvoice.set(item.Invoice_ID, arr);
        });
    }
    invoices.forEach(inv => { inv.items = itemsByInvoice.get(inv.Invoice_ID) || []; });
    return invoices.sort((a, b) => (b.Created_Date || '').localeCompare(a.Created_Date || ''));
}

// ============================================
// CREATE / UPDATE DRAFT
// ============================================

export interface InvoiceDraftInput {
    Invoice_ID?: string;   // postoji → update-in-place; inače → kreiraj novi
    Project_ID: string;
    Offer_ID?: string;
    Notes?: string;
    lines: InvoiceLineDraft[];
}

/** Snimi nacrt (ili ažuriraj postojeći nacrt) završnog računa — redovi se u potpunosti zamjenjuju. */
export async function saveInvoiceDraft(
    input: InvoiceDraftInput,
    organizationId: string
): Promise<{ success: boolean; data?: { Invoice_ID: string }; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };
    if (!input.lines || input.lines.length === 0) return { success: false, message: 'Račun nema nijednu stavku' };

    try {
        const db = getDb();
        const subtotal = input.lines.reduce((s, l) => s + (l.finalTotal || 0), 0);
        const batch = writeBatch(db);
        let invoiceId = input.Invoice_ID;

        if (invoiceId) {
            const ref = await findRef(COLLECTIONS.INVOICES, 'Invoice_ID', invoiceId, organizationId);
            if (!ref) return { success: false, message: 'Račun nije pronađen' };
            batch.update(ref, { Notes: input.Notes || '', Subtotal: subtotal, Total: subtotal });
            const existingItemsSnap = await getDocs(query(
                collection(db, COLLECTIONS.INVOICE_ITEMS),
                where('Invoice_ID', '==', invoiceId),
                where('Organization_ID', '==', organizationId)
            ));
            existingItemsSnap.docs.forEach(d => batch.delete(d.ref));
        } else {
            invoiceId = uuidv4();
            const existingSnap = await getDocs(query(
                collection(db, COLLECTIONS.INVOICES),
                where('Organization_ID', '==', organizationId)
            ));
            const existingNumbers = existingSnap.docs.map(d => d.data().Invoice_Number as string).filter(Boolean);
            const invoice: Invoice = {
                Invoice_ID: invoiceId,
                Organization_ID: organizationId,
                Project_ID: input.Project_ID,
                Offer_ID: input.Offer_ID,
                Invoice_Number: generateInvoiceNumber(existingNumbers),
                Status: 'Nacrt',
                Created_Date: new Date().toISOString(),
                Notes: input.Notes || '',
                Subtotal: subtotal,
                Total: subtotal,
            } as Invoice & { Organization_ID: string };
            batch.set(doc(collection(db, COLLECTIONS.INVOICES)), invoice);
        }

        for (const line of input.lines) {
            const invoiceItem: InvoiceItem & { Organization_ID: string } = {
                ID: uuidv4(),
                Organization_ID: organizationId,
                Invoice_ID: invoiceId,
                Product_ID: line.productId,
                Product_Name: line.productName,
                Quantity: line.quantity,
                Offer_Unit_Price: line.offerUnitPrice,
                Recalculated_Unit_Price: line.recalculatedUnitPrice,
                Final_Unit_Price: line.finalUnitPrice,
                Final_Total: line.finalTotal,
                Price_Source: line.priceSource,
            };
            batch.set(doc(collection(db, COLLECTIONS.INVOICE_ITEMS)), invoiceItem);
        }

        await batch.commit();
        return { success: true, data: { Invoice_ID: invoiceId }, message: 'Nacrt računa sačuvan' };
    } catch (error) {
        console.error('saveInvoiceDraft error:', error);
        return { success: false, message: 'Greška pri snimanju računa' };
    }
}

export async function deleteInvoice(invoiceId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };
    try {
        const db = getDb();
        const itemsSnap = await getDocs(query(
            collection(db, COLLECTIONS.INVOICE_ITEMS),
            where('Invoice_ID', '==', invoiceId),
            where('Organization_ID', '==', organizationId)
        ));
        const batch = writeBatch(db);
        itemsSnap.docs.forEach(d => batch.delete(d.ref));
        const ref = await findRef(COLLECTIONS.INVOICES, 'Invoice_ID', invoiceId, organizationId);
        if (ref) batch.delete(ref);
        await batch.commit();
        return { success: true, message: 'Račun obrisan' };
    } catch (error) {
        console.error('deleteInvoice error:', error);
        return { success: false, message: 'Greška pri brisanju računa' };
    }
}

// ============================================
// IZDAVANJE — cijene postaju zvanični prihod
// ============================================

/**
 * Izdaj završni račun: validira, pa ATOMSKI (jedan batch) upisuje Profit_Overrides.Selling_Price
 * (+ Product_Value mirror, isti oblik kao saveProfitOverrides) na sve pogođene WorkOrderItem-e,
 * raspoređujući Final_Total svakog reda po količini kad je proizvod podijeljen na više stavki.
 * Nakon uspješnog commit-a se pokreće recalculateWorkOrder po pogođenom nalogu — TAČNO JEDNOM
 * (dedup po Work_Order_ID), bez obzira koliko redova računa pripada istom nalogu.
 */
export async function issueInvoice(invoiceId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };
    try {
        const db = getDb();
        const { data: invoice, ref: invoiceRef } = await findByIdAndOrg<Invoice>(COLLECTIONS.INVOICES, 'Invoice_ID', invoiceId, organizationId);
        if (!invoice || !invoiceRef) return { success: false, message: 'Račun nije pronađen' };
        if (invoice.Status === 'Izdat') return { success: false, message: 'Račun je već izdat' };

        // v1: samo jedan aktivan (Izdat) račun po projektu.
        const existingForProject = await getInvoicesForProject(invoice.Project_ID, organizationId);
        if (existingForProject.some(i => i.Status === 'Izdat' && i.Invoice_ID !== invoiceId)) {
            return { success: false, message: 'Projekat već ima izdat završni račun — storniraj ga prije izdavanja novog' };
        }

        const itemsSnap = await getDocs(query(
            collection(db, COLLECTIONS.INVOICE_ITEMS),
            where('Invoice_ID', '==', invoiceId),
            where('Organization_ID', '==', organizationId)
        ));
        if (itemsSnap.empty) return { success: false, message: 'Račun nema nijednu stavku' };
        const invoiceItems = itemsSnap.docs.map(d => ({ ref: d.ref, data: d.data() as InvoiceItem }));
        if (invoiceItems.some(({ data }) => !((data.Final_Unit_Price || 0) > 0))) {
            return { success: false, message: 'Sve stavke moraju imati cijenu veću od 0 prije izdavanja' };
        }

        // Ciljni radni nalozi: ne-otkazani, NE-montaža (montaža ne nosi prihod — vidi lib/projectProfit.ts).
        const [woItemsSnap, woSnap] = await Promise.all([
            getDocs(query(
                collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
                where('Project_ID', '==', invoice.Project_ID),
                where('Organization_ID', '==', organizationId)
            )),
            getDocs(query(collection(db, COLLECTIONS.WORK_ORDERS), where('Organization_ID', '==', organizationId))),
        ]);
        const woById = new Map(woSnap.docs.map(d => [(d.data() as WorkOrder).Work_Order_ID, d.data() as WorkOrder]));
        const itemsByProduct = new Map<string, { ref: DocumentReference; data: WorkOrderItem }[]>();
        woItemsSnap.docs.forEach(d => {
            const item = d.data() as WorkOrderItem;
            const wo = woById.get(item.Work_Order_ID);
            if (!wo || wo.Status === 'Otkazano' || wo.Work_Order_Type === 'Montaža') return;
            const arr = itemsByProduct.get(item.Product_ID) || [];
            arr.push({ ref: d.ref, data: item });
            itemsByProduct.set(item.Product_ID, arr);
        });

        const batch = writeBatch(db);
        const nowIso = new Date().toISOString();
        const recalcWoIds = new Set<string>();

        for (const { ref: invItemRef, data: line } of invoiceItems) {
            const matches = itemsByProduct.get(line.Product_ID) || [];
            const workOrderItemIds: string[] = [];
            if (matches.length > 0) {
                const distribution = distributeAmountByQuantity(
                    line.Final_Total,
                    matches.map(m => ({ id: m.data.ID, qty: m.data.Quantity || 1 }))
                );
                for (const { id, amount } of distribution) {
                    const match = matches.find(m => m.data.ID === id)!;
                    batch.update(match.ref, {
                        Profit_Overrides: { Selling_Price: amount, Notes: `Završni račun ${invoice.Invoice_Number}`, Updated_At: nowIso },
                        Product_Value: amount, // mirror — isti oblik kao saveProfitOverrides (database.ts)
                    });
                    workOrderItemIds.push(id);
                    recalcWoIds.add(match.data.Work_Order_ID);
                }
            }
            // Linija bez WO stavke (nalog još nije kreiran) — dozvoljeno, prazan audit trag.
            batch.update(invItemRef, { Work_Order_Item_IDs: workOrderItemIds });
        }

        batch.update(invoiceRef, { Status: 'Izdat', Issued_Date: nowIso });
        await batch.commit();

        const { recalculateWorkOrder } = await import('../../attendance');
        await Promise.all(Array.from(recalcWoIds).map(id =>
            recalculateWorkOrder(id).catch(err => console.warn('issueInvoice: recalc failed (non-critical):', id, err))
        ));

        return { success: true, message: `Račun ${invoice.Invoice_Number} izdat` };
    } catch (error) {
        console.error('issueInvoice error:', error);
        return { success: false, message: 'Greška pri izdavanju računa' };
    }
}

// ============================================
// STORNO — vrati naloge na cijenu ponude
// ============================================

/**
 * Storniraj izdat račun: briše Profit_Overrides i EKSPLICITNO vraća Product_Value iz
 * prihvaćene ponude (Selling_Price × Quantity) na svaki pogođeni WorkOrderItem — ne
 * oslanja se na recalculateWorkOrder-ov one-time backfill (koji bi preskočio stavku
 * čiji je Product_Value>0 od override-a).
 */
export async function cancelInvoice(invoiceId: string, organizationId: string): Promise<{ success: boolean; message: string }> {
    if (!organizationId) return { success: false, message: 'Organization ID is required' };
    try {
        const db = getDb();
        const { data: invoice, ref: invoiceRef } = await findByIdAndOrg<Invoice>(COLLECTIONS.INVOICES, 'Invoice_ID', invoiceId, organizationId);
        if (!invoice || !invoiceRef) return { success: false, message: 'Račun nije pronađen' };
        if (invoice.Status !== 'Izdat') return { success: false, message: 'Samo izdat račun se može stornirati' };

        const itemsSnap = await getDocs(query(
            collection(db, COLLECTIONS.INVOICE_ITEMS),
            where('Invoice_ID', '==', invoiceId),
            where('Organization_ID', '==', organizationId)
        ));
        const allWoItemIds = itemsSnap.docs.flatMap(d => (d.data() as InvoiceItem).Work_Order_Item_IDs || []);

        if (allWoItemIds.length === 0) {
            await updateDocByRef(invoiceRef, { Status: 'Storniran' });
            return { success: true, message: 'Račun storniran' };
        }

        // Prihvaćena ponuda projekta — izvor za restauraciju Product_Value.
        const offerSnap = await getDocs(query(
            collection(db, COLLECTIONS.OFFERS),
            where('Project_ID', '==', invoice.Project_ID),
            where('Status', '==', 'Prihvaćeno'),
            where('Organization_ID', '==', organizationId)
        ));
        const offerProductByProduct = new Map<string, OfferProduct>();
        if (!offerSnap.empty) {
            const offerId = offerSnap.docs[0].data().Offer_ID;
            const opSnap = await getDocs(query(
                collection(db, COLLECTIONS.OFFER_PRODUCTS),
                where('Offer_ID', '==', offerId),
                where('Organization_ID', '==', organizationId)
            ));
            opSnap.docs.forEach(d => {
                const op = d.data() as OfferProduct;
                offerProductByProduct.set(op.Product_ID, op);
            });
        }

        const batch = writeBatch(db);
        const recalcWoIds = new Set<string>();
        for (let i = 0; i < allWoItemIds.length; i += 30) {
            const chunk = allWoItemIds.slice(i, i + 30);
            const woItemsSnap = await getDocs(query(
                collection(db, COLLECTIONS.WORK_ORDER_ITEMS),
                where('ID', 'in', chunk),
                where('Organization_ID', '==', organizationId)
            ));
            woItemsSnap.docs.forEach(d => {
                const item = d.data() as WorkOrderItem;
                const op = offerProductByProduct.get(item.Product_ID);
                const restoredValue = op ? (op.Selling_Price || 0) * (item.Quantity || 1) : 0;
                batch.update(d.ref, { Profit_Overrides: {}, Product_Value: restoredValue });
                recalcWoIds.add(item.Work_Order_ID);
            });
        }
        batch.update(invoiceRef, { Status: 'Storniran' });
        await batch.commit();

        const { recalculateWorkOrder } = await import('../../attendance');
        await Promise.all(Array.from(recalcWoIds).map(id =>
            recalculateWorkOrder(id).catch(err => console.warn('cancelInvoice: recalc failed (non-critical):', id, err))
        ));

        return { success: true, message: 'Račun storniran, cijene naloga vraćene na ponudu' };
    } catch (error) {
        console.error('cancelInvoice error:', error);
        return { success: false, message: 'Greška pri storniranju računa' };
    }
}
