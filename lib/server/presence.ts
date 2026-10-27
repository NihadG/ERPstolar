// ════════════════════════════════════════════════════════════════════
// PRISUSTVO IZ TELEGRAMA — sloj „Prisustvo" (šihtarica)
//
// „Svi su prisutni", „Kerim bolovanje", „Amer i Bego na terenu" upisuju
// SAMO prisustvo. Dnevnice nastaju tačno kao kad se u aplikaciji označi
// prisustvo i potvrdi predčekiran prijedlog: nalozi koje je radnik tog dana
// već imao, inače nalozi zadnjeg ranijeg dana (lib/attendanceBooking).
// Radnik bez ranijeg rada ostaje samo prisutan — nalog se ne izmišlja.
// Procesi se ne diraju. Sve ide pod ↩️ Poništi (snimak prije, novo = null).
// ════════════════════════════════════════════════════════════════════

import { adminDb } from './firebaseAdmin';
import { getActiveWorkers, getWorkLogRefsForWorkerDate, getWorkOrderRef, getItemDocsForWorkOrder } from './fieldRepo';
import {
    ABSENT_STATUSES, PRESENT_STATUSES, buildProposalForDate, commitBooking, recalcOrderLabor, renormalizeWorkerDay,
} from './fieldAttendance';
import { upsertAttendance, type TrackHook } from './workDiary';

export interface PresenceRow {
    workerId: string;
    worker: string;
    status: string;
    /** Prisustvo je ovim upisom postavljeno ili promijenjeno. */
    changed: boolean;
    /** Nalozi na koje je dan proknjižen po pravilu šihtarice (imena). */
    orders: string[];
    /** Prisutan, a nema naloga za predložiti (nema ranijeg rada). */
    noOrders: boolean;
}

export async function markPresence(
    orgId: string,
    input: { workerIds: string[]; status: string; date: string },
    track: TrackHook = () => undefined,
): Promise<PresenceRow[]> {
    const workers = (await getActiveWorkers(orgId)).filter(w => input.workerIds.includes(w.Worker_ID));
    const rows: PresenceRow[] = [];
    for (const w of workers) {
        const changed = await upsertAttendance(orgId, w.Worker_ID, w.Name, input.date, input.status, track);
        rows.push({ workerId: w.Worker_ID, worker: w.Name, status: input.status, changed, orders: [], noOrders: false });
    }

    // Odsutan: dnevnice iz šihtarice i diktata tog dana se brišu (ručni unos u ERP-u ostaje).
    if (ABSENT_STATUSES.has(input.status)) {
        const affected = new Set<string>();
        for (const r of rows) {
            const logs = await getWorkLogRefsForWorkerDate(orgId, r.workerId, input.date);
            const batch = adminDb().batch();
            for (const l of logs) {
                if (l.data.Booking_Source === 'manual' && l.data.Entry_Source !== 'telegram') continue;
                track(l.ref.path, l.data as unknown as Record<string, unknown>);
                batch.delete(l.ref);
                if (l.data.Work_Order_ID) affected.add(l.data.Work_Order_ID);
            }
            await batch.commit();
            (await renormalizeWorkerDay(orgId, r.workerId, input.date)).forEach(id => affected.add(id));
        }
        for (const id of Array.from(affected)) await recalcOrderLabor(orgId, id);
        return rows;
    }
    if (!PRESENT_STATUSES.has(input.status)) return rows;

    // Prisutan / teren: isti prijedlog kao u aplikaciji, potvrđen onako kako je predčekiran.
    const proposal = await buildProposalForDate(orgId, rows.map(r => ({ workerId: r.workerId, workerName: r.worker, status: input.status })), input.date);
    const nameOf = new Map<string, string>();
    proposal.forEach(p => (p.kind === 'present' || p.kind === 'teren') && p.orders.forEach(o => nameOf.set(o.workOrderId, o.name)));
    const decisions = proposal
        .filter(p => p.suggestedOrderIds.length)
        .map(p => ({ workerId: p.workerId, workerName: p.workerName, orderIds: p.suggestedOrderIds, presence: (p.bookedPresence === 0.5 ? 0.5 : 1) as 0.5 | 1 }));
    rows.forEach(r => {
        const d = decisions.find(x => x.workerId === r.workerId);
        r.orders = (d?.orderIds || []).map(id => nameOf.get(id) || id);
        r.noOrders = !d;
    });
    if (!decisions.length) return rows;

    // Snimak za ↩️: dnevnice tih radnika tog dana, nalozi i njihove stavke (trošak rada, start naloga).
    const before = new Set<string>();
    for (const d of decisions) {
        for (const l of await getWorkLogRefsForWorkerDate(orgId, d.workerId, input.date)) {
            track(l.ref.path, l.data as unknown as Record<string, unknown>);
            before.add(l.ref.path);
        }
    }
    for (const woId of Array.from(new Set(decisions.flatMap(d => d.orderIds)))) {
        const ref = await getWorkOrderRef(orgId, woId);
        if (ref) track(ref.path, (await ref.get()).data() as Record<string, unknown>);
        for (const it of await getItemDocsForWorkOrder(orgId, woId)) track(it.ref.path, it.data as unknown as Record<string, unknown>);
    }
    await commitBooking(orgId, input.date, decisions);
    for (const d of decisions) {
        for (const l of await getWorkLogRefsForWorkerDate(orgId, d.workerId, input.date)) {
            if (!before.has(l.ref.path)) track(l.ref.path, null);
        }
    }
    return rows;
}
