// ════════════════════════════════════════════════════════════════════
// RADNIKOVA EFIKASNOST — suptilan lični pregled
//
// Tekući mjesec + zadnjih 8 sedmica. Brojke stoje jedna pored druge; nigdje
// nema ocjene, poređenja s drugima ni iznosa. „Tempo" traži i timski utrošak
// po stavci (dnevnice svih radnika te stavke ovaj mjesec) — zato jedan org-upit
// za mjesec, filtriran u projekciji.
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireFieldUser } from '@/lib/server/requireUser';
import { resolveWorkerSubject } from '@/lib/server/fieldSubject';
import {
    getAttendanceForWorkerRange, getItemsByIds, getWorkLogsForWorkerRange, getWorkLogsInRange,
} from '@/lib/server/fieldRepo';
import { buildWorkerEfficiency } from '@/lib/field/fieldWorker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const toISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Ponedjeljak sedmice u kojoj je datum. */
function mondayOf(d: Date): Date {
    const dow = (d.getDay() + 6) % 7;
    const m = new Date(d);
    m.setDate(d.getDate() - dow);
    return m;
}

export async function GET(req: Request) {
    try {
        const caller = await requireFieldUser(req);
        const { workerId } = await resolveWorkerSubject(req, caller);
        const orgId = caller.orgId;

        const now = new Date();
        const today = toISO(now);

        // Prozor: ponedjeljak prije 7 sedmica → nedjelja tekuće sedmice.
        const curMon = mondayOf(now);
        const windowStart = new Date(curMon); windowStart.setDate(curMon.getDate() - 7 * 7);
        const windowEnd = new Date(curMon); windowEnd.setDate(curMon.getDate() + 6);
        const windowFrom = toISO(windowStart);
        const windowTo = toISO(windowEnd);

        // Tekući mjesec.
        const monthFrom = `${today.slice(0, 7)}-01`;
        const monthEndDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const monthTo = `${today.slice(0, 7)}-${String(monthEndDay).padStart(2, '0')}`;

        const [workLogs, attendance, monthOrgLogs] = await Promise.all([
            getWorkLogsForWorkerRange(orgId, workerId, windowFrom, windowTo),
            getAttendanceForWorkerRange(orgId, workerId, windowFrom, windowTo),
            getWorkLogsInRange(orgId, monthFrom, monthTo),
        ]);

        // Stavke kojih se radnik dotakao ovaj mjesec — za planirane dane i nazive.
        const monthItemIds = Array.from(new Set(
            workLogs
                .filter(l => {
                    const d = (l.Date || '').split('T')[0];
                    return d >= monthFrom && d <= monthTo;
                })
                .map(l => l.Work_Order_Item_ID)
                .filter(Boolean)
        ));
        const items = monthItemIds.length ? await getItemsByIds(orgId, monthItemIds) : [];

        const efficiency = buildWorkerEfficiency({
            today,
            workerId,
            monthFrom,
            monthTo,
            workLogs,
            itemLogs: monthOrgLogs,
            attendance,
            items,
        });

        return NextResponse.json(efficiency, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
