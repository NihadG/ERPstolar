// ════════════════════════════════════════════════════════════════════
// PRIJEDLOZI ZA ODOBRENJE — spisak
//
// Vraća prijedloge koje pozivalac SMIJE odobriti (canApprove po ulozi × vrsti):
// kontrolor vidi samo nenovčane, vlasnik/staff sve. Podrazumijevano „pending".
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, requireController } from '@/lib/server/requireUser';
import { listRequests } from '@/lib/server/changeRequests';
import type { ChangeRequestStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: ChangeRequestStatus[] = ['pending', 'approved', 'rejected', 'failed'];

export async function GET(req: Request) {
    try {
        const caller = await requireController(req);
        const statusParam = new URL(req.url).searchParams.get('status');
        const status = STATUSES.includes(statusParam as ChangeRequestStatus)
            ? (statusParam as ChangeRequestStatus)
            : 'pending';

        const requests = await listRequests(caller.orgId, {
            status,
            approvableBy: caller.isSuperAdmin ? 'owner' : caller.role,
        });

        return NextResponse.json({ requests }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
