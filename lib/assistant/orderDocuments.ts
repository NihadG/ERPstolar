// ════════════════════════════════════════════════════════════════════
// PDF NARUDŽBE U TELEGRAM
//
// Poslije odgovora na „naruči…" bot pošalje PDF (isti raspored kao ERP),
// a uz nacrt dugme „📤 Označi kao poslano" — tek tad materijali postaju
// naručeni, kao kad se u ERP-u narudžba prebaci u „Poslano".
// ════════════════════════════════════════════════════════════════════

import { adminDb } from '@/lib/server/firebaseAdmin';
import { buildOrderPdf, orderPdfFileName, type PdfCompany } from '@/lib/server/orderPdf';
import { getOrderWithItems, getSupplier, loadOrderSpecs } from '@/lib/server/orderWrites';
import { sendDocument, sendMessage } from '@/lib/telegram/api';

async function companyOf(orgId: string): Promise<PdfCompany> {
    const snap = await adminDb().collection('org_settings').doc(orgId).get();
    return ((snap.data() as { companyInfo?: PdfCompany } | undefined)?.companyInfo) || {};
}

export async function sendOrderPdf(chatId: number | string, orgId: string, orderId: string, draft: boolean): Promise<void> {
    const order = await getOrderWithItems(orgId, orderId);
    if (!order) {
        await sendMessage(chatId, 'Narudžba više ne postoji.');
        return;
    }
    const [supplier, specs, company] = await Promise.all([
        getSupplier(orgId, order.Supplier_ID, order.Supplier_Name),
        loadOrderSpecs(orgId, order),
        companyOf(orgId),
    ]);
    const pdf = buildOrderPdf({ order, supplier, specs, company });
    await sendDocument(chatId, { buffer: pdf, filename: orderPdfFileName(order) },
        `Narudžba ${order.Order_Number} · ${order.Supplier_Name} (${order.Status})`,
        draft && order.Status === 'Nacrt' ? [[{ text: '📤 Označi kao poslano', data: `ordsent:${order.Order_ID}` }]] : undefined);
}
