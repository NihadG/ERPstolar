// ════════════════════════════════════════════════════════════════════
// PRIJEDLOG NALOGA ZA VIŠE RADNIKA ODJEDNOM
//
// Koristi ga žuta traka „N radnika bez dnevnice — Proknjiži" i dugme
// „Svi prisutni". Pojedinačno označavanje prijedlog dobija odmah, u
// odgovoru POST /api/field/attendance.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { getActiveWorkers, getAttendanceForDate } from '@/lib/server/fieldRepo';
import { PRESENT_STATUSES, buildProposalForDate } from '@/lib/server/fieldAttendance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request) {
    try {
        const caller = await requireController(req);
        const body = await req.json().catch(() => ({}));

        const date = String(body.date || '');
        if (!isISODate(date)) throw new HttpError(400, 'Neispravan datum.');

        const requested: string[] = Array.isArray(body.workerIds)
            ? body.workerIds.map((x: unknown) => String(x)).filter(Boolean)
            : [];

        // Status se čita IZ BAZE, ne iz zahtjeva: prijedlog za „Prisutan" i
        // „Teren" nije isti (proizvodnja vs montaža), pa bi lažiran status
        // proknjižio radnika na pogrešnu vrstu naloga.
        const [workers, attendance] = await Promise.all([
            getActiveWorkers(caller.orgId),
            getAttendanceForDate(caller.orgId, date),
        ]);
        const nameById = new Map(workers.map(w => [w.Worker_ID, w.Name]));

        const saved = attendance
            .filter(a => PRESENT_STATUSES.has(a.Status))
            .filter(a => requested.length === 0 || requested.includes(a.Worker_ID))
            .filter(a => nameById.has(a.Worker_ID))
            .map(a => ({
                workerId: a.Worker_ID,
                workerName: nameById.get(a.Worker_ID) || '',
                status: a.Status,
            }));

        return NextResponse.json({ proposal: await buildProposalForDate(caller.orgId, saved, date) });
    } catch (e) {
        return errorResponse(e);
    }
}
