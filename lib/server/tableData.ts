// ════════════════════════════════════════════════════════════════════
// PODACI ZA TABELE — učitavanje za alat make_table (bot)
//
// Materijali: iste količine kao naručivanje (loadProjectMaterials →
// lib/materialCoverage). Bez rečenog projekta — projekti na kojima se radi:
// Odobreno / U proizvodnji, i svaki s otvorenim nalogom (nalog može krenuti
// prije prihvaćene ponude). Završeni, otkazani i skriveni ne ulaze.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import { getItemsForWorkOrders, getOpenWorkOrders } from './fieldRepo';
import { loadProjectMaterials } from './orderWrites';
import type { TableMaterialRow } from '@/lib/tables/sources';
import type { Project } from '@/lib/types';

const WORKING = new Set(['Odobreno', 'U proizvodnji']);
const CLOSED = new Set(['Završeno', 'Otkazano']);

const projectName = (p: Project) => p.Name || p.Client_Name || 'Projekat';

export async function loadTableMaterials(orgId: string, projectIds: string[] | null): Promise<{ rows: TableMaterialRow[]; projects: number }> {
    const snap = await adminDb().collection('projects').where('Organization_ID', '==', orgId).get();
    const all = snap.docs.map(d => d.data() as Project);
    let scope: Project[];
    if (projectIds) {
        scope = all.filter(p => projectIds.includes(p.Project_ID));
    } else {
        const open = await getOpenWorkOrders(orgId);
        const items = await getItemsForWorkOrders(orgId, open.map(o => o.Work_Order_ID));
        const withOrder = new Set(items.map(i => i.Project_ID).filter(Boolean));
        scope = all.filter(p => !p.Hidden && !CLOSED.has(p.Status) && (WORKING.has(p.Status) || withOrder.has(p.Project_ID)));
    }
    const names = new Map(scope.map(p => [p.Project_ID, projectName(p)]));
    const rows = await loadProjectMaterials(orgId, scope.map(p => p.Project_ID));
    return {
        rows: rows.map(r => ({
            name: r.name, unit: r.unit, supplier: r.supplier, unitPrice: r.unitPrice,
            productName: r.productName, projectId: r.projectId, projectName: names.get(r.projectId) || 'Projekat',
            needed: r.needed, onStock: r.onStock, ordered: r.ordered, received: r.received,
            inDrafts: r.inDrafts, toOrder: r.toOrder, status: r.status,
        })),
        projects: scope.length,
    };
}
