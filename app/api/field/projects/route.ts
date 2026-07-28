// ════════════════════════════════════════════════════════════════════
// PROJEKTI I PROIZVODI — pregled za pogon
//
// Bez cijena i bez kontakta klijenta. Jedan zahtjev vraća projekte s
// proizvodima i materijalima; u pogonu je to nekoliko desetina zapisa, pa
// listanje kroz nivoe onda uopšte ne ide na mrežu.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireController } from '@/lib/server/requireUser';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { buildFieldProjectDetail } from '@/lib/field/fieldProjects';
import type { Product, ProductMaterial, Project } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Samo projekti koji su još u igri — završeni i otkazani se u pogonu ne gledaju. */
const ACTIVE = ['Odobreno', 'U proizvodnji'];

export async function GET(req: Request) {
    try {
        const caller = await requireController(req);
        const db = adminDb();

        const projectSnap = await db.collection('projects')
            .where('Organization_ID', '==', caller.orgId)
            .where('Status', 'in', ACTIVE)
            .get();

        const projects = projectSnap.docs
            .map(d => d.data() as Project)
            .filter(p => !p.Hidden);

        if (projects.length === 0) return NextResponse.json({ projects: [] });

        const [productSnap, materialSnap] = await Promise.all([
            db.collection('products').where('Organization_ID', '==', caller.orgId).get(),
            db.collection('product_materials').where('Organization_ID', '==', caller.orgId).get(),
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

        const detailed = projects
            .map(p => {
                p.products = productsByProject.get(p.Project_ID) || [];
                return buildFieldProjectDetail(p);
            })
            .sort((a, b) =>
                (a.deadline || '9999').localeCompare(b.deadline || '9999')
                || a.name.localeCompare(b.name, 'bs')
            );

        return NextResponse.json({ projects: detailed }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
