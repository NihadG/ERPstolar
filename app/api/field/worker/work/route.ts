// ════════════════════════════════════════════════════════════════════
// RADNIKOV RAD — nalozi + projekti u jednom zahtjevu
//
// Jedan dohvat pokriva oba taba (Nalozi i Projekti) jer dijele izvor. Radnik
// tako ne plaća dvije mreže, a poniranje projekat → proizvod → materijali ne
// ide više na mrežu. Bez ijednog iznosa (projekcija se gradi nabrajanjem polja).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireFieldUser } from '@/lib/server/requireUser';
import { resolveWorkerSubject } from '@/lib/server/fieldSubject';
import {
    attachItems, getItemsForWorkOrders, getOpenWorkOrders, getWorkLogsInRange,
} from '@/lib/server/fieldRepo';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { buildWorkerOrders, buildWorkerProjects, myProductIds } from '@/lib/field/fieldWorker';
import type { Product, ProductMaterial, Project, Task } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIVE_PROJECTS = ['Odobreno', 'U proizvodnji'];

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        const { workerId } = await resolveWorkerSubject(req, caller);
        const orgId = caller.orgId;
        const today = todayISO();

        // ── Nalozi ───────────────────────────────────────────────────
        const [orders, todayLogs, taskSnap] = await Promise.all([
            getOpenWorkOrders(orgId),
            getWorkLogsInRange(orgId, today, today),
            adminDb().collection('tasks').where('Organization_ID', '==', orgId).get(),
        ]);
        const items = await getItemsForWorkOrders(orgId, orders.map(o => o.Work_Order_ID));
        attachItems(orders, items);

        const tasks = taskSnap.docs.map(d => d.data() as Task);
        const orderRows = buildWorkerOrders({
            today,
            workerId,
            orders,
            tasks,
            workedTodayOrderIds: new Set(todayLogs.map(l => l.Work_Order_ID).filter(Boolean)),
        });

        // ── Projekti (samo radnikovi proizvodi) ──────────────────────
        const wantedProductIds = myProductIds(orders, workerId);
        let projectRows: ReturnType<typeof buildWorkerProjects> = [];

        if (wantedProductIds.size > 0) {
            const projectSnap = await adminDb().collection('projects')
                .where('Organization_ID', '==', orgId)
                .where('Status', 'in', ACTIVE_PROJECTS)
                .get();
            const projects = projectSnap.docs.map(d => d.data() as Project).filter(p => !p.Hidden);

            if (projects.length > 0) {
                const [productSnap, materialSnap] = await Promise.all([
                    adminDb().collection('products').where('Organization_ID', '==', orgId).get(),
                    adminDb().collection('product_materials').where('Organization_ID', '==', orgId).get(),
                ]);

                const materialsByProduct = new Map<string, ProductMaterial[]>();
                materialSnap.docs.forEach(d => {
                    const m = d.data() as ProductMaterial;
                    const list = materialsByProduct.get(m.Product_ID) || [];
                    list.push(m);
                    materialsByProduct.set(m.Product_ID, list);
                });

                const productsByProject = new Map<string, Product[]>();
                productSnap.docs.forEach(d => {
                    const p = d.data() as Product;
                    p.materials = materialsByProduct.get(p.Product_ID) || [];
                    const list = productsByProject.get(p.Project_ID) || [];
                    list.push(p);
                    productsByProject.set(p.Project_ID, list);
                });
                projects.forEach(p => { p.products = productsByProject.get(p.Project_ID) || []; });

                projectRows = buildWorkerProjects({ workerId, projects, productIds: wantedProductIds });
            }
        }

        return NextResponse.json(
            { today, orders: orderRows, projects: projectRows },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (e) {
        return errorResponse(e);
    }
}
