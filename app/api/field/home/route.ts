// ════════════════════════════════════════════════════════════════════
// POGONSKA POČETNA — jedini dovod podataka za radnika i kontrolora
//
// Pogonske uloge nemaju pristup Firestoreu (vidi firestore.rules). Sve što
// njihov telefon dobije prolazi kroz `buildFieldHome`, koji gradi payload
// nabrajanjem polja — nijedan iznos ne izlazi odavde.
//
// `?preview=<uid>` je „Pogledaj kao": vlasnik/admin gleda tuđi ekran bez
// prijave tuđim nalogom. Dozvoljeno samo unutar ISTE organizacije.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { errorResponse, HttpError, requireUser } from '@/lib/server/requireUser';
import { buildFieldHome, weekBounds } from '@/lib/field/fieldHome';
import { isStaffRole } from '@/lib/types';
import type { Task, User, Worker, WorkerAttendance, WorkLog, WorkOrder, WorkOrderItem } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: Request) {
    try {
        const caller = await requireUser(req);
        const db = adminDb();

        // ── Čiji ekran gradimo ───────────────────────────────────────
        const previewUid = new URL(req.url).searchParams.get('preview');
        let subjectUid = caller.uid;
        let preview = false;

        if (previewUid && previewUid !== caller.uid) {
            if (!isStaffRole(caller.role) && !caller.isSuperAdmin) {
                throw new HttpError(403, 'Pregled tuđeg ekrana nije dozvoljen.');
            }
            subjectUid = previewUid;
            preview = true;
        }

        const userSnap = await db.collection('users').doc(subjectUid).get();
        const subject = userSnap.data() as User | undefined;
        if (!subject) throw new HttpError(404, 'Korisnik nije pronađen.');
        // Presudna provjera: vlasnik smije gledati SAMO svoje ljude.
        if (subject.Organization_ID !== caller.orgId) {
            throw new HttpError(403, 'Korisnik ne pripada vašoj organizaciji.');
        }

        const orgId = caller.orgId;
        const today = todayISO();
        const week = weekBounds(today);
        const workerId = subject.Worker_ID || null;

        // ── Dovlačenje ───────────────────────────────────────────────
        // Nalozi: samo otvoreni. Dnevnice/prisustvo: samo tekuća sedmica i samo
        // za tog radnika — pogonskom ekranu ništa više ne treba, a firmi s
        // godinama istorije bi puno povlačenje bilo i sporo i skupo.
        const [orgSnap, workOrderSnap, workerSnap, logSnap, attSnap, taskSnap] = await Promise.all([
            db.collection('organizations').doc(orgId).get(),
            db.collection('work_orders')
                .where('Organization_ID', '==', orgId)
                .where('Status', 'in', ['U toku', 'Na čekanju'])
                .get(),
            workerId
                ? db.collection('workers').where('Worker_ID', '==', workerId).where('Organization_ID', '==', orgId).limit(1).get()
                : Promise.resolve(null),
            workerId
                ? db.collection('work_logs')
                    .where('Organization_ID', '==', orgId).where('Worker_ID', '==', workerId)
                    .where('Date', '>=', week.from).where('Date', '<=', week.to).get()
                : Promise.resolve(null),
            workerId
                ? db.collection('worker_attendance')
                    .where('Organization_ID', '==', orgId).where('Worker_ID', '==', workerId)
                    .where('Date', '>=', week.from).where('Date', '<=', week.to).get()
                : Promise.resolve(null),
            workerId
                ? db.collection('tasks')
                    .where('Organization_ID', '==', orgId).where('Assigned_Worker_ID', '==', workerId).get()
                : Promise.resolve(null),
        ]);

        const workOrders = workOrderSnap.docs.map(d => d.data() as WorkOrder);

        // Stavke su zasebna kolekcija — dovuci ih za dovučene naloge i prikači.
        // `in` prima najviše 30 vrijednosti, pa idemo u komadima.
        const orderIds = workOrders.map(w => w.Work_Order_ID).filter(Boolean);
        const itemsByOrder = new Map<string, WorkOrderItem[]>();
        for (let i = 0; i < orderIds.length; i += 30) {
            const chunk = orderIds.slice(i, i + 30);
            const snap = await db.collection('work_order_items')
                .where('Organization_ID', '==', orgId)
                .where('Work_Order_ID', 'in', chunk)
                .get();
            for (const doc of snap.docs) {
                const item = doc.data() as WorkOrderItem;
                const list = itemsByOrder.get(item.Work_Order_ID) || [];
                list.push(item);
                itemsByOrder.set(item.Work_Order_ID, list);
            }
        }
        for (const wo of workOrders) {
            wo.items = itemsByOrder.get(wo.Work_Order_ID) || [];
        }

        const payload = buildFieldHome({
            today,
            preview,
            user: {
                Name: subject.Name,
                Role: subject.Role,
                Worker_ID: subject.Worker_ID,
                Must_Change_Password: subject.Must_Change_Password,
            },
            organizationName: (orgSnap.data()?.Name as string) || '',
            worker: workerSnap && !workerSnap.empty ? (workerSnap.docs[0].data() as Worker) : null,
            workOrders,
            tasks: taskSnap ? taskSnap.docs.map(d => d.data() as Task) : [],
            attendance: attSnap ? attSnap.docs.map(d => d.data() as WorkerAttendance) : [],
            workLogs: logSnap ? logSnap.docs.map(d => d.data() as WorkLog) : [],
        });

        return NextResponse.json(payload, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (e) {
        return errorResponse(e);
    }
}
