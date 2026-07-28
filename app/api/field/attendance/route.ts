// ════════════════════════════════════════════════════════════════════
// ŠIHTARICA — čitanje mjeseca i označavanje prisustva
//
// GET  → radnici + prisustvo za raspon + ključevi dana koji već imaju dnevnicu
// POST → upiši status; ako je prisutan/teren, ODMAH vrati prijedlog naloga
//
// Prijedlog se vraća u istom odgovoru namjerno: u pogonu je mreža slaba, a
// desktop tok je „označi → otvori se dodjela naloga". Dva odvojena poziva
// značila bi vidljivu pauzu između ta dva koraka.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import {
    getActiveWorkers, getAttendanceInRange, getWorkLogsInRange,
} from '@/lib/server/fieldRepo';
import {
    ABSENT_STATUSES, PRESENT_STATUSES, buildProposalForDate, clearAutoLogsForAbsence,
    recalcOrderLabor, setAttendance,
} from '@/lib/server/fieldAttendance';
import { buildFieldAttendance } from '@/lib/field/fieldAttendance';
import { ATTENDANCE_STATUSES } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request) {
    try {
        const caller = await requireController(req);
        const url = new URL(req.url);
        const from = url.searchParams.get('from') || '';
        const to = url.searchParams.get('to') || '';

        if (!isISODate(from) || !isISODate(to) || from > to) {
            throw new HttpError(400, 'Neispravan raspon datuma.');
        }
        // Granica postoji da jedan zahtjev ne povuče godine istorije.
        const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
        if (days > 62) throw new HttpError(400, 'Raspon je predugačak (najviše dva mjeseca).');

        const [workers, attendance, workLogs] = await Promise.all([
            getActiveWorkers(caller.orgId),
            getAttendanceInRange(caller.orgId, from, to),
            getWorkLogsInRange(caller.orgId, from, to),
        ]);

        return NextResponse.json(
            buildFieldAttendance({ from, to, today: todayISO(), workers, attendance, workLogs }),
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (e) {
        return errorResponse(e);
    }
}

export async function POST(req: Request) {
    try {
        const caller = await requireController(req);
        const body = await req.json().catch(() => ({}));

        const workerId = String(body.workerId || '');
        const date = String(body.date || '');
        const status = String(body.status || '');
        const notes = typeof body.notes === 'string' ? body.notes : '';

        if (!workerId) throw new HttpError(400, 'Radnik nije naveden.');
        if (!isISODate(date)) throw new HttpError(400, 'Neispravan datum.');
        if (!(ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
            throw new HttpError(400, 'Nepoznat status prisustva.');
        }

        // Ime radnika se uzima IZ BAZE, ne iz zahtjeva — denormalizovano ime na
        // zapisu mora odgovarati evidenciji, inače se izvještaji razilaze.
        const workers = await getActiveWorkers(caller.orgId);
        const worker = workers.find(w => w.Worker_ID === workerId);
        if (!worker) throw new HttpError(404, 'Radnik nije pronađen.');

        await setAttendance(caller.orgId, {
            workerId, workerName: worker.Name, date, status, notes,
        });

        // Odsutan radnik ne smije zadržati auto-dnevnicu (ručne se čuvaju).
        if (ABSENT_STATUSES.has(status)) {
            const affected = await clearAutoLogsForAbsence(caller.orgId, workerId, date);
            await Promise.all(affected.map(id =>
                recalcOrderLabor(caller.orgId, id).catch(e => console.warn('[field/attendance] recalc', id, e))
            ));
            return NextResponse.json({ ok: true, proposal: null, clearedOrders: affected.length });
        }

        // Prisutan/teren → odmah ponudi dodjelu naloga, kao na desktopu.
        const proposal = PRESENT_STATUSES.has(status)
            ? await buildProposalForDate(caller.orgId, [{ workerId, workerName: worker.Name, status }], date)
            : [];

        return NextResponse.json({ ok: true, proposal });
    } catch (e) {
        return errorResponse(e);
    }
}
