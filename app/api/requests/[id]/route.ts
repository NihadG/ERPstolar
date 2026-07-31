// ════════════════════════════════════════════════════════════════════
// PRIJEDLOG — odobri / odbij / zatvori
//
// POST { action: 'approve' | 'reject' | 'resolve', reason?, appliedPayload? }
//   • approve  — nenovčani prijedlog: server primjenjuje izmjenu,
//   • reject   — odbijanje uz razlog,
//   • resolve  — novčani prijedlog: vlasnik ga je već primijenio na desktopu
//                (kroz gejt osnovice), ovo samo zatvara zahtjev.
//
// Dozvolu i jednokratnost garantuje resolveRequest (canApprove + transakcija).
// ════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireController } from '@/lib/server/requireUser';
import { resolveRequest, type ResolveDecision } from '@/lib/server/changeRequests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
    try {
        const caller = await requireController(req);
        const body = await req.json().catch(() => ({}));
        const action = String(body.action || '');

        let decision: ResolveDecision;
        if (action === 'approve') {
            decision = { action: 'approve' };
        } else if (action === 'reject') {
            decision = { action: 'reject', reason: typeof body.reason === 'string' ? body.reason.trim() : undefined };
        } else if (action === 'resolve') {
            decision = { action: 'resolve', appliedPayload: body.appliedPayload };
        } else {
            throw new HttpError(400, 'Nepoznata radnja.');
        }

        const request = await resolveRequest(caller.orgId, params.id, decision, {
            uid: caller.uid,
            name: caller.email || 'Odobravač',
            role: caller.role,
            isSuperAdmin: caller.isSuperAdmin,
        });

        return NextResponse.json({ ok: true, request }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
        return errorResponse(e);
    }
}
