// ════════════════════════════════════════════════════════════════════
// KARTICA PROJEKTA — učitavanje (Admin SDK) + kratki keš
//
// Spaja postojeće čitače: materijali sa stanjem narudžbe (loadProjectMaterials),
// narudžbe sa stavkama, istorija rada (loadProjectHistory), bilježnica, zadaci i
// Kontakti s ulogom na projektu. Tekst složi lib/assistant/projectBrief.ts.
//
// Keš 2 minute po projektu: isti razgovor („a za ormare?", „a kad smo počeli?")
// ne čita bazu ponovo; poslije upisa podaci su svježi za par minuta.
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import { listOrdersWithItems, loadProjectMaterials } from './orderWrites';
import { getAllTasks } from './fieldRepo';
import { loadProjectHistory } from '@/lib/assistant/orderStatus';
import { listMemory } from '@/lib/assistant/store';
import { buildProjectBrief, type BriefInput } from '@/lib/assistant/projectBrief';
import { contactFullName, PROJECT_ROLE_LABELS } from '@/lib/contacts';
import { COLLECTIONS } from '@/lib/services/shared/collections';
import type { Contact, Product, Project } from '@/lib/types';

const TTL_MS = 2 * 60_000;
const cache = new Map<string, { at: number; input: BriefInput }>();

const isOpenTask = (status: string) => status === 'pending' || status === 'in_progress';

export async function loadProjectBriefInput(orgId: string, uid: string, projectId: string, label: string, now = Date.now()): Promise<BriefInput> {
    const key = `${orgId}:${uid}:${projectId}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < TTL_MS) return hit.input;

    const db = adminDb();
    const [projectSnap, productsSnap, materials, orders, history, memory, tasks, contactsSnap] = await Promise.all([
        db.collection(COLLECTIONS.PROJECTS).where('Organization_ID', '==', orgId).where('Project_ID', '==', projectId).limit(1).get(),
        db.collection(COLLECTIONS.PRODUCTS).where('Organization_ID', '==', orgId).where('Project_ID', '==', projectId).get(),
        loadProjectMaterials(orgId, [projectId]),
        listOrdersWithItems(orgId),
        loadProjectHistory(orgId, { projectId }).catch(() => null),
        listMemory(orgId, uid, false),
        getAllTasks(orgId),
        db.collection(COLLECTIONS.CONTACTS).where('Organization_ID', '==', orgId).get(),
    ]);
    const project = projectSnap.empty ? null : (projectSnap.docs[0].data() as Project);
    const linked = (links?: { Entity_Type: string; Entity_ID: string }[]) => (links || []).some(l => l.Entity_Type === 'project' && l.Entity_ID === projectId);

    const input: BriefInput = {
        label,
        status: project?.Status,
        deadline: project?.Deadline || undefined,
        products: productsSnap.docs.map(d => d.data() as Product)
            .sort((a, b) => a.Name.localeCompare(b.Name, 'bs'))
            .map(p => ({ name: p.Name, quantity: Number(p.Quantity) || 1, status: p.Status || '' })),
        materials: materials.map(r => ({
            name: r.name, unit: r.unit, supplier: r.supplier, productName: r.productName,
            needed: r.needed, ordered: r.ordered, received: r.received, onStock: r.onStock,
        })),
        orders: orders
            .map(o => ({ o, mine: (o.items || []).filter(i => i.Project_ID === projectId) }))
            .filter(x => x.mine.length)
            .sort((a, b) => String(b.o.Order_Date).localeCompare(String(a.o.Order_Date)))
            .map(({ o, mine }) => ({
                number: o.Order_Number, supplier: o.Supplier_Name, status: o.Status, date: o.Sent_At || o.Order_Date,
                items: mine.length, materials: Array.from(new Set(mine.map(i => i.Material_Name))),
                emailedAt: o.Emailed_At, supplierDoc: o.Supplier_Doc?.No || undefined, readyAt: o.Ready_At, invoice: o.Invoice?.No || undefined,
            })),
        history,
        notebook: memory.filter(m => m.State === 'open' && linked(m.Links))
            .map(m => ({ title: m.Title, location: m.Location, state: m.State_Label, quantity: m.Quantity })),
        tasks: tasks.filter(t => isOpenTask(t.Status) && linked(t.Links))
            .sort((a, b) => String(a.Due_Date || '9999').localeCompare(String(b.Due_Date || '9999')))
            .map(t => ({ title: t.Title, due: t.Due_Date, worker: t.Assigned_Worker_Name })),
        people: contactsSnap.docs.map(d => d.data() as Contact).flatMap(c => (c.Project_Roles || [])
            .filter(r => r.Project_ID === projectId)
            .map(r => ({ name: contactFullName(c), role: PROJECT_ROLE_LABELS[r.Role] || r.Role, email: c.Email }))),
    };
    cache.set(key, { at: now, input });
    return input;
}

export async function projectBriefText(orgId: string, uid: string, projectId: string, label: string, product?: string): Promise<string> {
    return buildProjectBrief(await loadProjectBriefInput(orgId, uid, projectId, label), { product });
}
