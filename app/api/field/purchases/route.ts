// ════════════════════════════════════════════════════════════════════
// NARUDŽBE — lista za pogon, bez iznosa
//
// Poredak: prvo ono što se čeka (djelomično primljeno, pa poslano), na dnu
// ono što je već stiglo.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireController } from '@/lib/server/requireUser';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { buildFieldPurchasesList } from '@/lib/field/fieldPurchases';
import type { Order, OrderItem, Project } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const caller = await requireController(req);
        const db = adminDb();

        const [orderSnap, itemSnap, projectSnap] = await Promise.all([
            db.collection('orders').where('Organization_ID', '==', caller.orgId).get(),
            db.collection('order_items').where('Organization_ID', '==', caller.orgId).get(),
            db.collection('projects').where('Organization_ID', '==', caller.orgId).get(),
        ]);

        const itemsByOrder = new Map<string, OrderItem[]>();
        itemSnap.docs.forEach(d => {
            const item = d.data() as OrderItem;
            const list = itemsByOrder.get(item.Order_ID) || [];
            list.push(item);
            itemsByOrder.set(item.Order_ID, list);
        });

        const orders = orderSnap.docs.map(d => {
            const o = d.data() as Order;
            o.items = itemsByOrder.get(o.Order_ID) || [];
            return o;
        });

        const projectNames = new Map<string, string>(
            projectSnap.docs.map(d => {
                const p = d.data() as Project;
                return [p.Project_ID, p.Name?.trim() || p.Client_Name || ''] as [string, string];
            })
        );

        return NextResponse.json(
            { purchases: buildFieldPurchasesList({ orders, projectNames }) },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (e) {
        return errorResponse(e);
    }
}
