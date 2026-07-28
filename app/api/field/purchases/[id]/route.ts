// ════════════════════════════════════════════════════════════════════
// NARUDŽBA — detalj sa stavkama za čekiranje prijema
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { buildFieldPurchaseDetail } from '@/lib/field/fieldPurchases';
import type { Order, OrderItem, Project } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireController(req);
        const db = adminDb();

        const orderSnap = await db.collection('orders')
            .where('Organization_ID', '==', caller.orgId)
            .where('Order_ID', '==', params.id)
            .limit(1)
            .get();
        if (orderSnap.empty) throw new HttpError(404, 'Narudžba nije pronađena.');

        const order = orderSnap.docs[0].data() as Order;

        const [itemSnap, projectSnap] = await Promise.all([
            db.collection('order_items')
                .where('Organization_ID', '==', caller.orgId)
                .where('Order_ID', '==', order.Order_ID)
                .get(),
            db.collection('projects').where('Organization_ID', '==', caller.orgId).get(),
        ]);

        order.items = itemSnap.docs.map(d => d.data() as OrderItem);

        const projectNames = new Map<string, string>(
            projectSnap.docs.map(d => {
                const p = d.data() as Project;
                return [p.Project_ID, p.Name?.trim() || p.Client_Name || ''] as [string, string];
            })
        );

        return NextResponse.json(
            buildFieldPurchaseDetail(order, projectNames),
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (e) {
        return errorResponse(e);
    }
}
